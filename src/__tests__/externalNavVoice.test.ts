/**
 * "Hey Mavi, Yandex'ten Mersin'e rota kur" — harici navigasyon devri.
 *
 * Ölçülen kusurlar (2026-09-30, yerel ayrıştırıcı):
 *  - "Mersin'e rota kur" / "Kadıköy'e yol tarifi" → `open_maps`, HEDEF KAYBI.
 *  - "Yandex'ten Mersin'e rota kur" → `open_maps`; "Waze ile Mersin'e git" →
 *    hedef "waze ile mersine". Sağlayıcı hiçbir yolda taşınmıyordu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommandFull } from '../platform/commandParser';
import { matchExternalNavCommand } from '../platform/voice/externalNavCommand';
import { isProvisionalFeedback } from '../platform/voice/voiceCommandPolicy';
import {
  buildExternalRouteUris, extractExternalNavProvider, launchExternalRoute, packageForRouteUri,
} from '../platform/navigation/externalNavHandoff';
import {
  runExternalNavFlow, EXTERNAL_NAV_WAIT_MS,
  type ExternalNavAddressState, type ExternalNavFlowDeps,
} from '../platform/navigation/externalNavFlow';
import type { ExternalRoute } from '../platform/navigation/externalRouteState';
import {
  clearExternalRoute, getExternalRoute, setExternalRoute,
} from '../platform/navigation/externalRouteState';
import {
  judgeExternalRouteEnd, EXTERNAL_ROUTE_ARRIVAL_M, EXTERNAL_ROUTE_MAX_AGE_MS,
} from '../platform/navigation/externalRouteWatcher';
import { buildExternalMapEmbedUrl } from '../platform/navigation/externalMapEmbed';

describe('çevrimdışı rota cümlesi hedefi KAYBETMEZ', () => {
  it.each([
    ["Mersin'e rota kur", 'Mersin'],
    ["Ankara'ya rota çiz", 'Ankara'],
    ["Kadıköy'e yol tarifi", 'Kadıköy'],
    ['rota kur Mersin', 'Mersin'],
  ])('%s → navigate_* hedef=%s', (input, dest) => {
    const c = parseCommandFull(input).command;
    expect(c?.type === 'navigate_address' || c?.type === 'navigate_place').toBe(true);
    expect(c?.extra?.destination).toBe(dest);
  });

  it('hedefsiz "rota kur" hâlâ haritayı açar (davranış korundu)', () => {
    expect(parseCommandFull('rota kur').command?.type).toBe('open_maps');
    expect(parseCommandFull('yol tarifi').command?.type).toBe('open_maps');
  });
});

describe('harici navigasyon sesli cevabı', () => {
  it('🔒 "…hazırlanıyor" ara bilgidir → "…gönderdim/açılamadı" cevap hakkını korur (telefonda susturuluyordu)', () => {
    const c = matchExternalNavCommand("Yandex'ten Mersin'e rota kur");
    expect(c).not.toBeNull();
    expect(isProvisionalFeedback(c!.type, c!.extra)).toBe(true);
  });

  it('sağlayıcısız normal rota cümlesinin davranışı DEĞİŞMEZ (nihai cevap)', () => {
    const c = parseCommandFull("Mersin'e götür").command;
    expect(isProvisionalFeedback(c!.type, c!.extra)).toBe(false);
  });
});

describe('matchExternalNavCommand', () => {
  it.each([
    ["Yandex'ten Mersin'e rota kur", 'yandex', 'Mersin'],
    ['yandexten rota kur mersin', 'yandex', 'mersin'],
    ["mersin'e yandex ile git", 'yandex', 'mersin'],
    ["yandex haritalar'dan Mersin Şehir Hastanesi'ne götür", 'yandex', 'Mersin Şehir Hastanesi'],
    ['waze ile mersine git', 'waze', 'mersine'],
    ["google haritalardan izmir'e yol tarifi", 'google_maps', 'izmir'],
    ['google maps ile ankaraya rota kur', 'google_maps', 'ankaraya'],
  ])('%s → %s / %s', (input, provider, dest) => {
    const c = matchExternalNavCommand(input);
    expect(c?.extra?.provider).toBe(provider);
    expect(c?.extra?.destination).toBe(dest);
    expect(c?.type === 'navigate_address' || c?.type === 'navigate_place').toBe(true);
  });

  it.each(['yandex müzik aç', 'yandex aç', 'waze aç', "Mersin'e rota kur", 'google ne demek'])(
    'rota OLMAYAN / sağlayıcısız cümle dokunulmaz: %s', (input) => {
      expect(matchExternalNavCommand(input)).toBeNull();
    },
  );

  it('sağlayıcı ifadesi tek başına kalan metin üretmezse null', () => {
    expect(extractExternalNavProvider("Yandex'ten")).toBeNull();
  });
});

describe('harici uygulamayı açma', () => {
  it('Yandex: önce Navigasyon, sonra Haritalar denenir; açılan paket bildirilir', async () => {
    const tried: string[] = [];
    const res = await launchExternalRoute('yandex', 36.8, 34.6, async (uri) => {
      tried.push(uri);
      if (uri.startsWith('yandexnavi://')) throw new Error('LAUNCH_FAILED');
    });
    expect(tried).toEqual(buildExternalRouteUris('yandex', 36.8, 34.6));
    expect(tried[0]).toContain('lat_to=36.800000&lon_to=34.600000');
    expect(tried[1]).toContain('rtext=~36.800000,34.600000');
    expect(res).toEqual({ uri: tried[1], packageName: 'ru.yandex.yandexmaps' });
  });

  it('hiçbiri açılamazsa null; geçersiz koordinatta hiç denenmez', async () => {
    const launch = vi.fn(async () => { throw new Error('LAUNCH_FAILED'); });
    expect(await launchExternalRoute('waze', 36.8, 34.6, launch)).toBeNull();
    launch.mockClear();
    expect(await launchExternalRoute('google_maps', NaN, 34.6, launch)).toBeNull();
    expect(await launchExternalRoute('google_maps', 91, 34.6, launch)).toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });

  it('paket eşlemesi', () => {
    expect(packageForRouteUri('yandexnavi://build_route_on_map?x')).toBe('ru.yandex.yandexnavi');
    expect(packageForRouteUri('waze://?ll=1,2')).toBe('com.waze');
    expect(packageForRouteUri('google.navigation:q=1,2')).toBe('com.google.android.apps.maps');
    expect(packageForRouteUri('geo:1,2')).toBeNull();
  });
});

describe('runExternalNavFlow', () => {
  /** Gerçek motor gibi: abone olunca O ANKİ durumu hemen gönderir
   *  (addressNavigationEngine.onAddressNavState → `fn({ ..._state })`). */
  function harness(launchOk = true, initial: ExternalNavAddressState = { phase: 'idle', query: '', selected: null }) {
    const said: string[] = [];
    let listener: ((s: ExternalNavAddressState) => void) | null = null;
    const routes: ExternalRoute[] = [];
    const deps: ExternalNavFlowDeps = {
      findSaved: () => ({ match: null, ambiguous: [] }),
      resolveOnly: vi.fn(),
      onAddressState: (fn) => { listener = fn; fn(initial); return () => { listener = null; }; },
      launch: vi.fn(async () => (launchOk ? { uri: 'x://', packageName: 'pkg.test' } : null)),
      setExternalRoute: (r) => { routes.push(r); },
      startOwnNavigation: vi.fn(),
      say: (t) => { said.push(t); },
      now: () => 1_000,
      setTimer: vi.fn(() => 1),
      clearTimer: vi.fn(),
    };
    return { deps, said, routes, push: (s: ExternalNavAddressState) => listener?.(s), subscribed: () => listener !== null };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('onayda harici uygulama açılır, yüzen pencere kurulur; BİZİM navigasyon BAŞLAMAZ', async () => {
    const h = harness();
    runExternalNavFlow('Mersin', 'yandex', h.deps);
    expect(h.deps.resolveOnly).toHaveBeenCalledWith('Mersin');
    expect(h.deps.setTimer).toHaveBeenCalledWith(expect.any(Function), EXTERNAL_NAV_WAIT_MS);
    h.push({ phase: 'searching', query: 'Mersin', selected: null });
    expect(h.deps.launch).not.toHaveBeenCalled();
    h.push({ phase: 'confirmed', query: 'Mersin', selected: { lat: 36.8, lng: 34.6, name: 'Mersin' } });
    await flush();
    expect(h.deps.launch).toHaveBeenCalledWith('yandex', 36.8, 34.6);
    expect(h.routes).toEqual([{ provider: 'yandex', packageName: 'pkg.test', destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: 1_000 }]);
    expect(h.deps.startOwnNavigation).not.toHaveBeenCalled();
    expect(h.said[0]).toContain('Yandex');
    expect(h.subscribed()).toBe(false);
  });

  it('uygulama açılamazsa pencere KURULMAZ; yedek olarak bizim navigasyon başlar ve söylenir', async () => {
    const h = harness(false);
    runExternalNavFlow('Mersin', 'waze', h.deps);
    h.push({ phase: 'searching', query: 'Mersin', selected: null });
    h.push({ phase: 'confirmed', query: 'Mersin', selected: { lat: 36.8, lng: 34.6, name: 'Mersin' } });
    await flush();
    expect(h.routes).toEqual([]);
    expect(h.deps.startOwnNavigation).toHaveBeenCalledWith(expect.objectContaining({ lat: 36.8, name: 'Mersin' }));
    expect(h.said[0]).toMatch(/Waze bu cihazda açılamadı; Mersin rotasını bizim navigasyonda başlattım/);
  });

  it('arama hatası veya başka bir arama → harici uygulama AÇILMAZ', async () => {
    const a = harness();
    runExternalNavFlow('Mersin', 'yandex', a.deps);
    a.push({ phase: 'searching', query: 'Mersin', selected: null });
    a.push({ phase: 'error', query: 'Mersin', selected: null });
    const b = harness();
    runExternalNavFlow('Mersin', 'yandex', b.deps);
    b.push({ phase: 'searching', query: 'Mersin', selected: null });
    b.push({ phase: 'confirmed', query: 'Adana', selected: { lat: 37, lng: 35.3, name: 'Adana' } });
    await flush();
    expect(a.deps.launch).not.toHaveBeenCalled();
    expect(b.deps.launch).not.toHaveBeenCalled();
    expect(a.subscribed()).toBe(false);
    expect(b.subscribed()).toBe(false);
  });

  it('🔒 abone olunca gelen ilk "boşta" mesajı akışı KAPATMAZ (telefonda ölçülen kusur)', async () => {
    const h = harness();                                // initial: idle + boş sorgu
    runExternalNavFlow('Mersin', 'waze', h.deps);
    expect(h.subscribed()).toBe(true);                  // eskiden burada kapanıyordu
    h.push({ phase: 'searching', query: 'Mersin', selected: null });
    h.push({ phase: 'confirmed', query: 'Mersin', selected: { lat: 36.8, lng: 34.6, name: 'Mersin' } });
    await flush();
    expect(h.deps.launch).toHaveBeenCalledWith('waze', 36.8, 34.6);
  });

  it('🔒 aynı hedefe ait ESKİ "onaylandı" durumu devri tetiklemez', async () => {
    const stale: ExternalNavAddressState = { phase: 'confirmed', query: 'Mersin', selected: { lat: 1, lng: 2, name: 'Eski' } };
    const h = harness(true, stale);
    runExternalNavFlow('Mersin', 'yandex', h.deps);
    await flush();
    expect(h.deps.launch).not.toHaveBeenCalled();
    h.push({ phase: 'searching', query: 'Mersin', selected: null });
    h.push({ phase: 'confirmed', query: 'Mersin', selected: { lat: 36.8, lng: 34.6, name: 'Mersin' } });
    await flush();
    expect(h.deps.launch).toHaveBeenCalledTimes(1);
    expect(h.deps.launch).toHaveBeenCalledWith('yandex', 36.8, 34.6);
  });

  it('kayıtlı konum: çözücü çağrılmadan harici uygulama; bizim navigasyon başlamaz', async () => {
    const h = harness();
    h.deps.findSaved = () => ({ match: { id: 's1', name: 'Şelale', lat: 36.9, lng: 34.8 }, ambiguous: [] });
    runExternalNavFlow('şelale', 'google_maps', h.deps);
    await flush();
    expect(h.deps.resolveOnly).not.toHaveBeenCalled();
    expect(h.deps.launch).toHaveBeenCalledWith('google_maps', 36.9, 34.8);
    expect(h.deps.startOwnNavigation).not.toHaveBeenCalled();
    expect(h.routes[0]?.destName).toBe('Şelale');
  });
});

