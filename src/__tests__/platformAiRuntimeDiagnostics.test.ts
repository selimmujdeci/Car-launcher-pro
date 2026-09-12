/**
 * platformAiRuntimeDiagnostics.test.ts — AI-DIAG: tanı raporundaki `aiRuntime` bölümü kilitleri.
 *
 * NEDEN BU BÖLÜM VAR: `eventBus.activeListenerCount = 0` gözlemi tek başına AYIRT EDİLEMEYEN
 * üç kökü temsil ediyordu:
 *   (a) bus hiç yoktu       → wiring sessizce no-op döndü,
 *   (b) runtime kuruldu     → sonra dispose edildi,
 *   (c) abonelik reddedildi → limit/disposed.
 * `aiRuntime` bölümü `present` + `busPresent` + `subscriptions` üçlüsüyle bunları ayırır.
 *
 * KİLİTLENEN İNVARYANTLAR: "ölçülemiyor (null) ≠ gerçek 0" · fail-soft (accessor throw ederse
 * rapor sürer) · yalnız primitif alanlar (payload/AI çıktısı/prompt/PII TAŞIMAZ) · teşhis
 * okuması runtime veya abonelik YARATMAZ.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildPlatformRuntimeSnapshot } from '../platform/diagnosticSections';
import { startPlatformCoreEventBusWiring } from '../platform/system/platformCoreEventBusWiring';
import { startPlatformCoreVehicleHalWiring } from '../platform/system/platformCoreVehicleHalWiring';
import type { UnifiedVehicleStoreLike, UnifiedVehicleStateReadable } from '../platform/vehicleHal/providers';
import type { VehicleHalIngestTarget } from '../platform/vehicleHal';
import type { AiRuntimeWiringStatus } from '../platform/system/platformCoreAiRuntimeWiring';

const AI_MOD = '../platform/system/platformCoreAiRuntimeWiring';

function fakeStore(state: UnifiedVehicleStateReadable): UnifiedVehicleStoreLike {
  return { getState: () => state, subscribe: () => () => { /* */ } };
}
const fakeHal: VehicleHalIngestTarget = { ingest: () => undefined };

/** Tam `AiRuntimeWiringStatus` üretici — alan eksikse tip hatası verir (sözleşme kilidi). */
function status(over: Partial<AiRuntimeWiringStatus> = {}): AiRuntimeWiringStatus {
  return {
    present: false, started: false, disposed: false, subscriptions: 0,
    runCount: 0, publishedCount: 0, errorCount: 0, lastRunAt: null, busPresent: null,
    ...over,
  };
}

const _open: Array<() => void> = [];
afterEach(() => {
  while (_open.length) { try { _open.pop()!(); } catch { /* */ } }
  vi.restoreAllMocks();
});

/* ══════════════ "ölçülemiyor ≠ 0" ══════════════ */

describe('AI-DIAG — absent ile gerçek sıfır AYRILIR', () => {
  it('runtime YOKKEN: present=false ve sayaçlar NULL (0 DEĞİL)', () => {
    const { aiRuntime } = buildPlatformRuntimeSnapshot();
    expect(aiRuntime.present).toBe(false);
    expect(aiRuntime.subscriptions).toBeNull();
    expect(aiRuntime.runCount).toBeNull();
    expect(aiRuntime.errorCount).toBeNull();
    expect(aiRuntime.lastRunAt).toBeNull();
    expect(aiRuntime.started).toBeNull();
    expect(aiRuntime.disposed).toBeNull();
  });

  it('GERÇEK SIFIR korunur: present=true + subscriptions=0 → null DEĞİL', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockReturnValue(
      status({ present: true, started: true, subscriptions: 0, runCount: 0, busPresent: true }));
    const { aiRuntime } = buildPlatformRuntimeSnapshot();
    expect(aiRuntime.subscriptions).toBe(0);     // ÖLÇÜLDÜ ve sıfır
    expect(aiRuntime.runCount).toBe(0);
    expect(aiRuntime.lastRunAt).toBeNull();      // damga yok → uydurulmaz
  });

  it('bozuk sayaç (NaN/Infinity) NULL a normalize edilir, sağlam sayaç korunur', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockReturnValue(
      status({
        present: true, started: true, subscriptions: NaN, runCount: Infinity,
        errorCount: 2, lastRunAt: NaN, busPresent: true,
      }));
    const { aiRuntime } = buildPlatformRuntimeSnapshot();
    expect(aiRuntime.subscriptions).toBeNull();
    expect(aiRuntime.runCount).toBeNull();
    expect(aiRuntime.lastRunAt).toBeNull();
    expect(aiRuntime.errorCount).toBe(2);
  });
});

/* ══════════════ Kök ayrımı: busPresent ══════════════ */

