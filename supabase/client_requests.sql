-- Aires y Destinos: portal privado de solicitudes de clientes. Ejecutar completo en Supabase > SQL Editor. Es idempotente y solo AGREGA objetos nuevos
-- (tablas client_request_*, bucket privado «client-requests», funciones cr_*/portal_*). No modifica ninguna tabla, vista ni función existente.
--
-- Modelo de seguridad
--  * El cliente NO tiene sesión ni acceso a la base: todo lo público pasa por la Edge Function «portal» (clave de servicio solo dentro de la función).
--    Las funciones portal_* solo las puede ejecutar service_role (anon y authenticated NO).
--  * El enlace privado lleva un token aleatorio de 256 bits; en la base solo se guarda su hash SHA-256 (token_hash). token_hash NULL = enlace revocado.
--  * La agencia usa su sesión de Supabase (rol authenticated). Las funciones de administración exigen auth.uid() y registran quién actuó.
--  * Los archivos viven en un bucket privado aparte; no hay URLs públicas. Los borrados de archivos se encolan SIEMPRE (trigger) en client_request_cleanup.

-- 1. Tablas ---------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  client_name text not null default '' check (char_length(client_name) <= 160),
  client_email text not null default '' check (char_length(client_email) <= 200),
  client_phone text not null default '' check (char_length(client_phone) <= 40),
  request_type text check (request_type in ('flight', 'hotel', 'transport', 'food', 'package', 'other')),
  description text not null default '' check (char_length(description) <= 4000),
  observations text not null default '' check (char_length(observations) <= 4000),
  details jsonb not null default '{}'::jsonb,
  details_history jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'in_progress', 'closed', 'reopened')),
  submitted_at timestamptz,
  privacy_accepted_at timestamptz,
  token_hash text unique,
  link_issued_at timestamptz,
  link_revoked_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  last_message_author text check (last_message_author in ('client', 'agency')),
  agency_unread integer not null default 0 check (agency_unread >= 0)
);
create index if not exists client_requests_status_idx on public.client_requests (status);
create index if not exists client_requests_activity_idx on public.client_requests (last_activity_at desc);

create table if not exists public.client_request_passengers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_requests (id) on delete cascade,
  position integer not null default 1,
  first_names text not null check (btrim(first_names) <> '' and char_length(first_names) <= 120),
  last_names text not null check (btrim(last_names) <> '' and char_length(last_names) <= 120),
  document_type text not null check (document_type in ('CC', 'CE', 'TI', 'RC', 'PA', 'NIT')),
  document_number text not null check (btrim(document_number) <> '' and char_length(document_number) <= 40),
  birth_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists client_request_passengers_request_idx on public.client_request_passengers (request_id, position);

create table if not exists public.client_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_requests (id) on delete cascade,
  author text not null check (author in ('client', 'agency')),
  author_user_id uuid references auth.users (id) on delete set null,
  body text not null default '' check (char_length(body) <= 5000),
  created_at timestamptz not null default now(),
  check (author = 'agency' or author_user_id is null)
);
create index if not exists client_request_messages_request_idx on public.client_request_messages (request_id, created_at);

create table if not exists public.client_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_requests (id) on delete cascade,
  message_id uuid references public.client_request_messages (id) on delete cascade,
  passenger_id uuid references public.client_request_passengers (id) on delete cascade,
  kind text not null check (kind in ('identity', 'supporting', 'message')),
  uploaded_by text not null check (uploaded_by in ('client', 'agency')),
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  check ((kind = 'identity') = (passenger_id is not null)),
  check ((kind = 'message') = (message_id is not null))
);
create index if not exists client_request_attachments_request_idx on public.client_request_attachments (request_id);
create index if not exists client_request_attachments_message_idx on public.client_request_attachments (message_id);
create index if not exists client_request_attachments_passenger_idx on public.client_request_attachments (passenger_id);

