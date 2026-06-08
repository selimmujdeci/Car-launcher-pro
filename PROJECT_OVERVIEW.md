# CarOS Pro — Geliştirici Genel Bakış

> Aftermarket araç head unit'leri için offline-first araç-içi OS/launcher.
> Bu doküman yeni geliştiriciye mimari giriş sağlar. Detaylı denetim: `AUDIT_FINDINGS.md`,
> ürün özeti: `FEATURES.md`, kurallar: `CLAUDE.md` / `AI.md`.

## Stack
React 19 · TypeScript 5 · Vite 8 · Capacitor 8 (Android) · MapLibre GL 4 · Zustand 5 ·
Tailwind 4 · native Java/Kotlin + C++ (NDK) · Supabase (backend) · `com.cockpitos.pro`

## Mimari Katmanlar
```
UI (React/Tailwind)         components/ (142) · 13 Zustand store · temalar
   │
Platform servisleri         platform/ (~180) — bridge pattern, native soyutlama
   │
Veri hattı (yüksek frekans) sensör → adapter → VehicleCompute.worker (SAB Seqlock) → UI
   │
Native (Android)            CarLauncherPlugin · CAN (K24/Hiworld) · OBD (BLE/classic) · HAL
   │
Native-Core (C++/NDK)       Seqlock VehicleState + lock-free SPSC ring buffer
```

## Kilit Giriş Noktaları
| Dosya | Sorumluluk |
|-------|-----------|
| `src/App.tsx` | Kök bileşen, SystemBoot tetikleyici |
| `src/platform/system/SystemBoot.ts` | 4-dalgalı servis önyükleme (Core→Backbone→Intelligence→UI) |
| `src/platform/vehicleDataLayer/VehicleCompute.worker.ts` | Off-main-thread füzyon/sanity/odometer |
| `src/platform/bridge.ts` | Platform soyutlama (demo/native) — native özellikler buradan |
| `src/core/runtime/AdaptiveRuntimeManager.ts` | Cihaz-uyarlı performans/termal mod |
| `src/utils/safeStorage.ts` | Atomic persistence (eMMC koruma) |
| `src/platform/commandCrypto.ts` | E2E uzaktan komut kriptosu (ECDH+AES-GCM) |
| `android/.../CarLauncherPlugin.java` | Ana native plugin (87 metot: OBD/media/system) |
| `android/.../cpp/VehicleState.hpp` | C++ Seqlock çekirdeği |

## Çalıştırma
```bash
npm run dev          # tarayıcı (demo bridge)
npm run android      # build → cap sync → Android Studio
npm run test         # Vitest (516 test)
npm run test:e2e     # Playwright (37 test)
```

## Mimari İlkeler (CLAUDE.md / AI.md — ZORUNLU)
- **Zero-leak:** her useEffect/timer/listener cleanup'lı.
- **Sensör resiliency:** imkansız değerleri reddet, fail-soft, hysteresis.
- **Clock-jump koruması:** süre ölçümünde `performance.now()` (Date.now değil).
- **Atomic persistence:** safeStorage wrapper, throttled write.
- **V8/SAB:** hidden-class stabilitesi, monomorphic, Seqlock protokolü.
- **Atomik patch:** multi-system refactor yok; yarım mantık bırakma.

## Önemli Durum Notları (bkz. AUDIT_FINDINGS.md)
- SAB/Seqlock hattı APK'da `crossOriginIsolated=false` nedeniyle pasif (BASIC_JS fallback) — bilinçli karar.
- API anahtarları sensitiveKeyStore (Android Keystore) — `settings`'teki alanlar ölü/legacy.
- Uzaktan komut E2E enforcement sertleştirildi (C1/C2/C8 fix'li).
- Test/lint/tsc temiz; native (gradle) ve cihaz runtime ayrı doğrulama ister.

## Belge Haritası
- `FEATURES.md` — ürün/özellik dökümanı
- `AUDIT_FINDINGS.md` — güvenlik & mimari denetim (64 alan, P0 triage, handoff)
- `MARKETING_ONEPAGER.md` — pazarlama tek-sayfası
- `B2B_PITCH.md` — üreticilere lisanslama sunumu
- `CLAUDE.md` / `AI.md` — mühendislik kuralları (zorunlu)
