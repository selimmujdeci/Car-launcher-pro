# CAROS PRO — NAVIGATION REALITY AUDIT & OEM GAP ANALYSIS

**Tarih:** 2026-08-03
**Yöntem:** Yalnız gerçek kod + aynı gün alınmış cihaz ölçümleri (`4L45OFZDX84X55GE`, CDP over adb).
**Kapsam dışı bırakılanlar:** vizyon belgesi, roadmap, test isimleri, eski raporlar. Bunlar ürün gerçeği sayılmadı.
**Bu denetimde kod yazılmadı, refactor yapılmadı, test eklenmedi, commit/push/deploy yapılmadı.**

> Bu belgedeki her "YOK / KIRIK / PLACEHOLDER" yargısı bir dosya·satır kanıtına veya bir cihaz
> ölçümüne dayanır. Kanıtı olmayan yerlerde açıkça **UNKNOWN** yazılmıştır.

---

## 1. YÖNETİCİ ÖZETİ

CAROS PRO navigasyonu **çevrimiçi koşulda çalışan, tek otoriteli, dürüst hata bildiren bir
navigasyon prototipidir.** Zincirin omurgası (hedef → geocode → OSRM → rota deposu → harita →
manevra → ses → sapma → ETA → varış → kalıcılık) gerçekten bağlıdır ve tek merkezden akar.
Sahte veri üretimine karşı disiplin belirgindir: düz-hat yedeği kullanıcıya **"düz hat
navigasyon"** diye söylenir, offline grafik yokken "çevrimdışı rota var" denmez.

Ancak OEM seviyesinden **yapısal olarak** uzaktır ve bunun üç kökü vardır:

1. **Çevrimdışı navigasyon GERÇEKTE YOKTUR.** `public/maps/` dizini **tamamen boştur**;
   `routing-graph.bin` ve `poi.db` artefaktları repoda, `dist/`te ve Android assets'te
   **hiç yoktur**. İnternet gidince ürün kuş uçuşu düz çizgiye düşer — bu navigasyon değildir.
2. **Rota zenginliği kullanılmıyor.** OSRM yanıtından yalnız `geometry`, `steps`, `name`,
   `maneuver.type/modifier` ve `intersections[].classes` okunur. **`maneuver.exit` (dönel
   kavşak çıkış numarası) ve `intersections[].lanes` (gerçek şerit verisi) hiç ayrıştırılmaz.**
   Ekrandaki şerit rehberi manevra tipinden TÜRETİLİR — gerçek şerit bilgisi değildir.
3. **Saha doğrulaması yoktur.** Gerçek araçta rota başlatma, sapma, tünel, internet kaybı ve
   süreç yeniden başlatma senaryolarının hiçbiri doğrulanmamıştır. Bugünkü tüm ölçümler
   **park hâlindeki bir telefonda** alınmıştır.

Aynı gün, aynı cihazda ölçülüp kapatılan üç ağır kusur bu denetimin bağlamıdır ve OEM
olgunluğunun neden düşük olduğunu gösterir: kamera 28 saattir görünmez bir görüntü için
çekiyordu, park hâlindeki araçta harita saniyede 31 kez çiziliyordu, ve rota isteği aracın
yönünü hiç göndermediği için bölünmüş yolda ters şeride yapışıyordu.

**Nihai karar: `NAVIGATION_LOCAL_BETA`** (gerekçe §17).

---

## 2. GERÇEK MİMARİ

### 2.1 Zincir haritası

