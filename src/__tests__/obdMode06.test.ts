/**
 * obdMode06.test — P0-OBD-05 · SERVİS 06 kilitleri.
 *
 * Görev şartı: PASS · FAIL · NO DATA · bozuk yanıt · sınır kenarı · çoklu ECU
 * ayrımı · reconnect sonrası eski sonuç · desteklenmeyen monitör · Mode 01
 * polling'in ETKİLENMEMESİ — hepsi kilitlenir.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseMode06Body, parseMode06SupportedMids, mode06MonitorFamily, UAS_TABLE,
} from '../platform/obd/mode06';
import {
  buildTestRows, buildOverview, buildHeadline, marginPercent, midTone,
} from '../platform/devtools/mode06LabModel';
import type { Mode06Scan } from '../platform/obd/mode06Service';

/* ── Kayıt üreticileri (9 baytlık test kaydı) ─────────────────────────────── */

const h2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const h4 = (n: number) => (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

/** MID TID UAS VAL(2) MIN(2) MAX(2) — 9 bayt. */
function rec(mid: number, tid: number, uas: number, val: number, min: number, max: number): string {
  return h2(mid) + h2(tid) + h2(uas) + h4(val) + h4(min) + h4(max);
}

/* UAS 0x0C = voltaj ×0.01 V (tanınan) · 0x4D = tabloda YOK (tanınmayan). */
const UAS_V = 0x0C;
const UAS_UNKNOWN = 0x4D;

/* ── 1. Çözümleme: PASS / FAIL / sınır kenarı ─────────────────────────────── */

describe('P0-OBD-05 · test sonucu ECU sınırlarından türer', () => {
  it('sınırlar İÇİNDE → PASS ve değer ölçeklenir', () => {
    const { tests, malformed } = parseMode06Body(rec(0x01, 0x81, UAS_V, 1234, 1000, 1500));
    expect(malformed).toBe(false);
    expect(tests).toHaveLength(1);
    const t = tests[0]!;
    expect(t.result).toBe('PASS');
    expect(t.mid).toBe('01');
    expect(t.tid).toBe('81');
    expect(t.value).toBeCloseTo(12.34, 4);
    expect(t.min).toBeCloseTo(10, 4);
    expect(t.max).toBeCloseTo(15, 4);
    expect(t.unit).toBe('V');
    expect(t.interpretable).toBe(true);
  });

  it('sınırların DIŞINDA → FAIL', () => {
    expect(parseMode06Body(rec(0x01, 0x81, UAS_V, 1600, 1000, 1500)).tests[0]!.result).toBe('FAIL');
    expect(parseMode06Body(rec(0x01, 0x81, UAS_V, 900,  1000, 1500)).tests[0]!.result).toBe('FAIL');
  });

  it('SINIR KENARI dahildir — min ve max tam değerinde PASS', () => {
    expect(parseMode06Body(rec(0x01, 0x81, UAS_V, 1000, 1000, 1500)).tests[0]!.result).toBe('PASS');
    expect(parseMode06Body(rec(0x01, 0x81, UAS_V, 1500, 1000, 1500)).tests[0]!.result).toBe('PASS');
    // Bir birim dışarı → FAIL (kenarın hangi tarafta olduğu belirsiz bırakılmaz)
    expect(parseMode06Body(rec(0x01, 0x81, UAS_V, 1501, 1000, 1500)).tests[0]!.result).toBe('FAIL');
    expect(parseMode06Body(rec(0x01, 0x81, UAS_V, 999,  1000, 1500)).tests[0]!.result).toBe('FAIL');
  });

  it('İŞARETLİ ölçekte negatif değer doğru çözülür', () => {
    // 0x96: ×0.1 °C, işaretli. 0xFFF6 = -10 → -1.0 °C
    const t = parseMode06Body(rec(0x21, 0x01, 0x96, 0xFFF6, 0xFF9C, 0x000A)).tests[0]!;
    expect(t.rawValue).toBe(-10);
    expect(t.value).toBeCloseTo(-1, 4);
    expect(t.result).toBe('PASS');   // -100 ≤ -10 ≤ 10
  });

  it('BİLİNMEYEN ölçekte hüküm VERİLMEZ — "geçti" SAYILMAZ', () => {
    const t = parseMode06Body(rec(0x01, 0x81, UAS_UNKNOWN, 1234, 1000, 1500)).tests[0]!;
    expect(t.result).toBe('UNKNOWN');
    expect(t.result).not.toBe('PASS');
    expect(t.interpretable).toBe(false);
    expect(t.value).toBeNull();
    expect(t.unit).toBeNull();
    expect(t.rawValue).toBe(1234);   // ham değer KAYBOLMAZ
  });

  it('birden çok kayıt sırayla çözülür', () => {
    const body = rec(0x01, 0x81, UAS_V, 1200, 1000, 1500)
               + rec(0x01, 0x82, UAS_V, 1900, 1000, 1500);
    const { tests, malformed } = parseMode06Body(body);
    expect(malformed).toBe(false);
    expect(tests.map((t) => t.result)).toEqual(['PASS', 'FAIL']);
  });
});

/* ── 2. BOZUK YANIT: "test yok" değil "okunamadı" ─────────────────────────── */

describe('P0-OBD-05 · bozuk yanıt normal sayılmaz', () => {
  it('9\'un katı OLMAYAN gövde malformed işaretlenir', () => {
    const r = parseMode06Body(rec(0x01, 0x81, UAS_V, 1200, 1000, 1500) + 'AABB');
    expect(r.malformed).toBe(true);
    expect(r.tests).toHaveLength(1);   // TAM kayıt korunur, artık ATILIR
  });

  it('kısmi tek kayıt HİÇ test üretmez (uydurma kayıt YOK)', () => {
    const r = parseMode06Body('0181 0C 04D2');
    expect(r.tests).toHaveLength(0);
    expect(r.malformed).toBe(true);
  });

  it('boş gövde malformed — sessizce "test yok" DEMEZ', () => {
    const r = parseMode06Body('');
    expect(r.tests).toHaveLength(0);
    expect(r.malformed).toBe(true);
  });

  it('hex olmayan karakterler temizlenir, kalan bozuksa malformed', () => {
    const r = parseMode06Body('ZZ:!!');
    expect(r.tests).toHaveLength(0);
    expect(r.malformed).toBe(true);
  });
});

/* ── 3. Desteklenen MID keşfi ─────────────────────────────────────────────── */

describe('P0-OBD-05 · desteklenen monitör keşfi', () => {
  it('bitmask çözülür (Mode 01 PID 00 ile AYNI desen)', () => {
    // 0x80000000 → yalnız base+1 destekli
    expect([...parseMode06SupportedMids('00', '80000000')]).toEqual(['01']);
    const s = parseMode06SupportedMids('00', 'C0000000');
    expect([...s].sort()).toEqual(['01', '02']);
  });

  it('taban kaydırması uygulanır', () => {
    expect([...parseMode06SupportedMids('20', '80000000')]).toEqual(['21']);
  });

  it('kısa/bozuk bitmask BOŞ küme döner — uydurma destek listesi YOK', () => {
    expect(parseMode06SupportedMids('00', '80').size).toBe(0);
    expect(parseMode06SupportedMids('ZZ', '80000000').size).toBe(0);
    expect(parseMode06SupportedMids('00', '').size).toBe(0);
  });

  it('desteklenmeyen MID keşifte YER ALMAZ', () => {
    const s = parseMode06SupportedMids('00', '80000000');
    expect(s.has('02')).toBe(false);
    expect(s.has('21')).toBe(false);
  });
});

/* ── 4. Monitör aileleri: ad UYDURULMAZ ───────────────────────────────────── */

describe('P0-OBD-05 · monitör aileleri', () => {
  it('standart aralıklar adlandırılır', () => {
    expect(mode06MonitorFamily(0x01)).toContain('O2');
    expect(mode06MonitorFamily(0x21)).toContain('Katalizör');
    expect(mode06MonitorFamily(0x31)).toContain('EGR');
    expect(mode06MonitorFamily(0x3A)).toContain('ısıtıcı');
    expect(mode06MonitorFamily(0xA2)).toContain('misfire');
  });

  it('üretici aralığı (0xF0+) ve tanımsız MID için ad UYDURULMAZ', () => {
    expect(mode06MonitorFamily(0xF1)).toBeNull();
    expect(mode06MonitorFamily(0x60)).toBeNull();
  });

  it('UAS tablosu yalnız TANINAN kimlikleri içerir; gerisi yorumlanamaz', () => {
    expect(UAS_TABLE[UAS_V]).toBeDefined();
    expect(UAS_TABLE[UAS_UNKNOWN]).toBeUndefined();
  });
});

/* ── 5. LAB modeli: durum karışmaz ────────────────────────────────────────── */

describe('P0-OBD-05 · LAB modeli dürüstlüğü', () => {
  it('NO DATA ve bozuk yanıt "ok" TONUNDA gösterilmez', () => {
    expect(midTone('ok')).toBe('ok');
    expect(midTone('no_data')).not.toBe('ok');
    expect(midTone('malformed')).not.toBe('ok');
    expect(midTone('error')).not.toBe('ok');
  });

  it('yorumlanamayan test HAM değer ve GEREKÇE gösterir', () => {
    const { tests } = parseMode06Body(rec(0x01, 0x81, UAS_UNKNOWN, 1234, 1000, 1500));
    const row = buildTestRows({ mid: '01', family: null, status: 'ok', tests, raw: null })[0]!;
    expect(row.value).toBe('ham 1234');
    expect(row.marginPct).toBeNull();
    expect(row.note).toContain('tanınmıyor');
  });

  it('sınıra yakın PASS ayrıca UYARILIR (Mode 06\'nın asıl değeri)', () => {
    // band 1000..1500, değer 1480 → sınıra çok yakın
    const { tests } = parseMode06Body(rec(0x01, 0x81, UAS_V, 1480, 1000, 1500));
    expect(marginPercent(tests[0]!)).toBeLessThanOrEqual(20);
    const row = buildTestRows({ mid: '01', family: null, status: 'ok', tests, raw: null })[0]!;
    expect(row.result).toBe('PASS');
    expect(row.note).toContain('Sınıra yakın');
  });

  it('bandın ortasındaki PASS uyarı ÜRETMEZ', () => {
    const { tests } = parseMode06Body(rec(0x01, 0x81, UAS_V, 1250, 1000, 1500));
    expect(marginPercent(tests[0]!)).toBe(100);
    expect(buildTestRows({ mid: '01', family: null, status: 'ok', tests, raw: null })[0]!.note).toBeNull();
  });

  it('başlık "arıza yok" DEMEZ; okunamayan durumu açıkça yazar', () => {
    const empty: Mode06Scan = {
      epoch: 1, atMs: 1, bridgeMissing: false,
      ecus: [{ ecuLabel: 'E', ecuTx: '7E0', ecuRx: '7E8', status: 'unsupported',
        supportedCount: 0, truncated: 0, mids: [] }],
    };
    const h = buildHeadline(empty, false);
    expect(h.text).toContain('sorulamadı');
    expect(h.text).not.toMatch(/arıza yok|temiz|sağlıklı/i);
  });

  it('FAIL varsa başlık bunu KESİN TEŞHİS diye sunmaz', () => {
    const { tests } = parseMode06Body(rec(0x01, 0x81, UAS_V, 1600, 1000, 1500));
    const scan: Mode06Scan = {
      epoch: 1, atMs: 1, bridgeMissing: false,
      ecus: [{ ecuLabel: 'E', ecuTx: '7E0', ecuRx: '7E8', status: 'ok',
        supportedCount: 1, truncated: 0,
        mids: [{ mid: '01', family: null, status: 'ok', tests, raw: null }] }],
    };
    const h = buildHeadline(scan, false);
    expect(h.tone).toBe('bad');
    expect(h.text).toContain('sınırının DIŞINDA');
    expect(h.text).not.toMatch(/arızalı|bozuk|kesin/i);
  });

  it('köprü yoksa bunu AÇIKÇA söyler (sessiz boş ekran YOK)', () => {
    const h = buildHeadline({ epoch: 1, atMs: 1, ecus: [], bridgeMissing: true }, false);
    expect(h.text).toContain('KÖPRÜ YOK');
  });
});

/* ── 6. ÇOKLU ECU: sonuçlar karışmaz ──────────────────────────────────────── */

describe('P0-OBD-05 · çoklu ECU provenance', () => {
  const a = parseMode06Body(rec(0x01, 0x81, UAS_V, 1200, 1000, 1500)).tests;
  const b = parseMode06Body(rec(0x21, 0x01, UAS_V, 1600, 1000, 1500)).tests;
  const scan: Mode06Scan = {
    epoch: 1, atMs: 1, bridgeMissing: false,
    ecus: [
      { ecuLabel: 'Motor (ECM)', ecuTx: '7E0', ecuRx: '7E8', status: 'ok',
        supportedCount: 1, truncated: 0, mids: [{ mid: '01', family: 'O2', status: 'ok', tests: a, raw: null }] },
      { ecuLabel: 'ECU 7E1', ecuTx: '7E1', ecuRx: '7E9', status: 'ok',
        supportedCount: 1, truncated: 0, mids: [{ mid: '21', family: 'Kat', status: 'ok', tests: b, raw: null }] },
    ],
  };

  it('her sonuç KENDİ ECU kaydında kalır', () => {
    expect(scan.ecus[0]!.mids[0]!.tests[0]!.mid).toBe('01');
    expect(scan.ecus[1]!.mids[0]!.tests[0]!.mid).toBe('21');
    expect(scan.ecus[0]!.mids.some((m) => m.mid === '21')).toBe(false);
    expect(scan.ecus[1]!.mids.some((m) => m.mid === '01')).toBe(false);
  });

  it('ECU etiketi ve header sonuçla birlikte TAŞINIR (provenance)', () => {
    expect(scan.ecus[0]!.ecuLabel).toBe('Motor (ECM)');
    expect(scan.ecus[0]!.ecuTx).toBe('7E0');
    expect(scan.ecus[1]!.ecuTx).toBe('7E1');
  });

  it('özet iki ECU\'yu birlikte sayar ama ayrımı bozmaz', () => {
    const o = buildOverview(scan);
    expect(o.ecuCount).toBe(2);
    expect(o.pass).toBe(1);
    expect(o.fail).toBe(1);
  });

  it('bütçe dışı kalan MID adedi sessizce GİZLENMEZ', () => {
    const s2: Mode06Scan = { ...scan, ecus: [{ ...scan.ecus[0]!, truncated: 7 }] };
    expect(buildOverview(s2).truncated).toBe(7);
  });
});

/* ── 7. Servis: NO DATA · reconnect · desteklenmeyen · köprü yok ──────────── */

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));

