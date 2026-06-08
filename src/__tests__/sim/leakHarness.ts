/**
 * leakHarness.ts — T3: kaynak sızıntısı / cleanup doğrulama araçları (TEST-ONLY).
 *
 * Amaç: araç olmadan listener / timer / native-handle / store-subscription /
 * AudioContext / MediaStream dengesini ölçüp "start → stop sonrası sıfır kalıntı"
 * sözleşmesini deterministik doğrulamak.
 *
 * Tasarım kuralları (CLAUDE.md + T1/T2/T7):
 *   - Yalnız src/__tests__ altında → production bundle'a GİRMEZ (tree-shake).
 *   - Hiçbir production / native modülü import EDİLMEZ → saf, bağımsız araç.
 *   - React/react-dom import EDİLMEZ (jsdom'da çöküyor — T7 dersi).
 *   - Worker mock'u için T7 `runtimeSimulator.makeMockWorker` yeniden kullanılır.
 */

// ── 1. EventTarget listener denge spy'ı ───────────────────────────────────────────

interface ListenerEntry { type: string; listener: EventListenerOrEventListenerObject }

export interface EventTargetSpy {
  /** Toplam addEventListener çağrısı (opsiyonel type filtresi). */
  added:        (type?: string) => number;
  /** Toplam removeEventListener çağrısı (opsiyonel type filtresi). */
  removed:      (type?: string) => number;
  /** Eklenip henüz kaldırılmamış (net aktif) listener sayısı. */
  active:       (type?: string) => number;
  /** Aktif listener'ların type→adet dağılımı. */
  byType:       () => Map<string, number>;
  /** Orijinal add/removeEventListener'ı geri yükler. */
  restore:      () => void;
}

/**
 * Bir EventTarget'ın (window/document/element) add/removeEventListener'ını sarmalar
 * ve denge sayar. `active() === 0` → sızıntı yok.
 */
export function spyEventTarget(target: EventTarget): EventTargetSpy {
  const origAdd    = target.addEventListener.bind(target);
  const origRemove = target.removeEventListener.bind(target);

  let addCount = 0;
  let removeCount = 0;
  const addByType    = new Map<string, number>();
  const removeByType = new Map<string, number>();
  const live: ListenerEntry[] = []; // net aktif (eklendi, kaldırılmadı)

  function bump(m: Map<string, number>, type: string): void {
    m.set(type, (m.get(type) ?? 0) + 1);
  }

  target.addEventListener = (function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener) {
      addCount++;
      bump(addByType, type);
      live.push({ type, listener });
    }
    return origAdd(type, listener, options);
  }) as typeof target.addEventListener;

  target.removeEventListener = (function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (listener) {
      removeCount++;
      bump(removeByType, type);
      const idx = live.findIndex((e) => e.type === type && e.listener === listener);
      if (idx >= 0) live.splice(idx, 1);
    }
    return origRemove(type, listener, options);
  }) as typeof target.removeEventListener;

  return {
    added:   (type) => (type ? (addByType.get(type) ?? 0) : addCount),
    removed: (type) => (type ? (removeByType.get(type) ?? 0) : removeCount),
    active:  (type) => (type ? live.filter((e) => e.type === type).length : live.length),
    byType: () => {
      const m = new Map<string, number>();
      for (const e of live) m.set(e.type, (m.get(e.type) ?? 0) + 1);
      return m;
    },
    restore: () => {
      target.addEventListener = origAdd as typeof target.addEventListener;
      target.removeEventListener = origRemove as typeof target.removeEventListener;
    },
  };
}

// ── 2. Timer denge spy'ı (gerçek timer'larla, fake timer GEREKMEZ) ─────────────────
//
// setTimeout fire olunca otomatik "pending" setinden düşer; setInterval yalnız
// clearInterval ile düşer. Böylece "stop() sonrası bekleyen interval var mı?"
// sorusu doğru yanıtlanır.

