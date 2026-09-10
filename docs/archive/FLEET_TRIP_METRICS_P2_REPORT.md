# CAROS PRO — FLEET TRIP METRICS P2 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** `FLEET_TRIP_ENGINE_P1_REPORT.md` §13'te açık bırakılan trip metriği
borçlarını kapatmak (B2–B6).
**Commit / push / deploy / db push:** YAPILMADI (kural gereği)
**Yeni trip platformu:** KURULMADI — `tripLogService` tek otorite olarak KALDI.

---

## 1. EXECUTIVE SUMMARY

### Nihai karar: **`FLEET_TRIP_METRICS_P2_COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`FLEET_TRIP_METRICS_P2_COMPLETE_LOCAL`** |
| `tripP1RegressionVerdict` | **`PRESERVED`** |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Yakıt artık gerçekten **ölçülebiliyor** (OBD seviye farkı, yedi kapıdan
geçerek), maliyet **fiyat snapshot'ına** bağlandı, sert manevralar
**kalıcılaştı**, süre **hareket / rölanti / bilinmeyen** olarak ayrıştı, tepe
RPM ve motor sıcaklığı yalnız **taze OBD**'den üretiliyor, hız ihlali gerçek
limit kaynağı olmadığı için **hiç üretilmiyor**, ve confidence artık **kanıta
dayalı** (kapsama · boşluk · kaynak geçişi · kapanış).

### ⚠️ Bu turun en önemli bulgusu: **yeşil test, çalışan zincir DEĞİLDİR**

Bu görev devralındığında P2'nin **kod tarafı büyük ölçüde yazılmıştı** ve
**9 154 test yeşildi**. Buna rağmen özellik **sahada çalışmayacaktı**. Beş
kusur testlerin arasından geçmişti — hepsi de zincir kusuru, parça kusuru
değil:

| # | Kusur | Etkisi |
|---|-------|--------|
| **K1** | `public._trip_source()` migration 047'de **25 kez çağrılıyor**, hiçbir migration'da **TANIMLI DEĞİL** | plpgsql geç bağlandığı için migration geçerdi; **her trip yüklemesi** ilk çağrıda `42883` ile ölürdü |
| **K2** | 047'nin kendi doğrulama bloğu, imzayı `pg_get_function_identity_arguments` **tip desenine** göre arıyordu — o fonksiyon **parametre isimlerini de** döndürür | Desen asla eşleşmez → **migration hiçbir zaman uygulanamazdı** (bu, DB tarafının hiç koşulmadığının kesin kanıtıdır) |
| **K3** | `tripUploadRuntime` sabit `distanceSource:'DERIVED'`, `fuelMeasured:false` gönderiyordu | Üretilen gerçek provenance eziliyordu: **ölçülmüş mesafe "türetme", ölçülmüş yakıt "tahmin"** olarak yüklenirdi — P2'nin ana amacının tersi |
| **K4** | `p_provenance` · `p_price` · `p_coverage` · `p_metrics_version` **hiç gönderilmiyordu** | 047'nin eklediği 20+ kolon kalıcı olarak **boş** kalırdı |
| **K5** | Kanonik `TripMetrics`'te **`unknownTimeMin` alanı yoktu** | Süre invaryantının üçüncü kovası buluta hiç ulaşmaz, invaryant **denetlenemez** olurdu |

Ek olarak Fleet UI, sunucunun kabul ettiği **`VERY_HIGH`** güvenini tanımıyor
ve **"Bilinmiyor"a düşürüyordu** (K6) — yani kanıta dayalı en yüksek güven, en
düşük güvene çevriliyordu.

Altısı da bu turda düzeltildi ve **zincir kilitleriyle** (38 + 22 test)
kapatıldı. K1 gerçek PostgreSQL'de **çağrılarak** kanıtlandı:

```
ERROR:  function public._trip_source(unknown) does not exist
```

---

## 2. PREFLIGHT — koddan çıkarılan gerçek

Aşağıdaki tablo **kodun bugünkü hâlinden** çıkarıldı (bu turun düzeltmeleri
dahil). "Tazelik kapısı" bir örneğin metrik üretmeye hak kazanma koşuludur.

