# Performans Audit — Baseline & Ölçüm Planı

> CarOS Pro performans korumalarının **kalıcı referansı**: mevcut savunma katmanları,
> risk matrisi, araçsız (deterministik) test planı, K24 manuel ölçüm planı ve kabul
> kriterleri. Amaç — bu korumaların gerçekten devrede kaldığını ve gelecekte
> bozulmadığını **ölçmek ve regresyondan korumak**.
>
> Bu doküman koddur değil referanstır. Production'a/bundle'a etkisi yoktur.
> İlgili: `docs/SOAK_MANUAL_K24_CHECKLIST.md` (uzun-süre), `docs/TEST_MATRIX.md`,
> `CLAUDE.md §⚡ V8/JIT` + `§🛡️ Automotive` standartları.

---

## 0. Ölçüm Katmanları (NET AYRIM)

| Katman | Ne ölçer | Araç | Determinizm |
|--------|----------|------|-------------|
| **Sanal (vitest)** | Mantık/sözleşme: notify disiplini, RAF throttle, mod→config bütçesi | fake timer + fake RAF (T4 `soakHarness`) | ✅ deterministik |
| **E2E (Playwright)** | Gerçek render/FPS, gerçek chromium paint | `npm run test:e2e` | ~ (gerçek tarayıcı) |
| **K24 manuel** | Gerçek Mali-400 GPU paint, WebGL context, RAM/PSS, iframe decode | DevInspector + `diag-restart.ps1` | ❌ yalnız saha |

> **Kısıt (T7 dersi):** jsdom + `react-dom/client` navigator-override yüzünden kırılgan
> → **tam component render-count testi sanal katmanda yapılmaz**. Render storm'u
> **kök-nedeninden** (store notify disiplini + RAF throttle + selector kararlılığı)
> deterministik proxy'lerle ölçeriz. Gerçek render/FPS → E2E + K24.

---

## 1. Mevcut Performans Korumaları (kod tabanından doğrulandı)

| Koruma | Mekanizma | Dosya (referans) |
|--------|-----------|------------------|
| **Gauge hot-path** | RAF lerp; **20Hz cap** (`FRAME_BUDGET_MS=50`); `setDisplay` RAF tick'inde → React render'dan ayrık; tek RAF reuse; hedefe `<0.5` snap+dur; **lite-mod bypass**; unmount'ta `cancelAnimationFrame` | `src/platform/rafSmoother.ts` (`useRafSmoothed`, satır 32/68/83/102) |
| **Adaptive runtime / FPS budget** | Mod başına dondurulmuş config: `uiFpsTarget` **60/30/20/15**, `obdPollingMs` 1k–10k, `gpsUpdateMs` 500–8k, `enableBlur`, `enableAnimations`, `suspendWorkers` | `src/core/runtime/runtimeConfig.ts` |
| **Mod geçiş yönetimi** | Histerezis (downgrade anlık / upgrade 30s) + thermal ceiling + zombie restart | `src/core/runtime/AdaptiveRuntimeManager.ts` |
| **OBD notify throttle** | `_notify` → `getConfig().obdListenerDebounce` ile mod-bağımlı debounce; `source==='real'` → CAN snapshot 4s debounce | `src/platform/obdService.ts:170` |
| **Theme-switching guard** | `applyTheme` swap sırasında `theme-switching` class ekler → transition'ları kapatır → **2× `requestAnimationFrame` sonra kaldırır** (binlerce elemanda "transition fırtınası" engeli) | `src/store/useCarTheme.ts:82` |
| **Media blur gating** | `blurOff = !getRuntimeConfig(mode).enableBlur \|\| isLowEndDevice()`; `--rt-blur` CSS var; ambient `blur(64px)` + `blur(20px)` yalnız `playing && !blurOff` | `src/components/media/MediaScreen.tsx:600,608,639,678` |
| **Map WebGL ownership** | Singleton harita; MiniMap↔FullMap **devir protokolü** (`destroyOwnedMap`, ownership takeover, re-init guard, zombie recovery); `MiniMapWidget` `memo`'lu | `src/components/map/MiniMapWidget.tsx`, `FullMapView.tsx`, `src/platform/mapService.ts` |
| **safeStorage write throttle** | 5s debounce (normal) / 1s safety / immediate; idle-callback Stage 2; eMMC sayacı | `src/utils/safeStorage.ts` (T4 `soak.safeStorage` kapsadı) |
| **Worker yaşam döngüsü** | `suspendWorkers` (SAFE_MODE); zombie ping (10s, 3-miss); memory-pressure terminate (OPTIONAL kapanır, CRITICAL korunur) | `AdaptiveRuntimeManager.ts` (T4 `soak.runtime` kapsadı) |
| **Ölçüm yüzeyi (DevInspector)** | **FPS** (`useFpsCounter` RAF, 1s pencere) · **RAM** (`usedJSHeapSize`, 2Hz poll) · **Mode/Tier/Blur/WebGL/GPU renderer** · worker listesi · `VITE_ENABLE_INSPECTOR` ile satış-build'inde DCE | `src/components/debug/devInspector/InspectorPanel.tsx`, `useFpsCounter.ts` |

