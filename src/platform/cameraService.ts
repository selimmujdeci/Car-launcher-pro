/**
 * Camera Service — geri görüş kamerası yönetimi.
 *
 * Native: CarLauncherPlugin.openCamera() + captureFrame() üzerinden Camera2 API
 *         ile arka kamerayı açar; 100 ms'de bir JPEG frame base64 olarak çeker.
 * Web:    navigator.mediaDevices.getUserMedia({ facingMode: 'environment' }) ile
 *         tarayıcı kamerasına erişir; canvas üzerinden aynı frame döngüsünü çalıştırır.
 *
 * Kullanım:
 *   openRearCamera()   → kamera açılır, frame stream başlar
 *   closeRearCamera()  → kamera kapatılır, stream durur
 *   useCameraState()   → React hook — güncel frame + durum
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';

/* ── Types ───────────────────────────────────────────────── */

export type CameraStatus = 'idle' | 'opening' | 'active' | 'error';

export interface CameraState {
  status:       CameraStatus;
  currentFrame: string | null; // base64 data URI (JPEG) ya da ObjectURL
  cameraId:     string | null; // native camera ID
  error:        string | null;
  facingMode:   'back' | 'front';
}

/* ── Module state ────────────────────────────────────────── */

const INITIAL: CameraState = {
  status:       'idle',
  currentFrame: null,
  cameraId:     null,
  error:        null,
  facingMode:   'back',
};

let _state: CameraState = { ...INITIAL };
const _listeners = new Set<(s: CameraState) => void>();

let _frameTimer: ReturnType<typeof setInterval> | null = null;
let _webStream:  MediaStream | null = null;
let _webVideo:   HTMLVideoElement | null = null;
let _webCanvas:  HTMLCanvasElement | null = null;

function push(partial: Partial<CameraState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Native camera (Camera2 via plugin) ──────────────────── */

async function startNativeCamera(facing: 'back' | 'front'): Promise<void> {
  try {
    const result = await CarLauncher.openCamera({ facing });
    push({ status: 'active', cameraId: result.cameraId, error: null });

    // 100 ms aralıkla frame çek (≈10 FPS — geri görüş için yeterli)
    if (_frameTimer) clearInterval(_frameTimer);
    _frameTimer = setInterval(async () => {
      try {
        const frame = await CarLauncher.captureFrame();
        push({ currentFrame: `data:image/jpeg;base64,${frame.imageData}` });
      } catch {
        // Frame henüz hazır değil — bir sonraki döngüde tekrar dene
      }
    }, 100);
  } catch (e) {
    push({
      status: 'error',
      error:  e instanceof Error ? e.message : 'Kamera açılamadı',
    });
  }
}

async function stopNativeCamera(): Promise<void> {
  if (_frameTimer) { clearInterval(_frameTimer); _frameTimer = null; }
  try { await CarLauncher.closeCamera(); } catch { /* zaten kapalı */ }
}

/* ── Web camera (getUserMedia) ───────────────────────────── */

async function startWebCamera(facing: 'back' | 'front'): Promise<void> {
  try {
    _webStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing === 'back' ? 'environment' : 'user' },
      audio: false,
    });

    _webVideo            = document.createElement('video');
    _webVideo.srcObject  = _webStream;
    _webVideo.playsInline = true;
    _webVideo.muted      = true;
    await _webVideo.play();

    _webCanvas        = document.createElement('canvas');
    _webCanvas.width  = 640;
    _webCanvas.height = 480;

    push({ status: 'active', error: null });

    if (_frameTimer) clearInterval(_frameTimer);
    _frameTimer = setInterval(() => {
      if (!_webVideo || !_webCanvas) return;
      const ctx = _webCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(_webVideo, 0, 0, _webCanvas.width, _webCanvas.height);
      push({ currentFrame: _webCanvas.toDataURL('image/jpeg', 0.75) });
    }, 100);
  } catch (e) {
    push({
      status: 'error',
      error:  e instanceof Error ? e.message : 'Kamera erişim hatası',
    });
  }
}

async function stopWebCamera(): Promise<void> {
  if (_frameTimer) { clearInterval(_frameTimer); _frameTimer = null; }
  _webStream?.getTracks().forEach((t) => t.stop());
  _webStream = null;
  _webVideo  = null;
  _webCanvas = null;
}

/* ── Public API ──────────────────────────────────────────── */

export async function openRearCamera(): Promise<void> {
  if (_state.status === 'active' || _state.status === 'opening') return;
  push({ status: 'opening', facingMode: 'back', error: null, currentFrame: null });

  if (isNative) {
    await startNativeCamera('back');
  } else {
    await startWebCamera('back');
  }
}

export async function closeRearCamera(): Promise<void> {
  if (isNative) {
    await stopNativeCamera();
  } else {
    await stopWebCamera();
  }
  push({ status: 'idle', currentFrame: null, cameraId: null });
}

export function getCameraState(): CameraState { return _state; }

/* ── React hook ──────────────────────────────────────────── */

export function useCameraState(): CameraState {
  const [state, setState] = useState<CameraState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
