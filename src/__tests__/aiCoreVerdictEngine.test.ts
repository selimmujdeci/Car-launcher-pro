/**
 * aiCoreVerdictEngine.test.ts — AI Core Faz-1 · Verdict Engine (deterministik, offline).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Mevcut Diagnostics V2 kök-neden motorunu SARAR (ikinci motor yok).
 *  2. Aciliyet severity + confidence + kritik DTC'den türer (sabit değil).
 *  3. Aktif kök-neden yok → confidence 0, aciliyet 'none'/'watch'.
 *  4. Kritik DTC aciliyeti en az 'urgent'e yükseltir.
 */
import { describe, it, expect } from 'vitest';
import { buildAiCoreVerdict } from '../platform/aiCore/verdictEngine';
import type { TriageSections } from '../platform/diagnosticTriage';

describe('buildAiCoreVerdict', () => {
  it('kritik yüksek-güven kök-neden → aciliyet critical', () => {
    // Sık reconnect + düşük kalite → TRANSPORT_RECONNECT critical (korelasyonlu, yüksek güven).
    const s: TriageSections = {
      transport: { reconnectAttempts: 6 },
      obdDeep: { health: { connectionQuality: 30 } },
    };
    const v = buildAiCoreVerdict(s);
    expect(v.hasActiveRootCause).toBe(true);
    expect(v.confidence).toBeGreaterThanOrEqual(70);
    expect(v.urgency).toBe('critical');
    expect(v.topRootCauses[0].code).toBe('TRANSPORT_RECONNECT');
  });

  it('uyarı severity → aciliyet soon/watch', () => {
    const s: TriageSections = { transport: { reconnectAttempts: 4 } }; // warning (kalite yok)
    const v = buildAiCoreVerdict(s);
    expect(v.topRootCauses[0].severity).toBe('warning');
    expect(['soon', 'watch']).toContain(v.urgency);
  });

  it('kritik DTC aciliyeti en az urgent yapar', () => {
    const s: TriageSections = {
      obdDeep: { dtc: { count: 1, codes: [{ code: 'P0300', severity: 'critical' }] } },
    };
    const v = buildAiCoreVerdict(s);
    expect(['urgent', 'critical']).toContain(v.urgency);
  });

  it('aktif kök-neden yok + OBD kopuk → belirsiz, aciliyet watch, güven 0', () => {
    const v = buildAiCoreVerdict({ obdDeep: { adapter: { source: 'none' } } });
    expect(v.hasActiveRootCause).toBe(false);
    expect(v.confidence).toBe(0);
    expect(v.urgency).toBe('watch');
    expect(v.inconclusive.some((n) => n.code === 'OBD_DISCONNECTED_NO_VERIFY')).toBe(true);
  });

  it('boş bölüm → aciliyet none, güven 0', () => {
    const v = buildAiCoreVerdict({});
    expect(v.urgency).toBe('none');
    expect(v.confidence).toBe(0);
    expect(v.hasActiveRootCause).toBe(false);
  });
});
