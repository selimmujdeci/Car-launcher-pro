/**
 * sttMeasurementModel.ts — MAVI-STT-LAB-2: Kabin Gürültü Ölçüm Defteri SAF modeli.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · `Math.random()` yok · global durum yok ·
 * React importu yok. Tüm zaman ve kimlik ÇAĞIRANDAN gelir → deterministik test.
 *
 * ── BU MODEL NE YAPMAZ ──────────────────────────────────────────────────────
 * STT davranışını DEĞİŞTİRMEZ · eşik/AudioSource/efekt kararı ÜRETMEZ · otomatik
 * ölçüm BAŞLATMAZ · "şu eşik daha iyi" / "gürültü hızdan arttı" gibi ÖNERİ veya
 * NEDENSELLİK iddiası KURMAZ. Yalnız sayısal özet ve sayısal FARK üretir.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 * Kayıt tipinde transcript · n-best · wake sözcüğü · grammar KELİMESİ · kişi adı ·
 * konum · VIN · cihaz kimliği · ham exception · PCM/WAV/byte[]/short[]/Base64
 * TAŞIYAN ALAN YOKTUR. Kayıtlar HAM ÖRNEKLERİ SAKLAMAZ — yalnız özet istatistik.
 *
 * ── SENTINEL SÖZLEŞMESİ (STT-LAB-1 ile AYNI) ────────────────────────────────
 * `-1` = ölçüm yok · `null` = kaynak değer vermedi. `0` GERÇEK bir değerdir ve
 * istatistiğe DAHİL edilir; eksik veri SAYILMAZ.
 */

import {
  percentileNearestRank, normalizeMotion, normalizeGrammar,
  type SttMicRaw, type SttMotionState, type SttGrammarType,
} from './sttMicModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

export const STT_MEASUREMENT_SCHEMA_VERSION = 1;

/** Defter tavanı — 31. kayıt geldiğinde EN ESKİ düşer. */
export const STT_LEDGER_MAX = 30;

/** Örnekleme aralığı TABANI — bundan sık örnekleme YAPILMAZ (hot-path bütçesi). */
export const STT_SAMPLE_INTERVAL_MS = 500;

/** Seçilebilir ölçüm süreleri (sn). Varsayılan 10. */
export const STT_DURATION_OPTIONS_S: readonly number[] = [5, 10, 20, 30] as const;
export const STT_DEFAULT_DURATION_MS = 10_000;

/** Bir ölçümde tutulabilecek azami ham örnek (bellek tavanı — kayda GİRMEZ). */
export const STT_MAX_SAMPLES_PER_MEASUREMENT = 120;

/* ── Koşul etiketi — KULLANICI SEÇER, asla çıkarım yapılmaz ─────────────── */

export const STT_CONDITION_IDS = [
  'park_motor_kapali',
  'rolanti',
  'sehir_ici_50',
  'otoyol_100_110',
  'fan_kapali',
  'fan_acik',
  'masaustu_simulasyon',
  'diger',
] as const;

export type SttConditionId = (typeof STT_CONDITION_IDS)[number];

export const STT_CONDITION_LABEL: Readonly<Record<SttConditionId, string>> = {
  park_motor_kapali:   'Park / motor kapalı',
  rolanti:             'Rölanti',
  sehir_ici_50:        'Şehir içi ~50 km/s',
  otoyol_100_110:      'Otoyol ~100–110 km/s',
  fan_kapali:          'Fan kapalı',
  fan_acik:            'Fan açık',
  masaustu_simulasyon: 'Masaüstü / simülasyon',
  diger:               'Diğer',
} as const;

/**
 * KURAL: etiket YALNIZ kullanıcı beyanıdır. Etiketten hız, fan durumu veya motor
 * durumu ÇIKARILMAZ — gerçek hız diagnostics kaynağından AYRICA kaydedilir ve
 * ikisi kayıtta yan yana durur (çelişirlerse bu görünür olmalıdır).
 */
export function isSttConditionId(v: unknown): v is SttConditionId {
  return typeof v === 'string' && (STT_CONDITION_IDS as readonly string[]).includes(v);
}

