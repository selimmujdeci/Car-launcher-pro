/**
 * visionCore.ts — Kamera akışı ve RAF döngüsü.
 *
 * Tek sorumluluk: kamera başlatma/durdurma + frame yakalama + CV tetikleme.
 *
 * AdaptiveRuntime throttle (Mali-400 optimizasyonu):
 *   SAFE_MODE              → tespit tamamen durdurulur (0 CPU)
 *   POWER_SAVE / BASIC_JS  → her 12. frame'de bir (~5fps)
 *   BALANCED / PERFORMANCE → her 6. frame'de bir (~10fps)
 */

import { logError }       from '../crashLogger';
import { useVisionStore } from '../visionStore';
import type { VisionFrame, VisionStore } from '../visionStore';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }    from '../../core/runtime/runtimeTypes';
import {
  PROC_W,
  PROC_H,
  DETECT_INTERVAL,
  runDetection,
  computeAndPublishConfidence,
  resetConfidenceHistory,
} from './visionImageProcess';

// ── Modül state ───────────────────────────────────────────────────────────────

const STATE_SYNC_MS = 100;  // 10fps — React store yenileme hızı

let _stream:    MediaStream | null                                                  = null;
let _videoEl:   HTMLVideoElement | null                                             = null;
let _procCanvas: OffscreenCanvas | HTMLCanvasElement | null                        = null;
let _procCtx:   OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
let _rafId:     number | null = null;
let _running    = false;
let _tick       = 0;

let _lastFrame: VisionFrame = { lanes: [], signs: [], lateralOffsetM: null, processingMs: 0, timestamp: 0 };
const _frameListeners = new Set<(f: VisionFrame) => void>();

let _syncTimer:      ReturnType<typeof setInterval> | null = null;
let _newFrameReady   = false;
let _pendingState:   'active' | 'degraded' | null = null;

// ── State sync (RAF → React, 10fps) ──────────────────────────────────────────

function _set(patch: Partial<VisionStore>): void {
  useVisionStore.setState((s) => ({ ...s, ...patch }));
}

function _startStateSync(): void {
  if (_syncTimer) return;
  _syncTimer = setInterval(() => {
    if (!_running) return;
    if (_pendingState !== null) { _set({ state: _pendingState }); _pendingState = null; }
    if (_newFrameReady) {
      _newFrameReady = false;
      _set({ frame: _lastFrame });
      computeAndPublishConfidence(_lastFrame);
    }
  }, STATE_SYNC_MS);
}

function _stopStateSync(): void {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
  _newFrameReady = false;
  _pendingState  = null;
}

// ── RAF döngüsü ───────────────────────────────────────────────────────────────

function _loop(): void {
  if (!_running) return;

  try {
    if (_videoEl && _procCtx && _videoEl.readyState >= 2) {
      _procCtx.drawImage(_videoEl, 0, 0, PROC_W, PROC_H);
      _tick++;

      // ── AdaptiveRuntime throttle ────────────────────────────────────────────
      const mode      = runtimeManager.getMode();
      const isSafe    = mode === RuntimeMode.SAFE_MODE;
      const isLowPow  = mode === RuntimeMode.POWER_SAVE || mode === RuntimeMode.BASIC_JS;
      // SAFE_MODE: tespit yok; POWER_SAVE/BASIC_JS: 2× yavaşlatılmış; diğerleri: normal
      const interval  = isSafe ? 0 : isLowPow ? DETECT_INTERVAL * 2 : DETECT_INTERVAL;

      if (interval > 0 && _tick % interval === 0) {
        try {
          _lastFrame = runDetection(_procCtx);
          _frameListeners.forEach((fn) => fn(_lastFrame));
          _newFrameReady = true;
          if (useVisionStore.getState().state === 'degraded') _pendingState = 'active';
        } catch (detErr) {
          logError('VisionCore:detect', detErr);
          if (useVisionStore.getState().state === 'active') _pendingState = 'degraded';
        }
      }
    }
  } catch (frameErr) {
    logError('VisionCore:loop', frameErr);
  }

  _rafId = requestAnimationFrame(_loop);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function checkVisionCapabilities(): Promise<boolean> {
  try {
    _set({ state: 'checking' });
    if (!navigator.mediaDevices?.enumerateDevices) { _set({ state: 'disabled', hasCamera: false }); return false; }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const has = devices.some((d) => d.kind === 'videoinput');
    _set({ hasCamera: has, state: has ? 'idle' : 'disabled' });
    return has;
  } catch {
    _set({ state: 'disabled', hasCamera: false });
    return false;
  }
}

export async function startVision(videoEl: HTMLVideoElement): Promise<void> {
  const cur = useVisionStore.getState().state;
  if (cur === 'active' || cur === 'initializing' || cur === 'disabled') return;

  _running = true;
  _videoEl = videoEl;

  try {
    _set({ state: 'requesting' });
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
      audio: false,
    });
    _set({ state: 'initializing', permissionGranted: true });

    videoEl.srcObject   = _stream;
    videoEl.playsInline = true;
    videoEl.muted       = true;
    await videoEl.play();

    if (typeof OffscreenCanvas !== 'undefined') {
      _procCanvas = new OffscreenCanvas(PROC_W, PROC_H);
      _procCtx    = (_procCanvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
    } else {
      const c = document.createElement('canvas');
      c.width = PROC_W; c.height = PROC_H;
      _procCanvas = c;
      _procCtx    = c.getContext('2d');
    }

    _stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      logError('VisionCore:stream', new Error('Video track ended unexpectedly'));
      stopVision();
      _set({ state: 'error', error: 'Kamera akışı kesildi' });
    });

    _set({ state: 'active', error: null });
    _tick  = 0;
    _startStateSync();
    _rafId = requestAnimationFrame(_loop);

  } catch (err) {
    _running = false;
    const msg    = err instanceof Error ? err.message : String(err);
    const denied = /NotAllowed|Permission/i.test(msg);
    logError('VisionCore:start', err);
    _set({ state: denied ? 'disabled' : 'error', error: denied ? 'Kamera izni verilmedi' : msg, permissionGranted: !denied });
    throw err;
  }
}

export function stopVision(): void {
  _running = false;
  _stopStateSync();
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
  if (_videoEl) { _videoEl.srcObject = null; _videoEl = null; }
  _procCtx = null; _procCanvas = null; _tick = 0;
  resetConfidenceHistory();
  _set({ state: 'idle', frame: null, error: null, confidence: 0, confidenceLevel: 'off' });
}

export function disableVision(): void { stopVision(); _set({ state: 'disabled' }); }

export function onVisionFrame(fn: (f: VisionFrame) => void): () => void {
  _frameListeners.add(fn);
  return () => _frameListeners.delete(fn);
}

export function getLastFrame(): VisionFrame { return _lastFrame; }

/* ── HMR cleanup ─────────────────────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => { _stopStateSync(); stopVision(); _frameListeners.clear(); });
}
