// ── Storage keys ─────────────────────────────────────────────────────────────
const STORAGE = {
  VEHICLE_ID:    'caros_pair_vehicle_id',
  API_KEY:       'caros_pair_api_key',
  VEHICLE_NAME:  'caros_pair_vehicle_name',
  VEHICLE_PLATE: 'caros_pair_vehicle_plate',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PairResult {
  success:    boolean;
  vehicleId?: string;
  message:    string;
}

export interface LocalVehicle {
  id:     string;
  name:   string;
  plate:  string;
  apiKey: string;
}

// ── Local storage helpers ─────────────────────────────────────────────────────

function storeLocalVehicle(v: LocalVehicle): void {
  try {
    localStorage.setItem(STORAGE.VEHICLE_ID,    v.id);
    localStorage.setItem(STORAGE.API_KEY,       v.apiKey);
    localStorage.setItem(STORAGE.VEHICLE_NAME,  v.name);
    localStorage.setItem(STORAGE.VEHICLE_PLATE, v.plate);
  } catch { /* quota — silently ignore */ }
}

/** Returns the locally paired vehicle, or null if none. */
export function getLocalVehicle(): LocalVehicle | null {
  try {
    const id     = localStorage.getItem(STORAGE.VEHICLE_ID);
    const apiKey = localStorage.getItem(STORAGE.API_KEY);
    if (!id || !apiKey) return null;
    return {
      id,
      apiKey,
      name:  localStorage.getItem(STORAGE.VEHICLE_NAME)  ?? 'Araç',
      plate: localStorage.getItem(STORAGE.VEHICLE_PLATE) ?? '—',
    };
  } catch { return null; }
}

/** Removes all local pairing data (unpair). */
export function clearLocalVehicle(): void {
  try {
    Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
  } catch { /* non-critical */ }
}

/**
 * Returns the stored api_key for a given vehicleId.
 * Used by commandService for E2E payload encryption.
 */
export function getStoredApiKey(vehicleId: string): string | null {
  try {
    const storedId = localStorage.getItem(STORAGE.VEHICLE_ID);
    if (storedId !== vehicleId) return null;
    return localStorage.getItem(STORAGE.API_KEY);
  } catch { return null; }
}

// ── Pairing ───────────────────────────────────────────────────────────────────

/**
 * Pairs a vehicle via PIN or QR code — no user login required.
 * Calls /api/pwa/pair which uses service-role credentials server-side.
 */
export async function pairVehicle(code: string): Promise<PairResult> {
  try {
    const res = await fetch('/api/pwa/pair', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code: code.trim().toUpperCase() }),
    });

    const data = (await res.json()) as {
      success?:   boolean;
      vehicleId?: string;
      apiKey?:    string;
      name?:      string;
      plate?:     string;
      error?:     string;
    };

    if (!res.ok || !data.success || !data.vehicleId || !data.apiKey) {
      return { success: false, message: data.error ?? 'Eşleştirme başarısız.' };
    }

    storeLocalVehicle({
      id:     data.vehicleId,
      apiKey: data.apiKey,
      name:   data.name  ?? 'Araç',
      plate:  data.plate ?? '—',
    });

    return {
      success:   true,
      vehicleId: data.vehicleId,
      message:   'Araç başarıyla eşleştirildi.',
    };
  } catch {
    return { success: false, message: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.' };
  }
}
