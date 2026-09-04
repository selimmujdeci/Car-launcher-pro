/**
 * audioExperienceAuthority.ts — MUSIC F6 · TEK DSP OTORİTESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SAHİPLİĞİ (Cross-Domain §1 — ONE DOMAIN = ONE AUTHORITY)
 * ══════════════════════════════════════════════════════════════════════════
 * SAHİBİDİR:   EQ durumu · preset · loudness · denge · DSP yetenek gerçeği ·
 *              güvenlik (headroom) kazancı · bypass kararı.
 *
 * SAHİBİ DEĞİLDİR (ve asla olmaz):
 *   · playback truth        → CarosPlaybackService / playbackTruth (F0)
 *   · kullanıcı sesi        → volumePolicy · CarosPlaybackService.userVolume
 *   · ducking               → duckPolicy · CarosAudioFocusManager
 *   · kaynak devri          → sourceCoordinator · handoverMachine
 *
 * Bu modül HİÇBİR oynatma komutu göndermez: `native.command(...)` çağırmaz,
 * MediaCommandGateway'i çağırmaz. Yalnız `audioDsp*` köprüsünü kullanır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * FAIL-SAFE (§16 FAIL-CLOSED)
 * ══════════════════════════════════════════════════════════════════════════
 *   · Yetenek sorgulanamadı        → hiçbir kontrol yok, hiçbir yazım yok.
 *   · Efekt attach edilemedi       → native bypass; OYNATMA DEVAM EDER.
 *   · Bayat oturum (generation)    → yazım REDDEDİLİR, bir kez yeniden ölçülür.
 *   · Bozuk kalıcı ayar            → reddedilir, varsayılana düşülür (sayılır).
 *   · Pozitif boost                → deterministik headroom (kullanıcı sesine DOKUNULMAZ).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ZAMANLAYICI (§15 — YENİ GLOBAL SCHEDULER KURULMAZ)
 * ══════════════════════════════════════════════════════════════════════════
 * Burada modül-yerel TEK bir debounce timer'ı vardır: slider sürüklemesi
 * native köprüyü basmasın diye. Bu bir global scheduler DEĞİLDİR, başka
 * domainin kadansını yönetmez ve `stopAudioExperience()` ile temizlenir.
 */

import { isNative } from '../../bridge';
import { CarLauncher } from '../../nativePlugin';
import type {
  NativeAudioDspCapabilities, NativeAudioDspSnapshot,
} from '../../nativePlugin';
import { logError } from '../../crashLogger';
import { safeGetRaw, safeSetRaw } from '../../../utils/safeStorage';
import {
  DEFAULT_CONFIG, UNPROBED_CAPABILITIES,
  alignBands, balanceToChannelGains, clampBandGainDb, computeSafetyPreampDb,
  configEquals, dbToLinear, projectPresetToBands, sanitizeConfig,
  MAX_USER_LOUDNESS_DB,
  type AudioDspCapabilities, type AudioExperienceConfig, type PresetId,
} from './audioExperienceModel';

/* ── Sabitler ────────────────────────────────────────────────────────────── */

const PERSIST_KEY = 'caros.music.f6.audio-experience.v1';
const PERSIST_SCHEMA = 1;

/** Sürükleme sırasında native'e en fazla bu sıklıkta yazılır. */
const COALESCE_MS = 120;
/** Kesintisiz sürüklemede bile bu süreden fazla yazımsız kalınmaz. */
const COALESCE_MAX_WAIT_MS = 400;

/* ── Modül durumu ────────────────────────────────────────────────────────── */

let _caps: AudioDspCapabilities = UNPROBED_CAPABILITIES;
let _capsGeneration = 0;
let _config: AudioExperienceConfig = DEFAULT_CONFIG;
let _lastSentConfig: AudioExperienceConfig | null = null;
let _snapshot: NativeAudioDspSnapshot | null = null;
let _started = false;
/** Otorite kuşağı — teardown sonrası uçuşan promise'ler durumu YAZAMAZ. */
let _runtimeGeneration = 0;

let _timer: ReturnType<typeof setTimeout> | null = null;
let _pendingSince = 0;
let _applyInFlight = false;
let _revalidating = false;

const _subscribers = new Set<() => void>();

/* ── Telemetri (bounded, PII taşımaz) ────────────────────────────────────── */

