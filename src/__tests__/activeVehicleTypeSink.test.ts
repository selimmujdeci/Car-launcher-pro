/**
 * Store → obdService statik import'u kaldırıldı (91 dosyalık import döngüsü);
 * aktif profil araç tipi obd/activeVehicleTypeSink üzerinden akar.
 * Davranış kilidi: profil seçimi OBD vehicleType'ını hâlâ günceller.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store/useStore';
import { getOBDDataSnapshot } from '../platform/obdService';

describe('aktif profil araç tipi köprüsü', () => {
  beforeEach(() => {
    useStore.getState().resetSettings();
  });

  it('profil seçimi OBD vehicleType\'ını günceller', () => {
    const store = useStore.getState();
    store.addVehicleProfile({
      id: 'p-ev', name: 'Test EV', vehicleType: 'ev',
      createdAt: '2020-01-01T00:00:00.000Z', lastUsedAt: null,
    });
    store.setActiveVehicleProfile('p-ev');
    expect(getOBDDataSnapshot().vehicleType).toBe('ev');

    store.addVehicleProfile({
      id: 'p-diesel', name: 'Test Dizel', vehicleType: 'diesel',
      createdAt: '2020-01-01T00:00:00.000Z', lastUsedAt: null,
    });
    store.setActiveVehicleProfile('p-diesel');
    expect(getOBDDataSnapshot().vehicleType).toBe('diesel');
  });

  it('tipsiz profil ve null seçim OBD tipine dokunmaz', () => {
    const store = useStore.getState();
    store.addVehicleProfile({
      id: 'p-hybrid', name: 'Test Hibrit', vehicleType: 'hybrid',
      createdAt: '2020-01-01T00:00:00.000Z', lastUsedAt: null,
    });
    store.setActiveVehicleProfile('p-hybrid');
    store.addVehicleProfile({ id: 'p-bare', name: 'Tipsiz', createdAt: '2020-01-01T00:00:00.000Z', lastUsedAt: null });
    store.setActiveVehicleProfile('p-bare');
    store.setActiveVehicleProfile(null);
    expect(getOBDDataSnapshot().vehicleType).toBe('hybrid');
  });

  it('store obdService\'i statik import etmez', () => {
    const src = readFileSync(join(__dirname, '../store/useStore.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/platform\/obdService'/);
  });
});
