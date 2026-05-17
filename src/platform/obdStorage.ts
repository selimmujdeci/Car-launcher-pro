import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';

export const OBD_ADDRESS_KEY = 'obd:lastAddress';
export const OBD_PROFILE_KEY = 'obd:detectedProfile';

/** Son bilinen BT MAC adresini localStorage'dan okur. */
export function loadObdAddress(): string | null {
  try { return localStorage.getItem(OBD_ADDRESS_KEY); } catch { return null; }
}

/** BT MAC adresini localStorage'a yazar. Kota hatalarını sessizce yok sayar. */
export function saveObdAddress(address: string): void {
  try { localStorage.setItem(OBD_ADDRESS_KEY, address); } catch { /* quota */ }
}

/** Kalıcı OBD profil kimliğini safeStorage'dan okur. */
export function loadObdProfileId(): string | null {
  return safeGetRaw(OBD_PROFILE_KEY) ?? null;
}

/** OBD profil kimliğini safeStorage'a yazar (4s debounce safeStorage katmanında). */
export function saveObdProfileId(id: string): void {
  safeSetRaw(OBD_PROFILE_KEY, id);
}
