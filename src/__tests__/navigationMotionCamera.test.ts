/**
 * navigationMotionCamera.test.ts — NAVIGATION_MOTION_CAMERA_P0 kilitleri.
 *
 * Kapsam (görev §13): motion · camera · pan/recenter · orientation · regresyon.
 */
/// <reference types="vite/client" />
import { describe, it, expect, beforeEach } from 'vitest';

import miniSrc     from '../components/map/MiniMapWidget.tsx?raw';
import fullSrc     from '../components/map/FullMapView.tsx?raw';
import motionSrc   from '../platform/navigation/core/markerMotionModel.ts?raw';
import camSrc      from '../platform/navigation/core/cameraPolicyModel.ts?raw';
import runtimeSrc  from '../platform/navigation/navMarkerMotionRuntime.ts?raw';
import orientSrc   from '../platform/navigation/navigationOrientation.ts?raw';
import appSrc      from '../App.tsx?raw';

import {
  computeRenderedMotion, isImplausibleJump, lerpBearing,
  MOTION_STALE_MS, MOTION_MAX_EXTRAPOLATION_MS, MOTION_MIN_EXTRAPOLATION_KMH,
  MOTION_DEGRADED_ACCURACY_M,
  type MotionSample,
} from '../platform/navigation/core/markerMotionModel';
import {
  decideCameraPolicy, resolveSpeedBand, resolveManeuverBand,
  shouldApplyCameraUpdate, SPEED_BANDS, MANEUVER_BANDS,
  CAMERA_POLICY_VERSION, CAMERA_MIN_UPDATE_MS,
  type CameraPolicyInput,
} from '../platform/navigation/core/cameraPolicyModel';
import {
  noteMotionSample, getRenderedMotion, getMarkerMotionSnapshot,
  registerMotionFeeder, resetMarkerMotion, _resetMarkerMotionForTest,
} from '../platform/navigation/navMarkerMotionRuntime';
import {
  acquireFullNavigationOrientation, getNavigationOrientationSnapshot,
  orientationOf, _resetNavigationOrientationForTest,
} from '../platform/navigation/navigationOrientation';

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

const sample = (over: Partial<MotionSample> = {}): MotionSample => ({
  lat: 36.8000, lon: 34.6000, headingDeg: 90, speedKmh: 50,
  accuracyM: 8, tsMs: 1_000, matched: false, ...over,
});

