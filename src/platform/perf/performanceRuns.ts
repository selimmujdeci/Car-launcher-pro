/**
 * performanceRuns — Performans 2.0: 0-100, 60-100 (ara hızlanma), 100-0 (fren).
 *
 * Eski sprint testinden farkı:
 *  - Zaman ÖLÇÜM ANINDAN gelir (OBD hız damgası, `getObdFieldObservedAt`),
 *    ekran/throttle anından değil; eşik geçişi iki örnek arasında doğrusal
 *    enterpolasyonla bulunur → örnek aralığından daha hassas.
 *  - Her sonucun GEÇERLİLİK kararı vardır: seyrek veri, simüle OBD, hız
 *    verisinin kopması, gazın/frenin bırakılması geçersiz kılar; belirgin eğim
 *    uyarı olarak yazılır. Geçersiz koşu rekor sayılmaz.
 *  - Sonuçlar sürücüye göre saklanır; kıyas yalnız aynı sürücünün geçerli
 *    koşularıyla yapılır.
 *
 * Hız yalnız KAYNAĞI DOĞRULANMIŞ OBD hızıdır (`getObdSpeedFresh`); yoksa örnek
 * alınmaz — "0 km/h" varsayılmaz.
 */

import { useEffect, useState } from 'react';
import { onOBDData, getObdSpeedFresh, getObdFieldObservedAt, getOBDDataSnapshot } from '../obdService';
import { getGPSState } from '../gpsService';
import { useStore } from '../../store/useStore';
import { randomToken } from '../../utils/randomId';

export type RunKind = '0-100' | '60-100' | '100-0';

export interface SpeedSample { readonly t: number; readonly kmh: number; readonly altM?: number | null }

export type RunInvalidReason = 'SPARSE_DATA' | 'SIMULATED' | 'LIFTED';
export type RunWarning = 'SLOPE';

export interface RunAnalysis {
  readonly kind: RunKind;
  readonly timeMs: number;
  /** ±ms — eşiklerdeki örnek aralığının yarısı. */
  readonly precisionMs: number;
  readonly distanceM: number;
  /** 100-0: ortalama yavaşlama (g). */
  readonly avgDecelG: number | null;
  readonly maxGapMs: number;
  readonly valid: boolean;
  readonly invalidReasons: readonly RunInvalidReason[];
  readonly warnings: readonly RunWarning[];
}

export const MAX_SAMPLE_GAP_MS = 1200;
export const LIFT_TOLERANCE_KMH = 3;
/** Eğim uyarısı: GPS irtifa farkı en az bu kadar VE eğim eşiğin üstünde. */
const SLOPE_MIN_ALT_M = 6;
const SLOPE_MIN_GRADE = 0.03;
const STOP_KMH = 1;
/** Kalkış/duruş eşiği: OBD hızı tam sayı gelir; 1 km/s "duruyor" sayılır, 2 hareket. */
const MOVE_KMH = 1.5;

const BOUNDS: Record<RunKind, { from: number; to: number; dir: 1 | -1 }> = {
  '0-100':  { from: MOVE_KMH, to: 100, dir: 1 },
  '60-100': { from: 60, to: 100, dir: 1 },
  '100-0':  { from: 100, to: MOVE_KMH, dir: -1 },
};

/* ── Saf analiz ────────────────────────────────────────────────────────── */

interface Crossing { t: number; i: number; gapMs: number }

function crossing(s: readonly SpeedSample[], target: number, dir: 1 | -1, fromIdx = 1): Crossing | null {
  for (let i = Math.max(1, fromIdx); i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    const hit = dir === 1 ? a.kmh < target && b.kmh >= target : a.kmh > target && b.kmh <= target;
    if (!hit) continue;
    const f = b.kmh === a.kmh ? 1 : (target - a.kmh) / (b.kmh - a.kmh);
    return { t: a.t + f * (b.t - a.t), i, gapMs: b.t - a.t };
  }
  return null;
}

function speedAt(s: readonly SpeedSample[], t: number): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const a = s[i - 1], b = s[i];
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.kmh + f * (b.kmh - a.kmh);
    }
  }
  return s[s.length - 1]?.kmh ?? 0;
}

/** t0..t1 arası yol (m) — yamuk kuralı, uçlar enterpole edilir. */
function distanceBetween(s: readonly SpeedSample[], t0: number, t1: number): number {
  const pts: Array<{ t: number; v: number }> = [{ t: t0, v: speedAt(s, t0) }];
  for (const p of s) if (p.t > t0 && p.t < t1) pts.push({ t: p.t, v: p.kmh });
  pts.push({ t: t1, v: speedAt(s, t1) });
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += ((pts[i - 1].v + pts[i].v) / 2 / 3.6) * ((pts[i].t - pts[i - 1].t) / 1000);
  return m;
}

