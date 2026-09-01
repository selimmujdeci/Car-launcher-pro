/**
 * P0-OBD-FINAL-02 · DTC KAPSAM DÜRÜSTLÜĞÜ — KİLİT TESTLERİ
 *
 * ── ÖLÇÜLEN SAHA KUSURU (2026-08-25 · gerçek araç · Protocol 5 / KWP) ───────
 * ECU keşfi çalıştı: `ECU 7A (KWP)` · rx `86F17A` · tx `817AF1` · 8-bit ·
 * rol UNKNOWN. Fonksiyonel Mode 03/07 cevap verdi, FİZİKSEL `817AF1` SUSTU.
 * Aynı ekranda AYNI ANDA şunlar yazıyordu:
 *     "KISMİ TARAMA — GÜVEN %0"   ve   "1 ECU okunamadı"
 *     "TARAMA KAPSAMI %100"       ve   "Tam tarama"
 *
 * KÖK: İKİ AYRI OTORİTE. Kapsam rozeti YALNIZ mod kapsamını (`scanReport`)
 * okuyordu; ECU tamlık/adreslenebilirlik kanıtı (`EcuCompletenessEvidence`)
 * kapsam kararının TAMAMEN DIŞINDAYDI. Hüküm motoru (verdictEngine) ise ECU
 * kanıtını okuyordu → iki sayı aynı ekranda çelişti.
 *
 * BU DOSYA O ÇELİŞKİYİ KİLİTLER: ECU kanıtında boşluk varken sistem
 * "%100" ya da "Tam tarama" DİYEMEZ. Payda bilinmiyorsa sayı UYDURULMAZ.
 */
import { describe, it, expect } from 'vitest';
import { buildScanReport, evaluateEcuCoverage, type ScanEcuCoverageInput } from '../platform/obd/scanReport';
import { buildVehicleVerdict } from '../platform/obd/verdictEngine';
import { computeDtcVerdict } from '../platform/obd/dtcVerdict';

/** Kusursuz ECU kanıtı — payda BİLİNİYOR, kayıp YOK. */
const PERFECT_ECU: ScanEcuCoverageInput = {
  discoveryRan: true, discovered: 2, scanned: 2, failed: 0, skipped: 0,
  notAddressable: 0, staleSession: false, denominatorKnown: true,
};

/** SAHA: keşif koştu, 1 ECU fiziksel isteğe SUSTU, payda BİLİNMİYOR. */
const FIELD_ECU: ScanEcuCoverageInput = {
  discoveryRan: true, discovered: 1, scanned: 0, failed: 0, skipped: 0,
  notAddressable: 1, staleSession: false, denominatorKnown: false,
};

