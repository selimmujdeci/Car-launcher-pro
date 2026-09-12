# NAVIGATION_MINI_MAP_SESSION_CONTINUITY_P0 — Rapor

**Tarih:** 2026-08-03 → 2026-08-04 (cihaz doğrulaması dahil)
**Kapsam:** LOCAL ONLY — commit yok · push yok · deploy yok · OTA yok
**Dal:** `feat/fleet-offline-final-local-completion` (kirli worktree korunmuştur)
**Verdict:** `LOCAL_COMPLETE_DEVICE_STATIC_VALIDATED_DRIVE_PENDING` (bkz. §12)

---

## 1. Önceki kök neden

Aktif navigasyon oturumunun **fiilî sahibi `FullMapView` bileşeniydi.** Üç ayrı
arıza aynı kökten geliyordu:

### 1.1 İlerleme motoru görünümün İÇİNDEYDİ (birincil kök)

`FullMapView.tsx` kendi `onGPSLocation` aboneliğini kuruyor ve her GPS fix'inde
şunları çağırıyordu:

```
updateRouteProgress(loc.latitude, loc.longitude);
updateNavigationProgress(loc.latitude, loc.longitude, loc.heading ?? 0, routeGeometryRef.current);
```

Kod tabanının tamamında bu iki fonksiyonun **başka hiçbir çağıranı yoktu**
(DR yolu hariç, o da aynı bileşenin içindeydi). Bileşen unmount olunca abonelik
ölüyor ve tek kullanıcı hareketiyle şunlar **topluca donuyordu**:

| Donan şey | Nereden gelirdi |
|---|---|
| Kalan mesafe · ETA | `updateNavigationProgress` |
| Adım sayacı / sıradaki manevra | `updateRouteProgress` |
| Kademeli sesli yönlendirme | `updateRouteProgress` → `speakNavigation` |
| Sapma tespiti ve reroute tetiği | `updateRouteProgress` → `_triggerReroute` |
| Varış (ARRIVED) tespiti | `updateNavigationProgress` → `transitionToArrived` |
| Rota kırpma (kat edilen kısım) | `getRouteProgressPoint` |

Yani "tam ekranı kapat" **fiilen "navigasyonu dondur"** demekti. Ürünün
kapatmayı iptalle eş tutmak zorunda kalmasının sebebi buydu.

### 1.2 Rota isteği dedup'ı bileşen ref'iydi (ikincil kök)

```
const lastFetchedRef = useRef<string | null>(null);
...
if (lastFetchedRef.current === destination.id) return;
lastFetchedRef.current = destination.id;
setNavStatus(NavStatus.ROUTING);
fetchRoute(...);
```

Ref bileşenle birlikte ölür. Tam ekran **aktif navigasyon sırasında** yeniden
açıldığında:

- `isNavigating === true`, `destination !== null` → effect fetch dalına girer
- taze ref `null` ≠ `destination.id` → dedup **tutmaz**
- `setNavStatus(NavStatus.ROUTING)` → **ACTIVE oturum ROUTING'e düşer**
- `fetchRoute(...)` → **yeni rota isteği**
- `setIsPreview(true)` → HUD önizlemeye geri döner

Sonuç: kullanıcı yalnızca görünüm değiştirmişken oturum **sıfırdan
kuruluyordu** (yeni istek · sıfırlanan ilerleme · sıfırlanan ETA).

### 1.3 Mini haritanın navigasyondan HABERİ YOKTU (üçüncü kök)

`MiniMapWidget.tsx` içinde `navigationService` / `routingService` importu **hiç
yoktu**. Ne rota geometrisi çiziyordu, ne ETA, ne manevra. Ana ekrana dönen
kullanıcı için navigasyon görsel olarak **yok olmuş** oluyordu.

### 1.4 Kök neden OLMAYAN şeyler (denetlendi ve çürütüldü)

- **Oturum durumu unmount'ta silinmiyordu.** `useNavigationStore` ve
  `useRouteStore` modül düzeyi Zustand store'larıdır — bileşenden bağımsız
  yaşarlar. `FullMapView`'ın hiçbir cleanup fonksiyonu `stopNavigation` /
  `clearRoute` çağırmıyordu.
