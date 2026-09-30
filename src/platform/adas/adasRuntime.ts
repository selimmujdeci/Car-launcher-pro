/**
 * adasRuntime.ts — ADAS çalışma zamanı: kamera kirası + kare işleme + yayımlama.
 *
 * TEK YAZAR: `adasStore`un canlı alanlarını yalnız bu modül yazar.
 *
 * KAPI (kamera ne zaman açık?) — ısı/pil bütçesi gerçek bir kısıttır (bkz.
 * realDriveFindings K: görünmeyen kamera 28 saat açık kalmıştı). ADAS kamerası:
 *   · kullanıcı ADAS'ı AÇIK tuttuysa,
 *   · geri vites YOKSA (ileri yön uyarısı anlamsız + aynı kamerayı geri görüş ister),
 *   · çalışma modu SAFE_MODE değilse,
 *   · ve araç son 3 dk içinde HAREKET ETTİYSE (trafik ışığında kalkış uyarısı sürer;
 *     park hâlinde kamera BIRAKILIR)
 * açıktır. Hız bilinmiyorsa uyarı ÜRETİLMEZ (fail-closed) ama iz ısınmaya devam eder.
 *
 * DAYANIKLILIK:
 *   · Donma bekçisi: 600 ms kare gelmezse sinyaller DÜŞER, durum 'degraded/frozen'.
 *   · USB kamera çekilirse: 'unavailable/camera_lost'; takılınca (devicechange /
 *     native usbCameraChanged) ya da geri çekilmeli yeniden denemeyle geri gelir.
 *   · Seçili kamera yoksa başka kameraya DÜŞÜLMEZ (kalibrasyon kameraya özgü).
 */

import { useAdasStore, getAdasCalibration, saveAdasCalibration, beginAdasEpoch, setAdasStatus,
  clearAdasSignals, publishAdasEvaluation } from './adasStore';
import type { AdasSettings } from './adasStore';
import { AdasFrameProcessor } from './adasFrameProcessor';
import { isMetricCalibration } from './adasCalibration';
import { classifyCameraLabel, subscribeCameraChanges } from './adasCameraDiscovery';
import type { AdasCalibration, AdasReason, AdasTurnSignal } from './adasTypes';
import type { VehicleDetectorConfig } from './adasVehicleDetector';
import {
  startVision, stopVision, onVisionFrame, setVisionCameraPreference, setVisionDetectorConfig,
  getActiveVisionCamera,
} from '../vision/visionCore';
import { PROC_W, PROC_H } from '../vision/visionImageProcess';
import { useVisionStore } from '../visionStore';
import type { VisionFrame } from '../visionStore';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import type { UnifiedVehicleState } from '../vehicleDataLayer/UnifiedVehicleStore';
import { isGateSafeMode, getActiveProfileSignalNames } from '../canBus/ProfileSignalGate';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import { logError } from '../crashLogger';

export const ADAS_RUNTIME_CFG = {
  GATE_TICK_MS: 1000,
  WATCHDOG_MS: 200,
  FROZEN_MS: 600,
  FIRST_FRAME_TIMEOUT_MS: 3000,
  PARK_RELEASE_MS: 180_000,
  SPEED_FRESH_MS: 2000,
  MOVING_KMH: 5,
  BLINKER_HOLD_MS: 1500,
  RETRY_BASE_MS: 5000,
  RETRY_MAX_MS: 60_000,
} as const;

// ── Saf kapı kararı ──────────────────────────────────────────────────────────

export interface AdasGateInput {
  enabled: boolean;
  reverse: boolean;
  safeMode: boolean;
  /** Taze hız ya da null. */
  speedKmh: number | null;
  /** Son "hareket" anı (performance.now; hiç yoksa −∞). */
  lastMovingTs: number;
  now: number;
}

export type AdasGateDecision =
  | { run: true }
  | { run: false; status: 'off' | 'standby'; reason: AdasReason | null };

export function evaluateAdasGate(i: AdasGateInput): AdasGateDecision {
  if (!i.enabled) return { run: false, status: 'off', reason: null };
  if (i.reverse) return { run: false, status: 'standby', reason: 'reverse' };
  if (i.safeMode) return { run: false, status: 'standby', reason: 'safe_mode' };
  if (i.now - i.lastMovingTs < ADAS_RUNTIME_CFG.PARK_RELEASE_MS) return { run: true };
  if (i.speedKmh === null) return { run: false, status: 'standby', reason: 'no_speed' };
  return { run: false, status: 'standby', reason: 'parked' };
}

