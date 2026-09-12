/**
 * mode06 — SAE J1979 Servis 06 (On-Board Monitoring Test Results) ÇÖZÜMLEYİCİSİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 *
 * ── NEDEN MODE 06 ─────────────────────────────────────────────────────────
 * Mode 03 bir arızayı ancak ECU onu KOD OLARAK yazdıktan sonra gösterir; kod
 * yazılması için genelde iki sürüş çevrimi ve eşiğin AŞILMASI gerekir. Mode 06
 * ise ECU'nun kendi izleme testlerinin HAM SONUCUNU verir: ölçülen değer ve
 * ECU'nun kendi belirlediği alt/üst sınır. Yani "sınıra ne kadar yakınız"
 * sorusu kod yanmadan yanıtlanabilir.
 *
 * ── KRİTİK: SINIRLARI BİZ UYDURMAYIZ, ECU SÖYLER ──────────────────────────
 * Her test kaydı ECU'nun KENDİ min/max sınırını taşır. Bu yüzden geçti/kaldı
 * hükmü bir YORUM DEĞİL, ECU'nun beyanının doğrudan sonucudur. Eşik icat etmeyiz.
 *
 * ── FORMAT (CAN / ISO 15765-4) ────────────────────────────────────────────
 * İstek:  `06 MID`
 * Yanıt:  `46` + N × 9 bayt kayıt:
 *         MID(1) TID(1) UAS(1) TESTVAL(2) MIN(2) MAX(2)
 * Tek kayıt bile 10 bayt eder → CAN'de tek çerçeveye (7 bayt) SIĞMAZ, yani
 * Mode 06 yanıtı HER ZAMAN çok-çerçevelidir. Birleştirme native tarafta
 * `ElmProtocol.splitResponseBodies` ile yapılır (mevcut ISO-TP birleştiricisi
 * yeniden kullanılır — ikinci çözümleyici YAZILMAZ).
 *
 * ── BU MODÜL NE YAPMAZ ────────────────────────────────────────────────────
 *  · Desteklenmeyen MID/TID UYDURMAZ — yalnız ECU'nun bildirdiği kayıtları çözer.
 *  · Bilinmeyen ölçek kimliğini (UAS) TAHMİN ETMEZ; `interpretable:false` der ve
 *    ham değeri gösterir. Yanlış birimle ölçeklenmiş bir sayı, hiç sayı
 *    olmamasından daha tehlikelidir.
 *  · Bilinmeyen ölçekte GEÇTİ/KALDI HÜKMÜ VERMEZ — işaretlilik bilinmeden
 *    karşılaştırma yanlış olabilir.
 */

/* ── Ölçek ve birim (SAE J1979 Ek — Unit and Scaling ID tablosu) ──────────── */

export interface UasDef {
  /** Ham değeri fiziksel değere çeviren çarpan. */
  readonly mul: number;
  /** Çarpımdan SONRA eklenen sabit (yalnız sıcaklıkta kullanılır). */
  readonly offset: number;
  /** Görüntülenecek birim; birimsiz sayımlarda boş string. */
  readonly unit: string;
  /** Ham 16-bit değer İŞARETLİ mi (two's complement). */
  readonly signed: boolean;
}

/**
 * Yalnız KAMU STANDARDINDA net olan ölçek kimlikleri. Listede OLMAYAN bir kimlik
 * tahmin EDİLMEZ — kayıt `interpretable:false` olarak işaretlenir.
 *
 * Bu tablonun eksik olması bir kusur değildir: eksik satır "bilmiyoruz" der,
 * uydurulmuş bir satır ise sessizce yanlış birim üretirdi.
 */
