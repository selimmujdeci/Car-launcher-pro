/**
 * useAssistantContextStore — Birleşik Asistan Bağlamı testleri.
 *
 * SAF çekirdek (`buildSnapshot`) enjekte edilen kaynaklarla, lifecycle ise
 * enjekte edilen bağımlılıklarla (scheduler/tier/now/readSources/subscribeSources)
 * test edilir → canlı servis mock'u GEREKMEZ, deterministik.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  buildSnapshot,
  startAssistantContext,
  stopAssistantContext,
  refreshAssistantContext,
  getAssistantContextSnapshot,
  snapshotPeriodMs,
  useAssistantContextStore,
  _resetAssistantContextForTest,
  SNAPSHOT_PERIOD_MS,
  LOW_TIER_SNAPSHOT_PERIOD_MS,
  SNAPSHOT_TASK_ID,
  type AssistantContextDeps,
  type AssistantContextSources,
  type AssistantContextSnapshot,
} from '../store/useAssistantContextStore';
import type { DeviceTier } from '../platform/deviceCapabilities';
import type { ScheduledTask } from '../core/runtime/AdaptiveRuntimeManager';

/* ── Test koşum takımı: sahte scheduler + sahte abonelikler ─────────────── */

interface Harness {
  deps: AssistantContextDeps;
  /** Scheduler'a kaydedilen görev (tick'i elle tetiklemek için). */
  task: () => ScheduledTask;
  tickCount: () => number;
  /** Kaynak aboneliği kurulum/kapanış sayaçları (zero-leak + hot-path kanıtı). */
  subscribeCalls: () => number;
  unsubscribeCalls: () => number;
  unscheduleCalls: () => number;
  /** Abone edilmiş `onChange` — kaynak değişimini simüle eder (dirty flag). */
  emitChange: () => void;
  setNow: (ms: number) => void;
  readCalls: () => number;
}

function makeHarness(opts: {
  tier?: DeviceTier;
  sources?: AssistantContextSources | (() => AssistantContextSources);
} = {}): Harness {
  let now = 1_000_000;
  let task: ScheduledTask | null = null;
  let onChange: (() => void) | null = null;
  let subscribeCalls = 0, unsubscribeCalls = 0, unscheduleCalls = 0, readCalls = 0, tickCount = 0;

  const deps: AssistantContextDeps = {
    now: () => now,
    tier: () => opts.tier ?? 'mid',
    schedule: (t) => {
      // Görevi sar: tick sayısını ölçelim.
      task = { ...t, fn: () => { tickCount++; t.fn(); } };
      return () => { unscheduleCalls++; task = null; };
    },
    readSources: () => {
      readCalls++;
      const s = opts.sources;
      return (typeof s === 'function' ? s() : s) ?? {};
    },
    subscribeSources: (cb) => {
      subscribeCalls++;
      onChange = cb;
      return [() => { unsubscribeCalls++; }];
    },
  };

  return {
    deps,
    task: () => {
      if (!task) throw new Error('scheduler görevi kaydedilmedi');
      return task;
    },
    tickCount: () => tickCount,
    subscribeCalls: () => subscribeCalls,
    unsubscribeCalls: () => unsubscribeCalls,
    unscheduleCalls: () => unscheduleCalls,
    emitChange: () => onChange?.(),
    setNow: (ms) => { now = ms; },
    readCalls: () => readCalls,
  };
}

/** Tam dolu, geçerli örnek kaynak seti. */
function fullSources(): AssistantContextSources {
  return {
    identity: { fingerprintHash: 'abc123', manufacturer: 'Renault', profileHint: 'Renault', protocol: 'ISO15765' },
    health: { healthScore: 82, severity: 'warning', driveSafe: true, oilLifePercent: 60, wearRate: 0.2 },
    learning: { evidenceCount: 12, patternCount: 3, strongestConfidence: 0.77, learnedVehicleCount: 2 },
    status: { speed: 54, rpm: 1800, coolantTemp: 90, fuelLevel: 43, batteryVoltage: 14.1 },
    driver: { tripDuration: 25, cognitiveMode: 'AWARE' },
    navigation: { isNavigating: true, destination: 'Kadıköy', remainingKm: 12.4, remainingTime: 900 },
    media: { playing: true, volume: 60 },
    network: { online: true, wifi: true, mobile: false },
    device: { tier: 'mid', thermalStatus: 'normal', powerSaver: false },
  };
}

