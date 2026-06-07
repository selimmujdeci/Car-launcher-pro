/**
 * Media Service — Android MediaSession tabanlı müzik durumu.
 *
 * Mimari:
 *   - Native (Android): CarLauncherPlugin üzerinden gerçek MediaSession dinlenir.
 *     play/pause/next/prev → sendMediaAction() → Android MediaController
 *   - Web/Localhost: Her zaman pasif mod. Harici uygulama kontrolü YOK.
 *     Kontroller devre dışı. "Uygulamayı aç" butonları çalışır.
 *
 * Web modda fake playback YOK.
 * Demo track data YOK.
 * Ayrı browser sekmesi kontrolü YOK.
 */
import { useSyncExternalStore } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import type { NativeMediaInfo } from './nativePlugin';
import { logError } from './crashLogger';

/* ── Issue 2: albumArt hash — köprü trafiği önleme ──────────
 * Base64 bir kapak ~20–80 KB. 5 saniyelik poll döngüsünde değişmemiş
 * kapağı tekrar bridge'den geçirmek gereksiz CPU + GC yükü yaratır.
 * DJB2 hash: ilk 128 + son 32 karakter + uzunluk → pratik çakışma yok.
 */
function _djb2(str: string): number {
  const sample = str.length > 160 ? str.slice(0, 128) + str.slice(-32) : str;
  let h = 5381;
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) + h) ^ sample.charCodeAt(i);
  }
  return h >>> 0;
}

/* ── Types ───────────────────────────────────────────────── */

export interface TrackInfo {
  title:       string;
  artist:      string;
  albumArt?:   string; // base64 veya URL (Android MediaSession'dan gelir)
  durationSec: number;
  positionSec: number;
}

export type MediaSource =
  | 'spotify'
  | 'youtube'
  | 'youtube_music'
  | 'local'
  | 'bluetooth'
  | 'unknown';

export interface MediaState {
  playing:            boolean;
  source:             MediaSource;
  track:              TrackInfo;
  activePackage:      string;   // tespit edilen Android paketi
  activeAppName:      string;   // kullanıcıya görünen uygulama adı
  hasSession:         boolean;  // gerçek Android MediaSession var mı
  shuffle:            boolean;
  repeat:             'off' | 'one' | 'all';
  /** Bildirim erişim izni verilmemiş */
  permissionRequired: boolean;
  /** Albüm kapağından çıkarılan dominant renk — CSS rgb bileşenleri "R, G, B" formatında.
   *  TheaterOverlay ve MusicHub ambient efektleri için merkezi kaynak.
   *  --album-accent-rgb CSS değişkeni olarak :root'a da uygulanır. */
  albumAccentRgb: string;
}

/* ── Boş track — gerçek veri gelene kadar ───────────────── */

const EMPTY_TRACK: TrackInfo = {
  title:       '',
  artist:      '',
  albumArt:    undefined,
  durationSec: 0,
  positionSec: 0,
};

/* ── Module-level state ──────────────────────────────────── */

let _current: MediaState = {
  playing:            false,
  source:             'unknown',
  track:              { ...EMPTY_TRACK },
  activePackage:      '',
  activeAppName:      '',
  hasSession:         false,
  shuffle:            false,
  repeat:             'off',
  permissionRequired: false,
  albumAccentRgb:     '139, 92, 246', // varsayılan: mor
};

const _listeners = new Set<(s: MediaState) => void>();

/* ── Issue 1: Focus lock — kullanıcı/sistem çakışması önleme ─
 * Kullanıcı manuel kaynak seçtiğinde, sistemin başka bir session'a
 * geçmesi 5 saniyelik "focus lock" penceresiyle engellenir.
 * Bu pencere içinde gelen farklı paket bilgileri sessizce reddedilir.
 */
const FOCUS_LOCK_MS = 5_000;
let _focusLockUntil = 0;

/* ── albumArt hash cache ─────────────────────────────────── */
let _lastArtHash = 0;

/* ── Albüm Rengi (Music Hub 2.0 — Ambient Sync) ─────────────
 * Albüm kapağından dominant rengi asenkron çeker; CSS değişkeni +
 * MediaState.albumAccentRgb güncellenir.
 * DJB2 hash: aynı kapak için tekrar ekstraksiyonu önler.
 */
