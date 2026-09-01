/**
 * serviceDiscovery.test — P0-VDK-F4B · KEŞİF MOTORU KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev)
 * ══════════════════════════════════════════════════════════════════════════
 * "En az bir sentetik ECU'da servis/alt-fonksiyon yetenek haritası NORMAL ürün
 *  PDU yolundan ÖLÇÜLEREK oluşsun; `NRC 0x11` DIŞINDAKİ NRC'ler yanlışlıkla
 *  'servis yok' sayılmasın; taşıma yetersizliği ECU yetersizliği olarak
 *  KAYDEDİLMESİN."
 *
 * Bu dosyanın kilitlediği en pahalı üç hata:
 *  1. `0x31`/`0x12` görüp "servis yok" demek (var olan yeteneği yok saymak),
 *  2. köprü taşıyamadı diye "ECU desteklemiyor" demek (bizim sınırımızı
 *     aracın sınırı sanmak),
 *  3. bütçe bitince kalanları "yok" saymak (yarım taramayı yokluk kanıtı yapmak).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDtcClass: vi.fn(), readDtcFromEcu: vi.fn(),
    readAdvancedDtcs: vi.fn(), sendTesterPresent: vi.fn(),
  },
}));

import { CarLauncher } from '../platform/nativePlugin';
import {
  runServiceDiscovery, getProbeRecords, getDiscoverySummary,
  getProbeExclusions, _resetServiceDiscoveryForTest,
} from '../platform/obd/discovery/serviceDiscoveryRuntime';
import {
  buildProbeCorpus, expandSubFunctionProbes, mergeProbeRecord,
  gapSignalForPresence, summarizeProbes, type ProbeRecord,
} from '../platform/obd/discovery/serviceProbeModel';
import {
  deriveServicePresence, isServiceProbablyPresent, isPresenceCoverageLoss,
  isPresenceMeasured,
} from '../platform/obd/ecuCapabilityModel';
import { builtinServiceDefs, extraReadOnlyServiceDefs } from '../platform/obd/cddl/legacyAdapter';
import type { EcuVariant, ServiceDef } from '../platform/obd/cddl/schema';
import {
  beginTransaction, transitionTransaction, cancelTransaction,
  _resetTransactionsForTest,
} from '../platform/obd/diagnosticTransaction';
import { createSessionLease, failSession } from '../platform/obd/diagnosticSessionLease';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest } from '../platform/obd/pduRouting';
import { getGapRegistry, _resetGapRegistryForTest } from '../platform/obd/gapRegistry';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';

/* ── Ortam ───────────────────────────────────────────────────────────────── */

let sent: Record<string, unknown>[] = [];

/** Native genel köprü sahtesi — istek başına yanıt seçilebilir. */
function bridge(reply: (o: Record<string, unknown>) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply(o); });
}

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];
const def = (id: string): ServiceDef => {
  const d = DEFS().find((x) => x.id === id);
  if (!d) throw new Error(`tanım yok: ${id}`);
  return d;
};

function ecu(refs: string[], over: Partial<EcuVariant> = {}): EcuVariant {
  return {
    id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
    addressing: 'physical', session: 'default', serviceRefs: refs,
    patternRefs: [], comParamRefs: [],
    provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
    ...over,
  } as unknown as EcuVariant;
}

/** Canlı bir F1-A işlemi (CREATED → SESSION_ACTIVE). */
function liveTxn(maxRequests?: number) {
  const t = beginTransaction({
    purpose: 'ecu_probe',
    ...(maxRequests !== undefined ? { budget: { maxRequests } } : {}),
  });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  return t;
}

const UDS_ECU = () => ecu(['uds_read_dtc_information', 'uds_report_supported_dtc']);

async function runWith(
  reply: (o: Record<string, unknown>) => Record<string, unknown>,
  over: Partial<Parameters<typeof runServiceDiscovery>[0]> = {},
) {
  bridge(reply);
  return runServiceDiscovery({
    defs: DEFS(), ecu: UDS_ECU(), protocolClass: 'can', protocol: '6',
    txn: liveTxn(), ecuKey: 'ECM@7E0', sessionEpoch: 7, nowMs: 1_000,
    probeSubFunctions: false, ...over,
  });
}

