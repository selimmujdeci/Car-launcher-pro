/**
 * cddlPduProductPath.test — P0-VDK-F4A · ZİNCİRİN UÇTAN UCA KANITI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev §12)
 * ══════════════════════════════════════════════════════════════════════════
 *   CDDL ServiceDef → DiagnosticPdu → GENEL native salt-okunur köprü
 *   → ham ECU yanıtı → MEVCUT ayrıştırıcı → dtcAuthority
 *
 * ve **yeni bir salt-okunur servis eklemek için yeni köprü metodu
 * yazmak GEREKMİYOR**.
 *
 * "Sadece generic fonksiyon yazmak PASS değildir" — bu dosya zincirin
 * SONUNU (kanonik defter) ölçer, ortasını değil.
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
import { readByServiceDef, dtcScanOutcomeFromPdu } from '../platform/obd/cddlPduRead';
import { builtinServiceDefs, extraReadOnlyServiceDefs } from '../platform/obd/cddl/legacyAdapter';
import type { EcuVariant, ServiceDef } from '../platform/obd/cddl/schema';
import {
  getDtcAuthoritySnapshot, resetDtcAuthorityForSession,
} from '../platform/obd/dtcAuthority';

/* Defter TEK bir salt-okunur snapshot verir; ikinci getter kurulmaz. */
const getDtcObservations = () => getDtcAuthoritySnapshot().observations;
const getDtcServiceScans = () => getDtcAuthoritySnapshot().scans;
import {
  getAdvancedDtcEvidence, _resetAdvancedDtcEvidenceForTest,
} from '../platform/obd/advancedDtcEvidence';
import {
  beginTransaction, transitionTransaction, cancelTransaction,
  _resetTransactionsForTest,
} from '../platform/obd/diagnosticTransaction';
import { _resetPduRoutePolicyForTest, _setPduRoutePolicyForTest } from '../platform/obd/pduRouting';

/* ── Ortam ───────────────────────────────────────────────────────────────── */

let sent: Record<string, unknown>[] = [];

function bridge(reply: Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply; });
}

const ALL = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];
const def = (id: string): ServiceDef => {
  const d = ALL().find((x) => x.id === id);
  if (!d) throw new Error(`tanım yok: ${id}`);
  return d;
};

function ecu(serviceRefs: string[], over: Partial<EcuVariant> = {}): EcuVariant {
  return {
    id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
    addressing: 'physical', session: 'default', serviceRefs,
    patternRefs: [], comParamRefs: [],
    provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
    ...over,
  } as unknown as EcuVariant;
}

