/**
 * livingThemeState.test.ts — Living Theme System · saf türetme testleri (Commit 1)
 *
 * Kapsam: araç eşikleri + öncelik, animasyon seviyesi (tier/runtime/reduced-motion),
 * companion eşlemesi, tod eşlemesi ve "saf fonksiyon / DOM yazmaz" sözleşmesi.
 */
import { describe, it, expect } from 'vitest';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import {
  deriveLivingThemeState,
  deriveTimeOfDay,
  deriveVehicleStatus,
  deriveCompanionStatus,
  deriveAnimationLevel,
  deriveConnectionStatus,
  type LivingThemeInputs,
  FUEL_LOW_PCT,
  ENGINE_TEMP_HIGH_C,
} from '../platform/livingThemeState';

/** Nötr "her şey yolunda" temel girdi — testler tek ekseni değiştirir. */
function baseInputs(): LivingThemeInputs {
  return {
    dayNightMode:         'day',
    hour:                 12,
    obdConnected:         true,
    fuelLevel:            60,
    engineTemp:           80,
    online:               true,
    voiceStatus:          'idle',
    tier:                 'high',
    runtimeMode:          RuntimeMode.PERFORMANCE,
    prefersReducedMotion: false,
  };
}

describe('deriveVehicleStatus — eşikler ve öncelik', () => {
  it('yakıt <= 12 → fuel-low', () => {
    expect(deriveVehicleStatus(true, 12, 80)).toBe('fuel-low');
    expect(deriveVehicleStatus(true, 5, 80)).toBe('fuel-low');
    expect(deriveVehicleStatus(true, 13, 80)).toBe('normal'); // sınırın üstü
  });

  it('motor sıcaklığı >= 105 → temp-high', () => {
    expect(deriveVehicleStatus(true, 60, 105)).toBe('temp-high');
    expect(deriveVehicleStatus(true, 60, 130)).toBe('temp-high');
    expect(deriveVehicleStatus(true, 60, 104)).toBe('normal'); // sınırın altı
  });

  it('OBD bağlı değil veya stale → obd-offline', () => {
    expect(deriveVehicleStatus(false, 60, 80)).toBe('obd-offline');
    // OBD yokken düşük yakıt/yüksek ısı bile obd-offline'ı ezemez (geçerli veri yok)
    expect(deriveVehicleStatus(false, 5, 130)).toBe('obd-offline');
  });

  it('öncelik: temp-high > fuel-low > obd-offline > normal', () => {
    // Hem ısı yüksek hem yakıt düşük → temp-high kazanır
    expect(deriveVehicleStatus(true, 5, 130)).toBe('temp-high');
    // Yalnız yakıt düşük → fuel-low
    expect(deriveVehicleStatus(true, 5, 80)).toBe('fuel-low');
    // Bağlı + sorun yok → normal
    expect(deriveVehicleStatus(true, 60, 80)).toBe('normal');
  });

  it('geçersiz (< 0 / NaN) yakıt veya ısı uyarı tetiklemez', () => {
    expect(deriveVehicleStatus(true, -1, 80)).toBe('normal');     // yakıt bilinmiyor
    expect(deriveVehicleStatus(true, 60, -1)).toBe('normal');     // ısı bilinmiyor
    expect(deriveVehicleStatus(true, NaN, NaN)).toBe('normal');
  });

  it('eşik sabitleri sözleşmeye uyar', () => {
    expect(FUEL_LOW_PCT).toBe(12);
    expect(ENGINE_TEMP_HIGH_C).toBe(105);
  });
});

describe('deriveAnimationLevel — tier / runtime / reduced-motion', () => {
  it('tier=low (Mali-400/K24) → static (runtime modundan bağımsız)', () => {
    expect(deriveAnimationLevel('low', RuntimeMode.PERFORMANCE, false)).toBe('static');
    expect(deriveAnimationLevel('low', RuntimeMode.BALANCED, false)).toBe('static');
  });

  it('SAFE_MODE → static (enableAnimations=false)', () => {
    expect(deriveAnimationLevel('high', RuntimeMode.SAFE_MODE, false)).toBe('static');
  });

  it('BASIC_JS → static (runtime config kanıtı: enableAnimations=false)', () => {
    // tier high olsa BİLE BASIC_JS animasyonu kapatır → static
    expect(deriveAnimationLevel('high', RuntimeMode.BASIC_JS, false)).toBe('static');
    expect(deriveAnimationLevel('mid', RuntimeMode.BASIC_JS, false)).toBe('static');
  });

  it('POWER_SAVE → static (enableAnimations=false)', () => {
    expect(deriveAnimationLevel('high', RuntimeMode.POWER_SAVE, false)).toBe('static');
  });

  it('prefers-reduced-motion → reduced (animasyonlu modda)', () => {
    expect(deriveAnimationLevel('high', RuntimeMode.PERFORMANCE, true)).toBe('reduced');
    expect(deriveAnimationLevel('mid', RuntimeMode.BALANCED, true)).toBe('reduced');
  });

  it('high/mid + BALANCED/PERFORMANCE + reduced-motion yok → full', () => {
    expect(deriveAnimationLevel('high', RuntimeMode.PERFORMANCE, false)).toBe('full');
    expect(deriveAnimationLevel('mid', RuntimeMode.BALANCED, false)).toBe('full');
  });

  it('öncelik: tier=low, reduced-motion=true olsa bile static (low her şeyi ezer)', () => {
    expect(deriveAnimationLevel('low', RuntimeMode.PERFORMANCE, true)).toBe('static');
  });
});

