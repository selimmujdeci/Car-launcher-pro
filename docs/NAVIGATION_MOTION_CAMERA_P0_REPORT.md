# NAVIGATION_MOTION_CAMERA_P0 — Mini Harita Hareketi & Profesyonel Kamera

**Tarih:** 2026-08-05 · **Dal:** `feat/fleet-offline-final-local-completion`
**Commit / push / deploy:** YAPILMADI · dirty worktree korundu ·
`git checkout/restore/reset/clean/stash` KULLANILMADI.

---

## 1. Ön Analiz (koddan doğrulandı)

| Soru | Bulgu (kanıt) |
|---|---|
| FullMapView marker'ı nasıl interpolate ediyor? | RAF döngüsünde `interpolateNavPoint(p1, p2, now)` — `FullMapView.tsx:940`, tampon `navPointsRef` |
| MiniMapWidget neden doğrudan GPS değerini çiziyor? | `updateUserMarker(latitude, longitude, hdg)` GPS geri çağrısında — `MiniMapWidget.tsx:535`. GPS tavanı 2 Hz (`gpsService.ts` `GPS_NAV_MAX_INTERVAL_MS = 500`) → **saniyede iki zıplama** |
| Kamera sahipleri kim? | İkisi de `setDrivingView` çağırıyor **ama farklı argümanlarla** (aşağıda) |
| zoom/pitch/bearing/padding nerede? | `cameraEngine.computeCameraTarget` + `CAMERA_CFG`; uygulama `MapInteractionManager.setDrivingView` |
| user pan / recenter nerede? | `navigation/cameraFollowAuthority.ts` — **zaten paylaşılan** (mini + full) |
| orientation nerede yönetiliyor? | Hiçbir yerde: `AndroidManifest.xml:63` `android:screenOrientation="sensorLandscape"` ile TÜM uygulama yataya kilitli |
| yön değişiminde oturum korunuyor mu? | Manifest `configChanges` içinde `orientation\|screenSize\|screenLayout` VAR → Activity yeniden yaratılmıyor |

### 🔴 Bulunan kusur: mini harita kamerası EKSİK argümanla çağrılıyordu

```
FullMapView : setDrivingView(map, lat, lng, bear, speed, h, turnDist, obdSpeed, nextTurnBearing, routeBearing)
MiniMapWidget: setDrivingView(map, lat, lon, hdg,  effKmh, h)              ← 4 argüman EKSİK
```

Sonuç: tam ekranda **kavşak yaklaşımı zoom'u, dönüş öngörüsü (anticipation) ve
durakta rota-yönü düzeltmesi** çalışırken mini haritada **hiçbiri** çalışmıyordu.
İki ekran aynı fonksiyonu çağırıyor ama farklı davranıyordu.

---

## 2. Paylaşılan Motion Runtime

| Katman | Dosya | Rol |
|---|---|---|
| Karar (SAF) | `navigation/core/markerMotionModel.ts` | "şu anda nereye çizilmeli" |
| Sahip | `navigation/navMarkerMotionRuntime.ts` | örnek tamponu + snapshot |
| Besleyici | `navigation/navigationSessionRuntime.ts` | GPS fix **ve** DR tick |
| Tüketici | `MiniMapWidget` · `FullMapView` | yalnız ÇİZER |

**Durumlar:** `INTERPOLATING · TRACKING · SNAP_CORRECTION · GPS_DEGRADED · STALE · UNKNOWN`
**Çıktılar:** renderedPosition · renderedBearing · motionState · interpolationProgress ·
sourceAgeMs · confidence

