# ADR — SABİT RADAR / EDS VERİ KAYNAĞI (ölçüm turu, 2026-08-13)

> **DURUM: ÖLÇÜM TAMAMLANDI — KARAR: OSM TEK BAŞINA YETERSİZ (birincil kaynak OLAMAZ).**
> Bu belge yalnız **ölçer ve karar verir**. Kod yazılmadı, Guardian
> `SPEED_CAMERA_WARNING` kuralına ve G1/G3 dosyalarına **dokunulmadı**.
>
> Vizyon bağlamı: `docs/CAROS_PRO_VIZYONU.md` §"ÜRÜN SÖZÜ" — *"CAROS PRO kullanan
> biri radara yakalanmamalı"* ve `SPEED_CAMERA_WARNING`'in **boş yuva** kararı
> (2026-08-09).
>
> **Kapsam dışı (bilerek):** mobil radar / topluluk bildirimi (statik veri olarak
> hiçbir kaynakta yok, ayrı ve büyük iş) · ticari lisans görüşmeleri (Başarsoft
> vb. — iş tarafı, kod işi değil).

---

## 0. ÖZET (üç cümle)

1. **Ölçüldü, tahmin edilmedi:** Overpass üzerinden gerçek sorgularla Türkiye
   sınırı içinde **730 `highway=speed_camera` nodu** ve **30 `type=enforcement`
   ilişkisi** sayıldı (veri damgası **2026-08-13**).
2. **Kapsam şehre göre uçurum gibi değişiyor:** İstanbul **182**, buna karşılık
   Mersin ili **4**, Adana ili **0**. Test rotamızın kalbi olan
   **Mersin merkez → Tarsus koridorunda SIFIR nokta** var — oysa o hat kamuya
   açık kaynaklarda TEDES/sabit radar bakımından "çok aktif" diye anılıyor.
3. **Etiket kalitesi de aynı uçurumu izliyor:** ülke genelinde kameraların
   yalnız **%48'inde hız limiti**, **%32'sinde yön** var — yön yoksa karşı
   şeritteki radar için **yanlış uyarı** üretilir; bu, uyarıyı güvenlik
   davranışı olmaktan çıkarır.

**Karar:** OSM, **ücretsiz taban katman** olarak değerlidir ama **ürün sözünü
tek başına taşıyamaz**. Kapsamı doğrulanmış ikinci bir kaynak (ticari lisans
veya üretici/filo müşterisinin kendi paketi) **zorunludur**. Yuva boş kalmaya
devam eder; OSM ile "yarı dolu" gösterilmez.

> **EK — İKİNCİ TUR (aynı gün, §6-B):** özellik "olmazsa olmaz" ilan edildiği
> için aday kaynaklar arandı **ve sayıldı**: **SCDB.info 2 266** · **EGM resmî
> 1 503** · OSM 730 nokta (TomTom'un ülke listesinde **Türkiye yok**; Başarsoft
> ve Lufop ölçülemedi). En sert bulgu: **EGM ile OSM yalnız %10 örtüşüyor** —
> yani tek kaynak asla tam olmayacak, birleştirme katmanı ve tekilleştirme
> **zorunlu**. Önerilen sıra: **EGM (protokolle) → Başarsoft → SCDB → OSM
> (çapraz doğrulama)**.

---

## 1. NEDEN BU ÖLÇÜM

