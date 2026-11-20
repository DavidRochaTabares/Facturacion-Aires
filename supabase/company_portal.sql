-- Aires y Destinos: portal empresarial. Ejecutar completo en Supabase > SQL Editor (requiere client_requests.sql, request_items.sql y portal_chat_first.sql ya aplicados).
-- Idempotente y NO destructivo: solo agrega columnas opcionales, tablas, funciones, triggers y políticas. No borra ni modifica datos existentes.
--
-- Modelo de seguridad
--  * Cada empresa tiene UN administrador con cuenta de Supabase Auth (tabla company_admins). Ese usuario es «authenticated» como el personal de la agencia,
--    por eso se agrega a CADA tabla de public (y a storage.objects) una política RESTRICTIVA «agency_only»: solo pasa quien NO es administrador empresarial.
--    Las políticas restrictivas se combinan con AND con las permisivas existentes, así que el personal de la agencia no cambia en nada.
--  * El administrador empresarial no lee tablas: solo ejecuta funciones company_* (security definer) que resuelven SIEMPRE su empresa desde auth.uid().
--    Nunca reciben company_id desde el navegador.
--  * Los archivos siguen en el bucket privado «client-requests»; el administrador solo puede LEER (URL firmada) los de conversaciones de su empresa.
--  * Enlaces públicos de empresa: solo se guarda el hash SHA-256 del token; revocar = marcar revoked_at. La Edge Function «company-access» (service_role)
--    valida el enlace y crea una conversación nueva (con su propio enlace privado) a nombre del empleado.
--  * IMPORTANTE: una fila de company_admins NUNCA debe borrarse sin borrar también el usuario de Auth (la desactivación se hace con active = false).
--    Desactiva también «Allow new users to sign up» en Supabase > Authentication > Providers > Email.

-- 1. Columnas nuevas en la conversación -------------------------------------------------------------------------------------------------------------
alter table public.client_requests
  add column if not exists company_id uuid references public.companies (id) on delete restrict,
  add column if not exists approval_status text check (approval_status in ('pending_approval', 'approved', 'rejected', 'in_management', 'completed')),
  add column if not exists approval_updated_at timestamptz;
create index if not exists client_requests_company_idx on public.client_requests (company_id, last_activity_at desc) where company_id is not null;

-- 2. Tablas ---------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.company_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create unique index if not exists company_links_one_active on public.company_links (company_id) where revoked_at is null;

create table if not exists public.company_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null unique references public.companies (id) on delete restrict,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Historial de aprobación: solo se agrega, nunca se edita ni se borra. Sin FK a propósito: sobrevive a la eliminación de la conversación.
create table if not exists public.conversation_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  company_id uuid,
  action text not null check (action in ('created', 'approve', 'reject', 'reopen', 'agency_status')),
  from_status text,
  to_status text,
  actor_type text not null check (actor_type in ('company_admin', 'agency', 'system')),
  actor_user_id uuid,
  actor_label text not null default '',
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists conversation_approvals_request_idx on public.conversation_approvals (request_id, created_at);

create or replace function public.ca_immutable() returns trigger language plpgsql as $$
begin raise exception 'El historial de aprobación no se puede modificar ni eliminar.'; end;
$$;
drop trigger if exists conversation_approvals_immutable on public.conversation_approvals;
create trigger conversation_approvals_immutable before update or delete on public.conversation_approvals for each row execute function public.ca_immutable();

-- 3. Funciones de identidad ----------------------------------------------------------------------------------------------------------------------
-- true = personal de la agencia (cualquier usuario autenticado que NO sea administrador empresarial; no depende de «active»)
create or replace function public.is_agency_user() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not exists (select 1 from public.company_admins where user_id = auth.uid())
$$;

create or replace function public.is_company_admin_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_admins where user_id = auth.uid())
$$;

-- Empresa del administrador ACTIVO que llama; si no lo es, error. Es la única fuente del company_id en todo el portal empresarial.
create or replace function public.company_admin_company() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select company_id into v from public.company_admins where user_id = auth.uid() and active;
  if v is null then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  return v;
