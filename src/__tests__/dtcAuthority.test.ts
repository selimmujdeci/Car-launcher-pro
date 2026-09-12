/**
 * dtcAuthority.test.ts — P0-OBD-CORE-03 · KANONİK DTC/ECU OTORİTESİ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KUSUR: DTC sonuçları SEKİZ ayrı state/store/model içinde yaşıyordu
 * ve yanlış tüketici yalnız klasik `codes` dizisine (Mode 03) bakıyordu →
 * multi-ECU / pending / permanent / üretici (UDS·KWP) bulguları KAÇIYORDU.
 * Dahası boş dizi sessizce "araç temiz" hükmüne dönüşüyordu — ECU sustuğunda
 * ve tarama hiç koşmadığında da AYNI cümle çıkıyordu.
 *
 * Bu dosya kanonik otoritenin sözleşmesini KİLİTLER.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  recordDtcObservation, recordDtcServiceScan, beginDtcScanRound,
  getDtcAuthoritySnapshot, evaluateVehicleDtcVerdict, isProvenClean,
  summarizeDtcAuthority, observationKey, isCoverageLoss, isMeasuredOutcome,
  _resetDtcAuthorityForTest,
  type RecordObservationInput, type DtcSourceService, type DtcScanOutcome,
} from '../platform/obd/dtcAuthority';

const EPOCH = 5;

/** Gözlem kısayolu — alanlar açık, varsayılan uydurulmaz. */
function obs(over: Partial<RecordObservationInput> & { dtcCode: string }): void {
  recordDtcObservation({
    dtcClass: 'CONFIRMED', ecuKey: null, ecuRole: null,
    rxHeader: null, txHeader: null, protocol: '6',
    sessionEpoch: EPOCH, sourceService: '03', provenance: 'functional_7DF',
    ...over,
  });
}

function scan(service: DtcSourceService, outcome: DtcScanOutcome, ecuKey: string | null = null, codeCount = 0): void {
  recordDtcServiceScan({
    service, ecuKey, ecuRole: null, txHeader: null,
    outcome, sessionEpoch: EPOCH, codeCount, protocol: '6',
  });
}

beforeEach(() => { _resetDtcAuthorityForTest(); });

