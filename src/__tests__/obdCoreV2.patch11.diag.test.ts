/**
 * obdCoreV2.patch11.diag.test.ts — Patch 11 (Teşhis derinliği: Mode 07/0A DTC,
 * Mode 02 freeze frame, readiness monitörleri + enum PID'ler).
 *
 * NOT: Mode 03/07/0A ham yanıt parse'ı (CAN sayaçlı / K-line dolgulu / çok-ECU /
 * Mode 0A "desteklenmiyor" açık-negatif ayrımı) NATIVE (Java) katmanda test edilir —
 * bkz. android/app/src/test/java/com/cockpitos/pro/obd/ElmProtocolTest.java. Bu dosya
 * yalnızca TS orkestrasyon katmanını (fail-soft birleştirme, enum/bit çözümü, freeze
 * frame registry-formül tutarlılığı) kilitler.
 *
 * Kilitler:
 *  - decodePid01: MIL + DTC sayısı, benzin/dizel B-bayt (bit3) ayrımı, allReady hesabı.
 *  - decodePid03 / decodePid1C: enum çözümü + bilinmeyen kod fallback'i.
 *  - readFreezeFrame: FF yok (dtc:null) → null; PID değerleri StandardPidRegistry.decode
 *    İLE AYNI sonucu verir (kopya formül yok); tek PID hatası diğerlerini engellemez.
 *  - readAllDTCs: stored/pending/permanent fail-soft birleşimi; permanentSupported false
 *    ayrımı (mod yok / eski plugin) "kod yok"tan ayrışır.
 *  - readDiagnosticStatus: PID 01 okunamazsa null; PID 03/1C hatası diğer alanları etkilemez.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({
  isNative: true,
  readDTC: vi.fn(async () => ({ codes: [] as string[] })),
  readPendingDTC: vi.fn(async () => ({ codes: [] as string[] })) as unknown as (() => Promise<{ codes: string[] }>) | undefined,
  readPermanentDTC: vi.fn(async () => ({ codes: [] as string[], supported: true })) as unknown as (() => Promise<{ codes: string[]; supported: boolean }>) | undefined,
  readFreezeFrameDtc: vi.fn(async () => ({ dtc: null as string | null })) as unknown as (() => Promise<{ dtc: string | null }>) | undefined,
  readFreezeFramePid: vi.fn(async (_opts: { pid: string }) => ({ data: null as string | null })) as unknown as ((opts: { pid: string }) => Promise<{ data: string | null }>) | undefined,
  readPidOnce: vi.fn(async (_opts: { pid: string }) => ({ data: null as string | null })) as unknown as ((opts: { pid: string }) => Promise<{ data: string | null }>) | undefined,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => M.isNative) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDTC: (...a: unknown[]) => M.readDTC(...(a as [])),
    get readPendingDTC() { return M.readPendingDTC; },
    get readPermanentDTC() { return M.readPermanentDTC; },
    get readFreezeFrameDtc() { return M.readFreezeFrameDtc; },
    get readFreezeFramePid() { return M.readFreezeFramePid; },
    get readPidOnce() { return M.readPidOnce; },
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import { readAllDTCs, readFreezeFrame } from '../platform/dtcService';
import {
  decodePid01, decodePid03, decodePid1C, readDiagnosticStatus,
} from '../platform/obd/StandardPidEnums';
import { decodeStandardPid } from '../platform/obd/StandardPidRegistry';

beforeEach(() => {
  M.isNative = true;
  M.readDTC = vi.fn(async () => ({ codes: [] }));
  M.readPendingDTC = vi.fn(async () => ({ codes: [] }));
  M.readPermanentDTC = vi.fn(async () => ({ codes: [], supported: true }));
  M.readFreezeFrameDtc = vi.fn(async () => ({ dtc: null }));
  M.readFreezeFramePid = vi.fn(async () => ({ data: null }));
  M.readPidOnce = vi.fn(async () => ({ data: null }));
});

/* ── PID 0x01 — MIL / DTC sayısı / readiness ─────────────────────────────── */

