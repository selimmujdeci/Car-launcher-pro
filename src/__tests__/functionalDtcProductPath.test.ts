/**
 * functionalDtcProductPath.test.ts — P0-VDK-F2C1 · ÜRÜN YOLU + REPLAY KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ
 * ══════════════════════════════════════════════════════════════════════════
 * "Mode 03/07/0A ham gövdesi ÜRÜNÜN NORMAL yolunda kanonik TS çözümleyicisine
 *  ulaşır; native listesi ürün otoritesi DEĞİLDİR; replay AYNI çözümleyiciyi
 *  kullanır ve F2-B'nin `PARSER_GAP` borcu KAPANIR."
 *
 * Sadece `functionalDtc.ts` yazmak ya da parser birim testi geçmek PASS
 * DEĞİLDİR — bu dosya zincirin tamamını koşar:
 *
 *   readAllDTCs (ÜRÜN) → vdkTransport → ham `43 …`
 *     → functionalDtcSource → functionalDtc → dtcAuthority → ürün sonucu
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const epochRef = { value: 0 };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDTC:           vi.fn(),
    readPendingDTC:    vi.fn(),
    readPermanentDTC:  vi.fn(),
    readDtcClass:      vi.fn(),
    readFreezeFrameDtc: vi.fn(),
    readFreezeFramePid: vi.fn(),
    probeEcus:         vi.fn(),
    readDtcFromEcu:    vi.fn(),
    readUdsDtcs:       vi.fn(),
    readAdvancedDtcs:  vi.fn(),
    sendTesterPresent: vi.fn(),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => epochRef.value,
  getHandshakeDiagnostics: () => ({ protocolActive: '6', protocolTried: null }),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { readAllDTCs } from '../platform/dtcService';
import {
  getTraceEvents, _resetTraceForTest, _setTraceClocksForTest,
} from '../platform/obd/canonicalTrace';
import { buildTracePackage, importTracePackage } from '../platform/obd/traceExport';
import {
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetSchedulerForTest, _setSchedulerClockForTest } from '../platform/obd/diagnosticSessionScheduler';
import { _resetSessionEvidenceForTest } from '../platform/obd/diagnosticSessionEvidence';
import { getDtcAuthoritySnapshot, _resetDtcAuthorityForTest } from '../platform/obd/dtcAuthority';
import {
  startReplay, stopReplay, _resetVdkTransportForTest, _setReplaySleepForTest,
} from '../platform/obd/vdkTransport';
import {
  getFunctionalDtcEvidence, getFunctionalDtcEvidenceFor,
  _resetFunctionalDtcEvidenceForTest,
} from '../platform/obd/functionalDtcEvidence';
import {
  GOLDEN_FUNCTIONAL_A, GOLDEN_FUNCTIONAL_B, GOLDEN_FUNCTIONAL_C,
  GOLDEN_FUNCTIONAL_CORPUS,
} from './fixtures/goldenFunctional';

const clock = { t: 5_000 };
const mono = { t: 0 };

/** Golden A/B/C gövdelerini `readDtcClass` köprüsünden döndürür. */
function armGoldenBridge(opts: { withNativeCodes?: readonly string[]; raw?: boolean } = {}): void {
  const byMode: Record<string, string> = {
    '03': GOLDEN_FUNCTIONAL_A.rawResponse,
    '07': GOLDEN_FUNCTIONAL_B.rawResponse,
    '0A': GOLDEN_FUNCTIONAL_C.rawResponse,
  };
  vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async ({ mode }) => ({
    /* Native'in ÇÖZDÜĞÜ liste — parite tanığı. Ürün otoritesi DEĞİL. */
    codes: opts.withNativeCodes !== undefined
      ? [...opts.withNativeCodes]
      : (mode === '03' ? ['P0301'] : mode === '07' ? ['P0380', 'P0420'] : ['P0301']),
    raw: opts.raw === false ? '' : byMode[mode]!,
    supported: true,
    outcome: 'OK',
    elapsedMs: 100,
    protocol: '6',
  }));
}

