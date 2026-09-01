/**
 * P0-NAV-11 — ROTA GEOMETRİ BÜTÜNLÜĞÜ (KİLİT).
 *
 * ── ÖLÇÜLEN BOŞLUKLAR (2026-08-24, koddan) ────────────────────────────────
 * `routeValidationModel` boş/tek noktalı geometriyi, geçersiz koordinatı, dev
 * atlamayı ve uç sapmalarını ZATEN yakalıyordu. Kapsamadığı ÜÇ şey vardı:
 *   1. YİNELENEN NOKTALAR ölçülmüyordu (640 noktanın 600'ü aynı olabilir ve
 *      hiçbir denetim bunu görmez — `maxGap` küçük, koordinatlar geçerli).
 *   2. Ölçülen POLİLİNE UZUNLUĞU sağlayıcının BİLDİRDİĞİ mesafeyle
 *      karşılaştırılmıyordu.
 *   3. REDDEDİLEN adayın kanıtı SİLİNİYORDU (yalnız sayaç artıyordu).
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  DUPLICATE_RATIO_FAIL,
  GEOMETRY_MAX_GAP_M,
  LENGTH_MISMATCH_FAIL,
  REJECTED_GEOMETRY_RING,
  geometryDistanceM,
  getRejectedGeometryEvidence,
  judgeGeometry,
  measureGeometry,
  recordRejectedGeometry,
  _resetRejectedGeometryForTest,
  type RejectedGeometryEvidence,
} from '../platform/navigation/core/routeGeometryModel';

/* ── Fikstür üreticileri ─────────────────────────────────────────────────── */

/** Tarsus'tan kuzeye doğru düz bir çizgi — `[lon, lat]` (OSRM sırası). */
function straight(points: number, stepDeg = 0.001): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points; i++) out.push([34.8621, 36.9175 + i * stepDeg]);
  return out;
}

