/**
 * adasCore.test.ts — ADAS saf çekirdeği: geometri, kalibrasyon, şerit (LDW),
 * öndeki araç (FCW / takip mesafesi / kalkış) ve worker dedektörü.
 *
 * Sahneler GERÇEK geometriden üretilir (yol düzlemindeki nokta → görüntü), böylece
 * testler "modelin kendi formülünü tekrar etmesi" değil fiziksel tutarlılığı ölçer.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCameraModel, focalFromHfov, groundDistanceFromRow, rowForDistance,
  lateralFromColumn, widthMetersAt, expectedWidthAtRow,
} from '../platform/adas/adasGeometry';
import type { AdasCameraModel } from '../platform/adas/adasGeometry';
import {
  DEFAULT_ADAS_CALIBRATION, sanitizeCalibration, isMetricCalibration,
  vanishingPointFromLanes, HorizonEstimator,
} from '../platform/adas/adasCalibration';
import { LaneDepartureModel, lineLateralAtWheel } from '../platform/adas/adasLaneModel';
import { LeadVehicleModel } from '../platform/adas/adasCollisionModel';
import { detectLeadVehicle } from '../platform/adas/adasVehicleDetector';
import type { AdasCalibration, AdasLaneLine, AdasVehicleDetection } from '../platform/adas/adasTypes';

const ASPECT = 16 / 9;
const CAL: AdasCalibration = { ...DEFAULT_ADAS_CALIBRATION, source: 'auto' };
const CAM: AdasCameraModel = buildCameraModel(CAL, ASPECT);

/** Yol düzlemindeki (X yanal, Z ileri) noktanın normalize görüntü konumu. */
function project(x: number, z: number, cam = CAM): { u: number; v: number } {
  return { u: cam.forwardU + ((x - cam.lateralOffsetM) * cam.fN) / z, v: cam.horizonV + (cam.fN * cam.aspect * cam.cameraHeightM) / z };
}

/** Yolda X yanal konumunda duran şerit çizgisi (6 m – 30 m arası görünür). */
function laneLine(side: 'left' | 'right', x: number, conf = 0.9): AdasLaneLine {
  const near = project(x, 6);
  const far = project(x, 30);
  return { side, uTop: far.u, vTop: far.v, uBottom: near.u, vBottom: near.v, confidence: conf };
}

/** Z mesafesinde, genişliği W olan aracın ideal algılaması. */
function vehicleAt(z: number, width = 1.8, lateral = 0, conf = 0.8): AdasVehicleDetection {
  const l = project(lateral - width / 2, z);
  const r = project(lateral + width / 2, z);
  return { u0: l.u, u1: r.u, vBottom: l.v, vTop: l.v - 0.1, confidence: conf };
}

// ═══════════════════════════ GEOMETRİ ══════════════════════════════════════
describe('ADAS geometri', () => {
  it('odak: 90° HFOV → f_n = 0.5', () => {
    expect(focalFromHfov(90)).toBeCloseTo(0.5, 6);
  });

  it('satır ↔ mesafe gidiş-dönüş tutarlı', () => {
    for (const z of [5, 12, 30, 80]) {
      const v = rowForDistance(z, CAM)!;
      expect(groundDistanceFromRow(v, CAM)!).toBeCloseTo(z, 6);
    }
  });

  it('ufuk ve üstü → null (sahte mesafe yok)', () => {
    expect(groundDistanceFromRow(CAM.horizonV, CAM)).toBeNull();
    expect(groundDistanceFromRow(CAM.horizonV - 0.1, CAM)).toBeNull();
  });

  it('yanal konum ve genişlik geri kazanılır', () => {
    const p = project(1.2, 20);
    expect(lateralFromColumn(p.u, 20, CAM)).toBeCloseTo(1.2, 6);
    const d = vehicleAt(20, 1.8);
    expect(widthMetersAt(d.u1 - d.u0, 20, CAM)).toBeCloseTo(1.8, 6);
  });

  it('satırdaki beklenen genişlik ODAKTAN bağımsız', () => {
    const d = vehicleAt(15, 1.8);
    const exp = expectedWidthAtRow(d.vBottom, 1.8, CAM.horizonV, CAM.cameraHeightM, ASPECT);
    expect(exp).toBeCloseTo(d.u1 - d.u0, 6);
    const wide = buildCameraModel({ ...CAL, hfovDeg: 110 }, ASPECT);
    const d2 = vehicleAt(15, 1.8);
    // aynı satır/genişlik ilişkisi farklı odakta da geçerli
    const v2 = rowForDistance(15, wide)!;
    const w2 = (1.8 * wide.fN) / 15;
    expect(expectedWidthAtRow(v2, 1.8, wide.horizonV, wide.cameraHeightM, ASPECT)).toBeCloseTo(w2, 6);
    expect(d2.u1 - d2.u0).toBeGreaterThan(0);
  });
});