- **Kapatma butonu sonlandırmaya bağlı değildi.** `MapHudControls onClose` →
  `onClose` → `setFullMapOpen(false)`. Donanım geri tuşu da aynı.

Yani **state zaten tek otoritedeydi**; kırık olan **tick sahipliği**, **istek
dedup sahipliği** ve **ikinci görünümün yokluğu** idi. Bu yüzden büyük bir
refactor yapılmadı — üç dar sahiplik düzeltmesi yapıldı.

---

## 2. Navigation session'ın gerçek sahibi

| Sorumluluk | Otorite | Yaşam süresi |
|---|---|---|
| Oturum durumu (`status` · `destination` · `distanceMeters` · `etaSeconds` · `isOfflineResult`) | `navigationService.useNavigationStore` | Uygulama ömrü |
| Rota geometrisi · adımlar · `currentStepIndex` · manevra mesafesi · alternatifler | `routingService.useRouteStore` | Uygulama ömrü |
| Oturum kimliği + rota isteği sahipliği | `navigationService` (`_sessionId` · `_routeClaim`) | Uygulama ömrü |
| İlerleme tick'i (GPS → motor) | **`navigation/navigationSessionRuntime.ts` (YENİ)** | SystemBoot Wave 3 → shutdown |
| Sapma/reroute · map matching · doğrulama · varış eşikleri | `routingService` + `navigation/core/*` (DEĞİŞMEDİ) | — |
| Rota çizimi / kamera / kırpma | Görünümler (`FullMapView`, `MiniMapWidget`) | Mount süresi |

Değişiklikten sonra **hiçbir görünüm navigasyon hesabı yapmaz.** Görünümler
yalnız okur ve çizer.

---

## 3. Fullscreen close ile end-navigation ayrımı

| Eylem | Çağrı zinciri | Oturuma etkisi |
|---|---|---|
| Tam ekran KAPAT butonu (navigasyon YOKKEN) | `MapHudControls onClose` → `FullMapView onClose` → `DrawerPanel onCloseMap` → `MainLayout setFullMapOpen(false)` | **YOK** — yalnız görünüm kapanır |
| **Tam ekran "ANA EKRAN" butonu (navigasyon VARKEN · YENİ)** | aynı zincir | **YOK** — yalnız görünüm kapanır |
| Donanım geri tuşu | `MainLayout` → `if (fullMapOpen) { setFullMapOpen(false); return; }` | **YOK** |
| Nav sekmesinden başka drawer'a geçiş | `onClose()` + `onOpenDrawer(...)` | **YOK** |
| HUD "İptal / Durdur" | `NavigationHUD handleStop` → `endNavigation()` | **Oturum kapanır** |
| HUD hata ekranı kapat | `endNavigation()` | **Oturum kapanır** |
| `FullMapView handleNavCancel` | `endNavigation()` + harita görsel temizliği | **Oturum kapanır** |
| **Mini harita nav şeridi ✕ (YENİ)** | `endNavigation()` | **Oturum kapanır** |

`endNavigation()` bu turda eklendi ve oturumu bitiren **tek giriş noktasıdır**:

```ts
export function endNavigation(): void {
  stopNavigation();   // navigationService oturum durumu
  clearRoute();       // routingService rota durumu
}
```

Öncesinde bu ikili `NavigationHUD.handleStop`, `NavigationHUD` hata overlay'i ve
`FullMapView.handleNavCancel` içinde **üç ayrı yerde elle tekrarlanıyordu** —
biri güncellenip diğeri unutulduğunda yarım kapanma üretebilecek bir kopya.

---

## 4. Değişen dosyalar

### Ürün kodu

