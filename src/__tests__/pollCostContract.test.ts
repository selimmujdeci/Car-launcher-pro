/**
 * P0-VDK-B3 · POLL MALİYET SÖZLEŞMESİ kilitleri (JS tarafı).
 *
 * SAHA (2026-08-30 · gerçek araç · CAROS LAB TAM KOPYA 1788096650111):
 * `attempted:117 · success:117 · noData:0` "hat kusursuz" diyordu; aynı oturumun
 * ham trafiğinde onlarca NO DATA, `7F1912` ve istek başına dört AT komutu vardı.
 * Kullanıcı VERİSİ maliyeti ile ADAPTÖR YÖNETİM maliyeti ayrı ölçülmediği sürece
 * bu çelişki görünmez kalıyordu.
 *
 * Kilitlerin ortak yasası: **KAYNAK YOK ≠ 0.**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizePollCost, normalizeCycleCost,
  adapterOverheadShare, wastedShare, costliestClass, burstVsNormal,
  getPollCostSnapshot, _resetPollCostForTest, EMPTY_POLL_COST,
  type PollCostSnapshot,
} from '../platform/obd/pollCost';
import type { NativePollCost, NativePollCycleCost } from '../platform/nativePlugin';

function cycle(over: Partial<NativePollCycleCost> = {}): NativePollCycleCost {
  return {
    cycleId: 1, sessionEpoch: 1000, burst: false,
    diagnosticPayloadRequests: 8, adapterControlCommands: 5,
    headerSwitches: 4, voltageReads: 1, protocolChecks: 0,
    redundantHeaderSwitches: 0,
    noResponses: 0, negativeResponses: 0, noResponseMs: 0,
    payloadMs: 3200, adapterMs: 205, elapsedMs: 3500,
    bytesTx: 60, bytesRx: 120, retries: null, provenance: 'NATIVE_MEASURED',
    ...over,
  };
}

function native(over: Partial<NativePollCost> = {}): NativePollCost {
  const last = cycle();
  return {
    present: true, sessionEpoch: 1000, cyclesRecorded: 1, burstCyclesRecorded: 0,
    unattributedCommands: 0,
    totals: {
      diagnosticPayloadRequests: 8, adapterControlCommands: 5, headerSwitches: 4,
      voltageReads: 1, protocolChecks: 0, redundantHeaderSwitches: 0,
      noResponses: 0, negativeResponses: 0, noResponseMs: 0,
      payloadMs: 3200, adapterMs: 205, bytesTx: 60, bytesRx: 120,
    },
    lastCycle: last, recentCycles: [last],
    ...over,
  };
}

beforeEach(() => { _resetPollCostForTest(); });

describe('B3 · PID isteği ile AT overhead AYRI', () => {
  it('🔒 10 PID + 4 AT → toplam 14 görünür ama iki sınıf AYRI taşınır', () => {
    const c = normalizeCycleCost(cycle({
      diagnosticPayloadRequests: 10, adapterControlCommands: 4, headerSwitches: 4,
      voltageReads: 0, protocolChecks: 0,
    }))!;
    expect(c.diagnosticPayloadRequests).toBe(10);
    expect(c.adapterControlCommands).toBe(4);
    expect(c.diagnosticPayloadRequests + c.adapterControlCommands).toBe(14);
    /* Sözleşmede "toplam istek" diye TEK bir alan YOKTUR — ayrım yapısaldır. */
    expect(Object.keys(c)).not.toContain('totalRequests');
  });

  it('🔒 AT overhead payı süreden türetilir; süre yoksa oran UYDURULMAZ', () => {
    expect(adapterOverheadShare(normalizeCycleCost(cycle({ payloadMs: 800, adapterMs: 200 })))).toBeCloseTo(0.2);
    expect(adapterOverheadShare(normalizeCycleCost(cycle({ payloadMs: 0, adapterMs: 0 })))).toBeNull();
    expect(adapterOverheadShare(null)).toBeNull();
  });

  it('🔒 en pahalı sınıf eşitlikte İDDİA EDİLMEZ', () => {
    expect(costliestClass(normalizeCycleCost(cycle({
      diagnosticPayloadRequests: 4, adapterControlCommands: 4,
      headerSwitches: 4, voltageReads: 0, protocolChecks: 0,
    })))).toBeNull();
    expect(costliestClass(normalizeCycleCost(cycle({
      diagnosticPayloadRequests: 9, adapterControlCommands: 2,
      headerSwitches: 2, voltageReads: 0, protocolChecks: 0,
    })))).toBe('DIAGNOSTIC_PAYLOAD');
    /* Hiç komut yoksa sınıf iddiası yok. */
    expect(costliestClass(normalizeCycleCost(cycle({
      diagnosticPayloadRequests: 0, adapterControlCommands: 0,
      headerSwitches: 0, voltageReads: 0, protocolChecks: 0,
    })))).toBeNull();
  });
});

