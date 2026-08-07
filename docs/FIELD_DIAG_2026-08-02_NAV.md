# SAHA TANI — 2026-08-02 · Navigasyon (canlı sürüş, CDP-over-adb)

**Cihaz:** Xiaomi 23090RA98I (zircon) · `com.cockpitos.pro` 1.0.2 (bugünkü APK)
**Yöntem:** CDP over adb, **SALT OKUMA** — uygulamaya hiçbir komut gönderilmedi, UI'a dokunulmadı.
**Bağlam:** Mersin–Antalya Yolu, hedef Tarsus, gece modu, `performanceMode=lite`, tema `expedition`.
**Gözlem penceresi:** 19:29 → 19:38 (iki tam ölçüm + 3 ekran görüntüsü).

---

## ÖZET — 4 gerçek arıza

| # | Arıza | Kanıt | Etki |
|---|-------|-------|------|
| **A** | **Harita hiç çizilmiyor** (9 dk boyunca boş) | `isStyleLoaded()=false`, `map.loaded()=false` — 9 dk sonra hâlâ | Navigasyon görsel olarak kullanılamaz |
| **B** | **Sürekli "U dönüşü yapın"** (yanlış yön) | 19:29'da 2.8 km sonra, 19:38'de 9.0 km sonra — hedefe mesafe 77.5→71.1 km AZALIRKEN | Rota güvenilmez |
| **C** | **Odometre gerçek hareketi reddediyor** | `[ODO:Guard] Teleport rejected … (0.0 km/h)` — ekranda 68 km/h | Yol Sayacı + trip mesafesi eksik sayıyor |
| **D** | **Ana ekranda SAHTE navigasyon verisi** | `2.4 km · Sahil Yolu Cd.` — koda gömülü sabit | Ürün yalanı |

---

## A · Harita çizilmiyor — ölçümler

Ağ ve tile hattı **SAĞLAM**, sorun render/style tarafında:

