# CockpitOS — CLAUDE.md

## 🌐 DİL KURALI (ZORUNLU)

**Tüm yanıtlar Türkçe olacak.** Kod dışındaki her şey — açıklamalar, sorular, öneriler, hata mesajları, yorumlar — Türkçe yazılacak. İstisna yok.

## Project Overview

An Android in-car infotainment OS built with React + TypeScript + Capacitor. Optimized for automotive displays with offline-first maps, GPS tracking, OBD integration, and native app launching.

**App ID:** `com.cockpitos.pro`
**Primary branch:** `master`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5 |
| Build | Vite 8 |
| Styling | Tailwind CSS 4 (utility-only, no CSS-in-JS) |
| State | Zustand 5 |
| Maps | MapLibre GL 4 (offline-first) |
| Mobile | Capacitor 8 (Android) |
| Icons | Lucide React |

---

## Directory Structure

```
src/
├── components/        # UI components organized by feature
│   ├── apps/          # App grid and launcher UI
│   ├── home/          # Home screen widgets
│   ├── layout/        # Root layout wrapper
│   ├── map/           # Map views (FullMapView, MiniMapWidget, Overlay)
│   ├── modals/        # Modal dialogs
│   └── settings/      # Settings page
├── platform/          # Native bridge and platform services (17 files)
│   ├── bridge.ts      # Platform abstraction (demoBridge / nativeBridge)
│   ├── appLauncher.ts
│   ├── mapService.ts
│   ├── mapSourceManager.ts
│   ├── gpsService.ts
│   ├── obdService.ts
│   ├── nativePlugin.ts
│   ├── navigationService.ts
│   ├── mediaService.ts
│   └── ...
├── store/             # Zustand stores
├── data/              # Static data (apps.ts)
├── types/             # TypeScript type definitions
├── App.tsx
└── main.tsx
android/               # Capacitor Android project
public/maps/           # Offline map tiles
dist/                  # Build output (do not edit)
```

---

## Development Commands

```bash
npm run dev           # Start local dev server (browser mode)
npm run build         # TypeScript check + Vite build
npm run lint          # ESLint check
npm run preview       # Preview production build
npm run android       # Build → sync → open in Android Studio
npm run cap:sync      # Build → sync web assets to native
npm run cap:copy      # Build → copy web assets only (no plugin sync)
```

---

## Architecture Patterns

### Bridge Pattern (platform abstraction)
All native capabilities go through `src/platform/bridge.ts`. Two implementations:
- **`demoBridge`** — web/browser mode, opens URLs
- **`nativeBridge`** — Capacitor Android mode, invokes native plugins

Never call Capacitor APIs directly in components — always go through the platform services.

### Platform Services
Each capability has a dedicated service in `src/platform/`:
- GPS → `gpsService.ts`
- OBD diagnostics → `obdService.ts`
- App launching → `appLauncher.ts`
- Maps → `mapService.ts` + `mapSourceManager.ts`
- Navigation → `navigationService.ts`
- Media/music → `mediaService.ts`
- Contacts → `addressBookService.ts`

### Offline-First Maps
- MapLibre GL renders tiles
- Service worker caches tiles for offline use (see `SERVICE_WORKER_OFFLINE.md`)
- `mapSourceManager.ts` switches between online / offline / cached sources
- Offline tiles live in `public/maps/`

### State Management
- Zustand for shared state (map sources, settings)
- Keep store slices small and feature-scoped

---

## Conventions

- **TypeScript strict mode** — no `any`, no unused variables
- **ES2023 target** — modern JS features allowed
- **Tailwind-only styling** — never write raw CSS or CSS-in-JS
- **Component organization** — group by feature, not by type
- **Car-themed dark design** — optimized for automotive displays; preserve the dark color palette
- **ErrorBoundary** wraps the component tree — don't remove it

---

## Building for Android

1. `npm run build` — builds web assets to `dist/`
2. `npx cap sync android` — syncs to Android project
3. Open `android/` in Android Studio to build APK/AAB

