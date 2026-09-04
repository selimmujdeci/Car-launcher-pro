/**
 * sonicDescriptor.ts — MUSIC F17 · SESTEN ölçülen betimleyicinin sözleşmesi (SAF).
 *
 * ── NE DEĞİŞTİ (F10.1 → F17) ─────────────────────────────────────────────
 * F10.1 bir ETİKET okumasıydı: ID3 `TBPM` alanında üreticinin yazdığı sayı.
 * F17 ilk kez dosyayı DECODE eder ve dalga formunun KENDİSİNİ ölçer. Bu yüzden
 * ve YALNIZ bu yüzden `MEASURED_AUDIO` provenance'ı ilk kez kullanılabilir.
 *
 * ── DÜRÜSTLÜK SINIRLARI (pazarlıksız) ────────────────────────────────────
 *   · **MOOD ÜRETİLMEZ.** Dalga formu bir ruh hâli değildir; "hüzünlü/neşeli"
 *     iddiası psikolojik bir yorumdur ve ölçüm DEĞİLDİR. `mood` daima `null`.
 *   · **BPM yalnız BELİRGİN tepeden gelir.** Otokorelasyon tepesi zayıfsa
 *     (`tempoConfidence < TEMPO_CONFIDENCE_MIN`) tempo YOK sayılır — zayıf bir
 *     tepe "tempo bulundu" demek değildir.
 *   · **`energy` bir PROXY'dir ve öyle adlandırılır:** girdileri (RMS, crest,
 *     spektral merkez, onset yoğunluğu, tempo) GERÇEK ölçümlerdir; bunları tek
 *     bir 0..1 sayısına indirgemek bir YORUMdur. Provenance `MEASURED_AUDIO`
 *     kalır çünkü GİRDİLER ölçülmüştür; iddia dili F10'un güven kapısına tabidir.
 *   · Başlık/sanatçı/dosya adı bu modele GİRMEZ — yalnız sayısal ölçüm.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import {
  makeTraitEvidence, NO_TRAIT_EVIDENCE, type MusicTraitEvidence,
} from '../traits/musicTraitEvidence';

/**
 * Betimleyici şeması. Ölçüm kuralı/eşiği değişince ARTAR ve eski önbellek
 * satırları bir daha OKUNMAZ (bayat kanıt kullanılmaz).
 */
export const SONIC_SCHEMA_VERSION = 1;

/** Tempo tepesi bu belirginliğin altındaysa ÖLÇÜM SAYILMAZ. */
export const TEMPO_CONFIDENCE_MIN = 0.35;
/** Bu güvenin üstünde tempo "güçlü ölçüm" sayılır (kesin dil kapısı). */
export const TEMPO_CONFIDENCE_STRONG = 0.55;
/** Bu süreden az ses çözümlendiyse ölçüm GÜÇLÜ sayılmaz. */
export const STRONG_ANALYSIS_MS = 8000;
/** Kompakt tanımlayıcının bant sayısı — native ile BİREBİR aynı olmalı. */
export const SONIC_BAND_COUNT = 8;

/** Ölçümün neden yapılamadığı (native ile aynı sözlük). */
export type SonicFailureReason =
  | 'NO_AUDIO_TRACK' | 'UNSUPPORTED_CODEC' | 'DECODE_FAILED'
  | 'TIMEOUT' | 'TOO_SHORT' | 'SILENT' | 'CANCELLED';

/**
 * Bir parçanın ÖLÇÜLEN sonic betimleyicisi.
 *
 * Tüm alanlar gerçek ölçümdür; hiçbiri türetilmiş bir tahmin değildir.
 * `tempoBpm` yalnız güven eşiği geçilirse doludur.
 */