-- Sin FK a propósito: los eventos sobreviven a la eliminación de la solicitud. Solo metadatos mínimos, nunca datos personales.
create table if not exists public.client_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  action text not null,
  actor_user_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists client_request_events_request_idx on public.client_request_events (request_id, created_at);

-- Archivos de Storage pendientes de borrar (se llena solo, por trigger, ante cualquier borrado de un adjunto)
create table if not exists public.client_request_cleanup (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);

-- Referencia solicitud -> operación creada por la agencia (no se crea nada automáticamente)
create table if not exists public.client_request_operations (
  request_id uuid not null references public.client_requests (id) on delete cascade,
  operation_id uuid not null references public.operations (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (request_id, operation_id)
);

-- 2. Triggers -------------------------------------------------------------------------------------------------------------------------------------
drop trigger if exists client_requests_updated_at on public.client_requests;
create trigger client_requests_updated_at before update on public.client_requests for each row execute function public.set_updated_at();

create or replace function public.cr_enqueue_storage_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.client_request_cleanup (storage_path) values (old.storage_path) on conflict (storage_path) do nothing;
  return old;
end;
$$;
revoke all on function public.cr_enqueue_storage_cleanup() from public, anon, authenticated;
drop trigger if exists client_request_attachments_cleanup on public.client_request_attachments;
create trigger client_request_attachments_cleanup before delete on public.client_request_attachments for each row execute function public.cr_enqueue_storage_cleanup();

-- 3. RLS: solo usuarios autenticados de la agencia; anon no tiene nada. (El cliente nunca toca estas tablas: pasa por la Edge Function.) -----------
alter table public.client_requests enable row level security;
alter table public.client_request_passengers enable row level security;
alter table public.client_request_messages enable row level security;
alter table public.client_request_attachments enable row level security;
alter table public.client_request_events enable row level security;
alter table public.client_request_cleanup enable row level security;
alter table public.client_request_operations enable row level security;

-- Privilegios explícitos (no depender de los por defecto): nada para anon; authenticated solo lo mínimo (sin TRUNCATE/TRIGGER/REFERENCES); service_role todo (la Edge Function)
revoke all on public.client_requests, public.client_request_passengers, public.client_request_messages, public.client_request_attachments,
  public.client_request_events, public.client_request_cleanup, public.client_request_operations from anon, authenticated;
grant all on public.client_requests, public.client_request_passengers, public.client_request_messages, public.client_request_attachments,
  public.client_request_events, public.client_request_cleanup, public.client_request_operations to service_role;
grant select, insert, update, delete on public.client_requests, public.client_request_passengers, public.client_request_attachments, public.client_request_operations to authenticated;
grant select, insert, delete on public.client_request_messages to authenticated;
grant select, insert on public.client_request_events to authenticated;
grant select, delete on public.client_request_cleanup to authenticated;

drop policy if exists cr_agency_all on public.client_requests;
create policy cr_agency_all on public.client_requests for all to authenticated using (true) with check (true);
drop policy if exists crp_agency_all on public.client_request_passengers;
create policy crp_agency_all on public.client_request_passengers for all to authenticated using (true) with check (true);
drop policy if exists cra_agency_all on public.client_request_attachments;
create policy cra_agency_all on public.client_request_attachments for all to authenticated using (true) with check (true);
drop policy if exists cro_agency_all on public.client_request_operations;
create policy cro_agency_all on public.client_request_operations for all to authenticated using (true) with check (true);
-- un mensaje de la agencia solo se puede insertar como agencia y firmado con el usuario real (no se puede suplantar al cliente ni a otro usuario)
drop policy if exists crm_select on public.client_request_messages;
create policy crm_select on public.client_request_messages for select to authenticated using (true);
drop policy if exists crm_insert on public.client_request_messages;
create policy crm_insert on public.client_request_messages for insert to authenticated with check (author = 'agency' and author_user_id = auth.uid());
drop policy if exists crm_delete on public.client_request_messages;
create policy crm_delete on public.client_request_messages for delete to authenticated using (true);
-- bitácora: solo lectura e inserción firmada; no se puede editar ni borrar
drop policy if exists cre_select on public.client_request_events;
create policy cre_select on public.client_request_events for select to authenticated using (true);
drop policy if exists cre_insert on public.client_request_events;
create policy cre_insert on public.client_request_events for insert to authenticated with check (actor_user_id = auth.uid());
drop policy if exists crc_select on public.client_request_cleanup;
create policy crc_select on public.client_request_cleanup for select to authenticated using (true);
drop policy if exists crc_delete on public.client_request_cleanup;
create policy crc_delete on public.client_request_cleanup for delete to authenticated using (true);

-- 4. Storage: bucket privado y aislado de los documentos de facturación ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-requests', 'client-requests', false, 8388608, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

drop policy if exists cr_storage_select on storage.objects;
create policy cr_storage_select on storage.objects for select to authenticated using (bucket_id = 'client-requests');
drop policy if exists cr_storage_insert on storage.objects;
create policy cr_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'client-requests' and (storage.foldername(name))[1] = 'requests');
drop policy if exists cr_storage_delete on storage.objects;
create policy cr_storage_delete on storage.objects for delete to authenticated using (bucket_id = 'client-requests');
-- anon no tiene ninguna política sobre este bucket: los archivos del cliente solo se leen/escriben dentro de la Edge Function (service_role)

