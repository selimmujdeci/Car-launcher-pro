/**
 * perfHarness.ts — P1: performans test ölçüm primitifleri (TEST-ONLY).
 *
 * Amaç: araçsız/donanımsız performans testleri (PERF_AUDIT §3, testler A–H) için
 * deterministik ölçüm araçları:
 *   - Fake RAF köprüsü (T4 soakHarness fake timer'ı `requestAnimationFrame`'i de
 *     fakeler) üstünde RAF scheduling/firing/active sayacı.
 *   - Sanal "frame" ilerletici → RAF döngüleri deterministik tiklenir.
 *   - rateProbe → bir callback'in sanal süre boyunca efektif Hz'ini ölçer (throttle
 *     cap doğrulaması için).
 *   - subscribeProbe (T3 leakHarness) re-export → Zustand notify disiplini (render
 *     storm proxy'si; jsdom'da tam render testi kırılgan — T7 dersi).
 *
 * Tasarım kuralları (CLAUDE.md + T1/T3/T4/T7):
 *   - Yalnız src/__tests__ altında → production bundle'a GİRMEZ.
 *   - Production/native hot-path DEĞİŞMEZ. Ölçüm pasiftir.
 *   - Gerçek `requestAnimationFrame`'i değiştirmez; yalnız fake (sinon) RAF'ı sarmalar.
 *
 * Kullanım sırası: startVirtualClock() ÖNCE (fake RAF kurulur) → installRafSpy()
 * SONRA (fake RAF'ı sarmalar). Teardown'da spy.restore() → clock.restore().
 */
import {
  startVirtualClock, installSoakProbes, runSoak,
  seriesOf, growth, peak, isBounded,
  forceMode, makeMockWorker, captureRuntimeChecklist,
  SECONDS, MINUTES, HOURS,
  type VirtualClock,
} from './soakHarness';
import { subscribeProbe, type SubscribeProbe } from './leakHarness';
import { RUNTIME_CHECKLIST, computeMediaBlurOff } from './runtimeSimulator';

// Tek import yüzeyi: perf testleri çoğu primitifi buradan alabilir.
export {
  startVirtualClock, installSoakProbes, runSoak,
  seriesOf, growth, peak, isBounded,
  forceMode, makeMockWorker, captureRuntimeChecklist,
  RUNTIME_CHECKLIST, computeMediaBlurOff,
  subscribeProbe,
  SECONDS, MINUTES, HOURS,
};
export type { VirtualClock, SubscribeProbe };

/**
 * Sinon fake-timers `requestAnimationFrame`'i ~16ms (60fps) frame sınırlarında
 * tetikler. advanceFrames bu birim üstünden ilerler.
 */
export const FRAME_MS = 16;

/** N frame'lik sanal süre (ms). */
export function framesMs(frames: number): number {
  return frames * FRAME_MS;
}

// ── RAF denge spy'ı (T3 installTimerSpy mantığının RAF karşılığı) ─────────────────

export interface RafSpy {
  /** Toplam requestAnimationFrame çağrısı. */
  scheduled: () => number;
  /** Fire olmuş (çalışmış) RAF callback sayısı. */
  fired:     () => number;
  /** Bekleyen (fire olmamış + cancel edilmemiş) RAF sayısı. */
  active:    () => number;
  restore:   () => void;
}

type RafHandle = ReturnType<typeof requestAnimationFrame>;

/**
 * globalThis.requestAnimationFrame/cancelAnimationFrame'i denge sayan stub'la
 * sarmalar. startVirtualClock'tan SONRA çağrılmalı (fake RAF'ı sarmalar).
 * `active() === 0` → bekleyen RAF yok (gauge unmount sonrası sızıntı kontrolü).
 */
export function installRafSpy(): RafSpy {
  const origRaf    = globalThis.requestAnimationFrame;
  const origCancel = globalThis.cancelAnimationFrame;

  let scheduledN = 0;
  let firedN     = 0;
  const pending  = new Set<RafHandle>();

  globalThis.requestAnimationFrame = (function (cb: FrameRequestCallback): RafHandle {
    scheduledN++;
    const id: RafHandle = origRaf((t: number): void => {
      pending.delete(id);
      firedN++;
      cb(t);
    });
    pending.add(id);
    return id;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = (function (id: RafHandle): void {
    pending.delete(id);
    return origCancel(id);
  }) as typeof cancelAnimationFrame;

  return {
    scheduled: () => scheduledN,
    fired:     () => firedN,
    active:    () => pending.size,
    restore: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame  = origCancel;
    },
  };
}

/** Sanal zamanı `frames` animasyon frame'i kadar ilerletir (RAF döngülerini tikler). */
export async function advanceFrames(clock: VirtualClock, frames: number): Promise<void> {
  await clock.advance(framesMs(frames));
}

// ── Fire-rate (Hz) probe'u — throttle cap doğrulaması ─────────────────────────────

export interface RateProbe {
  /** Bir "iş" olayı kaydet (callback gövdesinde çağrılır). */
  hit:   () => void;
  /** Toplam hit sayısı. */
  count: () => number;
  /** Geçen sanal süreye göre efektif Hz. */
  hz:    (elapsedMs: number) => number;
  reset: () => void;
}

/**
 * Bir callback'in fire-rate'ini ölçer. Tipik: throttle'lı bir RAF döngüsünün
 * "iş yaptığı" dalında hit() çağrılır → belirli sanal süre sonra hz() ≤ cap mı?
 */
export function rateProbe(): RateProbe {
  let n = 0;
  return {
    hit:   () => { n++; },
    count: () => n,
    hz:    (elapsedMs) => (elapsedMs > 0 ? (n * 1000) / elapsedMs : 0),
    reset: () => { n = 0; },
  };
}

// ── Hafif gözlemlenebilir store (notify disiplini testleri için) ──────────────────
//
// Gerçek Zustand store'lar testte doğrudan subscribe edilir (subscribeProbe ile).
// Bu yardımcı yalnız harness self-test'i + bağımsız notify senaryoları içindir;
// production store davranışını taklit ETMEZ, sadece subscribe/notify imzasını taşır.

export interface MiniStore<T> {
  get:       () => T;
  set:       (next: T) => void;
  subscribe: (cb: () => void) => () => void;
}

/**
 * `Object.is`-eşitlik guard'lı minimal store: aynı değer set edilince notify YAYMAZ
 * (settled-frame disiplini). Zustand'ın "değişmediyse bildirme" davranışını yansıtır.
 */
export function makeMiniStore<T>(initial: T): MiniStore<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(next, value)) return; // settled → notify yok
      value = next;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}
