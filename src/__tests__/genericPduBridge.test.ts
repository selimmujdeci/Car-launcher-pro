/**
 * genericPduBridge.test — P0-VDK-F4A · GENEL SALT-OKUNUR PDU KÖPRÜSÜ KİLİTLERİ.
 *
 * Bu dosya üç iddiayı kilitler:
 *  1. CDDL tanımı → PDU → GENEL köprü zinciri GERÇEKTEN kuruluyor (1902FF · 190A).
 *  2. Destructive servisler köprüden GEÇEMEZ ve hatta TEK BAYT ÇIKMAZ.
 *  3. "Biz soramadık" ile "araç desteklemiyor dedi" ASLA aynı sonuca düşmez.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* Mevcut `pduTransport.test.ts` ile AYNI desen: köprü sahte bir nesnedir,
   böylece "eski APK'da metot YOK" durumu (silme) gerçekten test edilebilir. */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDtcClass: vi.fn(), readDtcFromEcu: vi.fn(),
    readAdvancedDtcs: vi.fn(), sendTesterPresent: vi.fn(),
  },
}));

import {
  makePdu, pduTarget, pduIdentity, encodePduRequest, isPduCoverageLoss,
  pduOutcomeFromGeneric, FUNCTIONAL_TARGET,
  type PduResponse,
} from '../platform/obd/pdu';
import {
  GenericPduTransport, judgeGenericPdu, genericBridgeAvailable,
  GENERIC_READ_ONLY_SERVICES, DESTRUCTIVE_SERVICES,
} from '../platform/obd/genericPduTransport';
import { ElmPduTransport, type PduTransport } from '../platform/obd/pduTransport';
import {
  HybridPduTransport, _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest,
  DEFAULT_PDU_ROUTE_POLICY,
} from '../platform/obd/pduRouting';
import { comparePduResponses, runPduParity } from '../platform/obd/pduParity';
import { buildPduFromServiceDef } from '../platform/obd/cddl/serviceDef';
import { builtinServiceDefs, extraReadOnlyServiceDefs } from '../platform/obd/cddl/legacyAdapter';
import type { EcuVariant, ServiceDef } from '../platform/obd/cddl/schema';
import { CarLauncher } from '../platform/nativePlugin';

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

type NativeCall = Record<string, unknown>;
let sent: NativeCall[] = [];

function mockBridge(reply: (o: NativeCall) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: NativeCall) => { sent.push(o); return reply(o); });
}

function removeBridge(): void {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
}

const ECM: EcuVariant = {
  id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
  addressing: 'physical', session: 'default', serviceRefs: [],
  patternRefs: [], comParamRefs: [], provenance: {
    source: 'builtin', reference: 'test', license: 'test', verifiedOn: null,
  },
} as unknown as EcuVariant;

function ecuWith(serviceRefs: string[], over: Partial<EcuVariant> = {}): EcuVariant {
  return { ...ECM, serviceRefs, ...over } as EcuVariant;
}