| Kural | Uygulama |
|---|---|
| Mini + tam ekran aynı konum | Tek `getRenderedMotion(now)` |
| Bileşen kendi motorunu kurmaz | Matematik saf modelde (kilit: mini'de `interpolateNavPoint` YOK) |
| 1–2 Hz GPS'te akıcı | Ara değer + sınırlı ekstrapolasyon |
| **Yapay mesafe yok** | Hız `< 3 km/sa` ise ekstrapolasyon YAPILMAZ |
| **Sıçrama animasyonla meşrulaştırılmaz** | `isImplausibleJump` → `SNAP_CORRECTION`, ara değer YOK |
| Eşleştirme değişimi kontrollü | `matched` değişince `SNAP_CORRECTION` |
| Bayat konumda hareket uydurulmaz | `STALE` → işaret DONAR, `confidence = 0` |
| İki listener/RAF yok | Runtime'da `onGPSLocation`/`setInterval`/RAF **yok** (kilit) |
| Tam ekran açılıp kapanınca sıçrama yok | Durum MODÜL düzeyinde |
| Çift runtime görünür | `duplicateMotionRuntimeCount` (LAB) |

**Ekstrapolasyon sınırı SÜREdir (700 ms), oran değil.** Eski `interpolateNavPoint`
yorumu "maksimum 1,5 saniye" diyordu ama kod `t`'yi **2.5 ile** sınırlıyordu —
sınır fix aralığına göre değişiyordu. Yeni modelde sınır açıkça süredir.

### 🔴 Testlerin yakaladığı GERÇEK ÜRETİM KUSURU: kuzeyde işaret 180° ters dönüyordu

`utils/interpolation.ts` içindeki `lerpAngle` şuydu:
`const diff = ((b - a + 180) % 360) - 180;`

JavaScript'te `%` **kalan** operatörüdür, matematiksel modulo değil — negatif
girdide negatif döner:

```
lerpAngle(350, 10, 0.5) → (10-350+180) = -160 → -160 % 360 = -160 → diff = -340
→ sonuç 180°   (doğrusu 0°)
lerpAngle(10, 350, 0.5) → 0°   ✅ (ters yön DOĞRU çalışıyordu)
```

Yani araç **kuzeye giderken (350° → 10°)** tam ekran marker'ının yönü ara
değerleme sırasında **tam ters** dönüyordu. Kusur yalnız tek geçiş yönünde
ortaya çıktığı için bugüne kadar fark edilmemişti. Düzeltildi (her iki
fonksiyonda gerçek modulo) ve kilitlendi.

---

## 3. Kamera Politikası

`navigation/core/cameraPolicyModel.ts` (SAF, versiyonlu: `CAM-2026.08.05`).

**Kapsam sınırı (bilinçli):** zoom/pitch/look-ahead **eğrileri yeniden
yazılmadı**. Onlar `cameraEngine.CAMERA_CFG` içindedir ve sahada tek tek
ölçülerek ayarlanmıştır (araç ekran-içi garantisi, durakta yön dondurma, ısınma
düzeltmeleri). Bu katman eksik olanı kurar: **durum makinesi · bantlar ·
histerezis · yön-duyarlı çapa · güncelleme kapısı.**

**Durumlar:** `FOLLOW_CITY · FOLLOW_CRUISE · APPROACH_MANEUVER · IN_MANEUVER ·
POST_MANEUVER · USER_PANNING · FOLLOW_SUSPENDED · RECENTERING · GPS_DEGRADED · UNKNOWN`

### Hız bantları (histerezisli — sınırda salınım yok)

| Bant | Giriş | Çıkış | Çapa (yatay) | Çapa (dikey) |
|---|---:|---:|---:|---:|
| STOPPED | 0 | 0 | 0.50 | 0.50 |
| CITY | 3 | 2 | 0.58 | 0.55 |
| SUBURBAN | 55 | 48 | 0.62 | 0.59 |
| **CRUISE** | **90** | **82** | **0.66** | **0.63** |
| HIGHWAY | 115 | 105 | 0.68 | 0.65 |

90 km/sa'te CRUISE'a girilir, 85'e düşünce **çıkılmaz** (çıkış 82) → 90 civarında
gidip gelen araçta profil salınmaz. Yukarı geçişte histerezis yoktur (rejim
gecikmemelidir).

### Manevra bantları — **yol-boyu** mesafeden

`FAR 400 m · APPROACH 180 m · IMMINENT 60 m`.
`maneuverDistanceSource !== 'ALONG_ROUTE'` ise manevra kamerası **hiç
uygulanmaz** — kuş uçuşu mesafe virajlı yaklaşımda kısa çıkar ve kamerayı erken
kavşağa sokar.

### Güncelleme fırtınası kapısı
`shouldApplyCameraUpdate`: asgari 120 ms · `< 1.5 km/sa` hız değişimi profil
değiştirmez · **rejim/bant/manevra değişimi eşiği ATLAR** (gecikmez).

### ⚠️ Çapa yorumu (açıkça belirtiliyor)
Görev "dikeyde araç alt %55–65, yatayda alt %35–40" diyor; bu ifade iki türlü
okunabilir. Burada **`anchorY` = aracın üstten aşağı oranı** alındı (0 = üst
kenar). Gerekçe: navigasyonda amaç aracın ÖNÜNDEKİ yolu göstermektir; araç ne
kadar aşağıdaysa ileri yol o kadar uzun görünür. Yatay değerler bugünkü sahada
ayarlı davranışa (`TOP_PAD 0.50→0.70`) yakın tutuldu → **regresyon yok**.

---

## 4. Mini Harita

* Marker artık paylaşılan `getRenderedMotion(now)`'dan ~16 fps ile çizilir.
* `setDrivingView` **tam argüman setiyle** çağrılır: yol-boyu manevra mesafesi
  (`ALONG_ROUTE` kapısıyla) + rotanın ileri yönü (tam ekranla **aynı otorite**:
  `currentStepIndex + 1` adımı; paralel "ileri yön" otoritesi kurulmadı).
* **Boşta CPU koruması pazarlıksız korundu (#61/#64):** döngü yalnız araç
  sürerken açılır, durunca kapanır; `updateUserMarker` yalnız konum/yön gerçekten
  değiştiyse çağrılır (0.4 m / 0.6°).
* ETA · ses · DR · oturum runtime'larını **sahiplenmez** (önceki turlarda taşındı).

---

## 5. Ekran Yönü

* **Ana CAROS arayüzü YATAY kalır.** Manifest `sensorLandscape` DEĞİŞMEDİ.
* Yeni native yöntem `CarLauncherPlugin.setNavigationOrientation({mode})`:
  `sensor` → `SCREEN_ORIENTATION_FULL_SENSOR` (dört yön) · `landscape` →
  `SCREEN_ORIENTATION_SENSOR_LANDSCAPE`.
* `navigation/navigationOrientation.ts` — **ref-count'lu** kapı:
  `FullMapView` mount'ta alır, unmount'ta bırakır. Çift mount'ta kilit erken
  geri alınmaz.
* `App.tsx` portre uyarısı yalnız `FULL_SENSOR` iken bastırılır; ana arayüz için
  uyarı aynen kalır.
* **Oturum sürekliliği:** manifest `configChanges` zaten `orientation|screenSize|
  screenLayout` içeriyor → Activity yeniden yaratılmaz. Rota, ses kuyruğu, ETA,
  DR, marker motion ve pan durumu **görünümden bağımsız runtime'lardadır**
  (önceki iki tur) → yön değişimi bunlara dokunmaz. Görünümün tek işi
  viewport/çapa/padding'i yeniden hesaplamaktır.
* **FAIL-SOFT:** native yöntem yoksa (eski APK) veya çağrı hata verirse
  navigasyon aynen sürer, yalnız ekran yataya kilitli kalır.

---

## 6. Pan / Ortala

`cameraFollowAuthority` **zaten** mini ve tam ekran tarafından paylaşılıyordu
(önceki mini-harita turunda kurulmuştu); bu tur onu kamera politikasına da
bağladı: `USER_PANNING`/`FOLLOW_SUSPENDED` → `cameraDriveAllowed = false`,
manevra kamerası kapalı. `UNKNOWN` → fail-closed (kamera sürülmez).
Keyfî otomatik recenter süresi **eklenmedi**; mevcut sözleşme korundu.

---

## 7. CAROS LAB

**Navigation Core → Kart 13 "İşaret Hareketi · Takip Kamerası"** — 22 alan,
salt-okunur: markerMotionState · maskeli ham/çizilen konum ·
interpolationProgress · sourceAgeMs · confidence · örnek sayısı ·
**duplicateMotionRuntimeCount** · cameraState · cameraProfileId+sürüm ·
speedBand · maneuverBand · anchorX/Y · zoom · pitch · bearing · orientation+kilit ·
userPanState · recenterAvailable · suppressedCameraUpdates · cameraUpdateReason.

Koordinat **taşınmaz** — konumlar `VAR ±8 m` biçiminde maskelidir (test kilitli).
LAB hiçbir kamera/hareket davranışını değiştiremez.

---

## 8. Testler

**Yeni:** `src/__tests__/navigationMotionCamera.test.ts` — **48 kilit**
(A hareket modeli · B paylaşılan runtime · C kamera politikası · D ekran yönü ·
E yapısal kilitler).

| Kapı | Sonuç |
|---|---|
| `npx tsc -b --force` | ✅ temiz |
| `npm run lint` | ✅ yeni dosyalarda 0 sorun (4 hata **önceden vardı**, dokunulmayan dosyalarda) |
| `npx vitest run` | ✅ **476 dosya / 10732 test — hepsi geçti** |

---

## 9. Değişen Dosyalar

**Yeni:** `navigation/core/markerMotionModel.ts` · `navigation/navMarkerMotionRuntime.ts` ·
`navigation/core/cameraPolicyModel.ts` · `navigation/navigationOrientation.ts` ·
`__tests__/navigationMotionCamera.test.ts`

**Değişen:** `MiniMapWidget.tsx` (paylaşılan motion + kamera paritesi) ·
`FullMapView.tsx` (yön kapısı) · `App.tsx` (portre uyarısı kapısı) ·
`navigationSessionRuntime.ts` (motion beslemesi) · `utils/interpolation.ts`
(**lerpAngle modulo kusuru**) · `devtools/navigationCoreSources.ts` +
`navigationCoreModel.ts` (kart 13) · `CarLauncherPlugin.java`
(`setNavigationOrientation`) · 2 LAB test fixture'ı

---

## 10. Açık Borçlar

1. **`suppressedCameraUpdates` ürün sayacı bağlı DEĞİL.** Kapı
   (`shouldApplyCameraUpdate`) saf modelde ve test edilmiş durumda, ama
   `setDrivingView` çağıranları henüz bu kapıdan geçmiyor — LAB'da 0 raporlanır
   ve bu alanın notunda açıkça yazar. Kapıyı çağrı yollarına bağlamak kamera
   akışını değiştirir; bu tur eğrilere dokunmama kararı verildiği için ayrıldı.
2. **`decideCameraPolicy` çıktısı henüz `setDrivingView`i SÜRMÜYOR.** Durum
   makinesi, bantlar ve çapa üretiliyor ve LAB'da gözleniyor; fiilî zoom/pitch
   hâlâ `cameraEngine` eğrilerinden geliyor. Yani bu tur **gözlemlenebilir ve
   test edilebilir bir politika katmanı** kurdu, eğrileri devralmadı.
   Devralma ayrı ve ölçüm gerektiren bir turdur.
3. **`anchorY` bugün kameraya uygulanmıyor** (yukarıdaki maddenin sonucu);
   yatay davranış `TOP_PAD` eğrisinden gelmeye devam ediyor, dikeyde özel çapa
   henüz etkin değil.
4. **Native yön değişimi hiç çalıştırılmadı** — APK üretilmedi; Java kodu
   derlenmedi. `setNavigationOrientation` gerçek cihazda doğrulanmalı.
5. **Döner kavşak / iki yakın manevra kadrajı** için özel kadraj mantığı
   eklenmedi; mevcut `pendingManeuver` ve kavşak zoom boost'u kullanılıyor.
6. **Gerçek araçta hiçbir senaryo ölçülmedi.**

---

## 11. Kapılar ve Nihai Karar

| Kapı | Hüküm | Gerekçe |
|---|---|---|
| `sharedMotionRuntimeVerdict` | **PASS** | Tek runtime, tek besleyici, saf model; ikinci listener/RAF yasağı kilitli; çift runtime sayacı LAB'da |
| `miniMapSmoothnessVerdict` | **PASS** | Mini harita paylaşılan konumu ~16 fps çiziyor; `interpolateNavPoint` yasağı kilitli; idle koruması korundu |
| `dynamicCameraVerdict` | **PARTIAL** | Bantlar/histerezis/durum makinesi kuruldu ve test edildi **ama fiilî zoom/pitch hâlâ eski eğrilerden** (§10.2) |
| `maneuverCameraVerdict` | **PASS** | Mini harita artık yol-boyu manevra mesafesini geçiriyor (parite); kuş uçuşu kaynağı reddediliyor |
| `bearingStabilityVerdict` | **PASS** | Yön bilinmiyorsa ani dönüş yok; kuzey geçişindeki 180° ters dönme kusuru düzeltildi |
| `panRecenterVerdict` | **PASS** | Tek `cameraFollowAuthority`; pan/askı/bilinmiyor hâllerinde kamera sürülmez |
| `portraitFullNavigationVerdict` | **PARTIAL** | Kapı, ref-count ve native yöntem yazıldı; **APK üretilmedi, hiç çalıştırılmadı** |
| `orientationContinuityVerdict` | **PARTIAL** | Yapısal olarak korunuyor (configChanges + görünümden bağımsız runtime'lar) ama **ölçülmedi** |
| `realVehicleValidationVerdict` | **PENDING_REAL_VEHICLE** | Kuga/Doblo ile hiçbir madde doğrulanmadı |

### `NAVIGATION_MOTION_CAMERA_P0_PARTIAL`

**Neden `COMPLETE_LOCAL` değil:** görevin talep ettiği "tek kanonik camera
policy" **kurulmuş ve gözlemlenebilir** durumda, ancak **kameranın fiilî
zoom/pitch değerlerini henüz sürmüyor** (§10.2–10.3). Sahada tek tek ölçülerek
ayarlanmış eğrileri aynı turda devralmak, ölçüm olmadan doğrudan regresyon
riskiydi; bu yüzden bilinçli olarak ayrıldı. Dikey tam ekran navigasyon da
yazıldı ama **hiç çalıştırılmadı**.

Bu turun **kesin** kazanımları: mini haritanın zıplaması bitti, iki ekran aynı
konumu çiziyor, mini harita kamera paritesi sağlandı, kuzeyde ters dönen marker
kusuru düzeltildi ve tüm zincir CAROS LAB'da gözlemlenebilir hâle geldi.