| Metrik | Kaynak | Ölçülüyor mu | Tazelik kapısı | Kalıcı mı | Buluta gidiyor mu | Güvenilirlik |
|--------|--------|--------------|----------------|-----------|-------------------|--------------|
| `distance` | GPS haversine (birincil) · OBD Euler (yedek) | ✅ | accuracy ≤ 50 m · delta 5–300 m · GPS 5 s bayatsa OBD | ✅ | ✅ | GPS payı ≥ %70 → `MEASURED`, aksi `DERIVED` |
| `duration` | `performance.now()` deltası | ✅ | monotonik (saat atlamasına bağışık) | ✅ | ✅ | `MEASURED` |
| `averageSpeed` | hız örnekleri ortalaması | ✅ | örnek başına hız aralığı 0–400 | ✅ | ✅ | `DERIVED` |
| `maxSpeed` | gözlenen tepe | ✅ | aynı | ✅ | ✅ | `MEASURED` |
| `fuelUsed` (%) | OBD yakıt seviyesi farkı | ✅ **YENİ** | `dataFresh` · 0–100 · ikmal yok · süreklilik · makullük | ✅ | ✅ | `MEASURED` |
| `fuelUsed` (L) | yüzde × depo kapasitesi | ✅ **YENİ** | depo 20–200 L (kullanıcı girdisi) | ✅ | ✅ | `DERIVED` — kapasite yoksa `ESTIMATED` |
| `estimatedCost` | yakıt × fiyat snapshot'ı | ✅ **YENİ** | fiyat 0,01–1 000 | ✅ | ✅ | `DERIVED` (kullanıcı fiyatı) / `ESTIMATED` (fallback) |
| `idleTime` | hız ≤ 1 km/h süresi | ✅ **YENİ** | örnek taze + boşluk yok | ✅ | ✅ | `MEASURED` |
| `movingTime` | hız ≥ 3 km/h süresi | ✅ **YENİ** | aynı | ✅ | ✅ | `MEASURED` |
| `unknownTime` | boşluk / bayat / eşik-arası süre | ✅ **YENİ** | — (tanım gereği kapıyı geçemeyen süre) | ✅ | ✅ | `MEASURED` |
| `stopCount` | ≥ 5 s duruş, tek sayım | ✅ **YENİ** | jitter debounce | ✅ | ✅ | `MEASURED` |
| `maxRpm` | OBD `rpm` | ✅ **YENİ** | `dataFresh` · 0–20 000 · `-1` sentinel reddi | ✅ | ✅ | `MEASURED` |
| `maxEngineTemp` | OBD `engineTemp` | ✅ **YENİ** | `dataFresh` · −50…250 · `-1` reddi | ✅ | ✅ | `MEASURED` |
| `speedViolationCount` | **YOK** | ❌ | — | — | ❌ (`NULL`) | `UNAVAILABLE` — gerekçe §11 |
| `harshBrakeCount` | \|Δhız\| > 15 km/h, delta < 0 | ✅ **artık KALICI** | aynı kaynak · ardışık · 2 s debounce | ✅ **YENİ** | ✅ | `MEASURED` |
| `harshAccelerationCount` | aynı, delta > 0 | ✅ **artık KALICI** | aynı | ✅ **YENİ** | ✅ | `MEASURED` |
| `confidence` | kanıt türetmesi | ✅ **YENİ** | — | ✅ | ✅ | kanıt tabanlı, kanıtı da taşınır |

### P1'de "yok" denen ve bu turda kapatılanlar

- **B2** stop count → kapandı (PAUSED/RESUMED kararı için bkz. §13)
- **B3** gerçek yakıt ölçümü → kapandı
- **B4** fiyat snapshot'ı → kapandı (kullanıcı fiyat ayarı hâlâ açık borç)
- **B5** idle/moving/max rpm/max temp → kapandı; speed violations **bilinçli** açık
- **B6** harsh brake/accel kalıcılığı → kapandı

---

## 3. MEVCUT TRIP METRIC GERÇEĞİ

`tripLogService` **tek otorite olarak korundu.** Ona eklenen şey yeni bir
sistem değil, **kendi abonelikleri içinde saf yardımcı çağrıları**:

```
_onGPS / _onOBD  ──►  applySample(acc, sample)      [SAF: I/O·timer·Date.now YOK]
                                │
      trip kapanışı ──►  sealAccumulator()  ──►  evaluateFuelMeasurement()
                                              ──►  computeTripCost()
                                              ──►  deriveEvidenceConfidence()
                                │
                          TripRecord (P2 alanları OPSİYONEL)
                                │
                     toCanonicalTripSummary()  ──►  TripSummary
                                │
                       tripUploadRuntime  ──►  upload_vehicle_trip()
```

**İkinci otorite kurulmadı:** `tripMetricsAccumulator` ve `tripCostModel`
abonelik kurmaz, timer açmaz, durum sahiplenmez. Zaman daima dışarıdan
(`performance.now()`) verilir.

**Fail-soft:** P2 metrik üretiminin tamamı `try/catch` içinde; üretim düşerse
**trip yine kaydedilir**, yalnız yeni alanlar eksik kalır (eski davranış).

---

## 4. PROVENANCE MODELİ

Her metrik `MEASURED · DERIVED · ESTIMATED · UNAVAILABLE` sınıflarından
**yalnız birini** taşır ve sınıf **metrik başına** saklanır.

**Tek genel "trip estimated" bayrağı reddedildi**, çünkü tek bir trip'in
mesafesi ölçülmüş, yakıtı tahmini, RPM'i hiç yok olabilir. Veri tabanında
bunun karşılığı **11 ayrı provenance kolonudur** (`duration_source`,
`avg_speed_source`, `max_speed_source`, `idle_source`, `moving_source`,
`stop_count_source`, `max_rpm_source`, `max_temp_source`,
`speed_violation_source`, `harsh_brake_source`, `harsh_accel_source`) +
P1'den gelen üçü (`distance_source`, `fuel_source`, `cost_source`).

**Değeri olmayan metriğin provenance'ı da gönderilmez.** `UNAVAILABLE`
etiketi yazmak "ölçmeye çalıştık, olmadı" iddiasıdır; hiç göndermemek
sunucudaki `COALESCE` sözleşmesiyle eski güvenilir değeri korur.

---

## 5. YAKIT

### Ölçüm kapıları (hepsi geçilmeden `MEASURED` YOK)

`evaluateFuelMeasurement()` sırayla reddeder:

| Kapı | Reddetme gerekçesi |
|------|--------------------|
| başlangıç okuması yok | `NO_START` |
| bitiş okuması yok | `NO_END` |
| trip içinde yakıt **≥ 2 puan arttı** | `REFUEL_SUSPECTED` |
| OBD taşıma bağlantısı koptu | `CONTINUITY_BROKEN` |
| fark negatif (şamandıra gürültüsü) | `NEGATIVE_DELTA` |
| 100 km'de > %60 tüketim | `IMPLAUSIBLE` |
| mesafe yok (makullük sınanamaz) | `NO_DISTANCE` |

