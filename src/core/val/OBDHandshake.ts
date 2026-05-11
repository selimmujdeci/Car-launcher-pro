/**
 * OBDHandshake — Pure ELM327 response parsers.
 *
 * Durumsuz, bağımlılıksız fonksiyonlar — test edilebilir.
 *
 * SAE J1979 referansları:
 *   Mode 09 PID 02 → VIN (17 ASCII karakter)
 *   Mode 01 PID 00 → Desteklenen PID'ler bitmask (PIDs 01-32)
 */

/* ── Yardımcılar ────────────────────────────────────────────────────────── */

/**
 * ELM327 yanıtından hex çiftlerini ayıklar.
 * Boşlukları, '>', '\r', '\n' karakterlerini ve prompt'u temizler.
 * "NODATA", "ERROR", "?" → boş array döner.
 */
function _hexTokens(raw: string): string[] {
  const clean = raw
    .replace(/\r|\n|>/g, ' ')
    .replace(/NODATA|ERROR|\?|SEARCHING\.\.\./gi, '')
    .trim()
    .toUpperCase();
  return clean.split(/\s+/).filter((t) => /^[0-9A-F]{2}$/.test(t));
}

/* ══════════════════════════════════════════════════════════════════════════
   VIN — Mode 09 PID 02
══════════════════════════════════════════════════════════════════════════ */

/**
 * ELM327 ham `09 02` yanıtından VIN'i ayrıştırır.
 *
 * Tipik yanıt formatı (ISO 15765-4 CAN):
 *   49 02 01 57 41 55 5A 5A 5A 4A 4E 41 41 42 43 31 32 33 34 35
 *   ^^    ^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *  mode  pid frame#      17 × ASCII VIN bytes
 *
 * Multi-frame (Type 1 J1979): bazen birden fazla `49 02 0N ...` satırı.
 * Tüm frame'leri birleştir → VIN'i ilk 17 yazdırılabilir ASCII char'dan oluştur.
 *
 * @returns 17-char VIN string, ya da parse edilemezse null.
 */
export function parseVIN(raw: string): string | null {
  const tokens = _hexTokens(raw);

  // 49 02 önekini bul
  const startIdx = tokens.findIndex((t, i) =>
    t === '49' && tokens[i + 1] === '02',
  );
  if (startIdx < 0) return null;

  // Tüm '49 02 0N ...' bloklarını topla
  const vinBytes: number[] = [];
  let i = startIdx;

  while (i < tokens.length) {
    // Her blok: 49 02 <frameNo> <data...>
    if (tokens[i] === '49' && tokens[i + 1] === '02') {
      i += 3; // 49, 02, frameNo atla
      // Sonraki '49 02' veya end'e kadar data al
      while (i < tokens.length && !(tokens[i] === '49' && tokens[i + 1] === '02')) {
        const byte = parseInt(tokens[i]!, 16);
        if (byte >= 0x20 && byte <= 0x7E) vinBytes.push(byte); // yazdırılabilir ASCII
        i++;
      }
    } else {
      i++;
    }
  }

  if (vinBytes.length < 17) return null;

  const vin = vinBytes
    .slice(0, 17)
    .map((b) => String.fromCharCode(b))
    .join('');

  // SAE J1979: VIN yalnızca A-Z, 0-9 içerir; I, O, Q yasak
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;

  return vin;
}

/* ══════════════════════════════════════════════════════════════════════════
   Supported PIDs — Mode 01 PID 00
══════════════════════════════════════════════════════════════════════════ */

/**
 * ELM327 ham `01 00` yanıtından desteklenen PID numaralarını ayrıştırır.
 *
 * Yanıt: `41 00 BE 1F B8 13`
 *   41 00 = Mode 01 yanıt başlığı
 *   Sonraki 4 byte = A B C D = 32-bit bitmask:
 *     Bit 7 byte A → PID 01, Bit 6 byte A → PID 02, ..., Bit 0 byte D → PID 32
 *
 * @returns Desteklenen PID numaralarını içeren Set<number> (PIDs 01–32).
 *          Yanıt hatalıysa boş Set döner.
 */
export function parseSupportedPIDs(raw: string): Set<number> {
  const supported = new Set<number>();
  const tokens    = _hexTokens(raw);

  // 41 00 önekini bul
  const headerIdx = tokens.findIndex((t, i) => t === '41' && tokens[i + 1] === '00');
  if (headerIdx < 0) return supported;

  const dataStart = headerIdx + 2; // 41, 00 atla
  if (tokens.length < dataStart + 4) return supported; // en az 4 data byte gerekli

  const bytes = [
    parseInt(tokens[dataStart]!,     16),
    parseInt(tokens[dataStart + 1]!, 16),
    parseInt(tokens[dataStart + 2]!, 16),
    parseInt(tokens[dataStart + 3]!, 16),
  ];

  // Byte i → PIDs (i*8+1) … (i*8+8)
  // Bit 7 = first PID in group, Bit 0 = last
  bytes.forEach((byte, byteIdx) => {
    for (let bit = 7; bit >= 0; bit--) {
      if (byte & (1 << bit)) {
        const pid = byteIdx * 8 + (8 - bit);
        supported.add(pid);
      }
    }
  });

  return supported;
}

/* ══════════════════════════════════════════════════════════════════════════
   HandshakeResult
══════════════════════════════════════════════════════════════════════════ */

export interface HandshakeResult {
  /** 17 char VIN veya null (yanıt gelmediyse / geçersizse) */
  vin:           string | null;
  /** Mode 01 PID 00'dan ayrıştırılan desteklenen PID numaraları */
  supportedPids: Set<number>;
}

/**
 * Ham native yanıtları birleştirerek HandshakeResult üretir.
 * Yoksa her alan için graceful fallback uygulanır.
 */
export function buildHandshakeResult(
  raw09: string,
  raw0100: string,
): HandshakeResult {
  return {
    vin:           parseVIN(raw09),
    supportedPids: parseSupportedPIDs(raw0100),
  };
}
