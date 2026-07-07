/**
 * obdDiagEmitter — Remote Log v1 / Commit 3: OBD/CAN tanı event üreticisi
 *
 * obdService'in bağlantı hata noktalarından çağrılır; payload'ı kurar ve
 * remoteLogService.reportObdDiag()'a iletir (oradan sanitize → pushVehicleEvent
 * → push_vehicle_event RPC → vehicle_events 'obd_diag').
 *
 * ── Fırtına koruması (yerel katman) ─────────────────────────────────
 *  Aynı phase+errorCode çifti SUPPRESS_WINDOW_MS içinde yalnız 1 kez
 *  gider — reconnect döngüsü her turda aynı hatayı üretse bile uzağa
 *  spam gitmez. remoteLogService'in saatlik critical_error token bucket'ı
 *  obd_diag'ı kapsamaz; bu pencere onun yerel muadilidir. Sunucu tarafı
 *  60sn/30 event rate limit (migration 020) son güvenlik ağıdır.
 *  Zaman: performance.now (monotonic — saat atlaması güvenli).
 *
 * ── Gizlilik ────────────────────────────────────────────────────────
 *  Bluetooth MAC, cihaz adı, VIN, plaka, konum ASLA payload'a konmaz —
 *  msg alanları statik metindir; alan seti remoteLogService allowlist'i
 *  ile birebir sınırlıdır. Sanitizer (deny-list + regex maskeleri)
 *  ikinci katman olarak yine de uygulanır.
 */

import { reportObdDiag } from './remoteLogService';

/** OBD bağlantı yaşam döngüsündeki tanı fazları */
export type ObdDiagPhase =
  | 'scan'        // BT tarama — eşleşmiş adaptör bulunamadı
  | 'connect'     // RFCOMM/GATT bağlantısı — her iki transport başarısız
  | 'handshake'   // ELM327 VIN/PID el sıkışması başarısız
  | 'data_gate'   // bağlandı ama PID akışı başlamadı (stale bağlantı)
  | 'stale_data'  // akış vardı, kesildi (RFCOMM sessiz drop)
  | 'reconnect';  // üstel yeniden bağlanma turu tükendi

export interface ObdDiagDetail {
  transport?:   string | null;
  protocol?:    string | null;
  /** PII-güvenli soket/bağlantı hata KATEGORİSİ (classifyObdErrorReason çıktısı). Ham mesaj DEĞİL. */
  reason?:      string;
  attempts?:    number;
  elapsedMs?:   number;
  source?:      string;
  vehicleType?: string;
  lastSeenMs?:  number;
  /** Statik, kişisel-veri-içermeyen kısa açıklama */
  msg?:         string;
}

/** Aynı phase+errorCode çiftinin tekrar gönderim penceresi */
export const SUPPRESS_WINDOW_MS = 60_000;

/** Suppression haritası tavanı — sınırsız büyüme yok (zero-leak) */
const MAP_MAX = 64;

const _lastEmit = new Map<string, number>();

/** Transport/Bağlantı Sağlığı tanı bölümü — son kopma nedeni (Date.now, fmtAge uyumlu). */
let _lastReason: { phase: ObdDiagPhase; errorCode: string; atMs: number } | null = null;

/**
 * Native/JS bağlantı hatasını PII-GÜVENLİ bir kategoriye sınıflandırır.
 * Ham mesaj cihaz adı/MAC içerebildiğinden ASLA yayılmaz — yalnız sabit etiket döner.
 * Kategoriler "tekel mi, kontak mı, gerçek bug mı" ayrımını doğrudan verir:
 *   resource_busy       → adaptör başka app tarafından tutuluyor (Car Scanner vb.)
 *   no_vehicle_response → ELM327 bağlandı ama araç ECU'su yanıt vermedi (kontak/uyku)
 *   connection_refused / socket_closed / broken_pipe / read_failed → transport düştü
 *   permission_denied   → BLUETOOTH_CONNECT izni yok
 *   timeout             → bağlantı zaman aşımı
 *   bt_disabled / device_not_found → adaptör erişilemez
 */
