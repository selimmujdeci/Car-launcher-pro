/**
 * OBDHandshake — Pure ELM327 response parsers.
 *
 * Durumsuz, bağımlılıksız fonksiyonlar — test edilebilir.
 *
 * SAE J1979 referansları:
 *   Mode 09 PID 02                → VIN (17 ASCII karakter)
 *   Mode 01 PID 00/20/40/60/80/A0 → Desteklenen PID bitmask'leri (PIDs 01–192)
 *
 * Tek doğruluk kaynağı sözleşmesi: native katman yalnız HAM ELM327 yanıtını
 * döndürür (formül/parse YOK); tüm bitmap ayrıştırma + yanıt sınıflandırması
 * BURADA (TS) yapılır → tam unit-test edilebilir.
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

/**
 * SAE J1979 pozitif yanıt önekinden (ör. "41"/"49") ORİJİNAL istek modunu
 * ("01"/"09") türetir (pozitif yanıt = istek modu + 0x40). Geçersiz girişte null.
 * ElmResponseParser.requestModeHex (native) ile birebir aynı — tek doğruluk kaynağı.
 */
function _requestModeHex(positiveModeHex: string): string | null {
  const v = parseInt(positiveModeHex, 16) - 0x40;
  if (Number.isNaN(v) || v < 0) return null;
  return v.toString(16).toUpperCase().padStart(2, '0');
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
 * @returns 17-char VIN string, ya da parse edilemezse null (fail-soft — hiç throw etmez).
 */
export function parseVIN(raw: string | null | undefined): string | null {
  if (raw == null) return null;
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
   Supported PIDs — Mode 01 PID 00 / 20 / 40 / 60 / 80 / A0
══════════════════════════════════════════════════════════════════════════ */

/**
 * Tek bir "desteklenen PID" bitmap bloğunu ayrıştırır ve PID numaralarını
 * (offset uygulanmış) verilen Set'e ekler.
 *
 * Yanıt: `41 00 BE 1F B8 13`
 *   41 00 = Mode 01 yanıt başlığı (blok probe PID'i)
 *   Sonraki 4 byte = A B C D = 32-bit bitmask:
 *     Bit 7 byte A → 1. PID (offset+1), Bit 0 byte D → 32. PID (offset+32)
 *
 * @param offset Blok tabanı: PID 00 bloğu → 0, PID 20 bloğu → 32, PID 40 → 64 …
 * @returns true = başlık + 4 data byte bulundu (bu blok GERÇEKTEN okundu — kanıt).
 *          false = başlık yok / eksik data (blok okunmadı; PID'ler "bilinmiyor").
 */
function _parseBitmapBlock(
  raw: string | null | undefined,
  posMode: string,
  pid: string,
  offset: number,
  into: Set<number>,
): boolean {
  if (raw == null) return false;
  const tokens = _hexTokens(raw);
  const needlePid = pid.toUpperCase();

  const headerIdx = tokens.findIndex(
    (t, i) => t === posMode && tokens[i + 1] === needlePid,
  );
  if (headerIdx < 0) return false;

  const dataStart = headerIdx + 2; // posMode, pid atla
  if (tokens.length < dataStart + 4) return false; // en az 4 data byte gerekli

  const bytes = [
    parseInt(tokens[dataStart]!, 16),
    parseInt(tokens[dataStart + 1]!, 16),
    parseInt(tokens[dataStart + 2]!, 16),
    parseInt(tokens[dataStart + 3]!, 16),
  ];

  // Byte i → PIDs (offset + i*8 + 1) … (offset + i*8 + 8)
  // Bit 7 = grubun ilk PID'i, Bit 0 = son PID'i
  bytes.forEach((byte, byteIdx) => {
    for (let bit = 7; bit >= 0; bit--) {
      if (byte & (1 << bit)) {
        into.add(offset + byteIdx * 8 + (8 - bit));
      }
    }
  });

  return true;
}

/**
 * Geriye dönük uyumlu tek-blok ayrıştırıcı (Mode 01 PID 00 → PIDs 01–32).
 * Çok-bloklu keşif için {@link buildHandshakeResult} kullanılır.
 *
 * @returns Desteklenen PID numaralarını içeren Set<number>. Yanıt hatalıysa boş Set.
 */
export function parseSupportedPIDs(raw: string | null | undefined): Set<number> {
  const supported = new Set<number>();
  _parseBitmapBlock(raw, '41', '00', 0, supported);
  return supported;
}

/* ══════════════════════════════════════════════════════════════════════════
   Yanıt sınıflandırması (timeout türü ayrımı — item 5)
══════════════════════════════════════════════════════════════════════════ */

/**
 * Handshake ham yanıt sınıfları. Native ElmResponseParser.Kind ile birebir eşlenir
 * (tek doğruluk kaynağı burada — TS): sessiz yutma YOK, her tür ayrı raporlanır.
 */
export type HandshakeResponseClass =
  | 'ok'          // beklenen mode+pid bloğu bulundu
  | 'no_data'     // ELM327 "NO DATA" — ECU PID'i tanımıyor (ARIZA DEĞİL)
  | 'busy'        // "SEARCHING..." / "BUS INIT" — protokol araması sürüyor
  | 'unsupported' // "7F <mode> <NRC>" — ECU ayrık negatif yanıtı
  | 'error'       // STOPPED / BUFFER FULL / CAN ERROR / BUS ERROR / UNABLE TO CONNECT / "?"
  | 'timeout';    // boş / tanınmayan / eksik yanıt (yarım kalmış bayt akışı)

/**
 * Ham ELM327 handshake yanıtını sınıflandırır — NO DATA / TIMEOUT / UNSUPPORTED
 * ayrımı burada yapılır (sessiz yutma yasak). {@link ElmResponseParser.classify}
 * (native) ile davranış-eş.
 *
 * @param posMode Pozitif yanıt önek modu ('41' = Mode 01, '49' = Mode 09).
 * @param pid     Beklenen PID hex ('00', '20', '02' …).
 */
export function classifyHandshakeResponse(
  raw: string | null | undefined,
  posMode: string,
  pid: string,
): HandshakeResponseClass {
  if (raw == null || raw.trim() === '') return 'timeout';
  const compact = raw.replace(/\s+/g, '').toUpperCase();

  if (compact.includes('NODATA')) return 'no_data';
  if (compact.includes('SEARCHING') || compact.includes('BUSINIT')) return 'busy';
  if (
    compact.includes('UNABLETOCONNECT') || compact.includes('CANERROR') ||
    compact.includes('BUSERROR') || compact.includes('STOPPED') ||
    compact.includes('BUFFERFULL')
  ) {
    return 'error';
  }

  const needle = (posMode + pid).toUpperCase();
  if (compact.includes(needle)) return 'ok';

  const reqMode = _requestModeHex(posMode);
  if (reqMode != null && compact.includes('7F' + reqMode)) return 'unsupported';
  if (compact === '?' || compact.includes('ERROR')) return 'error';

  return 'timeout';
}

/* ══════════════════════════════════════════════════════════════════════════
   HandshakeResult
══════════════════════════════════════════════════════════════════════════ */

/**
 * Native `performHandshake()` ham dönüşü. raw0100 dışındaki bitmap blokları
 * opsiyoneldir — native yalnız süreklilik-bit'i set olan blokları sorgular
 * (desteklenmeyen bloğu sorgulamaz → NO-DATA fırtınası yok). Eski plugin
 * yalnız {raw09, raw0100} döndürebilir (geriye dönük uyumlu).
 */
export interface RawHandshake {
  raw09:    string;
  raw0100:  string;
  raw0120?: string;
  raw0140?: string;
  raw0160?: string;
  raw0180?: string;
  raw01A0?: string;
}

export interface HandshakeResult {
  /** 17 char VIN veya null (yanıt gelmediyse / geçersizse) */
  vin:           string | null;
  /** Tüm bitmap bloklarından ayrıştırılan desteklenen PID numaraları (1–192) */
  supportedPids: Set<number>;
  /**
   * GERÇEKTEN okunan bitmap bloklarının taban PID'leri (0x00, 0x20, …).
   * Zero-trust kapı: yalnız bu bloklardaki PID'ler için "desteklenmiyor"
   * çıkarımı yapılabilir — okunmayan blok PID'leri "bilinmiyor" (poll'dan
   * ATILMAZ, mevcut davranış korunur → fail-soft, regresyonsuz).
   */
  readBlocks:    Set<number>;
}

/** Bitmap blokları — probe PID → pozitif önek + offset + ham alan çıkarıcı. */
const BITMAP_BLOCKS: ReadonlyArray<{
  probe: number; posMode: string; pid: string; offset: number;
  raw: (r: RawHandshake) => string | undefined;
}> = [
  { probe: 0x00, posMode: '41', pid: '00', offset: 0,   raw: (r) => r.raw0100 },
  { probe: 0x20, posMode: '41', pid: '20', offset: 32,  raw: (r) => r.raw0120 },
  { probe: 0x40, posMode: '41', pid: '40', offset: 64,  raw: (r) => r.raw0140 },
  { probe: 0x60, posMode: '41', pid: '60', offset: 96,  raw: (r) => r.raw0160 },
  { probe: 0x80, posMode: '41', pid: '80', offset: 128, raw: (r) => r.raw0180 },
  { probe: 0xA0, posMode: '41', pid: 'A0', offset: 160, raw: (r) => r.raw01A0 },
];

/**
 * Ham native yanıtları birleştirerek HandshakeResult üretir.
 * Her alan için graceful fallback (hiç throw etmez) — item 6/7: VIN yoksa null,
 * bitmap yoksa boş Set, kısmi/bozuk giriş sessizce atlanır.
 */
export function buildHandshakeResult(raw: RawHandshake): HandshakeResult {
  const supportedPids = new Set<number>();
  const readBlocks    = new Set<number>();

  for (const blk of BITMAP_BLOCKS) {
    const ok = _parseBitmapBlock(blk.raw(raw), blk.posMode, blk.pid, blk.offset, supportedPids);
    if (ok) readBlocks.add(blk.probe);
  }

  return {
    vin: parseVIN(raw.raw09),
    supportedPids,
    readBlocks,
  };
}