/* ── Sonuç ve gerekçe (bounded) ─────────────────────────────────────────── */

export type SttMeasurementOutcome = 'complete' | 'cancelled' | 'source_lost';

export const STT_OUTCOME_LABEL: Readonly<Record<SttMeasurementOutcome, string>> = {
  complete:    'TAMAMLANDI',
  cancelled:   'İPTAL EDİLDİ',
  source_lost: 'KAYNAK KAYBOLDU',
} as const;

/** Sabit gerekçe kodları — serbest metin YOK. */
export const STT_REASON_CODES = [
  'COMPLETED',
  'COMPLETED_PARTIAL_LOSS',
  'USER_CANCELLED',
  'SCREEN_CLOSED',
  'SOURCE_LOST_NO_EVIDENCE',
] as const;

export type SttReasonCode = (typeof STT_REASON_CODES)[number];

export const STT_REASON_LABEL: Readonly<Record<SttReasonCode, string>> = {
  COMPLETED:               'Süre doldu, kanıt tam',
  COMPLETED_PARTIAL_LOSS:  'Süre doldu, bazı örneklerde kanıt yoktu',
  USER_CANCELLED:          'Kullanıcı iptal etti',
  SCREEN_CLOSED:           'Ekran kapandı — ölçüm güvenli iptal edildi',
  SOURCE_LOST_NO_EVIDENCE: 'Hiçbir örnekte kanıt yok',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Örnek (bir anlık gözlem projeksiyonu)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tek bir örnekleme anının PII'siz projeksiyonu. Ham `SttMicRaw` SAKLANMAZ —
 * bu daraltma ölçüm defterinin gizlilik kapısıdır.
 */
export interface SttSample {
  /** Native kanıt var mıydı. */
  readonly present: boolean;
  /** Gerçek VAD ölçümü var mıydı (kanıt var ama pencere ölçülmemiş olabilir). */
  readonly vadPresent: boolean;
  readonly selectedSourceName: string;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly aecAvailable: boolean; readonly aecCreated: boolean; readonly aecEnabled: boolean;
  readonly nsAvailable: boolean;  readonly nsCreated: boolean;  readonly nsEnabled: boolean;
  readonly agcAvailable: boolean; readonly agcCreated: boolean; readonly agcEnabled: boolean;
  /** 9 efekt eksenin kararlı anahtarı — değişim tespiti için. */
  readonly effectsKey: string;
  /** -1 = ölçüm yok (0 GERÇEK değerdir). */
  readonly rms: number;
  readonly noiseFloor: number;
  readonly threshold: number;
  readonly speechDetected: boolean;
  /** null = hız BİLİNMİYOR (0'a ÇEVRİLMEZ). */
  readonly speedKmh: number | null;
  readonly motionState: SttMotionState;
  readonly grammarType: SttGrammarType;
  readonly wakeActive: boolean;
  readonly recognizerActive: boolean;
}

/** SAF projeksiyon: STT-LAB-1 gözlemi → tek ölçüm örneği. */
export function sampleFromSnapshot(s: SttMicRaw): SttSample {
  const present = !!s && s.present === true;
  const src = s?.source ?? null;
  const fx  = s?.effects ?? null;
  const vad = s?.vad ?? null;
  const eng = s?.stt ?? null;
  const veh = s?.vehicle ?? null;

  const b = (v: boolean | undefined): boolean => v === true;
  const effectsKey = [
    fx?.aecAvailable, fx?.aecCreated, fx?.aecEnabled,
    fx?.nsAvailable,  fx?.nsCreated,  fx?.nsEnabled,
    fx?.agcAvailable, fx?.agcCreated, fx?.agcEnabled,
  ].map((v) => (v === true ? '1' : '0')).join('');

  return {
    present,
    vadPresent: !!vad && vad.present === true,
    selectedSourceName: src && src.selectedSource >= 0 ? src.selectedSourceName : 'UNKNOWN',
    sampleRate:   src ? src.sampleRate : 0,
    channelCount: src ? src.channelCount : 0,
    aecAvailable: b(fx?.aecAvailable), aecCreated: b(fx?.aecCreated), aecEnabled: b(fx?.aecEnabled),
    nsAvailable:  b(fx?.nsAvailable),  nsCreated:  b(fx?.nsCreated),  nsEnabled:  b(fx?.nsEnabled),
    agcAvailable: b(fx?.agcAvailable), agcCreated: b(fx?.agcCreated), agcEnabled: b(fx?.agcEnabled),
    effectsKey,
    rms:        vad ? vad.lastRms : -1,
    noiseFloor: vad ? vad.noiseFloor : -1,
    threshold:  vad ? vad.effectiveThreshold : -1,
    speechDetected: !!vad && vad.speechDetected === true,
    speedKmh: veh && typeof veh.speedKmh === 'number' && Number.isFinite(veh.speedKmh)
      ? veh.speedKmh : null,
    motionState: normalizeMotion(veh ? veh.motionState : 'unknown'),
    grammarType: normalizeGrammar(eng ? eng.grammarType : 'free'),
    wakeActive:       !!eng && eng.wakeEngineActive === true,
    recognizerActive: !!eng && eng.activeRecognizerActive === true,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * İstatistik
 * ════════════════════════════════════════════════════════════════════════ */

export interface NumericStats {
  readonly count: number;
  readonly min: number;
  readonly p50: number;
  readonly avg: number;
  readonly p95: number;
  readonly max: number;
}

/**
 * Deterministik özet. DIŞLANANLAR: `NaN` · `±Infinity` · negatif (`-1` sentinel).
 * DAHİL EDİLEN: gerçek `0` (sessiz kabinde RMS 0 olabilir — eksik veri DEĞİLDİR).
 * Geçerli örnek yoksa `null` — SIFIR İSTATİSTİĞİ UYDURULMAZ.
 */
export function computeNumericStats(values: readonly number[] | null | undefined): NumericStats | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const vals: number[] = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) vals.push(v);
  }
  if (vals.length === 0) return null;

  const sorted = vals.slice().sort((a, b) => a - b);
  let sum = 0;
  for (const v of vals) sum += v;

  return {
    count: vals.length,
    min:   sorted[0]!,
    p50:   percentileNearestRank(sorted, 0.50),
    avg:   sum / vals.length,
    p95:   percentileNearestRank(sorted, 0.95),
    max:   sorted[sorted.length - 1]!,
  };
}

