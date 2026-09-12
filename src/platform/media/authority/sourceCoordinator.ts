/**
 * sourceCoordinator.ts — MÜZİK HUB PAKET A · Kaynak devri yürütücüsü.
 *
 * Durum makinesi SAF (`handoverMachine.ts`); burada yalnız yürütme vardır:
 * adapter çağrıları, bounded timeout, komut serileştirme.
 *
 * SÖZLEŞME:
 *   1. Aynı anda EN FAZLA bir audible backend olur.
 *   2. Eski kaynağın durduğu DOĞRULANMADAN yeni kaynak COMMITTED olmaz.
 *   3. Devir sırasında gelen komutlar serileştirilir (araya girip yarış yaratmaz).
 *   4. Yeni devir isteği eskisini SUPERSEDE eder — eski istek yalancı başarı dönmez.
 *   5. Hedef başlatılamazsa önceki kaynağa rollback denenir; olmazsa GÜVENLİ DURUŞ.
 *
 * Zero-Leak: her timeout timer'ı finally'de temizlenir; bekleyen devir yoksa
 * hiçbir timer yaşamaz.
 */

import {
  IDLE_HANDOVER,
  reduceHandover,
  isInFlight,
  audibleBackendCount,
  type HandoverEvent,
  type HandoverState,
} from './handoverMachine';
import type { SourceClass } from './sourceCapabilities';

/* ── Adapter sözleşmesi ──────────────────────────────────────────────────── */

export interface PlayRequest {
  /** Çalınacak öğeler — backend'e göre yorumlanır (uri / videoId / spotifyUri). */
  readonly items: readonly PlayItem[];
  readonly startIndex: number;
  readonly positionMs: number;
  /** false ise yalnız yüklenir, çalmaz (kaldığı yerden devam önizlemesi). */
  readonly autoPlay: boolean;
}

export interface PlayItem {
  readonly id: string;
  readonly uri: string;
  readonly title: string;
  readonly artist: string;
  readonly artworkUri?: string;
}

export interface StopOutcome {
  /** Durdurma komutu backend tarafından kabul edildi mi. */
  readonly accepted: boolean;
  /** Backend'in GERÇEKTEN sustuğu gözlendi mi (capability gerektirir). */
  readonly verified: boolean;
  readonly failureCode: string | null;
}

export interface StartOutcome {
  readonly accepted: boolean;
  /** Oynatmanın başladığı gözlendi mi. */
  readonly started: boolean;
  /** Ses yolunun doğrulandığı (yalnız native otoritede mümkün). */
  readonly renderingVerified: boolean;
  readonly failureCode: string | null;
}

/**
 * MUSIC F7.1 · Backend'in GÖZLENEN oynatma durumu.
 *
 * `UNKNOWN` dürüst bir cevaptır: backend durumunu okuyamıyorsa uydurulmaz.
 */
export type BackendPlaybackState =
  | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'STOPPED' | 'ERROR' | 'UNKNOWN';

export interface BackendCommandOutcome {
  readonly accepted: boolean;
  readonly failureCode: string | null;
}

/**
 * MUSIC F7.1 · Native OLMAYAN backend'lerin transport yüzeyi.
 *
 * NEDEN VAR: `mediaCommandGateway` transport komutlarını (play · pause · seek)
 * KOŞULSUZ `nativeAuthorityBridge`'e yolluyordu. Bu, backend'i native
 * `CarosPlaybackService` OLMAYAN kaynaklar (YouTube IFrame · Spotify Connect)
 * için YANLIŞTI — bu yüzden o kaynaklar kapının DIŞINDA, kendi ad-hoc
 * yollarından sürülüyordu (ikinci transport otoritesi).
 *
 * Çözüm ikinci kapı açmak DEĞİL, aynı kapının yürütmesini backend'e
 * DAĞITMAKTIR: politika · kanıt · dürüstlük kapıda kalır, yürütme sahibine
 * gider. Bir backend bir komutu sunmuyorsa kapı onu `unsupported_capability`
 * ile REDDEDER — sessizce yutmaz.
 */
export interface BackendTransport {
  resume(): Promise<BackendCommandOutcome>;
  pause(): Promise<BackendCommandOutcome>;
  seek(positionSec: number): Promise<BackendCommandOutcome>;
}