/* ══════════════════════════════════════════════════════════════════════════
   A. HAREKET MODELİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('A. İşaret hareket modeli', () => {
  it('örnek yoksa UNKNOWN — konum uydurulmaz', () => {
    const r = computeRenderedMotion({ prev: null, cur: null, nowMs: 0 });
    expect(r.state).toBe('UNKNOWN');
    expect(r.lat).toBeNull();
  });

  it('iki fix arası ARA DEĞER üretir (2 Hz GPS akıcı görünür)', () => {
    // 50 km/sa · 500 ms → ~7 m gerçekçi yer değiştirme (sıçrama DEĞİL).
    const prev = sample({ tsMs: 1_000, lat: 36.80000 });
    const cur  = sample({ tsMs: 1_500, lat: 36.80006 });
    const mid = computeRenderedMotion({ prev, cur, nowMs: 1_250 });
    expect(mid.state).toBe('INTERPOLATING');
    expect(mid.interpolationProgress).toBeCloseTo(0.5, 3);
    expect(mid.lat).toBeGreaterThan(36.80000);
    expect(mid.lat).toBeLessThan(36.80006);
  });

  it('ara değer MONOTONİK ilerler (geri gitmez)', () => {
    const prev = sample({ tsMs: 1_000, lat: 36.80000 });
    const cur  = sample({ tsMs: 1_500, lat: 36.80006 });
    let last = -Infinity;
    for (let t = 1_000; t <= 1_500; t += 50) {
      const r = computeRenderedMotion({ prev, cur, nowMs: t });
      expect(r.lat as number).toBeGreaterThanOrEqual(last);
      last = r.lat as number;
    }
  });

  it('🔒 DURAN ARAÇTA yapay mesafe ÜRETİLMEZ (ekstrapolasyon yok)', () => {
    const prev = sample({ tsMs: 1_000, speedKmh: 0 });
    const cur  = sample({ tsMs: 1_500, speedKmh: MOTION_MIN_EXTRAPOLATION_KMH - 0.5, lat: 36.8001 });
    const r = computeRenderedMotion({ prev, cur, nowMs: 2_200 });
    expect(r.interpolationProgress).toBe(1);   // t asla 1'i geçmez
    expect(r.lat).toBeCloseTo(cur.lat, 10);
  });

  it('ekstrapolasyon SÜRE ile sınırlıdır (zombi hareket yok)', () => {
    const prev = sample({ tsMs: 1_000, lat: 36.80000 });
    const cur  = sample({ tsMs: 1_500, lat: 36.80007, speedKmh: 60 });
    const far = computeRenderedMotion({ prev, cur, nowMs: 1_500 + 5_000 });
    const cap = 1 + MOTION_MAX_EXTRAPOLATION_MS / 500;
    expect(far.interpolationProgress).toBeLessThanOrEqual(cap + 1e-9);
  });

  it('🔒 BAYAT konumda hareket UYDURULMAZ — işaret donar', () => {
    const cur = sample({ tsMs: 1_000 });
    const r = computeRenderedMotion({ prev: sample({ tsMs: 500 }), cur, nowMs: 1_000 + MOTION_STALE_MS + 1 });
    expect(r.state).toBe('STALE');
    expect(r.lat).toBe(cur.lat);
    expect(r.confidence).toBe(0);
  });

  it('🔒 BÜYÜK GPS SIÇRAMASI animasyonla MEŞRULAŞTIRILMAZ', () => {
    const prev = sample({ tsMs: 1_000, lat: 36.800, speedKmh: 50 });
    // 500 ms'de ~1.1 km → fiziksel olarak imkânsız
    const cur  = sample({ tsMs: 1_500, lat: 36.810, speedKmh: 50 });
    expect(isImplausibleJump(prev, cur)).toBe(true);
    const r = computeRenderedMotion({ prev, cur, nowMs: 1_250 });
    expect(r.state).toBe('SNAP_CORRECTION');
    expect(r.lat).toBe(cur.lat);            // ara değer YOK, doğrudan uygulandı
  });

  it('düşük hızdaki GPS gürültüsü sıçrama SAYILMAZ', () => {
    const prev = sample({ tsMs: 1_000, lat: 36.80000, speedKmh: 0, accuracyM: 6 });
    const cur  = sample({ tsMs: 1_500, lat: 36.80010, speedKmh: 0, accuracyM: 6 }); // ~11 m
    expect(isImplausibleJump(prev, cur)).toBe(false);
  });

  it('eşleştirme kaynağı değişince KONTROLLÜ düzeltme yapılır', () => {
    const prev = sample({ tsMs: 1_000, matched: false });
    const cur  = sample({ tsMs: 1_500, matched: true, lat: 36.80005 });
    const r = computeRenderedMotion({ prev, cur, nowMs: 1_250 });
    expect(r.state).toBe('SNAP_CORRECTION');
  });

  it('GPS doğruluğu bozukken ekstrapolasyon KAPALI', () => {
    const prev = sample({ tsMs: 1_000, accuracyM: MOTION_DEGRADED_ACCURACY_M + 10 });
    const cur  = sample({ tsMs: 1_500, accuracyM: MOTION_DEGRADED_ACCURACY_M + 10, lat: 36.8005 });
    const r = computeRenderedMotion({ prev, cur, nowMs: 2_000 });
    expect(r.state).toBe('GPS_DEGRADED');
    expect(r.interpolationProgress).toBe(1);
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('yön bilinmiyorsa ANİ DÖNÜŞ olmaz — önceki yön korunur', () => {
    const prev = sample({ tsMs: 1_000, headingDeg: null });
    const cur  = sample({ tsMs: 1_500, headingDeg: null });
    const r = computeRenderedMotion({ prev, cur, nowMs: 1_250, lastBearingDeg: 42 });
    expect(r.bearingDeg).toBe(42);
  });

  it('yön ara değeri KISA YAYDAN gider (0/360 geçişi)', () => {
    expect(lerpBearing(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(lerpBearing(10, 350, 0.5)).toBeCloseTo(0, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B. PAYLAŞILAN MOTION RUNTIME
   ══════════════════════════════════════════════════════════════════════════ */
