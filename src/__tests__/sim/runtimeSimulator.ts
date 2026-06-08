/**
 * runtimeSimulator.ts — T7: araçsız/donanımsız low-end mod simülatörü (TEST-ONLY).
 *
 * Amaç: BASIC_JS / SAFE_MODE / POWER_SAVE modlarını gerçek donanım (Mali-400)
 * olmadan, herhangi bir makinede deterministik doğrulamak.
 *
 * Tasarım kuralları (CLAUDE.md + T1/T2 yaklaşımı):
 *   - Yalnız src/__tests__ altında → production bundle'a GİRMEZ (tree-shake).
 *   - Production / native / worker hot-path DEĞİŞMEZ.
 *   - GERÇEK runtime sistemini sürer: AdaptiveRuntimeManager + getRuntimeConfig.
 *     Hiçbir production fonksiyonu kopyalanmaz/yeniden yazılmaz.
 *   - Mod zorlama "downgrade anlık" histerezis kuralından yararlanır: BALANCED
 *     baseline'dan low modlara geçiş anlıktır (fake timer gerekmez).
 *
 * Not — mock bağımlılıkları (vi.mock) ÇAĞIRAN test dosyasında hoist edilir;
 * bu modül yalnız mantık yardımcılarıdır (paylaşılan modül grafiğinde mock'lu
 * deviceCapabilities / detectWeakGpu / headUnitCompat'i görür).
 *
 * Bilinçli olarak React/react-dom import EDİLMEZ: jsdom setup'ı navigator'ı
 * override ettiğinden react-dom/client modül yüklemede çöküyordu. Gauge
 * settled-frame doğrulaması React render yerine store dirty-guard ile yapılır
 * (Plan B) → kararlı ve render'sız.
 */
import { AdaptiveRuntimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import { getRuntimeConfig } from '../../core/runtime/runtimeConfig';
import { isLowEndDevice } from '../../platform/headUnitCompat';

// ── Low-end mod kümesi ──────────────────────────────────────────────────────────
export const LOW_END_MODES = [
  RuntimeMode.BASIC_JS,
  RuntimeMode.POWER_SAVE,
  RuntimeMode.SAFE_MODE,
] as const;

// ── Kanonik checklist (Inspector overlay ile doğrulanabilir beklenti matrisi) ────
// InspectorPanel'in gösterdiği yüzeyi yansıtır: Mode + Blur(--rt-blur) +
// enableAnimations + suspendWorkers + uiFpsTarget. Test bu matrisi GERÇEK
// runtimeConfig + uygulanan CSS değişkenleriyle karşılaştırır.
export interface RuntimeExpectation {
  enableBlur:       boolean;
  enableAnimations: boolean;
  suspendWorkers:   boolean;
  uiFpsTarget:      15 | 20 | 30 | 60;
}

export const RUNTIME_CHECKLIST: Readonly<Record<RuntimeMode, RuntimeExpectation>> = {
  [RuntimeMode.PERFORMANCE]: { enableBlur: true,  enableAnimations: true,  suspendWorkers: false, uiFpsTarget: 60 },
  [RuntimeMode.BALANCED]:    { enableBlur: true,  enableAnimations: true,  suspendWorkers: false, uiFpsTarget: 30 },
  [RuntimeMode.BASIC_JS]:    { enableBlur: false, enableAnimations: false, suspendWorkers: false, uiFpsTarget: 20 },
  [RuntimeMode.POWER_SAVE]:  { enableBlur: false, enableAnimations: false, suspendWorkers: false, uiFpsTarget: 15 },
  [RuntimeMode.SAFE_MODE]:   { enableBlur: false, enableAnimations: false, suspendWorkers: true,  uiFpsTarget: 15 },
} as const;

// ── Mod zorlama ──────────────────────────────────────────────────────────────────

/** SAB/Worker/COI global'lerini BALANCED baseline üretecek şekilde kur. */
function _installHighEndGlobals(): void {
  (globalThis as { Worker?: unknown }).Worker = class {} as unknown as typeof Worker;
  (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = class {} as unknown;
  Object.defineProperty(globalThis, 'crossOriginIsolated', { value: true, configurable: true });
}

/**
 * Runtime manager'ı sıfırlar, BALANCED baseline'da taze instance üretir ve
 * istenen moda zorlar. Low modlar baseline'dan downgrade → anlık uygulanır.
 * Mod zorlaması sonrası _applyCSS çalışmış olur (--rt-blur/--rt-anim güncel).
 *
 * @returns Aktif AdaptiveRuntimeManager instance (taze)
 */
export function forceMode(mode: RuntimeMode): AdaptiveRuntimeManager {
  _installHighEndGlobals();
  AdaptiveRuntimeManager._resetForTest();
  const m = AdaptiveRuntimeManager.getInstance(); // baseline: tier='high' mock → BALANCED
  if (m.getMode() !== mode) {
    m.setMode(mode, 'test:T7'); // BALANCED→low = downgrade = anlık
  }
  return m;
}

// ── CSS değişkeni okuma (Inspector ile aynı kaynak: :root inline style) ──────────

/** :root üzerindeki inline CSS değişkenini okur (jsdom'da güvenilir). */
export function readRtVar(name: '--rt-blur' | '--rt-anim'): string {
  if (typeof document === 'undefined') return '';
  return document.documentElement.style.getPropertyValue(name).trim();
}

// ── Inspector checklist snapshot ──────────────────────────────────────────────────

export interface RuntimeChecklistSnapshot {
  mode:             RuntimeMode;
  /** InspectorPanel mantığı: --rt-blur boş değilse onu, değilse config.enableBlur'u kullan. */
  blurOn:           boolean;
  animOn:           boolean;
  enableBlur:       boolean;
  enableAnimations: boolean;
  suspendWorkers:   boolean;
  uiFpsTarget:      number;
  workers:          ReadonlyArray<{ key: string; criticality: 'CRITICAL' | 'OPTIONAL'; alive: boolean }>;
}

/**
 * InspectorPanel'in okuduğu yüzeyi yapısal olarak yakalar.
 * Testin doğruladığı = Dev Inspector overlay'de görülen.
 */
export function captureRuntimeChecklist(m: AdaptiveRuntimeManager): RuntimeChecklistSnapshot {
  const mode   = m.getMode();
  const config = m.getConfig();
  const rtBlur = readRtVar('--rt-blur');
  const rtAnim = readRtVar('--rt-anim');
  return {
    mode,
    blurOn:           rtBlur !== '' ? rtBlur !== '0' : config.enableBlur,
    animOn:           rtAnim !== '' ? rtAnim !== '0' : config.enableAnimations,
    enableBlur:       config.enableBlur,
    enableAnimations: config.enableAnimations,
    suspendWorkers:   config.suspendWorkers,
    uiFpsTarget:      config.uiFpsTarget,
    workers: Array.from(m.getWorkers()).map(([key, e]) => ({
      key,
      criticality: e.criticality,
      alive:       e.worker != null,
    })),
  };
}

// ── Media low-end blurOff mantığı (MediaScreen.tsx:608 birebir) ───────────────────
// `blurOff = !getRuntimeConfig(mode).enableBlur || isLowEndDevice()`
// getRuntimeConfig GERÇEK; isLowEndDevice çağıran testte mock'lanır.
export function computeMediaBlurOff(mode: RuntimeMode): boolean {
  return !getRuntimeConfig(mode).enableBlur || isLowEndDevice();
}

// ── Mock Worker (memory-pressure & zombie testleri için) ──────────────────────────

export interface MockWorkerHandle {
  worker:    Worker;
  posted:    unknown[];
  terminated: () => boolean;
}

/** terminate()/postMessage()/addEventListener() izleyen minimal sahte Worker. */
export function makeMockWorker(): MockWorkerHandle {
  let _terminated = false;
  const posted: unknown[] = [];
  const worker = {
    postMessage: (msg: unknown) => { posted.push(msg); },
    terminate:   () => { _terminated = true; },
    addEventListener:    () => {},
    removeEventListener: () => {},
  } as unknown as Worker;
  return { worker, posted, terminated: () => _terminated };
}