// ═══════════════════════════ KALİBRASYON ═══════════════════════════════════
describe('ADAS kalibrasyon', () => {
  it('çöp girdi → varsayılan, metrik DEĞİL', () => {
    for (const raw of [null, undefined, 42, 'x', []]) {
      const c = sanitizeCalibration(raw);
      expect(c.source).toBe('default');
      expect(isMetricCalibration(c)).toBe(false);
    }
  });

  it('aralık dışı alan tek başına varsayılana düşer', () => {
    const c = sanitizeCalibration({ ...CAL, hfovDeg: 500, cameraHeightM: 1.4 });
    expect(c.hfovDeg).toBe(DEFAULT_ADAS_CALIBRATION.hfovDeg);
    expect(c.cameraHeightM).toBe(1.4);
    expect(c.source).toBe('auto');
  });

  it('bozuk ufuk → kaynak default (metrik güven kaybolur)', () => {
    const c = sanitizeCalibration({ ...CAL, horizonV: Number.NaN });
    expect(c.source).toBe('default');
  });

  it('iki şeritten kaybolma noktası = gerçek ufuk', () => {
    const vp = vanishingPointFromLanes(laneLine('left', -1.75), laneLine('right', 1.75))!;
    expect(vp.v).toBeCloseTo(CAM.horizonV, 4);
    expect(vp.u).toBeCloseTo(CAM.forwardU, 4);
  });

  it('otomatik ufuk: tutarlı örneklerle yakınsar, düşük hızda örnek almaz', () => {
    const est = new HorizonEstimator();
    const lanes = [laneLine('left', -1.7), laneLine('right', 1.8)];
    expect(est.addLanes(lanes, 20, 0)).toBe(false);
    for (let i = 0; i < 45; i++) est.addLanes(lanes, 90, 1000 + i * 250);
    const e = est.estimate()!;
    expect(e.converged).toBe(true);
    expect(e.horizonV).toBeCloseTo(CAM.horizonV, 4);
  });

  it('otomatik ufuk: dağınık örneklerde yakınsamaz', () => {
    const est = new HorizonEstimator();
    for (let i = 0; i < 60; i++) {
      const cam = buildCameraModel({ ...CAL, horizonV: 0.35 + (i % 5) * 0.05 }, ASPECT);
      const l = { ...laneLine('left', -1.75), ...(() => { const n = project(-1.75, 6, cam); const f = project(-1.75, 30, cam); return { uTop: f.u, vTop: f.v, uBottom: n.u, vBottom: n.v }; })() };
      const r = { ...laneLine('right', 1.75), ...(() => { const n = project(1.75, 6, cam); const f = project(1.75, 30, cam); return { uTop: f.u, vTop: f.v, uBottom: n.u, vBottom: n.v }; })() };
      est.addLanes([l, r], 90, i * 250);
    }
    expect(est.estimate()!.converged).toBe(false);
  });
});