interface AudioExperienceTelemetry {
  probeCount: number;
  probeFailures: number;
  applyRequested: number;
  applyCoalesced: number;
  applySent: number;
  applyAccepted: number;
  applyRejected: number;
  applyErrors: number;
  staleRejections: number;
  revalidations: number;
  persistWrites: number;
  persistRejected: number;
  bypassObserved: number;
  applyLatencySumMs: number;
  applyLatencyMaxMs: number;
  applyLatencyCount: number;
  probeLatencyLastMs: number;
  lastFailureCode: string;
}

const _tel: AudioExperienceTelemetry = {
  probeCount: 0,
  probeFailures: 0,
  applyRequested: 0,
  applyCoalesced: 0,
  applySent: 0,
  applyAccepted: 0,
  applyRejected: 0,
  applyErrors: 0,
  staleRejections: 0,
  revalidations: 0,
  persistWrites: 0,
  persistRejected: 0,
  bypassObserved: 0,
  applyLatencySumMs: 0,
  applyLatencyMaxMs: 0,
  applyLatencyCount: 0,
  probeLatencyLastMs: 0,
  lastFailureCode: '',
};

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function notify(): void {
  _subscribers.forEach((fn) => {
    try { fn(); } catch { /* abone hatası otoriteyi bozmaz */ }
  });
}

function milliBel(db: number): number {
  return Math.round(db * 100);
}

/**
 * Native yetenek yükünü doğrular. Eksik/bozuk alan UYDURULMAZ; tek bir
 * geçersizlik bile tüm yeteneği "yok" saymaz — yalnız o alan kapatılır.
 */
export function sanitizeNativeCapabilities(raw: unknown): AudioDspCapabilities {
  if (!raw || typeof raw !== 'object') return UNPROBED_CAPABILITIES;
  const r = raw as Partial<NativeAudioDspCapabilities>;
  if (r.probed !== true) {
    return Object.freeze({
      ...UNPROBED_CAPABILITIES,
      unavailableReason: typeof r.unavailableReason === 'string' && r.unavailableReason
        ? r.unavailableReason
        : 'not_probed',
    });
  }

  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  const freqs = Array.isArray(r.eqBandFrequenciesHz)
    ? r.eqBandFrequenciesHz
      .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
      .slice(0, 32)
    : [];

  const minDb = num(r.eqMinGainMilliBel, 0) / 100;
  const maxDb = num(r.eqMaxGainMilliBel, 0) / 100;
  /* Bant sayısı, cihazın GERÇEKTEN frekans bildirdiği bant sayısını AŞAMAZ:
     frekansı bilinmeyen bir bandı çizmek uydurma bir kontrol üretirdi. */
  const bandCount = Math.max(0, Math.min(Math.floor(num(r.eqBandCount, 0)), freqs.length, 32));
  const eqOk = r.supportsEqualizer === true && bandCount > 0 && maxDb > minDb;

  const loudMaxDb = Math.max(0, num(r.loudnessMaxMilliBel, 0) / 100);
  const loudOk = r.supportsLoudness === true && loudMaxDb > 0;

  return Object.freeze({
    probed: true,
    supportsEqualizer: eqOk,
    eqBandCount: eqOk ? bandCount : 0,
    eqBandFrequenciesHz: Object.freeze(eqOk ? freqs.slice(0, bandCount) : []) as readonly number[],
    eqMinGainDb: eqOk ? minDb : 0,
    eqMaxGainDb: eqOk ? maxDb : 0,
    supportsLoudness: loudOk,
    loudnessMaxDb: loudOk ? Math.min(loudMaxDb, MAX_USER_LOUDNESS_DB) : 0,
    supportsBalance: r.supportsBalance === true,
    supportsFader: r.supportsFader === true,
    faderUnsupportedReason: typeof r.faderUnsupportedReason === 'string'
      ? r.faderUnsupportedReason.slice(0, 120)
      : '',
    supportsVirtualizer: r.supportsVirtualizer === true,
    supportsHardwareDsp: r.supportsHardwareDsp === true,
    unavailableReason: typeof r.unavailableReason === 'string'
      ? r.unavailableReason.slice(0, 120)
      : '',
  });
}

