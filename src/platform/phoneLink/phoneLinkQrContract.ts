/**
 * phoneLinkQrContract.ts — PHONE LINK F1 · QR bootstrap sözleşmesi.
 *
 * QR KALICI CREDENTIAL TAŞIMAZ. Yalnız kısa ömürlü, tek kullanımlık bir guest
 * bootstrap referansı taşır (`phoneLinkGuestSession.ts`den üretilen token).
 *
 * ── `localEndpoint` (F1 → F3) ───────────────────────────────────────────────
 * F1'de bu alan KASITLI OLARAK `null`du: telefonun düz tarayıcısına ulaşacak
 * bir yerel portal taşıması repoda YOKTU, bu yüzden sahte bir URL üretilmedi.
 * F3.1 ölçümüyle taşıma seçildi (aynı-LAN yerel HTTP dinleyicisi) ve F1'in
 * kendi notunun söylediği şey aynen yapıldı: *"yalnız bu alanı dolduran ince
 * bir üretici eklenecektir; sözleşmenin GERİ KALANI DEĞİŞMEZ."*
 *
 * Endpoint hâlâ ZORUNLU DEĞİLDİR: ulaşılabilir bir yerel ağ yoksa `null` kalır
 * ve çağıran QR GÖSTERMEZ — açılamayacak bir adres ÜRETİLMEZ.
 */

export const PHONE_LINK_QR_PROTOCOL_VERSION = 1 as const;

export interface PhoneLinkQrPayload {
  readonly protocolVersion: typeof PHONE_LINK_QR_PROTOCOL_VERSION;
  /** Loglanabilir/görüntülenebilir referans — SIR DEĞİLDİR. */
  readonly guestSessionId: string;
  /** Tek kullanımlık bootstrap kimlik bilgisi — QR DIŞINDA ASLA taşınmaz/loglanmaz. */
  readonly oneTimeBootstrapToken: string;
  /** Portal kabuğunun tam adresi (`http://ip:port/p`), yoksa `null`. */
  readonly localEndpoint: string | null;
  readonly expiresAtMs: number;
}

export interface PhoneLinkGuestSessionRef {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: number;
}

/** Saf üretici — guest session'ı QR payload'una çevirir. Yeni token ÜRETMEZ. */
export function buildGuestQrPayload(
  session: PhoneLinkGuestSessionRef, localEndpoint: string | null = null,
): PhoneLinkQrPayload {
  return Object.freeze({
    protocolVersion: PHONE_LINK_QR_PROTOCOL_VERSION,
    guestSessionId: session.sessionId,
    oneTimeBootstrapToken: session.token,
    localEndpoint,
    expiresAtMs: session.expiresAt,
  });
}

export function isQrPayloadExpired(payload: PhoneLinkQrPayload, now: number = Date.now()): boolean {
  return now >= payload.expiresAtMs;
}

/**
 * QR'ın KENDİSİNE gömülecek değeri üretir.
 *
 * ── TOKEN DAİMA FRAGMENT'TA ─────────────────────────────────────────────────
 * Bootstrap token QUERY'ye ASLA konmaz; fragment (`#`) kullanılır
 * (`keyBeamCrypto.ts` ile AYNI gerekçe): fragment sunucuya HİÇ gönderilmez, bu
 * yüzden access log'a, `Referer`'a veya proxy kaydına DÜŞMEZ. Yalnız tarayıcı
 * içindeki portal betiği onu okur ve ilk işi adres çubuğundan silmektir.
 *
 * `localEndpoint` varsa telefonun kamerasının doğrudan açabileceği düz bir
 * `http://` adresi üretilir (uygulama kurulumu GEREKTİRMEZ — F3 ana hedefi).
 * Endpoint yoksa F1 davranışı korunur: yalnız sözleşmeyi taşıyan özel şema —
 * bu bir gerçek URL'e YÖNLENDİRME İDDİASI DEĞİLDİR ve çağıran QR göstermez.
 */
export function buildGuestQrDisplayValue(payload: PhoneLinkQrPayload): string {
  if (payload.localEndpoint !== null) {
    return `${payload.localEndpoint}#t=${payload.oneTimeBootstrapToken}`;
  }
  const body = encodeURIComponent(JSON.stringify({
    v: payload.protocolVersion,
    sid: payload.guestSessionId,
    exp: payload.expiresAtMs,
  }));
  // Token DAİMA fragment'tadır — asla query'de.
  return `caros-phone-link://guest#t=${payload.oneTimeBootstrapToken}&d=${body}`;
}
