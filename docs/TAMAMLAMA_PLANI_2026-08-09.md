# Tamamlama Planı — Guardian AI · Trip Cost · 2026-08-09

> **Silme kararları İPTAL.** Guardian AI (32 dosya / 3 966 satır) ve Trip Cost
> (12 dosya / 2 111 satır) **tamamlanacak**. `SPEED_CAMERA_WARNING` kuralı da
> kalır — ama **veri gelmez**: boş yuva olarak tasarlanır.
>
> Bu belge **plan**dır; kod içermez ve hiçbir şeyin "bitti" olduğunu iddia etmez.
> Durum otoritesi `docs/DEVICE_VALIDATION_LEDGER.md`, vizyon otoritesi
> `docs/CAROS_PRO_VIZYONU.md`.

---

## 0. Bağlayıcı sıra kuralı

**Bir seferde BİR yarım iş tamamlanır ve gerçek araçta kanıtlanmadan sıradakine
geçilmez.** Bu projenin 384 kırmızı kütük satırı, paralel başlatmaktan doğdu:
her biri tek başına doğru yazılmış, hiçbiri sonuna kadar götürülmemiş.

**Öncelik sırası:**

```
#491 (ağsız hüküm)  →  GPS / G1  →  Trip Cost  →  Guardian AI
```

**Gerekçe:**
- **#491 önce** çünkü ADR-286 karar omurgasının çevrimdışı çalıştığı henüz
  cihazda gösterilmedi; omurga kanıtlanmadan üstüne yeni karar üreten katman
  eklemek, kanıtlanmamışın üstüne kanıtlanmamış yığmaktır.
- **GPS (G1) ikinci** çünkü Guardian'ın konum tabanlı kurallarının yarısı
  (viraj · yokuş · yol tehlikesi) GPS düzelmeden **matematiksel olarak**
  bitirilemez — p50 19,5 s bayat fix, 94 km/h'de ~509 m konum körlüğü demektir;
  "300 m sonra viraj" cümlesi bu körlükte yalandır.
- **Trip Cost üçüncü** çünkü filo müşterisine satılacak **ilk somut şey** odur:
  araç gerektirmez, veri kaynakları ticari olarak edinilebilir, çıktısı bir
  rakamdır ve müşteri onu kendi muhasebesiyle doğrulayabilir.
- **Guardian son** çünkü en pahalı kanıt onunki: gerçek araç + gerçek yol +
  gerçek hava + tekrarlanabilir senaryo ister.

---

## 1. Boş yuva deseni (SPEED_CAMERA_WARNING ve benzerleri)

`SPEED_CAMERA_WARNING` kuralı **kodda kalır, veri gelmez**. Veriyi üretici ya da
filo müşterisi **kendi lisansıyla** takar — `ADR_PID_PACK.md`'deki paket
deseninin birebir aynısı:

| PID Pack'te | Yuva deseninde |
|---|---|
| tanım + `sourceRef` + `license` + güven sınıfı | kamera kaydı + `sourceRef` + `license` + `confidence` |
| gömülü paket checksum'u doğrulanır, bozuk paket **reddedilir** | yuva manifesti doğrulanır, beyansız veri **reddedilir** |
| lisans saflığı kayıtta taşınır | lisans yuvanın manifestinde taşınır (GPL/NC veri **kabul edilmez**) |

**Boş yuva davranışı — pazarlıksız:** yuva boşken kural **hiç çalışmaz**.
Sessizce "risk yok" **demez**, `confidence: 0` ile olay **üretmez**, boş liste
dönüp "temiz yol" izlenimi **vermez**. LAB'da yuvanın durumu okunur:
`YUVA BOŞ — kamera verisi takılmadı` / `YUVA DOLU — N kayıt · kaynak · lisans`.
Bu ayrım #503'ün dersinin aynısıdır: **sessizliğin sebebi görünmeli**.

Aynı desen ileride `ROAD_HAZARD` (yol tehlike veri tabanı) ve
`WEATHER_RISK` (ticari hava sağlayıcısı) için de kullanılabilir.

---

## 2. Özet tablo

