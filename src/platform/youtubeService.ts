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

/* Hazırlık bütçeleri — `sourceCoordinator`un adım zaman aşımından (4000 ms)
   KISA tutulur ki hata DÜRÜST bir `youtube_iframe_unavailable` olarak dönsün,
   jenerik bir `prepare_timeout` olarak değil. */
const API_LOAD_TIMEOUT_MS = 2500;
const PLAYER_READY_TIMEOUT_MS = 2500;

let _player: YtPlayer | null = null;
let _apiLoading = false;

/* ═══════════════════════════════════════════════════════════════════════════
   DOĞRUDAN SES AKIŞI YEDEĞİ — SAHA KUSURU 2026-09-05 (KALICI ÇÖZÜM)
   ═══════════════════════════════════════════════════════════════════════════
   KUSUR: resmî/dağıtımcı kısıtlı klipler IFrame'de GÖMÜLEMEZ (onError 100/101/
   150) — bu, YouTube'un kendi platform kısıtıdır, uygulamanın hatası DEĞİLDİR
   ve hiçbir IFrame ayarıyla aşılamaz. Önceki tur bunu TEŞHİS ETTİ (kuyruğun
   sessizce yanmasını durdurdu) ama videonun GERÇEKTEN çalmasını sağlamadı.

   ÇÖZÜM: IFrame gömülemediğinde aynı YouTube backend'i KENDİ İÇİNDE bir
   `<audio>` elementine düşer ve `pipedProvider.resolvePipedStream` ile
   çözülen DOĞRUDAN ses URL'sini çalar. Bu YENİ BİR KAYNAK SINIFI DEĞİLDİR:
   `activePackage` YOUTUBE_PKG olarak KALIR, `sourceClass` YOUTUBE'dur —
   yalnız decode motoru değişir (IFrame video → HTML5 audio). Aynı desen
   zaten `ytDownloadService`te (çevrimdışı indirme) kullanılıyordu; burada
   CANLI oynatmaya taşındı. İkinci bir playback authority KURULMADI.

   TETİKLENME:
     1. `onError` (100/101/150/2/5) → ANINDA dener (kesin gömme reddi).
     2. `loadVideoById` sonrası EMBED_CHECK_MS içinde PLAYING/BUFFERING
        gelmezse → dener (sessiz autoplay reddi; bazı WebView'larda onError
        HİÇ ateşlenmeden video state -1/5'te takılı kalır).
   Yedek de başarısız olursa (piped instance'ları da çözemezse) `_onUnplayable`
   ÇAĞRILIR — kuyruk-yakma koruması (#1291) son çare olarak duruyor. */

let _audioEl: HTMLAudioElement | null = null;
let _usingAudioFallback = false;
/** Video-kullanılamıyor GÖZLEMİ aboneleri (MediaScreen bunu okuyup IFrame'in
 *  ham "video unavailable" kartını gizleyip kapak moduna düşebilsin). */
const _videoAvailSubs = new Set<() => void>();
function _notifyVideoAvail(): void {
  _videoAvailSubs.forEach((f) => { try { f(); } catch { /* abone hatası diğerlerini etkilemesin */ } });
}
/** Sesli yedek AKTİFSE video artık GÖSTERİLEMEZ — IFrame kendi "video
kullanılamıyor" kartını göstermeye devam eder; UI kapak moduna düşmelidir. */
export function isYouTubeVideoAvailable(): boolean {
  return !_usingAudioFallback;
}
export function subscribeYouTubeVideoAvailability(cb: () => void): () => void {
  _videoAvailSubs.add(cb);
  return () => { _videoAvailSubs.delete(cb); };
}
/** Her `playYouTube`/hata ile artar — GEÇ gelen bir yedek yanlış videoya
 *  ATLANMASIN diye (kullanıcı bu arada başka parça seçmiş olabilir). */
let _audioFallbackAttempt = 0;
let _embedCheckTimer: number | null = null;
/** IFrame'e "gerçekten çalışıyor mu" diye bakılan süre — sourceCoordinator'ın
 *  adım bütçesinden (4000 ms) KISA tutulur ki hata dürüst dönsün. */