| # | Halka | Gerçek üretici → tüketici | Durum |
|---|-------|---------------------------|-------|
| 1 | Hedef seçimi | `MapSearchBar.tsx:67` · `NavigationHUD.tsx:1539` · `FullMapView.tsx:1197` · `homeWorkNavigation.ts:102` · `addressNavigationEngine.ts:206` → hepsi **tek** `navigationService.startNavigation()` | **WORKING** |
| 2 | Geocoding | `geocodingService.ts` (Nominatim + BYOK sağlayıcı katmanı) · `streetSearchService.ts` (Overpass tam-eşleşme) · `offlineSearchService.ts` (cihaz-içi POI) | **PARTIAL** |
| 3 | Rota isteği | `FullMapView.tsx:1462` → `routingService.fetchRoute()` — **tek giriş** | **WORKING** |
| 4 | Rota motoru | 5 katman: L0 yerel daemon · L1/L2 uzak OSRM · L3 offline A* worker · L4 düz hat | **PARTIAL** (L0 ve L3 ölü) |
| 5 | Rota sonucu | `useRouteStore` (`routingService.ts:66`) — **tek rota deposu** | **WORKING** |
| 6 | Harita çizimi | `MapLayerManager.ts` → `selected-route-source` · `car-route-alt` | **WORKING** |
| 7 | Manevra üretimi | `routingService._toTR()` + `updateRouteProgress()` (adım ilerleme) | **PARTIAL** |
| 8 | Sesli yönlendirme | `NavigationHUD.tsx:1857` üç kademe → `ttsService.speakNavigation()` | **PARTIAL** |
| 9 | Yeniden rota | `routingService.updateRouteProgress()` sapma + histerezis | **WORKING** |
| 10 | Trip/ETA | `navigationService.updateNavigationProgress()` + `cumulativeDistances` | **WORKING** |
| 11 | Varış | `navigationService.ARRIVAL_THRESHOLD_M = 20` → `ARRIVED` → 5 s → `IDLE` | **WORKING** |
| 12 | Kalıcılık | `_sealNavState()` + `restoreNavigationAsync()` (bütünlük + tazelik denetimli) | **WORKING** |

### 2.2 Otorite sayısı (kritik)

- **Konum otoritesi: TEK** — `gpsService` → `useGPSStore` → `UnifiedVehicleStore`.
- **Rota otoritesi: TEK** — `useRouteStore`.
- **Navigasyon durumu: TEK** — `useNavigationStore`.
- **İlerleme: İKİ FONKSİYON, ÇAKIŞMA YOK** — `updateRouteProgress` (adım/sapma) ve
  `updateNavigationProgress` (kalan mesafe/ETA/varış) ayrı sorumluluklardır ve aynı
  `cumulativeDistances` dizisini paylaşırlar.

Bu, denetimin en olumlu bulgusudur: **paralel otorite yoktur.**

---

## 3. KULLANICI AKIŞLARI

| Akış | Giriş | Gerçek veri | Kopma noktası | Durum |
|------|-------|-------------|---------------|-------|
| Ev'e git | `homeWorkNavigation.ts:102` | Kayıtlı adres → OSRM | Adres kayıtlı değilse | **WORKING** |
| İş'e git | aynı | aynı | aynı | **WORKING** |
| Adres ara | `MapSearchBar` → `geocodingService` | Nominatim/Overpass | Numaralı sokaklar OSM'de yok (kütük #336) | **PARTIAL** |
| Hastane/akaryakıt bul | `nearbyPoiNavigation.ts` + `offlineSearchService` | cihazda 6 621 POI ölçüldü | — | **WORKING** |
| Haritadan nokta seç | `FullMapView` | ters geocode | — | **WORKING** |
| Rota başlat | `FullMapView.tsx:1462` | OSRM | — | **WORKING** |
| Rota iptal | `stopNavigation()` | — | — | **WORKING** |
| Rotadan sap | `updateRouteProgress` sapma penceresi | gerçek geometri | — | **WORKING** |
| Yeniden hesapla | `_getRerouteThrottleMs` + histerezis | OSRM | internet yoksa **düz hat** | **PARTIAL** |
| Tünel / GPS kaybı | DR (`DR_THRESHOLD_MS = 2 s`) + `allowReroute:false` | OBD hızı varsa gerçek | OBD yoksa DR hızsız | **PARTIAL** |
| İnternet kaybı | L4 düz hat + sesli bildirim | — | **gerçek navigasyon YOK** | **PARTIAL** |
| Arka plan | `feedBackgroundLocation` (foreground service) | gerçek | — | **WORKING** |
| Uygulama restart | `restoreNavigationAsync()` | gerçek | — | **WORKING** |
| Varış | 20 m eşiği | gerçek | — | **WORKING** |

**Sessiz başarısızlık bulunamadı** — düz-hat yedeği hem sesli hem `error` alanıyla bildirilir
(`routingService.ts:788-800`). Bu, denetimin ikinci olumlu bulgusudur.

---

## 4. HARİTA VE ROTA MOTORU

### 4.1 Ölçülen gerçek