/** Hız yalnız TAZEYSE kullanılır; bayat hız "bilinmiyor"dur (sahte 0 değil). */
export function freshSpeedKmh(v: Pick<UnifiedVehicleState, 'speed' | '_vehicleSpeedTs'>, nowMono: number): number | null {
  if (v.speed == null || !Number.isFinite(v.speed)) return null;
  if (nowMono - v._vehicleSpeedTs > ADAS_RUNTIME_CFG.SPEED_FRESH_MS) return null;
  return v.speed;
}

export function detectorConfigFor(cal: AdasCalibration): VehicleDetectorConfig {
  return { horizonV: cal.horizonV, forwardU: cal.forwardU, hoodV: cal.hoodV, cameraHeightM: cal.cameraHeightM };
}

// ── Modül durumu ─────────────────────────────────────────────────────────────

let _started = false;
let _leased = false;
let _acquiring = false;
let _wantRun = false;
/** İzin reddedildi — kullanıcı ADAS'ı yeniden açana kadar kamera İSTENMEZ (döngü yok). */
let _permissionBlocked = false;
let _epoch = 0;
let _acquiredAt = 0;
let _lastMovingTs = Number.NEGATIVE_INFINITY;
let _lastLeftOnTs = Number.NEGATIVE_INFINITY;
let _lastRightOnTs = Number.NEGATIVE_INFINITY;
let _retryDelay: number = ADAS_RUNTIME_CFG.RETRY_BASE_MS;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _gateTimer: ReturnType<typeof setInterval> | null = null;
let _watchdog: ReturnType<typeof setInterval> | null = null;
let _unsubs: Array<() => void> = [];
const _processor = new AdasFrameProcessor();

function settings(): AdasSettings {
  return useAdasStore.getState().settings;
}

function isSafeMode(): boolean {
  try { return runtimeManager.getMode() === RuntimeMode.SAFE_MODE; } catch { return false; }
}

function turnSignalNow(now: number): AdasTurnSignal {
  let available = false;
  try {
    const names = getActiveProfileSignalNames();
    available = !isGateSafeMode() && names.has('turnLeft') && names.has('turnRight');
  } catch { available = false; }
  if (!available) return 'unknown';
  // Sinyal lambası yanıp söner → son yanma anından itibaren kısa tutma; sürekli
  // yanan (değişmeyen, yayın üretmeyen) sinyal anlık değerden okunur.
  const v = useUnifiedVehicleStore.getState();
  if (v.canTurnLeft || now - _lastLeftOnTs <= ADAS_RUNTIME_CFG.BLINKER_HOLD_MS) return 'left';
  if (v.canTurnRight || now - _lastRightOnTs <= ADAS_RUNTIME_CFG.BLINKER_HOLD_MS) return 'right';
  return 'none';
}

// ── Kapı değerlendirmesi ─────────────────────────────────────────────────────

function evaluateGateNow(): void {
  if (!_started) return;
  const now = performance.now();
  const v = useUnifiedVehicleStore.getState();
  const speed = freshSpeedKmh(v, now);
  // Sabit hızda store yayın üretmeyebilir → hareket damgası tick'te de tazelenir.
  if (speed !== null && speed > ADAS_RUNTIME_CFG.MOVING_KMH) _lastMovingTs = now;
  const decision = evaluateAdasGate({
    enabled: settings().enabled,
    reverse: v.reverse === true,
    safeMode: isSafeMode(),
    speedKmh: speed,
    lastMovingTs: _lastMovingTs,
    now,
  });
  _wantRun = decision.run;
  if (decision.run) {
    if (!_leased && !_acquiring && _retryTimer === null && !_permissionBlocked) void acquire();
  } else {
    release(decision.status, decision.reason);
  }
}

// ── Kira al / bırak ──────────────────────────────────────────────────────────

