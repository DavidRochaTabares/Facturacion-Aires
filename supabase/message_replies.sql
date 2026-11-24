-- Aires y Destinos: responder a un mensaje concreto (cita), como en WhatsApp. Ejecutar completo en Supabase > SQL Editor.
-- Requiere client_requests.sql, request_items.sql, portal_chat_first.sql y company_portal.sql ya aplicados.
-- Idempotente y NO destructivo: agrega una columna opcional (los mensajes existentes quedan con reply_to = null) y recrea 5 funciones con un parámetro nuevo opcional.
-- reply_to no tiene clave foránea a propósito: si el mensaje citado se elimina, la cita sigue existiendo y la interfaz muestra «Mensaje eliminado».

alter table public.client_request_messages add column if not exists reply_to uuid;

-- 1. Agencia: agency_post_message con p_reply_to (se reemplaza la firma anterior para evitar ambigüedad entre sobrecargas)
drop function if exists public.agency_post_message(uuid, text, jsonb);
create or replace function public.agency_post_message(p_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb, p_reply_to uuid default null) returns uuid
language plpgsql as $$
declare v_user uuid := public.cr_require_user(); v_status text; v_msg uuid; a jsonb; v_body text := btrim(coalesce(p_body, ''));
begin
  select status into v_status from public.client_requests where id = p_id for update;
  if not found then raise exception 'La solicitud ya no existe.'; end if;
  if v_status = 'closed' then raise exception 'La conversación está cerrada. Reábrela para responder.'; end if;
  if v_body = '' and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then raise exception 'Escribe un mensaje o adjunta un archivo.'; end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 10 then raise exception 'Máximo 10 archivos por mensaje.'; end if;
  if p_reply_to is not null and not exists (select 1 from public.client_request_messages where id = p_reply_to and request_id = p_id) then p_reply_to := null; end if;
  insert into public.client_request_messages (request_id, author, author_user_id, body, reply_to) values (p_id, 'agency', v_user, v_body, p_reply_to) returning id into v_msg;
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
revoke all on function public.agency_post_message(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.agency_post_message(uuid, text, jsonb, uuid) to authenticated;

-- 2. Portal del empleado / cliente (solo service_role: la Edge Function «portal»)
drop function if exists public.portal_post_message(text, text, jsonb);
create or replace function public.portal_post_message(p_hash text, p_body text, p_attachments jsonb default '[]'::jsonb, p_reply_to uuid default null) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; v_msg uuid; a jsonb; v_body text := btrim(coalesce(p_body, '')); v_n int := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if v_body = '' and v_n = 0 then raise exception 'portal:empty'; end if;
  if char_length(v_body) > 5000 then raise exception 'portal:too_long'; end if;
  if v_n > 5 then raise exception 'portal:too_many_files'; end if;
  if (select count(*) from public.client_request_messages where request_id = v.id and author = 'client' and created_at > now() - interval '1 hour') >= 30 then raise exception 'portal:rate_limited'; end if;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + v_n > 80 then raise exception 'portal:too_many_files'; end if;
  if (select coalesce(sum(size_bytes), 0) from public.client_request_attachments where request_id = v.id) > 250 * 1024 * 1024 then raise exception 'portal:storage_limit'; end if;
  if p_reply_to is not null and not exists (select 1 from public.client_request_messages where id = p_reply_to and request_id = v.id) then p_reply_to := null; end if;

  insert into public.client_request_messages (request_id, author, body, reply_to) values (v.id, 'client', v_body, p_reply_to) returning id into v_msg;
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    insert into public.client_request_attachments (request_id, message_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (v.id, v_msg, 'message', 'client', left(a->>'file_name', 200), a->>'mime_type', (a->>'size_bytes')::bigint, a->>'storage_path');
  end loop;
  update public.client_requests set last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1 where id = v.id;
  return jsonb_build_object('id', v_msg, 'request_id', v.id);
end;
$$;
revoke all on function public.portal_post_message(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.portal_post_message(text, text, jsonb, uuid) to service_role;

-- 3. Administrador de la empresa
drop function if exists public.company_post_message(uuid, text);
create or replace function public.company_post_message(p_id uuid, p_body text, p_reply_to uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := public.company_admin_company(); r public.client_requests; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into r from public.client_requests where id = p_id and company_id = v for update;
  if not found then raise exception 'Conversación no encontrada.'; end if;
  if r.status = 'closed' then raise exception 'La conversación está cerrada.'; end if;
  if v_body = '' then raise exception 'Escribe un mensaje.'; end if;
  if char_length(v_body) > 4900 then raise exception 'El mensaje es demasiado largo.'; end if;
  if (select count(*) from public.client_request_messages where request_id = r.id and author = 'client' and created_at > now() - interval '1 hour') >= 60 then raise exception 'Has enviado muchos mensajes en poco tiempo.'; end if;
  if p_reply_to is not null and not exists (select 1 from public.client_request_messages where id = p_reply_to and request_id = r.id) then p_reply_to := null; end if;
  insert into public.client_request_messages (request_id, author, body, reply_to) values (r.id, 'client', 'Administrador de la empresa: ' || v_body, p_reply_to);
  update public.client_requests set last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1 where id = r.id;
end;
$$;
revoke all on function public.company_post_message(uuid, text, uuid) from public, anon;
grant execute on function public.company_post_message(uuid, text, uuid) to authenticated, service_role;

-- 4. Lecturas: los mensajes devuelven reply_to (la interfaz arma la cita con la lista de mensajes de la conversación)
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
      'document_number', p.document_number, 'birth_date', p.birth_date, 'item_id', p.item_id) order by p.position) from public.client_request_passengers p where p.request_id = v.id and p.item_id is null), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'passenger_id', a.passenger_id, 'message_id', a.message_id, 'item_id', a.item_id, 'file_name', a.file_name,
      'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'uploaded_by', a.uploaded_by, 'created_at', a.created_at) order by a.created_at) from public.client_request_attachments a where a.request_id = v.id and a.item_id is null), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'request_type', i.request_type, 'description', i.description, 'observations', i.observations, 'details', i.details, 'created_at', i.created_at,
        'passengers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'first_names', p.first_names, 'last_names', p.last_names, 'document_type', p.document_type,
          'document_number', p.document_number, 'birth_date', p.birth_date, 'item_id', p.item_id) order by p.position) from public.client_request_passengers p where p.item_id = i.id), '[]'::jsonb),
        'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'passenger_id', a.passenger_id, 'message_id', a.message_id, 'item_id', a.item_id, 'file_name', a.file_name,
          'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'uploaded_by', a.uploaded_by, 'created_at', a.created_at) order by a.created_at) from public.client_request_attachments a where a.item_id = i.id), '[]'::jsonb))
      order by i.position) from public.client_request_items i where i.request_id = v.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'created_at', m.created_at, 'reply_to', m.reply_to) order by m.created_at, m.id)
      from public.client_request_messages m where m.request_id = v.id and (p_since is null or m.created_at > p_since)), '[]'::jsonb));
end;
$$;
grant execute on function public.portal_get(text, timestamptz) to service_role;

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
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'created_at', m.created_at, 'reply_to', m.reply_to) order by m.created_at, m.id)
      from public.client_request_messages m where m.request_id = r.id), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'from_status', h.from_status, 'to_status', h.to_status, 'actor_type', h.actor_type,
      'actor_label', h.actor_label, 'note', h.note, 'created_at', h.created_at) order by h.created_at, h.id)
      from public.conversation_approvals h where h.request_id = r.id), '[]'::jsonb));
end;
$$;
grant execute on function public.company_get_conversation(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
