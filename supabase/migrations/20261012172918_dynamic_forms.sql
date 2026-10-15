-- Additive migration: existing entries, forms and policies are not changed.
begin;

create table public.mf_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  current_version_id uuid,
  created_at timestamptz not null default now()
);
create table public.mf_drafts (
  form_id uuid primary key references public.mf_forms(id) on delete cascade,
  definition jsonb not null,
  revision integer not null default 1 check (revision > 0)
);
create table public.mf_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.mf_forms(id),
  version integer not null check (version > 0),
  definition jsonb not null,
  created_at timestamptz not null default now(),
  unique(form_id, version),
  unique(form_id, id)
);
alter table public.mf_forms add constraint mf_current_version_fk
  foreign key(id, current_version_id) references public.mf_versions(form_id, id);

create table public.mf_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 120),
  active boolean not null default true
);
create table public.mf_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.mf_lists(id),
  label text not null check (length(trim(label)) between 1 and 120),
  kind text not null default '' check (length(kind) <= 120),
  active boolean not null default true,
  unique(list_id, label)
);
create table public.mf_submissions (
  id uuid primary key, -- client-generated retry identity
  version_id uuid not null references public.mf_versions(id),
  answers jsonb not null,
  created_at timestamptz not null default now()
);
create index mf_submissions_version_date_idx on public.mf_submissions(version_id, created_at desc);
create index mf_submissions_answers_idx on public.mf_submissions using gin(answers jsonb_path_ops);

-- Only public list data belongs here; never add private personnel details.
alter table public.mf_forms enable row level security;
alter table public.mf_drafts enable row level security;
alter table public.mf_versions enable row level security;
alter table public.mf_lists enable row level security;
alter table public.mf_items enable row level security;
alter table public.mf_submissions enable row level security;
revoke all on public.mf_forms, public.mf_drafts, public.mf_versions,
  public.mf_lists, public.mf_items, public.mf_submissions from anon, authenticated;
grant select on public.mf_forms, public.mf_versions, public.mf_lists, public.mf_items to anon, authenticated;
grant select, insert, update, delete on public.mf_forms, public.mf_drafts to authenticated;
grant insert on public.mf_versions to authenticated;
grant insert, update on public.mf_lists, public.mf_items to authenticated;
grant insert on public.mf_submissions to anon, authenticated;
grant select on public.mf_submissions to authenticated;

create policy mf_forms_read on public.mf_forms for select to anon, authenticated
  using (status = 'published' or (select public.is_admin()));
create policy mf_forms_admin on public.mf_forms for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy mf_drafts_admin on public.mf_drafts for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- All immutable published versions remain readable while the form is live.
-- This avoids a policy cycle through current_version_id.
create policy mf_versions_read on public.mf_versions for select to anon, authenticated
  using ((select public.is_admin()) or exists (
    select 1 from public.mf_forms f where f.id = form_id and f.status = 'published'));
create policy mf_versions_insert on public.mf_versions for insert to authenticated
  with check ((select public.is_admin()));
create policy mf_lists_read on public.mf_lists for select to anon, authenticated
  using (active or (select public.is_admin()));
create policy mf_lists_insert on public.mf_lists for insert to authenticated
  with check ((select public.is_admin()));
create policy mf_lists_update on public.mf_lists for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy mf_items_read on public.mf_items for select to anon, authenticated
  using ((select public.is_admin()) or (active and exists (
    select 1 from public.mf_lists l where l.id = list_id and l.active)));
create policy mf_items_insert on public.mf_items for insert to authenticated
  with check ((select public.is_admin()));
create policy mf_items_update on public.mf_items for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy mf_submissions_read on public.mf_submissions for select to authenticated
  using ((select public.is_admin()));
create policy mf_submissions_insert on public.mf_submissions for insert to anon, authenticated
  with check (exists (select 1 from public.mf_forms f
    where f.current_version_id = version_id and f.status = 'published'));

