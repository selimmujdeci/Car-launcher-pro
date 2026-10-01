/**
 * visionCore.ts — Kamera akışı ve RAF döngüsü.
 *
 * Tek sorumluluk: kamera başlatma/durdurma + frame yakalama + CV tetikleme.
 *
 * AdaptiveRuntime throttle (Mali-400 optimizasyonu):
 *   SAFE_MODE              → tespit tamamen durdurulur (0 CPU)
 *   POWER_SAVE / BASIC_JS  → her 12. frame'de bir (~5fps)
 *   BALANCED / PERFORMANCE → her 6. frame'de bir (~10fps)
 *
 * KAMERA KİRALAMA (lease) — AR ve ADAS AYNI yol kamerasını paylaşır:
 *   · `startVision(el, { owner })` sahibin kirasını ekler; akış yoksa açar.
 *   · `stopVision(owner)` yalnız O sahibin kirasını bırakır. Donanım ancak SON kira
 *     bırakılınca kapanır. Varsayılan sahip `'ar'` → mevcut çağrılar (VisionOverlay)
 *     birebir aynı davranır: AR görünmezken kirasını bırakır (bkz. realDriveFindings K).
 *   · ADAS görünür bir `<video>` sahibi değildir; işleme için motorun KENDİ gizli
 *     video öğesi kullanılır → AR ekranı kapalıyken de algılama sürer.
 *   · Kamera tercihi (`setVisionCameraPreference`) değişirse akış, kiralar korunarak
 *     yeniden açılır. Seçili kamera yoksa SESSİZCE başka kameraya DÜŞÜLMEZ: kalibrasyon
 *     kameraya özgüdür; yanlış kamerayla metrik uyarı üretmek yanlış alarmdır.
 *
 * EPOCH: her akış oturumu yeni epoch açar; kapanmış oturumun geç gelen worker sonucu
 * yok sayılır (CLAUDE.md §8).
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
import type { VehicleDetectorConfig } from '../adas/adasVehicleDetector';

// ── Modül state ───────────────────────────────────────────────────────────────

const STATE_SYNC_MS = 100;  // 10fps — React store yenileme hızı

export type VisionLeaseOwner = 'ar' | 'adas';

export interface StartVisionOptions {
  /** Kirayı alan tüketici. Varsayılan `'ar'` (geriye uyum). */
  owner?: VisionLeaseOwner;
}

let _stream:    MediaStream | null                                                  = null;
/** AR'ın GÖRÜNÜR video öğesi (yalnız gösterim). */
let _displayVideo: HTMLVideoElement | null                                          = null;
/** Motorun gizli işleme öğesi — ADAS kirası varken vardır. */
let _procVideo: HTMLVideoElement | null                                             = null;
let _procCanvas: OffscreenCanvas | HTMLCanvasElement | null                        = null;
let _procCtx:   OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
let _rafId:     number | null = null;
let _running    = false;
let _tick       = 0;

const _leases = new Set<VisionLeaseOwner>();
let _openPromise: Promise<void> | null = null;
let _openToken   = 0;
let _epoch       = 0;
let _preferredDeviceId: string | null = null;
let _activeDeviceId:    string | null = null;
let _activeLabel:       string | null = null;
let _detectorCfg: VehicleDetectorConfig | null = null;
let _inflightCaptureMono = 0;

// ── VisionCompute Worker ──────────────────────────────────────────────────────
// OffscreenCanvas.transferToImageBitmap() → postMessage([bitmap]) → worker hesaplar.
// Worker mevcut değilse (SAB yoksa veya worker crash) → no-op frame (lanes: []).

let _visionWorker: Worker | null = null;
let _workerBusy   = false; // bir frame zaten işleniyorsa yeni frame atlanır
let _vsabGen      = 0;     // Vision SAB generation sayacı

