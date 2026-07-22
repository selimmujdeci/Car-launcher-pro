/**
 * validationRecorder — Saha Doğrulama Modu'nun kayıt çekirdeği.
 *
 * Tasarım çapası: `obdDiagnosticRecorder` (bounded ring buffer + monotonik delta
 * + abone seti + disposer listesi). AYNI deseni izler, PARALEL bir sistem kurmaz.
 *
 * ── GARANTİLER ──────────────────────────────────────────────────────────────
 *  - **Sıfır ek yük (kapalıyken):** her kayıt fonksiyonu ilk satırda tek bir
 *    `_active` boolean kontrolüyle döner. Oturum başlamadıysa hiçbir tahsis,
 *    zamanlayıcı veya abonelik YOKTUR.
 *  - **Zero-leak:** sabit boyutlu ring buffer'lar; aboneler Set'te; `stopSession`
 *    kayıtlı tüm disposer'ları çalıştırır.
 *  - **Saat-atlama güvenliği:** süreler `performance.now()` delta; `Date.now()`
 *    yalnız id/gösterim (CLAUDE.md §4).
 *  - **Fail-soft:** hiçbir fonksiyon throw etmez; abone hatası diğerlerini etkilemez.
 *  - **Sıfır-uydurma:** ölçülmemiş değer `null` döner.
 *
 * Bu dosya HİÇBİR servisi import ETMEZ (döngüsel bağımlılık yok, saf test edilebilir);
 * gerçek kaynaklara bağlama işi `concrete/validationCollector.ts` composition
 * root'undadır.
 */

import {
  LOG_MESSAGE_MAX,
  MAVI_RECORD_TEMPLATE,
  OBD_METRICS_TEMPLATE,
  PERF_METRICS_TEMPLATE,
  type MaviValidationInput,
  type MaviValidationRecord,
  type ObdValidationMetrics,
  type PerfValidationMetrics,
  type ValidationChannel,
  type ValidationLevel,
  type ValidationLogEntry,
  type ValidationSnapshot,
} from './validationTypes';

/* ── Sabitler ──────────────────────────────────────────────────────────────── */

/** Canlı kütük tavanı — bounded bellek. */
export const MAX_LOG_ENTRIES  = 300;
/** Mavi kayıt tavanı. */
export const MAX_MAVI_RECORDS = 100;

/* ── Modül durumu ──────────────────────────────────────────────────────────── */

let _active = false;
let _sessionId = '';
let _startedWallMs = 0;
let _origin = 0;          // performance.now() oturum başlangıcı
let _logSeq = 0;
let _maviSeq = 0;

// Kütük ring buffer'ı (sabit boyut).
const _logSlots: (ValidationLogEntry | null)[] = Array.from({ length: MAX_LOG_ENTRIES }, () => null);
let _logHead = 0;
let _logFilled = 0;

// Mavi kayıt ring buffer'ı.
const _maviSlots: (MaviValidationRecord | null)[] = Array.from({ length: MAX_MAVI_RECORDS }, () => null);
let _maviHead = 0;
let _maviFilled = 0;

let _obd: ObdValidationMetrics = OBD_METRICS_TEMPLATE;

/** Performans birikimcileri — sıcak yolda nesne üretmemek için düz sayaçlar. */
const _pkt = { count: 0, lastMonoMs: -1, sumIntervalMs: 0, intervalCount: 0, maxIntervalMs: -1 };
const _lat = { sumAgeMs: 0, count: 0 };
const _fps = { sum: 0, count: 0, min: -1 };
const _mem = { lastMb: -1, peakMb: -1 };
const _cnt = { timeoutCount: 0, recoveryCount: 0 };

const _subscribers = new Set<() => void>();
const _disposers: Array<() => void> = [];

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function _now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function _notify(): void {
  _subscribers.forEach((cb) => { try { cb(); } catch { /* yoksay */ } });
}

