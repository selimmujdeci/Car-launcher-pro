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
  buildExternalRouteUris, extractExternalNavProvider, launchExternalRoute,
} from '../platform/navigation/externalNavHandoff';
import {
  runExternalNavFlow, EXTERNAL_NAV_WAIT_MS,
  type ExternalNavAddressState, type ExternalNavFlowDeps,
} from '../platform/navigation/externalNavFlow';
import {
  clearExternalGuidanceOwner, getExternalGuidanceOwner, setExternalGuidanceOwner,
} from '../platform/navigation/externalGuidanceOwner';
import {
  noteVoiceGuidanceTick, noteTrafficAheadTick, resetVoiceGuidance,
} from '../platform/navigation/voiceGuidanceRuntime';

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
  it('Yandex: önce Navigasyon, sonra Haritalar denenir', async () => {
    const tried: string[] = [];
    const ok = await launchExternalRoute('yandex', 36.8, 34.6, async (uri) => {
      tried.push(uri);
      if (uri.startsWith('yandexnavi://')) throw new Error('LAUNCH_FAILED');
    });
    expect(ok).toBe(true);
    expect(tried).toEqual(buildExternalRouteUris('yandex', 36.8, 34.6));
    expect(tried[0]).toContain('lat_to=36.800000&lon_to=34.600000');
    expect(tried[1]).toContain('rtext=~36.800000,34.600000');
  });

  it('hiçbiri açılamazsa false; geçersiz koordinatta hiç denenmez', async () => {
    const launch = vi.fn(async () => { throw new Error('LAUNCH_FAILED'); });
    expect(await launchExternalRoute('waze', 36.8, 34.6, launch)).toBe(false);
    launch.mockClear();
    expect(await launchExternalRoute('google_maps', NaN, 34.6, launch)).toBe(false);
    expect(await launchExternalRoute('google_maps', 91, 34.6, launch)).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('runExternalNavFlow', () => {
  /** Gerçek motor gibi: abone olunca O ANKİ durumu hemen gönderir
   *  (addressNavigationEngine.onAddressNavState → `fn({ ..._state })`). */
  function harness(launchOk = true, initial: ExternalNavAddressState = { phase: 'idle', query: '', selected: null }) {
    const said: string[] = [];
    let listener: ((s: ExternalNavAddressState) => void) | null = null;
    let owner: string | null = null;
    const deps: ExternalNavFlowDeps = {
      findSaved: () => ({ match: null, ambiguous: [] }),
      startOwnNavigation: vi.fn(),
      activateOwnNavigation: vi.fn(),
      resolveWithoutFullMap: vi.fn(),
      onAddressState: (fn) => { listener = fn; fn(initial); return () => { listener = null; }; },
      launch: vi.fn(async () => launchOk),
      setGuidanceOwner: (p) => { owner = p; },
      clearGuidanceOwner: () => { owner = null; },
      say: (t) => { said.push(t); },
      setTimer: vi.fn(() => 1),
      clearTimer: vi.fn(),
    };
    return { deps, said, push: (s: ExternalNavAddressState) => listener?.(s), owner: () => owner, subscribed: () => listener !== null };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('çözülen hedef onaylanınca harici uygulama o koordinatla açılır; tam ekran harita açılmaz', async () => {
    const h = harness();
    runExternalNavFlow('Mersin', 'yandex', h.deps);
    expect(h.deps.resolveWithoutFullMap).toHaveBeenCalledWith('Mersin');
    expect(h.deps.setTimer).toHaveBeenCalledWith(expect.any(Function), EXTERNAL_NAV_WAIT_MS);
    h.push({ phase: 'searching', query: 'Mersin', selected: null });
    expect(h.deps.launch).not.toHaveBeenCalled();
    h.push({ phase: 'confirmed', query: 'Mersin', selected: { lat: 36.8, lng: 34.6, name: 'Mersin' } });
    await flush();
    expect(h.deps.launch).toHaveBeenCalledWith('yandex', 36.8, 34.6);
    expect(h.deps.activateOwnNavigation).toHaveBeenCalledTimes(1);   // mini haritada rota
    expect(h.owner()).toBe('yandex');
    expect(h.said[0]).toContain('Yandex');
    expect(h.subscribed()).toBe(false);
  });

  it('uygulama açılamazsa sahiplik KURULMAZ ve dürüstçe söylenir', async () => {
    const h = harness(false);
    runExternalNavFlow('Mersin', 'waze', h.deps);
    h.push({ phase: 'searching', query: 'Mersin', selected: null });
    h.push({ phase: 'confirmed', query: 'Mersin', selected: { lat: 36.8, lng: 34.6, name: 'Mersin' } });
    await flush();
    expect(h.owner()).toBeNull();
    expect(h.said[0]).toMatch(/Waze bu cihazda açılamadı; Mersin rotası bizim haritada kuruldu/);
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
    expect(a.deps.activateOwnNavigation).not.toHaveBeenCalled();
    expect(b.deps.activateOwnNavigation).not.toHaveBeenCalled();
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

  it('kayıtlı konum: çözücü çağrılmadan kendi rotamız + harici uygulama', async () => {
    const h = harness();
    h.deps.findSaved = () => ({ match: { id: 's1', name: 'Şelale', lat: 36.9, lng: 34.8 }, ambiguous: [] });
    runExternalNavFlow('şelale', 'google_maps', h.deps);
    await flush();
    expect(h.deps.startOwnNavigation).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', lat: 36.9 }));
    expect(h.deps.resolveWithoutFullMap).not.toHaveBeenCalled();
    expect(h.deps.launch).toHaveBeenCalledWith('google_maps', 36.9, 34.8);
    expect(h.deps.activateOwnNavigation).toHaveBeenCalledTimes(1);
  });
});

describe('harici uygulama yönlendirirken bizim yol tarifimiz SUSAR', () => {
  afterEach(() => { clearExternalGuidanceOwner(); resetVoiceGuidance('test'); });
  const input = {
    navActive: true, isRerouting: false, sessionId: 9, routeRevision: 1,
    stepIndex: 0, instruction: 'Sağa dönün', distanceM: 500,
    distanceSource: 'ALONG_ROUTE' as const, speedKmh: 50,
  };

  it('sahip varken anons YOK; sahip kalkınca anons döner', () => {
    const spoken: string[] = [];
    setExternalGuidanceOwner('yandex');
    expect(noteVoiceGuidanceTick(input, (t) => { spoken.push(t); })).toBeNull();
    expect(noteVoiceGuidanceTick({ ...input, isRerouting: true }, (t) => { spoken.push(t); })).toBeNull();
    expect(spoken).toEqual([]);
    clearExternalGuidanceOwner();
    expect(noteVoiceGuidanceTick(input, (t) => { spoken.push(t); })).not.toBeNull();
    expect(spoken.length).toBe(1);
  });

  it('trafik anonsu da susar; sahip kalkınca aynı olay söylenir', () => {
    const cum = Array.from({ length: 11 }, (_, i) => (10 - i) * 500);
    const jam = { startIdx: 6, endIdx: 8, level: 'heavy' as const, kind: 'JAM' as const, delayS: 180 };
    const tIn = {
      sessionId: 9, routeRevision: 1, isRerouting: false, sections: [jam], cumulativeDistances: cum,
      vehicleAlongRemainingM: 2900, speedKmh: 50, distanceToNextTurnM: null,
    };
    const speak = vi.fn();
    setExternalGuidanceOwner('waze');
    expect(noteTrafficAheadTick(tIn, speak)).toBeNull();
    expect(speak).not.toHaveBeenCalled();
    clearExternalGuidanceOwner();
    expect(noteTrafficAheadTick(tIn, speak)).not.toBeNull();
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('yeni navigasyon başlangıcı sahipliği temizler (bayat susturma yok)', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'src/platform/navigationService.ts'), 'utf8');
    const start = src.indexOf('export function startNavigation(');
    const stop = src.indexOf('export function stopNavigation(');
    expect(src.indexOf('clearExternalGuidanceOwner()', start)).toBeLessThan(src.indexOf('useNavigationStore.getState()', start));
    expect(src.indexOf('clearExternalGuidanceOwner()', stop)).toBeGreaterThan(stop);
    expect(getExternalGuidanceOwner()).toBeNull();
  });
});
