/**
 * TBT talimat endeksi kilidi — "off-by-one" (2026-07-05 navigasyon denetimi P0).
 *
 * KÖK NEDEN: OSRM semantiğinde steps[i].instruction = adımın BAŞINDAKİ manevra.
 * routingService.updateRouteProgress currentStepIndex'i manevra GEÇİLİNCE ilerletir
 * ve distanceToNextTurnMeters steps[i+1]'in manevra noktasına sayar. Panel + sesli
 * anons steps[i]'yi okursa sürücüye hep az önce GEÇİLMİŞ manevra söylenir
 * ("200 m sonra sağa dönün" derken gerçek dönüş soldur).
 *
 * KİLİT: TurnPanel ve sesli anons YAKLAŞAN manevrayı (steps[i+1]) okumalı.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// Kaynak-metin kilidi: ?raw = transform-time sabit (bkz. regression.guards.test.ts).
// react-dom/client bu repo'nun setup.ts navigator mock'u yüzünden import edilemez
// (bkz. safetyContext.test.tsx) → sesli anons wiring'i yapısal kilitle doğrulanır.
import navigationHudSrc from '../components/map/NavigationHUD.tsx?raw';

/* ── Mock'lar — NavigationHUD'un tüm platform bağımlılıkları ─────────────── */

const { speakNavigationMock, NAV_STATUS, routeState } = vi.hoisted(() => {
  const NAV_STATUS = {
    IDLE: 'IDLE', PREVIEW: 'PREVIEW', ROUTING: 'ROUTING', ACTIVE: 'ACTIVE',
    REROUTING: 'REROUTING', ARRIVED: 'ARRIVED', ERROR: 'ERROR',
  } as const;

  /* Rota: depart → SAĞA dön (GEÇİLDİ, currentStepIndex=1) → SOLA dön (YAKLAŞAN, 200 m) → arrive */
  const STEPS = [
    {
      instruction: 'Yola çıkın', streetName: 'Başlangıç Cd', distance: 400, duration: 40,
      maneuverType: 'depart', maneuverModifier: 'straight', coordinate: [34.60, 36.80],
    },
    {
      instruction: 'Sağa dönün (Atatürk Cd)', streetName: 'Atatürk Cd', distance: 800, duration: 70,
      maneuverType: 'turn', maneuverModifier: 'right', coordinate: [34.61, 36.80],
    },
    {
      instruction: 'Sola dönün (İnönü Cd)', streetName: 'İnönü Cd', distance: 600, duration: 55,
      maneuverType: 'turn', maneuverModifier: 'left', coordinate: [34.62, 36.81],
    },
    {
      instruction: 'Hedefinize ulaştınız', streetName: '', distance: 0, duration: 0,
      maneuverType: 'arrive', maneuverModifier: 'straight', coordinate: [34.64, 36.82],
    },
  ];

  const routeState = {
    loading: false, error: null,
    geometry: STEPS.map((s) => s.coordinate) as [number, number][],
    alternatives: [], altDistances: [], altDurations: [], altRealIndices: [], altHasToll: [],
    selectedAltIndex: 0, hasToll: false,
    steps: STEPS,
    totalDistanceMeters: 5000, totalDurationSeconds: 600,
    currentStepIndex: 1,            // "Sağa dönün" manevrasının ÜZERİNDEN GEÇİLDİ
    distanceToNextTurnMeters: 200,  // yaklaşan manevra: steps[2] = "Sola dönün"
    serverUsed: 'test', cumulativeDistances: null, pendingManeuver: null,
  };

  return { speakNavigationMock: vi.fn(), NAV_STATUS, STEPS, routeState };
});

vi.mock('../platform/ttsService', () => ({
  speakNavigation: (...args: unknown[]) => speakNavigationMock(...args),
}));

