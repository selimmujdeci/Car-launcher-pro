/**
 * W5-OBD-PR1 — Native Handshake + Supported PID Discovery testleri.
 *
 * Gerçek araç senaryolarını kapsar (kaynak: saha doğrulanmış PID 2F %40.4,
 * RPM/MAP/MAF/Coolant/Fuel gerçek okuma). Native `performHandshake()` HAM yanıt
 * döndürür; tüm ayrıştırma/karar mantığı burada test edilen pure TS'te.
 *
 * Kapsam (task madde eşlemesi):
 *   1  Bitmap doğru parse ediliyor
 *   2  Desteklenmeyen PID poll edilmiyor
 *   3  Desteklenen PID poll ediliyor
 *   4  PID 2F capability oluşuyor
 *   5  VIN okunuyor
 *   6  VIN desteklenmiyorsa fail-soft
 *   7  performHandshake (parse zinciri) exception atmıyor
 *   8  Timeout türleri ayrılıyor (NO DATA / TIMEOUT / UNSUPPORTED)
 *   9  Import yan etkisi yok
 *  10  Mevcut poll zinciri regresyonsuz (kanıt yokken taban değişmez)
 */
import { describe, it, expect } from 'vitest';
import {
  parseVIN,
  parseSupportedPIDs,
  buildHandshakeResult,
  classifyHandshakeResponse,
  type RawHandshake,
} from '../core/val/OBDHandshake';
import { getPidListForVehicle, refinePidList } from '../platform/obdPidConfig';

/* ── Gerçek araç yanıt fixture'ları ──────────────────────────────────────── */

// Mode 01 PID 00 — PIDs {1,3,4,5,6,7,12,13,14,15,16,17,19,20,21,28,31,32}
// (0x0C RPM=12, 0x0D hız=13, 0x05 coolant=5 hepsi destekli; PID 0x20=32 set → 0120 sorulur)
const RAW_0100 = '41 00 BE 1F B8 13';

// Mode 01 PID 20 — yalnız PID 47 (0x2F yakıt seviyesi) set; byte D bit0=0 → devam yok
const RAW_0120 = '41 20 00 02 00 00';

// Gerçek araç VIN yanıtı (Renault Trafic örneği — 17 char ISO 15765-4)
const RAW_VIN = '49 02 01 56 46 31 41 41 41 41 41 35 35 31 32 33 34 35 36 37';

describe('W5-OBD-PR1 · Bitmap parse (item 1)', () => {
  it('01 00 bitmap doğru PID setine çözülür', () => {
    const s = parseSupportedPIDs(RAW_0100);
    expect(s.has(0x0C)).toBe(true); // RPM
    expect(s.has(0x0D)).toBe(true); // hız
    expect(s.has(0x05)).toBe(true); // coolant
    expect(s.has(0x20)).toBe(true); // süreklilik bit'i
    expect(s.has(0x02)).toBe(false); // set değil
  });

  it('buildHandshakeResult çok-bloklu bitmap ve readBlocks üretir', () => {
    const raw: RawHandshake = { raw09: RAW_VIN, raw0100: RAW_0100, raw0120: RAW_0120 };
    const r = buildHandshakeResult(raw);
    expect(r.readBlocks.has(0x00)).toBe(true);
    expect(r.readBlocks.has(0x20)).toBe(true);
    expect(r.readBlocks.has(0x40)).toBe(false); // sorulmadı
    expect(r.supportedPids.has(0x2F)).toBe(true); // 0120 bloğundan yakıt
    expect(r.supportedPids.has(0x0C)).toBe(true); // 0100 bloğundan RPM
  });
});

describe('W5-OBD-PR1 · Capability-güdümlü poll listesi (item 2/3/4)', () => {
  const base = getPidListForVehicle('ice'); // ['0x0D','0x0C','0x05','0x11','0x0F']

  it('desteklenen PID poll listesinde kalır (item 3)', () => {
    const r = buildHandshakeResult({ raw09: '', raw0100: RAW_0100 });
    const pids = refinePidList(base, r.supportedPids, r.readBlocks);
    expect(pids).toContain('0x0C'); // RPM destekli → kalır
    expect(pids).toContain('0x0D'); // hız destekli → kalır
    expect(pids).toContain('0x05'); // coolant destekli → kalır
  });

  it('desteklenmeyen PID poll listesinden çıkar (item 2)', () => {
    // 0100'de coolant(5) YOK: byte A=00, B=1A {12,13,15}, C=80 {17}, D=00
    const r = buildHandshakeResult({ raw09: '', raw0100: '41 00 00 1A 80 00' });
    const pids = refinePidList(base, r.supportedPids, r.readBlocks);
    expect(pids).not.toContain('0x05'); // coolant desteklenmiyor → elendi
    expect(pids).toContain('0x0C');     // RPM(12) destekli → kaldı
    expect(pids).toContain('0x11');     // throttle(17) destekli → kaldı
  });

  it('PID 2F bitmap kanıtıyla oto-aktive olur — statik kara liste kalktı (item 4)', () => {
    expect(base).not.toContain('0x2F'); // taban listede yakıt YOK (statik)
    const r = buildHandshakeResult({ raw09: '', raw0100: RAW_0100, raw0120: RAW_0120 });
    const pids = refinePidList(base, r.supportedPids, r.readBlocks);
    expect(pids).toContain('0x2F'); // kanıtlı destekli → eklendi
  });

  it('2F desteklenmiyorsa eklenmez (varsayım yok)', () => {
    const r = buildHandshakeResult({ raw09: '', raw0100: RAW_0100 }); // 0120 yok → 2F bilinmiyor
    const pids = refinePidList(base, r.supportedPids, r.readBlocks);
    expect(pids).not.toContain('0x2F');
  });
});

