/**
 * inconclusiveEngine.test.ts — Diagnostics V2 · PR-4 ("Eksik Kanıt" motoru).
 *
 * KİLİTLENEN SÖZLEŞME (2026-07-14 saha gerçeği): motor bir subsystem'i arıza/yoksun
 * görüp karar-kanıtı yoksa SUSMAZ — neyin doğrulanamadığını + hangi ham kanıtın
 * eksik olduğunu söyler. Sahte belirsizlik ÜRETİLMEZ (koşul yoksa not yok).
 */
import { describe, it, expect } from 'vitest';
import { buildRootCauseSnapshot, type TriageSections } from '../platform/diagnosticTriage';

describe('INCONCLUSIVE motoru — PR-4', () => {
  it('OBD bağlı değil → DTC/VIN/Freeze/Extended doğrulanamaz beyanı', () => {
    const s: TriageSections = {
      obdDeep: { adapter: { source: 'none', connectionState: 'error', lastSeenMs: 0 } },
    };
    const rc = buildRootCauseSnapshot(s);
    const obd = rc.inconclusive.find((n) => n.code === 'OBD_DISCONNECTED_NO_VERIFY');
    expect(obd).toBeDefined();
    expect(obd!.subsystem).toBe('OBD');
    expect(obd!.blockedConclusions.join(' ')).toMatch(/DTC/);
    expect(obd!.blockedConclusions.join(' ')).toMatch(/VIN/);
    expect(obd!.missingEvidence.length).toBeGreaterThan(0);
  });

  it('OBD bağlı → OBD sonuçsuzluk beyanı YOK (sahte belirsizlik üretilmez)', () => {
    const s: TriageSections = {
      obdDeep: { adapter: { source: 'ble', connectionState: 'connected', lastSeenMs: 1765000000000 } },
    };
    const rc = buildRootCauseSnapshot(s);
    expect(rc.inconclusive.find((n) => n.subsystem === 'OBD')).toBeUndefined();
  });

  it('GPS izni yok → konum-tabanlı sonuçlar doğrulanamaz beyanı', () => {
    const rc = buildRootCauseSnapshot({ gps: { permission: 'denied' } });
    const gps = rc.inconclusive.find((n) => n.code === 'GPS_DENIED_NO_VERIFY');
    expect(gps).toBeDefined();
    expect(gps!.missingEvidence).toContain('gps.permission=granted');
  });

  it('boş kesit → inconclusive boş', () => {
    expect(buildRootCauseSnapshot({}).inconclusive).toEqual([]);
  });

  it('hipotezler + inconclusive AYNI ANDA üretilebilir (bağımsız geçiş)', () => {
    const s: TriageSections = {
      transport: { reconnectAttempts: 4 },
      obdDeep: { adapter: { source: 'none' }, health: { connectionQuality: 41 } },
    };
    const rc = buildRootCauseSnapshot(s);
    expect(rc.hypotheses.some((h) => h.code === 'TRANSPORT_RECONNECT')).toBe(true);
    expect(rc.inconclusive.some((n) => n.code === 'OBD_DISCONNECTED_NO_VERIFY')).toBe(true);
  });
});