/** Ortalama — hiç örnek yoksa `null` ("ölçülmedi"), UYDURMA YOK. */
export function meanOrNull(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

function _resetAccumulators(): void {
  _pkt.count = 0; _pkt.lastMonoMs = -1; _pkt.sumIntervalMs = 0; _pkt.intervalCount = 0; _pkt.maxIntervalMs = -1;
  _lat.sumAgeMs = 0; _lat.count = 0;
  _fps.sum = 0; _fps.count = 0; _fps.min = -1;
  _mem.lastMb = -1; _mem.peakMb = -1;
  _cnt.timeoutCount = 0; _cnt.recoveryCount = 0;
}

/* ── Oturum yaşam döngüsü ──────────────────────────────────────────────────── */

/** Doğrulama oturumu ÇALIŞIYOR mu — kayıt fonksiyonlarının tek kapısı. */
export function isValidationActive(): boolean {
  return _active;
}

/**
 * Yeni doğrulama oturumu başlatır: buffer'ları sıfırlar, monotonik referansı kurar.
 * Şalter kontrolü ÇAĞIRANA aittir (collector) — bu çekirdek saftır.
 * @returns sessionId
 */
export function startValidationSession(): string {
  _logSlots.fill(null);  _logHead = 0;  _logFilled = 0;  _logSeq = 0;
  _maviSlots.fill(null); _maviHead = 0; _maviFilled = 0; _maviSeq = 0;
  _obd = OBD_METRICS_TEMPLATE;
  _resetAccumulators();

  _origin = _now();
  _startedWallMs = Date.now();
  _sessionId = `val-${_startedWallMs.toString(36)}`;
  _active = true;

  recordLog('system', 'info', 'Doğrulama oturumu başladı.');
  return _sessionId;
}

/**
 * Oturumu durdurur ve kayıtlı tüm disposer'ları çalıştırır (zero-leak).
 * Toplanan veri OKUNABİLİR kalır (rapor export'u için) — yalnız kayıt durur.
 */
export function stopValidationSession(): void {
  if (_active) recordLog('system', 'info', 'Doğrulama oturumu durduruldu.');
  _active = false;
  while (_disposers.length) {
    const fn = _disposers.pop();
    try { fn?.(); } catch { /* yoksay */ }
  }
  _notify();
}

/** Dış kaynak temizleyicisi kaydeder (collector abonelikleri buraya yazılır). */
export function registerValidationDisposer(fn: () => void): void {
  _disposers.push(fn);
}

/* ── Kayıt: kütük ──────────────────────────────────────────────────────────── */

/**
 * Canlı kütüğe satır ekler. Mesaj SABİT/BOUNDED olmalıdır — kullanıcı metni,
 * prompt, cevap veya ham araç kimliği GEÇİRİLMEZ (çağıran sözleşmesi).
 */
export function recordLog(channel: ValidationChannel, level: ValidationLevel, message: string): void {
  if (!_active) return;                       // kapalıyken sıfır ek yük

  const entry: ValidationLogEntry = {
    id:       `vlog-${_logSeq++}`,
    tsMonoMs: _now() - _origin,
    tsWallMs: Date.now(),
    channel,
    level,
    message:  (message ?? '').slice(0, LOG_MESSAGE_MAX),
  };

  _logSlots[_logHead] = entry;
  _logHead = (_logHead + 1) % MAX_LOG_ENTRIES;
  if (_logFilled < MAX_LOG_ENTRIES) _logFilled++;
  _notify();
}

/* ── Kayıt: OBD ────────────────────────────────────────────────────────────── */

/**
 * OBD metriklerini günceller (kısmi yama; template spread → hidden class kararlı).
 * Değerler MEVCUT tanı erişimcilerinden TÜRETİLİR; bu fonksiyon ölçüm YAPMAZ.
 */
export function recordObdMetrics(patch: Partial<ObdValidationMetrics>): void {
  if (!_active) return;
  _obd = { ...OBD_METRICS_TEMPLATE, ..._obd, ...patch };
  _notify();
}

/* ── Kayıt: performans ─────────────────────────────────────────────────────── */

/**
 * Canlı veri paketi gözlemi — paketler arası MONOTONİK aralık biriktirilir.
 * Yeni OBD sorgusu ÜRETMEZ; yalnız mevcut akışı sayar.
 */
export function recordLivePacket(): void {
  if (!_active) return;
  const now = _now();
  _pkt.count++;
  if (_pkt.lastMonoMs >= 0) {
    const delta = now - _pkt.lastMonoMs;
    if (delta >= 0) {
      _pkt.sumIntervalMs += delta;
      _pkt.intervalCount++;
      if (delta > _pkt.maxIntervalMs) _pkt.maxIntervalMs = delta;
    }
  }
  _pkt.lastMonoMs = now;
}

/** Canlı veri yaşı örneği (ms) — "gecikme" ortalaması bundan türer. */
export function recordDataAge(ageMs: number): void {
  if (!_active) return;
  if (!Number.isFinite(ageMs) || ageMs < 0) return;   // imkânsız örnek reddedilir
  _lat.sumAgeMs += ageMs;
  _lat.count++;
}

/** FPS örneği. Geçersiz/0 örnek yok sayılır (ölçüm başlamamış olabilir). */
export function recordFpsSample(fps: number): void {
  if (!_active) return;
  if (!Number.isFinite(fps) || fps <= 0) return;
  _fps.sum += fps;
  _fps.count++;
  if (_fps.min < 0 || fps < _fps.min) _fps.min = fps;
}

/** Bellek örneği (MB). Altyapı sağlamıyorsa çağrılmaz → metrik `null` kalır. */
export function recordMemorySample(usedMb: number): void {
  if (!_active) return;
  if (!Number.isFinite(usedMb) || usedMb < 0) return;
  _mem.lastMb = usedMb;
  if (usedMb > _mem.peakMb) _mem.peakMb = usedMb;
}

/** Timeout / kurtarma sayaçlarını MUTLAK değerle senkronlar (çift sayım yok). */
export function recordPerfCounters(timeoutCount: number, recoveryCount: number): void {
  if (!_active) return;
  if (Number.isFinite(timeoutCount) && timeoutCount >= 0) _cnt.timeoutCount = timeoutCount;
  if (Number.isFinite(recoveryCount) && recoveryCount >= 0) _cnt.recoveryCount = recoveryCount;
}

/* ── Kayıt: Mavi ───────────────────────────────────────────────────────────── */

/**
 * Bir Mavi/Operatör çağrısının GÜVENLİ metadata'sını kaydeder.
 * Girdi yalnız sabit jetonlar ve sayılar taşır (çağıran sözleşmesi) — kullanıcı
 * metni/prompt/cevap ASLA geçirilmez.
 */
export function recordMaviRun(input: MaviValidationInput): void {
  if (!_active) return;

  const rec: MaviValidationRecord = {
    ...MAVI_RECORD_TEMPLATE,
    ...input,
    id:       `mavi-${_maviSeq++}`,
    tsMonoMs: _now() - _origin,
  };

  _maviSlots[_maviHead] = rec;
  _maviHead = (_maviHead + 1) % MAX_MAVI_RECORDS;
  if (_maviFilled < MAX_MAVI_RECORDS) _maviFilled++;

  recordLog(
    'mavi', rec.ok ? 'info' : 'warn',
    `Mavi ${rec.intentKind}/${rec.operatorTask} · ${Math.round(rec.durationMs)}ms · ${rec.ok ? 'OK' : `HATA(${rec.errorKind ?? 'unknown'})`}`,
  );
}

/* ── Okuma ─────────────────────────────────────────────────────────────────── */

function _readLog(): ValidationLogEntry[] {
  const out: ValidationLogEntry[] = [];
  const start = _logFilled < MAX_LOG_ENTRIES ? 0 : _logHead;
  for (let i = 0; i < _logFilled; i++) {
    const e = _logSlots[(start + i) % MAX_LOG_ENTRIES];
    if (e) out.push(e);
  }
  return out;
}

function _readMavi(): MaviValidationRecord[] {
  const out: MaviValidationRecord[] = [];
  const start = _maviFilled < MAX_MAVI_RECORDS ? 0 : _maviHead;
  for (let i = 0; i < _maviFilled; i++) {
    const r = _maviSlots[(start + i) % MAX_MAVI_RECORDS];
    if (r) out.push(r);
  }
  return out;
}

/** Birikimcilerden performans metriklerini türetir (ölçülmeyen → `null`). */
function _perfMetrics(): PerfValidationMetrics {
  return {
    ...PERF_METRICS_TEMPLATE,
    liveDataSamples:   _pkt.count,
    avgLiveLatencyMs:  meanOrNull(_lat.sumAgeMs, _lat.count),
    avgPollIntervalMs: meanOrNull(_pkt.sumIntervalMs, _pkt.intervalCount),
    maxLatencyMs:      _pkt.maxIntervalMs >= 0 ? Math.round(_pkt.maxIntervalMs) : null,
    timeoutCount:      _cnt.timeoutCount,
    recoveryCount:     _cnt.recoveryCount,
    memoryUsedMb:      _mem.lastMb >= 0 ? _mem.lastMb : null,
    memoryPeakMb:      _mem.peakMb >= 0 ? _mem.peakMb : null,
    avgFps:            meanOrNull(_fps.sum, _fps.count),
    minFps:            _fps.min >= 0 ? Math.round(_fps.min) : null,
  };
}

/** Oturumun tam anlık görüntüsü (kopya — dış mutasyona kapalı). */
export function getValidationSnapshot(): ValidationSnapshot {
  return {
    sessionId:     _sessionId,
    startedWallMs: _startedWallMs,
    durationMs:    _sessionId ? Math.max(0, _now() - _origin) : 0,
    active:        _active,
    obd:           { ..._obd },
    perf:          _perfMetrics(),
    mavi:          _readMavi(),
    log:           _readLog(),
  };
}

/* ── Abonelik ──────────────────────────────────────────────────────────────── */

/** UI aboneliği — değişimde cb çağrılır. Dönen fonksiyon aboneliği kaldırır. */
export function subscribeValidation(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetValidationRecorderForTest(): void {
  _active = false;
  _sessionId = '';
  _startedWallMs = 0;
  _origin = 0;
  _logSlots.fill(null);  _logHead = 0;  _logFilled = 0;  _logSeq = 0;
  _maviSlots.fill(null); _maviHead = 0; _maviFilled = 0; _maviSeq = 0;
  _obd = OBD_METRICS_TEMPLATE;
  _resetAccumulators();
  _disposers.length = 0;
  _subscribers.clear();
}
