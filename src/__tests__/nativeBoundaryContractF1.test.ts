import { describe, expect, it } from 'vitest';
import { assessNativeBoundaryConformance, getNativeCapabilityDescriptors } from '../platform/native/nativeBoundaryContract';

describe('ARCH-04/F1 native boundary contract', () => {
  it('is data-only and keeps bridges separate from domain owners', () => {
    const all = getNativeCapabilityDescriptors();
    expect(all.find((x) => x.id === 'gps.location')).toMatchObject({ owner: 'gpsService→VDL', operationClass: 'OBSERVATION_STREAM', hotStream: true });
    expect(all.find((x) => x.id === 'obd.diagnostic_pdu')).toMatchObject({ owner: 'DiagnosticTransaction', bridge: 'CarLauncher.sendDiagnosticPdu' });
    expect(all.find((x) => x.id === 'media.playback')?.owner).not.toContain('Plugin');
  });
  it('does not make permission or bridge availability into readiness truth', () => {
    const gps = getNativeCapabilityDescriptors().find((x) => x.id === 'gps.location')!;
    expect(assessNativeBoundaryConformance(gps)).toMatchObject({ staleGuard: true, authorityBypass: false, status: 'PASS' });
  });
});
