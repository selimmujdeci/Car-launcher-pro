/**
 * deadReckoning.test.ts — Dead Reckoning saf matematik birim testleri.
 *
 * FullMapView'daki rAF tick içinde gömülü olan DR projeksiyon formülü
 * src/utils/interpolation.ts'e taşındı (projectDeadReckon + resolveDrSpeed).
 * Bu testler GERÇEK assertion içerir — drRealWorldValidation.test.ts'in aksine
 * console.info ile "geçmiş gibi yapan" sahte test yoktur.
 *
 * Senaryolar:
 *  1. GPS kaybı + OBD hızı var → ileri projeksiyon (distDeg > 0, doğru yön)
 *  2. GPS kaybı + OBD 0 + GPS speed fallback → GPS hızıyla ilerler
 *  3. Her iki hız 0 → konum lastKnown'a EŞİT (marker donar)
 *  4. Heading yön doğruluğu (kuzey=0 → lat; doğu=90 → lng)
 *  5. dtSec clamp (60s verilse bile max 5s × hız drift üst sınırı)
 *  6. cosLat guard (yüksek enlem → NaN/Infinity yok, sonlu sonuç)
 *  7. OBD önceliği (obd>0 iken GPS kullanılmaz)
 *  8. Negatif/null GPS speed güvenliği (ters yön projeksiyon yok)
 */

import { describe, it, expect } from 'vitest';
import {
  projectDeadReckon,
  resolveDrSpeed,
  DR_MAX_DT_SEC,
  DR_CONFIDENT_SEC,
  drIsEstimated,
  DR_METERS_PER_DEG,
  type NavPoint,
} from '../utils/interpolation';

/* ── Sabitler & yardımcılar ──────────────────────────────────────────── */

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine — iki nokta arası metre. */
function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Standart başlangıç noktası — İstanbul, ts=0. */
function makeLastKnown(overrides: Partial<NavPoint> = {}): NavPoint {
  return { lat: 41.0, lng: 29.0, heading: 0, ts: 0, ...overrides };
}

/* ── 1. GPS kaybı + OBD hızı var ─────────────────────────────────────── */

describe('projectDeadReckon — GPS kaybı + OBD hızı var', () => {
  it('son bilinen noktadan ileri projeksiyon yapar (distDeg > 0)', () => {
    const last = makeLastKnown({ heading: 0 });
    const speedKmh = 72; // 20 m/s
    const dtSec = 2;
    const out = projectDeadReckon(last, speedKmh, dtSec * 1000);

    // Hareket olmalı
    expect(out.lat).not.toBe(last.lat);
    // Kuzey (heading=0) → lat artmalı
    expect(out.lat).toBeGreaterThan(last.lat);

    // Beklenen mesafe: 20 m/s × 2 s = 40 m
    const dist = haversineMeters(last, out);
    expect(dist).toBeCloseTo(40, 0);
  });

  it('beklenen lat artışı formülle eşleşir (manuel hesap)', () => {
    const last = makeLastKnown({ heading: 0 });
    const speedKmh = 36; // 10 m/s
    const now = 3000;    // 3 s
    const out = projectDeadReckon(last, speedKmh, now);

    // distDeg = (10) * 3 / 111320 ; heading 0 → tüm hareket lat'ta
    const expectedDistDeg = (10 * 3) / DR_METERS_PER_DEG;
    expect(out.lat - last.lat).toBeCloseTo(expectedDistDeg, 10);
    // lng heading=0 iken sin(0)=0 → değişmez
    expect(out.lng).toBeCloseTo(last.lng, 12);
  });
});

/* ── 2. GPS kaybı + OBD 0 + GPS speed fallback ───────────────────────── */

