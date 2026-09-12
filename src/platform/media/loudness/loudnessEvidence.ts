/**
 * loudnessEvidence.ts — MUSIC F19 · Seviye tutarlılığının SAF sözleşmesi.
 *
 * ── ÇÖZÜLEN GERÇEK SORUN ─────────────────────────────────────────────────
 * Parça değişince biri patlıyor, öteki duyulmuyor. Bunun nedeni kullanıcı
 * sesi DEĞİL, içeriğin üretim seviyesidir. F19 bunu **ölçülmüş/etiketlenmiş
 * kanıtla** düzeltir.
 *
 * ── OTORİTE SINIRI (Cross-Domain §1) ─────────────────────────────────────
 * **İkinci bir ses otoritesi KURULMAZ.** Tek ses formülü `volumePolicy`dedir:
 *   `effective = userVolume × duckLevel × safetyAttenuation × sourceNormalization`
 * F19 yalnız o formülün ZATEN var olan `sourceNormalization` alanını besler.
 * Kullanıcı sesine (`userVolume`) DOKUNULMAZ, duck'a DOKUNULMAZ, DSP güvenlik
 * preamp'ine (ayrı katsayı, native DSP zincirinde) DOKUNULMAZ.
 *
 * ── DÜRÜSTLÜK SINIRLARI ──────────────────────────────────────────────────
 *   · **LUFS UYDURULMAZ.** Elimizde ya bir ETİKET (ReplayGain/R128) ya da
 *     F17'nin ölçtüğü RMS vardır. İkisi de LUFS DEĞİLDİR ve öyle adlandırılmaz.
 *   · **Kanıt yoksa çarpan tam olarak 1.0'dır** (nötr) — tahmin edilmez.
 *   · **YALNIZ KISILIR, hiç yükseltilmez.** Yükseltmek headroom tüketir ve
 *     clipping üretebilir; sessiz parçayı yükseltmek F19'un kapsamı DIŞINDADIR
 *     ve bu açıkça bir sınır olarak yazılır.
 *   · Kısma SINIRLIDIR (`MAX_ATTENUATION_DB`) — kanıt saçmalasa bile ses
 *     kaybolmaz.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

/** Seviye kanıtının kaynağı — sıra AYNI ZAMANDA güç sırasıdır. */
export type LoudnessProvenance =
  /** Dosyada ReplayGain/R128 etiketi var (üretim aracının yazdığı değer). */
  | 'TAG_REPLAYGAIN'
  | 'TAG_R128'
  /** F17'nin GERÇEKTEN ölçtüğü RMS seviyesi (LUFS DEĞİL). */
  | 'MEASURED_RMS'
  | 'NONE';

export interface LoudnessEvidence {
  readonly provenance: LoudnessProvenance;
  /**
   * Kaynağın önerdiği kazanç (dB). Negatif = "bu parça hedefe göre YÜKSEK".
   * Kanıt yoksa `null`.
   */
  readonly gainDb: number | null;
  /** Bilinen tepe (1.0 = tam ölçek); yoksa `null`. */
  readonly peak: number | null;
  /** LAB teşhisi için kaynak etiketi — içerik adı DEĞİL. */
  readonly sourceId: string;
}

export const NO_LOUDNESS_EVIDENCE: LoudnessEvidence = Object.freeze({
  provenance: 'NONE' as const, gainDb: null, peak: null, sourceId: 'none',
});

/**
 * Ölçülen RMS'in kıyaslandığı referans seviye (dBFS).
 *
 * ⚠️ Bu bir **LUFS hedefi DEĞİLDİR** ve öyle sunulamaz: LUFS algısal
 * ağırlıklı bir ölçüdür, buradaki değer düz RMS'tir. Referans, tipik modern
 * masterların RMS aralığından seçilmiş MÜHENDİSLİK sabitidir; sahada
 * kalibre edilecektir (kütük maddesi).
 */
export const RMS_REFERENCE_DBFS = -14;

/** Kısma tavanı — kanıt saçmalasa bile ses kaybolmaz. */
export const MAX_ATTENUATION_DB = 12;

/** Bu eşiğin altındaki fark DUYULMAZ; boşuna çarpan değiştirilmez. */
export const MIN_ADJUSTMENT_DB = 1;

/** Çarpanın inebileceği EN DÜŞÜK değer (≈ −12 dB). */
export const MIN_NORMALIZATION = 0.25;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Gömülü etiketten kanıt.
 *
 * Etiket makul aralıkta değilse kanıt SAYILMAZ (bozuk etiket bir ölçüm
 * değildir). Album kazancı da kabul edilir ama kaynağı ayrı etiketlenir.
 */
export function fromGainTag(input: {
  readonly gainDb?: number | null;
  readonly gainPeak?: number | null;
  readonly gainSource?: string | null;
}): LoudnessEvidence {
  const source = (input.gainSource ?? 'NONE').toUpperCase();
  if (source === 'NONE') return NO_LOUDNESS_EVIDENCE;
  if (!isNum(input.gainDb)) return NO_LOUDNESS_EVIDENCE;
  if (input.gainDb < -60 || input.gainDb > 60) return NO_LOUDNESS_EVIDENCE;

  const r128 = source.startsWith('R128');
  const peak = isNum(input.gainPeak) && input.gainPeak > 0 && input.gainPeak <= 2
    ? input.gainPeak : null;

  return Object.freeze({
    provenance: (r128 ? 'TAG_R128' : 'TAG_REPLAYGAIN') as LoudnessProvenance,
    gainDb: input.gainDb,
    peak,
    sourceId: source.toLowerCase(),
  });
}

