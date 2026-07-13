/**
 * vehicleStatusModel — OEM durum çubuğu göstergeleri için SAF türetme katmanı.
 *
 * ANAYASA: "yeni paralel state üretme". Bu modül HİÇBİR yeni state/polling/health-ping
 * üretmez — yalnız MEVCUT kaynaklardan (deviceApi, obdService, gpsService, aiHealth ve
 * BYOK yapılandırma metadata'sı) gelen sınırlı (bounded) metadata'yı OEM gösterge
 * durumlarına eşler. Bounded metadata'yı bileşen türetir; bu saf katman anahtar deposuna
 * ASLA dokunmaz (import/okuma yok) — yalnız boolean/enum/sayı alır.
 *
 * Tümü PURE fonksiyon → tam unit-test edilebilir; React/DOM/zaman-yan-etkisi YOK
 * (`now` her zaman DIŞARIDAN parametre — clock-jump ve test determinizmi için).
 *
 * GİZLİLİK: Bu katmana koordinat, SSID, cihaz adı, VIN, gizli anahtar değeri veya
 * herhangi bir hassas değer GİRMEZ — yalnız boolean/enum/sayı bounded metadata.
 */

/* ── Freshness bütçeleri (ms) ─────────────────────────────────────────────── */

/** OBD gerçek paket tazelik bandı — 0–3s healthy. */
export const OBD_FRESH_MS = 3_000;
/** OBD 3–10s → stale; >10s → disconnected. */
export const OBD_STALE_MS = 10_000;
/** GPS fix tazelik bandı. */
export const GPS_STALE_MS = 30_000;
/** GPS doğruluk eşiği (m) — üzeri "zayıf fix". */
export const GPS_WEAK_ACCURACY_M = 50;

/* ── Durum enum'ları ──────────────────────────────────────────────────────── */

export type WifiStatus = 'online' | 'no_internet' | 'offline';
export type BtStatus   = 'disabled' | 'idle' | 'scanning' | 'connected' | 'error';
export type ObdStatus  = 'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'stale' | 'error';
export type GpsStatus  = 'disabled' | 'searching' | 'fixed' | 'weak' | 'stale' | 'error';
export type AiStatus   = 'hidden' | 'checking' | 'healthy' | 'fallback' | 'error';

/** OEM ton — küçük nokta/halka rengi. Büyük renkli rozet YOK. */
export type StatusTone = 'ok' | 'warn' | 'error' | 'muted' | 'active';

/* ── Wi-Fi ────────────────────────────────────────────────────────────────── */

/**
 * @param wifiConnected deviceApi.wifiConnected (native yoklama)
 * @param online        navigator.onLine (internet erişilebilirliği — yeni ping YOK)
 */
export function deriveWifiStatus(wifiConnected: boolean, online: boolean): WifiStatus {
  if (!wifiConnected && !online) return 'offline';
  if (wifiConnected && !online)  return 'no_internet';
  if (!wifiConnected && online)  return 'online'; // hücresel/başka ağ üzerinden çevrimiçi
  return 'online';
}

/* ── Bluetooth ────────────────────────────────────────────────────────────── */

export function deriveBtStatus(i: {
  enabled: boolean; connected: boolean; scanning?: boolean; error?: boolean;
}): BtStatus {
  if (i.error)      return 'error';
  if (!i.enabled)   return 'disabled';
  if (i.connected)  return 'connected';
  if (i.scanning)   return 'scanning';
  return 'idle';
}

/* ── OBD (freshness çekirdeği) ────────────────────────────────────────────── */

/**
 * OBD göstergesi — "connected" YALNIZ şu üçü birlikteyken:
 *   transport gerçekten connected + source === 'real' + son paket freshness içinde.
 * Mock/fallback ('mock'/'none') veri ASLA bağlı sayılmaz.
 *
 * @param connectionState obdService connectionState
 * @param source          'real' | 'mock' | 'none'
 * @param lastSeenMs      son GERÇEK paket (Date.now); 0 = hiç
 * @param now             Date.now() — dışarıdan (test/clock-jump güvenli)
 * @param available       OBD platformda uygulanabilir mi (native). false → 'unavailable'
 */