const ACCENT_DEFAULT = '139, 92, 246';
let _lastAccentHash = 0;

function _extractAndApplyAccent(albumArt: string): void {
  const hash = _djb2(albumArt);
  if (hash === _lastAccentHash) return;
  _lastAccentHash = hash;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16; // küçük örnekleme — hız+doğruluk dengesi
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n   = d.length / 4;
      const rgb = `${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}`;
      // CSS değişkeni → tüm uygulama vurgu rengi
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--album-accent-rgb', rgb);
        document.documentElement.style.setProperty('--album-accent',     `rgb(${rgb})`);
      }
      updateMediaState({ albumAccentRgb: rgb });
    } catch { /* tainted canvas veya CORS — önceki renk korunur */ }
  };
  img.onerror = () => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--album-accent-rgb', ACCENT_DEFAULT);
      document.documentElement.style.setProperty('--album-accent',     `rgb(${ACCENT_DEFAULT})`);
    }
    updateMediaState({ albumAccentRgb: ACCENT_DEFAULT });
  };
  img.src = albumArt;
}

/* ── MediaSession API — sistem donanım tuşlarını yakala ─────
 * Android WebView'da navigator.mediaSession mevcutsa, Bluetooth
 * kulaklık / bildirim panel butonları (Next/Prev/Play/Pause) bu
 * handler'lara yönlendirilir. isNative guard: harici komutlar
 * Capacitor plugin üzerinden gider.
 */
function _setupMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ms.setActionHandler('play',          () => { play(); });
  ms.setActionHandler('pause',         () => { pause(); });
  ms.setActionHandler('nexttrack',     () => { next(); });
  ms.setActionHandler('previoustrack', () => { previous(); });
}

function _teardownMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  (['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]).forEach((a) => {
    try { ms.setActionHandler(a, null); } catch { /* bazı tarayıcılar hata fırlatır */ }
  });
}

/* ── Session grace period — otomotiv standardı ───────────────
 * ISO 15008 / Android Auto: oturum kapanınca ekran anında boşalmamalı.
 * 3 saniyelik grace penceresi arada-sırada kapanan/açılan oturumların
 * (parça değişimi, sistem geçişleri) boş ekran flaşını engeller.
 */
const SESSION_GRACE_MS = 3_000;
let _sessionFallbackTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Linear Interpolation Engine ─────────────────────────────
 * Problem: 5 saniyelik poll periyodu progress-bar'da 5s'de-bir takılmaya
 * neden olur. Çözüm: playing=true iken her 100ms positionSec'i sanal
 * olarak artır. Gerçek veri gelince sarsıntısız senkronize et.
 *
 * Senkronizasyon kuralı (POSITION_DRIFT_S eşiği):
 *   |native_pos - interp_pos| ≤ 2s → interpolated değeri koru (animasyon düzgün)
 *   |native_pos - interp_pos| >  2s → snap (kullanıcı seek etti / parça değişti)
 *
 * Session Grace Period ve Focus Lock ile entegrasyon:
 *   - Grace timer tetiklendiğinde interpolasyon durdurulur.
 *   - Focus Lock interpolasyonu etkilemez — zaten aynı session.
 */
const INTERP_TICK_MS   = 500;   // 2 Hz — pil tasarrufu; CSS transition progress düzgünlüğünü sağlar
const POSITION_DRIFT_S = 2.0;   // Bu eşiğin üstünde native pozisyona snap yap

let _interpTimer: ReturnType<typeof setInterval> | null = null;

function _startInterpolation(): void {
  if (_interpTimer) return;
  _interpTimer = setInterval(() => {
    // Guard: playing veya session yoksa timer kendini durdurur (defense-in-depth).
    // _merge() zaten _stopInterpolation çağırır; bu satır stale callback'e karşı ikinci hat.
    if (!_current.playing || !_current.hasSession) {
      _stopInterpolation();
      return;
    }
    const dur  = _current.track.durationSec;
    const cap  = dur > 0 ? dur : Infinity;
    const next = Math.min(_current.track.positionSec + INTERP_TICK_MS / 1000, cap);
    if (next === _current.track.positionSec) return; // dur sınırına dayandık
    _current = { ..._current, track: { ..._current.track, positionSec: next } };
    _listeners.forEach((fn) => fn(_current));
  }, INTERP_TICK_MS);
}

