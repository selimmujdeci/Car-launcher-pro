/**
 * vehicleFingerprint.test.ts — Araç Parmak İzi TEMEL katmanı (PR-25, foundation-only).
 *
 * Kilitlenen davranışlar: deterministik hash (aynı araç=aynı, farklı=farklı, VIN'siz çalışır,
 * ECU sırası ve PID trailing-zero dolgusu kimliği DEĞİŞTİRMEZ), bounded (max 8) LRU depo,
 * matcher güven değerleri (1.0 / 0.80 / 0.30 / 0).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeVin,
  normalizeEcuAddress,
  normalizeEcuAddresses,
  normalizePidBitmap,
  stripTrailingZeroBytes,
  canonicalFingerprintKey,
  buildFingerprint,
  matchFingerprint,
  findBestMatch,
  VehicleFingerprintStore,
  MAX_FINGERPRINTS,
  type VehicleFingerprintInput,
} from '../platform/vehicleFingerprintService';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
});

/* ── Normalize ────────────────────────────────────────────────────────────── */
describe('normalize yardımcıları', () => {
  it('VIN: trim + büyük harf + boşluksuz', () => {
    expect(normalizeVin('  vf1 abc 123  ')).toBe('VF1ABC123');
    expect(normalizeVin(undefined)).toBe('');
    expect(normalizeVin(null)).toBe('');
  });
  it('ECU adresi: büyük harf hex, 0x öneki temizli', () => {
    expect(normalizeEcuAddress(' 0x7e8 ')).toBe('7E8');
    expect(normalizeEcuAddress('18daf110')).toBe('18DAF110');
  });
  it('ECU listesi: normalize + tekil + sıralı + boşları at', () => {
    expect(normalizeEcuAddresses(['7E8', '7e0', '', '7E8', ' 7DF '])).toEqual(['7DF', '7E0', '7E8']);
  });
  it('stripTrailingZeroBytes: yalnız sondaki tam sıfır baytı kırpar', () => {
    expect(stripTrailingZeroBytes('BE1FA81300')).toBe('BE1FA813');
    expect(stripTrailingZeroBytes('BE1FA8130000')).toBe('BE1FA813');
    expect(stripTrailingZeroBytes('00BE00')).toBe('00BE'); // ortadaki 00 KORUNUR
    expect(stripTrailingZeroBytes('0000')).toBe('');
  });
  it('PID bitmap: hex-dışı at, bayt-hizala, trailing-zero temizle', () => {
    expect(normalizePidBitmap('be 1f a8 13')).toBe('BE1FA813');
    expect(normalizePidBitmap('BE1FA81300')).toBe('BE1FA813');
    expect(normalizePidBitmap('F')).toBe('0F'); // tek hane → bayt-hizalı
    expect(normalizePidBitmap('')).toBe('');
  });
});

