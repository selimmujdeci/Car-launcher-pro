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

/* ── 5. dtSec clamp — drift üst sınırı ───────────────────────────────── */

describe('projectDeadReckon — dtSec clamp (max 5s)', () => {
  it('60s verildiğinde 5s gibi davranır (clamp)', () => {
    const last = makeLastKnown({ heading: 0 });
    const speedKmh = 36; // 10 m/s

    const out60 = projectDeadReckon(last, speedKmh, 60_000); // 60 s istek
    const out5  = projectDeadReckon(last, speedKmh, DR_MAX_DT_SEC * 1000); // 5 s

    // 60s ve 5s aynı sonucu vermeli (clamp)
    expect(out60.lat).toBeCloseTo(out5.lat, 12);
    expect(out60.lng).toBeCloseTo(out5.lng, 12);
  });

  it('drift üst sınırını AŞMAZ: 60s @ 10m/s → en fazla 50 m', () => {
    const last = makeLastKnown({ heading: 0 });
    const out60 = projectDeadReckon(last, 36, 60_000); // 10 m/s
    const dist = haversineMeters(last, out60);
    // 10 m/s × 5 s = 50 m üst sınır
    expect(dist).toBeCloseTo(50, 0);
    expect(dist).toBeLessThanOrEqual(50.5);
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
