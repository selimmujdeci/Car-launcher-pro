# MAP_FOLLOW_FIELD_TEST — Harita Takip / Heading Saha Testi

> **Amaç:** Kod yazmadan, ham GPS + kamera loglarıyla "harita aracı takip etmiyor"
> ve "yön ters algılanıyor" bug'larının kök nedenini KANITLAMAK. Log gelmeden patch YOK.
> **Cihaz:** K24 / NWD (K2401, ceres_b3). Araç içinde, sürüş gerekli.
> Hazırlık tarihi: 2026-06-25.

---

## 0. Problem Özeti

Gerçek araç testi:
- Araç hareket ediyor.
- Harita **bazen sabit kalıyor**, aracı takip etmiyor.
- Bazen **yön ters algılanıyor**: araç ileri giderken harita/ikon geri gidiyor gibi.
- K24 head unit üzerinde test edildi.

İki ayrı belirti = muhtemelen iki ayrı kök neden (sabit harita ≠ ters yön).

---

## 1. Veri Akışı (özet)

```
Geolocation.watchPosition (head unit GPS)
  → gpsService.handlePosition()                                gpsService.ts:393
     throttle 200ms (termal L2'de 500ms)                       gpsService.ts:396,83
     gpsCourse = coords.heading (durağanda null)               gpsService.ts:435
     effectiveCourse = gpsCourse ?? computeCourseDelta(...)    gpsService.ts:440 ★
     heading = _blendHeading(effectiveCourse, speed)           gpsService.ts:442
       (head unit pusulasız → compass null → tek kaynak course)
     setState{location, heading, source}                       gpsService.ts:482
  → UnifiedVehicleStore
     ├─ MiniMapWidget (ANA EKRAN)                              MiniMapWidget.tsx:287
     │    speedKmh = location.speed*3.6 (HAM GPS hızı) ★        MiniMapWidget.tsx:293
     │    isDriving = speedKmh > 5 ★                            MiniMapWidget.tsx:297
     │      park dalı: recenter SADECE moved>25m && dist>222m ★ MiniMapWidget.tsx:325,333
     └─ FullMapView (tam ekran)                                FullMapView.tsx:581
          isFollowingRef / userInteractingRef
          nav watchdog 8s SADECE ACTIVE/REROUTING ★            FullMapView.tsx:665-671
  → updateUserMarker: icon-rotate=['get','heading'] map-align  MapLayerManager.ts:299
     setDrivingView: map bearing = heading                     MapInteractionManager.ts:185
```

> Marker `icon-rotation-alignment:'map'` + sürüş görünümünde harita bearing=heading →
> **çift-rotasyon YOK, yön mantığı doğru.** Terslik heading kaynağında, marker'da değil.

---

## 2. Kök Neden Adayları

### A) Düşük hızda course-over-ground `null` kalıyor → heading DONUYOR  *(ters yön — birincil)*
- `computeCourseDelta` yalnız iki ardışık fix arası yer değişimi ≥ `COURSE_DELTA_MIN_M`
  (4m) ise yön döner (speedCore.ts:82).
- `_prevForSpeed` HER kabul edilen fix'te güncellenir (gpsService.ts:428) → yer değişimi
  **birikmez**. 1Hz fix'te 4m ≈ 14 km/h, 2Hz'de ≈ 29 km/h altıdır → şehir/yavaş sürüşte
  yön her tick null → heading son değerde takılı → dönüş sonrası eski yönü gösterir
  ("ileri giderken geri gidiyor gibi").

### B) MiniMap `isDriving` HAM GPS hızına bağlı, fused speed kullanılmıyor  *(sabit harita — birincil)*
- `isDriving = location.speed*3.6 > 5` (MiniMapWidget.tsx:293,297). Head unit GPS modülü
  çoğu kez Doppler hız vermez → `location.speed` null/0 → `isDriving=false` → park dalı.
- Park dalı yalnız konum >25m (`movedDeg>0.00025`) VE merkeze uzaklık >~222m
  (`dist>0.002`) iken yeniden ortalar (MiniMapWidget.tsx:325,333) → harita ~200m'de bir
  zıplar, arada donuk.
- Füzyon hızı (`useFusedSpeed`, CAN/OBD/GPS) sadece kadran için kullanılıyor (satır 341),
  takip kararında DEĞİL.

### C) Park dalı bearing'siz recenter / heading null ise 0=kuzey  *(ters algıyı pekiştirir)*
- Park dalında `setMapCenter(...,animated=true)` = `flyTo` bearing'siz (kuzey-yukarı
  kalır) + marker `hdg=heading||0` (heading null → 0=kuzey). Araç güneye giderken ikon
  kuzeyi gösterir → ters algı. (MiniMapWidget.tsx:296,334)

### D) FullMapView nav-dışı follow kilidi  *(sabit harita — tam ekran)*
- Kazara dokunuş `userInteracting=true` / `isFollowing=false` bırakırsa, otomatik
  toparlama watchdog'u SADECE nav ACTIVE/REROUTING'te var (FullMapView.tsx:665-671).
  Casual sürüşte (nav yok) follow kapalı kalır → manuel recenter'a kadar takip yok.