const epochMock = vi.fn(() => 1);
vi.mock('../platform/obdService', () => ({
  getObdSessionEpoch: () => epochMock(),
}));

const readMock = vi.fn();
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { get readMode06() { return readMock.getMockImplementation() ? readMock : undefined; } },
}));

vi.mock('../platform/obd/multiEcuScan', () => ({
  discoverEcus: async () => ({
    ecus: [{ label: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8', addressBits: 11, role: 'engine' }],
    probedAt: 1, probeEmpty: false,
  }),
}));

async function svc() { return import('../platform/obd/mode06Service'); }

describe('P0-OBD-05 · servis davranışı', () => {
  beforeEach(async () => {
    (await svc())._resetMode06ForTest();
    readMock.mockReset();
    epochMock.mockReturnValue(1);
  });

  it('ECU SUSARSA (NO DATA) sonuç "no_data" — PASS/NORMAL DEĞİL', async () => {
    const m = await svc();
    readMock.mockImplementation(async ({ mid }: { mid: string }) =>
      mid === '00' ? { data: '80000000', kind: 'OK' } : { data: null, kind: 'NO_DATA' });
    const scan = await m.runMode06Scan();
    const mid = scan.ecus[0]!.mids[0]!;
    expect(mid.status).toBe('no_data');
    expect(mid.tests).toHaveLength(0);
    expect(m.summarizeMode06(scan).pass).toBe(0);
    expect(m.summarizeMode06(scan).noData).toBe(1);
  });

  it('BOZUK yanıt "malformed" — "test yok" SAYILMAZ', async () => {
    const m = await svc();
    readMock.mockImplementation(async ({ mid }: { mid: string }) =>
      mid === '00' ? { data: '80000000', kind: 'OK' } : { data: 'AABBCC', kind: 'OK' });
    const scan = await m.runMode06Scan();
    expect(scan.ecus[0]!.mids[0]!.status).toBe('malformed');
    expect(m.summarizeMode06(scan).malformed).toBe(1);
  });

  it('DESTEKLENMEYEN MID hiç SORULMAZ (uydurma sorgu yok)', async () => {
    const m = await svc();
    readMock.mockImplementation(async ({ mid }: { mid: string }) =>
      mid === '00' ? { data: '80000000', kind: 'OK' }   // yalnız MID 01 destekli
                   : { data: rec(0x01, 0x81, UAS_V, 1200, 1000, 1500), kind: 'OK' });
    await m.runMode06Scan();
    const asked = readMock.mock.calls.map((c) => (c[0] as { mid: string }).mid);
    expect(asked).toContain('01');
    expect(asked).not.toContain('02');
    expect(asked).not.toContain('21');
  });

  it('ECU Mode 06\'ya HİÇ yanıt vermezse "unsupported" — test yok DEĞİL', async () => {
    const m = await svc();
    readMock.mockImplementation(async () => ({ data: null, kind: 'NO_DATA' }));
    const scan = await m.runMode06Scan();
    expect(scan.ecus[0]!.status).toBe('unsupported');
    expect(scan.ecus[0]!.mids).toHaveLength(0);
  });

  it('RECONNECT sonrası eski sonuç BAYAT işaretlenir', async () => {
    const m = await svc();
    readMock.mockImplementation(async ({ mid }: { mid: string }) =>
      mid === '00' ? { data: '80000000', kind: 'OK' }
                   : { data: rec(0x01, 0x81, UAS_V, 1200, 1000, 1500), kind: 'OK' });
    await m.runMode06Scan();
    expect(m.getMode06Scan().stale).toBe(false);

    epochMock.mockReturnValue(2);   // yeni OBD oturumu (başka araç olabilir)
    const after = m.getMode06Scan();
    expect(after.stale).toBe(true);
    expect(after.scan).not.toBeNull();          // sonuç SİLİNMEZ…
    expect(buildHeadline(after.scan, true).text).toContain('BAYAT');   // …ama canlı sanılamaz
  });

  it('tarama sürerken ikinci çağrı hattı İKİ KEZ meşgul etmez', async () => {
    const m = await svc();
    let resolveFirst: (v: unknown) => void = () => {};
    readMock.mockImplementation(() => new Promise((r) => { resolveFirst = r; }));
    const p1 = m.runMode06Scan();
    expect(m.isMode06ScanRunning()).toBe(true);
    const p2 = m.runMode06Scan();          // NO-OP dönmeli
    /* İlk okuma HENÜZ gönderilmemiş olabilir (ECU keşfi bir mikro-görev bekletir).
       Sabit bir gecikme yerine olayın KENDİSİ beklenir — zamana bağlı test yazmayız. */
    for (let i = 0; i < 200 && readMock.mock.calls.length === 0; i++) await Promise.resolve();
    expect(readMock.mock.calls.length).toBe(1);   // ikinci çağrı hattı MEŞGUL ETMEDİ
    resolveFirst({ data: null, kind: 'NO_DATA' });
    await Promise.all([p1, p2]);
    expect(m.isMode06ScanRunning()).toBe(false);
  });

  it('köprü YOKSA tarama yapılmaz ve bu AÇIKÇA bildirilir', async () => {
    const m = await svc();
    readMock.mockReset();                   // getter undefined döner
    const scan = await m.runMode06Scan();
    expect(scan.bridgeMissing).toBe(true);
    expect(scan.ecus).toHaveLength(0);
  });
});

/* ── 8. Mode 01 sıcak poll'u ETKİLENMEZ ───────────────────────────────────── */

describe('P0-OBD-05 · Mode 01 polling bozulmaz', () => {
  it('servis kendiliğinden ÇALIŞMAZ: timer/abonelik/scheduleTask YOK', () => {
    /* Yapısal kilit: talep-güdümlü olmasının tek garantisi budur. Bir timer
       eklenirse Mode 06 arka planda hatta çıkar ve hız/devir turunu böler. */
    const src = readFileSync(resolve(process.cwd(), 'src/platform/obd/mode06Service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(src).not.toContain('setInterval');
    expect(src).not.toContain('setTimeout');
    expect(src).not.toContain('scheduleTask');
    expect(src).not.toContain('onOBDData');
  });

  it('servis Mode 01 poll listesine DOKUNMAZ', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/platform/obd/mode06Service.ts'), 'utf8');
    expect(src).not.toContain('setObdExtendedPids');
    expect(src).not.toContain('setObdPollProfile');
    expect(src).not.toContain('setObdDiagnosticBurst');
    expect(src).not.toContain('watchPid');
  });

  it('YAZMA/AKTÜATÖR yolu eklenmemiş', () => {
    const all = readFileSync(resolve(process.cwd(), 'src/platform/obd/mode06Service.ts'), 'utf8')
      + readFileSync(resolve(process.cwd(), 'src/platform/obd/mode06.ts'), 'utf8');
    for (const forbidden of ['writeDid', 'actuator', 'routineControl', 'clearDtc', 'sendRaw']) {
      expect(all).not.toContain(forbidden);
    }
  });
});