const EMBED_CHECK_MS = 1400;

function _ensureAudioEl(): HTMLAudioElement {
  if (_audioEl) return _audioEl;
  const el = new Audio();
  el.preload = 'auto';
  el.addEventListener('pause', () => {
    if (_usingAudioFallback && getMediaState().activePackage === YOUTUBE_PKG) {
      updateMediaState({ playing: false });
    }
  });
  el.addEventListener('playing', () => {
    if (_usingAudioFallback && getMediaState().activePackage === YOUTUBE_PKG) {
      updateMediaState({ playing: true });
    }
  });
  el.addEventListener('ended', () => {
    if (!_usingAudioFallback) return;
    updateMediaState({ playing: false });
    _onEnded?.();
  });
  el.addEventListener('timeupdate', () => {
    if (_usingAudioFallback && getMediaState().activePackage === YOUTUBE_PKG) {
      updateMediaState({
        track: {
          ...getMediaState().track,
          positionSec: el.currentTime,
          durationSec: Number.isFinite(el.duration) ? el.duration : 0,
        },
      });
    }
  });
  _audioEl = el;
  return el;
}

/**
 * IFrame gömülemedi/otoyoklama reddedildi — doğrudan ses akışına düş.
 * @returns gerçekten çalmaya BAŞLADI mı (sahte kanıt üretilmez).
 */
async function _tryAudioFallback(videoId: string, attempt: number): Promise<boolean> {
  if (!videoId) return false;
  // Zaten bu deneme için yedekteyiz — onError ve embed-check zamanlayıcısı
  // aynı videoyu neredeyse aynı anda tetikleyebilir; ikinci ağ isteğini boşa
  // harcama (idempotent kısayol, davranışı DEĞİŞTİRMEZ).
  if (_usingAudioFallback && attempt === _audioFallbackAttempt) return true;
  try {
    const { resolvePipedStream } = await import('./media/pipedProvider');
    const url = await resolvePipedStream(videoId);
    // Bu arada kullanıcı başka bir video seçmiş olabilir — bayat sonucu ATMA.
    if (attempt !== _audioFallbackAttempt) return false;
    if (!url) { _noteYtFailure('audio_fallback_no_stream'); return false; }
    const el = _ensureAudioEl();
    el.pause();
    el.src = url;
    el.volume = Math.max(0, Math.min(1, _volume / 100));
    await el.play();
    if (attempt !== _audioFallbackAttempt) { el.pause(); return false; } // yarışı kaybetti
    _usingAudioFallback = true;
    _notifyVideoAvail();
    console.warn('[YT] IFrame gömme reddi/otoyoklama engeli — doğrudan ses akışına düşüldü');
    updateMediaState({ playing: true });
    return true;
  } catch (e) {
    console.error('[YT] ses akışı yedeği başarısız:', e);
    _noteYtFailure('audio_fallback_failed');
    return false;
  }
}

function _clearEmbedCheck(): void {
  if (_embedCheckTimer !== null) { clearTimeout(_embedCheckTimer); _embedCheckTimer = null; }
}

/** IFrame'in KENDİ durumu — yedek aktifken bile ham veriyi taşır (teşhis). */
function _iframeState(): YouTubePlaybackState {
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
  /* ⚠️ `display:none` DEĞİL — SAHA KUSURU 2026-09-05.
   * Player bu konteynerin İÇİNDE kurulur (`ensureYouTubeReady` → `_ensureHost()`
   * → `new YT.Player('yt-player-inner')`). `display:none` bir konteynerde
   * oluşturulan iframe 0×0'dır ve Android WebView'da düzen/boya hiç yapılmadığı
   * için IFrame API'nin `onReady` olayı GECİKEBİLİR ya da HİÇ GELMEZ. O zaman
   * `ensureYouTubeReady()` çözülmez → `prepare()` zaman aşımına düşer →
   * LOCAL durdurulmuş, YouTube başlamamış: **sessizlik**.
   * Host bu yüzden en baştan RENDER EDİLİR ama ekran dışına park edilir:
   * ses çalar, video UI'ı kaplamaz, düzen gerçekleşir. */
  host.style.cssText =
    'position:fixed; z-index:2147483000; background:#000; pointer-events:none;'
    + ' display:block; visibility:hidden; left:-10000px; top:0px; width:320px; height:180px;';
  const inner = document.createElement('div');
  inner.id = 'yt-player-inner';
  // İç konteyner host'u TAM doldurmalı — yoksa YT iframe %100×0 = görünmez (ses çalar, video yok).
  inner.style.cssText = 'width:100%; height:100%;';
  host.appendChild(inner);
  document.body.appendChild(host);
  _host = host;
  return host;
}