/** Kaydedilen örneklerden koşuyu çözümler. Eşikler bulunamazsa `null`. */
export function analyzeRun(kind: RunKind, samples: readonly SpeedSample[], simulated = false): RunAnalysis | null {
  const b = BOUNDS[kind];
  const start = crossing(samples, b.from, b.dir);
  if (!start) return null;
  const end = crossing(samples, b.to, b.dir, start.i);
  if (!end) return null;

  const window = samples.slice(start.i - 1, end.i + 1);
  let maxGapMs = 0;
  for (let i = 1; i < window.length; i++) maxGapMs = Math.max(maxGapMs, window[i].t - window[i - 1].t);

  // Gaz/fren bırakıldı mı: hızlanmada tepe hızdan düşüş, frende dipten yükseliş.
  let lifted = false;
  let extreme = window[0].kmh;
  for (const p of window) {
    if (b.dir === 1) { if (extreme - p.kmh > LIFT_TOLERANCE_KMH) lifted = true; extreme = Math.max(extreme, p.kmh); }
    else { if (p.kmh - extreme > LIFT_TOLERANCE_KMH) lifted = true; extreme = Math.min(extreme, p.kmh); }
  }

  const timeMs = Math.round(end.t - start.t);
  const distanceM = Math.round(distanceBetween(samples, start.t, end.t) * 10) / 10;
  const invalidReasons: RunInvalidReason[] = [];
  if (simulated) invalidReasons.push('SIMULATED');
  if (maxGapMs > MAX_SAMPLE_GAP_MS) invalidReasons.push('SPARSE_DATA');
  if (lifted) invalidReasons.push('LIFTED');

  const warnings: RunWarning[] = [];
  const alt0 = window.find((p) => typeof p.altM === 'number')?.altM;
  const alt1 = [...window].reverse().find((p) => typeof p.altM === 'number')?.altM;
  if (typeof alt0 === 'number' && typeof alt1 === 'number' && distanceM > 0) {
    const dAlt = Math.abs(alt1 - alt0);
    if (dAlt >= SLOPE_MIN_ALT_M && dAlt / distanceM >= SLOPE_MIN_GRADE) warnings.push('SLOPE');
  }

  const dvMs = Math.abs(b.to - b.from) / 3.6;
  return {
    kind, timeMs,
    precisionMs: Math.round((start.gapMs + end.gapMs) / 4),
    distanceM,
    avgDecelG: kind === '100-0' && timeMs > 0 ? Math.round((dvMs / (timeMs / 1000) / 9.81) * 100) / 100 : null,
    maxGapMs,
    valid: invalidReasons.length === 0,
    invalidReasons, warnings,
  };
}

/* ── Geçmiş ────────────────────────────────────────────────────────────── */

export interface RunRecord extends RunAnalysis {
  readonly id: string;
  readonly at: number;
  readonly driverId: string | null;
}

const HISTORY_KEY = 'caros.perf.runs.v1';
export const MAX_RUN_HISTORY = 40;

export function loadRunHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as RunRecord[]).filter((r) => r && typeof r.timeMs === 'number') : [];
  } catch { return []; }
}

function saveRunHistory(list: readonly RunRecord[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-MAX_RUN_HISTORY))); } catch { /* depo dolu/kilitli */ }
}

/** Aynı sürücü + aynı tür, GEÇERLİ koşular içinde en iyisi (en kısa süre). */
export function bestRun(history: readonly RunRecord[], kind: RunKind, driverId: string | null, excludeId?: string): RunRecord | null {
  let best: RunRecord | null = null;
  for (const r of history) {
    if (r.kind !== kind || !r.valid || r.driverId !== driverId || r.id === excludeId) continue;
    if (!best || r.timeMs < best.timeMs) best = r;
  }
  return best;
}

/* ── Kayıt makinesi (tek aktif koşu) ───────────────────────────────────── */

export type RunPhase = 'idle' | 'arming' | 'ready' | 'recording' | 'done';

export interface RunState {
  readonly kind: RunKind | null;
  readonly phase: RunPhase;
  readonly liveKmh: number | null;
  readonly liveMs: number;
  readonly result: RunRecord | null;
  /** Bir önceki en iyiye göre fark (ms; negatif = daha hızlı). */
  readonly deltaVsBestMs: number | null;
  readonly note: string | null;
}

const TIMEOUT_MS: Record<RunKind, number> = { '0-100': 40_000, '60-100': 30_000, '100-0': 20_000 };
const SPEED_LOST_MS = 2500;
const PRE_SAMPLES = 3;

let _state: RunState = { kind: null, phase: 'idle', liveKmh: null, liveMs: 0, result: null, deltaVsBestMs: null, note: null };
const _listeners = new Set<(s: RunState) => void>();
let _buf: SpeedSample[] = [];
let _recStartT = 0;
let _unsub: (() => void) | null = null;
let _lostTimer: ReturnType<typeof setInterval> | null = null;
let _lastSampleWall = 0;

function emit(p: Partial<RunState>): void {
  _state = { ..._state, ...p };
  _listeners.forEach((fn) => fn(_state));
}

function stopFeed(): void {
  _unsub?.(); _unsub = null;
  if (_lostTimer) { clearInterval(_lostTimer); _lostTimer = null; }
}

function readyNote(kind: RunKind): string {
  return kind === '0-100' ? 'Hazır — kalkışla ölçüm başlar'
    : kind === '60-100' ? 'Hazır — 60 km/s geçişinde ölçüm başlar'
    : 'Hazır — frene basınca ölçüm başlar';
}