describe('B3 · cevapsız ve negatif yanıt maliyeti 0 SAYILMAZ', () => {
  it('🔒 cevapsız maliyet süresiyle birlikte taşınır', () => {
    const c = normalizeCycleCost(cycle({ noResponses: 7, noResponseMs: 3150 }))!;
    expect(c.noResponses).toBe(7);
    expect(c.noResponseMs).toBe(3150);
  });

  it('🔒 negatif yanıt cevapsızlıktan AYRI alanda', () => {
    const c = normalizeCycleCost(cycle({ noResponses: 0, negativeResponses: 5, noResponseMs: 2100 }))!;
    expect(c.noResponses).toBe(0);
    expect(c.negativeResponses).toBe(5);
    expect(c.noResponseMs).toBeGreaterThan(0);
  });

  it('🔒 boşa giden süre payı hesaplanır; ölçüm yoksa null', () => {
    expect(wastedShare(normalizeCycleCost(cycle({ payloadMs: 800, adapterMs: 200, noResponseMs: 500 }))))
      .toBeCloseTo(0.5);
    expect(wastedShare(normalizeCycleCost(cycle({ payloadMs: 0, adapterMs: 0 })))).toBeNull();
  });
});

describe('B3 · KAYNAK YOK ≠ 0 (sahte sıfır yasağı)', () => {
  it('🔒 native kanıt yoksa durum UNAVAILABLE ve TÜM alanlar null', () => {
    const s = normalizePollCost(null, 5_000);
    expect(s.state).toBe('UNAVAILABLE');
    expect(s.totals.diagnosticPayloadRequests).toBeNull();
    expect(s.totals.adapterControlCommands).toBeNull();
    expect(s.cyclesRecorded).toBeNull();
    expect(s.lastCycle).toBeNull();
    expect(s.readAt).toBe(5_000);
  });

  it('🔒 present:false → UNAVAILABLE (0 üretilmez)', () => {
    expect(normalizePollCost({ ...native(), present: false }, 1).state).toBe('UNAVAILABLE');
  });

  it('🔒 metot cevap verdi ama hiç tur kapanmadı → NO_CYCLES_YET (MEASURED DEĞİL)', () => {
    const s = normalizePollCost(native({ cyclesRecorded: 0, lastCycle: null, recentCycles: [] }), 1);
    expect(s.state).toBe('NO_CYCLES_YET');
  });

  it('🔒 retries ölçülmediyse null KALIR (0 yapılmaz)', () => {
    expect(normalizeCycleCost(cycle({ retries: null }))!.retries).toBeNull();
    expect(normalizeCycleCost(cycle({ retries: 3 }))!.retries).toBe(3);
  });

  it('🔒 eski APK: totals alanı hiç yoksa alanlar null olur, 0 DEĞİL', () => {
    const raw = { ...native(), totals: undefined } as unknown as NativePollCost;
    const s = normalizePollCost(raw, 1);
    expect(s.totals.headerSwitches).toBeNull();
    expect(s.totals.noResponses).toBeNull();
  });

  it('🔒 okuma yapılmadan snapshot dürüst boşluk döner', () => {
    expect(getPollCostSnapshot()).toEqual(EMPTY_POLL_COST);
    expect(getPollCostSnapshot().state).toBe('UNAVAILABLE');
  });
});

