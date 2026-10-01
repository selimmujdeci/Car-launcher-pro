/**
 * vehicleDetector.ts — Araç dedektörü portu (ana iş parçacığı tarafı).
 *
 * Görevi yalnız taşımak: işleme video'sundan küçültülmüş kare alır, worker'a
 * verir, sonucu ve UÇTAN UCA gecikmeyi (kare yakalama → sonuç) bildirir. Karar
 * vermez — sağlık (Hz/gecikme) ve uyarı kararı `forwardCollisionModel`'dedir.
 *
 * Geri basınç: aynı anda tek kare işlenir; dedektör yavaşsa kareler atlanır,
 * kuyruk birikmez (bayat kareyle uyarı üretilmez).
 *
 * Kurulamazsa (eski WebView, model yok, WebGL/CPU hatası) durum `unavailable`
 * olur ve öyle kalır — sessizce "yol temiz" denmez.
 */
import { supportsModuleWorker } from '../deviceCapabilities';
import { logError } from '../crashLogger';
import type { VehicleDetection } from './adasTypes';

/** Dedektöre giden karenin genişliği (px) — model içte 300×300'e indirir. */
const FRAME_W = 480;
/** Model yükleme üst sınırı (ms). */
const LOAD_TIMEOUT_MS = 30_000;
/** Bir kare bu sürede dönmezse worker takılmış sayılır (ms). */
const STUCK_MS = 3_000;

/** off: çalışmıyor · loading: model yükleniyor · ready: kare işliyor · unavailable: kurulamadı. */
export type DetectorStatus = 'off' | 'loading' | 'ready' | 'unavailable';

export interface DetectionResult {
  readonly detections: readonly VehicleDetection[];
  /** Kare yakalama → sonuç (ms). */
  readonly latencyMs: number;
  /** Karenin yakalandığı an (performance.now). */
  readonly capturedAtMs: number;
  /** Kaynak en-boy oranı (genişlik/yükseklik). */
  readonly aspect: number;
}

export interface VehicleDetectorHandle {
  status(): DetectorStatus;
  backend(): string | null;
  /** Hedef örnekleme hızı (Hz) — runtime bütçesine göre. */
  setTargetHz(hz: number): void;
  stop(): void;
}

export interface VehicleDetectorOptions {
  readonly getVideo: () => HTMLVideoElement | null;
  readonly onResult: (r: DetectionResult) => void;
  readonly onStatus?: (s: DetectorStatus) => void;
  readonly targetHz?: number;
  readonly modelUrl?: string;
}

function defaultModelUrl(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
  return new URL('models/ssdlite_mobilenet_v2/model.json', base).href;
}

export function startVehicleDetector(opts: VehicleDetectorOptions): VehicleDetectorHandle {
  let status: DetectorStatus = 'loading';
  let backend: string | null = null;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalMs = 1000 / (opts.targetHz ?? 8);
  let lastSentAt = 0;
  let inFlight: { id: number; at: number; aspect: number } | null = null;
  let seq = 0;
  let stopped = false;

  const setStatus = (s: DetectorStatus): void => {
    if (status === s) return;
    status = s;
    opts.onStatus?.(s);
  };

  const teardown = (): void => {
    if (timer) { clearInterval(timer); timer = null; }
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (worker) {
      try { worker.postMessage({ type: 'STOP' }); } catch { /* zaten ölü */ }
      worker.terminate();
      worker = null;
    }
    inFlight = null;
  };

  const fail = (where: string, err: unknown): void => {
    logError(`VehicleDetect:${where}`, err instanceof Error ? err : new Error(String(err)));
    teardown();
    setStatus('unavailable');
  };

  const pump = (): void => {
    if (stopped || status !== 'ready' || !worker) return;
    const now = performance.now();
    if (inFlight) {
      if (now - inFlight.at > STUCK_MS) fail('stuck', new Error('Dedektör yanıt vermiyor'));
      return;
    }
    if (now - lastSentAt < intervalMs) return;
    const video = opts.getVideo();
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const id = ++seq;
    lastSentAt = now;
    inFlight = { id, at: now, aspect: vw / vh };
    createImageBitmap(video, {
      resizeWidth: FRAME_W, resizeHeight: Math.round((FRAME_W * vh) / vw), resizeQuality: 'low',
    }).then((bitmap) => {
      if (!worker || inFlight?.id !== id) { bitmap.close(); return; }
      worker.postMessage({ type: 'DETECT', id, bitmap }, [bitmap]);
    }).catch(() => {
      if (inFlight?.id === id) inFlight = null;   // tek kare kaçtı; bir sonrakinde yeniden
    });
  };

  const unsupported =
    !supportsModuleWorker() || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined';
  if (unsupported) {
    status = 'unavailable';
  } else {
    try {
      worker = new Worker(new URL('./VehicleDetect.worker.ts', import.meta.url), { type: 'module', name: 'VehicleDetect' });
      worker.onmessage = (e: MessageEvent): void => {
        const m = e.data as {
          type: string; backend?: string; id?: number; message?: string;
          detections?: VehicleDetection[];
        };
        if (m.type === 'READY') {
          if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
          backend = m.backend ?? null;
          setStatus('ready');
        } else if (m.type === 'RESULT' && inFlight && m.id === inFlight.id) {
          const at = inFlight.at;
          const aspect = inFlight.aspect;
          inFlight = null;
          opts.onResult({
            detections: m.detections ?? [], latencyMs: performance.now() - at, capturedAtMs: at, aspect,
          });
        } else if (m.type === 'FAIL') {
          if (m.id === undefined) fail('init', new Error(m.message ?? 'model yüklenemedi'));
          else if (inFlight?.id === m.id) inFlight = null;
        }
      };
      worker.onerror = (ev: ErrorEvent): void => fail('onerror', new Error(ev.message || 'worker hatası'));
      worker.postMessage({ type: 'INIT', modelUrl: opts.modelUrl ?? defaultModelUrl() });
      loadTimer = setTimeout(() => fail('load-timeout', new Error('Model yükleme zaman aşımı')), LOAD_TIMEOUT_MS);
      timer = setInterval(pump, 40);
    } catch (err) {
      fail('create', err);
    }
  }

  return {
    status: () => status,
    backend: () => backend,
    setTargetHz: (hz: number) => { intervalMs = 1000 / Math.max(1, hz); },
    stop: () => {
      if (stopped) return;
      stopped = true;
      teardown();
      status = 'off';
    },
  };
}