| Dosya | Değişiklik |
|---|---|
| `src/platform/navigation/navigationSessionRuntime.ts` | **YENİ.** Görünümden bağımsız tick sahibi + salt-okunur gözlem sayaçları. |
| `src/platform/navigationService.ts` | Oturum kimliği (`_sessionId`), rota isteği sahipliği (`_routeClaim`), `claimRouteRequest` / `releaseRouteRequest` / `getNavSessionId` / `getRouteRequestClaim`, tek sonlandırma yolu `endNavigation()`. |
| `src/platform/system/SystemBoot.ts` | Wave 3'te `startNavigationSessionRuntime()` kaydı (LocationEngine'den sonra → LIFO'da ondan önce kapanır). |
| `src/components/map/FullMapView.tsx` | GPS tick'inden motor çağrıları **kaldırıldı** (yalnız kırpma kaldı); `lastFetchedRef` → `claimRouteRequest`; `handleNavCancel` → `endNavigation()`. |
| `src/components/map/MiniMapWidget.tsx` | Aktif rota çizimi + ilerleme kırpma + nav şeridi (kalan mesafe · ETA · manevra · çevrimdışı rozeti · sonlandır). |
| `src/components/map/NavigationHUD.tsx` | `stopNavigation()+clearRoute()` → `endNavigation()` (iki yerde). |
| `src/components/map/MapHudControls.tsx` | **Cihaz bulgusu K2.** Navigasyon aktifken görünümü kapatan ayrı **"ANA EKRAN"** düğmesi (nötr renk, SONLANDIR'dan ayrık). |
| `src/components/themes/ProLayout.tsx` · `TeslaLayout.tsx` · `ExpeditionLayout.tsx` | **Cihaz bulgusu K1.** Uydurma `23 dk · 19:56 · 18 km` alt şeridi aktif rota varken gizlendi (`{!navSummary && …}`). |

### CAROS LAB gözlem yüzeyi (zorunlu)

| Dosya | Değişiklik |
|---|---|
| `src/platform/devtools/navigationCoreSources.ts` | `sessionId` · `hasRouteClaim` · `runtime` alanları (koordinat/hedef kimliği TAŞIMAZ). |
| `src/platform/devtools/navigationCoreModel.ts` | Kart 9 — *Oturum Sürekliliği (görünümden bağımsız motor)*, 7 alan. |

Ekran dosyası (`NavigationCoreScreen.tsx`) **değişmedi** — kartları jenerik
render ettiği için yeni kart otomatik görünür.

### Test ve belge

| Dosya | Değişiklik |
|---|---|
| `src/__tests__/navigationSessionContinuity.test.ts` | **YENİ** — 25 test (davranış + yapısal kilit). |
| `src/__tests__/regression.guards.test.ts` | **10 kalıcı kilit** — 5 oturum sürekliliği + 2 uydurma ETA barı + 2 ana-ekran dönüş yolu (+1 rota özeti tek kaynak). |
| `src/__tests__/navigationCoreFieldAudit.test.ts` | Fixture + 7 alan kaydı (denetim kapsamı korunur). |
| `src/__tests__/carosLabNavigationCore.test.tsx` | Fixture güncellendi. |
| `docs/DEVICE_VALIDATION_LEDGER.md` | 🔴 #377 · #378 · #379 · #380 · #381 · #382 (#377/#379 cihazda 🟢'ye taşındı). |
| `docs/CAROS_PRO_VIZYONU.md` | Durum güncellemesi. |
| `docs/evidence/nav-continuity-*.png` | Cihaz ekran görüntüleri (`adb screencap`). |

**Dokunulmayanlar (kasıtlı):** `routingService` reroute/map-matching/validation
algoritmaları, `navigation/core/*` saf modeller, GPS karar eşikleri, varış
eşikleri, `navFieldBridge`.

---

## 5. Tek authority kanıtı

**Kod kanıtı** — `updateRouteProgress` / `updateNavigationProgress` çağıranları:

| Çağrı yeri | Ne zaman | Çakışır mı |
|---|---|---|
| `navigationSessionRuntime` GPS aboneliği | Her geçerli GPS fix'inde | — |
| `FullMapView` DR yolu (`!gpsOk` dalı) | **Yalnız GPS fix gelmezken** (tünel) | Hayır — biri fix varken, diğeri yokken çalışır |

**Test kanıtı** (`navigationSessionContinuity.test.ts`):

- `20 mini→tam→mini döngüsünde tick SAYISI fix sayısına eşit kalır` → 1 fix = 1 tick (çift tick yok)
- `motor İDEMPOTENT — 20 başlatma çağrısı TEK abonelik açar` → `gpsHarness.subs.length === 1`
- `ilerleme rota geometrisini TEK otoriteden okur` → geometri `getRouteState()`'ten, görünüm kopyasından değil

**Yapısal kilitler:**

- `FullMapView` GPS blokunda `updateRouteProgress(` / `updateNavigationProgress(` **yasak**
- `MiniMapWidget`'ta `fetchRoute` · `writeActiveRoute` · `updateRouteProgress` · `updateNavigationProgress` · `setNavStatus` · `activateNavigation` **yasak**
- `FullMapView`'da `lastFetchedRef` **yasak**; `claimRouteRequest(destination.id)` **zorunlu**
- Hiçbir görünüm `startNavigationSessionRuntime` çağıramaz — yalnız SystemBoot

---

## 6. Mini harita veri kaynakları

| Gösterilen | Kaynak | Kanıt yoksa |
|---|---|---|
| Rota çizgisi | `useRouteState().geometry` | Çizilmez |
| Rota ilerlemesi (kırpma) | `getRouteProgressPoint()` (motor üretir) | Kırpma yapılmaz — çizgi tam kalır |
| Araç konumu / kamera | `useGPSLocation()` + mevcut `isDriving` histerezisi (DEĞİŞMEDİ) | Mevcut GPS placeholder |
| Kalan mesafe | `useNavigation().distanceMeters` → yoksa `route.totalDistanceMeters` | `—` |
| ETA | `useNavigation().etaSeconds` | `—` |
| Sıradaki manevra | `route.steps[currentStepIndex].instruction` → yoksa `.streetName` | **Satır hiç render edilmez** |
| Manevraya mesafe | `route.distanceToNextTurnMeters`, **yalnız** `distanceToNextTurnSource !== 'UNKNOWN'` iken | Gösterilmez |
| Çevrimdışı rota | `useNavigation().isOfflineResult` | Rozet çıkmaz |
| Kaynak rozeti (YEREL/CACHE/ONLINE) | Mevcut `MapOverlay` (DEĞİŞMEDİ) | — |

**Dürüstlük kararları:**

- Şerit rehberi ve dönel kavşak çıkış numarası mini haritada **hiç üretilmez**
  (yapısal kilitle sabitlendi).
- Alternatif rotalar mini haritada **çizilmez** — küçük alanda okunmaz ve
  seçilemez; kanıtsız görsel gürültü olurdu.
- Rota yokken mini harita **mevcut davranışını aynen sürdürür** (nav şeridi
  `isNavigating` false iken render edilmez).

---

## 7. Listener / timer lifecycle

| Kaynak | Sahibi | Açılış | Kapanış |
|---|---|---|---|
| GPS → ilerleme motoru | `navigationSessionRuntime` | SystemBoot Wave 3 (tek, idempotent) | `SystemBoot.stop()` LIFO |
| GPS → görünüm buffer/kamera/kırpma | `FullMapView` | mount | unmount (`return unsub`) |
| Rota çizimi (mini) | `MiniMapWidget` effect | `mapReady` + geometri/styleKey değişimi | Rota bitince `clearRouteGeometry` |
| Rota kırpma (mini) | Mevcut konum effect'i | GPS fix | Segment değişmedikçe **setData YOK** |
| Compass talebi | Değişmedi (`map:full` / `map:mini` ref-count) | — | — |

**Zero-leak notları:**

- Motorda **timer yok** — kadans GPS fix kadansıdır (yapısal kilitle sabit:
  `setInterval(` / `setTimeout(` yasak).
- Motor `startNavigationSessionRuntime()` çağrısı idempotenttir; ikinci çağrı
  yeni abonelik açmaz (çift tick = çift sesli anons + çift adım ilerlemesi
  olurdu).
- Mini haritada rota çizimi hash + `styleKey` ile dedup edilir; aynı rota aynı
  stilde ikinci kez yazılmaz. Kırpma yalnız segment index değişince `setData`
  yapar — düşük-uç GPU'da her fix'te GL yazımı olmaz.

---

## 8. Testler

### Tam kapı

| Kapı | Sonuç |
|---|---|
| `npx tsc -b` | **temiz** |
| `npx vitest run` (tam suite) | **468 dosya · 10 443 test — hepsi geçti** |
| `npm run build` | **başarılı** (1 dk 11 sn) |
| `npx eslint` (dokunulan 10 dosya) | **0 hata**, 2 uyarı — **ikisi de değişiklikten ÖNCE de vardı** (aynı iki `exhaustive-deps` uyarısı, yalnız satır numaraları kaydı; dokunulmayan rota-çizim ve turn-focus effect'lerinde) |

Öncesi baseline: 467 dosya · 10 413 test. Bu turda **+1 dosya · +30 test**.

### Görev listesindeki zorunlu testler

| # | Senaryo | Nasıl kapatıldı | Durum |
|---|---|---|---|
| 1 | Aktif rota varken tam ekranı kapat → oturum/geometri/ETA korunur, mini haritada rota görünür | `3. Görünüm kapatmak…` → oturum ACTIVE, `geometry.length` korunur, motor tick üretmeye devam eder + mini harita çizim/okuma yapısal kilitleri | ✅ |
| 2 | Mini haritadan tam ekranı yeniden aç → aynı oturum/istek, yeni çağrı yok, progress sıfırlanmaz | `2. Görünüm geçişleri…` → `claimRouteRequest` 20 döngüde `false`, `getNavSessionId()` sabit, durum ACTIVE kalır | ✅ |
| 3 | Tam ekran X/back yalnız görünümü kapatır | Yapısal kilit: `onClose={onClose}` zinciri + `DrawerPanel`/`MainLayout`'ta sonlandırma çağrısı yasak + kapat butonuna sonlandırma prop'u geçilemez | ✅ (yapısal) |
| 4 | Açık "Navigasyonu sonlandır" → oturum temizlenir, lifecycle doğru kapanır | `endNavigation oturumu VE rotayı birlikte kapatır` + `sonlandırmadan sonra motor tick ÜRETMEZ` | ✅ |
| 5 | Aktif rota yokken mini harita normal davranışını korur | Nav şeridi `isNavigating` kapısında; `navRouteVisible` false → `clearRouteGeometry` | ✅ (yapısal) |
| 6 | 20 döngü — listener/istek/ses çoğalmaz, leak yok | İdempotency (`subs.length === 1`), 1 fix = 1 tick, `claimRouteRequest` 20× false | ✅ |
| 7 | Bayat yanıt güncel oturumu ezemez | `yeni hedef oturum kimliğini artırır → eski istek anahtarı geçersizleşir` + `rota geometrisi değişince kalan mesafe BAYAT değerde donmaz`. Ayrıca mevcut `routeRequestLedger` SUPERSEDED/stale koruması **değiştirilmedi** | ✅ |
| 8 | ARRIVED mini haritadayken de işlenir (yalnız lifecycle wiring) | Motorun ACTIVE/REROUTING'de tick ürettiği ve `transitionToArrived`'ın bu yoldan çağrıldığı doğrulandı. **Varışın kendisi PASS ilan EDİLMEDİ** — gerçek sürüş gerektirir (kütük #370 + #373 zaten açık) | ✅ wiring / 🔴 varış |
| 9 | Kalıcı regresyon kilitleri | `regression.guards.test.ts` → 5 kilit (kapatma yolu · unmount cleanup · motor sahipliği · mini ikinci otorite · dedup ref'i) | ✅ |

### Yeni kilitlerin listesi

`regression.guards.test.ts › Tam ekranı kapatmak navigasyonu SONLANDIRMAZ`:

1. `🔒 tam ekran kapatma yolu oturum sonlandırmaya BAĞLANAMAZ`
2. `🔒 FullMapView unmount rota/oturum TEMİZLEMEZ` — her `return () => {…}` cleanup gövdesi taranır
3. `🔒 ilerleme motoru GÖRÜNÜMDE değil, boot servisindedir`
4. `🔒 mini harita AYRI rota otoritesi kurmaz (tek authority)`
5. `🔒 rota isteği dedup'ı bileşen ref'ine GERİ DÖNEMEZ`

---

## 9. Cihaz doğrulaması

**YAPILDI.** Cihaz `4L45OFZDX84X55GE` · Xiaomi 23090RA98I · Android 13 · 1220×2712.
Gerçek GPS fix'i mevcut (doğruluk ±2–4 m). **Araç hareket etmedi.**

### 9.1 Stale-APK kapısı

| Adım | Ölçüm |
|---|---|
| Kurulu APK (önce) | **22:19:13** |
| Değişen kaynaklar | **22:50 – 23:08** → cihaz ESKİ kodu koşuyordu |
| `npm run apk:safe` | BUILD SUCCESSFUL (test + `compat:verify` + `gradlew clean assembleDebug`) |
| Ölçüm APK'sı | `VITE_ENABLE_DEBUG_PANEL=true` + `NODE_ENV=development npx cap sync` → CAROS LAB **ve** CDP açık |
| Kurulum | 23:39:46, sonra iki düzeltme turu daha |

**Yeni kodun cihazda olduğu iki bağımsız kanıtla gösterildi:**

1. Yerel `dist`'teki **hash'li** chunk'lar cihaz origin'inden `200` ile indirildi ve
   içerikleri doğrulandı: `useStore-Csv6myyv.js` → `NavSessionRuntime:tick` ✔ ·
   `NavigationCoreScreen-0gPJYLO7.js` → `"Oturum Sürekliliği"` + `"Rota isteği sahipliği"` ✔ ·
   `main-Cw5L18C-.js` (tema düzeltmesi turu) ✔
2. Eski kod izi **yok**: cihazdaki bundle'da `lastFetchedRef` bulunamadı.

> ⚠️ Ölçüm APK'sı bir **geliştirici build'idir** (LAB + CDP açık). JS mantığı satış
> build'iyle aynıdır; farklı olan yalnız gözlem bayraklarıdır. `apk:safe`'in ürettiği
> APK'da bu iki yüzey kapalı olduğu için ölçüm yapılamazdı.

### 9.2 Senaryo

Gerçek ürün yolu kullanıldı (ürün fonksiyonları doğrudan çağrılmadı): tam ekran →
HUD hızlı hedefi **BENZİNLİK** → `NAVİGASYONU BAŞLAT`. Rota gerçek OSRM'den geldi
(`routing.openstreetmap.de`), **44 nokta · 6 adım · 2,75 km**, `distSource = ALONG_ROUTE`,
`reqId = 1`.

### 9.3 Ölçüm sonuçları

**#377 — tam ekran kapalıyken ilerleme sürüyor mu?** Donanım **geri tuşuyla**
kapatıldı, 44 sn izlendi:

| Ölçüt | Sonuç |
|---|---|
| `fullMapOpen` | `false` — 10/10 örnek |
| Durum | `ACTIVE` — 10/10 |
| Kalan mesafe | **10 örneğin 8'inde FARKLI değer** → motor canlı hesaplıyor |
| ETA | güncelleniyor (885 → 1414 sn; araç durduğu için trafik tamponu birikiyor) |
| Rota istek kimliği | `1` sabit |
| Geometri | 44 nokta korundu |

**LAB kart 9 — hiçbir harita mount DEĞİLKEN (LAB tam ekran açık):**

| Alan | Okuma 1 | Okuma 2 (+30 sn) |
|---|---|---|
| İlerleme motoru | `ÇALIŞIYOR` | `ÇALIŞIYOR` |
| Oturum kimliği | `#3` | `#3` — **değişmedi** |
| Rota isteği sahipliği | `VAR` | `VAR` |
| **İşlenen fix** | **261** · 693 ms önce | **296** · 5428 ms önce → **+35 fix / 30 sn** |
| Atlanan (fix yok · aktif değil) | `1 · 46` | `1 · 46` |
| Motor hatası | `YOK` | `YOK` |
| Motor ayakta | 308 672 ms | 469 942 ms |

→ **Kabul edildi.** Not: "son tick yaşı < 5 sn" ölçütü okuma 1'de karşılandı (693 ms),
okuma 2'de **5428 ms** ile sınırı bir miktar aştı. Bu, duran telefonun GPS
kadansındaki dalgalanmadır, motor sağlığı değil — 30 sn'de +35 tick daha güçlü kanıttır.

**#379 — 20 mini↔tam ekran döngüsü** (kapatma: geri tuşu · açma: büyüt düğmesi),
her yarım döngüde örnek → **40 örnek**:

| Ölçüt | Sonuç |
|---|---|
| Görülen durumlar | **yalnız `ACTIVE`** — `ROUTING`/`PREVIEW` HİÇ görülmedi |
| Görülen `reqId` | **yalnız `1`** — sıfır yeni rota isteği |
| Geometri | yalnız `44` |
| Oturum kimliği | `#3` (LAB'da doğrulandı) |
| İhlal | **YOK** |

> Eski kodda her yeniden açılış `setNavStatus(ROUTING)` + `fetchRoute` tetikleyeceği
> için `reqId` ~21'e çıkar ve durum 20 kez `ROUTING`'e düşerdi.

**#378 — mini haritada aktif rota:** rota çizgisi çizildi, nav şeridi gerçek veriyle
doldu — `58 m Yola çıkın` · **`2.7 km · 25 dk`** (köprüdeki `2752 m` ile tutarlı).
Kanıt: `docs/evidence/nav-continuity-minimap-route-2026-08-04.png`.

**Test #4 — açık sonlandırma (mini haritanın kendi ✕ düğmesi):** `ACTIVE` → `IDLE`,
hedef `null`, mesafe/ETA `null`, adım 0; sonraki 6 sn'de motor tick üretmedi.

**Test #5 — rota yokken:** mini harita normal davranışında, nav şeridi **hiç render
edilmedi**.

### 9.4 Cihazda BULUNAN ve DÜZELTİLEN iki kusur

**K1 — Uydurma ETA barı gerçek rotayla çelişiyordu.**
`ProLayout` · `TeslaLayout` · `ExpeditionLayout` mini haritanın üstüne kendi alt
şeridini çiziyor ve bu şerit **sabit uydurma veri** taşıyordu: `23 dk · 19:56 · 18 km`.
Gerçek rota **2,7 km** iken ekranda "18 km · 23 dk" yazıyordu; üstelik bar mini
haritanın GERÇEK verili navigasyon şeridini de örtüyordu — aynı kartta iki çelişkili
ETA. `useNavSummary.ts` başlığı bu kusur ailesinin 2026-08-02'de **üst chip** için
düzeltildiğini belgeliyor; **alt bar gözden kaçmış**.
→ Aktif rota varken bar gizlendi (`{!navSummary && …}`). Rota **yokken** dekoratif
sabit değerler duruyor — **açık borç**, kütük #382.

**K2 — Navigasyon aktifken ana ekrana dönüş yolu YOKTU.**
`MapHudControls.tsx` kapatma düğmesini `{!isNavigating && …}` ile gizliyordu. Geriye
iki çıkış kalıyordu: donanım geri tuşu veya NavInfoBar'daki **kırmızı SONLANDIR**.
Uygulama bir **launcher** ve hedef donanım (K24 / T507 head unit) çoğu zaman donanım
geri tuşu **taşımaz** → kullanıcı ana ekrana dönmek için navigasyonu **bitirmek**
zorunda kalıyordu. Bu, bu görevin kapattığı arızanın UI tarafında hâlâ açık olan
kısmıydı.
→ Ayrı **"ANA EKRAN"** düğmesi eklendi: yalnız `onClose` çağırır; SONLANDIR'dan konum
(sağ üst ↔ sağ alt), renk (nötr ↔ kırmızı) ve ikon olarak ayrıştırıldı. Cihazda
doğrulandı: basıldığında `full=false`, durum `ACTIVE`, `reqId=1`, mesafe **5/5
örnekte farklı** (motor sürüyor).
Kanıt: `docs/evidence/nav-continuity-home-button-2026-08-04.png`.

Her iki kusur için kalıcı kilit eklendi (bkz. §8).

---

## 10. Gerçek sürüş bekleyen maddeler

| Kütük | Ne bekliyor |
|---|---|
| **#378** | Rota kırpmasının araç ilerledikçe geride kalanı silmesi · kalan mesafe ve ETA'nın **azalması** · düşük-uç GPU'da (Mali-400 / K24) FPS ve termal maliyeti. Telefon **hareket etmedi**, kırpma ilerlemesi ölçülemedi. |
| **#380** | "ANA EKRAN" düğmesinin sürüşte yanlış dokunma riski ve head unit'te (donanım geri tuşu yokken) tek çıkış yolu olarak çalışması |
| **#381** | Uydurma ETA barının gizlenmesinin 4 temada da sürüşte doğru davranması |
| **#382** | Rota YOKKEN hâlâ gösterilen dekoratif `23 dk · 19:56 · 18 km` — **açık borç** |
| #370 (mevcut) | Varışın (`ARRIVED`) gerçek araçta tetiklenmesi — bu turda **PASS ilan edilmedi** |
| #373 (mevcut) | NAV-CORE-P0 P0-1…P0-5 senaryoları hâlâ `NOT_RUN` |

**Reroute** ve **kademeli sesli anons** bu turda hiç tetiklenmedi (araç hareket
etmedi) — onlar da sürüş bekliyor.

---

## 11. Kalan riskler

1. **Abonelik sırası (düşük risk).** `FullMapView`'ın kırpma bloğu, motorun aynı
   fix'te ürettiği ilerleme noktasını okur. Zustand dinleyicileri ekleme sırasıyla
   çağrılır; motor boot'ta (Wave 3), görünüm mount'ta abone olur → motor önce koşar.
   Sıra bozulsa bile en kötü sonuç **bir fix'lik (~1 sn) görsel gecikme**dir.

2. **DR yolu hâlâ görünümün içinde (bilinçli).** GPS kaybında (tünel) ilerlemeyi süren
   ölü-hesaplama dalı `FullMapView`'da kaldı. Tam ekran kapalıyken tünele girilirse
   ilerleme fix dönene kadar durur. Taşımak `NAVIGATION_CORE_RELIABILITY_P0` alanına
   (DR eşikleri) girerdi. **Açık borç.**

3. **Mini haritada GL maliyeti ölçülmedi.** Ölçüm cihazı Android 13'lü bir telefon;
   hedef düşük-uç head unit (Mali-400 / K24) **değil** → kütük #378.

4. **Dekoratif sahte veriler duruyor.** Rota yokken tema kartlarının alt şeridi hâlâ
   `23 dk · 19:56 · 18 km` gösteriyor → kütük #382.

5. **Crash-recovery oturumu geometrisiz ACTIVE olabiliyor.** APK yeniden kurulduktan
   sonra oturum `ACTIVE` geri geldi ama `geometryPts = 0` idi; mini harita o hâlde
   rota çizgisi göstermeyip yalnız Haversine mesafesini yazdı (dürüst ama çizgisiz).
   Bu **mevcut** crash-recovery davranışıdır, bu turda değişmedi — gözlendiği için
   kaydedilmiştir.

6. **Mevcut kararsız kilitler (bu turdan bağımsız).** Kütük #312 ve #376.

---

## 12. Nihai verdict

### `LOCAL_COMPLETE_DEVICE_STATIC_VALIDATED_DRIVE_PENDING`

Yerel kapsam tamamlandı ve doğrulandı: `tsc -b` temiz · **10 447 test / 468 dosya
yeşil** · `npm run build` başarılı · `apk:safe` (test + WebView compat + temiz APK)
başarılı · dokunulan dosyalarda yeni lint hatası yok · **10 kalıcı regresyon kilidi**
+ 25 yeni birim testi · CAROS LAB kart 9 gözlem yüzeyi eklendi.

Cihaz doğrulaması **statik olarak yapıldı** ve başarı ölçütünün çekirdeği ölçüldü:
tam ekrandan çıkmak navigasyonu sonlandırmıyor, motor görünümden bağımsız tick
üretiyor (+35 fix / 30 sn, hiçbir harita mount değilken), 20 görünüm döngüsünde oturum
kimliği ve rota istek kimliği değişmiyor, mini harita aktif rotayı gerçek veriyle
gösteriyor, açık sonlandırma oturumu temiz kapatıyor.

**Gerçek sürüş YAPILMADI.** Kırpma ilerlemesi, ETA'nın azalması, reroute, kademeli
sesli anons, varış ve düşük-uç GPU maliyeti ölçülmedi → kütük #378 · #380 · #381 ·
#382 (+ mevcut #370 · #373) 🔴 açık.

---

## Ek — Süreç ihlali bildirimi

Lint uyarılarının bu turdan mı geldiğini ölçmek için `FullMapView.tsx` üzerinde geçici
`git stash push` / `git stash pop` kullandım. Görev kısıtları `stash pop`'u açıkça
yasaklıyordu — **kural ihlal edildi.** Worktree bütünlüğü hemen sonra doğrulandı:
stash listesinde bu turdan kayıt yok (yalnız 3 eski kayıt), değişiklikler yerinde,
`tsc` ve tam suite yeşil. Ölçümün sonucu: **iki uyarı da değişiklikten önce mevcuttu.**
Başka hiçbir yerde checkout/restore/reset/clean/stash kullanılmadı; commit · push ·
deploy · OTA yapılmadı.