describe('yüzen pencere: harici rota durumu ve bitişi', () => {
  afterEach(() => clearExternalRoute());
  const route: ExternalRoute = { provider: 'yandex', packageName: 'ru.yandex.yandexnavi', destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: 0 };

  it('hedefe varınca (≤200 m) biter; konum bilinmiyorsa "vardı" DENMEZ; azami ömürde biter', () => {
    expect(judgeExternalRouteEnd(route, { latitude: 36.8005, longitude: 34.6005 }, 1_000)).toBe('arrived');
    expect(judgeExternalRouteEnd(route, { latitude: 36.9, longitude: 34.6 }, 1_000)).toBeNull();   // ~11 km
    expect(judgeExternalRouteEnd(route, null, 1_000)).toBeNull();
    expect(judgeExternalRouteEnd(route, null, EXTERNAL_ROUTE_MAX_AGE_MS + 1)).toBe('expired');
    expect(EXTERNAL_ROUTE_ARRIVAL_M).toBe(200);
  });

  it('kur / temizle', () => {
    setExternalRoute(route);
    expect(getExternalRoute()?.destName).toBe('Mersin');
    clearExternalRoute();
    expect(getExternalRoute()).toBeNull();
  });

  it('bizde YENİ navigasyon başlayınca harici rota (ve pencere) temizlenir', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'src/platform/navigationService.ts'), 'utf8');
    const start = src.indexOf('export function startNavigation(');
    expect(src.indexOf('clearExternalRoute()', start)).toBeGreaterThan(start);
    expect(src.indexOf('clearExternalRoute()', start)).toBeLessThan(src.indexOf('useNavigationStore.getState()', start));
  });
});

