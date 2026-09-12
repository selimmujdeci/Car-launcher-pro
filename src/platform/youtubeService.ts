/**
 * YouTube IFrame Player servisi — YouTube'un resmî gömülü oynatıcısıyla
 * uygulama İÇİNDE çalma (harici uygulamaya gidilmez, hesap/Premium gerekmez).
 *
 * Neden bu yol: ham ses çıkarma (Piped /streams) YouTube'un bot-engeline
 * (LOGIN_REQUIRED) takılıyor. IFrame Player gerçek YouTube oynatıcısı olduğu
 * için bu engele takılmaz; arama Piped'den gelir, çalma buradan olur.
 *
 * Oynatıcı body'ye bağlı kalıcı bir host'ta yaşar → sekme değişse de ses sürer.
 * UI (MediaScreen) host'u albüm-kapağı alanına `setYouTubeRegion()` ile hizalar;
 * player sekmesinden çıkılınca köşeye küçülür (mini oynatıcı, ses devam eder).
 *
 * Not: Bu bir VIDEO oynatıcısıdır (ses-only değil) — ToS'un istediği yasal yol.
 */
import { updateMediaState, getMediaState } from './mediaService';
import { isLowEndDevice } from './headUnitCompat';
import { getDeviceTier } from './deviceCapabilities';

export const YOUTUBE_PKG = 'com.cockpitos.pro.youtube';

/**
 * loadVideoById argümanı — düşük donanımda (Mali-400 sınıfı head unit) videoyu
 * düşük çözünürlükte iste: GPU decode yükü ve kasma ciddi azalır. 800×480 ekranda
 * 'small' (240p) zaten yeterli. Capable cihazlarda 'default' (otomatik kalite).
 * YT bunu bir İPUCU olarak uygular; yok sayılırsa zararsız.
 */
function _loadArg(videoId: string): string | { videoId: string; suggestedQuality: string } {
  return isLowEndDevice() ? { videoId, suggestedQuality: 'small' } : videoId;
}

// Teşhis: setYouTubeRegion saniyede bir log atsın (rAF spam'ini önle).
let _lastRegionLog = 0;
function _logRegion(msg: string, data: Record<string, unknown>): void {
  const now = Date.now();
  if (now - _lastRegionLog < 1000) return;
  _lastRegionLog = now;
  console.warn('[YT-region]', msg, JSON.stringify(data));
}

/* ── YouTube IFrame Player API sözleşmesi ──────────────────────────────────
   Bu API'nin resmî TS tipi paketi YOK ve ekleyemeyiz (yeni bağımlılık + lisans
   denetimi). Bu yüzden YALNIZ KULLANDIĞIMIZ yüzey burada dar biçimde modellenir.
   Yöntemler opsiyonel: script yüklenirken/parçalı yüklendiğinde eksik olabilir
   (kod zaten `?.` ile çağırıyor — sözleşme bu gerçeği yansıtır). */
