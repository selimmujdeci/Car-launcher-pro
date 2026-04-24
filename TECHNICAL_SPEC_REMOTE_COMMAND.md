# Technical Specification: Remote Command Service (Vehicle Side)

**Status:** Draft | **Version:** 1.0.0
**Target Implementation:** Claude (via `CLAUDE.md` guidelines)
**Reference Standards:** Automotive Grade Engineering (Memory, Performance, Data Integrity)

## 1. Executive Summary
This document specifies the implementation of a background listener service for the 'Caros Pro' application. The service will subscribe to real-time command events via Supabase, parse incoming JSON into actionable `AppIntent` objects, execute them via the existing `commandExecutor`, and report the execution status back to the cloud.

## 2. Strategic Goal
Enable remote vehicle control (e.g., door locks, climate, navigation pre-load, diagnostics) with < 200ms latency from cloud-to-car, ensuring zero memory leaks and robust error handling.

---

## 3. Technical Requirements

### 3.1. Identity & Authentication (Ref: `vehicleIdentityService.ts`)
The service MUST use the existing vehicle identity to filter incoming commands.
- **Vehicle ID:** Retrieve via `getVehicleIdentity()`.
- **API Key:** Retrieve via `sensitiveKeyStore.get('veh_api_key')`. This key is used for authenticated feedback RPCs.
- **Supabase Client:** Initialize a `SupabaseClient` instance in `src/platform/supabaseClient.ts` using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### 3.2. Realtime Command Listener
Listen for `INSERT` events on the `vehicle_commands` table.
- **Table:** `public.vehicle_commands`
- **Filter:** `vehicle_id=eq.{vehicleId}`
- **Payload Structure:**
  ```json
  {
    "id": "uuid",
    "intent": "OPEN_NAVIGATION",
    "payload": { "destination": "Home", "targetApp": "maps" },
    "created_at": "timestamp"
  }
  ```

### 3.3. Intent Mapping & Execution (Ref: `intentEngine.ts` & `commandExecutor.ts`)
1.  **Mapping:** Convert the raw DB payload to `AppIntent` using `fromAIResponse(rawJson, sourceText)`.
    - `rawJson`: The combination of `intent` and `payload` from the DB.
    - `sourceText`: Use "Remote Command" or the `intent` string.
2.  **Execution:** Call `executeIntent(intent, context)`.
3.  **Context Injection:** The service must be provided with a valid `CommandContext` (typically from `MainLayout` or a global state provider) containing `launch`, `openDrawer`, `setTheme`, etc.

### 3.4. Feedback Loop (Status Update)
After execution (Success or Failure), the service MUST update the `vehicle_commands` table status.
- **RPC Recommended:** Implement `update_remote_command_status` in `vehicleIdentityService.ts` to follow the existing `push_vehicle_event` pattern.
- **Payload:** `{ p_api_key: string, p_command_id: string, p_status: 'executed' | 'failed', p_error?: string }`.
- **Fallback (PATCH):** If RPC is not available, use a standard Supabase PATCH request to `/rest/v1/vehicle_commands?id=eq.{id}`.

---

## 4. Implementation Details (Claude Instructions)

### Phase 1: Supabase Client Foundation
Create `src/platform/supabaseClient.ts`.
- Ensure it only initializes if `VITE_SUPABASE_URL` is present.
- Export a singleton `supabase` instance.

### Phase 2: RemoteCommandService Development
Create `src/hooks/useRemoteCommandService.ts`.
- **Init:** Fetch `vehicleId` and `apiKey` on mount.
- **Subscription:**
  ```typescript
  const channel = supabase
    .channel('remote-commands')
    .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'vehicle_commands', 
        filter: `vehicle_id=eq.${vehicleId}` 
    }, async (payload) => {
        await processIncomingCommand(payload.new);
    })
    .subscribe();
  ```
- **Execution Logic:**
  - Map `payload.new` to `AppIntent`.
  - Try `executeIntent`.
  - Update DB status to `executed`.
  - On error, update status to `failed` and log via `pushVehicleEvent`.

### Phase 3: Memory Management (Automotive Standard)
- **Cleanup:** `channel.unsubscribe()` MUST be called in the `useEffect` cleanup function.
- **Leak Prevention:** Ensure no stale closures hold references to `CommandContext` callbacks. Use a `useRef` to store the latest `ctx`.

---

## 5. Security & Stability Pillars (CLAUDE.MD Compliance)
1.  **Zero-Leak:** Subscription must be idempotent and properly disposed of.
2.  **Sensor Resiliency:** If GPS/OBD data is required by a remote command, handle "No Signal" gracefully.
3.  **Data Integrity:** Use the `created_at` timestamp to ignore commands older than 5 minutes (stale command protection).
4.  **Performance:** Command execution must be non-blocking. Do not await UI transitions before reporting success back to the cloud.

## 6. Verification Checklist
- [ ] Command sent from PWA appears in `vehicle_commands` table.
- [ ] Vehicle logs "Subscribed to Remote Commands" on launch.
- [ ] Executed command status in DB changes from `pending` to `executed`.
- [ ] App unmount successfully calls `unsubscribe()`.