const ALL_MODES_OK = { stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok' } as const;

describe('P0-OBD-FINAL-02 — kanonik kapsam ECU kanıtını İÇERİR', () => {
  it('🔒 KİLİT: SAHA SENARYOSU — mod kapsamı %100 ama ECU ulaşılamadı → "%100" ve "Tam tarama" YASAK', () => {
    const r = buildScanReport({ ...ALL_MODES_OK, ecu: FIELD_ECU });

    // Mod kapsamı hâlâ 1 (o ölçüm doğruydu) — ama ÜRÜNÜN gösterdiği sayı DEĞİL.
    expect(r.coverage).toBe(1);

    // Payda BİLİNMİYOR → sayı üretilemez. Sahte %100 (ve sahte %0) YASAK.
    expect(r.canonicalCoverage).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.summary).not.toMatch(/Tam tarama/);
    expect(r.summary).toMatch(/BİLİNMİYOR/);
    expect(r.summary).toMatch(/ULAŞILAMADI/);
    expect(r.ecuEvidencePresent).toBe(true);
    expect(r.ecuGaps.length).toBeGreaterThan(0);
  });

  it('🔒 KİLİT: notAddressable > 0 → complete ASLA true olamaz (payda bilinse bile)', () => {
    const r = buildScanReport({
      ...ALL_MODES_OK,
      ecu: { ...PERFECT_ECU, discovered: 3, scanned: 2, notAddressable: 1 },
    });
    expect(r.canonicalCoverage).toBeCloseTo(2 / 3, 6);
    expect(r.canonicalCoverage).toBeLessThan(1);
    expect(r.complete).toBe(false);
    expect(r.summary).not.toMatch(/Tam tarama/);
  });

  it('🔒 KİLİT: staleSession → kapsam BİLİNMİYOR (bayat kanıt sayıya çevrilmez)', () => {
    const r = buildScanReport({ ...ALL_MODES_OK, ecu: { ...PERFECT_ECU, staleSession: true } });
    expect(r.canonicalCoverage).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.ecuGaps.join(' ')).toMatch(/bayat/);
  });

  it('🔒 KİLİT: ECU keşfi hiç koşmadıysa kapsam BİLİNMİYOR ("0 ECU" ile "bakılmadı" ayrı)', () => {
    const r = buildScanReport({
      ...ALL_MODES_OK,
      ecu: { ...PERFECT_ECU, discoveryRan: false, discovered: 0, scanned: 0 },
    });
    expect(r.canonicalCoverage).toBeNull();
    expect(r.ecuGaps.join(' ')).toMatch(/keşfi çalışmadı/);
  });

  it('🔒 KİLİT: fiziksel tamlık UNKNOWN (payda bilinmiyor) tek başına %100 iddiasını KESER', () => {
    const r = buildScanReport({
      ...ALL_MODES_OK,
      ecu: { ...PERFECT_ECU, denominatorKnown: false },
    });
    expect(r.canonicalCoverage).toBeNull();
    expect(r.complete).toBe(false);
  });

  it('okunamayan/taranmayan ECU kanonik kapsamı ORANLA düşürür (uydurma değil ölçüm)', () => {
    const r = buildScanReport({
      ...ALL_MODES_OK,
      ecu: { ...PERFECT_ECU, discovered: 4, scanned: 2, failed: 1, skipped: 1 },
    });
    expect(r.canonicalCoverage).toBeCloseTo(0.5, 6);
    expect(r.ecuGaps.join(' ')).toMatch(/1 ECU okunamadı/);
    expect(r.ecuGaps.join(' ')).toMatch(/1 ECU taranmadı/);
  });

  it('ECU kanıtı KUSURSUZ + modlar tam → kanonik %100 ve "Tam tarama" MEŞRUDUR', () => {
    const r = buildScanReport({ ...ALL_MODES_OK, ecu: PERFECT_ECU });
    expect(r.canonicalCoverage).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.ecuGaps).toEqual([]);
    expect(r.summary).toMatch(/Tam tarama/);
  });

  it('ECU kanıtı VERİLMEDİYSE geriye uyum korunur (tek-ECU akışı regresyonu yok)', () => {
    const r = buildScanReport(ALL_MODES_OK);
    expect(r.ecuEvidencePresent).toBe(false);
    expect(r.canonicalCoverage).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('mod kapsamı da düşükse kanonik kapsam ÇARPIMDIR (iki kayıp toplanmaz, çarpılır)', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'failed', permanent: 'ok', status: 'ok',
      ecu: { ...PERFECT_ECU, discovered: 2, scanned: 1, failed: 1 },
    });
    expect(r.coverage).toBeCloseTo(3 / 4, 6);
    expect(r.canonicalCoverage).toBeCloseTo((3 / 4) * (1 / 2), 6);
  });
});

describe('P0-OBD-FINAL-02 — evaluateEcuCoverage (saf sınıflandırma)', () => {
  it('BİLİNMEZLİK ile ÖLÇÜLMÜŞ KAYIP karıştırılmaz', () => {
    expect(evaluateEcuCoverage({ ...PERFECT_ECU, staleSession: true }).ratio).toBeNull();
    expect(evaluateEcuCoverage({ ...PERFECT_ECU, discovered: 2, scanned: 1, failed: 1 }).ratio)
      .toBeCloseTo(0.5, 6);
  });

  it('keşif koştu ama tek ECU bile ölçülmediyse oran ÜRETİLMEZ (0 demek yalan olurdu)', () => {
    const e = evaluateEcuCoverage({ ...PERFECT_ECU, discovered: 0, scanned: 0 });
    expect(e.ratio).toBeNull();
    expect(e.gaps.join(' ')).toMatch(/hiçbir ECU ölçülmedi/);
  });
});

describe('P0-OBD-FINAL-02 — hüküm motoru kanonik kapsamı kullanır', () => {
  const cleanDtc = computeDtcVerdict({
    scanRan: true, storedCount: 0, pendingCount: 0, permanentCount: 0,
    mil: false, pid01DtcCount: 0, failedModes: [], noResponseModes: [],
    deferredModes: [], manufacturerScope: 'covered',
  });

  it('🔒 KİLİT: ECU boşluğu varken hüküm "temiz" DİYEMEZ (fail-closed)', () => {
    const v = buildVehicleVerdict({
      dtc: cleanDtc,
      scan: buildScanReport({ ...ALL_MODES_OK, ecu: FIELD_ECU }),
      multiEcu: null,
      criticalCodes: [],
    });
    expect(v.level).toBe('inconclusive');
    expect(v.coverage).toBeNull();
    expect(v.findings.some((f) => f.source === 'scan_gap')).toBe(true);
  });

  it('🔒 KİLİT: verdict.coverage MOD kapsamını DEĞİL kanonik kapsamı taşır', () => {
    const v = buildVehicleVerdict({
      dtc: cleanDtc,
      scan: buildScanReport({
        ...ALL_MODES_OK,
        ecu: { ...PERFECT_ECU, discovered: 4, scanned: 2, failed: 2 },
      }),
      multiEcu: null,
      criticalCodes: [],
    });
    expect(v.coverage).toBeCloseTo(0.5, 6);
    expect(v.confidence).toBeLessThan(1);
  });
});