export interface BackendAdapter {
  readonly sourceClass: SourceClass;
  /** Bu backend şu anda ses üretiyor mu (GÖZLENEN, varsayım değil). */
  isActive(): boolean;
  /** Durdur ve mümkünse durduğunu doğrula. */
  stop(): Promise<StopOutcome>;
  /** Hedefi hazırla (kuyruk yükle / kaynak çöz). */
  prepare(request: PlayRequest): Promise<{ ready: boolean; failureCode: string | null }>;
  /** Başlat ve gözlenen sonucu döndür. */
  start(request: PlayRequest): Promise<StartOutcome>;
  /**
   * MUSIC F7.1 · Anlık gözlenen durum. Yoksa/okunamazsa `UNKNOWN`.
   * Native backend bunu SUNMAZ — orada gerçek `nativeAuthorityBridge`
   * anlık görüntüsüdür (tek kaynak korunur).
   */
  observe?(): BackendPlaybackState;
  /** MUSIC F7.1 · Native olmayan backend'in transport yüzeyi (yoksa reddedilir). */
  readonly transport?: BackendTransport;
}

/* ── Yürütücü ────────────────────────────────────────────────────────────── */

export interface HandoverResult {
  readonly ok: boolean;
  readonly committed: SourceClass | null;
  readonly failureCode: string | null;
  readonly phase: HandoverState['phase'];
  readonly elapsedMs: number;
  /** Hedef başladı ama ses yolu doğrulanamadı → "istek gönderildi" dürüstlüğü. */
  readonly renderingVerified: boolean;
  /** Devir sırasında serileştirilen komut sayısı. */
  readonly serializedCommands: number;
}

export interface CoordinatorDeps {
  readonly now: () => number;
  readonly adapters: ReadonlyMap<SourceClass, BackendAdapter>;
  /** Tek adım (stop/prepare/start) üst sınırı. */
  readonly stepTimeoutMs?: number;
  /** Devrin tamamı için üst sınır. */
  readonly totalTimeoutMs?: number;
  /** Teşhis kancası — fail-soft olmalıdır. */
  readonly onTransition?: (state: HandoverState, event: HandoverEvent) => void;
}

const DEFAULT_STEP_TIMEOUT_MS = 4000;
const DEFAULT_TOTAL_TIMEOUT_MS = 12_000;

export interface SourceCoordinator {
  switchTo(target: SourceClass, request: PlayRequest): Promise<HandoverResult>;
  getState(): HandoverState;
  getActiveSource(): SourceClass | null;
  /** Devir sürerken gelen komutu serileştirir; devir bitince çözülür. */
  serialize<T>(fn: () => Promise<T>): Promise<T>;
  /** Sözleşme ihlali denetimi — 1'den fazla audible backend ASLA olmamalı. */
  audibleBackends(): number;
  /** Aktif kaynağı güvenle durdurur (stop komutu). */
  stopActive(): Promise<StopOutcome>;
  /**
   * MUSIC F7.1 · Kayıtlı adaptörün SALT-OKUNUR erişimi.
   * Kapı, transport yürütmesini sahibine dağıtmak için kullanır; adaptör
   * kümesini DEĞİŞTİRMEZ (kayıt hâlâ `CoordinatorDeps`indir).
   */
  getAdapter(source: SourceClass): BackendAdapter | null;
}

