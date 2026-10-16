# Madenci Web Data

Statik form portalı (`form.html`) ve admin paneli (`admin.html`).

## Loder sayaç fotoğrafı

Manuel saat yerine tek fotoğraflı wizard adımı, özel Storage ve 3 takvim aylık otomatik silme altyapısı eklendi. **Canlı kurulum henüz yapılmadı.** Kurulum sırası ve kabul kontrolleri: [LOADER-PHOTO-SETUP.md](LOADER-PHOTO-SETUP.md).

Yerel fotoğraf testi: `http://127.0.0.1:8765/tests/photo-preview.html` (sunucuya veri göndermez).

## Dinamik form oluşturucu

Admin panelindeki **Formlar** bölümü yeni, sürümlü formları yönetir:

- Alanı tıklayarak veya sürükleyerek ekleme; düğmelerle sıralama.
- Ortak isim, soyisim ve tarih; metin, sayı, miktar/birim, seçenek, kayıtlı liste ve tekrarlanan grup.
- Taslak kaydetme, gerçek wizard motoruyla önizleme, yeni sürüm yayımlama.
- Taslağı silme; yayımlanmış formu geçmiş raporları silmeden arşivleme.
- **Seçim listeleri**: Araçlar gibi bir liste oluşturup kayıt adı ve türü ekleyin. Örneğin “Kamyon 7 / Kamyon”. Forma eklenen liste alanı ister bütün türleri ister yalnızca Kamyon türünü gösterebilir.
- **Yeni form raporları**: form, rapor tarihi ve yanıt metnine göre sunucu tarafında filtreleme; sürüme bağlı ayrıntılar ve sayfalama.

### Koşul ve tekrarlanan grup

“Bu alan ne zaman görünsün?” isteğe bağlıdır. Koşul bir önceki seçenek sorusunun belirli cevabına bağlanır: “Delgi tipi = Ayna” ise patlayıcı alanını göster. Koşulsuz alan için “Her zaman göster” seçilir. Grup içindeki koşullar aynı grubun önceki sorularına bağlanır. Bağlı soru kaldırılırsa veya sırası bozulursa yayımlama doğrulaması bunu engeller.

Tekrarlanan grup, kullanıcıya **Satır ekle / Satırı kaldır** sunar. Örneğin Malzeme + Miktar/birim + Araç alanları tek grupta tutulur; her satır bir malzeme tüketimidir. En fazla 50 satır vardır; iç içe gruplar henüz desteklenmez.

### Kurulum ve geçiş durumu

1. Mevcut Supabase projesinde `public.is_admin()` fonksiyonunun çalıştığını doğrulayın.
2. Önce veritabanı yedeği alın. `supabase/migrations/20261012172918_dynamic_forms.sql` dosyasını SQL Editor'de **bir kez** çalıştırın (veya mevcut migration iş akışınızla uygulayın). Bu migration tekrar çalıştırılabilir bir onarım betiği değildir.
3. `admin.html`, `form.html`, `dynamic-forms.js`, `dynamic-forms.css`, `form-builder.js`, `form-portal.js` dosyalarını birlikte yayımlayın.
4. Admin → Formlar → Seçim listeleri → liste ve kayıtları tanımlayın. Sonra Form oluştur → alanları düzenle → Önizle → Taslağı kaydet → Yeni sürümü yayımla.
5. Portalda yeni raporu doldurup adminin Yeni form raporları bölümünden kontrol edin. Kurulum öncesinde ek formlar için hata/yeniden dene mesajı çıkabilir; eski formlar buna bağımlı değildir.

**Mevcut dört form ve `entries` raporları henüz yeni motora taşınmadı.** Hazır lokasyon, kategori, malzeme, loder ve delgi tipi listeleri yeni oluşturucudan doğrudan kullanılabilir. `20261016160729_shared_form_catalog.sql` migration'ı web dosyalarından önce uygulanmalıdır. Kayıtlar kopyalanmaz; security-invoker görünümleri mevcut RLS izinleriyle kaynak tabloları okur. “Kayıtlı listeden seçim → Kaynak liste → Hazır” yoluyla seçilir; malzemeler kategoriye göre filtrelenebilir. Hazır listeler mevcut Admin Panelinden yönetilir.

Özel listelerde “Listeyi kaldır” ve “Kaydı kaldır” işlemleri geri alınabilir arşivlemedir. Kaldırılanlar normal listeden ve yeni seçimlerden gizlenir; “Kaldırılan listeleri ve kayıtları göster” ile geri getirilebilir. Geçmiş raporlardaki etiketler korunur. Zorunlu bir listeyi kaldırmadan önce bu listeyi kullanan yayımlanmış formları güncelleyin; aksi halde yeni kayıt tamamlanamaz. Fiziksel silme yapılmaz.

16 Ekim 2026: `shared_form_catalog` migration'ı canlı `cxvrcqkkxfblpxzynfya` projesine CLI SQL sorgusuyla uygulandı; anonim rol ile kaynak liste erişimleri doğrulandı. Migration geçmişine otomatik işlenmediğinden dosyayı yeniden çalıştırmayın; toplu `db push` öncesinde geçmiş eşleştirilmelidir.

Yayımlanan tanımlar değiştirilemez; düzenleme yeni sürüm oluşturur. Kullanıcı eski bir sürümü doldururken form yeniden yayımlanırsa kayıt reddedilir ve yeniden açması istenir. Liste adı/etiketi değişirse geçmiş raporda kayıt anındaki etiket korunur. Listeler ve yayımlanmış form tanımları halka açıktır; yanıtları yalnızca admin okuyabilir. Anonim yazma mevcut portal kullanımına uygundur; yüksek trafikte sunucu tarafı bot/rate-limit koruması ayrıca planlanmalıdır.

### Test ve yerel önizleme

```sh
npm ci
npm test
python3 -m http.server 8765 --bind 127.0.0.1
```

- `http://127.0.0.1:8765/tests/preview.html`: canlı veriye bağlanmayan oluşturucu önizlemesi; kayıt/yayımlama kapalıdır.
- `http://127.0.0.1:8765/tests/mobile-preview.html`: 390 px iframe viewport ile dar ekran testi.

Testler jsdom ile wizard/oluşturucu davranışını, PGlite ile gerçek PostgreSQL şemasını ve anon/normal kullanıcı/admin RLS ayrımını doğrular. Testteki `is_admin()` bir test ikamesidir; canlı Auth/PostgREST ve gerçek telefon testi yerine geçmez. Canlı migration ve yayımlama ayrıca doğrulanmalıdır.