Bayat örnek (`dataFresh === false`) yakıt okuması **üretmez** — yalnız süre
kovasına yazılır.

### Yüzde ≠ litre

**Yakıt seviyesi farkı litre DEĞİLDİR.** `fuelUsedPercent` doğrudan sensör
farkıdır ve `MEASURED`'dır. Litreye çevirme ayrı bir işlemdir ve **daima
`DERIVED`**'dır: depo kapasitesi **kullanıcı araç profilinden** gelir
(`settings.vehicleProfiles[].fuelTankL`), üretici verisi değildir.

- Kapasite yoksa / 20–200 L dışındaysa → **litre ÜRETİLMEZ**;
  litre alanı sabit varsayıma düşer ve `ESTIMATED` etiketlenir,
  `fuelRejectReason = 'NO_TANK_CAPACITY'` yazılır.
- Ölçülen **yüzde** yine de saklanır ve buluta gider.

### Sabit `8,5 L/100 km` — kaynağı ve kapsamı

- **Kaynak:** `tripLogService.FUEL_L_PER_100KM`, kodda doğrudan yazılmış sabit.
- **Kapsam:** araç profiline, motor hacmine, yakıt türüne **bağlı değil**;
  tüm araçlar için aynı.
- **Statü:** **varsayılan fallback**. Yalnız ölçüm kapıları geçilemediğinde
  kullanılır ve **daima `ESTIMATED`** etiketlenir.
- **Silinmedi** (geriye uyum: `TripRecord.fuelConsumptionL` sözleşmesi ve
  100 kayıtlık geçmiş), ama **artık ölçüm gibi davranamıyor.**

---

## 6. MALİYET

```
cost = fuelUsedL × unitPrice        (başka hiçbir yol yok)
```

| Fiyat kaynağı | Maliyet sınıfı |
|---------------|----------------|
| `USER_DEFINED` (kullanıcı ayarı) + yakıt ölçülmüş | `DERIVED` |
| `DEFAULT_FALLBACK` (45 TL/L sabiti) | **`ESTIMATED`** |
| `UNAVAILABLE` | `cost = null` |

**"Ölçülmüş maliyet" diye bir şey yoktur** — çarpım daima türetmedir; bu
yüzden zincirin en iyi sonucu `DERIVED`'dır.

### Fiyat SNAPSHOT'tır

Fiyat **trip başlangıcında** alınır (`_capturePrice()` → `ActiveTrip.price`)
ve trip ile birlikte saklanır (`fuel_unit_price`, `currency`, `price_source`,
`price_captured_at`). Trip kapandıktan sonra kullanıcı fiyatı değiştirirse
**geçmiş trip'in maliyeti DEĞİŞMEZ.** Aksi hâlde geçen ayın raporu bu ayın
fiyatıyla yeniden yazılır ve Cost Analysis geçmişi sessizce bozulur.

`currency` zorunlu taşınır: para birimi olmayan bir tutar Cost Analysis'te
anlamsızdır ve farklı kurlar sessizce toplanır. Fleet UI para birimini
snapshot'tan alır; **varsayılan bir para birimi uydurmaz.**

> **Açık borç:** kullanıcı için birim fiyat **ayar yüzeyi YOK** (kod
> taramasıyla doğrulandı: araç profilinde ve ayarlarda fiyat alanı
> bulunmadı). Bu yüzden bugün maliyet **daima `ESTIMATED`**. Alan
> eklendiğinde `_capturePrice()` `USER_DEFINED` döner ve maliyet
> kendiliğinden `DERIVED`'a yükselir — **hesap mantığı değişmez.**

---

## 7. SÜRÜŞ OLAYLARI

`harshBrakeEvents` / `harshAccelEvents` artık RAM'de kaybolmuyor;
`TripRecord.harshBrakeCount` / `harshAccelCount` olarak **kalıcı**.

| Kural | Uygulama |
|-------|----------|
| Eşik | \|Δhız\| > **15 km/h** — mevcut `tripLogService` değeri KORUNDU (geçmiş skorlarla kıyaslanabilirlik) |
| Debounce | **2 s** — tek fiziksel manevra (1,5–3 s) çok örnekte eşiği aşar; debounce'suz **3–5 kez** sayılırdı |
| Çift sayım | Aynı olay bir kez; `lastHarshPerfMs` çapası |
| Veri boşluğu | `isGap` (> 3 s) ise olay **üretilmez** — 8 s susan kaynağın dönüşündeki 40 km/h fark bir fren değil, **boşluktur** |
| Kaynak geçişi | `s.source === acc.lastSource` şartı — GPS↔OBD geçişi olay **DEĞİLDİR** |
| Reconnect spike | `dataFresh === false` örnek ölçüm üretmez; `transportConnected === false` süreklilik kırar |
| İlk örnek | `prevSpeed === null` → olay yok |
| Trip sınırı | Birikim trip başında sıfırlanır (`createAccumulator()`) |

**Yön ayrımı korunurken toplam sayaç (`harshEvents`) değişmedi** —
`drivingScore` sözleşmesi ve geçmiş kayıt biçimi bozulmadı.

P2'de **tam olay tablosu kurulmadı** (görev metni bunu şart koşmuyor);
öncelik sayaçların kaybolmamasıydı. Kanonik `TripEvent` tipi mevcut ve
koordinat taşımıyor; doldurulması ayrı tur.

---

## 8. MOVING / IDLE / UNKNOWN

