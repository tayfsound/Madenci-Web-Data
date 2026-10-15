-- Private photos; existing entries and historical hours are preserved.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('loader-meter-photos','loader-meter-photos',false,2097152,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/jpeg'];

create table public.loader_meter_photos (
  id uuid primary key,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  object_path text generated always as (id::text || '.jpg') stored unique,
  status text not null default 'pending' check(status in ('pending','ready','deleting','deleted')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz,
  cleanup_retry_at timestamptz,
  check ((uploaded_at is null and expires_at is null) or (uploaded_at is not null and expires_at = uploaded_at + interval '3 months'))
);
create index loader_meter_created_idx on public.loader_meter_photos(created_at);
create index loader_meter_expiry_idx on public.loader_meter_photos(expires_at) where status='ready';
create index loader_meter_cleanup_idx on public.loader_meter_photos(cleanup_retry_at) where status='deleting';
alter table public.loader_meter_photos enable row level security;
revoke all on public.loader_meter_photos from anon,authenticated;
grant select on public.loader_meter_photos to authenticated;
grant all on public.loader_meter_photos to service_role;
create policy loader_meter_admin_read on public.loader_meter_photos for select to authenticated using ((select public.is_admin()));

-- The public portal cannot upload/read/delete objects directly. Uploads pass
-- through the bounded Edge Function; only the administrator can read live photos.
create policy loader_meter_admin_object_read on storage.objects for select to authenticated
using (bucket_id='loader-meter-photos' and (select public.is_admin()) and exists (
  select 1 from public.loader_meter_photos p where p.object_path=name
  and p.status='ready' and p.expires_at > now()));

-- Existing broad Storage policies must not expose this new private bucket.
create policy loader_meter_read_guard on storage.objects as restrictive for select to anon,authenticated
using (bucket_id<>'loader-meter-photos' or ((select public.is_admin()) and exists (
  select 1 from public.loader_meter_photos p where p.object_path=name and p.status='ready' and p.expires_at>now())));
create policy loader_meter_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check (bucket_id<>'loader-meter-photos');
create policy loader_meter_update_guard on storage.objects as restrictive for update to anon,authenticated
using (bucket_id<>'loader-meter-photos') with check (bucket_id<>'loader-meter-photos');
create policy loader_meter_delete_guard on storage.objects as restrictive for delete to anon,authenticated
using (bucket_id<>'loader-meter-photos');
-- New loder reports must use the validating service; other public forms are unchanged.
create policy loader_report_insert_guard on public.entries as restrictive for insert to anon,authenticated
with check (entry_type<>'loder');

create function public.reserve_loader_photo(p_id uuid,p_hash text) returns text
language plpgsql security invoker set search_path='' as $$
declare p public.loader_meter_photos;
begin
  -- A bounded global public-upload budget, independent of spoofable IP headers.
  perform pg_advisory_xact_lock(91327041);
  select * into p from public.loader_meter_photos where id=p_id;
  if found then
    if p.request_hash<>p_hash then raise exception 'Aynı kayıt kimliği farklı içerikle kullanılamaz.'; end if;
    if p.status not in ('pending','ready') then raise exception 'Fotoğraf kaydı kapandı. Yeni rapor açın.'; end if;
    return p.status;
  end if;
  if (select count(*) from public.loader_meter_photos where created_at>now()-interval '1 hour')>=120
    or (select count(*) from public.loader_meter_photos where created_at>now()-interval '1 day')>=1000 then
    raise exception 'Fotoğraf yükleme sınırına ulaşıldı. Daha sonra deneyin.';
  end if;
  insert into public.loader_meter_photos(id,request_hash) values(p_id,p_hash);
  return 'pending';
end;
$$;

create function public.commit_loader_photo(p_id uuid,p_hash text,p_report jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare photo public.loader_meter_photos; loc jsonb; loader_name text; stamp timestamptz:=now();
begin
  select * into photo from public.loader_meter_photos where id=p_id for update;
  if not found or photo.request_hash<>p_hash then raise exception 'Fotoğraf kaydı bulunamadı.'; end if;
  if photo.status='ready' then return; end if;
  if photo.status<>'pending' then raise exception 'Fotoğraf yükleme süresi doldu.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='loader-meter-photos' and name=photo.object_path) then
    raise exception 'Fotoğraf yüklenmedi.';
  end if;
  select name into loader_name from public.loaders where id::text=p_report->>'loader_id';
  if loader_name is null then raise exception 'Loder bulunamadı.'; end if;
  if length(trim(coalesce(p_report->>'first_name',''))) not between 1 and 120
    or length(trim(coalesce(p_report->>'last_name',''))) not between 1 and 120
    or coalesce(p_report->>'shift','') not in ('gunduz','gece')
    or coalesce(p_report->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or length(coalesce(p_report->>'description',''))>4000
    or jsonb_typeof(p_report->'locations') is distinct from 'array'
    or jsonb_array_length(p_report->'locations') not between 1 and 50 then raise exception 'Rapor alanları geçersiz.'; end if;
  for loc in select value from jsonb_array_elements(p_report->'locations') loop
    if not exists(select 1 from public.locations where name=loc->>'location') then raise exception 'Lokasyon bulunamadı.'; end if;
    if coalesce(loc->>'cevher_kovasi','') !~ '^[0-9]{1,7}$' or coalesce(loc->>'pasa_kovasi','') !~ '^[0-9]{1,7}$' then raise exception 'Kova sayıları geçersiz.'; end if;
    insert into public.entries(date,entry_type,location,details)
    values((p_report->>'date')::date,'loder',loc->>'location',jsonb_build_object(
      'first_name',p_report->>'first_name','last_name',p_report->>'last_name',
      'submission_id',p_id,'meter_photo_id',p_id,'loader_id',p_report->>'loader_id',
      'loader',loader_name,'shift',p_report->>'shift','description',coalesce(p_report->>'description',''),
      'cevher_kovasi',loc->>'cevher_kovasi','pasa_kovasi',loc->>'pasa_kovasi'));
  end loop;
  update public.loader_meter_photos set status='ready',uploaded_at=stamp,expires_at=stamp+interval '3 months' where id=p_id;
end;
$$;

-- Claim, then remove via Storage API. Never DELETE storage.objects in SQL.
-- Crashes retry after an hour; abandoned uploads are removed after 24 hours.
create function public.claim_loader_photo_cleanup() returns table(id uuid,object_path text)
language sql security invoker set search_path='' as $$
  with due as (
    select p.id from public.loader_meter_photos p where
      (p.status='ready' and p.expires_at<=now())
      or (p.status='pending' and p.created_at<=now()-interval '1 day')
      or (p.status='deleting' and p.cleanup_retry_at<=now())
    order by p.created_at limit 100 for update skip locked
  )
  update public.loader_meter_photos p set status='deleting',cleanup_retry_at=now()+interval '1 hour'
  from due where p.id=due.id returning p.id,p.object_path;
$$;
revoke all on function public.reserve_loader_photo(uuid,text),public.commit_loader_photo(uuid,text,jsonb),
 public.claim_loader_photo_cleanup() from public,anon,authenticated;
grant execute on function public.reserve_loader_photo(uuid,text),public.commit_loader_photo(uuid,text,jsonb),
 public.claim_loader_photo_cleanup() to service_role;
commit;
