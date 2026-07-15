/**
 * OBD-OS-F4-1 — Verdict Engine: kanıt → karar → aksiyon.
 *
 * ÜÇ SÖZLEŞME KİLİTLENİR:
 *  1. CONFIDENCE KANITTAN TÜRER (sabit olamaz) — göremediğimiz her şey güveni DÜŞÜRÜR.
 *  2. FAIL-CLOSED — kanıt eksikse "temiz" DEME.
 *  3. HER BULGU KANITA BAĞLI — evidence boş olamaz (uydurma bulgu yasak).
 */
import { describe, it, expect } from 'vitest';
import { buildVehicleVerdict, type VerdictEngineInput } from '../platform/obd/verdictEngine';
import { computeDtcVerdict } from '../platform/obd/dtcVerdict';
import { buildScanReport } from '../platform/obd/scanReport';
import { buildTopology, emptyTopology } from '../platform/obd/ecuDiscovery';
import type { MultiEcuScanReport, EcuDtc } from '../platform/obd/multiEcuScan';

/** Sağlıklı taban: her şey okundu, hiç bulgu yok, 2 ECU sorunsuz. */
function healthyMultiEcu(codes: EcuDtc[] = []): MultiEcuScanReport {
  const topology = buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1);
  return {
    topology,
    results: topology.ecus.map((ecu) => ({
      ecu, stored: 'ok', pending: 'ok', permanent: 'ok', uds: 'unsupported',
      codes: codes.filter((c) => c.ecuTxHeader === ecu.txHeader),
    })),
    allCodes: codes,
    failedReads: 0,
    scannedEcus: 2,
    skippedEcus: 0,
  };
}

