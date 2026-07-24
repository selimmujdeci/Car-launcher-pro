/**
 * obdTrafficMask.ts — ham OBD trafiğinde hassas alan maskeleme (SAF).
 *
 * Ham hex geliştiricinin ASIL verisidir → körlemesine maskelenmez. Yalnız KİMLİK
 * taşıyan yükler gizlenir (görev §F):
 *   · Mode 09 PID 02 (VIN) istek/yanıtı → yük REDACTED
 *   · ASCII VIN (17 hane) · MAC · API key/token · e-posta · UUID
 *
 * Kaynak servisler DEĞİŞTİRİLMEZ: maskeleme yalnız görüntü katmanında uygulanır
 * (DebugPanel'in mevcut davranışı korunur; CAROS LAB maskeli gösterir).
 */

const RE_SECRET = /\b(?:sk|pk|api|key|token|bearer|apikey)[-_]?[A-Za-z0-9_-]{12,}\b/gi;
const RE_EMAIL  = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RE_MAC    = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const RE_UUID   = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
/** 17 haneli ASCII VIN (I/O/Q yok). */
const RE_VIN    = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

export const REDACTED_VIN = '[VIN redacted]';
export const REDACTED = '[redacted]';

/** Boşluk/ayraçsız büyük harfli hâl — komut/yanıt sınıflandırması için. */
function _compact(s: string): string {
  return s.replace(/[\s>\r\n]/g, '').toUpperCase();
}

/** Komut VIN sorgusu mu? (Mode 09 PID 02 — 0902, 09 02, 0902 1 …) */
export function isVinRequest(cmd: unknown): boolean {
  if (typeof cmd !== 'string') return false;
  return _compact(cmd).startsWith('0902');
}

/** Yanıt VIN taşıyor mu? (pozitif yanıt 49 02 …) */
export function isVinResponse(resp: unknown): boolean {
  if (typeof resp !== 'string') return false;
  return _compact(resp).includes('4902');
}

/** Genel hassas desenler (hex yükü korunur). */
export function maskCommonSecrets(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return input
    .replace(RE_SECRET, REDACTED)
    .replace(RE_EMAIL, REDACTED)
    .replace(RE_UUID, REDACTED)
    .replace(RE_MAC, REDACTED)
    .replace(RE_VIN, REDACTED_VIN);
}

export interface MaskedObdEntry {
  readonly cmd:    string;
  readonly resp:   string;
  /** VIN yükü gizlendi mi (UI'da rozet). */
  readonly masked: boolean;
}

/**
 * Tek trafik satırını maskeler. VIN istek/yanıtında YÜK tamamen gizlenir (yalnız
 * servis baytı görünür kalır → geliştirici akışı yine izleyebilir).
 */
export function maskObdTrafficEntry(cmd: unknown, resp: unknown): MaskedObdEntry {
  const safeCmd  = typeof cmd === 'string' ? cmd : '';
  const safeResp = typeof resp === 'string' ? resp : '';

  const vin = isVinRequest(safeCmd) || isVinResponse(safeResp);
  if (vin) {
    return { cmd: maskCommonSecrets(safeCmd), resp: REDACTED_VIN, masked: true };
  }
  return { cmd: maskCommonSecrets(safeCmd), resp: maskCommonSecrets(safeResp), masked: false };
}
