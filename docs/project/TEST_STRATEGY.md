# CarOS Pro — TEST STRATEGY (test anayasası)

> **Kural:** Yeni davranış = yeni test. Bug fix = regresyon testi. CI kırmızıysa görev bitmemiştir.
> **Build/test yeşil ≠ başarı** — gerçek davranış (ve kritik özelliklerde cihaz) kanıt ister.

---

## Katmanlar

### 1. Unit (Vitest — `src/__tests__/*.test.ts`)
- OBD service state machine, sanitization
- Smart Engine (detectDrivingMode, trackLaunch, Markov)
- Safety Brain (fault tracking, feature disable)
- Store (settings merge, negative delta guard)
- Platform Core wiring'leri (ownership, fail-closed, bridge event map)

### 2. Integration (Vitest — `*.integration.test.ts`)
- OBD + GPS veri akışı
- Smart Engine + Theme koordinasyonu
- Runtime Manager hysteresis
- Zustand store persistence
- Fixture'lar: `src/__tests__/fixtures/integration.ts`, helper'lar: `src/__tests__/helpers/index.ts`

### 3. Regression — "YASA" (`src/__tests__/regression.guards.test.ts`)
- Defalarca bozulup düzelttiğimiz davranışları KİLİTLER.
- **Asla zayıflatma/silme.** Kilit bilinçli değişiyorsa yeni doğru davranışa GÜNCELLE.
- Yeni bug düzeltilince karşılık gelen kilit EKLENİR (aynı bug sessizce geri gelmesin).

### 4. E2E (Playwright — `e2e/*.spec.ts`)
| Dosya | Kapsam |
|-------|--------|
| app.spec.ts | Boot, ErrorBoundary, portrait warning |
| navigation.spec.ts | App grid, phone, maps, POI |
| obd.spec.ts | OBD mock, speedometer, RPM, fuel |
| theme.spec.ts | Theme switching, night mode |
| safety.spec.ts | Reverse overlay priority (z-index 100000), radar HUD |
| settings.spec.ts | Settings drawer, language, volume, perf |
| smart-engine.spec.ts | Driving mode detection, AI recommendations |
| error-handling.spec.ts | Error boundaries, console errors |

### 5. Performance / Mali-400
- Hot-path (3Hz hız/RPM) allocation ve deopt kontrolü.
- Render throttle 10–20Hz doğrulaması.
- Idle CPU / rAF park doğrulaması (bkz. FullMapView #61, VisionOverlay #64).
- Mali-400 blur/animasyon bütçesi (K24 checklist: `docs/PERF_K24_CHECKLIST.md`).

### 6. Device / Acceptance
- Her PR için kabul ölçütü `docs/DEVICE_VALIDATION_LEDGER.md`'ye 🔴 ile eklenir.
- Cihaz matrisi: `docs/HEAD_UNIT_MATRIX.md` (T507 Dacia, Xiaomi, K24 Hiworld).
- Detay checklist: `docs/project/DEVICE_VALIDATION.md`.

---

## Komutlar

```bash
npm run test            # Tüm testler (headless)
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage
npm run guard           # Hızlı regresyon kasası (sadece kilitler)
npm run lint            # ESLint
npm run build           # tsc check + Vite build
npm run test:e2e        # Playwright (headless)
npm run apk:safe        # test → build → sync → temiz APK (test düşerse APK YOK)
```

---

## Cihaz hedefleri

| Cihaz | Rol | Not |
|-------|-----|-----|
| **T507 Dacia** | Ana OBD hedefi | PC-adb imkansız → CAN'i SystemCanBroadcastAdapter ile oku |
| **Xiaomi** | Uzaktan debug | CDP-over-adb; background/foreground testleri |
| **K24 Hiworld** | Low-end / Mali-400 | BT OEM kilitli → 3.taraf OBD-BT imkansız; perf tavanı |

---

## Kabul kuralı (ZORUNLU)

Bir PR "tamam" sayılması için:
1. Unit + integration + regression yeşil.
2. `tsc` temiz, lint temiz, build başarılı.
3. Yeni davranışın testi + (bug ise) regresyon kilidi mevcut.
4. Ledger'a kabul ölçütüyle 🔴 kayıt.
5. Cihaz kanıtı gelene kadar 🔴 kalır — "çalışıyor" diye SUNULMAZ.
