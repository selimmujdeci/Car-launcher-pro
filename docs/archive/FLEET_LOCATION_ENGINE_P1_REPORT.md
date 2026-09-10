# CAROS PRO — FLEET LOCATION ENGINE P1 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** YALNIZ konum katmanı. Geofence · Trip History · AI · Driver DNA ·
Deep Scan · CAN · Harita · Rota analizi **DAHİL DEĞİL**.
**Commit / push / deploy / db push:** YAPILMADI (kural gereği)

---

## 1. NİHAİ KARAR

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| Gerçek GPS cihazı doğrulaması | **`BLOCKED_REAL_DEVICE`** |
| Harici GPS taşıması (BT/USB/TCP) | **KAPSAM DIŞI** — yalnız kayıt arayüzü kuruldu |
| Phone Hub GPS | **KAPSAM DIŞI** — yalnız öncelik yuvası |

**`BLOCKED_REAL_DEVICE` gerekçesi:** bu turda araca bağlı gerçek bir GNSS
alıcısı veya harici GPS modülü YOKTU. Hiçbir gerçek fix, gerçek kaynak
geçişi, gerçek tünel/köprü kesintisi ölçülmedi. Kütükte #209–#212 🔴
bekliyor. Yerel kanıt tamdır (§8) ama **saha kanıtı sıfırdır.**

---

## 2. MEVCUT MİMARİ (§1 — koddan çıkarıldı, tahmin yok)

| Bileşen | Dosya | Yaşam döngüsü | Thread | Sıklık |
|---------|-------|---------------|--------|--------|
| **Fix kaynağı** | `gpsService.ts:283 startGPSTracking()` | `useLayoutServices.ts:78` (React mount) → `stopGPSTracking` unmount'ta | **ana thread** | Capacitor `watchPosition`; native → web `navigator.geolocation` fallback |
| **Warm start** | `gpsService.ts:342` | tracking başlarken TEK sefer | ana | `getCurrentPosition`, 10 s timeout |
| **İlk fix fallback** | `_firstFixTimer` + `GPS_FIRST_FIX_MS=5000` | 5 s içinde fix yoksa last-known/TR varsayılan | ana | tek sefer |
| **Throttle** | `_positionThrottleMs()` | her fix'te | ana | **200 ms (5 Hz)**; termal L2+ → **500 ms** |
| **Runtime aralığı** | `_gpsUpdateMs` + `runtimeManager.subscribe` | mod değişiminde soft-restart | ana | `min(config.gpsUpdateMs, 500)` → **taban 2 Hz** |
| **Jump guard** | `gps/fusionCore.isJumpInvalid` | her fix'te | ana | >100 m atlama + accuracy>30 m → **fix REDDEDİLİR** |
| **DR→GPS fusion ramp** | `gps/fusionCore.calculateFusionRamp` | DR'dan çıkışta | ana | **3 s** ağırlıklı blend |
| **Hız** | `gps/speedCore` (`computeSpeedDelta`·`pickRawSpeed`·`applySpeedFilters`) | her fix'te | ana | delta çapası ≥500 ms'de ilerler |
| **Yön** | `gps/headingCore` (`computeBlendedHeading`) | her fix'te | ana | <3 km/h %100 pusula · >10 km/h %100 GPS |
| **Pusula** | `sensors` + `gps/compassDemand` | talep sayımlı (ref-count) | ana | 100 ms throttle |
| **Last-known** | `_saveLastKnown` → `LAST_KNOWN_KEY` | fix'te | ana | **5 s'de bir**, yalnız `{lat,lng}` (**damga YOK**) |
| **Store #1** | `useGPSStore` (gpsService-özel) | — | ana | her kabul edilen fix |
| **Mirror** | `gpsService.ts:61` `useGPSStore.subscribe` | — | ana | → `UnifiedVehicleStore.updateGPSState` |
| **Store #2** | `UnifiedVehicleStore` (**tek doğru kaynak**) | — | ana | `onGPSLocation` buradan okur |
| **`onGPSLocation`** | `gpsService.ts:672` | `UnifiedVehicleStore` aboneliği | ana | konum referansı değişince |
| **`GpsAdapter`** | `vehicleDataLayer/GpsAdapter.ts` | `vehicleDataLayer/index.ts:146` | ana | **200 ms throttle** → `GPS_DATA` mesajı |
| **Worker** | `VehicleCompute.worker.ts` | `GPS_DATA` mesajı alır | **worker thread** | ön-ayrılmış `_gpsLocBuf` (zero-allocation) |
| **`speedFusion`** | `speedFusion.ts` | CAN/OBD/GPS hız füzyonu | ana | `SpeedSource: can\|obd\|gps\|fused\|none` |
| **Harici besleme** | `feedBackgroundLocation` (`gpsService.ts:689`) | native arka plan servisi | ana | aralık + finite doğrulaması VAR |
| **`vehicle_locations`** | `push_vehicle_event` RPC | telemetri push | server | her konumlu paket → **geçmiş satırı** |
| **`vehicle_telemetry`** | aynı RPC | aynı | server | **upsert** (araç başına tek satır) |
| **Kadans (Fleet)** | `telemetryService` | sürüş 5 s · park 10 dk · derin uyku 1 sa | ana | — |

