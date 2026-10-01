/**
 * arScene.test.ts — AR navigasyon sahnesinin saf geometrisi.
 *
 * Kilitlenen riskler:
 *   - Kamera `object-fit: cover` ile kırpılınca bindirme yoldan KAYMAMALI.
 *   - ADAS'ın ölçtüğü ufuk, projeksiyonda tam o satıra düşmeli (tek geometri).
 *   - USB kamerada ana ünitenin eğim sensörü kamera pozu SAYILMAMALI.
 *   - Chevron'lar rotaya sabit (dünya-kilitli) olmalı; araç ilerleyince zıplamamalı.
 *   - Konumsal kanıt yoksa rota ÇİZİLMEMELİ ve nedeni söylenmeli.
 */
import { describe, expect, it } from 'vitest';
import {
  AR_DEFAULT_PITCH_DEG,
  billboardScale,
  buildArcLengths,
  chevronAnchors,
  chevronPolygon,
  classifyCameraError,
  clipPathForward,
  coverFit,
  extractPathAhead,
  extrapolateFix,
  isDeviceBackCamera,
  makeGroundProjector,
  normToScreen,
  pitchFromHorizon,
  resolveArPose,
  ribbonEdges,
  routeEvidence,
  smoothPose,
  toVehicleFrame,
  type ArPose,
  type LocalPt,
} from '../components/map/ar/arScene';

const LAT0 = 41.0;
const LON0 = 29.0;
const M_PER_DEG = 111_320;

/** Kuzeye düz rota: her `stepM` metrede bir nokta. */
function northRoute(count: number, stepM: number): [number, number][] {
  return Array.from({ length: count }, (_, i) => [LON0, LAT0 + (i * stepM) / M_PER_DEG] as [number, number]);
}

const GOOD_POSE: ArPose = { pitchDeg: -3, hfovDeg: 66, heightM: 1.2, source: 'adas', usable: true };

describe('coverFit — kamera kırpması', () => {
  it('16:9 kare geniş ekranda üstten/alttan kırpılır, merkez korunur', () => {
    const fit = coverFit(1280, 720, 2000, 900);
    expect(fit.scale).toBeCloseTo(1.5625, 6);
    expect(fit.offX).toBeCloseTo(0, 6);
    expect(fit.offY).toBeCloseTo(-112.5, 6);
    const c = normToScreen(fit, 0.5, 0.5);
    expect(c.x).toBeCloseTo(1000, 6);
    expect(c.y).toBeCloseTo(450, 6);
    // Karenin üst kenarı ekranın ÜSTÜNDE kalır (kırpılmış) — eski çizim bunu yok sayıyordu.
    expect(normToScreen(fit, 0, 0).y).toBeLessThan(0);
  });

  it('video boyutu henüz bilinmiyorsa 16:9 varsayılır (NaN üretmez)', () => {
    const fit = coverFit(0, 0, 800, 450);
    expect(fit.srcW).toBe(1280);
    expect(fit.srcH).toBe(720);
    expect(Number.isFinite(fit.scale)).toBe(true);
  });
});

