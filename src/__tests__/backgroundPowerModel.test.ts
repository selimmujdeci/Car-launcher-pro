/**
 * backgroundPowerModel — arka plan güç politikası karar testleri.
 *
 * Kilitlenen davranış (saha ölçümü 2026-08-20, Redmi Note 13 Pro 5G):
 * uygulama arka plandayken ve pille çalışırken GPS kısılır + pasif mikrofon
 * susar; navigasyon sürerken veya harici güç varken HİÇBİR ŞEY kısılmaz
 * (head unit davranışı korunur).
 */
import { describe, it, expect } from 'vitest';
import {
  decideBackgroundPower,
  isSameDecision,
  BACKGROUND_GPS_INTERVAL_MS,
  type BackgroundPowerInputs,
} from '../platform/power/backgroundPowerModel';

/** Varsayılan: ön planda, navigasyon yok, pille, wake açık. */
function inputs(patch: Partial<BackgroundPowerInputs> = {}): BackgroundPowerInputs {
  return {
    appActive:        true,
    navigationActive: false,
    externalPower:    false,
    wakeWordEnabled:  true,
    ...patch,
  };
}

describe('backgroundPowerModel — kısma YOK dalları', () => {
  it('ön planda tam güç', () => {
    const d = decideBackgroundPower(inputs());
    expect(d).toEqual({ gps: 'high', mic: 'on', reason: 'foreground' });
  });

  it('navigasyon sürerken arka planda + pille bile kısma yok', () => {
    const d = decideBackgroundPower(inputs({
      appActive: false, externalPower: false, navigationActive: true,
    }));
    expect(d.gps).toBe('high');
    expect(d.mic).toBe('on');
    expect(d.reason).toBe('navigation_active');
  });

  it('harici güç (head unit / şarj) varken arka planda kısma yok', () => {
    const d = decideBackgroundPower(inputs({ appActive: false, externalPower: true }));
    expect(d).toEqual({ gps: 'high', mic: 'on', reason: 'external_power' });
  });

  it('appActive okunamadıysa (null) ön plan varsayılır — davranış değişmez', () => {
    const d = decideBackgroundPower(inputs({ appActive: null, externalPower: false }));
    expect(d.gps).toBe('high');
    expect(d.reason).toBe('foreground');
  });
});

describe('backgroundPowerModel — kısma VAR dalları', () => {
  it('arka plan + pil → GPS kısık, mikrofon kapalı', () => {
    const d = decideBackgroundPower(inputs({ appActive: false, externalPower: false }));
    expect(d).toEqual({ gps: 'low', mic: 'off', reason: 'background_battery' });
  });

  it('güç kaynağı bilinmiyorsa GPS kısılır ama mikrofona DOKUNULMAZ', () => {
    const d = decideBackgroundPower(inputs({ appActive: false, externalPower: null }));
    expect(d.gps).toBe('low');
    expect(d.mic).toBe('on');                     // kanıtsız susturma yok
    expect(d.reason).toBe('background_power_unknown');
  });
});

describe('backgroundPowerModel — mikrofon ayarı otoritesi', () => {
  it('wake ayarı kapalıysa model mikrofonu ASLA açtırmaz', () => {
    for (const patch of [
      { appActive: true },
      { appActive: false, externalPower: true },
      { appActive: false, navigationActive: true },
      { appActive: false, externalPower: null },
    ] as Array<Partial<BackgroundPowerInputs>>) {
      const d = decideBackgroundPower(inputs({ ...patch, wakeWordEnabled: false }));
      expect(d.mic).toBe('off');
    }
  });
});

describe('backgroundPowerModel — yardımcılar', () => {
  it('isSameDecision yalnız uygulanabilir farkı görür (gerekçe farkı sayılmaz)', () => {
    const a = decideBackgroundPower(inputs({ appActive: true }));
    const b = decideBackgroundPower(inputs({ appActive: false, externalPower: true }));
    expect(a.reason).not.toBe(b.reason);
    expect(isSameDecision(a, b)).toBe(true);       // ikisi de high/on → donanım thrash'i yok
  });

  it('ilk karar (önceki null) her zaman uygulanır', () => {
    expect(isSameDecision(null, decideBackgroundPower(inputs()))).toBe(false);
  });

  it('kısık mod aralığı GNSS uyandırmayacak kadar uzundur', () => {
    expect(BACKGROUND_GPS_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
  });
});