| Yetenek | Gerçek durum | Kanıt |
|---------|--------------|-------|
| Harita sağlayıcı | MapLibre GL, **raster** karo | `_mapState.ts:142` |
| Karo kaynağı | `caros-tile://tile.openstreetmap.org/{z}/{x}/{y}.png` | `_mapState.ts:142` |
| Karo önbelleği | Cache API LRU, **500 MB** tavan | `CacheLRUManager.ts:24` |
| Offline karo paketi | **YOK** — `public/maps/` boş (0 dosya) | `ls public/maps` |
| Offline rota grafiği | **YOK** — `routing-graph.bin` repoda/dist'te/assets'te yok | `NavigationCompute.worker.ts:29` |
| Offline POI (worker) | **YOK** — `/maps/poi.db` yok | `NavigationCompute.worker.ts:264` |
| Offline POI (çalışan yol) | **VAR** — `offlineDataService`, cihazda 6 621 yer | `caros-offline-meta-v2` (cihaz) |
| Yerel OSRM daemon | **YOK** — Android tarafında tek iz bir yorum satırı | `network_security_config.xml:8` |
| Online routing | `routing.openstreetmap.de` + `osrm.route.at` | `routingService.ts:137-139` |
| Alternatifler | `alternatives=3`, UI'da seçilebilir | `routingService.ts:324` |
| `bearings` | **VAR** (bugün eklendi), durakta gönderilmez | `routingService.ts:304`, cihazda doğrulandı |
| Avoid toll/ferry/highway | **YOK** | kod taraması: eşleşme yok |
| Araç profili | **YOK** — sabit `driving` | `routingService.ts:137` |
| Trafik | **YOK** — "traffic" yalnız sürücünün KENDİ durma süresinden ETA tamponu | `navigationService.ts:345` |
| Yol kapanması | **YOK** | eşleşme yok |
| Hız limiti | Overpass `maxspeed`, yoksa yol sınıfından ÇIKARIM (`≈` işaretli) | `speedLimitService.ts` |
| Şerit rehberi | **PLACEHOLDER** — manevra tipinden türetilmiş ok | `NavigationHUD.tsx:475` |
| Dönel kavşak çıkışı | **YOK** — `maneuver.exit` ayrıştırılmıyor | `routingService.ts:249-257` |
| Köprü/feribot | **YOK** | eşleşme yok |
| ETA | Gerçek — rota süresi + durma tamponu + histerezis | `navigationService.ts:345,383` |

### 4.2 Ağır bulgu — L0 katmanı her rotada 3 sn'ye kadar boşuna bekliyor

`fetchRoute` native platformda **her rotada** `http://localhost:5000`'e istek atar
(`offlineRoutingService.ts:78-79`, `LOCAL_DAEMON_TIMEOUT_MS = 3_000`). Android tarafında böyle
bir daemon **yoktur**. Cihazda ölçüldü: rota kurarken önce `localhost:5000`'e, sonra uzak
sunucuya istek gitti. Bağlantı reddi genelde hızlıdır, ama bu katman **ölü koddur** ve rota
gecikmesine katkı riski taşır.

### 4.3 Ticari lisans riski (CLAUDE.md §Lisans kapsamında)

Karolar doğrudan `tile.openstreetmap.org`'dan çekilmektedir. **OSMF Tile Usage Policy** yoğun
ve ticari kullanımı yasaklar. Ürün 3. taraf head unit üreticilerine satılacaksa bu yapılandırma
**satıştan önce değiştirilmelidir** (kendi karo sunucusu veya ticari sağlayıcı). Bu bir kod
kusuru değil, bir **ürün riski**dir ve OEM matrisinde "Harita" puanını sınırlar.

---

## 5. KONUM OTORİTESİ

**Tek otorite doğrulandı.** `gpsService.ts` → `useGPSStore` → `UnifiedVehicleStore`; navigasyon
`FullMapView` üzerinden bu tek kaynağı okur.

| Bileşen | Durum | Not |
|---------|-------|-----|
| Kaynak seçimi | **WORKING** | native/web ayrımı |
| Fix tazeliği | **WORKING** | `lastFixTsRef`, monotonik `performance.now()` |
| GPS heartbeat | **WORKING** | varış-tabanlı (`onGPSFixArrival`), kütük #327 |
| Dead reckoning | **PARTIAL** | `DR_THRESHOLD_MS = 2 s`, `DR_MIN_SPEED_MS = 2 km/h`; OBD hızı yoksa projeksiyon zayıf |
| OBD hız füzyonu | **WORKING** | `resolveDrSpeed` |
| Heading | **PARTIAL** | durakta gürültü (ölçüldü: 92°→106°); artık rota isteğine geçmiyor |
| Jump guard | **WORKING** | `isJumpInvalid` |
| Arka plan konum | **WORKING** | foreground service → `feedBackgroundLocation` |
| Süreç geri yükleme | **WORKING** | `restoreNavigationAsync` bütünlük denetimli |
| Harici GPS | **YOK** | Phone Hub taşıması kayıtlı değil |