beforeEach(() => { sent = []; _resetPduRoutePolicyForTest(); });
afterEach(() => { removeBridge(); _resetPduRoutePolicyForTest(); vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
   1) GÜVENLİK — EN KRİTİK BÖLÜM
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · native güvenlik kapısı (TS aynası)', () => {
  it('destructive servislerin TEK BAYTI bile köprüye ULAŞMAZ', async () => {
    mockBridge(() => ({ outcome: 'ok', raw: 'AA', kind: 'OK' }));
    const t = new GenericPduTransport();

    for (const sid of DESTRUCTIVE_SERVICES) {
      const r = await t.send(makePdu({
        service: sid, subFunction: '01', payload: 'FFFF',
        target: pduTarget('7E0', '7E8'),
      }));
      expect(r.outcome, `${sid} geçti`).toBe('DENIED_BY_SAFETY_GATE');
      expect(isPduCoverageLoss(r.outcome)).toBe(true);
    }
    /* HAT SESSİZ KALDI: köprüye tek çağrı bile gitmedi. */
    expect(sent).toHaveLength(0);
  });

  it('beyaz liste dışındaki HER servis reddedilir (fail-closed, 256 bayt taraması)', () => {
    for (let i = 0; i < 256; i++) {
      const sid = i.toString(16).toUpperCase().padStart(2, '0');
      const verdict = judgeGenericPdu(makePdu({
        service: sid, subFunction: '02', payload: 'FF',
        target: pduTarget('7E0', '7E8'),
      }));
      if (!GENERIC_READ_ONLY_SERVICES.has(sid)) {
        expect(verdict, `${sid} beyaz liste dışıyken geçti`).not.toBe('OK');
      }
    }
  });

  it('beyaz liste ile destructive liste KESİŞMEZ', () => {
    for (const sid of DESTRUCTIVE_SERVICES) {
      expect(GENERIC_READ_ONLY_SERVICES.has(sid), `${sid} beyaz listede`).toBe(false);
    }
  });

  it('UDS 0x19 alt fonksiyonu salt-okunur kümeyle sınırlıdır', () => {
    const mk = (sub: string) => makePdu({
      service: '19', subFunction: sub, payload: '', target: pduTarget('7E0', '7E8'),
    });
    for (const ok of ['01', '02', '03', '06', '0A']) {
      expect(judgeGenericPdu(mk(ok))).toBe('OK');
    }
    for (const bad of ['04', '14', 'FF', '00']) {
      expect(judgeGenericPdu(mk(bad))).toBe('SUBFUNCTION_NOT_READ_ONLY');
    }
  });

  it('bozuk biçim bir "belki"dir ve hatta çıkmaz', () => {
    const t = pduTarget('7E0', '7E8');
    expect(judgeGenericPdu(makePdu({ service: '1', target: t }))).toBe('MALFORMED_REQUEST');
    expect(judgeGenericPdu(makePdu({ service: '22', payload: 'F1', target: t })))
      .toBe('OK');
    expect(judgeGenericPdu({
      ...makePdu({ service: '22', target: t }), payload: 'F19',
    })).toBe('MALFORMED_REQUEST');
    expect(judgeGenericPdu({
      ...makePdu({ service: '22', target: t }), payload: 'A'.repeat(200),
    })).toBe('MALFORMED_REQUEST');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ADRESLEME
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · adresleme (yeni tahmin sistemi YOK)', () => {
  it('adres BİLİNMİYORSA istek GÖNDERİLMEZ', async () => {
    mockBridge(() => ({ outcome: 'ok', raw: 'AA', kind: 'OK' }));
    const r = await new GenericPduTransport().send(makePdu({
      service: '19', subFunction: '02', payload: 'FF',
      target: pduTarget('ZZZZ', '7E8'),
    }));
    expect(r.outcome).toBe('NOT_ADDRESSABLE');
    expect(sent).toHaveLength(0);
  });

  it('CAN11 · CAN29 · KWP · fonksiyonel — dördü de mevcut sınıflandırmayı kullanır', async () => {
    mockBridge(() => ({ outcome: 'ok', raw: '5902AA', kind: 'OK' }));
    const t = new GenericPduTransport();

    const can11 = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'), responseEchoBytes: 1 });
    const can29 = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('18DA10F1', '18DAF110'), responseEchoBytes: 1 });
    const kwp = makePdu({ service: '18', subFunction: null, payload: '00FF00', target: pduTarget('8110F1', '81F110'), responseEchoBytes: 0 });
    const func = makePdu({ service: '03', subFunction: null, payload: '', target: FUNCTIONAL_TARGET });

    expect(can11.target.addressing).toBe('physical_can11');
    expect(can29.target.addressing).toBe('physical_can29');
    expect(kwp.target.addressing).toBe('physical_kwp');
    expect(func.target.addressing).toBe('functional');

    for (const p of [can11, can29, kwp, func]) {
      const r = await t.send(p, { targetVerified: true });
      expect(r.outcome).toBe('POSITIVE');
    }
    expect(sent).toHaveLength(4);
    /* Fonksiyonel yayında başlık BOŞ gider — native default adresleme. */
    expect(sent[3].tx).toBe('');
  });

  it('KWP fiziksel hedef native tarafta targetVerified ister (kapı korunur)', async () => {
    mockBridge((o) => (o.targetVerified === true
      ? { outcome: 'ok', raw: '58AA', kind: 'OK' }
      : { outcome: 'not_addressable', raw: '', kind: 'NOT_SENT', gate: 'KWP_TARGET_UNVERIFIED' }));
    const t = new GenericPduTransport();
    const pdu = makePdu({
      service: '18', payload: '00FF00', target: pduTarget('8110F1', '81F110'),
    });

    const denied = await t.send(pdu);
    expect(denied.outcome).toBe('NOT_ADDRESSABLE');
    expect(denied.detail).toContain('KWP_TARGET_UNVERIFIED');

    const ok = await t.send(pdu, { targetVerified: true });
    expect(ok.outcome).toBe('POSITIVE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) GENERIC ≠ NEGATIVE (§5)
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · "biz soramadık" ile "araç desteklemiyor" AYRI kalır', () => {
  it('üç ayrı sonuç ASLA birleşmez', () => {
    expect(pduOutcomeFromGeneric('denied')).toBe('DENIED_BY_SAFETY_GATE');
    expect(pduOutcomeFromGeneric('negative_nrc')).toBe('NEGATIVE');
    expect(pduOutcomeFromGeneric(null)).toBe('UNKNOWN');
    const distinct = new Set([
      'DENIED_BY_SAFETY_GATE', 'NOT_SUPPORTED_BY_TRANSPORT', 'NEGATIVE',
    ]);
    expect(distinct.size).toBe(3);
    /* NEGATIVE kapsam kaybı DEĞİLDİR: ECU cevap verdi. */
    expect(isPduCoverageLoss('NEGATIVE')).toBe(false);
    expect(isPduCoverageLoss('DENIED_BY_SAFETY_GATE')).toBe(true);
    expect(isPduCoverageLoss('NOT_SUPPORTED_BY_TRANSPORT')).toBe(true);
  });

  it('eski APK (köprü YOK) fail-soft: NOT_SUPPORTED_BY_TRANSPORT', async () => {
    removeBridge();
    expect(genericBridgeAvailable()).toBe(false);
    const r = await new GenericPduTransport().send(makePdu({
      service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'),
    }));
    expect(r.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    expect(r.raw).toBeNull();
  });

  it('NRC · NO_RESPONSE · timeout · malformed · transport_error KORUNUR', async () => {
    const cases: Array<[Record<string, unknown>, PduResponse['outcome']]> = [
      [{ outcome: 'negative_nrc', kind: 'NEG_7F', raw: '', nrc: 0x31 }, 'NEGATIVE'],
      [{ outcome: 'no_response', kind: 'NO_DATA', raw: '' }, 'NO_RESPONSE'],
      [{ outcome: 'timeout', kind: 'ERROR', raw: '' }, 'TIMEOUT'],
      [{ outcome: 'malformed', kind: 'ERROR', raw: 'ZZ' }, 'MALFORMED'],
      [{ outcome: 'transport_error', kind: 'ERROR', raw: '' }, 'TRANSPORT_ERROR'],
    ];
    for (const [reply, expected] of cases) {
      mockBridge(() => reply);
      const r = await new GenericPduTransport().send(makePdu({
        service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'),
      }));
      expect(r.outcome).toBe(expected);
    }
    /* NRC sayısal olarak KAYBOLMAZ. */
    mockBridge(() => ({ outcome: 'negative_nrc', kind: 'NEG_7F', raw: '', nrc: 0x31 }));
    const neg = await new GenericPduTransport().send(makePdu({
      service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'),
    }));
    expect(neg.nrc).toBe(0x31);
  });

  it('köprü istisna fırlatırsa TAŞIMA hatasıdır — araç iddiası DEĞİL', async () => {
    (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
      vi.fn(async () => { throw new Error('bağlantı koptu'); });
    const r = await new GenericPduTransport().send(makePdu({
      service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'),
    }));
    expect(r.outcome).toBe('TRANSPORT_ERROR');
    expect(r.detail).toContain('bağlantı koptu');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) OTURUM / AYAR / GERİ ALMA KANITI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · session · tuning · restore kanıtı kaybolmaz', () => {
  it('oturum ve ayar kanıtı köprüden AYNEN taşınır', async () => {
    mockBridge(() => ({
      outcome: 'ok', kind: 'OK', raw: '02AABBCC01',
      sessionOpened: true, sessionCommand: '1003',
      tuningApplied: true, tuningCommands: 'ATFCSH7E0=OK',
      tuningPreviousMode: '0', tuningNewMode: '1',
      tuningRestored: true, tuningRestoreDetail: 'ATFCSM0=OK',
      byteCount: 5, frameCount: 2, latencyMs: 143,
    }));
    const r = await new GenericPduTransport().send(makePdu({
      service: '19', subFunction: '02', payload: 'FF',
      target: pduTarget('7E0', '7E8'), responseEchoBytes: 1,
    }), { isoTpTuning: true });

    expect(r.session).toEqual({ opened: true, command: '1003' });
    expect(r.tuning?.applied).toBe(true);
    expect(r.tuning?.restored).toBe(true);
    expect(r.byteCount).toBe(5);
    expect(r.frameCount).toBe(2);
    expect(r.latencyMs).toBe(143);
    expect(sent[0].isoTpTuning).toBe(true);
  });

  it('eski APK oturum alanı taşımıyorsa keepalive AÇILMAZ (fail-closed)', async () => {
    mockBridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'AA' }));
    const r = await new GenericPduTransport().send(makePdu({
      service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'),
    }));
    expect(r.session).toBeNull();
    expect(r.tuning).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) CDDL → PDU → GENEL KÖPRÜ ZİNCİRİ (ana kabul kanıtı)
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · CDDL ServiceDef → DiagnosticPdu → generic bridge', () => {
  const defs = () => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];
  const byId = (id: string): ServiceDef => {
    const d = defs().find((x) => x.id === id);
    if (!d) throw new Error(`tanım yok: ${id}`);
    return d;
  };

  it('1902FF — tanımdan kurulur ve genel köprüden GİDER', async () => {
    mockBridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'FFAABBCC01' }));
    const svc = byId('uds_read_dtc_information');
    const built = buildPduFromServiceDef({
      service: svc, ecu: ecuWith([svc.id]), argument: 'FF', protocolClass: 'can',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(encodePduRequest(built.pdu)).toBe('1902FF');
    expect(built.pdu.responseEchoBytes).toBe(1);

    const r = await new GenericPduTransport().send(built.pdu);
    expect(r.outcome).toBe('POSITIVE');
    expect(sent[0]).toMatchObject({
      service: '19', subFunction: '02', payload: 'FF', echoBytes: 1, tx: '7E0',
    });
  });

  it('190A — YENİ SERVİS, yalnız VERİ eklenerek zincir kuruldu', async () => {
    mockBridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'AABBCC' }));
    const svc = byId('uds_report_supported_dtc');
    const built = buildPduFromServiceDef({
      service: svc, ecu: ecuWith([svc.id]), protocolClass: 'can',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(encodePduRequest(built.pdu)).toBe('190A');
    const r = await new GenericPduTransport().send(built.pdu);
    expect(r.outcome).toBe('POSITIVE');
    expect(sent[0]).toMatchObject({ service: '19', subFunction: '0A', echoBytes: 1 });
  });

  it('KWP 0x13 ve 0x1A da yalnız tanımla kurulur', async () => {
    mockBridge(() => ({ outcome: 'ok', kind: 'OK', raw: '01AABB' }));
    const kwpEcu = ecuWith(['kwp_read_dtc_13', 'kwp_read_ecu_identification'],
      { txHeader: '8110F1', rxHeader: '81F110' });

    const b13 = buildPduFromServiceDef({
      service: byId('kwp_read_dtc_13'), ecu: kwpEcu, protocolClass: 'kwp',
    });
    expect(b13.ok && encodePduRequest(b13.pdu)).toBe('13');

    const b1a = buildPduFromServiceDef({
      service: byId('kwp_read_ecu_identification'), ecu: kwpEcu,
      argument: '80', protocolClass: 'kwp',
    });
    expect(b1a.ok && encodePduRequest(b1a.pdu)).toBe('1A80');
    if (b1a.ok) expect(b1a.pdu.responseEchoBytes).toBe(1);
  });

  it('destructive tanım PDU BİLE ÜRETMEZ (kapı zincirin başında da var)', () => {
    const evil: ServiceDef = {
      ...byId('uds_read_dtc_information'),
      id: 'evil_clear', service: '14', subFunction: null,
      effect: 'destructive', argKind: 'literal', literalPayload: '',
    };
    const r = buildPduFromServiceDef({ service: evil, ecu: ecuWith([evil.id]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('DESTRUCTIVE_DENIED');
  });

  it('her CDDL tanımı echo sayısı TAŞIR ve makul aralıktadır', () => {
    for (const d of defs()) {
      expect(Number.isInteger(d.responseEchoBytes), d.id).toBe(true);
      expect(d.responseEchoBytes).toBeGreaterThanOrEqual(0);
      expect(d.responseEchoBytes).toBeLessThanOrEqual(8);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) YÖNLENDİRME POLİTİKASI + LEGACY PARITY
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · legacy korunur, parity tanık olarak çalışır', () => {
  function fakeTransport(res: PduResponse, log: string[], tag: string): PduTransport {
    return {
      capabilities: { kind: 'elm327', supportedServices: ['19'], supportsArbitraryPdu: false },
      async send() { log.push(tag); return res; },
    };
  }

  const base: PduResponse = {
    outcome: 'POSITIVE', raw: 'FFAABBCC01', nrc: null, latencyMs: 120,
    byteCount: 5, frameCount: 2, protocol: '6', transportKind: 'ok',
    session: { opened: true, command: '1003' },
    tuning: {
      applied: true, commands: 'ATFCSH7E0=OK', previousMode: '0', newMode: '1',
      restored: true, restoreDetail: 'ATFCSM0=OK',
    },
    detail: null,
  };

  it('VARSAYILAN politika legacy_first — mevcut davranış DEĞİŞMEZ', async () => {
    expect(DEFAULT_PDU_ROUTE_POLICY).toBe('legacy_first');
    const log: string[] = [];
    const h = new HybridPduTransport(
      fakeTransport(base, log, 'legacy'), fakeTransport(base, log, 'generic'));
    /* Legacy'nin taşıyabildiği servis → legacy çağrılır. */
    await h.send(makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8') }));
    expect(log).toEqual(['legacy']);
  });

  it('legacy taşıyamadığı servisi GENEL köprüye devreder ve bunu SÖYLER', async () => {
    const log: string[] = [];
    const h = new HybridPduTransport(
      fakeTransport(base, log, 'legacy'), fakeTransport(base, log, 'generic'));
    const r = await h.send(makePdu({
      service: '22', payload: 'F190', target: pduTarget('7E0', '7E8'),
    }));
    expect(log).toEqual(['generic']);
    expect(r.detail).toContain('genel köprü');
  });

  it('generic_only ve legacy_only tanık modları çalışır', async () => {
    const log: string[] = [];
    const h = new HybridPduTransport(
      fakeTransport(base, log, 'legacy'), fakeTransport(base, log, 'generic'));
    const pdu = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8') });

    _setPduRoutePolicyForTest('generic_only');
    await h.send(pdu);
    _setPduRoutePolicyForTest('legacy_only');
    await h.send(pdu);
    expect(log).toEqual(['generic', 'legacy']);
  });

  it('aynı sonuç → MATCH', async () => {
    const log: string[] = [];
    const pdu = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8') });
    const p = await runPduParity(pdu,
      fakeTransport(base, log, 'l'), fakeTransport({ ...base, latencyMs: 999 }, log, 'g'));
    expect(p.verdict).toBe('MATCH');
    expect(p.identity).toBe(pduIdentity(pdu));
  });

  it('fark varsa HANGİ KATMANDA olduğu görünür', () => {
    const pdu = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8') });
    const p = comparePduResponses(pdu, base, {
      ...base, raw: 'FFAABBCC02', nrc: 0x31,
      tuning: { ...base.tuning!, restored: false, restoreDetail: 'ATFCSM0=?' },
    });
    expect(p.verdict).toBe('PARITY_MISMATCH');
    const axes = p.differences.map((d) => d.axis).sort();
    expect(axes).toEqual(['NRC', 'RAW', 'RESTORE']);
    const raw = p.differences.find((d) => d.axis === 'RAW');
    expect(raw?.legacy).toBe('FFAABBCC01');
    expect(raw?.generic).toBe('FFAABBCC02');
  });

  it('taraflardan biri isteği GÖNDERMEDİYSE karşılaştırma YAPILMAZ', () => {
    const pdu = makePdu({ service: '22', payload: 'F190', target: pduTarget('7E0', '7E8') });
    const p = comparePduResponses(pdu, {
      ...base, outcome: 'NOT_SUPPORTED_BY_TRANSPORT', raw: null,
    }, base);
    expect(p.verdict).toBe('NOT_COMPARABLE');
    expect(p.incomparableReason).toContain('GÖNDERMEDİ');
    expect(p.differences).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) REPLAY / İZ KİMLİĞİ KORUNDU
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4A · F2 mimarisi bozulmadı', () => {
  it('echo alanı istek künyesini ve kimliği DEĞİŞTİRMEZ', () => {
    const a = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8') });
    const b = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'), responseEchoBytes: 1 });
    expect(encodePduRequest(a)).toBe(encodePduRequest(b));
    expect(pduIdentity(a)).toBe(pduIdentity(b));
  });

  it('legacy ElmPduTransport genel köprüyü KULLANMAZ (tanık saf kalır)', async () => {
    mockBridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'AA' }));
    const r = await new ElmPduTransport().send(makePdu({
      service: '22', payload: 'F190', target: pduTarget('7E0', '7E8'),
    }));
    expect(r.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    expect(sent).toHaveLength(0);
  });
});
