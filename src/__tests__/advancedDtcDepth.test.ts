import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetAdvancedDtcEvidenceForTest, getAdvancedDtcEvidence, normalizeAdvancedOutcome,
  parseSnapshotIdentification, parseStatusAvailability, recordAdvancedDtcEvidence,
} from '../platform/obd/advancedDtcEvidence';
import { validateUdsDtcResponse } from '../platform/obd/udsDtc';
import { validateKwpDtcResponse } from '../platform/obd/kwpDtc';
import { isKwpDtcAddressable } from '../platform/obd/multiEcuScan';

describe('P1-OBD-02 advanced DTC depth', () => {
  beforeEach(_resetAdvancedDtcEvidenceForTest);
  it('0x19-01 status availability ve count çözer', () =>
    expect(parseStatusAvailability('FF010002')).toEqual({ valid: true, availabilityMask: 'FF', formatIdentifier: '01', count: 2 }));
  it('bozuk availability malformed kalır', () => expect(parseStatusAvailability('FF01').valid).toBe(false));
  it('snapshot identification referanslarını korur', () =>
    expect(parseSnapshotIdentification('010203040A0B0C05').references).toEqual(['010203:04', '0A0B0C:05']));
  it('yarım snapshot malformed olur', () => expect(parseSnapshotIdentification('010203').valid).toBe(false));
  it('0x19-02 boş geçerli liste ile malformed ayrılır', () => {
    expect(validateUdsDtcResponse('FF').valid).toBe(true);
    expect(validateUdsDtcResponse('FF0102').valid).toBe(false);
  });
  it('KWP declared count uyuşmazlığı malformed olur', () => {
    expect(validateKwpDtcResponse('01123409').valid).toBe(true);
    expect(validateKwpDtcResponse('02123409').valid).toBe(false);
  });
  it('NRC unsupported/security/condition ayrımını korur', () => {
    expect(normalizeAdvancedOutcome('negative_nrc', 0x31)).toBe('unsupported');
    expect(normalizeAdvancedOutcome('negative_nrc', 0x33)).toBe('security_required');
    expect(normalizeAdvancedOutcome('negative_nrc', 0x22)).toBe('condition_required');
  });
  it('no_response timeout malformed birbirine dönüşmez', () => {
    expect(normalizeAdvancedOutcome('no_response', null)).toBe('no_response');
    expect(normalizeAdvancedOutcome('timeout', null)).toBe('timeout');
    expect(normalizeAdvancedOutcome('malformed', null)).toBe('malformed');
  });
  it('KWP hedef/session kanıtı yoksa 0x18 adreslenebilir sayılmaz', () => {
    const base = { rxHeader: '10F1', txHeader: '8110F1', addressBits: 11 as const,
      role: 'unknown' as const, roleEvidence: 'none' as const, label: 'KWP ECU' };
    expect(isKwpDtcAddressable(base, '5')).toBe(false);
    expect(isKwpDtcAddressable({ ...base, kwpTargetVerified: true }, '5')).toBe(true);
    expect(isKwpDtcAddressable({ ...base, kwpTargetVerified: true }, '6')).toBe(false);
  });
  it('session epoch değişince eski LAB kanıtını düşürür', () => {
    const base = { atMs: 1, service: '19' as const, subFunction: '02', tx: '7E0', rx: '7E8', protocol: '6',
      outcome: 'ok' as const, nrc: null, raw: 'FF', dtcs: [], statusBytes: [], statusAvailabilityMask: 'FF',
      snapshotReferences: [], extendedDataReferences: [], error: null };
    recordAdvancedDtcEvidence({ ...base, sessionEpoch: 1 });
    recordAdvancedDtcEvidence({ ...base, sessionEpoch: 2 });
    expect(getAdvancedDtcEvidence()).toHaveLength(1);
    expect(getAdvancedDtcEvidence()[0]?.sessionEpoch).toBe(2);
  });
  it('LAB target bilinmiyorsa 0x18 NOT_SENT ve gerekçeyi gösterir', async () => {
    const { buildKwpSections } = await import('../platform/devtools/kwpMonitorModel');
    const fields = buildKwpSections({ readAt: 1_700_000_000_000, protocolActive: '5', protocolTried: '5',
      protocolClass: 'kwp', slowSerial: true, transportConnected: true, connectionState: 'connected',
      dataFresh: true, lastRxAt: null, freshWindowMs: null, pollingActive: true, recovery: null,
      dtc: { lastScanAtMs: 1_700_000_000_000, protocolAtScan: '5', attempted: false,
        channelAvailable: true, okCount: 0, unsupportedCount: 0, failedCount: 0, codeCount: 0,
        functional03Raw: '43000000000000', functional07Raw: '47000000000000',
        targetProvenance: 'UNKNOWN', gateOutcome: 'NOT_SENT',
        notSentReason: 'KWP target/session kanıtı yok', foundDtcs: [],
        publishedToCanonicalAuthority: false } }).find((s) => s.id === 'dtc')!.fields;
    expect(fields.find((f) => f.id === 'functional03Raw')?.value).toBe('43000000000000');
    expect(fields.find((f) => f.id === 'kwp18Tx')?.klass).toBe('UNAVAILABLE');
    expect(fields.find((f) => f.id === 'kwpGate')?.value).toBe('NOT_SENT');
    expect(fields.find((f) => f.id === 'kwpNotSentReason')?.value).toMatch(/target\/session/);
  });
  it('LAB gönderilmiş 0x18 TX/RX, P0089 ve authority yayınını ayrı gösterir', async () => {
    const { buildKwpSections } = await import('../platform/devtools/kwpMonitorModel');
    const fields = buildKwpSections({ readAt: 1_700_000_000_000, protocolActive: '5', protocolTried: '5',
      protocolClass: 'kwp', slowSerial: true, transportConnected: true, connectionState: 'connected',
      dataFresh: true, lastRxAt: null, freshWindowMs: null, pollingActive: true, recovery: null,
      dtc: { lastScanAtMs: 1_700_000_000_000, protocolAtScan: '5', attempted: true,
        channelAvailable: true, okCount: 1, unsupportedCount: 0, failedCount: 0, codeCount: 1,
        physicalTarget: '10', targetProvenance: 'ecuDiscovery.kwpTargetVerified',
        request18Tx: '1800FF00', response18Raw: '01008920', gateOutcome: 'SENT',
        foundDtcs: ['P0089'], publishedToCanonicalAuthority: true } }).find((s) => s.id === 'dtc')!.fields;
    expect(fields.find((f) => f.id === 'kwp18Tx')?.value).toBe('1800FF00');
    expect(fields.find((f) => f.id === 'kwp18RawRx')?.value).toBe('01008920');
    expect(fields.find((f) => f.id === 'kwpFoundDtcs')?.value).toBe('P0089');
    expect(fields.find((f) => f.id === 'kwpAuthorityPublish')?.value).toBe('true');
  });
});
