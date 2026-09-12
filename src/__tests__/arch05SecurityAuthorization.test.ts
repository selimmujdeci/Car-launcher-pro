import { describe, expect, it } from 'vitest';
import { authorize, canExecute, type AuthorizationInput, type Principal } from '../platform/security/authorization';

const phone: Principal = { principalType: 'PHONE_DEVICE', principalIdRef: 'phone:masked', deviceIdentityRef: 'device:masked', personIdentityRef: 'person:masked', vehicleRef: 'vehicle:A', sessionRef: 'session:1', generation: 7, authenticationState: 'AUTHENTICATED', provenance: 'LIVE' };
const input = (overrides: Partial<AuthorizationInput> = {}): AuthorizationInput => ({ principal: phone, capability: 'PHONE_CONTROL', targetRef: 'phone', vehicleRef: 'vehicle:A', attached: true, currentGeneration: 7, grantedCapabilities: ['PHONE_CONTROL'], motion: 'PARKED', nativePermission: true, available: true, ...overrides });

describe('ARCH-05 canonical authorization', () => {
  it('separates device identity, person identity, role-less principal and capability', () => expect(authorize(input()).decision).toBe('ALLOW'));
  it.each([
    ['unauthenticated', { principal: { ...phone, authenticationState: 'NOT_AUTHENTICATED' as const } }, 'NOT_AUTHENTICATED'],
    ['unattached', { attached: false }, 'NOT_ATTACHED'],
    ['missing grant', { grantedCapabilities: [] }, 'CAPABILITY_NOT_GRANTED'],
    ['stale phone generation', { currentGeneration: 8 }, 'STALE'],
    ['cross vehicle', { capability: 'VEHICLE_READ', grantedCapabilities: ['VEHICLE_READ'], vehicleRef: 'vehicle:B' }, 'DENY'],
    ['replay', { principal: { ...phone, provenance: 'REPLAY' as const } }, 'DENY'],
    ['imported', { principal: { ...phone, provenance: 'IMPORTED' as const } }, 'DENY'],
    ['lab', { principal: { ...phone, principalType: 'LAB' as const, provenance: 'LAB' as const } }, 'DENY'],
    ['native permission is not a grant', { capability: 'DIAGNOSTIC_READ', grantedCapabilities: [] }, 'CAPABILITY_NOT_GRANTED'],
    ['diagnostic privileged defaults denied', { capability: 'DIAGNOSTIC_PRIVILEGED', grantedCapabilities: [] }, 'CAPABILITY_NOT_GRANTED'],
    ['motion unknown blocks destructive', { capability: 'CLEAR_DTC', attached: true, grantedCapabilities: ['CLEAR_DTC'], motion: 'UNKNOWN' }, 'MOTION_RESTRICTED'],
    ['unknown principal', { principal: { ...phone, principalType: 'UNKNOWN' as const } }, 'DENY'],
    ['unknown capability', { capability: 'UNKNOWN', grantedCapabilities: ['UNKNOWN'] }, 'DENY'],
  ])('%s fails closed', (_name, patch, decision) => expect(authorize(input(patch)).decision).toBe(decision));
  it('allows only an explicitly granted low-risk phone capability', () => expect(authorize(input({ capability: 'MEDIA_CONTROL', grantedCapabilities: ['MEDIA_CONTROL'], nativePermission: null })).decision).toBe('ALLOW'));
  it('rechecks session and vehicle at execution time', () => {
    const evidence = authorize(input({ capability: 'DIAGNOSTIC_READ', grantedCapabilities: ['DIAGNOSTIC_READ'] }));
    expect(canExecute(evidence, { principal: phone, vehicleRef: 'vehicle:A', currentGeneration: 7 })).toBe(true);
    expect(canExecute(evidence, { principal: phone, vehicleRef: 'vehicle:B', currentGeneration: 7 })).toBe(false);
    expect(canExecute(evidence, { principal: phone, vehicleRef: 'vehicle:A', currentGeneration: 8 })).toBe(false);
  });
  it('does not expose raw identity fields in evidence', () => {
    const e = authorize(input());
    expect(Object.keys(e)).not.toContain('deviceIdentityRef');
    expect(Object.keys(e)).not.toContain('personIdentityRef');
  });
});
