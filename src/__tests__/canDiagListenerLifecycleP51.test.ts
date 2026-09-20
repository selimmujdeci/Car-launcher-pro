/**
 * canDiagListenerLifecycleP51.test.ts — P5-1 · canDiag DİNLEYİCİ YAŞAM DÖNGÜSÜ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * İDDİA
 *
 * `startVehicleDataLayer()` native cihazda `canDiag` kanalına bir dinleyici
 * kurar. Dönen `PluginListenerHandle` SAKLANMAZSA katman durdurulduğunda o
 * dinleyici KALIR. VehicleDataLayer yeniden başlatılabilen bir servistir
 * (`SystemBoot._handleWorkerCrash` → eski cleanup → `startVehicleDataLayer`
 * yeniden), yani her worker çökmesi bir dinleyici daha bırakır:
 *
 *   START × N   →   canDiag LISTENER × N
 *
 * Sonuç yalnız bellek değildir: her tanı satırı `recordDiagLine` ve
 * `_feedValidatorFromDiag` yollarından N KEZ geçer — yani aynı CAN sinyali
 * validator'a N kez beslenir ve olay kütüğüne N kez yazılır.
 *
 * ── DOĞRU INVARIANT ───────────────────────────────────────────────────────
 *   ÇALIŞAN BİR VehicleDataLayer  =  BİR canDiag dinleyicisi
 *   DURDURULMUŞ VehicleDataLayer  =  SIFIR canDiag dinleyicisi
 *
 * ── KANIT SEVİYESİ ────────────────────────────────────────────────────────
 * DAVRANIŞSAL. Kaynak-metin araması DEĞİL: native köprü sınırı taklit edilir
 * ve GERÇEKTEN kayıtlı kalan dinleyiciler sayılır, ayrıca bir olay yayılıp
 * üretim yan etkisinin (`recordDiagLine`) kaç kez koştuğu ölçülür.
 *
 * MOCK POLİTİKASI (en küçük güvenli set): `VehicleSignalResolver` (Worker
 * açmasın), `remoteCommandService` (ağ), `bridge` (native yolu etkinleştir),
 * `nativePlugin` (köprü sınırı), `EventRecorder` (yan etkiyi say — diğer
 * export'lar gerçek kalır). Geri kalan her şey ÜRETİM kodudur.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Native köprü sınırı — kayıtlı dinleyiciler burada gerçekten tutulur. */
const nat = vi.hoisted(() => ({
  /** event → canlı geri çağırımlar. */
  listeners: new Map<string, Set<(ev: { msg: string }) => void>>(),
  /** `addListener` toplam çağrı sayısı (kayıt ≠ çağrı ayrımı için). */
  addCalls: 0,
  /**
   * `true` iken `addListener` promise'i ELDE TUTULUR: Capacitor'da kayıt
   * native tarafta hemen olur ama handle ÇAĞIRANA daha sonra ulaşır. Bu,
   * "start → addListener beklemede → stop → promise çözülür" yarışını
   * gerçekçi biçimde kurar.
   */
  deferHandles: false,
  /** Elde tutulan handle çözücüleri. */
  pending: [] as Array<() => void>,
}));

vi.mock('../platform/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/bridge')>();
  return { ...actual, isNative: true };
});

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    addListener: (event: string, cb: (ev: { msg: string }) => void) => {
      nat.addCalls++;
      /* Kayıt HEMEN olur — olaylar bu andan itibaren geri çağırıma ulaşır. */
      let set = nat.listeners.get(event);
      if (!set) { set = new Set(); nat.listeners.set(event, set); }
      set.add(cb);
      const handle = { remove: async (): Promise<void> => { set!.delete(cb); } };

      if (!nat.deferHandles) return Promise.resolve(handle);
      return new Promise<typeof handle>((resolve) => {
        nat.pending.push(() => resolve(handle));
      });
    },
    startMcuSniff: () => Promise.resolve(),
    stopMcuSniff:  () => Promise.resolve(),
  },
}));

vi.mock('../platform/vehicleDataLayer/VehicleSignalResolver', () => ({
  VehicleSignalResolver: class {
    start(): void { /* no-op */ }
    stop():  void { /* no-op */ }
    onResolved(_cb: unknown): () => void { return () => { /* no-op */ }; }
    sendGeofence(_z: unknown): void { /* no-op */ }
    restoreOdometer(_km: number): void { /* no-op */ }
    setHandshakeOutcome(_o: unknown): void { /* no-op */ }
    chaosBitflip(): void { /* no-op */ }
  },
}));

vi.mock('../platform/remoteCommandService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/remoteCommandService')>();
  return {
    ...actual,
    startRemoteCommands: () => Promise.resolve(),
    stopRemoteCommands:  () => { /* no-op */ },
  };
});

/** Üretim yan etkisini say — diğer export'lar GERÇEK kalır. */
const rec = vi.hoisted(() => ({ diagLines: 0 }));
vi.mock('../platform/canBus/EventRecorder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/canBus/EventRecorder')>();
  return {
    ...actual,
    recordDiagLine: (..._a: unknown[]) => { rec.diagLines++; },
  };
});

import { startVehicleDataLayer } from '../platform/vehicleDataLayer';

/** O anda canlı `canDiag` dinleyici sayısı. */
function liveCanDiag(): number {
  return nat.listeners.get('canDiag')?.size ?? 0;
}

/** Native tarafın bir tanı satırı yayması. */
function emitCanDiag(msg: string): void {
  for (const cb of [...(nat.listeners.get('canDiag') ?? [])]) cb({ msg });
}