describe('resolveDrSpeed — GPS speed fallback', () => {
  it('OBD 0 ise GPS hızını (m/s → km/h) döndürür', () => {
    // 15 m/s → 54 km/h
    expect(resolveDrSpeed(0, 15)).toBeCloseTo(54, 6);
  });

  it('fallback hız ile projeksiyon ilerler', () => {
    const last = makeLastKnown({ heading: 0 });
    const speed = resolveDrSpeed(0, 15); // 54 km/h = 15 m/s
    const out = projectDeadReckon(last, speed, 2000); // 2 s
    const dist = haversineMeters(last, out);
    // 15 m/s × 2 s = 30 m
    expect(dist).toBeCloseTo(30, 0);
    expect(out.lat).toBeGreaterThan(last.lat);
  });
});

/* ── 3. Her iki hız 0 → konum donar ──────────────────────────────────── */

describe('projectDeadReckon — hız 0 (marker donar)', () => {
  it('resolveDrSpeed(0, 0) → 0', () => {
    expect(resolveDrSpeed(0, 0)).toBe(0);
  });

  it('hız 0 → distDeg 0 → konum lastKnown ile EŞİT', () => {
    const last = makeLastKnown({ heading: 123 });
    const out = projectDeadReckon(last, 0, 9999);
    expect(out.lat).toBe(last.lat);
    expect(out.lng).toBe(last.lng);
    expect(haversineMeters(last, out)).toBe(0);
  });
});

/* ── 4. Heading yön doğruluğu ────────────────────────────────────────── */

describe('projectDeadReckon — heading yön doğruluğu', () => {
  const speedKmh = 72; // 20 m/s
  const now = 2000;    // 2 s → 40 m

  it('heading=0 (kuzey) → sadece lat artar, lng ~sabit', () => {
    const last = makeLastKnown({ heading: 0 });
    const out = projectDeadReckon(last, speedKmh, now);
    expect(out.lat).toBeGreaterThan(last.lat);
    expect(out.lng).toBeCloseTo(last.lng, 12);
  });

  it('heading=90 (doğu) → sadece lng artar, lat ~sabit', () => {
    const last = makeLastKnown({ heading: 90 });
    const out = projectDeadReckon(last, speedKmh, now);
    expect(out.lng).toBeGreaterThan(last.lng);
    expect(out.lat).toBeCloseTo(last.lat, 12);
  });

  it('heading=180 (güney) → lat azalır', () => {
    const last = makeLastKnown({ heading: 180 });
    const out = projectDeadReckon(last, speedKmh, now);
    expect(out.lat).toBeLessThan(last.lat);
    expect(out.lng).toBeCloseTo(last.lng, 12);
  });

  it('heading=270 (batı) → lng azalır', () => {
    const last = makeLastKnown({ heading: 270 });
    const out = projectDeadReckon(last, speedKmh, now);
    expect(out.lng).toBeLessThan(last.lng);
    expect(out.lat).toBeCloseTo(last.lat, 12);
  });
});

/* ── 5. dtSec clamp — NAV-1: tünelde donmaz, 60s cap ─────────────────── */

describe('projectDeadReckon — NAV-1 tünel devamlılığı (cap 60s)', () => {
  it('5s SONRA da ilerlemeye DEVAM eder (tünelde DONMAZ — eski 5s clamp bug\'ı)', () => {
    const last = makeLastKnown({ heading: 0 });
    const speedKmh = 36; // 10 m/s
    const out5  = projectDeadReckon(last, speedKmh, 5_000);
    const out30 = projectDeadReckon(last, speedKmh, 30_000);
    // 30s projeksiyonu 5s'ten DAHA İLERİDE olmalı (eskiden clamp'le AYNI kalıyordu = donma).
    expect(haversineMeters(last, out30)).toBeGreaterThan(haversineMeters(last, out5) + 100);
  });

  it('30s @ 10m/s ≈ 300 m (gerçek projeksiyon, donuk değil)', () => {
    const last = makeLastKnown({ heading: 0 });
    const dist = haversineMeters(last, projectDeadReckon(last, 36, 30_000));
    expect(dist).toBeCloseTo(300, 0); // 10 m/s × 30 s
  });

  it('drift üst sınırı 60. saniyede tavan yapar: 120s @ 10m/s = 60s @ 10m/s = 600 m', () => {
    const last = makeLastKnown({ heading: 0 });
    const out120 = projectDeadReckon(last, 36, 120_000); // clamp DR_MAX_DT_SEC=60
    const out60  = projectDeadReckon(last, 36, DR_MAX_DT_SEC * 1000);
    expect(out120.lat).toBeCloseTo(out60.lat, 12);
    // 10 m/s × 60 s = 600 m tavan (haversine R≈6371km ile projeksiyon 111320 m/deg arası ~1m fark → ±5m tolerans).
    expect(haversineMeters(last, out120)).toBeGreaterThan(595);
    expect(haversineMeters(last, out120)).toBeLessThan(605);
  });

  it('drIsEstimated: ≤5s güvenilir (false), >5s tahmini (true)', () => {
    expect(DR_CONFIDENT_SEC).toBe(5);
    expect(drIsEstimated(0, 4_000)).toBe(false);  // 4s → güvenilir
    expect(drIsEstimated(0, 5_000)).toBe(false);  // 5s sınır dahil → güvenilir
    expect(drIsEstimated(0, 8_000)).toBe(true);   // 8s → tahmini
  });
});

