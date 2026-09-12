/**
 * remoteDiagnosticCommands.test.ts — Teşhis komutlarının DÜRÜSTLÜK kilitleri.
 *
 * Kilitlenen ölçülen kusur (2026-08-14): PWA `read_dtc`/`clear_dtc`/`read_voltage`
 * gönderiyordu, araç tarafında tip HİÇ yoktu → `default: rejected`. Uç bağlandı;
 * bu testler bağlantının YALAN SÖYLEMEDİĞİNİ kilitler:
 *   · araç yoksa "arıza yok" denmez
 *   · kısmi tarama gizlenmez
 *   · ölçülmemiş voltaj 0 V diye raporlanmaz
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => _native },
}));

let _native = false;

const _readAllDTCs   = vi.fn();
const _readDTCCodes  = vi.fn();
const _clearDTCCodes = vi.fn();
const _obdSnapshot   = vi.fn();

vi.mock('../platform/dtcService', () => ({
  readAllDTCs:   (...a: unknown[]) => _readAllDTCs(...a),
  readDTCCodes:  (...a: unknown[]) => _readDTCCodes(...a),
  clearDTCCodes: (...a: unknown[]) => _clearDTCCodes(...a),
}));

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => _obdSnapshot(),
}));

import {
  toRemoteDtcCode, isPartialScan, buildRemoteScanResult, isReportableVoltage,
  executeReadDtc, executeReadVoltage, executeClearDtc,
} from '../platform/remoteDiagnosticCommands';
import type { DTCCodeWithStatus } from '../platform/dtcService';

const CODE: DTCCodeWithStatus = {
  code: 'P0420', description: 'Katalitik dönüştürücü verimi düşük',
  system: 'Egzoz', severity: 'warning', possibleCauses: ['katalizör'],
  status: 'stored',
};

beforeEach(() => {
  _native = false;
  vi.clearAllMocks();
});

describe('saf dönüştürücüler', () => {
  it('description → desc eşlemesi yapılır (PWA sözleşmesi)', () => {
    const r = toRemoteDtcCode(CODE);
    expect(r).toEqual({
      code: 'P0420', severity: 'warning', system: 'Egzoz',
      desc: 'Katalitik dönüştürücü verimi düşük', status: 'stored',
    });
    // Uydurma alan taşınmaz.
    expect(Object.keys(r).sort()).toEqual(['code', 'desc', 'severity', 'status', 'system']);
  });

  it('KİLİT: `unsupported` kısmi tarama SAYILMAZ, `failed` sayılır', () => {
    // Araç Mode 0A'yı hiç bilmiyorsa bu bir okuma kaybı DEĞİLDİR.
    expect(isPartialScan({ stored: 'ok', pending: 'ok', permanent: 'unsupported' })).toBe(false);
    expect(isPartialScan({ stored: 'ok', pending: 'unsupported', permanent: 'unsupported' })).toBe(false);
    // Gerçek okuma kaybı → kısmi.
    expect(isPartialScan({ stored: 'failed', pending: 'ok', permanent: 'ok' })).toBe(true);
    expect(isPartialScan({ stored: 'ok', pending: 'failed', permanent: 'ok' })).toBe(true);
    expect(isPartialScan({ stored: 'ok', pending: 'ok', permanent: 'failed' })).toBe(true);
  });

  it('KİLİT: ölçülmemiş / imkânsız voltaj raporlanabilir DEĞİLDİR (sahte 0 V yasak)', () => {
    expect(isReportableVoltage(null)).toBe(false);
    expect(isReportableVoltage(undefined)).toBe(false);
    expect(isReportableVoltage(0)).toBe(false);
    expect(isReportableVoltage(-1)).toBe(false);
    expect(isReportableVoltage(Number.NaN)).toBe(false);
    expect(isReportableVoltage(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isReportableVoltage(12.4)).toBe(true);
  });

  it('tarama sonucu partial bayrağını bütünlükten TÜRETİR', () => {
    const r = buildRemoteScanResult({
      codes: [CODE], permanentSupported: false,
      completeness: { stored: 'ok', pending: 'failed', permanent: 'unsupported' },
    });
    expect(r.partial).toBe(true);
    expect(r.permanentSupported).toBe(false);
    expect(r.dtcs).toHaveLength(1);
  });
});

describe('executeReadDtc', () => {
  it('KİLİT: araç bağlantısı yokken BOŞ LİSTE "tamamlandı" diye dönmez', async () => {
    _native = false;
    const out = await executeReadDtc();
    expect(out.outcome).toBe('failed');
    // Okuma hiç DENENMEZ — web'in bilinçli boş listesi uzak kullanıcıya sızmaz.
    expect(_readAllDTCs).not.toHaveBeenCalled();
  });

  it('native: gerçek okuma sonucu `result` olarak döner', async () => {
    _native = true;
    _readAllDTCs.mockResolvedValue({
      codes: [CODE], permanentSupported: true,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
    });
    const out = await executeReadDtc();
    expect(out.outcome).toBe('completed');
    if (out.outcome !== 'completed') return;
    expect(out.result.partial).toBe(false);
    expect((out.result.dtcs as unknown[])).toHaveLength(1);
    expect(typeof out.result.readAt).toBe('string');
  });

  it('okuma hatası uydurma sonuç ÜRETMEZ', async () => {
    _native = true;
    _readAllDTCs.mockRejectedValue(new Error('ELM327 timeout'));
    const out = await executeReadDtc();
    expect(out).toEqual({ outcome: 'failed', reason: 'ELM327 timeout' });
  });
});

describe('executeReadVoltage', () => {
  it('KİLİT: ATRV okunmadıysa 0 V RAPORLANMAZ — komut düşer', async () => {
    _native = true;
    _obdSnapshot.mockReturnValue({ batteryVoltage: null });
    const out = await executeReadVoltage();
    expect(out.outcome).toBe('failed');
    if (out.outcome !== 'failed') return;
    expect(out.reason).toContain('ölçülemedi');
  });

  it('ölçülmüş voltaj sonuç olarak taşınır', async () => {
    _native = true;
    _obdSnapshot.mockReturnValue({ batteryVoltage: 12.6 });
    const out = await executeReadVoltage();
    expect(out.outcome).toBe('completed');
    if (out.outcome !== 'completed') return;
    expect(out.result.voltage).toBe(12.6);
  });

  it('araç yoksa ölçüm DENENMEZ', async () => {
    _native = false;
    const out = await executeReadVoltage();
    expect(out.outcome).toBe('failed');
    expect(_obdSnapshot).not.toHaveBeenCalled();
  });
});

describe('executeClearDtc', () => {
  it('KİLİT: write-gate reddi EZİLMEZ ve gerçek gerekçe taşınır', async () => {
    _native = true;
    _readDTCCodes.mockResolvedValue(undefined);
    _clearDTCCodes.mockResolvedValue({
      allowed: false, reason: 'moving',
      userMessage: 'Araç hareket halindeyken arıza kodu silinemez.',
      advisories: [],
    });
    const out = await executeClearDtc();
    expect(out).toEqual({
      outcome: 'rejected',
      reason: 'Araç hareket halindeyken arıza kodu silinemez.',
    });
  });

  it('KİLİT: silme sonrası DOĞRULAMA okuması yapılır — kalan kod gizlenmez', async () => {
    _native = true;
    _readDTCCodes.mockResolvedValue(undefined);
    _clearDTCCodes.mockResolvedValue({ allowed: true, reason: 'ok', userMessage: '', advisories: [] });
    // Silme sonrası hâlâ bir kod duruyor (kalıcı kod tipik olarak silinmez).
    _readAllDTCs.mockResolvedValue({
      codes: [{ ...CODE, status: 'permanent' }], permanentSupported: true,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
    });
    const out = await executeClearDtc();
    expect(out.outcome).toBe('completed');
    if (out.outcome !== 'completed') return;
    expect(_readAllDTCs).toHaveBeenCalled();
    expect((out.result.dtcs as unknown[])).toHaveLength(1); // boş liste UYDURULMADI
  });

  it('araç yoksa yıkıcı komut REDDEDİLİR (silme denenmez)', async () => {
    _native = false;
    const out = await executeClearDtc();
    expect(out.outcome).toBe('rejected');
    expect(_clearDTCCodes).not.toHaveBeenCalled();
  });
});
