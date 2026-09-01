/**
 * dtcFieldParity.test.ts — P0-OBD-FINISH · CAR SCANNER SAHA PARİTESİ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KUSUR (bu dosyanın varlık sebebi)
 * ══════════════════════════════════════════════════════════════════════════
 * Aynı araçta (Renault Clio · aynı ELM327) Car Scanner YİRMİ kayıt gösterirken
 * CarOS kullanıcıya HİÇBİR üretici kodu göstermiyordu. Zincirde ÜÇ ayrı yerde
 * kanıt düşüyordu ve üçü de bu dosyada kilitlenir:
 *
 *   1. DEDUP_DROPPED — tekilleştirme anahtarı YALNIZ `Pxxxx` idi. Golden
 *      listedeki `P0380(11)` · `(12)` · `(13)` · `(96)` (dört AYRI devre
 *      arızası) tek satıra iniyordu; `P2263(21)/(22)` ve `P047B(92)/(29)` de.
 *   2. PARSE_FAILED — KWP çözücüsü kayıt boyunu 3 BAYT sabitlemişti. 3 baytlık
 *      DTC (ISO 14229 biçimi) taşıyan bir 0x18/0x13 gövdesi ya MALFORMED
 *      sayılıyor ya da kaydırılarak ÇÖP kod üretiyordu.
 *   3. UI_DROPPED + STATUS_DROPPED — alt kod hiç basılmıyordu ve kaydın
 *      durumu (aktif / arşiv / test tamamlanmadı) `stored|pending` ikilisine
 *      düşürülüyordu.
 *
 * GOLDEN LİSTE aşağıda AYNEN kodlanmıştır; kilitler ona bağlıdır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from './helpers';
import {
  GOLDEN_CLIO, encodeDtcBytes, goldenUdsBody, goldenKwp3ByteBody,
} from './fixtures/goldenClio';

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
import {
  parseUdsDtcResponse, validateUdsDtcResponse, classifyUdsDtcState, formatDtcDisplayCode,
} from '../platform/obd/udsDtc';
import {
  parseKwpDtcResponse, validateKwpDtcResponse, detectKwpRecordBytes,
} from '../platform/obd/kwpDtc';
import {
  recordDtcObservation, recordDtcServiceScan, getDtcAuthoritySnapshot,
  observationKey, _resetDtcAuthorityForTest,
} from '../platform/obd/dtcAuthority';

/* ══════════════════════════════════════════════════════════════════════════
   GOLDEN FIELD REFERENCE — Car Scanner'ın AYNI araçta gösterdiği kayıtlar.
   P0-VDK-F2B: korpus `fixtures/goldenClio` dosyasına TAŞINDI (içerik AYNI).
   Neden: replay paritesi de TAM OLARAK bu listeyi doğrulamak zorunda ve
   korpusun iki kopyası olsaydı biri sessizce eskirdi.
   ══════════════════════════════════════════════════════════════════════════ */
const GOLDEN = GOLDEN_CLIO;

function twoEcuTopology() {
  return buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
}