function _stopInterpolation(): void {
  if (_interpTimer) { clearInterval(_interpTimer); _interpTimer = null; }
}

/* ── Metadata Resilience — Sanitizer Katmanı ─────────────────
 * Bluetooth ve düşük kaliteli kaynaklardan gelen null / "Unknown"
 * metadata değerleri için akıllı fallback metinleri üretir.
 * Paket adından anlamlı uygulama adı türetilir (ör: "Spotify Sinyali").
 *
 * Session Grace Period entegrasyonu: bu katman applyNativeMediaInfo
 * içinde Focus Lock ve Grace kontrolünden SONRA çalışır — mimariyi bozmaz.
 */

/** Temiz olmayan değer tespiti */
const BAD_METADATA = new Set(['', 'unknown', 'null', 'undefined', '<unknown>', 'none', '-']);
function _isBadMeta(v: string | undefined | null): boolean {
  if (!v) return true;
  const t = v.trim().toLowerCase();
  return BAD_METADATA.has(t) || t.startsWith('<') || v.trim().length < 2;
}

/** Paket adından insan-okunabilir uygulama adı çıkar (PACKAGE_LABEL yoksa) */
function _deriveAppLabel(pkg: string): string {
  if (!pkg) return 'Medya';
  const known = PACKAGE_LABEL[pkg];
  if (known) return known;
  // com.spotify.music → ['com','spotify','music'] → 'Spotify'
  const parts = pkg.split('.');
  const skip  = new Set(['com', 'org', 'net', 'android', 'google', 'app', 'apps', 'mobile', 'music', 'player', 'audio']);
  const word  = parts.find((p) => p.length > 2 && !skip.has(p));
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : 'Medya';
}

/** Metadata sanitizer — akıllı fallback ile title/artist döner */
function _sanitizeMetadata(
  rawTitle:  string | undefined | null,
  rawArtist: string | undefined | null,
  pkg:       string,
): { title: string; artist: string } {
  const title  = _isBadMeta(rawTitle)  ? null : rawTitle!.trim();
  const artist = _isBadMeta(rawArtist) ? null : rawArtist!.trim();
  if (title && artist) return { title, artist };

  const label = _deriveAppLabel(pkg);
  return {
    title:  title  ?? `${label} Sinyali`,
    artist: artist ?? label,
  };
}

/* ── Push API ────────────────────────────────────────────── */

export function updateMediaState(partial: Partial<MediaState>): void {
  _current = {
    ..._current,
    ...partial,
    track: partial.track ? { ..._current.track, ...partial.track } : _current.track,
  };

  // Interpolation lifecycle: playing && hasSession ise başlat, aksi hâlde durdur.
  // stopMediaHub() da _stopInterpolation() çağırır — sızıntı riski yok.
  if (_current.playing && _current.hasSession) {
    _startInterpolation();
  } else {
    _stopInterpolation();
  }

  _listeners.forEach((fn) => fn(_current));
}

export function getMediaState(): MediaState {
  return _current;
}

export function setSource(source: MediaSource): void {
  updateMediaState({ source });
}

/* ── Playback controls ───────────────────────────────────── */
/*
 * Web modda bu fonksiyonlar NO-OP'tur.
 * Harici uygulama kontrolü mümkün değil — sadece native Android.
 */

/**
 * Issue 4 — Background-Safe Play Logic
 *
 * Uygulama arka planda çalışıyorken (Spotify, YouTube Music vb.) sendMediaAction()
 * ile müzik başlatılır. launchApp() KULLANILMAZ — bu çağrı uygulamayı ön plana
 * getirir ve kullanıcı müzik çalar ekranından uzaklaşır.
 *
 * Eğer uygulama arka planda değil, tamamen kapalıysa sendMediaAction() etkisiz
 * kalabilir; bu durumda kullanıcı uygulamayı bir kez kendisi açmalıdır.
 *
 * Kaynak seçilmemişse: önce aktif oturumdan paket tespit edilir, yoksa
 * DEFAULT_PLAY_PACKAGES listesindeki ilk pakete geçilir.
 */