-- 5. Funciones de la agencia (rol authenticated; exigen sesión y registran al usuario) -----------------------------------------------------------
create or replace function public.cr_new_token() returns text
language sql volatile set search_path = public, extensions as $$ select translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_') $$;

create or replace function public.cr_hash(p_token text) returns text
language sql immutable set search_path = public, extensions as $$ select encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

create or replace function public.cr_require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Sesión requerida. Inicia sesión de nuevo.' using errcode = '28000'; end if;
  return v;
end;
$$;

create or replace function public.cr_event(p_request uuid, p_action text, p_meta jsonb default '{}'::jsonb) returns void
language sql as $$ insert into public.client_request_events (request_id, action, actor_user_id, meta) values (p_request, p_action, auth.uid(), coalesce(p_meta, '{}'::jsonb)) $$;

drop function if exists public.create_client_request(text, text, text, text, text);
-- Genera una conversación vacía + enlace. Todos los parámetros son opcionales: el cliente completa nombre, contacto y tipo desde el enlace.
create or replace function public.create_client_request(p_name text default '', p_email text default '', p_phone text default '', p_type text default null, p_description text default '') returns jsonb
language plpgsql set search_path = public, extensions as $$
declare v_user uuid := public.cr_require_user(); v_token text := public.cr_new_token(); v_id uuid;
begin
  if p_type is not null and p_type not in ('flight', 'hotel', 'transport', 'food', 'package', 'other') then raise exception 'Tipo de solicitud no válido.'; end if;
  insert into public.client_requests (created_by, client_name, client_email, client_phone, request_type, description, token_hash, link_issued_at)
  values (v_user, btrim(coalesce(p_name, '')), btrim(coalesce(p_email, '')), btrim(coalesce(p_phone, '')), p_type, btrim(coalesce(p_description, '')), public.cr_hash(v_token), now())
  returning id into v_id;
  perform public.cr_event(v_id, 'created');
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

create or replace function public.regenerate_client_request_link(p_id uuid) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare v_token text := public.cr_new_token();
begin
  perform public.cr_require_user();
  update public.client_requests set token_hash = public.cr_hash(v_token), link_issued_at = now(), link_revoked_at = null where id = p_id;
  if not found then raise exception 'La solicitud ya no existe.'; end if;
  perform public.cr_event(p_id, 'link_regenerated');
  return jsonb_build_object('id', p_id, 'token', v_token);
end;
$$;

