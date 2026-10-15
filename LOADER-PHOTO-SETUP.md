# Loder sayaç fotoğrafı — kurulum ve doğrulama

## Hazırlanan davranış

- Bir rapor bir loder içindir; aynı loderin birden fazla çalışma alanı olabilir.
- İsim → Soyisim → Tarih → Vardiya → Loder → Çalışma alanları → Tek sayaç fotoğrafı → Kaydet.
- Manuel saat girişi, OCR, sayaç karşılaştırması veya saat hesaplaması yoktur.
- Fotoğraf tarayıcıda JPEG'e çevrilir; EXIF/GPS bilgisi aktarılmaz. Uzun kenar en fazla 2560 px, kalite 0.90/0.85; gerekirse 2048 px. 2 MB üstü çıktı okunabilirlik daha da azaltılmadan reddedilir. Kullanıcı sıkıştırılmış önizlemeyi onaylar. HEIC desteği tarayıcıya bağlıdır; açılamazsa JPEG veya kamera önerilir.
- Özel `loader-meter-photos` bucket'ı. Tarayıcı service-role anahtarı almaz. Anonim portal yalnızca doğrulayan Edge Function'a yükler; fotoğrafları admin oturumuyla açar.
- Fotoğraf ve ilgili `entries` satırları aynı kayıt kimliğini paylaşır. Ağ hatasından sonra değişmemiş isteği tekrar göndermek aynı raporu iki kez oluşturmaz.
- Kayıt tamamlandığı andan itibaren **3 takvim ayı** saklanır. Saatlik görev vadesi dolan dosyayı Storage API ile kalıcı siler. Rapor/metaveri kalır; admin süre doldu mesajını görür. İşlem başarısızsa bir saat sonra yeniden denenir. Başarısız/yarım yüklemeler 24 saat sonra temizlenir.
- Süre dolduğunda RLS fotoğraf erişimini hemen kapatır. Fiziksel silme, çalışan görevin bir sonraki turunda olur; servis kesintilerinde gecikebilir.
- Eski `details.hours` raporları korunur. Yeni kayıtlarda yalnızca `meter_photo_id` bulunur.

## Canlı kurulum durumu — 15 Ekim 2026

`cxvrcqkkxfblpxzynfya` projesinde dinamik form ve fotoğraf migration'ları, iki Edge Function, Vault/Edge secret ve saatlik Cron kuruldu. Mevcut 19 rapor korundu. Canlı `entries_entry_type_check` kısıtının loder içermediği görüldü; `20261015150032_loader_report_entry_type.sql` ile mevcut türler korunarak loder eklendi.

SQL dosyaları CLI `db query --linked --project-ref` ile uygulandı; migration geçmişine otomatik işlenmedi. Bu dosyaları canlıda tekrar çalıştırmayın veya geçmişi eşleştirmeden `db push` kullanmayın.

Eksik fotoğraf isteği HTTP 400, yetkisiz cleanup HTTP 401 ile reddedildi. Vault üzerinden tetiklenen cleanup HTTP 200 (`deleted: 0, failed: 0`) döndü; saatlik görev aktif. Gerçek saha telefonu ile fotoğraf yükleme ve admin görüntüleme kabul kontrolü hâlâ gereklidir.

Güvenlik taramasında yeni tablolar için RLS uyarısı çıkmadı. `is_admin` search_path sabitlendi; böylece boş search_path kullanan yeni RPC'lerden de çalışır. Önceden bulunan `is_admin` SECURITY DEFINER, `handle_new_user` RPC erişimi ve sızmış parola koruması uyarıları ayrı güvenlik işi olarak takip edilmelidir. Mevcut yetki politikasını bozabilecek geniş değişiklik yapılmadı.

## Yeni ortam için canlıya geçiş

Bu iş yalnızca SQL çalıştırmakla tamamlanmaz: **migration + iki Edge Function + secret + Cron + web dosyaları** birlikte gerekir. Önce test projesinde doğrulayın ve canlı yedeği alın. `setup.sql` veya `duzelt.sql` dosyalarını yeniden çalıştırmayın.

