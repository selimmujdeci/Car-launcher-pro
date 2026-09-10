# CAROS PRO — FLEET TRIP ENGINE P1 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Mevcut yerel Trip sistemini Fleet'e taşımak. **Yeni trip sistemi
yazılmadı.**
**Commit / push / deploy / db push:** YAPILMADI (kural gereği)

---

## 1. EXECUTIVE SUMMARY

### Nihai karar: **`COMPLETE_LOCAL`** · gerçek araç: **`BLOCKED_REAL_VEHICLE`**

Head unit'te zaten var olan yolculuk verisi artık buluta taşınabiliyor:
kanonik model, yaşam döngüsü otoritesi, dedupe/revizyonlu tek yükleme,
`vehicle_trips` tablosu, LAB gözlem ekranı ve Fleet UI Trips bölümü hazır.
`tripLogService`'in **tek satırı değişmedi**.

**Gerçek araç doğrulaması YOK** — bu turda araca bağlı OBD/GPS ile gerçek bir
yolculuk tamamlanmadı. Hiçbir gerçek trip kapanışı, gerçek yükleme veya
gerçek çevrimdışı replay ölçülmedi. Kütükte #214–#218 🔴 bekliyor.

### Bu turda ortaya çıkan en önemli gerçek

**Yakıt ve maliyet ÖLÇÜLMÜYOR — TAHMİN.** `tripLogService` yakıtı
`mesafe/100 × 8,5 L` sabitiyle, maliyeti sabit birim fiyatla hesaplıyor.
Daha da net: `ActiveTrip.fuelAtStart` yakalanıyor ama `TripRecord`'da
**hiç kullanılmıyor** — yani araçtan okunan yakıt seviyesi atılıyor.

Bu değerleri silmedim (geriye uyum) ama **artık "ölçüm" gibi
davranamıyorlar**: her metrik `MEASURED · DERIVED · ESTIMATED · UNAVAILABLE`
etiketiyle taşınıyor, DB'de `fuel_source`/`cost_source` kolonlarında
saklanıyor ve Fleet UI'da **"(tahmini)"** ekiyle gösteriliyor. Cost Analysis
ve Driver DNA artık varsayımı ölçümden ayırt edebilir.

---

## 2. MEVCUT MİMARİ (§1 — koddan çıkarıldı, tahmin yok)

**Tek trip otoritesi:** `src/platform/tripLogService.ts` (439 satır).

| Bileşen | Yer | Yaşam döngüsü / davranış |
|---------|-----|--------------------------|
| `TripRecord` | `tripLogService.ts:21` | 11 alan: `id · startTime · endTime · distanceKm · durationMin · avgSpeedKmh · maxSpeedKmh · fuelConsumptionL · fuelCostTL · drivingScore · harshEvents` |
| `ActiveTrip` (iç) | `:35` | + `startPerfMs` (monotonik) · `speedSum/speedCount` · `fuelAtStart` · `lastSpeed` · **`harshBrakeEvents`/`harshAccelEvents`** · `lastGPSLat/Lng/Ts` |
| Depolama | `:68` | `localStorage` `car-launcher-trip-log`, **en fazla 100 trip** |
| Yaşam döngüsü sahibi | `useLayoutServices.ts:358` | `startTripLog()` mount · `stopTripLog()` unmount |
| **trip start** | `_startTrip` `:186` | hız > **5 km/h** (GPS veya OBD) → 5 s'lik canlı saat başlar |
| **trip stop** | `_endTrip` `:214` | duruş **60 s** sonra; **< 1 dk veya < 100 m ise KAYDEDİLMEZ** |
| **trip resume** | — | **YOK.** Yalnız idle timer iptali var; ayrı `PAUSED`/`RESUMED` durumu yok |
| **trip merge** | — | **YOK.** Kod içinde birleştirme mantığı bulunamadı |
| **trip distance** | `_onGPS` `:262` | **GPS haversine birincil**: accuracy ≤ 50 m, delta 5 m–300 m arası kabul. GPS 5 s bayatsa **OBD Euler** (`hız × dt`, < 1 km/tick koruması) |
| **trip duration** | `_endTrip` | `performance.now()` deltası — **saat atlamalarına bağışık** |
| **trip fuel** | `_endTrip` | ⚠️ `distanceKm/100 × 8,5` — **TAHMİN**; `fuelAtStart` kullanılmıyor |
| **trip cost** | `_endTrip` | ⚠️ `fuelL × 45` — **sabit birim fiyat** |
| **trip score** | `_calcScore` `:146` | 100 − min(harsh×8, 40) − hız cezaları (>120/130/150/180) − ortalama hız cezası |
| **harsh brake / accel** | `_onGPS` `:319` | \|Δhız\| > 15 km/h; yön ayrımı yapılıyor ama **YALNIZ RAM'de** — `TripRecord`'a YAZILMIYOR |
| Diğer tüketiciler | `TripLogView` · `TripSummaryBanner` · `companionEngine` · `maintenanceBrain` · `SystemOrchestrator` · `useAssistantContextStore` | `onTripState`/`getTripSnapshot` ile okur |