`SPEED_CAMERA_WARNING` kuralı kodda var, **veri yok** (vizyon §"Silme kararları
iptal", 2026-08-09: boş yuva). Yuvayı doldurmadan önce cevaplanması gereken tek
soru şuydu:

> **Ücretsiz tek aday olan OSM'de gerçekten kaç sabit radar var ve o veriden
> bir UYARI kararı üretilebilir mi?**

"Büyük ihtimalle vardır" cevabı bu projede kabul edilmez (`AI.md` · kanıt kuralı).
Bu yüzden gerçek sorgu atıldı ve sayıldı.

---

## 2. YÖNTEM

| Öğe | Değer |
|---|---|
| Kaynak | OpenStreetMap, Overpass API |
| Uç noktalar | `overpass-api.de` (birincil) · `overpass.private.coffee` · `overpass.kumi.systems` (yedek) |
| Ölçüm tarihi | 2026-08-13 |
| Veri anlık görüntüsü | `timestamp_osm_base` her sonuçta okundu ve rapor edildi |
| Aranan etiketler | `highway=speed_camera` (node/way) · `type=enforcement` ilişkileri (`enforcement=maxspeed`, `average_speed`, …) |
| İl sınırı | `area["name"=…]["admin_level"="4"]` (bbox değil — il sınırı gerçek poligon) |
| Ülke sınırı | `area["ISO3166-1"="TR"]["admin_level"="2"]` |

> ⚠️ **Ölçüm tuzağı (yaşandı, kayda geçiyor):** aynalar farklı tarihli anlık
> görüntü servis ediyor. `overpass.kumi.systems` bu oturumda **2026-06-01**
> tarihli veri döndürdü, resmi uç nokta **2026-08-13**. Aradaki fark gerçek
> sayıları değiştirdi (Ankara 38 → 47, Adana 0 → 0 ama ilişki farklı). **Her
> sonuçta `timestamp_osm_base` okunmadan sayı raporlanamaz.** Bu, adres arama
> teşhisinde de yaşadığımız "ayna 200 + boş döndü" tuzağının aynısıdır.

Aşağıdaki tüm sayılar **2026-08-13 damgalı** anlık görüntüden alınmıştır.

---

## 3. ÖLÇÜM SONUÇLARI

### 3.1 Küçük bölge — Tarsus / Mersin hattı (kabul ölçütü #1)

**Sorgu A — geniş bbox** `(36.60, 34.30) – (37.10, 35.10)`:

| Sonuç | Sayı |
|---|---|
| `highway=speed_camera` | **4** |
| `enforcement` ilişkisi | **0** |
| Hız limiti (`maxspeed`) taşıyan | **0** |
| Yön (`direction`) taşıyan | **0** |

Dört nokta aslında **iki fiziksel konumun** çift kaydı (~10–15 m arayla ikişer
node): `36.6892/34.4297` ve `36.6336/34.3447` — ikisi de Mersin'in **batısında**
(Mezitli–Erdemli yönü D-400). Etiketleri **yalnız** `highway=speed_camera`;
başka hiçbir bilgi yok.

**Sorgu B — dar koridor** Mersin merkez → Tarsus `(36.70, 34.55) – (37.00, 34.95)`:

| Sonuç | Sayı |
|---|---|
| Toplam eleman | **0** |

> **Bu, ölçümün en sert bulgusudur.** Konya→Tarsus saha koşumumuzun bittiği,
> günlük kullanılan ve kamuya açık kaynaklarda "TEDES ve sabit radar kameraları
> çok aktif" diye anılan koridorda OSM'de **hiçbir kamera kaydı yok**.

**Mersin ili tamamı** (il sınırı poligonu): **4 kamera · 0 enforcement ilişkisi**
— yani ildeki tüm kayıt, yukarıdaki iki konumdan ibaret.

### 3.2 Büyük şehir — İstanbul (kabul ölçütü #2)

| Sonuç | Sayı | Oran |
|---|---|---|
| `highway=speed_camera` | **182** | — |
| `maxspeed` taşıyan | 158 | %87 |
| `direction` taşıyan | 126 | %69 |
| `enforcement` ilişkisi | 2 | — |

İstanbul hem **sayıca** hem **etiket kalitesi** bakımından ülkenin en iyi
kapsanan ili. Yön ve hız limiti üçte ikiden fazla noktada mevcut — yani burada
gerçekten bir uyarı kararı üretilebilirdi.

### 3.3 Sekiz il karşılaştırması (hepsi 2026-08-13 damgalı)

| İl | Kamera | `maxspeed` | `direction` | enf. ilişki | Kamera / milyon nüfus |
|---|---:|---:|---:|---:|---:|
| İstanbul | **182** | 158 | 126 | 2 | 11,4 |
| İzmir | 55 | 11 | 10 | 1 | 12,5 |
| Antalya | 50 | 11 | 2 | 2 | 18,5 |
| Ankara | 47 | 24 | 22 | 1 | 8,1 |
| Konya | 18 | 11 | 0 | 6 | 7,8 |
| Bursa | 12 | 0 | 0 | 0 | 3,8 |
| **Mersin** | **4** | 0 | 0 | 0 | 2,1 |
| **Adana** | **0** | 0 | 0 | 1 | 0,0 |

> **Adana ili — 2,3 milyon nüfus, 0 sabit radar kaydı.** Bu sayı taze uç
> noktadan iki kez teyit edildi. Kapsamın **gönüllü ve düzensiz** olduğunun en
> net kanıtı: eksiklik "az radar var" demek değil, **"kimse haritalamamış"**
> demek.

### 3.4 Türkiye geneli

| Sonuç | Sayı |
|---|---|
| TR sınırı içi `highway=speed_camera` | **730** |
| TR sınırı içi `type=enforcement` ilişkisi | **30** |
| Bunlardan `enforcement=average_speed` (ortalama hız koridoru) | 16 |
| `enforcement=maxspeed` | 6 |
| Diğer / etiketsiz (`access`, `check`, `traffic_signals`, boş) | 8 |
| `maxspeed` taşıyan kamera | 351 (**%48**) |
| `direction` taşıyan kamera | 230 (**%32**) |
| `name` taşıyan kamera | 10 (%1,4) |

Karşılaştırma için aynı sorgu Türkiye **bbox'ında** (komşu ülke sınır bölgeleri
dahil) 1361 nokta döndürdü — yani sayının yarısı Türkiye dışındandır. **bbox ile
ülke ölçmek yanıltır**; il/ülke ölçümleri poligonla yapıldı.

### 3.5 Etiket kalitesi — asıl kısıt

Guardian'ın bir uyarı **kararı** üretmesi için üç bilgi gerekir: **konum · yön ·
hız limiti**. OSM'de:

| Bilgi | Kapsam (TR) | Karara etkisi |
|---|---|---|
| Konum | %100 | var |
| Hız limiti | %48 | "hangi hızın üstünde uyaracağız" bilinmiyor |
| Yön | %32 | **karşı şeritteki radar için yanlış uyarı** riski |
| Kamera tipi (`camera:type`) | %0,2 | hız mı, kırmızı ışık mı, ayırt edilemez |
| Ortalama hız koridoru bağlantısı | 16 ilişki | koridor girişi/çıkışı çoğu yerde modellenmemiş |

Yön bilgisi olmayan bir noktadan üretilen uyarı, iki yönlü bir yolda **%50
olasılıkla yanlıştır**. Yanlış uyarı, uyarı sisteminin güvenilirliğini bir kez
kırdıktan sonra doğru uyarıyı da öldürür — bu, "8 Kapı"nın (1) *doğru mu?*
kapısında düşer.

### 3.6 Tazelik ve katkıcı tabanı

`out meta` ile 717 nodun düzenleme geçmişi (2026-06-01 anlık görüntüsü):

| Ölçü | Değer |
|---|---|
| Son düzenleme yaşı p10 / **p50** / p90 | 157 gün / **984 gün (~2,7 yıl)** / 2594 gün (~7,1 yıl) |
| 2024–2026 arası düzenlenmiş | 353 (%49) |
| 2019 ve öncesi düzenlenmiş | 90 (%13) |
| Farklı katkıcı sayısı | **81** |
| En büyük katkıcının payı | 185 nokta (**%26**) |