**GPS ile heartbeat çelişebilir mi?** Hayır — `gpsHealthReconcile.ts` iki kanıtı birleştirir ve
çelişkiyi `GPS_HEALTH_CONFLICT` olarak AYRI sınıflandırır (kütük #327/#328).

### 5.1 Açık kusur — hayalet hız

Bugün ölçüldü (telefon sabit, 17 fix): ardışık fix'ler arası **10–12 m** yer değiştirme,
bildirilen doğruluk 3.0–3.6 m. Toplam yol **46.8 m**, net yer değiştirme **4.2 m**,
**düzlük oranı 0.089**. Yani cihaz gerçekten "hareket ettim" diyor ve tek fix çiftinden bu,
40 km/h'lik gerçek sürüşten **ayırt edilemiyor**. Ayırt edici ölçüldü ama **uygulanmadı**
(dönel kavşak riski — kütük #362).

---

## 6. NAVIGATION WORKER

| Soru | Cevap | Kanıt |
|------|-------|-------|
| Nerede oluşturuluyor | `offlineRoutingService._getOrCreateNavWorker()` | satır 185 |
| Hangi olayla start | **Yalnız** `computeOfflineRoute` (L3) veya `dispatchPOISearch` çağrılınca — tembel | satır 304 |
| Neden `not_started` | Tüm online katmanlar başarılı olduğu sürece L3 hiç çağrılmaz; çağrılsa bile `shouldAttemptOfflineRoute()` grafik yokken kısa devre yapar | `offlineRoutingStatus.ts:92` |
| Kim stop ediyor | `restartNavWorker()` / `closeWorkerDatabase()` | satır 349/363 |
| Duplicate worker riski | **YOK** — `if (_navWorker) return _navWorker` | satır 186 |
| Main thread fallback | **VAR** — worker desteklenmiyorsa `null` → düz hat | satır 191-196 |
| Timeout / iptal | **VAR** — `NAV_WORKER_TIMEOUT_MS = 8_000`, `_pending` map ile | satır 164, 310 |
| Eski WebView | **KORUNMUŞ** — `supportsModuleWorker()` kontrolü, kalıcı kayıt | satır 191 |

**Kanıtlanamayan iddia:** "Gerçek kullanıcı navigasyon başlatınca worker çalışır" — **YANLIŞ**.
Worker, online rota başarılı olduğu sürece **hiç çalışmaz**. LAB snapshot'larındaki
`not_started` bir arıza değil, **tasarımın doğru sonucudur**; asıl arıza grafik artefaktının
hiç paketlenmemiş olmasıdır.

---

## 7. SESLİ YÖNLENDİRME

| Konu | Durum | Kanıt |
|------|-------|-------|
| Metin kaynağı | **GERÇEK rota motorundan** — `_toTR(maneuver.type, modifier, name)` | `routingService.ts:234` |
| Sabit metin mi | **HAYIR** — sabit metin yalnız düz-hat/hata bildirimlerinde | `routingService.ts:790` |
| Kademeler | 600 m / 250 m / son uyarı | `NavigationHUD.tsx:1857` |
| Son uyarı eşiği | **Hıza bağlı** (bugün değişti): `clamp(hız × 4 sn, 35, 150) m` | `NavigationHUD.tsx` |
| Tekrar koruması | **VAR** — adım başına bitmask | `_spokenRef.tiers` |
| Ducking | **VAR** — `duckMedia/unduckMedia` | `ttsService.ts:13` |
| Native audio focus | **VAR** — `CarosAudioFocusManager` | Java |
| Mavi ile çakışma | **KORUNMUŞ** — `__SAFETY_LOCK__` + kritik mesaj istisnası | `ttsService.ts:494-499` |
| Dil | Türkçe | — |

### 7.1 Ağır kusur — manevra mesafesi kuş uçuşu

`updateRouteProgress`'te bir sonraki manevraya mesafe **düz çizgi** ile hesaplanır
(`hav(araç, manevraNoktası)`). Virajlı yaklaşımda bu gerçek yol mesafesinden **kısa** çıkar →
hem HUD'daki "X M SONRA" yanlış hem sesli anons **erken** gelir. Kullanıcı bunu birebir
bildirdi ("daha 50 metre var, sağa dön diyor").

**Bu kusur ucuzdur:** `cumulativeDistances` suffix-sum dizisi ZATEN mevcuttur ve
`navigationService.calculateRouteDistance()` yol-boyu mesafeyi ZATEN hesaplar. Eksik olan
yalnız manevra noktasının geometri indeksinin önbelleklenmesidir.

---

## 8. UX DENETİMİ (OEM ölçütleriyle)

| Ölçüt | Durum | Kanıt / Not |
|-------|-------|-------------|
| Sürüşte dokunma sayısı | **İYİ** — Ev/İş tek dokunuş | `NewHomeLayout` hızlı hedefler |
| Büyük dokunma alanları | **İYİ** | `ALT_TOUCH_PAD` 24 px bbox |
| Kontrast / gece modu | **İYİ** — `--oem-*` token katmanı | kütük #338 (gündüz beyaz-üstüne-beyaz düzeltildi) |
| Mevcut hız | **VAR** | `SpeedPanel` |
| Hız limiti | **VAR** — `≈` ile çıkarım ayrımı | `speedLimitService` |
| ETA / kalan mesafe | **VAR** | alt şerit |
| Sonraki manevra | **VAR** | `TurnPanel` |
| İkinci manevra | **VAR** — `pendingManeuver` (50 m eşiği) | `routingService.ts:851` |
| Şerit yönlendirme | **PLACEHOLDER** — gerçek şerit verisi yok | `NavigationHUD.tsx:475` |
| Kavşak görünümü | **YOK** | — |
| Dönel kavşak | **ZAYIF** — çıkış numarası yok | `routingService.ts:234` |
| Reroute durumu | **VAR** — `REROUTING` statüsü | — |
| GPS kaybı | **VAR** — 30 sn + OBD hızı < 1 koşuluyla banner | `FullMapView.tsx:788` |
| İnternet kaybı | **VAR** — sesli + `error` alanı | `routingService.ts:790` |
| Sürüşte modal | **KORUNMUŞ** — `canShowDistractingSurface()` fail-closed | `tripSummaryGate.ts` |
| Sesli komut | **VAR** — `resolveAndNavigate` | `useVoiceCommandHandler.ts:241` |

**Amatör görünen alanlar (dosya kanıtıyla):**
1. `NavigationHUD.tsx:475` — şerit oku manevra tipinden üretiliyor; sürücüye gerçek şerit
   bilgisi olduğu izlenimi verir. **Bu, ürünün kendi "kanıtsız bilgi üretme" yasağına aykırıdır.**
2. `routingService.ts:234` — "Dönel kavşakta devam edin" (kaçıncı çıkış belirtilmiyor).
3. `detectToll` (satır 264) — motorway/trunk sınıfından "ücretli" çıkarımı; Türkiye'de trunk
   çoğunlukla ücretsizdir → **yanlış pozitif üretir.**

---

## 9. GÜVENLİK / FAIL-CLOSED

| Risk | Durum | Kanıt |
|------|-------|-------|
| GPS yokken rota devam ediyor görünmesi | **KORUNMUŞ** | 30 sn banner + DR sınırı |
| Route yokken ACTIVE navigasyon | **KORUNMUŞ** | `activateNavigation()` olmadan `ARRIVED` imkânsız (satır 132) |
| Stale route | **KORUNMUŞ** | `NAV_PERSIST_MAX_AGE_MS` tazelik filtresi |
| Stale ETA | **KORUNMUŞ** | histerezis + durma takibi |
| İnternet yokken online bekleme | **KORUNMUŞ** | `navigator.onLine` fail-fast + `HEADERS_TIMEOUT_MS` |
| Yanlış konum | **KISMİ RİSK** | hayalet hız (§5.1) hâlâ açık |
| Bilinmeyen heading | **KORUNMUŞ** | 5 km/h altında OSRM'e gönderilmiyor |
| Sürüşte modal | **KORUNMUŞ** | fail-closed kapı |
| Rotaya müdahale eden debug kodu | **BULUNAMADI** | mock hız servisi 2026-08-03'te silinmiş |
| Düz-hat yedeğinin yanlış sunumu | **KORUNMUŞ** | hem sesli hem metin bildirimi |

**Tek gerçek güvenlik açığı:** ters şeride yapışma (bugün `bearings` ile kapatıldı, **gerçek
araçta doğrulanmadı**). Yanlış şeritte rota, sürücüyü yanlış yola sokabilecek tek sınıftı.

---

## 10. PERFORMANS (cihazda ölçülmüş değerler)

| Ölçüm | Değer | Kaynak |
|-------|-------|--------|
| Harita çizimi (park, nav aktif) | **0 /sn** (düzeltme öncesi 31.2) | CDP, 2026-08-03 |
| Uygulama CPU (park, nav aktif) | **%41.3** (düzeltme öncesi %119) | `adb top` |
| Pil sıcaklığı | **39.2°C** (en kötü 46.3°C) | `dumpsys battery` |
| `RenderThread` | %3.1 (öncesi %14.6) | `top -H` |
| `SensorsHandlerT` | **%9.3 — AÇIK KALEM** | `top -H` |
| Kamera akışı | bırakıldı (öncesi 720p30, 28 saat) | CDP |
| Kamera throttle | 150 ms sürüşte / 500 ms durakta | `FullMapView.tsx:961` |
| Karo önbellek tavanı | 500 MB | `CacheLRUManager.ts:24` |
| Rota timeout | `HEADERS_TIMEOUT_MS` + L0 3 sn | `offlineRoutingService.ts:79` |
| Worker timeout | 8 sn | satır 164 |
| Reroute throttle | 5/10/15 sn (hıza göre) | `routingService.ts` |
| Offline grafik boyutu | **0 (artefakt yok)** | `ls public/maps` |

**Ölçülmedi (dürüst boşluk):** gerçek head unit'te (Mali-400 / K24) navigasyon FPS'i, sürüş
hâlinde CPU, uzun yolda bellek eğrisi.

---

## 11. ÇAKIŞAN / GEREKSİZ YAPILAR

| Yapı | Bulgu | Karar |
|------|-------|-------|
| `navigationService.navigateToAddress()` | **0 çağrı** — ölü ikinci adres→rota yolu | **REMOVE** |
| `offlineRoutingService.tryLocalDaemon()` (L0) | Native daemon YOK; her rotada boşuna istek | **REMOVE** (veya daemon gerçekten paketlenecekse KEEP) |
| `NavigationCompute.worker` A* rota yolu | Grafik artefaktı yok → yapısal ölü | **REWORK** (artefakt üret ve paketle) veya **REMOVE** |
| Worker `/maps/poi.db` | Artefakt yok; çalışan POI yolu `offlineDataService` | **MERGE** (tek POI otoritesi) |
| `appNavigationService.ts` | Ekran navigasyonu — isim çakışması, işlev çakışması YOK | **KEEP** |
| Düz-hat yedeği | Doğru kullanılmış (dürüst etiketli) | **KEEP** |
| İkinci ETA hesabı | **YOK** — tek ETA | **KEEP** |
| İkinci heading hesabı | **YOK** — `_blendHeading` tek | **KEEP** |
| İkinci harita instance | `MiniMapWidget` ayrı WebGL context; `MainLayout.tsx:354` bilinçli serbest bırakıyor | **KEEP** (izlenmeli) |
| Navigasyon LAB ekranı | **YOK** — 47 katalog girdisinde rota/navigasyon gözlem ekranı yok | **REWORK** (zorunlu gözlemlenebilirlik borcu) |

---

## 12. OEM SEVİYE MATRİSİ

| Başlık | Puan | Gerekçe (kanıt) |
|--------|:----:|-----------------|
| Hedef arama | **3** | Nominatim + Overpass + BYOK + 6 621 offline POI; numaralı sokak boşluğu (#336) |
| Harita | **3** | MapLibre raster; offline paket yok; OSM tile policy ticari risk |
| Online rota | **4** | OSRM, alternatifler, bearings, fail-fast, dürüst hata |
| Offline rota | **0** | `routing-graph.bin` YOK; düz hat navigasyon sayılmaz |
| GPS doğruluğu | **2** | Tek otorite + jump guard iyi; hayalet hız açık (#362) |
| Tünel toparlanması | **2** | DR var ama OBD hızı yoksa zayıf; gerçek tünelde doğrulanmadı |
| Reroute | **3** | Histerezis + throttle + accuracy payı; sahada doğrulanmadı |
| ETA | **3** | Rota süresi + durma tamponu + histerezis; trafik verisi yok |
| Maneuver guidance | **2** | Adım/ikinci manevra var; mesafe KUŞ UÇUŞU; dönel çıkış yok |
| Voice guidance | **3** | Gerçek motordan, üç kademe, ducking, safety lock |
| Lane guidance | **1** | Manevra tipinden türetilmiş — gerçek şerit verisi yok |
| Speed limits | **2** | Gerçek `maxspeed` + dürüst çıkarım; Overpass erişilebilirliğine bağlı |
| Traffic | **0** | Trafik verisi YOK; "traffic" yalnız kendi durma süresi |
| Background continuity | **3** | Foreground service + `feedBackgroundLocation` |
| Process restore | **4** | Bütünlük + tazelik + `wasActive`; sağlam tasarım |
| Driver safety | **3** | Fail-closed modal kapısı, safety lock; ters şerit yeni kapandı |
| UX | **3** | OEM token, büyük hedefler, ikinci manevra; şerit/kavşak eksik |
| Performance | **3** | Bugün %119→%41 CPU, 31→0 çizim; head unit ölçümü yok |
| Observability | **1** | 47 LAB girdisinde **navigasyon ekranı YOK** — kendi zorunlu kuralının ihlali |
| Field validation | **0** | Gerçek araçta hiçbir navigasyon senaryosu doğrulanmadı |

**Ortalama: 2.15 / 5**

---

## 13. EN AĞIR 20 AÇIK

1. **Offline rota grafiği hiç paketlenmemiş** — internet yoksa navigasyon yok. (`public/maps` boş)
2. **Gerçek araç doğrulaması sıfır** — rota/sapma/tünel/restart hiç sürülmedi.
3. **Manevra mesafesi kuş uçuşu** — HUD ve sesli anons virajda erken. (`routingService.ts:864`)
4. **Şerit rehberi sahte** — manevra tipinden türetilmiş. (`NavigationHUD.tsx:475`)
5. **Navigasyon LAB ekranı yok** — projenin kendi "gözlemlenemeyen özellik tamamlanmamıştır" kuralı ihlal.
6. **Hayalet GPS hızı** — düzlük oranı 0.089 ölçüldü, filtre uygulanmadı. (#362)
7. **Trafik verisi yok** — ETA gerçek yol koşulunu bilmiyor.
8. **Dönel kavşak çıkış numarası yok** — `maneuver.exit` ayrıştırılmıyor.
9. **OSM tile policy ticari risk** — doğrudan `tile.openstreetmap.org`.
10. **L0 yerel daemon ölü kod** — her rotada boşuna istek. (`offlineRoutingService.ts:78`)
11. **Rota çizgisi kaybolması açıklanmamış** — kullanıcı ekran görüntüsü, kök neden UNKNOWN. (#354)
12. **`SensorsHandlerT` %9.3 CPU** — AR hizalama sensörleri AR kapalıyken de açık.
13. **Ücretli yol tespiti yanlış pozitif üretir** — trunk ≠ ücretli.
14. **Avoid toll/highway/ferry seçeneği yok** — sürücü rota tercihini yönlendiremiyor.
15. **Araç profili sabit** — ağır araç/karavan/EV profili yok.
16. **Kavşak yakınlaştırma görünümü yok** (junction view).
17. **Harici GPS / Phone Hub konum taşıması kayıtlı değil.**
18. **DR yalnız OBD hızıyla anlamlı** — OBD yoksa tünelde konum donar.
19. **Hız limiti Overpass erişilebilirliğine bağlı** — ölçümde 504 alındı, kart doğamadı.
20. **`navigateToAddress` ölü kod** — bakım yükü ve yanlış yönlendirme riski.

---

## 14. NE KALDIRILMALI

- `navigationService.navigateToAddress()` — 0 çağrı.
- `tryLocalDaemon()` (L0) — daemon paketlenmeyecekse.
- Worker'ın `/maps/poi.db` yolu — çalışan POI otoritesi `offlineDataService`.
- `LaneGuidance` **mevcut hâliyle** — gerçek `lanes` verisi bağlanana kadar gösterilmemeli
  (sahte bilgi göstermek, hiç göstermemekten kötüdür).

## 15. NE TAMAMLANMALI

- `routing-graph.bin` üretimi + paketlenmesi (offline rota).
- Yol-boyu manevra mesafesi (`cumulativeDistances` zaten var).
- OSRM `maneuver.exit` + `intersections[].lanes` ayrıştırması.
- Navigasyon LAB gözlem ekranı (rota kaynağı, katman, sapma sayacı, worker durumu).
- Hayalet hız için pencere-içi yön tutarlılığı filtresi (dönel kavşak riski çözülerek).
- Kendi karo altyapısı (ticari lisans).

---

## 16. ÜÇ AŞAMALI YOL HARİTASI

### AŞAMA 1 — ÇALIŞAN TEMEL NAVİGASYON
**Amaç:** Bugün yanlış olan şeyleri doğru yapmak. Yeni yetenek yok.

- **Dosyalar:** `routingService.ts` (yol-boyu manevra mesafesi, `maneuver.exit`),
  `NavigationHUD.tsx` (şerit rehberini gerçek veriye bağla veya gizle),
  `offlineRoutingService.ts` (L0 kaldır).
- **Yeniden kullanılacak:** `cumulativeDistances`, `calculateRouteDistance`.
- **Silinecek:** `navigateToAddress`, L0 daemon, worker POI yolu.
- **Cihaz kabul kriterleri:** virajlı yaklaşımda HUD mesafesi ±%10; dönel kavşakta "N. çıkış";
  bölünmüş yolda rota doğru şeritte; gerçek araçta 30 dk sürüş.
- **Risk:** düşük. **Kapsam:** ~4 dosya.

### AŞAMA 2 — GÜVENİLİR ARAÇ NAVİGASYONU
**Amaç:** İnternet ve GPS olmadan da güvenilir olmak.

- **Dosyalar:** `NavigationCompute.worker.ts`, `offlineRoutingStatus.ts`, build pipeline
  (grafik artefaktı), `gps/speedCore.ts` (yön tutarlılığı filtresi), yeni LAB ekranı.
- **Yeniden kullanılacak:** mevcut worker iskeleti, `shouldAttemptOfflineRoute` kapısı,
  `sessionInspectorModel` gözlem sözleşmesi.
- **Cihaz kabul kriterleri:** uçak modunda gerçek rota (düz hat DEĞİL); tünelde konum
  sürekliliği; park hâlinde düzlük oranı < 0.2 ölçülüp hız 0 kalması.
- **Risk:** orta (hız otoritesi güvenlik katmanlarını besler). **Kapsam:** ~8 dosya + artefakt.

### AŞAMA 3 — OEM SEVİYE
**Amaç:** Ticari head unit ürünü.

- Kendi karo/rota altyapısı (lisans), trafik sağlayıcı entegrasyonu (BYOK),
  gerçek şerit + kavşak görünümü, araç profilleri, avoid seçenekleri, harici GPS.
- **Cihaz kabul kriterleri:** DEVICE_VALIDATION_LEDGER'da navigasyon maddelerinin
  🟢'ya taşınması; gerçek araçta uzun yol oturumu.
- **Risk:** yüksek (harici bağımlılık + maliyet). **Kapsam:** yeni altyapı.

---

## 17. NİHAİ KARAR

# `NAVIGATION_LOCAL_BETA`

**Neden `NAVIGATION_PROTOTYPE` değil:** zincir uçtan uca gerçekten bağlıdır, tek otoritelidir,
gerçek OSRM verisiyle çalışır, sapma/ETA/varış/restore uygulanmıştır ve hata durumları
dürüstçe bildirilir. Bu bir demo değildir.

**Neden `NAVIGATION_FIELD_BETA` değil:** gerçek araçta **hiçbir** navigasyon senaryosu
doğrulanmamıştır. Bugünkü ölçümlerin tamamı park hâlindeki bir telefondan alınmıştır.
Saha kütüğünde navigasyonla ilgili maddeler 🔴 beklemektedir.

**Neden `NAVIGATION_COMMERCIAL_READY` / `OEM_READY` değil:** çevrimdışı navigasyon
**yoktur** (artefakt paketlenmemiş), trafik verisi yoktur, şerit rehberi gerçek veriye
dayanmaz, manevra mesafesi kuş uçuşudur ve harita karo kaynağı ticari kullanım için
uygun değildir.

> **Bu karar, gerçek araçta rota başlatma · sapma · tünel · internet kaybı · yeniden başlatma
> senaryoları ölçülene kadar YÜKSELTİLEMEZ.** Test yeşilliği ve rota çizilmesi bu beş ölçütün
> yerine geçmez.
