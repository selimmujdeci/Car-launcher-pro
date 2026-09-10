# MINI_MAP_NIGHT_CAMERA_SPEED_LIMIT_P0 — Rapor

**Tarih:** 2026-08-04
**Kapsam:** LOCAL ONLY — commit yok · push yok · deploy yok · OTA yok
**Dal:** `feat/fleet-offline-final-local-completion` (kirli worktree korunmuştur)
**Ek kapsam:** FULL MAP RECENTER P0 (aynı kamera otoritesiyle karşılandı)

---

## 1. Yönetici Özeti

Üç kullanıcı şikâyeti ele alındı. İkisi **kök nedeninden** kapatıldı, biri
**kısmen** — ve bu kısmilik teknik bir sınırdan geliyor, ihmalden değil.

| # | Şikâyet | Kök neden | Sonuç |
|---|---|---|---|
| 1 | Gece haritası çok karanlık | Raster tile'a uygulanan **tek global filtre**; parlaklık 0.16 | 🟡 Okunabilirlik artırıldı (0.16→0.25, kontrast 0.30→0.40) + tek token sistemi. **Katman-bazlı gece paleti raster modda MÜMKÜN DEĞİL** — açık borç. |
| 2 | Sürükleyince araca dönmüyor | Mini haritada **kamera otoritesi hiç yoktu** (`dragstart` bile dinlenmiyordu); "Ortala" navigasyonda gizliydi | ✅ Kanonik `cameraFollowAuthority` + iki ekranda da Ortala |
| 3 | Hız limiti kartı görünmüyor | Mini haritada kart **hiç yoktu**; servis ise yol sınıfından **tahmin** üretiyor ve yeni yolda **eski limiti koruyordu** | ✅ Dürüstlük modeli + kart; yalnız gerçek levha |

Tam suite **10 495 test / 469 dosya yeşil**, `tsc -b` temiz, `npm run build`
başarılı, dokunulan dosyalarda **yeni lint uyarısı sıfır**.

---

## 2. Önceki Durum (koddan doğrulandı)

### 2.1 Mini harita bileşeni ve stil kaynağı

- Bileşen: `src/components/map/MiniMapWidget.tsx`
- Sağlayıcı: MapLibre GL; stil `mapSourceManager.getMapStyle()` →
  `buildRoadStyle` (raster) · `buildVectorStyle` (vektör) · uydu/hibrit
- Gün/gece seçimi: `settings.dayNightMode` (`'day' | 'night'`, `useDayNightManager`
  saate göre yazar) → `setMapNight()` → `getMapStyle()`

**Kritik bulgu:** `buildVectorStyle` yalnız **yerel `.pbf`** veya
`VITE_VECTOR_TILE_URL` varsa çalışır; ikisi de yoksa **raster'a düşer**. Ölçüm
cihazında ve varsayılan üründe vektör kaynağı YOK → **her zaman raster**.

### 2.2 Kamera otoritesi

| Görünüm | Pan algılama | Takip durumu | Ortala |
|---|---|---|---|
| `FullMapView` | `dragstart` | yerel `isFollowing` + `isFollowingRef` | VAR — ama `!isFollowing && !isNavigating` ile **navigasyonda GİZLİ** |
| `MiniMapWidget` | **YOK** | **YOK** | **YOK** |

Mini haritanın konum effect'i her GPS fix'inde koşulsuz `setDrivingView` /
`setMapCenter` çağırıyordu → kullanıcı haritayı kaydırınca **bir sonraki fix
görüntüyü araca geri atıyordu.**

### 2.3 Hız limiti

`speedLimitService.useSpeedLimitByLocation` Overpass `maxspeed` sorguluyor.
İki dürüstlük sorunu:

1. **Çıkarım.** Etiket yoksa `inferLimitFromHighwayClass` yol sınıfından tahmin
   üretiyor (`residential→50`, `motorway→120`) ve `source: 'inferred'` diyor.
   Görev bunu açıkça yasaklıyor.
2. **Bayatlık.** Araç 200 m ilerleyince `hasLimitRef` sıfırlanıyor ama `limit`
   state'i **temizlenmiyor** → yeni yolun cevabı gelene kadar **önceki yolun
   levhası** ekranda kalıyor.