/** Oran (0..1). Payda 0 ise `null` — sahte %0 ÜRETİLMEZ. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ölçüm kaydı
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttMotionDistribution {
  readonly moving: number;
  readonly stopped: number;
  readonly unknown: number;
}

export interface SttMeasurementRecord {
  readonly schemaVersion: number;
  readonly measurementId: string;
  readonly conditionId: SttConditionId;
  /** Duvar-saati başlangıcı (ms). */
  readonly startedAt: number;
  /** MONOTONIC geçen süre — saat atlaması bozamaz. */
  readonly elapsedMs: number;
  readonly targetMs: number;

  readonly samplesTaken: number;
  readonly samplesValid: number;
  readonly missingSourceCount: number;

  readonly selectedSourceName: string;
  readonly sourceChanged: boolean;
  readonly sampleRate: number;
  readonly channelCount: number;

  readonly aecAvailable: boolean; readonly aecCreated: boolean; readonly aecEnabled: boolean;
  readonly nsAvailable: boolean;  readonly nsCreated: boolean;  readonly nsEnabled: boolean;
  readonly agcAvailable: boolean; readonly agcCreated: boolean; readonly agcEnabled: boolean;
  readonly effectsChanged: boolean;

  readonly rms: NumericStats | null;
  readonly noiseFloor: NumericStats | null;
  readonly threshold: NumericStats | null;
  readonly speechDetectedRatio: number | null;

  readonly speed: NumericStats | null;
  readonly speedUnknownRatio: number | null;
  readonly motionDistribution: SttMotionDistribution;

  readonly grammarType: SttGrammarType;
  readonly grammarChanged: boolean;
  readonly wakeActiveRatio: number | null;
  readonly recognizerActiveRatio: number | null;

  readonly outcome: SttMeasurementOutcome;
  readonly reasonCode: SttReasonCode;
}

