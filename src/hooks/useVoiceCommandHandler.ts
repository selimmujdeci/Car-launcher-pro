import { useEffect, useRef } from 'react';
import { toIntent, routeIntent } from '../platform/intentEngine';
import { registerCommandHandler, registerAIResultHandler } from '../platform/voiceService';
import { pause, play, next, previous, getMediaState, setMediaPreferredPackage } from '../platform/mediaService';
import { bridge, isNative } from '../platform/bridge';
import { showToast } from '../platform/errorBus';
import { CarLauncher } from '../platform/nativePlugin';
import type { MusicOptionKey } from '../data/apps';
import type { MusicFavorite, AppSettings } from '../store/useStore';
import { useStore } from '../store/useStore';
import { useCarTheme, baseOf, toDay, toNight, isDay, type CoreTheme } from '../store/useCarTheme';
import { getVoiceSetting } from '../platform/settingsVoice';

// activeMediaSourceKey değerleri içinde geçerli MusicOptionKey olabilenler
const _MUSIC_KEY_SET = new Set<string>(['spotify', 'youtube'] satisfies MusicOptionKey[]);

/* ── Sesli tema kontrolü ───────────────────────────────────────────────
 * Sesli komutlar GÖRÜNÜR temayı (useCarTheme) değiştirir — eskiden yalnızca
 * kullanılmayan useStore.settings.theme flag'ine yazıyordu (görsel etki yoktu).
 * getState() React dışında ve monomorfik çağrıda güvenli (zero re-render). */
function applyVoiceTheme(mode: 'night' | 'day' | 'oled' | 'dark'): void {
  const { theme, setTheme } = useCarTheme.getState();
  if (mode === 'oled')     setTheme('oled');            // saf siyah (düşük güç)
  else if (mode === 'day') setTheme(toDay(theme));      // mevcut temanın gündüz varyantı
  else                     setTheme(toNight(theme));    // 'night' | 'dark' → gece varyantı
}

// "tema değiştir" → core temalar arasında döngü; gündüz/gece tercihi korunur.
const _THEME_CYCLE: CoreTheme[] = ['expedition', 'horizon', 'tesla', 'mercedes', 'pro', 'sunlight'];
function cycleVoiceTheme(): void {
  const { theme, setTheme } = useCarTheme.getState();
  const idx  = _THEME_CYCLE.indexOf(baseOf(theme) as CoreTheme); // legacy/bilinmeyen → -1 → ilk tema
  const next = _THEME_CYCLE[(idx + 1) % _THEME_CYCLE.length];
  // sunlight'ın -day varyantı yok; diğerlerinde gündüz tercihini koru
  setTheme(isDay(theme) && next !== 'sunlight' ? toDay(next) : next);
}

/* ── Sesli ayar kontrolü (set_setting, toggle_wifi/bt, brightness) ─────────
 * Aksiyonu doğrudan AppSettings'e (veya wifi/bt/brightness native) uygular.
 * getState() React dışında güvenli; openTab için drawer açıcı callback geçilir. */
const _SETTING_STEP = 10;
async function applyVoiceSetting(
  key: string,
  action: string,
  value: string | undefined,
  kind: string | undefined,
  openSettings: () => void,
): Promise<void> {
  // WiFi / Bluetooth — Android 10+ doğrudan açmayı engeller → sistem panelini aç (fail-soft)
  if (key === 'wifi' || key === 'bluetooth') {
    if (isNative) {
      try {
        if (key === 'wifi') await CarLauncher.openWifiSettings?.();
        else                await CarLauncher.openBluetoothSettings?.();
      } catch { /* fail-soft: panel açılamadı */ }
    }
    return;
  }

  const update  = useStore.getState().updateSettings;
  const s        = useStore.getState().settings as unknown as Record<string, unknown>;
  const effKind  = kind ?? getVoiceSetting(key)?.kind;

  if (effKind === 'openTab') { openSettings(); return; }

  if (effKind === 'enum') {
    if (value) update({ [key]: value } as unknown as Partial<AppSettings>);
    return;
  }

  if (effKind === 'number') {
    const cur = Number(s[key] ?? 0);
    let next = cur;
    if (action === 'set' && value)      next = parseInt(value, 10);
    else if (action === 'inc')          next = cur + _SETTING_STEP;
    else if (action === 'dec')          next = cur - _SETTING_STEP;
    next = Math.max(0, Math.min(100, Number.isFinite(next) ? next : cur));
    update({ [key]: next } as unknown as Partial<AppSettings>);
    if (key === 'brightness' && isNative) {
      try { await CarLauncher.setBrightness({ value: Math.round((next / 100) * 255) }); } catch { /* fail-soft */ }
    }
    return;
  }

  // bool (varsayılan) — on/off/toggle
  const curBool  = Boolean(s[key]);
  const nextBool = action === 'toggle' ? !curBool : action === 'on';
  update({ [key]: nextBool } as unknown as Partial<AppSettings>);
}