export const UAS_TABLE: Readonly<Record<number, UasDef>> = {
  0x01: { mul: 1,          offset: 0,   unit: '',        signed: false },
  0x02: { mul: 0.1,        offset: 0,   unit: '',        signed: false },
  0x03: { mul: 0.01,       offset: 0,   unit: '',        signed: false },
  0x04: { mul: 0.001,      offset: 0,   unit: '',        signed: false },
  0x07: { mul: 0.25,       offset: 0,   unit: 'rpm',     signed: false },
  0x09: { mul: 1,          offset: 0,   unit: 'km/h',    signed: false },
  0x0A: { mul: 0.122,      offset: 0,   unit: 'mV',      signed: false },
  0x0B: { mul: 0.001,      offset: 0,   unit: 'V',       signed: false },
  0x0C: { mul: 0.01,       offset: 0,   unit: 'V',       signed: false },
  0x0E: { mul: 0.001,      offset: 0,   unit: 'A',       signed: false },
  0x10: { mul: 1,          offset: 0,   unit: 'ms',      signed: false },
  0x11: { mul: 100,        offset: 0,   unit: 'ms',      signed: false },
  0x12: { mul: 1,          offset: 0,   unit: 's',       signed: false },
  0x14: { mul: 1,          offset: 0,   unit: 'Ω',       signed: false },
  0x15: { mul: 1,          offset: 0,   unit: 'kΩ',      signed: false },
  0x16: { mul: 0.1,        offset: -40, unit: '°C',      signed: false },
  0x17: { mul: 0.01,       offset: 0,   unit: 'kPa',     signed: false },
  0x19: { mul: 0.079,      offset: 0,   unit: 'kPa',     signed: false },
  0x1A: { mul: 1,          offset: 0,   unit: 'kPa',     signed: false },
  0x1B: { mul: 10,         offset: 0,   unit: 'kPa',     signed: false },
  0x1C: { mul: 0.01,       offset: 0,   unit: '°',       signed: false },
  0x1D: { mul: 0.5,        offset: 0,   unit: '°',       signed: false },
  0x1E: { mul: 0.0000305,  offset: 0,   unit: 'λ',       signed: false },
  0x21: { mul: 1,          offset: 0,   unit: 'mHz',     signed: false },
  0x22: { mul: 1,          offset: 0,   unit: 'Hz',      signed: false },
  0x23: { mul: 1,          offset: 0,   unit: 'kHz',     signed: false },
  0x24: { mul: 1,          offset: 0,   unit: '',        signed: false },
  0x25: { mul: 1,          offset: 0,   unit: 'km',      signed: false },
  0x27: { mul: 0.01,       offset: 0,   unit: 'g/s',     signed: false },
  0x28: { mul: 1,          offset: 0,   unit: 'g/s',     signed: false },
  0x2F: { mul: 0.01,       offset: 0,   unit: '%',       signed: false },
  0x31: { mul: 0.001,      offset: 0,   unit: 'L',       signed: false },
  0x34: { mul: 1,          offset: 0,   unit: 'dk',      signed: false },
  0x35: { mul: 10,         offset: 0,   unit: 'ms',      signed: false },
  0x36: { mul: 0.01,       offset: 0,   unit: 's',       signed: false },
  /* İŞARETLİ aile (0x80+): iki'nin tümleyeni. İşaretliliği bilmeden yapılan
     karşılaştırma geçti/kaldı hükmünü TERSİNE çevirebilir. */
  0x81: { mul: 1,          offset: 0,   unit: '',        signed: true },
  0x82: { mul: 0.1,        offset: 0,   unit: '',        signed: true },
  0x83: { mul: 0.01,       offset: 0,   unit: '',        signed: true },
  0x84: { mul: 0.001,      offset: 0,   unit: '',        signed: true },
  0x8C: { mul: 0.01,       offset: 0,   unit: 'V',       signed: true },
  0x8E: { mul: 0.001,      offset: 0,   unit: 'A',       signed: true },
  0x90: { mul: 1,          offset: 0,   unit: 'ms',      signed: true },
  0x96: { mul: 0.1,        offset: 0,   unit: '°C',      signed: true },
  0xA8: { mul: 1,          offset: 0,   unit: 'g/s',     signed: true },
  0xAF: { mul: 0.01,       offset: 0,   unit: '%',       signed: true },
};

/* ── Monitör aileleri (SAE J1979 standart MID aralıkları) ─────────────────── */

/**
 * MID → insan okunur aile adı. YALNIZ standartta tanımlı aralıklar adlandırılır;
 * üretici aralığı (0xF0-0xFF) ve tanımsız MID'ler `null` döner ve ekranda ham
 * MID olarak gösterilir. Ada sahip olmamak, sonucun geçersiz olduğu anlamına
 * GELMEZ — yalnız ailesini bilmediğimiz anlamına gelir.
 */
export function mode06MonitorFamily(mid: number): string | null {
  if (mid >= 0x01 && mid <= 0x08) return `O2 sensörü izleme (Banka ${mid <= 0x04 ? 1 : 2}, Sensör ${((mid - 1) % 4) + 1})`;
  if (mid >= 0x09 && mid <= 0x0B) return 'O2 sensörü izleme (ek)';
  if (mid >= 0x21 && mid <= 0x24) return `Katalizör izleme (Banka ${mid - 0x20})`;
  if (mid >= 0x31 && mid <= 0x32) return `EGR izleme (Banka ${mid - 0x30})`;
  if (mid >= 0x39 && mid <= 0x3C) return 'O2 sensör ısıtıcı izleme';
  if (mid >= 0x41 && mid <= 0x43) return 'İkincil hava izleme';
  if (mid === 0x71 || mid === 0x72) return 'EVAP izleme';
  if (mid >= 0xA1 && mid <= 0xA5) return 'Ateşleme kaçırma (misfire) izleme';
  if (mid >= 0xF0) return null;   // üretici tanımlı — ad UYDURULMAZ
  return null;
}

/* ── Bitmask keşfi (Mode 01 PID 00 ile AYNI desen) ────────────────────────── */

/**
 * `06 00` / `06 20` … yanıtındaki desteklenen-MID bitmask'ini çözer.
 *
 * @param baseHex taban MID ('00' · '20' · '40' · '60' · '80' · 'A0')
 * @param dataHex `46 <base>` SOYULMUŞ ≥4 bayt
 * @returns desteklenen MID'ler (2 hane büyük-harf hex). Geçersiz girdide BOŞ küme
 *          (uydurma destek listesi ÜRETİLMEZ).
 */
