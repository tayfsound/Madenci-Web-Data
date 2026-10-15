const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const F=require('../dynamic-forms.js');

test('schema: conditions, groups, immutable IDs, units and active lookups',()=>{
 const d=F.base();d.fields.push({id:'choice',type:'select',label:'Tür',required:true,options:['A','B']},{id:'note',type:'text',label:'Not',required:true,condition:{field:'choice',equals:'B'}});
 F.checkDefinition(d);
 const a={first_name:'Ali',last_name:'Test',date:'2026-10-12',choice:'A',note:'stale'};
 assert.equal(F.clean(d.fields,a).note,undefined);
 assert.equal(F.validate(d.fields,F.clean(d.fields,a),[]),'');
 assert.match(F.validate(d.fields,{...a,choice:'B',note:''},[]),/zorunlu/);
 const clone=F.clone(d);clone.fields.reverse();assert.throws(()=>F.checkDefinition(clone),/Koşul/);
 assert.match(F.validate([{id:'q',label:'Miktar',type:'quantity',required:true,units:['kg']}],{q:{value:-1,unit:'kg'}},[]),/Miktar/);
 assert.match(F.validate([{id:'g',label:'Satırlar',type:'group',required:true,fields:[]}],{g:[]},[]),/satır/);
});

test('wizard: one card, required fields, Enter, back, group removal and save',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only',url:'https://test.local'}),w=dom.window,d=w.document;
 w.eval(fs.readFileSync('dynamic-forms.js','utf8'));
 const schema=w.MadenciForms.base();schema.fields.push({id:'rows',type:'group',label:'Kalemler',required:true,fields:[{id:'qty',type:'quantity',label:'Miktar',required:true,units:['kg','adet']}]});
 let saved=null;
 w.MadenciForms.mountWizard(d.getElementById('root'),schema,[],{onSave:async(a)=>saved=a});
 const click=text=>[...d.querySelectorAll('button')].find(b=>b.textContent===text).click();
 click('Devam et');assert.match(d.querySelector('[role=alert]').textContent,/İsim/);
 d.querySelector('input').value='Ali';d.querySelector('input').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert.equal(d.querySelector('input').autocomplete,'family-name');d.querySelector('input').value='Test';click('Devam et');
 click('Geri');assert.equal(d.querySelector('input').value,'Test');click('Devam et');click('Devam et');
 assert.equal(d.querySelectorAll('input[type=number]').length,1);
 click('＋ Satır ekle');assert.equal(d.querySelectorAll('input[type=number]').length,2);click('Satırı kaldır');assert.equal(d.querySelectorAll('input[type=number]').length,1);
 click('Devam et');assert.match(d.querySelector('[role=alert]').textContent,/Miktar/);
 d.querySelector('input[type=number]').value='2';click('Devam et');click('Kaydet');await new Promise(r=>setImmediate(r));
 assert.equal(saved.rows[0].qty.value,2);assert.equal(saved.rows[0].qty.unit,'kg');assert.equal(saved.first_name,'Ali');
 dom.window.close();
});

test('existing four forms still build and Ayna validation remains required',()=>{
 const dom=new JSDOM(fs.readFileSync('form.html','utf8'),{runScripts:'outside-only',url:'https://test.local'}),w=dom.window,d=w.document;
 w.scrollTo=()=>{};w.supabase={createClient:()=>({})};w.MadenciPortal={init(){},reload(){}};
 w.eval(fs.readFileSync('loader-photo.js','utf8'));
 w.eval([...d.scripts].find(s=>s.textContent.includes('const SUPABASE_URL')).textContent.replace(/\s*initApp\(\);\s*$/,''));
 for(const type of ['drilling','material','ore','loder']){w.openForm(type);const shell=d.querySelector('#form-'+type+' .real-wizard');assert.ok(shell);assert.equal(shell.querySelectorAll('.is-active').length,1);w.showSelection();}
 w.openForm('drilling');w.renderAynaFields(d.getElementById('d_dynamicFields'));
 const step=d.getElementById('d_dynamicFields').closest('.real-wizard-step');assert.equal(w.validateWizardStep(step),false);
 d.querySelector('.d-ayna-material-type').value='cevher';assert.equal(w.validateWizardStep(step),true);w.addAynaRow();assert.equal(w.validateWizardStep(step),false);
 dom.window.close();
});