interface YtPlayer {
  /* Kod bunları `?.` OLMADAN çağırıyor (try/catch koruması var) → zorunlu. */
  loadVideoById(arg: string | { videoId: string; suggestedQuality: string }): void;
  playVideo():  void;
  pauseVideo(): void;
  setVolume(v: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  /* Kod bunları `?.` İLE çağırıyor (eski/parçalı player'da eksik olabilir). */
  mute?():           void;
  unMute?():         void;
  stopVideo?():      void;
  getPlayerState?(): number;
  getCurrentTime?(): number;
  getDuration?():    number;
}

/** Player olayları yalnız sayısal `data` taşır (durum kodu / hata kodu). */
interface YtEvent { data?: number }

interface YtPlayerOptions {
  width:      string;
  height:     string;
  playerVars: Record<string, number | string>;
  events: {
    onReady:       () => void;
    onStateChange: (e: YtEvent) => void;
    onError:       (e: YtEvent) => void;
  };
}

interface YtNamespace {
  Player: new (elementId: string, opts: YtPlayerOptions) => YtPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

/** IFrame API kendini `window` üzerine yazar. */
interface YtWindow {
  YT?: YtNamespace;
  onYouTubeIframeAPIReady?: () => void;
}

/** `window`u YT alanlarıyla birlikte gören dar görünüm (global kirletmeden). */
const _ytWindow = (): YtWindow => window as unknown as YtWindow;

let _player: YtPlayer | null = null;
let _apiLoading = false;
// Son uygulanan ses düzeyi (0–100). IFrame player web'de sistem sesinden bağımsızdır;
// bu yüzden ses jesti/slider buraya yönlenir. Yeni video yüklenince tekrar uygulanır.
let _volume = 100;
let _onEnded: (() => void) | null = null;
let _onUnplayable: ((videoId: string) => void) | null = null;
let _currentVideoId = '';
let _pollTimer: number | null = null;
let _host: HTMLDivElement | null = null;
let _readyPromise: Promise<void> | null = null;

/** Şu an çalan YouTube videosunun id'si (yoksa boş string). */
export function getCurrentYouTubeVideoId(): string {
  return _currentVideoId;
}

/** Parça doğal bitince çağrılacak kanca (kuyruk ilerletme için katman bağlar). */
export function setYouTubeOnEnded(cb: (() => void) | null): void {
  _onEnded = cb;
}

/** Video oynatılamadığında (gömme kapalı / kaldırılmış / geçersiz) çağrılır.
 *  Katman bunu aynı şarkının gömülebilir alternatifini bulmak için kullanır. */
export function setYouTubeOnUnplayable(cb: ((videoId: string) => void) | null): void {
  _onUnplayable = cb;
}

function _ensureHost(): HTMLDivElement {
  if (_host) return _host;
  const host = document.createElement('div');
  host.id = 'yt-player-host';
  // KRİTİK — Video Compositing Güvenliği:
  // Cross-origin YouTube iframe'inde `overflow:hidden`+`border-radius` KIRPMA, `box-shadow`
  // ve animasyonlu `opacity` bazı GPU'larda (özellikle düşük donanımlı head-unit'ler ve
  // donanım-hızlandırmalı Chrome) donanım VİDEO KATMANINI devre dışı bırakır → ses çalar
  // ama yalnızca poster görünür (hareketli kare yok). Bu yüzden host MİNİMAL tutulur:
  // kırpma yok, gölge yok, opacity geçişi yok. Köşe yuvarlama gerekirse iç iframe'i değil
  // yalnızca arka planı etkileyen güvenli yollarla yapılır (şimdilik kapalı — güvenilirlik öncelik).
  // pointer-events:none → tıklamalar bizim UI kontrollerine geçer; player'ı API ile yönetiriz.
  host.style.cssText =
    'position:fixed; z-index:2147483000; background:#000; display:none; pointer-events:none;';
  const inner = document.createElement('div');
  inner.id = 'yt-player-inner';
  // İç konteyner host'u TAM doldurmalı — yoksa YT iframe %100×0 = görünmez (ses çalar, video yok).
  inner.style.cssText = 'width:100%; height:100%;';
  host.appendChild(inner);
  document.body.appendChild(host);
  _host = host;
  return host;
}

function _loadApi(): Promise<void> {
  return new Promise<void>((resolve) => {
    const w = _ytWindow();
    if (w.YT?.Player) { resolve(); return; }
    if (_apiLoading) {
      const iv = setInterval(() => { if (w.YT?.Player) { clearInterval(iv); resolve(); } }, 100);
      return;
    }
    _apiLoading = true;
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
}

/**
 * preloadYouTubeIfAffordable — ÖN YÜKLEME kapısı (saha kanıtı, kütük #139/#140).
 *
 * KÖK NEDEN: Ana ekrandaki medya kartı, hiç YouTube çalmıyorken bile mount'ta
 * `ensureYouTubeReady()` çağırıyordu. Sonuç, K24 LOW-tier head unit'te CDP ile
 * ÖLÇÜLDÜ: `www-widgetapi.js` 250 ms'lik interval'lar sürekli çalışıyor,
 * `ytembeds/base.js` + `player_embed_es6` JS zamanının **%4.3'ünü** yiyor ve
 * kalıcı bir cross-origin iframe composited katman olarak GPU'da duruyor —
 * kullanıcı medyaya hiç dokunmasa bile.
 *
 * KARAR: ön yükleme yalnız BÜTÇESİ OLAN cihazda yapılır. LOW tier'da atlanır;
 * player, kullanıcı gerçekten YouTube seçtiğinde `ensureYouTubeReady()` ile
 * (MediaScreen yolundan) lazım olduğu anda kurulur → **işlev kaybı YOK**,
 * yalnız boşuna ön yükleme kalkar.
 *
 * Bu fonksiyon ASLA hata fırlatmaz.
 */
export function preloadYouTubeIfAffordable(): void {
  try {
    if (getDeviceTier() === 'low') return;   // düşük-uç: ön yükleme YOK
    // Safari/WebKit, görünmeyen IFrame API ön yüklemesinde zaman zaman yanlış
    // postMessage origin'i üretir. Yalnız spekülatif ısıtmayı atla; kullanıcı
    // YouTube'u seçtiğinde ensureYouTubeReady() aynı işlevi kurmaya devam eder.
    const ua = navigator.userAgent;
    const isSafariWebKit = /AppleWebKit/i.test(ua)
      && !/(Chrome|Chromium|CriOS|Android)/i.test(ua);
    if (isSafariWebKit) return;
    void ensureYouTubeReady().catch(() => { /* fail-soft */ });
  } catch { /* fail-soft */ }
}

/** Player'ı önceden hazırlar (ilk çalmada user-gesture kaybolmasın diye). */
export function ensureYouTubeReady(): Promise<void> {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    console.warn('[YT] ensureYouTubeReady — API yükleniyor…');
    _ensureHost();
    await _loadApi();
    console.warn('[YT] IFrame API yüklendi, player kuruluyor');
    await new Promise<void>((resolve) => {
      const w = _ytWindow();
      _player = new w.YT!.Player('yt-player-inner', {
        width: '100%', height: '100%',
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, fs: 0,
          modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3,
          // IFrame API postMessage hedefini açıkça ana uygulama origin'ine bağla.
          // Özellikle WebKit, origin verilmezse zaman zaman youtube.com hedefiyle
          // localhost/Capacitor origin'ini karıştırıp konsol hatası üretiyor.
          origin: window.location.origin,
        },
        events: {
          onReady: () => { console.warn('[YT] player hazır'); _applyVolume(); resolve(); },
          onStateChange: _onState,
          onError: _onError,
        },
      });
      console.warn('[YT] player oluşturuluyor…');
    });
  })();
  return _readyPromise;
}

function _onError(e: YtEvent): void {
  // 2=geçersiz param, 5=HTML5 hatası, 100=bulunamadı/kaldırıldı,
  // 101/150=video sahibi gömmeye (embedding) izin vermiyor (resmî kliplerde sık).
  const code = e?.data;
  console.error('[YT] HATA kodu:', code, code === 101 || code === 150 ? '(gömme kapalı)' : '');
  updateMediaState({ playing: false });
  // Oynatılamayan video (gömme kapalı / kaldırılmış / geçersiz): katmana bildir →
  // aynı şarkının gömülebilir alternatifini bulup çalsın (fail-soft, sessizce takılma).
  if (code === 100 || code === 101 || code === 150 || code === 2) {
    _onUnplayable?.(_currentVideoId);
  }
}

function _onState(e: YtEvent): void {
  console.warn('[YT] state:', e?.data);
  const YT = _ytWindow().YT;
  if (!YT || getMediaState().activePackage !== YOUTUBE_PKG) return;
  if (e.data === YT.PlayerState.PLAYING) {
    updateMediaState({ playing: true });
    _startPoll();
  } else if (e.data === YT.PlayerState.PAUSED) {
    updateMediaState({ playing: false });
  } else if (e.data === YT.PlayerState.ENDED) {
    updateMediaState({ playing: false });
    _onEnded?.();
  }
}

function _startPoll(): void {
  if (_pollTimer != null) return;
  // YT'de timeupdate yok → 500ms'de bir pozisyon/süre çek.
  _pollTimer = window.setInterval(() => {
    if (!_player || getMediaState().activePackage !== YOUTUBE_PKG) return;
    try {
      const pos = _player.getCurrentTime?.() ?? 0;
      const dur = _player.getDuration?.() ?? 0;
      updateMediaState({ track: { ...getMediaState().track, positionSec: pos, durationSec: dur } });
    } catch { /* ignore */ }
  }, 500);
}

function _stopPoll(): void {
  if (_pollTimer != null) { clearInterval(_pollTimer); _pollTimer = null; }
}

/** Bir YouTube video'sunu (arama sonucundan) uygulama içinde çalmaya başlar.
 *
 * KRİTİK — User-Activation Koruması:
 * Tarayıcı autoplay politikası, sesli oynatmayı yalnızca aktif user-gesture
 * penceresinde başlatılan loadVideoById çağrılarına izin verir. `await` (özellikle
 * dinamik `import()` modül çözümlemesi) bu transient activation'ı tüketir →
 * loadVideoById reddedilir (state -1→3→-1, video başlamaz).
 * Bu yüzden: player ISINMIŞSA loadVideoById HEMEN, await'siz çağrılır; diğer
 * kaynakları durdurma temizliği loadVideoById'den SONRA fire-and-forget yapılır.
 */
export async function playYouTube(videoId: string, title: string, artist: string, artwork?: string): Promise<void> {
  if (!videoId) return;
  _currentVideoId = videoId;

  updateMediaState({
    playing:       false,
    hasSession:    true,
    source:        'youtube',
    activePackage: YOUTUBE_PKG,
    activeAppName: 'YouTube',
    track: { title, artist, albumArt: artwork, durationSec: 0, positionSec: 0 },
  });

  console.warn('[YT] playYouTube videoId=', videoId);

  // Player hazırsa: user-gesture'ı korumak için loadVideoById'i await'siz çağır.
  // Hazır değilse (cold start): API yüklenir — bu durumda gesture kaybolabilir,
  // bu yüzden çağıranlar player'ı önceden ensureYouTubeReady() ile ısıtmalıdır.
  if (_player && _host) {
    _ensureHostRendered();
    try { _player.loadVideoById(_loadArg(videoId)); _applyVolume(); console.warn('[YT] loadVideoById (warm) çağrıldı'); }
    catch (e) { console.error('[YT] loadVideoById hata:', e); }
  } else {
    await ensureYouTubeReady();
    _ensureHostRendered();
    // ensureYouTubeReady() sonrası player yine null olabilir (API yüklenemedi).
    // Eski `any` sürümünde bu bir TypeError'a düşüp AYNI catch'e gidiyordu —
    // davranış korunsun diye açıkça fırlatılır, log satırı aynı kalır.
    try {
      if (!_player) throw new Error('YT player oluşturulamadı');
      _player.loadVideoById(_loadArg(videoId)); _applyVolume(); console.warn('[YT] loadVideoById (cold) çağrıldı');
    }
    catch (e) { console.error('[YT] loadVideoById hata:', e); }
  }

  /* MUSIC F7.1 · KAYNAK DEVRİ ARTIK BURADA YAPILMAZ.
   *
   * Eskiden burada `stopLocalMusic()` ve `streamStop()` "ateşle-unut" biçiminde
   * çağrılıyordu. Bu ikinci bir devir (handover) yürütücüsüydü: durduğu
   * DOĞRULANMIYORDU, sırası garanti değildi ve `audibleBackendCount <= 1`
   * sözleşmesini `sourceCoordinator`un dışından zorlamaya çalışıyordu.
   *
   * Kanonik yol: `mediaCommandGateway.playSource({ source: 'YOUTUBE' })` →
   * `sourceCoordinator` önce aktif kaynağı durdurur ve DOĞRULAR, sonra burayı
   * `start()` ile çağırır. Bu fonksiyon artık yalnız KENDİ backend'ini sürer. */
}

/** Host'u DOM'da render et ama UI'ı kaplamadan.
 *
 * Ana ekran müzik kartından YouTube çalınca MediaScreen mount DEĞİLDİR → kimse
 * setYouTubeRegion ile host'u konumlandırmaz. Eskiden burada koşulsuz
 * `display:block` veriliyordu → siyah video kutusu konumsuz biçimde ekranı kaplardı
 * ("uygulama açılıp kapanıyor / başka bir şey açılıyor" izlenimi).
 *
 * Çözüm: host hâlihazırda MediaScreen tarafından GÖRÜNÜR konumlandırılmışsa ona
 * dokunma; aksi halde render et ama ekran dışına gizli park et (ses çalar, video
 * UI'ı kaplamaz). MediaScreen videoMode'a geçince setYouTubeRegion ile görünür kılar.
 */
function _ensureHostRendered(): void {
  if (!_host) return;
  if (_host.style.visibility === 'visible') { _host.style.display = 'block'; return; }
  _host.style.display    = 'block';
  _host.style.left       = '-10000px';
  _host.style.top        = '0px';
  _host.style.visibility = 'hidden';
}

/** Mevcut ses düzeyini IFrame player'a uygular (player hazırsa). */
function _applyVolume(): void {
  if (!_player) return;
  try {
    _player.setVolume(_volume);   // YT API: 0–100
    if (_volume > 0) _player.unMute?.();
    else _player.mute?.();
  } catch { /* player henüz hazır değil — onReady/load sonrası tekrar uygulanır */ }
}

/**
 * Uygulama içi YouTube oynatıcısının ses düzeyini ayarlar (0–100).
 * Web'de sistem sesi (STREAM_MUSIC) IFrame'i etkilemediği için ses kontrolü buraya yönlenir.
 */
export function youtubeSetVolume(percent: number): void {
  _volume = Math.max(0, Math.min(100, Math.round(percent)));
  _applyVolume();
}

export function youtubeTogglePlayPause(): void {
  if (!_player) return;
  try {
    const YT = _ytWindow().YT;
    const st = _player.getPlayerState?.();
    if (st === YT?.PlayerState?.PLAYING) _player.pauseVideo();
    else _player.playVideo();
  } catch { /* ignore */ }
}

/* ── MUSIC F7.1 · Kanonik transport yüzeyi ─────────────────────────────────
 *
 * `mediaCommandGateway` bu backend'i `BackendTransport` üzerinden sürer.
 * Fonksiyonlar KABUL bilgisini döner ("çaldı" iddiası DEĞİL) — duyulabilirlik
 * hükmü `playbackTruth`ın işidir. IFrame yoksa `false` döner ve kapı bunu
 * dürüst bir hata olarak raporlar (sessiz yutma YOK). */

/** Oynatmayı devam ettir. @returns komut player'a İLETİLDİ mi. */
export function youtubeResume(): boolean {
  if (!_player) return false;
  try { _player.playVideo(); return true; } catch { return false; }
}

/** Oynatmayı duraklat. @returns komut player'a İLETİLDİ mi. */
export function youtubePause(): boolean {
  if (!_player) return false;
  try { _player.pauseVideo(); return true; } catch { return false; }
}

/** IFrame oynatıcısının GÖZLENEN durumu. */
export type YouTubePlaybackState =
  | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'STOPPED' | 'UNKNOWN';

/**
 * IFrame player'ın gözlenen durumu — okunamıyorsa `UNKNOWN` (uydurulmaz).
 *
 * Durum kodları IFrame Player API'sinin belgelenmiş sabitleridir:
 * `-1` başlamadı · `0` bitti · `1` çalıyor · `2` duraklı · `3` tamponluyor ·
 * `5` kuyruklandı. Çalışma anında `YT.PlayerState` varsa O KULLANILIR; yoksa
 * belgelenmiş sayısal karşılıklara düşülür (script parçalı yüklenmiş olabilir).
 */
export function getYouTubePlaybackState(): YouTubePlaybackState {
  if (!_player) return 'UNKNOWN';
  let st: number | undefined;
  try { st = _player.getPlayerState?.(); } catch { return 'UNKNOWN'; }
  if (typeof st !== 'number') return 'UNKNOWN';

  const ps = _ytWindow().YT?.PlayerState;
  if (st === (ps?.PLAYING ?? 1)) return 'PLAYING';
  if (st === (ps?.PAUSED ?? 2)) return 'PAUSED';
  if (st === 3) return 'BUFFERING';
  if (st === (ps?.ENDED ?? 0) || st === -1 || st === 5) return 'STOPPED';
  return 'UNKNOWN';
}

/** Konuma atlar. @returns komut player'a İLETİLDİ mi (F7.1 · kapı bunu okur). */
export function youtubeSeek(positionSec: number): boolean {
  if (!_player) return false;
  try { _player.seekTo(positionSec, true); return true; } catch { return false; }
}

export function youtubeStop(): void {
  try { _player?.stopVideo?.(); } catch { /* ignore */ }
  _stopPoll();
  if (_host) _host.style.display = 'none';
  if (getMediaState().activePackage === YOUTUBE_PKG) {
    updateMediaState({ playing: false, hasSession: false });
  }
}

export function isYouTubeActive(): boolean {
  return getMediaState().activePackage === YOUTUBE_PKG;
}

/**
 * Video host'unu konumlandırır/gösterir.
 * @param rect    Albüm-kapağı alanı (player ekranındayken). null → ekran dışı.
 * @param visible Video görünsün mü. false ise host gizlenir (visibility:hidden) →
 *                kapak görünür, ses ARKADA çalmaya devam eder.
 *
 * Ses her durumda sürer (iframe DOM'da kalır); yalnızca görünürlük değişir.
 *
 * KRİTİK: Gizleme `opacity` ile DEĞİL `visibility` ile yapılır. Saydam (opacity:0)
 * composited bir katman, bazı GPU'larda görünür yapıldığında bile donanım video
 * katmanını bastırır (ses çalar, hareketli kare gelmez — sadece poster). Koordinatlar
 * tam sayıya yuvarlanır: her karede sub-pixel reposition sürekli recomposite tetikler
 * ve düşük donanımlı head-unit GPU'larında video katmanı yanıp söner / çizilmez.
 */
export function setYouTubeRegion(
  rect: { left: number; top: number; width: number; height: number } | null,
  visible = true,
): void {
  const host = _host;
  if (!host) {
    _logRegion('host yok', { hasHost: false });
    return;
  }
  if (rect && rect.width > 0 && rect.height > 0) {
    // Görünür kılınıyorsa host kesinlikle açık olmalı — display:none'da takılı kalmasın
    // (aksi halde "video butonuna basıyorum ama değişen bir şey yok" yaşanır).
    if (visible && host.style.display === 'none') host.style.display = 'block';
    host.style.left       = `${Math.round(rect.left)}px`;
    host.style.top        = `${Math.round(rect.top)}px`;
    host.style.width      = `${Math.round(rect.width)}px`;
    host.style.height     = `${Math.round(rect.height)}px`;
    host.style.opacity    = '1';
    host.style.visibility = visible ? 'visible' : 'hidden';
    const ifr = host.querySelector('iframe');
    _logRegion('konumlandı', {
      visible, visibility: host.style.visibility,
      rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      iframe: ifr ? `${ifr.clientWidth}x${ifr.clientHeight}` : 'YOK',
      z: getComputedStyle(host).zIndex,
    });
  } else {
    // Player ekranında değil → ekran dışına park et (ses sürer, video gizli).
    host.style.left       = '-10000px';
    host.style.top        = '0px';
    host.style.width      = '320px';
    host.style.height     = '180px';
    host.style.visibility = 'hidden';
  }
}
