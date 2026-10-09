-- Aires y Destinos: movimientos bancarios (category + bank_report).
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente. No toca operaciones ni enums.

-- 1. category: texto libre que escribe la usuaria en "Tipo de movimiento". movement_type (enum) queda como naturaleza interna.
alter table public.bank_movements add column if not exists category text not null default '';

-- 2. bank_report: alimenta la página de movimientos y la tarjeta bancaria del Dashboard (solo lee bank_movements).
create or replace function public.bank_report(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select
      m.amount,
      m.movement_date,
      coalesce(nullif(btrim(m.category), ''),
        case m.movement_type when 'income' then 'Ingreso' when 'expense' then 'Egreso' when 'transfer' then 'Transferencia' else 'Otro' end) as label,
      lower(concat_ws(' ', m.description, m.beneficiary, m.category, m.reference_1, m.reference_2, m.reference_3, m.observation)) as hay
    from public.bank_movements m
  ),
  f as (
    select * from b
    where (nullif(p->>'movement_type', '') is null or label = p->>'movement_type')
      and (nullif(p->>'date_from', '') is null or movement_date >= (p->>'date_from')::date)
      and (nullif(p->>'date_to', '') is null or movement_date <= (p->>'date_to')::date)
      and (nullif(btrim(p->>'search'), '') is null or position(lower(btrim(p->>'search')) in hay) > 0)
  )
  select jsonb_build_object(
    'count', (select count(*) from f),
    'total_amount', (select coalesce(sum(amount), 0) from f),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('key', label, 'label', label, 'count', n, 'amount', a) order by a desc, label)
      from (select label, count(*) as n, sum(amount) as a from f group by label) t
    ), '[]'::jsonb),
    'last_date', (select max(movement_date) from f)
  );
$$;

revoke all on function public.bank_report(jsonb) from public, anon;
grant execute on function public.bank_report(jsonb) to authenticated;

notify pgrst, 'reload schema';