/**
 * IFrame API script'ini yükler — **SINIRLI ve YENİDEN DENENEBİLİR**.
 *
 * ── SAHA KUSURU 2026-09-05 (giderilen) ────────────────────────────────────
 * Eski sürüm üç ayrı yerde SONSUZA KADAR bekliyordu:
 *   1. `tag.onerror` YOKTU → script indirilemezse promise hiç çözülmezdi.
 *   2. Zaman aşımı YOKTU → ağ askıda kalırsa aynı sonuç.
 *   3. `_apiLoading` true iken kurulan 100 ms'lik `setInterval` başarısızlıkta
 *      HİÇ temizlenmiyordu → hem sızıntı hem sonsuz bekleme (zero-leak ihlali).
 * Üstelik `_apiLoading` bir daha `false` yapılmadığı için ilk başarısız deneme
 * oturumun geri kalanını ZEHİRLİYORDU. Açılışta ağ henüz yokken çalışan
 * `preloadYouTubeIfAffordable()` tam bu tuzağa düşüyordu: kullanıcı daha sonra
 * çevrimiçi olsa bile YouTube bir daha ASLA hazır olamıyordu.
 */
function _loadApi(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const w = _ytWindow();
    if (w.YT?.Player) { resolve(); return; }

    let settled = false;
    let iv: number | null = null;
    let to: number | null = null;
    const cleanup = (): void => {
      if (iv !== null) { clearInterval(iv); iv = null; }
      if (to !== null) { clearTimeout(to); to = null; }
    };
    const ok = (): void => { if (settled) return; settled = true; cleanup(); resolve(); };
    const fail = (why: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      _apiLoading = false;            // ZEHİRLENME YOK: sonraki deneme yeniden dener
      _noteYtFailure(why);
      reject(new Error(why));
    };

    to = window.setTimeout(() => fail('api_load_timeout'), API_LOAD_TIMEOUT_MS);

    if (_apiLoading) {
      // Başka bir çağrı script'i zaten indiriyor — hazır olmasını SINIRLI bekle.
      iv = window.setInterval(() => { if (w.YT?.Player) ok(); }, 100);
      return;
    }
    _apiLoading = true;
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); ok(); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => fail('api_script_error');
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
  /* ⚠️ ZEHİRLİ ÖNBELLEK YASAĞI (saha kusuru 2026-09-05): eski sürüm promise'i
   * KOŞULSUZ önbelleğe alıyordu. İlk deneme çözülmezse (ağ yok / script hatası
   * / `onReady` gelmedi) aynı ASLA-ÇÖZÜLMEYEN promise oturum boyunca geri
   * dönüyordu → YouTube bir daha hiç hazır olamıyordu. Artık başarısızlıkta
   * önbellek TEMİZLENİR ve bir sonraki deneme gerçekten yeniden dener. */
  const attempt = (async () => {
    console.warn('[YT] ensureYouTubeReady — API yükleniyor…');
    _ensureHost();
    await _loadApi();
    console.warn('[YT] IFrame API yüklendi, player kuruluyor');
    await new Promise<void>((resolve, reject) => {
      const w = _ytWindow();
      /* `onReady` hiç gelmezse promise burada asılı kalırdı — SINIRLI bekle. */
      let settled = false;
      const rt = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        _noteYtFailure('player_ready_timeout');
        reject(new Error('player_ready_timeout'));
      }, PLAYER_READY_TIMEOUT_MS);
      const done = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(rt);
        resolve();
      };
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
          onReady: () => { console.warn('[YT] player hazır'); _applyVolume(); done(); },
          onStateChange: _onState,
          onError: _onError,
        },
      });
      console.warn('[YT] player oluşturuluyor…');
    });
  })();
  _readyPromise = attempt;
  attempt.catch(() => {
    /* Başarısız deneme ÖNBELLEKTE KALMAZ. `_player` da temizlenir ki
       `playYouTube` yarım kurulmuş bir player'a `loadVideoById` yollamasın. */
    if (_readyPromise === attempt) _readyPromise = null;
    _player = null;
  });
  return attempt;
}

