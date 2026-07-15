/**
 * OBD-OS-F2-2/F2-3/F2-4 — Çoklu-ECU tarama orkestrasyonu.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *  - Her ECU'ya KENDİ tx/rx header'ıyla gidilir; bir ECU'nun kodu BAŞKA ECU'ya sızmaz (F2-2).
 *  - Keşfedilen HER ECU'da Mode 03/07/0A okunur; kodlar provenance (ECU) etiketli (F2-3).
 *  - Bir ECU/mod düşse tarama DURMAZ, kısmi kalır ve failedReads ile RAPORLANIR (F2-4).
 *  - Tavan (MAX_SCAN_ECUS) aşılırsa sessiz kırpma YOK — skippedEcus raporlanır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:      vi.fn(),
    readDtcFromEcu: vi.fn(),
    readUdsDtcs:    vi.fn(),
  },
}));

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology, emptyTopology } from '../platform/obd/ecuDiscovery';
import { scanAllEcus, discoverEcus, runFullVehicleScan, MAX_SCAN_ECUS } from '../platform/obd/multiEcuScan';

/** İki ECU'lu araç: motor (7E0/7E8) + ikinci ECU (7E1/7E9). */
function twoEcuTopology() {
  return buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
}

beforeEach(() => {
  vi.mocked(CarLauncher.probeEcus).mockReset();
  vi.mocked(CarLauncher.readDtcFromEcu).mockReset();
  // F3-1: varsayılan — ECU UDS 0x19'u desteklemiyor (çoğu eski araç). Testler bunu daraltır.
  vi.mocked(CarLauncher.readUdsDtcs!).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
});

describe('OBD-OS-F2-3 — ECU başına DTC + provenance', () => {
  it('🔒 KİLİT: HER ECU’ya kendi tx/rx header’ıyla gidilir (router doğru yönlendiriyor)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    await scanAllEcus(twoEcuTopology());

    const calls = vi.mocked(CarLauncher.readDtcFromEcu).mock.calls.map((c) => c[0]);
    // 2 ECU × 3 mod = 6 çağrı; her ECU kendi adresine.
    expect(calls).toHaveLength(6);
    expect(calls.filter((c) => c.tx === '7E0' && c.rx === '7E8')).toHaveLength(3);
    expect(calls.filter((c) => c.tx === '7E1' && c.rx === '7E9')).toHaveLength(3);
    expect(calls.map((c) => c.mode)).toEqual(['03', '07', '0A', '03', '07', '0A']);
  });

  it('🔒 KİLİT: kod HANGİ ECU’dan geldiğini taşır ve BAŞKA ECU’ya SIZMAZ', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async ({ tx, mode }) => {
      if (tx === '7E1' && mode === '03') return { codes: ['C1234'], supported: true };  // ABS kodu
      if (tx === '7E0' && mode === '03') return { codes: ['P0301'], supported: true };  // motor kodu
      return { codes: [], supported: true };
    });

    const report = await scanAllEcus(twoEcuTopology());

    const engine = report.results.find((r) => r.ecu.txHeader === '7E0')!;
    const second = report.results.find((r) => r.ecu.txHeader === '7E1')!;
    expect(engine.codes.map((c) => c.code)).toEqual(['P0301']);
    expect(second.codes.map((c) => c.code)).toEqual(['C1234']);   // sızıntı YOK
    expect(engine.codes[0]!.ecuLabel).toBe('Motor (ECM)');
    expect(second.codes[0]!.ecuTxHeader).toBe('7E1');
    expect(report.allCodes).toHaveLength(2);
  });

  it('ECU o modu desteklemiyorsa "unsupported" — hata SAYILMAZ (fail-soft)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async ({ mode }) =>
      mode === '0A' ? { codes: [], supported: false } : { codes: [], supported: true },
    );
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.results.every((r) => r.permanent === 'unsupported')).toBe(true);
    expect(report.failedReads).toBe(0);   // desteklenmemek HATA DEĞİL
  });
});