function sanitizeNativeSnapshot(raw: unknown): NativeAudioDspSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<NativeAudioDspSnapshot>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 120) : '');
  return {
    available: r.available === true,
    audioSessionId: num(r.audioSessionId),
    generation: num(r.generation),
    equalizerAttached: r.equalizerAttached === true,
    loudnessAttached: r.loudnessAttached === true,
    processorActive: r.processorActive === true,
    bypass: r.bypass === true,
    bypassReason: str(r.bypassReason),
    appliedBandsMilliBel: Array.isArray(r.appliedBandsMilliBel)
      ? r.appliedBandsMilliBel.filter((x): x is number => typeof x === 'number').slice(0, 32)
      : [],
    appliedLoudnessMilliBel: num(r.appliedLoudnessMilliBel),
    appliedPreampLinear: num(r.appliedPreampLinear),
    appliedBalance: num(r.appliedBalance),
    attachCount: num(r.attachCount),
    attachFailureCount: num(r.attachFailureCount),
    applyFailureCount: num(r.applyFailureCount),
    lastFailureCode: str(r.lastFailureCode),
    lastApplyLatencyMs: num(r.lastApplyLatencyMs),
    lastAttachLatencyMs: num(r.lastAttachLatencyMs),
  };
}

/* ── Kalıcılık ───────────────────────────────────────────────────────────── */

/**
 * Kalıcı ayar YALNIZ bir ÖNERİDİR (Cross-Domain §13: persistence ≠ live truth).
 * Cihazın o anki gerçek yetenekleri yeniden ölçülmeden aktif kabul EDİLMEZ;
 * `sanitizeConfig` her yüklemede yeteneklere göre kırpar/reddeder.
 */
function loadPersisted(caps: AudioDspCapabilities): AudioExperienceConfig {
  const raw = safeGetRaw(PERSIST_KEY);
  if (!raw) return sanitizeConfig({}, caps);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed?.schema !== PERSIST_SCHEMA) {
      _tel.persistRejected += 1;
      return sanitizeConfig({}, caps);
    }
    return sanitizeConfig(parsed.config, caps);
  } catch {
    _tel.persistRejected += 1;
    return sanitizeConfig({}, caps);
  }
}

function persist(cfg: AudioExperienceConfig): void {
  try {
    safeSetRaw(PERSIST_KEY, JSON.stringify({ schema: PERSIST_SCHEMA, config: cfg }));
    _tel.persistWrites += 1;
  } catch { /* kalıcı yazım hatası DSP'yi bozmaz */ }
}

/* ── Native uygulama ─────────────────────────────────────────────────────── */

function clearTimer(): void {
  if (_timer !== null) { clearTimeout(_timer); _timer = null; }
}

/** Sürükleme yükünü sınırlayan tek kapı. Yeni bir kadans otoritesi DEĞİLDİR. */
function scheduleApply(): void {
  _tel.applyRequested += 1;
  if (!isNative || !_caps.probed) return;

  const now = Date.now();
  if (_pendingSince === 0) _pendingSince = now;

  if (_timer !== null) {
    _tel.applyCoalesced += 1;
    /* Kesintisiz sürüklemede yazım sonsuza kadar ertelenmez. */
    if (now - _pendingSince >= COALESCE_MAX_WAIT_MS) {
      clearTimer();
      void flushApply();
      return;
    }
    clearTimer();
  }
  _timer = setTimeout(() => { _timer = null; void flushApply(); }, COALESCE_MS);
}