// ═══════════════════════════ ŞERİT (LDW) ═══════════════════════════════════
describe('ADAS şerit modeli (LDW)', () => {
  const run = (
    m: LaneDepartureModel, xs: (t: number) => number, opts: { speed?: number | null; signal?: 'left' | 'right' | 'none' | 'unknown'; ms?: number } = {},
  ): Array<'left' | 'right' | null> => {
    const out: Array<'left' | 'right' | null> = [];
    const total = opts.ms ?? 3000;
    for (let t = 0; t <= total; t += 100) {
      const off = xs(t); // araç şerit merkezinden sağa ofset (m)
      const r = m.update({
        lanes: [laneLine('left', -1.75 - off), laneLine('right', 1.75 - off)],
        nowMs: t, speedKmh: opts.speed === undefined ? 90 : opts.speed,
        turnSignal: opts.signal ?? 'none', cam: CAM, sensitivity: 'normal',
      });
      out.push(r.departure);
    }
    return out;
  };

  it('çizgi konumu tekerlek hizasına doğru taşınır', () => {
    expect(lineLateralAtWheel(laneLine('left', -1.75), CAM)!).toBeCloseTo(-1.75, 3);
  });

  it('merkezde sabit sürüş → uyarı yok, ofset ≈ 0', () => {
    const m = new LaneDepartureModel();
    expect(run(m, () => 0).every((d) => d === null)).toBe(true);
    const r = m.update({ lanes: [laneLine('left', -1.75), laneLine('right', 1.75)], nowMs: 3100, speedKmh: 90, turnSignal: 'none', cam: CAM, sensitivity: 'normal' });
    expect(r.lane.offsetM!).toBeCloseTo(0, 2);
    expect(r.lane.laneWidthM!).toBeCloseTo(3.5, 1);
  });

  it('sola yavaş sürüklenme → TEK sol uyarı', () => {
    const m = new LaneDepartureModel();
    const out = run(m, (t) => -0.4 * (t / 1000), { ms: 2500 });
    expect(out.includes('left')).toBe(true);
    expect(out.includes('right')).toBe(false);
    // tutma bitince aynı olay tekrar etmez
    const first = out.indexOf('left');
    const rest = out.slice(first);
    const reEntries = rest.filter((d, i) => d === 'left' && i > 0 && rest[i - 1] === null).length;
    expect(reEntries).toBe(0);
  });

  it('sol sinyal verilmişse sola geçiş uyarı ÜRETMEZ', () => {
    const m = new LaneDepartureModel();
    expect(run(m, (t) => -0.4 * (t / 1000), { signal: 'left', ms: 2500 }).includes('left')).toBe(false);
  });

  it('sinyal bilgisi yoksa hızlı (kasıtlı) şerit değişimi uyarı ÜRETMEZ', () => {
    const m = new LaneDepartureModel();
    expect(run(m, (t) => -1.5 * (t / 1000), { signal: 'unknown', ms: 1200 }).includes('left')).toBe(false);
  });

  it('düşük hız veya bilinmeyen hızda uyarı yok', () => {
    expect(run(new LaneDepartureModel(), (t) => -0.4 * (t / 1000), { speed: 40, ms: 2500 }).includes('left')).toBe(false);
    expect(run(new LaneDepartureModel(), (t) => -0.4 * (t / 1000), { speed: null, ms: 2500 }).includes('left')).toBe(false);
  });
});