beforeEach(() => {
  _resetDtcAuthorityForTest();
  vi.mocked(CarLauncher.probeEcus).mockReset();
  vi.mocked(CarLauncher.readDtcFromEcu).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockReset();
  vi.mocked(CarLauncher.readUdsDtcs!).mockResolvedValue({ raw: '', supported: false });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) HAM YANIT → DTC ÇÖZÜMÜ (golden listenin TAMAMI)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-FINISH · A) ham yanıt → DTC çözümü', () => {
  it('🔒 KİLİT: UDS 0x19-02 gövdesinden golden listenin YİRMİSİ de çözülür (alt kodlarıyla)', () => {
    const parsed = parseUdsDtcResponse(goldenUdsBody());
    expect(parsed).toHaveLength(GOLDEN.length);
    expect(parsed.map((d) => formatDtcDisplayCode(d.code, d.failureType)))
      .toEqual(GOLDEN.map(([c, f]) => `${c}(${f})`));
  });

  it('🔒 KİLİT: 3 BAYTLIK DTC taşıyan KWP gövdesi ARTIK çözülür (eski çözücü kaydırıyordu)', () => {
    const body = goldenKwp3ByteBody();
    // 20 kayıt × 4 bayt = 80 bayt; 3'e BÖLÜNMEZ → eski kod MALFORMED diyordu.
    expect(detectKwpRecordBytes(body)).toBe(4);
    expect(validateKwpDtcResponse(body)).toEqual({ valid: true, declaredCount: 20, recordBytes: 4 });

    const parsed = parseKwpDtcResponse(body);
    expect(parsed).toHaveLength(GOLDEN.length);
    expect(parsed.map((d) => formatDtcDisplayCode(d.code, d.failureType)))
      .toEqual(GOLDEN.map(([c, f]) => `${c}(${f})`));
    expect(parsed.every((d) => d.recordBytes === 4)).toBe(true);
  });

  it('🔒 GERİ UYUM: klasik 2 BAYTLIK KWP kaydı ESKİSİ GİBİ çözülür (alt kod UYDURULMAZ)', () => {
    const body = '02' + '0301' + '09' + '5234' + '04';
    expect(detectKwpRecordBytes(body)).toBe(3);
    const parsed = parseKwpDtcResponse(body);
    expect(parsed.map((d) => d.code)).toEqual(['P0301', 'C1234']);
    expect(parsed[0]!.failureType).toBeUndefined();
    expect(formatDtcDisplayCode(parsed[0]!.code, parsed[0]!.failureType)).toBe('P0301');
  });

  it('yalancı count baytı biçimi DEĞİŞTİREMEZ — fail-closed 3 bayta düşer', () => {
    // count 5 diyor, gövde tek 3-baytlık kayıt → hiçbir çarpanla uyuşmaz.
    expect(detectKwpRecordBytes('05' + '0301' + '09')).toBe(3);
    expect(parseKwpDtcResponse('05' + '0301' + '09')).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) ALT KOD / STATUS KORUNUMU — aynı kodun farklı kayıtları AYRI KALIR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-FINISH · B) alt kod + status korunumu', () => {
  it('🔒 ANA KİLİT: P0380’in DÖRT alt kodu da taramadan SAĞ ÇIKAR (eskiden ÜÇÜ ölüyordu)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E0' ? { raw: goldenUdsBody(), supported: true } : { raw: '', supported: false },
    );

    const report = await scanAllEcus(twoEcuTopology());

    expect(report.allCodes).toHaveLength(GOLDEN.length);
    const p0380 = report.allCodes.filter((c) => c.code === 'P0380');
    expect(p0380).toHaveLength(4);
    expect(p0380.map((c) => c.subCode).sort()).toEqual(['11', '12', '13', '96']);
  });

  it('🔒 KİLİT: golden listenin TAMAMI ekrana çıkacak künyeyle üretilir', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E0' ? { raw: goldenUdsBody(), supported: true } : { raw: '', supported: false },
    );

    const report = await scanAllEcus(twoEcuTopology());
    expect(report.allCodes.map((c) => formatDtcDisplayCode(c.code, c.subCode)))
      .toEqual(GOLDEN.map(([c, f]) => `${c}(${f})`));
  });

  it('🔒 KİLİT: PROVENANCE her kayıtta TAM — ECU · servis · ham DTC · status', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E0' ? { raw: goldenUdsBody(), supported: true } : { raw: '', supported: false },
    );

    const report = await scanAllEcus(twoEcuTopology());
    for (const c of report.allCodes) {
      expect(c.ecuTxHeader).toBe('7E0');
      expect(c.fromUds).toBe(true);
      expect(c.rawDtc).toMatch(/^[0-9A-F]{6}$/);
      expect(c.rawStatus).toMatch(/^[0-9A-F]{2}$/);
      expect(c.state).toBeDefined();
    }
  });

  it('BİREBİR AYNI kayıt (kod+alt kod+status) yine TEK KEZ listelenir — gerçek çift koruması durur', async () => {
    const rec = encodeDtcBytes('P0380') + '11' + '09';
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E0' ? { raw: 'FF' + rec + rec, supported: true } : { raw: '', supported: false },
    );
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.allCodes).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) DURUM SEMANTİĞİ — "kayıt var" ≠ "aktif arıza"
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-FINISH · C) durum semantiği', () => {
  it('🔒 KİLİT: status baytı BEŞ ayrı duruma çözülür (ikiliye düşürülmez)', () => {
    const st = (h: string) => classifyUdsDtcState(parseUdsDtcResponse('FF' + '038011' + h)[0]!.status);
    expect(st('09')).toBe('ACTIVE');              // testFailed + confirmed
    expect(st('08')).toBe('CONFIRMED_INACTIVE');  // onaylı ama şu an düşmüyor
    expect(st('04')).toBe('PENDING');
    expect(st('40')).toBe('TEST_INCOMPLETE');
    expect(st('00')).toBe('STORED_INACTIVE');     // arşiv / etkin değil
  });

  it('🔒 KİLİT: status ÖLÇÜLMEDİYSE durum UYDURULMAZ', () => {
    expect(classifyUdsDtcState(null)).toBe('UNKNOWN');
    expect(classifyUdsDtcState(undefined)).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: ARŞİV kaydı taramadan DÜŞÜRÜLMEZ, yalnız DOĞRU adıyla taşınır', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    vi.mocked(CarLauncher.readUdsDtcs!).mockImplementation(async ({ tx }) =>
      tx === '7E0' ? { raw: 'FF' + encodeDtcBytes('P0833') + '29' + '00', supported: true }
        : { raw: '', supported: false },
    );
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.allCodes).toHaveLength(1);          // FİLTRELENİP YOK EDİLMEDİ
    expect(report.allCodes[0]!.state).toBe('STORED_INACTIVE');
    expect(report.allCodes[0]!.active).toBe(false);   // "aktif arıza" DENMEDİ
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) KANONİK OTORİTE — alt kod dedup anahtarına GİRER
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-FINISH · D) kanonik otorite', () => {
  const base = {
    dtcClass: 'UDS' as const, ecuKey: '7E0', ecuRole: null,
    rxHeader: null, txHeader: '7E0', protocol: '5',
    sessionEpoch: 7, sourceService: '19' as const, provenance: 'physical_ecu' as const,
  };

  it('🔒 ANA KİLİT: aynı kod + FARKLI alt kod → AYRI gözlem (biri diğerini EZMEZ)', () => {
    recordDtcServiceScan({ service: '19', ecuKey: '7E0', ecuRole: null, txHeader: '7E0',
      outcome: 'ok', sessionEpoch: 7, codeCount: 4, protocol: '5' });
    for (const ftb of ['11', '12', '13', '96']) {
      recordDtcObservation({ ...base, dtcCode: 'P0380', failureType: ftb, rawStatusByte: '09' });
    }
    const snap = getDtcAuthoritySnapshot();
    expect(snap.observations).toHaveLength(4);
    expect(new Set(snap.observations.map((o) => o.failureType)))
      .toEqual(new Set(['11', '12', '13', '96']));
  });

  it('🔒 GERİ UYUM: alt kod/status ÖLÇÜLMEMİŞSE anahtar BİREBİR eskisi gibi kalır', () => {
    expect(observationKey({
      dtcCode: 'P0089', dtcClass: 'PENDING', ecuKey: '7E0', ecuRole: null,
      rxHeader: null, txHeader: null, protocol: null, sessionEpoch: 7,
      sourceService: '07', scanOutcome: 'ok', measuredAt: 0, provenance: 'physical_ecu',
    })).toBe('P0089|PENDING|7E0');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) OLUMSUZ YOLLAR — sessizlik/NRC/bozukluk "temiz" DEĞİLDİR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-FINISH · E) olumsuz yollar', () => {
  it('NO_RESPONSE (boş gövde) kod ÜRETMEZ ve uydurma kayıt YAZMAZ', () => {
    expect(parseUdsDtcResponse('')).toEqual([]);
    expect(parseKwpDtcResponse('')).toEqual([]);
  });

  it('BOZUK gövde MALFORMED sayılır — kaydırılmış çöp kod ÜRETİLMEZ', () => {
    // 3-baytlık kayıt sınırına oturmayan gövde.
    const bad = '02' + '0301' + '09' + '5234';
    expect(validateKwpDtcResponse(bad).valid).toBe(false);
    expect(validateUdsDtcResponse('FF' + '0380').valid).toBe(false);
  });

  it('ECU 0x19’u desteklemiyorsa (negatif yanıt) tarama DÜŞMEZ, kod da UYDURULMAZ', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu).mockResolvedValue({ codes: [], supported: true });
    const report = await scanAllEcus(twoEcuTopology());
    expect(report.results.every((r) => r.uds === 'unsupported')).toBe(true);
    expect(report.allCodes).toEqual([]);
    expect(report.failedReads).toBe(0);
  });

  it('dolgu (000000) kaydı KOD SAYILMAZ', () => {
    expect(parseUdsDtcResponse('FF' + '000000' + '00' + '038011' + '09')).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) UI KATMANI — kodun ekrana ULAŞTIĞI yer (bu proje kaynak-metin kilidi kullanır;
      araç içi panel için bir render kütüphanesi bağımlılığı EKLENMEDİ)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-FINISH · F) UI katmanı', () => {
  const panel = stripComments(
    readFileSync(resolve(process.cwd(), 'src/components/obd/DTCPanel.tsx'), 'utf8'),
  );

  it('🔒 ANA KİLİT: MOTOR ECU FİLTRESİ GERİ GELEMEZ (kodların kaybolduğu asıl satır)', () => {
    /* Blok `allCodes.filter((c) => c.ecuTxHeader !== '7E0')` ile açılıyordu →
       motor ECU'sundan okunan HER üretici kodu ekrandan yapısal olarak
       dışlanıyordu. Renault Clio'da aranan kodların TAMAMI oradadır. */
    expect(panel).not.toMatch(/ecuTxHeader\s*!==\s*'7E0'/);
    expect(panel).toMatch(/multiEcu\.allCodes\.length > 0/);
  });

  it('🔒 KİLİT: kod ALT KODUYLA basılır (P0380(11)) — sade kod yeterli DEĞİL', () => {
    expect(panel).toMatch(/formatDtcDisplayCode\(c\.code, c\.subCode\)/);
  });

  it('🔒 KİLİT: kullanıcı KOD · DURUM · ECU · KAYNAK/SERVİS · STATUS görebilir', () => {
    expect(panel, 'durum rozeti').toMatch(/UDS_DTC_STATE_LABEL\[c\.state\]/);
    expect(panel, 'kaynak/servis rozeti').toMatch(/dtc-source-/);
    expect(panel, 'ECU etiketi').toMatch(/\{c\.ecuLabel\}/);
    expect(panel, 'ham status baytı').toMatch(/dtc-raw-/);
  });

  it('🔒 KİLİT: React anahtarı alt kod + status taşır (aynı kod dört kez basılabilmeli)', () => {
    expect(panel).toMatch(/c\.subCode \?\? ''\}-\$\{c\.rawStatus \?\? ''\}/);
  });
});
