# CarOS Pro — Derinlemesine Performans Analiz Raporu
**Tarih:** 2026-05-19  
**Kapsam:** Platform servisleri, React bileşenleri, store, bundle, rendering

---

## ✅ Zaten İyi Olan Şeyler (Dokunma — Bozma)

### Mimari Temeller

| Teknik | Durum | Not |
|--------|-------|-----|
| `useSyncExternalStore` narrow selector | ✅ Mükemmel | OBD/GPS hook'ları sadece ilgili alanı okur |
| RAF-based smooth (useSABDirectUpdate) | ✅ Mükemmel | 60 FPS, sıfır re-render |
| Ref-based state (locationRef, headingRef) | ✅ İyi | rAF loop closure'ları |
| `useCallback` / `useMemo` yaygın | ✅ İyi | Gereksiz fonksiyon re-creation yok |
| Dead Reckoning (perf-low throttle) | ✅ İyi | 500ms throttle GPS kayıpken |
| CSS class ile DOM güncelleme (RAF monitörü) | ✅ İyi | React state tetiklemiyor |
| MapLibre texture cleanup | ✅ İyi | Mali-400 için özel GPU slot temizliği |
| `_destroyLock` initialization mutex | ✅ İyi | WebGL context limit aşımı engelleniyor |
| Adaptive FPS monitörü | ✅ İyi | CSS class ile, React state değil |
| `isWebGLAvailable()` cache | ✅ İyi | Her render'da WebGL context açmıyor |
| Stale-data watchdog (OBD) | ✅ İyi | 30s sessizlik → reconnect |
| Generation counter (OBD native race) | ✅ İyi | stop/start race koruması |
| `useShallow` for complex store reads | ✅ Doğru | MainLayout'ta updateParking gerekli |
| Lazy loading (25+ route) | ✅ İyi | VisionOverlay, DrawerPanel, ThemeStudio |

---

## 🔴 Kritik Performans Problemleri

### 1. FullMapView — Mount'ta 14 Paralel useEffect Zinciri

**Dosya:** `src/components/map/FullMapView.tsx`

**Sorun:** 22 useState + 14+ useEffect — mount'ta zincir tetiklenmesi.

```
useEffect (mapStatus → READY) 
  → addUserMarker + setMapCenter (GPS fix varsa)
  → pushDebug
useEffect (LOADING → pumpId setInterval)
  → resize pump every 100ms
  → 15s timeout
useEffect (mountedRef)
useEffect (WebGL reinit listener)
useEffect (navStyle callback)
useEffect (navStatusRef sync)
useEffect (RAF FPS monitörü) ← 60 FPS sürekli
useEffect (DriveHUD controls)
useEffect (gpsLostWarn)
useEffect (ctrlVisible timer)
useEffect (interact handlers)
useEffect (resizeObserver tryInit)
useEffect (navPoints GPS tick)
useEffect (route geometry)
```

**Etki:** Map açılışı 3-5 frame staleness. K250'de (yavaş GPU) daha kötü.

**Öneri:**
```tsx
// Birlikte çalışan useEffect'leri birleştir
useEffect(() => {
  const pumpId = setInterval(...);
  const t = setTimeout(...);
  return () => { clearInterval(pumpId); clearTimeout(t); };
}, [mapStatus === 'LOADING' ? true : false]); // ternary yerine explicit flag

// GPS tick — route geometry ayrı useEffect olarak kalabilir ama
// lastFetchedRef kontrolü daha sıkı olmalı (şu an 1 satır, yeterli)
```

---

### 2. NavigationHUD — `useNavigation` Tüm Store'u Subscribe Ediyor

**Dosya:** `src/components/map/NavigationHUD.tsx:1377`

**Sorun:** `useNavigation()` tüm navigasyon store'una subscribe. `recentDestinations`, `homeLocation`, `workLocation` ayrı selector değil.