/* ── 6. cosLat guard — yüksek enlem ──────────────────────────────────── */

describe('projectDeadReckon — cosLat guard (yüksek enlem)', () => {
  it('lat=89.9 + doğu heading → sonlu sonuç, NaN/Infinity yok', () => {
    const last = makeLastKnown({ lat: 89.9, heading: 90 });
    const out = projectDeadReckon(last, 72, 2000);
    expect(Number.isFinite(out.lat)).toBe(true);
    expect(Number.isFinite(out.lng)).toBe(true);
    expect(Number.isNaN(out.lng)).toBe(false);
  });

  it('lat=90 (kutup) → bölme patlamaz, sonlu kalır', () => {
    const last = makeLastKnown({ lat: 90, heading: 90 });
    const out = projectDeadReckon(last, 100, 4000);
    expect(Number.isFinite(out.lng)).toBe(true);
    // cosLat floor 0.001 → distDeg / 0.001 büyür ama sonlu
    expect(Math.abs(out.lng)).toBeLessThan(Infinity);
  });
});

/* ── 7. OBD önceliği ─────────────────────────────────────────────────── */

describe('resolveDrSpeed — OBD önceliği', () => {
  it('OBD > 0 iken GPS hızı YOK SAYILIR', () => {
    // OBD 80 km/h, GPS 15 m/s (=54 km/h) → OBD seçilmeli
    expect(resolveDrSpeed(80, 15)).toBe(80);
  });

  it('OBD pozitif + GPS null → OBD döner', () => {
    expect(resolveDrSpeed(45, null)).toBe(45);
  });
});

/* ── 8. Negatif/null GPS speed güvenliği ─────────────────────────────── */

describe('resolveDrSpeed — negatif/null güvenliği', () => {
  it('resolveDrSpeed(0, null) → 0 (ters yön yok)', () => {
    expect(resolveDrSpeed(0, null)).toBe(0);
  });

  it('resolveDrSpeed(0, -5) → 0 (negatif GPS hızı kıstırılır)', () => {
    expect(resolveDrSpeed(0, -5)).toBe(0);
  });

  it('negatif sonuç → projeksiyon ileri gitmez (lastKnown ile eşit)', () => {
    const last = makeLastKnown({ heading: 0 });
    const speed = resolveDrSpeed(0, -10); // 0 olmalı
    const out = projectDeadReckon(last, speed, 3000);
    expect(out.lat).toBe(last.lat);
    expect(out.lng).toBe(last.lng);
  });

  it('OBD negatif + GPS pozitif → GPS fallback kullanılır', () => {
    // OBD -3 (geçersiz) → GPS 10 m/s = 36 km/h
    expect(resolveDrSpeed(-3, 10)).toBeCloseTo(36, 6);
  });

  it('OBD NaN → GPS fallback (NaN sızdırmaz)', () => {
    expect(resolveDrSpeed(NaN, 10)).toBeCloseTo(36, 6);
    expect(resolveDrSpeed(NaN, null)).toBe(0);
  });
});