const WARMUP_CHECK_MS  = 1_500;
const MAX_WARMUP_TRIES = 2;

/** Tercih edilen paket yoksa sırayla denenir */
const DEFAULT_PLAY_PACKAGES = [
  'com.spotify.music',
  'com.google.android.apps.youtube.music',
  'com.maxmpz.audioplayer',
];

async function _sendWithWarmup(action: 'play' | 'pause'): Promise<void> {
  // Kaynak seçilmemişse: aktif oturumdan veya varsayılan listeden paket seç
  if (action === 'play' && !_preferredPackage) {
    try {
      const active = await CarLauncher.getMediaInfo();
      _preferredPackage = active.packageName || DEFAULT_PLAY_PACKAGES[0];
    } catch {
      _preferredPackage = DEFAULT_PLAY_PACKAGES[0];
    }
  }

  // Uygulamayı ön plana almadan medya komutu gönder.
  // Arka planda yaşayan uygulamalar (Spotify, YouTube Music vb.) bu komutu alır ve çalmaya başlar.
  await CarLauncher.sendMediaAction({ action });

  // pause için doğrulama/yeniden deneme gereksiz
  if (action !== 'play') return;

  await new Promise<void>((r) => setTimeout(r, WARMUP_CHECK_MS));

  let info: NativeMediaInfo;
  try {
    info = await CarLauncher.getMediaInfo(
      _preferredPackage ? { preferredPackage: _preferredPackage } : undefined,
    );
  } catch {
    return;
  }

  if (info.playing) return;

  // Hâlâ çalmıyorsa tekrar dene — uygulama arka planda uyandırılıyor olabilir
  for (let attempt = 0; attempt < MAX_WARMUP_TRIES; attempt++) {
    try {
      await CarLauncher.sendMediaAction({ action: 'play' });
      await new Promise<void>((r) => setTimeout(r, 500));
      const verify = await CarLauncher.getMediaInfo(
        _preferredPackage ? { preferredPackage: _preferredPackage } : undefined,
      );
      if (verify.playing) break;
    } catch (e) {
      logError(`Media:Warmup:try${attempt}`, e);
      break;
    }
  }
}

/** Aktif paket uygulama-içi oynatıcı mı (stream / youtube / yerel)? */
function _isInAppPkg(pkg: string): boolean {
  return pkg === 'com.cockpitos.pro.stream'
      || pkg === 'com.cockpitos.pro.youtube'
      || pkg === 'com.cockpitos.pro';
}

/**
 * Çalmayı BAŞLAT/DEVAM ETTİR. Sesli komut ("müzik başlat/çal") ve MediaSession
 * 'play' aksiyonu buraya gelir.
 *
 * Eski sürüm yalnız native MediaSession'a 'play' yolluyordu → tarayıcıda no-op,
 * cihazda da uygulama-içi parçayı/placeholder'ı devam ettirmiyordu ("başlatıldı
 * der ama çalmaz"). Yeni davranış:
 *   1) Aktif in-app oturum (stream/youtube/yerel) duraklatılmışsa → devam ettir
 *      (togglePlayPause stream/youtube'u web'de de yönlendirir).
 *   2) Oturum yoksa → son çalınan parçayı (placeholder dahil) resumeLastMedia ile
 *      başlat; o da yoksa native MediaSession 'play' (harici uygulama).
 */
export function play(): void {
  if (_isInAppPkg(_current.activePackage) && _current.hasSession) {
    if (!_current.playing) togglePlayPause();   // yalnız duraklatılmışsa devam ettir
    return;
  }
  // Oturum yok → son medyayı devam ettir. Lazy import: carosMediaLayer mediaService'i
  // import ettiğinden statik döngüyü kırmak için dinamik import.
  void import('./media/carosMediaLayer')
    .then(({ resumeLastMedia }) => {
      if (!resumeLastMedia() && isNative) _sendWithWarmup('play').catch((e) => logError('Media:Play', e));
    })
    .catch(() => { if (isNative) _sendWithWarmup('play').catch((e) => logError('Media:Play', e)); });
}

