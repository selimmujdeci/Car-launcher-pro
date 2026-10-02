/**
 * adasCore.test.ts — ADAS saf çekirdek kilitleri.
 *
 * Senaryolar FİZİKSEL olarak tutarlı üretilir: kalibre edilmiş bir kameranın
 * (ufuk 0.40, merkez 0.50, referans şerit genişliği 0.60) göreceği şerit
 * çizgileri ve öndeki araç kutusu pinhole modelinden hesaplanır. Böylece
 * uyarının GERÇEK çizgi mesafesine / GERÇEK TTC'ye göre ne zaman geldiği
 * ölçülür — sihirli sayılar değil.
 *
 *   A · geometri + kalibrasyon      B · şerit ayrılma (LDW)
 *   C · çarpışma / takip / kalkış (FCW)
 */
import { describe, it, expect } from 'vitest';
import {
  LANE_REF_Y, focalNormFromHfov, groundDistanceM, intersect, lineXAtY, widthDistanceM,
} from '../platform/adas/adasGeometry';
import {
  EMPTY_LEARNER, calibrationProgress, detectCalibrationDrift, finalizeCalibration,
  laneGeometry, learnCalibrationSample, manualCalibration,
} from '../platform/adas/adasCalibration';
import {
  INITIAL_LDW_STATE, LDW_HALF_VEHICLE_M, LDW_LANE_WIDTH_M, stepLdw, type LdwOutput, type LdwState,
} from '../platform/adas/laneDepartureModel';
import {
  INITIAL_FORWARD_STATE, stepForward, type ForwardOutput, type ForwardState,
} from '../platform/adas/forwardCollisionModel';
import type {
  AdasCalibration, AdasSensitivity, LaneObservation, NormLine, TurnSignal, VehicleDetection,
} from '../platform/adas/adasTypes';

/* ── Sahne üreteci ─────────────────────────────────────────────────────── */

const VP = { x: 0.5, y: 0.4 };
const CAL: AdasCalibration = {
  horizonY: VP.y, vanishX: VP.x, centerX: 0.5, laneWidthAtRef: 0.6,
  samples: 200, learnedAtMs: 0, cameraKey: 'auto', source: 'auto',
};
const PX_PER_M = CAL.laneWidthAtRef / LDW_LANE_WIDTH_M;

/** Referans satırdaki x'ten kaybolma noktasına giden çizgi parçası. */
function line(xAtRef: number, conf = 0.9, vp = VP): NormLine {
  const yTop = 0.6;
  const t = (LANE_REF_Y - yTop) / (LANE_REF_Y - vp.y);
  return { x1: xAtRef, y1: LANE_REF_Y, x2: xAtRef + (vp.x - xAtRef) * t, y2: yTop, confidence: conf };
}

/** Araç şerit ortasına göre `offsetM` (+ sağ) konumdayken görülen şeritler. */
function lanesAt(offsetM: number, conf = 0.9): LaneObservation {
  const mid = CAL.centerX - offsetM * PX_PER_M;
  return { left: line(mid - CAL.laneWidthAtRef / 2, conf), right: line(mid + CAL.laneWidthAtRef / 2, conf) };
}

/* ══════════════════ A · GEOMETRİ + KALİBRASYON ══════════════════ */

