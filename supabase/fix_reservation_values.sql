-- Aires y Destinos: corrección ÚNICA de reservas guardadas con el valor completo repetido en cada pasajero.
-- Ejecutar UNA sola vez en Supabase > SQL Editor. Queda marcado en public.data_fixes y una segunda ejecución no hace nada.
--
-- Solo corrige una reserva (mismo código de reserva, 2 o más registros) si TODO esto se cumple, es decir, si es seguro que quedó duplicada:
--   * todos los registros tienen exactamente el mismo valor TKT, el mismo valor a cobrar y el mismo total factura;
--   * valor a cobrar = valor TKT x 1,30 (redondeado) y total factura = valor a cobrar (los valores sugeridos sin editar);
--   * ninguno tiene comisión de terceros ni ganancia proveedor;
--   * cada registro tiene exactamente un pasajero (la cantidad de pasajeros reales = la cantidad de registros).
-- Cualquier otra reserva se deja intacta. Cada total se reparte en pesos enteros entre los pasajeros y la suma vuelve a ser el total original.
--
-- VISTA PREVIA (solo lectura): ejecuta esto antes para ver qué reservas se corregirían:
--   select lower(btrim(f.booking_code)) as reserva, count(*) as registros, max(f.ticket_value_with_taxes_ta_fee) as valor_tkt, max(o.charge_amount) as a_cobrar
--   from public.flights f join public.operations o on o.id = f.operation_id
--   where btrim(coalesce(f.booking_code, '')) <> '' group by 1
--   having count(*) > 1 and bool_and(f.ticket_value_with_taxes_ta_fee > 0) and count(distinct f.ticket_value_with_taxes_ta_fee) = 1 and count(distinct o.charge_amount) = 1
--      and bool_and(o.charge_amount = round(f.ticket_value_with_taxes_ta_fee * 1.3)) and bool_and(f.total_invoice is not distinct from o.charge_amount)
--      and bool_and(f.third_party_commission is null and f.provider_profit is null);

create table if not exists public.data_fixes (
  name text primary key,
  applied_at timestamptz not null default now(),
  details jsonb not null default '[]'::jsonb
);
alter table public.data_fixes enable row level security;
revoke all on public.data_fixes from anon, authenticated;

do $$
declare
  g record;
  v_log jsonb := '[]'::jsonb;
  v_n int; v_pax int; i int;
  v_tkt numeric; v_charge numeric;
  v_t_base numeric; v_t_rem int; v_c_base numeric; v_c_rem int;
  v_id uuid; r record;
  v_new_tkt numeric; v_new_charge numeric; v_sum_tkt numeric; v_sum_charge numeric;
begin
  if exists (select 1 from public.data_fixes where name = 'split_reservation_values_v1') then
    raise notice 'Esta corrección ya se aplicó antes. No se hizo nada.';
    return;
  end if;

  for g in
    select lower(btrim(f.booking_code)) as code,
           array_agg(f.operation_id order by o.created_at, f.operation_id) as ids,
           count(*)::int as records,
           max(f.ticket_value_with_taxes_ta_fee) as tkt,
           max(o.charge_amount) as charge
    from public.flights f join public.operations o on o.id = f.operation_id
    where btrim(coalesce(f.booking_code, '')) <> ''
    group by lower(btrim(f.booking_code))
    having count(*) > 1
       and bool_and(f.ticket_value_with_taxes_ta_fee > 0)
       and count(distinct f.ticket_value_with_taxes_ta_fee) = 1
       and count(distinct o.charge_amount) = 1
       and bool_and(o.charge_amount = round(f.ticket_value_with_taxes_ta_fee * 1.3))
       and bool_and(f.total_invoice is not distinct from o.charge_amount)
       and bool_and(f.third_party_commission is null and f.provider_profit is null)
  loop
    select count(*) into v_pax from public.passengers where flight_id = any(g.ids);
    if v_pax <> g.records then
      raise notice 'Reserva % omitida: % registros pero % pasajeros (ambiguo).', g.code, g.records, v_pax;
      continue;
    end if;

    v_n := g.records; v_tkt := g.tkt; v_charge := g.charge;
    v_t_base := floor(v_tkt / v_n); v_t_rem := (v_tkt - v_t_base * v_n)::int;
    v_c_base := floor(v_charge / v_n); v_c_rem := (v_charge - v_c_base * v_n)::int;
    v_sum_tkt := 0; v_sum_charge := 0;

    for i in 1..v_n loop
      v_id := g.ids[i];
      v_new_tkt := v_t_base + case when i <= v_t_rem then 1 else 0 end;
      v_new_charge := v_c_base + case when i <= v_c_rem then 1 else 0 end;
      select f.net_quotation_less_ta_vat as net, f.ta, f.total_invoice into r from public.flights f where f.operation_id = v_id;

      update public.flights set
        ticket_value_with_taxes_ta_fee = v_new_tkt,
        total_invoice = v_new_charge,
        -- el valor neto solo se recalcula si seguía la fórmula automática (total factura - TA); si se editó a mano se deja igual
        net_quotation_less_ta_vat = case when r.net is not distinct from round(r.total_invoice - coalesce(r.ta, 0)) then round(v_new_charge - coalesce(r.ta, 0)) else r.net end
      where operation_id = v_id;
      update public.operations set amount = v_new_tkt, charge_amount = v_new_charge where id = v_id;

      v_sum_tkt := v_sum_tkt + v_new_tkt; v_sum_charge := v_sum_charge + v_new_charge;
    end loop;

    if v_sum_tkt <> v_tkt or v_sum_charge <> v_charge then
      raise exception 'La suma repartida no coincide con el total de la reserva %. Se cancela toda la corrección.', g.code;
    end if;
    v_log := v_log || jsonb_build_object('reserva', g.code, 'pasajeros', v_n, 'valor_tkt_total', v_tkt, 'total_factura_total', v_charge);
  end loop;

  insert into public.data_fixes (name, details) values ('split_reservation_values_v1', v_log);
  raise notice 'Reservas corregidas: %', v_log;
end;
$$;