// ═══════════════════════════ ÖNDEKİ ARAÇ ═══════════════════════════════════
describe('ADAS öndeki araç modeli', () => {
  const step = (m: LeadVehicleModel, det: AdasVehicleDetection | null, t: number, speed: number | null, metric = true) =>
    m.update({ detection: det, nowMs: t, speedKmh: speed, cam: CAM, metric, sensitivity: 'normal' });

  it('TTC gerçek değere yakınsar (ölçek yöntemi)', () => {
    const m = new LeadVehicleModel();
    // tampon mesafesi 30 m, yaklaşma 10 m/s → tampona TTC(t) = (30 − 10t)/10
    let last = step(m, null, 0, 60);
    for (let t = 0; t <= 800; t += 100) {
      const zCam = 30 + CAM.bumperOffsetM - 10 * (t / 1000);
      last = step(m, vehicleAt(zCam), t, 60);
    }
    const trueTtc = (30 - 8) / 10;
    expect(last.lead!.ttcS!).toBeGreaterThan(trueTtc * 0.85);
    expect(last.lead!.ttcS!).toBeLessThan(trueTtc * 1.15);
    expect(last.lead!.closingMps!).toBeCloseTo(10, 0);
  });

  it('hızla yaklaşan araç → FCW; sabit mesafe → FCW yok', () => {
    const m = new LeadVehicleModel();
    let fired = false;
    for (let t = 0; t <= 1500; t += 100) {
      const z = 20 + CAM.bumperOffsetM - 12 * (t / 1000);
      if (step(m, vehicleAt(z), t, 50).forwardCollision) fired = true;
    }
    expect(fired).toBe(true);

    const s = new LeadVehicleModel();
    let any = false;
    for (let t = 0; t <= 3000; t += 100) if (step(s, vehicleAt(15), t, 50).forwardCollision) any = true;
    expect(any).toBe(false);
  });

  it('ego hız bilinmiyorsa FCW üretilmez (fail-closed)', () => {
    const m = new LeadVehicleModel();
    for (let t = 0; t <= 1500; t += 100) {
      const z = 20 - 12 * (t / 1000);
      expect(step(m, vehicleAt(Math.max(3, z)), t, null).forwardCollision).toBe(false);
    }
  });

  it('ego şerit dışındaki araç izlenmez', () => {
    const m = new LeadVehicleModel();
    for (let t = 0; t <= 1000; t += 100) {
      const r = step(m, vehicleAt(20 - 10 * (t / 1000), 1.8, 3.5), t, 50);
      expect(r.lead).toBeNull();
      expect(r.forwardCollision).toBe(false);
    }
  });

  it('takip mesafesi: yakın takip ≥ 3 sn sürerse uyarı; varsayılan kalibrasyonda HİÇ', () => {
    // 90 km/sa = 25 m/s; 15 m aralık = 0.6 sn
    const z = 15 + CAM.bumperOffsetM;
    const m = new LeadVehicleModel();
    const hits: number[] = [];
    for (let t = 0; t <= 4000; t += 100) if (step(m, vehicleAt(z), t, 90).headway) hits.push(t);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toBeGreaterThanOrEqual(3000);

    const d = new LeadVehicleModel();
    for (let t = 0; t <= 4000; t += 100) {
      const r = step(d, vehicleAt(z), t, 90, false);
      expect(r.headway).toBe(false);
      if (r.lead) expect(r.lead.distanceM).toBeNull();
    }
  });

  it('öndeki araç kalkışı: durakta öndeki uzaklaşınca bildirim', () => {
    const m = new LeadVehicleModel();
    let fired = false;
    for (let t = 0; t <= 3000; t += 100) step(m, vehicleAt(8), t, 0);
    for (let t = 3100; t <= 6000; t += 100) {
      const z = 8 + 4 * ((t - 3100) / 1000); // öndeki 4 m/s ile uzaklaşıyor
      if (step(m, vehicleAt(z), t, 0).leadDeparture) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('öndeki araç kalkışı: ego hareket ederken bildirim YOK', () => {
    const m = new LeadVehicleModel();
    let fired = false;
    for (let t = 0; t <= 6000; t += 100) {
      const z = 8 + 4 * (t / 1000);
      if (step(m, vehicleAt(z), t, 20).leadDeparture) fired = true;
    }
    expect(fired).toBe(false);
  });
});

// ═══════════════════════════ DEDEKTÖR ══════════════════════════════════════
describe('ADAS araç dedektörü (worker)', () => {
  const W = 320, H = 180;
  const cfg = { horizonV: CAL.horizonV, forwardU: CAL.forwardU, hoodV: CAL.hoodV, cameraHeightM: CAL.cameraHeightM };

  function road(luma = 120): Uint8Array {
    const g = new Uint8Array(W * H);
    // hafif doku: satır bazlı ±3
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = luma + ((x * 7 + y * 3) % 7) - 3;
    return g;
  }

  /** z mesafesinde araç: altta koyu gölge bandı + üstte kenarlı arka yüz. */
  function drawCar(g: Uint8Array, z: number, withRear = true): { yBottom: number } {
    const d = vehicleAt(z);
    const x0 = Math.round(d.u0 * W), x1 = Math.round(d.u1 * W);
    const yb = Math.round(d.vBottom * H) - 1;
    const pxm = (yb - CAL.horizonV * H) / CAL.cameraHeightM;
    for (let y = yb - 2; y <= yb; y++) for (let x = x0; x <= x1; x++) g[y * W + x] = 30;
    if (withRear) {
      const top = Math.round(yb - 1.2 * pxm);
      for (let y = top; y < yb - 2; y++) {
        for (let x = x0; x <= x1; x++) {
          const stripe = ((y - top) >> 1) % 2 === 0 ? 200 : 60; // tampon/plaka yatay kenarları
          g[y * W + x] = (x < x0 + 2 || x > x1 - 2) ? 20 : stripe;
        }
      }
    }
    return { yBottom: yb };
  }

  it('gölge + arka yapı → araç bulunur, satır doğru', () => {
    const g = road();
    const { yBottom } = drawCar(g, 14);
    const r = detectLeadVehicle(g, W, H, cfg);
    expect(r.lowLight).toBe(false);
    expect(r.lead).not.toBeNull();
    expect(Math.abs(r.lead!.vBottom * H - (yBottom + 1))).toBeLessThanOrEqual(1);
  });

  it('üstünde yapı olmayan gölge (ağaç) → araç YOK', () => {
    const g = road();
    drawCar(g, 14, false);
    expect(detectLeadVehicle(g, W, H, cfg).lead).toBeNull();
  });

  it('yolu boydan boya kaplayan gölge (köprü) → araç YOK', () => {
    const g = road();
    const y = Math.round(rowForDistance(14, CAM)! * H);
    for (let yy = y - 3; yy <= y; yy++) for (let x = 0; x < W; x++) g[yy * W + x] = 25;
    expect(detectLeadVehicle(g, W, H, cfg).lead).toBeNull();
  });

  it('düşük ışık → lowLight, aday üretilmez', () => {
    const r = detectLeadVehicle(road(20), W, H, cfg);
    expect(r.lowLight).toBe(true);
    expect(r.lead).toBeNull();
  });

  it('boş yol → araç yok', () => {
    expect(detectLeadVehicle(road(), W, H, cfg).lead).toBeNull();
  });
});
