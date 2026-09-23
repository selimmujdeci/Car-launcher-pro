/**
 * didClassifier — bir DID'in DAVRANIŞ sınıfı (SAF).
 *
 * Anlam DEĞİL, davranış: "bu kanal ne tür bir şey taşıyor" sorusunun ilk,
 * ucuz cevabı. Anlamlandırıcı (semanticMatcher) yalnız ANALOG/COUNTER sınıfını
 * referanslarla eşler; FLAG'ler olay-tetikli öğrenmeye (kullanıcı eylemi) kalır.
 *
 * Yeterli kanıt yoksa `UNKNOWN` — tek okumadan "sabit" hükmü VERİLMEZ.
 */

export type DidBehaviorClass = 'UNKNOWN' | 'CONSTANT' | 'FLAG' | 'COUNTER' | 'ANALOG';

export interface DidSample {
  readonly t: number;
  readonly raw: number;
}

export interface ClassifyOptions {
  /** Hüküm için asgari örnek. */
  readonly minSamples?: number;
  /** Hüküm için asgari gözlem süresi (ms) — anlık bir pencere "sabit" kanıtı değildir. */
  readonly minSpanMs?: number;
}

const DEFAULTS = { minSamples: 6, minSpanMs: 60_000 };

export function classifyDidSamples(
  samples: readonly DidSample[], byteLength: number, opts: ClassifyOptions = {},
): DidBehaviorClass {
  const minSamples = opts.minSamples ?? DEFAULTS.minSamples;
  const minSpanMs = opts.minSpanMs ?? DEFAULTS.minSpanMs;
  const valid = samples.filter((s) => Number.isFinite(s.raw));
  if (valid.length < minSamples) return 'UNKNOWN';
  const span = valid[valid.length - 1]!.t - valid[0]!.t;
  const distinct = new Set(valid.map((s) => s.raw));

  if (distinct.size === 1) return span >= minSpanMs ? 'CONSTANT' : 'UNKNOWN';

  // Tek bayt ve az sayıda ayrık değer → durum/bayrak (0/1, vites kodu, mod…).
  if (byteLength <= 1 && distinct.size <= 6) return 'FLAG';

  // Yalnız artan (en az 3 artış) → sayaç (km, süre, olay sayısı).
  let increases = 0;
  let monotonic = true;
  for (let i = 1; i < valid.length; i++) {
    const d = valid[i]!.raw - valid[i - 1]!.raw;
    if (d < 0) { monotonic = false; break; }
    if (d > 0) increases++;
  }
  if (monotonic && increases >= 3) return 'COUNTER';

  return 'ANALOG';
}