async function acquire(): Promise<void> {
  if (_leased || _acquiring) return;
  _acquiring = true;
  const s = settings();
  const cal = getAdasCalibration(s.cameraDeviceId);
  setAdasStatus('starting', null);
  try {
    await setVisionCameraPreference(s.cameraDeviceId);
    setVisionDetectorConfig(detectorConfigFor(cal));
    _epoch = beginAdasEpoch(null);
    _processor.reset();
    await startVision(null, { owner: 'adas' });

    if (!_started || !_wantRun) { stopVision('adas'); setVisionDetectorConfig(null); return; }
    const vs = useVisionStore.getState();
    if (vs.state !== 'active') throw new Error(vs.error ?? `vision:${vs.state}`);

    _leased = true;
    _acquiredAt = performance.now();
    _retryDelay = ADAS_RUNTIME_CFG.RETRY_BASE_MS;
    const cam = getActiveVisionCamera();
    useAdasStore.setState({
      camera: cam.deviceId
        ? { deviceId: cam.deviceId, label: cam.label ?? '', kind: cam.label ? classifyCameraLabel(cam.label) : 'unknown' }
        : null,
    });
    setAdasStatus(isMetricCalibration(cal) ? 'active' : 'calibrating', isMetricCalibration(cal) ? null : 'calibration_pending');
    startWatchdog();
  } catch (e) {
    const vs = useVisionStore.getState();
    const reason: AdasReason = vs.state === 'disabled'
      ? 'permission_denied'
      : vs.error === 'Seçili kamera bulunamadı' ? 'camera_missing' : 'camera_error';
    logError('AdasRuntime:acquire', e);
    setVisionDetectorConfig(null);
    setAdasStatus('unavailable', reason);
    // İzin reddi kullanıcı eylemi bekler; diğerleri geri çekilmeli yeniden dener.
    if (reason === 'permission_denied') _permissionBlocked = true;
    else scheduleRetry();
  } finally {
    _acquiring = false;
  }
}

function release(status: 'off' | 'standby' | 'unavailable', reason: AdasReason | null): void {
  cancelRetry();
  stopWatchdog();
  if (status === 'off') _permissionBlocked = false;
  if (_leased) {
    _leased = false;
    stopVision('adas');
    setVisionDetectorConfig(null);
  }
  _processor.reset();
  clearAdasSignals();
  setAdasStatus(status, reason);
}

/** Kira dışarıdan kaybedildi (parça bitti / USB çekildi / görü hatası). */
function onLeaseLost(): void {
  if (!_leased) return;
  _leased = false;
  stopWatchdog();
  _processor.reset();
  clearAdasSignals();
  setAdasStatus('unavailable', 'camera_lost');
  scheduleRetry();
}

function scheduleRetry(): void {
  if (_retryTimer !== null || !_started) return;
  const delay = _retryDelay;
  _retryDelay = Math.min(ADAS_RUNTIME_CFG.RETRY_MAX_MS, _retryDelay * 2);
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    evaluateGateNow();
  }, delay);
}

function cancelRetry(): void {
  if (_retryTimer !== null) { clearTimeout(_retryTimer); _retryTimer = null; }
}

// ── Kare işleme ──────────────────────────────────────────────────────────────

function onFrame(frame: VisionFrame): void {
  if (!_leased) return;
  try {
    const now = frame.captureMonoMs ?? performance.now();
    const s = settings();
    const cal = getAdasCalibration(s.cameraDeviceId);
    const r = _processor.process(frame, {
      now,
      speedKmh: freshSpeedKmh(useUnifiedVehicleStore.getState(), performance.now()),
      turnSignal: turnSignalNow(now),
      calibration: cal,
      sensitivity: s.sensitivity,
      procW: PROC_W,
      procH: PROC_H,
    });

    if (r.horizonUpdate && cal.source === 'default') {
      const next: AdasCalibration = { ...cal, horizonV: r.horizonUpdate.horizonV, forwardU: r.horizonUpdate.forwardU, source: 'auto' };
      saveAdasCalibration(s.cameraDeviceId, next);
      setVisionDetectorConfig(detectorConfigFor(next));
    }

    publishAdasEvaluation({
      epoch: _epoch,
      ts: now,
      forwardCollision: s.forwardCollision && r.forwardCollision,
      headway: s.headway && r.headway,
      laneDeparture: s.laneDeparture ? r.laneDeparture : null,
      leadDeparture: s.leadDeparture && r.leadDeparture,
      lead: r.lead,
      lane: r.lane,
      calibrationProgress: r.calibrationProgress,
    });

    const metric = isMetricCalibration(getAdasCalibration(s.cameraDeviceId));
    if (r.lowLight) setAdasStatus('degraded', 'low_light');
    else if (metric) setAdasStatus('active', null);
    else setAdasStatus('calibrating', 'calibration_pending');
  } catch (e) {
    logError('AdasRuntime:frame', e);
  }
}

