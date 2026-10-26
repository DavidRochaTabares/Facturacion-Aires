-- Aires y Destinos: categorías de documentos, vuelos incompletos, alertas de cobro y movimientos personales.
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente. No borra ni modifica datos existentes.

-- 1. Categoría de cada adjunto de una operación.
--    Valores: 'ticket' (tiquete/itinerario), 'payment' (soporte de pago), 'supplier_invoice' (factura proveedor),
--    'agency_invoice' (factura Aires y Destinos), 'other' (cualquier otro). Los adjuntos existentes quedan en 'other'.
alter table public.documents add column if not exists category text not null default 'other';
update public.documents set category = 'other' where category is null or btrim(category) = '' or category not in ('ticket', 'payment', 'supplier_invoice', 'agency_invoice');
alter table public.documents drop constraint if exists documents_category_check;
alter table public.documents add constraint documents_category_check check (category in ('ticket', 'payment', 'supplier_invoice', 'agency_invoice', 'other'));
grant update on public.documents to authenticated;
drop policy if exists documents_authenticated_update on public.documents;
create policy documents_authenticated_update on public.documents for update to authenticated using (true) with check (true);

-- 2. Vuelos incompletos: la vista marca un vuelo como incompleto si falta itinerario, soporte de pago,
--    factura proveedor o factura Aires y Destinos (según la categoría de sus adjuntos).
create or replace view public.operations_view with (security_invoker = true) as
select
  o.id, o.company_id, o.type, o.operation_date as date, o.provider, o.invoice_number, o.amount, o.charge_amount, o.observations, o.group_id, o.created_at,
  c.name as company_name,
  case when g.id is null then null
       else jsonb_build_object('id', g.id, 'code', g.code, 'label', g.name, 'created_at', g.created_at) end as group_info,
  d.details,
  coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.documents x where x.operation_id = o.id), '[]'::jsonb) as documents,
  extract(year from o.operation_date)::int as year,
  extract(month from o.operation_date)::int as month,
  fl.airline,
  (o.type = 'loan' and (
    coalesce(o.amount, 0) <= 0 or btrim(coalesce(o.invoice_number, '')) = '' or ln.operation_id is null
    or btrim(coalesce(ln.request, '')) = '' or ln.invoice_date is null or btrim(coalesce(ln.purchase_order, '')) = ''
    or ln.received_at is null or btrim(coalesce(ln.requested_by, '')) = ''
  )) or (o.type = 'flight' and (
    fl.operation_id is null
    or btrim(coalesce(fl.airline, '')) = ''
    or not exists (select 1 from public.flight_segments s where s.flight_id = o.id
                   and btrim(coalesce(s.origin, '')) <> '' and btrim(coalesce(s.destination, '')) <> '' and s.departure_date is not null)
    or not exists (select 1 from public.documents x where x.operation_id = o.id and x.category = 'payment')
    or not exists (select 1 from public.documents x where x.operation_id = o.id and x.category = 'supplier_invoice')
    or not exists (select 1 from public.documents x where x.operation_id = o.id and x.category = 'agency_invoice')
  )) as is_incomplete,
  lower(concat_ws(' ', c.name, o.provider, o.invoice_number, g.code, g.name, d.details::text)) as search_text