create or replace function public.revoke_client_request_link(p_id uuid) returns void
language plpgsql as $$
begin
  perform public.cr_require_user();
  update public.client_requests set token_hash = null, link_revoked_at = now() where id = p_id;
  if not found then raise exception 'La solicitud ya no existe.'; end if;
  perform public.cr_event(p_id, 'link_revoked');
end;
$$;

-- Cierra (p_closed = true) o reabre (false). Guarda quién y cuándo. Cerrada: el portal rechaza mensajes y archivos del cliente.
create or replace function public.set_client_request_closed(p_id uuid, p_closed boolean) returns void
language plpgsql as $$
declare v_user uuid := public.cr_require_user(); v_status text;
begin
  select status into v_status from public.client_requests where id = p_id for update;
  if not found then raise exception 'La solicitud ya no existe.'; end if;
  if p_closed then
    if v_status = 'closed' then raise exception 'La conversación ya está cerrada.'; end if;
    update public.client_requests set status = 'closed', closed_at = now(), closed_by = v_user, last_activity_at = now() where id = p_id;
    perform public.cr_event(p_id, 'closed');
  else
    if v_status <> 'closed' then raise exception 'La conversación no está cerrada.'; end if;
    update public.client_requests set status = 'reopened', reopened_at = now(), reopened_by = v_user, last_activity_at = now() where id = p_id;
    perform public.cr_event(p_id, 'reopened');
  end if;
end;
$$;