describe('sağlayıcı web haritası adresi', () => {
  it('Yandex: konum varsa rota (rtext), yoksa yalnız hedef (pt, boylam önce)', () => {
    expect(buildExternalMapEmbedUrl('yandex', { lat: 36.8, lng: 34.6 }, { lat: 37, lng: 35 }))
      .toBe('https://yandex.com.tr/map-widget/v1/?rtext=37.000000,35.000000~36.800000,34.600000&rtt=auto');
    expect(buildExternalMapEmbedUrl('yandex', { lat: 36.8, lng: 34.6 }, null))
      .toBe('https://yandex.com.tr/map-widget/v1/?pt=34.600000,36.800000&z=13');
  });
  it('Google ve Waze; geçersiz hedefte null (boş harita gösterilmez)', () => {
    expect(buildExternalMapEmbedUrl('google_maps', { lat: 36.8, lng: 34.6 }, { lat: 37, lng: 35 }))
      .toContain('saddr=37.000000,35.000000&daddr=36.800000,34.600000&output=embed');
    expect(buildExternalMapEmbedUrl('waze', { lat: 36.8, lng: 34.6 }, null)).toContain('embed.waze.com/iframe');
    expect(buildExternalMapEmbedUrl('yandex', { lat: NaN, lng: 34.6 }, null)).toBeNull();
  });
});
