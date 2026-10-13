-- Aires y Destinos: eliminación segura de registros. Ejecutar completo en Supabase > SQL Editor. Es idempotente.
--
-- Estado real del esquema (verificado): todas las tablas hijas (flights, hotels, loans, food_services, transport_services, additional_services, documents,
-- flight_segments, passengers, bank_documents) tienen FK con ON DELETE CASCADE hacia operations / flights / bank_movements, y las políticas RLS ya permiten
-- borrar a los usuarios autenticados. Lo que NO se limpia solo: (1) los archivos del bucket «documents», (2) los grupos (operation_groups) que quedan vacíos.
--
-- Cada función corre en UNA sola transacción: si algo falla, no se borra nada. Devuelven las rutas de archivos que ya nadie usa;
-- el frontend las elimina del Storage. Un archivo compartido por otro registro (documents / bank_documents) NO se devuelve, así que no se borra.

-- 1. Storage: permitir borrar archivos del bucket «documents» a usuarios autenticados (hoy solo hay política de leer, subir y actualizar)
drop policy if exists authenticated_delete_documents on storage.objects;
create policy authenticated_delete_documents on storage.objects for delete to authenticated using (bucket_id = 'documents');

-- 2. Operaciones (uno o varios ids; p. ej. todos los pasajeros de una reserva)
create or replace function public.delete_operations(p_ids uuid[]) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_paths text[];
  v_groups uuid[];
  v_orphans text[];
  v_deleted int;
begin
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids from unnest(coalesce(p_ids, '{}'::uuid[])) as x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'No se indicó ningún registro.'; end if;
  if (select count(*) from public.operations where id = any(v_ids)) <> array_length(v_ids, 1) then
    raise exception 'Alguno de los registros ya no existe. Actualiza la tabla e inténtalo de nuevo.';
  end if;

  select coalesce(array_agg(distinct storage_path), '{}'::text[]) into v_paths from public.documents where operation_id = any(v_ids);
  select coalesce(array_agg(distinct group_id), '{}'::uuid[]) into v_groups from public.operations where id = any(v_ids) and group_id is not null;

  delete from public.operations where id = any(v_ids);
  get diagnostics v_deleted = row_count;

  delete from public.operation_groups g where g.id = any(v_groups) and not exists (select 1 from public.operations o where o.group_id = g.id);

  select coalesce(array_agg(p), '{}'::text[]) into v_orphans from unnest(v_paths) as p
  where not exists (select 1 from public.documents d where d.storage_path = p)
    and not exists (select 1 from public.bank_documents b where b.storage_path = p);

  return jsonb_build_object('deleted', v_deleted, 'storage_paths', to_jsonb(v_orphans));
end;
$$;

-- 3. Movimientos bancarios
create or replace function public.delete_bank_movement(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_paths text[];
  v_orphans text[];
begin
  if not exists (select 1 from public.bank_movements where id = p_id) then
    raise exception 'El movimiento ya no existe. Actualiza la tabla e inténtalo de nuevo.';
  end if;
  select coalesce(array_agg(distinct storage_path), '{}'::text[]) into v_paths from public.bank_documents where bank_movement_id = p_id;

  delete from public.bank_movements where id = p_id;

  select coalesce(array_agg(p), '{}'::text[]) into v_orphans from unnest(v_paths) as p
  where not exists (select 1 from public.documents d where d.storage_path = p)
    and not exists (select 1 from public.bank_documents b where b.storage_path = p);

  return jsonb_build_object('deleted', 1, 'storage_paths', to_jsonb(v_orphans));
end;
$$;

revoke all on function public.delete_operations(uuid[]), public.delete_bank_movement(uuid) from public, anon;
grant execute on function public.delete_operations(uuid[]), public.delete_bank_movement(uuid) to authenticated;

notify pgrst, 'reload schema';
