/**
 * dtcOutcomeSemantics.test.ts — P0-OBD-CORE-05 · Mode 03/07/0A SEMANTİK
 * SINIFLANDIRMA kilitleri.
 *
 * SAHA ÖRNEKLERİ (oturum toparlandıktan SONRA ölçülen gerçek yanıtlar):
 *   03 → 43 00 00 00 00 00 00  = POSITIVE_EMPTY
 *   07 → 47 00 00 00 00 00 00  = POSITIVE_EMPTY
 *   0A → 7F 0A 11               = NEGATIVE_UNSUPPORTED (NRC 0x11)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyDtcReadResponse, isSemanticCoverageLoss, isSemanticMeasurement,
} from '../platform/obd/dtcOutcomeSemantics';
import {
  evaluateVehicleDtcVerdict, recordDtcServiceScan, _resetDtcAuthorityForTest,
} from '../platform/obd/dtcAuthority';

describe('P0-OBD-CORE-05 · classifyDtcReadResponse', () => {
  it('🔒 5 — KİLİT SAHA: 03 → "43 00 00 00 00 00 00" = POSITIVE_EMPTY', () => {
    expect(classifyDtcReadResponse('03', '43 00 00 00 00 00 00', 0)).toBe('POSITIVE_EMPTY');
  });

  it('🔒 6 — KİLİT SAHA: 07 → "47 00 00 00 00 00 00" = POSITIVE_EMPTY', () => {
    expect(classifyDtcReadResponse('07', '47 00 00 00 00 00 00', 0)).toBe('POSITIVE_EMPTY');
  });

  it('🔒 7 — KİLİT SAHA: 0A → "7F 0A 11" = NEGATIVE_UNSUPPORTED (NRC 0x11)', () => {
    expect(classifyDtcReadResponse('0A', '7F 0A 11', 0)).toBe('NEGATIVE_UNSUPPORTED');
  });

  it('7b — NRC 0x12 (sub-function not supported) de NEGATIVE_UNSUPPORTED sayılır', () => {
    expect(classifyDtcReadResponse('0A', '7F 0A 12', 0)).toBe('NEGATIVE_UNSUPPORTED');
  });

  it('7c — NRC 0x22 (conditions not correct) NEGATIVE_OTHER — "desteklenmiyor" DEĞİL', () => {
    expect(classifyDtcReadResponse('03', '7F 03 22', 0)).toBe('NEGATIVE_OTHER');
  });

  it('POSITIVE_WITH_CODES: pozitif yanıt + kod sayısı > 0', () => {
    expect(classifyDtcReadResponse('07', '47 01 03 01 00', 1)).toBe('POSITIVE_WITH_CODES');
  });

  it('NO_DATA: ELM327 "NO DATA" — ECU sustu', () => {
    expect(classifyDtcReadResponse('03', 'NO DATA', 0)).toBe('NO_DATA');
  });

  it('PROMPT_TIMEOUT: hiç bayt gelmedi (null/boş)', () => {
    expect(classifyDtcReadResponse('03', null, 0)).toBe('PROMPT_TIMEOUT');
    expect(classifyDtcReadResponse('03', '', 0)).toBe('PROMPT_TIMEOUT');
  });

  it('BUS_ERROR: hat/protokol hatası', () => {
    expect(classifyDtcReadResponse('03', 'STOPPED', 0)).toBe('BUS_ERROR');
    expect(classifyDtcReadResponse('03', 'CAN ERROR', 0)).toBe('BUS_ERROR');
  });

  it('TRANSPORT_ERROR: adaptör komutu anlamadı ("?")', () => {
    expect(classifyDtcReadResponse('03', '?', 0)).toBe('TRANSPORT_ERROR');
  });

  it('MALFORMED: tanınan hiçbir kalıba uymayan yeterli-uzunluklu yanıt', () => {
    expect(classifyDtcReadResponse('03', 'AA BB CC DD', 0)).toBe('MALFORMED');
  });

  it('PARTIAL_TIMEOUT: çok kısa/kesik gövde', () => {
    expect(classifyDtcReadResponse('03', 'A', 0)).toBe('PARTIAL_TIMEOUT');
  });

  it('bitişik hex (ATS0) formatı da boşluklu (ATS1) ile AYNI sınıfı üretir', () => {
    expect(classifyDtcReadResponse('03', '43000000000000', 0)).toBe('POSITIVE_EMPTY');
    expect(classifyDtcReadResponse('0A', '7F0A11', 0)).toBe('NEGATIVE_UNSUPPORTED');
  });

  it('isSemanticCoverageLoss / isSemanticMeasurement ayrımı', () => {
    expect(isSemanticMeasurement('POSITIVE_EMPTY')).toBe(true);
    expect(isSemanticMeasurement('NEGATIVE_UNSUPPORTED')).toBe(true);
    expect(isSemanticMeasurement('NO_DATA')).toBe(false);
    expect(isSemanticCoverageLoss('NO_DATA')).toBe(true);
    expect(isSemanticCoverageLoss('POSITIVE_EMPTY')).toBe(false);
    expect(isSemanticCoverageLoss('NEGATIVE_UNSUPPORTED')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8/9 — CANONICAL AUTHORITY: unsupported "temiz/0 kod" SAYILMAZ ama coverage
   loss da DEĞİLDİR; positive-empty varken "hiçbir ECU yanıt vermedi" ÇIKMAZ.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-CORE-05 · dtcAuthority — unsupported/positive-empty ayrımı', () => {
  beforeEach(() => { _resetDtcAuthorityForTest(); });

  it('🔒 8 — KİLİT: 0A unsupported iken 03/07 positive-empty → "clean", KAYIP SAYILMAZ', () => {
    recordDtcServiceScan({ service: '03', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'ok', sessionEpoch: 1, codeCount: 0, protocol: '6' });
    recordDtcServiceScan({ service: '07', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'ok', sessionEpoch: 1, codeCount: 0, protocol: '6' });
    recordDtcServiceScan({ service: '0A', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'unsupported', sessionEpoch: 1, codeCount: 0, protocol: '6' });

    const v = evaluateVehicleDtcVerdict();
    expect(v.verdict).toBe('clean');
    expect(v.lossServices).not.toContain('0A');
    expect(v.measuredServices).toBe(2);
  });

  it('🔒 9 — KİLİT: pozitif-empty ölçülmüşken hüküm mesajı "hiçbir ECU yanıt vermedi" İÇERMEZ', () => {
    recordDtcServiceScan({ service: '03', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'ok', sessionEpoch: 1, codeCount: 0, protocol: '6' });
    recordDtcServiceScan({ service: '07', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'ok', sessionEpoch: 1, codeCount: 0, protocol: '6' });
    recordDtcServiceScan({ service: '0A', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'unsupported', sessionEpoch: 1, codeCount: 0, protocol: '6' });

    const v = evaluateVehicleDtcVerdict();
    expect(v.message).not.toMatch(/hiçbir ecu yanıt vermedi/i);
    expect(v.message).toMatch(/okundu.*arıza kodu bulunmadı/i);
  });

  it('9b — GERÇEKTEN hiç servis ölçülmediyse (measuredServices=0) "unproven" — bu AYRI hüküm', () => {
    recordDtcServiceScan({ service: '03', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'no_data', sessionEpoch: 1, codeCount: 0, protocol: '6' });
    recordDtcServiceScan({ service: '07', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'no_data', sessionEpoch: 1, codeCount: 0, protocol: '6' });
    recordDtcServiceScan({ service: '0A', ecuKey: null, ecuRole: null, txHeader: null, outcome: 'no_data', sessionEpoch: 1, codeCount: 0, protocol: '6' });

    const v = evaluateVehicleDtcVerdict();
    expect(v.verdict).toBe('unproven');
    expect(v.measuredServices).toBe(0);
  });
});
