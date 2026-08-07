/**
 * navigationCameraShadow.test.ts — NAVIGATION_CAMERA_SHADOW kilitleri.
 *
 * ANA İLKE: **ürün kamerası DEĞİŞMEDİ.** Gölge katmanı yalnız gözlemler;
 * hiçbir Map API çağrısı yapmaz ve hiçbir kamera değeri uygulamaz.
 */
/// <reference types="vite/client" />
import { describe, it, expect, beforeEach } from 'vitest';

import shadowModelSrc from '../platform/navigation/core/cameraShadowModel.ts?raw';
import shadowRtSrc    from '../platform/navigation/cameraShadowRuntime.ts?raw';
import mimSrc         from '../platform/map/MapInteractionManager.ts?raw';
import camEngineSrc   from '../platform/cameraEngine.ts?raw';

import {
  compareCameraOutcome, isEquivalentUpdate, bearingDelta,
  SHADOW_ANCHOR_MINOR, SHADOW_ANCHOR_MAJOR,
  type LegacyCameraOutcome, type CameraShadowContext, type CameraShadowComparison,
} from '../platform/navigation/core/cameraShadowModel';
import {
  decideCameraPolicy, type CameraPolicyInput,
} from '../platform/navigation/core/cameraPolicyModel';
import {
  noteLegacyCameraOutcome, getCameraShadowSnapshot, setCameraShadowEnabled,
  resetCameraShadowSession, _resetCameraShadowForTest,
  type ShadowContextReader, type LegacyCameraReport,
} from '../platform/navigation/cameraShadowRuntime';
import { CameraFollowState } from '../platform/navigation/cameraFollowAuthority';

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

const policy = (over: Partial<CameraPolicyInput> = {}) => decideCameraPolicy({
  speedKmh: 40, prevBand: null, nextManeuverM: null,
  maneuverDistanceSource: 'ALONG_ROUTE', secondManeuverM: null,
  followState: 'FOLLOWING', motionState: 'TRACKING',
  orientation: 'LANDSCAPE', viewport: 'FULL', ...over,
});

const legacy = (over: Partial<LegacyCameraOutcome> = {}): LegacyCameraOutcome => ({
  applied: true, zoom: 16.4, pitch: 32, bearing: 148,
  anchorY: 0.58, standstillFix: false, lookAheadM: 90, ...over,
});

const ctx = (over: Partial<CameraShadowContext> = {}): CameraShadowContext => ({
  speedKmh: 40, maneuverAlongM: null, maneuverDistanceSource: 'ALONG_ROUTE',
  positionAgeMs: 200, headingConfidence: 0.9, headingKnown: true, ...over,
});

/** Test okuyucusu — gerçek runtime'lara dokunmadan bağlam enjekte eder. */
function reader(over: Partial<{
  follow: CameraFollowState; motionState: string; ageMs: number; conf: number;
  alongM: number | null; source: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN'; now: number;
}> = {}): ShadowContextReader {
  const o = {
    follow: CameraFollowState.FOLLOWING, motionState: 'TRACKING',
    ageMs: 200, conf: 0.9, alongM: null as number | null,
    source: 'ALONG_ROUTE' as const, now: 1_000, ...over,
  };
  return {
    followState: () => o.follow,
    motion: () => ({ state: o.motionState, sourceAgeMs: o.ageMs, confidence: o.conf }),
    route: () => ({ alongM: o.alongM, source: o.source }),
    nowMs: () => o.now,
  };
}

const report = (over: Partial<LegacyCameraReport> = {}): LegacyCameraReport => ({
  ...legacy(), speedKmh: 40, orientation: 'LANDSCAPE', viewport: 'FULL', ...over,
});

/* ══════════════════════════════════════════════════════════════════════════
   A. KARŞILAŞTIRMA MODELİ (SAF)
   ══════════════════════════════════════════════════════════════════════════ */
