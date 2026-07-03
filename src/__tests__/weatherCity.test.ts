/**
 * weatherCity.test.ts — REGRESYON KİLİDİ (SAHA 2026-07-04)
 *
 * "İstanbul için hava durumu" deyince asistan bulunduğu yerin (Tarsus) havasını
 * veriyordu. Kök: hava sorgusu şehir adı içerse bile YEREL (GPS) hava kestirmesine
 * düşüyordu. weatherQueryNamesCity belirli şehir adını sezer → çağıran web aramasına
 * yönlendirir. Bu ayrımı ZAYIFLATMA (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import { weatherQueryNamesCity } from '../platform/weatherService';

describe('weatherQueryNamesCity — şehir adlı hava sorgusu tespiti', () => {
  it('BELİRLİ ŞEHİR → true (web aramasına gitmeli)', () => {
    expect(weatherQueryNamesCity('İstanbul için hava durumu')).toBe(true);
    expect(weatherQueryNamesCity('Ankara\'da hava nasıl')).toBe(true);
    expect(weatherQueryNamesCity('izmir hava durumu ne')).toBe(true);
    expect(weatherQueryNamesCity('Trabzon yarın yağmur var mı')).toBe(true);
  });

  it('GENEL/YEREL sorgu → false (yerel GPS havası doğru)', () => {
    expect(weatherQueryNamesCity('hava nasıl')).toBe(false);
    expect(weatherQueryNamesCity('hava durumu nasıl olacak')).toBe(false);
    expect(weatherQueryNamesCity('bugün hava nasıl')).toBe(false);
    expect(weatherQueryNamesCity('dışarısı kaç derece')).toBe(false);
    expect(weatherQueryNamesCity('yarın yağmur var mı')).toBe(false);
  });
});