describe('kamera pozu — ADAS ufku > cihaz sensörü > varsayılan', () => {
  it('ADAS ufku projeksiyonda TAM o satıra düşer (tek geometri)', () => {
    const horizonY = 0.42;
    const pose = resolveArPose({
      adas: { hfovDeg: 70, cameraHeightM: 1.3, horizonY },
      sensor: { pitchDeg: 25, measured: true },
      deviceBackCamera: true,
      srcW: 1280, srcH: 720,
    });
    expect(pose.source).toBe('adas');
    expect(pose.hfovDeg).toBe(70);
    expect(pose.heightM).toBe(1.3);
    const fit = coverFit(1280, 720, 2000, 900);
    const far = makeGroundProjector(pose, fit)(0, 50_000);
    expect(far).not.toBeNull();
    expect(far!.y).toBeCloseTo(normToScreen(fit, 0.5, horizonY).y, 0);
  });

  it('pitchFromHorizon: ufuk merkezdeyse eğim 0, üstteyse aşağı bakıyor', () => {
    expect(pitchFromHorizon(0.5, 66, 1280, 720)).toBeCloseTo(0, 9);
    expect(pitchFromHorizon(0.4, 66, 1280, 720)).toBeLessThan(0);
  });

  it('USB/harici kamerada ana ünitenin eğim sensörü KULLANILMAZ', () => {
    const pose = resolveArPose({
      adas: null, sensor: { pitchDeg: -22, measured: true }, deviceBackCamera: false, srcW: 1280, srcH: 720,
    });
    expect(pose.source).toBe('default');
    expect(pose.pitchDeg).toBe(AR_DEFAULT_PITCH_DEG);
  });

  it('ölçülmemiş sensör varsayılanı (15°) ölçüm sayılmaz', () => {
    const pose = resolveArPose({
      adas: null, sensor: { pitchDeg: 15, measured: false }, deviceBackCamera: true, srcW: 1280, srcH: 720,
    });
    expect(pose.source).toBe('default');
  });

  it('cihazın arka kamerası + ölçülmüş eğim → sensör; yola bakmıyorsa kullanılamaz', () => {
    const ok = resolveArPose({
      adas: null, sensor: { pitchDeg: -6, measured: true }, deviceBackCamera: true, srcW: 1280, srcH: 720,
    });
    expect(ok.source).toBe('sensor');
    expect(ok.usable).toBe(true);
    const tilted = resolveArPose({
      adas: null, sensor: { pitchDeg: -70, measured: true }, deviceBackCamera: true, srcW: 1280, srcH: 720,
    });
    expect(tilted.usable).toBe(false);
  });
});

describe('yer düzlemi projektörü', () => {
  const fit = coverFit(1280, 720, 1280, 720);
  const project = makeGroundProjector(GOOD_POSE, fit);

  it('tam karşıdaki nokta yatay merkeze, sağdaki sağa, yakındaki aşağıya düşer', () => {
    const ahead = project(0, 20)!;
    expect(ahead.x).toBeCloseTo(640, 6);
    expect(project(2, 20)!.x).toBeGreaterThan(640);
    expect(project(0, 6)!.y).toBeGreaterThan(ahead.y);
  });

  it('kameranın arkası projekte edilmez', () => {
    expect(project(0, -5)).toBeNull();
  });
});

describe('ileri rota yolu', () => {
  const geom = northRoute(12, 50); // 550 m kuzey
  const arc = buildArcLengths(geom);
  const origin = { lat: LAT0, lon: LON0 };

  it('yay uzunlukları metre cinsinden', () => {
    expect(arc[0]).toBe(0);
    expect(arc[11]).toBeCloseTo(550, 0);
  });

  it('araç rotanın 3 m doğusunda, 120 m ilerisinde → izdüşüm, sapma ve yön doğru', () => {
    const lat = LAT0 + 120 / M_PER_DEG;
    const lon = LON0 + 3 / (M_PER_DEG * Math.cos(LAT0 * Math.PI / 180));
    const path = extractPathAhead(geom, arc, origin, lat, lon, -1, 200)!;
    expect(path).not.toBeNull();
    expect(path.segIdx).toBe(2);
    expect(path.offRouteM).toBeCloseTo(3, 1);
    expect(path.points[0].s).toBeCloseTo(120, 0);
    expect(path.points[path.points.length - 1].s - path.points[0].s).toBeGreaterThanOrEqual(200);
    expect(path.bearingDeg).toBeCloseTo(0, 0);
  });

  it('ipucu penceresi yanlışsa tam taramaya düşer', () => {
    // 800 nokta × 5 m: ipucu 0'ın penceresi (≤600. nokta = 3000 m) aracı (3800 m) KAPSAMAZ.
    const long = northRoute(800, 5);
    const lat = LAT0 + 3_802 / M_PER_DEG;
    const path = extractPathAhead(long, buildArcLengths(long), origin, lat, LON0, 0, 50)!;
    expect(path.segIdx).toBe(760);
    expect(path.offRouteM).toBeLessThan(0.5);
  });
});