**Yorum:** ülke çapındaki radar verisinin dörtte biri **tek bir gönüllüye**
bağlı ve medyan kayıt **~2,7 yıldır dokunulmamış**. Radar noktaları idari
kararla eklenip kaldırılan bir envanterdir; 2,7 yıllık medyan tazelik, kaldırılmış
bir radar için "hâlâ var" demeye ve yeni kurulan için sessiz kalmaya yeter.

### 3.7 Ortalama hız koridorları (EDS) — küçük ama nitelikli

30 ilişkinin 16'sı `average_speed`. Bunların bir kısmı gerçekten kaliteli:

```
"Kuruçeşme Ortalama Hız Uygulaması - Ankara Yönü"  maxspeed=70/bus 70/hgv 70
Konya çevresi (4 ilişki)                            maxspeed=82/bus 70/hgv 70/minibus 82
Gaziantep çevresi (8 ilişki)                        maxspeed=70–80, araç sınıfına göre ayrı
```

Yani **araç sınıfına duyarlı hız limiti** (`maxspeed:hgv`, `maxspeed:bus`,
`maxspeed:minibus`) OSM'de mevcut ve bizim #388–390'da kurduğumuz **yol + araç
sınıfı** modeliyle birebir uyumlu. Ama **16 koridor**, ülke çapı için sembolik
bir sayıdır.

Not: bazı `enforcement` ilişkilerinde açıkça `"Mobil jandarma hız kamerası. Her
zaman burada değil."` açıklaması var — yani OSM'deki bazı kayıtlar **sabit
değil**, ürün açısından zaten kullanılamaz.

---

## 4. KAMU REFERANSLARIYLA KABA KARŞILAŞTIRMA

> ⚠️ Bu bölüm **kaba bir büyüklük kontrolüdür**. Karşılaştırılan sayılar haber
> ve üçüncü taraf derleme sitelerinden gelir; resmi envanter değildir. EGM'nin
> resmi sabit radar haritası (`onlineislemler.egm.gov.tr`) kamuya açıktır ama
> **toplam sayı yayınlamaz**, bu yüzden birebir doğrulama yapılamadı.

| Referans | Kamuya açık sayı | OSM ölçümü | Yorum |
|---|---|---|---|
| Kuzey Marmara Otoyolu (O-7) | listelenen **7–8** sabit nokta | O-7 güzergâhına 250 m yakınlıkta **7** kamera | **Büyüklük sınıfı tutuyor.** Birebir eşleşme **doğrulanmadı** (O-7 ilişkisine bağlanan bazı segmentler şehir içi bağlantılarda; noktaların aynı noktalar olduğu kanıtlanmadı) |
| İstanbul | UKOME kararıyla **128 yeni** EDS noktası (mevcutlara ek) | **182** kamera | Aynı büyüklük sınıfı; OSM İstanbul'da makul |
| Mersin–Tarsus D-400 | kaynaklarda "TEDES ve sabit radar çok aktif" | **0** | **Uçurum.** OSM bu koridoru hiç bilmiyor |
| Adana ili | il merkezinde EDS listeleri mevcut | **0** | **Uçurum** |

**Çıkarım:** OSM kapsamı **büyük şehirde gerçekçi, taşrada ve ana karayolu
koridorlarında gerçek dışı**. Bu tam da ürünün en çok ihtiyaç duyduğu yerde
(şehirler arası yol, uzun sürüş, yorgunluk) en zayıf olduğu anlamına gelir.

---

## 5. LİSANS

| Kaynak | Lisans | Ticari gömme | Yükümlülük |
|---|---|---|---|
| OpenStreetMap (radar noktaları dahil) | **ODbL 1.0** | ✅ serbest | atıf + türev veritabanı paylaşımı |

`docs/ADR_OFFLINE_ROUTING.md` §2 ile **aynı çerçeve**, iki ek notla:

1. **Atıf zorunlu:** `© OpenStreetMap katkıcıları`. Zaten harita için verdiğimiz
   atıf bu veriyi de kapsar; **ek maliyet yok**.
2. **Türev veritabanı:** radar noktalarını cihaza gömülü bir paket olarak
   dağıtırsak o paket ODbL'e tabidir. Uygulama kodu etkilenmez (*produced work*).
   Çevrimdışı rota paketi zaten ODbL beyanıyla dağıtılacak → **ek maliyet yok**.