/**
 * Çalmayı DURDUR/DURAKLAT. Sesli komut ("müziği durdur") ve MediaSession 'pause'
 * aksiyonu buraya gelir. Aktif in-app oturumu doğru servise yönlendirir (web +
 * native); yoksa native MediaSession 'pause'.
 */
export function pause(): void {
  if (_isInAppPkg(_current.activePackage) && _current.hasSession) {
    if (_current.playing) togglePlayPause();    // yalnız çalıyorsa duraklat
    return;
  }
  if (!isNative) return;
  _sendWithWarmup('pause').catch((e) => logError('Media:Pause', e));
}

export function togglePlayPause(): void {
  // Stream (uygulama içi internet akışı) aktifse → streamMusicService (web + native).
  // isNative guard'ından ÖNCE: stream web'de de çalar.
  if (_current.activePackage === 'com.cockpitos.pro.stream') {
    import('./streamMusicService').then(({ streamTogglePlayPause }) => streamTogglePlayPause()).catch(() => {});
    return;
  }
  if (_current.activePackage === 'com.cockpitos.pro.youtube') {
    import('./youtubeService').then(({ youtubeTogglePlayPause }) => youtubeTogglePlayPause()).catch(() => {});
    return;
  }
  if (!isNative) return;
  // Yerel müzik aktifse localMusicService'e yönlendir (circular import önlemek için lazy import)
  if (_current.activePackage === 'com.cockpitos.pro') {
    import('./localMusicService').then(({ localTogglePlayPause }) => localTogglePlayPause()).catch(() => {});
    return;
  }
  if (_current.playing) { pause(); } else { play(); }
}

export function toggleShuffle(): void {
  if (!isNative) return;
  // shuffle state Android tarafından MediaSession event ile güncellenir
  // Şimdilik local state güncelle — native destek eklenince kaldır
  updateMediaState({ shuffle: !_current.shuffle });
}

export function cycleRepeat(): void {
  if (!isNative) return;
  const next: MediaState['repeat'] =
    _current.repeat === 'off' ? 'all' : _current.repeat === 'all' ? 'one' : 'off';
  updateMediaState({ repeat: next });
}

export function next(): void {
  if (!isNative) return;
  if (_current.activePackage === 'com.cockpitos.pro') {
    import('./localMusicService').then(({ localNext }) => localNext()).catch(() => {});
    return;
  }
  CarLauncher.sendMediaAction({ action: 'next' }).catch((e) => { logError('Media:Next', e); });
}

export function previous(): void {
  if (!isNative) return;
  if (_current.activePackage === 'com.cockpitos.pro') {
    import('./localMusicService').then(({ localPrev }) => localPrev()).catch(() => {});
    return;
  }
  CarLauncher.sendMediaAction({ action: 'previous' }).catch((e) => { logError('Media:Prev', e); });
}

/* ── React hook ──────────────────────────────────────────── */

export function useMediaState(): MediaState {
  return useSyncExternalStore(
    (onStoreChange) => {
      _listeners.add(onStoreChange as any);
      return () => { _listeners.delete(onStoreChange as any); };
    },
    () => _current,
    () => _current,
  );
}

/* ── Utility ─────────────────────────────────────────────── */

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec); // floating-point artifact'ı önle
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ── Package → source mapping ────────────────────────────── */

const PACKAGE_SOURCE: Record<string, MediaSource> = {
  'com.spotify.music':                      'spotify',
  'com.google.android.youtube':             'youtube',
  'com.google.android.apps.youtube.music':  'youtube_music',
  'com.vanced.android.youtube':             'youtube',
  'app.revanced.android.youtube':           'youtube',
  'com.soundcloud.android':                 'local',
  'com.amazon.music':                       'local',
  'com.deezer.android.app':                 'local',
  'com.tidal.android':                      'local',
  'com.apple.android.music':                'local',
  'com.kapp.youtube.music':                 'youtube_music',
  'com.maxmpz.audioplayer':                 'local',
  'org.videolan.vlc':                       'local',
};