> **Sonuç:** Çekirdek koruma katmanı olgun. Eksik olan **regresyon/ölçüm testi** —
> bu korumaların devrede kaldığını doğrulayan deterministik testler (§3).

---

## 2. Risk Matrisi

| # | Alan | Riskli dosya | Risk | Mevcut koruma | Test durumu |
|---|------|--------------|------|---------------|-------------|
| R1 | **Zustand notify / render storm** | `src/store/useStore.ts` + tüketiciler | Geniş persist store + kötü selector → gereksiz re-render fırtınası | Zustand selector + `Object.is` | ❌ notify disiplini testsiz |
| R2 | **Gauge hot-path** | `rafSmoother.ts` + Speedo/RPM/Fuel gauge'ları | 3Hz sensör → ekran sıçraması; cap regresyonu | RAF 20Hz cap + render decouple | ❌ throttle regresyon testi yok |
| R3 | **Map MiniMap/FullMap** | `FullMapView.tsx`, `MiniMapWidget.tsx`, `mapService.ts` | WebGL context devir maliyeti; **çift-init / context leak** | Singleton ownership + destroy | ❌ geçiş testi yok |
| R4 | **Media blur / iframe** | `MediaScreen.tsx` | `blur(64px)` ambient + `blur(20px)` + **YouTube iframe** decode — Mali-400'de en pahalı ekran | `blurOff` gating | ⚠️ kısmi (`computeMediaBlurOff` T7) |
| R5 | **Theme switching** | `useCarTheme.ts`, `themeTransitionService.ts`, `themeLayoutEngine.ts` | Global DOM mutasyonu; guard timing | `theme-switching` guard | ❌ guard timing testsiz |
| R6 | **Worker / main-thread denge** | `AdaptiveRuntimeManager.ts` + VehicleCompute/VisionCompute | Main-thread vs worker yük dengesi; mode-gated polling | `suspendWorkers` + mod config | ⚠️ kısmi (T4 zombie/thermal) |
| R7 | **Inspector overhead** | `InspectorPanel.tsx`, `useFpsCounter.ts` | Ölçüm aracının kendi maliyeti (2Hz poll + FPS RAF) | tab-gated FPS RAF | ❌ math/overhead testsiz |

---

## 3. Araçsız Test Planı (deterministik — vitest, T4 altyapısı üstünde)

> RAF testleri için fake `requestAnimationFrame` — T4 `soakHarness`'in `toFake`
> listesinde `requestAnimationFrame` zaten var → `vi.advanceTimersByTime` RAF'ı sürer.
> Render storm **proxy** olarak `leakHarness.subscribeProbe` (notify sayacı) kullanılır.

| # | Risk | Test | Doğrulanan invariant | Reuse |
|---|------|------|----------------------|-------|
| A | R1 | **Store notify discipline** | N update → **≤N notify**; settled (aynı değer) → **0 notify**; selector çıktısı `Object.is`-kararlı | `subscribeProbe` (T3) |
| B | R2 | **rafSmoother throttle** | `setDisplay` çağrıları **≤20Hz** (FRAME_BUDGET); hedefe snap+dur; RAF **tek**; unmount → cancel; lite-mod bypass | fake RAF + `soakHarness` |
| C | R1 | **Cross render-storm budget** | OBD 3Hz + RAF 20Hz akışında belirli sürede **toplam notify/tick bounded** (storm yok) | `soakHarness` + `obdSimulator` (T1) |
| D | R5 | **Theme switch storm guard** | `applyTheme` → `theme-switching` **eklenir → 2 RAF sonra kaldırılır**; ardışık swap tek guard; CSS var atomik | fake RAF + jsdom `document` |
| E | R3 | **Map geçiş singleton** | MiniMap↔FullMap → **tek WebGL instance**; handoff'ta `destroy` çağrılır; **çift-init engellenir**; zombie recovery tek sefer | maplibre mock (T1 tarzı) |
| F | R4 | **Media blur gating** | `blurOff` matrisi tüm modlarda doğru; `--rt-blur` tutarlı; iframe **yalnız `playing && !blurOff`** | `computeMediaBlurOff` (T7) genişlet |
| G | R6 | **Worker/main-thread budget** | Mode→config matrisi (`suspendWorkers`/`obdPollingMs`/`gpsUpdateMs`/`uiFpsTarget`); SAFE_MODE worker suspend; mod düştükçe tick bütçesi azalır | `forceMode` + `captureRuntimeChecklist` (T7) |
| H | R7 | **Inspector math** | `useFpsCounter` frame-sayım → fps doğru; 2Hz poll; ölçüm RAF unmount'ta temiz | fake RAF |

**Konum:** hepsi `src/__tests__/` altında (`perf.*.test.ts` + `sim/perfHarness.ts`).
Production/native hot-path'e dokunulmaz; bundle'a sızmaz.