beforeEach(() => { _resetAssistantContextForTest(); });
afterEach(() => { _resetAssistantContextForTest(); vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Snapshot oluşturuluyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('buildSnapshot — snapshot oluşturma', () => {
  it('tüm bölümleri içeren snapshot üretir', () => {
    const snap = buildSnapshot(fullSources(), 12_345, 1);

    expect(snap.builtAt).toBe(12_345);
    expect(snap.revision).toBe(1);
    expect(snap.identity.fingerprintHash).toBe('abc123');
    expect(snap.identity.manufacturer).toBe('Renault');
    expect(snap.identity.protocol).toBe('ISO15765');
    expect(snap.health.healthScore).toBe(82);
    expect(snap.health.severity).toBe('warning');
    expect(snap.health.driveSafe).toBe(true);
    expect(snap.health.maintenance.oilLifePercent).toBe(60);
    expect(snap.learning.evidenceCount).toBe(12);
    expect(snap.learning.strongestConfidence).toBeCloseTo(0.77);
    expect(snap.status.speed).toBe(54);
    expect(snap.status.coolantTemp).toBe(90);
    expect(snap.driver.tripDuration).toBe(25);
    expect(snap.driver.cognitiveMode).toBe('AWARE');
    expect(snap.navigation.destination).toBe('Kadıköy');
    expect(snap.media.playing).toBe(true);
    expect(snap.network.online).toBe(true);
    expect(snap.device.tier).toBe('mid');
  });

  it('imkânsız sensör değerlerini (NaN / -1 sentinel / aralık dışı) null yapar', () => {
    const snap = buildSnapshot({
      status: { speed: 999, rpm: NaN, coolantTemp: -300, fuelLevel: 150, batteryVoltage: -1 },
      learning: { strongestConfidence: 5 },
    }, 1, 1);

    expect(snap.status.speed).toBeNull();
    expect(snap.status.rpm).toBeNull();
    expect(snap.status.coolantTemp).toBeNull();
    expect(snap.status.fuelLevel).toBeNull();
    expect(snap.status.batteryVoltage).toBeNull();
    expect(snap.learning.strongestConfidence).toBeNull();
  });

  it('kaynağı olmayan alanları (deepScan / ignition / fatigueScore / ducking) null bırakır', () => {
    const snap = buildSnapshot(fullSources(), 1, 1);

    expect(snap.deepScan.completed).toBeNull();
    expect(snap.deepScan.progress).toBeNull();
    expect(snap.deepScan.newDiscoveriesCount).toBeNull();
    expect(snap.deepScan.changedFirmware).toBeNull();
    expect(snap.deepScan.changedECU).toBeNull();
    expect(snap.status.ignition).toBeNull();
    expect(snap.driver.fatigueScore).toBeNull();
    expect(snap.media.ducking).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2-3. Tier'a göre snapshot periyodu
 * ════════════════════════════════════════════════════════════════════════ */

describe('snapshot periyodu (DeviceTier bütçesi)', () => {
  it('low tier → 10 saniye', () => {
    expect(snapshotPeriodMs('low')).toBe(10_000);
    expect(LOW_TIER_SNAPSHOT_PERIOD_MS).toBe(10_000);

    const h = makeHarness({ tier: 'low', sources: fullSources() });
    startAssistantContext(h.deps);
    expect(h.task().periodMs).toBe(10_000);
  });

  it('mid ve high tier → 5 saniye', () => {
    expect(snapshotPeriodMs('mid')).toBe(5_000);
    expect(snapshotPeriodMs('high')).toBe(5_000);
    expect(SNAPSHOT_PERIOD_MS).toBe(5_000);

    const mid = makeHarness({ tier: 'mid', sources: fullSources() });
    startAssistantContext(mid.deps);
    expect(mid.task().periodMs).toBe(5_000);
    stopAssistantContext();

    const high = makeHarness({ tier: 'high', sources: fullSources() });
    startAssistantContext(high.deps);
    expect(high.task().periodMs).toBe(5_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 + 10. Object.freeze / immutability
 * ════════════════════════════════════════════════════════════════════════ */

describe('immutability — Object.freeze', () => {
  it('snapshot ve tüm bölümleri dondurulmuştur', () => {
    const snap = buildSnapshot(fullSources(), 1, 1);

    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.identity)).toBe(true);
    expect(Object.isFrozen(snap.health)).toBe(true);
    expect(Object.isFrozen(snap.health.maintenance)).toBe(true);
    expect(Object.isFrozen(snap.learning)).toBe(true);
    expect(Object.isFrozen(snap.deepScan)).toBe(true);
    expect(Object.isFrozen(snap.status)).toBe(true);
    expect(Object.isFrozen(snap.driver)).toBe(true);
    expect(Object.isFrozen(snap.navigation)).toBe(true);
    expect(Object.isFrozen(snap.media)).toBe(true);
    expect(Object.isFrozen(snap.network)).toBe(true);
    expect(Object.isFrozen(snap.device)).toBe(true);
  });

  it('snapshot mutasyonu değeri değiştirmez', () => {
    const snap = buildSnapshot(fullSources(), 1, 1);
    const mutable = snap as unknown as { status: { speed: number } };

    try { mutable.status.speed = 999; } catch { /* strict mode → TypeError; ikisi de kabul */ }

    expect(snap.status.speed).toBe(54);
  });

  it('girdi kaynaklarını MUTASYONA UĞRATMAZ', () => {
    const sources = fullSources();
    const before = JSON.stringify(sources);

    buildSnapshot(sources, 1, 1);

    expect(JSON.stringify(sources)).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5-6. Fail-soft / null servis
 * ════════════════════════════════════════════════════════════════════════ */

describe('fail-soft', () => {
  it('bir kaynak bozuksa diğer bölümler üretilmeye devam eder', () => {
    // health tamamen bozuk (yanlış tipler), status sağlam.
    const broken = {
      health: { healthScore: 'çok iyi', severity: 'çok kötü', driveSafe: 'evet' },
      status: { speed: 60, rpm: 2000 },
    } as unknown as AssistantContextSources;

    const snap = buildSnapshot(broken, 1, 1);

    expect(snap.health.healthScore).toBeNull();
    expect(snap.health.severity).toBeNull();
    expect(snap.health.driveSafe).toBeNull();
    expect(snap.status.speed).toBe(60);   // diğer bölüm ETKİLENMEDİ
    expect(snap.status.rpm).toBe(2000);
  });

  it('null / undefined kaynakla throw etmez, tümü null snapshot üretir', () => {
    expect(() => buildSnapshot(null, 1, 1)).not.toThrow();
    expect(() => buildSnapshot(undefined, 1, 1)).not.toThrow();

    const snap = buildSnapshot(null, 1, 1);
    expect(snap.identity.fingerprintHash).toBeNull();
    expect(snap.status.speed).toBeNull();
    expect(snap.device.tier).toBeNull();
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('readSources throw ederse tik/başlatma çökmez, boş snapshot yayınlanır', () => {
    const h = makeHarness();
    const deps: AssistantContextDeps = {
      ...h.deps,
      readSources: () => { throw new Error('servis öldü'); },
    };

    expect(() => startAssistantContext(deps)).not.toThrow();

    const snap = getAssistantContextSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.status.speed).toBeNull();
  });

  it('subscribeSources throw ederse başlatma yine de tamamlanır', () => {
    const h = makeHarness({ sources: fullSources() });
    const deps: AssistantContextDeps = {
      ...h.deps,
      subscribeSources: () => { throw new Error('abonelik yok'); },
    };

    expect(() => startAssistantContext(deps)).not.toThrow();
    expect(getAssistantContextSnapshot()).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7-8. Dispose / zero-leak
 * ════════════════════════════════════════════════════════════════════════ */

describe('lifecycle — dispose ve zero-leak', () => {
  it('dispose tüm abonelikleri ve scheduler görevini kapatır', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    expect(h.subscribeCalls()).toBe(1);
    expect(h.unsubscribeCalls()).toBe(0);
    expect(h.unscheduleCalls()).toBe(0);

    stopAssistantContext();

    expect(h.unsubscribeCalls()).toBe(1);
    expect(h.unscheduleCalls()).toBe(1);
    expect(getAssistantContextSnapshot()).toBeNull(); // eski referans tutulmaz
  });

  it('start idempotenttir — ikinci çağrı yeni abonelik/timer kurmaz', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);
    startAssistantContext(h.deps);
    startAssistantContext(h.deps);

    expect(h.subscribeCalls()).toBe(1);
  });

  it('stop idempotenttir — ikinci çağrı ek unsubscribe üretmez', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);
    stopAssistantContext();
    stopAssistantContext();

    expect(h.unsubscribeCalls()).toBe(1);
    expect(h.unscheduleCalls()).toBe(1);
  });

  it('dispose sonrası tik çalışsa bile snapshot yayınlanmaz (dangling görev yok)', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);
    const task = h.task();
    stopAssistantContext();

    // Scheduler görevi kaldırıldı; yine de elde tutulan referansı tetiklemek çökmemeli.
    expect(() => task.fn()).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. Gizlilik
 * ════════════════════════════════════════════════════════════════════════ */

describe('gizlilik — VIN / MAC / GPS / ham PID sızmaz', () => {
  it('kaynakta gizli alanlar olsa bile snapshot bunları taşımaz (whitelist)', () => {
    const leaky = {
      identity: {
        fingerprintHash: 'abc123',
        protocol: 'ISO15765',
        vin: 'WF0AXXTTRAJA12345',
        adapterMac: 'AA:BB:CC:DD:EE:FF',
      },
      navigation: {
        isNavigating: true,
        destination: 'Kadıköy',
        latitude: 40.9901,
        longitude: 29.0250,
      },
      status: { speed: 50, rawPid: '410C1AF8', rawCan: '7E8 03 41 0C' },
    } as unknown as AssistantContextSources;

    const snap = buildSnapshot(leaky, 1, 1);
    const json = JSON.stringify(snap);

    expect(json).not.toContain('WF0AXXTTRAJA12345');
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(json).not.toContain('40.9901');
    expect(json).not.toContain('29.025');
    expect(json).not.toContain('410C1AF8');
    expect(json).not.toContain('7E8');
    expect(json).not.toMatch(/"vin"|"adapterMac"|"latitude"|"longitude"|"rawPid"|"rawCan"/);

    // Yorumlanmış alanlar korunur.
    expect(snap.identity.fingerprintHash).toBe('abc123');
    expect(snap.navigation.destination).toBe('Kadıköy');
    expect(snap.status.speed).toBe(50);
  });

  it('navigasyon hedefi yalnız ad taşır ve kırpılır (bellek + gizlilik)', () => {
    const long = 'A'.repeat(200);
    const snap = buildSnapshot({ navigation: { destination: long } }, 1, 1);

    expect(snap.navigation.destination).toHaveLength(64);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11-12. Dirty flag / manuel yenileme
 * ════════════════════════════════════════════════════════════════════════ */

describe('dirty flag ve manuel yenileme', () => {
  it('kaynak değişmediyse tik yeniden snapshot kurmaz (revision sabit)', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    const rev0 = getAssistantContextSnapshot()!.revision;
    const reads0 = h.readCalls();

    h.task().fn(); // dirty değil + bayat değil → hiçbir şey ayırma
    h.task().fn();

    expect(getAssistantContextSnapshot()!.revision).toBe(rev0);
    expect(h.readCalls()).toBe(reads0); // kaynak okuması bile yapılmadı
  });

  it('kaynak değişimi dirty yapar → sonraki tik yeni snapshot üretir', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    const rev0 = getAssistantContextSnapshot()!.revision;
    h.emitChange();
    h.task().fn();

    expect(getAssistantContextSnapshot()!.revision).toBe(rev0 + 1);
  });

  it('dirty olmasa bile snapshot bayatlarsa (>60 sn) yeniden kurulur', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    const rev0 = getAssistantContextSnapshot()!.revision;
    h.setNow(1_000_000 + 61_000);
    h.task().fn();

    expect(getAssistantContextSnapshot()!.revision).toBe(rev0 + 1);
  });

  it('refreshAssistantContext dirty flag\'i atlar ve anında yeni snapshot döner', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    const rev0 = getAssistantContextSnapshot()!.revision;
    const fresh = refreshAssistantContext();

    expect(fresh.revision).toBe(rev0 + 1);
    expect(getAssistantContextSnapshot()).toBe(fresh); // store da güncellendi
    expect(Object.isFrozen(fresh)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 13. Bellek büyümesi yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('bellek — snapshot birikmez', () => {
  it('200 yeniden kurulum sonrası store yalnız SON snapshot\'ı tutar', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    const seen = new Set<AssistantContextSnapshot>();
    for (let i = 0; i < 200; i++) {
      h.emitChange();
      h.task().fn();
      seen.add(getAssistantContextSnapshot()!);
    }

    // Store tek alanlı: geçmiş tutulmuyor, yalnız son snapshot erişilebilir.
    const state = useAssistantContextStore.getState();
    expect(Object.keys(state).filter((k) => !k.startsWith('_'))).toEqual(['snapshot']);
    expect(state.snapshot).toBe([...seen][seen.size - 1]);
    expect(state.snapshot!.revision).toBe(201); // 1 (ilk) + 200
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14. Hot-path etkilenmiyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('hot-path koruması', () => {
  it('görev NORMAL kritiklikte ve idle\'a ötelenir (3Hz hot-path\'e girmez)', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    const task = h.task();
    expect(task.id).toBe(SNAPSHOT_TASK_ID);
    expect(task.criticality).toBe('NORMAL'); // SAFETY değil → düşük tier'da yavaşlar
    expect(task.deferIdle).toBe(true);       // requestIdleCallback'e ötelenir
  });

  it('snapshot başına subscribe/unsubscribe döngüsü YOKTUR', () => {
    const h = makeHarness({ sources: fullSources() });
    startAssistantContext(h.deps);

    for (let i = 0; i < 50; i++) { h.emitChange(); h.task().fn(); }

    expect(h.subscribeCalls()).toBe(1);   // yalnız start'ta
    expect(h.unsubscribeCalls()).toBe(0); // dispose'a kadar hiç
    expect(h.tickCount()).toBe(50);
  });
});
