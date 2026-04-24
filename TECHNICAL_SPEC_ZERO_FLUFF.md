# TECHNICAL SPEC: ZERO-FLUFF (Hardening Feature Set)

This specification defines the architectural and implementation details for removing "mock/makeup" features and replacing them with industrial-grade, functional implementations.

---

## 1. Remote Command ACK (Realtime Feedback)

**Goal:** Eliminate optimistic update bias. The UI must wait for the actual vehicle response before confirming success.

### Architecture
- **Table:** `vehicle_commands` (Supabase)
- **Status Flow:** `pending` (INSERT by Web) -> `executed` or `failed` (UPDATE by Vehicle via RPC)
- **Realtime Trigger:** Web subscribes to `UPDATE` events on `vehicle_commands` for the specific `id`.

### Implementation Details (`website/src/components/dashboard/RemoteCommandPanel.tsx`)
1. **Subscription Logic:**
   - After `sendCommand` returns the `command_id`.
   - Initialize a Supabase Realtime subscription filtered by `id=eq.${command_id}`.
   - Listen for `UPDATE` events.
   - Timeout: If no response in 15 seconds, set status to `timeout` (error).
2. **UI States:**
   - `pending`: Button shows 'processing' spinner (SpinIcon).
   - `executed`: Button border flashes **Neon Green** (#34d399) + Success Toast.
   - `failed`: Button border flashes **Neon Red** (#ef4444) + Error Toast with reason.
3. **Zero-Leak Guard:**
   - Use `useEffect` for the subscription.
   - Ensure `channel.unsubscribe()` is called on unmount or after command resolution.

---

## 2. Hardware Bridge (Native Integration)

**Goal:** Remove Web simulations (CSS filters) and connect directly to Android system streams.

### Changes in `src/platform/systemSettingsService.ts`
1. **Brightness:**
   - Remove `_applyBrightnessWeb` and the `document.documentElement.style.filter` logic.
   - On Web, `setBrightness` should now call `Toast.show({ text: 'Parlaklık kontrolü yalnızca cihazda kullanılabilir' })`.
   - On Native, verify `CarLauncher.checkWriteSettings()` before calling `setBrightness`. If not granted, call `requestWriteSettings()`.
2. **Volume:**
   - Remove the "silent skip" on Web.
   - On Web, show a Toast: "Sistem ses kontrolü tarayıcıda desteklenmiyor".
   - On Native, Ensure the mapping `0-100` -> `0-15` (Standard Android Stream Index) is correct.
3. **Native Plugin:**
   - `android/app/src/main/java/.../CarLauncherPlugin.java` (Reference for Claude):
     - Brightness: `Settings.System.putInt(..., Settings.System.SCREEN_BRIGHTNESS, value)`
     - Volume: `audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, value, 0)`

---

## 3. Live Fuel (Real-Time API Integration)

**Goal:** Replace static `AVG_GASOLINE_TL` with dynamic data.

### Integration Schema (`src/platform/weatherService.ts` or new `fuelService.ts`)
1. **Data Source:** Use a Supabase Edge Function to proxy/scrape fuel prices from [EPDK](https://www.epdk.gov.tr/Detay/Icerik/3-1327/akaryakit-fiyat-arsivi) or a commercial aggregator (e.g., Opet/Shell public price lists).
2. **API Endpoint:** `POST {SUPABASE_URL}/functions/v1/get-fuel-prices`
3. **Payload:** `{ lat: number, lng: number }`
4. **Fallback:** If API fails, use the last cached value from `localStorage` instead of hardcoded constants.
5. **Logic Change:**
   - Remove `_genStations` random variance logic.
   - Map real API response to `FuelStation` interface.
   - Cache results for 60 minutes.

---

## 4. UI Integrity (Zero Mock Policy)

**Goal:** Clean up the UI from placeholders and non-functional elements.

### Targets for Removal/Disabling
1. **'Coming Soon' / 'Yakında' Labels:**
   - `src/components/modals/VehicleReminderModal.tsx`: Change `soon` status to `hidden` if data is missing.
   - `src/platform/commandExecutor.ts`: Remove "yakında servise git" string, replace with actual diagnostic logic or remove the warning branch if not ready.
2. **Mock Buttons:**
   - Search and identify buttons that only call `console.log('Not implemented')` or similar.
   - Add a global `isFeatureEnabled(featureName)` check in the store.
   - If `featureName` is not enabled, the component should **not render** (preferred) or be `disabled` with an opacity of 0.4.
3. **App Grid:**
   - `src/data/apps.ts`: Remove any apps that do not have a corresponding native package name or a valid intent.
   - Use `appDiscovery.ts` to only show apps that are **actually installed** on the device.

---

## Technical Constraints (Automotive Grade)
- **No unnecessary renders:** Use `memo` for RemoteCommand buttons.
- **Error Handling:** Every API call must have a `try-catch` with `logError`.
- **Latency:** Show local feedback immediately (spinner), then resolve with network data.