describe('deriveCompanionStatus — voice → companion eşlemesi', () => {
  it('listening / processing aynen geçer', () => {
    expect(deriveCompanionStatus('listening')).toBe('listening');
    expect(deriveCompanionStatus('processing')).toBe('processing');
  });
  it('success → speaking (cevap TTS)', () => {
    expect(deriveCompanionStatus('success')).toBe('speaking');
  });
  it('idle / error / throttled / bilinmeyen → idle', () => {
    expect(deriveCompanionStatus('idle')).toBe('idle');
    expect(deriveCompanionStatus('error')).toBe('idle');
    expect(deriveCompanionStatus('throttled')).toBe('idle');
    expect(deriveCompanionStatus('whatever')).toBe('idle');
  });
});

describe('deriveTimeOfDay — gün/gece + saat bandı', () => {
  it('dayNightMode=night → night (saat ne olursa olsun)', () => {
    expect(deriveTimeOfDay('night', 12)).toBe('night');
    expect(deriveTimeOfDay('night', 8)).toBe('night');
  });
  it('gündüz: sabah 07–09, akşam 17–19, arası gündüz', () => {
    expect(deriveTimeOfDay('day', 7)).toBe('morning');
    expect(deriveTimeOfDay('day', 8)).toBe('morning');
    expect(deriveTimeOfDay('day', 9)).toBe('day');
    expect(deriveTimeOfDay('day', 12)).toBe('day');
    expect(deriveTimeOfDay('day', 16)).toBe('day');
    expect(deriveTimeOfDay('day', 17)).toBe('evening');
    expect(deriveTimeOfDay('day', 18)).toBe('evening');
  });
});

describe('deriveConnectionStatus', () => {
  it('online/offline eşlemesi', () => {
    expect(deriveConnectionStatus(true)).toBe('online');
    expect(deriveConnectionStatus(false)).toBe('offline');
  });
});

describe('deriveLivingThemeState — birleşik + saf sözleşme', () => {
  it('nötr girdi → tüm eksenler beklenen', () => {
    expect(deriveLivingThemeState(baseInputs())).toEqual({
      tod:   'day',
      veh:   'normal',
      conn:  'online',
      comp:  'idle',
      level: 'full',
    });
  });

  it('gerçekçi K24 senaryosu: low tier + gece + yakıt düşük + offline + dinliyor', () => {
    expect(deriveLivingThemeState({
      ...baseInputs(),
      dayNightMode: 'night',
      tier:         'low',
      runtimeMode:  RuntimeMode.BASIC_JS,
      fuelLevel:    8,
      online:       false,
      voiceStatus:  'listening',
    })).toEqual({
      tod:   'night',
      veh:   'fuel-low',
      conn:  'offline',
      comp:  'listening',
      level: 'static',
    });
  });

  it('saf: aynı girdi → aynı çıktı (deterministik)', () => {
    const i = baseInputs();
    expect(deriveLivingThemeState(i)).toEqual(deriveLivingThemeState(i));
  });

  it('sözleşme: türetme DOM yazmaz (documentElement değişmez)', () => {
    const root = document.documentElement;
    const beforeClass = root.className;
    const beforeAttrs = root.getAttributeNames().sort().join(',');
    deriveLivingThemeState(baseInputs());
    deriveLivingThemeState({ ...baseInputs(), tier: 'low', voiceStatus: 'processing' });
    expect(root.className).toBe(beforeClass);
    expect(root.getAttributeNames().sort().join(',')).toBe(beforeAttrs);
  });

  it('sözleşme: girdi objesi mutasyona uğramaz', () => {
    const i = baseInputs();
    const copy = JSON.parse(JSON.stringify(i));
    deriveLivingThemeState(i);
    expect(i).toEqual(copy);
  });
});