export function createSourceCoordinator(deps: CoordinatorDeps): SourceCoordinator {
  const stepTimeout = deps.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const totalTimeout = deps.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;

  let state: HandoverState = IDLE_HANDOVER;
  /** Devam eden devir zinciri — komut serileştirmesi bunun üstüne kuyruklanır. */
  let chain: Promise<unknown> = Promise.resolve();
  /** Her yeni devir isteğinde artar; eski istek bunu görüp SUPERSEDE olur. */
  let generation = 0;

  function dispatch(event: HandoverEvent): void {
    const nextState = reduceHandover(state, event);
    if (nextState !== state) {
      state = nextState;
      try { deps.onTransition?.(state, event); } catch { /* teşhis ASLA akışı bozmaz */ }
    }
  }

  /** Bounded bekleme — hiçbir adım süresiz asılı kalmaz (Zero-Leak timer). */
  async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        p,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), ms);
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function runHandover(
    target: SourceClass,
    request: PlayRequest,
    myGeneration: number,
  ): Promise<HandoverResult> {
    const startedAt = deps.now();
    const targetAdapter = deps.adapters.get(target);

    if (!targetAdapter) {
      dispatch({ type: 'BEGIN', to: target, atMs: startedAt });
      dispatch({ type: 'FAIL', code: 'unknown_source_adapter', atMs: deps.now() });
      return result(startedAt, false);
    }

    dispatch({ type: 'BEGIN', to: target, atMs: startedAt });
    const previous = state.from;

    /* ── 1) Mevcut kaynağı durdur ve DOĞRULA ────────────────────────────── */
    const active = findActiveAdapter();
    if (active && active.sourceClass !== target) {
      const stop = await withTimeout(
        safeStop(active),
        stepTimeout,
        { accepted: false, verified: false, failureCode: 'stop_timeout' } as StopOutcome,
      );
      if (superseded(myGeneration)) return supersede(startedAt);

      if (!stop.verified) {
        // Sessizce devam ETMEK yasak: eski kaynak hâlâ ses veriyor olabilir.
        dispatch({ type: 'STOP_UNVERIFIED', atMs: deps.now() });
        // Hata kodu rollback'ten ÖNCE yakalanır: ROLLBACK_DONE durumu sıfırlayınca
        // gerçek neden kaybolur ve çağıran "bilinmeyen hata" görürdü.
        const code = state.failureCode;
        await rollback(previous, request);
        return result(startedAt, false, false, code);
      }
      dispatch({ type: 'STOP_VERIFIED', atMs: deps.now() });
    } else {
      // Çalan başka kaynak yok → durdurma adımı boş geçilir ama faz ATLANMAZ.
      dispatch({ type: 'STOP_VERIFIED', atMs: deps.now() });
    }

    /* ── 2) Hedefi hazırla ──────────────────────────────────────────────── */
    dispatch({ type: 'TARGET_PREPARED', atMs: deps.now() });  // → PREPARING_TARGET
    const prep = await withTimeout(
      safePrepare(targetAdapter, request),
      stepTimeout,
      { ready: false, failureCode: 'prepare_timeout' },
    );
    if (superseded(myGeneration)) return supersede(startedAt);
    if (!prep.ready) {
      const code = prep.failureCode ?? 'prepare_failed';
      dispatch({ type: 'FAIL', code, atMs: deps.now() });
      await rollback(previous, request);
      return result(startedAt, false, false, code);
    }
    dispatch({ type: 'TARGET_PREPARED', atMs: deps.now() });  // → TARGET_READY

    /* ── 3) Hedefi başlat ve GÖZLE ──────────────────────────────────────── */
    dispatch({ type: 'TARGET_STARTING', atMs: deps.now() });
    const start = await withTimeout(
      safeStart(targetAdapter, request),
      stepTimeout,
      {
        accepted: false, started: false, renderingVerified: false,
        failureCode: 'start_timeout',
      } as StartOutcome,
    );
    if (superseded(myGeneration)) return supersede(startedAt);

    if (!start.started) {
      const code = start.failureCode ?? 'start_failed';
      dispatch({ type: 'FAIL', code, atMs: deps.now() });
      await rollback(previous, request);
      return result(startedAt, false, start.renderingVerified, code);
    }

    dispatch({ type: 'TARGET_STARTED', atMs: deps.now() });

    /* ── 4) Toplam süre kapısı ──────────────────────────────────────────── */
    if (deps.now() - startedAt >= totalTimeout) {
      dispatch({ type: 'TIMEOUT', atMs: deps.now() });
      await rollback(previous, request);
      return result(startedAt, false, start.renderingVerified, 'handover_timeout');
    }

    dispatch({ type: 'COMMIT', atMs: deps.now() });
    return result(startedAt, true, start.renderingVerified);
  }

  function findActiveAdapter(): BackendAdapter | null {
    for (const adapter of deps.adapters.values()) {
      try {
        if (adapter.isActive()) return adapter;
      } catch { /* gözlem hatası → aktif DEĞİL sayılmaz, sıradakine bakılır */ }
    }
    return null;
  }

  async function safeStop(a: BackendAdapter): Promise<StopOutcome> {
    try { return await a.stop(); }
    catch { return { accepted: false, verified: false, failureCode: 'stop_threw' }; }
  }

  async function safePrepare(
    a: BackendAdapter, r: PlayRequest,
  ): Promise<{ ready: boolean; failureCode: string | null }> {
    try { return await a.prepare(r); }
    catch { return { ready: false, failureCode: 'prepare_threw' }; }
  }

  async function safeStart(a: BackendAdapter, r: PlayRequest): Promise<StartOutcome> {
    try { return await a.start(r); }
    catch {
      return { accepted: false, started: false, renderingVerified: false, failureCode: 'start_threw' };
    }
  }

  /** Hedef başlatılamadı → önceki kaynağa dön; olmazsa GÜVENLİ DURUŞ. */
  async function rollback(previous: SourceClass | null, request: PlayRequest): Promise<void> {
    if (!previous) { dispatch({ type: 'ROLLBACK_DONE', atMs: deps.now() }); return; }
    const prevAdapter = deps.adapters.get(previous);
    if (!prevAdapter) { dispatch({ type: 'ROLLBACK_DONE', atMs: deps.now() }); return; }
    const restore = await withTimeout(
      safeStart(prevAdapter, { ...request, autoPlay: false }),
      stepTimeout,
      { accepted: false, started: false, renderingVerified: false, failureCode: 'rollback_timeout' } as StartOutcome,
    );
    // Geri dönüş başarısızsa da faz kapanır: yarım kalmış devir bırakılmaz.
    if (!restore.started) {
      dispatch({ type: 'FAIL', code: 'rollback_failed', atMs: deps.now() });
      return;
    }
    dispatch({ type: 'ROLLBACK_DONE', atMs: deps.now() });
  }

  function superseded(myGeneration: number): boolean {
    return myGeneration !== generation;
  }

  function supersede(startedAt: number): HandoverResult {
    dispatch({ type: 'SUPERSEDE', atMs: deps.now() });
    return {
      ok: false,
      committed: state.committed,
      failureCode: 'superseded',
      phase: state.phase,
      elapsedMs: Math.max(0, deps.now() - startedAt),
      renderingVerified: false,
      serializedCommands: state.queuedCommands,
    };
  }

  /**
   * @param failureCode rollback ÖNCESİNDE yakalanmış gerçek neden. Verilmezse
   *        güncel durumdan okunur — ama rollback durumu sıfırlamış olabileceği
   *        için başarısız yollarda açıkça geçirilmelidir.
   */
  function result(
    startedAt: number,
    ok: boolean,
    renderingVerified = false,
    failureCode?: string | null,
  ): HandoverResult {
    return {
      ok,
      committed: state.committed,
      failureCode: ok ? null : (failureCode ?? state.failureCode),
      phase: state.phase,
      elapsedMs: Math.max(0, deps.now() - startedAt),
      renderingVerified: ok ? renderingVerified : false,
      serializedCommands: state.queuedCommands,
    };
  }

  return {
    switchTo(target: SourceClass, request: PlayRequest): Promise<HandoverResult> {
      generation += 1;
      const myGeneration = generation;
      // Zincirleme: aynı anda iki devir yürümez (yarış → çift ses).
      const run = chain.then(() => runHandover(target, request, myGeneration));
      chain = run.catch(() => undefined);
      return run;
    },

    getState(): HandoverState { return state; },

    getActiveSource(): SourceClass | null { return state.committed; },

    serialize<T>(fn: () => Promise<T>): Promise<T> {
      if (isInFlight(state.phase)) {
        dispatch({ type: 'ENQUEUE_COMMAND', atMs: deps.now() });
      }
      const run = chain.then(async () => {
        const out = await fn();
        dispatch({ type: 'DRAIN_COMMANDS', atMs: deps.now() });
        return out;
      });
      chain = run.catch(() => undefined);
      return run;
    },

    audibleBackends(): number { return audibleBackendCount(state); },

    async stopActive(): Promise<StopOutcome> {
      const active = findActiveAdapter();
      if (!active) return { accepted: true, verified: true, failureCode: null };
      const out = await withTimeout(
        safeStop(active),
        stepTimeout,
        { accepted: false, verified: false, failureCode: 'stop_timeout' } as StopOutcome,
      );
      if (out.verified) {
        state = { ...IDLE_HANDOVER, updatedAtMs: deps.now() };
      }
      return out;
    },

    getAdapter(source: SourceClass): BackendAdapter | null {
      return deps.adapters.get(source) ?? null;
    },
  };
}
