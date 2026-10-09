-- Aires y Destinos: operations_view + save_operation (adaptado al esquema real). Ejecutar completo en Supabase > SQL Editor. Es idempotente.

-- 0. operation_groups: el frontend muestra "G-001 · nombre"; se agrega code con secuencia
create sequence if not exists public.operation_group_seq;
alter table public.operation_groups add column if not exists code text;
update public.operation_groups set code = 'G-' || lpad(nextval('public.operation_group_seq')::text, 3, '0') where code is null;
alter table public.operation_groups alter column code set default ('G-' || lpad(nextval('public.operation_group_seq')::text, 3, '0'));
alter table public.operation_groups alter column code set not null;
create unique index if not exists operation_groups_code_key on public.operation_groups (code);
grant usage, select on sequence public.operation_group_seq to authenticated;

-- 0b. Vuelos/empresas: TA por empresa, TA con IVA, pasajeros con nombres y apellidos.
-- No se borra ni reinterpreta nada: full_name, vat_5 y national_ticket_without_19 quedan intactos (save_operation los conserva al editar); ta_vat vuelve a ser el "IVA incluido en TA".
alter table public.companies add column if not exists ta numeric(14,2);
alter table public.flights add column if not exists ta_with_vat numeric(14,2);
alter table public.passengers add column if not exists names text;
alter table public.passengers add column if not exists surnames text;
update public.passengers set names = full_name where names is null;
update public.passengers set surnames = '' where surnames is null;

-- 0c. Hoteles: TA con el mismo comportamiento que vuelos (columnas nuevas, nullable; no se toca nada existente).
alter table public.hotels add column if not exists ta numeric(14,2);
alter table public.hotels add column if not exists ta_without_vat numeric(14,2);
alter table public.hotels add column if not exists ta_with_vat numeric(14,2);
alter table public.hotels add column if not exists ta_vat numeric(14,2);

-- 0d. Hoteles: mismos conceptos de facturacion, comisiones e impuestos que vuelos (columnas nuevas, nullable).
alter table public.hotels add column if not exists total_invoice numeric(14,2);
alter table public.hotels add column if not exists third_party_commission numeric(14,2);
alter table public.hotels add column if not exists provider_profit numeric(14,2);
alter table public.hotels add column if not exists net_quotation_less_ta_vat numeric(14,2);

-- 1. operations_view
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
      'oc', ln.purchase_order, 'received', ln.received_at, 'requested_by', ln.requested_by, 'paid', ln.paid_at)
    when 'food' then jsonb_build_object(
      'requested_by', fs.requested_by, 'requested_item', fs.request_description, 'supplies_value', fs.supply_value, 'transport_value', fs.transport_value,
      'total_cost', coalesce(fs.total_cost, 0))
    when 'transport' then jsonb_build_object(
      'origin', ts.origin, 'destination', ts.destination, 'time', ts.service_time, 'passenger', ts.passenger, 'service_number', ts.service_number)
    else jsonb_build_object('description', ad.description)
  end as details
) d on true;

grant select on public.operations_view to authenticated;

-- 2. save_operation (atómica: una sola transacción por llamada)
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
      provider, charge_amount, observation)
    values (v_id, coalesce(d->>'request', ''), v_amount, v_invoice, nullif(d->>'invoice_date', '')::date, coalesce(d->>'cot', ''), nullif(d->>'sent', '')::date,
      nullif(d->>'charged_quoted_value', '')::numeric, nullif(d->>'iva', '')::numeric, coalesce(d->>'oc', ''), nullif(d->>'received', '')::date,
      coalesce(d->>'requested_by', ''), nullif(d->>'paid', '')::date, v_provider, v_charge, v_obs);

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

  return v_id;
end;
$$;

revoke all on function public.save_operation(jsonb) from public, anon;
grant execute on function public.save_operation(jsonb) to authenticated;

notify pgrst, 'reload schema';
