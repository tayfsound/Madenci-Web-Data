-- =====================================================================
-- Eksik locations tablosu + üç tablonun silme politikaları
-- Supabase SQL Editor'e olduğu gibi yapıştır ve çalıştır.
-- Tekrar çalıştırılabilir, mevcut veriye zarar vermez.
-- =====================================================================

-- 1) Eksik tablo
create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.locations enable row level security;

-- 2) locations için okuma/ekleme politikaları
drop policy if exists locations_select on public.locations;
drop policy if exists locations_insert on public.locations;

create policy locations_select on public.locations
  for select to authenticated
  using (true);

create policy locations_insert on public.locations
  for insert to authenticated
  with check (public.is_admin());

-- 3) Üç tablo için silme politikaları — eksik olan asıl parça buydu
drop policy if exists categories_delete on public.categories;
drop policy if exists materials_delete  on public.materials;
drop policy if exists locations_delete  on public.locations;

create policy categories_delete on public.categories
  for delete to authenticated
  using (public.is_admin());

create policy materials_delete on public.materials
  for delete to authenticated
  using (public.is_admin());

create policy locations_delete on public.locations
  for delete to authenticated
  using (public.is_admin());

-- 4) Sonucu göster: her tabloda hangi izinler var
select tablename, cmd, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('categories','materials','locations')
order by tablename, cmd;