### §1'de sorulan ama **BULUNMAYAN** dört şey (dürüst kayıt)

- **`TripLogService` diye bir sınıf yok** — modül-seviyesi fonksiyonlar ve
  kapanış durumu (`_state`, `_active`) var.
- **trip resume ve trip merge YOK.**
- **idle time · moving time · stop count · max rpm · max engine temp ·
  speed violations · confidence** metriklerinin **hiçbiri üretilmiyor.**
- **`harshBrakeEvents`/`harshAccelEvents` kalıcı değil** — Driver DNA için
  toplanan yön ayrımı trip kapanışında **kaybediliyor**.

---

## 3. TRIP YAŞAM DÖNGÜSÜ (§3)

`src/platform/trip/tripLifecycle.ts` — tek otorite, saf geçiş tablosu.

```
RUNNING ──MOVE_STOPPED──▶ PAUSED ──MOVE_STARTED──▶ RESUMED ──MOVE_STARTED──▶ RUNNING
   │                        │                         │
   └────────IDLE_EXPIRED────┴─────────────────────────┘
                            ▼
                        COMPLETED ──UPLOAD_ACCEPTED──▶ UPLOADED ──ARCHIVE──▶ ARCHIVED
```

- **Geçersiz geçiş YOK SAYILIR** ve gerekçesi döner (`rejected`) — sessiz
  uygulama yok. `UPLOADED` bir trip yeniden `RUNNING` OLAMAZ (kilit #20).
- `RESUMED` bilinçli olarak ayrı bir durumdur: "kaç kez durup devam etti"
  (stop count) ancak böyle sayılabilir hâle gelir.
- Yalnız `COMPLETED` yüklenebilir (kilit #21).

> **Not:** Bu geçiş tablosu **kanonik otoritedir** ama `tripLogService`'in iç
> akışına henüz BAĞLANMADI — o modül değiştirilmediği için hâlâ yalnız
> "aktif / değil" ikiliğinde çalışıyor. `PAUSED`/`RESUMED` ayrımı ve stop
> count'un gerçek üretimi açık borçtur (§13 B2).

---

## 4. CANONICAL MODEL (§2)

`src/platform/trip/tripCanonicalModel.ts` — saf.

| Tip | İçerik |
|-----|--------|
| `Metric` | `{ value: number \| null, source: MetricSource }` — **çıplak sayı YOK**, çünkü çıplak sayı kaynağını kaybeder |
| `TripMetrics` | §4'te istenen **14 metrik**, hepsi `Metric` |
| `TripEvent` | `kind · atOffsetMs · magnitude` — **mutlak zaman ve koordinat YOK** |
| `TripSummary` | `tripId · tripKey · state · startedAtMs · endedAtMs · metrics · score · confidence · events · revision` |
| `TripStatistics` | trip sayısı · toplamlar (kaynak etiketli) · ortalama skor · bekleyen/başarısız yükleme |

**Hiçbir modül kendi trip modelini oluşturmuyor:** kilit #13 `tripLogService`'in
kanonik modeli import ETMEDİĞİNİ (tek yönlü bağımlılık) doğruluyor; dönüşüm
tek yerde (`toCanonicalTripSummary`).

**Güven türetimi:** `HIGH` yalnız mesafe **ÖLÇÜLDÜYSE** (GPS haversine) ve
≥10 hız örneği varsa. OBD Euler mesafesi `MEDIUM`'u aşamaz — hız×zaman
toplamı viraj/rampa hatası biriktirir. Yakıt tahmini güveni **düşürmez**
(ayrı alan, kendi etiketi var — kilit #27).

---

## 5. UPLOAD (§5)

`tripUploadCoordinator.ts` (saf karar) + `tripUploadRuntime.ts` (ince kablolama).

| Kural | Uygulama |
|-------|----------|
| Anlık yükleme YOK | Canlı bildirimler (5 s'de bir `_notify`) elenir; yalnız `history` **büyüdüğünde** yükleme (kilit #17) |
| Tek upload | Kapanan trip için tek kanonik özet; `IN_FLIGHT` ikinci gönderimi engeller (kilit #30) |
| Mevcut kuyruk | `callVehicleRpc` → `pushVehicleEvent` ile **AYNI** taşıma; retry/backoff o kuyruğun DEĞİŞMEMİŞ davranışı |
| Retry | Geçici hatada revizyon **artar** (§6), bütçe **5 deneme** — sonsuz retry YOK (kilit #34) |
| Dedupe | `tripKey` + defter; 20 kez bildirilse **1** yükleme (kilit #36) |
| `DUPLICATE` = BAŞARI | Sunucuda veri zaten var; hata saymak sonsuz döngü üretir (kilit #32) |
| `REJECTED` = sunucu hükmü | Retry YOK (kilit #35) |
| Açılış çapası | İlk gözlemde eski geçmiş **yüklenmez** (kilit #19) |
| Bilinmeyen alan | Yüke **KONMAZ** (`null` gönderilmez) → sunucudaki `COALESCE` eskiyi ezmez (kilit #20) |

---

## 6. REVISION (§6)

**Deterministik `tripKey`:** `t{başlangıç_sn}-{bitiş_sn}-{mesafe×100}`.
Rastgele `tripId` dedupe için **kullanılamaz** — yeniden başlatmada yeni UUID
üretilir ve aynı yolculuk iki kez yüklenir (kilit #16).

| Senaryo | Sonuç |
|---------|-------|
| Aynı anahtar + aynı revizyon | `DUPLICATE` · **yazma YOK** (PG `P4`) |
| Aynı anahtar + daha düşük revizyon | `DUPLICATE` (PG `P4b`) |
| Aynı anahtar + daha yüksek revizyon | `UPDATED` · düzeltme; bilinmeyen alan **eskiyi ezmez** (PG `P5`, `P5b`) |
| 10 kez replay | **tek satır**, değer bozulmaz (PG `P12`) |
| Yeniden başlatma | Defter `localStorage`'dan geri gelir → yeniden yükleme YOK (kilit #38) |

İki savunma katmanı: istemci defteri (gereksiz ağ çağrısını önler) **+**
sunucu UNIQUE kısıtı (istemci atlatılsa bile iki kez saymaz).

---

## 7. OFFLINE QUEUE

Yeni kuyruk **kurulmadı**. Yükleme mevcut `connectivityService` at-least-once
kuyruğundan geçer (`pushVehicleEvent` ile aynı yol): IndexedDB kalıcılığı,
öncelik sıralaması, `2^n` backoff, monotonik `enqueuedAt`. Bu paket o
kuyruğun **hiçbir davranışını değiştirmedi**.

Çevrimdışı davranış: cihaz çevrimdışıysa RPC `null` döner → koordinatör
`RETRY_WAIT`'e geçer → bağlantı dönünce revizyon artırılarak yeniden
gönderilir → sunucu ilk yazımı yaptıysa `DUPLICATE` der ve **tekrar
sayılmaz**.

---

## 8. FLEET UI (§8)

`website/src/lib/fleet/vehicleTripsView.ts` (saf) + `VehicleModal.tsx`
"Yolculuklar" bölümü.

Gösterilenler: **Başlangıç · Bitiş · Mesafe · Süre · Yakıt · Maliyet ·
Ortalama hız · Maksimum hız · Skor · Güvenilirlik · yükleme durumu.**

| Kural | Uygulama |
|-------|----------|
| **Tahmin ETİKETLİ** | `ESTIMATED` → **"(tahmini)"** eki zorunlu; renk de soluk (kilit #1, #2) |
| Bilinmeyen | **"Veri yok"** — sahte `0` YOK (kilit #6) |
| Değer yoksa kaynak da yok | `UNAVAILABLE` (kilit #7) |
| Ölçülen `0` | "Veri yok" **DEĞİL** (kilit #8) |
| Okunamadı ≠ trip yok | `readable=false` → **"Okunamadı"**; `isEmpty` → "Kayıt yok" (kilit #15, #16) |
| PostgREST `numeric` | **METİN döner** → sayıya çevrilir (kilit #13) |
| Koordinat/rota | Görünümde **YOK** (kilit #19, #20) |
| Teknik sızıntı | Kullanıcı metinlerinde `rpc`/`sql`/`null` **YOK** (kilit #22) |

---

## 9. LAB (§7)

**Yeni araç:** `trip-engine` (kategori `vehicle`, `AVAILABLE`).

Gösterilenler (§7'de istenenlerin tamamı): **Trip State** · **Distance**
(canlı) · **Duration** (canlı) · **Upload Queue** (kuyrukta/yüklendi/tekrar/
retry/başarısız) · **Retry** · **Revision** defteri (istemci vs sunucu
revizyonu, deneme sayısı) · **Last Upload** · **Last Failure** + yerel
istatistik (kaynak etiketleriyle).

**Aktif komut YOK** (kilit #4): `startTripLog` · `stopTripLog` ·
`deleteTrip` · `clearAllTrips` · `startTripUpload` · `callVehicleRpc` ·
`upload_vehicle_trip` · `fetch` · timer · `.decide(` · `markQueued` yok.
**Rota/koordinat gösterilmez** (kilit #7); mutlak zaman damgası yok, yalnız
yaş (kilit #8); okuma düşerse ekran çökmez (kilit #10).

---

## 10. MIGRATION 046

`supabase/migrations/20260730000046_fleet_trip_engine_p1.sql` — yalnız ileri;
033–045 değiştirilmedi.

- **`public.vehicle_trips`**: 14 metrik kolonu **hepsi NULLABLE** (bilinmeyen
  `0` DEĞİL) + **kaynak etiketi kolonları** (`distance_source`,
  `fuel_source`, `cost_source`) + `revision` + `events` (koordinatsız)
- **`(vehicle_id, trip_key)` UNIQUE** — dedupe otoritesi
- CHECK kısıtları: revizyon ≥ 1 · skor 0–100 · enum daraltmaları · negatif
  metrik yasağı · `ended_at >= started_at`
- **`upload_vehicle_trip(...)`**: `api_key` kimlik doğrulaması · istemci
  saati **otorite değil** (gelecek damga kırpılır) · tanınmayan enum
  `UNKNOWN`/`UNAVAILABLE`'a düşer · **mesafesiz trip REDDEDİLİR** ·
  `DUPLICATE`/`UPDATED` hükümleri
- **`list_vehicle_trips(...)`**: kapsam `owner_id` veya `profiles.company_id`;
  oturumsuz **satır yok** (fail-closed)
- RLS açık · `anon` tabloyu **okuyamaz** ve okuma RPC'sini **çağıramaz**;
  yazma RPC'si `anon`'a açık (cihaz yolu — kasıtlı)
- **Fail-closed DO bloğu**: tablo · UNIQUE kısıt · **koordinat kolonu
  OLMADIĞI** · metrik kolonlarının NULLABLE olduğu · kaynak etiketi
  kolonları · RLS · anon kilidi · DEFINER+`search_path` · dedupe hükmü

**İdempotency:** ikinci uygulamada da `046 OK` + `COMMIT`.

---

## 11. GERÇEK POSTGRESQL (§9) — **25 doğrulama** (mock DEĞİL)

Yerel Supabase `supabase_db_fleetval`, gerçek `auth.uid()` oturumlarıyla.

```
P1   TRIP INSERT (CREATED, rev=1)                                    PASS
P2   alanlar gercekten yazildi + kaynak etiketleri dogru             PASS
P3   BILINMEYEN metrik NULL kaliyor (maxRpm/idle/stop/violations)    PASS
P4   DUPLICATE: ayni anahtar+revizyon -> yazma YOK, deger korundu    PASS
P4b  daha DUSUK revizyon da DUPLICATE                                PASS
P5   REVISION: daha yuksek revizyon UPDATED (duzeltme)               PASS
P5b  duzeltmede bilinmeyen alan ESKIYI EZMIYOR                       PASS
P6   MESAFESIZ trip REDDEDILIYOR (NO_DISTANCE, satir yok)            PASS
P7   ISTEMCI SAATI otorite degil (started<=now, received dolu)       PASS
P8   TANINMAYAN enum uydurulmuyor (UNKNOWN/UNAVAILABLE)              PASS
P9   gecersiz api_key REDDEDILIYOR                                   PASS
P10  skor 0-100 CHECK kisiti calisiyor                               PASS
P11  KOORDINAT kolonu YOK (rota gecmisi kapsam disi)                 PASS
P12  OFFLINE REPLAY: 10 tekrar -> TEK satir, deger bozulmadi         PASS
P13  OWNER trip'i goruyor                                            PASS
P14  CROSS-TENANT reddi (yabanci 0 satir)                            PASS
P15  OTURUMSUZ 0 satir (fail-closed)                                 PASS
P16a DEVIR sonrasi trip kaydi SILINMIYOR                             PASS
P16b devirden sonra ESKI sahip GORMUYOR                              PASS
P16c yeni sahip GORUYOR                                              PASS
P16d devir sonrasi cihaz yuklemeye DEVAM ediyor                      PASS
P17  OBSERVER (sirket uyesi) sirket aracinin trip'ini goruyor        PASS
P18a ANON DENY: tablo SELECT=f, okuma RPC=f                          PASS
P18b anon YAZMA acik (cihaz yolu — kasitli)                          PASS
P18c anon EFEKTIF olarak 0 satir goruyor                             PASS
```

§9'da istenen senaryoların **tamamı** kapsandı.

---

## 12. TESTLER (§10)

### Yerel kilitler — **87 yeni kilit**

| Dosya | Adet | Kapsam |
|-------|------|--------|
| `src/__tests__/tripEngine.test.ts` | **44** | tahmin/ölçüm ayrımı · kanonik model · dedupe anahtarı · yaşam döngüsü (start/pause/resume/stop) · güven · upload/retry/duplicate/restart · istatistik |
| `src/__tests__/carosLabTripEngine.test.ts` | **21** | LAB salt-okunurluk · rota gizliliği · "tripLogService'e dokunmama" · §5 canlı ölçüm gönderilmiyor |
| `website/src/__tests__/vehicleTripsView.test.ts` | **22** | UI dürüstlüğü · "(tahmini)" etiketi · okunamadı≠yok · PostgREST numeric metin · koordinat yok |

### Regresyon

| Kapı | Sonuç |
|------|-------|
| Kök `vitest` | **9 086 / 9 086 PASS** (434 dosya) |
| `website` `vitest` | **770 / 770 PASS** (38 dosya) |
| **`npm run build` (`tsc -b` + vite)** | **GEÇTİ** (2m 2s) |
| `website` `tsc --noEmit` | **TEMİZ** |
| `eslint` (yeni dosyalar) | **0 hata** |
| Migration 046 idempotency | ikinci uygulamada da `046 OK` + `COMMIT` |

Realtime · Offline Queue · Vehicle Identity · Location Engine testleri
**dokunulmadan** geçti (9 086 içinde).

> **Not:** Kök tip denetimi için `npm run build` / `tsc -b` kullanıldı —
> kökte `tsc --noEmit` **kanıt değildir** (bkz. kütük #213).

### İki test kusurumu ayırdım (ürün kusuru olarak raporlamadım)

- `vehicleTripsView` #8: `0` tam sayı olduğu için `"0 L"` basılıyor,
  benim beklentim `"0.0 L"`ydi. Biçimlendirme **doğru**; kilidin asıl
  amacı ("ölçülen 0, Veri yok DEĞİLDİR") korunarak beklenti düzeltildi.
- `carosLabTripEngine` #7: `/route\b/i` regex'i lucide **`Route` ikonunu**
  yakaladı — konum alanı değil. Kilit gerçek konum/rota verisi erişimini
  hedefleyecek şekilde daraltıldı.

---

## 13. AÇIK BORÇLAR

| # | Borç | Neden bu turda yapılmadı |
|---|------|--------------------------|
| **B1** | **Gerçek araç doğrulaması** — kütük #214–#218 🔴 | Araçta gerçek yolculuk tamamlanmadı → `BLOCKED_REAL_VEHICLE` |
| **B2** | `PAUSED`/`RESUMED` gerçek üretimi + **stop count** | Geçiş tablosu hazır ama `tripLogService`'e bağlanması o modülü değiştirmeyi gerektirir ("mevcut davranışı bozma") |
| **B3** | **Gerçek yakıt ölçümü** (`fuelAtStart` − `fuelAtEnd`) → `MEASURED` | `tripLogService._endTrip` değişikliği gerektirir; ayrıca yakıt seviyesi yüzdesi → litre için depo hacmi gerekir |
| **B4** | **Kullanıcının gerçek yakıt fiyatı** → maliyet `DERIVED` olur | Ayar yüzeyi + göç gerektirir |
| **B5** | `max_rpm` · `max_engine_temp_c` · `speed_violations` · idle/moving time | `tripLogService` bu ölçümleri hiç üretmiyor; eklemek o modülü değiştirmek demek |
| **B6** | `harshBrake`/`harshAccel` **kalıcı değil** — Driver DNA verisi trip kapanışında kayboluyor | `TripRecord` biçimini değiştirmek geçmiş kayıtları etkiler; ayrı göç turu |
| **B7** | **Geçmiş trip göçü** — açılış çapası nedeniyle eski 100 trip yüklenmiyor | Toptan göç ayrı ve dikkatli bir tur (dedupe yükü + kuyruk taşkını riski) |
| **B8** | Migration 040–046 **hiçbir ortama uygulanmadı** | `db push` yasak |
| **B9** | Fleet Trips **sekme değil, bölüm** olarak eklendi (modal içinde) | Sekme altyapısı modalda yok; eklemek UI mimarisi değişikliği |

---

## 14. NİHAİ KARAR

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| Gerçek araç doğrulaması | **`BLOCKED_REAL_VEHICLE`** |
| Production doğrulaması | **YAPILMADI** — 040–046 hiçbir ortamda yok |
| Bozulan mevcut sistem | **YOK** — `tripLogService` · Realtime · Offline Queue · Vehicle Identity · Location Engine · Music Hub · AccountCleanup dokunulmadı |

### Dürüstlük beyanı

Bu rapordaki her PASS **yerel** kanıttır: 9 086 kök + 770 website testi,
gerçek `npm run build`, ve **25 gerçek-PostgreSQL** doğrulaması (owner ·
observer · cross-tenant · anon deny · devir · offline replay dahil).

**Gerçek araçta hiçbir yolculuk tamamlanmadı** → `BLOCKED_REAL_VEHICLE`.
Kütükte 🔴 bekleyen beş madde "çalışıyor" olarak sunulmuyor.

En önemlisi: **yakıt ve maliyet bu üründe ÖLÇÜLMÜYOR, TAHMİN EDİLİYOR.**
Bu paket o gerçeği düzeltmedi — ama artık **gizlemiyor**: veri tabanında
kaynak etiketi, arayüzde "(tahmini)" ibaresi var. Fleet Intelligence ve Cost
Analysis bu ayrımı okumak zorundadır; aksi halde 8,5 L/100km varsayımı
gerçek tüketim sanılır.
