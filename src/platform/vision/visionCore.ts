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
import { systemBoot }     from '../system/SystemBoot';
import { useVisionStore } from '../visionStore';
import type { VisionFrame, VisionStore } from '../visionStore';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }    from '../../core/runtime/runtimeTypes';
import {
  PROC_W,
  PROC_H,
  DETECT_INTERVAL,
  computeAndPublishConfidence,
  resetConfidenceHistory,
} from './visionImageProcess';
import {
  initVisionSAB, clearVisionSAB, writeVisionSAB,
} from '../vehicleDataLayer/sabChannel';

// ── Modül state ───────────────────────────────────────────────────────────────

const STATE_SYNC_MS = 100;  // 10fps — React store yenileme hızı

let _stream:    MediaStream | null                                                  = null;
/* İşleme video'su — motorun KENDİ gizli öğesi. Eskiden AR'ın görünen video'su
   hem gösterim hem işleme içindi; ADAS (arka planda, ekran yokken) aynı
   kamerayı kullanacağı için işleme görünen öğeden AYRILDI. */
let _videoEl:   HTMLVideoElement | null                                             = null;
let _procCanvas: OffscreenCanvas | HTMLCanvasElement | null                        = null;
let _procCtx:   OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
let _rafId:     number | null = null;
let _running    = false;
let _tick       = 0;

// ── VisionCompute Worker ──────────────────────────────────────────────────────
// OffscreenCanvas.transferToImageBitmap() → postMessage([bitmap]) → worker hesaplar.
// Worker mevcut değilse (SAB yoksa veya worker crash) → no-op frame (lanes: []).

let _visionWorker: Worker | null = null;
let _workerBusy   = false; // bir frame zaten işleniyorsa yeni frame atlanır
let _vsabGen      = 0;     // Vision SAB generation sayacı