/* ── Kanonik anahtar + hash ───────────────────────────────────────────────── */
describe('deterministik hash', () => {
  const base: VehicleFingerprintInput = {
    vin: 'VF1ABC0000001234',
    protocol: 'ISO15765-4',
    ecuAddresses: ['7E8', '7E9'],
    supportedPidBitmap: 'BE1FA813',
  };

  it('aynı araç → aynı hash (zaman/metadata kimliği etkilemez)', () => {
    const a = buildFingerprint(base, 1000);
    const b = buildFingerprint({ ...base, metadata: { adapterMac: 'AA:BB' } }, 9999);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toHaveLength(16);
  });

  it('farklı araç → farklı hash', () => {
    const a = buildFingerprint(base);
    const b = buildFingerprint({ ...base, vin: 'VF1ZZZ0000009999' });
    const c = buildFingerprint({ ...base, supportedPidBitmap: 'BE1FA800' });
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it('VIN YOKken çalışır ve deterministiktir', () => {
    const a = buildFingerprint({ ...base, vin: undefined });
    const b = buildFingerprint({ ...base, vin: '' });
    expect(a.vin).toBe('');
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toHaveLength(16);
  });

  it('ECU SIRASI hash\'i DEĞİŞTİRMEZ (sıra-bağımsız kimlik)', () => {
    const a = buildFingerprint({ ...base, ecuAddresses: ['7E8', '7E9', '7EA'] });
    const b = buildFingerprint({ ...base, ecuAddresses: ['7EA', '7E8', '7E9'] });
    const c = buildFingerprint({ ...base, ecuAddresses: ['7e9', '7ea', '7E8'] }); // + case
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(c.hash);
  });

  it('PID bitmap trailing-zero DOLGUSU aynı fingerprint verir', () => {
    const a = buildFingerprint({ ...base, supportedPidBitmap: 'BE1FA813' });
    const b = buildFingerprint({ ...base, supportedPidBitmap: 'BE1FA81300' });
    const c = buildFingerprint({ ...base, supportedPidBitmap: 'BE 1F A8 13 00 00' });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(c.hash);
  });

  it('canonicalFingerprintKey: metadata/zaman DAHİL DEĞİL', () => {
    const key = canonicalFingerprintKey({
      vin: 'X', protocol: 'iso', ecuAddresses: ['7E8'], supportedPidBitmap: 'AB',
    });
    expect(key).toBe('V:X|P:ISO|E:7E8|B:AB');
  });
});

/* ── Matcher ──────────────────────────────────────────────────────────────── */
describe('matchFingerprint — güven değerleri', () => {
  const sig = { protocol: 'ISO15765-4', ecuAddresses: ['7E8', '7E9'], supportedPidBitmap: 'BE1FA813' };

  it('aynı VIN → 1.0', () => {
    const a = buildFingerprint({ ...sig, vin: 'VF1ABC0000001234' });
    const b = buildFingerprint({ ...sig, vin: 'VF1ABC0000001234', ecuAddresses: ['7E8'] }); // imza farklı ama VIN aynı
    const m = matchFingerprint(a, b);
    expect(m.confidence).toBe(1.0);
    expect(m.reason).toBe('vin');
  });

  it('VIN yok ama protocol+ECU+bitmap aynı → 0.80', () => {
    const a = buildFingerprint({ ...sig, vin: '' });
    const b = buildFingerprint({ ...sig, vin: '' });
    const m = matchFingerprint(a, b);
    expect(m.confidence).toBe(0.8);
    expect(m.reason).toBe('signature');
  });

  it('yalnız OBD MAC eşleşmesi → 0.30', () => {
    const a = buildFingerprint({ vin: '', protocol: 'ISO15765-4', ecuAddresses: ['7E8'], supportedPidBitmap: 'AA', metadata: { adapterMac: '11:22:33:44' } });
    const b = buildFingerprint({ vin: '', protocol: 'CAN29', ecuAddresses: ['18DAF110'], supportedPidBitmap: 'FF', metadata: { adapterMac: '11:22:33:44' } });
    const m = matchFingerprint(a, b);
    expect(m.confidence).toBe(0.3);
    expect(m.reason).toBe('adapter-mac');
  });

  it('hiçbir eşleşme → 0', () => {
    const a = buildFingerprint({ vin: 'AAA', protocol: 'ISO15765-4', ecuAddresses: ['7E8'], supportedPidBitmap: 'AA' });
    const b = buildFingerprint({ vin: 'BBB', protocol: 'CAN29', ecuAddresses: ['7E0'], supportedPidBitmap: 'BB' });
    const m = matchFingerprint(a, b);
    expect(m.confidence).toBe(0);
    expect(m.reason).toBe('none');
  });

  it('farklı VIN ama aynı imza → VIN çakışması aynı araç saymaz (0)', () => {
    const a = buildFingerprint({ ...sig, vin: 'VIN-AAA' });
    const b = buildFingerprint({ ...sig, vin: 'VIN-BBB' });
    expect(matchFingerprint(a, b).confidence).toBe(0);
  });

  it('boş imza (bitmap yok) 0.80 vermez', () => {
    const a = buildFingerprint({ vin: '', protocol: 'ISO15765-4', ecuAddresses: ['7E8'], supportedPidBitmap: '' });
    const b = buildFingerprint({ vin: '', protocol: 'ISO15765-4', ecuAddresses: ['7E8'], supportedPidBitmap: '' });
    expect(matchFingerprint(a, b).confidence).toBe(0);
  });

  it('findBestMatch: en yüksek güveni seçer', () => {
    const cand = buildFingerprint({ ...sig, vin: 'VF1ABC0000001234', metadata: { adapterMac: 'MAC1' } });
    const macOnly = buildFingerprint({ vin: '', protocol: 'X', ecuAddresses: ['1'], supportedPidBitmap: 'A', metadata: { adapterMac: 'MAC1' } });
    const exact = buildFingerprint({ ...sig, vin: 'VF1ABC0000001234' });
    const best = findBestMatch(cand, [macOnly, exact]);
    expect(best.confidence).toBe(1.0);
  });
});

/* ── Bounded LRU depo ─────────────────────────────────────────────────────── */
describe('VehicleFingerprintStore — bounded(8) LRU + kalıcılık', () => {
  let _n = 0;
  function store() { return new VehicleFingerprintStore(`vfp-test-${_n++}`); }

  function makeFp(i: number) {
    return buildFingerprint({ vin: `VIN-${i}`, protocol: 'ISO15765-4', ecuAddresses: ['7E8'], supportedPidBitmap: 'AB' }, 1000 + i);
  }

  it('save/load/list/remove/clear', () => {
    const s = store();
    const fp = makeFp(1);
    s.save(fp);
    expect(s.size).toBe(1);
    expect(s.load(fp.hash)?.vin).toBe('VIN-1');
    expect(s.list()).toHaveLength(1);
    expect(s.remove(fp.hash)).toBe(true);
    expect(s.size).toBe(0);
    s.save(makeFp(2));
    s.clear();
    expect(s.size).toBe(0);
    expect(s.list()).toEqual([]);
  });

  it('MAX 8 araç tutar; taşınca en eski-görülen düşer', () => {
    const s = store();
    const fps = Array.from({ length: 10 }, (_, i) => makeFp(i));
    fps.forEach((f) => s.save(f));
    expect(s.size).toBe(MAX_FINGERPRINTS); // 8
    // İlk iki eklenen (en eski-görülen) düşmüş olmalı.
    expect(s.load(fps[0].hash)).toBeNull();
    expect(s.load(fps[1].hash)).toBeNull();
    expect(s.load(fps[9].hash)).not.toBeNull();
    // En yeni-görülen başta.
    expect(s.list()[0].hash).toBe(fps[9].hash);
  });

  it('aynı hash upsert: firstSeen korunur, kayıt öne taşınır (recency)', () => {
    const s = store();
    const first = buildFingerprint({ vin: 'VIN-A', protocol: 'P', ecuAddresses: ['7E8'], supportedPidBitmap: 'AB' }, 1000);
    s.save(first);
    s.save(makeFp(5)); // araya başka araç
    const again = buildFingerprint({ vin: 'VIN-A', protocol: 'P', ecuAddresses: ['7E8'], supportedPidBitmap: 'AB' }, 5000);
    const stored = s.save(again);
    expect(s.size).toBe(2);              // upsert — çift kayıt YOK
    expect(stored.firstSeen).toBe(1000); // ilk görülme korundu
    expect(stored.lastSeen).toBe(5000);  // son görülme güncellendi
    expect(s.list()[0].hash).toBe(again.hash); // recency: öne taşındı
  });

  it('kalıcılık: aynı storageKey ile yeni örnek diskten yükler', () => {
    const key = `vfp-persist-${_n++}`;
    const a = new VehicleFingerprintStore(key);
    a.save(makeFp(42));
    const b = new VehicleFingerprintStore(key);
    expect(b.size).toBe(1);
    expect(b.load(makeFp(42).hash)?.vin).toBe('VIN-42');
  });

  it('bozuk disk verisi → fail-soft boş liste', () => {
    const key = `vfp-corrupt-${_n++}`;
    try { localStorage.setItem(key, '{bozuk-json'); } catch { /* jsdom */ }
    const s = new VehicleFingerprintStore(key);
    expect(s.size).toBe(0);
  });
});