describe('B3 · burst ile normal tur AYRI ölçülür', () => {
  const mixed: PollCostSnapshot = normalizePollCost(native({
    cyclesRecorded: 4, burstCyclesRecorded: 2,
    recentCycles: [
      cycle({ cycleId: 1, burst: false, elapsedMs: 1000, diagnosticPayloadRequests: 2 }),
      cycle({ cycleId: 2, burst: true,  elapsedMs: 3000, diagnosticPayloadRequests: 9 }),
      cycle({ cycleId: 3, burst: true,  elapsedMs: 3400, diagnosticPayloadRequests: 9 }),
      cycle({ cycleId: 4, burst: false, elapsedMs: 1200, diagnosticPayloadRequests: 2 }),
    ],
  }), 1);

  it('🔒 burst ve normal turlar ayrı ortalamalarla raporlanır', () => {
    const r = burstVsNormal(mixed);
    expect(r.burstCycles).toBe(2);
    expect(r.normalCycles).toBe(2);
    expect(r.burstAvgMs).toBe(3200);
    expect(r.normalAvgMs).toBe(1100);
    expect(r.burstAvgPayload).toBe(9);
    expect(r.normalAvgPayload).toBe(2);
  });

  it('🔒 hiç burst turu yoksa ortalama null (0 DEĞİL)', () => {
    const r = burstVsNormal(normalizePollCost(native(), 1));
    expect(r.burstCycles).toBe(0);
    expect(r.burstAvgMs).toBeNull();
  });
});

describe('B3 · poll bütçesi bağlantı/kurtarma işini SAHİPLENMEZ', () => {
  it('🔒 tur dışı komutlar ayrı alanda görünür (poll turuna yazılmaz)', () => {
    const s = normalizePollCost(native({ unattributedCommands: 23 }), 1);
    expect(s.unattributedCommands).toBe(23);
    /* Tur maliyetine karışmamalı. */
    expect(s.lastCycle!.diagnosticPayloadRequests).toBe(8);
  });
});

describe('B3 · gereksiz adresleme TESPİTİ taşınır', () => {
  it('🔒 kullanılmadan ezilen adresleme yazımı sayısı korunur', () => {
    const c = normalizeCycleCost(cycle({ headerSwitches: 4, redundantHeaderSwitches: 3 }))!;
    expect(c.headerSwitches).toBe(4);
    expect(c.redundantHeaderSwitches).toBe(3);
  });
});