function resetAll(): void {
  _resetVdkTransportForTest();
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetSessionEvidenceForTest();
  _resetDtcAuthorityForTest();
  _resetFunctionalDtcEvidenceForTest();
  clock.t = 5_000;
  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
}

beforeEach(() => {
  resetAll();
  _resetTraceForTest('trace-FN');
  mono.t = 0;
  _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
  epochRef.value = 0;
  for (const m of ['readDTC', 'readPendingDTC', 'readPermanentDTC', 'readDtcClass',
    'readFreezeFrameDtc', 'readFreezeFramePid'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
  vi.mocked(CarLauncher.readFreezeFrameDtc!).mockResolvedValue({ dtc: null });
  _setReplaySleepForTest(async () => { /* gerçek bekleme YOK */ });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) LIVE — KANONİK PARSER ÜRÜN OTORİTESİ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · A) live ürün yolu', () => {
  it('🔒 PASS KİLİDİ: Mode 03/07/0A ham gövdesi kanonik TS parser’dan geçer', async () => {
    armGoldenBridge();
    const r = await readAllDTCs();

    const ev = getFunctionalDtcEvidence();
    expect(ev.map((e) => e.mode).sort()).toEqual(['03', '07', '0A']);
    expect(ev.every((e) => e.provenance === 'CANONICAL_TS'),
      'ham gövde varken kanonik otorite DEVREYE GİRMEDİ').toBe(true);

    /* Ürün sonucu kanonik çözümden gelmeli. */
    const stored = r.codes.filter((c) => c.status === 'stored').map((c) => c.code);
    const pending = r.codes.filter((c) => c.status === 'pending').map((c) => c.code);
    const perm = r.codes.filter((c) => c.status === 'permanent').map((c) => c.code);
    expect(stored).toEqual(GOLDEN_FUNCTIONAL_A.expectedCodes);
    expect(pending).toEqual(GOLDEN_FUNCTIONAL_B.expectedCodes);
    expect(perm).toEqual(GOLDEN_FUNCTIONAL_C.expectedCodes);
  });

  it('🔒 KİLİT: NATIVE listesi ürün otoritesi DEĞİLDİR (çelişkide kanonik kazanır)', async () => {
    /* Native UYDURMA bir kod döndürüyor; ham gövdede o kod YOK. */
    armGoldenBridge({ withNativeCodes: ['P9999'] });
    const r = await readAllDTCs();

    expect(r.codes.map((c) => c.code)).not.toContain('P9999');
    expect(r.codes.filter((c) => c.status === 'stored').map((c) => c.code)).toEqual(['P0301']);

    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.provenance).toBe('CANONICAL_TS');
    expect(e.parity, 'çelişki GİZLENDİ').toBe('MISMATCH');
    expect(e.parityDetail).toMatch(/P9999|P0301/);
  });

  it('🔒 KİLİT: kanonik ve native AYNIYSA parite MATCH', async () => {
    armGoldenBridge();
    await readAllDTCs();
    for (const e of getFunctionalDtcEvidence()) {
      expect(e.parity, `${e.mode} paritesi`).toBe('MATCH');
    }
  });

  it('🔒 KİLİT: otorite defterine kanonik kodlar yazılır', async () => {
    armGoldenBridge();
    await readAllDTCs();
    const codes = getDtcAuthoritySnapshot().observations.map((o) => o.dtcCode);
    expect(codes).toContain('P0301');
    expect(codes).toContain('P0380');
    expect(codes).toContain('P0420');
  });

  it('🔒 KİLİT: golden korpusun TAMAMI ürün yolundan doğru çözülür', async () => {
    for (const t of GOLDEN_FUNCTIONAL_CORPUS) {
      resetAll();
      _resetTraceForTest(`trace-${t.mode}`);
      vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async ({ mode }) => ({
        codes: [], raw: mode === t.mode ? t.rawResponse : '43 00 00 00 00 00 00',
        supported: true, outcome: 'OK', elapsedMs: 10, protocol: '6',
      }));
      const r = await readAllDTCs();
      const wanted = t.mode === '03' ? 'stored' : t.mode === '07' ? 'pending' : 'permanent';
      const got = r.codes.filter((c) => c.status === wanted).map((c) => c.code);
      expect(got, `${t.name} → ${t.note}`).toEqual(t.expectedCodes);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) LEGACY YEDEK — eski köprü kırılmaz
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · B) legacy geri uyum', () => {
  it('🔒 KİLİT: ham gövde YOKSA native listesi YEDEK olur (ürün çökmez)', async () => {
    armGoldenBridge({ raw: false });
    const r = await readAllDTCs();

    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.provenance).toBe('LEGACY_NATIVE');
    expect(e.block).toBe('RAW_ABSENT');
    /* Yedek sonuç ürüne akar — eski APK bir gecede kırılmaz. */
    expect(r.codes.filter((c) => c.status === 'stored').map((c) => c.code)).toEqual(['P0301']);
  });

  it('🔒 KİLİT: legacy yedek "kanonik parite" diye İŞARETLENMEZ', async () => {
    armGoldenBridge({ raw: false });
    await readAllDTCs();
    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.provenance).not.toBe('CANONICAL_TS');
    expect(e.parity).toBe('NOT_APPLICABLE');
    expect(e.recordsDecoded, 'kanonik çözüm yokken kayıt sayısı ÜRETİLDİ').toBeNull();
  });

  it('🔒 KİLİT: KIRPILMIŞ ham gövde kanonik otorite OLAMAZ', async () => {
    /* 240 haneye dayanan gövde → kırpılmış SAYILIR (fail-closed). */
    const long = '43 01 03 01 ' + '00 '.repeat(200);
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async () => ({
      codes: ['P0301', 'P0420'], raw: long.slice(0, 260),
      supported: true, outcome: 'OK', elapsedMs: 10, protocol: '6',
    }));
    const r = await readAllDTCs();
    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.block).toBe('RAW_TRUNCATED');
    expect(e.provenance).toBe('LEGACY_NATIVE');
    /* Native listesi (TAM gövdeden çözülmüş) korunur — kod KAYBEDİLMEZ. */
    expect(r.codes.filter((c) => c.status === 'stored').map((c) => c.code))
      .toEqual(['P0301', 'P0420']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) REPLAY — PARSER_GAP KAPANDI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · C) replay ürün yolu', () => {
  async function captureAndReplay() {
    armGoldenBridge();
    const live = await readAllDTCs();
    const pkg = buildTracePackage(getTraceEvents(), 0, 'trace-FN', 1_700_000_000_000);
    expect(pkg.ok).toBe(true);
    if (!pkg.ok) throw new Error('unreachable');
    const imported = importTracePackage(pkg.body);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error('unreachable');

    resetAll();
    _resetTraceForTest('trace-FN-REPLAY');
    mono.t = 0;
    _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
    /* Replay sırasında canlı hat MAYINLI: tek çağrı bile testi düşürür. */
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(() => {
      throw new Error('İZOLASYON İHLALİ: replay sırasında readDtcClass çağrıldı');
    });
    const started = startReplay(imported.events, 'FAST', 'fn-run');
    expect(started.ok, started.ok ? '' : started.detail).toBe(true);
    const replay = await readAllDTCs();
    stopReplay();
    return { live, replay };
  }

  it('🔒 PASS KİLİDİ: Mode 03/07/0A replay uçtan uca — live ile AYNI kodlar', async () => {
    const { live, replay } = await captureAndReplay();
    const ids = (r: typeof live) => r.codes.map((c) => `${c.status}:${c.code}`).sort();
    expect(ids(replay), 'replay live ile AYNI kodları üretmedi').toEqual(ids(live));
    expect(replay.codes.length).toBeGreaterThan(0);
  });

  it('🔒 KİLİT: replay kanonik parser kullanır (PARSER_GAP KAPANDI)', async () => {
    await captureAndReplay();
    const ev = getFunctionalDtcEvidence();
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.provenance === 'CANONICAL_TS'),
      'replay kanonik parser kullanmadı').toBe(true);
    expect(ev.every((e) => e.replay), 'replay damgası taşınmadı').toBe(true);
    /* Native tanık YOK — bu bir kusur DEĞİL, izolasyonun sonucudur. */
    expect(ev.every((e) => e.parity === 'WITNESS_ABSENT')).toBe(true);
  });

  it('🔒 KİLİT: replay HİÇBİR native tanı çağrısı yapmaz', async () => {
    armGoldenBridge();
    await readAllDTCs();
    const pkg = buildTracePackage(getTraceEvents(), 0, 'trace-FN', 1);
    if (!pkg.ok) throw new Error('unreachable');
    const imported = importTracePackage(pkg.body);
    if (!imported.ok) throw new Error('unreachable');

    resetAll();
    _resetTraceForTest('trace-iso');
    vi.mocked(CarLauncher.readDtcClass!).mockClear();
    startReplay(imported.events, 'FAST', 'iso-run');
    await readAllDTCs();
    stopReplay();
    expect(vi.mocked(CarLauncher.readDtcClass!)).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT: replay BOZUK gövdeden "temiz" sonuç ÜRETMEZ', async () => {
    /* Ham gövdesi NO DATA olan bir iz — ölçüm YOK, kod yok DEĞİL. */
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async () => ({
      codes: [], raw: 'NO DATA', supported: true, outcome: 'NO_RESPONSE',
      elapsedMs: 10, protocol: '6',
    }));
    const live = await readAllDTCs();
    expect(live.completeness.stored).not.toBe('ok');

    const pkg = buildTracePackage(getTraceEvents(), 0, 'trace-nd', 1);
    if (!pkg.ok) throw new Error('unreachable');
    const imported = importTracePackage(pkg.body);
    if (!imported.ok) throw new Error('unreachable');

    resetAll();
    _resetTraceForTest('trace-nd-replay');
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(() => {
      throw new Error('İZOLASYON İHLALİ');
    });
    startReplay(imported.events, 'FAST', 'nd-run');
    const replay = await readAllDTCs();
    stopReplay();

    expect(replay.codes).toEqual([]);
    expect(replay.completeness.stored, 'ECU SUSTU ama tarama "ok" sayıldı').not.toBe('ok');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) FAIL-CLOSED — hiçbir arıza "temiz" üretmez
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · D) fail-closed', () => {
  const BAD: ReadonlyArray<readonly [string, string, string]> = [
    ['NO DATA',        'NO DATA',       'NO_RESPONSE'],
    ['negatif yanıt',  '7F 03 11',      'UNSUPPORTED'],
    ['hat hatası',     'BUS ERROR',     'BUS_ERROR'],
    ['beklenmeyen SID', '41 00 BE 3F',  'NO_SID'],
  ];

  for (const [name, raw, nativeOutcome] of BAD) {
    it(`🔒 ${name}: kod ÜRETİLMEZ ve kapsam "ok" SAYILMAZ`, async () => {
      vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async () => ({
        codes: [], raw, supported: nativeOutcome !== 'UNSUPPORTED',
        outcome: nativeOutcome, elapsedMs: 10, protocol: '6',
      }));
      const r = await readAllDTCs();
      expect(r.codes, name).toEqual([]);
      expect(r.completeness.stored, `${name} → tarama "ok" sayıldı`).not.toBe('ok');
    });
  }

  it('🔒 KİLİT: KISMİ yanıt (sayaç > gövde) temiz sayılmaz', async () => {
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async ({ mode }) => ({
      codes: [], raw: mode === '03' ? '43 03 00 89' : '43 00 00 00 00 00 00',
      supported: true, outcome: 'OK', elapsedMs: 10, protocol: '6',
    }));
    await readAllDTCs();
    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.malformedReason).toBe('PARTIAL_COUNT');
    expect(e.recordsDecoded).toBe(0);
    expect(e.parserOutcome).toBe('PARTIAL_TIMEOUT');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) KANIT — sessiz değil
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · E) parser kanıtı', () => {
  it('🔒 KİLİT: ölçümler taşınır (bayt · kayıt · dolgu · SID · atıf)', async () => {
    armGoldenBridge();
    await readAllDTCs();
    const e = getFunctionalDtcEvidenceFor('07')!;
    expect(e.positiveSid).toBe('47');
    expect(e.recordsDecoded).toBe(2);
    expect(e.paddingRecords).toBeGreaterThan(0);
    expect(e.inputBytes).toBeGreaterThan(0);
    expect(e.leftoverBytes).toBe(0);
    expect(e.authorityCodeCount).toBe(2);
    expect(e.ecuAttribution).toBe('NOT_APPLICABLE');
  });

  it('🔒 KİLİT: kanıt HAM gövde TAŞIMAZ (gizlilik)', async () => {
    armGoldenBridge();
    await readAllDTCs();
    const json = JSON.stringify(getFunctionalDtcEvidence());
    expect(json).not.toContain('43 03 01');
    expect(json).not.toContain('4303 01');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) RAW_UNPARSEABLE — kanonik "anlayamadim" derse kod DUSURULMEZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · F) taninmayan govde', () => {
  it('KILIT: kanonik govdeyi TANIYAMAZSA native listesi KORUNUR (kod kaybi YOK)', async () => {
    /* Govde gercek bir DTC yaniti degil; kanonik cozumleyici SID bulamaz.
       `MALFORMED` = "0 kod" DEGIL, "anlayamadim"dir — o sonucu urun otoritesi
       yapmak native'in GERCEKTEN cozdugu kodlari sessizce dusururdu. */
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async ({ mode }) => ({
      codes: mode === '03' ? ['P0301'] : [],
      raw: 'RAW', supported: true, outcome: 'OK', elapsedMs: 10, protocol: '6',
    }));
    const r = await readAllDTCs();

    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.block).toBe('RAW_UNPARSEABLE');
    expect(e.provenance).toBe('LEGACY_NATIVE');
    expect(r.codes.filter((c) => c.status === 'stored').map((c) => c.code)).toEqual(['P0301']);
  });

  it('KILIT: bu bir "hangisi doluysa onu kullan" kurali DEGILDIR', async () => {
    /* Kanonik BASARILI ama native FARKLI → kanonik KAZANIR (native dolu olsa bile). */
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async ({ mode }) => ({
      codes: ['P9999', 'P8888'],
      raw: mode === '03' ? GOLDEN_FUNCTIONAL_A.rawResponse : '43 00 00 00 00 00 00',
      supported: true, outcome: 'OK', elapsedMs: 10, protocol: '6',
    }));
    const r = await readAllDTCs();
    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.provenance).toBe('CANONICAL_TS');
    expect(e.block).toBeNull();
    expect(e.parity).toBe('MISMATCH');
    expect(r.codes.filter((c) => c.status === 'stored').map((c) => c.code)).toEqual(['P0301']);
  });

  it('KILIT: kanonik anlayamadi VE native de kod vermiyorsa temiz SAYILMAZ', async () => {
    vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async () => ({
      codes: [], raw: 'RAW', supported: true, outcome: 'OK', elapsedMs: 10, protocol: '6',
    }));
    const r = await readAllDTCs();
    const e = getFunctionalDtcEvidenceFor('03')!;
    expect(e.block).toBe('RAW_UNPARSEABLE');
    expect(e.parserOutcome).toBe('MALFORMED');
    expect(r.codes).toEqual([]);
    expect(r.completeness.stored, 'cozulemeyen govde "ok" sayildi').not.toBe('ok');
  });
});
