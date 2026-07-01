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

let _player: any = null;
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
    const w = window as any;
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

/** Player'ı önceden hazırlar (ilk çalmada user-gesture kaybolmasın diye). */
export function ensureYouTubeReady(): Promise<void> {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    console.warn('[YT] ensureYouTubeReady — API yükleniyor…');
    _ensureHost();
    await _loadApi();
    console.warn('[YT] IFrame API yüklendi, player kuruluyor');
    await new Promise<void>((resolve) => {
      const w = window as any;
      _player = new w.YT.Player('yt-player-inner', {
        width: '100%', height: '100%',
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, fs: 0,
          modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3,
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

function _onError(e: any): void {
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

function _onState(e: any): void {
  console.warn('[YT] state:', e?.data);
  const YT = (window as any).YT;
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
    try { _player.loadVideoById(_loadArg(videoId)); _applyVolume(); console.warn('[YT] loadVideoById (cold) çağrıldı'); }
    catch (e) { console.error('[YT] loadVideoById hata:', e); }
  }

  // Diğer kaynakları durdur (tek aktif kaynak) — loadVideoById'den SONRA,
  // fire-and-forget: bekleyen import'lar user-gesture'ı tüketmesin.
  import('./localMusicService')
    .then(({ isLocalMusicActive, stopLocalMusic }) => { if (isLocalMusicActive()) stopLocalMusic(); })
    .catch(() => { /* ignore */ });
  import('./streamMusicService')
    .then(({ streamStop, isStreamActive }) => { if (isStreamActive()) streamStop(); })
    .catch(() => { /* ignore */ });
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
    const YT = (window as any).YT;
    const st = _player.getPlayerState?.();
    if (st === YT?.PlayerState?.PLAYING) _player.pauseVideo();
    else _player.playVideo();
  } catch { /* ignore */ }
}

export function youtubeSeek(positionSec: number): void {
  try { _player?.seekTo(positionSec, true); } catch { /* ignore */ }
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