/**
 * F17 ölçümünden kanıt.
 *
 * `rmsDbfs` GERÇEK bir ölçümdür; ondan türetilen kazanç bir ÖNERİDİR ve
 * referans sabiti kalibre edilene kadar öyle kalır. Etiket varsa etiket
 * KAZANIR (üretim aracının kararı bizim RMS yaklaşımımızdan güçlüdür).
 */
export function fromMeasuredRms(input: {
  readonly rmsDbfs?: number | null;
  readonly peakDbfs?: number | null;
}): LoudnessEvidence {
  if (!isNum(input.rmsDbfs)) return NO_LOUDNESS_EVIDENCE;
  if (input.rmsDbfs < -60 || input.rmsDbfs > 0) return NO_LOUDNESS_EVIDENCE;

  const peak = isNum(input.peakDbfs) && input.peakDbfs <= 0
    ? Math.pow(10, input.peakDbfs / 20) : null;

  return Object.freeze({
    provenance: 'MEASURED_RMS' as LoudnessProvenance,
    /* Hedeften YÜKSEKSE negatif kazanç önerilir. */
    gainDb: RMS_REFERENCE_DBFS - input.rmsDbfs,
    peak,
    sourceId: 'sonic.rms',
  });
}

const RANK: Readonly<Record<LoudnessProvenance, number>> = Object.freeze({
  TAG_REPLAYGAIN: 3, TAG_R128: 3, MEASURED_RMS: 2, NONE: 0,
});

/** Güçlü kanıt kazanır; eşitlikte ilki. Birleştirme kanıt ÜRETMEZ. */
export function strongerLoudness(a: LoudnessEvidence, b: LoudnessEvidence): LoudnessEvidence {
  return RANK[b.provenance] > RANK[a.provenance] ? b : a;
}

export interface NormalizationResult {
  /** `volumePolicy.sourceNormalization`e yazılacak çarpan (0.25..1). */
  readonly factor: number;
  /** Uygulanan kısma (dB, ≤ 0). Kanıt yoksa 0. */
  readonly appliedDb: number;
  /** Kanıtın istediği ham kazanç (dB); yoksa `null`. */
  readonly requestedDb: number | null;
  readonly provenance: LoudnessProvenance;
  /** Tavan/eşik nedeniyle istenen değer KISITLANDI mı. */
  readonly clamped: boolean;
  /** Neden çarpan uygulanmadı (uygulandıysa `null`). */
  readonly bypassReason: 'NO_EVIDENCE' | 'BELOW_THRESHOLD' | 'BOOST_NOT_SUPPORTED' | null;
}

export const NEUTRAL_NORMALIZATION: NormalizationResult = Object.freeze({
  factor: 1, appliedDb: 0, requestedDb: null,
  provenance: 'NONE' as const, clamped: false, bypassReason: 'NO_EVIDENCE' as const,
});

/**
 * Kanıttan SINIRLI bir normalizasyon çarpanı üretir.
 *
 * Kurallar burada zorlanır — çağıran atlayamaz:
 *   1. Kanıt yoksa çarpan 1.0 (nötr).
 *   2. Pozitif kazanç (yükseltme) UYGULANMAZ → çarpan 1.0. Bu bilinçli bir
 *      sınırdır: yükseltmek headroom tüketir ve clipping üretebilir.
 *   3. `MIN_ADJUSTMENT_DB` altındaki fark DUYULMAZ → çarpan 1.0 (gereksiz
 *      kaynak-değişimi zıplaması üretilmez).
 *   4. Kısma `MAX_ATTENUATION_DB` ile SINIRLIDIR.
 */
export function computeNormalization(evidence: LoudnessEvidence): NormalizationResult {
  if (evidence.provenance === 'NONE' || !isNum(evidence.gainDb)) {
    return NEUTRAL_NORMALIZATION;
  }
  const requestedDb = evidence.gainDb;

  if (requestedDb >= 0) {
    /* Yükseltme F19 kapsamı DIŞINDADIR (dürüst sınır). */
    return Object.freeze({
      factor: 1, appliedDb: 0, requestedDb,
      provenance: evidence.provenance, clamped: false,
      bypassReason: 'BOOST_NOT_SUPPORTED' as const,
    });
  }
  if (Math.abs(requestedDb) < MIN_ADJUSTMENT_DB) {
    return Object.freeze({
      factor: 1, appliedDb: 0, requestedDb,
      provenance: evidence.provenance, clamped: false,
      bypassReason: 'BELOW_THRESHOLD' as const,
    });
  }

  const clamped = Math.abs(requestedDb) > MAX_ATTENUATION_DB;
  const appliedDb = clamped ? -MAX_ATTENUATION_DB : requestedDb;
  const raw = Math.pow(10, appliedDb / 20);
  /* Kuantalama: küçük dalgalanmalar aynı çarpanı üretir (pumping önlenir). */
  const factor = Math.max(MIN_NORMALIZATION, Math.min(1, Math.round(raw * 50) / 50));

  return Object.freeze({
    factor, appliedDb, requestedDb,
    provenance: evidence.provenance, clamped, bypassReason: null,
  });
}
