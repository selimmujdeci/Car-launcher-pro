/**
 * #668 KİLİTLERİ — LAB kopyasından çıkan iki gürültü kusuru.
 *
 * Kaynak: kullanıcının cihazdan aldığı CAROS LAB tam kopyası (2026-08-20).
 *  1. Kanıt özeti ham çift duyarlıklı sayı basıyordu
 *     (`trip_distance=0.11309596145554154km`).
 *  2. Araç açılışında ağ hazır olmadığı için düşen iki fail-soft çağrı,
 *     hata defterine KIRMIZI `error` olarak yazılıyordu.
 *
 * Bu kilitler ZAYIFLATILMAZ; davranış bilinçli değişirse kilit GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatEvidenceValue } from '../platform/aiCore/evidenceStore';
import { isNetworkAbsenceError } from '../platform/crashLogger';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('#668 · kanıt özeti okunur, ham değer korunur', () => {
  it('KİLİT: mesafe 17 haneli basılmaz', () => {
    expect(formatEvidenceValue(0.11309596145554154, 'km')).toBe('0.11');
  });

  it('KİLİT: birime göre hassasiyet', () => {
    expect(formatEvidenceValue(11.4, 'km/h')).toBe('11');
    expect(formatEvidenceValue(63.2, '°C')).toBe('63');
    expect(formatEvidenceValue(1649.7, 'rpm')).toBe('1650');
    expect(formatEvidenceValue(12.94, 'V')).toBe('12.9');
  });

  it('KİLİT: gereksiz sıfır eklenmez (0.10 değil 0.1)', () => {
    expect(formatEvidenceValue(0.1, 'km')).toBe('0.1');
    expect(formatEvidenceValue(5, 'km')).toBe('5');
  });

  it('KİLİT: sayı olmayan değer olduğu gibi kalır', () => {
    expect(formatEvidenceValue('kapalı' as unknown as string, '')).toBe('kapalı');
    expect(formatEvidenceValue(true as unknown as boolean, '')).toBe('true');
    expect(formatEvidenceValue(Number.NaN, 'km')).toBe('NaN');
  });

  it('KİLİT: kırpma YALNIZ özet metnindedir — ham değer zarfta kalır', () => {
    /* Kanıtın kendisi `sig.value`yu taşır; kısaltılan insan-okur satırdır.
       Bu kilit, birinin "sadeleştirme" adına ham değeri yuvarlamasını önler. */
    const src = read('src/platform/aiCore/evidenceStore.ts');
    expect(src).toContain('formatEvidenceValue(sig.value, sig.unit)');
    expect(src).toMatch(/ham değer[\s\S]{0,80}AYNEN kalır/i);
  });
});

describe('#668 · ağ yokluğu hata defterini kirletmez', () => {
  it('KİLİT: ağ yokluğu imzaları tanınır', () => {
    expect(isNetworkAbsenceError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkAbsenceError(new Error('NetworkError when attempting to fetch'))).toBe(true);
    expect(isNetworkAbsenceError(new Error('The operation was aborted'))).toBe(true);
    expect(isNetworkAbsenceError('net::ERR_INTERNET_DISCONNECTED')).toBe(true);
  });

  it('KİLİT: GERÇEK hata ağ sayılmaz — sessizleştirme yok', () => {
    expect(isNetworkAbsenceError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isNetworkAbsenceError(new RangeError('Maximum call stack size exceeded'))).toBe(false);
    expect(isNetworkAbsenceError(new Error('PGRST205 table not found'))).toBe(false);
    expect(isNetworkAbsenceError(null)).toBe(false);
  });

  it('KİLİT: açılışta düşen iki fail-soft çağrı ağ-farkında loglar', () => {
    /* Saha: `weatherService:fetchFuel` ve `geofenceService:_loadAndPushZones`
       araç açılışında `Failed to fetch` ile düşüp defterde KIRMIZI duruyordu. */
    expect(read('src/platform/weatherService.ts')).toContain('logNetworkAware');
    expect(read('src/platform/security/geofenceService.ts')).toContain('logNetworkAware');
  });

  it('KİLİT: kayıt BASTIRILMAZ — yalnız seviye düşer', () => {
    /* Olay defterde kalmalı; "ağ yoktu" bilgisi de bir gözlemdir. */
    const src = read('src/platform/crashLogger.ts');
    expect(src).toContain("isNetworkAbsenceError(error) ? 'warning' : 'error'");
    expect(src).toMatch(/kayd[ıi] BASTIRMAZ|Olay yine defterdedir/i);
  });
});
