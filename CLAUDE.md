# CockpitOS — CLAUDE.md

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