describe('Patch 11C — decodePid01', () => {
  it('benzin (spark): MIL açık + 1 DTC + tüm desteklenen monitörler hazır → allReady true', () => {
    // A=0x81 (MIL + 1 DTC), B=0x07 (misfire/yakıt/kapsamlı DESTEKLENİYOR, hepsi HAZIR — bit4-6=0, bit3=0→benzin)
    // C=0x01 (Katalizör destekleniyor), D=0x00 (Katalizör hazır)
    const r = decodePid01([0x81, 0x07, 0x01, 0x00]);
    expect(r.mil).toBe(true);
    expect(r.dtcCount).toBe(1);
    expect(r.ignitionType).toBe('spark');
    const cat = r.monitors.find((m) => m.monitor === 'Katalizör');
    expect(cat).toMatchObject({ available: true, ready: true });
    // Dizel-özel monitör spark listede YOK
    expect(r.monitors.find((m) => m.monitor === 'NOx/SCR Sistemi')).toBeUndefined();
    expect(r.allReady).toBe(true);
  });

  it('dizel (compression): B bayt bit3 seti → dizel monitör kümesi, tamamlanmamış monitör allReady false yapar', () => {
    // B=0x0F (bit3=1 → dizel, misfire/yakıt/kapsamlı destekleniyor+hazır)
    // C=0x02 (NOx/SCR destekleniyor), D=0x02 (NOx/SCR HAZIR DEĞİL)
    const r = decodePid01([0x00, 0x0f, 0x02, 0x02]);
    expect(r.ignitionType).toBe('compression');
    const nox = r.monitors.find((m) => m.monitor === 'NOx/SCR Sistemi');
    expect(nox).toMatchObject({ available: true, ready: false });
    // Benzin-özel monitör dizel listede YOK
    expect(r.monitors.find((m) => m.monitor === 'Katalizör')).toBeUndefined();
    expect(r.allReady).toBe(false);
  });

  it('MIL kapalı, hiçbir monitör desteklenmiyor → allReady dürüstçe false (bilinmiyor sayılır)', () => {
    const r = decodePid01([0x00, 0x00, 0x00, 0x00]);
    expect(r.mil).toBe(false);
    expect(r.dtcCount).toBe(0);
    expect(r.allReady).toBe(false);
  });

  it('eksik bayt → hata fırlatır (çağıran yakalar)', () => {
    expect(() => decodePid01([0x00, 0x00])).toThrow();
  });
});

/* ── PID 0x03 / 0x1C — enum çözümü ───────────────────────────────────────── */

describe('Patch 11C — decodePid03 / decodePid1C', () => {
  it('PID 03: kapalı çevrim (0x02), tek bankalı araçta bank2 null', () => {
    const r = decodePid03([0x02]);
    expect(r.bank1?.code).toBe('kapali_cevrim');
    expect(r.bank2).toBeNull();
  });

  it('PID 03: iki bankalı araç, farklı durumlar', () => {
    const r = decodePid03([0x01, 0x02]);
    expect(r.bank1?.code).toBe('acik_cevrim_yetersiz_sicaklik');
    expect(r.bank2?.code).toBe('kapali_cevrim');
  });

  it('PID 1C: bilinen kod (EOBD) doğru etiketlenir', () => {
    expect(decodePid1C([6]).label).toMatch(/EOBD/);
  });

  it('PID 1C: bilinmeyen/rezerve kod dürüst fallback döner', () => {
    expect(decodePid1C([99]).label).toMatch(/Bilinmeyen|rezerve/);
  });
});

/* ── readDiagnosticStatus — orkestrasyon + fail-soft ─────────────────────── */

describe('Patch 11C — readDiagnosticStatus', () => {
  it('PID 01 okunamazsa (data:null) dürüstçe null döner', async () => {
    M.readPidOnce = vi.fn(async () => ({ data: null }));
    expect(await readDiagnosticStatus()).toBeNull();
  });

  it('web/non-native ortamda null döner', async () => {
    M.isNative = false;
    expect(await readDiagnosticStatus()).toBeNull();
  });

  it('eski native plugin (readPidOnce yok) → null', async () => {
    M.readPidOnce = undefined;
    expect(await readDiagnosticStatus()).toBeNull();
  });

  it('PID 01 başarılı, PID 03 hata verir → diğer alanlar yine döner (fail-soft)', async () => {
    M.readPidOnce = vi.fn(async (opts: { pid: string }) => {
      if (opts.pid === '01') return { data: '810701 00' };
      if (opts.pid === '03') throw new Error('simulated 03 failure');
      if (opts.pid === '1C') return { data: '06' };
      return { data: null };
    });
    const r = await readDiagnosticStatus();
    expect(r).not.toBeNull();
    expect(r!.mil).toBe(true);
    expect(r!.dtcCount).toBe(1);
    expect(r!.obdStandard).toMatch(/EOBD/);
    // PID 03 hata verdi → varsayılana düşer, çökmedi
    expect(r!.fuelSystemStatus).toEqual({ bank1: null, bank2: null });
  });
});

/* ── readFreezeFrame — registry formül tutarlılığı + fail-soft ───────────── */

