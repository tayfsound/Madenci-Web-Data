const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const F=require('../dynamic-forms.js');

test('Postgres migration: publishing, validation, RLS, history and archive',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated;
   create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'false') = 'true' $$;`);
  const file=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_dynamic_forms.sql'));
  await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec(`set role authenticated; set test.admin='true';`);
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const form=(await q("insert into mf_forms(name) values('Kamyon raporu') returning id"))[0].id;
  const list=(await q("insert into mf_lists(name) values('Araçlar') returning id"))[0].id;
  const item=(await q("insert into mf_items(list_id,label,kind) values($1,'K-07','Kamyon') returning id",[list]))[0].id;
  const def=F.base();def.title='Kamyon raporu';def.fields.push({id:'vehicle',type:'lookup',label:'Kamyon',required:true,listId:list,kind:'Kamyon'},{id:'kind',type:'select',label:'Tür',required:true,options:['Cevher','Pasa']},{id:'note',type:'text',label:'Not',required:true,condition:{field:'kind',equals:'Pasa'}});
  await q('insert into mf_drafts(form_id,definition) values($1,$2)',[form,JSON.stringify(def)]);
  const v1=(await q('select mf_publish($1,1) as id',[form]))[0].id;
  await assert.rejects(q("update mf_versions set definition='{}' where id=$1",[v1]),/permission denied/);
  const answers={first_name:'Ali',last_name:'Test',date:'2026-10-12',vehicle:{id:item,label:'K-07'},kind:'Cevher'};
  await db.exec("set role anon; set test.admin='false';");
  assert.equal((await q('select * from mf_forms')).length,1);
  await assert.rejects(q('select * from mf_drafts'),/permission denied/);
  await assert.rejects(q('select * from mf_submissions'),/permission denied/);
  await assert.rejects(q('select mf_publish($1,1)',[form]),/permission denied/);
  await q('insert into mf_submissions(id,version_id,answers) values(gen_random_uuid(),$1,$2)',[v1,JSON.stringify(answers)]);
  for(const invalid of [{...answers,first_name:''},{...answers,kind:'Pasa'},{...answers,note:'hidden'},{...answers,vehicle:{id:item,label:'Fake'}},{...answers,date:'2026-02-31'},{...answers,unknown:'extra'}]){
   await assert.rejects(q('insert into mf_submissions(id,version_id,answers) values(gen_random_uuid(),$1,$2)',[v1,JSON.stringify(invalid)]));
  }
  await db.exec("set role authenticated; set test.admin='false';");
  assert.equal((await q('select * from mf_submissions')).length,0);
  await assert.rejects(q("insert into mf_forms(name) values('Attack')"),/row-level security/);
  await assert.rejects(q('select mf_publish($1,1)',[form]),/Admin/);
  await db.exec("set test.admin='true';");
  assert.equal((await q('select * from mf_reports(null,null,null,\'K-07\',0)')).length,1);
  def.title='Yeni başlık';await q('update mf_drafts set definition=$2,revision=2 where form_id=$1',[form,JSON.stringify(def)]);
  await assert.rejects(q('select mf_publish($1,1)',[form]),/Taslak/);
  const v2=(await q('select mf_publish($1,2) as id',[form]))[0].id;assert.notEqual(v1,v2);
  assert.equal((await q('select definition from mf_versions where id=$1',[v1]))[0].definition.title,'Kamyon raporu');
  await assert.rejects(q('delete from mf_forms where id=$1',[form]),/foreign key/);
  await q("update mf_forms set status='archived' where id=$1",[form]);
  assert.equal((await q('select * from mf_reports()')).length,1);
  await db.exec("set role anon; set test.admin='false';");
  assert.equal((await q('select * from mf_forms')).length,0);
  await assert.rejects(q('insert into mf_submissions(id,version_id,answers) values(gen_random_uuid(),$1,$2)',[v2,JSON.stringify(answers)]),/güncellendi/);
 } finally {await db.close();}
});