function _createVisionWorker(): Worker | null {
  try {
    // PR-RUNTIME-WORKER-1: worker DOSYASI prod'da IIFE (worker.format:'iife') ama `type`
    // constructor seçeneği Vite tarafından call-site'ta değişmez → sabit 'module' WebView<80'de
    // "Module scripts are not supported" ile throw eder. type'ı build-time seç: DEV → Vite ESM
    // servis eder ('module' şart); PROD → IIFE bundle ('classic', WebView 52+). İki ayrı
    // literal-type call-site — Vite `type`'ın literal olmasını zorunlu kılar; prod'da 'module'
    // dalı ölü-kod elenir. (§HEAD_UNIT_MATRIX)
    const w = import.meta.env.DEV
      ? new Worker(new URL('./VisionCompute.worker.ts', import.meta.url), { type: 'module', name: 'VisionCompute' })
      : new Worker(new URL('./VisionCompute.worker.ts', import.meta.url), { type: 'classic', name: 'VisionCompute' });
    w.onmessage = (e: MessageEvent) => {
      _workerBusy = false;
      const msg = e.data as { type: string; frame?: VisionFrame; message?: string };
      if (msg.type === 'RESULT' && msg.frame) {
        _lastFrame = msg.frame;
        _frameListeners.forEach(fn => fn(_lastFrame));
        _newFrameReady = true;

        // Vision SAB'a yaz (crossOriginIsolated=true ortamında sıfır kopya)
        const frame = msg.frame;
        const ll = frame.lanes.find(l => l.side === 'left');
        const rl = frame.lanes.find(l => l.side === 'right');
        const avgLaneConf = frame.lanes.length > 0
          ? frame.lanes.reduce((s, l) => s + l.confidence, 0) / frame.lanes.length
          : 0;
        const sign = frame.signs[0];
        writeVisionSAB(
          frame.lateralOffsetM, avgLaneConf,
          ll?.x2 ?? -1, rl?.x2 ?? -1,
          sign ? 1 : 0, sign?.speedValue ?? 0,
          _vsabGen++,
        );

        if (useVisionStore.getState().state === 'degraded') _pendingState = 'active';
      } else if (msg.type === 'ERROR') {
        logError('VisionCompute:worker', new Error(msg.message ?? 'Worker error'));
        if (useVisionStore.getState().state === 'active') _pendingState = 'degraded';
      }
    };
    w.onerror = (err) => {
      logError('VisionCompute:onerror', new Error(err.message ?? 'Worker crash'));
      runtimeManager.reportFailure('VisionCompute');
      _workerBusy   = false;
      _visionWorker = null;
      runtimeManager.registerWorker('VisionCompute', null, 'OPTIONAL'); // referansı temizle
      void systemBoot.restartService('VisionCompute').catch(() => {});
    };
    w.onmessageerror = () => {
      logError('VisionCompute:messageerror', new Error('Deserialize failed'));
      _workerBusy = false;
    };
    return w;
  } catch (e) {
    logError('VisionCompute:create', e);
    return null;
  }
}

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
      const mode     = runtimeManager.getMode();
      const isSafe   = mode === RuntimeMode.SAFE_MODE;
      const isLowPow = mode === RuntimeMode.POWER_SAVE || mode === RuntimeMode.BASIC_JS;
      const interval = isSafe ? 0 : isLowPow ? DETECT_INTERVAL * 2 : DETECT_INTERVAL;

      if (interval > 0 && _tick % interval === 0) {
        if (_visionWorker && !_workerBusy && _procCanvas instanceof OffscreenCanvas) {
          // ── Worker path: OffscreenCanvas → transferToImageBitmap → postMessage ──
          // bitmap transferable: ana thread'de kopya yok, GPU bellek transferi.
          try {
            const bitmap = _procCanvas.transferToImageBitmap();
            _workerBusy = true;
            _visionWorker.postMessage({ type: 'DETECT', bitmap }, [bitmap]);
          } catch (transferErr) {
            logError('VisionCore:transfer', transferErr);
            _workerBusy = false;
          }
        }
        // Worker yoksa (SAB eksik veya crash): frame atlanır, degraded state'e geç
        // sonraki tick'te yeniden denenebilir; servisi durdurmaz
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

/* ── Kamera kiralama (lease) ──────────────────────────────────────────────────
 * Tek kamera akışı, birden çok tüketici: harita AR katmanı ('ar') ve Sürüş
 * Asistanı ('adas'). Kamera ancak SON sahip bıraktığında kapanır — AR'ın
 * kapanması ADAS'ın kamerasını, ADAS'ın kapanması AR'ınkini kesmez.
 * Varsayılan sahip 'ar'dır: mevcut `startVision(video)` / `stopVision()`
 * çağrıları birebir aynı davranır. */
export type VisionOwner = 'ar' | 'adas';

const _owners   = new Set<VisionOwner>();
const _displays = new Map<VisionOwner, HTMLVideoElement>();
let _startPromise: Promise<void> | null = null;
/** Açık akışın istendiği kamera (`null` = otomatik/arka kamera). */
let _openDeviceId: string | null = null;

function _attachDisplay(owner: VisionOwner, el: HTMLVideoElement | null): void {
  if (!el || !_stream) return;
  _displays.set(owner, el);
  if (el === _videoEl) return;
  el.srcObject   = _stream;
  el.playsInline = true;
  el.muted       = true;
  void el.play().catch(() => { /* gösterim opsiyonel — işleme etkilenmez */ });
}

function _detachDisplay(owner: VisionOwner): void {
  const el = _displays.get(owner);
  if (el && el !== _videoEl) el.srcObject = null;
  _displays.delete(owner);
}

function _createProcessingVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.setAttribute('playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  /* DOM'da ama görünmez: bazı WebView'lar DOM dışı video karesini güncellemez. */
  Object.assign(v.style, {
    position: 'fixed', left: '-4px', top: '-4px', width: '2px', height: '2px',
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.appendChild(v);
  return v;
}

async function _openStream(deviceId: string | null): Promise<void> {
  _running = true;
  try {
    _set({ state: 'requesting' });
    _stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } }
        : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
      audio: false,
    });
    _openDeviceId = deviceId;
    _set({ state: 'initializing', permissionGranted: true });

    _videoEl = _createProcessingVideo();
    _videoEl.srcObject = _stream;
    await _videoEl.play();

    if (typeof OffscreenCanvas !== 'undefined') {
      _procCanvas = new OffscreenCanvas(PROC_W, PROC_H);
      _procCtx    = (_procCanvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
    } else {
      const c = document.createElement('canvas');
      c.width = PROC_W; c.height = PROC_H;
      _procCanvas = c;
      _procCtx    = c.getContext('2d');
    }

    /* USB kamera çekilirse ya da sistem akışı keserse: TÜM sahipler için dur,
       hatayı dürüstçe bildir (ADAS "kamera bağlantısı kesildi" der). */
    _stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      logError('VisionCore:stream', new Error('Video track ended unexpectedly'));
      _fullStop();
      _set({ state: 'error', error: 'Kamera akışı kesildi' });
    });

    // ── Vision Worker başlat ───────────────────────────────────────────────────
    _visionWorker = _createVisionWorker();
    // AdaptiveRuntimeManager'a OPTIONAL worker olarak kaydet
    runtimeManager.registerWorker('VisionCompute', _visionWorker, 'OPTIONAL');

    // ── Vision SAB başlat (crossOriginIsolated=true ortamında) ────────────────
    if (typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated) {
      initVisionSAB(new SharedArrayBuffer(128));
    }

    _set({ state: 'active', error: null });
    _tick  = 0;
    _vsabGen = 0;
    _startStateSync();
    _rafId = requestAnimationFrame(_loop);

  } catch (err) {
    _running = false;
    if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
    if (_videoEl) { _videoEl.srcObject = null; _videoEl.remove(); _videoEl = null; }
    const msg    = err instanceof Error ? err.message : String(err);
    const denied = /NotAllowed|Permission/i.test(msg);
    logError('VisionCore:start', err);
    _set({ state: denied ? 'disabled' : 'error', error: denied ? 'Kamera izni verilmedi' : msg, permissionGranted: !denied });
    throw err;
  }
}

