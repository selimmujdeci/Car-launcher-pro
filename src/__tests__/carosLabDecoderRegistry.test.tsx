/**
 * carosLabDecoderRegistry.test.tsx — CAROS LAB Faz A8 KİLİTLERİ.
 *
 * ANA İLKELER:
 *  1. Bu ekran STATİK bir katalogdur — araca komut GÖNDERMEZ, ECU/PID/DID keşfi
 *     BAŞLATMAZ, "destekleniyor" iddiası ÜRETMEZ.
 *  2. Çözücü FONKSİYON GÖVDESİ modele/render'a SIZMAZ (`toString()` yasak).
 *  3. VIN / araç parmak izi / kullanıcı aracı / anahtar modele GİRMEZ.
 *  4. Registry'ye canlı referans verilmez; model registry'yi DEĞİŞTİREMEZ.
 *  5. Merge/override/collision davranışı GERÇEK `compileVehicleDidProfile`
 *     kuralından türetilir — uydurulmaz.
 *  6. A4/A5/A6/A7/UX-F1 ve developer access gate kilitleri korunur.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  buildDecoderRecords, buildDecoderSummary, filterDecoderRecords,
  collectDecoderFacets, normalizeDecoderId,
  MAX_DECODER_RECORDS, DECODER_TYPE_LABEL,
  type DecoderRegistryRaw, type RawPidRecord, type RawDidRecord, type RawProfileRecord,
} from '../platform/devtools/decoderRegistryModel';
import { readDecoderRegistrySnapshot } from '../platform/devtools/decoderRegistrySources';
import { STANDARD_PIDS, STANDARD_PID_MAP } from '../platform/obd/StandardPidRegistry';
import { MANUFACTURER_DID_PROFILES } from '../platform/obd/profiles';
import { compileVehicleDidProfile } from '../platform/obd/vehicleDidProfile';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { DecoderRegistryScreen } from '../components/devtools/screens/DecoderRegistryScreen';
import { CarosLabShell } from '../components/devtools/CarosLabShell';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

function pid(over: Partial<RawPidRecord> = {}): RawPidRecord {
  return {
    pid: '0C', name: 'Motor devri', unit: 'rpm', bytes: 2,
    min: 0, max: 16383.75, category: 'motor', core: true, hasDecoder: true,
    ...over,
  };
}

function did(over: Partial<RawDidRecord> = {}): RawDidRecord {
  return {
    profileId: 'test-profile', did: 'F190', service: '22', ecu: 'engine', ecuKnown: true,
    name: 'VIN', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik',
    decodeFn: 'ascii', decodeA: null, decodeB: null, compiled: true,
    ...over,
  };
}

function profile(over: Partial<RawProfileRecord> = {}): RawProfileRecord {
  return {
    profileId: 'test-profile', brand: 'Test Marka', source: 'ISO 14229-1',
    note: null, protocols: ['can'], ecuCount: 1, declaredDids: 1, compiledDids: 1,
    ...over,
  };
}

function snapshot(over: Partial<DecoderRegistryRaw> = {}): DecoderRegistryRaw {
  return {
    readAt: NOW,
    pids: [pid()],
    pidInvalid: 0,
    profiles: [profile()],
    dids: [did()],
    didInvalid: 0,
    ...over,
  };
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

afterEach(() => { vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 1 — GERÇEK registry okunuyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — gerçek registry sembolleri okunuyor', () => {
  it('STANDARD_PIDS başarıyla okunuyor ve kayıt sayısı Map ile TUTARLI', () => {
    const s = readDecoderRegistrySnapshot();
    expect(s.pids).not.toBeNull();
    expect(s.pids!.length).toBe(STANDARD_PIDS.length);
    expect(s.pids!.length).toBe(STANDARD_PID_MAP.size);
    expect(s.pids!.length).toBeGreaterThan(50);
    expect(s.pidInvalid).toBe(0);
  });

  it('manufacturer DID profilleri başarıyla okunuyor', () => {
    const s = readDecoderRegistrySnapshot();
    expect(s.profiles).not.toBeNull();
    expect(s.profiles!.length).toBe(Object.keys(MANUFACTURER_DID_PROFILES).length);
    for (const p of s.profiles!) {
      expect(p.profileId.length).toBeGreaterThan(0);
      expect(p.brand.length).toBeGreaterThan(0);
      expect(p.source.length).toBeGreaterThan(0);      // kaynak alanı ZORUNLU (lisans kuralı)
    }
    expect(s.dids).not.toBeNull();
    expect(s.dids!.length).toBeGreaterThan(0);
  });

  it('profil DID sayıları GERÇEK compileVehicleDidProfile sonucuyla uyuşur', () => {
    const s = readDecoderRegistrySnapshot();
    for (const p of s.profiles!) {
      const real = compileVehicleDidProfile(
        MANUFACTURER_DID_PROFILES[p.profileId as keyof typeof MANUFACTURER_DID_PROFILES],
      );
      expect(p.compiledDids).toBe(real.size);
    }
  });

  it('kaynak katmanı sayıları TOPLAMDA tutarlı', () => {
    const s = readDecoderRegistrySnapshot();
    const declared = s.profiles!.reduce((n, p) => n + p.declaredDids, 0);
    expect(s.dids!.length).toBe(declared);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 2 — FAIL-SOFT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — bir kaynak bozuksa diğeri çalışmaya devam eder', () => {
  it('PID kaynağı okunamazken DID kayıtları yine üretilir', () => {
    const recs = buildDecoderRecords(snapshot({ pids: null }));
    expect(recs.filter((r) => r.kind === 'PID')).toHaveLength(0);
    expect(recs.filter((r) => r.kind === 'DID').length).toBeGreaterThan(0);
    const sum = buildDecoderSummary(snapshot({ pids: null }), recs);
    expect(sum.pidCount).toBeNull();          // OKUNAMADI — 0 DEĞİL
    expect(sum.didCount).toBe(1);
  });

  it('DID kaynağı okunamazken PID kayıtları yine üretilir', () => {
    const s = snapshot({ profiles: null, dids: null });
    const recs = buildDecoderRecords(s);
    expect(recs.filter((r) => r.kind === 'PID').length).toBeGreaterThan(0);
    const sum = buildDecoderSummary(s, recs);
    expect(sum.didCount).toBeNull();
    expect(sum.profileCount).toBeNull();
    expect(sum.manufacturerCount).toBeNull();
    expect(sum.pidCount).toBe(1);
  });

  it('BOŞ registry sahte kayıt ÜRETMEZ ve 0 ile null KARIŞTIRILMAZ', () => {
    const emptyRead = snapshot({ pids: [], dids: [], profiles: [] });
    const recs = buildDecoderRecords(emptyRead);
    expect(recs).toEqual([]);
    const sum = buildDecoderSummary(emptyRead, recs);
    expect(sum.pidCount).toBe(0);             // okundu ve GERÇEKTEN boş
    expect(sum.didCount).toBe(0);

    const unread: DecoderRegistryRaw = {
      readAt: NOW, pids: null, pidInvalid: 0, profiles: null, dids: null, didInvalid: 0,
    };
    const sum2 = buildDecoderSummary(unread, buildDecoderRecords(unread));
    expect(sum2.pidCount).toBeNull();
    expect(sum2.didCount).toBeNull();
  });

  it('null/undefined/bozuk kayıt fail-soft — atlanır veya SAYILIR', () => {
    const s = snapshot({
      pids: [pid(), null as unknown as RawPidRecord, pid({ pid: '05' })],
      pidInvalid: 2,
      dids: [did(), undefined as unknown as RawDidRecord],
      didInvalid: 1,
    });
    expect(() => buildDecoderRecords(s)).not.toThrow();
    const recs = buildDecoderRecords(s);
    // Bozuk kayıt için SAHTE satır üretilmez
    for (const r of recs) expect(r.normalizedId.length).toBeGreaterThan(0);
    const sum = buildDecoderSummary(s, recs);
    expect(sum.invalidCount).toBe(3);
  });

  it('gerçek ekran render olur ve çökmez', () => {
    const html = renderToStaticMarkup(<DecoderRegistryScreen />);
    expect(html).toContain('decoder-registry');
    expect(html).toContain('decoder-summary');
  });

  it('registry import\'u FIRLATSA bile snapshot üretilir (davranışsal)', async () => {
    vi.resetModules();
    const boom = new Proxy({}, { get() { throw new Error('registry patladı'); } });
    vi.doMock('../platform/obd/StandardPidRegistry', () => ({
      get STANDARD_PIDS() { throw new Error('pid registry patladı'); },
      STANDARD_PID_MAP: new Map(),
    }));
    vi.doMock('../platform/obd/profiles', () => ({
      MANUFACTURER_DID_PROFILES: boom,
      MANUFACTURER_DID_PROFILE_SOURCES: {},
    }));

    const sources = await import('../platform/devtools/decoderRegistrySources');
    const s = sources.readDecoderRegistrySnapshot();
    expect(s.pids).toBeNull();
    expect(s.readAt).toBeGreaterThan(0);

    vi.doUnmock('../platform/obd/StandardPidRegistry');
    vi.doUnmock('../platform/obd/profiles');
    vi.resetModules();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 3 — NORMALİZASYON
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — PID/DID kimlik normalizasyonu', () => {
  it('büyük harf · 0x ön eki · boşluk temizlenir', () => {
    expect(normalizeDecoderId('0c')).toBe('0C');
    expect(normalizeDecoderId('0x0c')).toBe('0C');
    expect(normalizeDecoderId(' f190 ')).toBe('F190');
    expect(normalizeDecoderId('f1 90')).toBe('F190');
    expect(normalizeDecoderId('')).toBe('');
    expect(normalizeDecoderId(null as unknown as string)).toBe('');
  });

  it('kayıtlarda normalizedId üretilir; ham id KORUNUR', () => {
    const recs = buildDecoderRecords(snapshot({
      pids: [pid({ pid: '0c' })], dids: [did({ did: 'f190' })],
    }));
    const p = recs.find((r) => r.kind === 'PID')!;
    const d = recs.find((r) => r.kind === 'DID')!;
    expect(p.id).toBe('0c');
    expect(p.normalizedId).toBe('0C');
    expect(d.normalizedId).toBe('F190');
  });

  it('PID servisi 01, DID servisi profilden gelir', () => {
    const recs = buildDecoderRecords(snapshot({
      dids: [did({ service: '21', did: '80' })],
    }));
    expect(recs.find((r) => r.kind === 'PID')!.service).toBe('01');
    expect(recs.find((r) => r.kind === 'DID')!.service).toBe('21');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 4 — ARAMA VE FİLTRE
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — arama saf ve büyük/küçük harf duyarsız', () => {
  const recs = buildDecoderRecords(snapshot({
    pids: [pid({ pid: '0C', name: 'Motor devri', unit: 'rpm' }),
           pid({ pid: '05', name: 'Soğutma sıvısı sıcaklığı', unit: '°C', core: false })],
    dids: [did({ did: 'F190', name: 'VIN', profileId: 'p1' }),
           did({ did: '2006', name: 'Odometre', unit: 'km', profileId: 'p2', decodeFn: 'linear', decodeA: 0.01 })],
    profiles: [profile({ profileId: 'p1', brand: 'Renault' }),
               profile({ profileId: 'p2', brand: 'Dacia' })],
  }));

  it('BOŞ sorguda TÜM kayıtlar döner', () => {
    expect(filterDecoderRecords(recs, { query: '' })).toHaveLength(recs.length);
    expect(filterDecoderRecords(recs, {})).toHaveLength(recs.length);
    expect(filterDecoderRecords(recs, null)).toHaveLength(recs.length);
  });

  it('ID ile arama çalışır (küçük harf + 0x ön eki dâhil)', () => {
    expect(filterDecoderRecords(recs, { query: '0c' }).map((r) => r.normalizedId)).toContain('0C');
    expect(filterDecoderRecords(recs, { query: '0x0c' }).map((r) => r.normalizedId)).toContain('0C');
    expect(filterDecoderRecords(recs, { query: 'F190' })).toHaveLength(1);
  });

  it('isim ile arama çalışır (büyük/küçük harf duyarsız)', () => {
    expect(filterDecoderRecords(recs, { query: 'motor DEVRİ' })).toHaveLength(1);
    expect(filterDecoderRecords(recs, { query: 'odometre' })).toHaveLength(1);
  });

  it('marka filtresi çalışır', () => {
    const r = filterDecoderRecords(recs, { manufacturer: 'Renault' });
    expect(r).toHaveLength(1);
    expect(r[0].profile).toBe('p1');
  });

  it('birim filtresi çalışır', () => {
    expect(filterDecoderRecords(recs, { unit: 'rpm' })).toHaveLength(1);
    expect(filterDecoderRecords(recs, { unit: 'km' })).toHaveLength(1);
  });

  it('çözücü tipi ve rol filtreleri çalışır', () => {
    expect(filterDecoderRecords(recs, { decoderType: 'ASCII' })).toHaveLength(1);
    expect(filterDecoderRecords(recs, { decoderType: 'CUSTOM' })).toHaveLength(2);   // iki PID
    expect(filterDecoderRecords(recs, { supportStatus: 'CORE' })).toHaveLength(1);
    expect(filterDecoderRecords(recs, { kind: 'DID' })).toHaveLength(2);
  });

  it('filtreler BİRLEŞİR ve eşleşme yoksa boş döner', () => {
    expect(filterDecoderRecords(recs, { kind: 'PID', unit: 'km' })).toHaveLength(0);
    expect(filterDecoderRecords(recs, { query: 'böyle-bir-sey-yok' })).toHaveLength(0);
  });

  it('facet listeleri tekil ve sıralı', () => {
    const f = collectDecoderFacets(recs);
    expect(f.manufacturers).toEqual(['Dacia', 'Renault']);
    expect(new Set(f.units).size).toBe(f.units.length);
    expect(f.types).toContain('CUSTOM');
    expect(f.types).toContain('ASCII');
  });

  it('arama TIMER/DEBOUNCE kullanmaz (saf fonksiyon)', () => {
    const iv = vi.spyOn(globalThis, 'setInterval');
    const to = vi.spyOn(globalThis, 'setTimeout');
    filterDecoderRecords(recs, { query: 'motor' });
    collectDecoderFacets(recs);
    expect(iv).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 5 — ÇÖZÜCÜ SINIFLANDIRMASI (kanıta dayalı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — decoder tipi kanıta dayanır, uydurulmaz', () => {
  it('DID decode.fn kümesi repo sözleşmesine göre sınıflandırılır', () => {
    const cases: [string, string][] = [
      ['ascii', 'ASCII'], ['A', 'LINEAR'], ['AB', 'LINEAR'],
      ['temp40', 'LINEAR'], ['pct', 'LINEAR'], ['linear', 'LINEAR'], ['div', 'LINEAR'],
    ];
    for (const [fn, expected] of cases) {
      const r = buildDecoderRecords(snapshot({ pids: [], dids: [did({ decodeFn: fn })] }));
      expect(r[0].decoderType).toBe(expected);
    }
  });

  it('bilinmeyen/eksik decode.fn → UNKNOWN (tahmin YOK)', () => {
    for (const fn of [null, 'quantum', '']) {
      const r = buildDecoderRecords(snapshot({
        pids: [], dids: [did({ decodeFn: fn as string | null })],
      }));
      expect(r[0].decoderType).toBe('UNKNOWN');
      expect(r[0].formulaSummary).toBeNull();
    }
  });

  it('standart PID → CUSTOM ve formül özeti null (makine-okunur spec YOK)', () => {
    const r = buildDecoderRecords(snapshot({ dids: [] }));
    expect(r[0].decoderType).toBe('CUSTOM');
    expect(r[0].formulaSummary).toBeNull();
    expect(r[0].notes).toContain('gövdesi');
  });

  it('çözücüsü olmayan PID kaydı UNKNOWN olur', () => {
    const r = buildDecoderRecords(snapshot({ pids: [pid({ hasDecoder: false })], dids: [] }));
    expect(r[0].decoderType).toBe('UNKNOWN');
  });

  it('formül özeti VERİDEN üretilir ve bounded kalır', () => {
    const lin = buildDecoderRecords(snapshot({
      pids: [], dids: [did({ decodeFn: 'linear', decodeA: 0.01, decodeB: -40, bytes: 2 })],
    }))[0];
    expect(lin.formulaSummary).toBe('AB × 0.01 − 40');

    const dv = buildDecoderRecords(snapshot({
      pids: [], dids: [did({ decodeFn: 'div', decodeA: 10, bytes: 3 })],
    }))[0];
    expect(dv.formulaSummary).toBe('ABC ÷ 10');

    const t = buildDecoderRecords(snapshot({ pids: [], dids: [did({ decodeFn: 'temp40' })] }))[0];
    expect(t.formulaSummary).toBe('A − 40');

    for (const r of buildDecoderRecords(snapshot())) {
      expect((r.formulaSummary ?? '').length).toBeLessThan(80);
    }
  });

  it('etiket tablosu her tip için tanımlı', () => {
    for (const k of Object.keys(DECODER_TYPE_LABEL)) {
      expect(DECODER_TYPE_LABEL[k as keyof typeof DECODER_TYPE_LABEL].length).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 6 — GİZLİLİK: fonksiyon gövdesi / araç verisi SIZMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — fonksiyon gövdesi ve araç verisi SIZMAZ', () => {
  it('kaynak katmanı toString/eval/Function KULLANMAZ', async () => {
    const { readFileSync } = await import('node:fs');
    for (const p of [
      'src/platform/devtools/decoderRegistrySources.ts',
      'src/platform/devtools/decoderRegistryModel.ts',
      'src/components/devtools/screens/DecoderRegistryScreen.tsx',
    ]) {
      const src = stripComments(readFileSync(p, 'utf8'));
      for (const banned of ['toString(', 'eval(', 'new Function', 'Function(']) {
        expect(src).not.toContain(banned);
      }
    }
  });

  it('ham snapshot tipi FONKSİYON alanı taşımaz (yapısal kilit)', () => {
    const s = readDecoderRegistrySnapshot();
    for (const p of s.pids!) {
      for (const v of Object.values(p)) expect(typeof v).not.toBe('function');
      expect(Object.keys(p)).not.toContain('decode');
    }
    for (const d of s.dids!) {
      for (const v of Object.values(d)) expect(typeof v).not.toBe('function');
      expect(Object.keys(d)).not.toContain('decode');
    }
  });

  it('model çıktısında fonksiyon gövdesi izi YOK', () => {
    const s = readDecoderRegistrySnapshot();
    const dump = JSON.stringify(buildDecoderRecords(s));
    for (const frag of ['=>', 'function', 'b[0]', 'return ', 'Math.']) {
      expect(dump).not.toContain(frag);
    }
  });

  it('render çıktısında fonksiyon gövdesi izi YOK', () => {
    const html = renderToStaticMarkup(<DecoderRegistryScreen />);
    for (const frag of ['b[0]', '=&gt;', 'String.fromCharCode']) {
      expect(html).not.toContain(frag);
    }
  });

  it('VIN DEĞERİ, parmak izi veya kullanıcı aracı modele GİRMEZ', () => {
    const s = readDecoderRegistrySnapshot();
    const dump = JSON.stringify({ raw: s, recs: buildDecoderRecords(s) });
    // Gerçek bir VIN deseni (17 hane) HİÇBİR yerde olmamalı
    expect(dump).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    for (const banned of ['vinHash', 'fingerprint', 'plaka', 'apiKey', 'token', 'Bearer']) {
      expect(dump).not.toContain(banned);
    }
  });

  it('kaynak katmanı araç/oturum kaynaklarını IMPORT ETMEZ', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/decoderRegistrySources.ts', 'utf8'));
    for (const banned of [
      'obdService', 'getVehicleFingerprint', 'getOBDDataSnapshot', 'vehicleRepository',
      'sendCommand', 'connectOBD', 'startScan', 'discoveryLive', 'manufacturerPidService',
      'nativePlugin', 'CarLauncher', 'fetch(', 'localStorage', 'setInterval', 'setTimeout',
      'await ',
    ]) expect(src).not.toContain(banned);
  });

  it('UI doğrudan registry import ETMEZ — tek kaynak katmanı', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/DecoderRegistryScreen.tsx', 'utf8'));
    for (const banned of [
      'StandardPidRegistry', 'MANUFACTURER_DID_PROFILES', 'compileVehicleDidProfile',
      'obd/profiles',
    ]) expect(src).not.toContain(banned);
    expect(src).toContain('decoderRegistrySources');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 7 — CANLI REFERANS YOK / MUTASYON YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — registry canlı referansı dışarı çıkmaz', () => {
  it('snapshot kayıtları registry nesneleriyle AYNI referans DEĞİL', () => {
    const s = readDecoderRegistrySnapshot();
    for (const rec of s.pids!) {
      expect(STANDARD_PIDS.indexOf(rec as never)).toBe(-1);
    }
  });

  it('model çalıştıktan sonra gerçek registry DEĞİŞMEZ', () => {
    const beforeSize = STANDARD_PID_MAP.size;
    const beforeIds = STANDARD_PIDS.map((d) => d.pid).join(',');
    const profileSizes = Object.keys(MANUFACTURER_DID_PROFILES).map((k) =>
      MANUFACTURER_DID_PROFILES[k as keyof typeof MANUFACTURER_DID_PROFILES].dids.length).join(',');

    const s = readDecoderRegistrySnapshot();
    const recs = buildDecoderRecords(s);
    buildDecoderSummary(s, recs);
    filterDecoderRecords(recs, { query: 'motor' });

    expect(STANDARD_PID_MAP.size).toBe(beforeSize);
    expect(STANDARD_PIDS.map((d) => d.pid).join(',')).toBe(beforeIds);
    expect(Object.keys(MANUFACTURER_DID_PROFILES).map((k) =>
      MANUFACTURER_DID_PROFILES[k as keyof typeof MANUFACTURER_DID_PROFILES].dids.length).join(','))
      .toBe(profileSizes);
  });

  it('kayıt listesi BOUNDED', () => {
    const many = Array.from({ length: MAX_DECODER_RECORDS + 50 }, (_, i) =>
      pid({ pid: (i % 256).toString(16).padStart(2, '0').toUpperCase() }));
    const recs = buildDecoderRecords(snapshot({ pids: many, dids: [] }));
    expect(recs.length).toBeLessThanOrEqual(MAX_DECODER_RECORDS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 8 — MERGE / OVERRIDE / COLLISION GERÇEĞİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — çakışma davranışı GERÇEK merge kuralından türer', () => {
  /* Repo gerçeği: compileVehicleDidProfile Map'i YALNIZ `did` ile anahtarlar
     (`out.set(did, …)`) → aynı profilde aynı kimlik iki kez tanımlıysa SON yazan
     kazanır; ECU farkı bunu ÖNLEMEZ. Kilit bunu doğrudan derleyiciden doğrular. */
  it('aynı profilde aynı DID iki kez tanımlıysa SON yazan kazanır (derleyiciden)', () => {
    const compiled = compileVehicleDidProfile({
      brand: 'X', source: 'test',
      ecus: [{ id: 'a', name: 'A', tx: '7E0', rx: '7E8' },
             { id: 'b', name: 'B', tx: '7E1', rx: '7E9' }],
      dids: [
        { did: 'F190', ecu: 'a', name: 'ilk', unit: '', bytes: 1, min: 0, max: 1, category: 'x', decode: { fn: 'A' } },
        { did: 'F190', ecu: 'b', name: 'son', unit: '', bytes: 1, min: 0, max: 1, category: 'x', decode: { fn: 'A' } },
      ],
    });
    expect(compiled.size).toBe(1);
    expect(compiled.get('F190')!.ecuId).toBe('b');          // SON yazan
  });

  it('model bunu OVERRIDDEN olarak işaretler ve GİZLEMEZ', () => {
    const recs = buildDecoderRecords(snapshot({
      pids: [],
      dids: [
        did({ did: 'F190', name: 'ilk', ecu: 'a', compiled: false }),
        did({ did: 'F190', name: 'son', ecu: 'b', compiled: true }),
      ],
    }));
    expect(recs.every((r) => r.collision === 'OVERRIDDEN')).toBe(true);
    const sum = buildDecoderSummary(snapshot({ pids: [] }), recs);
    expect(sum.overriddenCount).toBe(2);
  });

  it('ECU referansı çözülemeyen DID derlemede SESSİZCE atlanır — model bunu gösterir', () => {
    const compiled = compileVehicleDidProfile({
      brand: 'X', source: 'test',
      ecus: [{ id: 'a', name: 'A', tx: '7E0', rx: '7E8' }],
      dids: [{ did: 'F190', ecu: 'yok', name: 'x', unit: '', bytes: 1, min: 0, max: 1, category: 'x', decode: { fn: 'A' } }],
    });
    expect(compiled.size).toBe(0);                          // sessizce düştü

    const recs = buildDecoderRecords(snapshot({
      pids: [], dids: [did({ ecu: 'yok', ecuKnown: false, compiled: false })],
    }));
    expect(recs[0].supportStatus).toBe('DROPPED_UNKNOWN_ECU');
    expect(recs[0].notes).toContain('SESSİZCE');
    const sum = buildDecoderSummary(snapshot({ pids: [] }), recs);
    expect(sum.droppedCount).toBe(1);
  });

  it('tekil kayıt UNIQUE kalır — sahte çakışma üretilmez', () => {
    const recs = buildDecoderRecords(snapshot());
    expect(recs.every((r) => r.collision === 'UNIQUE')).toBe(true);
  });

  it('FARKLI profillerdeki aynı kimlik ÇAKIŞMA sayılmaz (profiller birleşmez)', () => {
    const s = snapshot({
      pids: [],
      profiles: [profile({ profileId: 'p1' }), profile({ profileId: 'p2' })],
      dids: [did({ profileId: 'p1', did: 'F190' }), did({ profileId: 'p2', did: 'F190' })],
    });
    const recs = buildDecoderRecords(s);
    expect(recs.every((r) => r.collision === 'UNIQUE')).toBe(true);   // OVERRIDDEN DEĞİL
    const sum = buildDecoderSummary(s, recs);
    expect(sum.overriddenCount).toBe(0);
    expect(sum.crossProfileDuplicates).toBe(1);                       // ayrı sayılır
  });

  it('gerçek registry\'de bugün düşen/üzerine yazılan kayıt YOK (kanıtla)', () => {
    const s = readDecoderRegistrySnapshot();
    const sum = buildDecoderSummary(s, buildDecoderRecords(s));
    expect(sum.droppedCount).toBe(0);
    expect(sum.overriddenCount).toBe(0);
    expect(sum.invalidCount).toBe(0);
    // Her profilde tanımlanan DID sayısı derlenen ile AYNI olmalı
    for (const p of s.profiles!) expect(p.compiledDids).toBe(p.declaredDids);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 9 — TIMER / OBD / NATIVE YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — otomatik timer/polling/OBD çağrısı YOK', () => {
  it('ekran kaynağında timer/abonelik/DOM erişimi YOK', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/DecoderRegistryScreen.tsx', 'utf8'));
    for (const f of [
      'setInterval', 'setTimeout', 'requestAnimationFrame', 'subscribe', 'addListener',
      'addEventListener', 'document.', 'querySelector', 'fetch(',
      'sendCommand', 'connectOBD', 'startScan', 'CarLauncher',
    ]) expect(src).not.toContain(f);
  });

  it('açılışta TEK okuma; yenileme YALNIZ butondan', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/DecoderRegistryScreen.tsx', 'utf8'));
    expect(src).toContain('useState<DecoderRegistryRaw>(() => readDecoderRegistrySnapshot())');
    expect(src).toContain('onClick={refresh}');
    expect(src).toContain('mountedRef.current = false');
    expect(src).toMatch(/if \(mountedRef\.current\) setSnap/);
    expect((src.match(/readDecoderRegistrySnapshot\(\)/g) ?? []).length).toBe(2);
  });

  it('snapshot okuması hiçbir zamanlayıcı kurmaz', () => {
    const iv = vi.spyOn(globalThis, 'setInterval');
    const to = vi.spyOn(globalThis, 'setTimeout');
    readDecoderRegistrySnapshot();
    expect(iv).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });

  /* NOT: yasaklı kelime listesi DAR tutulur — 'OKU' gibi bir parça "KAYNAK OKUNAMADI"
     uyarısıyla da eşleşir ve kilidi anlamsız kılardı. Asıl değişmez: ekranda YENİLE
     dışında TEK BİR eylem düğmesi bile olmaması. */
  it('ekranda tarama/komut butonu YOK (yalnız YENİLE + arama)', () => {
    const html = renderToStaticMarkup(<DecoderRegistryScreen />);
    expect(html).toContain('decoder-refresh');
    expect(html).toContain('decoder-search');
    for (const banned of [
      'TARAMA BAŞLAT', 'SORGULA', 'GÖNDER', 'BAĞLAN', 'DTC SİL', 'KOMUT',
    ]) expect(html).not.toContain(banned);
    // Tek düğme: YENİLE. Arama girdisi ve filtre <select>'leri eylem değildir.
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toContain('type="submit"');
  });

  it('shell katalog görünümünde ekran mount OLMAZ (lazy korunur)', () => {
    const html = renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(html).not.toContain('decoder-summary');
    expect(html).not.toContain('ÇÖZÜCÜ KAYITLARI');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 10 — KATALOG + EŞLEME
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — katalog AVAILABLE ve eşleme doğru', () => {
  it('decoder-registry AVAILABLE, id DEĞİŞMEDİ, developer kategorisinde', () => {
    const t = getCarosLabTool('decoder-registry')!;
    expect(t.id).toBe('decoder-registry');
    expect(t.status).toBe('AVAILABLE');
    expect(t.category).toBe('developer');
    expect(t.note ?? '').toContain('STATİK');
    expect(t.note ?? '').not.toContain('Ekran yok');
  });

  it('ekran eşlemesi lazy chunk döndürür', () => {
    const el = renderAvailableTool('decoder-registry');
    expect(el).not.toBeNull();
    const type = (el as unknown as { type?: { $$typeof?: symbol } }).type;
    expect(type?.$$typeof).toBe(Symbol.for('react.lazy'));
  });

  it('katalog metni doğrulanmamış iddia içermez', () => {
    const t = getCarosLabTool('decoder-registry')!;
    const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
    for (const banned of ['yakında', 'coming soon', 'sorunsuz', 'doğrulandı', 'sahada doğrulandı']) {
      expect(text).not.toContain(banned);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 11 — ÖNCEKİ FAZLAR BOZULMADI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — A4/A5/A6/A7/UX-F1 ve erişim kapısı korunur', () => {
  it('önceki AVAILABLE araçlar hâlâ AVAILABLE ve eşlenmiş', () => {
    for (const id of [
      'kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics', 'mavi-console',
    ] as const) {
      expect(getCarosLabTool(id)!.status).toBe('AVAILABLE');
      expect(renderAvailableTool(id)).not.toBeNull();
    }
  });

  it('UX-F1 giriş odağı korunur', () => {
    const q = renderAvailableTool('queue-monitor') as unknown as { type: unknown; props: { focus?: string } };
    const p = renderAvailableTool('poll-scheduler') as unknown as { type: unknown; props: { focus?: string } };
    expect(q.type).toBe(p.type);
    expect(q.props.focus).toBe('queue-monitor');
    expect(p.props.focus).toBe('poll-scheduler');
  });

  it('Çözücü Kayıtları başka hiçbir ekranla karışmaz', () => {
    const d = renderAvailableTool('decoder-registry') as unknown as { type: unknown };
    for (const id of [
      'kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics', 'mavi-console',
      'queue-monitor', 'discovery-database',
    ] as const) {
      expect((renderAvailableTool(id) as unknown as { type: unknown }).type).not.toBe(d.type);
    }
  });

  it('geliştirici erişim kapısı hâlâ tek build otoritesinde', async () => {
    const { isCarosLabAllowed } = await import('../platform/devtools/carosLabGate');
    expect(isCarosLabAllowed({ developerFeaturesEnabled: true })).toBe(true);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
    expect(isCarosLabAllowed(null)).toBe(false);
  });
});
