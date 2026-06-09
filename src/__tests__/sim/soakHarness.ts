/**
 * soakHarness.ts — T4: sanal-saat uzun-süre (soak) test motoru (TEST-ONLY).
 *
 * Amaç: CarOS Pro 8-24 saat açık kalınca timer / reconnect / telemetry /
 * safeStorage write-throttle / kuyruk / bellek-büyüme / runtime-mod davranışını
 * ARAÇ OLMADAN ve GERÇEK BEKLEME OLMADAN doğrulamak. Zaman "sanal saat" ile
 * sıkıştırılır: 8 saat → fake timer üzerinde milisaniyelerde koşar.
 *
 * Tasarım kuralları (CLAUDE.md + T1/T2/T3/T7 yaklaşımı):
 *   - Yalnız src/__tests__ altında → production bundle'a GİRMEZ (tree-shake).
 *   - Production / native / worker hot-path DEĞİŞMEZ. Hiçbir production fonksiyonu
 *     kopyalanmaz; servisler kendi public API'leri üzerinden sürülür.
 *   - T3 `leakHarness` yeniden kullanılır: timer/listener denge ölçümü.
 *   - T7 `runtimeSimulator` yeniden kullanılır: runtime soak senaryoları (Commit 4+).
 *   - GERÇEK `sleep` YOK. Tüm zaman ilerlemesi fake timer + fake Date +
 *     fake performance ile deterministiktir (flaky değil).
 *
 * Kullanım sözleşmesi (ÖNEMLİ):
 *   1. `startVirtualClock()` ÖNCE çağrılır (fake timer kurulur).
 *   2. `installSoakProbes()` SONRA çağrılır (spy'lar fake timer'ı sarmalar).
 *   `runSoak()` bu sırayı zaten doğru uygular.
 *   Teardown'da `vi.useRealTimers()` çağrılmalı (afterEach).
 */
import { vi } from 'vitest';
import {
  installTimerSpy,
  spyEventTarget,
  type TimerSpy,
  type EventTargetSpy,
} from './leakHarness';

// ── T7 yeniden kullanım: runtime soak senaryoları (Commit 4+) için yeniden ihraç ──
export { forceMode, makeMockWorker, captureRuntimeChecklist } from './runtimeSimulator';
export type { MockWorkerHandle, RuntimeChecklistSnapshot } from './runtimeSimulator';

// ── Sanal süre yardımcıları ───────────────────────────────────────────────────────
export const SECONDS = (s: number): number => s * 1_000;
export const MINUTES = (m: number): number => m * 60_000;
export const HOURS   = (h: number): number => h * 3_600_000;

/** Deterministik sabit başlangıç epoch'u — testler arası kayma olmasın. */
const DEFAULT_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

// ── Fake timer kurulumu ───────────────────────────────────────────────────────────

type UseFakeTimersOpts = NonNullable<Parameters<typeof vi.useFakeTimers>[0]>;
type FakeMethod = NonNullable<UseFakeTimersOpts['toFake']>[number];

/**
 * Faka edilecek global'leri belirler. Date + performance her zaman; geri kalanlar
 * yalnız global'de mevcutsa (jsdom'da setImmediate/requestIdleCallback olmayabilir).
 * Bu sayede sinon "olmayan metodu fakele" hatası vermez.
 */
function buildToFake(): FakeMethod[] {
  const wanted: FakeMethod[] = [
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'setImmediate', 'clearImmediate', 'Date', 'performance',
    'requestIdleCallback', 'cancelIdleCallback',
    'requestAnimationFrame', 'cancelAnimationFrame',
  ];
  const g = globalThis as unknown as Record<string, unknown>;
  return wanted.filter(
    (m) => m === 'Date' || m === 'performance' || g[m as string] !== undefined,
  );
}

