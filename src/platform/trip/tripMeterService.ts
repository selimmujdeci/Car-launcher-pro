/**
 * tripMeterService.ts — RESETLENEBİLİR YOL SAYACI runtime katmanı (P0 · AŞAMA A).
 *
 * Saf model (`tripMeterModel.ts`) üzerine kalıcılık + TEK abonelik kurar.
 * Mesafe otoritesi `useUnifiedVehicleStore.odometer`dir — burada PARALEL
 * mesafe hesabı YAPILMAZ, yalnız delta izlenir. Long road / saha testi
 * (`fieldValidation/longRoadModel.ts`) ve `tripLogService` ile ÇİFT YÖNLÜ
 * yazma YOK — bu servis onlara yazmaz, onlar da buraya yazmaz.
 *
 * Zero-leak: tek Zustand aboneliği, `stopTripMeter()` ile tam cleanup.
 * Yazma throttle: normal ilerlemede en fazla 10 sn'de bir serialize+persist;
 * reset ve tam km sınırı geçişinde `safeFlushKey` ile anında mühürleme.
 */

import {
  emptyTripMeter, advanceTripMeter, resetTripMeter, parseTripMeter,
  canResetTripMeter,
  type TripMeterRecord, type TripMeterResetReason,
} from './tripMeterModel';
import { safeGetRaw, safeSetRaw, safeFlushKey } from '../../utils/safeStorage';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';

export type { TripMeterResetReason } from './tripMeterModel';

const STORAGE_KEY = 'caros-trip-meter-v1';
const METER_ID = 'default';

/** Normal ilerlemede disk yazımı en fazla bu sıklıkta (eMMC ömrü — CLAUDE.md §3). */
const PERSIST_MIN_GAP_MS = 10_000;

export interface TripMeterSnapshot {
  readonly record: TripMeterRecord;
  readonly restoreState: 'RESTORED' | 'CORRUPT' | 'EMPTY';
  readonly lastPersistedAtMs: number | null;
  readonly started: boolean;
}

/* ── Modül durumu ─────────────────────────────────────────── */

let _record: TripMeterRecord = emptyTripMeter(METER_ID);
let _restoreState: 'RESTORED' | 'CORRUPT' | 'EMPTY' = 'EMPTY';
let _lastPersistedAtMs: number | null = null;
let _lastPersistMonoMs = 0;
let _started = false;
let _unsub: (() => void) | null = null;
const _listeners = new Set<(s: TripMeterSnapshot) => void>();

/* ── Kalıcılık ────────────────────────────────────────────── */

function _load(): void {
  try {
    const raw = safeGetRaw(STORAGE_KEY);
    const parsed: unknown = raw !== null ? JSON.parse(raw) : null;
    const { record, restoreState } = parseTripMeter(parsed, METER_ID);
    _record = record;
    _restoreState = restoreState;
  } catch {
    _record = emptyTripMeter(METER_ID);
    _restoreState = 'CORRUPT';
  }
}

function _persist(immediate: boolean): void {
  try {
    const json = JSON.stringify(_record);
    safeSetRaw(STORAGE_KEY, json);
    _lastPersistMonoMs = _mono();
    _lastPersistedAtMs = Date.now();
    if (immediate) safeFlushKey(STORAGE_KEY);
  } catch { /* fail-soft — sayaç RAM'de doğru kalmaya devam eder */ }
}

/** Reset veya tam km sınırı geçişinde anında mühürler; aksi halde 10s throttle. */
function _maybePersist(prevIntegerKm: number): void {
  const crossedIntegerKm = Math.floor(_record.distanceKm) !== prevIntegerKm;
  if (crossedIntegerKm) {
    _persist(true);
    return;
  }
  if (_mono() - _lastPersistMonoMs >= PERSIST_MIN_GAP_MS) {
    _persist(false);
  }
}

function _mono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/* ── Dinleyiciler ─────────────────────────────────────────── */

function _notify(): void {
  const snap = getTripMeterSnapshot();
  _listeners.forEach((fn) => { try { fn(snap); } catch { /* dinleyici hatası servisi bozmaz */ } });
}

/* ── Yaşam döngüsü ────────────────────────────────────────── */

/** İdempotent. Storage'dan restore eder, `odometer`e TEK abonelik kurar. */
export function startTripMeter(): void {
  if (_started) return;
  _started = true;

  _load();

  // İlk okuma: mevcut odometer ile tohumlama/ilerletme (restore sonrası doğru baz).
  try {
    const initialOdo = useUnifiedVehicleStore.getState().odometer;
    const prevIntegerKm = Math.floor(_record.distanceKm);
    _record = advanceTripMeter(_record, initialOdo, Date.now());
    _maybePersist(prevIntegerKm);
  } catch { /* fail-soft */ }

  try {
    _unsub = useUnifiedVehicleStore.subscribe((state, prevState) => {
      if (state.odometer === prevState.odometer) return;
      try {
        const prevIntegerKm = Math.floor(_record.distanceKm);
        _record = advanceTripMeter(_record, state.odometer, Date.now());
        _maybePersist(prevIntegerKm);
        _notify();
      } catch { /* trip meter aboneliği ASLA çökmez */ }
    });
  } catch { /* fail-soft */ }

  _notify();
}

/** Aboneliği söker, son değeri mühürler. Zero-leak. */
export function stopTripMeter(): void {
  if (!_started) return;
  _started = false;
  if (_unsub) { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  _persist(true);
}

/* ── Okuma ────────────────────────────────────────────────── */

/** Senkron anlık görüntü — ASLA throw etmez. */
export function getTripMeterSnapshot(): TripMeterSnapshot {
  try {
    return {
      record: _record,
      restoreState: _restoreState,
      lastPersistedAtMs: _lastPersistedAtMs,
      started: _started,
    };
  } catch {
    return {
      record: emptyTripMeter(METER_ID),
      restoreState: 'CORRUPT',
      lastPersistedAtMs: null,
      started: false,
    };
  }
}

export function subscribeTripMeter(cb: (s: TripMeterSnapshot) => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/* ── Reset ────────────────────────────────────────────────── */

export interface TripMeterResetResult {
  readonly ok: boolean;
  readonly reason: TripMeterResetReason;
}

/**
 * Güvenlik kapısı BURADA: hareket hâlinde veya hız bilinmiyorsa (fail-closed)
 * HİÇBİR ŞEY yazılmaz. İzinliyse yalnız yol sayacı sıfırlanır — trip geçmişi
 * (`tripLogService`), `odometer` store'u, Fleet kayıtları veya long road
 * oturumu ASLA silinmez/dokunulmaz.
 */
export function requestTripMeterReset(): TripMeterResetResult {
  let speed: number | null = null;
  try {
    speed = useUnifiedVehicleStore.getState().speed;
  } catch {
    speed = null;
  }

  const gate = canResetTripMeter(speed);
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason };
  }

  let odo: number | null = null;
  try {
    odo = useUnifiedVehicleStore.getState().odometer;
  } catch {
    odo = null;
  }

  _record = resetTripMeter(_record, odo, Date.now());
  _persist(true);
  _notify();
  return { ok: true, reason: gate.reason };
}