```
moving  : son geçerli hız ≥ 3 km/h
idle    : son geçerli hız ≤ 1 km/h
unknown : boşluk (> 3 s) · bayat örnek · eşikler arası (1–3 km/h) · hız bilinmiyor
```

**Bilinmeyen süre IDLE SAYILMAZ.** "Muhtemelen duruyordu" demek tahmin
üretmektir ve Driver DNA'yı kalıcı olarak yanlış eğitir.

**Kapanış kuyruğu:** son örnekten trip kapanışına kadar geçen süre
`sealAccumulator()` ile **`unknown`**'a yazılır — o aralıkta ölçüm yoktur.

### İnvaryant

```
moving + idle + unknown ≤ duration
```

Üç yerde birden korunuyor:
1. **Birikimde** — her aralık tam olarak bir kovaya yazılır.
2. **Testte** — kilit A5 (kök) ve C5 (website).
3. **Veri tabanında** — `vehicle_trips_duration_invariant` CHECK kısıtı,
   dakika yuvarlaması için **±3 dk** toleranslı (her kova ±1 dk).

---

## 9. DURUŞ MODELİ

| Kural | Değer / uygulama |
|-------|------------------|
| Minimum duruş | **5 s** — gerçek bir duruşun (ışık/trafik) alt sınırı |
| GPS jitter | Duran araçta 0↔2 km/h salınımı **duruş sayılmaz**; her salınım sayılsaydı şehirde ~200 duruş çıkardı |
| Aynı duruş tekrar sayılmaz | `currentStopCounted` bayrağı |
| Duruş bitişi | Hız ≥ 3 km/h → çapa temizlenir |
| **Final stop** | Trip'i kapatan duruş: idle penceresi (60 s) dolduğunda `cleanClose = true` işaretlenir ve confidence kanıtı olur. Bu duruş 5 s kapısını çoktan geçtiği için `stopCount`'a **dahildir** |

---

## 10. MAX RPM / MAX SICAKLIK

Yalnız **taze + geçerli** OBD verisinden:

- `dataFresh === false` → örnek ölçüm üretmez (yalnız süre kovası alır)
- `-1` sentinel'i (**desteklenmiyor**) → `null`, **0 DEĞİL**
- Aralık dışı reddedilir: RPM 0–20 000 · sıcaklık −50…250 °C
- Hiç ölçülmediyse **alan `TripRecord`'a KONMAZ** → `UNAVAILABLE`
- Trip başında birikim sıfırlanır → **önceki trip'in tepesi taşınmaz**
- `transportConnected === false` süreklilik kırar
- Provenance: `MEASURED`, kaynak head unit OBD

**Gerçek PostgreSQL kanıtı:** P3 — 046'dan kalan satırlarda P2 kolonları
`NULL` kaldı (uydurma `0` yazılmadı).

---

## 11. SPEED VIOLATION — bilinçli olarak ÜRETİLMİYOR

Araştırıldı, **gerçek hız limiti kaynağı bulunamadı:**

| Aday kaynak | Bulgu |
|-------------|-------|
| Navigation speed limit | Rota katmanında yol limiti alanı yok |
| Map provider limit | Offline tile'lar limit metaverisi taşımıyor |
| Road sign / CAN limit | Böyle bir sinyal okunmuyor |
| User/fleet tanımlı limit | **Ayar yüzeyi yok** |

`SPEED_LIMIT_KMH` benzeri sabitler **global varsayımlardır**, yol limiti veya
filo tanımı değildir. Sabit bir eşikten "ihlal" üretmek, 130 km/h otoyolda
giden sürücüyü ihlalci gösterirdi.

**Karar:**
```
speedViolationCount = null
speed_violation_source = UNAVAILABLE
```

Segment mantığı, histerezis ve threshold snapshot'ı **gerçek limit kaynağı
geldiğinde** eklenecek — kaynaksız bir ihlal motoru yazmak, ölçmediğimiz bir
şeyi ölçüyormuş gibi göstermektir.

> `drivingScore` içindeki mevcut hız cezaları (>120/130/150/180) **korundu** —
> onlar bir "ihlal sayısı" iddiası değil, skor bileşenidir ve P1'den beri var.

**Gerçek PostgreSQL kanıtı:** P13 — ihlal üretilmedi; P12 — tanınmayan
provenance uydurulmadı (`NULL`).

---

## 12. CONFIDENCE

Tek sezgisel sayı **değil**; bağımsız kanıtlardan türer ve **en zayıf kritik
kanıt tavanı belirler**.

| Kanıt | Tavan eşlemesi |
|-------|----------------|
| Mesafe kaynağı | `MEASURED`→VERY_HIGH · `DERIVED`→MEDIUM · `ESTIMATED`→LOW |
| Süre kaynağı | `MEASURED`→VERY_HIGH |
| Hız örneği kapsaması | ≥60→VERY_HIGH · ≥20→HIGH · ≥5→MEDIUM · ≥1→**LOW** |
| Zaman kapsaması | ≥0,95→VERY_HIGH · ≥0,80→HIGH · ≥0,50→MEDIUM · altı→LOW |
| Kaynak geçişi | ≤2→VERY_HIGH · ≤10→HIGH · üstü→MEDIUM |
| Kapanış güveni | temiz→VERY_HIGH · kesik→MEDIUM |

**Kritik olmayan kanıt:** OBD kapsaması yalnız `engine` güvenini etkiler —
**OBD yokluğu tüm trip'i geçersiz KILMAZ** (GPS'li bir yolculuk hâlâ
geçerlidir).