// ── Donma bekçisi ────────────────────────────────────────────────────────────

function startWatchdog(): void {
  if (_watchdog !== null) return;
  _watchdog = setInterval(() => {
    if (!_leased) return;
    const now = performance.now();
    const last = useAdasStore.getState().lastFrameTs;
    const frozen = last === null
      ? now - _acquiredAt > ADAS_RUNTIME_CFG.FIRST_FRAME_TIMEOUT_MS
      : now - last > ADAS_RUNTIME_CFG.FROZEN_MS;
    if (frozen) {
      clearAdasSignals();
      setAdasStatus('degraded', 'frozen');
    }
  }, ADAS_RUNTIME_CFG.WATCHDOG_MS);
}

function stopWatchdog(): void {
  if (_watchdog !== null) { clearInterval(_watchdog); _watchdog = null; }
}

// ── Yaşam döngüsü ────────────────────────────────────────────────────────────

/** Idempotent. @returns durdurma fonksiyonu (SystemBoot LIFO temizliği). */
export function startAdasRuntime(): () => void {
  if (_started) return stopAdasRuntime;
  _started = true;

  _unsubs.push(onVisionFrame(onFrame));

  _unsubs.push(useUnifiedVehicleStore.subscribe((s, prev) => {
    const now = performance.now();
    if (s.speed != null && s.speed > ADAS_RUNTIME_CFG.MOVING_KMH) _lastMovingTs = now;
    if (s.canTurnLeft) _lastLeftOnTs = now;
    if (s.canTurnRight) _lastRightOnTs = now;
    if (s.reverse !== prev.reverse) evaluateGateNow();
    else if (!_leased && !_acquiring && _wantRun === false && s.speed != null && s.speed > ADAS_RUNTIME_CFG.MOVING_KMH
      && prev.speed !== s.speed && settings().enabled) {
      evaluateGateNow(); // park → kalkış: 1 sn'lik tick'i bekleme
    }
  }));

  _unsubs.push(useAdasStore.subscribe((s, prev) => {
    const a = s.settings, b = prev.settings;
    if (a.enabled !== b.enabled) {
      if (a.enabled) {
        // Kullanıcı açık eylemi: önceki izin reddi / geri çekilme sıfırlanır.
        cancelRetry();
        _retryDelay = ADAS_RUNTIME_CFG.RETRY_BASE_MS;
        _permissionBlocked = false;
        if (useVisionStore.getState().state === 'disabled') stopVision('adas'); // 'disabled' → 'idle'
      }
      evaluateGateNow();
      return;
    }
    if (a.cameraDeviceId !== b.cameraDeviceId || s.calibrations !== prev.calibrations) {
      _processor.resetCalibration();
      if (a.cameraDeviceId !== b.cameraDeviceId && _leased) {
        // Farklı kamera = farklı kalibrasyon → temiz oturum.
        release('standby', null);
        evaluateGateNow();
      } else if (_leased) {
        setVisionDetectorConfig(detectorConfigFor(getAdasCalibration(a.cameraDeviceId)));
      }
    }
  }));

  _unsubs.push(useVisionStore.subscribe((s, prev) => {
    if (_leased && s.state !== prev.state && (s.state === 'error' || s.state === 'disabled' || s.state === 'idle')) {
      onLeaseLost();
    }
  }));

  _unsubs.push(subscribeCameraChanges(() => {
    const st = useAdasStore.getState();
    if (st.status === 'unavailable' && (st.reason === 'camera_missing' || st.reason === 'camera_lost' || st.reason === 'camera_error')) {
      cancelRetry();
      _retryDelay = ADAS_RUNTIME_CFG.RETRY_BASE_MS;
      evaluateGateNow();
    }
  }));

  _gateTimer = setInterval(evaluateGateNow, ADAS_RUNTIME_CFG.GATE_TICK_MS);
  evaluateGateNow();
  return stopAdasRuntime;
}

export function stopAdasRuntime(): void {
  if (!_started) return;
  release('off', null);
  _started = false;
  _wantRun = false;
  if (_gateTimer !== null) { clearInterval(_gateTimer); _gateTimer = null; }
  for (const u of _unsubs) { try { u(); } catch { /* temizlik fail-soft */ } }
  _unsubs = [];
}