| # | Parça | Önkoşul var mı | Tahmini iş | Kanıt için gereken | Satış kanalı |
|---|---|---|---:|---|---|
| P1 | **Rota → TripPlan wiring** | yok — emekle biter | 2–3 gün | araç gerekmez | Filo · aftermarket |
| P2 | **Yakıt fiyatı** | **veri kaynağı + lisans** | 3–4 gün | fiyat sağlayıcı sözleşmesi | **Filo** (birincil) |
| P3 | **HGS tarifesi** | **veri (tarife tablosu)** | 2–3 gün | KGM/HGS tarife kaynağı | **Filo** (TR'ye özgü) |
| P4 | **Otopark** | **veri + lisans** | 3–4 gün | OSM + fiyat kaynağı | Aftermarket · filo |
| P5 | **Konaklama** | **veri + lisans (BYOK)** | 3–4 gün | otel API anahtarı | Filo (uzun yol) |
| P6 | **Hız kamerası yuvası** | yok (veri MÜŞTERİDEN) | 3–4 gün | yuva manifesti + LAB | **OEM · filo** |
| P7 | **Hava** | **veri + lisans (BYOK)** | 3–4 gün | hava API + gerçek yol | Aftermarket · filo |
| P8 | **Viraj geometrisi** | **G1 (GPS)** | 5–7 gün | **gerçek araç + viraj** | Aftermarket · OEM |
| P9 | **Yokuş** | **G1 (GPS)** | 3–5 gün | **gerçek araç + eğim** | Filo (fren/yakıt) |
| P10 | **Yol tehlikesi** | **G1 + veri kaynağı** | 4–6 gün | tehlike veri tabanı | **Filo** (kendi filosu üretir) |
| P11 | **Yorgunluk** | **sinyal YOK** | 2 gün (zayıf) | mevzuat danışması | **Filo** (AETR/takograf) |

> Tahminler **gün cinsinden geliştirici işidir**, saha doğrulama süresi hariç.
> "Önkoşul" sütunundaki kalın yazı, o parçanın **emekle bitmeyeceğini** söyler.

---

## 3. Trip Cost parçaları

### P1 · Rota → TripPlan wiring
- **Ne eksik:** `tripCostRouteAdapter` (B2) dönüşümü yazmış ve dönüşümün
  **kayıplı/tek yönlü** olduğunu belgelemiş; ama ürün ucunda bu adaptörü
  çağıran yok. `TripPlanMetadata` (origin/destination/gece sayısı/yolcu/araç
  profili) rota modelinde **hiç yok** — dışarıdan zorunlu verilmeli.
- **Emekle mi biter:** **Evet.** Veri kaynağı, lisans veya araç gerekmez;
  eksik olan yalnızca composition. Trip Cost'un tek "saf emek" parçası budur.
- **Tahmini iş:** 2–3 gün (adaptör çağıranı + metadata giriş yüzeyi + LAB ekranı
  + kilit testleri).
- **Kanıt:** araç gerekmez. Gerçek bir rota hesaplanır, `CostReport` üretilir ve
  LAB'da `lowerBound` + `missingItems` + `weightedConfidence` okunur. Bütün
  kalemler `unknown` olsa bile rapor **üretilmelidir** — bu, dürüstlük
  sözleşmesinin çalıştığının kanıtıdır.
- **Satış kanalı:** Filo · aftermarket. Diğer on parçanın hepsi buna bağlanır;
  bu bitmeden hiçbir fiyat kaynağının değeri görünmez.
- **Not:** Bu parça sıradaki **ilk iş**tir (#491 ve G1'den sonra).

### P2 · Yakıt fiyatı
- **Ne eksik:** `computeFuelCost` formülü hazır (`mesafe × tüketim / 100 ×
  litre fiyatı`), ama **litre fiyatının kaynağı yok**. Ayrıca "OBD gerçek
  tüketim > araç profili > sınıf varsayılanı" önceliği bilinçli olarak
  yazılmamış — wiring'in işi.
- **Önce başka şey gerekiyor:** **Veri kaynağı + lisans kararı.** Türkiye'de
  akaryakıt fiyatı dağıtıcı bazlıdır ve günlük değişir. Üç seçenek: (a) ticari
  fiyat API'si (BYOK — her müşteri kendi anahtarı, CLAUDE.md gömülü anahtar
  yasağı), (b) müşterinin kendi tabelası (filoda gerçekçi — anlaşmalı istasyon
  fiyatı zaten sabittir), (c) kullanıcı elle girer (`stale` işaretlenir).
- **Tahmini iş:** 3–4 gün (fiyat kaynağı portu + TTL/`stale` politikası +
  tüketim önceliği + LAB).
- **Kanıt:** Fiyat sağlayıcı sözleşmesi/anahtarı. Araç gerekmez, ama OBD gerçek
  tüketim bacağı için **gerçek araçta** bir yolculuk gerekir.
- **Satış kanalı:** **Filo — birincil.** Filo maliyet muhasebesinin temel
  kalemidir. Aftermarket'te "ilginç"tir, filoda **satın alma gerekçesidir**.

### P3 · HGS tarifesi
- **Ne eksik:** `computeTollCost` üç durumu (ücretli segment yok / hepsinin
  fiyatı var / en az biri fiyatsız) doğru ayırıyor; eksik olan **segment→ücret
  tablosu**. `routingService.detectToll` bugün yalnız boolean sezgiseldir.
- **Önce başka şey gerekiyor:** **Veri.** KGM/HGS tarifeleri kamuya açıktır ama
  makine-okunur bir kaynağı yoktur; gişe-çifti bazlı bir tablonun kurulması ve
  yılda birkaç kez güncellenmesi gerekir. Lisans açısından temiz (resmî tarife),
  ama **kaynağı ve tarihi beyan edilmeli** (PID Pack `sourceRef` deseni).
- **Tahmini iş:** 2–3 gün (tarife tablosu şeması + segment eşleme + sürüm/tarih
  beyanı + LAB). Tablonun kendisinin doldurulması ayrı, veri işidir.
- **Kanıt:** Bilinen bir güzergâhta (ör. Konya→Tarsus) hesaplanan tutarın gerçek
  HGS kesintisiyle karşılaştırılması. Araç gerekmez, **gerçek geçiş** gerekir.
- **Satış kanalı:** **Filo — Türkiye'ye özgü güçlü argüman.** Yabancı hiçbir
  navigasyon ürünü HGS'yi kalem bazında vermiyor.

### P4 · Otopark
- **Ne eksik:** `computeParkingCost` iki fiyat tipini (`flat` / `per_hour`)
  hesaplıyor; eksik olan **durak listesi ve ücretleri**.
- **Önce başka şey gerekiyor:** **Veri + lisans.** OSM/Overpass otopark
  *konumlarını* verir (ODbL — atıf zorunlu, ticari kullanım serbest), **fiyat
  vermez**. Fiyat için ya şehir/işletme anlaşması ya kullanıcı girdisi gerekir.
- **Tahmini iş:** 3–4 gün.
- **Kanıt:** OSM atıfının doğru gösterildiği + en az bir şehirde fiyat
  kaynağıyla karşılaştırma.
- **Satış kanalı:** Aftermarket (şehir içi) · filo (araç park maliyeti).

### P5 · Konaklama
- **Ne eksik:** `computeLodgingCost` yalnız `per_stay` fiyatlamayı destekliyor,
  desteklenmeyen birim `unknown`'a düşüyor (doğru davranış). Eksik olan **otel
  fiyat kaynağı**.
- **Önce başka şey gerekiyor:** **Lisans + BYOK.** Otel fiyat API'leri ücretli
  ve ToS'ları katıdır; gömülü merkezi anahtar **yasak**. Gerçekçi ilk sürüm:
  kullanıcı/filo yöneticisi anlaşmalı otel fiyatını girer.
- **Tahmini iş:** 3–4 gün.
- **Kanıt:** BYOK anahtarıyla en az bir gerçek sorgu, veya elle girilen tarifeyle
  uçtan uca rapor.
- **Satış kanalı:** Filo (uzun yol/lojistik). Aftermarket'te düşük değer.

---

## 4. Guardian AI parçaları

> **Ortak önkoşul:** Guardian'ın **tick sahibi yok**. Motoru kimin, kaç Hz'de,
> hangi DeviceTier bütçesiyle süreceği kararı hiçbir parçaya ait değildir ve
> **hepsinden önce** verilmelidir. Kütük #494 taslağı zaten "hüküm üretimi
> `guardian/*` içinden sürüş yolunda koşmamalı · `low` tier'da tek koşum
> < 16 ms" diyor — Guardian ısınma/kasma geçmişi olan bir üründe hot-path'e
> giremez. Bu karar ~1 gün, ama sıraya **P8'den önce** girer.

### P7 · Hava
- **Ne eksik:** `weatherSource` **yalnız interface** — "GERÇEK IO YOK" diye
  yazıyor. `RawWeatherData` yüzey durumu + görüş mesafesi + güven istiyor.
- **Önce başka şey gerekiyor:** **Veri + lisans (BYOK).** Open-Meteo ticari
  kullanıma açık ve atıf ister; yüzey durumu (`ıslak/buzlu`) doğrudan gelmez,
  sıcaklık+yağıştan **türetilir** → türetilen değerin güveni dürüstçe düşük
  işaretlenmeli, "buzlu yol tespit edildi" **denmemeli**.
- **Tahmini iş:** 3–4 gün (HTTP portu + çevrimdışı/bayat politikası + türetme
  güveni + LAB + atıf ekranı).
- **Kanıt:** Gerçek yolda, bilinen hava koşulunda uyarının çıkması **ve**
  koşul yokken çıkmaması. Ağsız durumda `unknown` kalması.
- **Satış kanalı:** Aftermarket · filo. OEM'de düşük (çoğu OEM yağmur/dış
  sıcaklık sensörünü zaten veriyor).

