-- Aires y Destinos: requerimientos múltiples por conversación del portal. Ejecutar completo en Supabase > SQL Editor.
-- Idempotente y NO destructivo: solo agrega una tabla, dos columnas opcionales y funciones nuevas; no toca datos existentes.
-- La solicitud principal sigue viviendo en client_requests (request_type/details/...); los requerimientos adicionales van en client_request_items.

-- 1. Tabla de requerimientos adicionales --------------------------------------------------------------------------------------------------------
create table if not exists public.client_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_requests (id) on delete cascade,
  position integer not null default 1,
  request_type text not null check (request_type in ('flight', 'hotel', 'transport', 'food', 'package', 'other')),
  description text not null default '' check (char_length(description) <= 4000),
  observations text not null default '' check (char_length(observations) <= 4000),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_request_items_request_idx on public.client_request_items (request_id, position);

drop trigger if exists client_request_items_updated_at on public.client_request_items;
create trigger client_request_items_updated_at before update on public.client_request_items for each row execute function public.set_updated_at();

-- Pasajeros y archivos complementarios se pueden vincular a un requerimiento concreto (NULL = solicitud principal, compatible con lo ya guardado)
alter table public.client_request_passengers add column if not exists item_id uuid references public.client_request_items (id) on delete cascade;
alter table public.client_request_attachments add column if not exists item_id uuid references public.client_request_items (id) on delete cascade;
create index if not exists client_request_passengers_item_idx on public.client_request_passengers (item_id);
create index if not exists client_request_attachments_item_idx on public.client_request_attachments (item_id);

alter table public.client_request_items enable row level security;
revoke all on public.client_request_items from anon, authenticated;
grant all on public.client_request_items to service_role;
grant select, insert, update, delete on public.client_request_items to authenticated;
drop policy if exists cri_agency_all on public.client_request_items;
create policy cri_agency_all on public.client_request_items for all to authenticated using (true) with check (true);

-- 2. Lectura del portal: ahora incluye los requerimientos adicionales con sus pasajeros y adjuntos -----------------------------------------------
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
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.client_request_messages m where m.request_id = v.id and (p_since is null or m.created_at > p_since)), '[]'::jsonb));
end;
$$;

-- 3. Agregar un requerimiento adicional (la conversación ya debe estar enviada). Máximo 10 por conversación.
-- p_data: {request_type, description, observations, details, passengers:[{... ,file|null}], extras:[{file}]}
create or replace function public.portal_add_item(p_hash text, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; p jsonb; f jsonb; v_pid uuid; v_pos int := 0; v_item uuid;
  v_labels jsonb := '{"flight":"Vuelo","hotel":"Hotel","transport":"Transporte","food":"Alimentación","package":"Paquete turístico","other":"Otro requerimiento"}'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if v.submitted_at is null then raise exception 'portal:not_submitted'; end if;
  if (select count(*) from public.client_request_items where request_id = v.id) >= 10 then raise exception 'portal:too_many_items'; end if;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + jsonb_array_length(coalesce(p_data->'passengers', '[]'::jsonb)) + jsonb_array_length(coalesce(p_data->'extras', '[]'::jsonb)) > 80 then raise exception 'portal:too_many_files'; end if;

  insert into public.client_request_items (request_id, position, request_type, description, observations, details)
  values (v.id, (select count(*) + 1 from public.client_request_items where request_id = v.id), p_data->>'request_type',
    btrim(coalesce(p_data->>'description', '')), btrim(coalesce(p_data->>'observations', '')), coalesce(p_data->'details', '{}'::jsonb))
  returning id into v_item;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, item_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, v_item, v_pos, btrim(p->>'first_names'), btrim(p->>'last_names'), p->>'document_type', btrim(p->>'document_number'), (p->>'birth_date')::date) returning id into v_pid;
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

-- 4. Actualizar un requerimiento adicional: tipo, datos, descripción y NUEVOS pasajeros/archivos (lo ya guardado se conserva).
create or replace function public.portal_update_item(p_hash text, p_item uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v public.client_requests; it public.client_request_items; p jsonb; f jsonb; v_pid uuid; v_pos int;
  v_labels jsonb := '{"flight":"Vuelo","hotel":"Hotel","transport":"Transporte","food":"Alimentación","package":"Paquete turístico","other":"Otro requerimiento"}'::jsonb;
begin
  select * into v from public.client_requests where token_hash = p_hash and p_hash is not null and p_hash <> '' for update;
  if not found then raise exception 'portal:invalid_link'; end if;
  if v.status = 'closed' then raise exception 'portal:closed'; end if;
  if v.submitted_at is null then raise exception 'portal:not_submitted'; end if;
  select * into it from public.client_request_items where id = p_item and request_id = v.id for update;
  if not found then raise exception 'portal:not_found'; end if;
  if (select count(*) from public.client_request_attachments where request_id = v.id) + jsonb_array_length(coalesce(p_data->'passengers', '[]'::jsonb)) + jsonb_array_length(coalesce(p_data->'extras', '[]'::jsonb)) > 80 then raise exception 'portal:too_many_files'; end if;

  select coalesce(max(position), 0) into v_pos from public.client_request_passengers where item_id = it.id;
  update public.client_request_items set request_type = p_data->>'request_type', description = btrim(coalesce(p_data->>'description', description)),
    observations = btrim(coalesce(p_data->>'observations', observations)), details = coalesce(p_data->'details', '{}'::jsonb)
  where id = it.id;

  for p in select * from jsonb_array_elements(coalesce(p_data->'passengers', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.client_request_passengers (request_id, item_id, position, first_names, last_names, document_type, document_number, birth_date)
    values (v.id, it.id, v_pos, btrim(p->>'first_names'), btrim(p->>'last_names'), p->>'document_type', btrim(p->>'document_number'), (p->>'birth_date')::date) returning id into v_pid;
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

-- 5. Permisos: las funciones del portal solo las ejecuta service_role (la Edge Function) ----------------------------------------------------------
revoke all on function public.portal_add_item(text, jsonb), public.portal_update_item(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.portal_add_item(text, jsonb), public.portal_update_item(text, uuid, jsonb) to service_role;
grant execute on function public.portal_get(text, timestamptz) to service_role;
