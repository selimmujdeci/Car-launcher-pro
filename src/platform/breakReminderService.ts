/**
 * Break Reminder Service — Mola Hatırlatıcı.
 *
 * Çalışma prensibi:
 *   - OBD hızı > 5 km/h ise "sürüş" sayılır
 *   - Kesintisiz sürüş süresi INTERVAL_MIN aşınca uyarı gösterilir
 *   - Araç durursa (5+ dk) sayaç sıfırlanır
 *   - Kullanıcı uyarıyı dismiss ederse 30 dk sonra tekrar uyarır
 */

import { useState, useEffect } from 'react';

/* ── Sabitler ────────────────────────────────────────────── */

const SPEED_THRESHOLD_KMH = 5;
const STOP_RESET_MIN      = 5;     // dk — araç durursa sayaç sıfırlanır
const DEFAULT_INTERVAL_MIN = 120;  // 2 saat
const SNOOZE_MIN           = 30;   // dismiss sonrası gecikme

/* ── Tipler ──────────────────────────────────────────────── */

export interface BreakReminderState {
  enabled:            boolean;
  intervalMin:        number;
  drivingStartedAt:   number | null;  // epoch ms
  drivingElapsedMin:  number;
  alertVisible:       boolean;
  lastDismissedAt:    number | null;
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: BreakReminderState = {
  enabled:           false,
  intervalMin:       DEFAULT_INTERVAL_MIN,
  drivingStartedAt:  null,
  drivingElapsedMin: 0,
  alertVisible:      false,
  lastDismissedAt:   null,
};

let _state: BreakReminderState = { ...INITIAL };
const _listeners = new Set<(s: BreakReminderState) => void>();

function push(partial: Partial<BreakReminderState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Sayaç ticker ────────────────────────────────────────── */

let _tickerId: ReturnType<typeof setInterval> | null = null;
let _stoppedAt: number | null = null;

function startTicker(): void {
  if (_tickerId) return;
  _tickerId = setInterval(() => {
    if (!_state.enabled || !_state.drivingStartedAt) return;
    const elapsedMin = (Date.now() - _state.drivingStartedAt) / 60000;
    push({ drivingElapsedMin: elapsedMin });

    if (!_state.alertVisible && elapsedMin >= _state.intervalMin) {
      // Snooze kontrolü
      const sinceSnooze = _state.lastDismissedAt
        ? (Date.now() - _state.lastDismissedAt) / 60000
        : Infinity;
      if (sinceSnooze >= SNOOZE_MIN) {
        push({ alertVisible: true });
      }
    }
  }, 30000); // 30 sn'de bir kontrol
}

function stopTicker(): void {
  if (_tickerId) { clearInterval(_tickerId); _tickerId = null; }
}

/* ── Hız güncellemesi ────────────────────────────────────── */

/**
 * Her OBD güncellemesinde çağrılır.
 */
export function updateBreakReminder(speedKmh: number): void {
  if (!_state.enabled) return;

  const moving = speedKmh >= SPEED_THRESHOLD_KMH;

  if (moving) {
    _stoppedAt = null;
    if (!_state.drivingStartedAt) {
      push({ drivingStartedAt: Date.now(), drivingElapsedMin: 0 });
      startTicker();
    }
  } else {
    // Araç durdu — STOP_RESET_MIN sonra sayaç sıfırla
    if (_state.drivingStartedAt && _stoppedAt === null) {
      _stoppedAt = Date.now();
    }
    if (_stoppedAt && (Date.now() - _stoppedAt) / 60000 >= STOP_RESET_MIN) {
      _stoppedAt = null;
      stopTicker();
      push({
        drivingStartedAt: null,
        drivingElapsedMin: 0,
        alertVisible: false,
      });
    }
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function enableBreakReminder(intervalMin?: number): void {
  push({
    enabled:    true,
    intervalMin: intervalMin ?? _state.intervalMin,
    alertVisible: false,
  });
}

export function disableBreakReminder(): void {
  stopTicker();
  push({ ...INITIAL, intervalMin: _state.intervalMin });
}

export function setBreakInterval(minutes: number): void {
  push({ intervalMin: minutes });
}

export function dismissBreakAlert(): void {
  push({ alertVisible: false, lastDismissedAt: Date.now() });
}

export function getBreakReminderState(): BreakReminderState { return _state; }

/* ── React hook ──────────────────────────────────────────── */

export function useBreakReminderState(): BreakReminderState {
  const [state, setState] = useState<BreakReminderState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
