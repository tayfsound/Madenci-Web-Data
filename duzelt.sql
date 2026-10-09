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

-- Public form bu listeleri anonim kullanıcı olarak okuyabilmelidir.
drop policy if exists locations_select on public.locations;
drop policy if exists categories_select on public.categories;
drop policy if exists materials_select on public.materials;
drop policy if exists drilling_types_select on public.drilling_types;
drop policy if exists loaders_select on public.loaders;

create policy locations_select on public.locations
  for select to anon, authenticated
  using (true);

create policy categories_select on public.categories
  for select to anon, authenticated
  using (true);

create policy materials_select on public.materials
  for select to anon, authenticated
  using (true);

create policy drilling_types_select on public.drilling_types
  for select to anon, authenticated
  using (true);

create policy loaders_select on public.loaders
  for select to anon, authenticated
  using (true);

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

-- Admin hangi malzemede loder numarasının zorunlu olacağını seçebilir
alter table public.materials
  add column if not exists requires_loader boolean not null default false;

-- 4) Sonucu göster: her tabloda hangi izinler var
select tablename, cmd, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('categories','materials','locations')
order by tablename, cmd;
