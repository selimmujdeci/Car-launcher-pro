/**
 * aiCoreDiagnosticEvidence.test.ts — AI Core Faz-2.5 · tanı kanıtı zenginleştirme (SAF).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. 8 evidence tipi (DTC/freeze/handshake/transport+health/source-health/capability/recovery/memory).
 *  2. "0 ≠ no-data": lastPacketAgeMs -1 = ölçülmedi (freshness kanıtı üretmez).
 *  3. Eksik/eski AÇIKÇA: bayat DTC → düşük güven; DTC var+freeze yok → "yakalanmadı"; handshake not_run → işaret.
 *  4. Bounded/dedup: DTC ≤10, memory ≤8; anahtarlar kararlı.
 *  5. obdDeepToSections zengin obdDeep'i verdict için sarar.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveDiagnosticEvidence, obdDeepToSections, type DiagObdDeepLike, type DiagnosticEvidenceInput,
} from '../platform/aiCore/runtime/diagnosticEvidence';

function keys(input: DiagnosticEvidenceInput): string[] {
  return deriveDiagnosticEvidence(input, 5000).map((e) => e.key);
}

describe('deriveDiagnosticEvidence — DTC', () => {
  it('current DTC → dtc.<code>; bayat okuma → düşük güven', () => {
    const od: DiagObdDeepLike = { dtc: { count: 1, isStale: true, codes: [{ code: 'P0128', severity: 'critical', system: 'engine' }] } };
    const ev = deriveDiagnosticEvidence({ obdDeep: od }, 5000);
    const dtc = ev.find((e) => e.key === 'dtc.P0128')!;
    expect(dtc.kind).toBe('dtc');
    expect(dtc.confidence).toBeLessThanOrEqual(0.5);   // bayat → düşük
    expect(dtc.summary).toMatch(/bayat/);
  });
  it('DTC okuma hatası → dtc.read_error (açık eksik kanıt)', () => {
    expect(keys({ obdDeep: { dtc: { count: 0, error: 'timeout' } } })).toContain('dtc.read_error');
  });
  it('DTC bounded ≤10', () => {
    const codes = Array.from({ length: 20 }, (_, i) => ({ code: `P${1000 + i}`, severity: 'warning' }));
    const ev = deriveDiagnosticEvidence({ obdDeep: { dtc: { count: 20, codes } } }, 5000);
    expect(ev.filter((e) => e.key.startsWith('dtc.P')).length).toBe(10);
  });
});

describe('deriveDiagnosticEvidence — freeze-frame (canlı sorgu YOK)', () => {
  it('cache freeze → evidence', () => {
    expect(keys({ obdDeep: { dtc: { count: 1, codes: [{ code: 'P0128' }] } }, freezeFrame: { dtcCode: 'P0128', valueCount: 7 } }))
      .toContain('freeze.frame');
  });
  it('DTC var + freeze cache yok → "yakalanmadı" açıkça işaretli', () => {
    expect(keys({ obdDeep: { dtc: { count: 1, codes: [{ code: 'P0128' }] } }, freezeFrame: null }))
      .toContain('freeze.missing');
  });
  it('DTC yok → freeze kanıtı üretilmez', () => {
    expect(keys({ obdDeep: { dtc: { count: 0, codes: [] } } })).not.toContain('freeze.missing');
  });
});

describe('deriveDiagnosticEvidence — handshake/protocol', () => {
  it('not_run → açık eksik işaret', () => {
    expect(keys({ obdDeep: { handshake: { outcome: 'not_run' } } })).toContain('handshake.not_run');
  });
  it('protokol uyuşmazlığı (tried ama active yok)', () => {
    const k = keys({ obdDeep: { handshake: { outcome: 'fail', protocolTried: 'ISO15765', protocolActive: null, failReason: 'timeout' } } });
    expect(k).toContain('handshake.outcome');
    expect(k).toContain('handshake.protocol_mismatch');
  });
});

describe('deriveDiagnosticEvidence — transport + "0≠no-data"', () => {
  it('lastPacketAgeMs -1 (ölçülmedi) → freshness kanıtı YOK', () => {
    expect(keys({ obdDeep: { health: { connectionQuality: 80, lastPacketAgeMs: -1, isStale: false } } }))
      .not.toContain('transport.freshness');
  });
  it('isStale → freshness kanıtı (bağlı ama donuk)', () => {
    const ev = deriveDiagnosticEvidence({ obdDeep: { health: { connectionQuality: 60, lastPacketAgeMs: 8000, isStale: true } } }, 5000);
    expect(ev.find((e) => e.key === 'transport.freshness')!.summary).toMatch(/donuk|bayat/);
  });
  it('düşük kalite + reconnect baskısı', () => {
    const k = keys({ obdDeep: { health: { connectionQuality: 30, reconnectPressure: 2.5, lastPacketAgeMs: 100 } } });
    expect(k).toContain('transport.quality');
    expect(k).toContain('transport.reconnect_pressure');
  });
});

describe('deriveDiagnosticEvidence — source health / capability / recovery / memory', () => {
  it('source health: null=ölçülmedi kanıt yok, stale=işaretli', () => {
    const k = keys({ sourceHealth: { can: { stale: true }, obd: { stale: false }, gps: null } });
    expect(k).toContain('source_health.can');
    expect(k).toContain('source_health.obd');
    expect(k).not.toContain('source_health.gps');       // null → ölçülmedi
  });
  it('capability: unavailable PID → bilinen sınır', () => {
    const ev = deriveDiagnosticEvidence({ obdDeep: { extended: { unavailable: ['0105', '010C'] } } }, 5000);
    const c = ev.find((e) => e.key === 'capability.unavailable_pids')!;
    expect(c.kind).toBe('capability');
    expect(c.summary).toMatch(/bilinen sınır/);
  });
  it('recovery: KWP + reconnect geçmişi', () => {
    const k = keys({ obdDeep: {
      kwpRecoveryEvidence: { status: 'RECOVERED', recoveryCount: 3, maxCoreNoDataStreak: 5 },
      handshake: { outcome: 'ok', reconnectHistory: [{ reason: 'timeout' }, { reason: 'broken_pipe' }] },
      connLifecycle: { resetCount: 1, disconnectCount: 2 },
    } });
    expect(k).toContain('recovery.kwp');
    expect(k).toContain('recovery.reconnect_history');
    expect(k).toContain('recovery.lifecycle');
  });
  it('memory bilinen sınır → memory.<key> (bounded ≤8)', () => {
    const limits = Array.from({ length: 12 }, (_, i) => ({ key: `lim_${i}`, statement: `sınır ${i}`, confidence: 0.7 }));
    const ev = deriveDiagnosticEvidence({ memoryLimits: limits }, 5000);
    expect(ev.filter((e) => e.kind === 'memory').length).toBe(8);
    expect(ev.find((e) => e.kind === 'memory')!.summary).toMatch(/bilinen araç sınırı/i);
  });
  it('boş girdi → boş (sahte kanıt yok)', () => {
    expect(deriveDiagnosticEvidence({}, 5000)).toEqual([]);
  });
});

describe('obdDeepToSections', () => {
  it('zengin obdDeep verdict sections\'a sarılır', () => {
    const od: DiagObdDeepLike = { dtc: { count: 1, codes: [{ code: 'P0300', severity: 'critical' }] } };
    const sections = obdDeepToSections(od);
    expect(sections.obdDeep).toBeDefined();
    expect(sections.obdDeep!.dtc!.count).toBe(1);
  });
  it('null → boş sections', () => {
    expect(obdDeepToSections(null)).toEqual({});
  });
});