/* ═══════════════════════════════════════════════════════════════════════════
   A) GÖZLEM BÜTÜNLÜĞÜ — hiçbir bulgu kaybolmaz
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-CORE-03 · A) gözlem bütünlüğü', () => {
  it('🔒 A1 — yalnız Mode 03 → CONFIRMED gözlemi', () => {
    scan('03', 'ok', null, 1); obs({ dtcCode: 'P0301' });
    const snap = getDtcAuthoritySnapshot();
    expect(snap.observations).toHaveLength(1);
    expect(snap.observations[0]!.dtcClass).toBe('CONFIRMED');
    expect(evaluateVehicleDtcVerdict(snap).verdict).toBe('issues');
  });

  it('🔒 A2 — yalnız Mode 07 → PENDING gözlemi (Mode 03 boş olsa da KAYBOLMAZ)', () => {
    scan('03', 'ok', null, 0);
    scan('07', 'ok', null, 1);
    obs({ dtcCode: 'P0089', dtcClass: 'PENDING', sourceService: '07' });
    const v = evaluateVehicleDtcVerdict();
    expect(v.verdict).toBe('issues');
    expect(v.observationCount).toBe(1);
    // Klasik `codes` (Mode 03) BOŞ ama araç TEMİZ DEĞİL.
    expect(isProvenClean()).toBe(false);
  });

  it('🔒 A3 — ANA KİLİT: aynı kod Mode 03 + Mode 07 → İKİ gözlem, sınıflar KARIŞMAZ', () => {
    scan('03', 'ok', null, 1); scan('07', 'ok', null, 1);
    obs({ dtcCode: 'P0089', dtcClass: 'CONFIRMED', sourceService: '03' });
    obs({ dtcCode: 'P0089', dtcClass: 'PENDING',   sourceService: '07' });
    const snap = getDtcAuthoritySnapshot();
    expect(snap.observations).toHaveLength(2);
    expect(new Set(snap.observations.map((o) => o.dtcClass))).toEqual(new Set(['CONFIRMED', 'PENDING']));
  });

  it('🔒 A4 — ANA KİLİT: aynı kod İKİ ECU’da → İKİ gözlem, biri diğerini EZMEZ', () => {
    scan('03', 'ok', '7E0', 1); scan('03', 'ok', '7E1', 1);
    obs({ dtcCode: 'U0100', ecuKey: '7E0', txHeader: '7E0', provenance: 'physical_ecu' });
    obs({ dtcCode: 'U0100', ecuKey: '7E1', txHeader: '7E1', provenance: 'physical_ecu' });
    const snap = getDtcAuthoritySnapshot();
    expect(snap.observations).toHaveLength(2);
    expect(new Set(snap.observations.map((o) => o.ecuKey))).toEqual(new Set(['7E0', '7E1']));
    const byEcu = summarizeDtcAuthority(snap).byEcu;
    expect(byEcu).toHaveLength(2);
  });

  it('🔒 A5 — multi-ECU + motor ECU: fonksiyonel ve fiziksel gözlem AYRI kalır', () => {
    scan('03', 'ok', null, 1); scan('03', 'ok', '7E0', 1);
    obs({ dtcCode: 'P0301', ecuKey: null, provenance: 'functional_7DF' });
    obs({ dtcCode: 'P0301', ecuKey: '7E0', txHeader: '7E0', provenance: 'physical_ecu' });
    const snap = getDtcAuthoritySnapshot();
    expect(snap.observations).toHaveLength(2);
    expect(snap.observations.map((o) => o.provenance).sort())
      .toEqual(['functional_7DF', 'physical_ecu']);
  });

  it('🔒 A6 — UDS ve KWP sonuçları standart sınıflarla KARIŞTIRILMAZ', () => {
    scan('19', 'ok', '7E0', 1); scan('18', 'ok', '7E0', 1);
    obs({ dtcCode: 'DF001', dtcClass: 'UDS', sourceService: '19', ecuKey: '7E0', provenance: 'physical_ecu' });
    obs({ dtcCode: 'DF002', dtcClass: 'KWP', sourceService: '18', ecuKey: '7E0', provenance: 'physical_ecu' });
    const c = summarizeDtcAuthority().byClass;
    expect(c.UDS).toBe(1);
    expect(c.KWP).toBe(1);
    expect(c.CONFIRMED).toBe(0);
  });

  it('A7 — dedup anahtarı kod + SINIF + ECU (aynı üçlü tekrar yazılmaz)', () => {
    const k = observationKey({
      dtcCode: 'P0089', dtcClass: 'PENDING', ecuKey: '7E0', ecuRole: null,
      rxHeader: null, txHeader: null, protocol: null, sessionEpoch: EPOCH,
      sourceService: '07', scanOutcome: 'ok', measuredAt: 0, provenance: 'physical_ecu',
    });
    expect(k).toBe('P0089|PENDING|7E0');
    scan('07', 'ok', '7E0', 1);
    obs({ dtcCode: 'P0089', dtcClass: 'PENDING', sourceService: '07', ecuKey: '7E0' });
    obs({ dtcCode: 'P0089', dtcClass: 'PENDING', sourceService: '07', ecuKey: '7E0' });
    expect(getDtcAuthoritySnapshot().observations).toHaveLength(1);
  });

  it('A8 — ECU rolü bilinmiyorsa null KALIR (adresten rol uydurulmaz)', () => {
    scan('03', 'ok', '7E1', 1);
    obs({ dtcCode: 'P0700', ecuKey: '7E1', ecuRole: null, provenance: 'physical_ecu' });
    expect(getDtcAuthoritySnapshot().observations[0]!.ecuRole).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) "TEMİZ" HÜKMÜ — kanıtsız temizlik YASAK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-CORE-03 · B) temizlik hükmü', () => {
  it('🔒 B1 — ANA KİLİT: hiç tarama yok → "temiz" DEĞİL, not_scanned', () => {
    const v = evaluateVehicleDtcVerdict();
    expect(v.verdict).toBe('not_scanned');
    expect(isProvenClean()).toBe(false);
    expect(v.message).toMatch(/arıza yok.*DEĞİLDİR/i);
  });

  it('🔒 B2 — ANA KİLİT: EMPTY-BUT-UNPROVEN — üç servis NO DATA → "temiz" DEĞİL', () => {
    scan('03', 'no_data'); scan('07', 'no_data'); scan('0A', 'no_data');
    const v = evaluateVehicleDtcVerdict();
    expect(v.verdict).toBe('unproven');
    expect(v.observationCount).toBe(0);
    expect(isProvenClean()).toBe(false);
    expect(v.measuredServices).toBe(0);
  });

  it('🔒 B3 — KİLİT: timeout → "temiz" DEĞİL', () => {
    scan('03', 'timeout'); scan('07', 'timeout'); scan('0A', 'timeout');
    expect(evaluateVehicleDtcVerdict().verdict).toBe('unproven');
    expect(isProvenClean()).toBe(false);
  });

  it('🔒 B4 — KİLİT: KISMİ tarama (biri ok, biri düştü) → "temiz" DEĞİL', () => {
    scan('03', 'ok', null, 0); scan('07', 'failed'); scan('0A', 'ok', null, 0);
    const v = evaluateVehicleDtcVerdict();
    expect(v.verdict).toBe('unproven');
    expect(v.lossServices).toContain('07');
    expect(isProvenClean()).toBe(false);
  });

  it('🔒 B5 — KİLİT: GERÇEK temiz — hepsi ok, kod yok → clean', () => {
    scan('03', 'ok', null, 0); scan('07', 'ok', null, 0); scan('0A', 'ok', null, 0);
    const v = evaluateVehicleDtcVerdict();
    expect(v.verdict).toBe('clean');
    expect(isProvenClean()).toBe(true);
  });

  it('🔒 B6 — KİLİT: unsupported KAPSAM KAYBI DEĞİL → temizliği ENGELLEMEZ', () => {
    scan('03', 'ok', null, 0); scan('07', 'ok', null, 0); scan('0A', 'unsupported');
    expect(evaluateVehicleDtcVerdict().verdict).toBe('clean');
    expect(isCoverageLoss('unsupported')).toBe(false);
    expect(isCoverageLoss('no_data')).toBe(true);
    expect(isMeasuredOutcome('unsupported')).toBe(false);
  });

  it('🔒 B7 — KİLİT: BULGU kapsam eksikliğini EZER (issues > unproven)', () => {
    scan('03', 'ok', null, 1); scan('07', 'no_data');
    obs({ dtcCode: 'P0301' });
    expect(evaluateVehicleDtcVerdict().verdict).toBe('issues');
  });

  it('🔒 B8 — KİLİT: beş sonuç sınıfı BİRBİRİNE eşit DEĞİL', () => {
    const outcomes: DtcScanOutcome[] = ['ok', 'no_data', 'unsupported', 'timeout', 'failed', 'not_scanned'];
    expect(new Set(outcomes).size).toBe(6);
    expect(outcomes.filter(isMeasuredOutcome)).toEqual(['ok']);
    expect(outcomes.filter(isCoverageLoss).sort())
      .toEqual(['failed', 'no_data', 'not_scanned', 'timeout']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) OTURUM — eski gözlem yeni araca TAŞINMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-CORE-03 · C) oturum', () => {
  it('🔒 C1 — ANA KİLİT: ARAÇ DEĞİŞİMİ (yeni epoch) → eski gözlemler DÜŞER', () => {
    scan('03', 'ok', null, 1); obs({ dtcCode: 'P0301' });
    expect(getDtcAuthoritySnapshot().observations).toHaveLength(1);

    // Adaptör başka araca takıldı.
    recordDtcServiceScan({
      service: '03', ecuKey: null, ecuRole: null, txHeader: null,
      outcome: 'ok', sessionEpoch: EPOCH + 1, codeCount: 0, protocol: '6',
    });
    const snap = getDtcAuthoritySnapshot();
    expect(snap.sessionEpoch).toBe(EPOCH + 1);
    expect(snap.observations).toHaveLength(0);
    expect(snap.scans).toHaveLength(1);
  });

  it('🔒 C2 — KİLİT: RECONNECT sonrası defter yeni oturumla başlar', () => {
    scan('03', 'ok', null, 1); obs({ dtcCode: 'P0301' });
    beginDtcScanRound(EPOCH + 2);           // reconnect → yeni epoch
    const snap = getDtcAuthoritySnapshot();
    expect(snap.observations).toHaveLength(0);
    expect(snap.scans).toHaveLength(0);     // oturum mührü scans'i de düşürür
    expect(evaluateVehicleDtcVerdict(snap).verdict).toBe('not_scanned');
  });

  it('🔒 C3 — ANA KİLİT: CLEAR SONRASI yeniden tarama — giden kod defterde KALMAZ', () => {
    scan('03', 'ok', null, 1); obs({ dtcCode: 'P0089', dtcClass: 'PENDING', sourceService: '07' });
    expect(getDtcAuthoritySnapshot().observations).toHaveLength(1);

    // Silme sonrası yeniden okuma AYNI oturumda koşar.
    beginDtcScanRound(EPOCH);
    scan('03', 'ok', null, 0); scan('07', 'ok', null, 0); scan('0A', 'ok', null, 0);

    const v = evaluateVehicleDtcVerdict();
    expect(v.observationCount).toBe(0);
    expect(v.verdict).toBe('clean');        // ölçüldü VE boş → kanıtlı temiz
  });

  it('🔒 C4 — KİLİT: tur temizliği SERVİS SONUÇLARINI düşürmez (hüküm not_scanned’e kaçmaz)', () => {
    scan('03', 'ok', null, 0); scan('07', 'ok', null, 0); scan('0A', 'ok', null, 0);
    beginDtcScanRound(EPOCH);               // aynı oturum → yalnız gözlemler düşer
    expect(getDtcAuthoritySnapshot().scans.length).toBe(3);
    expect(evaluateVehicleDtcVerdict().verdict).toBe('clean');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) ÖZET — LAB'ın okuduğu sayılar
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-CORE-03 · D) özet', () => {
  it('D1 — sınıf ve ECU kırılımı doğru sayılır', () => {
    scan('03', 'ok', '7E0', 1); scan('07', 'ok', '7E0', 1); scan('0A', 'unsupported', '7E0');
    scan('03', 'no_data', '7E1');
    obs({ dtcCode: 'P0301', ecuKey: '7E0', provenance: 'physical_ecu' });
    obs({ dtcCode: 'P0089', dtcClass: 'PENDING', sourceService: '07', ecuKey: '7E0', provenance: 'physical_ecu' });

    const sum = summarizeDtcAuthority();
    expect(sum.total).toBe(2);
    expect(sum.byClass.CONFIRMED).toBe(1);
    expect(sum.byClass.PENDING).toBe(1);
    expect(sum.byEcu).toHaveLength(1);
    expect(sum.byEcu[0]!.count).toBe(2);
    expect(sum.scannedServices).toBe(2);    // 03/7E0 + 07/7E0
    expect(sum.skippedServices).toBe(1);    // 0A unsupported
    expect(sum.failedServices).toBe(1);     // 03/7E1 no_data
    expect(sum.sessionEpoch).toBe(EPOCH);
    expect(sum.lastScanAt).not.toBeNull();
  });

  it('D2 — hiç tarama yokken lastScanAt null (sahte 0 YASAK)', () => {
    expect(summarizeDtcAuthority().lastScanAt).toBeNull();
  });
});
