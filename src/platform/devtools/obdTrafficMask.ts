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

/* ══════════════════════════════════════════════════════════════════════════
 * P0-VDK-FIELD-FIX-A · VIN TESPİTİ PROTOKOL-FARKINDA OLMAK ZORUNDA
 *
 * ── SAHA ARIZASI (2026-08-30 · gerçek araç · CAROS LAB TAM KOPYA) ──────────
 * Kopyada şu iki satır çıktı:
 *     {"cmd":"0100","resp":"[VIN redacted]"}
 * `0100` VIN DEĞİLDİR — desteklenen PID bitmap'idir ve `ATH1` açıkken hangi ECU
 * adreslerinin cevap verdiğinin TEK kanıtıdır. Eski kapı
 * `_compact(resp).includes('4902')` idi: bayt hizası YOK, servis bağlamı YOK.
 * Gerçek adaptörde `ATS0` boşlukları kapatır ve `OBDManager.send()` CR'yi siler
 * → yanıt bitişik tek akış olur; `…A4·90·2B…` gibi bir bayt dizisi nibble
 * kaymasıyla "4902" üretir → TÜM yanıt silinir → ECU keşif kanıtı KAYBOLUR.
 *
 * Bu, #533'ün (ondalık sayı VIN sanıldı) AYNI hata sınıfıdır: HİZASIZ DESEN
 * ARAMA. #533 `RE_VIN` tarafında düzeltilmişti; bu kapı düzeltmeden geçmemişti.
 *
 * ── YENİ SÖZLEŞME ─────────────────────────────────────────────────────────
 * `49 02` yalnız bir ELM327 mesajının **payload BAŞLANGICINDA** VIN'dir.
 * Tanınan payload başlangıçları (hepsi bayt hizalı, hepsi segment başında):
 *   · headers OFF · tek frame       : `4902…`
 *   · headers OFF · ISO-TP çok frame: `014` + `0:` + `4902…`  (ELM frame öneki)
 *   · headers ON  · 11-bit · SF     : `7E8` + `0L`   + `4902…`
 *   · headers ON  · 11-bit · FF     : `7E8` + `1LLL` + `4902…`
 *   · headers ON  · 29-bit · SF/FF  : `18DAF110` + PCI + `4902…`
 * Nibble kayması eşleşme SAYILMAZ; `4100…` bitmap yanıtı ASLA VIN olamaz.
 *
 * VIN bulunursa yalnız **o segmentin yükü** gizlenir: servis baytı (`4902`) ve
 * önündeki header/PCI/uzunluk öneki KORUNUR (akış izlenebilsin), devam
 * frame'leri (CF — VIN'in geri kalanı) redaksiyona DAHİLDİR. Aynı kayıttaki
 * DİĞER mesajlar/ECU satırları kaybolmaz.
 *
 * FAIL-CLOSED: istek Mode 09 PID 02 iken yanıt hex taşıyor ama yapı çözülemedi
 * → yanıtın TAMAMI gizlenir (bkz. `maskObdTrafficEntry`). Gizlilik kanıttan önce.
 * ════════════════════════════════════════════════════════════════════════ */

/** Mode 09 PID 02 pozitif yanıt servis+PID baytı — VIN yükünün işareti. */
const VIN_SID = '4902';

/**
 * ELM/adaptör DURUM sözcükleri — hex değildir, VIN taşıyamaz.
 * `NO DATA` · `OK` · `?` · `SEARCHING…` · `STOPPED` · `UNABLE TO CONNECT` ·
 * `BUS INIT` · `CAN ERROR` · `⚠ …` (send() hata sarmalayıcısı).
 */
const RE_STATUS_LINE = /^(?:OK|\?|NO ?DATA|SEARCHING|STOPPED|UNABLE|BUS|CAN ?ERROR|ERR|ERROR|BUFFER|LV ?RESET|⚠|<)/;

/** En az 4 hex hane taşıyan segment = üzerinde protokol çözümlemesi yapılabilir. */
const RE_HAS_HEX = /[0-9A-F]{4}/;