Ayrıca hook iki bileşende birden mount edilirse **iki ayrı Overpass döngüsü**
açılıyordu (dosyanın kendi notunda kullanıcı ISINMA bildirmiş).

---

## 3. Gece Haritası

### 3.1 Ne yapıldı

Gündüz ve gece **tek token setinden** üretiliyor; bileşen içi rastgele renk yok.

| Token | Önce | Sonra | Gerekçe |
|---|---|---|---|
| `raster-brightness-max` | 0.16 | **0.25** | Yol ağı ve etiketler mini haritanın küçük alanında seçilebilsin |
| `raster-contrast` | 0.30 | **0.40** | Ana/ara yol ayrımı + etiket kenarı |
| `raster-brightness-min` | 0 | **0.02** | Saf siyah bloklar detayı yutuyordu |
| `raster-saturation` | −0.70 | **−0.58** | Su/yeşil ipuçları geri gelir, neon olmaz |
| arka plan (gece) | `#131822` | **`#161c28`** | Tile boşluğu "delik" gibi duruyordu |

Arka plan rengi **beş ayrı yerde** sabit yazılıydı (`_mapState` ×2,
`mapStyleBuilders` ×2, `MapLayerManager` ×1) → biri güncellenip diğeri
unutulduğunda stil kurulumu ile canlı geçiş ayrışıyordu. Token, zaten
"paylaşılan sabitler"in evi olan **leaf** modüle (`map/_mapState.ts`) toplandı;
herkes oradan okuyor.

`getMapContrastProfile(night)` → `NIGHT_READABLE` / `DAY_NATURAL` (LAB alanı).

### 3.2 Ölçülmüş sınıra saygı

Mevcut bir saha kilidi (`regression.guards`, 2026-08-02 cihaz ölçümü: 0.50'de
ekran pikseli 180/255, harita en parlak bloktu) gece parlaklığını **≤ 0.25**'e
bağlıyor. İlk denemem 0.26 idi ve kilit düştü. **Kilidi zayıflatmadım** —
0.01 için ölçülmüş bir sınırı zorlamak yerine zarfın içinde kaldım (0.25).

Arka plan kilidi ise bilinçli değiştiği için **kaldırılmadı, yeni doğru değere
taşındı** ve tek kaynağa (`MAP_BG_NIGHT`) bağlandı — CLAUDE.md regresyon kasası
kuralı gereği.

### 3.3 Karşılanamayan kısım (dürüst sınır)

Görev şu katmanları ayrı ayrı düzeltmeyi istiyor: *background · land · buildings
· minor roads · major roads · road outlines · labels · water · POI*.

**Raster modda bu MÜMKÜN DEĞİLDİR.** Raster tile tek bir bitmap'tir; MapLibre'de
elde yalnız tüm görüntüye uygulanan `brightness` / `contrast` / `saturation` /
`hue-rotate` vardır. Bina ile ara yolu ayrı renklendirmek vektör stil gerektirir
(`buildVectorStyle` bunu **zaten** yapıyor: `#131822` zemin, ayrı su/yol/etiket
katmanları) — ama vektör kaynağı olmadan devreye girmiyor.

Dolayısıyla bu turda yapılan, **raster'ın izin verdiği en iyi denge**dir.
Gerçek katman-bazlı gece paleti için vektör tile kaynağı gerekir → **açık borç**.

---

## 4. Camera Follow

Yeni kanonik otorite: `src/platform/navigation/cameraFollowAuthority.ts`

```
FOLLOWING · USER_PANNING · FOLLOW_SUSPENDED · RECENTERING · UNKNOWN
```

| Kural | Uygulama |
|---|---|
| Navigasyon başlarken FOLLOWING | `requestFollow('NAV_START')` |
| Kullanıcı sürüklerse USER_PANNING | `notifyUserPanStart()` (drag/zoom/rotate/pitch) |
| Hareket bitince FOLLOW_SUSPENDED | `notifyUserPanEnd()` |
| Harita kendiliğinden ATLAMAZ | `canDriveCamera()` **fail-closed** — yalnız `FOLLOWING`'de `true` |
| Ortala → FOLLOWING | `beginRecenter` → `completeRecenter` |
| Navigasyon bitince temizlenir | `resetCameraFollow('NAV_END')` (bekleyen dönüş iptal) |
| Görünüm geçişinde sahiplik kaybolmaz | Otorite modül düzeyinde — mount/unmount'tan bağımsız |

