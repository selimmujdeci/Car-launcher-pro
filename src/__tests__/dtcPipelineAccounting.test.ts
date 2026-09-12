/**
 * dtcPipelineAccounting.test.ts — P0-OBD-PARITY · SAYIM ZİNCİRİ + SERVİS MERDİVENİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KUSUR (bu dosyanın varlık sebebi)
 * ══════════════════════════════════════════════════════════════════════════
 * İKİ ayrı yapısal körlük vardı:
 *
 *  1. **TEK SERVİS BAĞIMLILIĞI.** `readUdsForEcu` yalnız `19 02 FF` soruyordu.
 *     0 kod dönerse `result.uds = 'ok'` yazıp BİTİRİYORDU. Oysa `19 02` isteği
 *     bir `statusMask` taşır ve birçok ECU maskeyi AND'lerken status baytı
 *     `0x00` olan (ARŞİV / etkin değil) kayıtları ELER. `19 0A`
 *     (reportSupportedDTC) o filtreyi hiç uygulamaz — native whitelist'te
 *     ZATEN vardı ama **hiçbir yerden çağrılmıyordu**.
 *
 *  2. **SAYIM KÖRLÜĞÜ.** Her katman kendi içinde `ok` raporluyordu; kimse iki
 *     katmanın SAYISINI karşılaştırmıyordu. ECU 20 kayıt gönderirken ekranda
 *     0 satır varken bile hiçbir ara katman hata bildirmiyordu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:         vi.fn(),
    readDtcFromEcu:    vi.fn(),
    readUdsDtcs:       vi.fn(),
    readAdvancedDtcs:  vi.fn(),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => 0,
  getHandshakeDiagnostics: () => ({ protocolActive: null, protocolTried: null }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology } from '../platform/obd/ecuDiscovery';
import { scanAllEcus } from '../platform/obd/multiEcuScan';
import { formatDtcDisplayCode } from '../platform/obd/udsDtc';
import { _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import {
  describeDtcPipelineLoss, formatDtcPipelineLine, summarizeDtcPipeline,
  getDtcPipelineEntries, recordDtcPipelineEntry, _resetDtcPipelineForTest,
  type DtcPipelineEntry,
} from '../platform/obd/dtcPipelineAccounting';

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function encodeDtcBytes(code: string): string {
  const letter = ['P', 'C', 'B', 'U'].indexOf(code[0]!);
  const b0 = (letter << 6) | (parseInt(code[1]!, 16) << 4) | parseInt(code[2]!, 16);
  const b1 = parseInt(code.slice(3, 5), 16);
  return b0.toString(16).toUpperCase().padStart(2, '0')
    + b1.toString(16).toUpperCase().padStart(2, '0');
}
/** UDS 0x19 gövdesi ("5902"/"590A" SOYULMUŞ): availability + kayıtlar. */
function udsBody(recs: ReadonlyArray<readonly [string, string, string]>): string {
  return 'FF' + recs.map(([c, ftb, st]) => encodeDtcBytes(c) + ftb + st).join('');
}
function twoEcuTopology() {
  return buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
}
function entry(over: Partial<DtcPipelineEntry> = {}): DtcPipelineEntry {
  return {
    atMs: 1, sessionEpoch: 0, txHeader: '7E0', rxHeader: '7E8', ecuLabel: 'Motor (ECM)',
    service: '19', subFunction: '02', protocol: '6',
    raw: 20, parsed: 20, authority: 20, ui: 20, measured: true, outcome: 'ok',
    ...over,
  };
}