interface Compacted {
  /** Boşluksuz, büyük harfli hâl (`:` gibi yapısal karakterler KORUNUR). */
  readonly hex: string;
  /** `hex[i]` karakterinin ORİJİNAL segmentteki indeksi — redaksiyonu hizalar. */
  readonly map: readonly number[];
}

/** Boşlukları atar ama her karakterin orijinal indeksini saklar (kayıpsız geri eşleme). */
function _compactWithMap(segment: string): Compacted {
  let hex = '';
  const map: number[] = [];
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i);
    if (code === 32 || code === 9) continue;            // boşluk / tab
    hex += segment[i].toUpperCase();
    map.push(i);
  }
  return { hex, map };
}

/**
 * `VIN_SID`'in `hex` içinde **payload başlangıcı** olarak geçtiği ilk indeks.
 * Bulunamazsa `-1`. Hizasız/ortada geçen `4902` KABUL EDİLMEZ.
 */
function _vinPayloadStart(hex: string): number {
  for (let i = hex.indexOf(VIN_SID); i >= 0; i = hex.indexOf(VIN_SID, i + 1)) {
    const pre = hex.slice(0, i);
    /* (1) Segment başı — headers OFF, tek frame. */
    if (pre.length === 0) return i;
    /* (2) ELM ISO-TP frame öneki `…0:` — ilk frame'in yükü hemen ardından başlar
           (uzunluk öneki `014` frame önekinden ÖNCEDİR, hizayı bozmaz). */
    if (pre.endsWith('0:')) return i;
    /* (3) headers ON — 11-bit (3 hane) / 29-bit (8 hane) header + PCI.
           SF PCI = `0L` (2 hane) · FF PCI = `1LLL` (4 hane). */
    if (/^[0-7][0-9A-F]{2}0[0-9A-F]$/.test(pre))    return i; // 11-bit SF
    if (/^[0-7][0-9A-F]{2}1[0-9A-F]{3}$/.test(pre)) return i; // 11-bit FF
    /* 29-bit header ISO 15765-4'te `18DAxxxx` (fiziksel) / `18DB33F1` (fonksiyonel)
       ile SINIRLIDIR. Genel `[0-9A-F]{8}` kalıbı KULLANILAMAZ: çok-ECU 11-bit akışı
       bitişik geldiğinde ("7E8064100A4902B13") 10 haneli önek ona tesadüfen uyar ve
       bitmap yanıtı VIN sanılırdı — düzeltilen arızanın TA KENDİSİ. */
    if (/^18D[AB][0-9A-F]{4}0[0-9A-F]$/.test(pre))    return i; // 29-bit SF
    if (/^18D[AB][0-9A-F]{4}1[0-9A-F]{3}$/.test(pre)) return i; // 29-bit FF
  }
  return -1;
}

/**
 * VIN mesajının BİTTİĞİ nokta: ELM frame formatında bir SONRAKİ mesajın
 * başlangıcı (`0:` frame öneki; varsa 3 haneli uzunluk öneki geri sarılır).
 * Yoksa segment sonu — devam frame'leri (CF) VIN yükünün parçasıdır.
 */
function _vinPayloadEnd(hex: string, from: number): number {
  const next = hex.indexOf('0:', from + VIN_SID.length);
  if (next < 0) return hex.length;
  /* `0:` önündeki 3 hane ISO-TP toplam uzunluk önekiyse o da SONRAKİ mesaja aittir. */
  const lenPrefix = hex.slice(Math.max(0, next - 3), next);
  return /^[0-9A-F]{3}$/.test(lenPrefix) ? next - 3 : next;
}

/** `maskVinPayload` sonucu — fail-closed kararı için `hadHexPayload` taşır. */
export interface VinScanResult {
  /** Redaksiyon uygulanmış metin (VIN yoksa girdi birebir). */
  readonly text: string;
  /** VIN yükü gizlendi mi. */
  readonly masked: boolean;
  /** Üzerinde hex çözümlenebilen en az bir segment vardı mı. */
  readonly hadHexPayload: boolean;
}

