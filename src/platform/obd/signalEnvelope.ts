/**
 * signalEnvelope — Sinyal Zarfı + Confidence Modeli (OBD-OS-F4-2).
 *
 * KÖK PROBLEM ("0 değer" ≠ "no-data"): OBD'de bir sinyalin 0 olması İKİ AYRI ŞEY olabilir:
 *   (a) gerçekten sıfır — araç duruyor, hız 0. KANITTIR.
 *   (b) veri yok — ECU o PID'i vermedi, adaptör NO DATA döndü, paket düştü. KANIT DEĞİLDİR.
 * Bu ikisini karıştırmak, teşhisin en sinsi hatasıdır: "yağ basıncı 0" diye alarm çalarsın
 * (aslında sensör okunamamıştır) ya da "hız 0, araç duruyor" diye Mode 04 yazmaya izin
 * verirsin (aslında hız bilinmiyordur — F0-6 WriteGate bunu zaten fail-closed reddediyor).
 *
 * Bu modül her sinyali bir ZARFA sarar: değerin YANINDA durumu, tazeliği, kaynağı ve
 * KANITTAN TÜREYEN güveni taşır. Ham sayı asla tek başına dolaşmaz.
 *
 * ZERO-TRUST (anayasa): güvenilmez aftermarket telemetri varsayılır. Bir sinyale güvenmek
 * için SEBEP gerekir; sebep yoksa güven DÜŞÜKTÜR — sıfır değil, DÜŞÜK (fail-soft: sinyali
 * atmayız, ama ona dayanarak karar alırken bunu biliriz).
 *
 * SAF: modül-durumu yok, I/O yok, zaman enjekte edilir — tam test edilebilir.
 */

/** Sinyalin durumu — "değer" ile "kanıt" arasındaki farkı taşır. */
export type SignalState =
  | 'valid'        // gerçek ölçüm (0 OLABİLİR — sıfır bir değerdir!)
  | 'stale'        // bir zamanlar geçerliydi, artık tazeliğini yitirdi
  | 'suspect'      // fiziksel olarak şüpheli (sanitize sınırları dışında / imkânsız sıçrama)
  | 'no_data'      // ECU yanıt vermedi / paket düştü — DEĞER YOK ("0" DEĞİL)
  | 'unsupported'; // araç bu sinyali HİÇ vermiyor — arıza DEĞİL, araç sınırı

export type SignalSource = 'obd' | 'can' | 'gps' | 'derived' | 'mock';

export interface SignalEnvelope {
  /** Fiziksel değer. state 'no_data'/'unsupported' iken ZORUNLU null (0 DEĞİL). */
  value: number | null;
  state: SignalState;
  /** 0..1 — KANITTAN türer (tazelik × durum). Sabit değildir. */
  confidence: number;
  source: SignalSource;
  /** Değerin ölçüldüğü an (Unix ms). 0 = hiç ölçülmedi. */
  updatedAt: number;
  /** Ölçümün yaşı (ms) — `nowMs - updatedAt`. */
  ageMs: number;
  unit: string;
}

/** Bu yaştan sonra sinyal tazeliğini yitirir (hot-path 3 Hz → 3 sn = ~9 kayıp paket). */
export const SIGNAL_STALE_MS = 3_000;
/** Bu yaştan sonra sinyal karar için KULLANILAMAZ (güven ~0). */
export const SIGNAL_DEAD_MS = 15_000;

export interface WrapSignalInput {
  /** Ham değer. `null`/`NaN` → no_data. Negatif "desteklenmiyor" konvansiyonu için `negativeMeansUnsupported`. */
  raw: number | null | undefined;
  source: SignalSource;
  unit: string;
  updatedAt: number;
  nowMs: number;
  /**
   * OBD konvansiyonu: -1 = "araç bu PID'i vermiyor". true (varsayılan) → negatif değer
   * `unsupported` olur. ⚠️ Gerçekten negatif olabilen sinyallerde (yakıt trim, ateşleme
   * avansı, ortam sıcaklığı) MUTLAKA false verilmeli — yoksa geçerli -5°C "desteklenmiyor"
   * sanılır (sessiz veri kaybı).
   */
  negativeMeansUnsupported?: boolean;
  /** Fiziksel geçerlilik aralığı (sanitize). Dışına çıkan değer 'suspect' olur. */
  min?: number;
  max?: number;
}