1. Canlı `entries` tablosunun mevcut anonim portal gibi `user_id` olmadan kayıt kabul ettiğini ve `entry_type='loder'` desteklediğini doğrulayın. `public.is_admin()`, `loaders`, `locations` tabloları mevcut olmalıdır. Eski `setup.sql` tek başına canlı şemanın güncel karşılığı değildir.
2. Supabase Edge Function Secrets bölümünde güçlü, rastgele bir `LOADER_CLEANUP_SECRET` tanımlayın. Aynı değeri Vault'ta `loader_photo_cleanup_secret` adıyla saklayın. Secret'ı HTML'e, Git'e veya sohbet mesajına yazmayın. Vault'ta `loader_photo_project_url` değerini de projenizin HTTPS adresi olarak tanımlayın.
3. `LOADER_ALLOWED_ORIGINS` varsayılanı `https://tayfsound.github.io`. Yerel uçtan uca test gerekiyorsa `http://127.0.0.1:8765` değerini virgülle ekleyin; üretimde yalnızca gereken origin'leri tutun. CORS kimlik doğrulama değildir. Endpoint kamuya açık veri girişi içindir; global 120 yeni fotoğraf/saat, 1000/gün sınırı vardır. Yoğun kullanım için oran sınırları ve bot koruması ayrıca değerlendirilmelidir.
4. Proje kimliğini doğruladıktan sonra iki fonksiyonu yayımlayın (`supabase/config.toml` JWT ayarlarını içerir). Cleanup fonksiyonunun kendi secret kontrolü vardır:

   ```sh
   npx supabase functions deploy submit-loader-report cleanup-loader-photos --project-ref cxvrcqkkxfblpxzynfya --use-api
   ```

5. Kısa, koordineli geçiş sırasında `supabase/migrations/20261013133951_loader_meter_photos.sql` dosyasını **bir kez** SQL Editor'de çalıştırın. Dinamik form migration'ına bağımlı değildir. Eski loder sayfası doğrudan `entries` tablosuna yazdığı için migration'daki koruma politikası sonrasında eski/önbellekteki sayfa kayıt yapamaz; web dosyalarını hemen birlikte yayımlayın ve kullanıcıları yenilemeye yönlendirin.
6. `form.html`, `admin.html`, `loader-photo.js` ve bu sayfalardaki diğer mevcut JS/CSS bağımlılıklarını birlikte yayımlayın.
7. Supabase Extensions bölümünden `pg_cron` ve `pg_net` etkinleştirin. Ardından `supabase/loader-photo-schedule.sql` dosyasını çalıştırın. Görev saat başından 15 dakika sonra çalışır. Aynı adlı görev yeniden zamanlanabilir.
8. Aşağıdaki kabul kontrolleri geçmeden kurulumu tamamlanmış saymayın.

## Kabul kontrolleri

- Test raporu: gerçek telefondan fotoğraf çek/seç, önizleme, onay, kaydet; admin fotoğrafı açabilsin.
- Ağ bağlantısı kesilince başarı ekranı çıkmasın; tekrar denemede tek rapor oluşsun.
- Farklı loder seçilince eski fotoğraf temizlensin. Dosya değiştirilince yine tek fotoğraf olsun.
- Admin rapor düzenlemesi sonrası `meter_photo_id` ve `submission_id` korunsun.
- Anonim kullanıcı bucket'tan fotoğraf okuyamasın; normal kayıtlı ama admin olmayan kullanıcı da okuyamasın.
- Test ortamında süreyi geçmiş bir **test** kaydıyla cleanup doğrulansın: dosya silinsin, metadata `deleted` olsun, rapor kalsın. Üretim fotoğrafları bu test için kullanılmamalı.
- Cron çalışması ve HTTP yanıtı ayrı ayrı kontrol edilsin. `pg_net` isteği kuyruğa aldığında Cron başarılı görünebilir; bu, Edge Function'ın başarılı olduğu anlamına gelmez. HTTP `503` veya `failed > 0` yeniden deneme gerektirir.

```sql
select jobname, schedule, active from cron.job
where jobname='loader-meter-photo-retention';

select status, count(*) from public.loader_meter_photos group by status;

select count(*) as overdue from public.loader_meter_photos
where status <> 'deleted' and expires_at < now() - interval '2 hours';
```

Storage nesnelerini SQL `DELETE` ile kaldırmayın; fiziksel dosyayı silmek için Storage API gerekir. Kurulum yaklaşımı [Supabase silme](https://supabase.com/docs/guides/storage/management/delete-objects) ve [Cron/Edge Function](https://supabase.com/docs/guides/functions/schedule-functions) belgelerine dayanır.

## Yerel test

`npm test` şema/RLS, tekrar gönderme, silme hatası ve wizard kontrollerini içerir. `tests/photo-preview.html` canlıya veri göndermeden tarayıcıda gerçek JPEG sıkıştırma ve önizlemeyi çalıştırır. Bu testler gerçek Supabase Storage/Auth ve iPhone kamera kabul testinin yerine geçmez.