export interface VirtualClock {
  /** Sanal zamanı `ms` kadar ilerletir; arada microtask/promise zinciri boşaltılır. */
  advance(ms: number): Promise<void>;
  /** Başlangıçtan beri geçen sanal ms (Date tabanlı). */
  elapsed(): number;
  /** Şu anki sanal epoch (Date.now eşdeğeri). */
  nowMs(): number;
  /** Gerçek timer'lara döner. */
  restore(): void;
}

/**
 * Fake timer + fake Date + fake performance kurar. Date.now(), performance.now()
 * ve tüm setTimeout/setInterval'lar aynı sanal saatten beslenir → telemetry'nin
 * monotonik Δ'sı (performance.now) ve safeStorage'ın Date.now eMMC sayacı birlikte
 * ilerler.
 */
export function startVirtualClock(startEpochMs: number = DEFAULT_EPOCH_MS): VirtualClock {
  const t0 = startEpochMs;
  vi.useFakeTimers({ now: startEpochMs, toFake: buildToFake() });
  return {
    advance: async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); },
    elapsed: (): number => Date.now() - t0,
    nowMs:   (): number => Date.now(),
    restore: (): void => { vi.useRealTimers(); },
  };
}

// ── Sızıntı probe'ları (T3 leakHarness yeniden kullanımı) ─────────────────────────

export interface SoakProbes {
  timers:            TimerSpy;
  windowListeners:   EventTargetSpy;
  documentListeners: EventTargetSpy;
  restore(): void;
}

/**
 * T3 timer spy + window/document listener spy'larını kurar. fake timer'dan SONRA
 * çağrılmalı → spy fake setTimeout/setInterval'ı sarmalar ve denge doğru sayılır.
 */
export function installSoakProbes(): SoakProbes {
  const g = globalThis as unknown as { window?: EventTarget; document?: EventTarget };
  const win = g.window ?? (globalThis as unknown as EventTarget);
  const doc = g.document ?? (globalThis as unknown as EventTarget);
  const timers            = installTimerSpy();
  const windowListeners   = spyEventTarget(win);
  const documentListeners = spyEventTarget(doc);
  return {
    timers,
    windowListeners,
    documentListeners,
    restore: (): void => {
      timers.restore();
      windowListeners.restore();
      documentListeners.restore();
    },
  };
}

// ── Zaman serisi örneği ───────────────────────────────────────────────────────────

export interface SoakSample {
  /** Örnek alındığı sanal ms (klok başından). */
  atMs: number;
  /** Bekleyen (fire olmamış / clear edilmemiş) setTimeout sayısı. */
  timeouts: number;
  /** Bekleyen (clear edilmemiş) setInterval sayısı. */
  intervals: number;
  /** Net aktif window listener sayısı. */
  windowListeners: number;
  /** Net aktif document listener sayısı. */
  documentListeners: number;
  /** Kullanıcı tanımlı ek metrikler (kuyruk uzunluğu, eMMC yazımı, reconnect, ...). */
  custom: Record<string, number>;
}

function takeSample(probes: SoakProbes, atMs: number, custom: Record<string, number>): SoakSample {
  return {
    atMs,
    timeouts:          probes.timers.activeTimeouts(),
    intervals:         probes.timers.activeIntervals(),
    windowListeners:   probes.windowListeners.active(),
    documentListeners: probes.documentListeners.active(),
    custom,
  };
}

// ── Orkestratör ───────────────────────────────────────────────────────────────────

export interface SoakStepCtx {
  /** Bu adımın bitiş sanal ms'i. */
  atMs:    number;
  /** 1-tabanlı adım indeksi (0 = baseline). */
  index:   number;
  /** Klok'tan okunan geçen sanal ms. */
  elapsed: number;
}

export interface SoakOptions {
  /** Toplam sanal süre (ms) — ör. HOURS(8). */
  durationMs:   number;
  /** Her adımda ilerlenen sanal ms (örnekleme çözünürlüğü). */
  stepMs:       number;
  /** Klok başlangıç epoch'u (varsayılan deterministik sabit). */
  startEpochMs?: number;
  /** Her adımda yük enjekte et (OBD besle, safeSet çağır, reconnect tetikle, ...). */
  onStep?:      (ctx: SoakStepCtx) => void | Promise<void>;
  /** Her örnekte ek metrik topla (servis iç durumu). */
  collect?:     (ctx: SoakStepCtx) => Record<string, number>;
}