- **Tek iyi GPS fix `HIGH` üretmez** — örnek kapsaması tavanı `LOW`.
- **Yakıt güveni mesafe güveninden AYRI** — yakıt tahmini olsa da mesafe
  `VERY_HIGH` kalabilir; ikisi ayrı alanlarda kendi etiketlerini taşır.
- **Kanıt da taşınır:** `confidence_limited_by` + `speed_sample_count` +
  `obd_coverage` + `time_coverage` + `data_gap_count` +
  `source_switch_count`. Güveni taşıyıp kanıtını taşımamak onu
  **denetlenemez** kılardı.

---

## 13. LIFECYCLE KARARI — PAUSED/RESUMED **UYGULANMADI**

Görev metni "önce gerçekten gerekli olup olmadığını analiz et" diyor. Analiz
sonucu: **gerekli değil.**

**Gerekçe:** Araç trip modelinde kısa veri kaybı, uygulama arka plana geçmesi,
geçici GPS kaybı ve OBD reconnect **trip'i otomatik PAUSED yapmamalıdır**.
Bunların hepsi bugün zaten doğru ele alınıyor:

- Duruş → `idle` kovası + `stopCount` (PAUSED durumuna gerek yok)
- Veri kaybı → `unknown` kovası + `dataGapCount` (durum değişimi değil)
- OBD reconnect → `obdContinuityBroken` (yakıt ölçümünü reddeder, trip'i değil)

**"Kaç kez durup devam etti" sorusunun cevabı `stopCount`'tur** — bir durum
makinesi geçişi değil, bir ölçümdür. PAUSED/RESUMED eklemek, `tripLogService`'e
ikinci bir durum otoritesi ve belirsiz trip birleştirme mantığı sokardı.

**Karar:**
- Mevcut **RUNNING → COMPLETED** modeli KORUNDU.
- `tripLifecycle.ts` geçiş tablosundaki `PAUSED`/`RESUMED` **enum olarak
  duruyor ama ürün davranışı gibi SUNULMUYOR** — hiçbir yerde üretilmiyor.
- Resume/merge **eklenmedi**; ikinci otorite veya belirsiz birleştirme
  oluşturulmadı.

---

## 14. BACKEND / MIGRATION 047

`supabase/migrations/20260730000047_fleet_trip_metrics_p2.sql` — **yalnız
ileri**; 033–046 dosyalarına dokunulmadı.

### Eklenenler

- **28 yeni kolon**, hepsi **NULLABLE** (bilinmeyen `0` DEĞİL)
- 11 **metrik başına provenance** kolonu + enum CHECK'leri
- `fuel_used_percent` · `fuel_unit` (`L`/`PERCENT` CHECK) · `fuel_reject_reason`
- Fiyat snapshot'ı: `fuel_unit_price` · `currency` · `price_source` (enum
  CHECK) · `price_captured_at`
- `unknown_time_min` — idle'dan ayrı kova
- Kapsama kanıtı: `speed_sample_count` · `obd_coverage` · `time_coverage`
  (0–1 CHECK) · `data_gap_count` · `source_switch_count` ·
  `confidence_limited_by`
- `metrics_version`
- **`VERY_HIGH`** confidence — 046'nın CHECK kısıtı bunu REDDEDİYORDU
- **`vehicle_trips_duration_invariant`** CHECK — süre invaryantı DB'de de
- **`public._trip_source(text)`** yardımcısı (bu turda EKLENDİ — K1)

### Korunanlar

- `(vehicle_id, trip_key)` **UNIQUE** ve dedupe/revizyon davranışı
- `COALESCE(EXCLUDED.x, t.x)` → **NULL eski güvenilir metriği EZMEZ**
- RLS · tenant isolation · anon kilidi
- `SECURITY DEFINER` + sabit `search_path`
- **Koordinat kolonu YOK** (fail-closed kontrolü ile)

### Bu turda düzeltilenler

1. **`_trip_source` tanımlandı** — 25 çağrısı vardı, tanımı yoktu (K1).
2. **Doğrulama bloğuna canlı çağrı testi eklendi** — plpgsql geç bağlandığı
   için metne bakan denetim bu sınıf hatayı **yakalayamaz**; fonksiyonu
   **çağırmak** gerekir.
3. **İmza deseni düzeltildi** (K2) — `pg_get_function_identity_arguments`
   parametre isimlerini de döndürür.
4. **NOT NULL koruması** — `_trip_source` bilinçli olarak `NULL` döner
   (eskiyi ezmemek için); `distance_source`/`fuel_source`/`cost_source`
   046'da NOT NULL olduğundan ilk yazımda `coalesce(…, 'UNAVAILABLE')`.
5. **Eski P1 yazma imzası DÜŞÜRÜLDÜ** — yeni parametreler ayrı bir *overload*
   oluşturuyordu; iki imza bırakmak, eski imzayı çağıran bir yolun P2
   alanlarını **sessizce düşürmesi** demekti. 046 hiçbir ortama uygulanmadığı
   için sahada eski imzayı çağıran istemci yoktur. Doğrulama bloğu artık
   **tek imza** şartını da denetliyor.

**İdempotency:** ikinci uygulamada da `047 OK` + `COMMIT` (ölçüldü).

---

## 15. FLEET UI

`website/src/lib/fleet/vehicleTripsView.ts` (saf) + `VehicleModal.tsx`.

Yolculuk kartında artık gösterilenler: **Bitiş · Mesafe · Süre · Hareket ·
Rölanti · Bilinmeyen · Duruş · Yakıt · Maliyet · Ort. hız · Maks. hız ·
Maks. RPM · Maks. sıcaklık · Sert fren · Sert hızlanma · Hız ihlali · Skor ·
Güvenilirlik.**

