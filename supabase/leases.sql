-- Aires y Destinos: módulo de Arrendamientos (operación inicial: SLB). Ejecutar completo en Supabase > SQL Editor.
-- Idempotente y NO destructivo: solo AGREGA tablas, vistas, funciones, triggers, políticas y un bucket privado. No toca ninguna tabla ni dato existente.
-- Requiere: public.set_updated_at() (ya existente), public.is_agency_user() (company_portal.sql) y public.bank_movements.
--
-- Modelo
--  * lease_operations -> lease_spaces (varios espacios por operación).
--  * lease_expenses (+ lease_expense_payments: pagos parciales sin sobrescribir el valor del gasto).
--  * lease_customer_invoices (+ lease_customer_payments): facturación mensual a clientes; recaudo = solo pagos registrados.
--  * lease_slb_payments: dinero que Aires y Destinos RECIBE de SLB (ingreso independiente; sin relación asumida con facturas de clientes).
--  * lease_attachments: archivos (bucket privado «lease-docs»); los borrados de archivos se encolan SIEMPRE en lease_cleanup (trigger).
--  * Conciliación bancaria opcional: bank_movement_id en los pagos; un mismo movimiento no puede vincularse dos veces.
--  * Los estados de pago (pendiente / parcial / pagado) se CALCULAN en vistas a partir de los pagos; nunca se guardan.

-- 1. Tablas -------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.lease_operations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lease_operations_name_uq on public.lease_operations (lower(btrim(name)));
insert into public.lease_operations (name, status) select 'SLB', 'active' where not exists (select 1 from public.lease_operations where lower(btrim(name)) = 'slb');