beforeEach(() => {
  sent = [];
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetGapRegistryForTest();
  _resetPduRoutePolicyForTest();
  /* Keşif GENEL köprüden ölçmeli — kanıt bu yolun çalıştığıdır. */
  _setPduRoutePolicyForTest('generic_only');
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) SINIFLANDIRMA — EN KRİTİK BÖLÜM
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4B · servis varlığı sınıflandırması', () => {
  it('POZİTİF yanıt → PRESENT', () => {
    expect(deriveServicePresence('POSITIVE', null)).toBe('PRESENT');
  });

  it('YALNIZ NRC 0x11 → ABSENT', () => {
    expect(deriveServicePresence('NEGATIVE', 0x11)).toBe('ABSENT');
  });

  it('0x12 · 0x22 · 0x31 · 0x33 · 0x7E · 0x7F → PRESENT_BUT_CONDITIONED', () => {
    for (const nrc of [0x12, 0x22, 0x31, 0x33, 0x7E, 0x7F, 0x78, 0x83, 0x10]) {
      expect(deriveServicePresence('NEGATIVE', nrc), `NRC 0x${nrc.toString(16)}`)
        .toBe('PRESENT_BUT_CONDITIONED');
    }
  });

  it('NRC OKUNAMADIYSA bile "yok" DENMEZ — ECU yanıt verdi', () => {
    expect(deriveServicePresence('NEGATIVE', null)).toBe('PRESENT_BUT_CONDITIONED');
  });

  it('sessizlik/zaman aşımı/hat hatası → UNKNOWN (araç hakkında iddia YOK)', () => {
    expect(deriveServicePresence('NO_RESPONSE', null)).toBe('UNKNOWN');
    expect(deriveServicePresence('TIMEOUT', null)).toBe('UNKNOWN');
    expect(deriveServicePresence('TRANSPORT_ERROR', null)).toBe('UNKNOWN');
  });

  it('taşıma/adresleme/şekil sınırları AYRI kutulardır', () => {
    expect(deriveServicePresence('NOT_SUPPORTED_BY_TRANSPORT', null))
      .toBe('UNKNOWN_TRANSPORT_LIMIT');
    expect(deriveServicePresence('NOT_ADDRESSABLE', null)).toBe('UNKNOWN_ADDRESSING');
    expect(deriveServicePresence('MALFORMED', null)).toBe('UNKNOWN_RESPONSE_SHAPE');
    expect(deriveServicePresence('DENIED_BY_SAFETY_GATE', null)).toBe('PROBE_FORBIDDEN');
  });

  it('HİÇBİR "bilinmiyor" sonucu ABSENT ile aynı kutuya düşmez', () => {
    const unknowns = ['UNKNOWN', 'UNKNOWN_TRANSPORT_LIMIT', 'UNKNOWN_ADDRESSING',
      'UNKNOWN_RESPONSE_SHAPE', 'DEFERRED'] as const;
    for (const u of unknowns) {
      expect(isPresenceMeasured(u), u).toBe(false);
      expect(isPresenceCoverageLoss(u), u).toBe(true);
    }
    expect(isPresenceMeasured('ABSENT')).toBe(true);
    expect(isPresenceCoverageLoss('ABSENT')).toBe(false);
  });

  it('alt fonksiyon keşfi YALNIZ servis mevcutsa açılır', () => {
    expect(isServiceProbablyPresent('PRESENT')).toBe(true);
    expect(isServiceProbablyPresent('PRESENT_BUT_CONDITIONED')).toBe(true);
    for (const p of ['ABSENT', 'UNKNOWN', 'DEFERRED', 'PROBE_FORBIDDEN'] as const) {
      expect(isServiceProbablyPresent(p), p).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) GÜVENLİK — DESTRUCTIVE KORPUSA GİREMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4B · keşif korpusu fail-closed', () => {
  it('destructive tanım korpusa GİREMEZ ve hatta çıkmaz', async () => {
    const evilDefs: ServiceDef[] = DESTRUCTIVE_SERVICES.map((sid, i) => ({
      ...def('uds_read_dtc_information'),
      id: `evil_${sid}`, service: sid, subFunction: i % 2 === 0 ? '01' : null,
      effect: 'destructive', argKind: 'literal', literalPayload: '',
    }));
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }), {
      defs: evilDefs, ecu: ecu(evilDefs.map((d) => d.id)),
    });

    expect(r.stopReason).toBe('EMPTY_CORPUS');
    expect(sent).toHaveLength(0);
    expect(r.excluded.every((e) => e.reason === 'DESTRUCTIVE_DEF')).toBe(true);
    /* Hepsi PROBE_FORBIDDEN olarak KAYDEDİLDİ — sessizce yok sayılmadı. */
    const recs = getProbeRecords();
    expect(recs).toHaveLength(DESTRUCTIVE_SERVICES.length);
    expect(recs.every((x) => x.classification === 'PROBE_FORBIDDEN')).toBe(true);
  });

  it('destructive OLMAYAN ama beyaz liste dışı servis de giremez', () => {
    const odd: ServiceDef = {
      ...def('uds_read_dtc_information'),
      id: 'svc_23', service: '23', subFunction: null,
      effect: 'read_only', argKind: 'literal', literalPayload: '',
    };
    const c = buildProbeCorpus([odd], ecu(['svc_23']), 'can');
    expect(c.specs).toHaveLength(0);
    expect(c.excluded[0]?.reason).toBe('SAFETY_GATE');
  });

  it('ECU saymayan tanım ve protokol uyuşmazlığı ayrı gerekçelerle elenir', () => {
    const c = buildProbeCorpus(DEFS(), ecu(['kwp_read_dtc_13']), 'can');
    const reasons = new Set(c.excluded.map((e) => e.reason));
    expect(reasons.has('NOT_ON_ECU')).toBe(true);
    expect(reasons.has('PROTOCOL_MISMATCH')).toBe(true);
    expect(c.specs).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) UÇTAN UCA ÖLÇÜM
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4B · yetenek haritası ürün PDU yolundan ÖLÇÜLEREK oluşur', () => {
  it('pozitif ECU: 19-02 ve 19-0A PRESENT olarak haritalanır', async () => {
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAABBCC01' }));
    expect(r.stopReason).toBe('COMPLETED');
    expect(r.probesSent).toBe(2);

    const map = new Map(getProbeRecords().map((x) => [`${x.service}-${x.subFunction}`, x]));
    expect(map.get('19-02')?.classification).toBe('PRESENT');
    expect(map.get('19-0A')?.classification).toBe('PRESENT');
    /* Kanıt eksiksiz taşındı. */
    const rec = map.get('19-02')!;
    expect(rec.requestIdentity).toBe('1902FF');
    expect(rec.ecuKey).toBe('ECM@7E0');
    expect(rec.txHeader).toBe('7E0');
    expect(rec.reason).toContain('pozitif');
  });

  it('0x11 → ABSENT, 0x31 → PRESENT_BUT_CONDITIONED (AYNI turda)', async () => {
    const r = await runWith((o) => (o.subFunction === '0A'
      ? { outcome: 'negative_nrc', kind: 'NEG_7F', raw: '', nrc: 0x11 }
      : { outcome: 'negative_nrc', kind: 'NEG_7F', raw: '', nrc: 0x31 }));
    expect(r.probesSent).toBe(2);

    const map = new Map(getProbeRecords().map((x) => [`${x.service}-${x.subFunction}`, x]));
    expect(map.get('19-0A')?.classification).toBe('ABSENT');
    expect(map.get('19-02')?.classification).toBe('PRESENT_BUT_CONDITIONED');
    expect(map.get('19-02')?.nrc).toBe(0x31);
    expect(map.get('19-02')?.reason).toContain('0x31');
  });

  it('KÖPRÜ TAŞIYAMADI ≠ ECU DESTEKLEMİYOR', async () => {
    /* Genel köprü YOK (eski APK) → NOT_SUPPORTED_BY_TRANSPORT. */
    delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
    const r = await runServiceDiscovery({
      defs: DEFS(), ecu: UDS_ECU(), protocolClass: 'can',
      txn: liveTxn(), ecuKey: 'ECM@7E0', nowMs: 1_000, probeSubFunctions: false,
    });
    expect(r.probesSent).toBe(2);
    const recs = getProbeRecords();
    expect(recs.every((x) => x.classification === 'UNKNOWN_TRANSPORT_LIMIT')).toBe(true);
    expect(recs.some((x) => x.classification === 'ABSENT')).toBe(false);
    /* Sicile TAŞIMA sınırı olarak yazıldı — yetenek boşluğu olarak DEĞİL. */
    const gaps = getGapRegistry();
    expect(gaps.some((g) => g.signal === 'TRANSPORT_LIMITATION' && g.scope === 'TRANSPORT'))
      .toBe(true);
  });

  it('ECU sustu / zaman aşımı / bozuk yanıt → ayrı UNKNOWN kutuları', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ outcome: 'no_response', kind: 'NO_DATA', raw: '' }, 'UNKNOWN'],
      [{ outcome: 'timeout', kind: 'ERROR', raw: '' }, 'UNKNOWN'],
      [{ outcome: 'malformed', kind: 'ERROR', raw: 'ZZ' }, 'UNKNOWN_RESPONSE_SHAPE'],
    ];
    for (const [reply, expected] of cases) {
      _resetServiceDiscoveryForTest();
      _resetTransactionsForTest();
      await runWith(() => reply);
      expect(getProbeRecords().every((x) => x.classification === expected)).toBe(true);
    }
  });

  it('adres BİLİNMİYORSA istek gitmez ve UNKNOWN_ADDRESSING yazılır', async () => {
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }), {
      ecu: ecu(['uds_read_dtc_information', 'uds_report_supported_dtc'],
        { txHeader: 'ZZZZ', rxHeader: '7E8' }),
    });
    expect(sent).toHaveLength(0);
    expect(r.records.every((x) => x.classification === 'UNKNOWN_ADDRESSING')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ALT FONKSİYON KEŞFİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4B · alt fonksiyon keşfi', () => {
  it('servis PRESENT ise 0x19 whitelist alt fonksiyonları yoklanır (kör tarama YOK)', async () => {
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }), {
      defs: [def('uds_read_dtc_information')],
      ecu: ecu(['uds_read_dtc_information']),
      probeSubFunctions: true,
    });
    const subs = new Set(getProbeRecords().map((x) => x.subFunction));
    /* Yalnız F4-A kapısının salt-okunur kümesi. */
    expect([...subs].sort()).toEqual(['01', '02', '03', '06', '0A']);
    expect(r.probesSent).toBe(5);
    /* Kör tarama olsaydı 256 istek olurdu. */
    expect(sent.length).toBeLessThanOrEqual(5);
  });

  it('servis ABSENT ise alt fonksiyon HİÇ yoklanmaz', async () => {
    await runWith(() => ({ outcome: 'negative_nrc', kind: 'NEG_7F', raw: '', nrc: 0x11 }), {
      defs: [def('uds_read_dtc_information')],
      ecu: ecu(['uds_read_dtc_information']),
      probeSubFunctions: true,
    });
    expect(sent).toHaveLength(1);
    expect(getProbeRecords()).toHaveLength(1);
  });

  it('koşullu servis (0x22 NRC) alt fonksiyon keşfini AÇAR', () => {
    const c = expandSubFunctionProbes(
      def('uds_read_dtc_information'), UDS_ECU(), 'PRESENT_BUT_CONDITIONED', new Set());
    expect(c.specs.length).toBe(5);
    expect(c.specs.every((s) => s.isSubFunctionProbe)).toBe(true);
  });

  it('zaten yoklanmış alt fonksiyon TEKRAR sorulmaz', () => {
    const c = expandSubFunctionProbes(
      def('uds_read_dtc_information'), UDS_ECU(), 'PRESENT',
      new Set(['19|02', '19|0A']));
    expect(c.specs.map((s) => s.subFunction).sort()).toEqual(['01', '03', '06']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) BÜTÇE · İPTAL · OTURUM — "YARIM" ASLA "YOK" DEĞİLDİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4B · yarım kalan tarama yokluk kanıtı DEĞİLDİR', () => {
  it('bütçe bitince kalanlar DEFERRED — ABSENT DEĞİL', async () => {
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }), {
      txn: liveTxn(1),
    });
    expect(r.stopReason).toBe('BUDGET_EXHAUSTED');
    expect(r.probesSent).toBe(1);
    expect(r.deferred).toBeGreaterThan(0);

    const recs = getProbeRecords();
    expect(recs.some((x) => x.classification === 'DEFERRED')).toBe(true);
    expect(recs.some((x) => x.classification === 'ABSENT')).toBe(false);
  });

  it('İPTAL edilmiş işlemde TEK BAYT gönderilmez', async () => {
    const t = liveTxn();
    cancelTransaction(t, 'kullanıcı durdurdu');
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }), { txn: t });
    expect(sent).toHaveLength(0);
    expect(r.stopReason).toBe('TRANSACTION_NOT_LIVE');
    expect(getProbeRecords().every((x) => x.classification === 'DEFERRED')).toBe(true);
  });

  it('CANLI OLMAYAN işlem (CREATED / bayat mühür yolu) yoklamayı engeller', async () => {
    const t = beginTransaction({ purpose: 'ecu_probe' });   // CREATED
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }), { txn: t });
    expect(sent).toHaveLength(0);
    expect(r.stopReason).toBe('TRANSACTION_NOT_LIVE');
  });

  it('oturum kirası DEGRADED ise yoklama ERTELENİR', async () => {
    const lease = createSessionLease({
      leaseId: 'L1', transactionId: 'T1',
      ecuEndpoint: { txHeader: '7E0', rxHeader: '7E8', label: 'ECM' } as never,
      protocol: '6', sessionEpoch: 7, nowMs: 1_000,
    });
    failSession(lease, 'keepalive düştü');
    const r = await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }), { lease });
    expect(sent).toHaveLength(0);
    expect(r.stopReason).toBe('SESSION_DENIED');
    expect(getProbeRecords().every((x) => x.classification === 'DEFERRED')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) KANIT SEMANTİĞİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4B · kanıt güncelleme ve dedup', () => {
  const base: ProbeRecord = {
    ecuKey: 'ECM@7E0', ecuLabel: 'ECM', txHeader: '7E0', rxHeader: '7E8',
    service: '19', subFunction: '02', serviceDefId: 'uds_read_dtc_information',
    requestIdentity: '1902FF', outcome: 'POSITIVE', nrc: null, latencyMs: 12,
    sessionOpened: true, sessionCommand: '1003', transportKind: 'ok',
    traceCorrelationId: 'c1', protocol: '6',
    classification: 'PRESENT', reason: 'pozitif yanıt geldi', atMs: 1_000, count: 1,
  };

  it('aynı ECU × servis × alt fonksiyon TEK satır olur, sayaç artar', async () => {
    await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }));
    _resetTransactionsForTest();
    await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }));
    const recs = getProbeRecords();
    expect(recs).toHaveLength(2);           // 19-02 ve 19-0A
    expect(recs.every((x) => x.count === 2)).toBe(true);
  });

  it('ÖLÇÜLMÜŞ kanıt, ölçülmemiş sonuçla EZİLMEZ', () => {
    const noisy: ProbeRecord = {
      ...base, classification: 'UNKNOWN', outcome: 'NO_RESPONSE',
      reason: 'ECU sustu', atMs: 2_000,
    };
    const merged = mergeProbeRecord(base, noisy);
    expect(merged.classification).toBe('PRESENT');   // kanıt korundu
    expect(merged.count).toBe(2);
    expect(merged.atMs).toBe(2_000);                 // damga ilerledi
  });

  it('ölçülmüş sonucun üstüne ölçülmüş sonuç YAZILIR (en taze kazanır)', () => {
    const later: ProbeRecord = {
      ...base, classification: 'ABSENT', outcome: 'NEGATIVE', nrc: 0x11, atMs: 3_000,
    };
    expect(mergeProbeRecord(base, later).classification).toBe('ABSENT');
  });

  it('hiç yoklama yoksa özet 0 DEĞİL "kaynak yok" der', () => {
    expect(summarizeProbes([]).neverProbed).toBe(true);
    expect(summarizeProbes([base]).neverProbed).toBe(false);
    expect(getDiscoverySummary().neverProbed).toBe(true);
  });

  it('boşluk sinyalleri MEVCUT sözlükten gelir; PRESENT/ABSENT boşluk DEĞİL', () => {
    expect(gapSignalForPresence('PRESENT', false)).toBeNull();
    expect(gapSignalForPresence('ABSENT', false)).toBeNull();
    expect(gapSignalForPresence('PRESENT_BUT_CONDITIONED', false)).toBe('CAPABILITY_GAP');
    expect(gapSignalForPresence('UNKNOWN_TRANSPORT_LIMIT', false)).toBe('TRANSPORT_LIMITATION');
    expect(gapSignalForPresence('UNKNOWN_RESPONSE_SHAPE', false)).toBe('UNKNOWN_RESPONSE_SHAPE');
    expect(gapSignalForPresence('UNKNOWN', false)).toBe('UNKNOWN_SERVICE');
    expect(gapSignalForPresence('UNKNOWN', true)).toBe('UNKNOWN_SUBFUNCTION');
  });

  it('elenen adaylar gerekçesiyle görünür (sessiz eleme YOK)', async () => {
    await runWith(() => ({ outcome: 'ok', kind: 'OK', raw: 'FF' }));
    expect(getProbeExclusions().length).toBeGreaterThan(0);
    expect(getProbeExclusions().every((e) => typeof e.reason === 'string')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) DETERMİNİZM
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4B · aynı girdi → aynı harita', () => {
  it('iki koşu bit-aynı sınıflandırma üretir', async () => {
    const reply = (o: Record<string, unknown>) => (o.subFunction === '0A'
      ? { outcome: 'negative_nrc', kind: 'NEG_7F', raw: '', nrc: 0x11 }
      : { outcome: 'ok', kind: 'OK', raw: 'FFAA' });

    await runWith(reply);
    const first = getProbeRecords()
      .map((x) => `${x.service}${x.subFunction}:${x.classification}`).sort();

    _resetServiceDiscoveryForTest();
    _resetTransactionsForTest();
    await runWith(reply);
    const second = getProbeRecords()
      .map((x) => `${x.service}${x.subFunction}:${x.classification}`).sort();

    expect(second).toEqual(first);
    expect(first).toEqual(['1902:PRESENT', '190A:ABSENT']);
  });
});