export interface SoakResult {
  /** baseline (index 0) + her adım → durationMs/stepMs + 1 örnek. */
  samples:    SoakSample[];
  steps:      number;
  durationMs: number;
  first:      SoakSample;
  last:       SoakSample;
  /** Soak sonrası canlı inceleme için (ör. servisi durdur → timer 0 mı?). */
  clock:      VirtualClock;
  probes:     SoakProbes;
  /** Probe + klok'u geri yükler (afterEach yerine kullanılabilir). */
  teardown(): void;
}

/**
 * Sanal saati `stepMs` adımlarla `durationMs` kadar ilerletir; her adımda yük
 * enjekte eder (`onStep`) ve sızıntı/metrik örneği toplar. Sonuçtaki zaman
 * serisi, "8 saat sonra timer/listener/kuyruk sabit kaldı mı?" iddiasını
 * deterministik doğrulamak içindir.
 */
export async function runSoak(opts: SoakOptions): Promise<SoakResult> {
  const { durationMs, stepMs } = opts;
  if (stepMs <= 0) throw new Error('soakHarness: stepMs > 0 olmalı');
  if (durationMs < stepMs) throw new Error('soakHarness: durationMs >= stepMs olmalı');

  const clock  = startVirtualClock(opts.startEpochMs);
  const probes = installSoakProbes();
  const samples: SoakSample[] = [];
  const steps = Math.floor(durationMs / stepMs);

  // t=0 baseline (yük enjeksiyonundan önce) — büyüme bu noktaya göre ölçülür.
  const baseCtx: SoakStepCtx = { atMs: 0, index: 0, elapsed: 0 };
  samples.push(takeSample(probes, 0, opts.collect?.(baseCtx) ?? {}));

  for (let i = 1; i <= steps; i++) {
    const atMs = i * stepMs;
    if (opts.onStep) await opts.onStep({ atMs, index: i, elapsed: clock.elapsed() });
    await clock.advance(stepMs);
    const custom = opts.collect?.({ atMs, index: i, elapsed: clock.elapsed() }) ?? {};
    samples.push(takeSample(probes, atMs, custom));
  }

  return {
    samples,
    steps,
    durationMs,
    first: samples[0],
    last:  samples[samples.length - 1],
    clock,
    probes,
    teardown: (): void => { probes.restore(); clock.restore(); },
  };
}

// ── Analiz yardımcıları ───────────────────────────────────────────────────────────

const BUILTIN_KEYS = new Set([
  'atMs', 'timeouts', 'intervals', 'windowListeners', 'documentListeners',
]);

/** Bir metriğin zaman serisini çıkarır (built-in alan veya custom anahtar). */
export function seriesOf(result: SoakResult, key: string): number[] {
  return result.samples.map((s) => {
    if (BUILTIN_KEYS.has(key)) return (s as unknown as Record<string, number>)[key];
    return s.custom[key] ?? 0;
  });
}

/** Seri sonu - seri başı (net büyüme; >0 = sızıntı şüphesi). */
export function growth(series: number[]): number {
  if (series.length === 0) return 0;
  return series[series.length - 1] - series[0];
}

/** Serideki tepe değer. */
export function peak(series: number[]): number {
  return series.reduce((m, v) => (v > m ? v : m), Number.NEGATIVE_INFINITY);
}

/** Tüm değerler baseline'dan ±maxDelta içinde mi (sınırlı/leak-free). */
export function isBounded(series: number[], maxDelta: number): boolean {
  if (series.length === 0) return true;
  const base = series[0];
  return series.every((v) => Math.abs(v - base) <= maxDelta);
}