const PACKAGE_LABEL: Record<string, string> = {
  'com.spotify.music':                      'Spotify',
  'com.google.android.youtube':             'YouTube',
  'com.google.android.apps.youtube.music':  'YouTube Music',
  'com.vanced.android.youtube':             'YouTube',
  'app.revanced.android.youtube':           'YouTube',
  'com.soundcloud.android':                 'SoundCloud',
  'com.amazon.music':                       'Amazon Müzik',
  'com.deezer.android.app':                 'Deezer',
  'com.tidal.android':                      'Tidal',
  'com.apple.android.music':                'Apple Music',
  'com.kapp.youtube.music':                 'YMusic',
  'com.maxmpz.audioplayer':                 'Poweramp',
  'org.videolan.vlc':                       'VLC',
};

function applyNativeMediaInfo(info: NativeMediaInfo): void {
  try {
    if (!info || typeof info !== 'object') return;

    const pkg = info.packageName ?? '';

    /* ── Issue 1: Focus Lock ─────────────────────────────────────────
     * Kullanıcı manuel kaynak seçiminden sonra 5 saniyelik pencerede
     * başka bir paketin session'ı ekranı ele geçirmesini engelle.
     * Tercih edilen paketin kendi event'leri her zaman geçer.
     */
    if (
      _focusLockUntil > performance.now() &&
      _preferredPackage &&
      pkg !== _preferredPackage
    ) return;

    /* ── Çakışma önleme: Exclusive Source Lock ──────────────────────
     * Native kaynak çalmaya başladıysa yerel müzik aktifse durdur.
     * Circular import: lazy import ile çözülür (localMusicService → mediaService zaten var).
     */
    if (info.playing && pkg && pkg !== 'com.cockpitos.pro' && _current.activePackage === 'com.cockpitos.pro') {
      import('./localMusicService').then(({ stopLocalMusic }) => stopLocalMusic()).catch(() => {});
    }

    const source: MediaSource = PACKAGE_SOURCE[pkg]
      ?? (pkg.toLowerCase().includes('bluetooth') ? 'bluetooth' : 'unknown');
    const appName    = PACKAGE_LABEL[pkg] || info.appName || 'Medya';
    const hasSession = !!(info.title || info.artist || info.playing);

    /* ── Issue 5: Session Grace Period ──────────────────────────────
     * Session kapanınca (hasSession false) anında boş ekrana geçme.
     * 3 saniyelik grace timer: bu sürede session geri gelirse (parça
     * değişimi, sistem geçişi) boşluk flaşı olmaz.
     */
    if (!hasSession && _current.hasSession) {
      if (!_sessionFallbackTimer) {
        _sessionFallbackTimer = setTimeout(() => {
          _sessionFallbackTimer = null;
          updateMediaState({ hasSession: false, playing: false });
        }, SESSION_GRACE_MS);
      }
      return; // Grace süresi dolana kadar mevcut bilgiyi tut
    }

    // Session geri geldiyse bekleyen grace timer'ı iptal et
    if (hasSession && _sessionFallbackTimer) {
      clearTimeout(_sessionFallbackTimer);
      _sessionFallbackTimer = null;
    }

    /* ── Metadata Sanitizer ─────────────────────────────────────────
     * Focus Lock ve Grace kontrolünden geçtikten sonra çalışır.
     * null/"Unknown" değerleri akıllı paket-tabanlı metinlerle doldurur.
     */
    const { title: incomingTitle, artist: incomingArtist } =
      _sanitizeMetadata(info.title, info.artist, pkg);

    /* ── albumArt Memoization ───────────────────────────────────────
     * Base64 kapak ~20–80 KB. Poll döngüsünde aynı kapağı tekrar
     * bridge'den state'e taşımak gereksiz GC baskısı yaratır.
     * DJB2 hash karşılaştırması: sadece parça değişince güncelle.
     */
    let albumArt = _current.track.albumArt;
    if (info.albumArt) {
      const incomingHash = _djb2(info.albumArt);
      if (incomingHash !== _lastArtHash) {
        _lastArtHash = incomingHash;
        albumArt     = info.albumArt;
        // Yeni albüm kapağı → ambient renk güncelle (async, sızıntısız)
        _extractAndApplyAccent(info.albumArt);
      }
    }

    /* ── Smooth Position Sync (Interpolation Engine) ────────────────
     * 5s poll'dan gelen native pozisyon ile 100ms interpolasyonlu
     * pozisyon arasındaki farkı değerlendir:
     *   ≤ POSITION_DRIFT_S → interpolated değeri koru (pürüzsüz animasyon)
     *   > POSITION_DRIFT_S → native pozisyona snap (seek / parça değişimi)
     */
    const nativePos   = info.positionMs > 0 ? info.positionMs / 1000 : _current.track.positionSec;
    const drift       = Math.abs(nativePos - _current.track.positionSec);
    const positionSec = drift <= POSITION_DRIFT_S ? _current.track.positionSec : nativePos;
    const durationSec = info.durationMs > 0 ? info.durationMs / 1000 : _current.track.durationSec;

    // Hiçbir anlamlı değişiklik yoksa listener'ları tetikleme
    if (
      incomingTitle  === _current.track.title   &&
      incomingArtist === _current.track.artist  &&
      info.playing   === _current.playing       &&
      hasSession     === _current.hasSession     &&
      albumArt       === _current.track.albumArt
    ) return;

    updateMediaState({
      hasSession,
      playing:       info.playing,
      source,
      activePackage: pkg,
      activeAppName: appName,
      track: {
        title:  incomingTitle,
        artist: incomingArtist,
        albumArt,
        durationSec,
        positionSec,
      },
    });
  } catch (e) {
    logError('Media:ApplyInfo', e);
    try { updateMediaState({ hasSession: false }); } catch { /* ignore */ }
  }
}