export function classifyObdErrorReason(err: unknown): string {
  const m = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (!m) return 'unknown';
  if (/resource busy|device or resource busy|ebusy|busy/.test(m))                          return 'resource_busy';
  if (/connection refused|econnrefused/.test(m))                                           return 'connection_refused';
  if (/broken pipe|epipe/.test(m))                                                         return 'broken_pipe';
  if (/socket might be closed|socket closed|bt socket closed|already closed|read ret|read return|closed or timeout/.test(m)) return 'socket_closed';
  if (/read failed/.test(m))                                                               return 'read_failed';
  if (/permission|eacces|izin yok|not allowed/.test(m))                                    return 'permission_denied';
  if (/unable to connect|no data|araç yanıt|ecu|vin\/pid|protokol uyuş/.test(m))           return 'no_vehicle_response';
  if (/timeout|timed out|zaman aşımı/.test(m))                                             return 'timeout';
  if (/bluetooth (kapalı|disabled)|bt_disabled|adapter.*(off|kapalı)/.test(m))             return 'bt_disabled';
  if (/not found|bulunamadı|no such device|does not exist/.test(m))                        return 'device_not_found';
  return 'other'; // ham mesaj ASLA payload'a girmez (PII güvenliği)
}

/**
 * OBD tanı eventi üretir (fire-and-forget).
 * Dönüş: true = reportObdDiag'a iletildi; false = pencere içinde bastırıldı.
 * Asla throw etmez — bağlantı hata yollarından çağrılmaya güvenlidir.
 */
export function emitObdDiag(
  phase: ObdDiagPhase,
  errorCode: string,
  detail: ObdDiagDetail = {},
): boolean {
  try {
    // Bastırılsa bile (fırtına penceresi) "son kopma nedeni" gerçek zamanlıdır —
    // Transport tanı bölümü bu yüzden suppress kontrolünden ÖNCE kaydeder.
    _lastReason = { phase, errorCode, atMs: Date.now() };

    const key = `${phase}:${errorCode}`;
    const now = performance.now();
    const prev = _lastEmit.get(key);
    if (prev !== undefined && now - prev < SUPPRESS_WINDOW_MS) return false;

    if (_lastEmit.size >= MAP_MAX) _lastEmit.clear(); // tavan koruması
    _lastEmit.set(key, now);

    const _baseMsg = detail.msg ?? `${phase} hatası`;
    void reportObdDiag({
      ctx:         'OBD',
      phase,
      errorCode,
      // reason (PII-güvenli kategori) mevcut rapor görünümünde msg'e eklenir → tek bakışta neden.
      msg:         detail.reason ? `${_baseMsg} · ${detail.reason}` : _baseMsg,
      reason:      detail.reason      ?? undefined,
      transport:   detail.transport   ?? undefined,
      protocol:    detail.protocol    ?? undefined,
      attempts:    detail.attempts,
      elapsedMs:   detail.elapsedMs !== undefined ? Math.round(detail.elapsedMs) : undefined,
      source:      detail.source,
      vehicleType: detail.vehicleType,
      lastSeenMs:  detail.lastSeenMs,
    });
    return true;
  } catch {
    return false; // tanı hattı bağlantı akışını asla düşürmez
  }
}

/**
 * Transport/Bağlantı Sağlığı tanı bölümü — en son OBD bağlantı-kopma/hata
 * nedenini döner (kısa etiket: phase+errorCode). PII yok — statik kod adları.
 */
export function getLastObdDiagReason(): { phase: ObdDiagPhase; errorCode: string; atMs: number } | null {
  return _lastReason;
}

/** Vitest: suppression penceresini sıfırlar. */
export function _resetObdDiagEmitterForTest(): void {
  _lastEmit.clear();
  _lastReason = null;
}
