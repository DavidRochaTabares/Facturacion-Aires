-- Aires y Destinos: catálogos independientes de PROVEEDORES y TARJETAS. Ejecutar completo en Supabase > SQL Editor. Es idempotente y no toca ninguna tabla existente.
--
-- Antes de ejecutar, comprueba que no exista una estructura equivalente (debe devolver 0 filas):
--   select table_name from information_schema.tables where table_schema = 'public' and table_name in ('suppliers', 'payment_cards');
--
-- Los dos catálogos NO tienen relación entre sí. Los registros (operations / flights) siguen guardando el proveedor y la tarjeta como TEXTO
-- (operations.provider, flights.card_number): es una copia del valor elegido, así que borrar, desactivar o renombrar un elemento
-- NUNCA altera los registros históricos. Tarjetas: solo alias y últimos 4 dígitos (sin número completo, CVV, PIN ni credenciales).
--
-- Si ya habías ejecutado la versión anterior de este archivo (con la tabla supplier_cards enlazada a proveedores), esa tabla queda sin uso.
-- Cuando confirmes que está vacía puedes quitarla tú mismo con:  drop table public.supplier_cards;   (este script no la borra).

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  nit text not null default '',
  contact text not null default '',
  email text not null default '',
  phone text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists suppliers_name_key on public.suppliers (lower(btrim(name)));

create table if not exists public.payment_cards (
  id uuid primary key default gen_random_uuid(),
  alias text not null check (btrim(alias) <> ''),
  last_four text not null check (last_four ~ '^[0-9]{4}$'),
  bank text not null default '',
  holder text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_cards_unique_key on public.payment_cards (lower(btrim(alias)), last_four);

-- updated_at automático
create or replace function public.suppliers_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists suppliers_touch on public.suppliers;
create trigger suppliers_touch before update on public.suppliers for each row execute function public.suppliers_touch_updated_at();
drop trigger if exists payment_cards_touch on public.payment_cards;
create trigger payment_cards_touch before update on public.payment_cards for each row execute function public.suppliers_touch_updated_at();

-- Texto que se guarda en flights.card_number al elegir una tarjeta: "alias ****1234" (el frontend usa el mismo formato)
create or replace function public.payment_card_label(p_alias text, p_last_four text) returns text
language sql immutable as $$ select btrim(p_alias) || ' ****' || p_last_four $$;

-- RLS: solo usuarios autenticados
alter table public.suppliers enable row level security;
alter table public.payment_cards enable row level security;
drop policy if exists suppliers_authenticated_all on public.suppliers;
create policy suppliers_authenticated_all on public.suppliers for all to authenticated using (true) with check (true);
drop policy if exists payment_cards_authenticated_all on public.payment_cards;
create policy payment_cards_authenticated_all on public.payment_cards for all to authenticated using (true) with check (true);
revoke all on public.suppliers, public.payment_cards from anon;
grant select, insert, update, delete on public.suppliers, public.payment_cards to authenticated;

-- Eliminación segura: si el elemento aparece en algún registro se DESACTIVA (deja de salir en los desplegables); si no, se borra.
create or replace function public.delete_supplier(p_id uuid) returns text
language plpgsql security invoker set search_path = public as $$
declare v_name text; v_used boolean;
begin
  select name into v_name from public.suppliers where id = p_id;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  select exists (select 1 from public.operations o where lower(btrim(o.provider)) = lower(btrim(v_name))) into v_used;
  if v_used then
    update public.suppliers set is_active = false where id = p_id;
    return 'deactivated';
  end if;
  delete from public.suppliers where id = p_id;
  return 'deleted';
end;
$$;

create or replace function public.delete_payment_card(p_id uuid) returns text
language plpgsql security invoker set search_path = public as $$
declare v_label text; v_used boolean;
begin
  select public.payment_card_label(alias, last_four) into v_label from public.payment_cards where id = p_id;
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  select exists (select 1 from public.flights f where lower(btrim(f.card_number)) = lower(v_label)) into v_used;
  if v_used then
    update public.payment_cards set is_active = false where id = p_id;
    return 'deactivated';
  end if;
  delete from public.payment_cards where id = p_id;
  return 'deleted';
end;
$$;

revoke all on function public.delete_supplier(uuid), public.delete_payment_card(uuid) from public, anon;
grant execute on function public.delete_supplier(uuid), public.delete_payment_card(uuid) to authenticated;
grant execute on function public.payment_card_label(text, text) to authenticated;

notify pgrst, 'reload schema';
