begin;
-- Read through existing RLS; never copy or independently edit the admin catalogs.
create view public.mf_available_lists with (security_invoker=true) as
select id::text, name, active, false as builtin from public.mf_lists
union all select * from (values
 ('builtin:locations','Lokasyonlar',true,true),
 ('builtin:categories','Malzeme kategorileri',true,true),
 ('builtin:materials','Malzemeler',true,true),
 ('builtin:loaders','Loderler',true,true),
 ('builtin:drilling_types','Delgi tipleri',true,true)
) as sources(id,name,active,builtin);

create view public.mf_available_items with (security_invoker=true) as
select i.id, i.list_id::text, i.label, i.kind, i.active
from public.mf_items i join public.mf_lists l on l.id=i.list_id
where l.active or (select public.is_admin())
union all select id,'builtin:locations',name,''::text,true from public.locations
union all select id,'builtin:categories',name,'',true from public.categories
union all select m.id,'builtin:materials',m.name,c.name,true
from public.materials m join public.categories c on c.id=m.category_id
union all select id,'builtin:loaders',name,'',true from public.loaders
union all select id,'builtin:drilling_types',name,'',true from public.drilling_types;
grant select on public.mf_available_lists,public.mf_available_items to anon,authenticated;

-- Keep all validation rules; use the same live catalog as the browser.
-- Exact substitutions also retain recursive group validation.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.mf_check_fields(jsonb,integer)'::regprocedure) into definition;
 execute replace(definition,'public.mf_lists','public.mf_available_lists');
 select pg_get_functiondef('public.mf_check_answers(jsonb,jsonb)'::regprocedure) into definition;
 execute replace(replace(definition,'public.mf_items','public.mf_available_items'),'public.mf_lists','public.mf_available_lists');
end;
$$;
commit;
