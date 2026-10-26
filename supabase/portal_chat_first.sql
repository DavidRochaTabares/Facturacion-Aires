-- Aires y Destinos: chat primero y formularios flexibles en el portal de clientes.
--  * El cliente puede conversar sin haber enviado ningún formulario (portal_post_message ya no exige submitted_at).
--  * Puede agregar/editar requerimientos adicionales antes o después de enviar la solicitud principal.
--  * Los pasajeros pueden quedar parcialmente diligenciados (campos vacíos ya no rompen el guardado).
--  * El aviso de privacidad deja de ser obligatorio para enviar: se registra la fecha solo si el cliente lo acepta.
-- Idempotente y NO destructivo: no toca datos existentes. Ejecutar completo en Supabase > SQL Editor.

-- 1. Pasajeros parciales: se quitan los checks que exigían campos llenos y la fecha de nacimiento pasa a ser opcional.
alter table public.client_request_passengers drop constraint if exists client_request_passengers_first_names_check;
alter table public.client_request_passengers drop constraint if exists client_request_passengers_last_names_check;
alter table public.client_request_passengers drop constraint if exists client_request_passengers_document_type_check;
alter table public.client_request_passengers drop constraint if exists client_request_passengers_document_number_check;
alter table public.client_request_passengers alter column birth_date drop not null;

-- 2. Envío de la solicitud principal: privacidad opcional y pasajeros que admiten campos vacíos.
create or replace function public.portal_submit(p_hash text, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; p jsonb; f jsonb; v_pid uuid; v_pos int := 0; v_ids jsonb := '[]'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if v.submitted_at is not null then raise exception 'portal:already_submitted'; end if;

  update public.client_requests set client_name = btrim(coalesce(p_data->>'client_name', '')), client_email = btrim(coalesce(p_data->>'client_email', '')), client_phone = btrim(coalesce(p_data->>'client_phone', '')),
    request_type = nullif(p_data->>'request_type', ''), description = btrim(coalesce(p_data->>'description', '')), observations = btrim(coalesce(p_data->>'observations', '')),
    details = coalesce(p_data->'details', '{}'::jsonb), submitted_at = now(),
    privacy_accepted_at = case when coalesce((p_data->>'privacy_accepted')::boolean, false) then now() else null end,
    last_activity_at = now(), last_message_author = 'client',
    agency_unread = agency_unread + 1 where id = v.id;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, v_pos, btrim(coalesce(p->>'first_names', '')), btrim(coalesce(p->>'last_names', '')), coalesce(nullif(p->>'document_type', ''), ''), btrim(coalesce(p->>'document_number', '')), nullif(p->>'birth_date', '')::date) returning id into v_pid;
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

