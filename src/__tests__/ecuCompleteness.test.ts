import { describe, expect, it } from 'vitest';
import { buildEcuCompleteness, ecuCoverageKey, type EcuCoverageCandidate } from '../platform/obd/ecuCompleteness';

function ecu(rx: string, bits: 11 | 29 = 11, extra: Partial<EcuCoverageCandidate> = {}): EcuCoverageCandidate {
  const tx = bits === 11 ? (parseInt(rx, 16) - 8).toString(16).toUpperCase() : `18DA${rx.slice(-2)}F1`;
  return { rxHeader: rx, txHeader: tx, addressBits: bits, role: rx === '7E8' ? 'engine' : 'unknown',
    roleEvidence: rx === '7E8' ? 'standard' : 'none', label: rx, ...extra };
}
function build(candidates: EcuCoverageCandidate[], more: Partial<Parameters<typeof buildEcuCompleteness>[0]> = {}) {
  return buildEcuCompleteness({ candidates, protocol: '6', sessionEpoch: 4, currentSessionEpoch: 4,
    expectedEcuCount: null, ...more });
}

describe('P0-OBD-CORE-04 ECU completeness', () => {
  it('tek ECU keşfini yüzde uydurmadan probed tutar', () => {
    const r = build([ecu('7E8')]); expect(r.probed).toBe(1); expect(r.completenessLabel).toBe('UNKNOWN');
  });
  it('çoklu 11-bit ECU header/rol kanıtını korur', () => {
    const r = build([ecu('7E8'), ecu('7E9')]); expect(r.discovered).toBe(2);
    expect(r.evidence[1]?.role).toBe('unknown'); expect(r.evidence[1]?.roleEvidence).toBe('none');
  });
  it('8 üstü ECU keşfini kesmez', () => {
    const rows = Array.from({ length: 10 }, (_, n) => ecu(`18DAF1${n.toString(16).padStart(2, '0').toUpperCase()}`, 29));
    expect(build(rows).discovered).toBe(10);
  });
  it('29-bit kimliği 11-bit kimliğiyle karıştırmaz', () => {
    const r = build([ecu('7E8'), ecu('18DAF108', 29)]); expect(new Set(r.evidence.map((e) => e.ecuKey)).size).toBe(2);
  });
  it('fonksiyonel probe yanıtlamayan ama başka kaynaktan bilinen ECUyu yok saymaz', () => {
    const r = build([ecu('7EA', 11, { discoverySource: 'gateway_inventory', probeOutcome: 'no_response' })]);
    expect(r.discovered).toBe(1); expect(r.evidence[0]?.probeOutcome).toBe('no_response');
  });
  it('failed probe ayrı durumdur', () => {
    const e = ecu('7EA', 11, { discoverySource: 'physical_probe', probeOutcome: 'failed' });
    expect(build([e]).evidence[0]?.status).toBe('failed');
  });
  it('duplicate ECU keşif kaynaklarını tek kimlikte birleştirir', () => {
    const r = build([ecu('7E8'), ecu('7e8', 11, { discoverySource: 'physical_probe' })]);
    expect(r.discovered).toBe(1); expect(r.evidence[0]?.discoverySources).toEqual(['functional_0100', 'physical_probe']);
  });
  it('gateway arkasında adreslenemeyen bilinen ECUyu açıkça işaretler', () => {
    const e = ecu('7EB', 11, { discoverySource: 'gateway_inventory', probeOutcome: 'no_response' });
    expect(build([e], { notAddressableKeys: new Set([ecuCoverageKey(e)]) }).notAddressable).toBe(1);
  });
  it('reconnect sonrası eski epoch kanıtını scanned saymaz', () => {
    const e = ecu('7E8'); const key = ecuCoverageKey(e);
    const r = build([e], { scannedKeys: new Set([key]), currentSessionEpoch: 5 });
    expect(r.staleSession).toBe(true); expect(r.scanned).toBe(0); expect(r.skipped).toBe(1);
  });
  it('gerçek payda verilirse yalnız o zaman yüzde hesaplar', () => {
    const e = ecu('7E8'); const r = build([e], { scannedKeys: new Set([ecuCoverageKey(e)]), expectedEcuCount: 2 });
    expect(r.completenessPercent).toBe(50); expect(r.denominatorKnown).toBe(true);
  });
});