describe('Patch 11B — readFreezeFrame', () => {
  it('freeze frame yok (dtc:null) → null', async () => {
    M.readFreezeFrameDtc = vi.fn(async () => ({ dtc: null }));
    expect(await readFreezeFrame()).toBeNull();
  });

  it('eski native plugin (readFreezeFrameDtc yok) → null', async () => {
    M.readFreezeFrameDtc = undefined;
    expect(await readFreezeFrame()).toBeNull();
  });

  it('PID değeri StandardPidRegistry.decode İLE AYNI sonucu verir (kopya formül yok)', async () => {
    M.readFreezeFrameDtc = vi.fn(async () => ({ dtc: 'P0301' }));
    M.readFreezeFramePid = vi.fn(async (opts: { pid: string }) => {
      if (opts.pid === '0C') return { data: '1AF8' }; // RPM ham veri
      if (opts.pid === '05') return { data: '5A' };    // soğutma sıcaklığı
      return { data: null };
    });
    const r = await readFreezeFrame();
    expect(r).not.toBeNull();
    expect(r!.dtc).toBe('P0301');

    const rpm = r!.values.find((v) => v.pid === '0C');
    const temp = r!.values.find((v) => v.pid === '05');
    expect(rpm?.value).toBe(decodeStandardPid('0C', '1AF8'));
    expect(temp?.value).toBe(decodeStandardPid('05', '5A'));
  });

  it('bir PID hata verir/desteklenmiyor → diğerleri yine gelir (fail-soft)', async () => {
    M.readFreezeFrameDtc = vi.fn(async () => ({ dtc: 'P0171' }));
    M.readFreezeFramePid = vi.fn(async (opts: { pid: string }) => {
      if (opts.pid === '0C') throw new Error('simulated read failure');
      if (opts.pid === '0D') return { data: '32' }; // hız
      return { data: null };
    });
    const r = await readFreezeFrame();
    expect(r).not.toBeNull();
    expect(r!.values.find((v) => v.pid === '0C')).toBeUndefined();
    expect(r!.values.find((v) => v.pid === '0D')?.value).toBe(decodeStandardPid('0D', '32'));
  });
});

/* ── readAllDTCs — stored/pending/permanent fail-soft birleşimi ──────────── */

describe('Patch 11A — readAllDTCs', () => {
  it('web/non-native ortamda boş sonuç döner', async () => {
    M.isNative = false;
    const r = await readAllDTCs();
    expect(r).toEqual({
      codes: [],
      permanentSupported: true,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
    });
  });

  it('üç mod da başarılı → status alanıyla ayrışan birleşik liste', async () => {
    M.readDTC = vi.fn(async () => ({ codes: ['P0171'] }));
    M.readPendingDTC = vi.fn(async () => ({ codes: ['P0300'] }));
    M.readPermanentDTC = vi.fn(async () => ({ codes: ['P0420'], supported: true }));

    const r = await readAllDTCs();
    expect(r.permanentSupported).toBe(true);
    expect(r.codes.find((c) => c.code === 'P0171')?.status).toBe('stored');
    expect(r.codes.find((c) => c.code === 'P0300')?.status).toBe('pending');
    expect(r.codes.find((c) => c.code === 'P0420')?.status).toBe('permanent');
  });

  it('pending okuma hata verir → stored/permanent yine döner (fail-soft)', async () => {
    M.readDTC = vi.fn(async () => ({ codes: ['P0171'] }));
    M.readPendingDTC = vi.fn(async () => { throw new Error('simulated pending failure'); });
    M.readPermanentDTC = vi.fn(async () => ({ codes: [], supported: true }));

    const r = await readAllDTCs();
    expect(r.codes.find((c) => c.code === 'P0171')?.status).toBe('stored');
    expect(r.codes.some((c) => c.status === 'pending')).toBe(false);
    expect(r.permanentSupported).toBe(true);
  });

  it('permanent mod desteklenmiyor (supported:false) → "kod yok"tan AYRI işaretlenir', async () => {
    M.readPermanentDTC = vi.fn(async () => ({ codes: [], supported: false }));
    const r = await readAllDTCs();
    expect(r.permanentSupported).toBe(false);
    expect(r.codes.some((c) => c.status === 'permanent')).toBe(false);
  });

  it('eski native plugin (readPendingDTC/readPermanentDTC yok) → sessizce atlanır, çökmez', async () => {
    M.readDTC = vi.fn(async () => ({ codes: ['P0171'] }));
    M.readPendingDTC = undefined;
    M.readPermanentDTC = undefined;

    const r = await readAllDTCs();
    expect(r.permanentSupported).toBe(false);
    expect(r.codes.find((c) => c.code === 'P0171')?.status).toBe('stored');
    expect(r.codes.length).toBe(1);
  });

  it('stored okuma hata verirse bile fonksiyon çökmez, boş stored ile devam eder', async () => {
    M.readDTC = vi.fn(async () => { throw new Error('simulated stored failure'); });
    M.readPendingDTC = vi.fn(async () => ({ codes: ['P0300'] }));
    const r = await readAllDTCs();
    expect(r.codes.some((c) => c.status === 'stored')).toBe(false);
    expect(r.codes.find((c) => c.code === 'P0300')?.status).toBe('pending');
  });
});
