-- Aires y Destinos: notificaciones push (Web Push) para el personal de la agencia cuando llega un mensaje nuevo en una conversación del portal.
-- Ejecutar completo en Supabase > SQL Editor (requiere company_portal.sql ya aplicado). Idempotente y NO destructivo.
--
-- Flujo: INSERT en client_request_messages (autor = cliente) -> trigger -> pg_net -> Edge Function «push-notify» -> servicio push (Apple/Google/Microsoft) -> dispositivo.
-- El trigger nunca bloquea ni hace fallar el mensaje: ante cualquier error simplemente no notifica.

create extension if not exists pg_net with schema extensions;

-- 1. Suscripciones: una fila por dispositivo/navegador del personal. Solo se gestionan con funciones (sin privilegios directos para authenticated).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;
drop policy if exists agency_only on public.push_subscriptions;
create policy agency_only on public.push_subscriptions as restrictive for all to authenticated using ((select public.is_agency_user())) with check ((select public.is_agency_user()));

-- 2. Configuración secreta del webhook (sin ningún privilegio para anon/authenticated; solo la lee el trigger, que es security definer)
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant all on public.app_secrets to service_role;

-- 3. Funciones para registrar / quitar el dispositivo (solo personal de la agencia; el usuario sale siempre de auth.uid())
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_agency_user() then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Suscripción no válida.'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_ua, ''), 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, updated_at = now();
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_agency_user() then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text) to authenticated, service_role;

-- 4. Trigger: avisa a la Edge Function cuando el CLIENTE (o el administrador de empresa, que se guarda del lado del cliente) escribe
create or replace function public.push_notify_message() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_secret text;
begin
  if new.author <> 'client' then return new; end if;
  select value into v_url from public.app_secrets where key = 'push_function_url';
  select value into v_secret from public.app_secrets where key = 'push_webhook_secret';
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(url := v_url, body := jsonb_build_object('message_id', new.id, 'request_id', new.request_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret), timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.push_notify_message() from public, anon, authenticated;
drop trigger if exists client_request_messages_push on public.client_request_messages;
create trigger client_request_messages_push after insert on public.client_request_messages for each row execute function public.push_notify_message();

notify pgrst, 'reload schema';

-- 5. PASO MANUAL (una sola vez; sustituye los dos valores). El secreto debe ser el MISMO que el secret PUSH_WEBHOOK_SECRET de la Edge Function:
-- insert into public.app_secrets (key, value) values
--   ('push_function_url', 'https://kvsowhgaimpfmfgkxknm.supabase.co/functions/v1/push-notify'),
--   ('push_webhook_secret', 'PEGA_AQUI_UN_SECRETO_LARGO_ALEATORIO')
-- on conflict (key) do update set value = excluded.value;