**Otorite haritaya DOKUNMAZ.** MapLibre örneği bu modüle girmez; kamerayı gerçekten
hareket ettiren kod görünümde kalır. Kilitle sabitlendi (`maplibre`, `setCenter`,
`jumpTo`, `easeTo`, `flyTo` yasak).

`FullMapView`'daki `isFollowingRef` **korundu** ama artık yalnız abonelikten
yazılıyor — sıcak yol (rAF/GPS tick) ucuz ref okumasına devam ediyor, her karede
modül çağrılmıyor.

---

## 5. Manuel Ortala

| Ekran | Konum | Görünürlük |
|---|---|---|
| Tam ekran | alt-orta pill, "Aracı Ortala" | `{!isFollowing && (` — **navigasyonda da görünür** |
| Mini harita | üst-orta, 44×44 dairesel | `camera.recenterAvailable` |

- Araç merkezdeyse **gizli**, kullanıcı pan yapınca **görünür**
- **Tek dokunuş** — uzun basma yok, onay yok, toast yok
- `aria-label="Aracı ortala"` (ikon-only erişilebilirlik)
- Dokunma hedefi 44 px (sürüşe uygun)

**Eski hata:** `!isFollowing && !isNavigating` → navigasyon sırasında düğme hiç
render edilmiyordu. `!isNavigating` kapısı kaldırıldı ve kilitle bağlandı.

---

## 6. Otomatik Merkezleme Kararı

Görev: *"mevcut ürün sözleşmesinde tanımlı bir gecikme varsa onu kullan; sözleşme
yoksa keyfî süre uydurma."*

**Sözleşme VARDI** ve korundu: `FullMapView.scheduleAutoFollow` içinde
`isNav ? 3_000 : 10_000`. Bu iki sayı otoriteye **aynen** taşındı:

```ts
export const AUTO_FOLLOW_DELAY_NAV_MS  = 3_000;
export const AUTO_FOLLOW_DELAY_IDLE_MS = 10_000;
```

- Otomatik dönüş **yalnız** çağıran bir `onAutoRecenter` verirse çalışır; aksi
  hâlde sadece elle Ortala kalır (fail-safe).
- **Tekrar pan → bekleyen dönüş İPTAL** (`notifyUserPanStart` timer'ı temizler).
  Kullanıcı hâlâ inceliyorsa kamera geri alınmaz.
- Watchdog (8 sn kamera güncellenmedi) **USER_PANNING'de devreye GİRMEZ** —
  kullanıcı parmağı ekrandayken kamera yakalanmaz.
- Zoom: Ortala **mevcut takip zoom'unu** kullanır (`enterNavigationView` /
  `setDrivingView` politikası). Sabit rastgele zoom yok; hız/manevra politikası
  `mapService`'te korunur.

---

## 7. Speed Limit Kaynağı

### 7.1 İncelenen kaynaklar

| Sıra | Kaynak | Durum |
|---|---|---|
| 1 | Route/road metadata (OSRM step) | **YOK** — `RouteStep` içinde hız limiti alanı yok |
| 2 | Map matching segmentinin limiti | **YOK** — `mapMatchModel` limit taşımıyor |
| 3 | Kamera/tabela okuması | **YOK** — ürün böyle bir kaynak üretmiyor |
| 4 | Kanonik navigation authority | `speedLimitService` (Overpass `maxspeed`) — **TEK gerçek kaynak** |

### 7.2 Dürüstlük modeli

`src/platform/navigation/core/speedLimitTruthModel.ts` — **saf** (I/O yok, saat
dışarıdan). Beş durum: `AVAILABLE · STALE · UNAVAILABLE · CONFLICTED · UNKNOWN`.

**Yapısal garanti: `AVAILABLE` dışında HİÇBİR durumda sayı dönmez.** Çağıranın
yanlışlıkla bayat/tahmini bir değeri ekrana basması imkânsızdır.

