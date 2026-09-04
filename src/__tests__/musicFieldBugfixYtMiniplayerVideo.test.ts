/**
 * musicFieldBugfixYtMiniplayerVideo.test.ts — SAHA BUGFIX (2026-09-03) ·
 * YOUTUBE PLAYBACK + MINI PLAYER/DOCK + VIDEO POLICY REVISION.
 *
 * Görevde İSTENEN 17 senaryonun KİLİTLERİ. Mimariyi YENİDEN YAZMAZ; yalnız
 * bu turda değişen/dokunulan gerçek davranışı doğrular:
 *   1-7  YouTube: gerçek backend başlaması, activeSource, LOCAL→YOUTUBE devri,
 *        sahte PLAYING üretilmemesi, audibleBackendCount<=1, dürüst FAIL,
 *        F7.6 kuyruk otoritesine dokunulmaması.
 *   8-12 MiniPlayer/Dock: `--lp-dock-h` çapası, ikinci yerleşim otoritesi
 *        kurulmaması, çakışmayan z-index, tek görünürlük otoritesi.
 *   13-17 Video: hız/hareketin ARTIK gate üretmemesi, videoSafetyPolicy'nin
 *        playback authority OLMAMASI, video aç/kapa'nın ses/oturumu bozmaması.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { stripComments } from './helpers';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
/** Yorum-güvenli kaynak okuması — kilit yorum CÜMLESİNE değil KODA bakar. */
const readCode = (p: string): string => stripComments(read(p));

/* ══════════════════════════════════════════════════════════════════════════
 * 1-7 · YOUTUBE PLAYBACK — gerçek adapter + gerçek coordinator
 * ════════════════════════════════════════════════════════════════════════ */

interface FakeYtState {
  state: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'UNSTARTED' | 'ENDED' | -1;
  active: boolean;
  playCalls: { videoId: string; title: string }[];
  ensureReadyShouldThrow: boolean;
  playShouldThrow: boolean;
}

function freshYtState(): FakeYtState {
  return {
    state: 'UNSTARTED', active: false, playCalls: [],
    ensureReadyShouldThrow: false, playShouldThrow: false,
  };
}

