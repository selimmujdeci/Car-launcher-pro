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

/**
 * Sağlayıcı anahtar biçimleri — bu kod tabanında GERÇEKTEN kullanılan şekiller.
 * TEK KAYNAK: `platform/ai/memory/sensitiveMemoryGuard.ts` PATTERNS listesiyle
 * bire bir hizalıdır (yeni sağlayıcı eklenirse iki yer de güncellenmeli).
 */
const RE_PROVIDER_KEY = /\b(?:sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|tvly-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{10,}|AQ\.[A-Za-z0-9_.-]{10,})/g;
/** Genel anahtar/jeton biçimleri (api_key=…, bearer …, token: …). */
const RE_SECRET = /\b(?:sk|pk|api|key|token|bearer|apikey)[-_]?[A-Za-z0-9_-]{12,}\b/gi;
/** `anahtar = değer` biçimi — değeri yut (VIN/hex maskesi değere ulaşamadan). */
const RE_KV_SECRET = /\b(api[_-]?key|apikey|token|secret|password|bearer)\s*[=:]\s*\S+/gi;
const RE_EMAIL  = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RE_MAC    = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const RE_UUID   = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
/** IBAN (TR…, GB…) — hex yükünde yanlış-pozitif riski yok (F sonrası harf gerektirir). */
const RE_IBAN   = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
/** Gruplu kart numarası (4-4-4-4) — OBD yanıtı 2'şer bayt gruplanır, çakışmaz. */
const RE_CARD   = /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{2,7}\b/g;
/** Uluslararası telefon (+ öneki) — ham hex'te '+' hiç geçmez. */
const RE_PHONE  = /\+\d[\d\s().-]{7,}\d/g;
/**
 * 17 haneli ASCII VIN (I/O/Q yok).
 *
 * ⚠️ #533 — TAMAMI RAKAM OLAN DİZİ VIN DEĞİLDİR. Sahada (2026-08-11) kopyada
 * `"reconnectPressure": 0.[VIN redacted]` çıktı: sönümlü sayacın ondalık kısmı
 * 17 haneli bir rakam dizisiydi, VIN sanılıp maskelendi → **kanıt kaybı** (sayı
 * okunamaz hâle geldi). Gerçek VIN'de model yılı · fabrika kodu · kontrol hanesi
 * nedeniyle en az bir HARF bulunur; 17 hanesinin tamamı rakam olan VIN pratikte
 * yoktur. Bu negatif lookahead maskeyi ZAYIFLATMAZ — harf içeren her 17'li dizi
 * yine maskelenir (fail-closed korunur), yalnız sayıyı VIN sanması engellenir.
 */
const RE_VIN    = /\b(?!\d{17}\b)[A-HJ-NPR-Z0-9]{17}\b/g;

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

/**
 * Genel hassas desenler. Ham hex yükü BİLEREK korunur — geliştiricinin asıl verisi
 * odur. Bu yüzden "çıplak uzun rakam dizisi", "plaka" ve "ayraçsız telefon" gibi
 * hex'te yanlış-pozitif üreten desenler BURADA uygulanmaz; bunlar dışa aktarımın
 * ikinci kapısında (`validationExport.sanitizeValue`) fail-closed ele alınır.
 *
 * Sıra ÖNEMLİ: `anahtar=değer` önce (değer, VIN/hex maskesine yem olmasın).
 */
export function maskCommonSecrets(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return input
    .replace(RE_KV_SECRET, '$1=' + REDACTED)
    .replace(RE_PROVIDER_KEY, REDACTED)
    .replace(RE_SECRET, REDACTED)
    .replace(RE_EMAIL, REDACTED)
    .replace(RE_UUID, REDACTED)
    .replace(RE_IBAN, REDACTED)
    .replace(RE_CARD, REDACTED)
    .replace(RE_PHONE, REDACTED)
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