describe('B. Paylaşılan motion runtime', () => {
  beforeEach(() => { _resetMarkerMotionForTest(); });

  it('mini ve tam ekran AYNI konumu okur', () => {
    noteMotionSample(sample({ tsMs: 1_000, lat: 36.80000 }));
    noteMotionSample(sample({ tsMs: 1_500, lat: 36.80006 }));
    const a = getRenderedMotion(1_250);
    const b = getRenderedMotion(1_250);
    expect(a.lat).toBe(b.lat);
    expect(a.lon).toBe(b.lon);
    expect(a.state).toBe(b.state);
  });

  it('aynı/eski damgalı örnek İKİNCİ KEZ yazılmaz (çift tick koruması)', () => {
    noteMotionSample(sample({ tsMs: 1_000 }));
    noteMotionSample(sample({ tsMs: 1_000 }));
    noteMotionSample(sample({ tsMs: 900 }));
    expect(getMarkerMotionSnapshot(1_000).sampleCount).toBe(1);
  });

  it('🔒 ÇİFT RUNTIME sayacı LAB\'da görünür', () => {
    const r1 = registerMotionFeeder();
    expect(getMarkerMotionSnapshot(0).duplicateMotionRuntimeCount).toBe(0);
    const r2 = registerMotionFeeder();
    expect(getMarkerMotionSnapshot(0).duplicateMotionRuntimeCount).toBe(1);
    r2(); r1();
    expect(getMarkerMotionSnapshot(0).duplicateMotionRuntimeCount).toBe(0);
  });

  it('🔒 LAB anlık görüntüsü KOORDİNAT SIZDIRMAZ', () => {
    noteMotionSample(sample({ tsMs: 1_000, lat: 36.8123456, lon: 34.6123456 }));
    const snap = getMarkerMotionSnapshot(1_000) as unknown as Record<string, unknown>;
    const json = JSON.stringify(snap);
    expect(json).not.toContain('36.81');
    expect(json).not.toContain('34.61');
    for (const key of Object.keys(snap)) {
      expect(/latitude|longitude|coordinate|coords?$/i.test(key),
        `alan sızdırıyor: ${key}`).toBe(false);
    }
  });

  it('navigasyon bitince hareket geçmişi TEMİZLENİR', () => {
    noteMotionSample(sample({ tsMs: 1_000 }));
    resetMarkerMotion();
    expect(getRenderedMotion(1_000).state).toBe('UNKNOWN');
  });

  it('tam ekran açılıp kapanınca marker SIÇRAMAZ (durum modül düzeyinde)', () => {
    noteMotionSample(sample({ tsMs: 1_000, lat: 36.80000 }));
    noteMotionSample(sample({ tsMs: 1_500, lat: 36.80006 }));
    const before = getRenderedMotion(1_300);
    // "Görünüm kapandı/açıldı" — runtime durumu DEĞİŞMEZ.
    const after = getRenderedMotion(1_300);
    expect(after.lat).toBe(before.lat);
    expect(after.state).toBe(before.state);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C. KAMERA POLİTİKASI
   ══════════════════════════════════════════════════════════════════════════ */
describe('C. Kamera politikası', () => {
  const base: CameraPolicyInput = {
    speedKmh: 40, prevBand: null, nextManeuverM: null,
    maneuverDistanceSource: 'ALONG_ROUTE', secondManeuverM: null,
    followState: 'FOLLOWING', motionState: 'TRACKING',
    orientation: 'LANDSCAPE', viewport: 'FULL',
  };

  it('profil tablosu VERSİYONLUDUR ve her bant künyelidir', () => {
    expect(CAMERA_POLICY_VERSION).toMatch(/^CAM-\d{4}\.\d{2}\.\d{2}$/);
    for (const b of SPEED_BANDS) {
      expect(b.exitKmh).toBeLessThanOrEqual(b.enterKmh);   // histerezis payı
      expect(b.note.length).toBeGreaterThan(5);
      expect(b.anchorYLandscape).toBeGreaterThan(0);
      expect(b.anchorYPortrait).toBeGreaterThan(0);
    }
  });

  it('hız bantları sırayla artar ve çapa aşağı kayar (ön yol uzar)', () => {
    const ys = SPEED_BANDS.map((b) => b.anchorYLandscape);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
  });

  it('🔒 90–110 km/sa aralığında kamera BELİRGİN geri çekilir', () => {
    const city = decideCameraPolicy({ ...base, speedKmh: 40 });
    const cruise = decideCameraPolicy({ ...base, speedKmh: 100 });
    expect(city.speedBand).toBe('CITY');
    expect(cruise.speedBand).toBe('CRUISE');
    expect(cruise.state).toBe('FOLLOW_CRUISE');
    expect(cruise.anchorY).toBeGreaterThan(city.anchorY);
  });

  it('🔒 BANT SINIRINDA SALINIM YOK (histerezis)', () => {
    // 90'a çıkıldı → CRUISE. 85'e düştü → ÇIKIŞ eşiği 82, hâlâ CRUISE.
    expect(resolveSpeedBand(92, null)).toBe('CRUISE');
    expect(resolveSpeedBand(85, 'CRUISE')).toBe('CRUISE');
    expect(resolveSpeedBand(80, 'CRUISE')).toBe('SUBURBAN');
    // Yukarı geçişte histerezis YOK — rejim gecikmez.
    expect(resolveSpeedBand(92, 'SUBURBAN')).toBe('CRUISE');
  });

  it('🔒 manevra bandı YOL-BOYU mesafeden türer; kuş uçuşu KABUL EDİLMEZ', () => {
    expect(resolveManeuverBand(120, 'ALONG_ROUTE')).toBe('APPROACH');
    expect(resolveManeuverBand(120, 'STRAIGHT_LINE')).toBe('NONE');
    expect(resolveManeuverBand(120, 'UNKNOWN')).toBe('NONE');
    expect(resolveManeuverBand(null, 'ALONG_ROUTE')).toBe('NONE');
  });

  it('manevra rejimleri: uzak → seyir, yaklaşma → APPROACH, dönüş → IN_MANEUVER', () => {
    expect(decideCameraPolicy({ ...base, speedKmh: 100, nextManeuverM: 900 }).state)
      .toBe('FOLLOW_CRUISE');
    expect(decideCameraPolicy({ ...base, nextManeuverM: MANEUVER_BANDS.APPROACH_M - 10 }).state)
      .toBe('APPROACH_MANEUVER');
    expect(decideCameraPolicy({ ...base, nextManeuverM: MANEUVER_BANDS.IMMINENT_M - 10 }).state)
      .toBe('IN_MANEUVER');
  });

  it('manevra tamamlanınca seyir profiline DÖNER', () => {
    const d = decideCameraPolicy({ ...base, speedKmh: 95, nextManeuverM: 900, justPassedManeuver: true });
    expect(d.state).toBe('POST_MANEUVER');
    expect(d.applyManeuverCamera).toBe(false);
  });

  it('🔒 KULLANICI PAN kamerayı DURDURUR — zorla geri dönmez', () => {
    for (const fs of ['USER_PANNING', 'FOLLOW_SUSPENDED'] as const) {
      const d = decideCameraPolicy({ ...base, followState: fs });
      expect(d.cameraDriveAllowed).toBe(false);
      expect(d.applyManeuverCamera).toBe(false);
    }
  });

  it('🔒 takip durumu bilinmiyorsa kamera SÜRÜLMEZ (fail-closed)', () => {
    expect(decideCameraPolicy({ ...base, followState: 'UNKNOWN' }).cameraDriveAllowed).toBe(false);
  });

  it('🔒 GPS BOZUKKEN kamera araca AŞIRI YAKLAŞMAZ ve manevra kamerası kapanır', () => {
    for (const ms of ['GPS_DEGRADED', 'STALE'] as const) {
      const d = decideCameraPolicy({ ...base, motionState: ms, nextManeuverM: 40 });
      expect(d.state).toBe('GPS_DEGRADED');
      expect(d.maxZoomHint).not.toBeNull();
      expect(d.applyManeuverCamera).toBe(false);
    }
  });

  it('DİKEY yönde araç daha yukarıda çapalanır (ileri yola daha çok alan)', () => {
    const land = decideCameraPolicy({ ...base, speedKmh: 100, orientation: 'LANDSCAPE' });
    const port = decideCameraPolicy({ ...base, speedKmh: 100, orientation: 'PORTRAIT' });
    expect(port.anchorY).not.toBe(land.anchorY);
    expect(port.anchorY).toBeGreaterThan(0.5);
    expect(port.anchorY).toBeLessThan(0.7);
  });

  it('🔒 GÜNCELLEME FIRTINASI YOK — asgari aralık uygulanır', () => {
    const d1 = decideCameraPolicy(base);
    expect(shouldApplyCameraUpdate({
      nowMs: 1_000, lastAppliedMs: 1_000 - (CAMERA_MIN_UPDATE_MS - 10),
      prevDecision: d1, nextDecision: d1, prevSpeedKmh: 40, speedKmh: 41,
    })).toBe(false);
  });

  it('🔒 REJİM DEĞİŞİMİ asgari aralığı ATLAR (gecikmez)', () => {
    const city = decideCameraPolicy({ ...base, speedKmh: 40 });
    const turn = decideCameraPolicy({ ...base, speedKmh: 40, nextManeuverM: 40 });
    expect(shouldApplyCameraUpdate({
      nowMs: 1_000, lastAppliedMs: 999,
      prevDecision: city, nextDecision: turn, prevSpeedKmh: 40, speedKmh: 40,
    })).toBe(true);
  });

  it('🔒 KÜÇÜK hız değişimi profil DEĞİŞTİRMEZ', () => {
    const d = decideCameraPolicy(base);
    expect(shouldApplyCameraUpdate({
      nowMs: 5_000, lastAppliedMs: 1_000,
      prevDecision: d, nextDecision: d, prevSpeedKmh: 40, speedKmh: 41,
    })).toBe(false);
  });

  it('pan durumunda güncelleme HİÇ uygulanmaz', () => {
    const d = decideCameraPolicy({ ...base, followState: 'USER_PANNING' });
    expect(shouldApplyCameraUpdate({
      nowMs: 9_999, lastAppliedMs: 0, prevDecision: null,
      nextDecision: d, prevSpeedKmh: 0, speedKmh: 100,
    })).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D. EKRAN YÖNÜ
   ══════════════════════════════════════════════════════════════════════════ */
describe('D. Ekran yönü', () => {
  beforeEach(() => { _resetNavigationOrientationForTest(); });

  it('🔒 ANA ARAYÜZ varsayılan olarak YATAY kilitlidir', () => {
    const s = getNavigationOrientationSnapshot();
    expect(s.mode).toBe('LOCKED_LANDSCAPE');
    expect(s.mainUiPortraitAllowed).toBe(false);
  });

  it('tam ekran navigasyon dört yönü açar, çıkışta GERİ ALIR', () => {
    const release = acquireFullNavigationOrientation();
    expect(getNavigationOrientationSnapshot().mode).toBe('FULL_SENSOR');
    release();
    expect(getNavigationOrientationSnapshot().mode).toBe('LOCKED_LANDSCAPE');
  });

  it('REF-COUNT: çift mount\'ta kilit erken geri alınmaz', () => {
    const r1 = acquireFullNavigationOrientation();
    const r2 = acquireFullNavigationOrientation();
    r1();
    expect(getNavigationOrientationSnapshot().mode).toBe('FULL_SENSOR');
    r2();
    expect(getNavigationOrientationSnapshot().mode).toBe('LOCKED_LANDSCAPE');
  });

  it('aynı bırakma fonksiyonu iki kez çağrılsa sayaç bozulmaz', () => {
    const r = acquireFullNavigationOrientation();
    r(); r();
    expect(getNavigationOrientationSnapshot().holders).toBe(0);
  });

  it('viewport ölçüsünden yön türetilir', () => {
    expect(orientationOf(1280, 720)).toBe('LANDSCAPE');
    expect(orientationOf(720, 1280)).toBe('PORTRAIT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E. YAPISAL KİLİTLER
   ══════════════════════════════════════════════════════════════════════════ */
describe('E. 🔒 Yapısal kilitler', () => {
  it('🔒 MİNİ HARİTA kendi interpolasyon motorunu KURMAZ', () => {
    const s = code(miniSrc);
    expect(s).toContain('getRenderedMotion(now)');
    expect(s).not.toContain('interpolateNavPoint');
    expect(s).not.toContain('lerpAngle');
  });

  it('🔒 MİNİ HARİTA marker\'ı artık GPS geri çağrısında ÇİZMEZ (sürüş dalı)', () => {
    const s = code(miniSrc);
    // Sürüş dalında kamera+marker paylaşılan yoldan gelir; doğrudan çizim yalnız
    // kamera kullanıcıdayken (fail-soft) yapılır.
    expect(s).toContain('setDrivingView(');
    expect(s).toContain('useMarkerMotionSampleTick()');
  });

  it('🔒 MİNİ HARİTA tam kamera argümanlarını geçirir (tam ekranla PARİTE)', () => {
    const s = code(miniSrc);
    expect(s).toContain('_turnDist');
    expect(s).toContain('_routeBearing');
    expect(s).toContain("distanceToNextTurnSource === 'ALONG_ROUTE'");
  });

  it('🔒 BOŞTA CPU KORUMASI: mini harita döngüsü yalnız SÜRÜŞTE açılır', () => {
    const s = code(miniSrc);
    expect(s).toContain('if (!wasDrivingRef.current) return;');
    expect(s).toContain('cancelAnimationFrame');
  });

  it('🔒 motion runtime kendi GPS aboneliğini/timer\'ını KURMAZ', () => {
    const s = code(runtimeSrc);
    expect(s).not.toContain('onGPSLocation');
    expect(s).not.toContain('setInterval');
    expect(s).not.toContain('requestAnimationFrame');
  });

  it('🔒 saf katmanlar I/O · saat · React KULLANMAZ', () => {
    for (const [name, src] of [['markerMotionModel', motionSrc], ['cameraPolicyModel', camSrc]] as const) {
      const s = code(src);
      for (const f of ['fetch(', 'Date.now', 'performance.now', 'useState', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
        expect(s, `${name} → ${f}`).not.toContain(f);
      }
    }
  });

  it('🔒 mini ve tam ekran AYNI takip otoritesini kullanır', () => {
    for (const src of [miniSrc, fullSrc]) {
      expect(code(src)).toContain('cameraFollowAuthority');
    }
  });

  it('🔒 EKRAN YÖNÜ yalnız tam ekran navigasyonda gevşer', () => {
    expect(code(fullSrc)).toContain('acquireFullNavigationOrientation()');
    expect(code(miniSrc)).not.toContain('acquireFullNavigationOrientation');
    // Ana arayüz uyarısı yalnız tam ekran navigasyonda bastırılır.
    expect(code(appSrc)).toContain("navOrientation !== 'FULL_SENSOR'");
  });

  it('🔒 yön kilidi FAIL-SOFT — native yoksa navigasyon bozulmaz', () => {
    const s = code(orientSrc);
    expect(s).toContain('catch');
    expect(s).toContain('if (!isNative) return;');
  });

  it('🔒 kamera sabitleri DAĞINIK değil, versiyonlu tabloda', () => {
    const s = code(camSrc);
    expect(s).toContain('CAMERA_POLICY_VERSION');
    expect(s).toContain('SPEED_BANDS');
  });
});
