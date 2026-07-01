/**
 * courseOverGround.test.ts — SAHA FIX kilidi (2026-06-21).
 *
 * Bug: Head unit'lerde manyetometre (pusula) yok ve çoğu GPS modülü `coords.heading`
 * vermez. Bu durumda yön null kalıp FullMapView'da `heading ?? 0` ile KUZEY'e
 * kilitleniyordu → harita gidiş yönünden bağımsız dönüyor, sürücüye "ters dönüyor"
 * gibi görünüyordu. Fix: GPS bearing yoksa konum farkından course-over-ground.
 *
 * Bu testleri zayıflatma — heading fallback'i sessizce geri gelmesin.
 */
import { describe, it, expect } from 'vitest';
import { _bearingDeg } from '../platform/gps/gpsMath';
import { computeCourseDelta, COURSE_DELTA_MIN_M } from '../platform/gps/speedCore';

const ORIGIN = { lat: 41.0, lng: 29.0 }; // İstanbul civarı
// ~0.001° enlem ≈ 111 m; yön testleri için yeterli yer değiştirme
const STEP = 0.001;

describe('_bearingDeg — pusula yönü (0–360°)', () => {
  it('kuzeye hareket → ~0°', () => {
    expect(_bearingDeg(ORIGIN.lat, ORIGIN.lng, ORIGIN.lat + STEP, ORIGIN.lng)).toBeCloseTo(0, 0);
  });
  it('doğuya hareket → ~90°', () => {
    expect(_bearingDeg(ORIGIN.lat, ORIGIN.lng, ORIGIN.lat, ORIGIN.lng + STEP)).toBeCloseTo(90, 0);
  });
  it('güneye hareket → ~180° (bug: eskiden 0/kuzey kalıyordu)', () => {
    expect(_bearingDeg(ORIGIN.lat, ORIGIN.lng, ORIGIN.lat - STEP, ORIGIN.lng)).toBeCloseTo(180, 0);
  });
  it('batıya hareket → ~270°', () => {
    expect(_bearingDeg(ORIGIN.lat, ORIGIN.lng, ORIGIN.lat, ORIGIN.lng - STEP)).toBeCloseTo(270, 0);
  });
});

describe('computeCourseDelta — GPS bearing fallback', () => {
  it('prev yoksa null (ilk fix)', () => {
    expect(computeCourseDelta(ORIGIN.lat, ORIGIN.lng, null)).toBeNull();
  });

  it('yetersiz hareket (jitter) → null, harita park halinde dönmez', () => {
    const prev = { lat: ORIGIN.lat, lng: ORIGIN.lng, ts: 0 };
    // ~0.5 m'lik mikro kayma — COURSE_DELTA_MIN_M altında
    const tiny = 0.000004;
    expect(computeCourseDelta(ORIGIN.lat + tiny, ORIGIN.lng, prev)).toBeNull();
  });

  it('güneye gerçek hareket → ~180° döner (ters-harita bug fix)', () => {
    const prev = { lat: ORIGIN.lat, lng: ORIGIN.lng, ts: 0 };
    const course = computeCourseDelta(ORIGIN.lat - STEP, ORIGIN.lng, prev);
    expect(course).not.toBeNull();
    expect(course as number).toBeCloseTo(180, 0);
  });

  it('eşik (COURSE_DELTA_MIN_M) makul bir araç değeri (1–10 m)', () => {
    expect(COURSE_DELTA_MIN_M).toBeGreaterThanOrEqual(1);
    expect(COURSE_DELTA_MIN_M).toBeLessThanOrEqual(10);
  });
});