| Test | Sonuç |
|------|-------|
| Düz `fetch` OSM tile | **HTTP 200 · 8738 B · 280 ms** ✅ |
| `User-Agent` başlıklı fetch (handler'ın kullandığı biçim) | **HTTP 200 · 8738 B · 46 ms** ✅ |
| Cache API'den aynı tile | **HIT · 8738 B · 12 ms** ✅ |
| `caros-tiles-v1` cache | **4745 kayıt** ✅ |
| Depolama kotası | 28.5 MB / 10268 MB (**%0.3**) — kota sorunu YOK ✅ |
| WebGL | Mali-G610 MC4, `isContextLost()=false` ✅ |
| `map.isStyleLoaded()` | **false** ❌ |
| `map.loaded()` | **false** ❌ |
| `map.areTilesLoaded()` | **false** ❌ |

**Ölçülen anormallik — `user-location` kaynağı setData ile boğuyor:**
10 saniyelik olay dinlemesinde `user-location` **6 tam yeniden yükleme döngüsü**
(`dataloading → metadata → content`) üretti; `map-tiles` yalnız 2 olay aldı.
Her `setData` bir worker turu + stil yeniden değerlendirmesi demektir.

**Hipotez (kanıtlanmadı):** `user-location` sürekli yeniden yüklendiği için stil
ASLA `loaded` durumuna geçemiyor; depoda kamera ve katman işlemleri
`isStyleLoaded()` kapısının arkasında (bkz. hafıza notu *gps-doppler-zero-stuck*
— "isStyleLoaded kamera kapıları") → tile/kamera işlemleri sessizce atlanıyor.
**Bu bağlantı ölçülmedi; doğrulanması gerekir.**

**Stil hatası — `glyphs` YOK:**
```
map.getStyle().glyphs  →  TANIMSIZ
map.getStyle().sprite  →  TANIMSIZ
car-launcher-glyphs-v1 cache → 0 kayıt (BOŞ)
```
Sonuç: `text-field` kullanan her symbol katmanı doğrulamadan geçemiyor →
katman eklenmiyor → ardından gelen `moveLayer` çağrıları patlıyor.
`cl_crash_log` içindeki **son 50 kaydın 50'si de harita hatası**:

| Hata | Adet |
|------|------|
| `Cannot style non-existing layer "car-route-glow-sel"` | 12 |
| `The layer 'car-route-shadow' does not exist … cannot be moved` | 8 |
| `The layer 'car-route-glow-sel' does not exist … cannot be moved` | 8 |
| `The layer 'car-route-flow' does not exist … cannot be moved` | 8 |
| `car-route-alt-badge-labels.layout.text-field: use of "text-field" requires a style "glyphs" property` | 7 |
| `The layer 'car-route-alt-badge-labels' does not exist … cannot be moved` | 7 |

**Service worker controller YOK** (`navigator.serviceWorker.controller === null`)
— çevrimdışı tile stratejisi bugün devre dışı.

---

## B · Sürekli U dönüşü

| Saat | Hedefe mesafe | U dönüşü |
|------|---------------|----------|
| 19:29 | 77.5 km | **2.8 km sonra** |
| 19:38 | 71.1 km | **9.0 km sonra** |

Hedefe mesafe **azalıyor** (doğru yöne gidiliyor) ama motor ısrarla U dönüşü
istiyor ve U dönüşü noktası **uzaklaşıyor**.

**Hipotez (kanıtlanmadı):** araç yönü/heading güvenilir gelmiyor (bkz. C —
hız beslemesi 0), rota motoru aracın ters yöne baktığını varsayıp her
yeniden hesapta U dönüşü ekliyor. **Doğrulanması gerekir.**

Ayrıca `nav_crash_state` kalıcı kayıtta duruyor:
`{"destination":{"name":"Tarsus"},"stepIndex":1,"wasActive":true}` — önceki
oturumda navigasyon çökmüş.

---

## C · Odometre / hız beslemesi

```
[ODO:Guard] Teleport rejected: 0.056 km > 0.050 km allowed (0.0 km/h, Δt 10980 ms)
[ODO:Guard] Teleport rejected: 0.086 km > 0.050 km allowed (0.0 km/h, Δt 1676 ms)
[ODO:Guard] Teleport rejected: 0.066 km > 0.058 km allowed (49.0 km/h, Δt 303 ms)
```

`OdometerGuard.ts:110` → `maxAllowedDist = (spd/3600)*(dt/1000)*2.0 + 0.05`

`spd = 0` geldiğinde izin **Δt'den bağımsız sabit 50 m**'ye düşüyor. Δt 10980 ms'de
56 m'lik **gerçek** hareket (≈18 km/h) reddediliyor. O sırada ekranda **68 km/h**
yazıyordu — yani gösterge hızı ile `_lastKnownSpeed` **AYNI DEĞİL**.

Muhtemel besleyici (kanıt): kalıcı kayıtta **10 gün eski** CAN snapshot'ı duruyor:
```
car-can-snapshot = {"ts":1784800024157,"speed":0,"rpm":-1,"engineTemp":-1,…}
```
Worker'ın füzyon önceliği CAN→OBD→GPS (`VehicleCompute.worker.ts:728`). Bayat CAN
`speed:0` füzyona sızıyorsa `_lastKnownSpeed=0` bunu açıklar. **Bu zincir
ölçülmedi — doğrulanması gerekir.**

**Bugünkü Yol Sayacı üzerindeki etki:** sayaç `odometer` farkını okuduğu için
odometre aç kaldıkça sayaç da **eksik** sayar. 19:29'da 4,9 km → 19:38'de 11,2 km
(9 dk'da 6,3 km ≈ 42 km/h ort.) — sayıyor ama reddedilen deltalar kayıp.

---

## D · Ana ekranda gömülü sahte navigasyon

`ExpeditionLayout.tsx:294` · `ProLayout.tsx:309` · `TeslaLayout.tsx:316`

```tsx
<div …>2.4 <span>km</span></div>
<div …>Sahil Yolu Cd.</div>
```

Hiçbir kaynağa bağlı değil — **sabit yazılmış**. Gerçek navigasyon
"Mersin-Antalya Yolu / 71.1 km" derken ana ekran kartı "2.4 km Sahil Yolu Cd."
gösteriyor. Vizyon anayasasının "kanıtsız bilgi üretilmez" kuralının ihlali;
lastik basıncı `2.5 bar` sabitiyle aynı sınıf (o düzeltilmişti, bu kalmış).

---

## E · Yan bulgular

| Bulgu | Ölçüm |
|-------|-------|
| `localStorage` şişkinliği | **1403 KB / 41 anahtar**; `cl_crash_log` tek başına **645 KB**, ayrıca 11 adet `crash-log-*` (~61-75 KB) |
| Geçmiş UI donması | `caros_panic_recovery = {"reason":"ui_freeze:25.1s"}` |
| Hız limiti sorgusu | `overpass-api.de … ERR_ABORTED` |
| İkinci canvas | `opacity=0`, WebGL bağlamı **yok**, z-index 5 — ölü katman |

---

---

## EK — 19:52 taze APK + taze rota sonrası (ikinci tur)

**D düzeltildi ve cihazda doğrulandı:** harita kartı artık gerçek hedefi okuyor
(`64,8 km · Tarsus`), rota yokken chip hiç çizilmiyor. `useNavSummary.ts` tek kaynak,
regresyon kasasında 6 kilit.

**B (U dönüşü) TAZE ROTAYLA GEÇTİ:** yeni rota `1.6 km sonra düz devam edin →
Silifke Caddesi → 4.2 km üzerinde 201. Bulvar`, varış 20:44, 64.8 km. Hiç U dönüşü
yok. Eski oturumdaki ısrarlı U dönüşü **bozuk başlangıç durumundan** üretilmişti
(muhtemelen `nav_crash_state` üzerinden geri yüklenen yarım rota).

**A (harita) DEVAM EDİYOR — ama tablo değişti.** Taze süreçte MapLibre kendini
sağlıklı bildiriyor:

| Ölçüm | 19:29 (eski süreç) | 19:55 (taze süreç) |
|---|---|---|
| `map.loaded()` | false | **true** |
| `isStyleLoaded()` | false | **true** |
| `areTilesLoaded()` | false | **true** |

Buna rağmen ekran hâlâ boş. Canvas kimliği:

```
CANVAS.maplibregl-canvas  opacity=1  ebeveynOpacity=1
  < DIV.maplibregl-canvas-container < DIV.maplibregl-map
  < DIV.fixed.inset-0.glass-card            ← cam kart (backdrop-filter)
```

Görünen "ana ekran sızması" büyük olasılıkla `glass-card`'ın **backdrop-filter**'ı:
MapLibre canvas'ı hiçbir şey boyamadığı için altındaki bulanık ana ekran görünüyor.
Yani **kaynak/stil sağlıklı, boyama olmuyor.**

İkinci canvas (`opacity=0`, `pointer-events-none`, z-index 5, WebGL bağlamı YOK)
zararsız dekoratif katman — suçlu değil.

**Önde gelen şüpheli (ölçülmedi):** çoklu WebGL bağlamı. `MiniMapWidget` de bir
MapLibre örneği açıyor; `MapCore._freeContext` (WEBGL_lose_context) tam ekrana
geçişte mini haritanın bağlamını serbest bırakmazsa Mali'de ikinci bağlam ölü
gelebilir. Hafıza notu *k24-perf-rootcause* ("çoklu WebGL thrash") bu deseni
zaten kaydetmiş. **Doğrulanması gerekir — kör yama YASAK.**

---

## ⛔ DÜZELTME — "harita çizilmiyor" TEŞHİSİ YANLIŞTI (20:04)

**Yöntem hatası:** yukarıdaki A maddesinin tamamı **CDP ekran görüntüsüne**
dayanıyordu. Android WebView'da `Page.captureScreenshot` **WebGL katmanını
birleştirmez** → harita boş görünür. `adb exec-out screencap` ile alınan
GERÇEK cihaz framebuffer'ı haritayı yollar, sokak etiketleri ve mavi rota
çizgisiyle birlikte **eksiksiz** gösterdi.

`readPixels` ölçümü de bunu zaten söylüyordu ve doğru okunmadı:

```
render anında merkez : 26,115,232,255   → mavi rota çizgisi
render anında köşeler: 180,180,176,255  → OSM karo dokusu
```

**DERS (bağlayıcı):** CarOS'ta harita/WebGL görsel doğrulaması **YALNIZ**
`adb exec-out screencap` ile yapılır. CDP ekran görüntüsü DOM/HTML katmanı için
geçerlidir, WebGL için **KANIT DEĞİLDİR**.

Bu hata sırasında A'nın altındaki ölçümler yine de gerçekti ve iki gerçek
kusur ortaya çıkardı (aşağıda düzeltildi).

---

## ✅ 20:30 — BULUNAN VE DÜZELTİLEN GERÇEK HARİTA HATALARI

### M1 · Gece harita paleti fiilen GÜNDÜZ parlaklığındaydı

Aynı konumda, aynı dakikada, gerçek cihaz framebuffer'ıyla A/B:

| `raster-brightness-max` | Sonuç |
|---|---|
| **0.50** (eski gece ön ayarı) | Beyaz yollar, bej binalar, marka logoları okunur — **gündüz görünümü** |
| 0.08 | Doğru ama fazla sönük |
| **0.16** + contrast 0.30 + sat −0.70 | Yollar seçilir, sokak adları okunur, mavi rota belirgin ✅ |

Ekran pikseli 180/255 ölçüldü — ön ayarın ima ettiği ≤127 değil. Gece
sürüşünde ekranın en parlak bloğu haritaydı (MBUX/iDrive ergonomisine aykırı).
**Düzeltildi:** `RASTER_PAINT_NIGHT` → contrast 0.30 / brightness-max 0.16 /
saturation −0.70.

### M2 · Gece paleti ÜÇ yerde kopyalanmıştı ve sürüklenmişti

| Yer | Değerler |
|---|---|
| `mapStyleBuilders.RASTER_PAINT_NIGHT` | contrast .52 / bMax .50 |
| `_mapState.getOnlineTileStyle` | contrast .52 / bMax .50 |
| `_mapState` sabit stil (`osm-tiles`) | **contrast .42 / bMax .62** ← sürüklenmiş |

Üçünün de yorumunda "RASTER_PAINT_NIGHT ile birebir aynı" yazıyordu; değildi.
Hangi stilin yüklendiğine göre gece haritası farklı görünüyordu.
**Düzeltildi:** `_mapState` artık sabitleri **import ediyor**, kopya kalmadı.

### M3 · Olmayan katmanlara yapılan çağrılar hata defterini dolduruyordu

Düşük-GPU modunda (`perf-low`, cihazda aktif) `car-route-shadow` ·
`car-route-glow-sel` · `car-route-flow` **bilerek oluşturulmuyor**. Ama
`moveLayer` / `setPaintProperty` koşulsuz çağrılıyordu.

**Kritik ayrıntı:** MapLibre bu durumda **throw ETMEZ**, `error` olayı yayınlar
→ çağrıları saran `try { } catch { }` blokları **hiçbir şey yakalamıyordu**.
Cihazdaki `cl_crash_log`'ta son 50 harita hatasının **50'si** bu gürültüydü:

| Hata | Adet |
|---|---|
| `Cannot style non-existing layer "car-route-glow-sel"` | 12 |
| `'car-route-shadow' … cannot be moved` | 8 |
| `'car-route-glow-sel' … cannot be moved` | 8 |
| `'car-route-flow' … cannot be moved` | 8 |
| `car-route-alt-badge-labels … requires a style "glyphs" property` | 7 |
| `'car-route-alt-badge-labels' … cannot be moved` | 7 |

Gerçek bir harita arızası bu gürültünün altında görünmez olurdu.
**Düzeltildi:** yeni `_safeLayerOps.ts` (`safeMoveLayer` · `safeSetPaint` ·
`safeSetLayout`) — katman yoksa sessizce atlanır; ham `map.moveLayer(` çağrısı
kalmadı.

### M4 · `glyphs` bildirilmeden `text-field` katmanı ekleniyordu

`glyphs` YALNIZ vektör stilinde bildirilmiş; cihaz **raster** stilde çalışıyor.
`car-route-alt-badge-labels` (alternatif rota süre rozeti) `text-field`
kullandığı için doğrulamadan geçemiyor → katman hiç eklenmiyor → sonraki
`moveLayer` çağrıları hata yayınlıyor (yukarıdaki 14 kayıt).
**Düzeltildi:** rozet katmanı yalnız `getStyle().glyphs` varsa eklenir.
**AÇIK BORÇ:** raster stile **ticari kullanıma uygun** bir `glyphs` kaynağı
tanımlanana kadar süre rozeti raster modda görünmez. Mevcut vektör stili
`demotiles.maplibre.org` kullanıyor — bu bir **demo** servistir, ticari
dağıtım için uygun değildir; ayrı bir karar gerektirir (CLAUDE.md lisans kuralı).

### Regresyon kilitleri (5 yeni)
`regression.guards.test.ts`: ham `moveLayer` yasağı · `ROUTE_GLOW_SEL`/
`ROUTE_SHADOW` korumasız boyama yasağı · `glyphs` kontrolü · `_mapState`
kopya yasağı · gece `brightness-max ≤ 0.25` eşiği.

**Doğrulama (host):** `tsc -b` temiz · lint 0 · 222/222 test yeşil.

**Doğrulama (GERÇEK CİHAZ, 20:33–20:37, `adb screencap`):**

| Ölçüt | Sonuç |
|---|---|
| Gece paleti canlı değerler | `contrast 0.30 · brightness-max 0.16 · saturation −0.70` ✅ |
| Harita görünümü (20:35) | **Koyu**, sokak adları okunur, panelle uyumlu ✅ |
| Karşılaştırma (20:33, palet uygulanmadan önce) | Parlak — fark gözle net ✅ |
| Rota katmanları | `car-route-alt-fill · car-route-casing · selected-route-layer · user-glow · user-ring · user-vehicle` kurulu ✅ |
| shadow / glow-sel / flow | Yok (düşük-GPU'da beklenen) ✅ |
| **Kurulumdan sonra harita hatası** | **0** (öncesi: son 50 kaydın 50'si) ✅ |
| Rota özeti chip | `50,8 km · Tarsus` — gerçek mesafe ✅ |

Not: kurulumun hemen ardından (20:33) alınan görüntüde harita hâlâ parlaktı —
`applyMapDayNight` boot'ta henüz çalışmamıştı. **Gece paleti boot'tan ~1 dk
sonra devreye giriyor**; bu ayrı bir gecikme borcudur (aşağıya eklendi).

---

## SONRAKİ ADIMLAR (öncelik sırası)

1. **A-kök:** `user-location` setData sıklığını ölç ve throttle'la; `isStyleLoaded()`
   kapılarının stil hiç yüklenmediğinde ne yaptığını doğrula. **Önce ölç, sonra yaz.**
2. **Stile `glyphs` ekle** (veya `text-field` kullanan katmanları kaldır) — 50/50
   harita hatasının kaynağı. `car-launcher-glyphs-v1` cache'inin neden boş olduğunu bul.
3. **C-kök:** bayat CAN snapshot'ının hız füzyonuna sızıp sızmadığını ölç;
   sızıyorsa yaş kapısı uygula. `OdometerGuard`'ın `spd=0` iken Δt'yi yok sayması
   ayrıca gözden geçirilmeli.
4. **D:** 3 temadaki sabit `2.4 km / Sahil Yolu Cd.` gerçek navigasyon durumuna
   bağlanmalı, yoksa kaldırılmalı — sahte veri gösterilmemeli.
5. **E:** `cl_crash_log` için üst sınır + rotasyon; `crash-log-*` anahtarlarını buda.

**Hiçbir düzeltme bu oturumda yazılmadı** — kullanıcı sürüş hâlindeydi, yalnız ölçüm alındı.