describe('B3 · LAB alanları GERÇEKTEN görünür (bounded kesme kurbanı olmaz)', () => {
  /** Saha imzasına yakın dolu bir anlık görüntü — kanalın alan tavanını zorlar. */
  function fullSnapshot() {
    const c = cycle({ cycleId: 137, diagnosticPayloadRequests: 8, adapterControlCommands: 5,
      headerSwitches: 4, voltageReads: 1, redundantHeaderSwitches: 3,
      noResponses: 6, negativeResponses: 4, noResponseMs: 3900,
      payloadMs: 3200, adapterMs: 205, elapsedMs: 3500 });
    return {
      readAt: 1_000,
      pollEvidence: {
        present: true, evidenceComplete: true, transport: 'classic',
        burstEnabled: false, burstIntent: false, lastCycleWasBurst: false,
        configuredPidCount: 8,
        counters: {
          pollCycles: 137, burstCycles: 135, roundRobinCycles: 2,
          attempted: 117, success: 117, noData: 0, busy: 0, negativeResponse: 0,
          error: 0, timeoutNoBytes: 0, timeoutPartial: 0, parseFailure: 0,
          cancelled: 0, unknownFailure: 0, callbackEmitted: 117, maxBurstSizeObserved: 9,
        },
        lastAttemptedPid: '10', lastSuccessfulPid: '10', lastOutcome: 'OK',
        lastElapsedMs: 1040, lastPollAt: 900, decisionLabel: 'HAT SAĞLIKLI',
        js: { eventsReceived: 116, decodeFailures: 0, valuesStored: 116, valuesCached: 8 },
      },
      pollCost: normalizePollCost(native({
        cyclesRecorded: 137, burstCyclesRecorded: 135, unattributedCommands: 23,
        lastCycle: c, recentCycles: [c],
      }), 1_000),
      pollCostRefreshedAt: 1_000,
      schedulerBudget: {
        activePollCount: 33, deferredTotal: 41, recoveryPauseCount: 2, lineBudgetMs: 900,
        agingPidCount: 5, maxAgingMs: 12_000, maxAgeMs: 560_329, deadlineMissTotal: 17,
        notYetDueTotal: 88, neverSucceededCount: 25, pidCount: 33,
      },
      elimState: 'ok', elimRefreshedAt: null, pollEvidenceRefreshedAt: null, elim: null,
      extGate: null, timeline: null, sessionHealth: null, obdStatus: null, health: null,
      freshWindowMs: null, handshake: null, kwp: null, deepScan: null,
      canCollect: null, capture: null,
    } as never;
  }

  it('🔒 maliyet ve bütçe alanları kanal tavanına takılıp KAYBOLMAZ', async () => {
    const { buildSchedChannels } = await import('../platform/devtools/runtimeSchedulingBuild');
    const ids = buildSchedChannels(fullSnapshot()).flatMap((ch) => ch.fields).map((f) => f.id);
    for (const id of [
      'costLastCycle', 'costLastMs', 'costOverheadShare', 'costWaste',
      'costRedundantHeader', 'costTopClass', 'costBurstVsNormal', 'costUnattributed',
      'costTotals', 'costRetries',
      'budgetAllocated', 'budgetDeferred', 'budgetNotYetDue', 'budgetStarvation',
      'budgetFairness', 'budgetDeadlineMiss', 'budgetRecoveryPause',
    ]) {
      expect(ids, `LAB alanı kayboldu (kanal tavanı?): ${id}`).toContain(id);
    }
  });

  it('🔒 maliyet ölçülemediğinde LAB "0" DEĞİL "ÖLÇÜLEMEDİ" gösterir', async () => {
    const { buildSchedChannels } = await import('../platform/devtools/runtimeSchedulingBuild');
    const snap = { ...fullSnapshot(), pollCost: null, schedulerBudget: null } as never;
    const fields = buildSchedChannels(snap).flatMap((ch) => ch.fields);
    const cost = fields.find((f) => f.id === 'costState');
    const budget = fields.find((f) => f.id === 'budgetState');
    expect(cost).toBeDefined();
    expect(budget).toBeDefined();
    expect(String(cost!.value ?? '')).not.toBe('0');
    expect(String(budget!.value ?? '')).not.toBe('0');
  });

  it('🔒 ERTELENEN iş "desteklenmiyor" diye sunulmaz', async () => {
    const { buildSchedChannels } = await import('../platform/devtools/runtimeSchedulingBuild');
    const fields = buildSchedChannels(fullSnapshot()).flatMap((ch) => ch.fields);
    const row = fields.find((f) => f.id === 'budgetDeferred')!;
    expect(String(row.value)).toBe('41');
    expect(row.note).toContain('desteklenmiyor');   // "DEĞİLDİR" açıklaması zorunlu
    expect(row.note).toContain('eleme defterine YAZILMAZ');
  });
});
