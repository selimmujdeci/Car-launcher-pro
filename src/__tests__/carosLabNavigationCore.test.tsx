/**
 * carosLabNavigationCore.test.tsx — CAROS LAB · Navigation Core KİLİTLERİ.
 *
 * YAKLAŞIM (A3–A8 turlarıyla aynı): model TAMAMEN SAF → gerçek davranış servis
 * mock'u olmadan doğrulanır; ekran kilidi `renderToStaticMarkup` ile alınır.
 *
 * ANA İLKE: bu ekran YENİ OTORİTE DEĞİLDİR ve NAVİGASYONA DOKUNMAZ.
 * Kilitlerin çoğu iki soruyu sorar: (1) uydurdu mu? (2) sızdırdı mı?
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildNavigationCoreCards, deriveNavCoreVerdict, countByNavCoreClass,
  NAV_CORE_VERDICT_LABEL, MAP_MATCH_STATE_LABEL, MANEUVER_SOURCE_LABEL,
} from '../platform/devtools/navigationCoreModel';
import type { NavigationCoreRawSnapshot } from '../platform/devtools/navigationCoreSources';
import { NavigationCoreScreen } from '../components/devtools/screens/NavigationCoreScreen';
import { getCarosLabTool, CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const NOW = 1_700_000_000_000;

function snap(over: Partial<NavigationCoreRawSnapshot> = {}): NavigationCoreRawSnapshot {
  return {
    readAt: NOW,
    navStatus: 'ACTIVE', isNavigating: true, isRerouting: false,
    hasDestination: true, remainingDistanceM: 4200, etaSeconds: 380,

    provider: {
      localState: 'LOCAL_OSRM_UNAVAILABLE', localProbedAtMs: NOW - 5_000,
      localProbeCount: 1, localSkippedCount: 7,
      lastSource: 'REMOTE_OSRM', lastProviderLabel: 'routing.openstreetmap.de',
      straightLineCount: 0, remoteFailureCount: 0,
    },
    offlineGraph: { state: 'GRAPH_MISSING', attemptCount: 1, lastAttemptAt: NOW - 9_000, usable: false },
    onlineHint: true, serverUsed: 'routing.openstreetmap.de',
    routeError: null, routeLoading: false, straightLineActive: false,

    hasRawFix: true, fixAgeMs: 400,
    mapMatchState: 'MATCHED', mapMatchConfidence: 0.82, mapMatchSegIdx: 12,
    lateralM: 6.4, headingDeltaDeg: 8, alongRemainingM: 4180,
    hasSnappedPosition: true, matchReasons: [], corridorM: 61,

    offRouteState: 'ON_ROUTE', offRouteEvidence: 0, offRouteRequired: 3,
    offRouteRequiredMs: 1500, offRouteConfirmedAtMs: null, offRouteReasons: ['ON_CORRIDOR'],

    geometryPoints: 640, stepCount: 14, currentStepIndex: 3,
    nextManeuverDistanceM: 312, nextManeuverDistanceSource: 'ALONG_ROUTE',
    totalRouteDistanceM: 9800,
    anchorResolvedCount: 14, anchorUnresolvedCount: 0,
    anchorMethodCounts: { CONCATENATION: 14, NEAREST: 0, UNRESOLVED: 0 },

    validationVerdict: 'VALID',
    validationChecks: [
      { id: 'ORIGIN_PROXIMITY', status: 'PASS', detail: '4 m' },
      { id: 'ROAD_CLASS_MIX', status: 'UNKNOWN', detail: 'yol sınıfı kanıtı yok' },
    ],

    requests: {
      currentId: 3,
      current: { id: 3, kind: 'REROUTE', startedAtMs: 1000, respondedAtMs: 1700,
                 committedAtMs: 1800, outcome: 'COMMITTED', provider: 'osrm' },
      history: [], committedCount: 3, staleRejectedCount: 1,
      invalidRejectedCount: 0, supersededCount: 1, failedCount: 0,
      suppressedDuplicateCount: 2,
      latency: { offRouteDetectedAtMs: 800, requestStartedAtMs: 1000,
                 responseReceivedAtMs: 1700, routeCommittedAtMs: 1800,
                 firstNewInstructionAtMs: 2100, detectToCommitMs: 1000,
                 detectToFirstInstructionMs: 1300, requestToResponseMs: 700 },
      lastCompletedLatency: { offRouteDetectedAtMs: null, requestStartedAtMs: null,
                 responseReceivedAtMs: null, routeCommittedAtMs: null,
                 firstNewInstructionAtMs: null, detectToCommitMs: null,
                 detectToFirstInstructionMs: null, requestToResponseMs: null },
    },
    fetchInFlight: false,

    stepsWithRealLanes: 0, roundaboutStepCount: 2, roundaboutWithExitCount: 1,
    sessionId: 3, hasRouteClaim: true,
    miniMapStyle: 'road/raster', mapTheme: 'night', mapContrastProfile: 'NIGHT_READABLE',
    camera: {
      cameraMode: 'FOLLOWING', isVehicleCentered: true, lastUserPanAgeMs: 4200,
      recenterAvailable: false, lastRecenterAgeMs: 900, recenterReason: 'USER_BUTTON',
      followZoom: 16.5, autoRecenterPending: false, autoRecenterDelayMs: 3000, listenerCount: 2,
    },
    speedLimit: {
      state: 'AVAILABLE', kmh: 50, source: 'osm', ageMs: 12000,
      distanceFromFixM: 40, confidence: 0.8, reason: 'yolun maxspeed etiketi',
    },
    /* Araç sınıfı + uygulanabilir sınır (VEHICLE_AWARE_SPEED_LIMIT_P0) —
       DOLU anlık görüntü: her alanın gerçek bir kaynağı vardır. */
    vehicleClass: {
      key: 'mmy:FIAT|DOBLO|2016',
      profile: {
        make: 'Fiat', model: 'Doblo', modelYear: 2016, vinMasked: 'ZFA…56',
        legalVehicleCategory: 'N1', registrationBodyType: 'PICKUP',
        source: 'USER_CONFIRMED', confidence: 0.95,
        verifiedAt: 1_700_000_000_000, expiresAt: null,
        sourceRefs: [{ url: 'https://example.org/a', title: 'Tip onayı', retrievedAt: 1_700_000_000_000 }],
        resolutionState: 'VERIFIED', candidates: [], reason: 'kullanıcı ruhsat beyanı',
      },
      researchOutcome: 'RESOLVED',
      researchAttemptedAt: 1_700_000_000_000,
      researchFailureReason: 'sağlayıcı yapılandırılmadı',
      promptDismissedAt: null,
      vinMasked: 'ZFA…56', hasVin: true,
    },
    vehicleKeyMasked: 'mmy:FIAT|DOBLO|2016',
    roadClassVerdict: {
      roadClass: 'URBAN', confidence: 0.85, motorwayOperatorKnown: false,
      reason: 'okunan levha 50 km/sa',
    },
    effectiveLimit: {
      roadLimitKmh: 50, vehicleClassCapKmh: 50, effectiveLimitKmh: 50,
      effectiveLimitReason: 'ROAD_POSTED', state: 'AVAILABLE', confidence: 0.7,
      sourceAgeMs: 12000, roadClass: 'URBAN', sourceLabel: 'YOL SINIRI',
      reason: 'yol sınırı araç tavanının altında — yol sınırı uygulandı',
      policyCountry: 'TR', policyVersion: 'TR-2022.07.01',
      policyEffectiveFrom: '2022-07-01', policySourceAuthority: 'KGM · md.100',
    },
    policyCountry: 'TR', policyVersion: 'TR-2022.07.01',
    policyEffectiveFrom: '2022-07-01', policySourceAuthority: 'KGM · md.100',
    offlineCacheState: 'CACHED',
    voice: {
      state: 'ACTIVE', owner: 'NAV_SESSION_RUNTIME',
      lastSpokenManeuverId: '3:2:1', lastSpokenStage: 'NEAR',
      spokenCount: 4, duplicateSuppressed: 2, trackedManeuvers: 3, routeKey: '3:2',
    },
    routeDurationSource: 'OSRM_ANNOTATION',
    durationIntegrityState: 'VALID',
    totalRouteDurationSeconds: 1800,
    remainingRouteDurationSeconds: 640,
    routeRevision: 2,
    durationRevision: 2,
    eta: {
      etaSeconds: 690, state: 'ROUTE_MODEL', source: 'OSRM_ANNOTATION',
      correctionFactor: 1.08, baseSeconds: 640,
      reason: 'gözlenen 55 km/sa · model 60 km/sa',
    },
    markerMotion: {
      state: 'INTERPOLATING', interpolationProgress: 0.42, sourceAgeMs: 210,
      confidence: 0.9, rawPositionMasked: 'VAR ±8 m', renderedPositionMasked: 'VAR',
      sampleCount: 120, snapCorrectionCount: 1, duplicateMotionRuntimeCount: 0,
      reason: 'iki fix arası ara değer',
    },
    cameraPolicy: {
      state: 'FOLLOW_CRUISE', profileId: 'CRUISE', policyVersion: 'CAM-2026.08.05',
      speedBand: 'CRUISE', maneuverBand: 'NONE', anchorY: 0.66, anchorX: 0.5,
      cameraDriveAllowed: true, applyManeuverCamera: false, maxZoomHint: null,
      updateReason: 'seyir profili (CRUISE) — ön yol bağlamı',
    },
    cameraPolicyVersion: 'CAM-2026.08.05',
    mapZoom: 15.8, mapPitch: 42, mapBearing: 148,
    orientation: 'LANDSCAPE', orientationMode: 'LOCKED_LANDSCAPE',
    suppressedCameraUpdates: 244,
    cameraShadow: {
      enabled: true, policyVersion: 'CAM-2026.08.05',
      policyEvaluationCount: 340, policyAcceptedCount: 96, policySuppressedCount: 244,
      legacyCameraApplyCount: 288, legacyCameraSkipCount: 52,
      duplicateEquivalentUpdateCount: 173,
      lastSuppressionReason: 'kullanıcı haritayı sürüklüyor — kamera sürülmez',
      maxAnchorYDelta: 0.072, maxZoomDelta: 0, maxPitchDelta: 0,
      last: {
        divergence: 'MINOR', zoomDelta: null, pitchDelta: null, bearingDelta: null,
        anchorYDelta: -0.021, legacyApplied: true, policyAllowed: true,
        cameraState: 'FOLLOW_CRUISE', speedBand: 'CRUISE', maneuverBand: 'NONE',
        speedKmh: 98, maneuverAlongM: 1240, positionAgeMs: 240,
        headingConfidence: 0.93, headingKnown: true, suppressionReason: null,
        reason: 'çapa farkı 0.021 — bant içi',
      },
    },
    /* Kamera SÖNÜMLEME KADANSI — alfalar 150 ms'lik tempoda ayarlandı;
       sapma doğrudan "kamera hissi" sapmasıdır (bkz. cameraEngine). */
    cameraDamping: {
      calibrationDtMs: 150, lastDtMs: 152, tickCount: 288, offCadenceTicks: 0,
      effectivePitchTauSec: 1.30, calibrationPitchTauSec: 1.29,
      cruiseMs: 1050, inCruise: true,
    },
    /* Rota RENK kararı — tek hakem (`map/core/routeColorModel`). */
    routeColor: {
      policyVersion: 'RC-2026.08.07',
      decision: {
        casing: '#f59e0b', glow: '#f59e0b', coreMode: 'EMPHASIS', coreOpacity: 1,
        reason: 'HAZARD', routeColorKey: 'HAZARD|dark|RC-2026.08.07',
        policyVersion: 'RC-2026.08.07',
      },
      input: { maneuverTier: 1, hazardHigh: true, lightBasemap: false },
    },
    runtime: {
      running: true, tickCount: 42, lastTickAgeMs: 900, lastObservedStatus: 'ACTIVE',
      skippedNoFix: 1, skippedInactive: 5, errorCount: 0, lastErrorAgeMs: null,
      uptimeMs: 60_000,
      drState: 'GPS_FRESH', drOwner: 'NAV_SESSION_RUNTIME', drTickCount: 7,
      drDistanceMeters: 42, drConfidence: 1, drTimerRunning: true,
      /* DR projeksiyon ekseni (#451) — dolu anlik goruntude olculmus degerler. */
      drProjectionMode: 'ALONG_ROUTE', drConsumedRouteM: 118, drProjectionSegIdx: 14,
    },
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 1 — Katalog ve ekran eşlemesi
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 1 — Navigation Core kataloğa kayıtlı ve gerçek ekrana gidiyor', () => {
  it('katalogda AVAILABLE olarak kayıtlı', () => {
    const t = getCarosLabTool('navigation-core');
    expect(t).toBeDefined();
    expect(t!.status).toBe('AVAILABLE');
    expect(t!.category).toBe('vehicle');
  });

  it('AVAILABLE kart gerçek bir ekrana çözülür (bilgi ekranına DÜŞMEZ)', () => {
    expect(renderAvailableTool('navigation-core')).not.toBeNull();
  });

  it('katalog notu "hiçbir şey başlatmaz" ve gizlilik sınırını AÇIKÇA yazar', () => {
    const t = getCarosLabTool('navigation-core')!;
    expect(t.note).toContain('BAŞLATMAZ');
    expect(t.note).toMatch(/ENLEM\/BOYLAM GÖSTERİLMEZ/);
    // Belirsiz ifade yasağı (katalog genel kuralı)
    expect(t.desc.toLowerCase()).not.toContain('yakında');
  });

  it('araç id\'leri benzersiz kalır (yeni giriş çakışma yaratmadı)', () => {
    const ids = CAROS_LAB_TOOLS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 2 — SALT OKUNUR: hiçbir komut/başlatma yüzeyi yok
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 2 — ekran navigasyona DOKUNMAZ', () => {
  const screenSrc = read('src/components/devtools/screens/NavigationCoreScreen.tsx');
  const srcSrc    = read('src/platform/devtools/navigationCoreSources.ts');

  it('ekran navigasyon başlatma/durdurma/rota isteği ÇAĞIRMAZ', () => {
    for (const forbidden of [
      'fetchRoute', 'startNavigation', 'stopNavigation', 'activateNavigation',
      'setRerouteContext', 'clearRoute', 'selectAltRoute', 'writeActiveRoute',
    ]) {
      expect(screenSrc, `ekran ${forbidden} çağırıyor — SALT OKUNUR ihlali`)
        .not.toContain(forbidden);
      expect(srcSrc, `okuma katmanı ${forbidden} çağırıyor — SALT OKUNUR ihlali`)
        .not.toContain(forbidden);
    }
  });

  it('TIMER / POLLING / ABONELİK YOK (repo LAB deseni)', () => {
    for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', '.subscribe(']) {
      expect(screenSrc, `ekranda ${banned} var`).not.toContain(banned);
      expect(srcSrc, `okuma katmanında ${banned} var`).not.toContain(banned);
    }
  });

  it('okuma katmanı ağ çağrısı YAPMAZ', () => {
    expect(srcSrc).not.toContain('fetch(');
    expect(srcSrc).not.toContain('XMLHttpRequest');
  });

  it('unmount sonrası setState koruması vardır (zero-leak)', () => {
    expect(screenSrc).toContain('mountedRef');
    expect(screenSrc).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 3 — GİZLİLİK: koordinat sızmaz
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 3 — enlem/boylam ve hedef adı bu ekrana GELMEZ', () => {
  it('ham anlık görüntü sözleşmesinde koordinat alanı YOK', () => {
    const s = snap();
    const keys = Object.keys(s);
    for (const k of keys) {
      expect(k, `snapshot alanı "${k}" koordinat taşıyor olabilir`)
        .not.toMatch(/^(lat|lon|latitude|longitude|snappedLat|snappedLon|rawLat|rawLon)$/);
    }
    // Konum yalnız VAR/YOK + yaş + dik mesafe olarak taşınır
    expect(typeof s.hasRawFix).toBe('boolean');
    expect(typeof s.hasSnappedPosition).toBe('boolean');
  });

  it('okuma katmanı fix\'in koordinatlarını OKUMAZ', () => {
    const srcSrc = read('src/platform/devtools/navigationCoreSources.ts');
    expect(srcSrc).not.toMatch(/fix\.(rawLat|rawLon|snappedLat|snappedLon)\s*[,;)]/);
    // hedef adı da taşınmaz — yalnız varlık
    expect(srcSrc).toContain('hasDestination');
    expect(srcSrc).not.toMatch(/destination\.name/);
  });

  it('render edilen çıktıda koordinat benzeri değer yok', () => {
    const html = renderToStaticMarkup(<NavigationCoreScreen />);
    // 36.8012 / 34.6105 gibi 4+ ondalıklı derece değerleri
    expect(html).not.toMatch(/\b\d{2}\.\d{4,}\b/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 4 — DÜRÜSTLÜK: bilinmeyen UNAVAILABLE, sahte 0 yok
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 4 — kanıtsız bilgi üretilmez', () => {
  it('hiç konum örneği yokken eşleştirme alanı UNAVAILABLE (sahte "eşleşti" yok)', () => {
    const cards = buildNavigationCoreCards(snap({ mapMatchState: null }));
    const mm = cards.find(c => c.id === 'matching')!;
    expect(mm.fields[0].klass).toBe('UNAVAILABLE');
  });

  it('konum bilinmiyorsa manevra mesafesi UYDURULMAZ', () => {
    const cards = buildNavigationCoreCards(snap({
      nextManeuverDistanceSource: 'UNKNOWN', nextManeuverDistanceM: 0,
    }));
    const mv = cards.find(c => c.id === 'maneuver')!;
    const dist = mv.fields.find(f => f.id === 'mv-dist')!;
    expect(dist.klass).toBe('UNAVAILABLE');
    expect(dist.value).not.toBe('0 m');
  });

  it('reroute hiç ölçülmediyse gecikme alanları UNAVAILABLE (sahte 0 ms yok)', () => {
    const empty = { offRouteDetectedAtMs: null, requestStartedAtMs: null,
      responseReceivedAtMs: null, routeCommittedAtMs: null, firstNewInstructionAtMs: null,
      detectToCommitMs: null, detectToFirstInstructionMs: null, requestToResponseMs: null };
    const cards = buildNavigationCoreCards(snap({
      requests: { ...snap().requests, latency: empty, lastCompletedLatency: empty },
    }));
    const rr = cards.find(c => c.id === 'reroute')!;
    for (const id of ['rq-lat-net', 'rq-lat-commit', 'rq-lat-instr']) {
      expect(rr.fields.find(f => f.id === id)!.klass).toBe('UNAVAILABLE');
    }
  });

  it('düz hat aktifken rota hükmü ÜRETİLMEZ ("geçerli rota" denmez)', () => {
    const cards = buildNavigationCoreCards(snap({
      straightLineActive: true, validationVerdict: null, validationChecks: [],
    }));
    const v = cards.find(c => c.id === 'validation')!;
    expect(v.fields[0].klass).toBe('UNAVAILABLE');
    expect(v.fields[0].note).toContain('rota adayı DEĞİLDİR');
  });

  it('yol sınıfı kanıtı yoksa denetim UNAVAILABLE sınıfında gösterilir', () => {
    const cards = buildNavigationCoreCards(snap());
    const v = cards.find(c => c.id === 'validation')!;
    expect(v.fields.find(f => f.id === 'rv-ROAD_CLASS_MIX')!.klass).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 5 — HÜKÜM fail-closed
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 5 — hüküm kanıta dayanır', () => {
  it('navigasyon yokken IDLE', () => {
    expect(deriveNavCoreVerdict(snap({ isNavigating: false })).status).toBe('IDLE');
  });

  it('düz hat aktifken "GERÇEK ROTA YOK" hükmü verilir', () => {
    const v = deriveNavCoreVerdict(snap({ straightLineActive: true }));
    expect(v.status).toBe('STRAIGHT_LINE_ONLY');
    expect(NAV_CORE_VERDICT_LABEL[v.status]).toContain('GERÇEK ROTA YOK');
  });

  it('eşleşti + yol-boyu mesafe → İZLENİYOR', () => {
    expect(deriveNavCoreVerdict(snap()).status).toBe('TRACKING');
  });

  it('kuş uçuşu mesafeye düşülmüşse izleme KUSURLU sayılır', () => {
    const v = deriveNavCoreVerdict(snap({ nextManeuverDistanceSource: 'STRAIGHT_LINE' }));
    expect(v.status).toBe('DEGRADED_TRACKING');
    expect(v.reasons.join(' ')).toContain(MANEUVER_SOURCE_LABEL.STRAIGHT_LINE);
  });

  it('eşleşme belirsizse "izleniyor" DENMEZ', () => {
    const v = deriveNavCoreVerdict(snap({ mapMatchState: 'MATCH_UNCERTAIN' }));
    expect(v.status).toBe('DEGRADED_TRACKING');
    expect(v.reasons.join(' ')).toContain(MAP_MATCH_STATE_LABEL.MATCH_UNCERTAIN);
  });

  it('hiç örnek işlenmediyse GÖZLEM YOK', () => {
    expect(deriveNavCoreVerdict(snap({ mapMatchState: null })).status).toBe('UNAVAILABLE');
  });

  it('sapma doğrulanıp istek uçuştaysa YENİDEN ROTA', () => {
    expect(deriveNavCoreVerdict(snap({ offRouteState: 'REROUTING' })).status).toBe('REROUTING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 6 — ŞERİT DÜRÜSTLÜĞÜ ekranda görünür
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 6 — şerit ve dönel kavşak dürüstlük sayaçları', () => {
  it('gerçek şerit verisi olan adım sayısı gösterilir', () => {
    const cards = buildNavigationCoreCards(snap());
    const t = cards.find(c => c.id === 'truth')!;
    const lanes = t.fields.find(f => f.id === 'tr-lanes')!;
    expect(lanes.value).toBe('0 / 14');
    expect(lanes.note).toContain('TÜRETİLMEZ');
  });

  it('dönel kavşak çıkış numarası oranı gösterilir', () => {
    const cards = buildNavigationCoreCards(snap());
    const t = cards.find(c => c.id === 'truth')!;
    expect(t.fields.find(f => f.id === 'tr-roundabout')!.value).toBe('2 / 1');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 7 — Ekran çökmeden render olur
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 7 — ekran render', () => {
  it('gerçek servis durumuyla (navigasyon yokken) çökmeden render olur', () => {
    const html = renderToStaticMarkup(<NavigationCoreScreen />);
    expect(html).toContain('NAVIGATION CORE');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="navigation-core"');
  });

  it('kart sayacı tüm alanları sınıflandırır (sınıfsız alan yok)', () => {
    const cards = buildNavigationCoreCards(snap());
    const counts = countByNavCoreClass(cards);
    const total = cards.reduce((n, c) => n + c.fields.length, 0);
    expect(counts.OBSERVED + counts.DERIVED + counts.UNAVAILABLE + counts.STALE).toBe(total);
  });

  it('kapsam sınırı ekranda AÇIKÇA yazılıdır (rota-göreli eşleştirme)', () => {
    const html = renderToStaticMarkup(<NavigationCoreScreen />);
    expect(html).toContain('rota-göreli');
    expect(html).toMatch(/routing-graph\.bin/);
  });
});
