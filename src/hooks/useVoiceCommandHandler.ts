import { useEffect, useRef } from 'react';
import { toIntent, routeIntent } from '../platform/intentEngine';
import { registerCommandHandler, registerAIResultHandler } from '../platform/voiceService';
import { pause, play, next, previous, getMediaState } from '../platform/mediaService';
import { bridge } from '../platform/bridge';
import { showToast } from '../platform/errorBus';
import type { MusicOptionKey } from '../data/apps';
import type { MusicFavorite } from '../store/useStore';
import { useStore } from '../store/useStore';
import { resolveAndNavigate } from '../platform/addressNavigationEngine';
import { getGPSState } from '../platform/gpsService';
import type { ParsedCommand } from '../platform/commandParser';
import type { SmartSnapshot } from '../platform/smartEngine';
import type { AppSettings } from '../store/useStore';
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
      const { settings: s, handleLaunch: launch, updateSettings: update, setDrawer: open, openWeather: showWeather } = voiceCtxRef.current;
      executeAIResult(aiResult, {
        vehicleCtx: vehicleCtx ?? { speedKmh: 0, drivingMode: 'idle', isDriving: false },
        defaultNav:   s.defaultNav as 'maps' | 'waze' | 'yandex',
        defaultMusic: s.defaultMusic,
        launch,
        setTheme:    (theme) => update({ theme }),
        openDrawer:  (t) => open(t as DrawerType),
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
      const intent = toIntent(cmd, {
        defaultNav: s.defaultNav, defaultMusic: s.defaultMusic,
        recentAppId: sm.quickActions.find((a) => a.id.startsWith('last-'))?.appId,
      });
      routeIntent(intent, {
        launch,
        openDrawer:  (t) => open(t as DrawerType),
        setTheme:    (theme) => update({ theme }),
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
        playMusicSearch: (appKey, query) =>
          bridge.launchMusicSearch(appKey as MusicOptionKey, query),

        playMusicQuery: (pkg, searchUri, _queryType, fallbackKey) =>
          bridge.launchMusicQuery(pkg, searchUri, fallbackKey),

        addMusicFavorite: () => {
          const media   = getMediaState();
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
