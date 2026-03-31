import { useEffect, useRef } from 'react';
import { toIntent, routeIntent } from '../platform/intentEngine';
import { registerCommandHandler } from '../platform/voiceService';
import { pause, play } from '../platform/mediaService';
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
}

export function useVoiceCommandHandler({
  settings,
  smart,
  handleLaunch,
  updateSettings,
  setDrawer,
}: UseVoiceCommandHandlerParams): void {
  const voiceCtxRef = useRef({ settings, smart, handleLaunch, updateSettings, setDrawer });
  useEffect(() => { voiceCtxRef.current = { settings, smart, handleLaunch, updateSettings, setDrawer }; });

  useEffect(() => {
    return registerCommandHandler((cmd: ParsedCommand) => {
      const { settings: s, smart: sm, handleLaunch: launch, updateSettings: update, setDrawer: open } = voiceCtxRef.current;
      if (cmd.type === 'toggle_sleep_mode') { update({ sleepMode: !s.sleepMode }); return; }
      const intent = toIntent(cmd, {
        defaultNav: s.defaultNav, defaultMusic: s.defaultMusic,
        recentAppId: sm.quickActions.find((a) => a.id.startsWith('last-'))?.appId,
      });
      routeIntent(intent, { launch, openDrawer: (t) => open(t as DrawerType), setTheme: (theme) => update({ theme }), playMedia: play, pauseMedia: pause });
    });
  }, []);
}