export function parseMode06SupportedMids(baseHex: string, dataHex: string): Set<string> {
  const out = new Set<string>();
  const clean = (dataHex ?? '').replace(/[^0-9A-Fa-f]/g, '');
  if (clean.length < 8) return out;
  const base = parseInt(baseHex, 16);
  if (Number.isNaN(base)) return out;
  for (let byteIdx = 0; byteIdx < 4; byteIdx++) {
    const byte = parseInt(clean.substring(byteIdx * 2, byteIdx * 2 + 2), 16);
    if (Number.isNaN(byte)) continue;
    for (let bit = 7; bit >= 0; bit--) {
      if (byte & (1 << bit)) {
        const n = base + byteIdx * 8 + (8 - bit);
        out.add(n.toString(16).toUpperCase().padStart(2, '0'));
      }
    }
  }
  return out;
}

/* ── Test kaydı ───────────────────────────────────────────────────────────── */

/**
 * Bir testin sonucu.
 *  · `PASS`/`FAIL` — ECU'nun KENDİ sınırlarına göre; yorum değil, doğrudan sonuç.
 *  · `UNKNOWN`     — ölçek kimliği tanınmadığı için karşılaştırma GÜVENLİ DEĞİL.
 *                    "geçti" SAYILMAZ.
 */
export type Mode06TestResult = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface Mode06Test {
  /** Monitör kimliği (2 hane hex). */
  readonly mid: string;
  /** Test kimliği (2 hane hex). */
  readonly tid: string;
  /** Ölçek kimliği (2 hane hex). */
  readonly uas: string;
  /** Ham 16-bit ölçüm (işaret UYGULANMIŞ). */
  readonly rawValue: number;
  readonly rawMin: number;
  readonly rawMax: number;
  /** Ölçeklenmiş değer; ölçek tanınmıyorsa `null`. */
  readonly value: number | null;
  readonly min: number | null;
  readonly max: number | null;
  /** Birim; ölçek tanınmıyorsa `null`. */
  readonly unit: string | null;
  /** Ölçek kimliği tanındı mı — `false` iken değer ham olarak gösterilmelidir. */
  readonly interpretable: boolean;
  readonly result: Mode06TestResult;
}

function _u16(hi: number, lo: number): number { return (hi << 8) | lo; }
function _signed16(v: number): number { return v > 0x7FFF ? v - 0x10000 : v; }

/**
 * `46` SOYULMUŞ gövdeyi 9 baytlık test kayıtlarına ayrıştırır.
 *
 * FAIL-CLOSED: gövde 9'un katı değilse ARTAN baytlar ATILIR ve `malformed`
 * işaretlenir — kısmi/bozuk bir çerçeveden kayıt UYDURULMAZ. Hiç tam kayıt
 * yoksa liste boş döner ve çağıran bunu "test yok" DEĞİL "okunamadı" sayar.
 */
export function parseMode06Body(bodyHex: string): {
  readonly tests: readonly Mode06Test[];
  readonly malformed: boolean;
} {
  const clean = (bodyHex ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.substring(i, i + 2), 16));
  if (bytes.some((b) => Number.isNaN(b))) return { tests: [], malformed: true };

  const REC = 9;
  const full = Math.floor(bytes.length / REC);
  const malformed = bytes.length === 0 || bytes.length % REC !== 0;

  const tests: Mode06Test[] = [];
  for (let r = 0; r < full; r++) {
    const o = r * REC;
    const midN = bytes[o]!, tidN = bytes[o + 1]!, uasN = bytes[o + 2]!;
    const def = UAS_TABLE[uasN];
    const signed = def?.signed === true;
    const rawV = signed ? _signed16(_u16(bytes[o + 3]!, bytes[o + 4]!)) : _u16(bytes[o + 3]!, bytes[o + 4]!);
    const rawMin = signed ? _signed16(_u16(bytes[o + 5]!, bytes[o + 6]!)) : _u16(bytes[o + 5]!, bytes[o + 6]!);
    const rawMax = signed ? _signed16(_u16(bytes[o + 7]!, bytes[o + 8]!)) : _u16(bytes[o + 7]!, bytes[o + 8]!);

    const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
    const scale = (x: number) => Number((x * def!.mul + def!.offset).toFixed(6));

    /* ÖLÇEK TANINMIYORSA HÜKÜM YOK: işaretliliği bilmeden yapılan karşılaştırma
       geçti/kaldı sonucunu TERSİNE çevirebilir. */
    const result: Mode06TestResult = def === undefined
      ? 'UNKNOWN'
      : (rawV >= rawMin && rawV <= rawMax ? 'PASS' : 'FAIL');

    tests.push({
      mid: hex2(midN), tid: hex2(tidN), uas: hex2(uasN),
      rawValue: rawV, rawMin, rawMax,
      value: def ? scale(rawV) : null,
      min:   def ? scale(rawMin) : null,
      max:   def ? scale(rawMax) : null,
      unit:  def ? def.unit : null,
      interpretable: def !== undefined,
      result,
    });
  }

  return { tests, malformed };
}