---

## 4. K24 Manuel Performans Planı (sanal taklit edilemez)

**Ön koşul:** `VITE_ENABLE_INSPECTOR=true` APK (bkz. `SOAK_MANUAL_K24_CHECKLIST.md §1`).
Her ekranda DevInspector şeridinden oku: **FPS · RAM · Mode · Tier · Blur · WebGL · GPU renderer**.

| Senaryo | Aksiyon | Ölç | Kabul kriteri |
|---------|---------|-----|---------------|
| **Ana ekran (idle)** | Boot → ana ekran, dokunma | FPS, RAM, Mode | FPS ≥ mod hedefinin %80'i; RAM stabil |
| **Gauge canlı** | OBD/mock veri akarken hız/RPM | FPS, gauge akıcılığı | Gauge takılmaz; FPS hedef bandında |
| **OBD modal** | OBDConnectModal aç/tarama | FPS, RAM | Tarama UI'ı dondurmaz |
| **MediaScreen** | Müzik çal + album art ambient blur | FPS, RAM, Blur | low-end'de **Blur=0**; FPS düşmez |
| **YouTube iframe** | YT arama + parça çal | FPS, RAM | iframe decode RAM'i şişirmez; FPS kabul edilebilir |
| **MiniMap → FullMap → MiniMap** | Harita aç/kapa 10× | FPS, RAM, WebGL | Geçiş jank'ı kabul edilebilir; **WebGL context sızıntısı yok** (RAM tırmanmaz) |
| **Theme switch** | Gündüz↔gece 10× | FPS, flicker | Swap sonrası **storm/flicker yok**; FPS toparlar |
| **Termal yük** | 45°C+ ısınma | Mode, FPS | Mode otomatik düşer (BALANCED→BASIC_JS→…); UI kullanılabilir |
| **8 saat açık** | Sürekli kullanım | RAM/PSS eğrisi | PSS plato (bkz. SOAK §2); FPS dejenerasyonu yok |

> Bu plan `SOAK_MANUAL_K24_CHECKLIST.md §6 (termal/low-end)` ile birlikte kullanılır;
> orası uzun-süre, burası etkileşim-başına FPS/RAM odaklıdır.

---

## 5. Kabul Kriterleri (genel)

1. **Low-end kullanılabilirlik:** BASIC_JS / POWER_SAVE / SAFE_MODE modlarında UI
   **kullanılabilir kalır** — donma, siyah ekran, dokunma kaybı yok.
2. **FPS hedefleri mod-tutarlı:** Ölçülen FPS, modun `uiFpsTarget`'ının (`runtimeConfig.ts`)
   makul bandında (≥ %80); hedefin çok üstünde "boşa render" da yok.
3. **RAM monoton tırmanmaz:** 8–24h kullanımda PSS **plato** yapar (SOAK §2 ölçütü);
   ekran geçişlerinde kalıcı sıçrama yok.
4. **Blur low-end'de kapalı:** `enableBlur=false` modlarda veya `isLowEndDevice()`'da
   `--rt-blur=0` ve `blur(64px)` ambient **kapalı**.
5. **WebGL context leak yok:** MiniMap↔FullMap döngüsünde tek aktif WebGL instance;
   tekrarlı geçişte RAM tırmanmaz (context biriktirmez).
6. **Theme storm yok:** Tema swap sonrası `theme-switching` guard kaldırılır; flicker/
   transition fırtınası gözlemlenmez; FPS toparlar.
7. **Worker dengesi:** SAFE_MODE'da OPTIONAL worker'lar suspend; CRITICAL korunur;
   düşük modda polling/animasyon yükü azalır (main-thread rahatlar).
8. **Inspector overhead minimal:** Ölçüm aracının kendisi (FPS tab açıkken RAF + 2Hz
   poll) ölçülen değeri kayda değer biçimde bozmaz; satış build'inde DCE edilir.

---

## Ek: Test/ölçüm komutları

```powershell
# Sanal (deterministik)
npm test -- perf            # perf.*.test.ts (P1+ eklendikçe)
npm test                    # tüm suite (soak dahil)
npx tsc -b ; npm run lint

# E2E (gerçek chromium)
npm run test:e2e

# K24 manuel ölçüm
$env:VITE_ENABLE_INSPECTOR = "true"; npm run build; npx cap sync android
# DevInspector overlay → FPS/RAM/Mode/Tier/Blur/GPU
cd tools; .\diag-restart.ps1 -Minutes 480 -IntervalSec 300   # 8h PSS timeline
```

> **Refactor kuralı:** Bu serideki tüm iş **salt test + doküman**. Bir test gerçek
> regresyon bulursa (örn. bir gauge'ın rafSmoother'ı atlayıp store'a doğrudan bağlı
> olması), **düzeltmeden önce rapor edilir** — `AI.md` "bir bug = bir fix" + gereksiz
> refactor yasağı geçerli.