/* ── SINIRLI TEŞHİS (salt-okunur) ─────────────────────────────────────────
 * Sahada "ses hiç başlamadı" dendiğinde SEBEBİN kaydı olmalıydı; yoktu.
 * Yalnız SON sebep ve SAYAÇ tutulur — sınırsız kayıt/geçmiş YOK, kullanıcı
 * verisi (video adı/kimliği) YOK. */
const _ytFailures: Record<string, number> = {};
let _ytLastFailure: string | null = null;
function _noteYtFailure(why: string): void {
  _ytFailures[why] = (_ytFailures[why] ?? 0) + 1;
  _ytLastFailure = why;
  console.error('[YT] hazırlık başarısız:', why);
}

export interface YouTubeReadinessDiagnostics {
  readonly playerCreated: boolean;
  readonly apiLoaded: boolean;
  readonly lastFailure: string | null;
  readonly failureCounts: Readonly<Record<string, number>>;
}

/** Salt-okunur teşhis — hiçbir şey başlatmaz/değiştirmez (CAROS LAB · raporlar). */
export function getYouTubeReadinessDiagnostics(): YouTubeReadinessDiagnostics {
  return {
    playerCreated: _player !== null,
    apiLoaded: _ytWindow().YT?.Player !== undefined,
    lastFailure: _ytLastFailure,
    failureCounts: { ..._ytFailures },
  };
}

function _onError(e: YtEvent): void {
  // 2=geçersiz param, 5=HTML5 hatası, 100=bulunamadı/kaldırıldı,
  // 101/150=video sahibi gömmeye (embedding) izin vermiyor (resmî kliplerde sık).
  const code = e?.data;
  console.error('[YT] HATA kodu:', code, code === 101 || code === 150 ? '(gömme kapalı)' : '');
  _clearEmbedCheck();
  const failedId = _currentVideoId;
  const attempt = _audioFallbackAttempt;
  void _tryAudioFallback(failedId, attempt).then((ok) => {
    if (ok) return;
    // Yedek de başaramadı — eski dürüst yol: katmana bildir, kuyruk-yakma
    // koruması (#1291) devreye girsin.
    updateMediaState({ playing: false });
    _onUnplayable?.(failedId);
  });
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
  _clearEmbedCheck();
  _audioFallbackAttempt += 1;              // yeni seçim — eski yedek denemeleri BAYAT
  const myAttempt = _audioFallbackAttempt;
  if (_usingAudioFallback && _audioEl) { try { _audioEl.pause(); } catch { /* ignore */ } }
  if (_usingAudioFallback) _notifyVideoAvail();
  _usingAudioFallback = false;

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
    try {
      _player.loadVideoById(_loadArg(videoId));
      _applyVolume();
      /* `loadVideoById` sözleşmeye göre otomatik çalar; ama WebView otoyoklama
         kısıtlaması altında bazen yalnız CUE'lanmış (state 5) kalır. Belgelenmiş
         dürtme budur ve zararsızdır: zaten çalıyorsa etkisizdir. */
      _player.playVideo?.();
      console.warn('[YT] loadVideoById (warm) çağrıldı');
    }
    catch (e) { console.error('[YT] loadVideoById hata:', e); _noteYtFailure('load_threw'); }
    _embedCheckTimer = window.setTimeout(() => {
      const st = _iframeState();
      if (st !== 'PLAYING' && st !== 'BUFFERING') void _tryAudioFallback(videoId, myAttempt);
    }, EMBED_CHECK_MS);
  } else {
    await ensureYouTubeReady();
    _ensureHostRendered();
    // ensureYouTubeReady() sonrası player yine null olabilir (API yüklenemedi).
    // Eski `any` sürümünde bu bir TypeError'a düşüp AYNI catch'e gidiyordu —
    // davranış korunsun diye açıkça fırlatılır, log satırı aynı kalır.
    try {
      if (!_player) throw new Error('YT player oluşturulamadı');
      _player.loadVideoById(_loadArg(videoId));
      _applyVolume();
      _player.playVideo?.();
      console.warn('[YT] loadVideoById (cold) çağrıldı');
    }
    catch (e) { console.error('[YT] loadVideoById hata:', e); _noteYtFailure('load_threw'); }
    _embedCheckTimer = window.setTimeout(() => {
      const st = _iframeState();
      if (st !== 'PLAYING' && st !== 'BUFFERING') void _tryAudioFallback(videoId, myAttempt);
    }, EMBED_CHECK_MS);
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
  if (_audioEl) { try { _audioEl.volume = _volume / 100; } catch { /* ignore */ } }
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
  if (_usingAudioFallback && _audioEl) {
    try { void _audioEl.play(); return true; } catch { return false; }
  }
  if (!_player) return false;
  try { _player.playVideo(); return true; } catch { return false; }
}