3. **🔴 KARIŞTIRMA TUZAĞI (yeni, bu ADR'ye özgü):** OSM radar noktalarını
   **ticari bir kaynakla (Başarsoft vb.) TEK bir veritabanında birleştirmek**,
   ortaya çıkan veritabanını ODbL'in *derivative database* tanımına sokar ve
   **share-alike** yükümlülüğünü ticari veriye bulaştırma riski doğurur —
   bu, ticari sağlayıcının sözleşmesiyle çelişir. Katmanlar **ayrı veritabanı
   olarak tutulur** (ODbL'de *collective database*), çalışma zamanında
   birleştirilir, tek dosyada karıştırılmaz. Bu, ileride ikinci kaynak
   eklenirse **mimari bir şart**tır, tercih değil.

---

## 6. KARAR

> ### OSM, sabit radar için **taban katmandır — birincil kaynak DEĞİLDİR**.
> ### Yuva, ikinci kaynak gelmeden **boş kalmaya devam eder**.

Gerekçe (ölçülmüş, üçü de):

1. **Kapsam yetersiz ve düzensiz:** ülke genelinde 730 nokta; Mersin 4, Adana 0,
   Mersin–Tarsus koridoru 0. Ürünün vaadi "şehirde işe yarar, yolda susar"
   olamaz — bu, sessiz "risk yok" demenin kılık değiştirmiş hâlidir.
2. **Karar üretmeye yetmiyor:** yön %32, hız limiti %48. Yön olmadan üretilen
   uyarı iki yönlü yolda yarı yarıya yanlıştır; kamera tipi %0,2 → hız radarı
   ile kırmızı ışık kamerası ayrılamıyor.
3. **Tazelik garantisi yok:** medyan son düzenleme **~2,7 yıl**, ülke verisinin
   %26'sı tek gönüllüde. Kaldırılmış radar için uyarı vermek de, yeni radarı
   kaçırmak da ürün sözünü bozar.

**Bunun anlamı — açıkça:**

- OSM verisiyle `SPEED_CAMERA_WARNING` yuvası **doldurulmaz**. Kısmi veriyle
  çalışan bir radar uyarısı, çalışmadığı yerde kullanıcıya **yanlış güven**
  verir (P0 sınıfı hata: vizyon §"P0 — Yanlış güven / güvenlik").
- OSM **tamamen çöpe de atılmaz**: ikinci kaynak geldiğinde **çapraz doğrulama
  ve boşluk tespiti** için ücretsiz ikinci gözdür (ticari kaynağın kaçırdığı
  noktayı OSM yakalarsa bu bir kapsam sinyalidir). Ayrıca `average_speed`
  koridorlarındaki **araç sınıfına duyarlı** hız limitleri, mevcut yol+araç
  sınıfı modelimizi besleyebilecek nitelikte.
- **İkinci kaynak ZORUNLU.** Ticari lisans (iş tarafı) veya üretici/filo
  müşterisinin kendi lisansıyla taktığı paket (PID Pack deseni) — vizyondaki
  "boş yuva" kararı bu ölçümle **doğrulanmış** oldu, değiştirilmedi.

**Kapsam kabul eşiği (ikinci kaynak değerlendirilirken uygulanacak):**
bir kaynağın "yeterli" sayılması için, bu ADR'nin ölçtüğü dört bölgede
(Mersin–Tarsus koridoru · Mersin ili · Adana ili · İstanbul) **her birinde
kamuya açık referansla aynı büyüklük sınıfında** nokta sayısı vermesi ve
noktalarının **≥%90'ında yön + hız limiti** taşıması gerekir. OSM bu eşiğin
dördünde de düşer.

---

## 6-B. KAYNAK AVI — İKİNCİ TUR (2026-08-13, aynı gün)

> **Neden:** özellik "olmazsa olmaz" ilan edildi. Bu bölüm **aday kaynakları
> arar ve ölçer** — "vardır herhalde" yok, her aday için Türkiye'de **sayılmış
> nokta** var (ölçülemeyenler açıkça öyle yazıldı).

### 6-B.1 Ölçülen adaylar

| Kaynak | TR nokta sayısı | Nasıl ölçüldü | Hız limiti | Yön | Güncelleme | Lisans / erişim |
|---|---:|---|---|---|---|---|
| **SCDB.info** | **2 266** | 46 liste sayfası indirilip sayıldı (494 farklı yer adı) | satın alınca (POI dosyasında) | satın alınca | **günlük** | **ticari**; iGO/TomTom/Garmin **OEM formatları var**; bireysel 9,95 € · B2B teklif gerekir |
| **EGM (resmî)** | **1 503** | `EDSHarita.aspx` sayfasına gömülü `markers` dizisi ayrıştırıldı | **YOK** (%0,5) | serbest metinde %56 ("…istikametine", "Giriş/Çıkış") | **30 dk** (site iddiası) | **belirsiz — hukuki izin gerekir** |
| **OpenStreetMap** | **730** | Overpass (§3) | %48 | %32 | sürekli, ama medyan kayıt 2,7 yıllık | **ODbL** — ücretsiz |
| **Lufop.net** | ölçülemedi | site 403 verdi (Cloudflare); API anahtarı form ile | ? | ? | günlük (iddia) | "ücretsiz ve açık API", 40 ülke **TR dahil**; şartlar formdan sonra |
| **Başarsoft** | ölçülemedi (ticari) | — | ? | ? | ? | **ticari**; Google Maps / Garmin / iGO'nun **Türkiye veri ortağı**; ürününde **EDS kamerası + seyyar radar katmanı** var |
| **TomTom Speed Camera** | **kapsam dışı görünüyor** | ürün sayfasındaki 50+ ülke listesinde **Türkiye YOK** | — | — | gerçek zamanlı | ticari (Hyundai/Renault/Stellantis müşterileri) |
| **HERE Safety Cameras** | belirsiz | ülke listesi dokümanı taşınmış; DE/LI/CH yasal kısıtlı | — | — | — | ticari |

### 6-B.2 EGM resmî verisi — en önemli bulgu

EGM'nin kamuya açık EDS haritası (`onlineislemler.egm.gov.tr/trafik/Sayfalar/EDSHarita.aspx`)
noktaları **sayfanın kendi HTML'ine gömülü** olarak yayınlıyor:

```js
var markers = [
  { "Aciklama": '31019 / Laiklik Cad. Büyükkılıçlı SİLİVRİ Büyükkılıçlı-D100 istikameti',
    "lat": '41.16418', "lng": '28.189972' }, ...
```

Ölçülen: **1 503 nokta**, tüm ülke (lat 36,17–41,60 · lng 26,40–41,75).
İstanbul bbox'ında **473** (OSM'de 182), Adana bbox'ında **85** (OSM'de **0**).

