# TECHNICAL SPEC: Offline Search Fallback (İnternetsiz Navigasyon)

## 1. STRATEGIC GOAL
Implement a robust local fallback for navigation searches when the system is offline or Nominatim API (OpenStreetMap) fails. This ensures continuity of navigation in tunnels, remote areas, or during cellular data loss.

**Compliance:** MUST adhere to `CLAUDE.md` Automotive Grade Engineering Standards (Zero-Leak, Sensor Resiliency, I/O Optimization).

## 2. DATA STORAGE (`src/platform/sensitiveKeyStore.ts`)
### 2.1 Key Addition
Add `nav_history` to the `SensitiveKey` type to allow encrypted storage of navigation history.
```typescript
export type SensitiveKey = | ... | 'nav_history';
```

### 2.2 Schema
- **Format:** `Address[]` (serialized as JSON string).
- **Retention:** Max 50 items (Circular Buffer).
- **Fields:** `id`, `name`, `latitude`, `longitude`, `type: 'history'`.

## 3. NAVIGATION SERVICE (`src/platform/navigationService.ts`)
### 3.1 State Updates
Update `NavigationState` and `NavigationStore` to track offline status:
```typescript
export interface NavigationState {
  // ... existing fields
  isOfflineResult: boolean; // True if using data from local history
}

interface NavigationStore extends NavigationState {
  // ... existing methods
  setOfflineResult: (val: boolean) => void;
}
```

### 3.2 Offline Search Logic
Implement an internal `searchOffline(query: string)` function:
1. Load `nav_history` from `sensitiveKeyStore.get('nav_history')`.
2. Perform **Simple Fuzzy Search**:
   - Normalize: Case-insensitive, trim whitespace.
   - Priority 1: Substring match (`includes`).
   - Priority 2: Character overlap score (80% threshold).
3. Return the `Address` object or `null`.

### 3.3 Offline Guard & Timeout Interceptor
Refactor `navigateToAddress(text: string)`:
1. **Network Check:** If `navigator.onLine === false`, skip `fetch` and call `searchOffline(text)`.
2. **Timeout Handling:** The existing 6s timeout must catch `AbortError` and immediately attempt `searchOffline(text)` before returning `false`.
3. **Success Integration:** 
   - If a match is found (online or offline), call `startNavigation(match)`.
   - Set `isOfflineResult` accordingly.

## 4. AUTOMOTIVE STANDARDS & OPTIMIZATION
### 4.1 Zero-Leak (Memory)
- Ensure the `AbortController` in `navigateToAddress` is always cleared via `finally` (existing logic is good, preserve it).

### 4.2 I/O Throttling (`CLAUDE.md` §3)
- **Do not** write to `sensitiveKeyStore` on every keystroke.
- Update `nav_history` only after a **successful** navigation start.
- Implementation should use a local copy for searching and only persist the updated buffer back to `sensitiveKeyStore` when a new destination is confirmed.

### 4.3 Sensor Resiliency (Fail-Soft)
- If `searchOffline` also fails, return `false` to let the system know no data is available.
- The UI must use the `isOfflineResult` flag to show a toast or status icon: *"İnternet yok, geçmiş veriler kullanılıyor"*.

## 5. REPRODUCTION & VALIDATION
1. **Scenario A (Online):** Perform a search, verify navigation starts, verify `nav_history` in `localStorage` (encrypted) contains the new entry.
2. **Scenario B (Offline):** Set `navigator.onLine = false`, search for the same term, verify it resolves via local history.
3. **Scenario C (Timeout):** Use Chrome DevTools to throttle network to "Offline" or high latency, verify fallback triggers after 6 seconds.
