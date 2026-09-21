/**
 * musicYoutubeStartAndHomeSurface.test.ts — 2026-09-05 SAHA TURU.
 *
 * İKİ AYRI SAHA PROBLEMİ, İKİ KİLİT KÜMESİ.
 *
 * ── A · YOUTUBE BULUNUYOR AMA SES ÇALMIYOR ────────────────────────────────
 * Ölçülen zincir: arama → kuyruk → `sourceCoordinator` → adapter → `prepare()`
 * → `ensureYouTubeReady()`. Kusur `prepare` aşamasındaydı ve ÜÇ yapısal
 * kaynağı vardı — hiçbiri hata ÜRETMİYOR, sessizce SONSUZA KADAR bekliyordu:
 *   1. Player, `display:none` bir konteynerde kuruluyordu → iframe 0×0, Android
 *      WebView düzen/boya yapmıyor, `onReady` gecikiyor ya da hiç gelmiyor.
 *   2. `_loadApi()` script `onerror`/zaman aşımı taşımıyordu; `_apiLoading`
 *      bir daha `false` olmuyor ve bekleyen `setInterval` temizlenmiyordu.
 *   3. `ensureYouTubeReady()` promise'i KOŞULSUZ önbelleğe alıyordu → ilk
 *      başarısız deneme (ör. açılışta ağ yokken çalışan `preload`) oturumun
 *      geri kalanını ZEHİRLİYORDU.
 * Sonuç: `sourceCoordinator` LOCAL'i durdurup 4 sn'lik `prepare` bütçesinde
 * takılıyor, sessizlik kalıyordu.
 *
 * ── B · KOKPİTTE İKİNCİ MÜZİK ÇUBUĞU ──────────────────────────────────────
 * Ürün kararı: ana home/navigasyon ekranında alttaki geniş MiniPlayer YOK;
 * sağ üstteki Müzik kartı yeterli.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const YT = read('src/platform/youtubeService.ts');
const ADAPTERS = read('src/platform/media/authority/backendAdapters.ts');

/* ══ A · YOUTUBE GERÇEK BAŞLANGIÇ ════════════════════════════════════════ */

