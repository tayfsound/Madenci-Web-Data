-- =====================================================================
-- Günlük Raporlama Sistemi — Supabase şema + RLS kurulumu
-- Supabase panelinde SQL Editor'e yapıştırıp çalıştır. Tekrar tekrar
-- çalıştırılabilir (idempotent).
-- =====================================================================

-- ---------- TABLOLAR ----------

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- DİKKAT: user_id, auth.users'a değil profiles'a bakmalı. Kodun admin
-- ekranı entries'i profiles(full_name) ile join'liyor; PostgREST bu
-- join'i ancak aradaki foreign key sayesinde çözebiliyor.
create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  date       date not null,
  entry_type text not null check (entry_type in ('drilling','material','ore')),
  location   text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists entries_user_id_idx on public.entries(user_id);
create index if not exists entries_date_idx    on public.entries(date desc);

-- Malzeme kategorileri ve adları
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references public.categories(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists materials_category_idx on public.materials(category_id);

-- Lokasyonlar
create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- Delgi tipleri (Ayna, Tavan, Bypass ...)
-- fields: bu tipin formda hangi alanları isteyeceği. Alan anahtarları
-- index.html içindeki DELGI_ALANLARI kataloğuyla eşleşir; sabit tutulmaları
-- raporların geçmiş kayıtları da toplayabilmesi için şart.
-- örn: '["sira_no","delik_sayisi","metre"]'
create table if not exists public.drilling_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  fields     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Kategori, malzeme, lokasyon ve delgi tipleri admin panelinden yönetiliyor;
-- buraya örnek veri konmuyor. Aksi halde dosya her çalıştırıldığında
-- panelden silinmiş kayıtlar geri gelir.

-- ---------- KAYIT OLUNCA PROFİL AÇ ----------
-- Kodda profiles'a hiçbir yerde insert yok, sadece okuma var. Profil
-- satırını bu trigger açmazsa admin kontrolü hiç çalışmaz.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger'dan önce açılmış hesaplar için eksik profilleri tamamla
insert into public.profiles (id, full_name)
select u.id, u.raw_user_meta_data->>'full_name'
from auth.users u
on conflict (id) do nothing;

-- ---------- ADMIN KONTROLÜ ----------
-- profiles üzerindeki policy'nin içinden profiles'ı sorgulamak sonsuz
-- döngü yaratır; security definer fonksiyon bunu kırar.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;


alter table public.categories     enable row level security;
alter table public.locations      enable row level security;
alter table public.materials      enable row level security;
alter table public.drilling_types enable row level security;

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.entries  enable row level security;

drop policy if exists profiles_select_own   on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_own   on public.profiles;

-- Herkes kendi profilini görür
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Admin herkesinkini görür (admin ekranındaki isim sütunu için şart)
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

-- Kendi adını değiştirebilir; is_admin'i kendine veremez
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid()));

drop policy if exists entries_select on public.entries;
drop policy if exists entries_insert on public.entries;
drop policy if exists entries_update on public.entries;
drop policy if exists entries_delete on public.entries;

-- Kategoriler ve malzemeler herkese açık (okunabilir), admin yazabilir
drop policy if exists categories_select on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists materials_select   on public.materials;
drop policy if exists materials_insert   on public.materials;

drop policy if exists locations_select on public.locations;
drop policy if exists locations_insert on public.locations;

create policy locations_select on public.locations
  for select to authenticated
  using (true);

create policy locations_insert on public.locations
  for insert to authenticated
  with check (public.is_admin());

create policy locations_delete on public.locations
  for delete to authenticated
  using (public.is_admin());

-- Delgi tipleri: herkes okur, yalnızca admin yazar. Alan listesi
-- değiştirilebildiği için burada update politikası da gerekiyor.
drop policy if exists drilling_types_select on public.drilling_types;
drop policy if exists drilling_types_insert on public.drilling_types;
drop policy if exists drilling_types_update on public.drilling_types;
drop policy if exists drilling_types_delete on public.drilling_types;

create policy drilling_types_select on public.drilling_types
  for select to authenticated
  using (true);

create policy drilling_types_insert on public.drilling_types
  for insert to authenticated
  with check (public.is_admin());

create policy drilling_types_update on public.drilling_types
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy drilling_types_delete on public.drilling_types
  for delete to authenticated
  using (public.is_admin());

create policy categories_select on public.categories
  for select to authenticated
  using (true);

create policy categories_insert on public.categories
  for insert to authenticated
  with check (public.is_admin());

create policy categories_delete on public.categories
  for delete to authenticated
  using (public.is_admin());

create policy materials_select on public.materials
  for select to authenticated
  using (true);

create policy materials_insert on public.materials
  for insert to authenticated
  with check (public.is_admin());

create policy materials_delete on public.materials
  for delete to authenticated
  using (public.is_admin());

create policy entries_select on public.entries
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Başkasının adına kayıt girilmesini engeller
create policy entries_insert on public.entries
  for insert to authenticated
  with check (user_id = auth.uid());

create policy entries_update on public.entries
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy entries_delete on public.entries
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- KENDİNİ ADMIN YAP ----------
-- Kayıt olduktan SONRA, kendi email'inle çalıştır:
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'emreturkes@gmail.com');