from public.operations o
join public.companies c on c.id = o.company_id
left join public.operation_groups g on g.id = o.group_id
left join public.flights fl on fl.operation_id = o.id
left join public.hotels hh on hh.operation_id = o.id
left join public.loans ln on ln.operation_id = o.id
left join public.food_services fs on fs.operation_id = o.id
left join public.transport_services ts on ts.operation_id = o.id
left join public.additional_services ad on ad.operation_id = o.id
left join lateral (
  select case o.type
    when 'flight' then jsonb_build_object(
      'no', coalesce(fl.row_number::text, ''), 'first_surname', fl.first_surname, 'names', fl.names, 'route', fl.route,
      'departure_date', fl.departure_date, 'return_date', fl.return_date, 'airline', fl.airline, 'booking_code', fl.booking_code,
      'internal_booking_code', fl.internal_booking_code, 'ticket_number', fl.ticket_number,
      'value_with_taxes_tae', fl.ticket_value_with_taxes_ta_fee, 'total_invoice', fl.total_invoice, 'third_party_commission', fl.third_party_commission,
      'provider_profit', fl.provider_profit, 'ta', fl.ta, 'ta_without_iva', fl.ta_without_vat, 'ta_with_iva', fl.ta_with_vat, 'iva_ta', fl.ta_vat,
      'net_quote_minus_iva_ta', fl.net_quotation_less_ta_vat,
      'card_number', fl.card_number, 'purchase_invoice', fl.purchase_invoice,
      'segments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'flight_number', s.flight_number, 'origin', s.origin, 'destination', s.destination,
          'departure_date', s.departure_date, 'departure_time', s.departure_time, 'arrival_date', s.arrival_date, 'arrival_time', s.arrival_time, 'cabin', s.cabin)
          order by s."position", s.id) from public.flight_segments s where s.flight_id = fl.operation_id), '[]'::jsonb),
      'passengers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'names', coalesce(p.names, p.full_name, ''), 'surnames', coalesce(p.surnames, ''), 'document_type', p.document_type, 'document_number', p.document_number,
          'birth_date', p.birth_date, 'email', p.email, 'phone', p.phone, 'frequent_flyer', p.frequent_flyer, 'ticket_number', p.ticket_number)
          order by p.ctid) from public.passengers p where p.flight_id = fl.operation_id), '[]'::jsonb))
    when 'hotel' then jsonb_build_object(
      'reservation_number', hh.reservation_number, 'accommodation_code', hh.accommodation_code, 'hotel', hh.hotel_name, 'city', hh.city, 'address', hh.address,
      'phone', hh.phone, 'email', hh.email, 'check_in', hh.check_in, 'check_in_time', hh.check_in_time, 'check_out', hh.check_out, 'check_out_time', hh.check_out_time,
      'nights', hh.nights, 'holder', hh.guest_name, 'guests', hh.guest_count, 'room_type', hh.room_type, 'board', hh.meal_plan,
      'special_requests', hh.special_requests, 'purchase_invoice', hh.purchase_invoice,
      'ta', hh.ta, 'ta_without_iva', hh.ta_without_vat, 'ta_with_iva', hh.ta_with_vat, 'iva_ta', hh.ta_vat,
      'total_invoice', hh.total_invoice, 'third_party_commission', hh.third_party_commission, 'provider_profit', hh.provider_profit,
      'net_quote_minus_iva_ta', hh.net_quotation_less_ta_vat)
    when 'loan' then jsonb_build_object(
      'request', ln.request, 'invoice_date', ln.invoice_date, 'cot', ln.cot, 'sent', ln.sent_at, 'charged_quoted_value', ln.quoted_value, 'iva', ln.vat,
      'oc', ln.purchase_order, 'received', ln.received_at, 'requested_by', ln.requested_by, 'paid', ln.paid_at, 'has_iva', ln.has_vat)
    when 'food' then jsonb_build_object(
      'requested_by', fs.requested_by, 'requested_item', fs.request_description, 'supplies_value', fs.supply_value, 'transport_value', fs.transport_value,
      'total_cost', coalesce(fs.total_cost, 0))
    when 'transport' then jsonb_build_object(
      'origin', ts.origin, 'destination', ts.destination, 'time', ts.service_time, 'passenger', ts.passenger, 'service_number', ts.service_number)
    else jsonb_build_object('description', ad.description)
  end as details
) d on true;

grant select on public.operations_view to authenticated;

