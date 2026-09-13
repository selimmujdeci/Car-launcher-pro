import { describe, expect, it } from 'vitest';
import { STANDARD_PID_MAP } from '../platform/obd/StandardPidRegistry';
import {
  buildSupportedPidSummary,
  classifyCorePidFreshness,
  OEM_DISCOVERY_WINDOW_MS,
  resolveOemDiscoveryState,
} from '../platform/obd/obdUxModel';
import { classifyFreshness, computeFreshnessWindow } from '../platform/obd/obdFreshnessPolicy';
import {
  classifyEcuCoverageStatus,
  isEcuDtcScanPartial,
  isEcuReachable,
  isEcuReadable,
  type EcuScanResult,
} from '../platform/obd/multiEcuScan';

describe('OBD ürün özeti', () => {
  it('katalog toplamını değil desteklenen/okunabilen veri sayısını ana metrik yapar', () => {
    const rows = [
      ...Array.from({ length: 16 }, () => ({ supported: true as const, status: 'fresh' as const })),
      { supported: true as const, status: 'waiting' as const },
      ...Array.from({ length: 84 }, () => ({ supported: false as const, status: 'unsupported' as const })),
    ];
    const summary = buildSupportedPidSummary(rows, true);
    expect(STANDARD_PID_MAP.size).toBe(101);
    expect(summary.label).toBe('16 / 17 desteklenen veri okunuyor');
    expect(summary.active).toBe(16);
    expect(summary.catalog).toBe(101);
  });

  it('destek keşfi eksikken katalogdan sahte payda üretmez', () => {
    const summary = buildSupportedPidSummary([
      { supported: null, status: 'fresh' },
      { supported: null, status: 'discovering' },
    ], false);
    expect(summary.supported).toBeNull();
    expect(summary.label).toContain('destek kapsamı belirleniyor');
  });
});

describe('cadence-aware PID tazeliği', () => {
  it('hızlı ve yavaş çekirdek PID aynı yaşta aynı hükmü almaz', () => {
    const speed = STANDARD_PID_MAP.get('0D')!;
    const intake = STANDARD_PID_MAP.get('0F')!;
    const now = 100_000;
    expect(classifyCorePidFreshness(speed, now - 40_000, now, 12_000)).toBe('STALE');
    expect(classifyCorePidFreshness(intake, now - 40_000, now, 12_000)).toBe('LIVE');
  });

  it('17 PID round-robin akışında 40 saniyelik sağlıklı yaş bayat sayılmaz', () => {
    const window = computeFreshnessWindow({ cls: 'medium', path: 'extended', cadenceMs: 3_000, watchedCount: 17 });
    expect(classifyFreshness({ hasValue: true, measuredAtMs: 60_000, nowMs: 100_000, window }).state).toBe('LIVE');
  });
});

describe('üretici verisi terminal durumları', () => {
  it('keşif penceresi sonlanınca UNKNOWN olur; sonsuz DISCOVERING kalmaz', () => {
    expect(resolveOemDiscoveryState({ decision: 'NOT_PROBED' }, 1_000, 0)).toBe('DISCOVERING');
    expect(resolveOemDiscoveryState(
      { decision: 'NOT_PROBED' }, OEM_DISCOVERY_WINDOW_MS + 1, 0,
    )).toBe('UNKNOWN');
  });

  it('kanıtı SUPPORTED / UNSUPPORTED / ERROR terminal durumlarına taşır', () => {
    expect(resolveOemDiscoveryState({ decision: 'HAS_REAL_VALUE' }, 0, null)).toBe('SUPPORTED');
    expect(resolveOemDiscoveryState({ decision: 'ALL_UNSUPPORTED' }, 0, null)).toBe('UNSUPPORTED');
    expect(resolveOemDiscoveryState({ decision: 'COMM_FAILING' }, 0, null)).toBe('ERROR');
  });
});

describe('ECU erişimi ile DTC alt-servis kapsamı ayrımı', () => {
  it('canlı PID keşfinde yanıt veren ECU, kısmi DTC taramasında bütünüyle okunamadı sayılmaz', () => {
    const result = {
      ecu: {
        rxHeader: '18DAF110', txHeader: '18DA10F1', addressBits: 29,
        role: 'unknown', roleEvidence: 'none', label: 'ECU 10 (29-bit)',
        discoverySource: 'functional_0100', probeOutcome: 'responded',
        txProvenance: 'can_29bit_standard',
      },
      stored: 'failed', pending: 'failed', permanent: 'failed',
      uds: null, udsSupported: null, kwp: null, kwp13: null,
      codes: [], authorityCodes: [],
    } satisfies EcuScanResult;

    expect(isEcuReachable(result)).toBe(true);
    expect(isEcuReadable(result)).toBe(false);
    expect(isEcuDtcScanPartial(result)).toBe(true);
    expect(classifyEcuCoverageStatus(result)).toBe('probed');
  });
});