/** Oynatmayı duraklat. @returns komut player'a İLETİLDİ mi. */
export function youtubePause(): boolean {
  if (_usingAudioFallback && _audioEl) {
    try { _audioEl.pause(); return true; } catch { return false; }
  }
  if (!_player) return false;
  try { _player.pauseVideo(); return true; } catch { return false; }
}

/** IFrame oynatıcısının GÖZLENEN durumu. */
export type YouTubePlaybackState =
  | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'STOPPED' | 'UNKNOWN';

/**
 * GÖZLENEN durum — okunamıyorsa `UNKNOWN` (uydurulmaz).
 *
 * Doğrudan ses akışı yedeği AKTİFKEN kanıt `<audio>` elementinden gelir
 * (gerçek decode motoru odur); değilse IFrame'in kendi durumu okunur.
 * Durum kodları IFrame Player API'sinin belgelenmiş sabitleridir:
 * `-1` başlamadı · `0` bitti · `1` çalıyor · `2` duraklı · `3` tamponluyor ·
 * `5` kuyruklandı.
 */
export function getYouTubePlaybackState(): YouTubePlaybackState {
  if (_usingAudioFallback && _audioEl) {
    if (_audioEl.error) return 'STOPPED';
    if (_audioEl.ended) return 'STOPPED';
    if (_audioEl.paused) return 'PAUSED';
    if (_audioEl.readyState < 2) return 'BUFFERING';
    return 'PLAYING';
  }
  return _iframeState();
}

/** Konuma atlar. @returns komut player'a İLETİLDİ mi (F7.1 · kapı bunu okur). */
export function youtubeSeek(positionSec: number): boolean {
  if (_usingAudioFallback && _audioEl) {
    try { _audioEl.currentTime = positionSec; return true; } catch { return false; }
  }
  if (!_player) return false;
  try { _player.seekTo(positionSec, true); return true; } catch { return false; }
}

export function youtubeStop(): void {
  _clearEmbedCheck();
  _audioFallbackAttempt += 1;   // uçuştaki yedek çözümlemeleri artık BAYAT
  if (_usingAudioFallback && _audioEl) {
    try { _audioEl.pause(); _audioEl.removeAttribute('src'); _audioEl.load(); } catch { /* ignore */ }
  }
  if (_usingAudioFallback) _notifyVideoAvail();
  _usingAudioFallback = false;
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