describe('OBD-OS-F2-4 — orkestrasyon (fail-soft + dürüst kapsam)', () => {
  it('🔒 KİLİT: bir ECU düşerse tarama DURMAZ, diğerleri okunur ve kısmilik RAPORLANIR', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async ({ tx }) => {
      if (tx === '7E1') throw new Error('ECU 7E1 timeout');
      return { codes: ['P0420'], supported: true };
    });

    const report = await scanAllEcus(twoEcuTopology());

    // Motor okundu (tarama durmadı)…
    const engine = report.results.find((r) => r.ecu.txHeader === '7E0')!;
    expect(engine.stored).toBe('ok');
    expect(engine.codes.length).toBeGreaterThan(0);
    // …düşen ECU açıkça işaretli ve kısmilik sayılıyor (sessiz "temiz" YASAK).
    const failed = report.results.find((r) => r.ecu.txHeader === '7E1')!;
    expect(failed.stored).toBe('failed');
    expect(report.failedReads).toBe(3);   // 3 mod da düştü
  });

  it('BÜTÇE: ECU sayısı tavanı aşarsa sessiz kırpma YOK — skippedEcus raporlanır', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    // NOT: 11-bit CAN'de adres uzayı zaten 8 ECU ile sınırlı (7E8-7EF) → tavan orada hiç
    // devreye girmez. Tavanın ANLAMLI olduğu yer 29-bit adresleme (geniş uzay) — ağır
    // ticari/premium araçlarda 8'den fazla ECU gerçektir. Test onu kurar.
    const lines = Array.from({ length: 12 }, (_, i) =>
      `18DAF1${(0x10 + i).toString(16).toUpperCase().padStart(2, '0')} 06 41 00 80`);
    const topo = buildTopology(lines.join('\r\n'), 1);
    expect(topo.ecus.length).toBe(12);   // keşif hepsini görür…

    const report = await scanAllEcus(topo);
    expect(report.scannedEcus).toBe(MAX_SCAN_ECUS);            // …ama tarama tavanla sınırlı
    expect(report.skippedEcus).toBe(12 - MAX_SCAN_ECUS);       // ve atlananlar RAPORLANIR
    expect(report.skippedEcus).toBeGreaterThan(0);
  });

  it('keşif hiç çalışmadıysa tarama boş rapor döner (çağıran tek-ECU akışına düşer)', async () => {
    const report = await scanAllEcus(emptyTopology());
    expect(report.results).toEqual([]);
    expect(report.allCodes).toEqual([]);
    expect(report.scannedEcus).toBe(0);
    expect(CarLauncher.readDtcFromEcu).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   OBD-OS-F3-1 — UDS 0x19 entegrasyonu: üretici-özel kodlar taramaya KATILIR.
   F1-2'nin "MIL yanıyor ama standart kod yok" uyarısının somut cevabı.
═══════════════════════════════════════════════════════════════════════════ */
describe('OBD-OS-F3-1 — UDS 0x19 çoklu-ECU taramasında', () => {
  it('🔒 KİLİT: standart modlar BOŞ ama UDS kod veriyor → kod BULUNUR (Car Scanner farkı)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E0'
        ? { raw: 'FF' + '03011C' + '09', supported: true }   // P0301, onaylı+aktif, FTB 1C
        : { raw: '', supported: false },
    );

    const report = await scanAllEcus(twoEcuTopology());

    // Standart tarama "temiz" derdi; UDS arızayı BULDU.
    expect(report.allCodes).toHaveLength(1);
    const c = report.allCodes[0]!;
    expect(c.code).toBe('P0301');
    expect(c.fromUds).toBe(true);          // ← standart tarama bunu GÖREMEZDİ
    expect(c.failureType).toBe('1C');      // Mode 03'te olmayan alt tip
    expect(c.active).toBe(true);           // Mode 03 bu ayrımı yapamaz
    expect(c.ecuTxHeader).toBe('7E0');     // provenance korunuyor
  });

  it('🔒 KİLİT: aynı kod hem Mode 03 hem UDS’te varsa TEK KEZ listelenir (yalancı çift arıza YASAK)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async ({ tx, mode }) =>
      tx === '7E0' && mode === '03' ? { codes: ['P0301'], supported: true } : { codes: [], supported: true },
    );
    vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E0' ? { raw: 'FF' + '03011C' + '09', supported: true } : { raw: '', supported: false },
    );

    const report = await scanAllEcus(twoEcuTopology());
    const p0301 = report.allCodes.filter((c) => c.code === 'P0301');
    expect(p0301).toHaveLength(1);          // iki kaynaktan geldi ama TEK kayıt
    expect(p0301[0]!.fromUds).toBeUndefined();  // standart moddan gelen KAZANIR
  });

  it('ECU 0x19’u desteklemiyorsa HATA sayılmaz (çoğu eski araç) — tarama sürer', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.results.every((r) => r.uds === 'unsupported')).toBe(true);
    expect(report.failedReads).toBe(0);
  });

  it('UDS düşerse standart sonuçlar KORUNUR (fail-soft) ve kısmilik raporlanır', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: ['P0420'], supported: true });
    vi.mocked(CarLauncher.readUdsDtcs!).mockRejectedValue(new Error('UDS timeout'));

    const report = await scanAllEcus(twoEcuTopology());
    expect(report.allCodes.some((c) => c.code === 'P0420')).toBe(true);   // standart kodlar durdu
    expect(report.results.every((r) => r.uds === 'failed')).toBe(true);
    expect(report.failedReads).toBe(2);   // 2 ECU × UDS düşüşü
  });
});

describe('OBD-OS-F2-1 — discoverEcus (fail-closed)', () => {
  it('native prob düşerse "ECU yok" DENMEZ — keşif çalışmadı (probedAt null)', async () => {
    vi.mocked(CarLauncher.probeEcus).mockRejectedValue(new Error('prob patladı'));
    const topo = await discoverEcus();
    expect(topo.probedAt).toBeNull();       // "bakılmadı" — "boş" değil
    expect(topo.probeEmpty).toBe(false);
    expect(topo.ecus).toEqual([]);
  });

  it('tam tarama: keşif → ECU başına DTC zinciri uçtan uca çalışır', async () => {
    vi.mocked(CarLauncher.probeEcus).mockResolvedValue({ raw: '7E8 06 41 00 BE\r\n7E9 06 41 00 80' });
    vi.mocked(CarLauncher.readDtcFromEcu).mockImplementation(async ({ tx, mode }) =>
      tx === '7E1' && mode === '03' ? { codes: ['C1234'], supported: true } : { codes: [], supported: true },
    );

    const report = await runFullVehicleScan();
    expect(report.topology.ecus).toHaveLength(2);
    expect(report.allCodes).toHaveLength(1);
    expect(report.allCodes[0]!.code).toBe('C1234');
    expect(report.allCodes[0]!.ecuTxHeader).toBe('7E1');   // motor DIŞI bir ECU'dan kod — F2'nin amacı
  });
});
