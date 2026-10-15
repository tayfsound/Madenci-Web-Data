(function () {
    'use strict';
    const F = MadenciForms;
    let client, portal, screen, items = [], generation = 0, opening = false;
    async function load() {
        const token = ++generation;
        portal.replaceChildren(F.el('p','Ek formlar yükleniyor…','mf-muted'));
        try {
            const result = await client.from('mf_forms').select('id,name,current_version_id').eq('status','published').order('name');
            if(result.error)throw result.error;
            if(token!==generation)return;
            portal.replaceChildren();
            if(!result.data.length)return;
            portal.append(F.el('h3','Diğer raporlar'));
            for(const form of result.data)portal.append(F.button(form.name,()=>open(form),'mf-card'));
        } catch(e) {
            if(token!==generation)return;
            portal.replaceChildren(F.el('p','Ek formlar şu anda yüklenemedi. Mevcut dört form kullanılabilir.','mf-muted'),F.button('Yeniden dene',load));
            console.warn('Dinamik form listesi:',e.message);
        }
    }
    async function open(form) {
        if(opening)return;
        opening=true;
        screen.hidden=false;screen.replaceChildren(F.el('p','Form yükleniyor…'));
        document.getElementById('selectionScreen').classList.add('hidden');
        try {
            const [v,i]=await Promise.all([
                client.from('mf_versions').select('*').eq('id',form.current_version_id).single(),
                client.from('mf_items').select('*').eq('active',true).order('label')
            ]);
            if(v.error||i.error)throw v.error||i.error;
            const version=v.data;items=i.data;
            F.mountWizard(screen,version.definition,items,{
                datePicker:window.createDateWheel,
                onExit:()=>{screen.hidden=true;showSelection();},
                onSave:async(answers,id)=>{
                    if(document.getElementById('website_url').value.trim())throw Error('Kayıt gönderilemedi.');
                    const result=await client.from('mf_submissions').insert({id,version_id:version.id,answers});
                    if(result.error&&result.error.code!=='23505')throw Error(result.error.message);
                    if(localStorage.getItem('madenci_remember_personal_info')==='true'){
                        localStorage.setItem('madenci_saved_first_name',answers.first_name);
                        localStorage.setItem('madenci_saved_last_name',answers.last_name);
                    }
                    screen.replaceChildren();const done=F.el('div',undefined,'mf mf-wizard');done.append(F.el('h2','Rapor kaydedildi'),F.el('p','Yeni form oluştururken rapor türünü yeniden seçebilirsiniz.'));
                    const back=()=>{screen.hidden=true;showSelection();};done.append(F.button('Yeni form oluştur',back,'mf-primary'),F.button('Ana sayfaya dön',back));screen.append(done);
                }
            });
        }catch(e){screen.replaceChildren(F.el('p','Form açılamadı: '+e.message,'mf-error'),F.button('Form türlerine dön',()=>{screen.hidden=true;showSelection();}));}
        finally{opening=false;}
    }
    window.MadenciPortal={init(db){client=db;portal=document.getElementById('dynamicFormCards');screen=document.getElementById('dynamicFormScreen');load();},reload:load};
})();
