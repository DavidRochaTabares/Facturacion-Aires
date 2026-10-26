-- Corrección de alertas de cobro en vuelos.
-- Causas corregidas:
--  1. La alerta usaba charge_amount (valor sugerido); en vuelos el valor pendiente real es details.total_invoice
--     (o charge_amount si aún no hay total de factura).
--  2. La fecha de referencia era solo invoice_date (que los vuelos no tienen): ahora es
--     invoice_date -> fecha del registro (operation_date) -> fecha de creación, + 1 mes.
--  3. Reservas con varios pasajeros y sin número de factura generaban una alerta por pasajero:
--     ahora también se deduplica por código de reserva (booking_code).
-- Idempotente: recrea save_operation y sanea las alertas pendientes existentes.

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
  v_alert numeric;
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

  -- Alerta de cobro: vuelos, préstamos y servicios adicionales con un valor pendiente generan (o actualizan) una alerta.
  -- Valor de la alerta: en vuelos el total de la factura (total_invoice); si aún no se diligencia, el valor a cobrar.
  -- Fecha de referencia: fecha de facturación (invoice_date) -> fecha del registro -> fecha de creación. Vence al mes.
  -- No se duplica si otro registro con la misma factura, el mismo grupo o el mismo código de reserva ya tiene alerta pendiente,
  -- ni se revive una ya cobrada.
  v_alert := case when v_type = 'flight'
    then coalesce(nullif(d->>'total_invoice', '')::numeric, v_charge)
    else v_charge end;
  if v_type in ('flight', 'loan', 'additional', 'other') and coalesce(v_alert, 0) > 0 then
    v_due := (coalesce(nullif(d->>'invoice_date', '')::date, v_date, (select o2.created_at::date from public.operations o2 where o2.id = v_id)) + interval '1 month')::date;
    if exists (select 1 from public.invoice_alerts a where a.operation_id = v_id) then
      update public.invoice_alerts a set invoice_number = v_invoice, amount = v_alert, due_date = v_due
      where a.operation_id = v_id and a.status = 'pending';
    elsif not exists (
      select 1 from public.invoice_alerts a
      join public.operations o2 on o2.id = a.operation_id
      left join public.flights fa on fa.operation_id = o2.id
      where a.status = 'pending'
        and ((v_invoice <> '' and a.invoice_number = v_invoice)
          or (v_group is not null and o2.group_id = v_group)
          or (v_type = 'flight' and btrim(coalesce(d->>'booking_code', '')) <> ''
              and lower(btrim(fa.booking_code)) = lower(btrim(d->>'booking_code'))))
    ) then
      insert into public.invoice_alerts (operation_id, invoice_number, amount, due_date) values (v_id, v_invoice, v_alert, v_due);
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_operation(jsonb) from public, anon;
grant execute on function public.save_operation(jsonb) to authenticated;

-- 1. Quita duplicados pendientes de vuelos por mismo código de reserva (queda la más antigua).
delete from public.invoice_alerts a
using public.operations oa, public.flights fa,
      public.invoice_alerts b, public.operations ob, public.flights fb
where a.operation_id = oa.id and fa.operation_id = oa.id and oa.type = 'flight'
  and b.operation_id = ob.id and fb.operation_id = ob.id and ob.type = 'flight'
  and a.status = 'pending' and b.status = 'pending'
  and a.id <> b.id and a.created_at > b.created_at
  and btrim(fa.booking_code) <> '' and lower(btrim(fa.booking_code)) = lower(btrim(fb.booking_code))
  and (btrim(oa.invoice_number) = '' or btrim(ob.invoice_number) = '' or oa.invoice_number = ob.invoice_number);

-- 2. Corrige valor y fecha de las alertas pendientes de vuelos ya creadas.
update public.invoice_alerts a
set amount = coalesce(fl.total_invoice, o.charge_amount),
    due_date = (coalesce(o.operation_date, o.created_at::date) + interval '1 month')::date
from public.operations o
join public.flights fl on fl.operation_id = o.id
where a.operation_id = o.id and a.status = 'pending' and o.type = 'flight';

-- 3. Backfill: crea la alerta para registros existentes sin ella (dedup por factura, reserva o grupo).
insert into public.invoice_alerts (operation_id, invoice_number, amount, due_date)
select t.id, t.invoice_number, t.amount, t.due
from (
  select distinct on (coalesce(nullif(o.invoice_number, ''), nullif(fl.booking_code, ''), o.group_id::text, o.id::text))
    o.id, o.invoice_number,
    coalesce(fl.total_invoice, o.charge_amount) as amount,
    (coalesce(ln.invoice_date, o.operation_date, o.created_at::date) + interval '1 month')::date as due
  from public.operations o
  left join public.loans ln on ln.operation_id = o.id
  left join public.flights fl on fl.operation_id = o.id
  where o.type in ('flight', 'loan', 'additional', 'other')
    and coalesce(case when o.type = 'flight' then fl.total_invoice else o.charge_amount end, o.charge_amount, 0) > 0
    and not exists (select 1 from public.invoice_alerts a where a.operation_id = o.id)
  order by coalesce(nullif(o.invoice_number, ''), nullif(fl.booking_code, ''), o.group_id::text, o.id::text), o.created_at
) t;

notify pgrst, 'reload schema';