### F) Dead Reckoning ELENDİ  *(neden DEĞİL)*
- Yerel DR projeksiyonu NO-OP'a alınmış (`_startDeadReckoning` boş, gpsService.ts:714-719)
  → `isDeadReckoningActive()` daima false → DR eski yönle ters hareket ÜRETMİYOR.
  "DR GPS'i bastırıyor mu?" → **hayır, kesin eleme.**

---

## 3. Saha Test Senaryosu

Bağlan (HANDOFF yolu): `adb connect <K24_IP>:5555`.
JS/console logları için CDP daha iyi (HANDOFF §DevTools): `webContentsDebuggingEnabled`
geçici aç → console akışı (şu an prod'da kapalı).

Senaryo — her fazda log kaydet:

1. **10s duruş (statik teyit):** `coords.heading` ve `coords.speed` **null mı** geliyor?
2. **30s düz sürüş (~30-40 km/h):** heading değişiyor mu, harita pürüzsüz takip mi / zıplıyor mu, `isDriving` true mu?
3. **Yavaş sürüş (~10-15 km/h, trafik):** A en belirgin — heading donar, `distM<4` tekrarı.
4. **Sağ/sol dönüş:** dönüş SONRASI heading güncelleniyor mu yoksa eski yönde mi kalıyor?
5. **Tekrar düz sürüş:** toparlıyor mu yoksa manuel recenter mı gerekiyor (D)?

---

## 4. Toplanacak Loglar

| Katman | Alanlar | Nerede |
|--------|---------|--------|
| **GPS fix** | `lat, lon, accuracy, speed(ham), heading(ham), timestamp` — özellikle heading/speed **null mı** | gpsService.ts:435-442 |
| **Store** | `lat, lon, speed, heading, source` (her emit) | gpsService.ts:482 |
| **MiniMap** | `isDriving, branch(driving/park), movedDeg, dist(merkeze), recenter?(evet/hayır)` | MiniMapWidget.tsx:297-335 |
| **FullMapView** | `isFollowing, userInteracting, bearing, camera update(setDrivingView/setMapCenter çağrıldı mı)` | FullMapView.tsx:726-746 |
| **courseDelta** | `distM, eşik(4m), null mı döndü` | speedCore.ts:81-83 |

> Bu loglar **geçici teşhis**; kök neden onaylanınca kaldırılır (teşhis-log disiplini).

---

## 5. Karar Tablosu

| Gözlem | Sonuç |
|--------|-------|
| `coords.heading` / `coords.speed` **null** geliyor | **A ve B güçlenir** (zincir hesaplı delta'ya bağımlı) |
| `effectiveCourse` **null** tekrarlıyor (düşük hızda) | **A doğrulanır** (heading donması) |
| MiniMap `isDriving=false` ama `fusedSpeed>0` | **B doğrulanır** (takip kararı yanlış kaynakta) |
| `isFollowing=false` kalıyor (nav dışı, hareket var) | **D doğrulanır** (follow kilidi) |
| Yukarıdakilerin hiçbiri yok, harita yine sabit | Yeni hipotez (kamera throttle / style.load / GL context) — ayrı tur |

---

## 6. Minimal Patch Planı (log onayından SONRA, izole)

1. **A doğrulanırsa:** birikimli course — son geçerli course noktasından mesafe biriktir
   (≥4m'ye ulaşana kadar referansı sıfırlama). Tek dosya: `gpsService.ts` (prevPos yönetimi)
   + `speedCore.computeCourseDelta`. Kilit: `courseOverGround.test.ts`.
2. **B doğrulanırsa:** MiniMap `isDriving`'i ham `location.speed` yerine zaten import'lu
   `useFusedSpeed`'e (CAN→OBD→GPS) bağla. Tek dosya: `MiniMapWidget.tsx:293-297`. Park
   eşiklerine (25m/222m) dokunma.
3. **D doğrulanırsa:** nav-dışı için koşullu follow re-arm — uzun süre kamera güncellenmedi
   ve hareket varsa `isFollowing=true` (kullanıcı pan'i hâlâ saygı görür). FullMapView
   watchdog'unu (665-671) nav-dışına genişlet, follow'u zorla-açık ALMADAN.
4. **DR/heading rastgele KAPATILMAYACAK** (DR zaten no-op, eleme yapıldı).
5. **Safety / OBD / CAN sistemlerine DOKUNULMAYACAK** + FullMapView map mutex/route-survive
   zırhı korunur (CLAUDE.md/AI.md).

---

## 7. Raporlanacak Sonuç (bu dosyanın altına doldur)

```
TARİH:
K24 IP:

coords.heading null mı:
coords.speed null mı:
effectiveCourse null tekrarı (düşük hız):
30s düz: heading değişiyor mu / harita takip / isDriving:
yavaş sürüş: distM<4 tekrarı / heading donuk mu:
dönüş sonrası heading güncelliyor mu:
isFollowing false kalıyor mu (nav dışı):

KARAR (tablo §5):
```
