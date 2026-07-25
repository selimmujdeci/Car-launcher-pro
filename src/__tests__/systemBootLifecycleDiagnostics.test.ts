/**
 * systemBootLifecycleDiagnostics.test.ts — B-1 · SystemBoot yaşam döngüsü teşhisi.
 *
 * KAPSAM: `getLifecycleDiagnostics()` salt-okuma API'si + doygun (saturating) sayaçlar.
 * Teşhis SALT GÖZLEMDİR: hiçbir karar/kontrol akışı bu değerleri okumaz. Bu dosya
 * yalnız sayaç semantiğini ve yan-etkisizliği kilitler; P0-1 kilitleri AYRI dosyada
 * (`systemBootRestartLifecycle.test.ts`) ve DEĞİŞTİRİLMEMİŞTİR.
 *
 * `start()` yalnız start/stop sayacı testinde çağrılır; radar/Supabase realtime katmanı
 * izole edilir (çift boot'ta bilinen unhandled rejection — ayrı bulgu).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const vdl = vi.hoisted(() => ({
  startCalls:    0,
  cleanupCalls:  0,
  onWorkerCrash: null as (() => void) | null,
}));

// KISMİ mock: yalnız `startVehicleDataLayer`; diğer export'lar GERÇEK kalır.
vi.mock('../platform/vehicleDataLayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/vehicleDataLayer')>();
  return {
    ...actual,
    startVehicleDataLayer: (opts?: { onWorkerCrash?: () => void }) => {
      vdl.startCalls++;
      vdl.onWorkerCrash = opts?.onWorkerCrash ?? null;
      return (): void => { vdl.cleanupCalls++; };
    },
  };
});

// RadarEngine izolasyonu — bu dosya SystemBoot teşhisini test eder, radar/Supabase'i değil.
vi.mock('../platform/radar/radarEngine', () => ({
  startRadarEngine: () => Promise.resolve(),
  stopRadarEngine:  () => { /* no-op */ },
}));

import { systemBoot, DIAG_COUNTER_MAX } from '../platform/system/SystemBoot';

/* ── Test-içi yaşam döngüsü görünürlüğü ──────────────────────────────────── */

interface BootInternals {
  _cleanups:             Array<() => void>;
  _namedCleanups:        Map<string, () => void>;
  _backoffState:         Map<string, unknown>;
  _started:              boolean;
  _diagStarts:           number;
  _diagStops:            number;
  _diagRestartAttempts:  number;
  _diagRestartSuccesses: number;
  _diagRejectedPostStop: number;
}
const internals = (): BootInternals => systemBoot as unknown as BootInternals;

/** Tüm teşhis durumunu sıfırla (testler arası izolasyon). */
function resetBoot(): void {
  const b = internals();
  b._started = false;
  b._cleanups.length = 0;
  b._namedCleanups.clear();
  b._backoffState.clear();
  b._diagStarts = 0;
  b._diagStops = 0;
  b._diagRestartAttempts = 0;
  b._diagRestartSuccesses = 0;
  b._diagRejectedPostStop = 0;
}

/**
 * Yaşam döngüsünü aktif et + VehicleDataLayer'ı GERÇEK üretim yolundan başlat.
 *
 * NOT: bu iskele `restartService()` kullandığı için KENDİSİ bir "başarılı restart"
 * sayar (sayaç doğru davranış). Senaryolar sıfır tabandan ölçülebilsin diye
 * aktivasyon sonrası teşhis sayaçları sıfırlanır — yaşam döngüsü AKTİF kalır.
 */
async function activate(): Promise<void> {
  vi.useRealTimers();
  internals()._started = true;
  await systemBoot.restartService('VehicleDataLayer');
  expect(vdl.startCalls).toBe(1);
  expect(vdl.onWorkerCrash).toBeTypeOf('function');

  // İskele sayaçlarını sıfırla (yaşam döngüsü/timer durumuna DOKUNULMAZ).
  const b = internals();
  b._diagStarts = 0;
  b._diagStops = 0;
  b._diagRestartAttempts = 0;
  b._diagRestartSuccesses = 0;
  b._diagRejectedPostStop = 0;
}

beforeEach(() => {
  vdl.startCalls = 0;
  vdl.cleanupCalls = 0;
  vdl.onWorkerCrash = null;
  resetBoot();
});