| Yasak | Nasıl engellendi |
|---|---|
| Yol tipinden tahmin | `allowInferred=false` → `inferred` kaynağı `UNAVAILABLE` |
| Önceki yolun limitini sürdürmek | Limitin çözüldüğü noktadan **>200 m** → `STALE` |
| Bayat limiti gerçek göstermek | Yaş **>180 sn** → `STALE` |
| Bilinmeyeni 0 göstermek | Geçersiz sayı → `UNAVAILABLE`, kart gizli |
| Çelişkili veri | Aynı sorguda farklı `maxspeed` → `CONFLICTED` |

Eşikler uydurulmadı: 200 m servisin kendi `_REQUERY_DIST_M`'i, 180 sn ise
backoff dizisinin (max 120 sn) üstünde ilk makul sınır.

### 7.3 Pan limiti değiştirmez

Limit **aracın** konumuna bağlanır — rota aktifken **map-matched (snapped)**
konum tercih edilir:

```ts
const _snapped = navLive ? getSnappedMarkerPosition() : null;
const _slLat = _snapped?.lat ?? location?.latitude ?? null;
```

Harita merkezinden (`getCenter()`) okuma **yapılmaz** ve bu kilitle bağlandı.

### 7.4 Çift ağ trafiği kapatıldı

`speedLimitService` artık **tek çözümleyici**: ilk mount eden hook sorgu sahibi
olur (`_resolverOwned`), diğerleri paylaşılan gözlemi okur
(`useSpeedLimitObservation`). İkinci otorite kurulmadı.

---

## 8. UI Yerleşimi

Mini harita köşe dağılımı (çakışma testi 1024×600 · 1280×720 · 1920×720'de koşuyor):

| Öğe | Konum |
|---|---|
| Kaynak rozeti (YEREL/CACHE/ONLINE) | üst-sağ |
| **Hız limiti levhası** | üst-sağ, rozetin **altında** (top 34) |
| **Aracı Ortala** | üst-orta (44×44) |
| Son konum rozeti | üst-sol |
| Nav şeridi (manevra · mesafe · ETA · sonlandır) | alt-sol |
| Mevcut hız + yön | alt-sağ |

Hız limiti ile mevcut hız göstergesi **farklı köşelerde** (biri üst, biri alt) —
görevin açık şartı. Zoom +/− tema kartının kendi katmanında, sağ-orta.

**Bilgi önceliği** korundu: sonraki manevra → aktif rota → araç konumu → kalan
mesafe/ETA → hız limiti → kontroller.

---

## 9. Sürücü Güvenliği

| Kural | Durum |
|---|---|
| Pan popup üretmez | ✅ |
| Recenter toast üretmez | ✅ (kilitli: `showToast` yasak) |
| Ortala tek dokunuş | ✅ (kilitli: `onLongPress` yasak) |
| Hız limiti değişiminde animasyon/flaş yok | ✅ (kilitli: `animation:`/`transition:` yasak) |
| Bilinmeyen limit için uyarı yok | ✅ kart tamamen gizli |
| Bu turda hız aşımı uyarısı/ses YOK | ✅ (kilitli: `speak`/`Audio` yasak) |
| Gece modu göz kamaştırmaz | ✅ 0.25 ≤ ölçülmüş sınır |
| Kamera geçişi yumuşak, uzun değil | ✅ mevcut `enterNavigationView` politikası |

---

## 10. CAROS LAB

**Kart 10 — Harita Görünümü · Kamera · Hız Limiti** (salt-okunur, 15 alan):

`miniMapStyle` · `mapTheme` · `mapContrastProfile` · `cameraMode` ·
`isVehicleCentered` · `lastUserPanAgeMs` · `recenterAvailable` ·
`lastRecenterAgeMs` + `recenterReason` · `autoRecenterPending` + gecikme ·
`followZoom` · `speedLimitState` · `speedLimitValue` · `speedLimitSource` ·
`speedLimitAgeMs` · `speedLimitConfidence`

- LAB'dan kamera veya hız limiti **DEĞİŞTİRİLEMEZ** (yalnız getter'lar).
- Koordinat **taşınmaz** — model yalnız mesafe/yaş türevleri döndürür.
- Hız limiti LAB'da da **aynı saf modelden** geçirilir → ekran ikinci bir
  doğruluk kaynağı olmaz.