export function deriveObdStatus(i: {
  connectionState: string; source: string; lastSeenMs: number; now: number; available: boolean;
}): ObdStatus {
  if (!i.available) return 'unavailable';
  if (i.connectionState === 'error') return 'error';
  if (i.connectionState === 'connecting'
   || i.connectionState === 'initializing'
   || i.connectionState === 'scanning'
   || i.connectionState === 'reconnecting') return 'connecting';

  // 'connected' state — ama SAHTE bağlı gösterme: yalnız real + fresh sayılır.
  if (i.connectionState === 'connected') {
    if (i.source !== 'real') return 'disconnected';   // mock/none → bağlı DEĞİL
    if (i.lastSeenMs <= 0)   return 'connecting';      // state connected ama paket yok
    const age = i.now - i.lastSeenMs;
    if (age < 0)             return 'connected';       // saat atlaması → son bilineni koru
    if (age <= OBD_FRESH_MS) return 'connected';
    if (age <= OBD_STALE_MS) return 'stale';
    return 'disconnected';                              // >10s sessizlik
  }
  // idle vb.
  return 'disconnected';
}

/* ── GPS ──────────────────────────────────────────────────────────────────── */

export function deriveGpsStatus(i: {
  unavailable: boolean; isTracking: boolean; hasLocation: boolean;
  accuracy: number; error: boolean; fixTimestamp: number; now: number;
}): GpsStatus {
  if (i.unavailable) return 'disabled';
  if (i.error)       return 'error';
  if (!i.hasLocation) return i.isTracking ? 'searching' : 'disabled';
  const age = i.now - i.fixTimestamp;
  if (age > GPS_STALE_MS) return 'stale';
  if (!Number.isFinite(i.accuracy) || i.accuracy > GPS_WEAK_ACCURACY_M) return 'weak';
  return 'fixed';
}

/* ── AI (görünürlük + sağlık) ─────────────────────────────────────────────── */

/**
 * AI göstergesi — SIKI görünürlük kuralı:
 *   - Yapılandırılmış sağlayıcı yoksa VEYA AI kapalıysa → 'hidden' (HİÇ render edilmez).
 *   - Yalnız anahtar varlığı "hazır" sayılmaz: readyProviderCount gerçek health/circuit
 *     sonucundan gelir (bu modül anahtar DEĞERİNİ görmez — yalnız sayı/boolean).
 *
 * @param configured        en az bir sağlayıcı anahtarı var mı (bool; değer DEĞİL)
 * @param enabled           kullanıcı AI özelliğini açık mı bıraktı
 * @param checked           health/config kontrolü tamamlandı mı (async has + circuit)
 * @param providerCount     yapılandırılmış sağlayıcı sayısı
 * @param readyProviderCount gerçek health ile hazır sağlayıcı sayısı
 * @param primaryReady      ana sağlayıcı hazır mı (fallback ayrımı)
 */
export function deriveAiStatus(i: {
  configured: boolean; enabled: boolean; checked: boolean;
  providerCount: number; readyProviderCount: number; primaryReady: boolean;
}): AiStatus {
  if (!i.configured || !i.enabled) return 'hidden';
  if (!i.checked)                  return 'checking';
  if (i.readyProviderCount <= 0)   return 'error';
  if (!i.primaryReady && i.readyProviderCount > 0) return 'fallback';
  return 'healthy';
}

/* ── Ton + animasyon eşlemesi (OEM) ───────────────────────────────────────── */

/** Bir gösterge durumunun OEM tonu (küçük nokta rengi) + animasyon gerekip gerekmediği. */
export function statusTone(status: WifiStatus | BtStatus | ObdStatus | GpsStatus | AiStatus): StatusTone {
  switch (status) {
    case 'online': case 'connected': case 'fixed': case 'healthy':
      return 'ok';
    case 'no_internet': case 'stale': case 'weak': case 'fallback':
      return 'warn';
    case 'error':
      return 'error';
    case 'connecting': case 'scanning': case 'searching': case 'checking':
      return 'active';
    case 'offline': case 'disabled': case 'idle': case 'disconnected':
    case 'unavailable': case 'hidden':
    default:
      return 'muted';
  }
}

/** Yalnız connecting/scanning/checking/searching durumlarında hafif animasyon. */
export function statusAnimates(status: WifiStatus | BtStatus | ObdStatus | GpsStatus | AiStatus): boolean {
  return statusTone(status) === 'active';
}
