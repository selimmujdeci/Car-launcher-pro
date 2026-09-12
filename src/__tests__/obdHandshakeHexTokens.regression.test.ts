/**
 * REGRESYON — _hexTokens compact-hex desteği (gerçek araç blocker'ı).
 *
 * KÖK NEDEN: ELM327 init'i `ATS0` (boşluk kapat) gönderdiği için gerçek adaptörler
 * yanıtı BİTİŞİK hex döner ("4100983B001100"). Eski `_hexTokens` yalnız TAM-2-karakter
 * (boşlukla ayrılmış) token kabul ediyordu → bitişik akış tek uzun token → filtrelenip
 * atılıyordu → `buildHandshakeResult` BOŞ üretiyordu → PID 2F oto-aktive olmuyordu →
 * yakıt göstergesi boş. Unit testler yalnız boşluklu fixture kullandığı için yakalanmadı.
 *
 * Bu dosya HEM boşluklu HEM bitişik biçimi kilitler; fixture olarak GERÇEK ARAÇ ham'ı
 * (docs-local/device-runs/20260713T200929-pr88-handshake-validation/RAW_HANDSHAKE.json)
 * kullanılır. Parser dışında hiçbir davranış değişmedi.
 */
import { describe, it, expect } from 'vitest';
import {
  parseVIN,
  parseSupportedPIDs,
  buildHandshakeResult,
  classifyHandshakeResponse,
  type RawHandshake,
} from '../core/val/OBDHandshake';

// ── Gerçek araçtan yakalanan HAM (ATS0, boşluksuz) — RAW_HANDSHAKE.json ──────────
const REAL_RAW: RawHandshake = {
  raw09:   '0140:4902012020201:202020202020202:20202020202020',
  raw0100: '4100983B001100',
  raw0120: '4120A012200100',
  raw0140: '414080C0000000',
  raw0160: '',
  raw0180: '',
  raw01A0: '',
};
/** Bitişik hex'i boşluklu (ATS1) biçime çevirir — parite karşılaştırması için. */
const spaced = (s: string): string => (s.match(/.{1,2}/g) ?? []).join(' ');

const asSet = (arr: number[]) => new Set(arr);

describe('_hexTokens — compact + spaced parite (parser blocker fix)', () => {
  it('bitişik hex (ATS0) ile boşluklu hex (ATS1) AYNI PID setini üretir', () => {
    const compact = parseSupportedPIDs('4100983B001100');
    const spacedSet = parseSupportedPIDs('41 00 98 3B 00 11 00');
    expect([...compact].sort((a, b) => a - b)).toEqual([...spacedSet].sort((a, b) => a - b));
    expect(compact.size).toBeGreaterThan(0);
  });

  it('boşluklu format BOZULMADI (mevcut davranış korunur)', () => {
    // 41 00 98 3B → PID 1,4,5 (0x98) · 0x0B,0x0C,0x0D,0x0F,0x10 (0x3B)
    const s = parseSupportedPIDs('41 00 98 3B 00 11');
    expect(s.has(0x0C)).toBe(true); // RPM
    expect(s.has(0x05)).toBe(true); // Coolant
    expect(s.has(0x20)).toBe(true); // continuation
  });

  it('lowercase bitişik hex → uppercase ile aynı', () => {
    expect([...parseSupportedPIDs('4100983b001100')].sort((a, b) => a - b))
      .toEqual([...parseSupportedPIDs('4100983B001100')].sort((a, b) => a - b));
  });

  it('karışık boşluk (tab / çoklu boşluk) tolere edilir', () => {
    const s = parseSupportedPIDs('41\t00   98 \t 3B 00 11');
    expect(s.has(0x0C)).toBe(true);
    expect(s.has(0x05)).toBe(true);
  });

  it('CRLF + ELM prompt ">" temizlenir', () => {
    const s = parseSupportedPIDs('41 00 98 3B 00 11\r\n>');
    expect(s.has(0x0C)).toBe(true);
  });

  it('geçersiz hex → boş set (fail-soft, throw yok)', () => {
    expect(parseSupportedPIDs('NO DATA').size).toBe(0);
    expect(parseSupportedPIDs('ZZZZ').size).toBe(0);
    expect(parseSupportedPIDs('?').size).toBe(0);
  });

  it('tek (odd) uzunluklu parça sessizce atılır', () => {
    // "410" bitişik ama tek uzunluk → tamamen atılır (yanlış hizalama yok) → boş
    expect(parseSupportedPIDs('410').size).toBe(0);
    // Geçerli blok + sonda kopuk "0" token → blok parse olur, "0" atılır
    const s = parseSupportedPIDs('4100983B0011 0');
    expect(s.has(0x0C)).toBe(true);
  });

  it('boş / null / undefined girdi → boş set (throw yok)', () => {
    expect(parseSupportedPIDs('').size).toBe(0);
    expect(parseSupportedPIDs(null).size).toBe(0);
    expect(parseSupportedPIDs(undefined).size).toBe(0);
  });
});

describe('GERÇEK ARAÇ RAW_HANDSHAKE.json — regresyon fixture', () => {
  const result = buildHandshakeResult(REAL_RAW);

  it('bitişik ham → 19 desteklenen PID (eskiden BOŞtu)', () => {
    expect(result.supportedPids.size).toBe(19);
  });

  it('okunan bloklar 0x00, 0x20, 0x40 (devam-bit zinciri)', () => {
    expect([...result.readBlocks].sort((a, b) => a - b)).toEqual([0x00, 0x20, 0x40]);
  });

  it('PID 2F (yakıt) GERÇEKTEN destekli olarak parse edilir → oto-aktive edilebilir', () => {
    expect(result.supportedPids.has(0x2F)).toBe(true);
  });

  it('bitmap ile tutarlı: çekirdek PID destekli, 0x11/0x42 desteksiz', () => {
    const expected = asSet([
      0x01, 0x04, 0x05, 0x0B, 0x0C, 0x0D, 0x0F, 0x10, 0x1C, 0x20,
      0x21, 0x23, 0x2C, 0x2F, 0x33, 0x40, 0x41, 0x49, 0x4A,
    ]);
    expect([...result.supportedPids].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
    expect(result.supportedPids.has(0x11)).toBe(false); // Throttle — bitmap'te kapalı
    expect(result.supportedPids.has(0x42)).toBe(false); // Voltage — bitmap'te kapalı
  });

  it('AYNI ham boşluklu (ATS1) biçimde de AYNI 19 PID (spaced regresyonu yok)', () => {
    const spacedRaw: RawHandshake = {
      raw09:   REAL_RAW.raw09,
      raw0100: spaced(REAL_RAW.raw0100),
      raw0120: spaced(REAL_RAW.raw0120),
      raw0140: spaced(REAL_RAW.raw0140),
      raw0160: '', raw0180: '', raw01A0: '',
    };
    const s = buildHandshakeResult(spacedRaw);
    expect([...s.supportedPids].sort((a, b) => a - b))
      .toEqual([...result.supportedPids].sort((a, b) => a - b));
  });

  it('VIN fail-soft korunur: boş/space VIN → null, throw yok', () => {
    expect(() => parseVIN(REAL_RAW.raw09)).not.toThrow();
    expect(parseVIN(REAL_RAW.raw09)).toBeNull();
  });

  it('classify bitişik hex ham 0100 bloğunu "ok" sınıflar (boşluk-duyarsız)', () => {
    expect(classifyHandshakeResponse(REAL_RAW.raw0100, '41', '00')).toBe('ok');
  });
});