describe('araç çerçevesi ve kırpma', () => {
  const pts: LocalPt[] = [
    { right: 0, fwd: 0, s: 100 },
    { right: 0, fwd: 50, s: 150 },
    { right: 0, fwd: 300, s: 400 },
  ];

  it('yol [near, far] bandına kırpılır', () => {
    const c = clipPathForward(pts, 3.5, 140);
    expect(c[0].fwd).toBeCloseTo(3.5, 6);
    expect(c[0].s).toBeCloseTo(103.5, 6);
    expect(c[c.length - 1].fwd).toBeCloseTo(140, 6);
  });

  it('U dönüşü kameranın arkasına sarkmaz', () => {
    const uturn: LocalPt[] = [
      { right: 0, fwd: 0, s: 0 },
      { right: 0, fwd: 40, s: 40 },
      { right: 8, fwd: 40, s: 48 },
      { right: 8, fwd: -20, s: 108 },
    ];
    const c = clipPathForward(uturn, 3.5, 140);
    expect(c.every((p) => p.fwd >= 3.5 - 1e-9)).toBe(true);
    expect(c[c.length - 1].fwd).toBeCloseTo(3.5, 6);
  });

  it('kuzeye giden araç için kuzeydeki nokta ileride, doğudaki sağda', () => {
    const [n, e] = toVehicleFrame([{ e: 0, n: 10, s: 0 }, { e: 10, n: 0, s: 0 }], 0, 0, 0);
    expect(n.fwd).toBeCloseTo(10, 9);
    expect(e.right).toBeCloseTo(10, 9);
    const [east] = toVehicleFrame([{ e: 10, n: 0, s: 0 }], 0, 0, 90);
    expect(east.fwd).toBeCloseTo(10, 9);
  });

  it('halı kenarları yolun iki yanında, istenen genişlikte', () => {
    const { left, right } = ribbonEdges(clipPathForward(pts, 3.5, 140), 1.1);
    expect(left[0].right).toBeCloseTo(-1.1, 6);
    expect(right[0].right).toBeCloseTo(1.1, 6);
  });
});

describe('chevron — dünya-kilitli', () => {
  it('chevron yay konumları aralığın katlarıdır ve araç ilerleyince DEĞİŞMEZ', () => {
    const geom = northRoute(6, 50);
    const arc = buildArcLengths(geom);
    const origin = { lat: LAT0, lon: LON0 };
    const sAt = (vehicleNorthM: number): number[] => {
      const lat = LAT0 + vehicleNorthM / M_PER_DEG;
      const path = extractPathAhead(geom, arc, origin, lat, LON0, -1, 150)!;
      const local = clipPathForward(toVehicleFrame(path.points, 0, vehicleNorthM, 0), 3.5, 140);
      return chevronAnchors(local, 7).map((a) => a.s);
    };
    const a = sAt(30);
    const b = sAt(31.3);
    for (const s of a) expect(s % 7).toBeCloseTo(0, 6);
    // 1.3 m ilerleyince ortak chevron'lar AYNI yay konumunda kalır (yolda sabit).
    const common = a.filter((s) => b.includes(s));
    expect(common.length).toBeGreaterThan(a.length - 2);
  });

  it('chevron çokgeni 6 köşe, ucu ileri bakar', () => {
    const poly = chevronPolygon({ right: 0, fwd: 20, tr: 0, tf: 1, s: 0 });
    expect(poly).toHaveLength(6);
    const tip = poly[1];
    expect(tip[1]).toBeGreaterThan(poly[0][1]);
    expect(tip[0]).toBeCloseTo(0, 9);
  });
});