end;
$$;

create or replace function public.company_can_read_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_requests r join public.company_admins a on a.company_id = r.company_id
    where a.user_id = auth.uid() and a.active and (storage.foldername(p_name))[1] = 'requests' and r.id::text = (storage.foldername(p_name))[2])
$$;

-- 4. RLS y privilegios de las tablas nuevas -------------------------------------------------------------------------------------------------------
alter table public.company_links enable row level security;
alter table public.company_admins enable row level security;
alter table public.conversation_approvals enable row level security;
revoke all on public.company_links, public.company_admins, public.conversation_approvals from anon, authenticated;
grant all on public.company_links, public.company_admins, public.conversation_approvals to service_role;
-- la agencia solo LEE (sin token_hash); todo cambio pasa por funciones o por la Edge Function company-admin
grant select (id, company_id, created_at, created_by, revoked_at, revoked_by) on public.company_links to authenticated;
grant select on public.company_admins, public.conversation_approvals to authenticated;
drop policy if exists cl_agency_select on public.company_links;
create policy cl_agency_select on public.company_links for select to authenticated using (true);
drop policy if exists ca_agency_select on public.company_admins;
create policy ca_agency_select on public.company_admins for select to authenticated using (true);
drop policy if exists capp_agency_select on public.conversation_approvals;
create policy capp_agency_select on public.conversation_approvals for select to authenticated using (true);

-- 5. Política restrictiva «agency_only» en TODAS las tablas de public (y RLS donde faltaba) ---------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and pg_get_userbyid(c.relowner) = current_user
  loop
    if not t.relrowsecurity then
      raise notice 'La tabla public.% no tenía RLS: se activa con acceso solo para la agencia.', t.relname;
      execute format('alter table public.%I enable row level security', t.relname);
      execute format('drop policy if exists agency_all on public.%I', t.relname);
      execute format('create policy agency_all on public.%I for all to authenticated using ((select public.is_agency_user())) with check ((select public.is_agency_user()))', t.relname);
    end if;
    execute format('drop policy if exists agency_only on public.%I', t.relname);
    execute format('create policy agency_only on public.%I as restrictive for all to authenticated using ((select public.is_agency_user())) with check ((select public.is_agency_user()))', t.relname);
  end loop;
end $$;

-- 6. Storage: solo la agencia escribe/borra; el administrador empresarial solo lee archivos de su empresa ---------------------------------------------
drop policy if exists agency_or_company_select on storage.objects;
create policy agency_or_company_select on storage.objects as restrictive for select to authenticated
  using ((select public.is_agency_user()) or (bucket_id = 'client-requests' and public.company_can_read_object(name)));
drop policy if exists agency_only_insert on storage.objects;
create policy agency_only_insert on storage.objects as restrictive for insert to authenticated with check ((select public.is_agency_user()));
drop policy if exists agency_only_update on storage.objects;
create policy agency_only_update on storage.objects as restrictive for update to authenticated using ((select public.is_agency_user())) with check ((select public.is_agency_user()));
drop policy if exists agency_only_delete on storage.objects;
create policy agency_only_delete on storage.objects as restrictive for delete to authenticated using (public.is_agency_user());

-- 7. Reapertura automática: un NUEVO requerimiento en una conversación ya aprobada la devuelve a «pendiente de aprobación» -------------------------
-- Trigger AFTER INSERT sobre client_request_items: corre en la misma transacción que portal_add_item (el requerimiento y el cambio de estado
-- se confirman juntos o ninguno). Editar un requerimiento o enviar mensajes NO dispara nada. Una conversación rechazada no cambia.
create or replace function public.cr_reopen_on_new_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.client_requests;
begin
  select * into v from public.client_requests where id = new.request_id for update;
  if found and v.company_id is not null and v.approval_status in ('approved', 'in_management', 'completed') then
    update public.client_requests set approval_status = 'pending_approval', approval_updated_at = now() where id = v.id;
    insert into public.conversation_approvals (request_id, company_id, action, from_status, to_status, actor_type, actor_label, note)
    values (v.id, v.company_id, 'reopen', v.approval_status, 'pending_approval', 'system', 'Sistema', 'Se agregó un nuevo requerimiento a la conversación: requiere nueva aprobación.');
  end if;
  return new;
