/**
 * Camera Service — geri görüş kamerası yönetimi (R-7 Boot-Split)
 *
 * Native: CarLauncherPlugin.openCamera() + captureFrame() üzerinden Camera2 API.
 * Web:    navigator.mediaDevices.getUserMedia(); canvas frame döngüsü.
 *
 * R-7 eklemeleri:
 *   signalReverse(active) — tek giriş noktası; hem main.tsx hem de App.tsx çağırır
 *   Hysteresis (2s)       — R-N-R geçişlerinde ekran titremesi engeli
 *   Priority frame rate   — reverse=true → 50ms (20 FPS), normal → 100ms (10 FPS)
 *   onReverseSignal()     — ReversePriorityOverlay için Zustand-siz subscription
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';

/* ── Types ───────────────────────────────────────────────── */

export type CameraStatus = 'idle' | 'opening' | 'active' | 'error';

export interface CameraState {
  status:       CameraStatus;
  currentFrame: string | null; // base64 data URI (JPEG) ya da ObjectURL
  cameraId:     string | null;
  error:        string | null;
  facingMode:   'back' | 'front';
}

/* ── Constants ───────────────────────────────────────────── */

const FRAME_INTERVAL_PRIORITY = 50;    // 20 FPS — geri vites aktif
const FRAME_INTERVAL_NORMAL   = 100;   // 10 FPS — standart
const HYSTERESIS_MS           = 2_000; // R-N-R geçişi stabilite süresi

/* ── Module state ────────────────────────────────────────── */

const INITIAL: CameraState = {
  status:       'idle',
  currentFrame: null,
  cameraId:     null,
  error:        null,
  facingMode:   'back',
};

let _state: CameraState = { ...INITIAL };
const _stateListeners   = new Set<(s: CameraState) => void>();
const _reverseListeners = new Set<(active: boolean) => void>();

let _frameTimer:      ReturnType<typeof setInterval> | null = null;
let _frameInterval:   number = FRAME_INTERVAL_NORMAL;
let _hysteresisTimer: ReturnType<typeof setTimeout>  | null = null;
let _reverseActive  = false;

let _webStream:  MediaStream       | null = null;
let _webVideo:   HTMLVideoElement  | null = null;
let _webCanvas:  HTMLCanvasElement | null = null;

function _push(partial: Partial<CameraState>): void {
  _state = { ..._state, ...partial };
  _stateListeners.forEach((fn) => fn(_state));
}

/* ── Frame loop (platform-aware, interval-switchable) ────── */

function _startFrameLoop(): void {
  if (_frameTimer) { clearInterval(_frameTimer); _frameTimer = null; }

  if (isNative) {
    _frameTimer = setInterval(async () => {
      try {
        const frame = await CarLauncher.captureFrame();
        _push({ currentFrame: `data:image/jpeg;base64,${frame.imageData}` });
      } catch { /* frame henüz hazır değil — bir sonraki tick'te dene */ }
    }, _frameInterval);
  } else {
    _frameTimer = setInterval(() => {
      if (!_webVideo || !_webCanvas) return;
      const ctx = _webCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(_webVideo, 0, 0, _webCanvas.width, _webCanvas.height);
      _push({ currentFrame: _webCanvas.toDataURL('image/jpeg', 0.75) });
    }, _frameInterval);
  }
}

/** Kamera açıkken frame hızını değiştir. Kapalıysa no-op. */
function _applyFrameInterval(ms: number): void {
  if (_frameInterval === ms) return;
  _frameInterval = ms;
  if (_frameTimer) _startFrameLoop(); // mevcut timer iptal + yeni aralıkta yeniden başlat
}

/* ── Native camera ───────────────────────────────────────── */

async function _startNativeCamera(facing: 'back' | 'front'): Promise<void> {
  try {
    const result = await CarLauncher.openCamera({ facing });
    _push({ status: 'active', cameraId: result.cameraId, error: null });
    _frameInterval = _reverseActive ? FRAME_INTERVAL_PRIORITY : FRAME_INTERVAL_NORMAL;
    _startFrameLoop();
  } catch (e) {
    _push({
      status: 'error',
      error:  e instanceof Error ? e.message : 'Kamera açılamadı',
    });
  }
}

async function _stopNativeCamera(): Promise<void> {
  if (_frameTimer) { clearInterval(_frameTimer); _frameTimer = null; }
  try { await CarLauncher.closeCamera(); } catch { /* zaten kapalı */ }
}

/* ── Web camera ──────────────────────────────────────────── */