/** Elde tutulan `addListener` promise'lerini çözer. */
async function releaseHandles(): Promise<void> {
  const p = nat.pending.splice(0);
  for (const r of p) r();
  await Promise.resolve();
  await Promise.resolve();
}

let open: Array<() => void> = [];
function start(): () => void {
  const c = startVehicleDataLayer();
  open.push(c);
  return c;
}

beforeEach(() => {
  nat.listeners.clear();
  nat.addCalls     = 0;
  nat.deferHandles = false;
  nat.pending      = [];
  rec.diagLines    = 0;
  open = [];
});

afterEach(() => {
  for (const c of open) { try { c(); } catch { /* zaten kapalı */ } }
  open = [];
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ── START / STOP TEMEL INVARIANT ────────────────────────────────────────────

describe('P5-1 · tek çalışan katman = tek dinleyici', () => {
  it('start sonrası TAM OLARAK bir canDiag dinleyicisi vardır', async () => {
    start();
    await Promise.resolve();

    expect(nat.addCalls, 'canDiag hiç kaydedilmemiş — ölçüm kör olurdu')
      .toBeGreaterThan(0);
    expect(liveCanDiag(), 'start tek dinleyici kurmalı').toBe(1);
  });

  it('stop sonrası SIFIR canDiag dinleyicisi kalır', async () => {
    const stop = start();
    await Promise.resolve();
    expect(liveCanDiag()).toBe(1);

    stop();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      liveCanDiag(),
      'katman durduruldu ama canDiag dinleyicisi KALDI — her restart bir tane daha ekler',
    ).toBe(0);
  });
});

// ── RESTART BİRİKİMİ (asıl kusur) ───────────────────────────────────────────

describe('P5-1 · restart dinleyici BİRİKTİRMEZ', () => {
  it('10 kez start→stop sonrası hiç dinleyici kalmaz', async () => {
    for (let i = 0; i < 10; i++) {
      const stop = start();
      await Promise.resolve();
      stop();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(
      liveCanDiag(),
      '10 restart sonrası artık dinleyiciler birikti (START × N → LISTENER × N)',
    ).toBe(0);
  });

  it('10 restart sonra AÇIK olan katmanda yine tek dinleyici vardır', async () => {
    for (let i = 0; i < 10; i++) {
      const stop = start();
      await Promise.resolve();
      stop();
      await Promise.resolve();
      await Promise.resolve();
    }
    start();                       // 11. başlatma — açık kalır
    await Promise.resolve();

    expect(liveCanDiag(), 'yeni katman eski dinleyicileri MİRAS ALDI').toBe(1);
  });
});

// ── OLAY TAM OLARAK BİR KEZ İŞLENİR ─────────────────────────────────────────

describe('P5-1 · tanı satırı TAM OLARAK bir kez işlenir', () => {
  it('10 restart sonrası tek canDiag olayı bir kez işlenir', async () => {
    for (let i = 0; i < 10; i++) {
      const stop = start();
      await Promise.resolve();
      stop();
      await Promise.resolve();
      await Promise.resolve();
    }
    start();
    await Promise.resolve();

    rec.diagLines = 0;
    emitCanDiag('[CAN] 1D0  FF0032000000  ← speed=50.0 km/h  ts=1');

    expect(
      rec.diagLines,
      'aynı tanı satırı birden fazla kez işlendi — yinelenen işleme, '
      + 'validator çift besleme ve gereksiz CPU',
    ).toBe(1);
  });

  it('durdurulmuş katman olay İŞLEMEZ', async () => {
    const stop = start();
    await Promise.resolve();
    stop();
    await Promise.resolve();
    await Promise.resolve();

    rec.diagLines = 0;
    emitCanDiag('[CAN] 1D0  FF0032000000  ← speed=50.0 km/h  ts=1');

    expect(rec.diagLines, 'durdurulmuş katman hâlâ tanı satırı işliyor').toBe(0);
  });
});

// ── ASYNC YARIŞ · handle stop'tan SONRA gelir ───────────────────────────────

describe('P5-1 · addListener beklemedeyken stop gelirse sızmaz', () => {
  it('stop → handle çözülür → dinleyici yine de kaldırılır', async () => {
    nat.deferHandles = true;

    const stop = start();
    await Promise.resolve();
    expect(liveCanDiag(), 'kayıt hemen olmalı (Capacitor davranışı)').toBe(1);

    /* Handle HENÜZ gelmedi — üretim kodu onu tutamadı. */
    stop();
    await Promise.resolve();

    /* Native ack şimdi ulaşır. */
    await releaseHandles();
    await Promise.resolve();

    expect(
      liveCanDiag(),
      'handle stop sonrası geldi ve dinleyici sızdı — yarış penceresi açık',
    ).toBe(0);
  });
});

// ── IDEMPOTENCY ─────────────────────────────────────────────────────────────

describe('P5-1 · idempotency', () => {
  it('iki kez stop çağrısı güvenlidir', async () => {
    const stop = start();
    await Promise.resolve();

    stop();
    stop();
    await Promise.resolve();
    await Promise.resolve();

    expect(liveCanDiag()).toBe(0);
  });

  it('iki eşzamanlı katman ayrı ayrı temizlenir', async () => {
    const stopA = start();
    const stopB = start();
    await Promise.resolve();
    expect(liveCanDiag(), 'iki çalışan katman iki dinleyici demektir').toBe(2);

    stopA();
    await Promise.resolve();
    await Promise.resolve();
    expect(liveCanDiag(), "bir katmanın durdurulması DİĞERİNİN dinleyicisini sildi").toBe(1);

    stopB();
    await Promise.resolve();
    await Promise.resolve();
    expect(liveCanDiag()).toBe(0);
  });
});
