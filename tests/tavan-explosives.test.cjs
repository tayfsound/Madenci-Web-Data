const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('Tavan optional explosives: render, validate and save with location; admin and export display',async()=>{
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
 const inputs=d.querySelectorAll('.d-tavan-explosive-qty');assert.equal(inputs.length,2);assert.equal(inputs[0].required,false);
 inputs[0].value='-1';await w.submitEntry('drilling');assert.equal(saved,null);assert.match(alerts.at(-1),/negatif/);
 inputs[0].value='2.5';await w.submitEntry('drilling');
 assert.ok(saved);assert.equal(saved[0].location,'Ocak 1');assert.equal(saved[0].details.total_meters,'12');
 assert.deepEqual(JSON.parse(JSON.stringify(saved[0].details.explosives)),[{material_id:'dynex',name:'Dynex',quantity:'2.5'}]);
 d.getElementById('d_firstName').value='Ali';d.getElementById('d_lastName').value='Test';
 d.querySelector('.d-tavan-row').value='1';d.querySelector('.d-tavan-holes').value='4';d.getElementById('d_tavanTotalMeters').value='12';
 inputs[0].value='';await w.submitEntry('drilling');assert.equal(saved[0].details.explosives.length,0);
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
