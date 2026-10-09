-- Aires y Destinos: service_report (alimenta Dashboard, Reportes y la columna "Registros" de Empresas).
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente. Solo lee operaciones de servicios (NO movimientos bancarios).

create or replace function public.service_report(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with f as (
    select
      o.type,
      o.company_id,
      c.name as company_name,
      coalesce(nullif(btrim(o.provider), ''), '—') as provider_label,
      coalesce(o.amount, 0) as amount,
      coalesce(o.charge_amount, 0) as charge,
      o.operation_date as op_date
    from public.operations o
    join public.companies c on c.id = o.company_id
    left join public.flights fl on fl.operation_id = o.id
    where (nullif(p->>'company_id', '') is null or o.company_id = (p->>'company_id')::uuid)
      and (nullif(p->>'type', '') is null or o.type = (p->>'type')::public.operation_type or (p->>'type' = 'additional' and o.type = 'other'))
      and (nullif(p->>'provider', '') is null or o.provider = p->>'provider' or fl.airline = p->>'provider')
      and (nullif(p->>'date_from', '') is null or o.operation_date >= (p->>'date_from')::date)
      and (nullif(p->>'date_to', '') is null or o.operation_date <= (p->>'date_to')::date)
  )
  select jsonb_build_object(
    'total_operations', (select count(*) from f),
    'total_cost', (select coalesce(sum(amount), 0) from f),
    'total_charge', (select coalesce(sum(charge), 0) from f),
    'average', (select case when count(*) = 0 then 0 else round(sum(amount) / count(*)) end from f),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'label', k, 'count', n, 'amount', a) order by a desc, k)
      from (select (case when type = 'other' then 'additional' else type::text end) as k, count(*) as n, sum(amount) as a from f group by 1) t
    ), '[]'::jsonb),
    'by_company', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'label', l, 'count', n, 'amount', a) order by a desc, l)
      from (select company_id::text as k, company_name as l, count(*) as n, sum(amount) as a from f group by company_id, company_name) t
    ), '[]'::jsonb),
    'by_provider', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'label', k, 'count', n, 'amount', a) order by a desc, k)
      from (select provider_label as k, count(*) as n, sum(amount) as a from f group by provider_label) t
    ), '[]'::jsonb),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'label', k, 'count', n, 'amount', a) order by k)
      from (select to_char(op_date, 'YYYY-MM') as k, count(*) as n, sum(amount) as a from f where op_date is not null group by 1) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.service_report(jsonb) from public, anon;
grant execute on function public.service_report(jsonb) to authenticated;

notify pgrst, 'reload schema';