/* ── MediaHub session polling ────────────────────────────── */

let _hubTimer:        ReturnType<typeof setInterval> | null = null;
let _hubListenerStop: (() => void) | null = null;
let _hubStarted       = false;
let _preferredPackage = '';

// Ön plana dönünce anında poll — Android WebView arka planda JS'yi askıya alır,
// setInterval kaçırılır. visibilitychange garantili ilk fırsatta çalışır.
function _handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && _hubStarted && isNative) {
    void _pollNative();
  }
}

export function setMediaPreferredPackage(pkg: string): void {
  _preferredPackage = pkg;
  // Issue 1: kullanıcı aktif olarak kaynak seçti — 5 saniyelik focus lock başlat.
  // Bu pencere içinde gelen sistem session event'leri (başka paket) reddedilir.
  _focusLockUntil = performance.now() + FOCUS_LOCK_MS;
  if (_hubStarted && isNative) void _pollNative();
}

function _isPermissionError(e: unknown): boolean {
  const msg  = (e instanceof Error ? e.message : String(e)) ?? '';
  const code = (e as { code?: string }).code ?? '';
  return (
    code === 'NO_LISTENER' ||
    msg.includes('NO_LISTENER') ||
    msg.includes('Bildirim erişim') ||
    msg.includes('PERMISSION_DENIED')
  );
}

/* Uygulama-içi (WebView) kaynaklar — kendi servisleriyle yönetilir (YouTube IFrame,
 * HTML5 stream, yerel MediaPlayer). Bunlar native MediaController değil; 5sn'lik native
 * poll bunların state'ini (hasSession/playing/track) EZMEMELİ — yoksa YouTube videosu
 * kararır, oynatma kontrolleri sıfırlanır. Gerçek harici oturum değişimleri yine
 * 'mediaChanged' event'iyle gelir (poll'dan bağımsız). */
const IN_APP_PACKAGES = new Set([
  'com.cockpitos.pro',
  'com.cockpitos.pro.youtube',
  'com.cockpitos.pro.stream',
]);