function base(over: Partial<VerdictEngineInput> = {}): VerdictEngineInput {
  return {
    dtc: computeDtcVerdict({
      scanRan: true, storedCount: 0, pendingCount: 0, permanentCount: 0,
      mil: false, pid01DtcCount: 0, failedModes: [],
    }),
    scan: buildScanReport({ stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok' }),
    multiEcu: healthyMultiEcu(),
    criticalCodes: [],
    ...over,
  };
}

const dtc = (over: Partial<EcuDtc>): EcuDtc => ({
  code: 'P0301', ecuLabel: 'Motor (ECM)', ecuTxHeader: '7E0', mode: 'stored', ...over,
});

describe('OBD-OS-F4-1 — verdict seviyeleri (fail-closed)', () => {
  it('her şey okundu + bulgu yok → clean, güven TAM', () => {
    const v = buildVehicleVerdict(base());
    expect(v.level).toBe('clean');
    expect(v.confidence).toBe(1);
    expect(v.actions[0]!.id).toBe('no_action');
  });

  it('kritik kod → critical + "servise başvurun" birinci öncelik', () => {
    const v = buildVehicleVerdict(base({
      multiEcu: healthyMultiEcu([dtc({ code: 'P0301' })]),
      criticalCodes: ['P0301'],
    }));
    expect(v.level).toBe('critical');
    expect(v.actions[0]!.id).toBe('service_now');
    expect(v.actions[0]!.priority).toBe(1);
    expect(v.actions[0]!.reason).toContain('P0301');   // gerekçe KANITA bağlı
  });

  it('kritik olmayan kod → attention', () => {
    const v = buildVehicleVerdict(base({ multiEcu: healthyMultiEcu([dtc({ code: 'P0420' })]) }));
    expect(v.level).toBe('attention');
  });

  it('🔒 KİLİT: bulgu YOK ama okuma düştü → "temiz" DENMEZ (inconclusive)', () => {
    const v = buildVehicleVerdict(base({
      scan: buildScanReport({ stored: 'ok', pending: 'failed', permanent: 'ok', status: 'ok' }),
    }));
    expect(v.level).toBe('inconclusive');
    expect(v.level).not.toBe('clean');
    expect(v.actions.some((a) => a.id === 'rescan')).toBe(true);
  });

  it('tarama hiç yapılmadı → not_scanned', () => {
    const v = buildVehicleVerdict(base({
      dtc: computeDtcVerdict({
        scanRan: false, storedCount: 0, pendingCount: 0, permanentCount: 0,
        mil: null, pid01DtcCount: null, failedModes: [],
      }),
    }));
    expect(v.level).toBe('not_scanned');
  });
});

describe('OBD-OS-F4-1 — confidence KANITTAN türer (sabit olamaz)', () => {
  it('🔒 KİLİT: ECU keşfi yapılamadıysa güven TAVANLANIR (araç geneli hakkında konuşamayız)', () => {
    const v = buildVehicleVerdict(base({ multiEcu: null }));
    expect(v.confidence).toBeLessThanOrEqual(0.6);
    expect(v.confidenceReason).toMatch(/ECU keşfi yapılamadı/);
  });

  it('🔒 KİLİT: bir ECU okunamadıysa güven DÜŞER', () => {
    const me = healthyMultiEcu();
    me.results[1] = { ...me.results[1]!, stored: 'failed', pending: 'failed', permanent: 'failed' };
    me.failedReads = 3;
    const v = buildVehicleVerdict(base({ multiEcu: me }));
    expect(v.confidence).toBeLessThan(1);
    expect(v.confidenceReason).toMatch(/1 ECU okunamadı/);
  });

  it('kısmi mod kapsamı güveni düşürür (coverage ile orantılı)', () => {
    const v = buildVehicleVerdict(base({
      scan: buildScanReport({ stored: 'ok', pending: 'failed', permanent: 'ok', status: 'ok' }),
    }));
    expect(v.confidence).toBeLessThan(1);
    expect(v.coverage).toBeLessThan(1);
  });

  it('bütçe tavanı nedeniyle taranmayan ECU güveni düşürür (sessiz kırpma yalanı yok)', () => {
    const me = healthyMultiEcu();
    me.skippedEcus = 4;
    const v = buildVehicleVerdict(base({ multiEcu: me }));
    expect(v.confidence).toBeLessThan(1);
    expect(v.confidenceReason).toMatch(/taranmadı/);
  });

  it('hiçbir ECU yanıt vermediyse güven ciddi düşer', () => {
    const v = buildVehicleVerdict(base({
      multiEcu: { ...healthyMultiEcu(), topology: buildTopology('NO DATA', 1), results: [], scannedEcus: 0 },
    }));
    expect(v.confidence).toBeLessThanOrEqual(0.5);
  });

  it('keşif hiç çalışmamış topoloji (probedAt null) de tavanlanır', () => {
    const v = buildVehicleVerdict(base({
      multiEcu: { ...healthyMultiEcu(), topology: emptyTopology(), results: [], scannedEcus: 0 },
    }));
    expect(v.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe('OBD-OS-F4-1 — bulgular KANITA bağlı (uydurma yasak)', () => {
  it('🔒 KİLİT: HER bulgunun evidence alanı DOLU', () => {
    const v = buildVehicleVerdict(base({
      multiEcu: healthyMultiEcu([dtc({ code: 'C1234', ecuTxHeader: '7E1', ecuLabel: 'ECU 7E1', fromUds: true, failureType: '1C', active: true })]),
      scan: buildScanReport({ stored: 'ok', pending: 'failed', permanent: 'ok', status: 'ok' }),
    }));
    expect(v.findings.length).toBeGreaterThan(0);
    for (const f of v.findings) {
      expect(f.evidence.length, `${f.id} kanıtsız üretilmiş`).toBeGreaterThan(0);
    }
  });

  it('UDS kodu "üretici-özel" olarak ayrışır ve kanıtı UDS’i gösterir', () => {
    const v = buildVehicleVerdict(base({
      multiEcu: healthyMultiEcu([dtc({ code: 'C1234', fromUds: true, active: true, failureType: '1C' })]),
    }));
    const f = v.findings.find((x) => x.source === 'uds_dtc')!;
    expect(f.detail).toMatch(/Üretici-özel/);
    expect(f.evidence).toContain('UDS 0x19 (üretici tabanı)');
    expect(f.evidence).toContain('şu anda AKTİF');
    expect(v.actions.some((a) => a.id === 'uds_codes_found')).toBe(true);
  });

  it('MIL tutarsızlığı → "üretici protokolüyle derin tarama" aksiyonu (F1-2 → F3 köprüsü)', () => {
    const v = buildVehicleVerdict(base({
      dtc: computeDtcVerdict({
        scanRan: true, storedCount: 0, pendingCount: 0, permanentCount: 0,
        mil: true, pid01DtcCount: 0, failedModes: [],
      }),
    }));
    expect(v.findings.some((f) => f.source === 'mil_inconsistency')).toBe(true);
    expect(v.actions.some((a) => a.id === 'manufacturer_scan')).toBe(true);
  });

  it('kod provenance (hangi ECU) bulgu başlığında KAYBOLMAZ', () => {
    const v = buildVehicleVerdict(base({
      multiEcu: healthyMultiEcu([dtc({ code: 'C1234', ecuTxHeader: '7E1', ecuLabel: 'ECU 7E1' })]),
    }));
    const f = v.findings.find((x) => x.id.includes('C1234'))!;
    expect(f.title).toContain('ECU 7E1');
    expect(f.evidence).toContain('ECU 7E1');
  });
});