/** Tek segmentte (satır) VIN yükünü gizler; servis baytı ve önek KORUNUR. */
function _redactVinInSegment(segment: string): VinScanResult {
  const upper = segment.trim().toUpperCase();
  if (upper.length === 0 || RE_STATUS_LINE.test(upper)) {
    return { text: segment, masked: false, hadHexPayload: false };
  }

  const { hex, map } = _compactWithMap(segment);
  if (!RE_HAS_HEX.test(hex)) return { text: segment, masked: false, hadHexPayload: false };

  const start = _vinPayloadStart(hex);
  if (start < 0) return { text: segment, masked: false, hadHexPayload: true };

  /* Servis baytı (`4902`) görünür kalır → akış izlenebilir, yük gizlenir. */
  const payloadStart = start + VIN_SID.length;
  const payloadEnd   = _vinPayloadEnd(hex, start);
  /* `4902` var ama ardından yük yok (kesik yanıt) → gizlenecek VIN de yok. */
  if (payloadEnd <= payloadStart) return { text: segment, masked: false, hadHexPayload: true };

  const from = map[payloadStart];
  const to   = payloadEnd >= map.length ? segment.length : map[payloadEnd];
  return {
    text: segment.slice(0, from) + REDACTED_VIN + segment.slice(to),
    masked: true,
    hadHexPayload: true,
  };
}

/**
 * Yanıtın TAMAMINDA VIN yükünü gizler. Satır ayraçları (varsa) korunur ve her
 * satır BAĞIMSIZ çözümlenir → VIN taşımayan ECU satırları KAYBOLMAZ.
 *
 * ⚠️ `OBDManager.send()` CR'yi siler; gerçek adaptörde satırlar bitişik gelebilir.
 * O yüzden tespit satır ayracına BAĞIMLI DEĞİLDİR: ELM frame öneki (`0:`) ve
 * header+PCI hizası segment sınırını kendi başına verir.
 */
export function maskVinPayload(resp: unknown): VinScanResult {
  if (typeof resp !== 'string' || resp.length === 0) {
    return { text: '', masked: false, hadHexPayload: false };
  }
  /* Ayraçlar capture ile korunur → çıktı birebir yeniden kurulur. */
  const parts = resp.split(/(\r\n|\r|\n)/);
  let masked = false;
  let hadHexPayload = false;
  const out: string[] = [];
  for (const part of parts) {
    if (part === '\r\n' || part === '\r' || part === '\n') { out.push(part); continue; }
    const r = _redactVinInSegment(part);
    masked = masked || r.masked;
    hadHexPayload = hadHexPayload || r.hadHexPayload;
    out.push(r.text);
  }
  return { text: out.join(''), masked, hadHexPayload };
}

/**
 * Yanıt GERÇEKTEN VIN taşıyor mu — protokol seviyesinde (bkz. yukarıdaki sözleşme).
 *
 * ⚠️ Eski `includes('4902')` davranışına DÖNÜLEMEZ: hizasız arama `0100` bitmap
 * yanıtını VIN sanıp kanıtı siliyordu (saha 2026-08-30).
 */
export function isVinResponse(resp: unknown): boolean {
  if (typeof resp !== 'string') return false;
  return maskVinPayload(resp).masked;
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
  return _applyCommonMasks(input, true);
}

/**
 * Ortak maskeler. `asciiVin=false` YALNIZ saf-hex OBD segmentlerinde kullanılır
 * (bkz. `_isPureHexSegment`) — orada ASCII VIN bulunamaz, `RE_VIN` ise 17 haneli
 * HAM HEX akışını VIN sanar.
 */
function _applyCommonMasks(input: unknown, asciiVin: boolean): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const base = input
    .replace(RE_KV_SECRET, '$1=' + REDACTED)
    .replace(RE_PROVIDER_KEY, REDACTED)
    .replace(RE_SECRET, REDACTED)
    .replace(RE_EMAIL, REDACTED)
    .replace(RE_UUID, REDACTED)
    .replace(RE_IBAN, REDACTED)
    .replace(RE_CARD, REDACTED)
    .replace(RE_PHONE, REDACTED)
    .replace(RE_MAC, REDACTED);
  return asciiVin ? base.replace(RE_VIN, REDACTED_VIN) : base;
}

