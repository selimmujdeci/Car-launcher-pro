# Technical Specification: Live Design Studio (Style Engine)

**Status:** Ready for Implementation | **Target:** Claude
**Reference:** `CLAUDE.md`, `TECHNICAL_SPEC_REMOTE_COMMAND.md`
**Goal:** Implement a real-time, low-latency style synchronization between the PWA (Web) and the Vehicle (App) using CSS Variables and Supabase.

---

## 1. Intent Engine Update (`src/platform/intentEngine.ts`)

Add the `SET_STYLE` intent to allow the system to route style change commands.

- **IntentType:** Add `'SET_STYLE'`.
- **IntentPayload:** Update to include `styles?: Record<string, string>`.
- **Validation:** Add `'SET_STYLE'` to `VALID_INTENTS`.

```typescript
// src/platform/intentEngine.ts changes
export type IntentType = ... | 'SET_STYLE';

export interface IntentPayload {
  ...
  styles?: Record<string, string>; // e.g., { "--neon-accent": "#00ff00" }
}
```

---

## 2. Style Engine Implementation (`src/platform/editStyleEngine.ts`)

Extend the existing engine to handle global CSS variable overrides. This avoids re-injecting large `<style>` blocks for every slider movement.

### Singleton Method: `applyLiveStyle`
```typescript
/**
 * Applies real-time style overrides via CSS Variables on the root element.
 * Optimized for high-frequency updates (sliders/color pickers).
 */
export function applyLiveStyle(styles: Record<string, string>): void {
  const root = document.documentElement;
  Object.entries(styles).forEach(([key, value]) => {
    // Safety check: Only allow variables starting with --
    if (key.startsWith('--')) {
      root.style.setProperty(key, value);
    }
  });
}
```

---

## 3. Command Executor Integration (`src/platform/commandExecutor.ts`)

Route the `SET_STYLE` intent to the `EditStyleEngine`.

```typescript
// Inside dispatchIntent switch case
case 'SET_STYLE': {
  const styles = intent.payload.styles;
  if (styles) {
    applyLiveStyle(styles);
  }
  break;
}
```

---

## 4. PWA Style Designer (`website/src/components/dashboard/StyleDesigner.tsx`)

A Next.js/React component for the administrative panel that sends commands to the vehicle.

### Logic Flow:
1. **State Management:** Local state for `accentColor`, `blurAmount`, `borderRadius`.
2. **Throttling:** Use `lodash.throttle` (or a simple `useRef` timer) to limit Supabase writes to **150ms**.
3. **Database Write:** Push to `vehicle_commands` table.

### Payload Structure:
```json
{
  "vehicle_id": "target-uuid",
  "intent": "SET_STYLE",
  "payload": {
    "styles": {
      "--neon-accent": "#3b82f6",
      "--card-blur": "12px",
      "--card-radius": "1rem"
    }
  },
  "status": "pending"
}
```

---

## 5. Synchronization & Live Preview

The "Live Preview" effect is achieved through the following chain:
1. **User interacts** with slider in PWA.
2. **PWA** throttles and writes `SET_STYLE` to Supabase.
3. **Vehicle App** (`useRemoteCommandService.ts`) receives `INSERT` event via Supabase Realtime.
4. **Vehicle App** maps DB record to `AppIntent`.
5. **Command Executor** calls `applyLiveStyle`.
6. **Browser/WebView** updates rendering instantly due to CSS Variable reactivity.

---

## 🛡️ Automotive Standards Compliance

1. **Performance:** `setProperty` on `documentElement` is significantly cheaper than DOM manipulation or CSS re-generation.
2. **Memory:** The remote command listener must be cleaned up (already handled in `TECHNICAL_SPEC_REMOTE_COMMAND.md`).
3. **Resiliency:** If an invalid CSS value is sent, the browser ignores it; the engine does not crash.
4. **Write Throttling:** 150ms throttling prevents DB flooding and excessive radio usage on the vehicle's LTE/5G connection.

---

## Claude Implementation Instructions

1. **Step 1:** Modify `src/platform/intentEngine.ts` to include `SET_STYLE`.
2. **Step 2:** Add `applyLiveStyle` to `src/platform/editStyleEngine.ts` and export it.
3. **Step 3:** Update `dispatchIntent` in `src/platform/commandExecutor.ts`.
4. **Step 4:** Implement `StyleDesigner.tsx` in the website directory, ensuring it imports the Supabase client and uses the 150ms throttle.
