import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';

export const OBD_ADDRESS_KEY = 'obd:lastAddress';
export const OBD_PROFILE_KEY = 'obd:detectedProfile';
export const OBD_TRANSPORT_KEY = 'obd:lastTransport';
export const OBD_PROTOCOL_KEY = 'obd:lastProtocol';

export type ObdTransport = 'classic' | 'ble';

/** Son bilinen BT MAC adresini localStorage'dan okur. */
export function loadObdAddress(): string | null {
  try { return localStorage.getItem(OBD_ADDRESS_KEY); } catch { return null; }
}

/** BT MAC adresini localStorage'a yazar. Kota hatalarını sessizce yok sayar. */
export function saveObdAddress(address: string): void {
  try { localStorage.setItem(OBD_ADDRESS_KEY, address); } catch { /* quota */ }
}

/** Kayıtlı BT MAC adresini siler (adaptör değişimi: stale MAC temizliği → tam scan'e düşer). */
export function clearObdAddress(): void {
  try { localStorage.removeItem(OBD_ADDRESS_KEY); } catch { /* ignore */ }
}

/** Son kullanılan taşıma katmanını localStorage'dan okur ('classic' | 'ble'). */
export function loadObdTransport(): ObdTransport | null {
  try {
    const v = localStorage.getItem(OBD_TRANSPORT_KEY);
    return v === 'classic' || v === 'ble' ? v : null;
  } catch { return null; }
}

/** Taşıma katmanını localStorage'a yazar. Kota hatalarını sessizce yok sayar. */
export function saveObdTransport(transport: ObdTransport): void {
  try { localStorage.setItem(OBD_TRANSPORT_KEY, transport); } catch { /* quota */ }
}

/** Kayıtlı taşıma katmanını siler (adaptör değişimi temizliği ile birlikte). */
export function clearObdTransport(): void {
  try { localStorage.removeItem(OBD_TRANSPORT_KEY); } catch { /* ignore */ }
}

/**
 * Patch 3: ElmInitSequencer'ın ATDPN ile okuduğu ELM327 ATSP protokol numarasını
 * (ör. '6' = ISO 15765-4 CAN 11/500) okur. Varsa sonraki bağlantı bu protokolü
 * ATSP<n> ile ZORLAR — ATSP0 otomatik arama YOK, aramasız/hızlı bağlanır.
 */
export function loadObdProtocol(): string | null {
  try { return localStorage.getItem(OBD_PROTOCOL_KEY); } catch { return null; }
}

/** Öğrenilen protokolü kalıcılaştırır. Kota hatalarını sessizce yok sayar. */
export function saveObdProtocol(protocol: string): void {
  try { localStorage.setItem(OBD_PROTOCOL_KEY, protocol); } catch { /* quota */ }
}

/** Öğrenilen protokolü siler (adaptör/araç değişimi temizliği ile birlikte kullanılabilir). */
export function clearObdProtocol(): void {
  try { localStorage.removeItem(OBD_PROTOCOL_KEY); } catch { /* ignore */ }
}

/** Kalıcı OBD profil kimliğini safeStorage'dan okur. */
export function loadObdProfileId(): string | null {
  return safeGetRaw(OBD_PROFILE_KEY) ?? null;
}

/** OBD profil kimliğini safeStorage'a yazar (4s debounce safeStorage katmanında). */
export function saveObdProfileId(id: string): void {
  safeSetRaw(OBD_PROFILE_KEY, id);
}