// Android paket adından store'daki kaynak anahtarına eşleme
const PKG_TO_SOURCE_KEY: Record<string, string> = {
  'com.spotify.music':                     'spotify',
  'com.google.android.apps.youtube.music': 'youtube_music',
  'com.kapp.youtube.music':                'ymusic',
  'com.maxmpz.audioplayer':                'poweramp',
  'org.videolan.vlc':                      'vlc',
  'com.soundcloud.android':                'soundcloud',
  'com.amazon.music':                      'amazon',
  'com.deezer.android.app':                'deezer',
  'com.tidal.android':                     'tidal',
};

// Android paketinden carosMediaLayer arama filtresine eşleme (kaynak tercihi).
// Eşleşmeyen paketler → 'all' (kaynak fark etmez). Spotify bağlı değilse playByQuery
// otomatik 'all'a düşer; ana Türkçe kaynak YouTube (Piped) zaten 'all' içinde.
const PKG_TO_CAROS_FILTER: Record<string, string> = {
  'com.spotify.music':                     'spotify',
  'com.google.android.apps.youtube.music': 'youtube',
  'com.google.android.youtube':            'youtube',
  'com.kapp.youtube.music':                'youtube',
};

// Kaynak anahtarından Android paket adına eşleme
const SOURCE_KEY_TO_PKG: Record<string, string> = {
  'spotify':       'com.spotify.music',
  'youtube_music': 'com.google.android.apps.youtube.music',
  'ymusic':        'com.kapp.youtube.music',
  'poweramp':      'com.maxmpz.audioplayer',
  'vlc':           'org.videolan.vlc',
  'soundcloud':    'com.soundcloud.android',
  'amazon':        'com.amazon.music',
  'deezer':        'com.deezer.android.app',
  'tidal':         'com.tidal.android',
};

