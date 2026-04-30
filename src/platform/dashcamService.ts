/**
 * Dashcam Service — Loop recording with G-sensor auto-lock.
 *
 * Architecture:
 *  - MediaRecorder API with circular segment buffer (last 3 × 2-min = 6 min)
 *  - DeviceMotionEvent for G-sensor impact detection (auto-locks on shake)
 *  - Manual lock + download support for locked recordings
 *  - useDashcamState() hook only subscribes; no timers inside React
 */

import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';

/* ── Types ───────────────────────────────────────────────── */

export interface DashcamState {
  active: boolean;
  locked: boolean;           // true for 3s after impact lock
  hasPermission: boolean | null;
  error: string | null;
  segments: number;          // segments in circular buffer (max 3)
  lockedCount: number;       // number of saved locked recordings
  currentDurationSec: number;
  gForce: number;            // last measured G-force (m/s²)
}

/* ── Config ──────────────────────────────────────────────── */

const SEGMENT_DURATION_MS  = 2 * 60 * 1000; // 2 minutes
const MAX_SEGMENTS         = 3;              // 6-minute rolling buffer
const SHAKE_THRESHOLD      = 15;            // m/s² — typical minor impact
const LOCK_COOLDOWN_MS     = 5_000;

// Sentry pre-buffer: 12s ring-buffer → 10s öncesi + 2s margin
const PRE_BUFFER_SEC       = 12;

/* ── Module state ────────────────────────────────────────── */

const INITIAL_STATE: DashcamState = {
  active: false,
  locked: false,
  hasPermission: null,
  error: null,
  segments: 0,
  lockedCount: 0,
  currentDurationSec: 0,
  gForce: 0,
};

let _state: DashcamState                   = { ...INITIAL_STATE };
const _listeners                           = new Set<(s: DashcamState) => void>();

let _mediaRecorder: MediaRecorder | null   = null;
let _stream: MediaStream | null            = null;
let _chunks: Blob[]                        = [];
let _segmentBuffer: Blob[][]               = [];   // circular buffer
let _lockedSegments: Blob[][]              = [];   // impact recordings

let _segmentTimer: ReturnType<typeof setInterval> | null = null;
let _durationTimer: ReturnType<typeof setInterval> | null = null;
let _lockFlashTimer: ReturnType<typeof setTimeout> | null = null;

let _lastLockTime    = 0;
let _segmentStart    = 0;

/* ── Sentry pre-buffer (dashcam'den bağımsız, park modu) ────── */

let _preBufferRecorder: MediaRecorder | null = null;
let _preBufferStream:   MediaStream | null   = null;
let _preBufferActive                         = false;
interface TimestampedChunk { blob: Blob; t: number; }
let _preBufferChunks: TimestampedChunk[]     = [];

/* ── Core helpers ────────────────────────────────────────── */

function _notify(): void {
  const snap = { ..._state };
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<DashcamState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

function _flushSegment(): void {
  if (_chunks.length === 0) return;
  const blob = new Blob(_chunks, { type: 'video/webm' });
  _chunks = [];
  _segmentBuffer.push([blob]);
  if (_segmentBuffer.length > MAX_SEGMENTS) _segmentBuffer.shift();
  _setState({ segments: _segmentBuffer.length });
}

function _lockNow(): void {
  const now = Date.now();
  if (now - _lastLockTime < LOCK_COOLDOWN_MS) return;
  _lastLockTime = now;

  // Capture last full segment + current chunks
  const parts: Blob[] = [
    ...(_segmentBuffer[_segmentBuffer.length - 1] ?? []),
    ...(_chunks.length > 0 ? [new Blob(_chunks, { type: 'video/webm' })] : []),
  ];

  if (parts.length === 0) return;

  _lockedSegments.push(parts);

  if (_lockFlashTimer) clearTimeout(_lockFlashTimer);
  _setState({ locked: true, lockedCount: _lockedSegments.length });
  _lockFlashTimer = setTimeout(() => _setState({ locked: false }), 3_000);
}

/* ── G-sensor ────────────────────────────────────────────── */

function _onMotion(event: DeviceMotionEvent): void {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;
  const total = Math.sqrt(
    (acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2,
  );
  _setState({ gForce: Math.round(total * 10) / 10 });
  if (total > SHAKE_THRESHOLD && _state.active) _lockNow();
}

/* ── Public API ──────────────────────────────────────────── */

export async function startDashcam(): Promise<void> {
  if (_state.active) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });

    _stream  = stream;
    _chunks  = [];
    _segmentBuffer = [];
    _segmentStart  = Date.now();

    // Pick best supported MIME type
    let mimeType = 'video/webm';
    for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
      if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
    }

    const mr = new MediaRecorder(stream, { mimeType });
    _mediaRecorder = mr;

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) _chunks.push(e.data);
    };

    mr.start(1_000); // collect every second

    // Rotate segments
    _segmentTimer = setInterval(() => {
      mr.requestData();
      setTimeout(_flushSegment, 150);
      _segmentStart = Date.now();
      _setState({ currentDurationSec: 0 });
    }, SEGMENT_DURATION_MS);

    // Update clock
    _durationTimer = setInterval(() => {
      _setState({ currentDurationSec: Math.floor((Date.now() - _segmentStart) / 1_000) });
    }, 1_000);

    window.addEventListener('devicemotion', _onMotion);
    _setState({ active: true, hasPermission: true, error: null, segments: 0 });

    // Foreground servis bildirimini "Kayıt aktif" olarak güncelle
    if (isNative) {
      CarLauncher.setDashcamActive({ active: true }).catch(() => undefined);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Kamera erişimi reddedildi';
    _setState({ hasPermission: false, error: msg });
  }
}