beforeEach(() => {
  _resetDtcPipelineForTest();
  _resetDtcAuthorityForTest();
  vi.mocked(CarLauncher.probeEcus).mockReset();
  vi.mocked(CarLauncher.readDtcFromEcu).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockReset();
  vi.mocked(CarLauncher.readAdvancedDtcs!).mockReset();
  vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) SAF MODEL — kayıp aşaması doğru adlandırılır
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · A) kayıp aşaması sınıflaması', () => {
  it('dört sayı tutuyorsa KAYIP YOK', () => {
    expect(describeDtcPipelineLoss(entry())).toBe('NONE');
  });

  it('🔒 KİLİT: PARSER kaybı — ECU 20 gönderdi, çözücü 14 üretti', () => {
    expect(describeDtcPipelineLoss(entry({ parsed: 14, authority: 14, ui: 14 }))).toBe('PARSER');
  });

  it('🔒 ANA KİLİT: AUTHORITY kaybı — çözüldü 20, otoriteye 14 yazıldı (dedup anahtarı dar)', () => {
    const e = entry({ authority: 14, ui: 14 });
    expect(describeDtcPipelineLoss(e)).toBe('AUTHORITY');
    expect(formatDtcPipelineLine(e))
      .toBe('RAW 20 · PARSED 20 · AUTHORITY 14 · UI 14 → AUTHORITY_DEDUP');
  });

  it('🔒 KİLİT: UI kaybı — otoritede 20, ekranda 0 (filtre)', () => {
    const e = entry({ ui: 0 });
    expect(describeDtcPipelineLoss(e)).toBe('UI');
    expect(formatDtcPipelineLine(e))
      .toBe('RAW 20 · PARSED 20 · AUTHORITY 20 · UI 0 → UI_DROPPED');
  });

  it('🔒 FAIL-CLOSED: ölçülemeyen sayı → UNKNOWN, ASLA "kayıp yok"', () => {
    expect(describeDtcPipelineLoss(entry({ raw: null }))).toBe('UNKNOWN');
    expect(describeDtcPipelineLoss(entry({ authority: null }))).toBe('UNKNOWN');
    expect(describeDtcPipelineLoss(entry({ measured: false }))).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: ölçülemeyen sayı `?` basılır — sahte 0 YASAK', () => {
    expect(formatDtcPipelineLine(entry({ raw: null, parsed: null })))
      .toBe('RAW ? · PARSED ? · AUTHORITY 20 · UI 20 → BİLİNMİYOR');
  });

  it('ilk kırılan halka raporlanır (kök en yukarıda)', () => {
    // Parser da düştü, otorite de — kök PARSER'dır.
    expect(describeDtcPipelineLoss(entry({ parsed: 15, authority: 10, ui: 10 }))).toBe('PARSER');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) TUR ÖZETİ — toplama kuralı ve dürüstlük
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · B) tur özeti', () => {
  it('ölçülen okumalar toplanır; kayıp aşamaları tekrarsız listelenir', () => {
    recordDtcPipelineEntry(entry({ service: '19', subFunction: '02' }));
    recordDtcPipelineEntry(entry({ service: '19', subFunction: '0A', authority: 3, ui: 3, raw: 5, parsed: 5 }));
    const sum = summarizeDtcPipeline(getDtcPipelineEntries(), 0);
    expect(sum.raw).toBe(25);
    expect(sum.parsed).toBe(25);
    expect(sum.authority).toBe(23);
    expect(sum.lossStages).toEqual(['AUTHORITY']);
    expect(sum.hasUnknown).toBe(false);
  });

  it('🔒 KİLİT: bir okumada ölçülemeyen sayı varsa TUR TOPLAMI da `null` — 0 sayılmaz', () => {
    recordDtcPipelineEntry(entry());
    recordDtcPipelineEntry(entry({ raw: null }));
    const sum = summarizeDtcPipeline(getDtcPipelineEntries(), 0);
    expect(sum.raw).toBeNull();          // "ölçemediğimizi 0 sayıp toplamak" YASAK
    expect(sum.parsed).toBe(40);
    expect(sum.hasUnknown).toBe(true);
  });

  it('ölçülmemiş (measured:false) okuma toplama GİRMEZ ama UNKNOWN işaretler', () => {
    recordDtcPipelineEntry(entry({ measured: false, outcome: 'no_response' }));
    const sum = summarizeDtcPipeline(getDtcPipelineEntries(), 0);
    expect(sum.measuredCount).toBe(0);
    expect(sum.raw).toBe(0);             // ölçülen okuma yok → toplam 0 kayıt
    expect(sum.hasUnknown).toBe(true);   // ama bu "kayıp yok" DEMEK DEĞİL
  });

  it('başka oturumun künyesi bu tura KARIŞMAZ', () => {
    recordDtcPipelineEntry(entry({ sessionEpoch: 0 }));
    recordDtcPipelineEntry(entry({ sessionEpoch: 9 }));
    expect(summarizeDtcPipeline(getDtcPipelineEntries(), 0).entryCount).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) SERVİS MERDİVENİ — 0x19-0A tek servis bağımlılığını kırar
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · C) UDS 0x19 servis merdiveni', () => {
  /** 0x19-02 filtreli 2 kayıt · 0x19-0A filtresiz 4 kayıt döndüren ECU. */
  function maskFilteringEcu() {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ service, subFunction, tx }) => {
      if (tx !== '7E0' || service !== '19') return { outcome: 'no_response', raw: '', kind: 'NO_DATA' };
      if (subFunction === '01') return { outcome: 'ok', raw: 'FF00FF00', kind: 'OK' };
      if (subFunction === '02') {
        // Maske AND'i status 0x00 kayıtları ELEDİ → yalnız aktif olanlar.
        return { outcome: 'ok', kind: 'OK', raw: udsBody([['P0380', '11', '09'], ['P0380', '12', '09']]) };
      }
      if (subFunction === '0A') {
        // reportSupportedDTC — FİLTRE YOK, arşiv kayıtları da gelir.
        return { outcome: 'ok', kind: 'OK', raw: udsBody([
          ['P0380', '11', '09'], ['P0380', '12', '09'],
          ['P0380', '13', '00'], ['P0380', '96', '00'],
        ]) };
      }
      return { outcome: 'no_response', raw: '', kind: 'NO_DATA' };
    });
  }

  it('🔒 ANA KİLİT: 0x19-02 maskeyle 2 kayıt verse de 0x19-0A ARŞİV kayıtlarını getirir → 4', async () => {
    maskFilteringEcu();
    const report = await scanAllEcus(twoEcuTopology());

    expect(report.allCodes.map((c) => formatDtcDisplayCode(c.code, c.subCode)))
      .toEqual(['P0380(11)', 'P0380(12)', 'P0380(13)', 'P0380(96)']);
    // Arşiv kayıtları DOĞRU adıyla taşınır — "aktif arıza" DENMEZ.
    const archived = report.allCodes.filter((c) => c.state === 'STORED_INACTIVE');
    expect(archived.map((c) => c.subCode)).toEqual(['13', '96']);
  });

  it('🔒 KİLİT: alt fonksiyon PROVENANCE’ı korunur — hangi kayıt hangi alt fonksiyondan', async () => {
    maskFilteringEcu();
    const report = await scanAllEcus(twoEcuTopology());
    const bySub = new Map(report.allCodes.map((c) => [c.subCode, c.udsSubFunction]));
    expect(bySub.get('11')).toBe('02');   // maskeli okumada zaten vardı
    expect(bySub.get('13')).toBe('0A');   // YALNIZ filtresiz okumada göründü
    expect(bySub.get('96')).toBe('0A');
  });

  it('🔒 KİLİT: 0x19-02 REDDEDİLSE bile 0x19-0A denenir (bir servis diğerini KESMEZ)', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ service, subFunction, tx }) => {
      if (tx !== '7E0' || service !== '19') return { outcome: 'no_response', raw: '', kind: 'NO_DATA' };
      if (subFunction === '02') return { outcome: 'negative_nrc', raw: '', kind: 'NEG_7F', nrc: 0x12 };
      if (subFunction === '0A') {
        return { outcome: 'ok', kind: 'OK', raw: udsBody([['P0833', '29', '08']]) };
      }
      return { outcome: 'ok', raw: 'FF00FF00', kind: 'OK' };
    });

    const report = await scanAllEcus(twoEcuTopology());
    expect(report.allCodes.map((c) => formatDtcDisplayCode(c.code, c.subCode))).toEqual(['P0833(29)']);
    const engine = report.results.find((r) => r.ecu.txHeader === '7E0')!;
    expect(engine.uds).toBe('unsupported');   // 0x02 gerçekten reddedildi
    expect(engine.udsSupported).toBe('ok');   // 0x0A çalıştı — AYRI gerçek
  });

  it('🔒 KİLİT: birebir aynı kayıt iki alt fonksiyondan gelirse TEK satır kalır', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ service, subFunction, tx }) => {
      if (tx !== '7E0' || service !== '19') return { outcome: 'no_response', raw: '', kind: 'NO_DATA' };
      if (subFunction === '02' || subFunction === '0A') {
        return { outcome: 'ok', kind: 'OK', raw: udsBody([['P0833', '29', '09']]) };
      }
      return { outcome: 'ok', raw: 'FF00FF00', kind: 'OK' };
    });
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.allCodes).toHaveLength(1);   // yalancı çift arıza YOK
  });

  it('0x19-0A köprüsü YOKSA "sorulmadı" kalır — "desteklenmiyor" DENMEZ', async () => {
    const noAdvanced = CarLauncher as unknown as { readAdvancedDtcs?: unknown };
    const saved = noAdvanced.readAdvancedDtcs;
    delete noAdvanced.readAdvancedDtcs;
    try {
      vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
      const report = await scanAllEcus(twoEcuTopology());
      expect(report.results.every((r) => r.udsSupported === null)).toBe(true);
    } finally {
      noAdvanced.readAdvancedDtcs = saved;
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) UÇTAN UCA MUHASEBE — gerçek taramada sayılar tutar
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · D) uçtan uca muhasebe', () => {
  it('🔒 ANA KİLİT: taramada RAW = PARSED = AUTHORITY = UI (kayıp YOK) ölçülür', async () => {
    const recs: ReadonlyArray<readonly [string, string, string]> = [
      ['P0380', '11', '09'], ['P0380', '12', '09'], ['P0380', '13', '00'], ['P0380', '96', '00'],
    ];
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ service, subFunction, tx }) => {
      if (tx !== '7E0' || service !== '19') return { outcome: 'no_response', raw: '', kind: 'NO_DATA' };
      if (subFunction === '02') return { outcome: 'ok', kind: 'OK', raw: udsBody(recs) };
      if (subFunction === '0A') return { outcome: 'unsupported', raw: '', kind: 'NEG_7F', nrc: 0x12 };
      return { outcome: 'ok', raw: 'FF00FF00', kind: 'OK' };
    });

    await scanAllEcus(twoEcuTopology());

    const row = getDtcPipelineEntries().find((e) => e.service === '19' && e.subFunction === '02')!;
    expect(row).toBeDefined();
    expect(formatDtcPipelineLine(row))
      .toBe('RAW 4 · PARSED 4 · AUTHORITY 4 · UI 4 → KAYIP YOK');
  });

  it('🔒 KİLİT: TUR TOPLAMI satırı yazılır ve kanonik otoriteyi ölçer', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockImplementation(async ({ service, subFunction, tx }) => {
      if (tx !== '7E0' || service !== '19') return { outcome: 'no_response', raw: '', kind: 'NO_DATA' };
      if (subFunction === '02') {
        return { outcome: 'ok', kind: 'OK', raw: udsBody([['P0833', '29', '09'], ['P0380', '11', '09']]) };
      }
      if (subFunction === '0A') return { outcome: 'unsupported', raw: '', kind: 'NEG_7F', nrc: 0x12 };
      return { outcome: 'ok', raw: 'FF00FF00', kind: 'OK' };
    });

    await scanAllEcus(twoEcuTopology());

    const total = getDtcPipelineEntries().find((e) => e.service === 'TOTAL')!;
    expect(total, 'tur toplamı künyesi yazılmadı').toBeDefined();
    expect(total.authority).toBe(2);   // kanonik otoritede iki AYRI gözlem
    expect(total.ui).toBe(2);
    expect(describeDtcPipelineLoss(total)).toBe('NONE');
  });

  it('🔒 KİLİT: okuma DÜŞTÜYSE künye `measured:false` — sayılar temizlik kanıtı SAYILMAZ', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      outcome: 'no_response', raw: '', kind: 'NO_DATA',
    });
    await scanAllEcus(twoEcuTopology());
    const rows = getDtcPipelineEntries().filter((e) => e.service === '19');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((e) => e.measured === false)).toBe(true);
    expect(rows.every((e) => describeDtcPipelineLoss(e) === 'UNKNOWN')).toBe(true);
  });
});
