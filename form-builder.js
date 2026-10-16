/* Admin-only UI. Permissions are also enforced by database RLS. */
(function () {
    'use strict';
    const F = MadenciForms, {el, button, labeled, select} = F;
    let db, host, lists = [], items = [], forms = [], dirty = false, editor = null, busy = false, showArchived = false;
    const check = result => { if (result.error) throw Error(result.error.message); return result.data; };
    function message(error) {
        const node = host.querySelector('[role=status]');
        if (node) node.textContent = error;
    }
    async function run(action) {
        if (busy) return;
        busy = true;
        host.inert = true;
        host.setAttribute('aria-busy','true');
        try { await action(); }
        catch (e) { message(`İşlem tamamlanamadı: ${e.message}. Yeni tablolar bulunamıyorsa dynamic_forms SQL kurulumunu kontrol edin.`); }
        finally { busy = false; host.inert = false; host.removeAttribute('aria-busy'); }
    }
    async function refresh() {
        [forms, lists, items] = await Promise.all([
            db.from('mf_forms').select('*').order('created_at', {ascending:false}).then(check),
            db.from('mf_available_lists').select('*').order('name').then(check),
            db.from('mf_available_items').select('*').order('label').then(check)
        ]);
    }
    function leave() { return !dirty || confirm('Kaydedilmemiş değişiklikler var. Vazgeçilsin mi?'); }
    function frame(tab) {
        host.replaceChildren(); host.classList.add('mf');
        host.append(el('h2','Form yönetimi'), el('p','Mevcut dört form korunur. Burada oluşturulan formlar yayımlandığında veri giriş portalında görünür.','mf-muted'));
        const nav = el('div',undefined,'mf-toolbar');
        for (const [id,label,draw] of [['forms','Formlar',drawForms],['lists','Seçim listeleri',drawLists],['reports','Yeni form raporları',drawReports]]) {
            nav.append(button(label, () => { if (!leave()) return; dirty=false; run(async()=>{await refresh(); draw();}); }, id===tab?'mf-primary':''));
        }
        host.append(nav);
        const status = el('p','','mf-error'); status.setAttribute('role','status'); host.append(status);
        return host;
    }
    function input(value = '', type = 'text') { const n=el('input'); n.type=type; n.value=value; return n; }
    function drawForms() {
        frame('forms'); editor=null;
        host.append(button('＋ Form oluştur', () => { editor={id:null, revision:0, definition:F.base(), selected:[0]}; dirty=true; drawEditor(); },'mf-primary'));
        if (!forms.length) host.append(el('p','Henüz özel form yok. Form oluştur düğmesiyle başlayın.','mf-muted'));
        for (const form of forms) {
            const card=el('div',undefined,'mf-card'), bar=el('div',undefined,'mf-toolbar');
            card.append(el('h3',form.name), el('p',{draft:'Taslak',published:'Yayında',archived:'Arşivde'}[form.status],'mf-muted'));
            bar.append(button('Düzenle',()=>run(async()=>{
                const d=check(await db.from('mf_drafts').select('*').eq('form_id',form.id).maybeSingle());
                editor={id:form.id,revision:d?.revision||0,definition:d?.definition||F.base(),selected:[0]}; dirty=false; drawEditor();
            })));
            if(form.status==='published') bar.append(button('Yayından kaldır',()=>run(async()=>{
                if(!confirm('Form yeni girişlere kapatılsın mı? Geçmiş raporlar korunacak.'))return;
                check(await db.from('mf_forms').update({status:'archived'}).eq('id',form.id)); await refresh();drawForms();
            })));
            if(!form.current_version_id) bar.append(button('Taslağı sil',()=>run(async()=>{
                if(!confirm('Bu yayımlanmamış taslak kalıcı olarak silinsin mi?'))return;
                check(await db.from('mf_forms').delete().eq('id',form.id)); await refresh();drawForms();
            }),'mf-danger'));
            card.append(bar);host.append(card);
        }
    }
    async function saveDraft() {
        const def=F.clone(editor.definition);
        if(!def.title.trim())throw Error('Form adı girin');
        if(!editor.id){ const f=check(await db.from('mf_forms').insert({name:def.title.trim()}).select('id').single());editor.id=f.id; }
        if(!editor.revision){
            check(await db.from('mf_drafts').insert({form_id:editor.id,definition:def,revision:1}));editor.revision=1;
        }else{
            const d=check(await db.from('mf_drafts').update({definition:def,revision:editor.revision+1}).eq('form_id',editor.id).eq('revision',editor.revision).select('revision').maybeSingle());
            if(!d)throw Error('Başka bir oturum taslağı değiştirdi. Formu listeden yeniden açın');
            editor.revision=d.revision;
        }
        dirty=false;
    }
    function selected() {
        const [i,j]=editor.selected;
        return j===undefined ? {f:editor.definition.fields[i], siblings:editor.definition.fields,index:i} : {f:editor.definition.fields[i].fields[j],siblings:editor.definition.fields[i].fields,index:j};
    }
    function addField(type, group, position) {
        if(!F.types[type] || (group && type==='group'))return;
        const arr=group?group.fields:editor.definition.fields;
        if(arr.length>=50){message('En fazla 50 alan eklenebilir.');return;}
        const index=position===undefined?arr.length:position;
        arr.splice(index,0,F.field(type)); editor.selected=group?[editor.definition.fields.indexOf(group),index]:[index];dirty=true;drawEditor();
    }
    function drawEditor() {
        frame('forms'); const def=editor.definition;
        const title=input(def.title);title.maxLength=120;title.oninput=()=>{def.title=title.value;dirty=true;};
        const description=el('textarea');description.value=def.description||'';description.maxLength=1000;description.oninput=()=>{def.description=description.value;dirty=true;};
        host.append(labeled('Form adı',title),labeled('Kısa açıklama',description));
        const actions=el('div',undefined,'mf-toolbar');
        actions.append(button('Taslağı kaydet',()=>run(async()=>{await saveDraft();message('Taslak kaydedildi. Yayındaki sürüm değişmedi.');})),button('Önizle',()=>{
            try{F.checkDefinition(def,lists);host.querySelector('.mf-preview')?.remove();const preview=el('div',undefined,'mf-card mf-preview'),body=el('div');preview.append(button('Önizlemeyi kapat',()=>preview.remove()),body);host.append(preview);F.mountWizard(body,def,activeItems(),{preview:true,onExit:()=>preview.remove(),datePicker:window.createDateWheel});preview.scrollIntoView({behavior:'smooth'});}catch(e){message(e.message);}
        }),button('Yeni sürümü yayımla',()=>run(async()=>{
            F.checkDefinition(def,lists);
            if(!confirm('Bu sürüm veri giriş portalında yayımlansın mı? Eski raporlar korunacak.'))return;
            await saveDraft();check(await db.rpc('mf_publish',{p_form_id:editor.id,p_revision:editor.revision}));await refresh();drawForms();message('Form yayımlandı.');
        }),'mf-primary'));
        host.append(actions,el('p','Soldan sürükleyin veya tıklayın. Sıralama için ↑ / ↓ düğmelerini kullanabilirsiniz. Her ana alan bir wizard adımıdır.','mf-muted'));
        const layout=el('div',undefined,'mf-builder'),palette=el('aside',undefined,'mf-palette'),canvas=el('div',undefined,'mf-canvas'),settings=el('aside',undefined,'mf-card');layout.append(palette,canvas,settings);host.append(layout);
        for(const [type,label] of Object.entries(F.types)){
            const b=button('＋ '+label,()=>addField(type));b.draggable=true;b.ondragstart=e=>e.dataTransfer.setData('text/plain',JSON.stringify({type}));palette.append(b);
            if(type==='group')palette.append(el('p','Tekrarlanan grup = satır eklenebilen bölüm. Örnek: Malzeme + Miktar + Birim alanlarını bir kez tanımlayın; kullanıcı her malzeme için yeni satır eklesin.','mf-muted'));
        }
        canvas.ondragover=e=>e.preventDefault();
        canvas.ondrop=e=>{e.preventDefault();try{const p=JSON.parse(e.dataTransfer.getData('text/plain'));if(p.type)addField(p.type);}catch(_){}};
        def.fields.forEach((f,i)=>{
            const card=el('div',undefined,'mf-card'+(editor.selected[0]===i?' mf-selected':''));card.draggable=true;
            card.ondragstart=e=>{e.stopPropagation();e.dataTransfer.setData('text/plain',JSON.stringify({index:i}));};
            card.ondragover=e=>e.preventDefault();card.ondrop=e=>{
                e.preventDefault();e.stopPropagation();try{const p=JSON.parse(e.dataTransfer.getData('text/plain'));
                    if(Number.isInteger(p.index)&&def.fields[p.index]){const [m]=def.fields.splice(p.index,1);def.fields.splice(i,0,m);editor.selected=[i];dirty=true;drawEditor();}
                    else if(p.type)addField(p.type,null,i);
                }catch(_){}
            };
            card.append(button(`${i+1}. ${f.label} · ${F.types[f.type]}`,()=>{editor.selected=[i];drawEditor();}));
            const bar=el('div',undefined,'mf-toolbar');
            for(const [label,delta] of [['↑',-1],['↓',1]]){const b=button(label,()=>{[def.fields[i],def.fields[i+delta]]=[def.fields[i+delta],def.fields[i]];editor.selected=[i+delta];dirty=true;drawEditor();});b.disabled=i+delta<0||i+delta>=def.fields.length;b.setAttribute('aria-label',f.label+' '+(delta<0?'yukarı taşı':'aşağı taşı'));bar.append(b);}card.append(bar);
            if(f.type==='group'){
                card.append(el('p','Aşağıdaki alanlar birlikte tekrarlanır. Kullanıcı bu bölüme satır ekleyip kaldırabilir.','mf-muted'));
                f.fields.forEach((child,j)=>card.append(button('↳ '+child.label,()=>{editor.selected=[i,j];drawEditor();})));
                const type=select(Object.entries(F.types).filter(([k])=>k!=='group'));card.append(labeled('Gruba eklenecek alan',type),button('Gruba alan ekle',()=>addField(type.value,f)));
            }
            canvas.append(card);
        });
        const {f,siblings,index}=selected();if(!f)return;
        settings.append(el('h3','Alan ayarları'));
        if(editor.selected.length===2){
            const order=el('div',undefined,'mf-toolbar');
            for(const [label,delta] of [['Grupta yukarı taşı',-1],['Grupta aşağı taşı',1]]){
                const b=button(label,()=>{[siblings[index],siblings[index+delta]]=[siblings[index+delta],siblings[index]];editor.selected[1]+=delta;dirty=true;drawEditor();});
                b.disabled=index+delta<0||index+delta>=siblings.length;order.append(b);
            }
            settings.append(order);
        }
        const name=input(f.label);name.maxLength=120;name.oninput=()=>{f.label=name.value;dirty=true;};settings.append(labeled('Başlık',name));
        const locked=['first_name','last_name','date'].includes(f.id);
        const req=input('','checkbox');req.checked=f.required;req.disabled=locked;req.onchange=()=>{f.required=req.checked;dirty=true;};settings.append(labeled('Zorunlu alan',req));
        if(['select','quantity'].includes(f.type)){
            const key=f.type==='select'?'options':'units';const opts=el('textarea');opts.value=f[key].join('\n');opts.oninput=()=>{f[key]=opts.value.split('\n').map(v=>v.trim()).filter(Boolean);dirty=true;};settings.append(labeled('Her satıra bir '+(key==='units'?'birim':'seçenek'),opts));
        }
        if(f.type==='lookup'){
            const list=select([['','Liste seçin'],...lists.filter(l=>l.active).map(l=>[l.id,(l.builtin?'Hazır · ':'Özel · ')+l.name])],f.listId);list.onchange=()=>{f.listId=list.value;f.kind='';dirty=true;drawEditor();};
            settings.append(el('p','Hazır listeler Admin Panelindeki kayıtlara doğrudan bağlıdır; tekrar kayıt eklemeniz gerekmez. Malzemelerde tür filtresi kategoridir.','mf-muted'));
            const kinds=[...new Set(items.filter(i=>i.list_id===f.listId&&i.active&&i.kind).map(i=>i.kind))];
            const kind=select([['','Bütün türler'],...kinds.map(k=>[k,k])],f.kind||'');kind.onchange=()=>{f.kind=kind.value;dirty=true;};settings.append(labeled('Kaynak liste',list),labeled('Tür filtresi (isteğe bağlı)',kind));
        }
        if(!locked){
            const prior=siblings.slice(0,index).filter(x=>x.type==='select');
            const c=select([['','Her zaman göster'],...prior.map(x=>[x.id,x.label])],f.condition?.field||'');
            c.onchange=()=>{if(!c.value)delete f.condition;else f.condition={field:c.value,equals:prior.find(x=>x.id===c.value).options[0]};dirty=true;drawEditor();};settings.append(labeled('Bu alan ne zaman görünsün?',c));
            settings.append(el('p','İsteğe bağlıdır. Örnek: “Delgi tipi” sorusuna “Ayna” cevabı verilirse bu alanı göster. Koşul yoksa “Her zaman göster” bırakın.','mf-muted'));
            if(!prior.length)settings.append(el('p','Koşul kullanmak için bu alandan önce bir “Seçenekler” alanı ekleyin. Grup içindeki koşullar aynı grubun önceki sorularına bağlanır.','mf-muted'));
            if(f.condition){const source=prior.find(x=>x.id===f.condition.field);const eq=select((source?.options||[]).map(o=>[o,o]),f.condition.equals);eq.onchange=()=>{f.condition.equals=eq.value;dirty=true;};settings.append(labeled('Seçilen cevap şu olduğunda',eq));
                if(!source)settings.append(el('p','Koşulun bağlı olduğu soru kaldırılmış veya bu alanın sonrasına taşınmış. Koşulu yeniden seçin.','mf-error'));
            }
            settings.append(button('Alanı kaldır',()=>{if(!confirm('Alan taslaktan kaldırılsın mı?'))return;siblings.splice(index,1);editor.selected=[0];dirty=true;drawEditor();},'mf-danger'));
        }else settings.append(el('p','Ortak alan: zorunludur ve kaldırılamaz.','mf-muted'));
        settings.append(el('p','Alan kimliği: '+f.id,'mf-muted'));
    }
    const activeItems=()=>items.filter(i=>i.active&&lists.some(l=>l.id===i.list_id&&l.active));
    function drawLists() {
        frame('lists');
        host.append(el('p','Listeler herkese açık seçim verileridir. Örnek: Araçlar → Loder 3 (Loder), Kamyon 7 (Kamyon). Kişisel veya gizli bilgi eklemeyin.','mf-muted'));
        const name=input();const bar=el('div',undefined,'mf-toolbar');bar.append(labeled('Yeni liste adı',name),button('Liste oluştur',()=>run(async()=>{if(!name.value.trim())throw Error('Liste adı girin');check(await db.from('mf_lists').insert({name:name.value.trim()}));await refresh();drawLists();}),'mf-primary'));host.append(bar);
        const archived=input('','checkbox');archived.checked=showArchived;archived.onchange=()=>{showArchived=archived.checked;drawLists();};host.append(labeled('Kaldırılan listeleri ve kayıtları göster',archived));
        for(const list of lists.filter(l=>l.active||showArchived)){
            const card=el('div',undefined,'mf-card');card.append(el('h3',list.name+(list.active?'':' · Pasif')));
            if(list.builtin){
                card.append(el('p','Hazır liste · Admin Panelinden yönetilir. Değişiklikler bu listeyi kullanan tüm formlara yansır.','mf-muted'));
                card.append(el('p',items.filter(i=>i.list_id===list.id&&i.active).map(i=>i.label).join(' · ')||'Henüz kayıt yok.'));
                card.append(button('Admin Panelinde yönet',()=>window.showSection('admin')));
                host.append(card);continue;
            }
            const rename=input(list.name);card.append(labeled('Liste adı',rename),button('Adı kaydet',()=>run(async()=>{check(await db.from('mf_lists').update({name:rename.value.trim()}).eq('id',list.id));await refresh();drawLists();})));
            card.append(button(list.active?'Listeyi kaldır':'Listeyi geri getir',()=>run(async()=>{if(list.active&&!confirm('Liste arşivlenecek; geçmiş raporlar korunacak. Bu listeyi kullanan formlarda yeni seçim yapılamayacak. Devam?'))return;check(await db.from('mf_lists').update({active:!list.active}).eq('id',list.id));await refresh();drawLists();}),'mf-danger'));
            const label=input(),kind=input();const add=el('div',undefined,'mf-toolbar');add.append(labeled('Kayıt adı / numarası',label),labeled('Tür (örn. Kamyon)',kind),button('Kayıt ekle',()=>run(async()=>{if(!label.value.trim())throw Error('Kayıt adı girin');check(await db.from('mf_items').insert({list_id:list.id,label:label.value.trim(),kind:kind.value.trim()}));await refresh();drawLists();})));card.append(add);
            for(const item of items.filter(i=>i.list_id===list.id&&(i.active||showArchived))){
                const row=el('div',undefined,'mf-toolbar'),label=input(item.label),kind=input(item.kind);
                row.append(labeled('Kayıt',label),labeled('Tür',kind),button('Güncelle',()=>run(async()=>{check(await db.from('mf_items').update({label:label.value.trim(),kind:kind.value.trim()}).eq('id',item.id));await refresh();drawLists();})),button(item.active?'Kaydı kaldır':'Kaydı geri getir',()=>run(async()=>{if(item.active&&!confirm('Kayıt seçimlerden kaldırılacak; geçmiş raporlar korunacak. Devam?'))return;check(await db.from('mf_items').update({active:!item.active}).eq('id',item.id));await refresh();drawLists();}),'mf-danger'));card.append(row);
            }
            host.append(card);
        }
    }
    function drawReports() {
        frame('reports');
        const form=select([['','Bütün yeni formlar'],...forms.map(f=>[f.id,f.name])]),start=input('','date'),end=input('','date'),search=input();
        const bar=el('div',undefined,'mf-toolbar');bar.append(labeled('Form',form),labeled('Rapor tarihi başlangıç',start),labeled('Rapor tarihi bitiş',end),labeled('Seçilen kaydın adı (araç vb.)',search));host.append(bar);
        const results=el('div',undefined,'mf-report-list');let page=0;
        const prev=button('Önceki sayfa',()=>{if(page){page--;run(load);}}),next=button('Sonraki sayfa',()=>{page++;run(load);});
        bar.append(button('Filtrele',()=>{page=0;run(load);},'mf-primary'));
        const pagination=el('div',undefined,'mf-toolbar');pagination.append(prev,next);host.append(results,pagination);
        async function load(){
            if(start.value&&end.value&&start.value>end.value)throw Error('Başlangıç tarihi bitişten sonra olamaz');
            const data=check(await db.rpc('mf_reports',{p_form_id:form.value||null,p_start:start.value||null,p_end:end.value||null,p_search:search.value.trim(),p_page:page}));
            results.replaceChildren();prev.disabled=page===0;next.disabled=data.length<25;
            results.append(el('p',`Sayfa ${page+1} · ${data.length} kayıt`,'mf-muted'));
            for(const row of data){
                const v=row,card=el('details',undefined,'mf-card');card.append(el('summary',`${v.definition.title} · v${v.version} · ${row.answers.date||''} · ${row.answers.first_name||''} ${row.answers.last_name||''}`));
                card.append(el('p','Kayıt: '+row.id,'mf-muted'));F.summary(card,v.definition.fields,row.answers);results.append(card);
            }
            if(!data.length)results.append(el('p','Bu filtrelerle kayıt bulunamadı.'));
        }
        load().catch(e=>message(e.message));
    }
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
    window.MadenciBuilder={
        canLeave:()=>{if(busy)return false;if(!leave())return false;dirty=false;return true;},
        open:async(client,container)=>{db=client;host=container;frame('forms');await run(async()=>{await refresh();dirty=false;drawForms();});}
    };
})();