vi.mock('../platform/navigationService', () => ({
  NavStatus: NAV_STATUS,
  useNavigation: () => ({
    status: NAV_STATUS.ACTIVE,
    isNavigating: true,
    isRerouting: false,
    destination: {
      id: 'd1', name: 'Test Hedef', latitude: 36.82, longitude: 34.64, type: 'history',
    },
    distanceMeters: 3200,
    etaSeconds: 420,
    headingToDestination: 90,
    isOfflineResult: false,
    errorMessage: undefined,
  }),
  startNavigation: vi.fn(),
  stopNavigation: vi.fn(),
  formatDistance: (m: number) => `${Math.round(m)} m`,
  formatEta: (s: number) => `${Math.ceil(s / 60)} dk`,
}));

vi.mock('../platform/routingService', () => ({
  useRouteState: () => routeState,
  clearRoute: vi.fn(),
  selectAltRoute: vi.fn(),
  computeFuelEstimate: () => 0.4,
}));

vi.mock('../platform/gpsService', () => ({
  useGPSLocation: () => ({
    latitude: 36.805, longitude: 34.615, accuracy: 5, timestamp: Date.now(),
  }),
}));

vi.mock('../platform/speedLimitService', () => ({
  useSpeedLimitByLocation: () => null,
}));

vi.mock('../platform/safetyService', () => ({
  startSafetyObserver: vi.fn(),
  stopSafetyObserver: vi.fn(),
}));

/* Selector-hook mock yardımcıları — hoisting kuralı gereği state her factory içinde tanımlanır. */

vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => {
  const state = {
    speed: 13.9, fuel: 55,
    location: { latitude: 36.805, longitude: 34.615, accuracy: 5, timestamp: Date.now() },
  };
  return {
    useUnifiedVehicleStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock('../store/useHazardStore', () => {
  const state = { hazardStatus: 'NONE', activeHazards: [], hazardIntensity: 0 };
  return {
    useHazardStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock('../store/useCognitiveStore', () => {
  const state = { currentMode: 'IMMERSIVE' };
  return {
    useCognitiveStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock('../store/useSafetyStore', () => {
  const state = {
    brakingDistanceM: 10, reactionDistanceM: 8, isBrakingCritical: false,
    safetyState: 'SAFE', recommendedSpeedKmh: null,
  };
  return {
    useSafetyStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock('../store/useStore', () => {
  const state = {
    settings: {
      recentDestinations: [], homeLocation: null, workLocation: null, customLocations: [],
    },
    updateSettings: () => undefined,
  };
  return {
    useStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

import { NavigationHUD } from '../components/map/NavigationHUD';

/* ── Testler ─────────────────────────────────────────────────────────────── */

const hudProps = {
  onStart: () => undefined,
  onCancel: () => undefined,
  routeReady: true,
};

describe('KİLİT: TBT talimatı yaklaşan manevrayı okur (off-by-one yasağı)', () => {
  beforeEach(() => {
    speakNavigationMock.mockClear();
  });

  it('TurnPanel yaklaşan manevrayı (steps[idx+1] = Sola dönün) gösterir, geçilmişi değil', () => {
    const html = renderToStaticMarkup(<NavigationHUD {...hudProps} />);
    // Yaklaşan manevra başlıkta olmalı
    expect(html).toContain('Sola dönün');
    // Geçilmiş manevra ("Sağa dönün") ana talimat olarak GÖSTERİLMEMELİ
    expect(html).not.toContain('Sağa dönün');
  });

  it('KİLİT (yapısal): sesli anons yaklaşan adımın (upcomingStep) talimatını okur', () => {
    // Kademeli anons effect'i talimat metnini YAKLAŞAN adımdan almalı.
    expect(navigationHudSrc).toContain('upcomingStep.instruction');
    // Geçilmiş adımın talimatı anons kaynağı OLMAMALI (off-by-one'ın kendisi).
    expect(navigationHudSrc).not.toContain('currentStep.instruction');
  });

  it('KİLİT (yapısal): TurnPanel ve LimpHomeHUD yaklaşan adımı (upcomingStep) alır', () => {
    // Ana dönüş kartı — step prop'u yaklaşan manevra olmalı.
    expect(navigationHudSrc).toMatch(/step=\{upcomingStep\}/);
    // LimpHome hayatta-kalma HUD'u da aynı yaklaşan manevrayı göstermeli.
    expect(navigationHudSrc).toMatch(/currentStep=\{upcomingStep\}/);
  });
});