**Ama bu veri "hazır" değil:**
- **Hız limiti yok** (1 503 kaydın yalnız 8'inde bir km değeri geçiyor) → uyarı
  eşiği bu veriden türetilemez, yolun kendi hız limitiyle birleştirilmesi gerekir.
- **Yön yapılandırılmamış**: "…Sirkeci istikametine", "…Giriş / Çıkış" gibi
  **serbest metin** (%56). Ayrıştırılabilir ama **ayrıştırma bir tahmindir**.
- **Ortalama hız koridorları var**: "(Başlangıç)/(Bitiş)" çiftleri (380 kayıt) →
  koridor modellemesi mümkün.
- **Hukuki durum belirsiz:** sayfada kullanım şartı bağlantısı yok, `robots.txt`
  yok. **Teknik engelin olmaması izin demek değildir.** Doğru yol, EGM'den
  **resmî veri paylaşım talebi/protokolü**dür — bu bir iş/hukuk adımıdır, kod adımı değil.

### 6-B.3 🔴 Kaynaklar birbirini DOĞRULAMIYOR (bu turun en sert bulgusu)

EGM'nin 1 503 noktası ile OSM'in 730 noktası 200 m yarıçapla eşleştirildi:

| Ölçüm | Sonuç |
|---|---:|
| EGM noktalarından OSM'de karşılığı olan | **150 / 1 503 = %10,0** |
| OSM noktalarından EGM'de karşılığı olan | **136 / 730 = %18,6** |
| EGM biliyor, OSM bilmiyor | **1 353** |
| OSM biliyor, EGM bilmiyor | **594** |

İki kaynak **neredeyse ayrık kümeler**. Bunun iki okuması var ve ikisi de bizi
bağlar:

1. **Farklı şeyleri sayıyorlar.** EGM listesi ağırlıkla şehir içi EDS / kırmızı
   ışık / ortalama hız koridorları; OSM gönüllüleri ağırlıkla otoyol hız
   kameralarını işaretlemiş. → **Tek kaynak asla tam olmayacak.**
2. **İkisi de eksik.** → Aynı sonuç.

**Mimari sonuç:** "iki kaynağı birleştiririz" cümlesi kolay ama **%10 örtüşmede
tekilleştirme (dedupe) başlı başına bir iştir**: aynı fiziksel kamerayı iki
kaynak farklı koordinatta, farklı isimle, farklı tipte gösteriyor. Birleştirme
katmanı **kaynak önceliği + mesafe eşiği + tip uyumu** ile tasarlanmalı, yoksa
sürücüye **aynı radar için iki kez** uyarı çalar.

### 6-B.4 Mersin–Tarsus koridoru: üç kaynak da boş

| Kaynak | Mersin merkez → Tarsus koridorunda |
|---|---:|
| OSM | 0 |
| EGM (resmî) | **0** (Mersin ilinde hiç kayıt yok; en yakınlar Adana'da) |
| SCDB.info | 0 (Mersin/Tarsus şehir kaydı yok; Erdemli 2 · Silifke 2 · Tarsus–Ankara Otoyolu'nda 3) |

**Bu, §3.1'deki "OSM bilmiyor" yorumunu düzeltir.** Üç bağımsız kaynağın üçü de
boşsa iki ihtimal kalır: (a) o koridorda **sabit** radar gerçekten yok — kamuya
açık haberlerdeki "TEDES aktif" ifadesi **belediye TEDES'ini** veya **mobil**
denetimi anlatıyor olabilir; (b) üçü de aynı boşluğu taşıyor. **Bu ancak sahada
gözle ayrılır** — sen o yolu sürüyorsun; Mersin–Tarsus D-400'de direk üstünde
**sabit kamera kutusu** görüyor musun, yoksa kenarda **mobil radar aracı** mı?
Bu tek gözlem, hangi ihtimalin doğru olduğunu söyler.

### 6-B.5 Önerilen sıra (karar vericiye)

| Sıra | Kaynak | Neden | Sonraki adım |
|---|---|---|---|
| **1** | **EGM resmî veri — protokolle** | Tek **otoriter** kaynak; 30 dk tazelik; ülkenin tamamı; ücret ihtimali düşük | EGM'ye **kurumsal veri paylaşım başvurusu**. Onay gelmeden veri **kullanılmaz** |
| **2** | **Başarsoft** | Türkiye'nin ana harita sağlayıcısı; EDS **+ seyyar radar** katmanı; Google/Garmin/iGO ortağı → OEM lisans deneyimi var | Zaten süren görüşmede **§6 kapsam eşiğini** teklif şartı yap |
| **3** | **SCDB.info** | **Ölçülen en yüksek kapsam (2 266)**; günlük güncelleme; hazır OEM formatları; maliyet muhtemelen en düşük | B2B/OEM teklifi iste + **örnek veri** iste (dört test bölgesi) |
| **4** | **OSM** | Ücretsiz **çapraz doğrulama** ve boşluk tespiti; `average_speed` koridorlarında araç sınıfına duyarlı limitler | Birincil kaynak seçildikten sonra **ikinci göz** olarak bağlanır |
| — | TomTom / HERE / Lufop | TR kapsamı **doğrulanmadı** (TomTom listesinde Türkiye yok) | Kapsam yazılı teyit edilmeden aday değil |

> **Her teklif aynı testle ölçülecek:** sağlayıcıdan dört bölge için **nokta
> sayısı + örnek kayıt** istenir (Mersin–Tarsus koridoru · Mersin ili · Adana ili ·
> İstanbul) ve kayıtlarda **yön + hız limiti oranı** sorulur. Bu ADR'nin ölçtüğü
> sayılar **pazarlık masasının referansıdır**: bir sağlayıcı Adana'da 85'ten az
> nokta veriyorsa EGM'nin kamuya açık verisinden geridedir.

---

## 6-C. BÜTÇE KARARI (2026-08-13 — sahibinin kararı, bağlayıcı)

> **Karar: bugün radar verisine para harcanmayacak.** Ürünün henüz geliri yok;
> ticari veri lisansı **gelir geldiğinde** alınacak ve o noktada "tam donanım"
> radar özelliği yapılacak. Bu, ADR §6'nın kararını **iptal etmez** — sırasını
> belirler.

### Bunun doğrudan sonuçları

| Konu | Bugünkü hüküm |
|---|---|
| Başarsoft / SCDB / HERE / TomTom teklifleri | **ERTELENDİ** — teklif metinleri (`docs/RADAR_VERI_TEKLIF_TALEBI_TASLAKLARI.md`) gelir oluşunca kullanılmak üzere **hazır bekliyor** |
| `SPEED_CAMERA_WARNING` yuvası | **BOŞ KALIR** — bu, bütçe kısıtının değil, ADR §6'nın zaten verdiği karar. Bütçe kararı onu yalnız **pekiştirir** |
| Radar kodu yazmak | ~~YASAK~~ → **AÇILDI (§6-D):** kaynak seçildi (EGM), şema sabitlendi → kod yazılabilir |
| Ürün sözü ("radara yakalanmaz") | **KULLANILMAZ** — pazarlama/satış malzemesinde bu vaat **verilemez**. Veri yokken verilen söz, satış sonrası sorumluluk doğurur |

### Sıfır maliyetli yollar (isteğe bağlı, para değil **zaman** ister)

Bunlar bugün de yapılabilir; hiçbiri kod işi değildir, ikisi de **sahibinin
kendi başlatması gereken** adımlardır:

| Yol | Maliyet | Beklenen | Risk |
|---|---|---|---|
| **EGM'ye yazılı izin talebi** (CİMER / bilgi edinme) | 0 ₺ · 30 gün yanıt süresi | Ülkenin en otoriter verisi (1 503 nokta, 30 dk tazelik) | Ticari kuruluşa tanımlı kanal yok — "hayır" gelebilir |
| **Lufop API anahtarı** (form) | 0 ₺ · birkaç gün | TR kapsamı ölçülür (şu an **bilinmiyor**) | Kapsam düşük çıkabilir; ticari kullanım şartı okunmalı |
| **OSM** | 0 ₺ | 730 nokta, ölçüldü | Tek başına yetersiz (§6) |

> Bu üç yol **birlikte bile** ADR §6'daki kapsam eşiğini geçmez. Yani ücretsiz
> yollarla özellik **yapılabilir ama söz verilemez** — kapsamın eksik olduğu
> açıkça yazılmadan sunulmaz.

### Yeniden değerlendirme tetikleyicisi

Bu ADR **gelir oluştuğunda** yeniden açılır. Somut tetikleyici: **ilk ticari
head unit siparişi** veya **ilk ödemeli filo müşterisi**. O gün yapılacak ilk iş,
`RADAR_VERI_TEKLIF_TALEBI_TASLAKLARI.md` içindeki üç metni göndermektir —
araştırma tekrarlanmaz, ölçümler bu belgede duruyor.

---

## 6-D. KAYNAK SEÇİLDİ: EGM (2026-08-13 — sahibinin kararı, bağlayıcı)

> **Karar:** EGM'nin kamuya açık EDS verisi **kullanılacak**; izin beklenmeyecek.
> Sahibinin gerekçesi: veri kamuya açık ve fiilen yaygın kullanımda.
> **Not (bir kez yazıldı, tekrarlanmayacak):** verinin ticari üründe yeniden
> dağıtımının hukuki tarafı gri alandır (olgu verisi ↔ sui generis veritabanı
> hakkı). Bu bir **iş riski kararıdır** ve sahibine aittir; teknik ekip kararı
> uygular. Asgari sorumluluk olarak **kaynak atfı** (§6-D.4) zorunludur.

### 6-D.1 Verinin ne söylediği — ve söyleyemediği (ölçüldü)

Paket üretilirken 1 503 kaydın tamamı sınıflandırılmaya çalışıldı. Sonuç:

| Alan | Durum | Ürüne etkisi |
|---|---:|---|
| Konum | 1 503 / 1 503 | ✅ kullanılabilir |
| **Tip** | **1 400'ü `UNKNOWN`** (%93) · 81 ortalama hız · 14 kırmızı ışık · 8 park ihlali | 🔴 **"radar" DENEMEZ** |
| **Hız limiti** | **0 / 1 503** | 🔴 "hızını düşür" **denemez** |
| Yön ipucu | 469 (%31), **serbest metin** | ⚠️ dereceye çevrilmedi — çevirmek uydurmak olurdu |

> **🔴 ÜRÜN DİLİNİ BELİRLEYEN BULGU:** kayıtların %93'ünde denetimin **türü
> bilinmiyor**; listede park ihlali kamerası bile var. Bu yüzden sürücüye
> **"radar var"** denemez — söylenebilecek en dürüst şey **"denetim noktası"**dır.
> Tip yalnız `UNKNOWN` olmayan kayıtlarda belirtilir (ör. "ortalama hız
> koridoru"). Hız limiti hiçbir kayıtta olmadığı için uyarı **eşik iddia etmez**;
> hız limiti gerekiyorsa **yolun kendi limitinden** (mevcut `speedLimitRule`
> zinciri) gelir, bu paketten DEĞİL.

Bu, sahibinin koyduğu ilkenin birebir uygulamasıdır: *"ne kadar sağlıklıysa ona
göre kullanıcıyı bilgilendiririz."*

### 6-D.2 Üretim hattı (kuruldu, çalışıyor)

```
scripts/fetch-enforcement-points.mjs   →   public/data/enforcement-points.tr.json
        (geliştirici / CI tarafında)              (1 503 nokta · 287 KB)
```

- **Cihaz EGM'ye ASLA doğrudan gitmez.** Gerekçe: ürün çevrimdışı çalışmak
  zorunda · her cihazın ayrı istek atması gereksiz yük ve kırılganlık ·
  paket sürüm damgalı ve denetlenebilir olmalı.
- **Boş paket üretilmez:** kaynak sayfanın yapısı değişip ayrıştırma 0 kayıt
  döndürürse script **hata verip durur**. Sessizce boş paket yazmak, üründe
  "denetim yok" anlamına gelirdi — bu, sahte güvenin ta kendisidir.
- **Sahte değer yazılmaz:** `speedLimitKph` her kayıtta `null`; tip çıkarılamıyorsa
  `UNKNOWN`; koordinat aralık dışıysa kayıt **atılır** (0'a düşürülmez).
- Paket alanları: `lat · lng · type · role · speedLimitKph · directionHint · label`
  ve başlıkta `sourceId · sourceUrl · fetchedAt · count · typeCounts`.

### 6-D.3 Tazelik politikası (karar bekliyor)

EGM sayfası kendini 30 dakikada bir güncellediğini söylüyor; bizim paket
**üretim anında donar**. Paket ne sıklıkla yenilenecek ve cihaza nasıl inecek
(uygulama güncellemesi mi, ayrı paket indirme mi) — **henüz kararlaştırılmadı**.
Paket başlığındaki `fetchedAt` bu yüzden **ürün yüzeyinde gösterilmelidir**
(kullanıcı verinin yaşını görebilmeli).

### 6-D.4 Atıf (zorunlu)

Radar/denetim uyarısının göründüğü her yüzeyde ve "Açık Kaynak / Veri
Lisansları" ekranında kaynak belirtilir:

> *Denetim noktası verisi: Emniyet Genel Müdürlüğü kamuya açık EDS haritası.*

### 6-D.5 Sıradaki adımlar (bu tur yapılmadı)

1. Paketi okuyan **salt-okunur veri katmanı** (`enforcementPointsSource`) —
   senkron, try/catch, paket yoksa **UNAVAILABLE** (boş liste ≠ "denetim yok").
2. `speedCameraWarningRule` bağlanması — uyarı metni §6-D.1 sözleşmesine uyacak.
3. **CAROS LAB → Vehicle/Navigation** altında salt-okunur gözlem ekranı
   (paket sürümü · `fetchedAt` · nokta sayısı · tip dağılımı · en yakın nokta).
4. Kilit testleri + `docs/DEVICE_VALIDATION_LEDGER.md`'ye 🔴 maddeler.

---

## 7. BU TURDA YAPILMAYANLAR (bilinçli sınır)

- Kod yazılmadı; `speedCameraWarningRule.ts`, `models.ts` ve G1/G3 dosyalarına
  **dokunulmadı**.
- Mobil radar / topluluk bildirimi tasarımına girilmedi.
- EGM'nin kamuya açık harita sayfası **ölçüm amacıyla bir kez indirildi ve
  sayıldı** (§6-B.2). Veri **hiçbir yere kopyalanmadı, ürüne aktarılmadı, tekrar
  tekrar çekilmedi**. Kullanım izni **değerlendirilmedi** — o bir hukuk/iş
  kararıdır; izin gelmeden bu veri üründe kullanılmaz.
- OSM noktalarının **gerçekte doğru olup olmadığı** sahada denetlenmedi — bu
  ADR kapsamı **var/yok**tur, **doğruluk** değil.

---

## 8. AÇIK SORULAR (karar vericiye)

1. **EGM'ye resmî veri paylaşım başvurusu yapılacak mı?** Veri kamuya açık
   yayınlanıyor (1 503 nokta, 30 dk tazelik) ama **kullanım izni ayrı bir
   şeydir**. Bu, projedeki en otoriter ve muhtemelen en ucuz yol.
2. **Sahada tek gözlem gerekiyor (§6-B.4):** Mersin–Tarsus D-400'de direk üstünde
   **sabit kamera kutusu** var mı, yoksa denetim **mobil** mi? Üç veritabanı da
   orayı boş gösteriyor; cevabı yalnız sürücü bilir.
3. Ticari sağlayıcı teklifleri §6'daki **kapsam kabul eşiği** ve §6-B.5'teki
   **dört bölge testiyle** ölçülecek mi?
4. Üretici/filo müşterisi kendi paketini takarsa, ODbL karıştırma tuzağı (§5.3)
   nedeniyle paketler **ayrı veritabanı** olarak taşınacak — paket formatı
   tasarlanırken şart olarak yazılmalı.
5. Birden çok kaynak alınırsa **tekilleştirme kimin işi?** %10 örtüşme, "aynı
   radar için iki uyarı" riskini gerçek kılıyor; bu bir tasarım kalemi olarak
   yol haritasına girmeli.

---

## EK A — KULLANILAN SORGULAR (tekrarlanabilirlik)

**Bölge (bbox) sorgusu:**
```overpassql
[out:json][timeout:120];
(
  node["highway"="speed_camera"](36.70,34.55,37.00,34.95);
  relation["type"="enforcement"](36.70,34.55,37.00,34.95);
);
out tags center;
```

**İl (poligon) sorgusu:**
```overpassql
[out:json][timeout:180];
area["name"="İstanbul"]["admin_level"="4"]->.a;
(
  node["highway"="speed_camera"](area.a);
  relation["type"="enforcement"](area.a);
);
out tags center;
```

**Ülke sorgusu:**
```overpassql
[out:json][timeout:300];
area["ISO3166-1"="TR"]["admin_level"="2"]->.tr;
(
  node["highway"="speed_camera"](area.tr);
  relation["type"="enforcement"](area.tr);
);
out tags center;
```

**Tazelik/katkıcı meta sorgusu:** aynı ülke sorgusu, `out meta;` ile.

**O-7 güzergâh sorgusu:**
```overpassql
[out:json][timeout:240];
relation["type"="route"]["route"="road"]["ref"="O-7"]->.r;
way(r.r)->.w;
node(around.w:250)["highway"="speed_camera"];
out tags center;
```

---

## EK C — İLETİŞİM UÇLARI (doğrulandı, 2026-08-13)

> Aşağıdaki bilgiler ilgili sitelerden **okunarak** alındı; uydurulmadı. Fiyat
> hiçbirinde yayınlanmıyor — hepsi teklif usulü.

### 1. Başarsoft (öncelikli — yerli, EDS + seyyar radar katmanı var)

| | |
|---|---|
| İletişim formu | https://www.basarsoft.com.tr/iletisim/ — konu seçiminde **"İş Geliştirme ve Satış"** |
| Merkez (Ankara) | **+90 312 473 70 80** · Ehlibeyt Mah. Tekstilciler Cad. No:17A Bayraktar Center A Blok Kat:12 D:41, Balgat/Ankara |
| İstanbul ofis | **+90 216 324 70 80** · Barbaros Mah. Kayacan Sk. No:15-17, Ataşehir/İstanbul |
| Not | Fiyat listesi sitede yayınlanmıyor, **talep üzerine e-posta ile** veriliyor |

### 2. SCDB.info — Eifrig Media GmbH (ölçülen en yüksek kapsam: 2 266)

| | |
|---|---|
| **B2B lisans başvurusu** | **http://clients.scdb.info/** ("Apply for B2B License") |
| E-posta | **info@scdb.info** |
| Firma | Eifrig Media GmbH · Neumann-Reichardt-Str. 27, D-22041 Hamburg · HRB 121774 (Hamburg) · sahibi Matthias Eifrig |
| Destek/iletişim | https://www.scdb.info/en/support/ |
| Hazır formatlar | Garmin · iGO · TomTom · Alpine · Mercedes · VW · Volvo · ZENEC (OEM entegrasyon deneyimi var) |

### 3. EGM (resmî veri) — ⚠️ kanal ticari şirkete kapalı görünüyor

| | |
|---|---|
| Veri talebi sayfası | https://www.trafik.gov.tr/veri-talebi |
| İrtibat | https://trafik.gov.tr/irtibat |
| Bilgi edinme | https://www.egm.gov.tr/bilgi-edinme |
| CİMER | https://www.cimer.gov.tr |

> **Okunan gerçek:** `trafik.gov.tr/veri-talebi` sayfasındaki süreç **yalnız
> akademik çalışmalar** için tarif edilmiş: talep **üniversite rektörlüğü
> aracılığıyla** yapılıyor, taahhütname imzalanıyor, sonuçlar EGM ile
> paylaşılıyor. **Ticari şirket için tanımlı bir kanal yok.** Bu, EGM yolunu
> imkânsız yapmaz ama **kurumsal başvuru / protokol** gerektirir (CİMER veya
> bilgi edinme üzerinden yazılı talep; yanıt süresi yasal olarak en geç 30 gün).
> Bir üniversite iş birliği varsa akademik kanal da bir seçenektir.

### 4. Lufop.net (ücretsiz API iddiası — kapsam ölçülemedi)

| | |
|---|---|
| API başvuru sayfası | https://lufop.net/en/lufop-api-access-the-most-complete-free-speed-camera-database/ |
| Not | Sayfa otomatik erişime **403** veriyor (Cloudflare) — **tarayıcıdan açılmalı**. Anahtar form doldurularak alınıyor. Türkiye kapsam listesinde var, **sayı doğrulanmadı** |

### 5. TomTom / HERE (Türkiye kapsamı doğrulanmadı — düşük öncelik)

| | |
|---|---|
| TomTom otomotiv ürün sayfası | https://automotive.tomtom.com/products-services/connected-services/tomtom-speed-camera/ |
| TomTom ürün sayfası (ülke listesi) | https://www.tomtom.com/products/speed-camera-data/ — **50+ ülke listesinde Türkiye yok** |
| HERE | https://www.here.com/contact |

### EK C.1 — Her sağlayıcıya sorulacak dört soru (aynı test)

Teklif isterken **bu dördü yazılı istenmeli**; cevaplar bu ADR'nin ölçtüğü
sayılarla karşılaştırılır:

1. **Kapsam:** Mersin–Tarsus D-400 koridoru · Mersin ili · Adana ili · İstanbul
   için **kaç nokta** var? *(Kıyas: EGM'nin kamuya açık verisi Adana'da ~85,
   İstanbul'da 473; OSM Adana'da 0.)*
2. **Alanlar:** kayıtların yüzde kaçında **yön** ve **hız limiti** var? Araç
   sınıfına göre limit (kamyon/otobüs) veriliyor mu? Kamera **tipi** (hız /
   kırmızı ışık / ortalama hız koridoru) ayrılıyor mu?
3. **Tazelik:** güncelleme sıklığı ne, **kaldırılan** kamera ne kadar sürede
   düşüyor? *(OSM'de medyan kayıt 2,7 yıllık — kıyas budur.)*
4. **Lisans:** **çevrimdışı gömülü** dağıtım (head unit'e önceden yüklenmiş) ve
   **kapalı kaynak ticari satış** kapsam içinde mi? Araç/cihaz başı mı, yıllık
   sabit mi? Veri **üçüncü tarafla karıştırılabilir mi** (§5.3 ODbL tuzağı)?

---

## EK B — KAMU REFERANS KAYNAKLARI

- EGM sabit radar haritası (resmi, toplam sayı yayınlamaz) — `onlineislemler.egm.gov.tr`
- [Kuzey Marmara Otoyolu radar/EDS derlemesi](https://www.trafikcezalari.tr/kuzey-marmara-otoyolu-radar-eds-noktalari/) (üçüncü taraf, 2026)
- [İstanbul radar/EDS derlemesi](https://www.trafikcezalari.tr/istanbul-radar-ve-eds-noktalari-ve-hiz-limitleri/) (üçüncü taraf, 2026-03)
- [İstanbul'da 128 noktaya yeni EDS kararı (UKOME)](https://www.odatv.com/guncel/128-noktaya-yeni-radar-karari-120156999)
- [EDS/radar genel derleme](https://trafikhukuku.com.tr/eds-haritasi-radar-noktalari-nerede/)

---

*Ölçüm: 2026-08-13 · Veri: OpenStreetMap (ODbL) · © OpenStreetMap katkıcıları*