create table if not exists public.lease_spaces (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.lease_operations (id) on delete restrict,
  name text not null check (btrim(name) <> '' and char_length(name) <= 160),
  description text not null default '' check (char_length(description) <= 2000),
  location text not null default '' check (char_length(location) <= 300),
  start_date date,
  rent_amount numeric(14, 2) check (rent_amount is null or rent_amount >= 0),
  periodicity text not null default 'monthly' check (periodicity in ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lease_spaces_operation_idx on public.lease_spaces (operation_id);

create table if not exists public.lease_expenses (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.lease_operations (id) on delete restrict,
  space_id uuid references public.lease_spaces (id) on delete restrict,
  category text not null check (category in ('rent', 'cleaning', 'utilities', 'payroll', 'additional')),
  concept text not null check (btrim(concept) <> '' and char_length(concept) <= 400),
  beneficiary text not null default '' check (char_length(beneficiary) <= 200),
  amount numeric(14, 2) not null check (amount > 0),
  expense_date date not null,
  period date not null check (extract(day from period) = 1),
  due_date date,
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lease_expenses_op_period_idx on public.lease_expenses (operation_id, period);
create index if not exists lease_expenses_space_idx on public.lease_expenses (space_id);

create table if not exists public.lease_expense_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.lease_expenses (id) on delete cascade,
  paid_at date not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default '' check (char_length(method) <= 60),
  reference text not null default '' check (char_length(reference) <= 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  bank_movement_id uuid references public.bank_movements (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lease_expense_payments_expense_idx on public.lease_expense_payments (expense_id);

create table if not exists public.lease_customer_invoices (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.lease_operations (id) on delete restrict,
  space_id uuid references public.lease_spaces (id) on delete restrict,
  customer_name text not null check (btrim(customer_name) <> '' and char_length(customer_name) <= 200),
  invoice_number text not null check (btrim(invoice_number) <> '' and char_length(invoice_number) <= 60),
  issue_date date not null,
  period_year integer not null check (period_year between 2000 and 2100),
  period_month integer not null check (period_month between 1 and 12),
  due_date date,
  concept text not null default '' check (char_length(concept) <= 400),
  subtotal numeric(14, 2) check (subtotal is null or subtotal >= 0),
  tax numeric(14, 2) check (tax is null or tax >= 0),
  total numeric(14, 2) not null check (total > 0),
  status text not null default 'active' check (status in ('active', 'void')),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lease_invoices_number_uq on public.lease_customer_invoices (operation_id, lower(btrim(invoice_number)));
create index if not exists lease_invoices_period_idx on public.lease_customer_invoices (operation_id, period_year, period_month);
create index if not exists lease_invoices_space_idx on public.lease_customer_invoices (space_id);

create table if not exists public.lease_customer_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.lease_customer_invoices (id) on delete cascade,
  paid_at date not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default '' check (char_length(method) <= 60),
  reference text not null default '' check (char_length(reference) <= 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  bank_movement_id uuid references public.bank_movements (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lease_customer_payments_invoice_idx on public.lease_customer_payments (invoice_id);

create table if not exists public.lease_slb_payments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.lease_operations (id) on delete restrict,
  received_at date not null,
  period date not null check (extract(day from period) = 1),
  concept text not null check (btrim(concept) <> '' and char_length(concept) <= 400),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default '' check (char_length(method) <= 60),
  bank_account text not null default '' check (char_length(bank_account) <= 120),
  reference text not null default '' check (char_length(reference) <= 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  bank_movement_id uuid references public.bank_movements (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lease_slb_payments_op_idx on public.lease_slb_payments (operation_id, received_at);

create table if not exists public.lease_attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('space', 'expense', 'expense_payment', 'invoice', 'customer_payment', 'slb_payment')),
  entity_id uuid not null,
  kind text not null default 'other' check (kind in ('contract', 'invoice', 'receipt', 'payment_proof', 'payroll', 'other')),
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists lease_attachments_entity_idx on public.lease_attachments (entity_type, entity_id);

create table if not exists public.lease_cleanup (
  storage_path text primary key,
  created_at timestamptz not null default now()
);

-- Un movimiento bancario solo puede estar vinculado a UN pago (de cualquiera de las tres tablas)
create unique index if not exists lease_expense_payments_bank_uq on public.lease_expense_payments (bank_movement_id) where bank_movement_id is not null;
create unique index if not exists lease_customer_payments_bank_uq on public.lease_customer_payments (bank_movement_id) where bank_movement_id is not null;
create unique index if not exists lease_slb_payments_bank_uq on public.lease_slb_payments (bank_movement_id) where bank_movement_id is not null;

-- 2. Triggers: updated_at, adjuntos, integridad de pagos ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['lease_operations', 'lease_spaces', 'lease_expenses', 'lease_expense_payments', 'lease_customer_invoices', 'lease_customer_payments', 'lease_slb_payments']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- Al borrar un archivo (fila) se encola el borrado físico en Storage
create or replace function public.lease_enqueue_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lease_cleanup (storage_path) values (old.storage_path) on conflict do nothing;
  return old;
end;
$$;
drop trigger if exists lease_attachments_cleanup on public.lease_attachments;
create trigger lease_attachments_cleanup before delete on public.lease_attachments for each row execute function public.lease_enqueue_cleanup();

-- Al borrar un registro se borran sus adjuntos (lo que dispara el encolado anterior); también aplica a borrados en cascada
create or replace function public.lease_drop_attachments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.lease_attachments where entity_type = tg_argv[0] and entity_id = old.id;
  return old;
end;
$$;
drop trigger if exists lease_spaces_files on public.lease_spaces;
create trigger lease_spaces_files before delete on public.lease_spaces for each row execute function public.lease_drop_attachments('space');
drop trigger if exists lease_expenses_files on public.lease_expenses;
create trigger lease_expenses_files before delete on public.lease_expenses for each row execute function public.lease_drop_attachments('expense');
drop trigger if exists lease_expense_payments_files on public.lease_expense_payments;
create trigger lease_expense_payments_files before delete on public.lease_expense_payments for each row execute function public.lease_drop_attachments('expense_payment');
drop trigger if exists lease_invoices_files on public.lease_customer_invoices;
create trigger lease_invoices_files before delete on public.lease_customer_invoices for each row execute function public.lease_drop_attachments('invoice');
drop trigger if exists lease_customer_payments_files on public.lease_customer_payments;
create trigger lease_customer_payments_files before delete on public.lease_customer_payments for each row execute function public.lease_drop_attachments('customer_payment');
drop trigger if exists lease_slb_payments_files on public.lease_slb_payments;
create trigger lease_slb_payments_files before delete on public.lease_slb_payments for each row execute function public.lease_drop_attachments('slb_payment');

-- Un pago nunca puede superar el saldo pendiente; una factura anulada no admite pagos
create or replace function public.lease_check_payment() returns trigger
language plpgsql set search_path = public as $$
declare v_total numeric; v_paid numeric; v_status text;
begin
  if tg_table_name = 'lease_expense_payments' then
    select amount into v_total from public.lease_expenses where id = new.expense_id for update;
    select coalesce(sum(amount), 0) into v_paid from public.lease_expense_payments where expense_id = new.expense_id and id <> new.id;
  else
    select total, status into v_total, v_status from public.lease_customer_invoices where id = new.invoice_id for update;
    if v_status = 'void' then raise exception 'La factura está anulada: no admite pagos.'; end if;
    select coalesce(sum(amount), 0) into v_paid from public.lease_customer_payments where invoice_id = new.invoice_id and id <> new.id;
  end if;
  if v_paid + new.amount > v_total then
    raise exception 'El pago supera el saldo pendiente (saldo: %).', to_char(v_total - v_paid, 'FM999G999G999G990');
  end if;
  return new;
end;
$$;
drop trigger if exists lease_expense_payments_check on public.lease_expense_payments;
create trigger lease_expense_payments_check before insert or update of amount on public.lease_expense_payments for each row execute function public.lease_check_payment();
drop trigger if exists lease_customer_payments_check on public.lease_customer_payments;
create trigger lease_customer_payments_check before insert or update of amount on public.lease_customer_payments for each row execute function public.lease_check_payment();

-- No se puede bajar el valor de un gasto/factura por debajo de lo ya pagado, ni anular una factura con pagos
create or replace function public.lease_check_totals() returns trigger
language plpgsql set search_path = public as $$
declare v_paid numeric;
begin
  if tg_table_name = 'lease_expenses' then
    select coalesce(sum(amount), 0) into v_paid from public.lease_expense_payments where expense_id = new.id;
    if new.amount < v_paid then raise exception 'El valor no puede ser menor a lo ya pagado (%).', to_char(v_paid, 'FM999G999G999G990'); end if;
  else
    select coalesce(sum(amount), 0) into v_paid from public.lease_customer_payments where invoice_id = new.id;
    if new.total < v_paid then raise exception 'El total no puede ser menor a lo ya recibido (%).', to_char(v_paid, 'FM999G999G999G990'); end if;
    if new.status = 'void' and v_paid > 0 then raise exception 'No se puede anular una factura con pagos registrados: elimina primero los pagos.'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists lease_expenses_check on public.lease_expenses;
create trigger lease_expenses_check before update of amount on public.lease_expenses for each row execute function public.lease_check_totals();
drop trigger if exists lease_invoices_check on public.lease_customer_invoices;
create trigger lease_invoices_check before update of total, status on public.lease_customer_invoices for each row execute function public.lease_check_totals();

-- Un movimiento bancario no puede vincularse a dos pagos distintos (aunque sean de tablas diferentes)
create or replace function public.lease_check_bank_link() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.bank_movement_id is null then return new; end if;
  if exists (select 1 from public.lease_expense_payments where bank_movement_id = new.bank_movement_id and not (tg_table_name = 'lease_expense_payments' and id = new.id))
     or exists (select 1 from public.lease_customer_payments where bank_movement_id = new.bank_movement_id and not (tg_table_name = 'lease_customer_payments' and id = new.id))
     or exists (select 1 from public.lease_slb_payments where bank_movement_id = new.bank_movement_id and not (tg_table_name = 'lease_slb_payments' and id = new.id)) then
    raise exception 'Ese movimiento bancario ya está conciliado con otro pago.';
  end if;
  return new;
end;
$$;
drop trigger if exists lease_expense_payments_bank on public.lease_expense_payments;
create trigger lease_expense_payments_bank before insert or update of bank_movement_id on public.lease_expense_payments for each row execute function public.lease_check_bank_link();
drop trigger if exists lease_customer_payments_bank on public.lease_customer_payments;
create trigger lease_customer_payments_bank before insert or update of bank_movement_id on public.lease_customer_payments for each row execute function public.lease_check_bank_link();
drop trigger if exists lease_slb_payments_bank on public.lease_slb_payments;
create trigger lease_slb_payments_bank before insert or update of bank_movement_id on public.lease_slb_payments for each row execute function public.lease_check_bank_link();

revoke all on function public.lease_enqueue_cleanup(), public.lease_drop_attachments(), public.lease_check_payment(), public.lease_check_totals(), public.lease_check_bank_link() from public, anon, authenticated;

-- 3. Vistas con estados calculados (security_invoker: aplican el RLS del que consulta) ------------------------------------------------------------------
create or replace view public.lease_expenses_view with (security_invoker = true) as
select e.*, coalesce(p.paid, 0)::numeric(14, 2) as paid, (e.amount - coalesce(p.paid, 0))::numeric(14, 2) as balance, p.last_paid_at,
  case when coalesce(p.paid, 0) >= e.amount then 'paid' when coalesce(p.paid, 0) > 0 then 'partial' else 'pending' end as payment_status
from public.lease_expenses e
left join (select expense_id, sum(amount) as paid, max(paid_at) as last_paid_at from public.lease_expense_payments group by expense_id) p on p.expense_id = e.id;

create or replace view public.lease_invoices_view with (security_invoker = true) as
select i.*, coalesce(p.received, 0)::numeric(14, 2) as received, (i.total - coalesce(p.received, 0))::numeric(14, 2) as balance, p.last_paid_at,
  case when i.status = 'void' then 'void' when coalesce(p.received, 0) >= i.total then 'paid' when coalesce(p.received, 0) > 0 then 'partial' else 'pending' end as payment_status
from public.lease_customer_invoices i
left join (select invoice_id, sum(amount) as received, max(paid_at) as last_paid_at from public.lease_customer_payments group by invoice_id) p on p.invoice_id = i.id;

-- 4. RLS: solo personal de la agencia (permisiva) + política restrictiva que excluye a los administradores empresariales -------------------------------
do $$
declare t text;
begin
  foreach t in array array['lease_operations', 'lease_spaces', 'lease_expenses', 'lease_expense_payments', 'lease_customer_invoices', 'lease_customer_payments', 'lease_slb_payments', 'lease_attachments', 'lease_cleanup']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists agency_all on public.%I', t);
    execute format('create policy agency_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists agency_only on public.%I', t);
    execute format('create policy agency_only on public.%I as restrictive for all to authenticated using ((select public.is_agency_user())) with check ((select public.is_agency_user()))', t);
  end loop;
end $$;
grant select, insert, update, delete on public.lease_operations, public.lease_spaces, public.lease_expenses, public.lease_expense_payments,
  public.lease_customer_invoices, public.lease_customer_payments, public.lease_slb_payments, public.lease_attachments to authenticated;
grant select, delete on public.lease_cleanup to authenticated;
grant select on public.lease_expenses_view, public.lease_invoices_view to authenticated;
revoke all on public.lease_expenses_view, public.lease_invoices_view from anon;

-- 5. Storage: bucket privado propio ---------------------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lease-docs', 'lease-docs', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
drop policy if exists lease_storage_select on storage.objects;
create policy lease_storage_select on storage.objects for select to authenticated using (bucket_id = 'lease-docs');
drop policy if exists lease_storage_insert on storage.objects;
create policy lease_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'lease-docs');
drop policy if exists lease_storage_delete on storage.objects;
create policy lease_storage_delete on storage.objects for delete to authenticated using (bucket_id = 'lease-docs');

notify pgrst, 'reload schema';

-- Reversión (solo módulo nuevo): drop view public.lease_invoices_view, public.lease_expenses_view; drop table public.lease_cleanup, public.lease_attachments,
--   public.lease_slb_payments, public.lease_customer_payments, public.lease_customer_invoices, public.lease_expense_payments, public.lease_expenses,
--   public.lease_spaces, public.lease_operations cascade;
