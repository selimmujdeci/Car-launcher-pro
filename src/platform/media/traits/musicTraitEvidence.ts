/**
 * musicTraitEvidence.ts — MUSIC F10 · Parça KARAKTER kanıtı sözleşmesi (SAF).
 *
 * ── ÖLÇÜLEN GERÇEK (F10 denetimi → F10.1 kapanışı) ────────────────────────
 * F10'da hiçbir kaynak gerçek kanıt vermiyordu. F10.1 ikisini BAĞLADI:
 *   · `EMBEDDED_METADATA` — dosyaya gömülü ID3 `TBPM` / Vorbis `BPM` (media3).
 *   · `LIBRARY_METADATA`  — MediaStore `GENRE` (API 30+) ve `YEAR`.
 * Bağlanmayanlar (uydurulmadı):
 *   · YouTube/Piped: başlık · yükleyen · süre · küçük resim → trait ALANI YOK.
 *   · Spotify: `audio-features` sözleşmesi bu turda DOĞRULANAMADI → UNVERIFIED,
 *     varmış gibi davranılmadı.
 *   · `MEASURED_AUDIO`: ses analizi YAPILMIYOR → bu provenance KULLANILMIYOR.
 *
 * Bu yüzden F10'un birinci kuralı şudur: **kanıt uydurulmaz.** Model, gerçek
 * ölçüm geldiğinde (sağlayıcı portu veya MediaStore GENRE) hiçbir tüketiciyi
 * değiştirmeden güçlenecek biçimde tasarlanmıştır; bugün elde YALNIZ zayıf ve
 * AÇIKÇA ETİKETLİ türetimler vardır.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · `tempoBpm` YALNIZ gerçek ölçümden gelir. Süre veya başlık sözcüğünden
 *     BPM ÜRETİLEMEZ (tip düzeyinde değil, birleştirme kuralında zorlanır).
 *   · Sezgisel (heuristic) kanıt `HEURISTIC_TEXT` provenance'ı ve en fazla
 *     `LOW` güven taşır; kesin gerçek gibi SUNULAMAZ.
 *   · Birleştirme güveni ASLA YÜKSELTMEZ: iki zayıf kanıt güçlü bir kanıt etmez.
 *   · Parça/sanatçı ADI bu modelde TAŞINMAZ — yalnız etiketlenmiş sinyal adları.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

/** Kanıtın nereden geldiği. Sıra AYNI ZAMANDA güç sırasıdır (büyük = güçlü). */
export type TraitProvenance =
  /**
   * Sesin KENDİSİ ölçüldü (offline audio analysis). Bugün CarOS'ta YOKTUR ve
   * ölçüm yapılmadan bu değer KULLANILAMAZ.
   */
  | 'MEASURED_AUDIO'
  /** Sağlayıcının GERÇEK ölçümü (audio-features benzeri) — bugün doğrulanmadı. */
  | 'PROVIDER_METADATA'
  /**
   * MUSIC F10.1 — dosyaya GÖMÜLÜ etiket (ID3 `TBPM` · Vorbis `BPM`).
   * Bu bir ETİKET okumasıdır: gerçek ve ölçülebilir ama üreticinin yazdığı
   * değerdir; ses analizi DEĞİLDİR.
   */
  | 'EMBEDDED_METADATA'
  /** Kütüphane metadata'sı (MediaStore `GENRE` / `YEAR`). */
  | 'LIBRARY_METADATA'
  /** Süreden türetilen ZAYIF sinyal — ölçüm değil, çıkarım. */
  | 'DERIVED_DURATION'
  /** Başlık/sanatçı sözcük ipucu — KESİN DEĞİL, yanılabilir. */
  | 'HEURISTIC_TEXT'
  | 'NONE';

/** Kanonik güç sırası (F10.1 §2). Büyük = güçlü. */
const PROVENANCE_RANK: Readonly<Record<TraitProvenance, number>> = Object.freeze({
  MEASURED_AUDIO: 6,
  PROVIDER_METADATA: 5,
  EMBEDDED_METADATA: 4,
  LIBRARY_METADATA: 3,
  DERIVED_DURATION: 2,
  HEURISTIC_TEXT: 1,
  NONE: 0,
});

/**
 * BPM yazabilen kaynaklar.
 *
 * `LIBRARY_METADATA` (tür/yıl) BURADA DEĞİLDİR: türden BPM türetmek uydurmadır.
 * Süre ve başlık da yazamaz — bu kural modelde zorlanır, çağıran atlayamaz.
 */
export function mayCarryTempo(p: TraitProvenance): boolean {
  return p === 'MEASURED_AUDIO' || p === 'PROVIDER_METADATA' || p === 'EMBEDDED_METADATA';
}

export type TraitConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

const CONFIDENCE_RANK: Readonly<Record<TraitConfidence, number>> = Object.freeze({
  HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0,
});

/** Sezgisel kaynağın çıkabileceği EN YÜKSEK güven — tavan pazarlıksızdır. */
export const MAX_HEURISTIC_CONFIDENCE: TraitConfidence = 'LOW';

export type MoodCharacter = 'CALM' | 'NEUTRAL' | 'ENERGETIC';