/**
 * Ham sinyali zarfa sarar. `0` ile `no-data` ASLA karışmaz.
 */
export function wrapSignal(input: WrapSignalInput): SignalEnvelope {
  const {
    raw, source, unit, updatedAt, nowMs,
    negativeMeansUnsupported = true,
    min, max,
  } = input;

  const ageMs = updatedAt > 0 ? Math.max(0, nowMs - updatedAt) : Number.POSITIVE_INFINITY;

  const dead = (state: SignalState): SignalEnvelope => ({
    value: null,              // ← "0" DEĞİL: değer YOK demek, sıfır demek DEĞİL
    state,
    confidence: 0,
    source,
    updatedAt,
    ageMs: Number.isFinite(ageMs) ? ageMs : 0,
    unit,
  });

  // 1) Hiç veri yok / ölçülmedi.
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return dead('no_data');
  if (updatedAt <= 0) return dead('no_data');

  // 2) OBD "-1 = desteklenmiyor" konvansiyonu (yalnız istendiğinde).
  if (negativeMeansUnsupported && raw < 0) return dead('unsupported');

  // 3) Fiziksel sınır dışı → şüpheli (değer KORUNUR ama güven düşük — fail-soft;
  //    atmak yerine işaretlemek, sonraki katmana karar hakkı bırakır).
  const outOfRange =
    (typeof min === 'number' && raw < min) || (typeof max === 'number' && raw > max);
  if (outOfRange) {
    return { value: raw, state: 'suspect', confidence: 0.2, source, updatedAt, ageMs, unit };
  }

  // 4) Tazelik → güven. Bu, "kanıttan türeyen güven"in somut hali.
  if (ageMs >= SIGNAL_DEAD_MS) {
    return { value: raw, state: 'stale', confidence: 0, source, updatedAt, ageMs, unit };
  }
  if (ageMs >= SIGNAL_STALE_MS) {
    // Taze ile ölü arasında lineer düşüş.
    const span = SIGNAL_DEAD_MS - SIGNAL_STALE_MS;
    const conf = Math.max(0, 1 - (ageMs - SIGNAL_STALE_MS) / span);
    return { value: raw, state: 'stale', confidence: Number(conf.toFixed(3)), source, updatedAt, ageMs, unit };
  }

  // 5) Taze ve geçerli. NOT: raw === 0 BURAYA düşer — sıfır GEÇERLİ BİR DEĞERDİR.
  const conf = source === 'mock' ? 0.1 : 1;   // mock veri karar için kanıt sayılmaz
  return { value: raw, state: 'valid', confidence: conf, source, updatedAt, ageMs, unit };
}

/** Sinyal karar almak için KULLANILABİLİR mi? (fail-closed: şüpheli/ölü → hayır) */
export function isDecisionGrade(sig: SignalEnvelope, minConfidence = 0.5): boolean {
  return sig.value !== null && sig.state === 'valid' && sig.confidence >= minConfidence;
}

/**
 * "Bu sinyal sıfır mı?" sorusunun DÜRÜST cevabı.
 * `null` = bilinmiyor (no_data/unsupported) — "sıfır" DEĞİL.
 * Bu ayrım olmadan "hız 0 → araç duruyor" gibi TEHLİKELİ çıkarımlar yapılır.
 */
export function isZero(sig: SignalEnvelope): boolean | null {
  if (sig.value === null || sig.state === 'no_data' || sig.state === 'unsupported') return null;
  return sig.value === 0;
}