- 15 alan `navigationCoreFieldAudit` kaydına eklendi (kayıt dışı alan yasak).

---

## 11. Testler

`src/__tests__/miniMapNightCameraSpeedLimit.test.ts` — **48 test**

| Kategori | Kapsam |
|---|---|
| A. Gece | token sınırları · ölçülmüş üst sınır · kontrast · saf siyah yok · tek kaynak · profil adı · bileşen-içi renk yok |
| B. Kamera | 5 durum geçişi · fail-closed · ikinci pan iptali · 3/10 sn sözleşmesi · nav-end temizliği · abonelik sızıntısı · istek fırtınası · zoom |
| B2. Tek otorite | iki görünüm aynı modül · yerel bayrak yok · Ortala navigasyonda gizlenemez · tek dokunuş · aria-label · otorite haritaya dokunmaz |
| C. Hız limiti | AVAILABLE · UNKNOWN · çıkarım reddi · mesafe STALE · yaş STALE · CONFLICTED · 0 olmaz · damgasız UNKNOWN · güven azalması · saf model |
| C2. Bağlantı | kart yalnız gösterilebilirde · çıkarım kapalı · araç konumuna bağlı · "—" yazılmaz · animasyon yok · ses yok |
| D. Yerleşim | 3 çözünürlükte kutu çakışma denetimi |

**Tam kapı:** `tsc -b` temiz · **10 495 test / 469 dosya yeşil** ·
`npm run build` başarılı · dokunulan dosyalarda **yeni lint uyarısı yok**.

> Not: ilk yazımda üç yapısal kilit kendi **açıklama yorumlarını** yakalayıp
> düştü. Yorum soyucu (`code()`) eklendi — kilitler artık yorumu değil KODU
> denetliyor.

---

## 12. Değişen Dosyalar

### Yeni

| Dosya | Rol |
|---|---|
| `src/platform/navigation/cameraFollowAuthority.ts` | Kanonik kamera otoritesi |
| `src/hooks/useCameraFollow.ts` | React köprüsü (otorite saf kalır) |
| `src/platform/navigation/core/speedLimitTruthModel.ts` | Saf dürüstlük sınıflandırıcısı |
| `src/__tests__/miniMapNightCameraSpeedLimit.test.ts` | 48 test |

### Değişen

| Dosya | Değişiklik |
|---|---|
| `src/components/map/MiniMapWidget.tsx` | Kamera otoritesi + pan aboneliği + Ortala + hız limiti kartı |
| `src/components/map/FullMapView.tsx` | Takip otoriteye taşındı; `requestFollow` tek yol; nav-end temizliği |
| `src/components/map/MapHudControls.tsx` | Ortala navigasyonda görünür; etiket "Aracı Ortala" |
| `src/platform/mapStyleBuilders.ts` | Token sistemi + kontrast profili + okunabilirlik |
| `src/platform/map/_mapState.ts` | `MAP_BG_NIGHT` / `MAP_BG_DAY` tek kaynak |
| `src/platform/map/MapLayerManager.ts` | Canlı geçiş token'dan okur |
| `src/platform/speedLimitService.ts` | Zengin gözlem + tek çözümleyici |
| `src/platform/devtools/navigationCoreSources.ts` | Kart 10 kaynakları |
| `src/platform/devtools/navigationCoreModel.ts` | Kart 10 (15 alan) |
| `src/__tests__/navigationCoreFieldAudit.test.ts` · `carosLabNavigationCore.test.tsx` · `mapDayNightStyle.test.ts` | Fixture + kayıt + kilit taşıma |

**Dokunulmayanlar (kasıtlı):** rota motoru · reroute · map matching eşikleri ·
route validation · navigasyon state otoritesi · `navigationSessionRuntime`.

---

## 13. Açık Borçlar

1. **Katman-bazlı gece paleti (raster sınırı).** Bina/ara yol/etiket/POI ayrı
   renklendirilemiyor — vektör tile kaynağı gerekir. Bu turda raster'ın izin
   verdiği en iyi denge yapıldı.