describe('A · geometri + kalibrasyon', () => {
  it('A1. çizgi uzatma ve kesişim kaybolma noktasını verir', () => {
    const l = line(0.2), r = line(0.8);
    expect(lineXAtY(l, LANE_REF_Y)).toBeCloseTo(0.2, 6);
    const p = intersect(l, r)!;
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.4, 6);
  });

  it('A2. pinhole mesafe: yer düzlemi ve genişlik aynı mesafeyi verir', () => {
    const fN = focalNormFromHfov(70), aspect = 16 / 9, H = 1.3, Z = 30;
    const yBottom = VP.y + (fN * aspect * H) / Z;
    expect(groundDistanceM(yBottom, VP.y, fN, aspect, H)).toBeCloseTo(Z, 6);
    expect(widthDistanceM((fN * 1.8) / Z, fN, 1.8)).toBeCloseTo(Z, 6);
    /* Ufkun üstündeki nokta ölçülemez — sonsuz/negatif mesafe UYDURULMAZ. */
    expect(groundDistanceM(VP.y - 0.01, VP.y, fN, aspect, H)).toBeNull();
  });

  it('A3. 🔒 tek çizgi, ters çizgi, görüntü dışı ufuk → geometri YOK', () => {
    expect(laneGeometry({ left: line(0.2), right: null })).toBeNull();
    expect(laneGeometry({ left: line(0.8), right: line(0.2) })).toBeNull();
    expect(laneGeometry({ left: line(0.2, 0.9, { x: 0.5, y: 0.95 }), right: line(0.8, 0.9, { x: 0.5, y: 0.95 }) })).toBeNull();
  });

  it('A4. otomatik kalibrasyon: 60 sn / 180 örnek sonra ortanca ile tamamlanır', () => {
    let l = EMPTY_LEARNER;
    for (let i = 0; i < 180; i++) {
      const jitter = ((i % 7) - 3) * 0.004;
      l = learnCalibrationSample(l, lanesAt(jitter * 5), 90, i * 333);
    }
    expect(calibrationProgress(l)).toBe(1);
    const cal = finalizeCalibration(l, 'cam-1', 1_000)!;
    expect(cal).not.toBeNull();
    expect(cal.horizonY).toBeCloseTo(0.4, 2);
    expect(cal.centerX).toBeCloseTo(0.5, 2);
    expect(cal.laneWidthAtRef).toBeCloseTo(0.6, 2);
    expect(cal.source).toBe('auto');
  });

  it('A5. 🔒 50 km/h altı ve bilinmeyen hız örneklenmez; yetersiz örnekle kalibrasyon YOK', () => {
    let l = EMPTY_LEARNER;
    for (let i = 0; i < 300; i++) l = learnCalibrationSample(l, lanesAt(0), 40, i * 300);
    for (let i = 0; i < 300; i++) l = learnCalibrationSample(l, lanesAt(0), null, i * 300);
    expect(l.horizon).toHaveLength(0);
    for (let i = 0; i < 50; i++) l = learnCalibrationSample(l, lanesAt(0), 90, i * 300);
    expect(calibrationProgress(l)).toBeLessThan(1);
    expect(finalizeCalibration(l, 'cam', 0)).toBeNull();
  });

  it('A6. 🔒 tutarsız ufuk (kamera sallantısı) kalibrasyon üretmez', () => {
    let l = EMPTY_LEARNER;
    for (let i = 0; i < 200; i++) {
      const vp = { x: 0.5, y: 0.2 + (i % 10) * 0.05 };
      l = learnCalibrationSample(l, { left: line(0.2, 0.9, vp), right: line(0.8, 0.9, vp) }, 90, i * 300);
    }
    expect(finalizeCalibration(l, 'cam', 0)).toBeNull();
  });

  it('A7. kamera oynarsa (ufuk kalıcı kaydı) kayma yakalanır', () => {
    let recent = EMPTY_LEARNER;
    const moved = { x: 0.5, y: 0.5 };
    for (let i = 0; i < 100; i++) {
      recent = learnCalibrationSample(recent, { left: line(0.2, 0.9, moved), right: line(0.8, 0.9, moved) }, 90, i * 300);
    }
    expect(detectCalibrationDrift(CAL, recent)).toBe(true);
    let same = EMPTY_LEARNER;
    for (let i = 0; i < 100; i++) same = learnCalibrationSample(same, lanesAt(0), 90, i * 300);
    expect(detectCalibrationDrift(CAL, same)).toBe(false);
  });

  it('A8. manuel hizalama şerit genişliğini geometriden türetir; anlamsız hizalama reddedilir', () => {
    const m = manualCalibration({
      horizonY: 0.45, centerX: 0.5, cameraHeightM: 1.3, aspect: 16 / 9,
      laneWidthM: 3.5, cameraKey: 'cam', wallMs: 5,
    })!;
    expect(m.source).toBe('manual');
    expect(m.laneWidthAtRef).toBeCloseTo((3.5 * 0.45) / ((16 / 9) * 1.3), 6);
    expect(manualCalibration({
      horizonY: 0.85, centerX: 0.5, cameraHeightM: 1.3, aspect: 16 / 9, laneWidthM: 3.5, cameraKey: 'c', wallMs: 0,
    })).toBeNull();
  });
});

