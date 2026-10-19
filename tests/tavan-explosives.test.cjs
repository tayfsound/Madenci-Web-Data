const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('Drilling excludes explosives; material report requires blast context; history remains readable',async()=>{
 const dom=new JSDOM(fs.readFileSync('form.html','utf8'),{runScripts:'outside-only',url:'https://test.local'});
 const w=dom.window,d=w.document;let saved=null;const alerts=[];
 w.scrollTo=()=>{};w.alert=message=>alerts.push(message);
 w.supabase={createClient:()=>({from:()=>({insert:async rows=>{saved=rows;return {};}})})};
 w.MadenciPortal={init(){},reload(){}};
 w.eval(fs.readFileSync('loader-photo.js','utf8'));
 w.eval([...d.scripts].find(s=>s.textContent.includes('const SUPABASE_URL')).textContent.replace(/\s*initApp\(\);\s*$/,'') + `
 categories=[{id:'explosives',name:'Patlayıcı'}];materialsByCategory={explosives:[{id:'dynex',name:'Dynex'},{id:'caps',name:'Kapsül'}]};drillingTypes=[{id:'roof',name:'Tavan',fields:[]}];`);
 w.openForm('drilling');
 const option=(id,value)=>{const o=d.createElement('option');o.value=value;o.textContent=value;d.getElementById(id).append(o);d.getElementById(id).value=value;};
 option('d_type','roof');option('d_location','Ocak 1');
 w.renderTavanFields(d.getElementById('d_dynamicFields'));
 d.getElementById('d_firstName').value='Ali';d.getElementById('d_lastName').value='Test';d.getElementById('d_date').value='2026-10-18';
 d.querySelector('.d-tavan-row').value='1';d.querySelector('.d-tavan-holes').value='4';d.getElementById('d_tavanTotalMeters').value='12';
 assert.equal(d.querySelectorAll('.d-tavan-explosive-qty').length,0);await w.submitEntry('drilling');
 assert.ok(saved);assert.equal(saved[0].location,'Ocak 1');assert.equal(saved[0].details.total_meters,'12');
 assert.equal(saved[0].details.explosives,undefined);
 w.renderAynaFields(d.getElementById('d_dynamicFields'));assert.equal(d.querySelectorAll('.d-ayna-explosive-qty').length,0);
 w.openForm('material');d.getElementById('m_firstName').value='Veli';d.getElementById('m_lastName').value='Test';d.getElementById('m_date').value='2026-10-19';
 const row=d.querySelector('.material-row');row.querySelector('.m-cat').value='explosives';row.querySelector('.m-cat').dispatchEvent(new w.Event('change'));
 row.querySelector('.m-name').value='dynex';row.querySelector('.m-qty').value='2.5';
 saved=null;await w.submitEntry('material');assert.equal(saved,null);assert.match(alerts.at(-1),/lokasyon/);
 row.querySelector('.m-blast-type').value='tavan';
 const loc=d.createElement('option');loc.value='Ocak 1';loc.textContent='Ocak 1';row.querySelector('.m-blast-location').append(loc);row.querySelector('.m-blast-location').value='Ocak 1';
 await w.submitEntry('material');assert.equal(saved[0].location,'Ocak 1');assert.equal(saved[0].details.blasting_type,'tavan');assert.equal(saved[0].details.first_name,'Veli');
 dom.window.close();
 const admin=new JSDOM('',{runScripts:'outside-only'}),a=admin.window;
 const source=fs.readFileSync('admin.html','utf8');
 // Load only pure report formatters, not auth or database setup.
 const start=source.indexOf('        function escapeReportText(');
 const end=source.indexOf('        function ',source.indexOf('        function formatDetails(entry)')+30);
 a.eval('const drillingTypes=[];'+source.slice(start,end));
 const report={entry_type:'drilling',details:{drilling_type:'Tavan',holes:[],total_meters:'12',explosives:[{name:'Dynex',quantity:'2.5'}]}};
 assert.match(a.formatDetailsHtml(report),/Dynex: 2.5/);assert.match(a.formatDetails(report),/Patlayıcı: Dynex: 2.5/);
 delete report.details.explosives;assert.doesNotThrow(()=>a.formatDetailsHtml(report));admin.window.close();
});