-- 3. Chat sin formulario: el cliente puede escribir desde el primer momento.
create or replace function public.portal_post_message(p_hash text, p_body text, p_attachments jsonb default '[]'::jsonb) returns jsonb
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

  insert into public.client_request_messages (request_id, author, body) values (v.id, 'client', v_body) returning id into v_msg;
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    insert into public.client_request_attachments (request_id, message_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (v.id, v_msg, 'message', 'client', left(a->>'file_name', 200), a->>'mime_type', (a->>'size_bytes')::bigint, a->>'storage_path');
  end loop;
  update public.client_requests set last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1 where id = v.id;
  return jsonb_build_object('id', v_msg, 'request_id', v.id);
end;
$$;

-- 4. Requerimientos adicionales sin exigir solicitud enviada (la conversación ya existe por el enlace).
create or replace function public.portal_add_item(p_hash text, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; p jsonb; f jsonb; v_pid uuid; v_pos int := 0; v_item uuid;
  v_labels jsonb := '{"flight":"Vuelo","hotel":"Hotel","transport":"Transporte","food":"Alimentación","package":"Paquete turístico","other":"Otro requerimiento"}'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if (select count(*) from public.client_request_items where request_id = v.id) >= 10 then raise exception 'portal:too_many_items'; end if;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + jsonb_array_length(coalesce(p_data->'passengers', '[]'::jsonb)) + jsonb_array_length(coalesce(p_data->'extras', '[]'::jsonb)) > 80 then raise exception 'portal:too_many_files'; end if;

  insert into public.client_request_items (request_id, position, request_type, description, observations, details)
  values (v.id, (select count(*) + 1 from public.client_request_items where request_id = v.id), nullif(p_data->>'request_type', ''),
    btrim(coalesce(p_data->>'description', '')), btrim(coalesce(p_data->>'observations', '')), coalesce(p_data->'details', '{}'::jsonb))
  returning id into v_item;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, item_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, v_item, v_pos, btrim(coalesce(p->>'first_names', '')), btrim(coalesce(p->>'last_names', '')), coalesce(nullif(p->>'document_type', ''), ''), btrim(coalesce(p->>'document_number', '')), nullif(p->>'birth_date', '')::date) returning id into v_pid;
    if p->'file' is not null and jsonb_typeof(p->'file') = 'object' then
      f := p->'file';
      insert into public.client_request_attachments (request_id, item_id, passenger_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
      values (v.id, v_item, v_pid, 'identity', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
    end if;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_data->'extras', '[]'::jsonb)) loop
    insert into public.client_request_attachments (request_id, item_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (v.id, v_item, 'supporting', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
  end loop;

  insert into public.client_request_messages (request_id, author, body)
  values (v.id, 'client', 'Agregué un nuevo requerimiento: «' || coalesce(v_labels->>(p_data->>'request_type'), 'otro') || '».');
  insert into public.client_request_events (request_id, action, meta) values (v.id, 'item_added', jsonb_build_object('item', v_item, 'type', p_data->>'request_type'));
  update public.client_requests set last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1 where id = v.id;
  return jsonb_build_object('id', v_item);
end;
$$;

create or replace function public.portal_update_item(p_hash text, p_item uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; it public.client_request_items; p jsonb; f jsonb; v_pid uuid; v_pos int;
  v_labels jsonb := '{"flight":"Vuelo","hotel":"Hotel","transport":"Transporte","food":"Alimentación","package":"Paquete turístico","other":"Otro requerimiento"}'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  select * into it from public.client_request_items where id = p_item and request_id = v.id for update;
  if not found then raise exception 'portal:not_found'; end if;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + jsonb_array_length(coalesce(p_data->'passengers', '[]'::jsonb)) + jsonb_array_length(coalesce(p_data->'extras', '[]'::jsonb)) > 80 then raise exception 'portal:too_many_files'; end if;

  select coalesce(max(position), 0) into v_pos from public.client_request_passengers where item_id = it.id;
  update public.client_request_items set request_type = nullif(p_data->>'request_type', ''), description = btrim(coalesce(p_data->>'description', description)),
    observations = btrim(coalesce(p_data->>'observations', observations)), details = coalesce(p_data->'details', '{}'::jsonb)
  where id = it.id;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, item_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, it.id, v_pos, btrim(coalesce(p->>'first_names', '')), btrim(coalesce(p->>'last_names', '')), coalesce(nullif(p->>'document_type', ''), ''), btrim(coalesce(p->>'document_number', '')), nullif(p->>'birth_date', '')::date) returning id into v_pid;
    if p->'file' is not null and jsonb_typeof(p->'file') = 'object' then
      f := p->'file';
      insert into public.client_request_attachments (request_id, item_id, passenger_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
      values (v.id, it.id, v_pid, 'identity', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
    end if;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_data->'extras', '[]'::jsonb)) loop
    insert into public.client_request_attachments (request_id, item_id, kind, uploaded_by, file_name, mime_type, size_bytes, storage_path)
    values (v.id, it.id, 'supporting', 'client', left(f->>'file_name', 200), f->>'mime_type', (f->>'size_bytes')::bigint, f->>'storage_path');
  end loop;

  insert into public.client_request_messages (request_id, author, body)
  values (v.id, 'client', 'Actualicé el requerimiento «' || coalesce(v_labels->>(p_data->>'request_type'), 'otro') || '».');
  insert into public.client_request_events (request_id, action, meta) values (v.id, 'item_updated', jsonb_build_object('item', it.id, 'type', p_data->>'request_type'));
  update public.client_requests set last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1 where id = v.id;
  return jsonb_build_object('id', it.id);
end;
$$;

-- 5. Requerimientos adicionales también pueden guardarse sin tipo (el check ya admite null).
alter table public.client_request_items alter column request_type drop not null;

-- 6. Actualizar la solicitud principal ya no exige submitted_at: si el cliente guarda el formulario
--    desde el chat antes de "enviarla", esa misma acción marca la solicitud como enviada.
create or replace function public.portal_update_request(p_hash text, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; p jsonb; f jsonb; v_pid uuid; v_pos int; v_new text := nullif(p_data->>'request_type', ''); v_changed boolean;
  v_labels jsonb := '{"flight":"Vuelo","hotel":"Hotel","transport":"Transporte","food":"Alimentación","package":"Paquete turístico","other":"Otro requerimiento"}'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  v_changed := v.request_type is distinct from v_new;
  select coalesce(max(position), 0) into v_pos from public.client_request_passengers where request_id = v.id and item_id is null;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + jsonb_array_length(coalesce(p_data->'passengers', '[]'::jsonb)) + jsonb_array_length(coalesce(p_data->'extras', '[]'::jsonb)) > 80 then raise exception 'portal:too_many_files'; end if;

  update public.client_requests set
    details_history = case when v.submitted_at is null then details_history
      else details_history || jsonb_build_array(jsonb_build_object('request_type', v.request_type, 'details', v.details, 'description', v.description, 'observations', v.observations, 'changed_at', now())) end,
    request_type = v_new, details = coalesce(p_data->'details', '{}'::jsonb),
    description = btrim(coalesce(p_data->>'description', description)), observations = btrim(coalesce(p_data->>'observations', observations)),
    client_name = btrim(coalesce(nullif(p_data->>'client_name', ''), client_name)),
    client_email = btrim(coalesce(p_data->>'client_email', client_email)), client_phone = btrim(coalesce(p_data->>'client_phone', client_phone)),
    submitted_at = coalesce(submitted_at, now()),
    last_activity_at = now(), last_message_author = 'client', agency_unread = agency_unread + 1
  where id = v.id;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, v_pos, btrim(coalesce(p->>'first_names', '')), btrim(coalesce(p->>'last_names', '')), coalesce(nullif(p->>'document_type', ''), ''), btrim(coalesce(p->>'document_number', '')), nullif(p->>'birth_date', '')::date) returning id into v_pid;
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

  insert into public.client_request_messages (request_id, author, body)
  values (v.id, 'client', case when v.submitted_at is null then 'Envié el formulario de mi solicitud.'
    when v_changed then 'Actualicé mi solicitud: el tipo de requerimiento cambió de «' || coalesce(v_labels->>v.request_type, 'sin definir') || '» a «' || coalesce(v_labels->>v_new, 'sin definir') || '».'
    else 'Actualicé los datos de mi solicitud.' end);
  insert into public.client_request_events (request_id, action, meta)
  values (v.id, case when v.submitted_at is null then 'submitted' when v_changed then 'type_changed' else 'details_updated' end, jsonb_build_object('from', v.request_type, 'to', v_new));
  return jsonb_build_object('id', v.id, 'changed', v_changed);
end;
$$;

revoke all on function public.portal_submit(text, jsonb), public.portal_post_message(text, text, jsonb),
  public.portal_add_item(text, jsonb), public.portal_update_item(text, uuid, jsonb), public.portal_update_request(text, jsonb) from public, anon, authenticated;
grant execute on function public.portal_submit(text, jsonb), public.portal_post_message(text, text, jsonb),
  public.portal_add_item(text, jsonb), public.portal_update_item(text, uuid, jsonb), public.portal_update_request(text, jsonb) to service_role;

notify pgrst, 'reload schema';