/**
 * Kamerayı `owner` adına kiralar. Akış zaten açıksa yalnız gösterim öğesi
 * bağlanır; farklı bir kamera (`deviceId`) istenirse akış o kamerayla yeniden
 * açılır (yol kamerası tektir — AR ve ADAS aynı yolu görür).
 */
export async function startVision(
  videoEl: HTMLVideoElement | null,
  owner: VisionOwner = 'ar',
  opts?: { deviceId?: string | null },
): Promise<void> {
  const cur = useVisionStore.getState().state;
  /* 'disabled' = kamera yok ya da izin reddedildi. AR sessizce vazgeçer (eski
     davranış); ADAS kullanıcının açık isteğidir → izni YENİDEN dener. */
  if (cur === 'disabled' && owner === 'ar') return;

  _owners.add(owner);
  try {
    if (_startPromise) await _startPromise.catch(() => { /* aşağıda yeniden denenir */ });
    const wanted = opts?.deviceId !== undefined ? opts.deviceId : _openDeviceId;
    if (_stream && wanted !== _openDeviceId) {
      const displays = new Map(_displays);
      const owners = new Set(_owners);
      _fullStop();
      owners.forEach((o) => _owners.add(o));
      _startPromise = _openStream(wanted);
      await _startPromise;
      displays.forEach((el, o) => _attachDisplay(o, el));
    } else if (!_stream) {
      _startPromise = _openStream(wanted ?? null);
      await _startPromise;
    }
    _attachDisplay(owner, videoEl);
  } catch (err) {
    _owners.delete(owner);
    throw err;
  } finally {
    _startPromise = null;
  }
}

/** Tüm sahipler için kamerayı kapatır (iç kullanım). */
function _fullStop(): void {
  _running = false;
  _stopStateSync();
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
  _displays.forEach((el) => { if (el !== _videoEl) el.srcObject = null; });
  _displays.clear();
  _owners.clear();
  if (_videoEl) { _videoEl.srcObject = null; _videoEl.remove(); _videoEl = null; }
  _procCtx = null; _procCanvas = null; _tick = 0;
  _openDeviceId = null;

  // Worker'ı durdur ve kaydını sil
  if (_visionWorker) {
    runtimeManager.unregisterWorker('VisionCompute');
    _visionWorker.postMessage({ type: 'STOP' });
    _visionWorker = null;
  }
  _workerBusy = false;
  clearVisionSAB();

  resetConfidenceHistory();
  _set({ state: 'idle', frame: null, error: null, confidence: 0, confidenceLevel: 'off' });
}

/** `owner`'ın kirasını bırakır; kamera yalnız son sahip çıkınca kapanır. */
export function stopVision(owner: VisionOwner = 'ar'): void {
  _detachDisplay(owner);
  _owners.delete(owner);
  if (_owners.size > 0) return;
  _fullStop();
}

export function disableVision(): void { _fullStop(); _set({ state: 'disabled' }); }

/** Kamerayı şu an kiralayan sahipler (tanı / test). */
export function getVisionOwners(): readonly VisionOwner[] { return [..._owners]; }

/** İşleme video öğesi — dedektör kare örneklemesi için (salt okuma). */
export function getVisionVideoElement(): HTMLVideoElement | null { return _videoEl; }

/** Açık kamera akışının kimliği ve etiketi; akış yoksa `null`. */
export function getVisionTrackInfo(): { deviceId: string | null; label: string; width: number; height: number } | null {
  const track = _stream?.getVideoTracks()[0];
  if (!track) return null;
  const st = typeof track.getSettings === 'function' ? track.getSettings() : {};
  return {
    deviceId: st.deviceId ?? _openDeviceId,
    label: track.label ?? '',
    width: typeof st.width === 'number' ? st.width : (_videoEl?.videoWidth ?? 0),
    height: typeof st.height === 'number' ? st.height : (_videoEl?.videoHeight ?? 0),
  };
}

export function onVisionFrame(fn: (f: VisionFrame) => void): () => void {
  _frameListeners.add(fn);
  return () => _frameListeners.delete(fn);
}

export function getLastFrame(): VisionFrame { return _lastFrame; }

/**
 * SystemBoot.restartService('VisionCompute') tarafından çağrılır.
 * Worker crash sonrası RAF döngüsü aktifken yeni worker oluşturur.
 */
export function restartVisionWorker(): void {
  if (!_running || _visionWorker) return; // vision çalışmıyorsa veya zaten varsa no-op
  _visionWorker = _createVisionWorker();
  if (_visionWorker) {
    runtimeManager.registerWorker('VisionCompute', _visionWorker, 'OPTIONAL');
  }
}

/* ── HMR cleanup ─────────────────────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => { _stopStateSync(); _fullStop(); _frameListeners.clear(); });
}