export interface MusicTraitEvidence {
  /** 0..1 — yüksek = daha enerjik. Kanıt yoksa `null` (sahte 0.5 YOK). */
  readonly energy: number | null;
  /** Gerçek BPM ölçümü; türetilmiş kaynaklarda DAİMA `null`. */
  readonly tempoBpm: number | null;
  readonly mood: MoodCharacter | null;
  readonly confidence: TraitConfidence;
  readonly provenance: TraitProvenance;
  /** Kanıtı üreten port kimliği (LAB teşhisi) — içerik adı DEĞİL. */
  readonly sourceId: string;
  /** Ölçüm anı; bilinmiyorsa `null`. Tazelik bundan hesaplanır. */
  readonly observedAtMs: number | null;
  /** Hangi ipuçlarının tuttuğu — ETİKET adları (başlık/sanatçı metni DEĞİL). */
  readonly signals: readonly string[];
}

export const NO_TRAIT_EVIDENCE: MusicTraitEvidence = Object.freeze({
  energy: null,
  tempoBpm: null,
  mood: null,
  confidence: 'NONE' as const,
  provenance: 'NONE' as const,
  sourceId: 'none',
  observedAtMs: null,
  signals: Object.freeze([] as readonly string[]),
});

/** Kanıt gerçekten bir şey söylüyor mu. */
export function hasTraitEvidence(e: MusicTraitEvidence): boolean {
  return e.confidence !== 'NONE' && (e.energy !== null || e.mood !== null || e.tempoBpm !== null);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Kanıt üretir — kurallar BURADA zorlanır (çağıran atlayamaz):
 *   · sezgisel/türetilmiş kaynak BPM YAZAMAZ,
 *   · sezgisel kaynağın güveni `LOW` tavanını AŞAMAZ,
 *   · geçersiz enerji değeri kanıt SAYILMAZ.
 */
export function makeTraitEvidence(input: {
  readonly provenance: TraitProvenance;
  readonly sourceId: string;
  readonly energy?: number | null;
  readonly tempoBpm?: number | null;
  readonly mood?: MoodCharacter | null;
  readonly confidence: TraitConfidence;
  readonly observedAtMs?: number | null;
  readonly signals?: readonly string[];
}): MusicTraitEvidence {
  const energy = typeof input.energy === 'number' && Number.isFinite(input.energy)
    ? clamp01(input.energy) : null;
  const tempoBpm = mayCarryTempo(input.provenance)
    && typeof input.tempoBpm === 'number' && Number.isFinite(input.tempoBpm)
    && input.tempoBpm > 20 && input.tempoBpm < 300
    ? input.tempoBpm
    : null;

  let confidence = input.confidence;
  if (input.provenance === 'HEURISTIC_TEXT' || input.provenance === 'DERIVED_DURATION') {
    if (CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[MAX_HEURISTIC_CONFIDENCE]) {
      confidence = MAX_HEURISTIC_CONFIDENCE;
    }
  }
  if (energy === null && tempoBpm === null && (input.mood ?? null) === null) {
    confidence = 'NONE';
  }

  return Object.freeze({
    energy,
    tempoBpm,
    mood: input.mood ?? null,
    confidence,
    provenance: confidence === 'NONE' ? 'NONE' : input.provenance,
    sourceId: input.sourceId,
    observedAtMs: typeof input.observedAtMs === 'number' && Number.isFinite(input.observedAtMs)
      ? input.observedAtMs : null,
    signals: Object.freeze([...(input.signals ?? [])]),
  });
}

/**
 * İki kanıtı birleştirir.
 *
 * KURAL: GÜÇLÜ provenance kazanır. Eşit provenance'ta yüksek güven kazanır.
 * **Birleştirme güveni ASLA yükseltmez** — iki zayıf ipucu güçlü bir ölçüm
 * etmez; yalnız sinyal etiketleri birleşir.
 */
export function mergeTraitEvidence(
  a: MusicTraitEvidence, b: MusicTraitEvidence,
): MusicTraitEvidence {
  const ra = PROVENANCE_RANK[a.provenance];
  const rb = PROVENANCE_RANK[b.provenance];
  if (ra === 0 && rb === 0) return NO_TRAIT_EVIDENCE;

  const [strong, weak] = ra > rb ? [a, b]
    : rb > ra ? [b, a]
      : CONFIDENCE_RANK[a.confidence] >= CONFIDENCE_RANK[b.confidence] ? [a, b] : [b, a];

  const signals = Object.freeze([...new Set([...strong.signals, ...weak.signals])]);
  return Object.freeze({
    ...strong,
    /* Güçlü kanıtın boş bıraktığı alanı zayıf kanıt DOLDURABİLİR, ama güven
       güçlü kanıtınki olarak KALIR (yükseltme yok). */
    energy: strong.energy ?? weak.energy,
    mood: strong.mood ?? weak.mood,
    tempoBpm: mayCarryTempo(strong.provenance) ? strong.tempoBpm : null,
    signals,
  });
}

/** İki güvenden ZAYIF olanı — bir karar en zayıf halkası kadar güçlüdür. */
export function weakerConfidence(a: TraitConfidence, b: TraitConfidence): TraitConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export function confidenceRank(c: TraitConfidence): number { return CONFIDENCE_RANK[c]; }
export function provenanceRank(p: TraitProvenance): number { return PROVENANCE_RANK[p]; }