beforeEach(() => {
  sent = [];
  resetDtcAuthorityForSession(7);
  _resetAdvancedDtcEvidenceForTest();
  _resetTransactionsForTest();
  _resetPduRoutePolicyForTest();
  /* Zincir GENEL köprüden geçmeli — kanıt bu yolun çalıştığıdır. */
  _setPduRoutePolicyForTest('generic_only');
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) ANA KABUL — 1902FF ve 190A defterin SONUNA kadar gider
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · CDDL → PDU → generic bridge → parser → dtcAuthority', () => {
  it('1902FF: kodlar ayrıştırılır ve KANONİK deftere yazılır', async () => {
    /* `5902` SOYULMUŞ gövde: availabilityMask FF + iki DTC kaydı. */
    bridge({ outcome: 'ok', kind: 'OK', raw: 'FF0100110801002F08', nrc: undefined });

    const r = await readByServiceDef({
      service: def('uds_read_dtc_information'),
      ecu: ecu(['uds_read_dtc_information']),
      argument: 'FF', protocolClass: 'can', protocol: '6',
      ecuKey: 'ECM@7E0', sessionEpoch: 7,
    });

    expect(r.sent).toBe(true);
    expect(r.request).toBe('1902FF');
    expect(r.response?.outcome).toBe('POSITIVE');

    /* Köprüye gerçekten GENEL çağrı gitti. */
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ service: '19', subFunction: '02', echoBytes: 1 });

    /* AYRIŞTIRMA mevcut çözücüyle yapıldı. */
    expect(r.parsedCodeCount).toBeGreaterThan(0);

    /* KANONİK DEFTER — zincirin SONU. */
    const obs = getDtcObservations();
    expect(obs.length).toBe(r.parsedCodeCount);
    expect(obs.every((o) => o.dtcClass === 'UDS')).toBe(true);
    expect(obs.every((o) => o.sourceService === '19')).toBe(true);
    expect(obs.every((o) => o.provenance === 'physical_ecu')).toBe(true);
    expect(obs.every((o) => o.sessionEpoch === 7)).toBe(true);

    const scan = getDtcServiceScans().find((s) => s.service === '19');
    expect(scan?.outcome).toBe('ok');
    expect(scan?.codeCount).toBe(r.parsedCodeCount);

    /* Gelişmiş kanıt defteri de yazıldı. */
    expect(getAdvancedDtcEvidence()).toHaveLength(1);
  });

  it('190A: YENİ servis — yeni köprü metodu YAZILMADAN uçtan uca çalışır', async () => {
    bridge({ outcome: 'ok', kind: 'OK', raw: 'FF0100110800' });

    const r = await readByServiceDef({
      service: def('uds_report_supported_dtc'),
      ecu: ecu(['uds_report_supported_dtc']),
      protocolClass: 'can', ecuKey: 'ECM@7E0', sessionEpoch: 7,
    });

    expect(r.request).toBe('190A');
    expect(r.sent).toBe(true);
    expect(sent[0]).toMatchObject({ service: '19', subFunction: '0A' });

    const scan = getDtcServiceScans().find((s) => s.service === '19');
    expect(scan?.outcome).toBe('ok');

    /* KANIT: bu servis için CarLauncher'da ÖZEL bir metot YOKTUR. */
    expect((CarLauncher as unknown as Record<string, unknown>).readReportSupportedDtc)
      .toBeUndefined();
  });

  it('yeni servis eklemek YALNIZ VERİ işidir — köprü/ taşıma dosyaları değişmez', async () => {
    /* `kwp_read_dtc_13` ve `kwp_read_ecu_identification` bu turda YALNIZ
       `legacyAdapter` tablosuna satır eklenerek doğdu. */
    bridge({ outcome: 'ok', kind: 'OK', raw: '01123401' });
    const kwpEcu = ecu(['kwp_read_dtc_13'], { txHeader: '8110F1', rxHeader: '81F110' });

    const r = await readByServiceDef({
      service: def('kwp_read_dtc_13'), ecu: kwpEcu,
      protocolClass: 'kwp', targetVerified: true,
      ecuKey: 'ECM@8110F1', sessionEpoch: 7,
    });
    expect(r.request).toBe('13');
    expect(r.sent).toBe(true);
    expect(sent[0]).toMatchObject({ service: '13', echoBytes: 0, targetVerified: true });
    expect(getDtcServiceScans().find((s) => s.service === '13')?.outcome).toBe('ok');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) "BİZ SORAMADIK" ≠ "ARAÇ DESTEKLEMİYOR" — defterin sonuna kadar
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · kapsam kaybı defterde UNSUPPORTED olarak GÖRÜNMEZ', () => {
  it('sözlük çevirisi: yalnız AÇIK NEGATİF yanıt "unsupported"tır', () => {
    expect(dtcScanOutcomeFromPdu('NEGATIVE')).toBe('unsupported');
    expect(dtcScanOutcomeFromPdu('POSITIVE')).toBe('ok');
    expect(dtcScanOutcomeFromPdu('NO_RESPONSE')).toBe('no_data');
    expect(dtcScanOutcomeFromPdu('TIMEOUT')).toBe('timeout');
    /* ÜÇÜ DE araç hakkında iddia DEĞİLDİR → 'unsupported' OLAMAZ. */
    expect(dtcScanOutcomeFromPdu('NOT_SUPPORTED_BY_TRANSPORT')).toBe('failed');
    expect(dtcScanOutcomeFromPdu('DENIED_BY_SAFETY_GATE')).toBe('failed');
    expect(dtcScanOutcomeFromPdu('TRANSPORT_ERROR')).toBe('failed');
  });

  it('köprü YOKKEN (eski APK) defter "desteklenmiyor" DEMEZ', async () => {
    /* sendDiagnosticPdu tanımlı DEĞİL → NOT_SUPPORTED_BY_TRANSPORT. */
    const r = await readByServiceDef({
      service: def('uds_report_supported_dtc'),
      ecu: ecu(['uds_report_supported_dtc']),
      protocolClass: 'can', ecuKey: 'ECM@7E0', sessionEpoch: 7,
    });
    expect(r.response?.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    const scan = getDtcServiceScans().find((s) => s.service === '19');
    expect(scan?.outcome).toBe('failed');
    expect(scan?.outcome).not.toBe('unsupported');
    expect(scan?.diagnosticOutcome).toContain('NOT_SUPPORTED_BY_TRANSPORT');
    expect(getDtcObservations()).toHaveLength(0);
  });

  it('NRC geldiğinde "unsupported" YAZILIR ve NRC kaybolmaz', async () => {
    bridge({ outcome: 'negative_nrc', kind: 'NEG_7F', raw: '', nrc: 0x31 });
    const r = await readByServiceDef({
      service: def('uds_read_dtc_information'),
      ecu: ecu(['uds_read_dtc_information']),
      argument: 'FF', protocolClass: 'can', ecuKey: 'ECM@7E0', sessionEpoch: 7,
    });
    expect(r.response?.nrc).toBe(0x31);
    expect(getDtcServiceScans().find((s) => s.service === '19')?.outcome)
      .toBe('unsupported');
    expect(getAdvancedDtcEvidence()[0]?.nrc).toBe(0x31);
  });

  it('ECU susarsa "0 kod" DEĞİL, ölçüm YOK yazılır', async () => {
    bridge({ outcome: 'no_response', kind: 'NO_DATA', raw: '' });
    await readByServiceDef({
      service: def('uds_read_dtc_information'),
      ecu: ecu(['uds_read_dtc_information']),
      argument: 'FF', protocolClass: 'can', ecuKey: 'ECM@7E0', sessionEpoch: 7,
    });
    const scan = getDtcServiceScans().find((s) => s.service === '19');
    expect(scan?.outcome).toBe('no_data');
    expect(scan?.codeCount).toBe(0);
    expect(getDtcObservations()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) OTURUM / İPTAL KAPISI — istek HİÇ GİTMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · F1-A kapısı genel köprüde de geçerlidir', () => {
  it('İPTAL EDİLMİŞ işlemden sonra TEK BAYT gönderilmez', async () => {
    bridge({ outcome: 'ok', kind: 'OK', raw: 'FF' });
    const txn = beginTransaction({ purpose: 'dtc_scan' });
    transitionTransaction(txn, 'PREPARING');
    transitionTransaction(txn, 'SESSION_ACTIVE');
    cancelTransaction(txn, 'kullanıcı durdurdu');

    const r = await readByServiceDef({
      service: def('uds_read_dtc_information'),
      ecu: ecu(['uds_read_dtc_information']),
      argument: 'FF', protocolClass: 'can', txn, sessionEpoch: 7,
    });

    expect(r.sent).toBe(false);
    expect(r.rejection).toBe('TRANSACTION_NOT_LIVE');
    expect(sent).toHaveLength(0);
  });

  it('CANLI OLMAYAN işlem (CREATED) isteği ENGELLER', async () => {
    bridge({ outcome: 'ok', kind: 'OK', raw: 'FF' });
    const txn = beginTransaction({ purpose: 'dtc_scan' });
    const r = await readByServiceDef({
      service: def('uds_read_dtc_information'),
      ecu: ecu(['uds_read_dtc_information']),
      argument: 'FF', protocolClass: 'can', txn, sessionEpoch: 7,
    });
    expect(r.sent).toBe(false);
    expect(r.rejection).toBe('TRANSACTION_NOT_LIVE');
    expect(sent).toHaveLength(0);
  });

  it('istek bütçesi dolunca GÖNDERİLMEZ', async () => {
    bridge({ outcome: 'ok', kind: 'OK', raw: 'FF' });
    const txn = beginTransaction({ purpose: 'dtc_scan', budget: { maxRequests: 1 } });
    transitionTransaction(txn, 'PREPARING');
    transitionTransaction(txn, 'SESSION_ACTIVE');

    const input = {
      service: def('uds_read_dtc_information'),
      ecu: ecu(['uds_read_dtc_information']),
      argument: 'FF', protocolClass: 'can' as const, txn, sessionEpoch: 7,
    };
    const first = await readByServiceDef(input);
    const second = await readByServiceDef(input);

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.rejection).toBe('BUDGET_EXHAUSTED');
    expect(sent).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) PDU KURULAMIYORSA ZİNCİR BAŞLAMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · fail-closed kurulum', () => {
  it('ECU servisi SAYMIYORSA istek kurulmaz', async () => {
    bridge({ outcome: 'ok', kind: 'OK', raw: 'FF' });
    const r = await readByServiceDef({
      service: def('uds_read_dtc_information'),
      ecu: ecu([]), argument: 'FF', protocolClass: 'can', sessionEpoch: 7,
    });
    expect(r.sent).toBe(false);
    expect(r.rejection).toBe('SERVICE_NOT_ON_ECU');
    expect(sent).toHaveLength(0);
  });

  it('destructive tanım zincire HİÇ giremez', async () => {
    bridge({ outcome: 'ok', kind: 'OK', raw: 'FF' });
    const evil: ServiceDef = {
      ...def('uds_read_dtc_information'),
      id: 'evil', service: '11', subFunction: '01',
      effect: 'destructive', argKind: 'literal', literalPayload: '',
    };
    const r = await readByServiceDef({
      service: evil, ecu: ecu(['evil']), protocolClass: 'can', sessionEpoch: 7,
    });
    expect(r.sent).toBe(false);
    expect(r.rejection).toBe('DESTRUCTIVE_DENIED');
    expect(sent).toHaveLength(0);
  });
});