### §1'de sorulan ama BULUNMAYAN üç şey (dürüst kayıt)

- **`fusionCore` ve `headingCore` YALNIZ `gpsService` tarafından kullanılıyor**
  — başka tüketicisi yok (grep ile doğrulandı).
- **`LAST_KNOWN` deposunda zaman damgası YOK.** `_saveLastKnown` yalnız
  `{lat,lng}` yazıyor → son bilinen konumun YAŞI bilinemez.
- **İki ayrı store var** (`useGPSStore` → mirror → `UnifiedVehicleStore`).
  Tüketiciler ikincisinden okur; birincisi gpsService'in iç durumudur.

---

## 3. YENİ KATMAN — TASARIM İLKESİ

`gpsService` **sahada doğrulanmış** ağır işleri yapıyor (jump guard · DR
fusion ramp · heading blend · termal throttle · first-fix fallback ·
geofence throttle · last-known kalıcılığı). Kural açıktı: *"Mevcut
davranışı bozma."*

Bu yüzden yeni katman **onun üstüne** oturdu ve `gpsService` artık
**yalnızca bir sağlayıcıdır** (`HEAD_UNIT_GPS`). Motor onu **gözlemler**:
başlatmaz, durdurmaz, yeniden başlatmaz, `runtimeManager`/termal
ayarlarına dokunmaz (kilit testleri #11, #12).

Bugün konum tüketen hiçbir yer (`onGPSLocation` · `GpsAdapter` ·
`useGPSLocation` · `FullMapView` · `speedFusion` · radar · geofence)
**değişmedi ve bu motora bağlanmak zorunda değil**. Motor ek bir **karar
ve gözlem katmanıdır**.

---

## 4. LOCATION PROVIDER SOYUTLAMASI (§2)

`src/platform/location/locationProvider.ts` — saf.

`LocationSample`: `latitude · longitude · accuracyM · headingDeg ·
speedMps · timestampMs · provider · confidence` (§2'de istenen 7 alan +
güven).

| Kural | Davranış | Kilit |
|-------|----------|-------|
| Geçersiz koordinat | **TÜM örnek reddedilir** — yarım konum yoktur | #3 |
| Zaman damgası yok | örnek reddedilir (tazelik kurulamaz) | #4 |
| Yardımcı alan geçersiz | **yalnız o alan** `null` | #5 |
| `accuracyM = 0` | **REDDEDİLİR** — fiziksel olarak imkânsız, "bilinmiyor" demek için kullanılamaz | #6 |
| `speedMps = 0` | **GEÇERLİDİR** (durağan araç) | #7 |
| Tanınmayan sağlayıcı/hata | `UNKNOWN` — uydurulmaz | #8 |

Güven sağlayıcı tarafından **ATANMAZ** (`RawLocationSample` güven
içermez); hakem atar. Sağlayıcı kendi güvenini yükseltemez.

---

## 5. DESTEKLENEN KAYNAKLAR (§3)

| # | Sağlayıcı | Bu turdaki durum |
|---|-----------|------------------|
| 1 | `EXTERNAL_GPS` | **Kayıt arayüzü hazır**; taşıma (BT/USB/TCP) kapsam dışı → kayıtsız, `available=false` |
| 2 | `HEAD_UNIT_GPS` | **Canlı** — `gpsService` gözlemi |
| 3 | `PHONE_HUB_GPS` | Öncelik yuvası açık; kayıt yok |
| 4 | `LAST_KNOWN` | **Canlı** — `LAST_KNOWN_KEY`'den; ASLA `LIVE` olmaz |
| — | Hiçbiri | `UNKNOWN` + `sample = null` (tahmin ÜRETİLMEZ, kilit #27) |

**Kayıtsız sağlayıcı "HAZIR" göstermez** (kilit #16); yerleşik ikisinin
üzerine yazılamaz (iki otorite yasağı).

---

## 6. GÜVEN MODELİ (§4) — "TEK FIX HIGH DEĞİLDİR"

Güven **üç bağımsız kanıttan** türer ve **en zayıf kanıt tavanı belirler**:

| Kanıt | Tavan |
|-------|-------|
| Hassasiyet | ≤10 m → `VERY_HIGH` · ≤25 m → `HIGH` · ≤75 m → `MEDIUM` · üstü → `LOW` · **bilinmiyor → `MEDIUM`** |
| Tazelik | ≤3 s → `VERY_HIGH` · ≤15 s → `MEDIUM` · üstü → `LOW` |
| **Süreklilik** | ≥6 fix → `VERY_HIGH` · ≥3 fix → `HIGH` · **<3 fix → `MEDIUM`** |

Neden süreklilik: tek fix, gerçek konumu çok yollu yansımadan (multipath),
soğuk başlangıç kaba fix'inden ve tünel çıkışı sıçramasından **ayırt
edemez**. Bunlar ancak birbirini doğrulayan ardışık fix'lerle ayrılır.

Ek kurallar: `LAST_KNOWN` tavanı **`LOW`** (kalıcı depo şu anı temsil
etmez) · gelecekten gelen fix → `UNKNOWN` (saat kayması) · **kaynak
değişince süreklilik SIFIRLANIR** (yeni kaynağın ilk fix'i tek fix'tir —
kilit #34) · aynı fix tekrar gelirse süreklilik **şişmez** (kilit #40).

---

## 7. TİTREŞİM KONTROLÜ (§5)

Üç kapı:

1. **Öncelik + uygunluk** — yalnız `available` ve geçerli örneği olan
   sağlayıcılar yarışır; bayat örnek (>15 s) aday olamaz (`LAST_KNOWN`
   muaf).
2. **Yükseltme serbest, düşürme gecikmeli** — daha iyi kaynağa geçiş
   anında; daha kötüye düşüş `DEMOTE_GRACE_MS = 6 s` bekler. Asimetri
   kasıtlı: **iyiye hızlı, kötüye temkinli.**
3. **Minimum tutunma** — her geçişten sonra `MIN_DWELL_MS = 4 s` boyunca
   yeni geçiş yapılmaz.

**Ölçülen sonuç (kilit #33):** harici kaynak 20 saniye boyunca her
tick'te (2 Hz, 40 tick) var/yok olarak zıplatıldığında kapılar olmasaydı
~40 geçiş olurdu; **gerçekleşen ≤6.** Geçiş engellendiğinde gerekçe
(`DWELL` / `DEMOTE_GRACE` / `NO_CANDIDATE`) **görünür** — sessiz davranış
yok.

---

## 8. TESTLER (§8)

### Yerel birim kilitleri — **57 yeni kilit**

| Dosya | Adet | Kapsam |
|-------|------|--------|
| `src/__tests__/locationEngine.test.ts` | **40** | provider switch · null · stale · accuracy · fallback · reconnect · provider unavailable · external preferred · head unit fallback · phone hub fallback · last known · unknown · titreşim · regresyon |
| `src/__tests__/carosLabLocationEngine.test.ts` | **17** | LAB salt-okunurluk · koordinat gizliliği · "gpsService'e dokunmama" yapısal kilidi |

§8'de istenen senaryoların **tamamı** kapsandı.

### Gerçek PostgreSQL — **13 doğrulama** (mock DEĞİL)

```
L1  HEAD_UNIT_GPS kaynagi + accuracy + gps_observed_at KALICI       PASS
L2  EXTERNAL_GPS kaynagi DB tarafinda KABUL EDILIYOR                PASS
L3  tanınmayan kaynak UYDURULMUYOR -> UNKNOWN                       PASS
L4  konum yoksa ESKI konum EZILMIYOR (yalniz motor verisi geldi)    PASS
L5  accuracy bilinmiyorsa 0 YAZILMIYOR (null kaliyor)               PASS
L6  istemci saati OTORITE DEGIL (observed<=now, received dolu)      PASS
L7  konum gecmisine de accuracy + kaynak yaziliyor                  PASS
L8  GECERSIZ koordinat ATILIYOR, payload'in geri kalani YAZILIYOR   PASS
L8b NULL ISLAND (0,0) gercek konum SAYILMIYOR                       PASS
L9  kaynak enum'u CHECK kisitiyla korunuyor                         PASS
L10 LAST_KNOWN db enum'unda YOK (istemci-ici kavram)                PASS
L11 anon EFEKTIF olarak 0 satir goruyor (RLS fail-closed)           PASS
L12 observed_at indeksi HER IKI tabloda da var                      PASS
```

### Regresyon

| Kapı | Sonuç |
|------|-------|
| Kök `vitest` | **9 004 / 9 004 PASS** (431 dosya) |
| `website` `vitest` | **741 / 741 PASS** (36 dosya) |
| **`npm run build` (`tsc -b` + vite)** | **GEÇTİ** — 2703 modül, 1m33s |
| `website` `tsc --noEmit` | **TEMİZ** |
| `eslint` (yeni dosyalar) | **0 hata** |
| Migration 045 idempotency | ikinci uygulamada da `045 OK` + `COMMIT` |

### ⚠️ Ölçüm dürüstlüğü — üç FAIL'in analizi

İlk koşumda L8, L11, L12 `FAIL` verdi. Hüküm vermeden önce her birini
kanıtladım:

- **L8 → GERÇEK KUSUR.** `push_vehicle_event` koordinat aralığını
  doğrulamıyordu; `lat=999` **veritabanına yazıldı**. Migration 045 ile
  kapatıldı (§9).
- **L11 → BENİM ÖLÇÜM KUSURUM.** `has_table_privilege('anon',…)` ile
  GRANT'e baktım; oysa RLS açık ve `anon` policy'si YOK → anon **efektif
  olarak 0 satır** görüyor. Doğru ölçüm `SET LOCAL ROLE anon` ile gerçek
  sorgudur. **GRANT ≠ erişim.**
- **L12 → BENİM ÖLÇÜM KUSURUM (ama gerçek bir boşluk açığa çıkardı).**
  042 indeksi `vehicle_telemetry`'ye kurmuş, ben `vehicle_locations`'ta
  aradım. Ancak `vehicle_locations.observed_at` gerçekten **indekssizdi**
  ve konum geçmişi o kolona göre sıralanacak → 045 indeksi ekledi.

---

## 9. MIGRATION 045

`supabase/migrations/20260730000045_location_range_guard.sql` — yalnız
ileri; 033–044 değiştirilmedi.

1. **Mevcut bozuk veri temizliği (zorunlu ön adım).** PostgreSQL, ihlal
   eden satır varsa `ADD CONSTRAINT`'i **reddeder** — yerel doğrulamada
   tam bu oldu. Geçersiz koordinat `NULL`'a çekilir (satırın rpm/temp
   verisi GEÇERLİDİR, kaybedilmez); `vehicle_locations` geçmişindeki
   geçersiz satır SİLİNİR (tek içeriği yanlış konumdur).
2. **Tablo CHECK kısıtları** — RPC atlanırsa da geçersiz koordinat giremez.
3. **`location_in_range()`** saf yardımcı — aralık + **Null Island (0,0)**
   kapısı.
4. **RPC gerçekten kapıya bağlandı.** Yalnız CHECK eklemek YETMEZDİ: o
   durumda geçersiz koordinatlı payload `check_violation` fırlatır ve
   **tüm telemetri yazımı geri alınır** (rpm/temp de kaybolur, kuyruk
   poison'a düşer). Doğru davranış: koordinatı **sessizce yok say**, geri
   kalanı yaz. 042'nin doğrulanmış gövdesi yeniden yazılmadı; hedefli
   yama uygulandı.
5. **Fail-closed doğrulama** — kısıtlar · indeks · davranışsal aralık
   kontrolleri · **RPC'nin kapıya bağlandığının** doğrulaması.

---

## 10. GÖZLEMLENEBİLİRLİK (§7)

**Yeni araç:** `location-engine` (kategori `vehicle`, `AVAILABLE`, katman `GNSS`)

Gösterilenler (§7'de istenenlerin tamamı): **Active Provider** (+önceliği) ·
**Confidence** · **Accuracy** (+sınıfı) · **Age** · **Switch Count** ·
**Fallback Count** · **Provider Priority** tablosu · **Provider Errors**
(+hata sınıfı) · Location State · süreklilik zinciri · geçiş kapısı
gerekçesi · dwell/grace değerleri.

**Gizlilik:** **koordinat (enlem/boylam) GÖSTERİLMEZ** — konum kişisel
veridir (kilit #7). Mutlak zaman damgası da gösterilmez, yalnız yaş
(kilit #8). Bilinmeyen alan `UNAVAILABLE` (kilit #9); okuma düşerse ekran
çökmez (kilit #10).

**Aktif komut YOK** (kilit #4): GPS başlatma/durdurma · `watchPosition` ·
`getCurrentPosition` · `feedBackgroundLocation` · sağlayıcı kaydı ·
motor başlatma/durdurma · `fetch` · timer yok.

---

## 11. BOZULMAYAN ALANLAR

| Alan | Durum |
|------|-------|
| `gpsService` ve tüm GPS davranışı | **Değiştirilmedi** — yalnız gözlemleniyor (kilit #11, #12) |
| Mevcut konum tüketicileri (harita · hız · radar · geofence · worker) | **Değiştirilmedi** |
| Vehicle Identity P1 | **Bozulmadı** — 9 004 test yeşil |
| Realtime · Offline Queue | **Dokunulmadı** |
| Music Hub · AccountCleanup | **Dokunulmadı** |
| Migration 033–044 | **Değiştirilmedi** |
| Production / staging | **Yazma YOK** |

---

## 12. BU TURDA BULUNAN İKİ CİDDİ KUSUR

### K1 — Sunucu koordinat doğrulaması yoktu

`lat=999` veritabanına yazıldı. Zero-trust telemetri ilkesinin doğrudan
ihlali: **istemci doğrulaması sunucu doğrulamasının yerine geçmez.**
045 ile kapatıldı.

### K2 — 🔴🔴 Kök tip denetimim BOŞ ÇIKMIŞ (P0 ve P1 raporlarını etkiler)

Kök `tsconfig.json` bir çözüm dosyasıdır (`"files": []` + references).
`npx tsc --noEmit` **hiçbir şeyi denetlemiyor** — kasıtlı
`const x: number = "metin"` bile sessiz geçti; `tsc -b` aynı hatayı
yakaladı.

**Sonuç:** P0 ve P1 raporlarındaki *"kök tsc temiz"* ifadeleri **boş
denetimdi**. Daha kötüsü: o boş denetim yüzünden P0 (`fleet-connectivity`)
ve P1 (`fleet-identity`) `CarosLabToolId` union'ına eklenmeyen araç
kimlikleri bıraktı ve **kök build'i KIRIK** hâle getirdi —
`npm run build` → `tsc -b` hata veriyordu. Kanıt: union'dan üç id
çıkarıldığında `tsc -b` `TS2322 · Types of property 'id' are
incompatible` verdi.

**Bu turda düzeltildi:** üç id union'a eklendi, `npm run build` gerçekten
geçti (2703 modül). Website tarafındaki `tsc --noEmit` **gerçektir**
(kasıtlı hata ile doğrulandı) — o raporlardaki website iddiaları geçerli.

**Kalıcı kural (kütük #213):** kökte tip kanıtı `npm run build` veya
`npx tsc -b`'dir; `tsc --noEmit` kökte **kanıt değildir**.

---

## 13. AÇIK BORÇLAR

| # | Borç | Neden bu turda yapılmadı |
|---|------|--------------------------|
| **B1** | **Gerçek GPS cihazı doğrulaması** — kütük #209–#212 🔴 | Araca bağlı gerçek alıcı/harici modül yoktu → `BLOCKED_REAL_DEVICE` |
| **B2** | `LAST_KNOWN` deposunda **zaman damgası yok** → yaş bilinemiyor. Motor bunu dürüstçe ele alıyor (asla `LIVE` demiyor) ama gerçek yaş gösterilemiyor | Damga eklemek `gpsService._saveLastKnown` değişikliği gerektirir → "mevcut davranışı bozma" kapsamında ayrı atomik PR |
| **B3** | Motor kararı **hiçbir tüketiciye bağlanmadı** (harita/hız hâlâ doğrudan `gpsService`'ten okuyor) | Kasıtlı: tüketici geçişi davranış değişikliğidir; bu tur yalnız karar+gözlem katmanı kurdu |
| **B4** | `EXTERNAL_GPS` / `PHONE_HUB_GPS` taşıması yok | Kapsam dışı (görev metni) |
| **B5** | Fleet UI konum durumu bu motordan **beslenmiyor** (042/044 kolonlarından besleniyor) | İki katman şimdilik paralel; birleştirme telefon doğrulaması sonrası |
| **B6** | Migration 040–045 **hiçbir ortama uygulanmadı** | `db push` yasak |

---

## 14. DÜRÜSTLÜK BEYANI

Bu rapordaki her PASS **yerel** kanıttır: 9 004 kök + 741 website testi,
gerçek `npm run build`, ve **13 gerçek-PostgreSQL** doğrulaması.

**Gerçek GPS cihazı bağlı değildi** → `BLOCKED_REAL_DEVICE`. Hiçbir gerçek
fix, gerçek kaynak geçişi veya gerçek sinyal kesintisi ölçülmedi; kütükte
🔴 bekleyen dört madde "çalışıyor" olarak sunulmuyor.

Bu turda **kendi önceki iki raporumdaki bir kanıt iddiasının geçersiz
olduğunu** buldum ve düzelttim (§12 K2). Ölçüm kusurlarımı (L11, L12)
ürün kusuru olarak raporlamadım; her birini kanıtlayıp ayırdım.