end;
$$;
drop trigger if exists client_request_items_reopen on public.client_request_items;
create trigger client_request_items_reopen after insert on public.client_request_items for each row execute function public.cr_reopen_on_new_item();

-- 8. Funciones de la AGENCIA (rol authenticated; exigen is_agency_user) --------------------------------------------------------------------------------
-- Genera el enlace público de la empresa (revoca el activo anterior). El token solo se devuelve aquí: en la base queda únicamente su hash.
create or replace function public.company_link_generate(p_company uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := public.cr_new_token(); v_user uuid := auth.uid();
begin
  if not public.is_agency_user() then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  perform 1 from public.companies where id = p_company for update;
  if not found then raise exception 'La empresa no existe.'; end if;
  update public.company_links set revoked_at = now(), revoked_by = v_user where company_id = p_company and revoked_at is null;
  insert into public.company_links (company_id, token_hash, created_by) values (p_company, public.cr_hash(v_token), v_user);
  return jsonb_build_object('token', v_token);
end;
$$;

create or replace function public.company_link_revoke(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_agency_user() then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  update public.company_links set revoked_at = now(), revoked_by = auth.uid() where company_id = p_company and revoked_at is null;
  if not found then raise exception 'La empresa no tiene un enlace activo.'; end if;
end;
$$;

-- La agencia gestiona la continuidad: puede pasar la conversación a en_gestión, finalizada o volver a pendiente de aprobación.
-- Aprobar y rechazar es exclusivo del administrador de la empresa.
create or replace function public.agency_set_approval(p_id uuid, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v public.client_requests;
begin
  if not public.is_agency_user() then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  if p_status not in ('pending_approval', 'in_management', 'completed') then raise exception 'Estado no permitido para la agencia.'; end if;
  select * into v from public.client_requests where id = p_id for update;
  if not found then raise exception 'La solicitud ya no existe.'; end if;
  if v.company_id is null then raise exception 'La conversación no pertenece a una empresa.'; end if;
  if v.approval_status is not distinct from p_status then raise exception 'La conversación ya tiene ese estado.'; end if;
  update public.client_requests set approval_status = p_status, approval_updated_at = now(), last_activity_at = now() where id = v.id;
  insert into public.conversation_approvals (request_id, company_id, action, from_status, to_status, actor_type, actor_user_id, actor_label, note)
  values (v.id, v.company_id, case when p_status = 'pending_approval' then 'reopen' else 'agency_status' end, v.approval_status, p_status, 'agency', auth.uid(), 'Aires y Destinos', left(btrim(coalesce(p_note, '')), 2000));
end;
$$;

-- 9. Funciones del ADMINISTRADOR EMPRESARIAL (rol authenticated; la empresa sale siempre de company_admin_company()) -------------------------------
create or replace function public.company_portal_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('company_id', a.company_id, 'company_name', c.name, 'email', a.email)
  from public.company_admins a join public.companies c on c.id = a.company_id where a.user_id = auth.uid() and a.active
$$;

create or replace function public.company_list_conversations(p_search text default '', p_status text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.company_admin_company(); s text := '%' || replace(replace(btrim(coalesce(p_search, '')), '%', '\%'), '_', '\_') || '%';
begin
  return coalesce((select jsonb_agg(x.j order by x.la desc) from (
    select r.last_activity_at la, jsonb_build_object(
      'id', r.id, 'employee_name', r.client_name, 'created_at', r.created_at, 'last_activity_at', r.last_activity_at,
      'approval_status', r.approval_status, 'request_type', r.request_type, 'closed', r.status = 'closed',
      'items', (select count(*) from public.client_request_items i where i.request_id = r.id),
      'messages', (select count(*) from public.client_request_messages m where m.request_id = r.id),
      'last_decision_at', (select max(a.created_at) from public.conversation_approvals a where a.request_id = r.id and a.action in ('approve', 'reject'))) j
    from public.client_requests r
    where r.company_id = v and (coalesce(p_status, '') = '' or r.approval_status = p_status)
      and (btrim(coalesce(p_search, '')) = '' or r.client_name ilike s or r.description ilike s)
    order by r.last_activity_at desc limit 500) x), '[]'::jsonb);
end;
$$;

create or replace function public.company_get_conversation(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.company_admin_company(); r public.client_requests;
begin
  select * into r from public.client_requests where id = p_id and company_id = v;
  if not found then raise exception 'Conversación no encontrada.'; end if;
  return jsonb_build_object(
    'request', jsonb_build_object('id', r.id, 'employee_name', r.client_name, 'created_at', r.created_at, 'last_activity_at', r.last_activity_at, 'submitted_at', r.submitted_at,
      'approval_status', r.approval_status, 'approval_updated_at', r.approval_updated_at, 'closed', r.status = 'closed', 'request_type', r.request_type,
      'description', r.description, 'observations', r.observations, 'details', r.details),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'request_type', i.request_type, 'description', i.description, 'observations', i.observations, 'details', i.details, 'created_at', i.created_at) order by i.position)
      from public.client_request_items i where i.request_id = r.id), '[]'::jsonb),
    'passengers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'item_id', p.item_id, 'first_names', p.first_names, 'last_names', p.last_names, 'document_type', p.document_type,
      'document_number', p.document_number, 'birth_date', p.birth_date) order by p.position) from public.client_request_passengers p where p.request_id = r.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'passenger_id', a.passenger_id, 'message_id', a.message_id, 'item_id', a.item_id, 'file_name', a.file_name,
      'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'uploaded_by', a.uploaded_by, 'created_at', a.created_at, 'storage_path', a.storage_path) order by a.created_at)
      from public.client_request_attachments a where a.request_id = r.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.client_request_messages m where m.request_id = r.id), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'from_status', h.from_status, 'to_status', h.to_status, 'actor_type', h.actor_type,
      'actor_label', h.actor_label, 'note', h.note, 'created_at', h.created_at) order by h.created_at, h.id)
      from public.conversation_approvals h where h.request_id = r.id), '[]'::jsonb));