function armNote(kind: RunKind): string {
  return kind === '0-100' ? 'Tamamen dur'
    : kind === '60-100' ? '55 km/s altına in'
    : '100 km/s üstüne çık';
}

/** Tek hız örneğini makineye verir (test ve canlı akış aynı yolu kullanır). */
export function feedRunSample(sample: SpeedSample, simulated = false, wallNow = Date.now()): void {
  const kind = _state.kind;
  if (!kind || _state.phase === 'idle' || _state.phase === 'done') return;
  const last = _buf[_buf.length - 1];
  if (last && sample.t <= last.t) return;          // aynı ölçüm tekrar gelmez
  _lastSampleWall = wallNow;
  const v = sample.kmh;

  if (_state.phase === 'arming') {
    const ok = kind === '0-100' ? v <= STOP_KMH : kind === '60-100' ? v < 55 : v >= 102;
    _buf = [sample];
    emit(ok ? { phase: 'ready', liveKmh: v, note: readyNote(kind) } : { liveKmh: v });
    return;
  }

  _buf.push(sample);
  if (_state.phase === 'ready') {
    const go = kind === '0-100' ? v > STOP_KMH : kind === '60-100' ? v >= 60 : v < 100;
    if (!go) { _buf = _buf.slice(-PRE_SAMPLES); emit({ liveKmh: v }); return; }
    _recStartT = sample.t;
    emit({ phase: 'recording', liveKmh: v, liveMs: 0, note: null });
  }

  // recording
  const elapsed = sample.t - _recStartT;
  const falseStart = kind === '0-100' ? v <= STOP_KMH
    : kind === '60-100' ? v < 55
    : v > 102;
  if (falseStart || elapsed > TIMEOUT_MS[kind]) {
    _buf = [sample];
    emit({ phase: falseStart ? 'ready' : 'arming', liveKmh: v, liveMs: 0,
      note: falseStart ? `Ölçüm iptal — ${readyNote(kind).toLowerCase()}` : `Süre doldu — ${armNote(kind).toLowerCase()}` });
    return;
  }
  const finished = kind === '100-0' ? v <= STOP_KMH : v >= 100;
  if (!finished) { emit({ liveKmh: v, liveMs: elapsed }); return; }

  const a = analyzeRun(kind, _buf, simulated);
  stopFeed();
  if (!a) { emit({ phase: 'done', liveKmh: v, note: 'Eşik geçişleri ölçülemedi', result: null }); return; }
  const driverId = useStore.getState().settings.activeDriverProfileId ?? null;
  const history = loadRunHistory();
  const rec: RunRecord = { ...a, id: randomToken(10), at: wallNow, driverId };
  const prevBest = bestRun(history, kind, driverId);
  saveRunHistory([...history, rec]);
  emit({
    phase: 'done', liveKmh: v, liveMs: a.timeMs, result: rec, note: null,
    deltaVsBestMs: rec.valid && prevBest ? rec.timeMs - prevBest.timeMs : null,
  });
}

function onLiveData(): void {
  const kmh = getObdSpeedFresh();
  if (kmh === null) return;                         // hız bilinmiyor → örnek yok
  let t = 0;
  try { t = getObdFieldObservedAt().speedMs; } catch { t = 0; }
  if (!t) return;
  let altM: number | null = null;
  try { const alt = getGPSState().location?.altitude; altM = typeof alt === 'number' && Number.isFinite(alt) ? alt : null; } catch { altM = null; }
  let simulated = false;
  try { simulated = getOBDDataSnapshot().source === 'mock'; } catch { simulated = false; }
  feedRunSample({ t, kmh, altM }, simulated);
}

export function startRun(kind: RunKind): void {
  stopFeed();
  _buf = [];
  emit({ kind, phase: 'arming', liveKmh: null, liveMs: 0, result: null, deltaVsBestMs: null, note: armNote(kind) });
  _unsub = onOBDData(onLiveData);
  _lastSampleWall = Date.now();
  _lostTimer = setInterval(() => {
    if (_state.phase === 'recording' && Date.now() - _lastSampleWall > SPEED_LOST_MS) {
      _buf = [];
      emit({ phase: 'arming', liveMs: 0, note: 'Hız verisi kesildi — ölçüm iptal' });
    }
  }, 500);
  onLiveData();
}

export function cancelRun(): void {
  stopFeed();
  _buf = [];
  emit({ kind: null, phase: 'idle', liveKmh: null, liveMs: 0, note: null });
}

/** Test yardımcısı — makineyi ağa/OBD'ye bağlamadan başlatır. */
export function _armRunForTest(kind: RunKind): void {
  stopFeed(); _buf = [];
  emit({ kind, phase: 'arming', liveKmh: null, liveMs: 0, result: null, deltaVsBestMs: null, note: armNote(kind) });
}

export function getRunState(): RunState { return _state; }

export function useRunState(): RunState {
  const [s, set] = useState<RunState>(_state);
  useEffect(() => { set(_state); _listeners.add(set); return () => { _listeners.delete(set); }; }, []);
  return s;
}