Capacitor config: `capacitor.config.ts`
Android WebView settings: mixed content allowed, remote debugging enabled in dev.

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/platform/bridge.ts` | Platform abstraction — start here for native features |
| `src/platform/mapSourceManager.ts` | Online/offline map source switching |
| `src/store/` | All Zustand state |
| `src/data/apps.ts` | Static app definitions shown in launcher |
| `capacitor.config.ts` | Capacitor + Android WebView configuration |
| `vite.config.ts` | Build configuration |
| `OFFLINE_TILES_SETUP.md` | How to configure offline map tiles |
| `SERVICE_WORKER_OFFLINE.md` | Service worker caching strategy |

---

## 🛡️ Automotive Grade Engineering Standards (CRITICAL)

To ensure "Caros Pro" meets industrial-grade reliability, all code modifications MUST adhere to these standards:

### 1. Zero-Leak Memory Management
- **Cleanup Responsibility:** Every `useEffect`, `setInterval`, or `eventListener` MUST have a corresponding cleanup function.
- **Reference Management:** Avoid global variable leakage; use React refs or Zustand for persistent state.
- **Resource Disposal:** Explicitly destroy MapLibre instances and WebGL contexts on unmount.

### 2. Sensor Resiliency (Self-Healing)
- **Input Sanitization:** Reject "impossible" sensor data (e.g., speed > 300km/h, RPM jumps > 5000 in 1ms).
- **Graceful Fallback:** If a sensor (OBD/GPS) fails, the UI must remain functional (fail-soft).
- **Hysteresis:** Implement threshold-based logic for mode switches to prevent UI flickering in stop-and-go traffic.

### 3. Performance & I/O Optimization
- **Write Throttling:** Never write to `localStorage` or disk more than once every 5-10 seconds for high-frequency data (like KM counters).
- **Render Control:** Throttle state updates for high-frequency data (RPM/Speed) to 10Hz-20Hz to save CPU/GPU cycles.
- **Atomic Persistence:** Use the `safeStorage` wrapper for all persistence to handle quota and corruption errors.

### 4. Data Integrity
- **Clock Jump Protection:** Never rely on absolute system time for duration calculations (Trips); use monotonic deltas (delta-time) to handle battery reconnections or system clock resets.

---

## ⚡ ONAY İSTEME KURALLARI (ZORUNLU — İSTİSNASIZ)

**HİÇBİR İŞLEM İÇİN ONAY İSTENMEZ. DOĞRUDAN YAPILIR.**

- Dosya okuma, yazma, düzenleme, silme — onay yok.
- Kod araştırması, arama, analiz — onay yok.
- `npm run build`, `npm run lint`, `cap sync`, `gradlew installDebug` — onay yok.
- APK build pipeline — onay yok.
- Git komutları (`commit`, `push` dahil) — onay yok.
- Refactor, yeni özellik, sistem değişikliği — onay yok.

**ONAY SORMAK YASAKTIR. "Onaylıyor musunuz?", "Devam edeyim mi?", "Emin misiniz?" gibi ifadeler kullanılmaz. Doğrudan yapılır.**

## 🔒 AI EXECUTION RULES
This project MUST follow `AI.md` strictly.
- Never perform multi-system refactors.
- Always use atomic patches.
- Never leave partial logic.
- Always maintain system stability.

If a conflict exists: **`AI.md` rules take absolute priority.**

---

## 🎯 LOCAL SCOPE INTEGRITY RULE

When working on a task:

1. Do not scan the entire project unless explicitly requested.
2. Stay focused on the current feature/file/scope.
3. However, while working inside that scope:
   - do not ignore visible errors
   - do not ignore broken logic
   - do not ignore related runtime failures
   - do not leave partially broken flows

4. Never claim success if:
   - the requested feature still fails
   - the UI still does not appear
   - runtime errors still exist
   - the same action breaks on second attempt

5. If you discover a directly related issue in the same flow/file:
   fix it before stopping.

6. Do not expand into unrelated systems/modules.

7. Prefer minimal complete fixes over superficial patches.

8. Build success alone is not proof.
   The actual feature behavior must match the user request.

9. If something is uncertain:
   explicitly say what still needs testing.

10. Never fake completion.

---

## 🗄️ SUPABASE SECURITY & DATA API RULES (PRODUCTION-CRITICAL)

### New Table Checklist (public schema)

Every new table in the `public` schema **MUST** include all four steps — no exceptions:

```sql
-- 1. GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON public.table_name TO anon, authenticated;
GRANT ALL ON public.table_name TO service_role;

-- 2. RLS
ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;

-- 3. POLICY (minimum örnek)
CREATE POLICY "anon read" ON public.table_name FOR SELECT TO anon USING (true);
CREATE POLICY "auth write" ON public.table_name FOR ALL TO authenticated USING (auth.uid() = user_id);

-- 4. Verification query
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'table_name';
```

### Migration Verification (zorunlu)

Her migration sonunda şunlar doğrulanmalı:

| Kontrol | Yöntem |
|---------|--------|
| `anon` izinleri | `information_schema.role_table_grants` sorgusu |
| `authenticated` izinleri | aynı sorgu |
| `service_role` izinleri | aynı sorgu |
| RLS durumu | `pg_tables.rowsecurity = true` |
| Policy varlığı | `pg_policies` tablosu |

### Supabase Data API Kuralları

- PostgREST erişimi: her endpoint için GRANT + RLS + policy üçlüsü zorunlu.
- Frontend erişimi: `anon` key ile erişilecek tablolarda `anon` GRANT eksikse **production crash** sayılır.
- Realtime: `supabase_realtime` publication'a tablo ekleniyorsa RLS politikaları realtime mesajlarına da uygulanır — policy'siz tablo ekleme yasak.

### Kesin Yasaklar

- GRANT olmadan migration göndermek yasak — **production-critical hata** sayılır.
- `public` şema tablolarının otomatik erişilebilir olduğunu varsaymak yasak.
- RLS kapalıyken `authenticated` policy yazmak anlamsızdır — önce RLS aç.
- Binary / büyük blob verisini `localStorage` veya Supabase `text` kolonuna yazmak yasak.