-- Validate the definition on the server as well as in the builder.
create function public.mf_check_fields(fields jsonb, depth integer default 0)
returns void language plpgsql security invoker set search_path = '' as $$
declare f jsonb; ids text[] := '{}'; opts jsonb; prior jsonb;
begin
  if jsonb_typeof(fields) is distinct from 'array' or jsonb_array_length(fields) not between 1 and 50 or depth > 1 then
    raise exception 'Alan listesi geçersiz (en fazla 50 alan).';
  end if;
  for f in select value from jsonb_array_elements(fields) loop
    if coalesce(f->>'id','') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' or (f->>'id') = any(ids)
      or length(trim(coalesce(f->>'label',''))) not between 1 and 120
      or coalesce(f->>'type','') not in ('text','textarea','number','quantity','date','select','lookup','group')
      or jsonb_typeof(f->'required') is distinct from 'boolean' then
      raise exception 'Alan kimliği, başlığı veya türü geçersiz.';
    end if;
    if f ? 'condition' then
      if not coalesce((f->'condition'->>'field') = any(ids), false) then
        raise exception 'Koşul yalnızca önceki bir alana bağlanabilir.';
      end if;
      select value into prior from jsonb_array_elements(fields) where value->>'id' = f->'condition'->>'field';
      if prior->>'type' <> 'select' or not (prior->'options' @> jsonb_build_array(f->'condition'->>'equals')) then
        raise exception 'Koşul için önceki bir seçenek alanı ve geçerli seçenek seçin.';
      end if;
    end if;
    ids := array_append(ids, f->>'id');
    if f->>'type' in ('select','quantity') then
      opts := case when f->>'type' = 'select' then f->'options' else f->'units' end;
      if jsonb_typeof(opts) is distinct from 'array' or jsonb_array_length(opts) not between 1 and 100 then
        raise exception 'Seçenek/birim listesi boş olamaz.';
      end if;
      if exists(select 1 from jsonb_array_elements(opts) o where jsonb_typeof(o) <> 'string' or length(trim(o #>> '{}')) not between 1 and 120)
        or (select count(*) from jsonb_array_elements(opts)) <> (select count(distinct value) from jsonb_array_elements(opts)) then
        raise exception 'Seçenekler benzersiz, dolu metinler olmalı.';
      end if;
    end if;
    if f->>'type' = 'lookup' and not exists(select 1 from public.mf_lists where id::text = f->>'listId' and active) then
      raise exception 'Aktif bir kayıt listesi seçin.';
    end if;
    if f->>'type' = 'group' then perform public.mf_check_fields(f->'fields', depth + 1); end if;
  end loop;
end;
$$;

create function public.mf_validate_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if octet_length(new.definition::text) > 65536
    or length(trim(coalesce(new.definition->>'title',''))) not between 1 and 120 then
    raise exception 'Form başlığı veya boyutu geçersiz.';
  end if;
  perform public.mf_check_fields(new.definition->'fields');
  if not (new.definition->'fields' @> '[{"id":"first_name","type":"text","required":true},{"id":"last_name","type":"text","required":true},{"id":"date","type":"date","required":true}]'::jsonb)
    or exists(select 1 from jsonb_array_elements(new.definition->'fields') f where f->>'id' in ('first_name','last_name','date') and f ? 'condition') then
    raise exception 'İsim, soyisim ve tarih zorunlu olmalı.';
  end if;
  return new;
end;
$$;
create trigger mf_version_validate before insert on public.mf_versions
  for each row execute function public.mf_validate_version();

create function public.mf_publish(p_form_id uuid, p_revision integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare d public.mf_drafts; v uuid; n integer;
begin
  if not public.is_admin() then raise exception 'Admin yetkisi gerekiyor.'; end if;
  perform 1 from public.mf_forms where id = p_form_id for update;
  select * into d from public.mf_drafts where form_id = p_form_id for update;
  if not found or d.revision <> p_revision then raise exception 'Taslak başka bir oturumda değişti. Yeniden açın.'; end if;
  select coalesce(max(version),0)+1 into n from public.mf_versions where form_id = p_form_id;
  insert into public.mf_versions(form_id, version, definition) values(p_form_id, n, d.definition) returning id into v;
  update public.mf_forms set name = d.definition->>'title', current_version_id = v, status = 'published' where id = p_form_id;
  return v;
end;
$$;
revoke all on function public.mf_publish(uuid,integer) from public;
grant execute on function public.mf_publish(uuid,integer) to authenticated;

create function public.mf_check_answers(fields jsonb, answers jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare f jsonb; a jsonb; row_value jsonb; k text; date_value date;
begin
  if jsonb_typeof(answers) is distinct from 'object' then raise exception 'Yanıtlar geçersiz.'; end if;
  for k in select jsonb_object_keys(answers) loop
    if not exists(select 1 from jsonb_array_elements(fields) x where x->>'id' = k) then raise exception 'Bilinmeyen alan: %', k; end if;
  end loop;
  for f in select value from jsonb_array_elements(fields) loop
    a := answers->(f->>'id');
    if f ? 'condition' and (answers->>(f->'condition'->>'field')) is distinct from (f->'condition'->>'equals') then
      if a is not null then raise exception 'Gizli alan yanıt içeremez: %', f->>'label'; end if;
      continue;
    end if;
    if a is null or a = 'null'::jsonb or a = '""'::jsonb then
      if (f->>'required')::boolean then raise exception 'Zorunlu alan: %', f->>'label'; end if;
      continue;
    end if;
    case f->>'type'
      when 'text', 'textarea' then
        if jsonb_typeof(a) <> 'string' or length(a #>> '{}') > 4000 or ((f->>'required')::boolean and trim(a #>> '{}') = '') then raise exception 'Metin geçersiz: %', f->>'label'; end if;
      when 'number' then
        if jsonb_typeof(a) <> 'number' or (a #>> '{}')::numeric < 0 then raise exception 'Negatif olmayan sayı girin: %', f->>'label'; end if;
      when 'quantity' then
        if jsonb_typeof(a->'value') is distinct from 'number' or (a->>'value')::numeric < 0 or not coalesce(f->'units' @> jsonb_build_array(a->>'unit'),false) then raise exception 'Miktar/birim geçersiz: %', f->>'label'; end if;
      when 'date' then
        if jsonb_typeof(a) <> 'string' or (a #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Tarih geçersiz.'; end if;
        date_value := (a #>> '{}')::date;
      when 'select' then
        if not (f->'options' @> jsonb_build_array(a)) then raise exception 'Seçim geçersiz: %', f->>'label'; end if;
      when 'lookup' then
        if not exists(select 1 from public.mf_items i join public.mf_lists l on l.id = i.list_id
          where i.id::text = a->>'id' and i.list_id::text = f->>'listId' and i.active and l.active
          and i.label = a->>'label' and (coalesce(f->>'kind','') = '' or i.kind = f->>'kind')) then
          raise exception 'Liste kaydı değişti veya kullanılamıyor: %', f->>'label';
        end if;
      when 'group' then
        if jsonb_typeof(a) <> 'array' or jsonb_array_length(a) > 50 or ((f->>'required')::boolean and jsonb_array_length(a) = 0) then raise exception 'Grup satırları geçersiz.'; end if;
        for row_value in select value from jsonb_array_elements(a) loop perform public.mf_check_answers(f->'fields', row_value); end loop;
    end case;
  end loop;
end;
$$;
create function public.mf_validate_submission() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare definition jsonb;
begin
  if octet_length(new.answers::text) > 131072 then raise exception 'Rapor boyutu çok büyük.'; end if;
  select v.definition into definition from public.mf_versions v join public.mf_forms f on f.current_version_id = v.id
    where v.id = new.version_id and f.status = 'published';
  if definition is null then raise exception 'Form güncellendi veya yayından kaldırıldı. Form listesinden yeniden açın.'; end if;
  perform public.mf_check_answers(definition->'fields', new.answers);
  new.created_at := now();
  return new;
end;
$$;
create trigger mf_submission_validate before insert on public.mf_submissions
  for each row execute function public.mf_validate_submission();

-- Helpers use invoker privileges, but are not public RPC entry points.
revoke all on function public.mf_check_fields(jsonb,integer), public.mf_validate_version(),
 public.mf_check_answers(jsonb,jsonb), public.mf_validate_submission() from public;
grant execute on function public.mf_check_fields(jsonb,integer) to authenticated;
grant execute on function public.mf_check_answers(jsonb,jsonb) to anon, authenticated;
create index mf_submissions_report_date_idx on public.mf_submissions ((answers->>'date'));
create function public.mf_reports(p_form_id uuid default null, p_start text default null,
  p_end text default null, p_search text default '', p_page integer default 0)
returns table(id uuid, answers jsonb, created_at timestamptz, definition jsonb, version integer)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.answers, s.created_at, v.definition, v.version
  from public.mf_submissions s join public.mf_versions v on v.id = s.version_id
  where (p_form_id is null or v.form_id = p_form_id)
    and (p_start is null or s.answers->>'date' >= p_start)
    and (p_end is null or s.answers->>'date' <= p_end)
    and (coalesce(p_search,'') = '' or position(lower(p_search) in lower(s.answers::text)) > 0)
  order by s.created_at desc, s.id
  limit 25 offset greatest(0, least(coalesce(p_page,0),100000)) * 25;
$$;
revoke all on function public.mf_reports(uuid,text,text,text,integer) from public;
grant execute on function public.mf_reports(uuid,text,text,text,integer) to authenticated;
commit;