export interface SonicDescriptor {
  readonly schema: number;
  /** Analizin koştuğu örnekleme hızı (decimate edilmiş). */
  readonly sampleRate: number;
  /** GERÇEKTEN çözümlenen ses süresi — parçanın tamamı değildir. */
  readonly analyzedMs: number;
  readonly peakDbfs: number;
  readonly rmsDbfs: number;
  readonly crestDb: number;
  readonly zeroCrossingRate: number;
  readonly spectralCentroidHz: number;
  readonly spectralRolloffHz: number;
  readonly spectralFlux: number;
  readonly onsetRate: number;
  /** Güven eşiğini GEÇEN tempo; geçmiyorsa `null` (uydurma YOK). */
  readonly tempoBpm: number | null;
  readonly tempoConfidence: number;
  /** 8 bantlık normalize enerji vektörü — benzerliğin taşıyıcısı. */
  readonly bands: readonly number[];
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Ham native satırının şekli (yalnız okunan alanlar). */
export interface SonicAnalysisInput {
  readonly analyzed?: boolean;
  readonly reason?: string;
  readonly sampleRate?: number | null;
  readonly analyzedMs?: number | null;
  readonly peakDbfs?: number | null;
  readonly rmsDbfs?: number | null;
  readonly crestDb?: number | null;
  readonly zeroCrossingRate?: number | null;
  readonly spectralCentroidHz?: number | null;
  readonly spectralRolloffHz?: number | null;
  readonly spectralFlux?: number | null;
  readonly onsetRate?: number | null;
  readonly tempoBpm?: number | null;
  readonly tempoConfidence?: number | null;
  readonly bands?: readonly unknown[] | null;
}

/**
 * Ham ölçümü betimleyiciye çevirir — **eksik/bozuk ölçüm kanıt SAYILMAZ.**
 *
 * Native tarafın "analyzed" demesi yetmez: alanlar gerçekten sayı olmalı,
 * bant vektörü tam uzunlukta olmalı ve süre anlamlı olmalıdır. Aksi hâlde
 * `null` döner ve çağıran hiçbir kanıt üretmez (fail-closed).
 */
export function makeSonicDescriptor(row: SonicAnalysisInput): SonicDescriptor | null {
  if (row.analyzed !== true) return null;
  if (typeof row.reason === 'string' && row.reason !== 'OK') return null;

  const sampleRate = num(row.sampleRate);
  const analyzedMs = num(row.analyzedMs);
  const peakDbfs = num(row.peakDbfs);
  const rmsDbfs = num(row.rmsDbfs);
  const crestDb = num(row.crestDb);
  const zcr = num(row.zeroCrossingRate);
  const centroid = num(row.spectralCentroidHz);
  const rolloff = num(row.spectralRolloffHz);
  const flux = num(row.spectralFlux);
  const onsetRate = num(row.onsetRate);

  if (sampleRate === null || sampleRate <= 0) return null;
  if (analyzedMs === null || analyzedMs < 1000) return null;
  if (rmsDbfs === null || peakDbfs === null || crestDb === null) return null;
  if (centroid === null || rolloff === null || zcr === null) return null;
  if (flux === null || onsetRate === null) return null;

  const rawBands = Array.isArray(row.bands) ? row.bands : [];
  if (rawBands.length !== SONIC_BAND_COUNT) return null;
  const bands: number[] = [];
  for (const b of rawBands) {
    const v = num(b);
    if (v === null || v < 0) return null;
    bands.push(v);
  }
  const bandSum = bands.reduce((a, b) => a + b, 0);
  /* Toplamı sıfır olan bir "spektrum" ölçüm değildir. */
  if (!(bandSum > 0)) return null;

  const tempoConfidence = clamp01(num(row.tempoConfidence) ?? 0);
  const rawTempo = num(row.tempoBpm);
  /* Eşiğin altındaki tepe TEMPO DEĞİLDİR — burada düşürülür, çağıran atlayamaz. */
  const tempoBpm = rawTempo !== null && rawTempo >= 40 && rawTempo <= 250
    && tempoConfidence >= TEMPO_CONFIDENCE_MIN
    ? Math.round(rawTempo * 10) / 10
    : null;

  return Object.freeze({
    schema: SONIC_SCHEMA_VERSION,
    sampleRate,
    analyzedMs,
    peakDbfs,
    rmsDbfs,
    crestDb,
    zeroCrossingRate: zcr,
    spectralCentroidHz: centroid,
    spectralRolloffHz: rolloff,
    spectralFlux: flux,
    onsetRate,
    tempoBpm,
    tempoConfidence,
    bands: Object.freeze(bands.map((b) => b / bandSum)),
  });
}

/* ── Enerji PROXY'si — girdiler ölçüm, birleştirme yorumdur ──────────────── */

/** Doğrusal eşleme + 0..1 sıkıştırma. */
function ramp(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0.5;
  return clamp01((v - lo) / (hi - lo));
}

/**
 * Ölçülen sinyallerden enerji proxy'si (0..1).
 *
 * Ağırlıklar bilinçli olarak KABADIR: elimizdeki ölçümden daha ince bir ayrım
 * iddia etmek, kanıttan fazlasını söylemek olurdu.
 *   · RMS seviyesi — yüksek ortalama seviye = yoğun miks.
 *   · Crest (tepe−RMS) — DÜŞÜK crest = sıkıştırılmış/yoğun = daha enerjik.
 *   · Spektral merkez — parlaklık.
 *   · Onset yoğunluğu — ritmik olay sıklığı.
 *   · Tempo — yalnız GÜVENİLİR ölçüldüyse ağırlığa girer.
 */
export function sonicEnergyProxy(d: SonicDescriptor): number {
  const loudness = ramp(d.rmsDbfs, -32, -8);
  const density = 1 - ramp(d.crestDb, 6, 22);
  const brightness = ramp(d.spectralCentroidHz, 500, 3500);
  const onset = ramp(d.onsetRate, 0.4, 4.0);

  let acc = loudness * 0.28 + density * 0.22 + brightness * 0.22 + onset * 0.28;
  let weight = 1;
  if (d.tempoBpm !== null) {
    const tempo = ramp(d.tempoBpm, 60, 170);
    /* Tempo ölçüldüyse baskın sinyaldir ama TEK BAŞINA karar vermez. */
    acc = acc * 0.6 + tempo * 0.4;
    weight = 1;
  }
  return clamp01(acc / weight);
}

/**
 * Betimleyiciyi kanonik `MusicTraitEvidence`e çevirir.
 *
 * F10 modeli YENİDEN YAZILMAZ: F17 yalnız YENİ ve DAHA GÜÇLÜ bir provenance
 * besler; birleştirme/tavan kuralları `musicTraitEvidence` içindedir.
 *
 * · `mood` DAİMA `null` (F17 sınırı — dalga formu ruh hâli değildir).
 * · `HIGH` güven yalnız GÜÇLÜ tempo + yeterli süre çözümlendiğinde verilir.
 */
export function descriptorToTraitEvidence(
  d: SonicDescriptor | null,
  o: { readonly observedAtMs?: number | null } = {},
): MusicTraitEvidence {
  if (d === null) return NO_TRAIT_EVIDENCE;

  const strong = d.analyzedMs >= STRONG_ANALYSIS_MS
    && d.tempoBpm !== null
    && d.tempoConfidence >= TEMPO_CONFIDENCE_STRONG;

  const signals: string[] = ['audio:measured', `len:${Math.round(d.analyzedMs / 1000)}s`];
  if (d.tempoBpm !== null) signals.push('tempo:measured');
  if (d.spectralCentroidHz > 2500) signals.push('spectrum:bright');

  return makeTraitEvidence({
    provenance: 'MEASURED_AUDIO',
    sourceId: 'sonic.analysis',
    energy: sonicEnergyProxy(d),
    tempoBpm: d.tempoBpm,
    /* Dalga formundan ruh hâli ÇIKARILMAZ. */
    mood: null,
    confidence: strong ? 'HIGH' : 'MEDIUM',
    observedAtMs: o.observedAtMs ?? null,
    signals,
  });
}

/* ── Benzerlik — F18 Smart Radio'nun aday politikası bunu kullanır ───────── */

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!(na > 0) || !(nb > 0)) return 0;
  return clamp01(dot / Math.sqrt(na * nb));
}

/**
 * İki ölçüm arasındaki sonic benzerlik (0..1).
 *
 * Yalnız İKİ TARAFTA DA ölçüm varsa hesaplanır; biri eksikse `null` döner —
 * "benzer" iddiası kanıtsız KURULMAZ.
 */
export function sonicSimilarity(
  a: SonicDescriptor | null, b: SonicDescriptor | null,
): number | null {
  if (a === null || b === null) return null;
  if (a.schema !== b.schema) return null;

  const spectral = cosine(a.bands, b.bands);
  const energy = 1 - Math.abs(sonicEnergyProxy(a) - sonicEnergyProxy(b));
  const brightness = 1 - clamp01(
    Math.abs(a.spectralCentroidHz - b.spectralCentroidHz) / 3000,
  );

  /* Tempo YALNIZ iki tarafta da ölçüldüyse karşılaştırılır. */
  if (a.tempoBpm !== null && b.tempoBpm !== null) {
    const tempo = 1 - clamp01(Math.abs(a.tempoBpm - b.tempoBpm) / 60);
    return clamp01(spectral * 0.35 + energy * 0.25 + brightness * 0.15 + tempo * 0.25);
  }
  return clamp01(spectral * 0.45 + energy * 0.35 + brightness * 0.20);
}