async function _pollNative(): Promise<void> {
  // Aktif kaynak uygulama-içiyse native poll'u atla (in-app servis state'i otoritedir).
  if (_current.hasSession && IN_APP_PACKAGES.has(_current.activePackage)) return;
  try {
    const info = await CarLauncher.getMediaInfo(
      _preferredPackage ? { preferredPackage: _preferredPackage } : undefined,
    );
    if (_current.permissionRequired) updateMediaState({ permissionRequired: false });
    applyNativeMediaInfo(info);
  } catch (e: unknown) {
    if (_isPermissionError(e)) {
      // NO_LISTENER → MediaListenerService.instance henüz null.
      // Bu iki sebepten kaynaklanabilir:
      //   1. Kullanıcı bildirim izni VERMEMİŞ → gerçek "İZİN GEREKLİ"
      //   2. İzin verilmiş ama Android henüz servisi bind etmemiş (birkaç saniye) → bekle
      // Gerçek izin durumunu native'den sorgula — sahte "İZİN GEREKLİ" göstermeyelim.
      try {
        const { granted } = await CarLauncher.checkNotificationAccess();
        if (granted) {
          // İzin var, servis bind ediliyor — permissionRequired flag'i bastır
          if (_current.permissionRequired) updateMediaState({ permissionRequired: false });
          if (_current.hasSession) updateMediaState({ hasSession: false });
        } else {
          // Gerçekten izin yok
          updateMediaState({ hasSession: false, permissionRequired: true });
        }
      } catch {
        // checkNotificationAccess başarısız — eski davranışa düş
        updateMediaState({ hasSession: false, permissionRequired: true });
      }
    } else {
      // Session yok veya başka hata — izin var ama müzik çalmıyor
      if (_current.hasSession) updateMediaState({ hasSession: false });
      if (_current.permissionRequired) updateMediaState({ permissionRequired: false });
    }
  }
}

/**
 * startMediaHub — Android native: event listener + 5s poll.
 * Web: hiçbir şey yapmaz. Web'de harici uygulama session'ı okunamaz.
 */
export async function startMediaHub(): Promise<void> {
  if (_hubStarted) return;
  _hubStarted = true;

  // MediaSession API: sistem donanım tuşlarını her zaman kaydet (native + web)
  _setupMediaSession();

  // Ön plan/arka plan geçişinde anında poll
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', _handleVisibilityChange);
  }

  // WEB MODU: tamamen pasif — fake polling yok
  if (!isNative) return;

  // Gerçek zamanlı MediaSession event dinle
  try {
    const handle = await CarLauncher.addListener('mediaChanged', (info) => {
      if (_current.permissionRequired) updateMediaState({ permissionRequired: false });
      applyNativeMediaInfo(info);
    });
    _hubListenerStop = () => { try { handle.remove(); } catch { /* ignore */ } };
  } catch (e) {
    logError('Media:Listener', e);
    // Plugin event desteği yok — poll only mode
  }

  // 5s poll — event'ler arası boşlukları doldurur; 3s'den artırıldı (pil tasarrufu)
  void _pollNative();
  if (_hubTimer) clearInterval(_hubTimer);
  _hubTimer = setInterval(() => { void _pollNative(); }, 5_000);
}

export function stopMediaHub(): void {
  _hubStarted = false;
  _teardownMediaSession();
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', _handleVisibilityChange);
  }
  if (_hubTimer) { clearInterval(_hubTimer); _hubTimer = null; }
  if (_hubListenerStop) {
    const stop = _hubListenerStop;
    _hubListenerStop = null;
    try { stop(); } catch (e) { logError('Media:StopHub', e); }
  }
  // Grace timer + interpolation temizle — unmount sonrası stale update olmasın
  if (_sessionFallbackTimer) { clearTimeout(_sessionFallbackTimer); _sessionFallbackTimer = null; }
  _stopInterpolation();
  _focusLockUntil = 0;
  _lastArtHash    = 0;
}

/**
 * Anında tek seferlik poll — uygulama ön plana gelince şarkı bilgisini hemen güncelle.
 */
export function pollMediaNow(): void {
  if (!isNative || !_hubStarted) return;
  void _pollNative();
}

export function openMediaPermissionSettings(): void {
  if (!isNative) return;
  CarLauncher.requestNotificationAccess().catch(() => { /* ignore */ });
}