export interface TimerSpy {
  /** Beklemede olan (clear edilmemiş, fire olmamış) setTimeout sayısı. */
  activeTimeouts:  () => number;
  /** Beklemede olan (clear edilmemiş) setInterval sayısı. */
  activeIntervals: () => number;
  /** Toplam oluşturulan setTimeout/setInterval sayısı. */
  created:         () => number;
  restore:         () => void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

/** global setTimeout/clearTimeout/setInterval/clearInterval'i denge sayan stub'la sarmalar. */
export function installTimerSpy(): TimerSpy {
  const origSetTimeout    = globalThis.setTimeout;
  const origClearTimeout  = globalThis.clearTimeout;
  const origSetInterval   = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;

  const timeouts  = new Set<TimerHandle>();
  const intervals = new Set<TimerHandle>();
  let createdCount = 0;

  globalThis.setTimeout = function (handler: TimerHandler, timeout?: number, ...args: unknown[]): TimerHandle {
    createdCount++;
    const id: TimerHandle = origSetTimeout(((...a: unknown[]): void => {
      timeouts.delete(id);
      if (typeof handler === 'function') (handler as (...p: unknown[]) => void)(...a);
    }) as TimerHandler, timeout, ...args);
    timeouts.add(id);
    return id;
  } as typeof setTimeout;

  globalThis.clearTimeout = function (id?: TimerHandle): void {
    if (id !== undefined) timeouts.delete(id);
    return origClearTimeout(id);
  } as typeof clearTimeout;

  globalThis.setInterval = function (handler: TimerHandler, timeout?: number, ...args: unknown[]): TimerHandle {
    createdCount++;
    const id = origSetInterval(handler, timeout, ...args);
    intervals.add(id);
    return id;
  } as typeof setInterval;

  globalThis.clearInterval = function (id?: TimerHandle): void {
    if (id !== undefined) intervals.delete(id);
    return origClearInterval(id);
  } as typeof clearInterval;

  return {
    activeTimeouts:  () => timeouts.size,
    activeIntervals: () => intervals.size,
    created:         () => createdCount,
    restore: () => {
      globalThis.setTimeout    = origSetTimeout;
      globalThis.clearTimeout  = origClearTimeout;
      globalThis.setInterval   = origSetInterval;
      globalThis.clearInterval = origClearInterval;
    },
  };
}

// ── 3. Native listener (CarLauncher.addListener → {remove}) denge mock'u ───────────

export interface MockCarLauncher {
  /** vi.mock factory'sine verilecek nesne. */
  CarLauncher: Record<string, unknown>;
  added:           (event?: string) => number;
  removed:         (event?: string) => number;
  /** Eklenip kaldırılmamış native handle sayısı. */
  activeListeners: (event?: string) => number;
  reset:           () => void;
}

/**
 * CarLauncher native plugin'ini, addListener → sayılabilir {remove} handle döndüren
 * bir mock ile taklit eder. Ek metodlar (scanOBD/connectOBD vb.) no-op döner.
 */
export function makeMockCarLauncher(extra: Record<string, unknown> = {}): MockCarLauncher {
  const addByEvent    = new Map<string, number>();
  const removeByEvent = new Map<string, number>();

  function bump(m: Map<string, number>, e: string): void { m.set(e, (m.get(e) ?? 0) + 1); }
  function total(m: Map<string, number>): number {
    let n = 0; for (const v of m.values()) n += v; return n;
  }

  const addListener = (event: string): Promise<{ remove: () => Promise<void> }> => {
    bump(addByEvent, event);
    return Promise.resolve({
      remove: () => { bump(removeByEvent, event); return Promise.resolve(); },
    });
  };

  // Yaygın native metodlar — no-op resolve (gerçek native davranış değiştirilmez).
  const noop = (): Promise<void> => Promise.resolve();
  const CarLauncher: Record<string, unknown> = {
    addListener,
    removeAllListeners: noop,
    scanOBD:        () => Promise.resolve({ devices: [] }),
    connectOBD:     noop,
    disconnectOBD:  noop,
    startCanBus:    noop,
    stopCanBus:     noop,
    startMcuSniff:  noop,
    stopMcuSniff:   noop,
    startBackgroundService: noop,
    stopBackgroundService:  noop,
    ...extra,
  };

  return {
    CarLauncher,
    added:   (e) => (e ? (addByEvent.get(e) ?? 0) : total(addByEvent)),
    removed: (e) => (e ? (removeByEvent.get(e) ?? 0) : total(removeByEvent)),
    activeListeners: (e) =>
      e
        ? (addByEvent.get(e) ?? 0) - (removeByEvent.get(e) ?? 0)
        : total(addByEvent) - total(removeByEvent),
    reset: () => { addByEvent.clear(); removeByEvent.clear(); },
  };
}

// ── 4. Zustand subscription probe ─────────────────────────────────────────────────

export interface SubscribeProbe {
  /** subscribe sonrası yayılan bildirim sayısı. */
  count: () => number;
  /** Aboneliği kaldırır. */
  unsub: () => void;
}

/**
 * subscribe(cb)→unsub imzalı bir store'a abone olur, bildirim sayar.
 * Tipik kullanım: subscribe → action → count, unsub → action → count değişmez.
 */
export function subscribeProbe(store: { subscribe: (cb: () => void) => () => void }): SubscribeProbe {
  let n = 0;
  const unsub = store.subscribe(() => { n++; });
  return { count: () => n, unsub };
}

// ── 5. AudioContext / MediaStream mock'ları ───────────────────────────────────────

interface MockAudioParam {
  value: number;
  setValueAtTime: () => MockAudioParam;
  linearRampToValueAtTime: () => MockAudioParam;
  exponentialRampToValueAtTime: () => MockAudioParam;
  setTargetAtTime: () => MockAudioParam;
  cancelScheduledValues: () => MockAudioParam;
}

function makeParam(): MockAudioParam {
  const p: MockAudioParam = {
    value: 0,
    setValueAtTime: () => p,
    linearRampToValueAtTime: () => p,
    exponentialRampToValueAtTime: () => p,
    setTargetAtTime: () => p,
    cancelScheduledValues: () => p,
  };
  return p;
}

export interface MockAudioContextHandle {
  /** globalThis.AudioContext'e atanacak sınıf. */
  AudioContextClass: unknown;
  /** Oluşturulmuş context instance'ları. */
  instances: Array<{ closeCount: number; state: string; nodeDisconnects: () => number }>;
  reset: () => void;
}

/** Web Audio node mock'u — audioService zincirinin kullandığı tüm param/metodları taşır. */
function makeAudioNode(onDisconnect: () => void): Record<string, unknown> {
  return {
    type: 'peaking',
    fftSize: 256,
    smoothingTimeConstant: 0.85,
    Q: makeParam(), frequency: makeParam(), gain: makeParam(),
    threshold: makeParam(), knee: makeParam(), ratio: makeParam(),
    attack: makeParam(), release: makeParam(),
    delayTime: makeParam(), pan: makeParam(),
    connect:    () => {},
    disconnect: () => { onDisconnect(); },
  };
}

/**
 * Web Audio API mock'u (jsdom'da yok). audioService initAudio/buildChain/destroy
 * yolunu sürer; close()/disconnect() sayılır → cleanup doğrulanır.
 */
export function makeMockAudioContext(): MockAudioContextHandle {
  const instances: MockAudioContextHandle['instances'] = [];

  class MockAudioContext {
    state = 'running';
    currentTime = 0;
    destination = makeAudioNode(() => { this._disc++; });
    private _closeCount = 0;
    private _disc = 0;

    constructor(_opts?: unknown) {
      instances.push({
        closeCount:      0,
        state:           this.state,
        nodeDisconnects: () => this._disc,
      });
      this._sync();
    }
    private _node(): Record<string, unknown> { return makeAudioNode(() => { this._disc++; }); }
    createBiquadFilter()      { return this._node(); }
    createDynamicsCompressor(){ return this._node(); }
    createChannelSplitter()   { return this._node(); }
    createChannelMerger()     { return this._node(); }
    createDelay()             { return this._node(); }
    createStereoPanner()      { return this._node(); }
    createGain()              { return this._node(); }
    createAnalyser()          { return this._node(); }
    resume(): Promise<void>   { this.state = 'running'; this._sync(); return Promise.resolve(); }
    close(): Promise<void>    { this._closeCount++; this.state = 'closed'; this._sync(); return Promise.resolve(); }
    private _sync(): void {
      const rec = instances[instances.length - 1];
      if (rec) { rec.closeCount = this._closeCount; rec.state = this.state; }
    }
  }

  return {
    AudioContextClass: MockAudioContext,
    instances,
    reset: () => { instances.length = 0; },
  };
}

export interface MockMediaStreamHandle {
  stream:      MediaStream;
  /** track.stop() çağrıldı mı (her track için). */
  allStopped:  () => boolean;
  stopCount:   () => number;
}

/** getUserMedia dönüşü için track.stop() izleyen sahte MediaStream. */
export function makeMockMediaStream(trackCount = 1): MockMediaStreamHandle {
  let stopped = 0;
  const tracks = Array.from({ length: trackCount }, () => ({
    stop: () => { stopped++; },
    kind: 'audio',
    enabled: true,
  }));
  const stream = {
    getTracks:      () => tracks,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  return {
    stream,
    allStopped: () => stopped >= trackCount,
    stopCount:  () => stopped,
  };
}