afterEach(() => {
  try { systemBoot.stop(); } catch { /* zaten durmuş */ }
  vi.clearAllTimers();
  vi.useRealTimers();
  resetBoot();
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('B-1 — başlangıç değerleri', () => {
  it('tüm sayaçlar sıfır, listeler boş, counterMax açık', () => {
    const d = systemBoot.getLifecycleDiagnostics();
    expect(d.started).toBe(false);
    expect(d.starts).toBe(0);
    expect(d.stops).toBe(0);
    expect(d.restartAttempts).toBe(0);
    expect(d.restartSuccesses).toBe(0);
    expect(d.rejectedPostStopRestarts).toBe(0);
    expect(d.activeCleanupCount).toBe(0);
    expect(d.namedCleanupKeys).toEqual([]);
    expect(d.pendingRestarts).toEqual([]);
    expect(d.counterMax).toBe(DIAG_COUNTER_MAX);
  });
});

describe('B-1 — start / stop sayaçları', () => {
  it('gerçek start() bir kez sayar; ikinci (idempotent) çağrı SAYILMAZ; stop() her çağrıda sayar', async () => {
    vi.useRealTimers();
    await systemBoot.start();
    expect(systemBoot.getLifecycleDiagnostics().starts).toBe(1);
    expect(systemBoot.getLifecycleDiagnostics().started).toBe(true);

    await systemBoot.start();                       // idempotent no-op
    expect(systemBoot.getLifecycleDiagnostics().starts).toBe(1);

    systemBoot.stop();
    expect(systemBoot.getLifecycleDiagnostics().stops).toBe(1);
    expect(systemBoot.getLifecycleDiagnostics().started).toBe(false);

    systemBoot.stop();                              // stop() gövdesi idempotent → yine sayılır
    expect(systemBoot.getLifecycleDiagnostics().stops).toBe(2);
  });
});

describe('B-1 — aktif oturumda restart denemesi ve başarısı', () => {
  it('crash → attempt=1; backoff dolunca success=1, reddedilen=0', async () => {
    await activate();
    expect(systemBoot.getLifecycleDiagnostics().restartAttempts).toBe(0);

    vi.useFakeTimers();
    vdl.onWorkerCrash!();

    let d = systemBoot.getLifecycleDiagnostics();
    expect(d.restartAttempts).toBe(1);
    expect(d.restartSuccesses).toBe(0);

    await vi.advanceTimersByTimeAsync(6_000);       // backoff 5 sn + settle 500 ms

    d = systemBoot.getLifecycleDiagnostics();
    expect(d.restartSuccesses).toBe(1);
    expect(d.rejectedPostStopRestarts).toBe(0);
    expect(d.started).toBe(true);
  });
});

describe('B-1 — post-stop reddedilen restart sayacı', () => {
  it('stop() sonrası bekleyen restart ateşlenirse KAPI 1 reddi sayılır', async () => {
    await activate();
    vi.useFakeTimers();
    vdl.onWorkerCrash!();
    expect(systemBoot.getLifecycleDiagnostics().restartAttempts).toBe(1);

    systemBoot.stop();
    await vi.advanceTimersByTimeAsync(30_000);

    const d = systemBoot.getLifecycleDiagnostics();
    expect(d.rejectedPostStopRestarts).toBe(0);      // stop() timer'ı iptal etti → hiç ulaşmadı
    expect(d.restartSuccesses).toBe(0);
  });

  it('doğrudan restartService() çağrısı (stop sonrası) KAPI 1 tarafından sayılır', async () => {
    await activate();
    systemBoot.stop();

    await systemBoot.restartService('VehicleDataLayer');
    await systemBoot.restartService('VisionCompute');

    const d = systemBoot.getLifecycleDiagnostics();
    expect(d.rejectedPostStopRestarts).toBe(2);
    expect(d.restartSuccesses).toBe(0);
  });

  it('settle penceresinde stop() gelirse KAPI 2 reddi sayılır', async () => {
    await activate();
    vi.useFakeTimers();
    vdl.onWorkerCrash!();

    await vi.advanceTimersByTimeAsync(5_100);        // restartService başladı, settle'da
    systemBoot.stop();                              // KAPI 2 penceresi
    await vi.advanceTimersByTimeAsync(30_000);

    const d = systemBoot.getLifecycleDiagnostics();
    expect(d.rejectedPostStopRestarts).toBe(1);
    expect(d.restartSuccesses).toBe(0);
  });
});

describe('B-1 — bekleyen restart timer teşhisi', () => {
  it('plan kurulunca künye görünür; süre ilerledikçe remainingMs azalır; stop() planı siler', async () => {
    await activate();
    vi.useFakeTimers();

    expect(systemBoot.getLifecycleDiagnostics().pendingRestarts).toEqual([]);

    vdl.onWorkerCrash!();

    let p = systemBoot.getLifecycleDiagnostics().pendingRestarts;
    expect(p).toHaveLength(1);
    expect(p[0]!.key).toBe('VehicleCompute');
    expect(p[0]!.delayMs).toBe(5_000);
    expect(typeof p[0]!.scheduledAtMs).toBe('number');
    expect(p[0]!.remainingMs).toBeGreaterThan(0);
    expect(p[0]!.remainingMs).toBeLessThanOrEqual(5_000);

    const before = p[0]!.remainingMs;
    await vi.advanceTimersByTimeAsync(2_000);
    p = systemBoot.getLifecycleDiagnostics().pendingRestarts;
    expect(p).toHaveLength(1);
    expect(p[0]!.remainingMs).toBeLessThan(before);

    systemBoot.stop();
    expect(systemBoot.getLifecycleDiagnostics().pendingRestarts).toEqual([]);
  });

  it('bekleyen plan listesi kayıtlı backoff durumu sayısını AŞMAZ', async () => {
    await activate();
    vi.useFakeTimers();

    vdl.onWorkerCrash!();
    vdl.onWorkerCrash!();                            // aynı worker → TEK bekleyen plan
    const d = systemBoot.getLifecycleDiagnostics();
    expect(d.pendingRestarts.length).toBeLessThanOrEqual(internals()._backoffState.size);
    expect(d.pendingRestarts).toHaveLength(1);
  });
});

describe('B-1 — cleanup görünürlüğü', () => {
  it('aktif cleanup sayısı ve isimli cleanup anahtarları raporlanır', async () => {
    await activate();

    let d = systemBoot.getLifecycleDiagnostics();
    expect(d.activeCleanupCount).toBe(1);
    expect(d.namedCleanupKeys).toContain('VehicleDataLayer');

    systemBoot.stop();
    d = systemBoot.getLifecycleDiagnostics();
    expect(d.activeCleanupCount).toBe(0);
    expect(d.namedCleanupKeys).toEqual([]);
  });

  it('anahtarlar yalnız servis adıdır — hassas veri deseni içermez', async () => {
    await activate();
    const keys = systemBoot.getLifecycleDiagnostics().namedCleanupKeys.join('|');
    expect(keys).not.toMatch(/\d{6,}/);              // VIN/koordinat/uzun sayı yok
    expect(keys).not.toMatch(/[0-9A-F]{2}(:[0-9A-F]{2}){5}/i);  // MAC yok
    expect(keys).not.toMatch(/key|token|secret|password/i);
  });
});

describe('B-1 — doygunluk (saturating)', () => {
  it('sayaç counterMax\'ta sabitlenir, taşmaz', () => {
    internals()._diagStops = DIAG_COUNTER_MAX - 1;

    systemBoot.stop();
    expect(systemBoot.getLifecycleDiagnostics().stops).toBe(DIAG_COUNTER_MAX);

    systemBoot.stop();
    expect(systemBoot.getLifecycleDiagnostics().stops).toBe(DIAG_COUNTER_MAX);

    systemBoot.stop();
    expect(systemBoot.getLifecycleDiagnostics().stops).toBe(DIAG_COUNTER_MAX);
  });

  it('reddedilen restart sayacı da doygunlaşır', async () => {
    internals()._diagRejectedPostStop = DIAG_COUNTER_MAX;
    internals()._started = false;

    await systemBoot.restartService('VehicleDataLayer');
    expect(systemBoot.getLifecycleDiagnostics().rejectedPostStopRestarts).toBe(DIAG_COUNTER_MAX);
  });
});

describe('B-1 — yan etkisizlik', () => {
  it('tekrarlanan çağrılar durumu MUTASYONA UĞRATMAZ', async () => {
    await activate();
    vi.useFakeTimers();
    vdl.onWorkerCrash!();

    const a = systemBoot.getLifecycleDiagnostics();
    const cleanupsBefore = internals()._cleanups.length;
    const backoffBefore  = internals()._backoffState.size;
    const timersBefore   = vi.getTimerCount();

    for (let i = 0; i < 25; i++) systemBoot.getLifecycleDiagnostics();

    const b = systemBoot.getLifecycleDiagnostics();
    expect(b.starts).toBe(a.starts);
    expect(b.stops).toBe(a.stops);
    expect(b.restartAttempts).toBe(a.restartAttempts);
    expect(b.restartSuccesses).toBe(a.restartSuccesses);
    expect(b.rejectedPostStopRestarts).toBe(a.rejectedPostStopRestarts);
    expect(b.activeCleanupCount).toBe(a.activeCleanupCount);
    expect(b.namedCleanupKeys).toEqual(a.namedCleanupKeys);
    expect(b.pendingRestarts).toHaveLength(a.pendingRestarts.length);

    // Yaşam döngüsü durumu ve timer sayısı DEĞİŞMEDİ
    expect(internals()._cleanups.length).toBe(cleanupsBefore);
    expect(internals()._backoffState.size).toBe(backoffBefore);
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(vdl.startCalls).toBe(1);
    expect(vdl.cleanupCalls).toBe(0);
  });

  it('dönen anlık görüntü DONDURULMUŞ (tüketici bozamaz)', () => {
    const d = systemBoot.getLifecycleDiagnostics();
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.pendingRestarts)).toBe(true);
    expect(Object.isFrozen(d.namedCleanupKeys)).toBe(true);
  });
});
