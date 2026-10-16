const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('builder: click/drop, group children, condition help, draft save and publish',async()=>{
 const dom=new JSDOM('<div id="builder"></div>',{runScripts:'outside-only',url:'https://test.local'}),w=dom.window,d=w.document;
 w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=()=>{};
 for(const file of ['dynamic-forms.js','form-builder.js'])w.eval(fs.readFileSync(file,'utf8'));
 const records={mf_forms:[],mf_drafts:[],mf_available_lists:[],mf_available_items:[]};let published=false;
 records.mf_lists=records.mf_available_lists;records.mf_items=records.mf_available_items;
 records.mf_lists.push({id:'custom',name:'Araçlar',active:true},{id:'builtin:locations',name:'Lokasyonlar',active:true,builtin:true});
 records.mf_items.push({id:'item',list_id:'custom',label:'K-1',kind:'Kamyon',active:true});
 const db={from(table){let action='read',payload,filters=[];
   const q={select(){return q;},order(){return q;},eq(k,v){filters.push([k,v]);return q;},insert(data){action='insert';payload=data;return q;},update(data){action='update';payload=data;return q;},single(){return q;},maybeSingle(){return q;},then(resolve,reject){
     try{let data=records[table].filter(r=>filters.every(([k,v])=>r[k]===v));
       if(action==='insert'){const row={id:'test-form',...JSON.parse(JSON.stringify(payload))};records[table].push(row);data=row;}
       if(action==='update'){for(const r of data)Object.assign(r,JSON.parse(JSON.stringify(payload)));data=data[0]||null;}
       return Promise.resolve({data}).then(resolve,reject);
     }catch(e){return Promise.reject(e).then(resolve,reject);}
   }};return q;},async rpc(name,args){assert.equal(name,'mf_publish');assert.equal(args.p_revision,2);published=true;return {data:'version-1'};}};
 await w.MadenciBuilder.open(db,d.getElementById('builder'));
 const click=text=>{const b=[...d.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(b,text);b.click();};
 const tick=()=>new Promise(r=>setImmediate(r));
 click('Seçim listeleri');await tick();
 assert.match(d.body.textContent,/Admin Panelinden yönetilir/);
 click('Kaydı kaldır');await tick();assert.equal(records.mf_items[0].active,false);
 assert.equal([...d.querySelectorAll('button')].some(b=>b.textContent==='Kaydı geri getir'),false);
 const archived=[...d.querySelectorAll('label')].find(l=>l.textContent.includes('Kaldırılan listeleri')).querySelector('input');
 archived.checked=true;archived.dispatchEvent(new w.Event('change'));click('Kaydı geri getir');await tick();assert.equal(records.mf_items[0].active,true);
 click('Listeyi kaldır');await tick();assert.equal(records.mf_lists[0].active,false);
 click('Listeyi geri getir');await tick();assert.equal(records.mf_lists[0].active,true);
 click('Formlar');await tick();
 click('＋ Form oluştur');click('＋ Tekrarlanan grup');
 assert.match(d.body.textContent,/satır eklenebilen bölüm/);
 const groupType=[...d.querySelectorAll('label')].find(l=>l.textContent.includes('Gruba eklenecek alan')).querySelector('select');assert.equal(groupType.value,'text');
 click('Gruba alan ekle');assert.equal([...d.querySelectorAll('.mf-canvas button')].filter(b=>b.textContent.startsWith('↳')).length,2);
 const dropped=new w.Event('drop',{bubbles:true,cancelable:true});dropped.dataTransfer={getData:()=>JSON.stringify({type:'number'})};d.querySelector('.mf-canvas .mf-card').dispatchEvent(dropped);
 assert.match(d.querySelector('.mf-canvas button').textContent,/1. Sayı/);
 assert.match(d.body.textContent,/Bu alan ne zaman görünsün/);
 click('Önizle');click('Önizle');assert.equal(d.querySelectorAll('.mf-preview').length,1);click('Önizlemeyi kapat');assert.equal(d.querySelectorAll('.mf-preview').length,0);
 click('Taslağı kaydet');await tick();assert.equal(records.mf_drafts.length,1);assert.equal(records.mf_drafts[0].definition.fields.length,5);assert.equal(records.mf_drafts[0].definition.fields.at(-1).fields.length,2);
 click('Yeni sürümü yayımla');await tick();assert.ok(published);
 dom.window.close();
});