-- p_attachments: [{storage_path, file_name, mime_type, size_bytes}] ya subidos por la agencia a requests/<id>/...
create or replace function public.agency_post_message(p_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb) returns uuid
language plpgsql as $$
declare v_user uuid := public.cr_require_user(); v_status text; v_msg uuid; a jsonb; v_body text := btrim(coalesce(p_body, ''));
begin
  select status into v_status from public.client_requests where id = p_id for update;
  if not found then raise exception 'La solicitud ya no existe.'; end if;
  if v_status = 'closed' then raise exception 'La conversación está cerrada. Reábrela para responder.'; end if;
  if v_body = '' and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then raise exception 'Escribe un mensaje o adjunta un archivo.'; end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 10 then raise exception 'Máximo 10 archivos por mensaje.'; end if;
  insert into public.client_request_messages (request_id, author, author_user_id, body) values (p_id, 'agency', v_user, v_body) returning id into v_msg;
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if left(a->>'storage_path', length('requests/' || p_id::text || '/')) <> 'requests/' || p_id::text || '/' then raise exception 'Ruta de archivo no válida.'; end if;
    insert into public.client_request_attachments (request_id, message_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (p_id, v_msg, 'message', 'agency', left(a->>'file_name', 200), a->>'mime_type', (a->>'size_bytes')::bigint, a->>'storage_path');
  end loop;
  update public.client_requests set last_activity_at = now(), last_message_author = 'agency', agency_unread = 0,
    status = case when status in ('new', 'reopened') then 'in_progress' else status end where id = p_id;
  return v_msg;
end;
$$;

create or replace function public.mark_client_request_read(p_id uuid) returns void
language plpgsql as $$
begin
  perform public.cr_require_user();
  update public.client_requests set agency_unread = 0 where id = p_id and agency_unread <> 0;
end;
$$;

-- Eliminación: revoca el enlace, borra todo lo dependiente (cascada) y deja los archivos de Storage encolados en client_request_cleanup (trigger).
create or replace function public.delete_client_request(p_id uuid) returns jsonb
language plpgsql as $$
declare v_msgs int; v_atts int; v_pax int;
begin
  perform public.cr_require_user();
  perform 1 from public.client_requests where id = p_id for update;
  if not found then raise exception 'La solicitud ya no existe.'; end if;
  update public.client_requests set token_hash = null, link_revoked_at = now() where id = p_id;
  select count(*) into v_msgs from public.client_request_messages where request_id = p_id;
  select count(*) into v_atts from public.client_request_attachments where request_id = p_id;
  select count(*) into v_pax from public.client_request_passengers where request_id = p_id;
  delete from public.client_requests where id = p_id;
  perform public.cr_event(p_id, 'deleted', jsonb_build_object('messages', v_msgs, 'attachments', v_atts, 'passengers', v_pax));
  return jsonb_build_object('messages', v_msgs, 'attachments', v_atts, 'passengers', v_pax, 'cleanup_pending', (select count(*) from public.client_request_cleanup));
end;
$$;

create or replace function public.delete_client_request_message(p_id uuid) returns jsonb
language plpgsql as $$
declare v_req uuid; v_atts int;
begin
  perform public.cr_require_user();
  select request_id into v_req from public.client_request_messages where id = p_id;
  if not found then raise exception 'El mensaje ya no existe.'; end if;
  select count(*) into v_atts from public.client_request_attachments where message_id = p_id;
  delete from public.client_request_messages where id = p_id;
  perform public.cr_event(v_req, 'message_deleted', jsonb_build_object('attachments', v_atts));
  return jsonb_build_object('attachments', v_atts, 'cleanup_pending', (select count(*) from public.client_request_cleanup));
end;
$$;

create or replace function public.delete_client_request_attachment(p_id uuid) returns jsonb
language plpgsql as $$
declare v_req uuid; v_msg uuid;
begin
  perform public.cr_require_user();
  select request_id, message_id into v_req, v_msg from public.client_request_attachments where id = p_id for update;
  if not found then raise exception 'El archivo ya no existe.'; end if;
  delete from public.client_request_attachments where id = p_id;
  -- a message that only carried this file disappears with it (no empty bubbles)
  if v_msg is not null and not exists (select 1 from public.client_request_attachments where message_id = v_msg)
     and exists (select 1 from public.client_request_messages where id = v_msg and btrim(body) = '') then
    delete from public.client_request_messages where id = v_msg;
  end if;
  perform public.cr_event(v_req, 'attachment_deleted');
  return jsonb_build_object('cleanup_pending', (select count(*) from public.client_request_cleanup));
end;
$$;

create or replace function public.delete_client_request_passenger(p_id uuid) returns jsonb
language plpgsql as $$
declare v_req uuid; v_atts int;
begin
  perform public.cr_require_user();
  select request_id into v_req from public.client_request_passengers where id = p_id for update;
  if not found then raise exception 'El pasajero ya no existe.'; end if;
  select count(*) into v_atts from public.client_request_attachments where passenger_id = p_id;
  delete from public.client_request_passengers where id = p_id;
  perform public.cr_event(v_req, 'passenger_deleted', jsonb_build_object('attachments', v_atts));
  return jsonb_build_object('attachments', v_atts, 'cleanup_pending', (select count(*) from public.client_request_cleanup));
end;
$$;

create or replace function public.link_client_request_operation(p_request uuid, p_operation uuid) returns void
language plpgsql as $$
declare v_user uuid := public.cr_require_user();
begin
  insert into public.client_request_operations (request_id, operation_id, created_by) values (p_request, p_operation, v_user) on conflict do nothing;
  perform public.cr_event(p_request, 'converted_to_operation');
end;
$$;

revoke all on function public.cr_new_token(), public.cr_hash(text), public.cr_require_user(), public.cr_event(uuid, text, jsonb),
  public.create_client_request(text, text, text, text, text), public.regenerate_client_request_link(uuid), public.revoke_client_request_link(uuid),
  public.set_client_request_closed(uuid, boolean), public.agency_post_message(uuid, text, jsonb), public.mark_client_request_read(uuid),
  public.delete_client_request(uuid), public.delete_client_request_message(uuid), public.delete_client_request_attachment(uuid),
  public.delete_client_request_passenger(uuid), public.link_client_request_operation(uuid, uuid) from public, anon;
grant execute on function public.cr_require_user(), public.cr_event(uuid, text, jsonb), public.create_client_request(text, text, text, text, text),
  public.regenerate_client_request_link(uuid), public.revoke_client_request_link(uuid), public.set_client_request_closed(uuid, boolean),
  public.agency_post_message(uuid, text, jsonb), public.mark_client_request_read(uuid), public.delete_client_request(uuid),
  public.delete_client_request_message(uuid), public.delete_client_request_attachment(uuid), public.delete_client_request_passenger(uuid),
  public.link_client_request_operation(uuid, uuid) to authenticated;
-- cr_new_token / cr_hash no se exponen a authenticated (solo los usan las otras funciones, que corren con los privilegios del que llama): se otorga ejecución solo a service_role
grant execute on function public.cr_new_token(), public.cr_hash(text) to authenticated, service_role;

-- 6. Funciones del portal público: SOLO service_role (la Edge Function). anon y authenticated no pueden ejecutarlas. ---------------------------------
-- Cada una recibe el HASH del token y valida enlace + estado en cada llamada. Errores con prefijo «portal:» que la función traduce.
create or replace function public.portal_lookup(p_hash text) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('id', id, 'status', status, 'submitted', submitted_at is not null)
  from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> ''
$$;

create or replace function public.portal_get(p_hash text, p_since timestamptz default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare v public.client_requests;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '';
  if not found then return null; end if;
  return jsonb_build_object(
    'server_time', now(),
    'request', jsonb_build_object('status', v.status, 'created_at', v.created_at, 'submitted_at', v.submitted_at, 'closed_at', v.closed_at, 'client_name', v.client_name,
      'client_email', v.client_email, 'client_phone', v.client_phone, 'request_type', v.request_type, 'description', v.description, 'observations', v.observations,
      'details', v.details, 'last_message_author', v.last_message_author),
    'passengers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'first_names', p.first_names, 'last_names', p.last_names, 'document_type', p.document_type,
      'document_number', p.document_number, 'birth_date', p.birth_date) order by p.position) from public.client_request_passengers p where p.request_id = v.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'passenger_id', a.passenger_id, 'message_id', a.message_id, 'file_name', a.file_name,
      'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'uploaded_by', a.uploaded_by, 'created_at', a.created_at) order by a.created_at) from public.client_request_attachments a where a.request_id = v.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.client_request_messages m where m.request_id = v.id and (p_since is null or m.created_at > p_since)), '[]'::jsonb));
end;
$$;

-- p_data: {client_name, client_email, client_phone, request_type, description, observations, details, privacy_accepted,
--          passengers:[{first_names,last_names,document_type,document_number,birth_date,file:{storage_path,file_name,mime_type,size_bytes}|null}], extras:[{...file}]}
create or replace function public.portal_submit(p_hash text, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; p jsonb; f jsonb; v_pid uuid; v_pos int := 0; v_ids jsonb := '[]'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if v.submitted_at is not null then raise exception 'portal:already_submitted'; end if;
  if coalesce((p_data->>'privacy_accepted')::boolean, false) is not true then raise exception 'portal:privacy_required'; end if;

  update public.client_requests set client_name = btrim(p_data->>'client_name'), client_email = btrim(coalesce(p_data->>'client_email', '')), client_phone = btrim(coalesce(p_data->>'client_phone', '')),
    request_type = p_data->>'request_type', description = btrim(coalesce(p_data->>'description', '')), observations = btrim(coalesce(p_data->>'observations', '')),
    details = coalesce(p_data->'details', '{}'::jsonb), submitted_at = now(), privacy_accepted_at = now(), last_activity_at = now(), last_message_author = 'client',
    agency_unread = agency_unread + 1 where id = v.id;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, v_pos, btrim(p->>'first_names'), btrim(p->>'last_names'), p->>'document_type', btrim(p->>'document_number'), (p->>'birth_date')::date) returning id into v_pid;
    v_ids := v_ids || to_jsonb(v_pid);
    if p->'file' is not null and jsonb_typeof(p->'file') = 'object' then
      f := p->'file';
      insert into public.client_request_attachments (request_id, passenger_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
      values (v.id, v_pid, 'identity', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
    end if;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_data->'extras', '[]'::jsonb)) loop
    insert into public.client_request_attachments (request_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (v.id, 'supporting', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
  end loop;
  insert into public.client_request_events (request_id, action, meta) values (v.id, 'submitted', jsonb_build_object('passengers', v_pos));
  return jsonb_build_object('id', v.id, 'passenger_ids', v_ids);
end;
$$;

create or replace function public.portal_post_message(p_hash text, p_body text, p_attachments jsonb default '[]'::jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; v_msg uuid; a jsonb; v_body text := btrim(coalesce(p_body, '')); v_n int := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if v.submitted_at is null then raise exception 'portal:not_submitted'; end if;
  if v_body = '' and v_n = 0 then raise exception 'portal:empty'; end if;
  if char_length(v_body) > 5000 then raise exception 'portal:too_long'; end if;
  if v_n > 5 then raise exception 'portal:too_many_files'; end if;
  if (select count(*) from public.client_request_messages where request_id = v.id and author = 'client' and created_at > now() - interval '1 hour') >= 30 then raise exception 'portal:rate_limited'; end if;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + v_n > 80 then raise exception 'portal:too_many_files'; end if;
  if (select coalesce(sum(size_bytes), 0) from public.client_request_attachments where request_id = v.id) > 250 * 1024 * 1024 then raise exception 'portal:storage_limit'; end if;

  insert into public.client_request_messages (request_id, author, body) values (v.id, 'client', v_body) returning id into v_msg;
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    insert into public.client_request_attachments (request_id, message_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (v.id, v_msg, 'message', 'client', left(a->>'file_name', 200), a->>'mime_type', (a->>'size_bytes')::bigint, a->>'storage_path');
  end loop;
  update public.client_requests set last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1 where id = v.id;
  return jsonb_build_object('id', v_msg, 'request_id', v.id);
end;
$$;

-- El cliente aclara/cambia su solicitud mientras la conversación siga abierta. Si cambia el tipo, lo anterior (tipo, datos y descripción) se conserva en details_history;
-- mensajes, pasajeros y documentos nunca se borran. p_data: {request_type, details, description, observations, passengers:[nuevos con file], extras:[...file]}
create or replace function public.portal_update_request(p_hash text, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; p jsonb; f jsonb; v_pid uuid; v_pos int; v_new text := p_data->>'request_type'; v_changed boolean; v_labels jsonb := '{"flight":"Vuelo","hotel":"Hotel","transport":"Transporte","food":"Alimentación","package":"Paquete turístico","other":"Otro requerimiento"}'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if v.submitted_at is null then raise exception 'portal:not_submitted'; end if;
  v_changed := v.request_type is distinct from v_new;
  select coalesce(max(position), 0) into v_pos from public.client_request_passengers where request_id = v.id;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + jsonb_array_length(coalesce(p_data->'passengers', '[]'::jsonb)) + jsonb_array_length(coalesce(p_data->'extras', '[]'::jsonb)) > 80 then raise exception 'portal:too_many_files'; end if;

  update public.client_requests set
    details_history = details_history || jsonb_build_array(jsonb_build_object('request_type', v.request_type, 'details', v.details, 'description', v.description, 'observations', v.observations, 'changed_at', now())),
    request_type = v_new, details = coalesce(p_data->'details', '{}'::jsonb),
    description = btrim(coalesce(p_data->>'description', description)), observations = btrim(coalesce(p_data->>'observations', observations)),
    last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1
  where id = v.id;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, v_pos, btrim(p->>'first_names'), btrim(p->>'last_names'), p->>'document_type', btrim(p->>'document_number'), (p->>'birth_date')::date) returning id into v_pid;
    if p->'file' is not null and jsonb_typeof(p->'file') = 'object' then
      f := p->'file';
      insert into public.client_request_attachments (request_id, passenger_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
      values (v.id, v_pid, 'identity', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
    end if;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_data->'extras', '[]'::jsonb)) loop
    insert into public.client_request_attachments (request_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (v.id, 'supporting', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
  end loop;

  -- aviso visible para la agencia en la propia conversación
  insert into public.client_request_messages (request_id, author, body)
  values (v.id, 'client', case when v_changed then 'Actualicé mi solicitud: el tipo de requerimiento cambió de «' || coalesce(v_labels->>v.request_type, 'sin definir') || '» a «' || coalesce(v_labels->>v_new, v_new) || '».'
                               else 'Actualicé los datos de mi solicitud.' end);
  insert into public.client_request_events (request_id, action, meta)
  values (v.id, case when v_changed then 'type_changed' else 'details_updated' end, jsonb_build_object('from', v.request_type, 'to', v_new));
  return jsonb_build_object('id', v.id, 'changed', v_changed);
end;
$$;

-- El cliente solo puede quitar archivos que ÉL envió en mensajes (nunca los de la agencia, ni los documentos de identidad / complementarios de la solicitud),
-- y solo mientras la conversación esté abierta. El trigger encola el borrado físico; la Edge Function lo ejecuta de inmediato.
create or replace function public.portal_delete_attachment(p_hash text, p_attachment uuid) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; a public.client_request_attachments; v_msg_deleted boolean := false;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  select * into a from public.client_request_attachments where id = p_attachment and request_id = v.id for update;
  if not found then raise exception 'portal:not_found'; end if;
  if a.uploaded_by <> 'client' or a.kind <> 'message' then raise exception 'portal:forbidden'; end if;
  delete from public.client_request_attachments where id = a.id;
  if not exists (select 1 from public.client_request_attachments where message_id = a.message_id)
     and exists (select 1 from public.client_request_messages where id = a.message_id and author = 'client' and btrim(body) = '') then
    delete from public.client_request_messages where id = a.message_id; v_msg_deleted := true;
  end if;
  insert into public.client_request_events (request_id, action, meta) values (v.id, 'attachment_deleted', jsonb_build_object('by', 'client'));
  return jsonb_build_object('storage_path', a.storage_path, 'message_deleted', v_msg_deleted);
end;
$$;

create or replace function public.portal_attachment(p_hash text, p_attachment uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('storage_path', a.storage_path, 'file_name', a.file_name, 'mime_type', a.mime_type)
  from public.client_request_attachments a join public.client_requests r on r.id = a.request_id
  where a.id = p_attachment and r.token_hash = p_hash and p_hash is not null and p_hash <> ''
$$;

revoke all on function public.portal_lookup(text), public.portal_get(text, timestamptz), public.portal_submit(text, jsonb), public.portal_post_message(text, text, jsonb),
  public.portal_update_request(text, jsonb), public.portal_delete_attachment(text, uuid), public.portal_attachment(text, uuid) from public, anon, authenticated;
grant execute on function public.portal_lookup(text), public.portal_get(text, timestamptz), public.portal_submit(text, jsonb), public.portal_post_message(text, text, jsonb),
  public.portal_update_request(text, jsonb), public.portal_delete_attachment(text, uuid), public.portal_attachment(text, uuid) to service_role;

-- 7. Migración para bases que ya tenían la versión anterior: permite conversaciones vacías (nombre y tipo los elige el cliente) y guarda el historial de cambios de tipo.
-- No borra ni modifica filas existentes.
alter table public.client_requests alter column request_type drop not null;
alter table public.client_requests alter column client_name set default '';
alter table public.client_requests add column if not exists details_history jsonb not null default '[]'::jsonb;
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.client_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%btrim(client_name)%' loop
    execute format('alter table public.client_requests drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.client_requests drop constraint if exists client_requests_client_name_len;
alter table public.client_requests add constraint client_requests_client_name_len check (char_length(client_name) <= 160);

notify pgrst, 'reload schema';
