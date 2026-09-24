/**
 * driverProfiles.test — sürücü profilleri araç profillerinden AYRI ve GERÇEK.
 *
 * 2026-09-24 (kullanıcı: "ayır ve gerçek tam profesyonel sürücü profili"):
 * sürücüler `vehicleProfiles` listesini paylaşıyordu (Araç sekmesinde görünüyordu),
 * "iklim/koltuk" hiç uygulanmıyordu. Artık ayrı liste + otomatik hafıza.
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
import {
  addDriver, switchDriver, removeDriver, clearActiveDriver,
  startDriverProfileSync, stopDriverProfileSync, _flushDriverSyncForTest,
} from '../platform/driverProfileService';
import { getQuickAddress, setQuickAddress, clearQuickAddress } from '../platform/addressBookService';

const set = (p: Parameters<ReturnType<typeof useStore.getState>['updateSettings']>[0]) =>
  useStore.getState().updateSettings(p);
const drivers = () => useStore.getState().settings.driverProfiles;

beforeEach(() => {
  stopDriverProfileSync();
  sys.setVolume.mockClear();
  sys.setBrightness.mockClear();
  set({ driverProfiles: [], activeDriverProfileId: null, vehicleProfiles: [], activeVehicleProfileId: null });
  useCarTheme.getState().setTheme('expedition');
  clearQuickAddress('home');
  clearQuickAddress('work');
});

describe('ayrı liste', () => {
  it('🔒 sürücü eklemek araç listesine DOKUNMAZ', () => {
    addDriver('Ayşe');
    expect(drivers()).toHaveLength(1);
    expect(useStore.getState().settings.vehicleProfiles).toHaveLength(0);
  });

  it('🔒 v17 geçişi: Profiller sekmesinin eski kayıtları (prof-) sürücü listesine taşınır', () => {
    const migrate = useStore.persist.getOptions().migrate!;
    const out = migrate({ settings: {
      vehicleProfiles: [
        { id: 'vp-1', name: 'Clio', vehicleType: 'ice', createdAt: 'x', lastUsedAt: null },
        { id: 'prof-1', name: 'Ayşe', defaultMusic: 'spotify', driveMode: 'comfort', climateTempC: 21, createdAt: 'y', lastUsedAt: null },
      ],
      activeVehicleProfileId: 'prof-1',
    } }, 16) as { settings: ReturnType<typeof useStore.getState>['settings'] };
    expect(out.settings.vehicleProfiles.map((p) => p.id)).toEqual(['vp-1']);
    expect(out.settings.driverProfiles.map((d) => d.name)).toEqual(['Ayşe']);
    expect(out.settings.driverProfiles[0].prefs).toEqual({ defaultMusic: 'spotify' });  // iklim/mod TAŞINMAZ
    expect(out.settings.activeDriverProfileId).toBe('prof-1');
    expect(out.settings.activeVehicleProfileId).toBe('vp-1');
  });
});

describe('sürücü değiştirme', () => {
  it('🔒 geçişte tema + ses + parlaklık + müzik + asistan uygulanır (sistem dahil)', () => {
    set({ volume: 20, brightness: 30, defaultMusic: 'spotify', companionUserCallsign: 'Selim' });
    const a = addDriver('Selim')!;
    clearActiveDriver();             // misafir: sonraki değişiklikler Selim'e YAZILMAZ
    set({ volume: 70, brightness: 90, defaultMusic: 'youtube', companionUserCallsign: 'Ayşe Hanım' });
    useCarTheme.getState().setTheme('tesla');
    const b = addDriver('Ayşe')!;    // şimdiki ayarlarla başlar

    switchDriver(a.id);
    const s = useStore.getState().settings;
    expect(s.activeDriverProfileId).toBe(a.id);
    expect(s.volume).toBe(20);
    expect(s.brightness).toBe(30);
    expect(s.defaultMusic).toBe('spotify');
    expect(s.companionUserCallsign).toBe('Selim');
    expect(useCarTheme.getState().theme).toBe('expedition');
    expect(sys.setVolume).toHaveBeenLastCalledWith(20);
    expect(sys.setBrightness).toHaveBeenLastCalledWith(30);

    switchDriver(b.id);
    expect(useStore.getState().settings.volume).toBe(70);
    expect(useCarTheme.getState().theme).toBe('tesla');
  });

  it('🔒 geçişte ÇIKAN sürücünün son hâli onun profiline yazılır', () => {
    const a = addDriver('Selim')!;
    set({ volume: 44 });                 // a etkinken değişti (senkron kapalı olsa bile)
    const b = addDriver('Ayşe')!;        // a kaydedilir
    set({ volume: 80 });
    switchDriver(a.id);
    expect(useStore.getState().settings.volume).toBe(44);
    switchDriver(b.id);
    expect(useStore.getState().settings.volume).toBe(80);
  });

  it('🔒 Ev/İş adresi sürücüye özeldir', () => {
    setQuickAddress('home', { latitude: 36.9, longitude: 34.9, name: 'Selim evi' });
    const a = addDriver('Selim')!;
    clearActiveDriver();
    clearQuickAddress('home');
    const b = addDriver('Ayşe')!;
    switchDriver(a.id);
    expect(getQuickAddress('home')?.name).toBe('Selim evi');
    switchDriver(b.id);
    expect(getQuickAddress('home')).toBeNull();
  });

  it('🔒 kaydedilmemiş tercih UYGULANMAZ (sahte varsayılan yok)', () => {
    set({ volume: 55, driverProfiles: [{ id: 'd-old', name: 'Eski', color: '#fff', createdAt: 'x', lastUsedAt: null, prefs: {} }] });
    switchDriver('d-old');
    expect(useStore.getState().settings.volume).toBe(55);
    expect(sys.setVolume).not.toHaveBeenCalled();
  });
});

describe('otomatik hafıza', () => {
  it('🔒 etkin sürücüde yapılan değişiklik profiline kendiliğinden kaydedilir', () => {
    const a = addDriver('Selim')!;
    startDriverProfileSync();
    set({ brightness: 12, alertToneStyle: 'soft' });
    _flushDriverSyncForTest();
    const saved = drivers().find((d) => d.id === a.id)!.prefs;
    expect(saved.brightness).toBe(12);
    expect(saved.alertToneStyle).toBe('soft');
  });

  it('🔒 misafir modda değişiklik HİÇBİR profile yazılmaz', () => {
    const a = addDriver('Selim')!;
    const before = drivers().find((d) => d.id === a.id)!.prefs.volume;
    clearActiveDriver();
    startDriverProfileSync();
    set({ volume: 99 });
    _flushDriverSyncForTest();
    expect(drivers().find((d) => d.id === a.id)!.prefs.volume).toBe(before);
  });

  it('silinen etkin sürücü misafir moda düşer', () => {
    const a = addDriver('Selim')!;
    removeDriver(a.id);
    expect(drivers()).toHaveLength(0);
    expect(useStore.getState().settings.activeDriverProfileId).toBeNull();
  });
});