beforeEach(() => { _resetRejectedGeometryForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
   1) ÖLÇÜM
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-11 › geometri ölçümü', () => {
  it('boş geometri sıfır künye üretir (çökmez)', () => {
    const m = measureGeometry([]);
    expect(m.pointCount).toBe(0);
    expect(m.polylineLengthM).toBeNull();
    expect(m.bboxWidthDeg).toBeNull();
  });

  it('null / tanımsız girdi çökmez', () => {
    expect(measureGeometry(null).pointCount).toBe(0);
    expect(measureGeometry(undefined).pointCount).toBe(0);
  });

  it('düz çizginin uzunluğu ve kapsamı ölçülür', () => {
    const m = measureGeometry(straight(11));           // 10 adım × ~111 m
    expect(m.pointCount).toBe(11);
    expect(m.duplicateCount).toBe(0);
    expect(m.invalidPointCount).toBe(0);
    expect(m.polylineLengthM ?? 0).toBeGreaterThan(1_000);
    expect(m.polylineLengthM ?? 0).toBeLessThan(1_200);
    expect(m.bboxHeightDeg).toBeCloseTo(0.01, 4);
    expect(m.bboxWidthDeg).toBe(0);                    // boylam sabit
  });

  it('YİNELENEN noktalar sayılır ve uzunluğa KATILMAZ', () => {
    /* Aynı nokta 5 kez: 4 yinelenen, uzunluk 0. */
    const g: [number, number][] = Array.from({ length: 5 }, () => [34.8621, 36.9175]);
    const m = measureGeometry(g);
    expect(m.pointCount).toBe(5);
    expect(m.duplicateCount).toBe(4);
    expect(m.uniquePointCount).toBe(1);
    expect(m.polylineLengthM).toBe(0);
  });

  it('GEÇERSİZ noktalar sayılır ama geometri çökertmez', () => {
    const g = [
      [34.8621, 36.9175],
      [NaN, 36.918],
      [34.8621, 200],          // aralık dışı enlem
      [34.8631, 36.9185],
    ] as [number, number][];
    const m = measureGeometry(g);
    expect(m.invalidPointCount).toBe(2);
    expect(m.pointCount).toBe(4);
    expect(m.polylineLengthM).not.toBeNull();
  });

  it('en büyük atlama ÖLÇÜLÜR', () => {
    const g: [number, number][] = [
      [34.8621, 36.9175],
      [34.8621, 36.9185],      // ~111 m
      [34.8621, 37.9185],      // ~111 km  ← dev atlama
    ];
    const m = measureGeometry(g);
    expect(m.maxGapM ?? 0).toBeGreaterThan(100_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) HÜKÜM — VALID · DEGRADED · INVALID · UNKNOWN
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-11 › geometri hükmü', () => {
  it('sağlam geometri VALID', () => {
    const g = straight(50);
    const m = measureGeometry(g);
    const v = judgeGeometry(g, m.polylineLengthM);
    expect(v.integrity).toBe('VALID');
    expect(v.flaws).toEqual([]);
  });

  it('BOŞ geometri INVALID', () => {
    const v = judgeGeometry([], 1000);
    expect(v.integrity).toBe('INVALID');
    expect(v.flaws).toContain('EMPTY');
  });

  it('TEK NOKTA INVALID — çizgi değildir', () => {
    const v = judgeGeometry([[34.8621, 36.9175]], 1000);
    expect(v.integrity).toBe('INVALID');
    expect(v.flaws).toContain('SINGLE_POINT');
  });

  it('GEÇERSİZ nokta içeren geometri INVALID', () => {
    const v = judgeGeometry([
      [34.8621, 36.9175], [NaN, 36.918], [34.8631, 36.9185],
    ] as [number, number][], 1000);
    expect(v.integrity).toBe('INVALID');
    expect(v.flaws).toContain('INVALID_POINTS');
  });

  it('SIFIR uzunluk INVALID — hepsi aynı nokta', () => {
    const g: [number, number][] = Array.from({ length: 20 }, () => [34.8621, 36.9175]);
    const v = judgeGeometry(g, 5000);
    expect(v.integrity).toBe('INVALID');
    expect(v.flaws).toContain('ZERO_LENGTH');
  });

  it('YİNELENEN AĞIRLIKLI geometri INVALID (eşik üstü)', () => {
    /* 100 noktanın 60'ı yinelenen → oran 0,6 ≥ 0,50. */
    const g: [number, number][] = [];
    for (let i = 0; i < 40; i++) g.push([34.8621, 36.9175 + i * 0.001]);
    for (let i = 0; i < 60; i++) g.push([34.8621, 36.9175 + 39 * 0.001]);
    const v = judgeGeometry(g, null);
    expect(v.duplicateRatio ?? 0).toBeGreaterThanOrEqual(DUPLICATE_RATIO_FAIL);
    expect(v.integrity).toBe('INVALID');
    expect(v.flaws).toContain('DUPLICATE_HEAVY');
  });

  it('DEV ATLAMA hükmü DEGRADED yapar (reddetmez)', () => {
    /* Atlama şüphelidir ama rota kullanılabilir olabilir — reddetme yetkisi
       `validateRoute`tedir, bu katman yalnız sınıflandırır. */
    const g: [number, number][] = [
      [34.8621, 36.9175], [34.8621, 36.9185], [34.8621, 37.9185],
    ];
    const m = measureGeometry(g);
    const v = judgeGeometry(g, m.polylineLengthM);
    expect(m.maxGapM ?? 0).toBeGreaterThan(GEOMETRY_MAX_GAP_M);
    expect(v.integrity).toBe('DEGRADED');
    expect(v.flaws).toContain('HUGE_GAP');
  });

  it('UZUNLUK UYUŞMAZLIĞI ölçülür ve sınıflandırılır', () => {
    const g = straight(11);                       // ~1,1 km
    const v = judgeGeometry(g, 10_000);           // sağlayıcı 10 km diyor
    expect(v.lengthMismatchRatio ?? 0).toBeGreaterThanOrEqual(LENGTH_MISMATCH_FAIL);
    expect(v.integrity).toBe('INVALID');
    expect(v.flaws).toContain('LENGTH_MISMATCH');
  });

  it('bildirilen mesafe YOKSA uyuşmazlık İDDİA EDİLMEZ', () => {
    /* "Bilinmiyor" ≠ "uyuşmuyor" — kanıtsız kusur yazılmaz. */
    const v = judgeGeometry(straight(11), null);
    expect(v.lengthMismatchRatio).toBeNull();
    expect(v.flaws).not.toContain('LENGTH_MISMATCH');
    expect(v.integrity).toBe('VALID');
  });

  it('geçersiz bildirilen mesafe uyuşmazlık ÜRETMEZ', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const v = judgeGeometry(straight(11), bad);
      expect(v.lengthMismatchRatio, `claimed=${bad}`).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) REDDEDİLEN ADAYIN KANITI SİLİNMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-11 › reddedilen aday kanıtı', () => {
  const ev = (i: number): RejectedGeometryEvidence => ({
    requestId: 1, providerLabel: 'srv-a', candidateIndex: i,
    integrity: 'INVALID',
    metrics: measureGeometry(straight(3)),
    flaws: ['LENGTH_MISMATCH'],
    failedCheckIds: ['REACHES_DESTINATION'],
    atMs: 1_700_000_000_000 + i,
  });

  it('reddedilen adayın ÖLÇÜMÜ korunur (yalnız sayaç değil)', () => {
    recordRejectedGeometry(ev(0));
    const snap = getRejectedGeometryEvidence();
    expect(snap.total).toBe(1);
    expect(snap.recent[0].failedCheckIds).toEqual(['REACHES_DESTINATION']);
    expect(snap.recent[0].metrics.pointCount).toBe(3);
    expect(snap.recent[0].candidateIndex).toBe(0);
  });

  it('halka sınırlıdır ama TOPLAM kaybolmaz', () => {
    for (let i = 0; i < REJECTED_GEOMETRY_RING + 5; i++) recordRejectedGeometry(ev(i));
    const snap = getRejectedGeometryEvidence();
    expect(snap.recent.length).toBe(REJECTED_GEOMETRY_RING);
    expect(snap.total).toBe(REJECTED_GEOMETRY_RING + 5);
  });

  it('kanıt KOORDİNAT TAŞIMAZ (gizlilik şartı #6)', () => {
    recordRejectedGeometry(ev(0));
    const snap = getRejectedGeometryEvidence();
    const json = JSON.stringify(snap);
    /* Ne fikstürün enlemi ne boylamı serileşmiş çıktıda görünmemeli. */
    expect(json).not.toContain('36.9175');
    expect(json).not.toContain('34.8621');
  });

  it('kayıt yolu THROW ETMEZ', () => {
    expect(() => recordRejectedGeometry(
      undefined as unknown as RejectedGeometryEvidence,
    )).not.toThrow();
  });

  it('boş defterde sahte kayıt YOK', () => {
    const snap = getRejectedGeometryEvidence();
    expect(snap.total).toBe(0);
    expect(snap.recent).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) UÇ ÖLÇÜMÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-11 › uç mesafesi', () => {
  it('geçerli koordinatlarda mesafe ölçülür', () => {
    const d = geometryDistanceM(36.9175, 34.8621, 36.9185, 34.8621);
    expect(d ?? 0).toBeGreaterThan(100);
    expect(d ?? 0).toBeLessThan(120);
  });

  it('geçersiz koordinatta `null` — sahte 0 YASAK', () => {
    expect(geometryDistanceM(NaN, 34.8621, 36.9185, 34.8621)).toBeNull();
    expect(geometryDistanceM(36.9175, Infinity, 36.9185, 34.8621)).toBeNull();
  });
});