end;
$$;

-- Aprobar o rechazar la conversación COMPLETA (no cada requerimiento). Solo desde «pendiente de aprobación».
create or replace function public.company_decide(p_id uuid, p_decision text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := public.company_admin_company(); r public.client_requests; v_to text; v_email text;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'Decisión no válida.'; end if;
  select * into r from public.client_requests where id = p_id and company_id = v for update;
  if not found then raise exception 'Conversación no encontrada.'; end if;
  if r.approval_status is distinct from 'pending_approval' then raise exception 'La conversación no está pendiente de aprobación.'; end if;
  v_to := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  select email into v_email from public.company_admins where user_id = auth.uid();
  update public.client_requests set approval_status = v_to, approval_updated_at = now(), last_activity_at = now() where id = r.id;
  insert into public.conversation_approvals (request_id, company_id, action, from_status, to_status, actor_type, actor_user_id, actor_label, note)
  values (r.id, v, p_decision, r.approval_status, v_to, 'company_admin', auth.uid(), coalesce(v_email, ''), left(btrim(coalesce(p_note, '')), 2000));
end;
$$;

-- Mensaje de texto del administrador a la agencia dentro de la misma conversación (se guarda como mensaje del lado del cliente con un prefijo visible).
create or replace function public.company_post_message(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := public.company_admin_company(); r public.client_requests; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into r from public.client_requests where id = p_id and company_id = v for update;
  if not found then raise exception 'Conversación no encontrada.'; end if;
  if r.status = 'closed' then raise exception 'La conversación está cerrada.'; end if;
  if v_body = '' then raise exception 'Escribe un mensaje.'; end if;
  if char_length(v_body) > 4900 then raise exception 'El mensaje es demasiado largo.'; end if;
  if (select count(*) from public.client_request_messages where request_id = r.id and author = 'client' and created_at > now() - interval '1 hour') >= 60 then raise exception 'Has enviado muchos mensajes en poco tiempo.'; end if;
  insert into public.client_request_messages (request_id, author, body) values (r.id, 'client', 'Administrador de la empresa: ' || v_body);
  update public.client_requests set last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1 where id = r.id;
end;
$$;

-- 10. Funciones del ENLACE PÚBLICO: SOLO service_role (Edge Function company-access) ------------------------------------------------------------
create or replace function public.company_link_lookup(p_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('company_name', c.name) from public.company_links l join public.companies c on c.id = l.company_id
  where p_hash is not null and p_hash <> '' and l.token_hash = p_hash and l.revoked_at is null
$$;

-- Crea una conversación NUEVA de la empresa a nombre del empleado y devuelve su id. El token de la conversación lo genera la Edge Function (aquí solo llega su hash).
create or replace function public.company_link_start(p_hash text, p_name text, p_conv_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.company_links; v_name text := left(btrim(coalesce(p_name, '')), 160); v_id uuid;
begin
  select * into l from public.company_links where p_hash is not null and p_hash <> '' and token_hash = p_hash and revoked_at is null;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v_name = '' then raise exception 'portal:name_required'; end if;
  if p_conv_hash is null or p_conv_hash = '' then raise exception 'portal:invalid_link'; end if;
  if (select count(*) from public.client_requests where company_id = l.company_id and created_at > now() - interval '1 hour') >= 60 then raise exception 'portal:rate_limited'; end if;
  insert into public.client_requests (client_name, token_hash, link_issued_at, company_id, approval_status, approval_updated_at)
  values (v_name, p_conv_hash, now(), l.company_id, 'pending_approval', now()) returning id into v_id;
  insert into public.conversation_approvals (request_id, company_id, action, to_status, actor_type, actor_label, note)
  values (v_id, l.company_id, 'created', 'pending_approval', 'system', v_name, 'Conversación iniciada desde el enlace de la empresa.');
  insert into public.client_request_events (request_id, action, meta) values (v_id, 'created', jsonb_build_object('via', 'company_link'));
  return jsonb_build_object('id', v_id);
end;
$$;

-- 11. Permisos de ejecución --------------------------------------------------------------------------------------------------------------------------
revoke all on function public.ca_immutable(), public.is_agency_user(), public.is_company_admin_user(), public.company_admin_company(), public.company_can_read_object(text),
  public.cr_reopen_on_new_item(),
  public.company_link_generate(uuid), public.company_link_revoke(uuid), public.agency_set_approval(uuid, text, text),
  public.company_portal_me(), public.company_list_conversations(text, text), public.company_get_conversation(uuid), public.company_decide(uuid, text, text), public.company_post_message(uuid, text),
  public.company_link_lookup(text), public.company_link_start(text, text, text) from public, anon, authenticated;
grant execute on function public.is_agency_user(), public.is_company_admin_user(), public.company_can_read_object(text),
  public.company_link_generate(uuid), public.company_link_revoke(uuid), public.agency_set_approval(uuid, text, text),
  public.company_portal_me(), public.company_list_conversations(text, text), public.company_get_conversation(uuid), public.company_decide(uuid, text, text), public.company_post_message(uuid, text) to authenticated;
grant execute on function public.is_agency_user(), public.is_company_admin_user(), public.company_admin_company(), public.company_can_read_object(text), public.company_link_lookup(text), public.company_link_start(text, text, text),
  public.company_link_generate(uuid), public.company_link_revoke(uuid), public.agency_set_approval(uuid, text, text), public.company_portal_me(), public.company_list_conversations(text, text),
  public.company_get_conversation(uuid), public.company_decide(uuid, text, text), public.company_post_message(uuid, text) to service_role;

notify pgrst, 'reload schema';

-- Reversión (solo si hace falta; no borra conversaciones): drop trigger client_request_items_reopen on public.client_request_items;
--   y para cada tabla de public: drop policy agency_only on public.<tabla>; drop policy agency_or_company_select/agency_only_* on storage.objects.