async function flushApply(): Promise<void> {
  const gen = _runtimeGeneration;
  _pendingSince = 0;
  if (!isNative || !_caps.probed) return;
  if (_applyInFlight) {
    /* Uçuşan yazım varken ikinci istek KUYRUĞA ALINMAZ; bitişte tekrar denenir. */
    scheduleApply();
    return;
  }

  const cfg = _config;
  if (_lastSentConfig && configEquals(_lastSentConfig, cfg)) return;

  _applyInFlight = true;
  const startedAt = Date.now();
  try {
    const preampDb = computeSafetyPreampDb(cfg, _caps);
    const res = await CarLauncher.audioDspApply({
      generation: _capsGeneration,
      enabled: cfg.enabled,
      bandsMilliBel: cfg.bandGainsDb.map(milliBel),
      loudnessMilliBel: milliBel(cfg.loudnessDb),
      preampLinear: dbToLinear(preampDb),
      balance: cfg.balance,
    });
    _tel.applySent += 1;

    const elapsed = Date.now() - startedAt;
    _tel.applyLatencyCount += 1;
    _tel.applyLatencySumMs += elapsed;
    if (elapsed > _tel.applyLatencyMaxMs) _tel.applyLatencyMaxMs = elapsed;

    if (gen !== _runtimeGeneration) return;   // teardown oldu → yazma

    if (res?.applied === true) {
      _tel.applyAccepted += 1;
      _lastSentConfig = cfg;
      _tel.lastFailureCode = '';
    } else {
      _tel.applyRejected += 1;
      _tel.lastFailureCode = typeof res?.failureCode === 'string' ? res.failureCode : 'apply_rejected';
      /* Bayat oturum: yetenekler ARTIK GEÇERSİZ. Bir kez yeniden ölçülür;
         eski kuşağın ayarı yeni oturuma ZORLA yazılmaz. */
      if (_tel.lastFailureCode === 'stale_session') {
        _tel.staleRejections += 1;
        void revalidate();
      }
    }
    const snap = sanitizeNativeSnapshot(res?.snapshot);
    if (snap) {
      _snapshot = snap;
      if (snap.bypass) _tel.bypassObserved += 1;
    }
  } catch (e) {
    _tel.applyErrors += 1;
    _tel.lastFailureCode = 'bridge_error';
    logError('AudioExperience:Apply', e);
  } finally {
    _applyInFlight = false;
    if (gen === _runtimeGeneration) notify();
  }
}

/* ── Yaşam döngüsü ───────────────────────────────────────────────────────── */

/**
 * Yetenekleri ÖLÇER (varsaymaz), kalıcı ayarı yükler ve bir kez uygular.
 * Çift çağrı güvenlidir.
 */
export async function startAudioExperience(): Promise<void> {
  if (_started) return;
  _started = true;
  const gen = _runtimeGeneration;

  if (!isNative) {
    /* Web modunda DSP yoktur. Sahte yetenek üretilmez; UI hiçbir kontrol çizmez. */
    _caps = Object.freeze({ ...UNPROBED_CAPABILITIES, unavailableReason: 'web_mode' });
    _config = sanitizeConfig({}, _caps);
    notify();
    return;
  }

  await probeCapabilities();
  if (gen !== _runtimeGeneration) return;

  _config = loadPersisted(_caps);
  if (_caps.probed) {
    _lastSentConfig = null;
    await flushApply();
  }
  if (gen === _runtimeGeneration) notify();
}

async function probeCapabilities(): Promise<void> {
  const gen = _runtimeGeneration;
  const startedAt = Date.now();
  _tel.probeCount += 1;
  try {
    const raw = await CarLauncher.audioDspCapabilities();
    if (gen !== _runtimeGeneration) return;
    _caps = sanitizeNativeCapabilities(raw);
    _capsGeneration = typeof raw?.generation === 'number' && Number.isFinite(raw.generation)
      ? raw.generation
      : 0;
    _tel.probeLatencyLastMs = Date.now() - startedAt;
  } catch (e) {
    if (gen !== _runtimeGeneration) return;
    _tel.probeFailures += 1;
    _caps = Object.freeze({ ...UNPROBED_CAPABILITIES, unavailableReason: 'probe_failed' });
    _capsGeneration = 0;
    logError('AudioExperience:Probe', e);
  }
}

/**
 * Yetenekleri YENİDEN ölçer ve ayarı yeni gerçeğe göre kırpar.
 * Audio session değişimi veya bayat yazım reddi sonrası çağrılır.
 */
export async function revalidate(): Promise<void> {
  if (!isNative || _revalidating) return;
  _revalidating = true;
  const gen = _runtimeGeneration;
  try {
    _tel.revalidations += 1;
    await probeCapabilities();
    if (gen !== _runtimeGeneration) return;
    /* Yeni yeteneklerde geçersiz kalan alanlar SESSİZCE KORUNMAZ. */
    _config = sanitizeConfig(_config, _caps);
    _lastSentConfig = null;
    if (_caps.probed) await flushApply();
  } finally {
    _revalidating = false;
    if (gen === _runtimeGeneration) notify();
  }
}