describe('kanıt kapısı — kanıtsız rota çizilmez', () => {
  const base = { accuracyM: 6, fixAgeMs: 400, offRouteM: 2, headingKnown: true, pose: GOOD_POSE };

  it('iyi kanıt → GOOD, tam opak', () => {
    expect(routeEvidence(base)).toEqual({ level: 'GOOD', reason: null, alpha: 1 });
  });
  it('düşük doğruluk → NONE + neden', () => {
    expect(routeEvidence({ ...base, accuracyM: 120 })).toMatchObject({ level: 'NONE', reason: 'LOW_ACCURACY', alpha: 0 });
  });
  it('konum yok / bayat → NONE', () => {
    expect(routeEvidence({ ...base, accuracyM: null }).reason).toBe('NO_FIX');
    expect(routeEvidence({ ...base, fixAgeMs: 9_000 }).reason).toBe('STALE_FIX');
  });
  it('rota dışı / yön yok / kamera yola bakmıyor → NONE', () => {
    expect(routeEvidence({ ...base, offRouteM: 90 }).reason).toBe('OFF_ROUTE');
    expect(routeEvidence({ ...base, headingKnown: false }).reason).toBe('NO_HEADING');
    expect(routeEvidence({ ...base, pose: { ...GOOD_POSE, usable: false } }).reason).toBe('CAMERA_TILT');
  });
  it('kalibre edilmemiş poz ya da orta doğruluk → WEAK (soluk çizim)', () => {
    expect(routeEvidence({ ...base, pose: { ...GOOD_POSE, source: 'default' } }).level).toBe('WEAK');
    expect(routeEvidence({ ...base, accuracyM: 35 }).level).toBe('WEAK');
  });
  it('şerit tespit güveni ölçüt DEĞİL — şeritsiz sokakta da çizilir', () => {
    // Girdi sözleşmesinde şerit/güven alanı yoktur: rota konumla yerleşir.
    expect(Object.keys(base)).not.toContain('confidence');
    expect(routeEvidence(base).level).toBe('GOOD');
  });
});

describe('çizim pozu (yalnız sunum)', () => {
  it('ileri kestirim hız × süre, 1 sn ile sınırlı', () => {
    const fix = { e: 0, n: 0, courseDeg: 90, speedMps: 10 };
    expect(extrapolateFix(fix, 0.5).e).toBeCloseTo(5, 6);
    expect(extrapolateFix(fix, 3).e).toBeCloseTo(10, 6);
    expect(extrapolateFix({ ...fix, speedMps: null }, 1).e).toBe(0);
  });

  it('yumuşatma hedefe yaklaşır; büyük sıçramada doğrudan atlar', () => {
    const prev = { e: 0, n: 0, headingDeg: 0 };
    const step = smoothPose(prev, { e: 1, n: 0, headingDeg: 0 }, 0.033);
    expect(step.e).toBeGreaterThan(0);
    expect(step.e).toBeLessThan(1);
    expect(smoothPose(prev, { e: 500, n: 0, headingDeg: 0 }, 0.033).e).toBe(500);
  });

  it('yön 350° → 10° geçişi 0° üzerinden döner (360° dolanmaz)', () => {
    const p = smoothPose({ e: 0, n: 0, headingDeg: 350 }, { e: 0, n: 0, headingDeg: 10 }, 0.5);
    expect(p.headingDeg > 350 || p.headingDeg < 10).toBe(true);
  });

  it('manevra işareti yakında büyük, uzakta sınırlı küçük', () => {
    expect(billboardScale(20)).toBeGreaterThan(billboardScale(200));
    expect(billboardScale(1_000)).toBeGreaterThanOrEqual(0.62);
    expect(billboardScale(1)).toBeLessThanOrEqual(1.3);
  });
});

describe('kamera hatası ve kamera türü', () => {
  it('getUserMedia hata adları sürücüye söylenebilir nedenlere eşlenir', () => {
    expect(classifyCameraError({ name: 'NotAllowedError', message: 'Permission denied' })).toBe('DENIED');
    expect(classifyCameraError({ name: 'NotFoundError', message: 'Requested device not found' })).toBe('NOT_FOUND');
    expect(classifyCameraError({ name: 'NotReadableError', message: 'Could not start video source' })).toBe('BUSY');
    expect(classifyCameraError(new Error('boom'))).toBe('FAILED');
  });

  it('arka kamera etiketi tanınır; USB/ön kamera tanınmaz', () => {
    expect(isDeviceBackCamera('camera2 0, facing back')).toBe(true);
    expect(isDeviceBackCamera('camera2 1, facing front')).toBe(false);
    expect(isDeviceBackCamera('USB Camera (046d:0825)')).toBe(false);
    expect(isDeviceBackCamera('')).toBe(false);
  });
});