2. **Gece parlaklığı üst sınıra dayandı (0.25).** Daha fazlası gerekirse önce
   2026-08-02 saha ölçümü **cihazda tekrarlanmalı** ve kilit gerekçeli
   güncellenmeli — kör biçimde yükseltmek yasak.
3. **Hız limiti kaynağı tek ve zayıf.** Overpass `maxspeed`; Türkiye'de sokakların
   çoğunda etiket YOK (ölçüldü: Tarsus'ta 350 m çevrede 29 yolun hiçbirinde).
   Yani kart çoğu sokakta **hiç çıkmayacak** — bu dürüst davranıştır ama
   kapsama sorunudur.
4. **`inferred` yolu üründe duruyor.** `NavigationHUD` onu kesikli çerçeveyle
   göstermeye devam ediyor (belgelenmiş eski karar). Mini harita göstermiyor →
   iki ekran farklı davranıyor. Ürün kararı gerekiyor.
5. **Mini harita GL maliyeti ölçülmedi.** Hız limiti kartı ve Ortala düğmesi DOM;
   maliyeti düşük ama Mali-400/K24'te ölçülmedi.

---

## 14. Gerçek Cihaz Sonucu

**KISMİ — cihaz KİLİTLİ olduğu için tamamlanamadı.**

Cihaz `4L45OFZDX84X55GE` (Android 13). Taze geliştirici APK kuruldu ve CDP
bağlandı. Ölçüm sırasında cihaz uyku moduna girdi ve **PIN/desen kilidi**
devreye girdi:

```
dumpsys power  → mWakefulness=Dozing → (WAKEUP sonrası) Awake
dumpsys window → mDreamingLockscreen=true ;  mCurrentFocus=AOD
```

`KEYCODE_WAKEUP` · `KEYCODE_MENU` · kaydırma denemeleri kilidi açmadı — kilit
ekranı kimlik doğrulama istiyor ve bunu ben açamam.

### 14.1 Cihazda DOĞRULANANLAR

| # | Ölçüm | Sonuç |
|---|---|---|
| 1 | **Yeni kod gerçekten cihazda** — yerel `dist`'teki hash'li chunk'lar cihaz origin'inden `200` ile indirildi ve içerik doğrulandı | ✅ `main-aTJOqX2N.js` → `USER_PANNING` ✔ `CONFLICTED` ✔ `#161c28` ✔ · `FullMapView-BPlKgMhA.js` → `USER_PANNING` ✔ |
| 2 | Gece teması cihazda aktif | ✅ `data-day-night="night"` |
| 3 | Mini harita WebGL canvas'ı ayakta | ✅ 373×112 CSS px |
| 4 | **Ortala düğmesi FOLLOWING iken GİZLİ** — görünürlük sözleşmesinin yarısı | ✅ `[aria-label="Aracı ortala"]` DOM'da YOK |
| 5 | Ölçüm köprüsü canlı | ✅ `__CAROS_NAV_FIELD__` mevcut |

### 14.2 Cihazda DOĞRULANAMAYANLAR (kilit nedeniyle)

| Kabul maddesi | Neden yapılamadı |
|---|---|
| 1–2. Gece mini harita açık, sokak/yan yollar okunuyor | Ekran kilitli → `adb screencap` siyah kare veriyor. **Görsel doğrulama YALNIZ cihaz framebuffer'ından yapılabilir** (CDP ekran görüntüsü WebGL katmanını birleştirmez — kütük #324 dersi). |
| 3–5. Harita sürükleniyor → Ortala çıkıyor → araç takip konumuna dönüyor | Gerçek dokunuş gerekiyor. **CDP sentetik fare olayları MapLibre'nin dokunma tabanlı gesture handler'ına ULAŞMIYOR** — bu turda ölçüldü: `page.mouse` ile 8 adımlı sürükleme `dragstart` tetiklemedi. Aynı sınır daha önce `contextmenu` denemesinde de görülmüştü. |
| 6. Tam ekran ↔ mini geçişinde camera state korunuyor | Aynı — dokunuş gerekiyor |
| 7–9. Hız limiti kartı çıkıyor / kayboluyor / pan'da değişmiyor | Aynı; ayrıca gerçek `maxspeed` etiketli bir yolda bulunmayı gerektirir |
| LAB kart 10 cihazda | Uygulama ızgarasına dokunmayı gerektiriyor |
| 1024×600 · 1280×720 · 1920×720 yerleşimi | Ölçüm cihazı 1220×2712 telefon; head unit çözünürlükleri **bu cihazda yoktur** |

### 14.3 `realDeviceValidationVerdict`

```
PENDING_REAL_DEVICE
```

**Kapanış koşulu:** cihazın kilidi açık tutulup (`Ayarlar → Ekran → Uyku: hiçbir
zaman` veya kilit geçici kapalı) şu üç ölçüm yapıldığında:
1. `adb screencap` ile gece mini harita — sokak adları ve yan yollar seçilebiliyor mu
2. Gerçek parmak/`adb shell input swipe` ile mini haritayı sürükle → Ortala düğmesi
   çıkıyor mu → tek dokunuşla araç merkeze dönüyor mu
3. `maxspeed` etiketli bir yolda levha kartı çıkıyor, etiketsiz yolda **çıkmıyor** mu

---

## 15. Nihai Karar

### `MINI_MAP_NIGHT_CAMERA_SPEED_LIMIT_P0_PARTIAL`

Yerel iş tamamlandı ve doğrulandı — ancak **iki bağımsız nedenle** `COMPLETE_LOCAL`
verilmemiştir:

1. **Gece haritası yapısal olarak kısmi.** Görevin istediği katman-bazlı palet
   (bina · ara yol · etiket · POI ayrı ayrı) **raster modda mümkün değildir**;
   ürünün varsayılan yolu raster'dır. Yapılan, raster'ın izin verdiği en iyi
   dengedir ve ölçülmüş saha kilidinin (≤0.25) sınırındadır.
2. **Cihaz doğrulaması tamamlanamadı** — cihaz kilitli (§14).

### Kapılar

| Kapı | Karar | Gerekçe |
|---|---|---|
| `nightMapReadabilityVerdict` | **PARTIAL** | Token sistemi + okunabilirlik ↑ (0.16→0.25, kontrast 0.30→0.40) uygulandı ve testlerle kilitlendi; **katman-bazlı palet raster'da imkânsız**, görsel doğrulama yapılamadı |
| `cameraFollowVerdict` | **PASS (yerel)** | 5 durumlu kanonik otorite, fail-closed, 20 birim testi; iki görünüm aynı modüle bağlı (yapısal kilit). Cihazda gerçek dokunuşla doğrulanmadı |
| `manualRecenterVerdict` | **PASS (yerel)** | Her iki ekranda, tek dokunuş, 44 px, `aria-label`; **navigasyonda gizlenme hatası düzeltildi ve kilitlendi**. Cihazda "FOLLOWING iken gizli" gözlendi; "pan sonrası görünür" gözlenemedi |
| `speedLimitTruthVerdict` | **PASS (yerel)** | `AVAILABLE` dışında sayı dönmesi **yapısal olarak imkânsız**; çıkarım/bayat/çelişkili elenir; limit aracın matched konumuna bağlı. Gerçek levhalı yolda görülmedi |
| `layoutVerdict` | **PARTIAL** | 3 çözünürlükte kutu-çakışma testi yeşil; **gerçek head unit çözünürlüğünde görsel doğrulama yok** |
| `driverSafetyVerdict` | **PASS (yerel)** | 8 kural kilitli (popup/toast/uzun basma/animasyon/ses yok) |
| `realDeviceValidationVerdict` | **PENDING_REAL_DEVICE** | Cihaz kilitli (§14.3) |

### Başarı ölçütüne göre durum

> *"Gece harita rahat okunuyor, kullanıcı haritayı sürükledikten sonra tek
> dokunuşla araca dönebiliyor ve mini haritada yalnız doğrulanmış gerçek hız
> limiti gösteriliyor."*

- **Ortala:** kod ve testler tamam; **cihazda gerçek dokunuşla doğrulanmadı**
- **Gerçek hız limiti:** kod ve testler tamam; **gerçek levhalı yolda görülmedi**
- **Gece okunabilirliği:** iyileştirildi ama **ölçülmedi** ve katman ayrımı
  raster'da yapılamıyor

Kanıtsız PASS verilmemiştir.
