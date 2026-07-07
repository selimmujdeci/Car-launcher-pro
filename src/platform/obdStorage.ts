import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';

export const OBD_ADDRESS_KEY = 'obd:lastAddress';
export const OBD_PROFILE_KEY = 'obd:detectedProfile';
export const OBD_TRANSPORT_KEY = 'obd:lastTransport';
// A-fix: transport'un GERÇEKTEN doğrulandığı (canlı PID verisi akan) bilgisi. Yalnız veri
// akınca '1' yazılır → boot'ta persisted+verified transport doğrudan denenir (BLE turu atlanır).
// Dual-mod adaptör TAHMİNİ (henüz veri akmamış) verified sayılmaz → yanlış yönlendirme olmaz.
export const OBD_TRANSPORT_VERIFIED_KEY = 'obd:transportVerified';
export const OBD_PROTOCOL_KEY = 'obd:lastProtocol';

export type ObdTransport = 'classic' | 'ble' | 'tcp';

/**
 * WiFi ELM327 (AP modu) adres biçimi: "ip:port" (ör. 192.168.0.10:35000).
 * Host: IPv4 dotted-quad veya hostname karakter seti. Port: 1-65535.
 */
const TCP_ADDRESS_RE = /^([a-zA-Z0-9.-]+):(\d{1,5})$/;

/** Patch 10: girilen adresin "ip:port" biçiminde ve port aralığının geçerli olup olmadığını doğrular. */
export function isValidTcpAddress(address: string): boolean {
  const m = TCP_ADDRESS_RE.exec(address.trim());
  if (!m) return false;
  const host = m[1];
  const port = Number(m[2]);
  return !!host && port >= 1 && port <= 65535;
}

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

/** Son kullanılan taşıma katmanını localStorage'dan okur ('classic' | 'ble' | 'tcp'). */
export function loadObdTransport(): ObdTransport | null {
  try {
    const v = localStorage.getItem(OBD_TRANSPORT_KEY);
    return v === 'classic' || v === 'ble' || v === 'tcp' ? v : null;
  } catch { return null; }
}

/** Taşıma katmanını localStorage'a yazar. Kota hatalarını sessizce yok sayar.
 *  YENİ transport yazımı verified'ı SIFIRLAR — bu transport henüz veri akıtmadı;
 *  gerçek PID verisi gelince saveObdTransportVerified(true) ile doğrulanır. */
export function saveObdTransport(transport: ObdTransport): void {
  try {
    localStorage.setItem(OBD_TRANSPORT_KEY, transport);
    localStorage.removeItem(OBD_TRANSPORT_VERIFIED_KEY); // yeni transport = doğrulanmamış
  } catch { /* quota */ }
}

/** A-fix: transport'un canlı-veri ile doğrulandığını persist eder. */
export function saveObdTransportVerified(verified: boolean): void {
  try {
    if (verified) localStorage.setItem(OBD_TRANSPORT_VERIFIED_KEY, '1');
    else localStorage.removeItem(OBD_TRANSPORT_VERIFIED_KEY);
  } catch { /* quota */ }
}

/** A-fix: persisted transport'un daha önce canlı-veri ile doğrulanıp doğrulanmadığı. */
export function loadObdTransportVerified(): boolean {
  try { return localStorage.getItem(OBD_TRANSPORT_VERIFIED_KEY) === '1'; } catch { return false; }
}

/** Kayıtlı taşıma katmanını siler (adaptör değişimi temizliği ile birlikte). Verified de silinir. */
export function clearObdTransport(): void {
  try {
    localStorage.removeItem(OBD_TRANSPORT_KEY);
    localStorage.removeItem(OBD_TRANSPORT_VERIFIED_KEY);
  } catch { /* ignore */ }
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