export interface FinalizeMeasurementInput {
  readonly measurementId: string;
  readonly conditionId: SttConditionId;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly targetMs: number;
  readonly samples: readonly SttSample[];
  /** Kullanıcı/ekran iptali mi — `true` ise sonuç DAİMA `cancelled`. */
  readonly cancelled: boolean;
  readonly cancelReason?: SttReasonCode;
}

/**
 * SAF finalize. Kural sırası:
 *  1. İptal edildiyse → `cancelled` (kanıt tam olsa bile — süre eksiktir).
 *  2. Hiç geçerli örnek yoksa → `source_lost` (SAHTE ölçüm ÜRETİLMEZ).
 *  3. Kısmi kayıp varsa → `complete` + `COMPLETED_PARTIAL_LOSS` (eksik oranı görünür).
 *  4. Aksi hâlde → `complete` + `COMPLETED`.
 */
export function finalizeMeasurement(input: FinalizeMeasurementInput): SttMeasurementRecord {
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const taken = samples.length;

  const presentSamples = samples.filter((s) => s.present);
  const validSamples   = samples.filter((s) => s.present && s.vadPresent);
  const missing        = taken - presentSamples.length;

  /* Sentinel (-1) taşıyan örnekler istatistiğe GİRMEZ; computeNumericStats süzer. */
  const rms        = computeNumericStats(validSamples.map((s) => s.rms));
  const noiseFloor = computeNumericStats(validSamples.map((s) => s.noiseFloor));
  const threshold  = computeNumericStats(validSamples.map((s) => s.threshold));

  const speedValues: number[] = [];
  let speedUnknown = 0;
  const motion: Record<SttMotionState, number> = { moving: 0, stopped: 0, unknown: 0 };
  for (const s of samples) {
    if (s.speedKmh === null) speedUnknown++;
    else speedValues.push(s.speedKmh);
    motion[normalizeMotion(s.motionState)]++;
  }

  /* Son GÖZLENEN durum taşınır (kanıtsız örnek üzerine yazmaz). */
  const lastPresent = presentSamples.length > 0 ? presentSamples[presentSamples.length - 1]! : null;
  const lastAny     = taken > 0 ? samples[taken - 1]! : null;

  const sourceNames = new Set(presentSamples.map((s) => s.selectedSourceName));
  const effectKeys  = new Set(presentSamples.map((s) => s.effectsKey));
  const grammars    = new Set(presentSamples.map((s) => s.grammarType));

  let outcome: SttMeasurementOutcome;
  let reasonCode: SttReasonCode;
  if (input.cancelled) {
    outcome = 'cancelled';
    reasonCode = input.cancelReason === 'SCREEN_CLOSED' ? 'SCREEN_CLOSED' : 'USER_CANCELLED';
  } else if (validSamples.length === 0) {
    outcome = 'source_lost';
    reasonCode = 'SOURCE_LOST_NO_EVIDENCE';
  } else if (missing > 0 || validSamples.length < taken) {
    outcome = 'complete';
    reasonCode = 'COMPLETED_PARTIAL_LOSS';
  } else {
    outcome = 'complete';
    reasonCode = 'COMPLETED';
  }

  return {
    schemaVersion: STT_MEASUREMENT_SCHEMA_VERSION,
    measurementId: input.measurementId,
    conditionId:   input.conditionId,
    startedAt:     input.startedAt,
    elapsedMs:     Math.max(0, Math.round(input.elapsedMs)),
    targetMs:      input.targetMs,

    samplesTaken:       taken,
    samplesValid:       validSamples.length,
    missingSourceCount: missing,

    selectedSourceName: lastPresent ? lastPresent.selectedSourceName : 'UNKNOWN',
    sourceChanged:      sourceNames.size > 1,
    sampleRate:         lastPresent ? lastPresent.sampleRate : 0,
    channelCount:       lastPresent ? lastPresent.channelCount : 0,

    aecAvailable: !!lastPresent?.aecAvailable, aecCreated: !!lastPresent?.aecCreated, aecEnabled: !!lastPresent?.aecEnabled,
    nsAvailable:  !!lastPresent?.nsAvailable,  nsCreated:  !!lastPresent?.nsCreated,  nsEnabled:  !!lastPresent?.nsEnabled,
    agcAvailable: !!lastPresent?.agcAvailable, agcCreated: !!lastPresent?.agcCreated, agcEnabled: !!lastPresent?.agcEnabled,
    effectsChanged: effectKeys.size > 1,

    rms, noiseFloor, threshold,
    speechDetectedRatio: ratio(validSamples.filter((s) => s.speechDetected).length, validSamples.length),

    speed: computeNumericStats(speedValues),
    speedUnknownRatio: ratio(speedUnknown, taken),
    motionDistribution: motion,

    grammarType:    lastPresent ? lastPresent.grammarType : (lastAny ? lastAny.grammarType : 'free'),
    grammarChanged: grammars.size > 1,
    wakeActiveRatio:       ratio(presentSamples.filter((s) => s.wakeActive).length, presentSamples.length),
    recognizerActiveRatio: ratio(presentSamples.filter((s) => s.recognizerActive).length, presentSamples.length),

    outcome,
    reasonCode,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Defter (bounded, saf)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * SÖZLEŞME: **iptal edilen ölçüm deftere YAZILMAZ.** Gerekçe: kısa süreli bir
 * ölçüm 10 sn'lik ölçümlerle KARŞILAŞTIRILAMAZ; deftere karışırsa karşılaştırma
 * görünümü sessizce yanıltır. `source_lost` YAZILIR — tam süre koştu ve
 * "kanıt yoktu" bilgisi gerçek bir saha bulgusudur.
 */
export function isLedgerEligible(rec: SttMeasurementRecord | null | undefined): boolean {
  return !!rec && rec.outcome !== 'cancelled';
}

/** En yeni BAŞTA. Tavanı aşarsa EN ESKİ (kuyruk) düşer. */
export function appendMeasurement(
  ledger: readonly SttMeasurementRecord[],
  rec: SttMeasurementRecord,
): SttMeasurementRecord[] {
  if (!isLedgerEligible(rec)) return Array.isArray(ledger) ? ledger.slice() : [];
  const base = Array.isArray(ledger) ? ledger : [];
  const next = [rec, ...base.filter((r) => r.measurementId !== rec.measurementId)];
  return next.length > STT_LEDGER_MAX ? next.slice(0, STT_LEDGER_MAX) : next;
}

/** YALNIZ verilen kimliği siler (diğerlerine dokunmaz). */
export function removeMeasurement(
  ledger: readonly SttMeasurementRecord[],
  measurementId: string,
): SttMeasurementRecord[] {
  if (!Array.isArray(ledger)) return [];
  return ledger.filter((r) => r.measurementId !== measurementId);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karşılaştırma — YALNIZ SAYISAL FARK
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttComparisonRow {
  readonly id: string;
  readonly label: string;
  /** A tarafı gösterimi ('—' = değer yok). */
  readonly a: string;
  readonly b: string;
  /** Sayısal fark (B − A) gösterimi; sayısal değilse 'AYNI' / 'FARKLI'. */
  readonly diff: string;
  readonly numeric: boolean;
  /** Sayısal satırlarda ham fark — testler ve sıralama için. */
  readonly diffValue: number | null;
}

export interface SttComparison {
  readonly aId: string;
  readonly bId: string;
  readonly rows: readonly SttComparisonRow[];
}

function _fmt(v: number | null | undefined, digits: number): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function _pct(v: number | null): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
}

function _numRow(
  id: string, label: string,
  av: number | null | undefined, bv: number | null | undefined,
  digits: number, asPercent = false,
): SttComparisonRow {
  const a = typeof av === 'number' && Number.isFinite(av) ? av : null;
  const b = typeof bv === 'number' && Number.isFinite(bv) ? bv : null;
  const d = a !== null && b !== null ? b - a : null;
  return {
    id, label,
    a: asPercent ? _pct(a) : _fmt(a, digits),
    b: asPercent ? _pct(b) : _fmt(b, digits),
    diff: d === null ? '—'
      : asPercent ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} puan`
      : `${d >= 0 ? '+' : ''}${d.toFixed(digits)}`,
    numeric: true,
    diffValue: d,
  };
}

function _catRow(id: string, label: string, a: string, b: string): SttComparisonRow {
  return { id, label, a, b, diff: a === b ? 'AYNI' : 'FARKLI', numeric: false, diffValue: null };
}

function _fxText(av: boolean, cr: boolean, en: boolean): string {
  return `${av ? 'M' : '-'}${cr ? 'O' : '-'}${en ? 'E' : '-'}`;
}

/**
 * İki kaydın SAYISAL farkı. **Hüküm, öneri veya nedensellik ÜRETMEZ:** dönen
 * satırlarda "daha iyi", "şunu kullan", "…yüzünden arttı" gibi hiçbir yorum
 * YOKTUR — yalnız A, B ve B−A. Yorum tamamen okuyucuya aittir.
 */
export function compareMeasurements(a: SttMeasurementRecord, b: SttMeasurementRecord): SttComparison {
  const rows: SttComparisonRow[] = [
    _numRow('cmpFloorP50', 'gürültü tabanı p50', a.noiseFloor?.p50, b.noiseFloor?.p50, 4),
    _numRow('cmpFloorP95', 'gürültü tabanı p95', a.noiseFloor?.p95, b.noiseFloor?.p95, 4),
    _numRow('cmpRmsP50',   'RMS p50',            a.rms?.p50,        b.rms?.p50,        4),
    _numRow('cmpRmsP95',   'RMS p95',            a.rms?.p95,        b.rms?.p95,        4),
    _numRow('cmpThrP50',   'VAD eşiği p50',      a.threshold?.p50,  b.threshold?.p50,  4),
    _numRow('cmpThrP95',   'VAD eşiği p95',      a.threshold?.p95,  b.threshold?.p95,  4),
    _numRow('cmpSpeech',   'konuşma algılanma oranı', a.speechDetectedRatio, b.speechDetectedRatio, 4, true),
    _numRow('cmpSpeedP50', 'hız p50 (km/s)',     a.speed?.p50,      b.speed?.p50,      1),
    _numRow('cmpSpeedP95', 'hız p95 (km/s)',     a.speed?.p95,      b.speed?.p95,      1),
    _catRow('cmpSource',   'AudioSource',        a.selectedSourceName, b.selectedSourceName),
    _catRow('cmpAec',      'AEC (mevcut/oluş/etkin)', _fxText(a.aecAvailable, a.aecCreated, a.aecEnabled), _fxText(b.aecAvailable, b.aecCreated, b.aecEnabled)),
    _catRow('cmpNs',       'NS (mevcut/oluş/etkin)',  _fxText(a.nsAvailable,  a.nsCreated,  a.nsEnabled),  _fxText(b.nsAvailable,  b.nsCreated,  b.nsEnabled)),
    _catRow('cmpAgc',      'AGC (mevcut/oluş/etkin)', _fxText(a.agcAvailable, a.agcCreated, a.agcEnabled), _fxText(b.agcAvailable, b.agcCreated, b.agcEnabled)),
    _catRow('cmpGrammar',  'grammar sınıfı',     a.grammarType,     b.grammarType),
  ];
  return { aId: a.measurementId, bId: b.measurementId, rows };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kalıcılık kapısı — YAPISAL PII SÜZGECİ
 * ════════════════════════════════════════════════════════════════════════ */

export const STT_LEDGER_STORAGE_KEY = 'caros.lab.stt-measurements';

function _num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function _statsOrNull(v: unknown): NumericStats | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const count = _num(o['count'], -1);
  if (count <= 0) return null;
  return {
    count,
    min: _num(o['min']), p50: _num(o['p50']), avg: _num(o['avg']),
    p95: _num(o['p95']), max: _num(o['max']),
  };
}

function _ratioOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * İKİNCİ KAPI: diske yazmadan/okuduktan sonra kayıt ALAN ALAN yeniden kurulur.
 * Bilinmeyen anahtar TAŞINMAZ → biri ileride kayda serbest metin eklerse bile
 * diske ve ekrana ÇIKAMAZ. Anlaşılamayan gövde için `null`.
 */
export function sanitizeMeasurementRecord(v: unknown): SttMeasurementRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = typeof o['measurementId'] === 'string' ? o['measurementId'].slice(0, 64) : '';
  if (!id) return null;
  if (!isSttConditionId(o['conditionId'])) return null;

  const outcome = o['outcome'];
  if (outcome !== 'complete' && outcome !== 'cancelled' && outcome !== 'source_lost') return null;
  const reason = o['reasonCode'];
  const reasonCode: SttReasonCode = (STT_REASON_CODES as readonly string[]).includes(reason as string)
    ? (reason as SttReasonCode) : 'COMPLETED';

  const md = o['motionDistribution'];
  const mdo = md && typeof md === 'object' ? md as Record<string, unknown> : {};
  const b = (k: string): boolean => o[k] === true;

  return {
    schemaVersion: STT_MEASUREMENT_SCHEMA_VERSION,
    measurementId: id,
    conditionId:   o['conditionId'],
    startedAt:     _num(o['startedAt']),
    elapsedMs:     _num(o['elapsedMs']),
    targetMs:      _num(o['targetMs']),
    samplesTaken:       _num(o['samplesTaken']),
    samplesValid:       _num(o['samplesValid']),
    missingSourceCount: _num(o['missingSourceCount']),
    selectedSourceName: typeof o['selectedSourceName'] === 'string'
      ? o['selectedSourceName'].slice(0, 32) : 'UNKNOWN',
    sourceChanged: b('sourceChanged'),
    sampleRate:    _num(o['sampleRate']),
    channelCount:  _num(o['channelCount']),
    aecAvailable: b('aecAvailable'), aecCreated: b('aecCreated'), aecEnabled: b('aecEnabled'),
    nsAvailable:  b('nsAvailable'),  nsCreated:  b('nsCreated'),  nsEnabled:  b('nsEnabled'),
    agcAvailable: b('agcAvailable'), agcCreated: b('agcCreated'), agcEnabled: b('agcEnabled'),
    effectsChanged: b('effectsChanged'),
    rms:        _statsOrNull(o['rms']),
    noiseFloor: _statsOrNull(o['noiseFloor']),
    threshold:  _statsOrNull(o['threshold']),
    speechDetectedRatio: _ratioOrNull(o['speechDetectedRatio']),
    speed:               _statsOrNull(o['speed']),
    speedUnknownRatio:   _ratioOrNull(o['speedUnknownRatio']),
    motionDistribution: {
      moving:  _num(mdo['moving']),
      stopped: _num(mdo['stopped']),
      unknown: _num(mdo['unknown']),
    },
    grammarType:    normalizeGrammar(typeof o['grammarType'] === 'string' ? o['grammarType'] : 'free'),
    grammarChanged: b('grammarChanged'),
    wakeActiveRatio:       _ratioOrNull(o['wakeActiveRatio']),
    recognizerActiveRatio: _ratioOrNull(o['recognizerActiveRatio']),
    outcome,
    reasonCode,
  };
}

/** Ham gövde → bounded, temizlenmiş defter. Bozuk kayıtlar SESSİZCE ATILIR. */
export function sanitizeLedger(v: unknown): SttMeasurementRecord[] {
  if (!Array.isArray(v)) return [];
  const out: SttMeasurementRecord[] = [];
  for (const item of v) {
    if (out.length >= STT_LEDGER_MAX) break;
    const rec = sanitizeMeasurementRecord(item);
    if (rec && rec.outcome !== 'cancelled') out.push(rec);
  }
  return out;
}
