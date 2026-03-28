/**
 * sunTimes.test.ts — NOAA güneş zamanı ve parlaklık eğrisi testleri.
 *
 * Test kapsamı:
 *  - İstanbul için yaz/kış güneş doğuşu / batışı makul aralıkta mı?
 *  - calcBrightness: gece = min, öğle = max, lineer geçiş
 *  - calcPhase: sabah/öğleden sonra/akşam doğru tespit ediliyor mu?
 *  - Kutup gündüzü / gecesi degenerate case
 */

import { describe, it, expect } from 'vitest';
import { calcSunTimes, calcBrightness, calcPhase } from '../platform/autoBrightnessService';

const ISTANBUL_LAT = 41.01;
const ISTANBUL_LNG = 28.98;

// Yaz gündönümü — İstanbul
const SUMMER = new Date('2024-06-21');
// Kış gündönümü
const WINTER = new Date('2024-12-21');

describe('calcSunTimes — İstanbul', () => {
  it('yaz gündönümü: gün doğuşu 300-350 dakika arası (05:00-05:50)', () => {
    const t = calcSunTimes(ISTANBUL_LAT, ISTANBUL_LNG, SUMMER);
    expect(t.sunrise).toBeGreaterThan(295);
    expect(t.sunrise).toBeLessThan(360);
  });

  it('yaz gündönümü: gün batımı 1230-1290 dakika arası (20:30-21:30)', () => {
    const t = calcSunTimes(ISTANBUL_LAT, ISTANBUL_LNG, SUMMER);
    expect(t.sunset).toBeGreaterThan(1220);
    expect(t.sunset).toBeLessThan(1310);
  });

  it('kış gündönümü: gün doğuşu 480-530 dakika arası (08:00-08:50)', () => {
    const t = calcSunTimes(ISTANBUL_LAT, ISTANBUL_LNG, WINTER);
    expect(t.sunrise).toBeGreaterThan(470);
    expect(t.sunrise).toBeLessThan(540);
  });

  it('kış gündönümü: gün batımı 990-1050 dakika arası (16:30-17:30)', () => {
    const t = calcSunTimes(ISTANBUL_LAT, ISTANBUL_LNG, WINTER);
    expect(t.sunset).toBeGreaterThan(980);
    expect(t.sunset).toBeLessThan(1060);
  });

  it('solar_noon gün doğuşu ile batışı arasında', () => {
    const t = calcSunTimes(ISTANBUL_LAT, ISTANBUL_LNG, SUMMER);
    expect(t.solar_noon).toBeGreaterThan(t.sunrise);
    expect(t.solar_noon).toBeLessThan(t.sunset);
  });
});

describe('calcSunTimes — kutup degenerates', () => {
  it('kutup gündüzü: sunrise=0, sunset=1440', () => {
    // Yaz gündönümü, Kuzey Kutup Dairesi yakını (~70°K)
    const t = calcSunTimes(70, 25, SUMMER);
    expect(t.sunrise).toBeLessThanOrEqual(60);   // ~0 veya erken
    expect(t.sunset).toBeGreaterThanOrEqual(1380); // ~1440 veya geç
  });
});

describe('calcBrightness', () => {
  const times = calcSunTimes(ISTANBUL_LAT, ISTANBUL_LNG, SUMMER);
  const MIN = 15;
  const MAX = 100;

  it('gece minimum parlaklık döner', () => {
    // Gece yarısı (dakika 0)
    const b = calcBrightness(times, 0, MIN, MAX);
    expect(b).toBe(MIN);
  });

  it('öğle zirve parlaklık döner', () => {
    const b = calcBrightness(times, times.solar_noon, MIN, MAX);
    expect(b).toBe(MAX);
  });

  it('sabah parlaklığı gece-max arası lineer', () => {
    const midMorning = Math.round((times.sunrise + times.solar_noon) / 2);
    const b = calcBrightness(times, midMorning, MIN, MAX);
    expect(b).toBeGreaterThan(MIN);
    expect(b).toBeLessThan(MAX);
    // Yaklaşık olarak ortada (~%50 artış)
    const expected = Math.round(MIN + (MAX - MIN) * 0.5);
    expect(Math.abs(b - expected)).toBeLessThanOrEqual(5);
  });

  it('öğleden sonra parlaklık azalır', () => {
    const midAfternoon = Math.round((times.solar_noon + times.sunset) / 2);
    const b = calcBrightness(times, midAfternoon, MIN, MAX);
    expect(b).toBeGreaterThan(MIN);
    expect(b).toBeLessThan(MAX);
  });

  it('custom min/max sınırlarına uyar', () => {
    const b = calcBrightness(times, times.solar_noon, 30, 80);
    expect(b).toBe(80);
    const bNight = calcBrightness(times, 0, 30, 80);
    expect(bNight).toBe(30);
  });
});

describe('calcPhase', () => {
  const times = calcSunTimes(ISTANBUL_LAT, ISTANBUL_LNG, SUMMER);

  it('gece yarısı → night', () => {
    expect(calcPhase(times, 0)).toBe('night');
  });

  it('gün doğuşu öncesi 15 dk → dawn', () => {
    expect(calcPhase(times, times.sunrise - 15)).toBe('dawn');
  });

  it('gün doğuşu sonrası → morning', () => {
    expect(calcPhase(times, times.sunrise + 30)).toBe('morning');
  });

  it('öğleden sonra → afternoon', () => {
    const midAfternoon = Math.round((times.solar_noon + times.sunset) / 2) - 15;
    expect(calcPhase(times, midAfternoon)).toBe('afternoon');
  });

  it('gün batımı öncesi → dusk', () => {
    expect(calcPhase(times, times.sunset - 15)).toBe('dusk');
  });

  it('gün batımı sonrası → evening', () => {
    expect(calcPhase(times, times.sunset + 15)).toBe('evening');
  });
});