describe('AI-DIAG — busPresent kökü ayırır', () => {
  it('BUS YOKTU dalı: busPresent=false + present=false', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockReturnValue(status({ busPresent: false }));
    const { aiRuntime } = buildPlatformRuntimeSnapshot();
    expect(aiRuntime.present).toBe(false);
    expect(aiRuntime.busPresent).toBe(false);    // → kök (a)
    expect(aiRuntime.subscriptions).toBeNull();  // sayaç yine "ölçülemiyor"
  });

  it('RUNTIME KAPANDI dalı: busPresent=true + present=false (kök (a) ile KARIŞMAZ)', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockReturnValue(status({ busPresent: true }));
    const { aiRuntime } = buildPlatformRuntimeSnapshot();
    expect(aiRuntime.present).toBe(false);
    expect(aiRuntime.busPresent).toBe(true);     // → kök (b)
  });

  it('hiç start denenmediyse busPresent=null (BİLİNMİYOR — false ile karışmaz)', () => {
    expect(buildPlatformRuntimeSnapshot().aiRuntime.busPresent).toBeNull();
  });

  it('present + started: gerçek subscriptions/runCount taşınır', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockReturnValue(
      status({
        present: true, started: true, subscriptions: 4, runCount: 7,
        errorCount: 1, lastRunAt: 1234, busPresent: true,
      }));
    const { aiRuntime } = buildPlatformRuntimeSnapshot();
    expect(aiRuntime.present).toBe(true);
    expect(aiRuntime.started).toBe(true);
    expect(aiRuntime.subscriptions).toBe(4);
    expect(aiRuntime.runCount).toBe(7);
    expect(aiRuntime.errorCount).toBe(1);
    expect(aiRuntime.lastRunAt).toBe(1234);
  });
});

/* ══════════════ Fail-soft + sınırlar ══════════════ */

describe('AI-DIAG — fail-soft ve bounded çıktı', () => {
  it('accessor THROW ederse aiRuntime absent döner, DİĞER bölümler üretilir', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockImplementation(() => { throw new Error('boom'); });
    _open.push(startPlatformCoreVehicleHalWiring({ store: fakeStore({ speed: 50 }), hal: fakeHal }));

    let snap: ReturnType<typeof buildPlatformRuntimeSnapshot> | null = null;
    expect(() => { snap = buildPlatformRuntimeSnapshot(); }).not.toThrow();
    expect(snap!.aiRuntime.present).toBe(false);
    expect(snap!.aiRuntime.subscriptions).toBeNull();
    expect(snap!.aiRuntime.busPresent).toBeNull();   // patlayınca bit de BİLİNMİYOR
    expect(snap!.halWiring.started).toBe(true);      // diğer bölüm ÜRETİLDİ
  });

  it('çıktı yalnız primitif — payload/AI raporu/prompt/PII TAŞIMAZ', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockReturnValue(
      status({ present: true, started: true, subscriptions: 4, runCount: 1, lastRunAt: 10, busPresent: true }));
    const { aiRuntime } = buildPlatformRuntimeSnapshot();

    for (const v of Object.values(aiRuntime as unknown as Record<string, unknown>)) {
      expect(['number', 'boolean', 'object']).toContain(typeof v);
      if (typeof v === 'object') expect(v).toBeNull();     // yalnız null olabilir
    }
    expect(Object.keys(aiRuntime)).toEqual([
      'present', 'started', 'disposed', 'busPresent',
      'subscriptions', 'runCount', 'errorCount', 'lastRunAt',
    ]);
    expect(JSON.stringify(aiRuntime)).not.toMatch(/report|summary|prompt|vin|lat|lon/i);
  });

  it('publishedCount bölüme SIZMAZ (AI çıktı hacmi teşhis yüzeyinde değil)', async () => {
    const mod = await import(AI_MOD);
    vi.spyOn(mod, 'getAiRuntimeStatus').mockReturnValue(
      status({ present: true, started: true, publishedCount: 99, busPresent: true }));
    expect(Object.keys(buildPlatformRuntimeSnapshot().aiRuntime)).not.toContain('publishedCount');
  });

  it('teşhis okuması AI runtime/abonelik YARATMAZ (salt-okuma)', () => {
    expect(buildPlatformRuntimeSnapshot().aiRuntime.present).toBe(false);
    buildPlatformRuntimeSnapshot();
    const after = buildPlatformRuntimeSnapshot().aiRuntime;
    expect(after.present).toBe(false);
    expect(after.subscriptions).toBeNull();
  });
});

/* ══════════════ İki sayaç birlikte okunabilir ══════════════ */

describe('AI-DIAG — activeListenerCount ile subscriptions AYNI raporda', () => {
  it('gerçek bus + gerçek AI runtime: subscriptions === activeListenerCount', async () => {
    _open.push(startPlatformCoreEventBusWiring());
    const { startPlatformCoreAiRuntimeWiring } = await import(AI_MOD);
    // DI'sız çağrı: wiring `getAppEventBus()` kullanır → GERÇEK bus üzerinde abone olur.
    _open.push(startPlatformCoreAiRuntimeWiring());

    const snap = buildPlatformRuntimeSnapshot();
    expect(snap.eventBus.present).toBe(true);
    expect(snap.aiRuntime.present).toBe(true);
    expect(snap.aiRuntime.busPresent).toBe(true);
    // KABUL KRİTERİ: normal koşulda İKİSİ EŞLEŞİR. Eşleşmiyorsa çift instance / bayat
    // snapshot şüphesidir — bu kilit otomatik düzeltme YAPMAZ, yalnız gözlemi sabitler.
    expect(snap.aiRuntime.subscriptions).toBe(snap.eventBus.activeListenerCount);
    expect(snap.aiRuntime.subscriptions).toBeGreaterThan(0);
  });

  it('bus YOKKEN AI wiring no-op: busPresent=false ve bus bölümü de absent', async () => {
    const { startPlatformCoreAiRuntimeWiring } = await import(AI_MOD);
    _open.push(startPlatformCoreAiRuntimeWiring());   // bus wiring HİÇ başlatılmadı

    const snap = buildPlatformRuntimeSnapshot();
    expect(snap.eventBus.present).toBe(false);
    expect(snap.aiRuntime.present).toBe(false);
    expect(snap.aiRuntime.busPresent).toBe(false);    // kök (a) KANITLANDI
    expect(snap.eventBus.activeListenerCount).toBeNull();
  });
});