/** Zero-Leak teardown — timer temizlenir, uçuşan yazımlar bayatlar. */
export function stopAudioExperience(): void {
  _started = false;
  _runtimeGeneration += 1;
  clearTimer();
  _pendingSince = 0;
  _applyInFlight = false;
  _revalidating = false;
  _lastSentConfig = null;
}

/* ── Okuma yüzeyi ────────────────────────────────────────────────────────── */

export function getCapabilities(): AudioDspCapabilities { return _caps; }
export function getConfig(): AudioExperienceConfig { return _config; }
export function getNativeSnapshot(): NativeAudioDspSnapshot | null { return _snapshot; }
export function getSafetyPreampDb(): number { return computeSafetyPreampDb(_config, _caps); }

/** Dengenin ürettiği kanal kazançları — LAB ve testler bunu doğrular. */
export function getChannelGains(): { left: number; right: number } {
  if (!_caps.supportsBalance || !_config.enabled) return { left: 1, right: 1 };
  return balanceToChannelGains(_config.balance);
}

export function getAudioExperienceTelemetry(): Readonly<AudioExperienceTelemetry> & {
  readonly applyLatencyAvgMs: number | null;
  readonly capsGeneration: number;
  readonly started: boolean;
} {
  return Object.freeze({
    ..._tel,
    applyLatencyAvgMs: _tel.applyLatencyCount > 0
      ? Math.round(_tel.applyLatencySumMs / _tel.applyLatencyCount)
      : null,
    capsGeneration: _capsGeneration,
    started: _started,
  });
}

export function subscribeAudioExperience(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => { _subscribers.delete(fn); };
}

/* ── Yazma yüzeyi (yalnız DSP alanları) ──────────────────────────────────── */

function commit(next: AudioExperienceConfig): void {
  if (configEquals(_config, next)) return;
  _config = next;
  persist(next);
  scheduleApply();
  notify();
}

export function setPreset(id: PresetId): void {
  if (!_caps.supportsEqualizer) return;
  const bands = id === 'custom' ? _config.bandGainsDb : projectPresetToBands(id, _caps);
  commit(Object.freeze({ ..._config, presetId: id, bandGainsDb: Object.freeze(bands.slice()) }));
}

/** Tek bant değişimi ayarı otomatik olarak `custom`'a taşır (preset yalanı olmaz). */
export function setBandGainDb(index: number, db: number): void {
  if (!_caps.supportsEqualizer) return;
  if (!Number.isInteger(index) || index < 0 || index >= _caps.eqBandCount) return;
  if (!Number.isFinite(db)) return;
  const bands = alignBands(_config.bandGainsDb, _caps).slice();
  bands[index] = Math.round(clampBandGainDb(db, _caps) * 10) / 10;
  commit(Object.freeze({ ..._config, presetId: 'custom', bandGainsDb: Object.freeze(bands) }));
}

export function setLoudnessDb(db: number): void {
  if (!_caps.supportsLoudness) return;
  if (!Number.isFinite(db)) return;
  const v = Math.round(Math.max(0, Math.min(_caps.loudnessMaxDb, db)) * 10) / 10;
  commit(Object.freeze({ ..._config, loudnessDb: v }));
}

export function setBalance(balance: number): void {
  if (!_caps.supportsBalance) return;
  if (!Number.isFinite(balance)) return;
  const v = Math.round(Math.max(-1, Math.min(1, balance)) * 10) / 10;
  commit(Object.freeze({ ..._config, balance: v }));
}

/** `false` = tam bypass. Efektler devre dışı kalır, oynatma ETKİLENMEZ. */
export function setEnabled(enabled: boolean): void {
  commit(Object.freeze({ ..._config, enabled: enabled === true }));
}

export function resetAudioExperience(): void {
  commit(sanitizeConfig({}, _caps));
}

/* ── Test kancası ────────────────────────────────────────────────────────── */

export function __resetAudioExperienceForTest(): void {
  stopAudioExperience();
  _caps = UNPROBED_CAPABILITIES;
  _capsGeneration = 0;
  _config = DEFAULT_CONFIG;
  _snapshot = null;
  _subscribers.clear();
  (Object.keys(_tel) as (keyof AudioExperienceTelemetry)[]).forEach((k) => {
    if (k === 'lastFailureCode') _tel.lastFailureCode = '';
    else (_tel[k] as number) = 0;
  });
}