describe('A · YouTube hazırlık zinciri — sessiz sonsuz bekleme YOK', () => {
  it('🔒 player `display:none` konteynerde KURULMAZ (iframe 0×0 → onReady gelmez)', () => {
    const i = YT.indexOf('function _ensureHost(');
    const gövde = YT.slice(i, i + 1800);
    expect(gövde, 'host hâlâ display:none ile kuruluyor')
      .not.toMatch(/cssText[\s\S]{0,400}display:none/);
    expect(gövde, 'host render edilmiyor').toContain('display:block');
    /* Ekran dışında ve görünmez: ses çalar, video UI\'ı kaplamaz. */
    expect(gövde).toContain('visibility:hidden');
    expect(gövde).toMatch(/left:-10000px/);
    /* 0×0 iframe tuzağı: konteynerin ÖLÇÜSÜ olmalı. */
    expect(gövde).toMatch(/width:\s*\d+px/);
    expect(gövde).toMatch(/height:\s*\d+px/);
  });

  it('🔒 API yüklemesi SINIRLI: script hatası ve zaman aşımı yakalanır', () => {
    const i = YT.indexOf('function _loadApi(');
    const gövde = YT.slice(i, YT.indexOf('\n}', i));
    expect(gövde, 'script onerror yok — indirilemezse sonsuz bekler').toContain('tag.onerror');
    expect(gövde, 'zaman aşımı yok').toContain('API_LOAD_TIMEOUT_MS');
    expect(gövde, 'promise reddedilemiyor').toContain('reject(');
  });

  it('🔒 API yüklemesi başarısızlıkta ZEHİRLEMEZ ve SIZDIRMAZ', () => {
    const i = YT.indexOf('function _loadApi(');
    const gövde = YT.slice(i, YT.indexOf('\n}', i));
    expect(gövde, '_apiLoading sıfırlanmıyor — oturum kalıcı bozulur')
      .toContain('_apiLoading = false');
    expect(gövde, 'bekleyen interval temizlenmiyor (zero-leak ihlali)')
      .toContain('clearInterval(iv)');
    expect(gövde).toContain('clearTimeout(to)');
  });

  it('🔒 `ensureYouTubeReady` başarısız denemeyi ÖNBELLEKTE TUTMAZ', () => {
    const i = YT.indexOf('export function ensureYouTubeReady(');
    const gövde = YT.slice(i, i + 3200);
    expect(gövde, 'başarısız promise temizlenmiyor — kalıcı zehirlenme')
      .toMatch(/_readyPromise === attempt.*_readyPromise = null/s);
    expect(gövde, 'yarım kurulmuş player bırakılıyor').toMatch(/_player = null/);
    expect(gövde, 'onReady için zaman aşımı yok').toContain('PLAYER_READY_TIMEOUT_MS');
  });

  it('🔒 hazırlık bütçesi koordinatörün ADIM bütçesinden KISA (dürüst hata kodu)', () => {
    const api = Number(/const API_LOAD_TIMEOUT_MS = (\d+)/.exec(YT)?.[1]);
    const rdy = Number(/const PLAYER_READY_TIMEOUT_MS = (\d+)/.exec(YT)?.[1]);
    const step = Number(
      /const DEFAULT_STEP_TIMEOUT_MS = (\d+)/.exec(
        read('src/platform/media/authority/sourceCoordinator.ts'),
      )?.[1],
    );
    expect(api).toBeGreaterThan(0);
    expect(rdy).toBeGreaterThan(0);
    expect(step).toBeGreaterThan(0);
    /* Aksi hâlde koordinatör önce zaman aşımına düşer ve sebep jenerik
       `prepare_timeout` olur — hangi halkanın koptuğu KAYBOLUR. */
    expect(Math.max(api, rdy), 'hazırlık bütçesi adım bütçesini aşıyor').toBeLessThan(step);
  });

  it('🔒 otoyoklama dürtmesi VAR ama sahte kanıt ÜRETMEZ', () => {
    expect(YT, 'playVideo dürtmesi yok — CUE\'da (state 5) takılabilir')
      .toContain('_player.playVideo?.()');
    /* Kanıt hâlâ player\'ın KENDİ durumundan okunur — bayraktan değil. */
    expect(ADAPTERS).toContain('waitForRealYouTubeStart');
    /* Eski kusurlu satır `started`ı `activePackage` BAYRAĞINDAN türetiyordu.
       Kanıt artık yalnız player durumundan gelir. */
    const ytStart = ADAPTERS.slice(
      ADAPTERS.indexOf('export function createYouTubeAdapter('),
      ADAPTERS.indexOf('/* ── 3) Spotify Connect'),
    );
    expect(ytStart, 'YouTube başlangıç kanıtı yine bayrağa bağlanmış')
      .not.toMatch(/const started = [\s\S]{0,120}activePackage/);
    expect(ytStart).toContain('const started = await waitForRealYouTubeStart');
  });

  it('🔒 başarısızlık DÜRÜST kodla döner (sahte başarı YOK)', () => {
    /* YALNIZ YouTube adapter bölümü — dosyada birden çok `prepare` var. */
    const yt = ADAPTERS.slice(
      ADAPTERS.indexOf('export function createYouTubeAdapter('),
      ADAPTERS.indexOf('/* ── 3) Spotify Connect'),
    );
    const gövde = yt.slice(yt.indexOf('async prepare(request: PlayRequest)'));
    expect(gövde).toContain('youtube_iframe_unavailable');
    expect(gövde).toContain('invalid_video_id');
    expect(ADAPTERS).toContain('playback_not_observed');
  });

  it('🔒 teşhis SINIRLI ve SALT-OKUNUR (kullanıcı verisi taşımaz)', () => {
    expect(YT).toContain('getYouTubeReadinessDiagnostics');
    const i = YT.indexOf('export function getYouTubeReadinessDiagnostics(');
    const gövde = YT.slice(i, i + 500);
    /* Video kimliği/başlığı SIZMAZ — yalnız sebep etiketi ve sayaç. */
    expect(gövde).not.toContain('_currentVideoId');
    expect(gövde).not.toContain('title');
    expect(YT, 'sınırsız geçmiş listesi tutulmuş').not.toMatch(/_ytFailures\.push/);
  });

  it('🔒 İKİNCİ player otoritesi kurulmadı', () => {
    const players = YT.match(/new w\.YT!?\.Player\(/g) ?? [];
    expect(players.length, 'birden fazla YT.Player kurulum noktası').toBe(1);
  });
});

/* ══ A2 · GÖMME REDDİ ZİNCİRİ — KUYRUK YAKILMAZ ═════════════════════════ */

describe('A2 · gömme reddi kuyruğu sonuna kadar yürütemez', () => {
  const LAYER = read('src/platform/media/carosMediaLayer.ts');

  it('🔒 ardışık red SAYILIR ve üst sınır VAR (eski kodda kuyrukta sınır YOKTU)', () => {
    expect(LAYER).toContain('YT_MAX_CONSECUTIVE_UNPLAYABLE');
    expect(LAYER).toContain('_ytConsecutiveUnplayable');
    const n = Number(/YT_MAX_CONSECUTIVE_UNPLAYABLE = (\d+)/.exec(LAYER)?.[1]);
    expect(n).toBeGreaterThan(0);
    expect(n, 'sınır o kadar yüksek ki 20lik kuyruk yine yanar').toBeLessThanOrEqual(5);
  });

  it('🔒 üst sınır ÇOK-PARÇALI daldan ÖNCE denetlenir (kusurun tam yeri)', () => {
    const i = LAYER.indexOf('async function _recoverYouTube(');
    const govde = LAYER.slice(i, LAYER.indexOf('setYouTubeOnUnplayable', i));
    const capIdx = govde.indexOf('_ytConsecutiveUnplayable > YT_MAX_CONSECUTIVE_UNPLAYABLE');
    const nextIdx = govde.indexOf('entries.length > 1');
    expect(capIdx, 'ardışık red kapısı yok').toBeGreaterThan(-1);
    expect(nextIdx).toBeGreaterThan(-1);
    expect(capIdx, 'kapı next() dalından SONRA — kuyruk yine yanar').toBeLessThan(nextIdx);
  });

  it('🔒 sayaç ZAMAN PENCERESİYLE sıfırlanır (yeni zamanlayıcı otoritesi YOK)', () => {
    expect(LAYER).toContain('YT_UNPLAYABLE_WINDOW_MS');
    expect(LAYER).toMatch(/_ytLastUnplayableAt > YT_UNPLAYABLE_WINDOW_MS/);
    expect(LAYER, 'pencere için setInterval/setTimeout kurulmuş — ikinci otorite')
      .not.toMatch(/set(Interval|Timeout)\([^)]*_ytConsecutiveUnplayable/);
  });

  it('🔒 KURTARMA kendi  çağrısında geçmişi TEMİZLEMEZ', () => {
    /* Eski kod her kurtarmada _ytFailedIds setini siliyordu → size > 6
       vazgeçme kapısı hiç tetiklenemiyordu (sonsuz arama riski). */
    expect(LAYER).toContain('_ytRecoveryPlay');
    const i = LAYER.indexOf('export function playMedia(');
    expect(LAYER.slice(i, i + 500), 'geçmiş koşulsuz temizleniyor')
      .toMatch(/if \(!_ytRecoveryPlay\) \{/);
  });

  it('🔒 zincir SESSİZ değil — sınırlı, salt-okunur teşhis var (PII yok)', () => {
    expect(LAYER).toContain('getYouTubeSkipDiagnostics');
    const i = LAYER.indexOf('export function getYouTubeSkipDiagnostics(');
    const govde = LAYER.slice(i, i + 320);
    for (const pii of ['title', 'artist', 'videoId', 'streamUrl']) {
      expect(govde, ).not.toContain(pii);
    }
    expect(LAYER).toContain('embed_blocked_chain');
  });

  it('🔒 vazgeçince SAHTE oynatma iddiası kurulmaz', () => {
    /* youtubeService._onError zaten playing:false yazar; katman vazgeçerken
       bunu EZMEZ — hiçbir yerde playing:true yazılmaz. */
    const i = LAYER.indexOf('_ytSkipDiag.gaveUp += 1');
    expect(LAYER.slice(i, i + 400)).not.toMatch(/playing:\s*true/);
  });
});

/* ══ A2b · DOĞRUDAN SES AKIŞI YEDEĞİ — KALICI ÇÖZÜM ═══════════════════ */

describe('A2b · gömme reddinde GERÇEKTEN çal — IFrame yerine doğrudan ses akışı', () => {
  /* ÖLÇÜM: kullanıcı A2 düzeltmesinden (kuyruk yakmayı durdurma) SONRA da
     bildirdi — "gömülü YouTube müzik çalmıyor" ve gerçek cihazda YouTube'un
     KENDİ "Video kullanılamıyor" kartı görüldü (rights-holder gömme kısıtı,
     101/150). A2 arızayı GÖRÜNÜR kıldı ama videoyu ÇALDIRMADI. Bu bölüm
     kalıcı çözümü kilitler: IFrame gömülemezse aynı YouTube backend'i
     (ikinci otorite AÇILMADAN) `pipedProvider`'ın zaten var olan
     `resolvePipedStream`ini kullanarak doğrudan ses akışına düşer. */

  it('onError (100/101/150/2) ANINDA yedeği dener — önce _onUnplayable\'a atlamaz', () => {
    const i = YT.indexOf('function _onError(');
    const bitis = YT.indexOf('\nfunction _onState', i);
    const govde = YT.slice(i, bitis);
    expect(govde, 'yedek denenmiyor').toContain('_tryAudioFallback(');
    expect(govde, 'yedek başarısız OLMADAN _onUnplayable çağrılıyor')
      .toContain('_onUnplayable');
    expect(govde.indexOf('_tryAudioFallback')).toBeLessThan(govde.indexOf('_onUnplayable'));
  });

  it('sessiz otoyoklama reddi de yakalanır (onError HİÇ gelmeyebilir)', () => {
    expect(YT).toContain('EMBED_CHECK_MS');
    expect(YT).toContain('_embedCheckTimer = window.setTimeout');
    expect(YT).toContain('_iframeState()');
  });

  it('yedek bütçesi koordinatörün başlangıç kanıtı bütçesinden KISA', () => {
    const embedMs = Number(/const EMBED_CHECK_MS = (\d+)/.exec(YT)?.[1]);
    const evidenceMs = Number(/const START_EVIDENCE_TIMEOUT_MS = (\d+)/.exec(ADAPTERS)?.[1]);
    expect(embedMs).toBeGreaterThan(0);
    expect(evidenceMs).toBeGreaterThan(0);
    expect(embedMs, 'embed-check penceresi kanıt bütçesini aşıyor').toBeLessThan(evidenceMs);
  });

  it('yedek MEVCUT altyapıyı yeniden kullanır — ikinci bir çözücü İCAT EDİLMEDİ', () => {
    expect(YT, 'pipedProvider yeniden kullanılmıyor').toContain("./media/pipedProvider");
    expect(YT).toContain('resolvePipedStream');
  });

  it('yedek İKİNCİ BİR KAYNAK SINIFI AÇMAZ — activePackage YOUTUBE_PKG kalır', () => {
    const i = YT.indexOf('async function _tryAudioFallback(');
    const bitis = YT.indexOf('\nfunction _clearEmbedCheck', i);
    const govde = YT.slice(i, bitis);
    for (const yasak of ['STREAM_PKG', 'sourceCoordinator', 'mediaCommandGateway']) {
      expect(govde, `yedek ${yasak} kullanıyor — ikinci otorite`).not.toContain(yasak);
    }
  });

  it('GEÇ gelen yedek yanlış videoya atlanmaz (kullanıcı arada başka parça seçmiş olabilir)', () => {
    expect(YT).toContain('_audioFallbackAttempt');
    const i = YT.indexOf('async function _tryAudioFallback(');
    const bitis = YT.indexOf('\nfunction _clearEmbedCheck', i);
    const govde = YT.slice(i, bitis);
    expect(govde, 'bayat sonuç denetimi yok — yarış durumu riski')
      .toContain('attempt !== _audioFallbackAttempt');
  });

  it('transport (resume/pause/seek) yedek aktifken ONA yönlenir', () => {
    for (const fn of ['youtubeResume', 'youtubePause', 'youtubeSeek']) {
      const i = YT.indexOf(`export function ${fn}(`);
      expect(i, `${fn} bulunamadı`).toBeGreaterThan(-1);
      expect(YT.slice(i, i + 300), `${fn} yedeği okumuyor`).toContain('_usingAudioFallback');
    }
  });

  it('youtubeStop yedek denemesini de BAYAT kılar ve elementi temizler', () => {
    const i = YT.indexOf('export function youtubeStop(');
    const bitis = YT.indexOf('\nexport function isYouTubeActive', i);
    const govde = YT.slice(i, bitis);
    expect(govde).toContain('_audioFallbackAttempt += 1');
    expect(govde, 'ses elementi temizlenmiyor').toContain("removeAttribute('src')");
  });

  it('gerçek kanıt yedekten okunur — sahte PLAYING üretilmez', () => {
    const i = YT.indexOf('export function getYouTubePlaybackState(');
    const bitis = YT.indexOf('\nexport function youtubeSeek', i);
    const govde = YT.slice(i, bitis);
    expect(govde).toContain('_usingAudioFallback');
    expect(govde, 'audio.paused okunmuyor — kanıt uydurulmuş').toContain('_audioEl.paused');
  });

  it('video kullanılamıyor durumu GÖZLENEBİLİR (UI ham IFrame kartını gizleyebilsin)', () => {
    expect(YT).toContain('isYouTubeVideoAvailable');
    expect(YT).toContain('subscribeYouTubeVideoAvailability');
  });

  it('teşhis yeni sebep etiketleri taşır, PII yine YOK', () => {
    for (const reason of ['audio_fallback_no_stream', 'audio_fallback_failed']) {
      expect(YT).toContain(reason);
    }
  });
});

/* ══ A3 · VİDEO OYNATMA VARSAYILAN AÇIK ════════════════════════════════ */

describe('A3 · video oynatma varsayılan AÇIK (2026-09-05 ürün kararı)', () => {
  const STORE = read('src/platform/media/videoModeStore.ts');
  const SCREEN = read('src/components/media/MediaScreen.tsx');

  it('🔒 varsayılan AÇIK — kullanıcı her seferinde düğmeye basmaz', async () => {
    expect(STORE, 'varsayılan hâlâ kapalı').toMatch(/let _videoMode = true;/);
    const mod = await import('../platform/media/videoModeStore');
    mod._resetVideoModeForTest();
    expect(mod.getVideoMode(), 'video modu kapalı başlıyor').toBe(true);
  });

  it('🔒 kullanıcı KAPATABİLİR ve seçimi korunur (varsayılan tercihi ezmez)', async () => {
    const mod = await import('../platform/media/videoModeStore');
    mod._resetVideoModeForTest();
    mod.toggleVideoMode();
    expect(mod.getVideoMode()).toBe(false);
    mod.setVideoMode(true);
    expect(mod.getVideoMode()).toBe(true);
  });

  it('🔒 bu bayrak YALNIZ GÖRÜNÜRLÜK — playback otoritesi DEĞİL', () => {
    /* Cross-Domain §6: görünüm katmanı playback truth üretmez. Depo hiçbir
       oynatma komutu çağırmaz, hiçbir playback alanı yazmaz. */
    for (const yasak of ['playYouTube', 'mediaCommandGateway', 'updateMediaState',
      'playing', 'sourceCoordinator']) {
      expect(STORE, 'video modu deposu playback otoritesine dokunuyor').not.toContain(yasak);
    }
  });

  it('🔒 hız/hareket videoyu REDDEDEMEZ (2026-09-03 kararı korunuyor)', () => {
    const i = SCREEN.indexOf('if (!isYouTube) return;');
    const govde = SCREEN.slice(i, i + 1200);
    expect(govde, 'video görünürlüğü yeniden hız kapısına bağlanmış')
      .not.toMatch(/useVideoSafety|decideVideoVisibility|speedKmh/);
    expect(govde).toContain('setYouTubeRegion');
  });

  it('🔒 abonelikler SIZDIRMAZ (zero-leak)', async () => {
    const mod = await import('../platform/media/videoModeStore');
    mod._resetVideoModeForTest();
    let n = 0;
    const off = mod.subscribeVideoMode(() => { n += 1; });
    mod.setVideoMode(false);
    off();
    mod.setVideoMode(true);
    expect(n, 'abonelik çözüldükten sonra da tetikleniyor').toBe(1);
  });
});

/* ══ B · KOKPİT YÜZEYİ ═══════════════════════════════════════════════════ */

describe('B · kokpitte ikinci müzik çubuğu YOK', () => {
  const shell = read('src/components/layout/MainLayout.tsx');
  const home = read('src/components/layout/NewHomeLayout.tsx');

  it('🔒 kokpit kabuğu MiniPlayer RENDER ETMEZ ve IMPORT ETMEZ', () => {
    expect(shell).not.toMatch(/<MiniPlayer\b/);
    expect(shell).not.toMatch(/from '\.\.\/media\/MiniPlayer'/);
  });

  it('🔒 ölü bileşen ve ölü politika dosyası GERİ GELMEZ', () => {
    for (const dead of [
      'src/components/media/MiniPlayer.tsx',
      'src/components/media/musicSurfaceVisibilityModel.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), dead)), `${dead} geri gelmiş`).toBe(false);
    }
  });

  it('🔒 sağ üst Müzik kartı DURUYOR ve tam transportu taşıyor', () => {
    expect(home, 'MusicCard kaldırılmış').toContain('const MusicCard = memo(');
    expect(home).toContain('<MusicCard />');
    for (const parça of ['track.albumArt', 'track.title', 'track.artist',
      'previous()', 'togglePlayPause()', 'next()']) {
      expect(home, `Müzik kartında ${parça} yok`).toContain(parça);
    }
  });

  it('🔒 Müzik kartı KANONİK transportu kullanır — provider/native\'e doğrudan komut YOK', () => {
    /* Kuyruk-farkında yol: `carosMediaLayer.next/previous` + `mediaService`
       kapısı. Kart doğrudan YouTube/stream servisine komut GÖNDERMEZ. */
    expect(home).toContain("from '../../platform/media/carosMediaLayer'");
    expect(home, 'kart doğrudan youtubeService sürüyor — ikinci transport')
      .not.toContain('youtubeService');
    expect(home, 'kart doğrudan native köprüye yazıyor')
      .not.toMatch(/nativeAuthorityBridge|CarLauncher\.\w+/);
  });

  it('🔒 Müzik kartı KENDİ playback durumunu üretmez (tek gerçek)', () => {
    const i = home.indexOf('const MusicCard = memo(');
    const gövde = home.slice(i, home.indexOf('\n});', i));
    expect(gövde, 'kart kanonik projeksiyonu okumuyor').toContain('useMediaState()');
    expect(gövde, 'kartta ikinci playback state kurulmuş').not.toMatch(/useState<.*playing/i);
  });

  it('🔒 YouTube transportu kartta da KAPIDAN geçer', () => {
    const svc = read('src/platform/mediaService.ts');
    const i = svc.indexOf("_current.activePackage === 'com.cockpitos.pro.youtube'");
    const gövde = svc.slice(i, i + 700);
    expect(gövde, 'YouTube transportu kapıyı atlıyor').toContain('mediaCommandGateway');
  });
});
