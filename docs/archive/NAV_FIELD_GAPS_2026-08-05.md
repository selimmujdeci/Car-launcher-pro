# NAVİGASYON SAHA EKSİK LİSTESİ — 2026-08-05 (Konya → Tarsus)

> **DURUM (ilk yazım): YALNIZ TESPİT.** Kullanıcı talimatı:
> *"sadece eksikleri bul ve not et, sonra yapılacak."* Bu belge bir **backlog**tur.
>
> **GÜNCELLEME 2026-08-05 (kapatma turu):** Aşağıdaki maddelerin çoğu için
> **kod düzeltmesi yapıldı** — hiçbiri cihazda doğrulanmadı. Kapatılanlar ve
> kabul ölçütleri: kütük **#432–#448**. Özet:
>
> | Madde | Durum |
> |-------|-------|
> | G1 GPS bayatlığı | ⏳ **ölçülebilir yapıldı** (#437) — kök neden hâlâ bilinmiyor |
> | G2 off-route → reroute yok | ✅ kod düzeltmesi (#438) — karar/aksiyon aynı eşiğe bağlandı |
> | G3 ETA sıçraması · G4 iki ETA otoritesi | ✅ kod düzeltmesi (#441) |
> | G5 kuş uçuşu mesafe · G9 mesafe artışı | ✅ kaynak etiketlendi + ETA girdisinden çıkarıldı (#441) |
> | G6 şerit · G7 canlı trafik | ❌ **YAPILMADI** — veri boşluğu, sağlayıcı kararı gerek |
> | G8 HEADING_UNKNOWN | ✅ kod düzeltmesi (#442) |
> | G10 rota doğrulaması DEGRADED | ⏳ sebep **görünür** yapıldı (#443) — kriter hâlâ ölçülmedi |
> | G11 çöp fix · G12 OFF_NETWORK | ⏳ ölçülebilir (#437) |
> | G13 hız %16 null | ⚠️ kısmi (#442) — sahte 0 kalktı, boşluk oranı #401'e bağlı |
> | G14 adım indeksi sabit | ⏳ #441/#442 ile dolaylı; ayrıca ölçülmeli |
> | G15 çevrimdışı rota motoru | ❌ **YAPILMADI** — ayrı büyük iş |
> | G16–G19 arayüz çakışmaları | ❌ **YAPILMADI** — ekran görüntüsü gerektirir (kör CSS patch yasak) |
> | T1 OBD bağlı değilken veri | ✅ tek hız otoritesi + `—` (#433) |
> | T2 "255 km/h" 0xFF | ✅ kod düzeltmesi (#432) |
> | T3 telefon = head unit | ✅ kod düzeltmesi (#444) |
> | T4 iklim kontrastı | ✅ OEM token katmanı (#445) |
> | T5 doğrulama modu kaydı | ❌ **YAPILMADI** — ölçüm gerek |

## Ölçüm künyesi (kanıt)

| Alan | Değer |
|------|-------|
| Cihaz | `4L45OFZDX84X55GE` (Redmi 23090RA98I, Android 13) |
| Build | 2026-08-05 12:30 `app-debug.apk` (taze, `clean assembleDebug`) |
| Rota | Konya → **Tarsus, Mersin** — 289,2 km / 32 adım, `REMOTE_OSRM` (`routing.openstreetmap.de`) |
| Koşum | **399 örnek · 420 s · 1 Hz** · CDP-over-adb · `__CAROS_NAV_FIELD__.sample()` (salt-okunur) |
| Sürüş | Gerçek araç, otoyol, hız medyanı **94 km/h** |
| Ham veri | `scratchpad/navrun.jsonl` (**kişisel konum içerir — paylaşmadan önce temizle**) |

Bu koşum **gerçek sürüş** verisidir; masa başı simülasyon değildir.

---

## 🔴 P0 — Google Haritalar'a karşı KAYBETTİREN eksikler

### G1. GPS fix'i medyanda 19,5 saniye BAYAT (en ağır kusur)

| Ölçüm | Değer | 94 km/h'de karşılığı |
|-------|-------|----------------------|
| `fixAgeMs` p50 | **19 496 ms** | **~509 m** konum körlüğü |
| `fixAgeMs` p95 | 100 872 ms | ~2,6 km |
| `fixAgeMs` max | **121 075 ms** | **~3,2 km** |
| fix > 3 s | **%67,7** | — |
| fix > 10 s | **%61,2** | — |
| Benzersiz fix sayısı | 123 / 420 s → **ort. 3,4 s'de bir** | ~89 m atlama |

Google Haritalar 1 Hz konum tüketir. Yarım kilometrelik körlükle şerit-seviyesi
rehberlik, doğru "şimdi dön" anı ve dürüst kalan-mesafe **matematiksel olarak
mümkün değildir**. Diğer kusurların çoğu bunun türevi.

**Kanıt:** doğruluğu <50 m olan fix'lerden hesaplanan iz **3,35 km**, oysa aynı
sürede gerçekten kat edilen yol **~11 km** (kalan mesafe düşüşü 11,75 km ile
tutarlı). Yani **yolun ~%70'i hiç ölçülmedi.**

- Ölçülmedi/bilinmiyor: kök neden GPS sağlayıcı isteği mi (interval/priority),
  store yazma throttle'ı mı, yoksa cihaz güç yönetimi mi. **Ayrıca ölçülmeli.**

### G2. `CONFIRMED_OFF_ROUTE` %17,5 — ama yeniden rota HİÇ istenmedi

| Alan | Değer |
|------|-------|
| `offRoute.state = CONFIRMED_OFF_ROUTE` | **70 / 399 örnek (%17,5)** |
| `SUSPECTED_OFF_ROUTE` | 88 (%22) |
| `nav.isRerouting` | **%0,0** |
| `req.committed` | **1** (yolculuk başındaki tek rota) |
| `fetchInFlight` | **%0,0** |
| `req.failed` / `staleRejected` | 0 / 0 |

Sistem "rotadan çıktı" kararını **verdi**, kütüğe yazdı — ve **hiçbir şey yapmadı**:
ne yeni rota istedi, ne kullanıcıyı uyardı. Google Haritalar bu durumda saniyeler
içinde yeniden rota çizer. Karar üretilip **aksiyona bağlanmamış** — vizyon
anayasasının 8. kapısı (`Vehicle Brain → Action`) burada kopuk.

- ⚠️ Not: off-route kararının kendisi G1 yüzünden **sahte** olabilir (kötü fix →
  sahte sapma). O hâlde kusur ikiye çıkar: (a) sahte off-route üretmek,
  (b) gerçek off-route'ta bile reroute etmemek. İkisi de ayrı ayrı doğrulanmalı.

### G3. ETA aynı yolculukta 1 saat 49 dakika sıçrıyor

| Ölçüm | Değer |
|-------|-------|
| `etaS` aralığı | 10 007 s (2 sa 47 dk) ↔ **16 764 s (4 sa 39 dk)** |
| 60 s'den büyük sıçrama | **43 kez** |
| En büyük tek sıçrama | **6 560 s = 1 sa 49 dk** |
| 7 dakikada ETA düşüşü | 192 dk → 179 dk (**13 dk** — olması gereken ~7 dk) |

ETA bir güven ürünüdür; bu salınım Google Haritalar karşısında tek başına
"güvenilmez" damgası yedirir.

### G4. İki ayrı ETA otoritesi — ekran ile motor ÇELİŞİYOR

Aynı anda: ekrandaki rota kartı **"289,2 km · 3 sa 18 dk"**, motor
(`nav.etaSeconds`) **16 905 s = 4 sa 42 dk**. Fark **1,5 saat**.
Kullanıcıya hangisinin gösterildiği ve hangisinin doğru olduğu belirsiz.
Tek otorite olmalı.

### G5. Kalan mesafenin %38'i KUŞ UÇUŞU hesaplanıyor

`route.distSource`: `ALONG_ROUTE` 247 örnek · **`STRAIGHT_LINE` 152 örnek (%38)**.

Kuş uçuşu mesafe rotanın kıvrımlarını yok sayar → hem "kalan km" hem ETA
sistematik olarak iyimser çıkar. Google Haritalar her zaman rota boyu ölçer.

### G6. Şerit rehberliği YOK — 32 adımın **0**'ında şerit verisi

`route.lanesSteps = 0 / 32` (399 örneğin tamamında).

Kod tarafı hazır (`RouteLane`, `intersections[].lanes` ayrıştırması, "manevra
tipinden ok TÜRETİLMEZ" kuralı doğru), ama **sağlayıcı veri vermiyor** —
OSRM demo sunucusu + TR OSM'de `turn:lanes` etiketi seyrek. Şehir içi ve
otoyol çıkışlarında Google'ın en görünür üstünlüğü budur.

- Bu bir **veri boşluğu**, kod boşluğu değil (bkz. `[[project_geocoding-provider-byok-osm-gap-2026-08-03]]`
  ile aynı desen). Çözüm sağlayıcı katmanında aranmalı, kodda değil.

### G7. Canlı trafik YOK → ETA yapısal olarak gerçekçi olamaz

`REMOTE_OSRM` trafik beslemesi taşımaz. Trafik olmadan ETA "boş yol" varsayar;
Google'ın çekirdek üstünlüğü tam olarak budur. Bugünkü ETA modeli
(`annotations=duration` segment süreleri) **serbest akış** modelidir.

---

## 🟠 P1 — Doğruluk ve tutarlılık kusurları

### G8. `heading` DEĞERİ VAR ama eşleme motoru `HEADING_UNKNOWN` diyor

`headingNull = %0,0` (heading her örnekte mevcut) — buna rağmen örneklerin
**%13,8'inde** `match.reasons` içinde `HEADING_UNKNOWN` var (55 örnek).
Motor eldeki yön bilgisini **kullanmıyor**; bu da eşleme güvenini düşürüp
sahte off-route'u besliyor. Mantık kusuru gibi görünüyor — doğrulanmalı.

### G9. Kalan mesafe 69 kez ARTTI

İlerlerken kalan mesafenin artması kullanıcı için "sistem şaşırdı" sinyalidir.
Büyük olasılıkla G5 (STRAIGHT_LINE ↔ ALONG_ROUTE geçişleri) ve G1'in türevi,
ama bağımsız bir kilit hak ediyor: **kalan mesafe monoton azalmalı** (reroute
hariç).

### G10. Rota doğrulaması %100 `DEGRADED`

`route.validation = DEGRADED` — 399 örneğin **tamamında**. Rota hiç "SAĞLAM"
olmadı. `DEGRADED`'ın hangi kritere takıldığı ölçülmedi; ürün bunu kullanıcıya
da göstermiyor.

### G11. Konum doğruluğu p95 = **7 578 metre**

`accuracyM`: p50 5,1 m (iyi) · **p95 7 578 m** · max 7 578 m.
Yani fix'lerin bir kısmı tamamen çöp (hücre bazlı). `LOW_ACCURACY` 158 örnekte
sebep olarak sayıldı. Çöp fix'ler eşlemeye **sokulmadan** elenmeli;
`lateralM` p95 **1 359 m**, max **1 480 m** — araç 1,5 km sapmış görünüyor.

### G12. `OFF_NETWORK` %38 — ilk kilitlenme sürekli sıfırlanıyor

`match.state`: `MATCHED` 207 · **`OFF_NETWORK` 152 (%38)** · `MATCH_UNCERTAIN` 40.
`FIRST_FIX` sebebi **152 kez** göründü — yani sistem yolculuk boyunca defalarca
"ilk fix" durumuna geri düştü. Bir kez kilitlenip kalması gerekirdi.

### G13. Hız %16 örnekte `null`

`veh.speedKmh == null` → **%16,0**. Hız hem HUD hem ETA hem eşleme girdisi;
boşluk doldurma (son geçerli hız + yaşlandırma) yok gibi görünüyor.

### G14. Adım indeksi 7 dakika boyunca **sabit 2**, sonraki manevra mesafesi salınıyor

`stepIdx` min=p50=max=**2**. `nextManeuverM` 7 285 m ↔ 18 929 m arasında
gidip geldi — yani "sonraki dönüşe kalan mesafe" **azalmak yerine dalgalandı**.
Uzun otoyol adımında adımın ilerlememesi normal; **mesafenin geri gitmesi değil.**

### G15. Çevrimdışı rota motoru YOK

`provider.localState = LOCAL_OSRM_UNAVAILABLE` (399/399), `lastSource = REMOTE_OSRM`.
Tünelde/kapsama dışında yeniden rota **imkânsız**. Google çevrimdışı harita
indirir. Ürün "offline-first" iddiasıyla çelişiyor.

- Olumlu: `straightLineCount = 0` ve `remoteFailures = 0` — bu koşumda düz-çizgi
  rotaya **hiç** düşülmedi, uzak sağlayıcı hiç patlamadı.

---

## 🟡 P2 — Arayüz / okunabilirlik (sürüş sırasında ekrandan)

### G16. Ana ekranda hız göstergesi ikonların üstüne biniyor
Sol üst kartta **"90 KM/H"** metni far/sinyal/dörtlü ikon satırının (`SOL · FAR ·
UZUN · DÖRTLÜ · ... · FR.`) tam üstüne binmiş; ikonlar okunamıyor.

### G17. GPS uyarı kartı sağ üstteki widget'ları kapatıyor
"GPS Doğruluğu Düşük" bildirimi medya/durum kartlarının üzerine gelmiş.
Uyarının kendisi **doğru ve dürüst** (bu iyi) — yerleşimi yanlış.

### G18. Yol sayacı metni kırpılıyor
"426,2 km **YOL SAY...**" kesik; "Sıfırla" butonu kart sınırından taşmış.

### G19. İki uyarı aynı anda farklı doğruluk değeri gösterdi
Ekran "~129 m" derken köprü aynı dakikada `accuracyM = 2068 m` okudu.
Kullanıcıya gösterilen doğruluk ile motorun kullandığı değer aynı kaynaktan
gelmiyor olabilir.

---

## ⚪ Ölçülmedi — iddia edilemez (dürüstlük kaydı)

Bu koşumda **kanıt toplanmadı**; "çalışıyor" da "bozuk" da denemez:

- **Sesli yönlendirme** — tetiklendi mi, zamanlaması doğru mu, uygulama-içi mi.
- **Reroute süresi** — hiç reroute olmadığı için `detectToCommitMs` vb. `null`.
- **Alternatif rota** — kodda var (`alternatives=3`, doğrulama kapısı); UI'da
  seçilebiliyor mu ölçülmedi.
- **Ücretli geçiş (`hasToll`) heuristiği** — doğruluğu ölçülmedi.
- **Tam ekran navigasyon HUD'ı** — sürüş boyunca mini haritada kalındı.
- **Hız limiti levhası** — ekranda "90" göründü, ancak kaynağı (yol sınıfı mı,
  gerçek levha mı) bu koşumda doğrulanmadı.
- **Varışta davranış** — yolculuk tamamlanmadı.

---

---

# EK: TEST / DOĞRULAMA MODU DENETİMİ — 2026-08-05

Aynı cihazda, aynı oturumda, salt-okunur olarak denetlendi.

## Modun gerçek durumu

| Bayrak | Değer | Anlamı |
|--------|-------|--------|
| `caros.validationMode.enabled` | **`"true"`** | **Saha Doğrulama Modu AÇIK** |
| Build | `app-debug.apk` → `DEBUG_ENABLED = true` | Geliştirici köprüleri açık (kanıt: `__CAROS_NAV_FIELD__` erişilebildi) |
| `VITE_ENABLE_OBD_MOCK` | **hiçbir `.env`'de tanımlı değil** | **OBD mock KAPALI** — sahte OBD üretilmiyor |
| `car-launcher-role` | `technician` | Teknisyen rolü |
| `cl_isHeadUnit` | **`"1"`** | **Telefon kendini HEAD UNIT sanıyor** |
| `cl_performanceMode` | `lite` | Düşük performans profili |
| `mavi.aiGateway.enabled` | `true` | AI ağ geçidi açık |

**Sonuç:** Doğrulama modu açık ama bu **kayıt/gözlem modudur, sahte veri modu değildir**
(`validationFlag.ts`: üç kapı — `DEBUG_ENABLED` && (uzak bayrak ‖ yerel kaldıraç)).
Bu nedenle **yukarıdaki navigasyon ölçümü gerçek veriyle yapılmıştır**, simülasyon değil.

## 🔴 T1. OBD bağlı DEĞİL — ama ekran araç verisi gösteriyor

| Kanıt | Değer |
|-------|-------|
| Bluetooth `V-LINK` (`10:21:3E:4D:71:D2`) | **`STATE_DISCONNECTED`** (eşleşmiş ama bağlı değil) |
| `car-can-snapshot` yaşı | **63,2 saat** (speed 0 · rpm 896 · 92 °C) |
| logcat OBD/ELM/CAN trafiği | **yok** |
| OBD mock | kapalı |

Buna rağmen ekranda **"MOTOR 93 °C · DEVİR 1888"** görüldü; DOM okumasında
**`Motor 93°C`** doğrulandı. Değerler 63 saatlik snapshot'la da uyuşmuyor
(92 °C / 896 rpm). **Kaynağı doğrulanamadı.**

Aynı kartta `Akü — V` **dürüstçe bilinmiyor** gösteriliyor. Yani kart bir alanda
dürüst, diğerinde kaynağı belirsiz değer basıyor → **gözlemlenebilirlik
sözleşmesinin 5. şartı** ("kanıtsız bilgi ÜRETİLMEMELİ; bilinmeyen `UNKNOWN`")
ihlal ediliyor olabilir. Kök neden ayrıca kazılmalı.

## 🔴 T2. Ekranda **"Hız 255 km/h"** — 0xFF sentinel'i sanitizasyonu geçiyor

DOM okuması: **`Hız 255 km/h`** — araç o sırada gerçekte ~94 km/h gidiyordu.

255 = **0xFF**, OBD'de klasik "veri yok / geçersiz" bayt değeridir. Ancak
`obdSanitizer.ts` sınırı `speed: [0, 300]` (satır 8) ve güvenlik kapısı
`data.speed > 300` (satır 55) → **255 geçerli kabul ediliyor.**

CLAUDE.md "Sensor Resiliency" kuralı *"imkânsız veriyi reddet"* der; 255 fiziksel
olarak imkânsız değil ama **bu bağlamda sentinel**tir. Sınır tek başına yetmiyor:
sentinel değerler ayrıca elenmeli (ve OBD bağlı değilken hız zaten basılmamalı).

⚠️ Bu iki bulgu (T1/T2) navigasyon eksiklerinden **bağımsızdır** ve bir sürücüye
yanlış hız göstermek doğrudan güvenlik konusudur.

## 🟠 T3. `cl_isHeadUnit = "1"` — telefonda head unit yerleşimi

Cihaz bir telefon (Redmi 23090RA98I), ancak uygulama kendini head unit sanıyor.
Bu, bilinen "HU için yazılmış px/metre ölçüleri telefonda çöküyor" sorununun
tetikleyicisidir; yukarıdaki P2 arayüz kusurları (G16–G18) büyük olasılıkla
bunun türevidir.

## 🟠 T4. İklim ekranında metin/kontrast çökmüş

Ekran görüntüsüyle doğrulandı: `A/C`, `AUTO`, `SYNC` etiketleri ve sıcaklık
değerleri (`22.0` / `21.0`) **beyaz üzerine beyaz** → okunamıyor; koltuk ısıtma
kademe rakamları görünmüyor (yalnız seçili "1" okunabiliyor); buton kutuları
etiketlerin üstüne binmiş. Sürüş sırasında kullanılamaz durumda.

## ⚪ T5. Doğrulama modu açık — ama kayıt ürettiği DOĞRULANMADI

IndexedDB'de kayıt deposu görünmüyor: `caros-connectivity-v1/queue: **0**`,
diğer depolar harita/POI amaçlı (`offline-places 3364`, `tile-manifest 17693`,
`locations 10`). `longRoadRecorder` için ayrı bir depo bulunamadı.
**"Mod açık" ≠ "kayıt tutuyor"** — bu ayrıca doğrulanmalı; açıkken pil/CPU
tüketip hiçbir şey kaydetmiyorsa çift kayıp olur.

## Test modu için sıradaki adımlar (öneri — YAPILMADI)

1. **T2 önce** — sentinel eleme (255/0xFF vb.) + OBD bağlı değilken hız/devir
   basılmaması. Güvenlik etkisi var.
2. **T1 kök neden** — bağlantı yokken "93 °C" hangi katmandan geliyor; bulunup
   `UNKNOWN`'a çevrilmeli (Akü alanı zaten doğru davranıyor, örnek alınmalı).
3. **T3** — cihaz sınıfı tespiti telefonda `isHeadUnit` vermemeli.
4. **T5** — doğrulama modunun kayıt ürettiği kanıtlanmalı, yoksa şalter yanıltıcı.
5. Sahada iş bitince `caros.validationMode.enabled` **kapatılmalı** (rollback şalteri).

---

---

# EK 2: TÜM UYGULAMA OEM TURU — 2026-08-05 (aynı sürüş)

Sürücü başkası olduğu için ekranlara **dokunularak** gezildi
(`adb input tap` + `adb screencap`) ve **15 dakikalık CDP konsol yakalaması**
yapıldı (**459 olay**). Bulguların tamamı kütüğe işlendi:

| Kütük # | Konu | Sınıf |
|---------|------|-------|
| **416** | `PREVIEW` iken `isNavigating: true`, `match.state = null` (eşleme ölü), `nextManeuverM = 0`, adım 32→20 | 🔴 P0 |
| **417** | Aynı anda üç etiketsiz hız: kart 99 · harita 103 · store 104 | 🔴 P0 |
| **418** | Tam ekranda kart "Konya · 66.6 KM" ↔ rozet "273.6 KM"; hedef Tarsus değil; panelde "NAVİGASYONU BAŞLAT" | 🔴 P0 |
| **419** | Müzik: oynatma düğmeleri alt barın ALTINDA (durdurulamıyor), kapak başlığı örtüyor, `0:00/0:00`, `MEDIA_ACTION_FAILED` | 🔴 P0 |
| **420** | Bakım kaydı yokken "Tüm bakımlar güncel" (sahte sağlıklı) | 🔴 P0 |
| **421** | OpenRouter **402 kredi bitti** ×11, Gemini **429** ×22, ses failsafe ×4 → AI sessizce ölü | 🔴 P0 |
| **422** | Supabase `public.raw_community_events` şemada yok; 404 ×6 | 🔴 P0 |
| **423** | GPS JumpGuard 29× çöp fix reddi (500–3 800 m) → **G1/#401'in muhtemel kökü** | 🔴 P0 |
| **424** | 15 dk'da 131 ağ kopması, buna rağmen harita "ONLİNE" (rozet iki kez çiziliyor) | 🔴 P1 |
| **425** | Ayarlar OEM paletinin dışında (mavi/mor/yeşil), hem "GERİ" hem "X", menü kırpık | 🔴 P1 |
| **426** | Tam ekran nav'da "Aracı Ortala" düğmesi `DURAK EKLE`'nin üstüne biniyor | 🔴 P1 |
| **427** | `[Battery] NORMAL → WARN` üretildi ama kartta `AKÜ — V`, sürücüye uyarı yok | 🔴 P0 |

**Olumlu çalışan yüzeyler (kanıtlı):** OGS/HGS ücretli geçiş rozeti · `GPS ±3m`
dürüst doğruluk göstergesi · `AKÜ — V` alanının bilinmeyeni dürüstçe göstermesi ·
GPS JumpGuard'ın çöp fix'i gerçekten reddetmesi · rota isteğinde `failed`/`stale`
sayaçlarının 0 kalması · `anchorsResolved` 32/32.

## Sıradaki atomik adımlar (öneri — henüz YAPILMADI)

1. **G1'i ölç ve kır** — GPS istek parametreleri + store yazma yolu; hedef
   ölçüt: `fixAge` p50 **< 1,5 s**, fix > 10 s oranı **< %1**. Diğer her şey buna bağlı.
2. **G4/G5'i tek otoriteye indir** — ETA ve kalan mesafe için tek kaynak,
   `STRAIGHT_LINE` yalnız rota yokken.
3. **G2'yi aksiyona bağla** — `CONFIRMED_OFF_ROUTE` → reroute isteği + kullanıcı
   bildirimi; kilit testi: "onaylı off-route reroute'suz kalamaz".
4. **G8'i doğrula** — heading varken `HEADING_UNKNOWN` üretiliyorsa mantık kusuru.
5. **G6/G7 için sağlayıcı kararı** — şerit + trafik veren BYOK sağlayıcı katmanı
   (kod boşluğu değil, veri boşluğu).

Her madde `docs/DEVICE_VALIDATION_LEDGER.md` kütüğüne **🔴 cihazda test edilmedi**
olarak, yukarıdaki ölçülebilir kabul ölçütleriyle işlenmelidir.
