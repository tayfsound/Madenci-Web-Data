(function(root){
    'use strict';
    const MAX_BYTES=2*1024*1024;
    const element=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
    function fit(width,height,max=2560){const s=Math.min(1,max/Math.max(width,height));return {width:Math.round(width*s),height:Math.round(height*s)};}
    async function compress(file){
        if(!file||file.size>20*1024*1024)throw Error('En fazla 20 MB fotoğraf seçin.');
        if(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))throw Error('JPEG, PNG, WebP veya desteklenen HEIC fotoğraf seçin.');
        const url=URL.createObjectURL(file),image=new Image();
        try{
            image.src=url;
            try{await image.decode();}catch(_){throw Error('Bu fotoğraf biçimi tarayıcıda açılamadı. Kamerayla yeniden çekin veya JPEG seçin.');}
            if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>50000000)throw Error('Fotoğraf boyutları çok büyük. Daha düşük çözünürlükte çekin.');
            const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
            if(!ctx)throw Error('Fotoğraf işleme desteklenmiyor. Başka tarayıcı deneyin.');
            // Canvas strips EXIF/GPS. Keep a conservative quality floor for digits.
            for(const [max,quality] of [[2560,.9],[2560,.85],[2048,.85]]){
                const size=fit(image.naturalWidth,image.naturalHeight,max);canvas.width=size.width;canvas.height=size.height;
                ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
                const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
                if(blob&&blob.size<=MAX_BYTES)return blob;
            }
            throw Error('Okunabilirliği düşürmeden 2 MB sınırına inilemedi. Sayacı daha yakından çekin.');
        }finally{URL.revokeObjectURL(url);}
    }
    function mount(host){
        let blob=null,url=null,working=false,generation=0,requestId=null,lastPayload=null;
        const note=element('p','Vardiya sonundaki sayacı çekin. Tek fotoğraf saklanır; yeni seçim eskisinin yerini alır. Fotoğraf 3 ay sonra silinir.');note.className='text-sm text-slate-400 mb-3';
        const camera=element('input'),gallery=element('input');
        for(const input of [camera,gallery]){input.type='file';input.accept='image/jpeg,image/png,image/webp,image/heic,image/heif';input.className='hidden';input.multiple=false;}
        camera.setAttribute('capture','environment');
        const take=element('button','Fotoğraf çek'),choose=element('button','Galeriden seç');
        for(const b of [take,choose]){b.type='button';b.className='border border-slate-600 rounded-xl px-4 py-3 mr-2 mb-2';}
        take.onclick=()=>camera.click();choose.onclick=()=>gallery.click();
        const preview=element('img');preview.alt='Sıkıştırılmış sayaç fotoğrafı önizlemesi';preview.hidden=true;preview.style.cssText='width:100%;max-height:420px;object-fit:contain;margin:12px 0;border-radius:12px';
        const status=element('p');status.setAttribute('role','status');status.className='text-sm text-slate-400';
        const label=element('label'),confirm=element('input');confirm.type='checkbox';confirm.disabled=true;label.className='flex items-center gap-3 text-sm my-3';label.append(confirm,document.createTextNode('Önizlemede sayaç rakamları okunuyor.'));
        const bigger=element('button','Fotoğrafı büyüt');bigger.type='button';bigger.className='text-blue-300 underline';bigger.hidden=true;bigger.onclick=()=>showImage(url,'Sayaç fotoğrafı');
        host.append(note,camera,gallery,take,choose,preview,bigger,status,label);
        async function change(event){
            const file=event.target.files[0];if(!file)return;
            const token=++generation;working=true;blob=null;confirm.checked=false;confirm.disabled=true;requestId=null;lastPayload=null;
            if(url)URL.revokeObjectURL(url);url=null;preview.hidden=true;bigger.hidden=true;status.textContent='Fotoğraf hazırlanıyor…';
            try{const result=await compress(file);if(token!==generation)return;blob=result;url=URL.createObjectURL(blob);preview.src=url;preview.hidden=false;bigger.hidden=false;confirm.disabled=false;status.textContent=`Hazır · ${Math.round(blob.size/1024)} KB. Rakamları kontrol edin.`;}
            catch(e){if(token===generation)status.textContent=e.message;}
            finally{if(token===generation)working=false;event.target.value='';}
        }
        camera.onchange=gallery.onchange=change;
        function validate(){if(working)return 'Fotoğrafın hazırlanmasını bekleyin.';if(!blob)return 'Bir sayaç fotoğrafı seçin.';if(!confirm.checked)return 'Fotoğraftaki rakamların okunabildiğini onaylayın.';return '';}
        return {validate,async submit(db,payload){
            const issue=validate();if(issue)throw Error(issue);
            const fingerprint=JSON.stringify(payload);if(!requestId||fingerprint!==lastPayload){requestId=crypto.randomUUID();lastPayload=fingerprint;}
            const body=new FormData();body.append('photo',blob,'meter.jpg');body.append('report',JSON.stringify({...payload,request_id:requestId}));
            const {data,error}=await db.functions.invoke('submit-loader-report',{body});
            if(error){let message='Fotoğraf/rapor yüklenemedi. Formdaki bilgileri koruduk; tekrar deneyin.';try{const detail=await error.context?.json();if(detail?.error)message=detail.error;}catch(_){}throw Error(message);}
            if(!data?.ok)throw Error(data?.error||'Sunucu kaydı doğrulamadı. Tekrar deneyin.');
        },reset(){generation++;working=false;blob=null;requestId=null;lastPayload=null;if(url)URL.revokeObjectURL(url);url=null;preview.removeAttribute('src');preview.hidden=true;bigger.hidden=true;confirm.checked=false;confirm.disabled=true;status.textContent='';}};
    }
    function showImage(src,title){
        const dialog=element('dialog');dialog.style.cssText='background:#0f172a;color:white;border:1px solid #475569;border-radius:16px;max-width:95vw;max-height:95vh;padding:20px';
        dialog.setAttribute('aria-label',title);const close=element('button','Kapat');close.type='button';close.style.cssText='padding:12px;margin-bottom:12px;border:1px solid #64748b;border-radius:8px;background:#1e293b;color:white';
        const image=element('img');image.alt=title;image.src=src;image.style.cssText='display:block;max-width:85vw;max-height:80vh;object-fit:contain';dialog.append(close,image);document.body.append(dialog);
        close.onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.showModal();close.focus();return dialog;
    }
    async function view(db,id){
        if(!/^[0-9a-f-]{36}$/i.test(id))return;
        try{
            const {data,error}=await db.from('loader_meter_photos').select('object_path,status,expires_at').eq('id',id).maybeSingle();
            if(error)throw error;
            if(!data)throw Error('Fotoğraf bulunamadı veya erişim yetkiniz yok.');
            if(data.status==='deleted'||data.status==='deleting'||(data.expires_at&&new Date(data.expires_at)<=new Date()))throw Error('Fotoğrafın 3 aylık saklama süresi doldu. Rapor kaydı korunuyor.');
            if(data.status!=='ready')throw Error('Fotoğraf yüklemesi tamamlanmamış.');
            // Download through authenticated Storage; no shareable signed URL is persisted.
            const result=await db.storage.from('loader-meter-photos').download(data.object_path);if(result.error)throw result.error;
            const url=URL.createObjectURL(result.data);const dialog=showImage(url,'Vardiya sonu sayaç fotoğrafı');
            dialog.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
        }catch(e){alert(e.message||'Fotoğraf açılamadı.');}
    }
    root.LoaderPhoto={mount,view,compress,fit,MAX_BYTES};
    if(typeof module!=='undefined')module.exports=root.LoaderPhoto;
})(typeof window==='undefined'?globalThis:window);