| Kural | Uygulama |
|-------|----------|
| `null` → `0` **YASAK** | "Veri yok" |
| Ölçülen `0` | "0 dk" / "0" — **"Veri yok" DEĞİL** |
| `ESTIMATED` → `MEASURED` **YASAK** | "(tahmini)" eki + soluk renk |
| Bilinmeyen → normal **YASAK** | Ayrı "Bilinmeyen" satırı |
| Para birimi | **Snapshot'tan**; uydurulmaz (yoksa birimsiz) |
| **`VERY_HIGH`** | **Bu turda eklendi (K6)** — önce "Bilinmiyor"a düşüyordu |
| Yakıt ölçülemedi | **Gerekçesi yazılıyor** ("Yolculuk sırasında yakıt alındı" vb.) |
| Metrik başına kaynak | Her metrik KENDİ provenance kolonunu okur |
| Koordinat/rota | Görünümde **YOK** (kilit E4) |

Kart altına açıklama eklendi: *"Veri yok" o metriğin ÖLÇÜLMEDİĞİ anlamına
gelir — sıfır olduğu anlamına DEĞİL.*

---

## 16. CAROS LAB

`TripEngineScreen` üç yeni salt-okunur bölümle genişletildi:

| Bölüm | Alanlar |
|-------|---------|
| **Last Completed Trip · Metric Provenance** | `lastCompletedTripKey` · mesafe · süre · **movingTime · idleTime · unknownTime** · `stopCount` · ort./maks. hız · `maxRpm` · `maxEngineTemp` · sert fren/hızlanma · `speedViolationSource` — her biri **[kaynak etiketiyle]** |
| **Fuel & Cost** | yakıt (ölçülen %) · yakıt (litre) · `fuelSource` · `fuelUnit` · `fuelRejectReason` · maliyet · `costSource` · birim fiyat snapshot'ı · `priceSource` · fiyat alınma yaşı |
| **Confidence Evidence** | `tripConfidence` · `confidenceLimitedBy` · `distanceSource` · `sampleCoverage` · `obdCoverage` · `timeCoverage` · `dataGapCount` · `sourceSwitchCount` · `metricsVersion` |

Upload Queue bölümüne `lastUploadResult` eklendi.

**Kurallar korundu ve kilitlendi (E1–E4):** aktif komut YOK · timer/abonelik
YOK · açılışta tek okuma + elle YENİLE · **rota/koordinat gösterilmez** ·
mutlak zaman yerine yaş · bilinmeyen kapsama sahte `%0` değil `UNAVAILABLE` ·
okuma düşerse ekran çökmez.

---

## 17. POSTGRESQL DOĞRULAMASI — **33 kontrol, gerçek DB**

Yerel Supabase `supabase_db_fleetval`, gerçek RLS ve gerçek `auth.uid()`.
Script: `supabase/verification/local_047_trip_metrics_p2.sql`

```
P1   046 satirlari KORUNDU (3/3)                          PASS
P2   eski satir DEGERLERI degismedi                       PASS
P3   eski satirda P2 kolonlari NULL (sahte 0 YOK)         PASS
P4   _trip_source canli + uydurmuyor                      PASS
P5   upload_vehicle_trip TEK imza (P1 overload dusuruldu) PASS
P6   ILK YAZIM CREATED                                    PASS
P7   sure ayrisimi yazildi (moving/idle/UNKNOWN ayri)     PASS
P8   yakit YUZDE olcumu + birim yazildi                   PASS
P9   FIYAT SNAPSHOT yazildi (kaynak+birim+an)             PASS
P10  CONFIDENCE KANITI yazildi (denetlenebilir)           PASS
P11  METRIK BASINA provenance yazildi                     PASS
P12  TANINMAYAN provenance uydurulmadi (NULL)             PASS
P13  HIZ IHLALI uretilmedi (limit kaynagi YOK)            PASS
P14  VERY_HIGH confidence KABUL edildi                    PASS
P15  metrics_version yazildi                              PASS
P16  AYNI revizyon -> DUPLICATE (yazma YOK)               PASS
P17  YUKSEK revizyon -> UPDATED (duzeltme uygulandi)      PASS
P18  NULL PRESERVATION: eksik alan eskiyi EZMEDI          PASS
P19  eksik PROVENANCE eskiyi ezmedi                       PASS
P20  DUSUK revizyon -> DUPLICATE, deger korundu           PASS
P21  OFFLINE REPLAY 10x -> TEK satir, deger bozulmadi     PASS
P22  SURE INVARYANTI kisiti calisiyor                     PASS
P23  fuel_unit kisiti calisiyor (L/PERCENT)               PASS
P24  kapsama 0-1 kisiti calisiyor                         PASS
P25  provenance enum kisiti calisiyor                     PASS
P26  MESAFESIZ trip reddedildi (satir YOK)                PASS
P27  gecersiz api_key REDDEDILDI                          PASS
P28  ANON DENY: tablo SELECT=f, okuma RPC=f               PASS
P29  RLS acik                                             PASS
P30  OWNER kendi trip ini GORUYOR                         PASS
P31  CROSS-TENANT reddi (yabanci 0 satir)                 PASS
P32  OTURUMSUZ 0 satir (fail-closed)                      PASS
P33  OKUMA RPC si P2 alanlarini donduruyor                PASS
```

**Migration idempotence:** ikinci uygulamada `047 OK` + `COMMIT` — PASS.

