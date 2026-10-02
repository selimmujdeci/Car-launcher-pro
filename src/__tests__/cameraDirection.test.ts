/**
 * cameraDirection.test.ts — Kamera yönünün hareketten doğrulanması (SAF).
 *
 * Sahne: sabit gürültü dokusu (asfalt / çizgi / gölge yerine) karede dikey
 * kaydırılır. Öne bakan kamerada yol dokusu ilerlerken AŞAĞI, geri görüş
 * kamerasında YUKARI akar; perspektif nedeniyle alt bant üst banttan hızlıdır.
 */
import { describe, it, expect } from 'vitest';
import {
  DIR_MIN_VOTES, EMPTY_VOTER, bandShift, directionProgress, directionVerdict, voteDirection,
  type DirectionVoter, type LumaFrame,
} from '../platform/adas/cameraDirection';

const W = 96;
const H = 54;

/** Deterministik doku (0–255). */
function tex(x: number, y: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return Math.floor((v - Math.floor(v)) * 255);
}

/** Satır y'nin içeriği `off(y)` kadar aşağı kaymış kare. */
function frame(off: (y: number) => number, fill?: (x: number, y: number) => number): LumaFrame {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = off(y);
    for (let x = 0; x < W; x++) data[y * W + x] = fill ? fill(x, y) : tex(x, y - o);
  }
  return { w: W, h: H, data };
}

/** t. karede perspektifli akış: alt bant üst banttan hızlı; `dir` +1 aşağı / -1 yukarı. */
const flow = (t: number, dir: 1 | -1) => frame((y) => dir * t * (y < 35 ? 1 : y < 41 ? 2 : 3));

function drive(n: number, make: (t: number) => LumaFrame, speed: number | null = 60): DirectionVoter {
  let v = EMPTY_VOTER;
  let prev: LumaFrame | null = null;
  for (let t = 0; t < n; t++) {
    const cur = make(t);
    v = voteDirection(v, prev, cur, speed);
    prev = cur;
  }
  return v;
}

describe('kamera yönü (hareket kanıtı)', () => {
  it('D1. bant kayması: aşağı akış +, yukarı akış −, hareketsiz 0', () => {
    const a = frame(() => 0);
    expect(bandShift(a, frame(() => 2), 0.52, 0.64)).toBe(2);
    expect(bandShift(a, frame(() => -3), 0.76, 0.88)).toBe(-3);
    expect(bandShift(a, a, 0.52, 0.64)).toBe(0);
  });

  it('D2. 🔒 dokusuz yüzey (düz asfalt / gece) oy ÜRETMEZ', () => {
    const flat = (t: number) => frame(() => t, () => 120);
    expect(bandShift(flat(0), flat(1), 0.52, 0.64)).toBeNull();
    expect(drive(100, flat)).toEqual(EMPTY_VOTER);
  });

  it('D3. öne bakan kamera: ~4 sn sürüşte (10 Hz) "forward"', () => {
    const v = drive(DIR_MIN_VOTES + 1, (t) => flow(t, 1));
    expect(directionVerdict(v)).toBe('forward');
    expect(directionProgress(v)).toBe(1);
  });

  it('D4. 🔒 geri görüş kamerası: "backward"', () => {
    expect(directionVerdict(drive(DIR_MIN_VOTES + 1, (t) => flow(t, -1)))).toBe('backward');
  });

  it('D5. 🔒 araç içi kamera (akış yok) ve 20 km/h altı → hüküm YOK', () => {
    expect(directionVerdict(drive(200, () => frame(() => 0)))).toBeNull();
    expect(drive(200, (t) => flow(t, 1), 15)).toEqual(EMPTY_VOTER);
    expect(drive(200, (t) => flow(t, 1), null)).toEqual(EMPTY_VOTER);
  });

  it('D6. 🔒 titreşim / yunuslama (iki yönde eşit) hüküm üretmez', () => {
    /* Kare kare ±2 px zıplayan tüm görüntü: kayma işareti sırayla değişir. */
    const v = drive(300, (t) => frame(() => (t % 2 === 0 ? 0 : 2)));
    expect(directionVerdict(v)).toBeNull();
  });

  it('D7. az kanıt hüküm değildir; %80 altı çoğunluk da değildir', () => {
    expect(directionVerdict({ down: DIR_MIN_VOTES - 1, up: 0 })).toBeNull();
    expect(directionVerdict({ down: 30, up: 10 })).toBeNull();
    expect(directionVerdict({ down: 32, up: 8 })).toBe('forward');
    expect(directionVerdict({ down: 8, up: 32 })).toBe('backward');
  });
});