/**
 * Segment YALNIZ hex hane + ELM yapı karakteri mi (`:` frame öneki, `>` prompt)?
 *
 * ⚠️ SAHA (2026-08-30): `7E8064100A4902B13` — 17 haneli ham bitmap yanıtı — ASCII
 * VIN kalıbına (`[A-HJ-NPR-Z0-9]{17}`) uyuyor ve ikinci kapıda siliniyordu. Ham hex
 * akışında ASCII VIN BULUNAMAZ (VIN orada hex kodludur ve onu protokol çözümleyicisi
 * yakalar). Gerçek bir ASCII VIN'de hex OLMAYAN harf (W · X · T · R · G …) neredeyse
 * kesin bulunur → böyle bir segment "saf hex" SAYILMAZ ve tam maske uygulanır.
 */
function _isPureHexSegment(segment: string): boolean {
  const compact = segment.replace(/[\s>]/g, '').toUpperCase();
  return compact.length >= 4 && /^[0-9A-F:]+$/.test(compact);
}

/**
 * Yanıt gövdesine ortak maskeleri uygular; saf-hex segmentlerde ASCII-VIN maskesi
 * ATLANIR (ham hex kanıtı korunur). Satır yapısı birebir korunur.
 */
function _maskResponseSecrets(resp: string): string {
  return resp
    .split(/(\r\n|\r|\n)/)
    .map((part) => (part === '\r\n' || part === '\r' || part === '\n'
      ? part
      : _applyCommonMasks(part, !_isPureHexSegment(part))))
    .join('');
}

export interface MaskedObdEntry {
  readonly cmd:    string;
  readonly resp:   string;
  /** VIN yükü gizlendi mi (UI'da rozet). */
  readonly masked: boolean;
}

/**
 * Tek trafik satırını maskeler. VIN YÜKÜ gizlenir; servis baytı (`4902`) ve
 * header/PCI öneki görünür kalır → geliştirici akışı yine izleyebilir.
 *
 * ── ÜÇ YOL (P0-VDK-FIELD-FIX-A) ───────────────────────────────────────────
 *  (1) Yanıtta protokol seviyesinde VIN BULUNDU → yalnız o segmentin yükü gizlenir;
 *      aynı kayıttaki diğer ECU satırları KORUNUR.
 *  (2) İstek Mode 09 PID 02 ama yanıtta VIN yapısı ÇÖZÜLEMEDİ, buna karşın yanıt
 *      hex taşıyor → **FAIL-CLOSED**: yanıtın tamamı gizlenir. (Desenkronizasyonda
 *      bir başka komutun yanıtı bu satıra kayabilir — bkz. `OBDManager.send()`
 *      prompt-timeout notu; gizlilik kanıttan önce gelir.)
 *  (3) İstek VIN sorgusu ama yanıt hex DEĞİL (`NO DATA` · `OK` · `?`) → gizlenecek
 *      kimlik yok, kanıt KORUNUR. (Eskiden bu satır da `[VIN redacted]` oluyordu.)
 */
export function maskObdTrafficEntry(cmd: unknown, resp: unknown): MaskedObdEntry {
  const safeCmd  = typeof cmd === 'string' ? cmd : '';
  const safeResp = typeof resp === 'string' ? resp : '';
  const maskedCmd = maskCommonSecrets(safeCmd);

  const scan = maskVinPayload(safeResp);
  if (scan.masked) {
    return { cmd: maskedCmd, resp: _maskResponseSecrets(scan.text), masked: true };
  }
  if (isVinRequest(safeCmd) && scan.hadHexPayload) {
    return { cmd: maskedCmd, resp: REDACTED_VIN, masked: true };
  }
  return { cmd: maskedCmd, resp: _maskResponseSecrets(safeResp), masked: false };
}