export function stopDashcam(): void {
  if (!_state.active) return;

  window.removeEventListener('devicemotion', _onMotion);

  if (_segmentTimer)  { clearInterval(_segmentTimer);  _segmentTimer  = null; }
  if (_durationTimer) { clearInterval(_durationTimer); _durationTimer = null; }

  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
    _mediaRecorder = null;
  }

  _stream?.getTracks().forEach((t) => t.stop());
  _stream = null;

  _flushSegment();
  _setState({ active: false, currentDurationSec: 0, gForce: 0 });

  // Foreground servis bildirimini sıfırla
  if (isNative) {
    CarLauncher.setDashcamActive({ active: false }).catch(() => undefined);
  }
}

export function lockCurrentRecording(): void {
  _lockNow();
}

export function downloadLockedRecording(index: number): void {
  const segs = _lockedSegments[index];
  if (!segs) return;
  _triggerDownload(new Blob(segs, { type: 'video/webm' }), `dashcam-kilitli-${index + 1}.webm`);
}

export function downloadCurrentBuffer(): void {
  const all = _segmentBuffer.flat();
  if (all.length === 0) return;
  _triggerDownload(new Blob(all, { type: 'video/webm' }), `dashcam-${Date.now()}.webm`);
}

function _triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export function getVideoStream(): MediaStream | null {
  return _stream;
}

export function onDashcamState(fn: (s: DashcamState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state });
  return () => { _listeners.delete(fn); };
}

export function useDashcamState(): DashcamState {
  const [s, setS] = useState<DashcamState>({ ..._state });
  useEffect(() => onDashcamState(setS), []);
  return s;
}

/* ── Sentry Pre-Buffer API ───────────────────────────────────── */

/**
 * Arka planda sessiz bir pre-buffer kaydı başlatır (UI state güncellenmez).
 * Kamera izni yoksa veya cihaz desteklemiyorsa false döner (G-Sensor only moda geçilir).
 */
export async function startSentryPreBuffer(): Promise<boolean> {
  if (_preBufferActive) return true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });

    _preBufferStream = stream;
    _preBufferChunks = [];

    let mimeType = 'video/webm';
    for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
    }

    const mr = new MediaRecorder(stream, { mimeType });
    _preBufferRecorder = mr;

    mr.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const now = Date.now();
      _preBufferChunks.push({ blob: e.data, t: now });
      // (PRE_BUFFER_SEC + 2)s üzeri chunk'ları at
      const cutoff = now - (PRE_BUFFER_SEC + 2) * 1_000;
      while (_preBufferChunks.length > 0 && _preBufferChunks[0].t < cutoff) {
        _preBufferChunks.shift();
      }
    };

    mr.start(500); // 500 ms dilimler → ince taneli ring buffer
    _preBufferActive = true;
    return true;
  } catch {
    return false; // İzin yok veya kamera meşgul
  }
}

/** Pre-buffer'ı durdurur ve belleği temizler. */
export function stopSentryPreBuffer(): void {
  if (!_preBufferActive) return;
  _preBufferActive = false;

  if (_preBufferRecorder && _preBufferRecorder.state !== 'inactive') {
    _preBufferRecorder.ondataavailable = null; // son flush'u yok say
    _preBufferRecorder.stop();
    _preBufferRecorder = null;
  }

  _preBufferStream?.getTracks().forEach((t) => t.stop());
  _preBufferStream = null;
  _preBufferChunks = [];
}

/**
 * Darbe anında çağrılır.
 * Ring buffer'daki son PRE_BUFFER_SEC saniyelik chunk'ları alır,
 * postDurationSec saniye daha kaydeder ve Blob döner.
 *
 * Not: Bu çağrı sonrası startSentryPreBuffer() ile buffer'ı yeniden başlat.
 */
export function captureEmergencyClip(postDurationSec = 20): Promise<Blob> {
  return new Promise((resolve) => {
    const preBlobs = _preBufferChunks.map((c) => c.blob);
    const mimeType = _preBufferRecorder?.mimeType ?? 'video/webm';

    // Pre-buffer kaydediciyi kapat (son chunk'ı yoksay, postRecorder devralır)
    if (_preBufferRecorder && _preBufferRecorder.state !== 'inactive') {
      _preBufferRecorder.ondataavailable = null;
      _preBufferRecorder.stop();
      _preBufferRecorder = null;
    }
    _preBufferActive = false;

    if (!_preBufferStream) {
      resolve(new Blob(preBlobs, { type: 'video/webm' }));
      return;
    }

    const postChunks: Blob[] = [];
    const postRecorder = new MediaRecorder(_preBufferStream, { mimeType });

    postRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) postChunks.push(e.data);
    };

    postRecorder.onstop = () => {
      resolve(new Blob([...preBlobs, ...postChunks], { type: mimeType }));
    };

    postRecorder.start(500);
    setTimeout(() => {
      if (postRecorder.state !== 'inactive') postRecorder.stop();
    }, postDurationSec * 1_000);
  });
}
