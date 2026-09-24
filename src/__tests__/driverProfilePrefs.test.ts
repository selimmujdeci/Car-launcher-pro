/**
 * driverProfilePrefs.test — sürücü hafızası GERÇEKTEN uygulanır.
 *
 * 2026-09-24: "Koltuk, iklim, müzik ve sürüş" deniyordu; iklim (21 °C) ve mod
 * (Konfor) sabit yazılıyor, hiçbir yerde uygulanmıyordu, koltuk hiç yoktu.
 * Artık profil uygulamanın uygulayabildiği tercihleri taşır: tema, ses,
 * parlaklık, müzik — seçilince hepsi değişir (sistem ses/parlaklık dahil).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sys = vi.hoisted(() => ({ setVolume: vi.fn(), setBrightness: vi.fn() }));
vi.mock('../platform/systemSettingsService', async (orig) => ({
  ...(await orig<object>()),
  setVolume: sys.setVolume,
  setBrightness: sys.setBrightness,
}));

import { useStore } from '../store/useStore';
import { useCarTheme } from '../store/useCarTheme';
import { forceApplyVehicleProfile, captureDriverPreferences } from '../platform/vehicleProfileService';

beforeEach(() => {
  sys.setVolume.mockClear();
  sys.setBrightness.mockClear();
});

describe('sürücü hafızası', () => {
  it('🔒 profil seçilince tema + ses + parlaklık + müzik uygulanır (sistem dahil)', () => {
    useCarTheme.getState().setTheme('expedition');
    useStore.getState().updateSettings({ volume: 20, brightness: 30, defaultMusic: 'spotify' });
    useStore.getState().addVehicleProfile({
      id: 'drv-1', name: 'Ayşe', createdAt: new Date(0).toISOString(), lastUsedAt: null,
      volume: 65, brightness: 80, carTheme: 'tesla', defaultMusic: 'youtube',
    } as never);

    forceApplyVehicleProfile('drv-1');

    const s = useStore.getState().settings;
    expect(s.activeVehicleProfileId).toBe('drv-1');
    expect(s.volume).toBe(65);
    expect(s.brightness).toBe(80);
    expect(s.defaultMusic).toBe('youtube');
    expect(useCarTheme.getState().theme).toBe('tesla');
    expect(sys.setVolume).toHaveBeenCalledWith(65);
    expect(sys.setBrightness).toHaveBeenCalledWith(80);
  });

  it('🔒 kaydedilmemiş tercih UYGULANMAZ (sahte 0 ses/parlaklık yok)', () => {
    useStore.getState().updateSettings({ volume: 42, brightness: 55 });
    useStore.getState().addVehicleProfile({
      id: 'drv-2', name: 'Eski', createdAt: new Date(0).toISOString(), lastUsedAt: null,
      driveMode: 'comfort', climateTempC: 21,
    } as never);
    forceApplyVehicleProfile('drv-2');
    expect(useStore.getState().settings.volume).toBe(42);
    expect(useStore.getState().settings.brightness).toBe(55);
    expect(sys.setVolume).not.toHaveBeenCalled();
    expect(sys.setBrightness).not.toHaveBeenCalled();
  });

  it('şimdiki ayarlar yakalanır (yeni profil / "Şimdikini kaydet")', () => {
    useCarTheme.getState().setTheme('horizon');
    useStore.getState().updateSettings({ volume: 33, brightness: 71 });
    expect(captureDriverPreferences()).toMatchObject({ volume: 33, brightness: 71, carTheme: 'horizon' });
  });
});
