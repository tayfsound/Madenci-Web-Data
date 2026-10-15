const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {JSDOM}=require('jsdom');
const PHOTO='22222222-2222-4222-8222-222222222222',LOADER='11111111-1111-4111-8111-111111111111';
const payload=()=>({request_id:PHOTO,first_name:'Ali',last_name:'Test',date:'2026-10-13',shift:'gece',loader_id:LOADER,description:'',locations:[{location:'214',cevher_kovasi:'2',pasa_kovasi:'0'}]});

test('photo migration: private access, atomic report, idempotency, calendar retention and retries',async()=>{
 const db=new PGlite();const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema storage;grant usage on schema storage to anon,authenticated,service_role;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   grant all on storage.objects to anon,authenticated,service_role;
   create policy broad_existing_storage on storage.objects for all to anon,authenticated using(true) with check(true);
   create function public.is_admin() returns boolean language sql stable as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
   create table public.loaders(id uuid primary key,name text);
   create table public.locations(name text primary key);
   create table public.entries(id uuid default gen_random_uuid(),date date,entry_type text,location text,details jsonb);
   alter table public.entries enable row level security;
   create policy existing_public_insert on public.entries for insert to anon,authenticated with check(true);
   grant insert on public.entries to anon,authenticated;
   grant all on public.entries,public.locations,public.loaders to service_role;
   insert into loaders values('${LOADER}','L-7');insert into locations values('214');`);
  const file=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_loader_meter_photos.sql'));
  await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec('set role anon');
  await assert.rejects(q('select * from loader_meter_photos'),/permission denied/);
  await assert.rejects(q('select reserve_loader_photo($1,$2)',[PHOTO,'a'.repeat(64)]),/permission denied/);
  await assert.rejects(q("insert into storage.objects(bucket_id,name) values('loader-meter-photos','attack.jpg')"),/row-level security/);
  await assert.rejects(q("insert into entries(entry_type) values('loder')"),/row-level security/);
  await q("insert into entries(entry_type) values('material')");
  await db.exec('set role service_role');
  await q('select reserve_loader_photo($1,$2)',[PHOTO,'a'.repeat(64)]);
  await assert.rejects(q('select commit_loader_photo($1,$2,$3)',[PHOTO,'a'.repeat(64),JSON.stringify(payload())]),/yüklenmedi/);
  await q("insert into storage.objects(bucket_id,name) values('loader-meter-photos',$1)",[PHOTO+'.jpg']);
  await q('select commit_loader_photo($1,$2,$3)',[PHOTO,'a'.repeat(64),JSON.stringify(payload())]);
  await q('select commit_loader_photo($1,$2,$3)',[PHOTO,'a'.repeat(64),JSON.stringify(payload())]);
  assert.equal((await q("select * from entries where entry_type='loder'")).length,1);
  const entry=(await q("select details from entries where entry_type='loder'"))[0].details;
  assert.equal(entry.hours,undefined);assert.equal(entry.meter_photo_id,PHOTO);
  assert.equal((await q('select expires_at=uploaded_at+interval \'3 months\' as correct from loader_meter_photos'))[0].correct,true);
  assert.equal((await q('select * from claim_loader_photo_cleanup()')).length,0);
  await db.exec("set role authenticated;set test.admin='false'");
  assert.equal((await q('select * from loader_meter_photos')).length,0);
  assert.equal((await q("select * from storage.objects where bucket_id='loader-meter-photos'")).length,0);
  await db.exec("set test.admin='true'");
  assert.equal((await q('select * from loader_meter_photos')).length,1);
  assert.equal((await q("select * from storage.objects where bucket_id='loader-meter-photos'")).length,1);
  await assert.rejects(q("update loader_meter_photos set status='deleted'"),/permission denied/);
  await db.exec('set role service_role');
  await q("update loader_meter_photos set uploaded_at='2026-01-31 12:00+00',expires_at='2026-04-30 12:00+00'");
  assert.equal((await q('select * from claim_loader_photo_cleanup()')).length,1);
  assert.equal((await q('select * from claim_loader_photo_cleanup()')).length,0);
  await q("update loader_meter_photos set cleanup_retry_at=now()-interval '1 minute'");
  assert.equal((await q('select * from claim_loader_photo_cleanup()')).length,1);
  await q("update loader_meter_photos set status='deleted',deleted_at=now()");
  assert.equal((await q("select * from entries where entry_type='loder'")).length,1);
  await db.exec("set role authenticated;set test.admin='true'");
  assert.equal((await q("select * from storage.objects where bucket_id='loader-meter-photos'")).length,0);
 }finally{await db.close();}
});

test('upload handler validates photo/report and retries completed requests without duplicates',async()=>{
 const {validateReport,validateJpeg,createSubmitHandler}=await import('../supabase/functions/_shared/loader-service.mjs');
 assert.equal(validateReport({...payload(),hours:'999'}).hours,undefined);
 assert.throws(()=>validateReport({...payload(),date:'2026-02-31'}),/Tarih/);
 assert.throws(()=>validateJpeg(new Uint8Array(30)),/JPEG/);
 const jpeg=new Uint8Array([255,216,255,192,0,8,8,0,100,0,100,0,255,217,0,0,255,217]);
 assert.equal(validateJpeg(jpeg).width,100);
 let done=false,uploads=0,commits=0;
 const db={rpc:async(name)=>{if(name==='reserve_loader_photo')return {data:done?'ready':'pending'};commits++;done=true;return {data:null};},storage:{from:()=>({upload:async()=>{uploads++;return {data:{}};}})}};
 const handler=createSubmitHandler(db,['https://test.local']);
 const request=()=>{const body=new FormData();body.append('report',JSON.stringify(payload()));body.append('photo',new Blob([jpeg],{type:'image/jpeg'}),'photo.jpg');return new Request('https://function.local',{method:'POST',headers:{Origin:'https://test.local'},body});};
 assert.equal((await handler(request())).status,200);assert.equal((await handler(request())).status,200);
 assert.equal(uploads,1);assert.equal(commits,1);
 assert.equal((await handler(new Request('https://function.local',{method:'POST',headers:{Origin:'https://evil.local'}}))).status,403);
});

test('cleanup never marks a failed Storage removal as deleted and rejects unauthorized calls',async()=>{
 const {createCleanupHandler}=await import('../supabase/functions/_shared/loader-service.mjs');let claims=0,marked=0,removes=0;
 const db={rpc:async()=>({data:claims++===0?[{id:PHOTO,object_path:PHOTO+'.jpg'}]:[]}),storage:{from:()=>({remove:async()=>{removes++;return {error:{message:'offline'}};}})},from(){marked++;throw Error('must not mark');}};
 const handler=createCleanupHandler(db,'test-secret');
 assert.equal((await handler(new Request('https://test.local',{method:'POST'}))).status,401);assert.equal(claims,0);
 const result=await handler(new Request('https://test.local',{method:'POST',headers:{'x-cleanup-secret':'test-secret'}}));
 assert.equal(result.status,503);assert.equal(marked,0);assert.equal(removes,1);
});

test('loder wizard has one common loader, one photo step, no manual hours and blocks missing photo',()=>{
 const dom=new JSDOM(fs.readFileSync('form.html','utf8'),{runScripts:'outside-only',url:'https://test.local'}),w=dom.window,d=w.document;
 w.scrollTo=()=>{};w.supabase={createClient:()=>({})};w.MadenciPortal={init(){},reload(){}};let alert='';w.alert=m=>alert=m;
 w.eval(fs.readFileSync('loader-photo.js','utf8'));
 w.eval([...d.scripts].find(s=>s.textContent.includes('const SUPABASE_URL')).textContent.replace(/\s*initApp\(\);\s*$/,''));
 w.openForm('loder');w.addLoderLocationGroup();
 assert.equal(d.querySelectorAll('#form-loder .ld-loader').length,1);
 assert.equal(d.querySelectorAll('.ld-hours').length,0);
 assert.equal(d.querySelectorAll('#ld_meterPhoto img').length,1);
 assert.ok([...d.querySelectorAll('#ld_meterPhoto input[type=file]')].every(i=>!i.multiple));
 assert.equal(w.validateWizardStep(d.getElementById('ld_meterPhoto').closest('.real-wizard-step')),false);assert.match(alert,/fotoğraf/);
 assert.deepEqual(JSON.parse(JSON.stringify(w.LoaderPhoto.fit(4000,3000))),{width:2560,height:1920});
 dom.window.close();
});
