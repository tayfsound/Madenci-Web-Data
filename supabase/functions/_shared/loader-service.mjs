export const BUCKET = 'loader-meter-photos';
export const MAX_PHOTO = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const check = result => { if (result.error) throw new Error(result.error.message); return result.data; };

export function validateReport(p) {
  if (!p || !UUID.test(p.request_id) || !UUID.test(p.loader_id)) throw Error('Rapor veya loder kimliği geçersiz.');
  for (const k of ['first_name','last_name']) if (typeof p[k] !== 'string' || !p[k].trim() || p[k].length > 120) throw Error('İsim ve soyisim zorunlu.');
  if (!['gunduz','gece'].includes(p.shift)) throw Error('Vardiya seçin.');
  if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || Number.isNaN(Date.parse(p.date)) || new Date(p.date).toISOString().slice(0,10) !== p.date) throw Error('Tarih geçersiz.');
  if (typeof p.description !== 'string' || p.description.length > 4000) throw Error('Açıklama en fazla 4000 karakter olabilir.');
  if (!Array.isArray(p.locations) || !p.locations.length || p.locations.length > 50) throw Error('1–50 çalışma alanı girin.');
  for (const l of p.locations) {
    if (!l || typeof l.location !== 'string' || !l.location || l.location.length > 120) throw Error('Lokasyon seçin.');
    for (const k of ['cevher_kovasi','pasa_kovasi']) if (typeof l[k] !== 'string' || !/^[0-9]{1,7}$/.test(l[k])) throw Error('Kova sayısı negatif olmayan tam sayı olmalı.');
  }
  // Whitelist the payload: no manual hours, actor ID or arbitrary entry type.
  return {request_id:p.request_id,first_name:p.first_name.trim(),last_name:p.last_name.trim(),date:p.date,shift:p.shift,loader_id:p.loader_id,description:p.description,
    locations:p.locations.map(l=>({location:l.location,cevher_kovasi:l.cevher_kovasi,pasa_kovasi:l.pasa_kovasi}))};
}

export function validateJpeg(bytes) {
  if (bytes.length < 16 || bytes.length > MAX_PHOTO || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw Error('Geçerli, en fazla 2 MB JPEG fotoğraf gerekiyor.');
  let p = 2;
  while (p < bytes.length-3) {
    if(bytes[p++] !== 255) throw Error('JPEG yapısı geçersiz.');
    while(bytes[p] === 255) p++;
    const marker = bytes[p++];
    if(marker === 218 || marker === 217) break;
    const size = (bytes[p] << 8) + bytes[p+1];
    if(size < 2 || p+size > bytes.length) throw Error('JPEG kesilmiş.');
    // Baseline or progressive JPEG from canvas; reject other image formats.
    if(marker === 192 || marker === 194) {
      const h = (bytes[p+3]<<8)+bytes[p+4], w = (bytes[p+5]<<8)+bytes[p+6];
      if(size < 8 || !w || !h || w > 4096 || h > 4096) throw Error('Fotoğraf boyutları geçersiz.');
      return {width:w,height:h};
    }
    p += size;
  }
  throw Error('JPEG boyut bilgisi bulunamadı.');
}

async function boundedBody(request, max) {
  if(Number(request.headers.get('content-length')) > max) throw Error('Yükleme boyutu sınırı aşıldı.');
  if(!request.body) throw Error('Fotoğraf eksik.');
  const reader=request.body.getReader(), chunks=[]; let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Yükleme boyutu sınırı aşıldı.');}chunks.push(value);}
  return new Response(new Blob(chunks),{headers:{'content-type':request.headers.get('content-type')||''}}).formData();
}

export function createSubmitHandler(db, allowedOrigins) {
  return async request => {
    const origin=request.headers.get('origin')||'';
    const headers={'Content-Type':'application/json','Vary':'Origin','Access-Control-Allow-Origin':allowedOrigins.includes(origin)?origin:allowedOrigins[0],
      'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
    const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(origin && !allowedOrigins.includes(origin)) return reply({error:'Bu kaynaktan yükleme kabul edilmiyor.'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return reply({error:'POST gerekli.'},405);
    let report,bytes;
    try {
      const form=await boundedBody(request,MAX_PHOTO+65536);
      if(form.getAll('photo').length!==1 || form.getAll('report').length!==1)throw Error('Yalnızca bir fotoğraf yükleyin.');
      const photo=form.get('photo'),raw=form.get('report');
      if(typeof raw!=='string'||raw.length>32768||!photo||typeof photo==='string'||photo.type!=='image/jpeg')throw Error('Fotoğraf veya rapor geçersiz.');
      report=validateReport(JSON.parse(raw));bytes=new Uint8Array(await photo.arrayBuffer());validateJpeg(bytes);
    } catch(e){return reply({error:e.message},400);}
    try {
      const payload=new TextEncoder().encode(JSON.stringify(report));
      const input=new Uint8Array(payload.length+bytes.length);input.set(payload);input.set(bytes,payload.length);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input))).map(b=>b.toString(16).padStart(2,'0')).join('');
      const state=check(await db.rpc('reserve_loader_photo',{p_id:report.request_id,p_hash:hash}));
      if(state==='ready')return reply({ok:true}); // successful response was lost; do not duplicate
      const path=report.request_id+'.jpg';
      // No upsert: concurrent retries must never overwrite or delete a committed photo.
      const upload=await db.storage.from(BUCKET).upload(path,bytes,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});
      const duplicate=upload.error && (String(upload.error.statusCode)==='409' || ['Duplicate','ResourceAlreadyExists','KeyAlreadyExists'].includes(upload.error.error||upload.error.code));
      if(upload.error && !duplicate) throw Error('Fotoğraf yüklenemedi. Tekrar deneyin.');
      check(await db.rpc('commit_loader_photo',{p_id:report.request_id,p_hash:hash,p_report:report}));
      return reply({ok:true});
    } catch(e){
      // The reservation tracks even uncommitted uploads; cleanup removes them after 24h.
      console.error('loader-photo:',e.message);
      return reply({error:'Rapor kaydedilemedi. Fotoğrafı değiştirmeden tekrar deneyebilirsiniz. '+e.message},503);
    }
  };
}

export function createCleanupHandler(db, secret) {
  return async request => {
    if(!secret || request.headers.get('x-cleanup-secret')!==secret) return new Response('Unauthorized',{status:401});
    if(request.method!=='POST') return new Response('POST required',{status:405});
    let deleted=0,failed=0;
    try {
      for(let batch=0;batch<5;batch++){
        const photos=check(await db.rpc('claim_loader_photo_cleanup'));if(!photos.length)break;
        for(const photo of photos){
          try{
            // Use object ID to constrain paths, even if a table row is corrupted.
            if(!UUID.test(photo.id)||photo.object_path!==photo.id+'.jpg')throw Error('Invalid path');
            check(await db.storage.from(BUCKET).remove([photo.object_path]));
            check(await db.from('loader_meter_photos').update({status:'deleted',deleted_at:new Date().toISOString(),cleanup_retry_at:null}).eq('id',photo.id).eq('status','deleting'));
            deleted++;
          }catch(e){failed++;console.error('loader-photo-cleanup:',photo.id,e.message);}
        }
      }
      return Response.json({deleted,failed},{status:failed?503:200});
    }catch(e){console.error(e.message);return Response.json({error:'Cleanup failed',deleted,failed},{status:503});}
  };
}
