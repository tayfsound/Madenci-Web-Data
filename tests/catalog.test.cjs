const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const F=require('../dynamic-forms.js');

test('shared catalog: live sources, category filters, RLS, archive and historical answers',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated;
   create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'false')='true' $$;`);
  for(const table of ['locations','categories','materials','loaders','drilling_types']){
   await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(),name text not null${table==='materials'?',category_id uuid':''});
    alter table public.${table} enable row level security;
    create policy read on public.${table} for select to anon,authenticated using(name<>'Private');
    grant select on public.${table} to anon,authenticated;`);
  }
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const category=(await q("insert into categories(name) values('Yağ') returning id"))[0].id;
  const material=(await q("insert into materials(name,category_id) values('Motor yağı',$1) returning id",[category]))[0].id;
  const loc=(await q("insert into locations(name) values('Ocak 1') returning id"))[0].id;
  await q("insert into locations(name) values('Private')");
  for(const suffix of ['_dynamic_forms.sql','_shared_form_catalog.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith(suffix)),'utf8'));
  await db.exec("set role authenticated; set test.admin='true';");
  const list=(await q("insert into mf_lists(name) values('Kamyonlar') returning id"))[0].id;
  const item=(await q("insert into mf_items(list_id,label) values($1,'K-1') returning id",[list]))[0].id;
  const def=F.base();def.fields.push({id:'loc',type:'lookup',label:'Lokasyon',required:true,listId:'builtin:locations'},
   {id:'mat',type:'lookup',label:'Malzeme',required:true,listId:'builtin:materials',kind:'Yağ'});
  const form=(await q("insert into mf_forms(name) values('Test') returning id"))[0].id;
  await q('insert into mf_drafts(form_id,definition) values($1,$2)',[form,JSON.stringify(def)]);
  const version=(await q('select mf_publish($1,1) as id',[form]))[0].id;
  const answers={first_name:'Test',last_name:'Test',date:'2026-10-16',loc:{id:loc,label:'Ocak 1'},mat:{id:material,label:'Motor yağı'}};
  const submit=a=>q('insert into mf_submissions(id,version_id,answers) values(gen_random_uuid(),$1,$2)',[version,JSON.stringify(a)]);
  await db.exec("set role anon; set test.admin='false';");
  assert.equal((await q("select * from mf_available_lists where builtin")).length,5);
  assert.equal((await q("select * from mf_available_items where label='Private'")).length,0);
  await submit(answers);
  await assert.rejects(submit({...answers,loc:{id:material,label:'Motor yağı'}}));
  await assert.rejects(q("update mf_lists set active=false"));
  await db.exec('reset role;');
  await q("update locations set name='Ocak 2' where id=$1",[loc]);
  await db.exec("set role anon;");
  await assert.rejects(submit(answers));
  await submit({...answers,loc:{id:loc,label:'Ocak 2'}});
  await db.exec("set role authenticated; set test.admin='true';");
  await q('update mf_items set active=false where id=$1',[item]);
  await q('update mf_lists set active=false where id=$1',[list]);
  assert.equal((await q('select answers from mf_submissions order by created_at'))[0].answers.loc.label,'Ocak 1');
  await db.exec("set role anon; set test.admin='false';");
  assert.equal((await q('select * from mf_available_items where list_id=$1',[list])).length,0);
  await db.exec("set role authenticated; set test.admin='true';");
  await q('update mf_lists set active=true where id=$1',[list]);
  assert.equal((await q('select active from mf_available_items where id=$1',[item]))[0].active,false);
  await q('update mf_items set active=true where id=$1',[item]);
  assert.equal((await q('select active from mf_available_items where id=$1',[item]))[0].active,true);
 } finally {await db.close();}
});