// Kaynak anahtarından arama URI oluşturucu
const SOURCE_KEY_TO_SEARCH_URI: Record<string, (q: string) => string> = {
  'spotify':       (q) => `spotify:search:${encodeURIComponent(q)}`,
  'youtube_music': (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
  'ymusic':        (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
  'soundcloud':    (q) => `https://soundcloud.com/search?q=${encodeURIComponent(q)}`,
  'deezer':        (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}`,
  'tidal':         (q) => `tidal://search?q=${encodeURIComponent(q)}`,
};

// Kaynak görünen adları — "yüklü değil" mesajı için
const SOURCE_KEY_TO_NAME: Record<string, string> = {
  'spotify':       'Spotify',
  'youtube_music': 'YouTube Music',
  'ymusic':        'YMusic',
  'poweramp':      'Poweramp',
  'vlc':           'VLC',
  'soundcloud':    'SoundCloud',
  'amazon':        'Amazon Müzik',
  'deezer':        'Deezer',
  'tidal':         'Tidal',
};

// Yüklü paket önbelleği — her 60 saniyede yenilenir
let _installedPkgCache: Set<string> | null = null;
let _installedPkgCacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function _isInstalled(pkg: string): Promise<boolean> {
  if (!pkg || !isNative) return true; // web modda kontrol yok
  const now = Date.now();
  if (!_installedPkgCache || now - _installedPkgCacheAt > CACHE_TTL_MS) {
    try {
      const { apps } = await CarLauncher.getApps();
      _installedPkgCache = new Set(apps.map((a) => a.packageName));
      _installedPkgCacheAt = now;
    } catch {
      return true; // hata → launchApp zaten toast gösterir
    }
  }
  return _installedPkgCache.has(pkg);
}

async function _speakAndToast(msg: string): Promise<void> {
  showToast({ type: 'info', title: 'Müzik', message: msg, duration: 4000 });
  if (isNative) {
    try { await CarLauncher.speak({ text: msg }); } catch { /* ignore */ }
  }
}

import { resolveAndNavigate } from '../platform/addressNavigationEngine';
import { getGPSState } from '../platform/gpsService';
import type { ParsedCommand } from '../platform/commandParser';
import type { SmartSnapshot } from '../platform/smartEngine';
import type { DrawerType } from '../components/layout/DockBar';
import { executeAIResult } from '../platform/commandExecutor';

interface UseVoiceCommandHandlerParams {
  settings: AppSettings;
  smart: SmartSnapshot;
  handleLaunch: (id: string) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;
  setDrawer: (drawer: DrawerType) => void;
  openWeather?: () => void;
}

export function useVoiceCommandHandler({
  settings,
  smart,
  handleLaunch,
  updateSettings,
  setDrawer,
  openWeather,
}: UseVoiceCommandHandlerParams): void {
  const voiceCtxRef = useRef({ settings, smart, handleLaunch, updateSettings, setDrawer, openWeather });
  useEffect(() => { voiceCtxRef.current = { settings, smart, handleLaunch, updateSettings, setDrawer, openWeather }; });

  useEffect(() => {
    return registerAIResultHandler((aiResult, vehicleCtx) => {
      const { settings: s, handleLaunch: launch, setDrawer: open, openWeather: showWeather } = voiceCtxRef.current;
      executeAIResult(aiResult, {
        vehicleCtx: vehicleCtx ?? { speedKmh: 0, drivingMode: 'idle', isDriving: false },
        defaultNav:   s.defaultNav as 'maps' | 'waze' | 'yandex',
        defaultMusic: s.defaultMusic,
        launch,
        setTheme:    applyVoiceTheme,
        openDrawer:  (t) => open(t as DrawerType),
        applySetting: (key, action, value, kind) =>
          void applyVoiceSetting(key, action, value, kind, () => open('settings' as DrawerType)),
        openWeather: showWeather,
      });
    });
  }, []);

  useEffect(() => {
    return registerCommandHandler((cmd: ParsedCommand) => {
      const { settings: s, smart: sm, handleLaunch: launch, updateSettings: update, setDrawer: open, openWeather: showWeather } = voiceCtxRef.current;
      if (cmd.type === 'toggle_sleep_mode') { update({ sleepMode: !s.sleepMode }); return; }

      // Serbest adres navigasyonu — intentEngine'e geçmeden burada çözülür
      if (
        cmd.type === 'navigate_address' ||
        cmd.type === 'navigate_place'   ||
        cmd.type === 'find_nearby_gas'  ||
        cmd.type === 'find_nearby_parking'
      ) {
        const dest = cmd.extra?.destination ?? cmd.raw;
        const gps  = getGPSState().location;
        resolveAndNavigate(
          dest,
          gps ? { lat: gps.latitude, lng: gps.longitude } : undefined,
        );
        return;
      }
      // activeMediaSourceKey geçerli bir MusicOptionKey ise defaultMusic'e öncelik tanır.
      const _activeKey = s.activeMediaSourceKey;
      const effectiveMusic: MusicOptionKey = (_activeKey && _MUSIC_KEY_SET.has(_activeKey))
        ? (_activeKey as MusicOptionKey)
        : s.defaultMusic;

      const intent = toIntent(cmd, {
        defaultNav: s.defaultNav, defaultMusic: effectiveMusic,
        recentAppId: sm.quickActions.find((a) => a.id.startsWith('last-'))?.appId,
      });
      routeIntent(intent, {
        launch,
        openDrawer:  (t) => open(t as DrawerType),
        setTheme:    applyVoiceTheme,
        cycleTheme:  cycleVoiceTheme,
        applySetting: (key, action, value, kind) =>
          void applyVoiceSetting(key, action, value, kind, () => open('settings' as DrawerType)),
        playMedia:   play,
        pauseMedia:  pause,
        nextTrack:   next,
        prevTrack:   previous,
        volumeUp:         () => update({ volume: Math.min(100, useStore.getState().settings.volume + 10) }),
        volumeDown:       () => update({ volume: Math.max(0,   useStore.getState().settings.volume - 10) }),
        openWeather:      showWeather,
        navigateToPlace: (query) => {
          const gps = getGPSState().location;
          resolveAndNavigate(query, gps ? { lat: gps.latitude, lng: gps.longitude } : undefined);
        },
        playMusicSearch: (appKey, query) => {
          // Şarkı/sanatçı adı → KAYNAK FARK ETMEKSİZİN uygulama içinde çal.
          void (async () => {
            const { playByQuery } = await import('../platform/media/carosMediaLayer');
            const filter = (appKey === 'spotify' || appKey === 'youtube') ? appKey : 'all';
            const played = await playByQuery(query, filter);
            if (played) {
              open('music' as DrawerType);
              void _speakAndToast(`${played.title}${played.subtitle ? ' — ' + played.subtitle : ''} çalınıyor`);
            } else {
              void _speakAndToast(`"${query}" bulunamadı`);
            }
          })();
        },

        playMusicQuery: (pkg, searchUri, _queryType, fallbackKey, query) => {
          // Yüklü olup olmadığını async kontrol et, sonuç gelince işlem yap
          void (async () => {
            // ── 0. Şarkı/sanatçı adı verildi → KAYNAK FARK ETMEKSİZİN uygulama içinde çal ──
            //    Sesli asistan birincil davranışı: harici uygulamaya gitmeden, en iyi eşleşmeyi çal.
            const q = (query ?? '').trim();
            if (q.length >= 2) {
              const { playByQuery } = await import('../platform/media/carosMediaLayer');
              const filter = pkg ? (PKG_TO_CAROS_FILTER[pkg] ?? 'all') : 'all';
              const played = await playByQuery(q, filter);
              if (played) {
                open('music' as DrawerType);
                void _speakAndToast(`${played.title}${played.subtitle ? ' — ' + played.subtitle : ''} çalınıyor`);
              } else {
                void _speakAndToast(`"${q}" bulunamadı`);
              }
              return;
            }

            // ── 1. Belirli bir kaynak (pkg) istendi ──────────────────────
            if (pkg) {
              const installed = await _isInstalled(pkg);
              if (!installed) {
                // Kaynak adını bul ve sesli + görsel bildir
                const sourceKey = PKG_TO_SOURCE_KEY[pkg];
                const name = sourceKey ? (SOURCE_KEY_TO_NAME[sourceKey] ?? sourceKey) : pkg;
                void _speakAndToast(`${name} bu cihazda yüklü değil`);
                return;
              }
              // Kuruluysa: kaynak güncelle
              setMediaPreferredPackage(pkg);
              const sourceKey = PKG_TO_SOURCE_KEY[pkg];
              if (sourceKey) update({ activeMediaSourceKey: sourceKey });
            }

            // ── 2. searchUri varsa → uygulamayı aç ve aramasını yap ─────
            if (searchUri) {
              bridge.launchMusicQuery(pkg, searchUri, fallbackKey);
              return;
            }

            // ── 3. searchUri yok ama query var → aktif kaynakta ara ─────
            if (query) {
              // Hangi kaynağı kullanacağız?
              const activeKey = s.activeMediaSourceKey || fallbackKey || 'spotify';
              const activePkg = pkg || SOURCE_KEY_TO_PKG[activeKey] || '';
              const uriGen    = SOURCE_KEY_TO_SEARCH_URI[activeKey];

              if (activePkg && uriGen) {
                // Aktif kaynak kurulu mu kontrol et
                const installed = pkg ? true : await _isInstalled(activePkg);
                if (!installed) {
                  const name = SOURCE_KEY_TO_NAME[activeKey] ?? activeKey;
                  void _speakAndToast(`${name} bu cihazda yüklü değil`);
                  return;
                }
                const uri = uriGen(query);
                bridge.launchMusicQuery(activePkg, uri, fallbackKey);
              } else {
                // Son çare: basit arama
                bridge.launchMusicSearch(fallbackKey as MusicOptionKey, query);
              }
              return;
            }

            // ── 4. Ne searchUri ne query → sadece kaynak söylendi ───────
            // Ön plana almadan arka planda çal
            play();
          })();
        },

        addMusicFavorite: () => {
          const media = getMediaState();
          const { addMusicFavorite } = useStore.getState();
          if (!media.hasSession || !media.track.title) {
            showToast({ type: 'info', title: 'Çalan şarkı yok', message: 'Favorilere eklemek için önce bir şarkı çalmalı', duration: 3000 });
            return;
          }
          const fav: MusicFavorite = {
            title:    media.track.title,
            artist:   media.track.artist,
            albumArt: media.track.albumArt,
            source:   media.source,
            addedAt:  Date.now(),
          };
          addMusicFavorite(fav);
          showToast({ type: 'success', title: 'Favorilere eklendi', message: `${media.track.title} — ${media.track.artist}`, duration: 3000 });
        },
      });

    });
  }, []);
}