describe('W5-OBD-PR1 · VIN (item 5/6)', () => {
  it('geçerli 09 02 yanıtından 17-char VIN okunur (item 5)', () => {
    const vin = parseVIN(RAW_VIN);
    expect(vin).toBe('VF1AAAAA551234567');
    expect(vin).toHaveLength(17);
  });

  it('VIN desteklenmiyorsa null döner, throw etmez (item 6)', () => {
    expect(parseVIN('NO DATA')).toBeNull();
    expect(parseVIN('7F 09 12')).toBeNull();
    expect(parseVIN('')).toBeNull();
    expect(parseVIN(null)).toBeNull();
    // Geçersiz VIN (I/O/Q yasak karakter) → null
    expect(parseVIN('49 02 01 49 4F 51 41 41 41 41 41 41 41 41 41 41 41 41 41 41')).toBeNull();
  });
});

describe('W5-OBD-PR1 · Fail-soft & saf zincir (item 7/9)', () => {
  it('bozuk/eksik girişte buildHandshakeResult exception atmaz (item 7)', () => {
    const garbage: RawHandshake[] = [
      { raw09: '', raw0100: '' },
      { raw09: 'ZZZ', raw0100: 'garbage!!!' },
      { raw09: 'NO DATA', raw0100: 'NO DATA', raw0120: 'STOPPED' },
      { raw09: '49', raw0100: '41' },
    ];
    for (const g of garbage) {
      expect(() => buildHandshakeResult(g)).not.toThrow();
      const r = buildHandshakeResult(g);
      expect(r.vin).toBeNull();
      expect(r.supportedPids).toBeInstanceOf(Set);
    }
  });

  it('refinePidList girdi listesini mutasyona uğratmaz (saf — item 9)', () => {
    const base = getPidListForVehicle('ice');
    const snapshot = [...base];
    const r = buildHandshakeResult({ raw09: '', raw0100: RAW_0100, raw0120: RAW_0120 });
    refinePidList(base, r.supportedPids, r.readBlocks);
    expect(base).toEqual(snapshot); // girdi değişmedi
  });
});

describe('W5-OBD-PR1 · Timeout türü ayrımı (item 8)', () => {
  it('NO DATA / TIMEOUT / UNSUPPORTED / ERROR / OK ayrı sınıflanır', () => {
    expect(classifyHandshakeResponse('41 00 BE 1F B8 13', '41', '00')).toBe('ok');
    expect(classifyHandshakeResponse('NO DATA', '41', '00')).toBe('no_data');
    expect(classifyHandshakeResponse('', '41', '00')).toBe('timeout');
    expect(classifyHandshakeResponse(null, '41', '00')).toBe('timeout');
    expect(classifyHandshakeResponse('7F 01 12', '41', '00')).toBe('unsupported');
    expect(classifyHandshakeResponse('STOPPED', '41', '00')).toBe('error');
    expect(classifyHandshakeResponse('SEARCHING...', '41', '00')).toBe('busy');
  });

  it('VIN negatif yanıtı (7F 09) unsupported olarak sınıflanır', () => {
    expect(classifyHandshakeResponse('7F 09 12', '49', '02')).toBe('unsupported');
  });
});

describe('W5-OBD-PR1 · Regresyon güvencesi (item 10)', () => {
  it('handshake kanıtı yokken (readBlocks boş) taban liste AYNEN döner', () => {
    for (const t of ['ice', 'ev', 'diesel', 'hybrid', 'phev'] as const) {
      const base = getPidListForVehicle(t);
      const same = refinePidList(base, new Set(), new Set());
      expect(same).toEqual(base);
    }
  });

  it('okunmayan bloktaki taban PID zero-trust ile korunur', () => {
    // readBlocks yalnız 0x20 içeriyor ama base PID'ler blok 0x00'da → dokunulmaz
    const base = getPidListForVehicle('ice');
    const pids = refinePidList(base, new Set([0x2F]), new Set([0x20]));
    // Blok 0x00 okunmadı → tüm ICE tabanı korunur, üstüne 2F eklenir
    for (const p of base) expect(pids).toContain(p);
    expect(pids).toContain('0x2F');
  });
});
