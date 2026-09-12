/**
 * discoveryValidator — P0 Deep PID/DID Explorer Faz-1 · GÜVENLİ OTOMATİK EKLEME KAPISI (SAF).
 *
 * AMAÇ (görev tanımı §D): yalnız AŞAĞIDAKİ 10 koşulun TAMAMI sağlanırsa bir aday VERIFIED
 * sayılır ve canlı polling'e (auto-add) UYGUN olur. Tek bir koşul bile eksikse aday
 * DECODER_KNOWN/VALIDATING/SUSPICIOUS seviyesinde kalır — otomatik canlıya EKLENMEZ.
 *
 * SAF: I/O yok — girdi tamamen booleans/sayılar, çağıran (discoveryCoordinator) gerçek
 * kanıtı toplar. Bu ayrım testability + "kararın NEREDE verildiği" netliği içindir.
 */

/** 10-koşul girdisi — her biri çağıran tarafından KANITLANMIŞ olmalı (uydurma YOK). */
export interface AutoAddGateInput {
  /** 1. ECU olumlu yanıt verdi + yanıt formatı doğru (OK/positive, format bozuk değil). */
  positiveEcuResponse: boolean;
  /** 2. İstek echo/header kontrolü geçti (yanlış ECU'nun yanıtı karışmadı). */
  requestEchoValid: boolean;
  /** 3. Beklenen byte uzunluğu decoder şemasıyla eşleşti. */
  byteLengthMatches: boolean;
  /** 4. Decoder registry'de kayıtlı (StandardPidRegistry / vehicleDidProfile). */
  decoderRegistered: boolean;
  /** 5. Birim + ölçek formülü biliniyor (decoderRegistered ile birlikte gelir, ayrı taşınır — dürüstlük). */
  unitScaleKnown: boolean;
  /** 6. Değer decoder'ın fiziksel min/max aralığında. */
  valueInPhysicalRange: boolean;
  /** 7. Birkaç BAĞIMSIZ örnekte kararlı (aynı okuma tekrar tekrar tutarlı). */
  stableAcrossSamples: boolean;
  /** 8. Başka bir PID/DID yanıtıyla KARIŞMADIĞI kanıtlı (çapraz-bulaşma yok). */
  noCrossTalk: boolean;
  /** 9. Yanıt STALE/cache değil — bu oturumda TAZE alındı. */
  notStaleOrCached: boolean;
  /** 10. Safety gate (AiSafetyGate / DiscoverySafetyPolicy) izin verdi. */
  safetyGateAllowed: boolean;
}

/** Girdi anahtarları — SIRALI, insan-okur hata raporu için (`failedConditions`). */
const CONDITION_KEYS: readonly (keyof AutoAddGateInput)[] = Object.freeze([
  'positiveEcuResponse',
  'requestEchoValid',
  'byteLengthMatches',
  'decoderRegistered',
  'unitScaleKnown',
  'valueInPhysicalRange',
  'stableAcrossSamples',
  'noCrossTalk',
  'notStaleOrCached',
  'safetyGateAllowed',
]);

export interface AutoAddGateResult {
  readonly eligible: boolean;
  /** Sağlanmayan koşulların anahtarları (sırayla) — dürüst "neden değil" raporu. */
  readonly failedConditions: readonly (keyof AutoAddGateInput)[];
}

/** 10-koşul kapısı — TEK karar noktası. Herhangi biri false ise eligible:false. */
export function evaluateAutoAddGate(input: AutoAddGateInput): AutoAddGateResult {
  const failed: (keyof AutoAddGateInput)[] = [];
  for (const key of CONDITION_KEYS) {
    if (input[key] !== true) failed.push(key);
  }
  return Object.freeze({ eligible: failed.length === 0, failedConditions: Object.freeze(failed) });
}

/**
 * Byte uzunluğu değerlendirmesi — beklenenden KISA yanıt asla güvenilir çözülemez
 * (SUSPICIOUS); fazladan bayt (dolgu/genişletilmiş yanıt) tolere edilir.
 */
export function classifyByteLength(expectedBytes: number, actualBytes: number): 'ok' | 'too_short' {
  return actualBytes < expectedBytes ? 'too_short' : 'ok';
}

/**
 * Bağımsız örneklerin kararlılığını değerlendirir — koşul 7. En az `minSamples` örnek
 * gerekir (varsayılan 2); hepsi decoder aralığında (`inRange`) VE aralarındaki en büyük
 * fark `maxRelativeDelta` (varsayılan %25) içindeyse kararlı sayılır. Fiziksel sıfıra
 * yakın değerlerde bölme patlamasın diye epsilon tabanı kullanılır.
 */
export function isSampleSetStable(
  samples: readonly number[],
  opts: { minSamples?: number; maxRelativeDelta?: number } = {},
): boolean {
  const minSamples = opts.minSamples ?? 2;
  const maxRelativeDelta = opts.maxRelativeDelta ?? 0.25;
  if (samples.length < minSamples) return false;
  if (samples.some((v) => !Number.isFinite(v))) return false;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const base = Math.max(Math.abs(min), Math.abs(max), 1e-6);
  return (max - min) / base <= maxRelativeDelta;
}
