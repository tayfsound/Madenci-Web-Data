const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('category rename preserves ID, handles cancel/empty/duplicate/denied updates',async()=>{
 const dom=new JSDOM('<select id="materialCategorySelect"><option value="cat">Eski</option></select>',{runScripts:'outside-only'}),w=dom.window;
 let value=' Yeni ',result={data:[{id:'cat'}]},updates=[],filters=[],alerts=[];
 w.prompt=()=>value;w.alert=m=>alerts.push(m);w.confirm=()=>true;
 w.db={from(table){assert.equal(table,'categories');return {update(payload){updates.push(payload);return this;},eq(k,v){filters.push([k,v]);return this;},select:async()=>result};}};
 w.loadCategoriesAndMaterials=async()=>{};w.loadCategoriesList=async()=>{};
 const source=fs.readFileSync('admin.html','utf8');w.eval(source.slice(source.indexOf('        async function renameCategory'),source.indexOf('        async function addCategory')));
 const button=w.document.createElement('button');await w.renameCategory('cat','Eski',button);
 assert.equal(updates[0].name,'Yeni');assert.deepEqual(filters,[['id','cat'],['name','Eski']]);assert.equal(w.document.querySelector('option').textContent,'Yeni');assert.equal(button.disabled,false);
 value=null;await w.renameCategory('cat','Eski',button);value=' ';await w.renameCategory('cat','Eski',button);assert.equal(updates.length,1);
 value='Yeni';result={error:{code:'23505'}};await w.renameCategory('cat','Eski',button);assert.match(alerts.at(-1),/zaten var/);
 result={data:[]};await w.renameCategory('cat','Eski',button);assert.match(alerts.at(-1),/Yetkinizi/);assert.equal(button.disabled,false);dom.window.close();
});