---

## 18. TEST SONUÇLARI

### Yeni kilitler

| Dosya | Adet | Kapsam |
|-------|------|--------|
| `src/__tests__/tripMetricsP2.test.ts` | 674 satır (devralındı) | Metrik ÜRETİMİ: eşikler · yakıt kapıları · debounce · süre kovaları · maliyet · confidence |
| **`src/__tests__/tripMetricsP2Wiring.test.ts`** | **38 (YENİ)** | **ZİNCİR:** provenance kaybolmuyor · unknownTime taşınıyor · fiyat/kapsama taşınıyor · migration bağımlılığı · yükleme yükü · LAB yüzeyi |
| **`website/src/__tests__/vehicleTripsViewP2.test.ts`** | **22 (YENİ)** | Fleet UI: `VERY_HIGH` · metrik başına provenance · bilinmeyen≠sıfır≠rölanti · fiyat snapshot · yakıt gerekçesi |

Trip ile ilgili kök testleri toplamı: **133 PASS**
(`tripMetricsP2` + `tripEngine` + `carosLabTripEngine`).

### Regresyon

| Kapı | Sonuç |
|------|-------|
| Kök `vitest` | **9 192 / 9 192 PASS** (436 dosya) |
| `website` `vitest` | **792 / 792 PASS** (39 dosya) |
| Kök `tsc -b` | **TEMİZ** |
| `website` `tsc --noEmit` | **TEMİZ** |
| `eslint` (kök, dokunulan dosyalar) | **0 hata** |
| `eslint` (website) | dosyalar **ignore pattern'e takılıyor** — lint kanıtı YOK; tip kanıtı `tsc --noEmit` |
| `npm run build` | **GEÇTİ** (1 dk 30 sn) |
| Migration 047 idempotency | `047 OK` + `COMMIT` (2. uygulamada da) |

Realtime · Offline Queue · Vehicle Identity · Location Engine · Fleet P0/P1
testleri **dokunulmadan** geçti.

### Bir test kusurunu ayırdım (ürün kusuru olarak raporlamadım)

`vehicleTripsViewP2` E4: serbest `/lat/i` regex'i **`speedVio·lat·ions`**
kelimesini yakaladı — koordinat sızıntısı değil. Kilit, ham metin yerine
**alan adlarını** hedefleyecek şekilde daraltıldı. (P1'de aynı hata lucide
`Route` ikonunu "rota verisi" sanmıştı — tekrarlayan bir tuzak.)

---

## 19. GERÇEK ARAÇ DURUMU

### `realVehicleValidationVerdict: BLOCKED_REAL_VEHICLE`

Bu turda **hiçbir gerçek yolculuk tamamlanmadı.** Ölçülmedi:

