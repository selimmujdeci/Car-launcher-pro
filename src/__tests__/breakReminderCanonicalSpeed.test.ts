/**
 * Mola hatırlatıcı — kanonik hız beslemesi.
 * Eskiden yalnız Eğlence Portalı açıkken ham `obd.speed` (OBD yokken 0) ile
 * besleniyordu: sürüşte sayaç hiç ilerlemiyor, bilinmeyen hız "durdu" sayılıyordu.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  enableBreakReminder, disableBreakReminder, getBreakReminderState, updateBreakReminder,
} from '../platform/breakReminderService';

const setSpeed = (speed: number | null) => useUnifiedVehicleStore.setState({ speed });

beforeEach(() => { disableBreakReminder(); setSpeed(null); });
afterEach(() => { disableBreakReminder(); setSpeed(null); });

describe('breakReminderService — kanonik hız', () => {
  it('etkinken store hızını kendisi dinler (portal açık olmasa da)', () => {
    enableBreakReminder(60);
    expect(getBreakReminderState().drivingStartedAt).toBeNull();
    setSpeed(42);
    expect(getBreakReminderState().drivingStartedAt).not.toBeNull();
  });

  it('bilinmeyen hız (null) "durdu" sayılmaz; sayaç korunur', () => {
    enableBreakReminder(60);
    setSpeed(50);
    const started = getBreakReminderState().drivingStartedAt;
    setSpeed(null);
    updateBreakReminder(null);
    expect(getBreakReminderState().drivingStartedAt).toBe(started);
  });

  it('devre dışıyken abone değildir', () => {
    enableBreakReminder(60);
    disableBreakReminder();
    setSpeed(80);
    expect(getBreakReminderState().drivingStartedAt).toBeNull();
    expect(getBreakReminderState().enabled).toBe(false);
  });
});

describe('ham obd.speed tüketicileri kaldırıldı', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');   // açıklama yorumları hariç

  it('Eğlence Portalı kanonik hızı okur; bilinmeyen hız park sayılmaz', () => {
    const src = read('components/entertainment/EntertainmentPortal.tsx');
    expect(src).not.toMatch(/obd\.speed/);
    expect(src).toContain('useDisplaySpeed()');
    expect(src).toContain('const isParked = speed !== null');
  });

  it('SecuritySuite ikinci geofence yazarı değildir (tek besleyici gpsService)', () => {
    expect(read('components/security/SecuritySuite.tsx')).not.toMatch(/checkGeofence\(/);
    expect(read('platform/gpsService.ts')).toMatch(/checkGeofence\(/);
  });
});
