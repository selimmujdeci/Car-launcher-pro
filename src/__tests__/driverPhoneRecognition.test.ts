/**
 * driverPhoneRecognition.test — sürücüyü telefonundan tanıma.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const speed = vi.hoisted(() => ({ obd: null as number | null }));
vi.mock('../platform/obdService', async (orig) => ({
  ...(await orig<object>()), getObdSpeedFresh: () => speed.obd,
}));

import { useStore, type DriverProfile } from '../store/useStore';
import {
  decidePhoneSwitch, handleBtChange, seedConnectedDevices, getConnectedBtDevices, _resetPhoneRecognitionForTest,
} from '../platform/driverPhoneRecognition';
import { linkDriverPhone, unlinkDriverPhone } from '../platform/driverProfileService';

const drv = (id: string, address?: string): DriverProfile => ({
  id, name: id, color: '#fff', createdAt: 'x', lastUsedAt: null, prefs: {},
  ...(address ? { phone: { address, name: `${id} tel` } } : {}),
});
const A = 'AA:AA:AA:AA:AA:01', B = 'BB:BB:BB:BB:BB:02', OBD = '00:1D:A5:00:00:09';

describe('decidePhoneSwitch (saf)', () => {
  const drivers = [drv('ayse', A), drv('mehmet', B), drv('misafir')];
  const base = { drivers, activeId: 'mehmet', connected: new Set<string>(), moving: false };

  it('tanınan telefon → o sürücüye geç', () => {
    expect(decidePhoneSwitch({ ...base, candidates: [A.toLowerCase()] })).toEqual({ action: 'switch', driverId: 'ayse' });
  });
  it('🔒 tanınmayan cihaz (OBD adaptörü) hiçbir şey yapmaz', () => {
    expect(decidePhoneSwitch({ ...base, candidates: [OBD] })).toEqual({ action: 'none', reason: 'UNKNOWN_DEVICE' });
  });
  it('🔒 etkin sürücünün telefonu bağlıyken sonradan binen profili ezmez', () => {
    expect(decidePhoneSwitch({ ...base, connected: new Set([B, A]), candidates: [A] }).action).toBe('none');
  });
  it('🔒 araç hareket hâlindeyken geçiş ertelenir', () => {
    expect(decidePhoneSwitch({ ...base, candidates: [A], moving: true }))
      .toEqual({ action: 'deferred', driverId: 'ayse', reason: 'MOVING' });
  });
  it('🔒 açılışta iki farklı sürücünün telefonu bağlıysa tahmin edilmez', () => {
    expect(decidePhoneSwitch({ ...base, activeId: null, candidates: [A, B] }))
      .toEqual({ action: 'none', reason: 'AMBIGUOUS' });
  });
});

describe('çalışma zamanı', () => {
  const set = (p: Parameters<ReturnType<typeof useStore.getState>['updateSettings']>[0]) =>
    useStore.getState().updateSettings(p);
  beforeEach(() => {
    _resetPhoneRecognitionForTest();
    speed.obd = null;
    set({ driverProfiles: [drv('ayse', A), drv('mehmet')], activeDriverProfileId: 'mehmet' });
  });

  it('telefon bağlanınca profil kendiliğinden gelir', () => {
    handleBtChange({ connected: true, deviceName: 'Ayşe iPhone', deviceAddress: A.toLowerCase() });
    expect(useStore.getState().settings.activeDriverProfileId).toBe('ayse');
    expect(getConnectedBtDevices().map((d) => d.address)).toEqual([A]);
    handleBtChange({ connected: false, deviceName: '', deviceAddress: A });
    expect(getConnectedBtDevices()).toHaveLength(0);
  });
  it('🔒 hareket hâlinde profil değişmez', () => {
    speed.obd = 60;
    handleBtChange({ connected: true, deviceName: 'Ayşe iPhone', deviceAddress: A });
    expect(useStore.getState().settings.activeDriverProfileId).toBe('mehmet');
  });
  it('🔒 adres gelmeyen eski plugin olayı yok sayılır', () => {
    handleBtChange({ connected: true, deviceName: 'Ayşe iPhone' });
    expect(useStore.getState().settings.activeDriverProfileId).toBe('mehmet');
  });
  it('açılışta zaten bağlı telefon tanınır', () => {
    seedConnectedDevices([{ address: A, name: 'Ayşe iPhone' }]);
    expect(useStore.getState().settings.activeDriverProfileId).toBe('ayse');
  });
  it('🔒 bir telefon tek sürücüye bağlıdır; kaldırılınca tanınmaz', () => {
    linkDriverPhone('mehmet', { address: A.toLowerCase(), name: 'Ortak tel' });
    const list = useStore.getState().settings.driverProfiles;
    expect(list.find((d) => d.id === 'ayse')?.phone).toBeUndefined();
    expect(list.find((d) => d.id === 'mehmet')?.phone?.address).toBe(A);
    unlinkDriverPhone('mehmet');
    expect(useStore.getState().settings.driverProfiles.every((d) => !d.phone)).toBe(true);
  });
});
