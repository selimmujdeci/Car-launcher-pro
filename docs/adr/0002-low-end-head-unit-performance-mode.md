# ADR 0002 — Low-End Head Unit Performans Modu (Adaptive Runtime)

## Status

Kısmen kabul edildi. **Faz 1 TAMAMLANDI** (commit `2fbbd57`). **Faz 2 (interval
gating) PENDING** — kullanıcı onayı bekliyor (`PROJECT_STATE.md`, `ROADMAP.md`).

## Context

Test head unit'i **K24 SMART SERIES + Hiworld CANBOX** (Android 15, 6GB RAM, root yok)
**Mali-400 GPU**'da 2-3 sn dokunma gecikmesi yaşıyordu. Kök neden: GPU compositor
doygunluğu (kontrol-dışı blur + her zaman canlı WebGL), ikincil olarak koşulsuz
ana-thread interval yığını. Mali-400'de hardware-accelerated blur yok → her kare
software render = GPU stall.

## Decision

Donanım sınıfına göre adaptif çalışma modu: **`AdaptiveRuntimeManager`** + kanonik
**`DeviceTier`** + CSS guard değişkenleri.

**RuntimeMode** (`src/core/runtime/runtimeTypes.ts:26-33`, `as const` — enum değil çünkü
`erasableSyntaxOnly`): `PERFORMANCE`, `BALANCED`, `BASIC_JS`, `POWER_SAVE`, `SAFE_MODE`.
(Mod adları doğrulandı; `runtimeTypes.ts` yorumlarında BASIC_JS = Mali-400/Android 7-8
giriş seviyesi, SAFE_MODE = kritik kurtarma/çok eski donanım, POWER_SAVE = düşük voltaj
akü koruma.)

**DeviceTier** (`src/platform/deviceCapabilities.ts:21`): `'low' | 'mid' | 'high'` —
"ham donanım sınıfı". Donanım bir kez problanır, kanonik tier üretilir; runtime mode
bundan beslenir.

**RuntimeConfig** alanları (`runtimeTypes.ts:61-100`): `gpsUpdateMs`, `obdPollingMs`,
`uiFpsTarget` (15|20|30|60), `enableBlur`, `enableAnimations`, `loggingLevel`,
`suspendWorkers`.

**CSS guard:** `AdaptiveRuntimeManager` `enableBlur`'a göre `--rt-blur: 0|1` yazar
(`AdaptiveRuntimeManager.ts:325`), `--rt-anim` aynı şekilde (:326), cleanup'ta kaldırır
(:649). `--rt-blur` tüketicileri: `index.css`, `theme.css` (`.up-blob` 60px),
`volume-overlays.css`, `ultra-premium-global.css` — `blur(calc(var(--rt-blur,1)*Npx))`.

### Faz 1 — TAMAMLANDI (commit 2fbbd57, salt görsel / koşullu render)
- `theme.css` `.up-blob` blur `--rt-blur` guard'ına bağlandı (`theme.css:175`).
- `MainLayout.tsx` ambient blob DOM'u `blurEnabled` koşullu render (`MainLayout.tsx:375`).
- MiniMap MapLibre WebGL anasayfa opak overlay'le kapanınca unmount: `homeFullyHidden`
  (`MainLayout.tsx:349-351, 431`).

### Faz 2 — PENDING (onay bekliyor)
Interval gating (frekanslar `PROJECT_STATE.md`'de doğrulandı): VehicleSignalResolver
20→10/5Hz, NativeHALAdapter 2→1Hz (`NativeHALAdapter.ts:43`), CognitivePriorityEngine
1→0.5Hz (`CognitivePriorityEngine.ts:46`), vehicleIntelligenceService durağanda 2→1Hz.
**`blackBoxService.ts:54` 10Hz DEĞİŞMEZ** (kaza kara kutusu, yüksek risk).

## Consequences

- (+) Faz 1: low-end'de kalıcı blur/WebGL compositor yükü kalkar; davranış aynı.
- (+) `SAFE_MODE` altında halo-pulse/heavy blur otomatik kapanır (SplitScreen,
  BootSplash, QuickControlsOverlay vb. `RuntimeMode.SAFE_MODE` aboneliği).
- (−) Faz 1'in cihaz etkisi henüz ölçülmedi (saha testi bekliyor) — Faz 2'ye
  gerçekten ihtiyaç olup olmadığı ölçümle netleşmeli (`HANDOFF.md` §4 notu).
- (!) `VehicleSignalResolver` Seqlock/SAB yapısına dokunulmaz; Faz 2'de yalnızca
  polling periyodu değişir.

## Links & affected files

- Commit: `2fbbd57` (Faz 1)
- `src/core/runtime/runtimeTypes.ts` (RuntimeMode, RuntimeConfig)
- `src/core/runtime/AdaptiveRuntimeManager.ts:325, 326, 649` (--rt-blur/--rt-anim)
- `src/core/runtime/runtimeConfig.ts` (mod başına config)
- `src/platform/deviceCapabilities.ts:21, 163` (DeviceTier, getDeviceTier)
- `src/components/layout/MainLayout.tsx:349-351, 375, 431`
- `src/styles/theme.css:175`, `src/styles/design-system.css:178`
- DOKUNMA: `src/platform/security/blackBoxService.ts:54`