### P8 · Viraj geometrisi
- **Ne eksik:** `RawCurveData` yarıçap · tavsiye hızı · yön · mesafe istiyor.
  Bunların **hiçbiri** bugün üretilmiyor; rota geometrisi var ama ondan yarıçap
  çıkaran hesap yok.
- **Önce başka şey gerekiyor:** **G1 (GPS tazeliği) — ŞARTLI KİLİT.** 509 m
  konum körlüğüyle "300 m sonra viraj" cümlesi kurulamaz. Ayrıca yol geometrisi
  kaynağı gerekir (rota polyline'ından türetme mümkün — Overpass'a gerek yok).
- **Tahmini iş:** 5–7 gün (polyline→yarıçap hesabı + hız/yarıçap eşiği +
  tavsiye hızı türetme + LAB). Hesabın kendisi zor değil; **doğrulanması**
  pahalı.
- **Kanıt:** **Gerçek araç + gerçek viraj.** Bilinen keskin bir virajda,
  bilinen hızla, uyarının doğru mesafede çıkması; düz yolda çıkmaması.
- **Satış kanalı:** Aftermarket · OEM (ADAS'ı olmayan araçlar). Guardian'ın
  en gösterişli parçası, ama en pahalı kanıtı olan da bu.

### P9 · Yokuş
- **Ne eksik:** `RawRoadProfileData` iniş eğim yüzdesi istiyor; üretilmiyor.
- **Önce başka şey gerekiyor:** **G1.** Eğim ya yükseklik profilinden (rota
  servisinden gelebilir) ya GPS irtifasından türetilir; GPS irtifası zaten yatay
  konumdan daha gürültülüdür — bayat fix'le türetilen eğim çöptür.
- **Tahmini iş:** 3–5 gün.
- **Kanıt:** **Gerçek araç + bilinen eğimli yol** (ör. Toroslar inişi).
- **Satış kanalı:** **Filo** — uzun inişte fren aşınması ve yakıt tüketimi
  filonun somut maliyet kalemidir. Aftermarket'te ilgi çekici ama satış
  gerekçesi değil.

### P10 · Yol tehlikesi
- **Ne eksik:** `RawRoadHazardData` tehlike tipi + mesafe + güven + kaynak
  istiyor; **kaynak yok**.
- **Önce başka şey gerekiyor:** **G1 + veri kaynağı.** Tehlike verisi ya
  crowd-source ya resmî kaynaktır; ikisi de bugün yok.
- **Tahmini iş:** 4–6 gün (yuva deseniyle — P6 ile aynı altyapı).
- **Kanıt:** Tehlike veri tabanı + gerçek yolda konum eşleşmesi.
- **Satış kanalı:** **Filo — en güçlü argüman burada.** Bir filo kendi
  araçlarının geçtiği yolları kendisi işaretleyebilir; veri müşterinin
  kendisinden gelir, lisans sorunu doğmaz. Aftermarket'te tek kullanıcı veri
  üretemez.

### P11 · Yorgunluk
- **Ne eksik:** `RawDriverFatigueData` iki farklı sınıf alan istiyor ve bu ayrım
  zaten koda yazılmış:
  - **zaman tabanlı:** `continuousDrivingMinutes`, `minutesSinceLastMeaningfulBreak`,
    `tripDurationMinutes`, `localHour` → **bunlar bugün üretilebilir**;
  - **sensör tabanlı:** `lowAttentionSignal`, `repeatedLaneCorrectionSignal`,
    `microsleepSuspectedSignal` → **bugün hiçbir sinyal yok** (kamera yok,
    şerit takibi yok, direksiyon açısı yok).
- **Önce başka şey gerekiyor:** Zaman tabanlı bacak için **hayır, emekle biter**.
  Sensör bacağı için **donanım** gerekir.
- **ŞARTLI KİLİT:** Zaman tabanlı zayıf tahmin yapılacaksa güveni **dürüst**
  işaretlenir ve **"tespit" denmez**. Kabul edilebilir cümle: *"3 saattir
  molasız sürüyorsunuz"* (ölçüm). Yasak cümle: *"yorgunsunuz"* / *"dikkatiniz
  dağıldı"* (tespit iddiası — dayanağı yok).
- **Tahmini iş:** 2 gün (zayıf/zaman tabanlı bacak). Sensör bacağı **kapsam
  dışı**.
- **Kanıt:** Mevzuat danışması (AETR/takograf sürüş-mola kuralları) + gerçek
  yolculukta sayaçların doğruluğu.
- **Satış kanalı:** **Filo — birincil ve mevzuat destekli.** Aftermarket'te
  yanlış-pozitif riski itibar kaybı; filoda sürüş-mola takibi zaten yasal
  yükümlülük.

### P6 · Hız kamerası yuvası
- **Ne eksik:** `RawSpeedCameraData` kayıt id · tip · mesafe · güven · kaynak
  istiyor. **Veri gelmeyecek** — eksik olan **yuvanın kendisi**.
- **Önce başka şey gerekiyor:** **Hayır — emekle biter.** Bu parçanın tamamı
  kendi kontrolümüzde: manifest şeması, lisans beyanı zorunluluğu, doğrulama,
  boş-yuva davranışı, LAB gözlemi.
- **Tahmini iş:** 3–4 gün.
- **Kanıt:** Veri kaynağı **gerekmez** — kanıt, yuva boşken kuralın hiç
  çalışmadığı ve LAB'ın `YUVA BOŞ` dediğidir. Sahte kamera paketiyle dolu-yuva
  yolu da doğrulanır.
- **Satış kanalı:** **OEM · filo.** Kamera verisi ülkeye göre lisanslıdır ve
  bazı ülkelerde gösterimi yasaktır; yuva deseni **hukuki riski müşteriye
  devreder** — üretici kendi lisansını takar, biz veri dağıtmayız. Bu, satışı
  kolaylaştıran bir tasarım kararıdır, teknik bir eksiklik değil.

---

## 5. `guardianDecisionEngine` → `guardianAlertRanker` (UYGULANDI 2026-08-09)

**Karar:** Bu modül bir **karar otoritesi değildir**; risk olaylarını önceliğe
göre sıralayan ve hangisinin sesli/ekranda sunulacağını seçen bir **uyarı
sıralayıcısıdır**. Kendi başlığı da bunu söylüyor: *"Bu motor KARAR-SUNUMU
yapar, RİSK ANALİZİ DEĞİL — event ÜRETMEZ, severity HESAPLAMAZ."*

Ölü kod envanterinde onu "11. karar otoritesi" diye listelemek **yanlıştı**;
ADR-286'nın tekleştirmek istediği şey *hüküm üretenler*dir, sıralayıcılar değil.
Bu düzeltme envanter ve vizyon belgelerine **bugün** işlendi.

**Yeniden adlandırma UYGULANDI (2026-08-09, tek atomik PR — davranış değişmedi):**

| Eski | Yeni |
|---|---|
| `guardianDecisionEngine.ts` | `guardianAlertRanker.ts` |
| `evaluateGuardianDecision()` | `rankGuardianAlerts()` |
| `GuardianDecision` | `GuardianAlertPlan` |
| `GUARDIAN_DECISION_ID` | `GUARDIAN_ALERT_RANKER_ID` |

Saf yeniden adlandırma: davranış değişmedi, ürün tüketicisi zaten yoktu.
`GUARDIAN_DECISION_ID` sabitinin değeri de (`'guardian-decision'` →
`'guardian-alert-ranker'`) güncellendi — sabitin hiçbir okuyucusu olmadığı
ölçülerek doğrulandı. Modül başlığına rolün **ne OLMADIĞI** yazıldı, çünkü bu
yanılgıyı üreten şey adın kendisiydi.

Doğrulama: `tsc --noEmit` temiz · `guardianAlertRanker.test.ts` 26/26 ·
guard 393/393.

---

## 6. Bu planın kendine koyduğu sınır

- Buradaki hiçbir satır bir özelliği "tamamlandı" saymaz. Tamamlanma ölçütü
  `DEVICE_VALIDATION_LEDGER.md`'de 🟢'dir.
- Gün tahminleri **tahmindir**, taahhüt değil; saha doğrulama süresi hariçtir.
- Bir parça sırası geldiğinde önkoşulu hâlâ yoksa **başlatılmaz**, sıradaki
  parçaya geçilmez — sıra kuralı budur.
