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
  hasSession:         false,  // Her zaman false ile başla — gerçek session gelince değişir
  shuffle:            false,
  repeat:             'off',
  permissionRequired: false,
};

const _listeners = new Set<(s: MediaState) => void>();

/* ── Issue 1: Focus lock — kullanıcı/sistem çakışması önleme ─
 * Kullanıcı manuel kaynak seçtiğinde, sistemin başka bir session'a
 * geçmesi 5 saniyelik "focus lock" penceresiyle engellenir.
 * Bu pencere içinde gelen farklı paket bilgileri sessizce reddedilir.
 */
const FOCUS_LOCK_MS = 5_000;
let _focusLockUntil = 0;

/* ── Issue 2: albumArt hash cache ───────────────────────────── */
let _lastArtHash = 0;

/* ── Issue 5: Session grace period — otomotiv standardı ─────
 * ISO 15008 / Android Auto: oturum kapanınca ekran anında boşalmamalı.
 * 3 saniyelik grace penceresi arada-sırada kapanan/açılan oturumların
 * (parça değişimi, sistem geçişleri) boş ekran flaşını engeller.
 */
const SESSION_GRACE_MS = 3_000;
let _sessionFallbackTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Push API ────────────────────────────────────────────── */

export function updateMediaState(partial: Partial<MediaState>): void {
  _current = {
    ..._current,
    ...partial,
    track: partial.track ? { ..._current.track, ...partial.track } : _current.track,
  };
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
 * Issue 4 — Warm-up Retry Logic
 *
 * Problem: sendMediaAction() bir KeyEvent gönderir. Hedef uygulama öldürülmüşse
 * (Android kill-cache), event native tarafından kabul edilir ama uygulama cevap
 * veremez. Sonuç: promise resolve olur, müzik başlamaz.
 *
 * Çözüm (play için — pause'da gerek yok):
 *   1. Komutu gönder.
 *   2. 1500 ms bekle, getMediaInfo() ile etkiyi doğrula.
 *   3. Müzik hâlâ başlamadıysa, paketi intent ile uyandır (warm-up).
 *   4. 1000 ms bekle, tekrar play komutu gönder (max 2 deneme).
 *
 * pause() sadece 1 kez çalışır — zaten çalmayan uygulamayı durdurmak anlamsız.
 */
const WARMUP_CHECK_MS  = 1_500;
const WARMUP_LAUNCH_MS = 1_000;
const MAX_WARMUP_TRIES = 2;

async function _sendWithWarmup(action: 'play' | 'pause'): Promise<void> {
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
    return; // getMediaInfo başarısız — sessizce çık
  }

  if (info.playing) return; // komut çalıştı

  // Uygulama cevap vermedi — launch intent ile uyandır
  const targetPkg = info.packageName || _preferredPackage;
  if (!targetPkg) return;

  for (let attempt = 0; attempt < MAX_WARMUP_TRIES; attempt++) {
    try {
      await CarLauncher.launchApp({ packageName: targetPkg });
      await new Promise<void>((r) => setTimeout(r, WARMUP_LAUNCH_MS));
      await CarLauncher.sendMediaAction({ action: 'play' });

      // Kısa doğrulama — başarılıysa döngüden çık
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

export function play(): void {
  if (!isNative) return;
  _sendWithWarmup('play').catch((e) => logError('Media:Play', e));
}

export function pause(): void {
  if (!isNative) return;
  _sendWithWarmup('pause').catch((e) => logError('Media:Pause', e));
}

export function togglePlayPause(): void {
  if (!isNative) return; // Web: no-op
  _current.playing ? pause() : play();
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
  if (!isNative) return; // Web: no-op
  CarLauncher.sendMediaAction({ action: 'next' }).catch((e) => {
    logError('Media:Next', e);
  });
}

export function previous(): void {
  if (!isNative) return; // Web: no-op
  CarLauncher.sendMediaAction({ action: 'previous' }).catch((e) => {
    logError('Media:Prev', e);
  });
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
      _focusLockUntil > Date.now() &&
      _preferredPackage &&
      pkg !== _preferredPackage
    ) return;

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

    const incomingTitle  = info.title  || _current.track.title;
    const incomingArtist = info.artist || _current.track.artist;

    /* ── Issue 2: albumArt Memoization ──────────────────────────────
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
      }
      // Hash aynıysa: albumArt referansını koru — string kopyalama yok
    }

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
        title:       incomingTitle,
        artist:      incomingArtist,
        albumArt,
        durationSec: info.durationMs > 0 ? Math.round(info.durationMs / 1000) : _current.track.durationSec,
        positionSec: info.positionMs > 0 ? Math.round(info.positionMs / 1000) : _current.track.positionSec,
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

export function setMediaPreferredPackage(pkg: string): void {
  _preferredPackage = pkg;
  // Issue 1: kullanıcı aktif olarak kaynak seçti — 5 saniyelik focus lock başlat.
  // Bu pencere içinde gelen sistem session event'leri (başka paket) reddedilir.
  _focusLockUntil = Date.now() + FOCUS_LOCK_MS;
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

async function _pollNative(): Promise<void> {
  try {
    const info = await CarLauncher.getMediaInfo(
      _preferredPackage ? { preferredPackage: _preferredPackage } : undefined,
    );
    if (_current.permissionRequired) updateMediaState({ permissionRequired: false });
    applyNativeMediaInfo(info);
  } catch (e: unknown) {
    if (_isPermissionError(e)) {
      updateMediaState({ hasSession: false, permissionRequired: true });
    } else {
      // Session yok veya başka hata — izin var ama müzik çalmıyor
      if (_current.hasSession) updateMediaState({ hasSession: false });
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

  // WEB MODU: tamamen pasif — fake polling yok
  if (!isNative) return;

  // Bildirim erişimini kontrol et
  try {
    const { granted } = await CarLauncher.checkNotificationAccess();
    if (!granted) {
      updateMediaState({ hasSession: false, permissionRequired: true });
    }
  } catch { /* checkNotificationAccess desteklenmiyorsa devam et */ }

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

  // 5s poll — event'ler arası boşlukları doldurur
  void _pollNative();
  if (_hubTimer) clearInterval(_hubTimer);
  _hubTimer = setInterval(() => { void _pollNative(); }, 5000);
}

export function stopMediaHub(): void {
  _hubStarted = false;
  if (_hubTimer) { clearInterval(_hubTimer); _hubTimer = null; }
  if (_hubListenerStop) {
    const stop = _hubListenerStop;
    _hubListenerStop = null;
    try { stop(); } catch (e) { logError('Media:StopHub', e); }
  }
  // Grace timer temizle — unmount sonrası stale state update olmasın
  if (_sessionFallbackTimer) { clearTimeout(_sessionFallbackTimer); _sessionFallbackTimer = null; }
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