describe('MUSIC YOUTUBE FIELD FIX — gerçek IFrame kanıtı olmadan COMMIT olmaz', () => {
  let yt: FakeYtState;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    yt = freshYtState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function loadAdapters() {
    const backendAdapters = await import('../platform/media/authority/backendAdapters');
    const fakeYtModule = {
      YOUTUBE_PKG: 'com.cockpitos.pro.youtube',
      ensureYouTubeReady: async () => {
        if (yt.ensureReadyShouldThrow) throw new Error('iframe_unavailable');
      },
      playYouTube: async (videoId: string, title: string) => {
        if (yt.playShouldThrow) throw new Error('resolve_failed');
        yt.playCalls.push({ videoId, title });
        yt.active = true;
      },
      getYouTubePlaybackState: () => yt.state,
      isYouTubeActive: () => yt.active,
      youtubeStop: () => { yt.active = false; yt.state = 'PAUSED'; },
      youtubeResume: () => true,
      youtubePause: () => true,
      youtubeSeek: () => true,
    } as unknown as Parameters<typeof backendAdapters.__setAdapterModulesForTest>[0]['youtube'];
    backendAdapters.__setAdapterModulesForTest({ youtube: fakeYtModule });
    return backendAdapters;
  }

  const YT_ITEM = { id: 'yt1', uri: 'piped:VIDEOID123', title: 'Şarkı', artist: 'Sanatçı' };
  const YT_REQUEST = { items: [YT_ITEM], startIndex: 0, positionMs: 0, autoPlay: true };

  /** LOCAL tarafı için gerçek adaptöre gerek yok — F7.6/koordinatör kilitleri
   *  zaten `mediaAuthority.test.ts`te gerçek native köprüyle kilitlidir; burada
   *  sahte bir LOCAL adaptörü YALNIZ "eski kaynak durur" davranışını gözlemler. */
  function fakeLocalAdapter(startedFlag: { active: boolean }) {
    const calls: string[] = [];
    return {
      sourceClass: 'LOCAL' as const,
      calls,
      isActive: () => startedFlag.active,
      async stop() {
        calls.push('stop');
        startedFlag.active = false;
        return { accepted: true, verified: true, failureCode: null };
      },
      async prepare() {
        calls.push('prepare');
        return { ready: true, failureCode: null };
      },
      async start() {
        calls.push('start');
        startedFlag.active = true;
        return { accepted: true, started: true, renderingVerified: true, failureCode: null };
      },
    };
  }

  it('1 · Piped sonucundan gerçek IFrame kanıtı geldiğinde backend GERÇEKTEN başlar', async () => {
    const backendAdapters = await loadAdapters();
    const { createSourceCoordinator } = await import('../platform/media/authority/sourceCoordinator');
    const coord = createSourceCoordinator({
      now: () => Date.now(),
      adapters: new Map([['YOUTUBE', backendAdapters.createYouTubeAdapter()]]) as never,
    });

    const pending = coord.switchTo('YOUTUBE' as never, YT_REQUEST as never);
    // Kanıt GECİKMELİ gelir (gerçek autoplay/ağ gecikmesi benzetimi).
    await vi.advanceTimersByTimeAsync(50);
    yt.state = 'BUFFERING';
    await vi.advanceTimersByTimeAsync(150);
    yt.state = 'PLAYING';
    await vi.advanceTimersByTimeAsync(150);

    const out = await pending;
    expect(out.ok, `beklenmeyen hata: ${out.failureCode}`).toBe(true);
    expect(yt.playCalls[0]?.videoId).toBe('VIDEOID123');
  });

  it('2 · Başarılı devir sonrası activeSource=YOUTUBE olur', async () => {
    const backendAdapters = await loadAdapters();
    const { createSourceCoordinator } = await import('../platform/media/authority/sourceCoordinator');
    const coord = createSourceCoordinator({
      now: () => Date.now(),
      adapters: new Map([['YOUTUBE', backendAdapters.createYouTubeAdapter()]]) as never,
    });
    yt.state = 'PLAYING';
    const pending = coord.switchTo('YOUTUBE' as never, YT_REQUEST as never);
    await vi.advanceTimersByTimeAsync(150);   // ilk poll tick'i (kanıt ZATEN hazır)
    const out = await pending;
    expect(out.ok).toBe(true);
    expect(coord.getActiveSource()).toBe('YOUTUBE');
  });

  it('3 · LOCAL çalarken YOUTUBE istenirse LOCAL DURUR, tek ses korunur', async () => {
    const backendAdapters = await loadAdapters();
    const { createSourceCoordinator } = await import('../platform/media/authority/sourceCoordinator');
    const localFlag = { active: true };
    const local = fakeLocalAdapter(localFlag);
    const coord = createSourceCoordinator({
      now: () => Date.now(),
      adapters: new Map([
        ['LOCAL', local], ['YOUTUBE', backendAdapters.createYouTubeAdapter()],
      ]) as never,
    });
    yt.state = 'PLAYING';
    const pending = coord.switchTo('YOUTUBE' as never, YT_REQUEST as never);
    await vi.advanceTimersByTimeAsync(150);
    const out = await pending;
    expect(out.ok).toBe(true);
    expect(local.calls).toContain('stop');
    expect(localFlag.active).toBe(false);
    expect(coord.audibleBackends()).toBeLessThanOrEqual(1);
  });

  it('4 · Gerçek kanıt HİÇ gelmezse (autoplay engeli) SAHTE PLAYING üretilmez', async () => {
    const backendAdapters = await loadAdapters();
    const { createSourceCoordinator } = await import('../platform/media/authority/sourceCoordinator');
    const coord = createSourceCoordinator({
      now: () => Date.now(),
      adapters: new Map([['YOUTUBE', backendAdapters.createYouTubeAdapter()]]) as never,
    });
    // Tarayıcı otoyoklaması engelledi: player PAUSED'da takılı kalır.
    yt.state = 'PAUSED';
    const pending = coord.switchTo('YOUTUBE' as never, YT_REQUEST as never);
    await vi.advanceTimersByTimeAsync(3000);   // bütçe (2600ms) dolar
    const out = await pending;

    expect(out.ok, 'PAUSED kanıt sayılmamalıydı — sahte VERIFIED üretildi').toBe(false);
    expect(out.committed).not.toBe('YOUTUBE');
    expect(out.renderingVerified).toBe(false);
    expect(coord.audibleBackends()).toBeLessThanOrEqual(1);
  });

  it('5 · Devrin HER fazında audibleBackendCount <= 1', async () => {
    const backendAdapters = await loadAdapters();
    const { createSourceCoordinator } = await import('../platform/media/authority/sourceCoordinator');
    const localFlag = { active: true };
    const local = fakeLocalAdapter(localFlag);
    const seen: number[] = [];
    const coord = createSourceCoordinator({
      now: () => Date.now(),
      adapters: new Map([
        ['LOCAL', local], ['YOUTUBE', backendAdapters.createYouTubeAdapter()],
      ]) as never,
      onTransition: () => { seen.push(coord.audibleBackends()); },
    });
    yt.state = 'PLAYING';
    const pending = coord.switchTo('YOUTUBE' as never, YT_REQUEST as never);
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((n) => expect(n).toBeLessThanOrEqual(1));
  });

  it('6 · Akış çözümü BAŞARISIZ olursa dürüst FAILED — çökme/sahte başarı YOK', async () => {
    const backendAdapters = await loadAdapters();
    const { createSourceCoordinator } = await import('../platform/media/authority/sourceCoordinator');
    const coord = createSourceCoordinator({
      now: () => Date.now(),
      adapters: new Map([['YOUTUBE', backendAdapters.createYouTubeAdapter()]]) as never,
    });
    yt.playShouldThrow = true;   // playYouTube (loadVideoById zinciri) reddetti
    const out = await coord.switchTo('YOUTUBE' as never, YT_REQUEST as never);
    expect(out.ok).toBe(false);
    expect(out.failureCode).toBe('start_threw');
    expect(out.committed).not.toBe('YOUTUBE');

    // ensureYouTubeReady (prepare) reddederse de aynı dürüstlük.
    yt.playShouldThrow = false;
    yt.ensureReadyShouldThrow = true;
    const out2 = await coord.switchTo('YOUTUBE' as never, YT_REQUEST as never);
    expect(out2.ok).toBe(false);
    expect(out2.failureCode).toBe('youtube_iframe_unavailable');
  });

  it('7 · F7.6 · adapter kendi kuyruk/oturum otoritesini KURMAZ — tek öğeyi ÇÖZER', () => {
    const src = read('src/platform/media/authority/backendAdapters.ts');
    const ytSection = src.slice(src.indexOf('2) YouTube IFrame'), src.indexOf('3) Spotify Connect'));
    expect(ytSection, 'YouTube bölümü ikinci bir kuyruk/oturum kurucusu import etmiş')
      .not.toMatch(/buildProviderQueueContext|startProviderListening|listeningSessionRuntime/);
    // extractVideoId yalnız İSTENEN öğeden okur — kendi arama/kuyruk YAPMAZ.
    expect(src).toContain('function extractVideoId(uri: string): string');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8-12 · MINIPLAYER / DOCKBAR ÇAKIŞMASI
 * ════════════════════════════════════════════════════════════════════════ */

describe('MUSIC MINIPLAYER FIELD FIX — dock ile ÇAKIŞMAZ, ikinci otorite KURULMAZ', () => {
  // Yorum-güvenli okuma: bu turun kendi bugfix yorumları eski hatayı (`bottom: 12`,
  // "ResizeObserver") ANLATIR — kilit KODA bakmalı, yorum cümlesine değil.
  const miniPlayer = readCode('src/components/media/MiniPlayer.tsx');
  const mainLayout = readCode('src/components/layout/MainLayout.tsx');
  const dockBar = readCode('src/components/layout/DockBar.tsx');

  it('8 · MiniPlayer artık ham piksel DEĞİL, dock\'un GERÇEK yüksekliğine çapalı', () => {
    expect(miniPlayer, 'ham piksel bottom geri gelmiş — dock çakışması riski')
      .not.toMatch(/bottom:\s*12\b/);
    expect(miniPlayer, 'MiniPlayer --lp-dock-h kanonik çapasını kullanmıyor')
      .toContain("bottom: 'calc(var(--lp-dock-h");
  });

  it('9 · Kanonik `--lp-dock-h` deseni tek yayıncıdan (DockBar) beslenir — MiniPlayer ikinci yayıncı KURMAZ', () => {
    expect(dockBar, 'DockBar kendi yüksekliğini artık yayınlamıyor').toMatch(/--lp-dock-h/);
    expect(miniPlayer, 'MiniPlayer kendi --lp-dock-h değerini YAZIYOR — ikinci otorite')
      .not.toMatch(/setProperty\(\s*['"]--lp-dock-h/);
    expect(miniPlayer, 'MiniPlayer\'da ResizeObserver kurulmuş — ikinci ölçüm otoritesi')
      .not.toContain('ResizeObserver');
  });

  it('10 · Full Music/Now Playing açıkken görünürlük TEK otoriteden (musicSurfaceVisibilityModel) gelir', () => {
    expect(mainLayout, 'MiniPlayer görünürlüğü kanonik modelden ayrılmış')
      .toContain('musicSurfaceVisibilityModel');
    // MiniPlayer bileşeni kendi başına Now Playing/drawer durumunu OKUMAZ —
    // parent zaten `showMiniPlayer` ile şart koşuyor (çift render otoritesi yok).
    expect(miniPlayer, 'MiniPlayer kendi drawer/nowPlaying durumunu okumuş — ikinci görünürlük otoritesi')
      .not.toMatch(/drawerOpen|nowPlayingOpen/);
  });

  it('11 · MiniPlayer içinde YENİ bir component-local görünürlük state\'i YOK', () => {
    expect(miniPlayer, 'useState ile ikinci görünürlük durumu eklenmiş').not.toContain('useState');
    // Tek erken-çıkış kapısı: canonical view model alanı (ikinci otorite değil,
    // parent'ın zaten kullandığı AYNI alan).
    expect(miniPlayer).toContain('if (!music.hasListeningContext) return null;');
  });

  it('12 · Dock her durumda erişilebilir kalır — MiniPlayer z-index\'i rastgele YÜKSELTİLMEMİŞ', () => {
    const miniZ = miniPlayer.match(/z-\[(\d+)\]/)?.[1];
    const dockZ = dockBar.match(/zIndex:\s*(\d+)/)?.[1];
    expect(miniZ, 'MiniPlayer z-index kilidi bulunamadı').toBeDefined();
    expect(dockZ, 'DockBar z-index kilidi bulunamadı').toBeDefined();
    // Dock kendi fixed katmanında sabit kalır; MiniPlayer üstte ama dock ALANININ
    // DIŞINA (bottom offset ile) taşındığı için görsel örtüşme YOKTUR — z-index
    // ilişkisi bu turda DEĞİŞMEDİ (rastgele eskalasyon yok).
    expect(miniZ).toBe('900');
    expect(dockZ).toBe('100');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 13-17 · VİDEO POLİTİKASI — hız artık HARD-BLOCK ÜRETMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MUSIC VIDEO POLICY FIELD FIX — hareket video açmayı REDDEDEMEZ', () => {
  // Yorum-güvenli okuma: bu turun bugfix yorumları eski `useVideoSafety`/
  // `decideVideoVisibility` referanslarını AÇIKLAR — kilit KODA bakmalı.
  const mediaScreen = readCode('src/components/media/MediaScreen.tsx');
  const voiceHandler = readCode('src/hooks/useVoiceCommandHandler.ts');
  const policy = readCode('src/platform/media/videoSafetyPolicy.ts');
  const videoModeStore = readCode('src/platform/media/videoModeStore.ts');

  it('13 · Araç hareket hâlinde video render/açma REDDİ üretilemez (MediaScreen kapısı kaldırıldı)', () => {
    expect(mediaScreen).not.toContain('useVideoSafety');
    expect(mediaScreen).not.toMatch(/videoSafety\.allowed/);
  });

  it('14 · `drivingMode` TEK BAŞINA video görünürlük efektini ETKİLEMEZ (video efekti yalnız isYouTube/videoMode\'a bağlı)', () => {
    // MediaScreen genel olarak drivingMode'u OKUR (yerleşim/NowPlaying için —
    // bu meşrudur), ama YouTube video görünürlük efekti SADECE isYouTube/videoMode
    // bağımlılık dizisine sahiptir — drivingMode ORAYA sızmamış olmalı.
    const effectStart = mediaScreen.indexOf('if (!isYouTube) return;');
    expect(effectStart, 'video görünürlük efekti kilit metninde bulunamadı — kaynak değişmiş').toBeGreaterThan(0);
    const effectEnd = mediaScreen.indexOf('}, [isYouTube, videoMode]);', effectStart);
    expect(effectEnd, 'efektin bağımlılık dizisi bulunamadı — kaynak değişmiş').toBeGreaterThan(effectStart);
    const effectBlock = mediaScreen.slice(effectStart, effectEnd + 40);
    expect(effectBlock, 'video görünürlük efekti drivingMode\'a bağlanmış').not.toContain('drivingMode');
  });

  it('15/16 · Video aç/kapa ses/oturum otoritesine KOMUT GÖNDERMEZ (playback state bozulmaz)', () => {
    // videoModeStore SAF kalır: mediaCommandGateway/sourceCoordinator'a dokunmaz.
    expect(videoModeStore).not.toContain('mediaCommandGateway');
    expect(videoModeStore).not.toContain('sourceCoordinator');
    // Sesli komut handler'ı da video aç/kapatırken playback komutu YOLLAMAZ —
    // yalnız drawer açar + videoModeStore'u günceller.
    const handlerBlock = voiceHandler.slice(
      voiceHandler.indexOf('setVideoMode: (on) => {'),
      voiceHandler.indexOf('setVideoMode: (on) => {') + 300,
    );
    expect(handlerBlock).not.toMatch(/mediaCommandGateway|\bpause\(|\bstop\(/);
  });

  it('17 · videoSafetyPolicy playback authority DEĞİLDİR (silinmedi, ama gate\'lemiyor)', () => {
    // Saf sınıflandırma modülü hâlâ var (gelecekteki opt-in mevzuat politikası için).
    expect(policy).toContain('export function decideVideoVisibility');
    expect(policy, 'video sınıflandırması ses/playback otoritesine karışmış')
      .not.toMatch(/mediaCommandGateway|sourceCoordinator|duckPolicy/);
    // Ama artık HİÇBİR üretim tüketicisi onu bir GATE olarak kullanmıyor.
    expect(mediaScreen).not.toContain('decideVideoVisibility');
    expect(voiceHandler).not.toContain('decideVideoVisibility');
  });
});