async function _startWebCamera(facing: 'back' | 'front'): Promise<void> {
  try {
    _webStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing === 'back' ? 'environment' : 'user' },
      audio: false,
    });

    _webVideo             = document.createElement('video');
    _webVideo.srcObject   = _webStream;
    _webVideo.playsInline = true;
    _webVideo.muted       = true;
    await _webVideo.play();

    _webCanvas        = document.createElement('canvas');
    _webCanvas.width  = 640;
    _webCanvas.height = 480;

    _push({ status: 'active', error: null });
    _frameInterval = _reverseActive ? FRAME_INTERVAL_PRIORITY : FRAME_INTERVAL_NORMAL;
    _startFrameLoop();
  } catch (e) {
    _push({
      status: 'error',
      error:  e instanceof Error ? e.message : 'Kamera erişim hatası',
    });
  }
}

async function _stopWebCamera(): Promise<void> {
  if (_frameTimer) { clearInterval(_frameTimer); _frameTimer = null; }
  _webStream?.getTracks().forEach((t) => t.stop());
  _webStream = null;
  _webVideo  = null;
  _webCanvas = null;
}

/* ── Public camera API ───────────────────────────────────── */

export async function openRearCamera(): Promise<void> {
  if (_state.status === 'active' || _state.status === 'opening') return;
  _push({ status: 'opening', facingMode: 'back', error: null, currentFrame: null });

  if (isNative) {
    await _startNativeCamera('back');
  } else {
    await _startWebCamera('back');
  }
}

export async function closeRearCamera(): Promise<void> {
  if (isNative) {
    await _stopNativeCamera();
  } else {
    await _stopWebCamera();
  }
  _push({ status: 'idle', currentFrame: null, cameraId: null });
}

export function getCameraState(): CameraState { return _state; }

/* ── Reverse signal API (R-7 boot-split merkezi) ─────────── */

/**
 * Geri vites sinyali — hysteresis ve priority frame rate yönetimi buradan geçer.
 * main.tsx (React öncesi) ve App.tsx (store değişimi) tarafından çağrılır.
 *
 * active=true:
 *   - Hysteresis timer'ını iptal et (R-N-R hızlı geçiş koruması)
 *   - Kamerayı aç (idle/error'daysa), frame rate'i 20 FPS'e çıkar
 *   - Tüm reverse listener'ları bildir
 *
 * active=false:
 *   - HYSTERESIS_MS (2s) bekle, sonra kapat ve listener'ları bildir
 *   - Frame rate'i hemen 10 FPS'e düşür (bant genişliği tasarrufu)
 */
export function signalReverse(active: boolean): void {
  if (active) {
    if (_hysteresisTimer) { clearTimeout(_hysteresisTimer); _hysteresisTimer = null; }
    _reverseActive = true;
    _reverseListeners.forEach((fn) => fn(true));

    if (_state.status === 'idle' || _state.status === 'error') {
      void openRearCamera(); // fire-and-forget; status → 'opening' → 'active'
    } else if (_state.status === 'active') {
      _applyFrameInterval(FRAME_INTERVAL_PRIORITY); // zaten açık, sadece hızlandır
    }
  } else {
    // Frame rate'i hemen düşür
    _applyFrameInterval(FRAME_INTERVAL_NORMAL);

    if (_hysteresisTimer) clearTimeout(_hysteresisTimer);
    _hysteresisTimer = setTimeout(() => {
      _hysteresisTimer = null;
      _reverseActive   = false;
      _reverseListeners.forEach((fn) => fn(false));
      void closeRearCamera();
    }, HYSTERESIS_MS);
  }
}

/**
 * Geri vites sinyal değişikliklerini dinle (Zustand-siz).
 * ReversePriorityOverlay için tasarlandı.
 * @returns cleanup (useEffect cleanup'ta çağır)
 */
export function onReverseSignal(cb: (active: boolean) => void): () => void {
  _reverseListeners.add(cb);
  return () => _reverseListeners.delete(cb);
}

/** Anlık reverse aktif mi? (sync okuma — polling için) */
export function isReverseActive(): boolean { return _reverseActive; }

/* ── React hook ──────────────────────────────────────────── */

export function useCameraState(): CameraState {
  const [state, setState] = useState<CameraState>(_state);
  useEffect(() => {
    setState(_state); // mount anında son durumu al
    _stateListeners.add(setState);
    return () => { _stateListeners.delete(setState); };
  }, []);
  return state;
}