- gerçek trip başlangıcı/kapanışı
- gerçek GPS mesafesi ve gerçek OBD örnekleri
- **gerçek yakıt seviyesi farkı** (P2'nin ana iddiası)
- gerçek sert fren/hızlanma olayı
- çevrimdışı tamamlanma → yeniden bağlantı → **tek** upload
- Fleet readback

**Simülasyon gerçek araç kanıtı olarak sunulmuyor.** Güvenli sürüş koşulları
olmadan sert fren/hızlanma üretmeye çalışılmadı.

Kütüğe **🔴 #219–#225** olarak, ölçülebilir kabul ölçütleriyle eklendi.

---

## 20. DEĞİŞEN DOSYALAR

### Bu turda değiştirilenler

| Dosya | Değişiklik |
|-------|-----------|
| `supabase/migrations/20260730000047_fleet_trip_metrics_p2.sql` | `_trip_source` tanımı · canlı çağrı denetimi · imza deseni · NOT NULL koruması · eski overload DROP · tek-imza denetimi |
| `src/platform/trip/tripCanonicalModel.ts` | `unknownTimeMin` metriği · `TripPriceSnapshot` · `TripCoverage` · `FuelUnit` · `TripSummary` P2 taşıyıcıları |
| `src/platform/trip/tripLifecycle.ts` | P2 alanlarını kayıttan okuma · fiyat/kapsama kurucuları |
| `src/platform/trip/tripUploadRuntime.ts` | `p_provenance`/`p_price`/`p_coverage`/`p_metrics_version` · `unknownTimeMin`/`fuelUsedPercent`/`fuelUnit`/`fuelRejectReason` · sabit bağlam açıklaması |
| `src/components/devtools/screens/TripEngineScreen.tsx` | Üç yeni LAB bölümü (19 alan) + `lastUploadResult` |
| `website/src/lib/fleet/vehicleTripsView.ts` | P2 satır alanları · `VERY_HIGH` · metrik başına provenance · yeni etiketleyiciler |
| `website/src/components/dashboard/VehicleModal.tsx` | 9 yeni metrik satırı · yakıt gerekçesi · para birimi snapshot'ı |
| `src/__tests__/tripMetricsP2Wiring.test.ts` | **YENİ** — 38 zincir kilidi |
| `website/src/__tests__/vehicleTripsViewP2.test.ts` | **YENİ** — 22 UI kilidi |
| `supabase/verification/local_047_trip_metrics_p2.sql` | **YENİ** — 33 gerçek PG kontrolü |
| `docs/FLEET_TRIP_METRICS_P2_REPORT.md` | **YENİ** — bu rapor |
| `docs/DEVICE_VALIDATION_LEDGER.md` | 🔴 #219–#225 |
| `docs/CAROS_PRO_VIZYONU.md` | Trip metriği durumu |

### Devralınan (diğer oturumda yazılmış, bu turda doğrulanmış)

`tripMetricsAccumulator.ts` · `tripCostModel.ts` · `tripLogService.ts` P2
eklemeleri · `tripMetricsP2.test.ts` — kod incelendi, doğru bulundu ve
korundu.

---

## 21. DOKUNULMAYAN ALANLAR

- **`tripLogService` tek otorite** — ikinci trip platformu kurulmadı
- **Deterministik `tripKey`** — formül değişmedi
- **P1 migration geçmişi (033–046)** — hiçbir dosya değiştirilmedi
- **Vehicle Identity · Location Engine · Realtime · Offline Queue** —
  davranışları değişmedi
- **Music Hub · AccountCleanup** — dosyalarına **dokunulmadı**
- **`drivingScore` formülü** ve `harshEvents` toplam sayacı
- **Offline kuyruk** — yeni kuyruk kurulmadı, mevcut at-least-once yolu

---

## 22. AÇIK BORÇLAR

| # | Borç | Neden bu turda yapılmadı |
|---|------|--------------------------|
| **D1** | **Gerçek araç doğrulaması** — kütük #219–#225 🔴 | Araçta yolculuk tamamlanmadı → `BLOCKED_REAL_VEHICLE` |
| **D2** | **Kullanıcı yakıt fiyatı ayar yüzeyi** | Ayar UI + kalıcılık ayrı tur; hesap mantığı hazır, `USER_DEFINED` gelince maliyet kendiliğinden `DERIVED` olur |
| **D3** | **Depo kapasitesi doğrulama akışı** | `fuelTankL` kullanıcı girdisi; üretici verisi olmadığı için litre daima `DERIVED` kalır |
| **D4** | **Gerçek hız limiti kaynağı** → `speedViolationCount` | Kaynak yok (§11); segment/histerezis mantığı kaynak gelince yazılacak |
| **D5** | **Tam olay tablosu** (`TripEvent` doldurma) | P2 önceliği sayaçların kaybolmamasıydı; olay tablosu ayrı tur |
| **D6** | **Geçmiş trip göçü** | Açılış çapası nedeniyle eski 100 trip yüklenmiyor (P1 B7 devam) |
| **D7** | **Migration 040–047 hiçbir ortama uygulanmadı** | `db push` yasak; yalnız yerel doğrulama DB'sinde koşuldu |
| **D8** | **`website` production build'i düşüyor** (`ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY`) | Kütük F5 — **paralel iş akışının sahipliğinde**, bu turda dokunulmadı |

---

## 23. NİHAİ KARAR

### **`FLEET_TRIP_METRICS_P2_COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| `tripP1RegressionVerdict` | **`PRESERVED`** — dedupe · `tripKey` · revizyon · anlık-yükleme-yok · açılış çapası korundu (PG P16–P21 + kilit C5) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** — 040–047 hiçbir ortamda yok |
| Bozulan mevcut sistem | **YOK** |

### Kabul kriterleri karşılığı (§16)

| # | Kriter | Durum |
|---|--------|-------|
| 1 | P1 trip upload ve dedupe korunuyor | ✅ PG P16–P21 |
| 2 | Ölçülmeyen metrikler `null` | ✅ PG P3, P13 · kilit B1 |
| 3 | Yakıt ölçümü ile tahmini ayrılmış | ✅ §5 · PG P8 |
| 4 | Sabit 8,5 L/100 km ölçülmüş gibi sunulmuyor | ✅ daima `ESTIMATED` |
| 5 | Maliyet fiyat snapshot'ına bağlı | ✅ PG P9 · kilit A6/D1 |
| 6 | Harsh brake/accel kaybolmuyor | ✅ kilit A10 |
| 7 | Moving/idle/unknown invaryantı geçiyor | ✅ kilit A5/C5 + DB CHECK (PG P22) |
| 8 | Max RPM/temp yalnız taze OBD'den | ✅ §10 |
| 9 | Hız limiti yoksa ihlal üretilmiyor | ✅ PG P13 |
| 10 | Confidence kanıta dayalı | ✅ §12 · PG P10 |
| 11 | Fleet UI provenance gösteriyor | ✅ §15 |
| 12 | Gerçek PostgreSQL testleri yeşil | ✅ **33/33** |
| 13 | Migration idempotent | ✅ |
| 14 | Mevcut Fleet/Identity/Location bozulmuyor | ✅ regresyon |
| 15 | Deploy/db push yapılmıyor | ✅ |

### Dürüstlük beyanı

Bu rapordaki her PASS **yerel** kanıttır: kök + website vitest, gerçek
`tsc`/build ve **33 gerçek-PostgreSQL** doğrulaması (owner · cross-tenant ·
oturumsuz · anon deny · replay · null preservation · kısıtlar dahil).

**Gerçek araçta hiçbir yolculuk tamamlanmadı** → `BLOCKED_REAL_VEHICLE`.
Kütükte 🔴 bekleyen yedi madde "çalışıyor" olarak sunulmuyor.

En önemlisi: bu tur, **yeşil testin çalışan bir zincir anlamına gelmediğini**
gösterdi. Devralınan kod 9 154 test yeşilken **buluta tek bir doğru metrik
gönderemeyecek** durumdaydı; migration ise hiç uygulanamıyordu. Bulguların
tamamı ancak **gerçek PostgreSQL'i çalıştırınca** ve **zinciri uçtan uca
kilitleyince** görüldü. Yeni `*Wiring` test dosyası tam olarak bu boşluğu
kapatmak için var: parçaları değil, **parçalar arasındaki bağı** ölçer.