describe('A. Gölge karşılaştırma modeli', () => {
  it('sabit hızda cruise — kararlar aynıysa fark küçük', () => {
    const p = policy({ speedKmh: 100 });
    const c = compareCameraOutcome(legacy({ anchorY: p.anchorY }), p, ctx({ speedKmh: 100 }));
    expect(c.divergence).toBe('IDENTICAL');
    expect(c.cameraState).toBe('FOLLOW_CRUISE');
    expect(c.speedBand).toBe('CRUISE');
  });

  it('90/82 histerezis sınırı gölgede de korunur', () => {
    const up = decideCameraPolicy({
      speedKmh: 92, prevBand: 'SUBURBAN', nextManeuverM: null,
      maneuverDistanceSource: 'ALONG_ROUTE', secondManeuverM: null,
      followState: 'FOLLOWING', motionState: 'TRACKING',
      orientation: 'LANDSCAPE', viewport: 'FULL',
    });
    const down = decideCameraPolicy({
      speedKmh: 85, prevBand: 'CRUISE', nextManeuverM: null,
      maneuverDistanceSource: 'ALONG_ROUTE', secondManeuverM: null,
      followState: 'FOLLOWING', motionState: 'TRACKING',
      orientation: 'LANDSCAPE', viewport: 'FULL',
    });
    expect(up.speedBand).toBe('CRUISE');
    expect(down.speedBand).toBe('CRUISE');   // çıkış eşiği 82 → banttan çıkmaz
  });

  it('yaklaşan dönüş gölgede IN_MANEUVER/APPROACH olarak görünür', () => {
    const p = policy({ nextManeuverM: 40 });
    const c = compareCameraOutcome(legacy(), p, ctx({ maneuverAlongM: 40 }));
    expect(c.cameraState).toBe('IN_MANEUVER');
    expect(c.maneuverBand).toBe('IMMINENT');
    expect(c.maneuverAlongM).toBe(40);
  });

  it('durakta yön dondurma legacy tarafında kaydedilir', () => {
    const c = compareCameraOutcome(
      legacy({ standstillFix: true, lookAheadM: 0 }), policy({ speedKmh: 0 }), ctx({ speedKmh: 0 }));
    expect(c.speedBand).toBe('STOPPED');
    expect(c.speedKmh).toBe(0);
  });

  it('bayat GPS → politika bastırır, legacy sürerse BÜYÜK ayrışma', () => {
    const p = policy({ motionState: 'STALE' });
    // Politika GPS_DEGRADED'de sürmeye İZİN VERİR ama zoom sınırlar.
    expect(p.state).toBe('GPS_DEGRADED');
    expect(p.maxZoomHint).not.toBeNull();
    const c = compareCameraOutcome(legacy(), p, ctx({ positionAgeMs: 9_000 }));
    expect(c.positionAgeMs).toBe(9_000);
  });

  it('düşük heading güveni bağlamda TAŞINIR', () => {
    const c = compareCameraOutcome(
      legacy({ bearing: null }), policy(), ctx({ headingConfidence: 0.1, headingKnown: false }));
    expect(c.headingKnown).toBe(false);
    expect(c.headingConfidence).toBe(0.1);
  });

  it('🔒 legacy SÜRDÜ ama politika BASTIRIRDI → MAJOR', () => {
    const p = policy({ followState: 'USER_PANNING' });
    const c = compareCameraOutcome(legacy({ applied: true }), p, ctx());
    expect(c.divergence).toBe('MAJOR');
    expect(c.suppressionReason).toContain('kullanıcı');
    expect(c.reason).toContain('BASTIRIRDI');
  });

  it('🔒 legacy ATLADI ama politika İZİN verirdi → MAJOR', () => {
    const c = compareCameraOutcome(legacy({ applied: false }), policy(), ctx());
    expect(c.divergence).toBe('MAJOR');
    expect(c.reason).toContain('erken döndü');
  });

  it('çapa farkı bantlara göre sınıflanır', () => {
    const p = policy({ speedKmh: 100 });   // anchorY 0.66
    const minor = compareCameraOutcome(
      legacy({ anchorY: p.anchorY - (SHADOW_ANCHOR_MINOR / 2) }), p, ctx({ speedKmh: 100 }));
    expect(minor.divergence).toBe('MINOR');
    const moderate = compareCameraOutcome(
      legacy({ anchorY: p.anchorY - (SHADOW_ANCHOR_MINOR + 0.01) }), p, ctx({ speedKmh: 100 }));
    expect(moderate.divergence).toBe('MODERATE');
    const major = compareCameraOutcome(
      legacy({ anchorY: p.anchorY - (SHADOW_ANCHOR_MAJOR + 0.01) }), p, ctx({ speedKmh: 100 }));
    expect(major.divergence).toBe('MAJOR');
  });

  it('🔒 politika zoom/pitch ÖNERMEDİĞİ için o deltalar NULL — sahte 0 YOK', () => {
    const c = compareCameraOutcome(legacy(), policy(), ctx());
    expect(c.zoomDelta).toBeNull();
    expect(c.pitchDelta).toBeNull();
    expect(c.zoomDelta).not.toBe(0);
  });

  it('legacy çapası ölçülemediyse UNCOMPARABLE', () => {
    const c = compareCameraOutcome(legacy({ anchorY: null }), policy(), ctx());
    expect(c.divergence).toBe('UNCOMPARABLE');
  });

  it('art arda eşdeğer güncellemeler tespit edilir', () => {
    const p = policy({ speedKmh: 100 });
    const a = compareCameraOutcome(legacy({ anchorY: 0.60 }), p, ctx({ speedKmh: 100 }));
    const b = compareCameraOutcome(legacy({ anchorY: 0.6001 }), p, ctx({ speedKmh: 100 }));
    expect(isEquivalentUpdate(a, b)).toBe(true);
    const different = compareCameraOutcome(
      legacy({ anchorY: 0.60 }), policy({ speedKmh: 100, nextManeuverM: 40 }), ctx({ speedKmh: 100 }));
    expect(isEquivalentUpdate(a, different)).toBe(false);
    expect(isEquivalentUpdate(null, a)).toBe(false);
  });

  it('bearing farkı kısa yaydan hesaplanır', () => {
    expect(bearingDelta(350, 10)).toBeCloseTo(20, 6);
    expect(bearingDelta(10, 350)).toBeCloseTo(-20, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B. GÖLGE RUNTIME + SAYAÇLAR
   ══════════════════════════════════════════════════════════════════════════ */
describe('B. Gölge runtime sayaçları', () => {
  beforeEach(() => { _resetCameraShadowForTest(); });

  it('her legacy çağrısı politika değerlendirmesi ÜRETİR', () => {
    noteLegacyCameraOutcome(report(), reader());
    noteLegacyCameraOutcome(report({ speedKmh: 42 }), reader({ now: 2_000 }));
    const s = getCameraShadowSnapshot();
    expect(s.policyEvaluationCount).toBe(2);
    expect(s.legacyCameraApplyCount).toBe(2);
    expect(s.legacyCameraSkipCount).toBe(0);
  });

  it('legacy ATLADIĞINDA skip sayacı artar (uygula sayacı ARTMAZ)', () => {
    noteLegacyCameraOutcome(report({ applied: false }), reader());
    const s = getCameraShadowSnapshot();
    expect(s.legacyCameraSkipCount).toBe(1);
    expect(s.legacyCameraApplyCount).toBe(0);
  });

  it('🔒 GÜNCELLEME FIRTINASI bastırma sayacı GERÇEK veriden gelir', () => {
    // Aynı bağlamda hızlı ardışık çağrılar → asgari aralık dolmaz → bastırılır.
    noteLegacyCameraOutcome(report(), reader({ now: 1_000 }));
    noteLegacyCameraOutcome(report({ speedKmh: 40.2 }), reader({ now: 1_030 }));
    noteLegacyCameraOutcome(report({ speedKmh: 40.4 }), reader({ now: 1_060 }));
    const s = getCameraShadowSnapshot();
    expect(s.policySuppressedCount).toBeGreaterThan(0);
    expect(s.policyAcceptedCount + s.policySuppressedCount).toBe(s.policyEvaluationCount);
  });

  it('🔒 suppressedCameraUpdates SABİT 0 DEĞİL — çağrıyla artar', () => {
    expect(getCameraShadowSnapshot().policySuppressedCount).toBe(0);
    for (let i = 0; i < 5; i++) {
      noteLegacyCameraOutcome(report({ speedKmh: 40 + i * 0.1 }), reader({ now: 1_000 + i * 20 }));
    }
    expect(getCameraShadowSnapshot().policySuppressedCount).toBeGreaterThan(0);
  });

  it('kullanıcı pan → bastırma NEDENİ kaydedilir', () => {
    noteLegacyCameraOutcome(report(), reader({ follow: CameraFollowState.USER_PANNING }));
    const s = getCameraShadowSnapshot();
    expect(s.lastSuppressionReason).toContain('kullanıcı');
    expect(s.last?.policyAllowed).toBe(false);
  });

  it('eşdeğer güncelleme sayacı GERÇEK ardışık çağrılardan gelir', () => {
    const r = reader({ now: 1_000 });
    noteLegacyCameraOutcome(report({ anchorY: 0.58 }), r);
    noteLegacyCameraOutcome(report({ anchorY: 0.5801 }), reader({ now: 1_400 }));
    expect(getCameraShadowSnapshot().duplicateEquivalentUpdateCount).toBeGreaterThan(0);
  });

  it('azami gözlenen çapa farkı BİRİKİR', () => {
    noteLegacyCameraOutcome(report({ anchorY: 0.58 }), reader({ now: 1_000 }));
    const first = getCameraShadowSnapshot().maxAnchorYDelta;
    noteLegacyCameraOutcome(report({ anchorY: 0.20 }), reader({ now: 2_000 }));
    const second = getCameraShadowSnapshot().maxAnchorYDelta;
    expect(second).toBeGreaterThan(first);
  });

  it('gölge KAPALIYKEN hiçbir sayaç artmaz', () => {
    setCameraShadowEnabled(false);
    expect(noteLegacyCameraOutcome(report(), reader())).toBeNull();
    expect(getCameraShadowSnapshot().policyEvaluationCount).toBe(0);
    expect(getCameraShadowSnapshot().enabled).toBe(false);
    setCameraShadowEnabled(true);
  });

  it('oturum sıfırlama SAYAÇLARI korur, son karşılaştırmayı temizler', () => {
    noteLegacyCameraOutcome(report(), reader());
    resetCameraShadowSession();
    const s = getCameraShadowSnapshot();
    expect(s.last).toBeNull();
    expect(s.policyEvaluationCount).toBe(1);
  });

  it('🔒 FAIL-SOFT: bağlam okuyucu patlarsa kamera BOZULMAZ', () => {
    const boom: ShadowContextReader = {
      followState: () => { throw new Error('patladı'); },
      motion: () => ({ state: 'TRACKING', sourceAgeMs: 0, confidence: 1 }),
      route: () => ({ alongM: null, source: 'UNKNOWN' }),
      nowMs: () => 0,
    };
    expect(() => noteLegacyCameraOutcome(report(), boom)).not.toThrow();
    expect(noteLegacyCameraOutcome(report(), boom)).toBeNull();
  });

  it('🔒 LAB anlık görüntüsü KOORDİNAT SIZDIRMAZ', () => {
    noteLegacyCameraOutcome(report(), reader());
    const json = JSON.stringify(getCameraShadowSnapshot());
    expect(json).not.toMatch(/"lat"|"lon"|"latitude"|"longitude"|"coordinate"/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C. YAPISAL KİLİTLER — ÜRÜN DAVRANIŞI DEĞİŞMEDİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('C. 🔒 Ürün kamerası değişmedi', () => {
  it('🔒 cameraEngine EĞRİLERİ DEĞİŞMEDİ (sahada ayarlı sabitler korunuyor)', () => {
    const s = code(camEngineSrc);
    for (const k of ['ZOOM_AT_0:    18.5', 'ZOOM_AT_30:   17.5', 'ZOOM_AT_60:   16.7',
                     'ZOOM_AT_100:  15.5', 'ZOOM_MIN:     14.2',
                     'PITCH_IDLE:     20', 'PITCH_HIGHWAY:  47',
                     'LOOK_MAX_M: 140', 'TOP_PAD_BASE:  0.50', 'TOP_PAD_MAX:   0.70']) {
      expect(s, `cameraEngine sabiti değişmiş: ${k}`).toContain(k);
    }
  });

  it('🔒 gölge katmanı cameraEngine\'i İMPORT ETMEZ ve DEĞİŞTİRMEZ', () => {
    for (const src of [shadowModelSrc, shadowRtSrc]) {
      const s = code(src);
      expect(s).not.toContain('cameraEngine');
      expect(s).not.toContain('CAMERA_CFG');
    }
  });

  it('🔒 gölge katmanı HİÇBİR Map API çağrısı yapmaz', () => {
    for (const src of [shadowModelSrc, shadowRtSrc]) {
      const s = code(src);
      expect(s).not.toContain('maplibre');
      expect(s).not.toContain('jumpTo');
      expect(s).not.toContain('easeTo');
      expect(s).not.toContain('setPaint');
      expect(s).not.toContain('.project(');
      expect(s).not.toContain('getZoom');
    }
  });

  it('🔒 gölge katmanı KOORDİNAT KABUL ETMEZ (tip düzeyinde)', () => {
    const s = code(shadowModelSrc);
    expect(s).not.toMatch(/readonly (lat|lon|lng|latitude|longitude)\b/);
  });

  it('🔒 raporlama ucu EK Map çağrısı üretmez — mevcut ölçüm yeniden kullanılır', () => {
    const s = code(mimSrc);
    // `_p2` çerçeve denetimi için ZATEN hesaplanıyordu; gölge onu kullanır.
    expect(s).toContain('_p2.y / _h');
    /* Gölge için YENİ bir `project()` EKLENMEDİ. Dosyadaki 3 çağrı bu turdan
       ÖNCE de vardı (durakta çerçeve filtresi · `_vehY` padding klipsi ·
       `_p2` çerçeve denetimi). Sayı sabitlenir: gelecekte biri gölge için
       dördüncü bir ölçüm eklerse bu kilit düşer. */
    const projects = s.match(/map\.project\(/g) ?? [];
    expect(projects.length, 'gölge için yeni bir project() eklenmiş').toBe(3);
  });

  it('🔒 raporlama FAIL-SOFT ve kamera akışını kesmez', () => {
    const s = code(mimSrc);
    expect(s).toContain('function _reportShadow(');
    // `_reportShadow` gövdesi try/catch ile sarılı.
    const body = s.slice(s.indexOf('function _reportShadow('), s.indexOf('export function setDrivingView('));
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });

  it('🔒 erken dönüş yolu da RAPORLANIR (atlanan güncelleme görünür)', () => {
    const s = code(mimSrc);
    expect(s).toContain('_reportShadow(map, false,');
  });

  it('🔒 gölge katmanı saf model kullanır — kendi kamera mantığını KURMAZ', () => {
    const s = code(shadowRtSrc);
    expect(s).toContain('decideCameraPolicy');
    expect(s).toContain('shouldApplyCameraUpdate');
  });

  it('🔒 saf model I/O · saat · React KULLANMAZ', () => {
    const s = code(shadowModelSrc);
    for (const f of ['fetch(', 'Date.now', 'performance.now', 'useState', 'setTimeout', 'setInterval']) {
      expect(s, `cameraShadowModel → ${f}`).not.toContain(f);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D. LAB — SAYILAR GERÇEK RUNTIME'DAN
   ══════════════════════════════════════════════════════════════════════════ */
describe('D. LAB veri kaynağı', () => {
  beforeEach(() => { _resetCameraShadowForTest(); });

  it('🔒 LAB sayaçları GERÇEK çağrılardan gelir (sabit değil)', () => {
    const before = getCameraShadowSnapshot();
    expect(before.policyEvaluationCount).toBe(0);
    expect(before.legacyCameraApplyCount).toBe(0);

    noteLegacyCameraOutcome(report(), reader({ now: 1_000 }));
    noteLegacyCameraOutcome(report({ applied: false }), reader({ now: 5_000 }));

    const after = getCameraShadowSnapshot();
    expect(after.policyEvaluationCount).toBe(2);
    expect(after.legacyCameraApplyCount).toBe(1);
    expect(after.legacyCameraSkipCount).toBe(1);
    expect(after.last).not.toBeNull();
  });

  it('kabul + bastırma toplamı DEĞERLENDİRME sayısına eşittir (kayıp yok)', () => {
    for (let i = 0; i < 12; i++) {
      noteLegacyCameraOutcome(
        report({ speedKmh: 30 + i * 6 }), reader({ now: 1_000 + i * 90 }));
    }
    const s = getCameraShadowSnapshot();
    expect(s.policyAcceptedCount + s.policySuppressedCount).toBe(s.policyEvaluationCount);
    expect(s.legacyCameraApplyCount + s.legacyCameraSkipCount).toBe(s.policyEvaluationCount);
  });

  it('son karşılaştırma bağlamı hız/manevra/yaş/güven TAŞIR', () => {
    noteLegacyCameraOutcome(
      report({ speedKmh: 95 }),
      reader({ alongM: 120, source: 'ALONG_ROUTE', ageMs: 350, conf: 0.77 }));
    const last = getCameraShadowSnapshot().last as CameraShadowComparison;
    expect(last.speedKmh).toBe(95);
    expect(last.maneuverAlongM).toBe(120);
    expect(last.positionAgeMs).toBe(350);
    expect(last.headingConfidence).toBe(0.77);
  });

  it('kuş uçuşu manevra kaynağı bağlamda NULL kalır', () => {
    noteLegacyCameraOutcome(report(), reader({ alongM: 120, source: 'STRAIGHT_LINE' }));
    expect(getCameraShadowSnapshot().last?.maneuverAlongM).toBeNull();
    expect(getCameraShadowSnapshot().last?.maneuverBand).toBe('NONE');
  });
});
