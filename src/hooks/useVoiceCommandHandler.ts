import { useEffect, useRef } from 'react';
import { toIntent, routeIntent } from '../platform/intentEngine';
import { registerCommandHandler } from '../platform/voiceService';
import { pause, play, next, previous } from '../platform/mediaService';
import { useStore } from '../store/useStore';
import type { ParsedCommand } from '../platform/commandParser';
import type { SmartSnapshot } from '../platform/smartEngine';
import type { AppSettings } from '../store/useStore';
import type { DrawerType } from '../components/layout/DockBar';

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
    return registerCommandHandler((cmd: ParsedCommand) => {
      const { settings: s, smart: sm, handleLaunch: launch, updateSettings: update, setDrawer: open, openWeather: showWeather } = voiceCtxRef.current;
      if (cmd.type === 'toggle_sleep_mode') { update({ sleepMode: !s.sleepMode }); return; }
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
        volumeUp:    () => update({ volume: Math.min(100, useStore.getState().settings.volume + 10) }),
        volumeDown:  () => update({ volume: Math.max(0,   useStore.getState().settings.volume - 10) }),
        openWeather: showWeather,
      });
    });
  }, []);
}
