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

/**
 * OBD gerçek paket tazelik bandı — bu yaşın altı "healthy".
 *
 * ⚠️ Bu bir VARSAYILANDIR: gerçek tazelik penceresi aktif poll kadansına bağlıdır
 * (PERFORMANCE 250ms … POWER_SAVE 15s). Çağıran `freshMs` geçebilir.
 */
export const OBD_FRESH_MS = 3_000;
/**
 * Bu yaşın üstü "stale" (veri akmıyor) — ama KOPUK DEĞİL.
 *
 * ⚠️ SÖZLEŞME DEĞİŞTİ: `deriveObdStatus` artık yaş ne kadar büyürse büyüsün
 * 'disconnected' DÖNMEZ. Bayat veri bir kopma değildir (adaptör takılı, hat sağlam,
 * yalnız ECU susmuş). 'disconnected' YALNIZ `transportConnected === false` ile —
 * yani DOĞRULANMIŞ link kopmasıyla — üretilir.
 */
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
  /**
   * Transport linki DOĞRULANMIŞ canlı mı (obdService.transportConnected). Verilmezse
   * `connectionState === 'connected'` varsayılır (eski çağıranlar için geriye dönük uyum).
   */
  transportConnected?: boolean;
  /**
   * Tazelik penceresi — aktif poll kadansından türetilmeli (POWER_SAVE'de 15s poll,
   * 3s'lik sabit pencere SAHTE bayatlık üretir). Verilmezse {@link OBD_FRESH_MS}.
   */
  freshMs?: number;
}): ObdStatus {
  if (!i.available) return 'unavailable';
  if (i.connectionState === 'error') return 'error';
  if (i.connectionState === 'connecting'
   || i.connectionState === 'initializing'
   || i.connectionState === 'scanning'
   || i.connectionState === 'reconnecting') return 'connecting';

  // 'connected' state — ama SAHTE bağlı gösterme: yalnız real sayılır.
  if (i.connectionState === 'connected') {
    if (i.source !== 'real') return 'disconnected';   // mock/none → bağlı DEĞİL

    // DOĞRULANMIŞ transport kopması — "OBD bağlı değil" YALNIZ burada dürüsttür.
    // (undefined → eski çağıran; connectionState'e güven.)
    if (i.transportConnected === false) return 'disconnected';

    if (i.lastSeenMs <= 0) return 'connecting';       // state connected ama hiç paket yok
    const age = i.now - i.lastSeenMs;
    if (age < 0) return 'connected';                   // saat atlaması → son bilineni koru
    const freshMs = (typeof i.freshMs === 'number' && i.freshMs > 0) ? i.freshMs : OBD_FRESH_MS;
    if (age <= freshMs) return 'connected';

    // KÖK DÜZELTME: eskiden `age > OBD_STALE_MS` → 'disconnected' idi. Bu YALANDI:
    // link canlıyken ECU'nun susması bir KOPMA DEĞİLDİR (POWER_SAVE'de poll periyodu
    // 15s → yaş 10s'i rutin olarak aşar → sağlıklı bağlantıda sahte "OBD bağlı değil").
    // Artık yaş ne olursa olsun 'stale': son değerler korunur, bağlantı düşmez.
    // Gerçek kopma YALNIZ transportConnected=false ile gelir (yukarıda).
    return 'stale';
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
