/** Canonical adaptör → gerçek sayfa → sunum/transport; dış servisler testte yalıtılır. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DigitalCockpitPage } from '../components/cockpit/DigitalCockpitPage';
import { CockpitPager } from '../components/cockpit/CockpitPager';

// Ortak setup navigator'ı dar mock ile değiştiriyor; React DOM dev yolu bu alanı okur.
vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

const source = vi.hoisted(() => ({
  speed: 72 as number | null,
  rpm: 1800,
  coolant: { source: 'CAN', state: 'LIVE', value: 92 },
  ambient: 24 as number | null,
  limit: { effectiveLimitKmh: 80 as number | null, state: 'AVAILABLE' },
  obd: { source: 'real', dataFresh: true, lastSeenMs: 1000, fuelLevel: 65, estimatedRangeKm: 520 },
  vehicle: { odometer: 8326 as number | null, canGearPos: 1 as number | null },
  navigating: true,
  route: { steps: [{ streetName: 'Önceki adım' }, { streetName: 'Gazi Paşa Blv.', maneuverType: 'turn', maneuverModifier: 'right' }], currentStepIndex: 0, distanceToNextTurnMeters: 300 },
  media: { track: { title: 'Leyla', artist: 'Mabel Matiz', albumArt: '' }, playing: true, permissionRequired: false },
  settings: { dayNightMode: 'day', use24Hour: true, sleepMode: false, activeVehicleProfileId: 'test',
    vehicleProfiles: [{ id: 'test', maxRpm: 8000, avgConsumptionL100: 6.1, driveMode: 'eco' }] },
  system: { isReverseActive: false, isTheaterModeActive: false, isDriving: null as boolean | null },
  previous: vi.fn(), next: vi.fn(), toggle: vi.fn(),
}));

vi.mock('../hooks/useDisplaySpeed', () => ({ useDisplaySpeed: () => source.speed }));
vi.mock('../hooks/useCanonicalVehicleSignal', () => ({ useCanonicalVehicleSignal: () => source.coolant, useAmbientTemp: () => source.ambient }));
vi.mock('../platform/obdService', () => ({ useOBDRPM: () => source.rpm, useOBDState: () => source.obd }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({ useUnifiedVehicleStore: (select: (s: typeof source.vehicle) => unknown) => select(source.vehicle) }));
vi.mock('../platform/navigationService', () => ({ useNavigation: () => ({ isNavigating: source.navigating, isGuidanceActive: source.navigating }) }));
vi.mock('../platform/routingService', () => ({ useRouteState: () => source.route }));
vi.mock('../platform/navigation/useEffectiveSpeedLimit', () => ({ useEffectiveSpeedLimit: () => source.limit }));
vi.mock('../platform/mediaService', () => ({ useMediaState: () => source.media, togglePlayPause: source.toggle }));
vi.mock('../platform/media/carosMediaLayer', () => ({ previous: source.previous, next: source.next }));
vi.mock('../store/useStore', () => ({ useStore: (select: (s: { settings: typeof source.settings }) => unknown) => select({ settings: source.settings }) }));
vi.mock('../store/useSystemStore', () => ({ useSystemStore: (select: (s: typeof source.system) => unknown) => select(source.system) }));
vi.mock('../hooks/useClock', () => ({ useClock: () => ({ time: '21:11', date: 'Pazar, 13 Eyl' }) }));

let root: Root;
let container: HTMLDivElement;
const initial = JSON.stringify(source);

beforeEach(() => {
  Object.assign(source, JSON.parse(initial));
  source.previous.mockClear(); source.next.mockClear(); source.toggle.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

const renderPage = () => act(() => root.render(<DigitalCockpitPage />));
const value = (name: string) => container.querySelector(`[data-cockpit-value="${name}"]`)?.textContent;

describe('cockpit canonical bağlama', () => {
  it('hız, RPM, CAN sıcaklık, yakıt/menzil, profil tüketimi, odometre, vites ve manevra aynı kaynaklardan görünür', () => {
    renderPage();
    expect(['speed', 'rpm', 'coolant', 'fuel', 'range', 'consumption', 'odometer', 'gear', 'driveMode', 'ambient', 'maneuverDistance'].map(value))
      .toEqual(['72', '1.8', '92°C', '%65', '520', '6.1 L/100km', '8.326 km', 'D', 'ECO', '24°C', '300 m']);
    expect(container.querySelector('[data-cockpit-speedlimit]')?.textContent).toBe('80');
    expect(container.textContent).toContain('Gazi Paşa Blv.');
    expect(container.textContent).not.toContain('Önceki adım');
  });

  it('gerçek sıfırlar canonical kaynaklardan geçerek sıfır kalır', () => {
    source.speed = 0; source.rpm = 0; source.ambient = 0;
    source.coolant = { source: 'OBD', state: 'LIVE', value: 0 };
    source.obd = { ...source.obd, fuelLevel: 0, estimatedRangeKm: 0 };
    source.vehicle = { odometer: 0, canGearPos: 0 };
    source.settings.vehicleProfiles[0].avgConsumptionL100 = 0;
    renderPage();
    expect(['speed', 'rpm', 'coolant', 'fuel', 'range', 'consumption', 'odometer', 'gear', 'ambient'].map(value))
      .toEqual(['0', '0.0', '0°C', '%0', '0', '0.0 L/100km', '0 km', 'N/P', '0°C']);
  });

  it('unknown/sentinel/bayat/cache ölçümler sıfıra dönüşmez', () => {
    source.speed = null; source.rpm = -1; source.ambient = null;
    source.coolant = { source: 'OBD', state: 'STALE', value: 92 };
    source.obd = { ...source.obd, dataFresh: false, lastSeenMs: 0 };
    source.vehicle = { odometer: null, canGearPos: null };
    source.settings.vehicleProfiles = [];
    source.limit = { state: 'STALE', effectiveLimitKmh: 80 };
    renderPage();
    for (const key of ['speed', 'rpm', 'coolant', 'fuel', 'range', 'consumption', 'odometer', 'gear', 'driveMode', 'ambient']) expect(value(key), key).toBe('—');
    expect(container.querySelector('[data-cockpit-speedlimit]')).toBeNull();
  });

  it('rota kapanınca eski manevra kaybolur; belirsiz hız limiti kesinleşmez', () => {
    renderPage();
    source.navigating = false;
    source.limit = { state: 'ROAD_ONLY', effectiveLimitKmh: 80 };
    renderPage();
    expect(container.querySelector('[data-cockpit-region="maneuverBar"]')).toBeNull();
    expect(container.querySelector('[data-cockpit-speedlimit]')?.getAttribute('data-cockpit-speedlimit')).toBe('uncertain');
    expect(container.textContent).not.toContain('Gazi Paşa Blv.');
  });

  it('dayNightMode değişince mevcut sayfa ve gerçek veriler korunur', () => {
    renderPage();
    const screen = container.querySelector('[data-caros-cockpit="screen"]');
    expect(screen?.getAttribute('data-cockpit-mode')).toBe('day');
    source.settings = { ...source.settings, dayNightMode: 'night' };
    renderPage();
    expect(container.querySelector('[data-caros-cockpit="screen"]')).toBe(screen);
    expect(screen?.getAttribute('data-cockpit-mode')).toBe('night');
    expect(value('speed')).toBe('72');
  });

  it('medya adı/artwork/playing canonical; her düğme yalnız kendi transportunu çağırır, izin yoksa hepsi pasif', () => {
    source.media.track.albumArt = '/canonical-artwork.jpg';
    renderPage();
    expect(container.textContent).toContain('Leyla');
    expect(container.textContent).toContain('Mabel Matiz');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/canonical-artwork.jpg');
    for (const label of ['Önceki parça', 'Duraklat', 'Sonraki parça']) {
      act(() => (container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click());
    }
    expect(source.previous).toHaveBeenCalledTimes(1);
    expect(source.toggle).toHaveBeenCalledTimes(1);
    expect(source.next).toHaveBeenCalledTimes(1);
    source.media = { ...source.media, playing: false, permissionRequired: true };
    renderPage();
    expect(container.querySelector('button[aria-label="Çal"]')).not.toBeNull();
    for (const button of container.querySelectorAll('button')) { expect(button.disabled).toBe(true); act(() => button.click()); }
    expect(source.toggle).toHaveBeenCalledTimes(1);
    expect(source.previous).toHaveBeenCalledTimes(1);
    expect(source.next).toHaveBeenCalledTimes(1);
  });
});

const renderShell = () => act(() => root.render(<><div data-test-home="">HOME</div><CockpitPager /></>));
function swipe(target: Element, from: number, to: number) {
  for (const [type, x] of [['pointerdown', from], ['pointermove', to], ['pointerup', to]] as const) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 180 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      target.dispatchEvent(event);
    });
  }
}

describe('cockpit kardeş sayfa regresyonu', () => {
  it('sağ kenar → cockpit → hardware back → HOME; HOME ve cockpit düğümleri yeniden mount edilmez', () => {
    renderShell();
    const home = container.querySelector('[data-test-home]')!;
    swipe(home, 1000, 300);
    const layer = container.querySelector('[data-caros-cockpit="layer"]')!;
    expect(layer.getAttribute('data-cockpit-page')).toBe('cockpit');
    expect(container.querySelector('[data-test-home]')).toBe(home);
    act(() => window.dispatchEvent(new Event('carlauncherBackButton')));
    expect(layer.getAttribute('data-cockpit-page')).toBe('home');
    expect(container.querySelector('[data-test-home]')).toBe(home);
    swipe(home, 1000, 300);
    expect(container.querySelector('[data-caros-cockpit="layer"]')).toBe(layer);
    const media = container.querySelector('[data-cockpit-region="musicCard"]')!;
    swipe(media, 450, 990);
    expect(layer.getAttribute('data-cockpit-page')).toBe('cockpit');
    /* ÜRÜN KARARI (OBD sayfası turu): kokpitte SAĞA kaydırma artık OBD canlı
       veri sayfasını açar. SOLA kaydırma HOME'a dönmeye devam eder ve donanım
       geri tuşu her sayfadan HOME'a döner — bu halka ikisini de kilitler. */
    swipe(container.querySelector('[data-cockpit-value="speed"]')!, 300, 990);
    expect(layer.getAttribute('data-cockpit-page')).toBe('obd');
    act(() => window.dispatchEvent(new Event('carlauncherBackButton')));
    expect(layer.getAttribute('data-cockpit-page')).toBe('home');
    expect(container.querySelector('[data-test-home]')).toBe(home);
  });

  it.each(['reverse', 'theater', 'sleep'])('%s cockpit’i kapatır ve yeni giriş jestini engeller', mode => {
    renderShell();
    const home = container.querySelector('[data-test-home]')!;
    swipe(home, 1000, 300);
    expect(container.querySelector('[data-cockpit-page="cockpit"]')).not.toBeNull();
    if (mode === 'reverse') source.system.isReverseActive = true;
    if (mode === 'theater') source.system.isTheaterModeActive = true;
    if (mode === 'sleep') source.settings.sleepMode = true;
    renderShell();
    expect(container.querySelector('[data-cockpit-page="home"]')).not.toBeNull();
    swipe(home, 1000, 300);
    expect(container.querySelector('[data-cockpit-page="cockpit"]')).toBeNull();
    expect(container.querySelector('[data-test-home]')).toBe(home);
  });
});