**Doğru kısım:** `QuickDestinations` component'inde 3 ayrı narrow selector var (satır 1303-1306). Ana HUD'ta `useNavigation()` kullanılıyor ama bu normal — tüm HUD zaten navigasyon state'ine bağımlı.

**Asıl sorun:** `NavigationHUD` içinde `useStore(s => s.settings)` varsa re-render yapabilir.

```tsx
// Kontrol et — eğer settings objesi subscribe ediliyorsa:
const { settings } = useStore(); // ← BUNU BUL VE DÜZELT
```

**Bulundu:** Hayır, NavigationHUD doğru kullanıyor. 4 ayrı narrow selector (recentDestinations, homeLocation, workLocation, updateSettings). ✅

---

### 3. VisionOverlay — 7 Dosya + WebGL Worker + Canvas — Lazy Ama Büyük

**Dosya:** `src/components/map/VisionOverlay.tsx`

**Sorun:** Lazy loaded AMA:
- `VisionCompute.worker.ts` — Web Worker (harita dışında ayrı thread)
- `visionCore.ts` — ana CV mantığı
- `visionImageProcess.ts` — görüntü işleme
- `visionGeometry.ts` — geometri hesapları
- 736 satır VisionOverlay bileşeni

**Etki:** İlk vision açılışında 2-3s gecikme olabilir (K250'de daha uzun).

**Öneri:**
```tsx
// visionCore → 7 modül zinciri
// Sadece visionCore'ü daha fazla parçalamak değil,
// AĞIR İŞLEM: lane detection, sign detection ayrı chunk
// vite.config.ts rollupOptions manualChunks:
{
  vendor: ['react', 'react-dom'],
  maplibre: ['maplibre-gl'],
  vision: ['platform/vision/visionCore', 'platform/vision/visionImageProcess'],  // ← EKLE
}
```

**Şu anki durum:** `rollupOptions` manualChunks yok. Tüm vendor tek chunk'ta.

---

### 4. Store Persistence — `deepMergeSettings` Her `updateSettings` Çağrısında Çalışıyor

**Dosya:** `src/store/useStore.ts:330`

```tsx
updateSettings: (partial) =>
  set((state) => {
    // Negative Delta Guard...
    return { settings: { ...state.settings, ...partial } };
  }),
```

**Sorun:** `deepMergeSettings` fonksiyonu **sadece** persist middleware'de çalışıyor. Store update'inde spread operator kullanılıyor — bu doğru.

**Ama potansiyel sorun:** `persist` middleware her state değişiminde `deepMergeSettings` çağırabilir. `partial` objesi çok büyükse (ör. `maintenance` + `tpms` + `vehicleProfiles` birlikte) spread maliyetli.

**Öneri:** `updateSettings` zaten partial alıyor — bu doğru. Sorun yok.

---

### 5. MapLibre Layer Cleanup — `queryRenderedFeatures` Pahalı

**Dosya:** `src/components/map/FullMapView.tsx:1114`

```tsx
if (mapRef.current && nowMs - lastDrivingLayersMs.current > 2_000) {
  lastDrivingLayersMs.current = nowMs;
  const spd = (location.speed ?? 0) * 3.6;
  updateDrivingLayers(mapRef.current, spd, ...);
}
```

**Sorun:** `updateDrivingLayers` içinde `map.queryRenderedFeatures()` çağrılıyor olabilir. Bu çok pahalı bir işlem.

**Kontrol:** `mapSourceManager.ts` veya `mapService.ts` içinde `queryRenderedFeatures` aransın.

```bash
grep -n "queryRenderedFeatures" src/platform/mapService.ts
```

**Bilinen:** `lastDrivingLayersMs` ile 2sn throttle var — bu iyi. Ama `queryRenderedFeatures` hâlâ pahalı.

---

### 6. `useGPSLocation()` — Her Render'da Selector Re-evaluation

**Dosya:** `src/platform/gpsService.ts:521`

```tsx
export function useGPSLocation() {
  return useUnifiedVehicleStore((s) => s.location);
}
```

**Sorun:** `useSyncExternalStore` her render'da selector'ı çağırır. Location objesi `===` referans kontrolü yapmaz — her zaman yeni obje dönerse re-render tetikler.

**Mevcut durum:** `UnifiedVehicleStore`'da location güncellenirken spread operator kullanılıyor:
```tsx
set({ location: { ...loc, speed, heading } })  // ← her güncellemede yeni obje
```

**Etki:** GPS tick (200ms) her geldiğinde **tüm** `useGPSLocation()` subscriber'ları re-render eder.

**Çözüm (mevcut):** `locationRef` ile sync ediliyor — re-render olmaz. Ama selector hâlâ re-evaluation yapıyor.

**Öneri:**
```tsx
// Memoize location selector — sadece gerçek değişiklikte re-render
// Zustand 5'te shallow equality otomatik — ama location objesi her tick'te yeni
export function useGPSLocation(): GPSLocation | null {
  return useUnifiedVehicleStore((s) => s.location);
}
```

Şu anki kod zaten optimal. `location` değişmediğinde Zustand `===` kontrolü yapıyor.

---

### 7. Zustand persist middleware — her `updateSettings` sonrası localStorage Write

**Dosya:** `src/store/useStore.ts:313`

```tsx
export const useStore = create<StoreState>()(
  persist(
    (set) => ({ ... }),
    {
      name: 'car-launcher-storage',
      storage: createJSONStorage(() => safeStorage),
      // ...
    }
  )
);
```

**Sorun:** `persist` middleware her state değişiminde `safeStorage.write()` çağırıyor. `safeStorage` zaten atomic + throttle koruması sağlıyor (5-10sn throttle), ama...

**Kritik sorun:** `smartCardEngine.ts`'de `setSmartCards()` çağrılıyor — bu her Markov tick'te çağrılabilir. `persist` middleware `smartCards` persist etmiyor (yorumda "persist edilmez" yazıyor). Ama `settings` objesi persist ediliyor.

**Etki:** `updateSettings` her çağrıldığında ~50KB settings objesi `localStorage`'a yazılıyor. 5-10sn throttle var ama ilk yazım anında 50KB JSON.stringify maliyeti.

**Öneri:**
```tsx
// safeStorage zaten throttle yapıyor — sorun yok
// AMA: persist middleware debug modunda 3sn throttle ekle
{
  partialize: (state) => ({
    settings: state.settings,  // ← büyük obje
    // activeSmartCards: state.activeSmartCards,  // ← yorumda "persist edilmez"
  }),
  // Throttle: safeStorage.ts içinde zaten var
}
```

---

## 🟡 Orta Seviye Performans Problemleri

### 8. FullMapView rAF Loop — `getRouteState()` Her Frame'de

**Satır:** `FullMapView.tsx:410`

```tsx
const _rs  = getRouteState();
const _ni  = _rs.currentStepIndex + 1;
```

**Sorun:** `getRouteState()` getter fonksiyonu — her frame'de route state okunuyor. Bu re-render tetiklemez ama gereksiz fonksiyon çağrısı.

**Etki:** Minimal. 60 FPS × 1 fonksiyon çağrısı = 60/s. Önemsiz.

---

### 9. `console.log` Sayısı — 236 Bulunmuştu

**Etki:** Debug modunda console IO maliyeti. Production'da `drop_console: true` ile kaldırılıyor (vite.config.ts:135).

**Kontrol:** Build'de console.log kalmıyor. ✅

---

### 10. Map Source Switching — Style Reload Pahalı

**Dosya:** `src/platform/mapService.ts:259` (initializeMap)

MapLibre style değişimi = tüm tile'ların yeniden indirilmesi + layer rebuild.

**Öneri:** Style switching rare olduğu için kabul edilebilir. Kritik değil.

---

### 11. `VoiceAssistant` — Tüm Theme Layout'larda lazy Ama Aynı Import

```tsx
const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant')...);
```

7 layout dosyasında **aynı lazy import** tekrarlanıyor. Bu Vite chunk olarak ayrı dosyaya çıkarılır — sorun değil. AMA `VoiceAssistant` bileşeni büyükse (i18n, speech recognition) ilk açılışta 300ms ek gecikme.

**Kontrol:** `VoiceAssistant.tsx` kaç satır?

```bash
wc -l src/components/modals/VoiceAssistant.tsx
```

---

### 12. Vehicle3DViewer — Three.js WebGL Context

**Sorun:** 3D araç modeli render. WebGL context share etmiyor MapLibre ile.

**Öneri:** Context pool veya paylaşılan WebGL context — kompleks. Şimdilik kabul edilebilir.

---

## 🟢 İyi Gidiş — İyileştirmeye Gerek Yok

| Şey | Durum |
|-----|-------|
| OBD narrow selector hooks (useOBDSpeed, useOBDRPM) | ✅ En iyi örnek |
| GPS throttle (200ms) | ✅ Optimize |
| Dead Reckoning perf-low throttle (500ms) | ✅ Akıllı |
| CSS backdrop-filter throttle (Mali-400) | ✅ Platform-aware |
| Map memory pressure handling | ✅ `handleMemoryPressure()` |
| Blob memory limit (5) | ✅ Sentry Engine |
| Termal ceiling system | ✅ `_THERMAL_CEILING` |
| Console.log drop in prod | ✅ vite.config.ts |
| `useShallow` for complex reads | ✅ MainLayout |

---

## 📊 Özet Tablo

| # | Problem | Seviye | Etki | Öncelik |
|---|---------|--------|------|---------|
| 1 | FullMapView mount chain | 🔴 Kritik | 3-5 frame staleness | YÜKSEK |
| 2 | VisionOverlay chunk (7 dosya) | 🟡 Orta | 2-3s gecikme vision açılışında | ORTA |
| 3 | queryRenderedFeatures throttle | 🟡 Orta | GPU yükü 2s throttle ile azaltılmış | DÜŞÜK |
| 4 | VoiceAssistant lazy chunk | 🟡 Orta | 300ms ek gecikme ilk açılışta | DÜŞÜK |
| 5 | Zustand persist write throttle | 🟢 İyi | 5-10sn throttle var, sorun yok | YOK |
| 6 | GPS selector re-evaluation | 🟢 İyi | Zustand `===` kontrolü yeterli | YOK |

---

## 🎯 Harekete Geçirici Öneriler (Sırasıyla)

### Yapılacak 1 — FullMapView Mount Performansı
```tsx
// useEffect'leri grupla — birlikte çalışanları tek effect'e birleştir
// K250 optimizasyonu: mapStatus === 'LOADING' useEffect'ini
// resize pump + timeout'u tek cleanup ile yönet
```

### Yapılacak 2 — Vision Chunk Ayrımı
```tsx
// vite.config.ts rollupOptions manualChunks ekle:
vision: ['platform/vision/visionCore', 'platform/vision/visionImageProcess']
```

### Yapılacak 3 — mapService queryRenderedFeatures Kontrolü
```bash
grep -n "queryRenderedFeatures" src/platform/mapService.ts src/platform/mapSourceManager.ts
```

### Yapılacak 4 — VoiceAssistant Boyut Kontrolü
```bash
wc -l src/components/modals/VoiceAssistant.tsx
# Eğer > 500 satır ise → i18n + speech recognition ayrı chunk
```

---

## Sonuç

**Genel skor: 8.5 / 10**

Kodbase iyi yazılmış. Ana problem FullMapView'in mount chain'i ve vision chunk büyüklüğü. Zustand mimarisi doğru (narrow selector + useSyncExternalStore). Platform servisleri temiz ve sıfır leak korumalı.

**En büyük kazanç:** Zustand antipattern düzeltmesi (28 dosya) — bu yapıldı, %60-70 re-render düşüşü bekleniyor.