function _createVisionWorker(): Worker | null {
  const epoch = _epoch;
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
      // Kapanmış oturumun geç gelen sonucu yeni oturumu etkileyemez.
      if (epoch !== _epoch || !_running) return;
      const msg = e.data as { type: string; frame?: VisionFrame; message?: string };
      if (msg.type === 'RESULT' && msg.frame) {
        _lastFrame = { ...msg.frame, captureMonoMs: _inflightCaptureMono };
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
    w.postMessage({ type: 'CONFIG', adas: _detectorCfg });
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

// ── Video öğeleri ─────────────────────────────────────────────────────────────

/** İşleme kaynağı: gizli öğe varsa o (ADAS), yoksa AR'ın görünür öğesi. */
function _sourceVideo(): HTMLVideoElement | null {
  return _procVideo ?? _displayVideo;
}

function _bindVideo(el: HTMLVideoElement): void {
  if (!_stream) return;
  if (el.srcObject !== _stream) el.srcObject = _stream;
  el.playsInline = true;
  el.muted       = true;
  // Eski WebView'larda (Chrome < 50) play() promise DÖNDÜRMEZ.
  const r = el.play() as Promise<void> | undefined;
  if (r && typeof r.catch === 'function') r.catch(() => { /* otomatik oynatma — bir sonraki karede tekrar */ });
}

/**
 * Gizli işleme öğesi. `display:none` DEĞİL: bazı WebView'lar görünmeyen öğenin
 * karelerini çözmez. 2×2 px, saydam, görünüm alanı içinde, etkileşimsiz.
 */
function _ensureProcVideo(): void {
  if (_procVideo || typeof document === 'undefined') return;
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  v.setAttribute('data-vision-proc', '');
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;';
  document.body.appendChild(v);
  _procVideo = v;
  _bindVideo(v);
}

function _removeProcVideo(): void {
  if (!_procVideo) return;
  _procVideo.srcObject = null;
  _procVideo.remove();
  _procVideo = null;
}

function _attachDisplay(el: HTMLVideoElement): void {
  if (_displayVideo && _displayVideo !== el) _displayVideo.srcObject = null;
  _displayVideo = el;
  _bindVideo(el);
}

function _detachDisplay(): void {
  if (_displayVideo) { _displayVideo.srcObject = null; _displayVideo = null; }
}

// ── RAF döngüsü ───────────────────────────────────────────────────────────────

function _loop(): void {
  if (!_running) return;

  try {
    const src = _sourceVideo();
    if (src && _procCtx && src.readyState >= 2) {
      _procCtx.drawImage(src, 0, 0, PROC_W, PROC_H);
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
            _inflightCaptureMono = performance.now();
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

// ── Akış aç / kapat ──────────────────────────────────────────────────────────

/**
 * Yakalama profili — ISI BÜTÇESİ: işleme zaten 320×180'de yapılır. Yalnız ADAS
 * kiralamışken (sürüşte en sık durum) 720p@30 yakalamak boşa ISP/ısı demektir;
 * görünür AR varsa sürücü görüntüyü GÖRÜR → 720p@30.
 */
function _captureProfile(): { width: { ideal: number }; height: { ideal: number }; frameRate: { ideal: number; max: number } } {
  return _leases.has('ar')
    ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } }
    : { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 30 } };
}

function _videoConstraints(): MediaTrackConstraints {
  const base = _captureProfile();
  return _preferredDeviceId
    ? { ...base, deviceId: { exact: _preferredDeviceId } }
    : { ...base, facingMode: 'environment' };
}

/** Kira kümesi değişince profili akışı KAPATMADAN uygula (destek yoksa sessizce atla). */
function _applyCaptureProfile(): void {
  const track = _stream?.getVideoTracks()[0];
  if (!track || typeof track.applyConstraints !== 'function') return;
  const r = track.applyConstraints(_captureProfile()) as Promise<void> | undefined;
  if (r && typeof r.catch === 'function') r.catch(() => { /* cihaz desteklemiyor — mevcut profil kalır */ });
}

async function _openStream(): Promise<void> {
  const token = ++_openToken;
  _running = true;

  try {
    _set({ state: 'requesting' });
    const stream = await navigator.mediaDevices.getUserMedia({ video: _videoConstraints(), audio: false });

    // Beklerken tüm kiralar bırakıldıysa / yeni açılış başladıysa bu akış artık sahipsiz.
    if (token !== _openToken || !_running || _leases.size === 0) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    _stream = stream;
    _epoch += 1;
    const track = stream.getVideoTracks()[0];
    const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
    _activeDeviceId = settings.deviceId ?? _preferredDeviceId;
    _activeLabel    = track?.label || null;
    _set({ state: 'initializing', permissionGranted: true });

    /* Görünür öğenin oynatma hatası (AbortError vb.) PAYLAŞILAN akışı öldürmez:
       ADAS aynı akışı kullanıyor olabilir. Döngü `readyState` bekler. */
    if (_displayVideo) _bindVideo(_displayVideo);
    if (_leases.has('adas')) _ensureProcVideo();

    if (typeof OffscreenCanvas !== 'undefined') {
      _procCanvas = new OffscreenCanvas(PROC_W, PROC_H);
      _procCtx    = (_procCanvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
    } else {
      const c = document.createElement('canvas');
      c.width = PROC_W; c.height = PROC_H;
      _procCanvas = c;
      _procCtx    = c.getContext('2d');
    }

    track?.addEventListener('ended', () => {
      if (_stream !== stream) return; // eski akışın gecikmeli olayı
      logError('VisionCore:stream', new Error('Video track ended unexpectedly'));
      // USB kamera çekildi / sistem kamerayı geri aldı → TÜM kiralar geçersiz.
      _leases.clear();
      _teardown();
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
    if (token !== _openToken) return; // yerini yeni bir açılış aldı
    _running = false;
    _leases.clear();
    _teardown();
    const name   = err instanceof Error ? err.name : '';
    const msg    = err instanceof Error ? err.message : String(err);
    const denied = /NotAllowed|Permission/i.test(`${name} ${msg}`);
    const missing = !denied && _preferredDeviceId !== null && /NotFound|Overconstrained/i.test(`${name} ${msg}`);
    logError('VisionCore:start', err);
    _set({
      state: denied ? 'disabled' : 'error',
      error: denied ? 'Kamera izni verilmedi' : missing ? 'Seçili kamera bulunamadı' : msg,
      permissionGranted: !denied,
    });
    throw err;
  }
}

/** Donanımı ve döngüyü kapatır; kiralara ve görünür öğe referansına DOKUNMAZ. */
function _teardown(): void {
  _running = false;
  _openToken += 1; // bekleyen açılış varsa sahipsiz kalsın
  _stopStateSync();
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
  if (_displayVideo) _displayVideo.srcObject = null;
  _removeProcVideo();
  _procCtx = null; _procCanvas = null; _tick = 0;
  _activeDeviceId = null;
  _activeLabel = null;

  // Worker'ı durdur ve kaydını sil
  if (_visionWorker) {
    runtimeManager.unregisterWorker('VisionCompute');
    _visionWorker.postMessage({ type: 'STOP' });
    _visionWorker = null;
  }
  _workerBusy = false;
  clearVisionSAB();

  resetConfidenceHistory();
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function checkVisionCapabilities(): Promise<boolean> {
  // Akış zaten açıksa (ör. ADAS kiralamış) kamera VARDIR; durumu 'idle'a çekme.
  if (_running) return true;
  try {
    _set({ state: 'checking' });
    if (!navigator.mediaDevices?.enumerateDevices) { _set({ state: 'disabled', hasCamera: false }); return false; }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const has = devices.some((d) => d.kind === 'videoinput');
    if (_running) return true; // numaralandırma sürerken başka sahip akışı açtı
    _set({ hasCamera: has, state: has ? 'idle' : 'disabled' });
    return has;
  } catch {
    if (_running) return true;
    _set({ state: 'disabled', hasCamera: false });
    return false;
  }
}

/** Tek uçuşta açılış: aynı anda gelen sahipler AYNI promise'i bekler. */
function _beginOpen(): Promise<void> {
  if (_openPromise) return _openPromise;
  const p = _openStream();
  _openPromise = p;
  const clear = (): void => { if (_openPromise === p) _openPromise = null; };
  p.then(clear, clear);
  return p;
}

export async function startVision(videoEl: HTMLVideoElement | null, opts: StartVisionOptions = {}): Promise<void> {
  const owner: VisionLeaseOwner = opts.owner ?? 'ar';
  if (useVisionStore.getState().state === 'disabled') return;

  const joined = !_leases.has(owner);
  _leases.add(owner);
  if (owner === 'ar' && videoEl) _attachDisplay(videoEl);
  if (owner === 'adas' && _stream) _ensureProcVideo();
  if (joined && _stream) _applyCaptureProfile();

  /* Beklenen açılış iptal edilmiş olabilir (önceki son sahip bıraktı → teardown).
     Kira hâlâ bizdeyse ve akış yoksa yeniden açılır; sınırlı deneme. */
  for (let attempt = 0; attempt < 3; attempt++) {
    if (_stream) return;
    await _beginOpen();
    if (!_leases.has(owner)) return;
  }
}

/**
 * Sahibin kirasını bırakır. Başka sahip hâlâ kullanıyorsa donanım AÇIK kalır;
 * son kira bırakılınca kamera, worker ve döngü tamamen kapanır.
 */
export function stopVision(owner: VisionLeaseOwner = 'ar'): void {
  const left = _leases.delete(owner);
  if (owner === 'ar') _detachDisplay();
  if (owner === 'adas' && _displayVideo) _removeProcVideo(); // AR işlemeye devam eder
  if (_leases.size > 0) {
    if (left && _stream) _applyCaptureProfile();
    return;
  }

  _teardown();
  _detachDisplay();
  _set({ state: 'idle', frame: null, error: null, confidence: 0, confidenceLevel: 'off' });
}

/** Tüm kiraları düşürür ve görüyü devre dışı bırakır (izin/donanım yok). */
export function disableVision(): void {
  _leases.clear();
  _teardown();
  _detachDisplay();
  _set({ state: 'disabled', frame: null, confidence: 0, confidenceLevel: 'off' });
}

/**
 * Yol kamerası tercihi (null = otomatik `environment`). Akış açıksa ve farklı bir
 * kameradaysa kiralar KORUNARAK yeniden açılır.
 */
export async function setVisionCameraPreference(deviceId: string | null): Promise<void> {
  if (_preferredDeviceId === deviceId) return;
  _preferredDeviceId = deviceId;
  if (!_running || _leases.size === 0) return;
  if (deviceId !== null && deviceId === _activeDeviceId) return;
  _teardown();
  await _beginOpen();
}

/** ADAS dedektör yapılandırması; null → worker ADAS algılaması yapmaz (AR-yalnız maliyet yok). */
export function setVisionDetectorConfig(cfg: VehicleDetectorConfig | null): void {
  _detectorCfg = cfg;
  _visionWorker?.postMessage({ type: 'CONFIG', adas: cfg });
}

export function getVisionLeaseOwners(): VisionLeaseOwner[] {
  return [..._leases];
}

export function getActiveVisionCamera(): { deviceId: string | null; label: string | null } {
  return { deviceId: _activeDeviceId, label: _activeLabel };
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
  import.meta.hot.dispose(() => { _stopStateSync(); _leases.clear(); stopVision(); _frameListeners.clear(); });
}
