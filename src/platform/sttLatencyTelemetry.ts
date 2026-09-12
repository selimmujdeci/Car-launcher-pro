/**
 * sttLatencyTelemetry — STT-LATENCY-2: native Vosk faz enstrümantasyonunun
 * SAF (yan etkisiz) türetme katmanı.
 *
 * Native taraf (CarLauncherPlugin.java, runVoskListening) yalnız HAM monotonic
 * zaman damgalarını (delta-from-request, ms — bkz. buildSttTelemetryJson) +
 * sayaçları + bounded kategorik alanları üretir; TÜM süre ÇIKARIMI (subtraction)
 * ve monotonluk doğrulaması burada, saf bir fonksiyonla yapılır — Android native
 * test altyapısı bu seviyeyi (thread/AudioRecord/Vosk) desteklemediği için, ölçüm
 * MANTIĞININ doğruluğu bu katmanda vitest ile doğrulanır.
 *
 * ── Gizlilik ────────────────────────────────────────────────────
 * Bu modül TRANSCRIPT/PII/dosya yolu/uuid GÖRMEZ ve TAŞIMAZ — yalnız sayısal
 * süreler, sayaçlar ve bounded kategorik alanlar (terminalStatus, model*Category).
 *
 * ── Davranış ────────────────────────────────────────────────────
 * Bu dosya YALNIZ ÖLÇÜM okur/türetir — hiçbir sesli asistan kararını etkilemez,
 * hiçbir native/JS davranışını değiştirmez (STT-LATENCY-2 kapsamı).
 */

/** Native'in ürettiği bounded terminal durum kümesi. */
export type SttTerminalStatus =
  | 'success'
  | 'no_speech'
  | 'cancelled'
  | 'timeout'
  | 'model_error'
  | 'audio_error'
  | 'decode_error';

const STT_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'success', 'no_speech', 'cancelled', 'timeout', 'model_error', 'audio_error', 'decode_error',
]);

export type SttModelSourceCategory = 'preloaded' | 'runtime_retry' | 'unavailable';

const STT_MODEL_SOURCE_CATEGORIES: ReadonlySet<string> = new Set([
  'preloaded', 'runtime_retry', 'unavailable',
]);

/**
 * Native'ten gelen HAM alanlar (CarLauncherPlugin#buildSttTelemetryJson ile birebir).
 * `*AtMs` alanları listenRequestedAt'a göre DELTA (ms, ≥0) — native'de ulaşılmamış
 * faz alanı hiç YAZILMAZ (undefined = "bu faza hiç ulaşılmadı", açık segment değil).
 */
export interface RawSttTelemetry {
  audioRecordStartAtMs?: number;
  firstPcmFrameAtMs?: number;
  vadFloorReadyAtMs?: number;
  firstSpeechDetectedAtMs?: number;
  lastSpeechFrameAtMs?: number;
  speechEndDetectedAtMs?: number;
  decodeStartAtMs?: number;
  decodeEndAtMs?: number;
  bridgeResolveAtMs?: number;
  pcmFrameCount?: number;
  acceptedWaveformCount?: number;
  sampleRate?: number;
  bufferSize?: number;
  modelLoadAttempted?: boolean;
  modelLoadSucceeded?: boolean;
  modelSourceCategory?: string;
  modelErrorCategory?: string;
  terminalStatus?: string;
}

/** Türetilmiş (subtraction ile hesaplanan) süre + geçiş alanları. Ulaşılmayan faz → undefined. */
export interface SttLatencyMetrics {
  terminalStatus: SttTerminalStatus | 'unknown';

  requestToAudioStartMs?: number;
  audioStartToFirstFrameMs?: number;
  vadFloorLearningMs?: number;
  floorReadyToSpeechStartMs?: number;
  speechDurationMs?: number;
  postSpeechSilenceMs?: number;
  decodeMs?: number;
  decodeEndToResolveMs?: number;
  nativeTotalMs?: number;

  pcmFrameCount?: number;
  acceptedWaveformCount?: number;
  sampleRate?: number;
  bufferSize?: number;

  modelLoadAttempted?: boolean;
  modelLoadSucceeded?: boolean;
  modelSourceCategory?: SttModelSourceCategory;
  modelErrorCategory?: string;

  /** Ulaşılan fazların (0 → audioStart → firstFrame → vadFloorReady → decodeStart →
   *  decodeEnd → bridgeResolve) sırası azalmayan mı? false ise türetilen süreler
   *  şüpheli — bozuk/tutarsız native veri (dennekleyici olay, atılmaz ama işaretlenir). */
  monotonic: boolean;
}

/** a→b arası süre (ms). İkisi de tanımlı DEĞİLSE veya b<a (bozuk veri) ise undefined —
 *  negatif/anlamsız süre asla dönmez (sessiz reddet, throw ETMEZ — fail-soft). */
function dur(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a !== 'number' || typeof b !== 'number') return undefined;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  const d = b - a;
  return d >= 0 ? d : undefined;
}

function cleanCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * HAM native telemetriden bounded, türetilmiş süre/metrik nesnesi üretir.
 * SAF fonksiyon: yan etkisi yok, native/JS davranışını etkilemez — yalnız hesaplar.
 * `raw` yoksa (Vosk hiç devreye girmedi — örn. Google STT yolu) 'unknown' terminalStatus
 * ile boş bir metrik döner (açık segment/sahte süre üretmez).
 */
export function deriveSttLatencyMetrics(raw: RawSttTelemetry | null | undefined): SttLatencyMetrics {
  if (!raw) {
    return { terminalStatus: 'unknown', monotonic: true };
  }

  const terminalStatus: SttTerminalStatus | 'unknown' =
    typeof raw.terminalStatus === 'string' && STT_TERMINAL_STATUSES.has(raw.terminalStatus)
      ? (raw.terminalStatus as SttTerminalStatus)
      : 'unknown';

  const modelSourceCategory: SttModelSourceCategory | undefined =
    typeof raw.modelSourceCategory === 'string' && STT_MODEL_SOURCE_CATEGORIES.has(raw.modelSourceCategory)
      ? (raw.modelSourceCategory as SttModelSourceCategory)
      : undefined;

  // Monotonluk: yalnız ULAŞILMIŞ (tanımlı) ana-hat fazları sırayla karşılaştırılır.
  // 0 = listenRequestedAt ankoru (her zaman "tanımlı" ve en küçük).
  const timeline: Array<number | undefined> = [
    0,
    raw.audioRecordStartAtMs,
    raw.firstPcmFrameAtMs,
    raw.vadFloorReadyAtMs,
    raw.decodeStartAtMs,
    raw.decodeEndAtMs,
    raw.bridgeResolveAtMs,
  ];
  let monotonic = true;
  let prev: number | undefined;
  for (const v of timeline) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (prev !== undefined && v < prev) { monotonic = false; break; }
    prev = v;
  }

  return {
    terminalStatus,

    requestToAudioStartMs:    dur(0, raw.audioRecordStartAtMs),
    audioStartToFirstFrameMs: dur(raw.audioRecordStartAtMs, raw.firstPcmFrameAtMs),
    vadFloorLearningMs:       dur(raw.firstPcmFrameAtMs, raw.vadFloorReadyAtMs),
    floorReadyToSpeechStartMs: dur(raw.vadFloorReadyAtMs, raw.firstSpeechDetectedAtMs),
    speechDurationMs:         dur(raw.firstSpeechDetectedAtMs, raw.lastSpeechFrameAtMs),
    postSpeechSilenceMs:      dur(raw.lastSpeechFrameAtMs, raw.speechEndDetectedAtMs),
    decodeMs:                 dur(raw.decodeStartAtMs, raw.decodeEndAtMs),
    decodeEndToResolveMs:     dur(raw.decodeEndAtMs, raw.bridgeResolveAtMs),
    nativeTotalMs:            dur(0, raw.bridgeResolveAtMs),

    pcmFrameCount:         cleanCount(raw.pcmFrameCount),
    acceptedWaveformCount: cleanCount(raw.acceptedWaveformCount),
    sampleRate:            cleanCount(raw.sampleRate),
    bufferSize:            cleanCount(raw.bufferSize),

    modelLoadAttempted: typeof raw.modelLoadAttempted === 'boolean' ? raw.modelLoadAttempted : undefined,
    modelLoadSucceeded: typeof raw.modelLoadSucceeded === 'boolean' ? raw.modelLoadSucceeded : undefined,
    modelSourceCategory,
    modelErrorCategory: typeof raw.modelErrorCategory === 'string' ? raw.modelErrorCategory : undefined,

    monotonic,
  };
}

/* ── Yerel gözlem halkası (destek/teşhis) ──────────────────────────────────
 * reportVoiceDiag'ın sabit şemasına (VoiceDiagExtra) UYMAZ — bu ölçüm çok daha
 * geniş sayısal alan taşır; bu yüzden AYRI, hafif bir yerel halka (getRecentVoiceDiag
 * ile aynı desen). Ağa GİTMEZ, yalnız son N oturumu bellekte tutar. */

const STT_LATENCY_RING_MAX = 20;
const _sttLatencyRing: SttLatencyMetrics[] = [];

/** Türetilmiş metrikleri yerel halkaya kaydeder (fire-and-forget, throw etmez). */
export function recordSttLatencyMetrics(m: SttLatencyMetrics): void {
  try {
    _sttLatencyRing.push(m);
    if (_sttLatencyRing.length > STT_LATENCY_RING_MAX) {
      _sttLatencyRing.splice(0, _sttLatencyRing.length - STT_LATENCY_RING_MAX);
    }
  } catch { /* fail-soft: ölçüm hattı asistanı ASLA etkilemez */ }
}

/** Son native Vosk STT oturumlarının türetilmiş metrikleri (en eski → en yeni). */
export function getRecentSttLatencyMetrics(): SttLatencyMetrics[] {
  return _sttLatencyRing.slice();
}

/** @internal — yalnız vitest. */
export function _resetSttLatencyRingForTest(): void {
  _sttLatencyRing.length = 0;
}
