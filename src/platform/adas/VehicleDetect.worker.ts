/// <reference lib="webworker" />
/**
 * VehicleDetect.worker — Sürüş Asistanı araç dedektörü (SSDLite MobileNetV2).
 *
 * MODÜL worker'ıdır: TF.js modern sözdizimi ve OffscreenCanvas WebGL ister →
 * `supportsModuleWorker()` (Chrome 80+) ile kapılıdır; eski WebView'da HİÇ
 * kurulmaz ve özellikler dürüstçe DETECTOR_UNAVAILABLE gösterir. Bu yüzden
 * vite `transpile-worker-to-es2015` kapsamı DIŞINDADIR (NavigationCompute gibi).
 *
 * Model APK ile gelir (public/models/ssdlite_mobilenet_v2, float16 ağırlık) —
 * ağ erişimi YOK. Arka uç: WebGL; yoksa CPU (yavaşsa sağlık kapısı yakalar).
 *
 * Protokol:
 *   → INIT {modelUrl}            ← READY {backend} | FAIL {message}
 *   → DETECT {id, bitmap}        ← RESULT {id, detections, inferMs} | FAIL
 *   → STOP
 * Koordinatlar normalize (0–1) döner; karar mantığı ana iş parçacığındadır.
 */
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import type { DetectionClass, VehicleDetection } from './adasTypes';

const CLASS_MAP: Readonly<Record<string, DetectionClass>> = {
  car: 'car', truck: 'truck', bus: 'bus', motorcycle: 'motorcycle',
};
/** Ham aday eşiği — kesin eşik (MIN_DETECTION_SCORE) karar modelindedir. */
const RAW_MIN_SCORE = 0.35;
const MAX_BOXES = 12;

let _model: cocoSsd.ObjectDetection | null = null;

const post = (m: unknown, transfer?: Transferable[]): void =>
  (self as unknown as Worker).postMessage(m, transfer ?? []);

async function init(modelUrl: string): Promise<void> {
  let backend = 'webgl';
  try {
    if (!(await tf.setBackend('webgl'))) backend = 'cpu';
  } catch {
    backend = 'cpu';
  }
  if (backend === 'cpu') await tf.setBackend('cpu');
  await tf.ready();
  _model = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl });
  post({ type: 'READY', backend: tf.getBackend() });
}

async function detect(id: number, bitmap: ImageBitmap): Promise<void> {
  const t0 = performance.now();
  const w = bitmap.width;
  const h = bitmap.height;
  let img: tf.Tensor3D | null = null;
  try {
    if (!_model) throw new Error('model yüklenmedi');
    img = tf.browser.fromPixels(bitmap);
    const raw = await _model.detect(img, MAX_BOXES, RAW_MIN_SCORE);
    const detections: VehicleDetection[] = [];
    for (const d of raw) {
      const cls = CLASS_MAP[d.class];
      if (!cls) continue;
      const [x, y, bw, bh] = d.bbox;
      detections.push({ cls, score: d.score, box: { x: x / w, y: y / h, w: bw / w, h: bh / h } });
    }
    post({ type: 'RESULT', id, detections, inferMs: performance.now() - t0 });
  } finally {
    img?.dispose();
    bitmap.close();
  }
}

self.onmessage = (e: MessageEvent): void => {
  const msg = e.data as { type: string; modelUrl?: string; id?: number; bitmap?: ImageBitmap };
  if (msg.type === 'STOP') {
    _model?.dispose();
    _model = null;
    self.close();
    return;
  }
  if (msg.type === 'INIT' && msg.modelUrl) {
    init(msg.modelUrl).catch((err: unknown) => {
      post({ type: 'FAIL', message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  if (msg.type === 'DETECT' && msg.bitmap && typeof msg.id === 'number') {
    const { id, bitmap } = msg;
    detect(id, bitmap).catch((err: unknown) => {
      post({ type: 'FAIL', id, message: err instanceof Error ? err.message : String(err) });
    });
  }
};