/* ══════════════════ B · ŞERİT AYRILMA ══════════════════ */

interface LdwRun { outs: LdwOutput[]; state: LdwState }

/** `offsetAt(tMs)` konum profilini `hz` ile sürer. */
function runLdw(
  durationMs: number, offsetAt: (t: number) => number | null, o: {
    speed?: (t: number) => number | null; signal?: (t: number) => TurnSignal;
    cal?: AdasCalibration | null; sens?: AdasSensitivity; hz?: number; conf?: number;
  } = {},
): LdwRun {
  const step = 1000 / (o.hz ?? 10);
  let state = INITIAL_LDW_STATE;
  const outs: LdwOutput[] = [];
  for (let t = 0; t <= durationMs; t += step) {
    const off = offsetAt(t);
    const r = stepLdw(state, {
      tMs: t,
      lanes: off === null ? { left: null, right: null } : lanesAt(off, o.conf ?? 0.9),
      speedKmh: o.speed ? o.speed(t) : 90,
      turnSignal: o.signal ? o.signal(t) : 'none',
      calibration: o.cal === undefined ? CAL : o.cal,
      sensitivity: o.sens ?? 'normal',
    });
    state = r.state;
    outs.push(r.out);
  }
  return { outs, state };
}

const firstWarn = (outs: LdwOutput[]) => outs.findIndex((x) => x.warning !== null);
/** Sola 0.4 m/s kayma (sol = negatif ofset). */
const driftLeft = (t: number) => -0.4 * (t / 1000);