-- 3. Alertas de cobro: una por operación con factura pendiente. Vencen un mes después de la fecha de facturación
--    (invoice_date del préstamo); si el registro no tiene fecha de facturación, se usa su fecha de creación.
create table if not exists public.invoice_alerts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  invoice_number text not null default '',
  amount numeric(14,2) not null default 0,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_movement_id uuid references public.bank_movements(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists invoice_alerts_operation_key on public.invoice_alerts (operation_id);
alter table public.invoice_alerts enable row level security;
drop policy if exists invoice_alerts_authenticated_all on public.invoice_alerts;
create policy invoice_alerts_authenticated_all on public.invoice_alerts for all to authenticated using (true) with check (true);
revoke all on public.invoice_alerts from anon;
grant select, insert, update, delete on public.invoice_alerts to authenticated;

-- 3b. save_operation vuelve a crearse igual que antes, más el bloque que mantiene la alerta del registro.
create or replace function public.save_operation(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  d jsonb := coalesce(p->'details', '{}'::jsonb);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_type public.operation_type := (p->>'type')::public.operation_type;
  v_company uuid := (p->>'company_id')::uuid;
  v_date date := nullif(p->>'date', '')::date;
  v_provider text := coalesce(p->>'provider', '');
  v_invoice text := coalesce(p->>'invoice_number', '');
  v_obs text := coalesce(p->>'observations', '');
  v_charge numeric := coalesce(nullif(p->>'charge_amount', '')::numeric, 0);
  v_amount numeric := coalesce(nullif(p->>'amount', '')::numeric, 0);
  v_group uuid;
  v_client text;
  v_no int;
  v_n19 numeric;
  v_vat5 numeric;
  v_due date;
  r record;
begin
  if v_type in ('flight', 'hotel', 'transport', 'additional', 'other') then
    v_group := nullif(p->>'group_id', '')::uuid;
    if v_group is null and btrim(coalesce(p->>'group_label', '')) <> '' then
      insert into public.operation_groups (name) values (btrim(p->>'group_label')) returning id into v_group;
    end if;
  end if;

  if v_type = 'flight' then
    v_amount := coalesce(nullif(d->>'value_with_taxes_tae', '')::numeric, 0);
  elsif v_type = 'food' then
    v_amount := coalesce(nullif(d->>'supplies_value', '')::numeric, 0) + coalesce(nullif(d->>'transport_value', '')::numeric, 0);
  end if;

  if v_id is null then
    insert into public.operations (company_id, type, operation_date, provider, invoice_number, amount, charge_amount, observations, group_id)
    values (v_company, v_type, v_date, v_provider, v_invoice, v_amount, v_charge, v_obs, v_group)
    returning id into v_id;
  else
    update public.operations set
      company_id = v_company, type = v_type, operation_date = v_date, provider = v_provider, invoice_number = v_invoice,
      amount = v_amount, charge_amount = v_charge, observations = v_obs, group_id = v_group
    where id = v_id;
    if not found then raise exception 'Operación no encontrada'; end if;
    select national_ticket_without_19, vat_5 into v_n19, v_vat5 from public.flights where operation_id = v_id;
    delete from public.flights where operation_id = v_id;
    delete from public.hotels where operation_id = v_id;
    delete from public.loans where operation_id = v_id;
    delete from public.food_services where operation_id = v_id;
    delete from public.transport_services where operation_id = v_id;
    delete from public.additional_services where operation_id = v_id;
  end if;

  if v_type = 'flight' then
    select name into v_client from public.companies where id = v_company;
    v_no := case when coalesce(d->>'no', '') ~ '^\s*\d+\s*$' then btrim(d->>'no')::int end;
    insert into public.flights (operation_id, row_number, invoice, client, first_surname, names, route, departure_date, return_date, airline, booking_code,
      internal_booking_code, ticket_number, ticket_value_with_taxes_ta_fee, total_invoice, third_party_commission, provider_profit, ta, ta_without_vat, ta_with_vat, ta_vat,
      net_quotation_less_ta_vat, national_ticket_without_19, vat_5, card_number, provider, purchase_invoice, observation)
    values (v_id, v_no, v_invoice, v_client, coalesce(d->>'first_surname', ''), coalesce(d->>'names', ''), coalesce(d->>'route', ''),
      nullif(d->>'departure_date', '')::date, nullif(d->>'return_date', '')::date, coalesce(d->>'airline', ''), coalesce(d->>'booking_code', ''),
      coalesce(d->>'internal_booking_code', ''), coalesce(d->>'ticket_number', ''),
      nullif(d->>'value_with_taxes_tae', '')::numeric, nullif(d->>'total_invoice', '')::numeric, nullif(d->>'third_party_commission', '')::numeric,
      nullif(d->>'provider_profit', '')::numeric, nullif(d->>'ta', '')::numeric, nullif(d->>'ta_without_iva', '')::numeric, nullif(d->>'ta_with_iva', '')::numeric, nullif(d->>'iva_ta', '')::numeric,
      nullif(d->>'net_quote_minus_iva_ta', '')::numeric, v_n19, v_vat5,
      coalesce(d->>'card_number', ''), v_provider, coalesce(d->>'purchase_invoice', ''), v_obs);

    for r in select t.v, t.n from jsonb_array_elements(coalesce(d->'segments', '[]'::jsonb)) with ordinality as t(v, n) loop
      insert into public.flight_segments (flight_id, "position", flight_number, origin, destination, departure_date, departure_time, arrival_date, arrival_time, cabin)
      values (v_id, (r.n)::int, coalesce(r.v->>'flight_number', ''), coalesce(r.v->>'origin', ''), coalesce(r.v->>'destination', ''),
        nullif(r.v->>'departure_date', '')::date, nullif(r.v->>'departure_time', '')::time, nullif(r.v->>'arrival_date', '')::date, nullif(r.v->>'arrival_time', '')::time,
        coalesce(nullif(r.v->>'cabin', ''), 'Economy'));
    end loop;

    for r in select t.v from jsonb_array_elements(coalesce(d->'passengers', '[]'::jsonb)) as t(v) loop
      insert into public.passengers (flight_id, full_name, names, surnames, document_type, document_number, birth_date, email, phone, frequent_flyer, ticket_number)
      values (v_id, btrim(concat_ws(' ', r.v->>'names', r.v->>'surnames')), coalesce(r.v->>'names', ''), coalesce(r.v->>'surnames', ''), coalesce(nullif(r.v->>'document_type', ''), 'CC'), coalesce(r.v->>'document_number', ''),
        nullif(r.v->>'birth_date', '')::date, coalesce(r.v->>'email', ''), coalesce(r.v->>'phone', ''), coalesce(r.v->>'frequent_flyer', ''), coalesce(r.v->>'ticket_number', ''));
    end loop;

  elsif v_type = 'hotel' then
    insert into public.hotels (operation_id, reservation_number, accommodation_code, hotel_name, city, address, phone, email, check_in, check_in_time, check_out, check_out_time,
      nights, guest_name, guest_count, room_type, meal_plan, special_requests, provider, value, charge_amount, invoice, purchase_invoice, observations, ta, ta_without_vat, ta_with_vat,
      total_invoice, third_party_commission, provider_profit, net_quotation_less_ta_vat, ta_vat)
    values (v_id, coalesce(d->>'reservation_number', ''), coalesce(d->>'accommodation_code', ''), coalesce(d->>'hotel', ''), coalesce(d->>'city', ''),
      coalesce(d->>'address', ''), coalesce(d->>'phone', ''), coalesce(d->>'email', ''), nullif(d->>'check_in', '')::date, nullif(d->>'check_in_time', '')::time,
      nullif(d->>'check_out', '')::date, nullif(d->>'check_out_time', '')::time, nullif(d->>'nights', '')::int, coalesce(d->>'holder', ''),
      nullif(d->>'guests', '')::int, coalesce(d->>'room_type', ''), coalesce(d->>'board', ''), coalesce(d->>'special_requests', ''),
      v_provider, v_amount, v_charge, v_invoice, coalesce(d->>'purchase_invoice', ''), v_obs,
      nullif(d->>'ta', '')::numeric, nullif(d->>'ta_without_iva', '')::numeric, nullif(d->>'ta_with_iva', '')::numeric,
      nullif(d->>'total_invoice', '')::numeric, nullif(d->>'third_party_commission', '')::numeric, nullif(d->>'provider_profit', '')::numeric,
      nullif(d->>'net_quote_minus_iva_ta', '')::numeric, nullif(d->>'iva_ta', '')::numeric);

  elsif v_type = 'loan' then
    insert into public.loans (operation_id, request, value, invoice, invoice_date, cot, sent_at, quoted_value, vat, purchase_order, received_at, requested_by, paid_at,
      provider, charge_amount, observation, has_vat)
    values (v_id, coalesce(d->>'request', ''), v_amount, v_invoice, nullif(d->>'invoice_date', '')::date, coalesce(d->>'cot', ''), nullif(d->>'sent', '')::date,
      nullif(d->>'charged_quoted_value', '')::numeric, nullif(d->>'iva', '')::numeric, coalesce(d->>'oc', ''), nullif(d->>'received', '')::date,
      coalesce(d->>'requested_by', ''), nullif(d->>'paid', '')::date, v_provider, v_charge, v_obs,
      coalesce(nullif(d->>'has_iva', '')::boolean, false));

  elsif v_type = 'food' then
    insert into public.food_services (operation_id, request_date, requested_by, request_description, supply_value, transport_value, total_cost, charge_amount, provider, observations)
    values (v_id, v_date, coalesce(d->>'requested_by', ''), coalesce(d->>'requested_item', ''), nullif(d->>'supplies_value', '')::numeric,
      nullif(d->>'transport_value', '')::numeric, v_amount, v_charge, v_provider, v_obs);

  elsif v_type = 'transport' then
    insert into public.transport_services (operation_id, provider, origin, destination, service_date, service_time, passenger, service_number, value, charge_amount, observations)
    values (v_id, v_provider, coalesce(d->>'origin', ''), coalesce(d->>'destination', ''), v_date, nullif(d->>'time', '')::time,
      coalesce(d->>'passenger', ''), coalesce(d->>'service_number', ''), v_amount, v_charge, v_obs);

  else
    insert into public.additional_services (operation_id, provider, description, service_date, invoice, value, charge_amount, observations)
    values (v_id, v_provider, coalesce(d->>'description', ''), v_date, v_invoice, v_amount, v_charge, v_obs);
  end if;

  -- Alerta de cobro: vuelos, préstamos y servicios adicionales con un valor a cobrar generan (o actualizan) una alerta pendiente.
  -- Fecha de referencia: la fecha de facturación del registro (invoice_date); si no existe, la fecha de creación. Vence al mes.
  -- No se duplica si otro registro del mismo grupo o con el mismo número de factura ya tiene alerta pendiente, ni se revive una ya cobrada.
  if v_type in ('flight', 'loan', 'additional', 'other') and coalesce(v_charge, 0) > 0 then
    v_due := (coalesce(nullif(d->>'invoice_date', '')::date, (select o2.created_at::date from public.operations o2 where o2.id = v_id)) + interval '1 month')::date;
    if exists (select 1 from public.invoice_alerts a where a.operation_id = v_id) then
      update public.invoice_alerts a set invoice_number = v_invoice, amount = v_charge, due_date = v_due
      where a.operation_id = v_id and a.status = 'pending';
    elsif not exists (
      select 1 from public.invoice_alerts a join public.operations o2 on o2.id = a.operation_id
      where a.status = 'pending'
        and ((v_invoice <> '' and a.invoice_number = v_invoice) or (v_group is not null and o2.group_id = v_group))
    ) then
      insert into public.invoice_alerts (operation_id, invoice_number, amount, due_date) values (v_id, v_invoice, v_charge, v_due);
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_operation(jsonb) from public, anon;
grant execute on function public.save_operation(jsonb) to authenticated;

-- 3c. Al registrar un movimiento bancario con un número de factura que coincide exactamente con una alerta
--     pendiente, la alerta se marca como cobrada y queda enlazada al movimiento.
create or replace function public.close_invoice_alert_on_payment() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if btrim(coalesce(new.invoice_number, '')) = '' then return new; end if;
  update public.invoice_alerts
  set status = 'paid', paid_at = now(), paid_movement_id = new.id
  where status = 'pending' and btrim(invoice_number) <> '' and lower(btrim(invoice_number)) = lower(btrim(new.invoice_number));
  return new;
end;
$$;
drop trigger if exists bank_movement_closes_alert on public.bank_movements;
create trigger bank_movement_closes_alert after insert or update of invoice_number on public.bank_movements
  for each row execute function public.close_invoice_alert_on_payment();

-- 4. Movimientos personales: tabla y adjuntos propios, separados de los movimientos de la agencia.
create table if not exists public.personal_movements (
  id uuid primary key default gen_random_uuid(),
  movement_date date not null,
  kind text not null check (kind in ('income', 'expense')),
  category text not null default '',
  description text not null default '',
  amount numeric(14,2) not null default 0,
  payment_method text not null default '',
  account text not null default '',
  beneficiary text not null default '',
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.personal_documents (
  id uuid primary key default gen_random_uuid(),
  personal_movement_id uuid not null references public.personal_movements(id) on delete cascade,
  name text not null,
  mime_type text,
  size bigint not null default 0,
  storage_path text not null,
  created_at timestamptz not null default now()
);
alter table public.personal_movements enable row level security;
alter table public.personal_documents enable row level security;
drop policy if exists personal_movements_authenticated_all on public.personal_movements;
create policy personal_movements_authenticated_all on public.personal_movements for all to authenticated using (true) with check (true);
drop policy if exists personal_documents_authenticated_all on public.personal_documents;
create policy personal_documents_authenticated_all on public.personal_documents for all to authenticated using (true) with check (true);
revoke all on public.personal_movements, public.personal_documents from anon;
grant select, insert, update, delete on public.personal_movements, public.personal_documents to authenticated;

-- 5. Eliminar un adjunto individual (documents / bank_documents / personal_documents). Devuelve la ruta de Storage
--    solo si ningún otro registro la sigue usando; el frontend la borra del bucket.
create or replace function public.delete_attachment(p_table text, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_path text;
  v_orphan boolean;
begin
  if p_table = 'documents' then
    delete from public.documents where id = p_id returning storage_path into v_path;
  elsif p_table = 'bank_documents' then
    delete from public.bank_documents where id = p_id returning storage_path into v_path;
  elsif p_table = 'personal_documents' then
    delete from public.personal_documents where id = p_id returning storage_path into v_path;
  else
    raise exception 'Tabla de adjuntos no permitida.';
  end if;
  if v_path is null then raise exception 'El archivo ya no existe. Actualiza e inténtalo de nuevo.'; end if;
  select not exists (select 1 from public.documents x where x.storage_path = v_path)
     and not exists (select 1 from public.bank_documents x where x.storage_path = v_path)
     and not exists (select 1 from public.personal_documents x where x.storage_path = v_path) into v_orphan;
  return jsonb_build_object('deleted', 1, 'storage_paths', case when v_orphan then to_jsonb(array[v_path]) else '[]'::jsonb end);
end;
$$;

-- 6. Eliminar un movimiento personal completo (los adjuntos caen en cascada; devuelve rutas huérfanas).
create or replace function public.delete_personal_movement(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_paths text[];
  v_orphans text[];
begin
  if not exists (select 1 from public.personal_movements where id = p_id) then
    raise exception 'El movimiento ya no existe. Actualiza e inténtalo de nuevo.';
  end if;
  select coalesce(array_agg(distinct storage_path), '{}'::text[]) into v_paths from public.personal_documents where personal_movement_id = p_id;
  delete from public.personal_movements where id = p_id;
  select coalesce(array_agg(p), '{}'::text[]) into v_orphans from unnest(v_paths) as p
  where not exists (select 1 from public.documents d where d.storage_path = p)
    and not exists (select 1 from public.bank_documents b where b.storage_path = p)
    and not exists (select 1 from public.personal_documents pd where pd.storage_path = p);
  return jsonb_build_object('deleted', 1, 'storage_paths', to_jsonb(v_orphans));
end;
$$;

revoke all on function public.delete_attachment(text, uuid), public.delete_personal_movement(uuid) from public, anon;
grant execute on function public.delete_attachment(text, uuid), public.delete_personal_movement(uuid) to authenticated;

-- 7. Backfill: crea la alerta pendiente para los registros YA existentes que tienen valor a cobrar
--    (una por factura o por grupo de reserva; nunca dos por lo mismo). Idempotente: no toca alertas que ya existan.
insert into public.invoice_alerts (operation_id, invoice_number, amount, due_date)
select t.id, t.invoice_number, t.charge_amount, t.due
from (
  select distinct on (coalesce(nullif(o.invoice_number, ''), o.group_id::text, o.id::text))
    o.id, o.invoice_number, o.charge_amount,
    (coalesce(ln.invoice_date, o.created_at::date) + interval '1 month')::date as due
  from public.operations o
  left join public.loans ln on ln.operation_id = o.id
  where o.type in ('flight', 'loan', 'additional', 'other') and coalesce(o.charge_amount, 0) > 0
    and not exists (select 1 from public.invoice_alerts a where a.operation_id = o.id)
  order by coalesce(nullif(o.invoice_number, ''), o.group_id::text, o.id::text), o.created_at
) t;

notify pgrst, 'reload schema';