describe('B · şerit ayrılma (LDW)', () => {
  it('B1. 🔒 bilinmeyen hız → UNAVAILABLE, kalibrasyon yok → CALIBRATING (uyarı YOK)', () => {
    const a = runLdw(3000, driftLeft, { speed: () => null });
    expect(a.outs.at(-1)!.state).toBe('UNAVAILABLE');
    expect(a.outs.at(-1)!.reason).toBe('SPEED_UNKNOWN');
    expect(firstWarn(a.outs)).toBe(-1);
    const b = runLdw(3000, driftLeft, { cal: null });
    expect(b.outs.at(-1)!.state).toBe('CALIBRATING');
    expect(firstWarn(b.outs)).toBe(-1);
  });

  it('B2. 60 km/h altı bekleme; histerezis 55 km/h (60→58 hâlâ etkin)', () => {
    expect(runLdw(1000, () => 0, { speed: () => 50 }).outs.at(-1)!.reason).toBe('BELOW_SPEED');
    const r = runLdw(2000, () => 0, { speed: (t) => (t < 1000 ? 70 : 58) });
    expect(r.outs.at(-1)!.state).toBe('READY');
  });

  it('B3. şerit ortasında düz sürüş → uyarı YOK', () => {
    const r = runLdw(20_000, (t) => 0.05 * Math.sin(t / 900));
    expect(firstWarn(r.outs)).toBe(-1);
    expect(r.outs.at(-1)!.state).toBe('READY');
  });

  it('B4. sola kayma: uyarı çizgi GEÇİLMEDEN, TLC ~0.7 sn civarında gelir', () => {
    const r = runLdw(4000, driftLeft);
    const i = firstWarn(r.outs);
    expect(i).toBeGreaterThan(0);
    const o = r.outs[i];
    expect(o.warning).toBe('left');
    const trueDist = LDW_LANE_WIDTH_M / 2 + driftLeft(i * 100) - LDW_HALF_VEHICLE_M;
    expect(trueDist).toBeGreaterThan(0);          // tekerlek çizgiyi geçmeden
    expect(trueDist / 0.4).toBeLessThan(1.0);     // makul erken (TLC < 1 sn)
  });

  it('B5. 🔒 o tarafa sinyal verilmişse (ve 2 sn sonrasına kadar) uyarı YOK', () => {
    expect(firstWarn(runLdw(4000, driftLeft, { signal: () => 'left' }).outs)).toBe(-1);
    /* Sinyal 0.8 sn'de kapandı; bastırma 2.8 sn'ye kadar sürer → uyarı yine yok. */
    expect(firstWarn(runLdw(2700, driftLeft, { signal: (t) => (t < 800 ? 'left' : 'none') }).outs)).toBe(-1);
    /* Diğer tarafa sinyal bu tarafı bastırmaz. */
    expect(firstWarn(runLdw(4000, driftLeft, { signal: () => 'right' }).outs)).toBeGreaterThan(0);
  });

  it('B6. sinyal bilgisi yoksa uyarı çalışır ve bunu dürüstçe bildirir', () => {
    const r = runLdw(4000, driftLeft, { signal: () => 'unknown' });
    const i = firstWarn(r.outs);
    expect(i).toBeGreaterThan(0);
    expect(r.outs[i].turnSignalKnown).toBe(false);
  });

  it('B7. 🔒 şerit değişimi (çizgiler yer değiştirdi) tekrar tekrar uyarı ÜRETMEZ', () => {
    /* Sola şerit değiştirme: 0 → -3.5 m; −1.75'te çizgiler sıçrar (+1.75'e). */
    const off = (t: number) => {
      const o = -0.9 * (t / 1000);
      return o < -1.75 ? o + 3.5 : o;
    };
    const r = runLdw(6000, (t) => (t < 3900 ? off(t) : 0));
    const warns = r.outs.map((x) => x.warning);
    const rising = warns.filter((w, i) => w !== null && warns[i - 1] === null).length;
    expect(rising).toBeLessThanOrEqual(1);
  });

  it('B8. çizgiler kısa süre kaybolursa READY, 1.5 sn\'den uzun → LOW_VISIBILITY', () => {
    const brief = runLdw(3000, (t) => (t > 1000 && t < 1500 ? null : 0));
    expect(brief.outs.at(-1)!.state).toBe('READY');
    const lost = runLdw(4000, (t) => (t > 1000 ? null : 0));
    expect(lost.outs.at(-1)!.state).toBe('UNAVAILABLE');
    expect(lost.outs.at(-1)!.reason).toBe('LOW_VISIBILITY');
  });

  it('B9. 🔒 kalibre genişlikle uyuşmayan çizgi (yanlış çizgi) ölçüm SAYILMAZ', () => {
    let state = INITIAL_LDW_STATE;
    let last: LdwOutput | null = null;
    for (let t = 0; t <= 3000; t += 100) {
      const r = stepLdw(state, {
        tMs: t, lanes: { left: line(0.35), right: line(0.65) },   // genişlik 0.30 ≠ 0.60
        speedKmh: 90, turnSignal: 'none', calibration: CAL, sensitivity: 'normal',
      });
      state = r.state; last = r.out;
    }
    expect(last!.reason).toBe('LOW_VISIBILITY');
    expect(last!.warning).toBeNull();
  });

  it('B10. hassasiyet: "erken" uyarı "geç"ten ÖNCE gelir', () => {
    const early = firstWarn(runLdw(4000, driftLeft, { sens: 'early' }).outs);
    const late = firstWarn(runLdw(4000, driftLeft, { sens: 'late' }).outs);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it('B11. uyarı en az 1.2 sn sürer, şeride dönünce kapanır ve 4 sn aynı tarafa tekrar uyarmaz', () => {
    /* Sola kay → 2.5 sn'de merkeze dön → 4 sn'de yeniden sola kay. */
    const off = (t: number) => (t < 2500 ? driftLeft(t) : t < 4000 ? -0.1 : -0.1 - 0.4 * ((t - 4000) / 1000));
    const r = runLdw(7000, off);
    const on = r.outs.map((x) => x.warning === 'left');
    const start = on.indexOf(true);
    const end = on.indexOf(false, start);
    expect(start).toBeGreaterThan(0);
    expect((end - start) * 100).toBeGreaterThanOrEqual(1200);
    const second = on.indexOf(true, end);
    if (second !== -1) expect((second - end) * 100).toBeGreaterThanOrEqual(4000);
  });
});

/* ══════════════════ C · ÇARPIŞMA / TAKİP / KALKIŞ ══════════════════ */

const FN = focalNormFromHfov(70);
const ASPECT = 16 / 9;
const CAM_H = 1.3;

/** Mesafe `Z` (m) ve yanal kayma `lateralM` (m) için öndeki araç kutusu. */
function carAt(Z: number, lateralM = 0, widthM = 1.8, cls: VehicleDetection['cls'] = 'car', score = 0.8): VehicleDetection {
  const yb = VP.y + (FN * ASPECT * CAM_H) / Z;
  const w = (FN * widthM) / Z;
  const cx = VP.x + (FN * lateralM) / Z;
  return { box: { x: cx - w / 2, y: yb - w * 0.8, w, h: w * 0.8 }, score, cls };
}

interface FwdRun { outs: ForwardOutput[]; state: ForwardState }

function runFwd(
  durationMs: number, scene: (t: number) => VehicleDetection[], o: {
    speed?: (t: number) => number | null; hz?: number; latency?: number; cal?: AdasCalibration | null;
    sens?: AdasSensitivity;
  } = {},
): FwdRun {
  const step = 1000 / (o.hz ?? 8);
  let state = INITIAL_FORWARD_STATE;
  const outs: ForwardOutput[] = [];
  for (let t = 0; t <= durationMs; t += step) {
    const r = stepForward(state, {
      tMs: t, detections: scene(t), latencyMs: o.latency ?? 120,
      speedKmh: o.speed ? o.speed(t) : 60,
      calibration: o.cal === undefined ? CAL : o.cal,
      sensitivity: o.sens ?? 'normal', cameraHeightM: CAM_H, hfovDeg: 70, aspect: ASPECT,
    });
    state = r.state;
    outs.push(r.out);
  }
  return { outs, state };
}

describe('C · çarpışma / takip / kalkış (FCW)', () => {
  it('C1. 🔒 dedektör ısınana kadar LOADING; 2 Hz ya da 500 ms gecikme → TOO_SLOW', () => {
    const warm = runFwd(1000, () => [carAt(40)]);
    expect(warm.outs.at(-1)!.fcwReason).toBe('DETECTOR_LOADING');
    const slow = runFwd(6000, () => [carAt(40)], { hz: 2 });
    expect(slow.outs.at(-1)!.fcwReason).toBe('DETECTOR_TOO_SLOW');
    const laggy = runFwd(6000, () => [carAt(40)], { latency: 500 });
    expect(laggy.outs.at(-1)!.fcwReason).toBe('DETECTOR_TOO_SLOW');
    const ok = runFwd(6000, () => [carAt(40)]);
    expect(ok.outs.at(-1)!.fcwState).toBe('READY');
  });

  it('C2. duran araca 60 km/h ile yaklaşma: uyarı gerçek TTC ~2.2 sn civarında gelir', () => {
    const v = 60 / 3.6;
    /* 3 sn ısınma boyunca uzakta bekleyen araç; sonra 70 m'den yaklaşma. */
    const Z = (t: number) => (t < 3000 ? 70 : 70 - v * ((t - 3000) / 1000));
    const r = runFwd(7000, (t) => (Z(t) > 3 ? [carAt(Z(t))] : []));
    const i = r.outs.findIndex((x) => x.forward === 'collision');
    expect(i).toBeGreaterThan(0);
    const trueTtc = Z(i * 125) / v;
    expect(trueTtc).toBeLessThan(2.6);
    expect(trueTtc).toBeGreaterThan(1.4);
  });

  it('C3. aynı hızla takip (TTC yok) çarpışma uyarısı ÜRETMEZ', () => {
    const r = runFwd(10_000, () => [carAt(25)], { speed: () => 90 });
    expect(r.outs.some((x) => x.forward === 'collision')).toBe(false);
  });

  it('C4. 🔒 yan şeritteki / park etmiş araç koridor dışı → uyarı YOK', () => {
    const v = 60 / 3.6;
    const Z = (t: number) => (t < 3000 ? 70 : 70 - v * ((t - 3000) / 1000));
    const r = runFwd(7000, (t) => (Z(t) > 3 ? [carAt(Z(t), 3.5)] : []));
    expect(r.outs.some((x) => x.forward !== null)).toBe(false);
  });

  it('C5. 🔒 kalibrasyon yok → CALIBRATING; hız yok → UNAVAILABLE; <15 km/h → STANDBY', () => {
    expect(runFwd(4000, () => [carAt(20)], { cal: null }).outs.at(-1)!.fcwState).toBe('CALIBRATING');
    expect(runFwd(4000, () => [carAt(20)], { speed: () => null }).outs.at(-1)!.fcwReason).toBe('SPEED_UNKNOWN');
    expect(runFwd(4000, () => [carAt(20)], { speed: () => 10 }).outs.at(-1)!.fcwState).toBe('STANDBY');
  });

  it('C6. takip mesafesi: 90 km/h\'te 15 m (0.6 sn) 3 sn sürerse uyarı; 30 m (1.2 sn) uyarı yok', () => {
    const close = runFwd(9000, () => [carAt(15)], { speed: () => 90 });
    const i = close.outs.findIndex((x) => x.forward === 'headway');
    expect(i).toBeGreaterThan(0);
    expect(close.outs[i].lead!.headwayS!).toBeCloseTo(0.6, 1);
    const far = runFwd(9000, () => [carAt(30)], { speed: () => 90 });
    expect(far.outs.some((x) => x.forward === 'headway')).toBe(false);
  });

  it('C7. 🔒 mesafe tahminleri ayrışırsa (sınıf genişliği tutmuyor) takip uyarısı YOK', () => {
    /* "car" etiketli ama 4 m genişliğinde nesne → iki tahmin %55 ayrışır (eşik %50). */
    const r = runFwd(9000, () => [carAt(15, 0, 4.0)], { speed: () => 90 });
    expect(r.outs.some((x) => x.forward === 'headway')).toBe(false);
    expect(r.outs.at(-1)!.lead!.distanceM).toBeNull();
  });

  it('C8. duran araçta öndeki araç uzaklaşınca "hareket etti" bir kez bildirilir', () => {
    const Z = (t: number) => (t < 7000 ? 8 : 8 + 4 * ((t - 7000) / 1000));
    const r = runFwd(10_000, (t) => [carAt(Z(t))], { speed: () => 0 });
    const pulses = r.outs.map((x) => x.leadDeparted);
    const rising = pulses.filter((p, i) => p && !pulses[i - 1]).length;
    expect(rising).toBe(1);
    expect(pulses.slice(0, 50).some(Boolean)).toBe(false);   // uzaklaşmadan önce yok
  });

  it('C9. 🔒 araç hareket halindeyken "hareket etti" bildirimi ÜRETİLMEZ', () => {
    const Z = (t: number) => 8 + 4 * (t / 1000);
    const r = runFwd(10_000, (t) => [carAt(Z(t))], { speed: () => 30 });
    expect(r.outs.some((x) => x.leadDeparted)).toBe(false);
  });

  it('C10. düşük skorlu tespit hedef SAYILMAZ', () => {
    const v = 60 / 3.6;
    const Z = (t: number) => (t < 3000 ? 70 : 70 - v * ((t - 3000) / 1000));
    const r = runFwd(7000, (t) => (Z(t) > 3 ? [carAt(Z(t), 0, 1.8, 'car', 0.3)] : []));
    expect(r.outs.some((x) => x.forward !== null)).toBe(false);
  });
});
