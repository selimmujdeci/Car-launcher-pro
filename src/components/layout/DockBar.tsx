import { memo } from 'react';
import {
  LayoutGrid, SlidersHorizontal,
  Camera, Route, ShieldAlert, Shield, Bell, CloudSun, Smartphone,
} from 'lucide-react';
import { VoiceMicButton } from '../modals/VoiceAssistant';
import { useNotificationState } from '../../platform/notificationService';
import { useTrafficState, TRAFFIC_COLORS } from '../../platform/trafficService';
import { useDragScroll } from '../../hooks/useDragScroll';
import type { AppItem } from '../../data/apps';
import type { useSmartEngine } from '../../platform/smartEngine';

export type DrawerType =
  | 'none' | 'apps' | 'settings' | 'dashcam' | 'triplog' | 'dtc'
  | 'notifications' | 'weather' | 'sport' | 'security' | 'entertainment' | 'traffic';

interface Props {
  smart:          ReturnType<typeof useSmartEngine>;
  appMap:         Record<string, AppItem>;
  onLaunch:       (id: string) => void;
  onOpenDrawer:   (d: DrawerType) => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
  onOpenSplit:    () => void;
  onOpenRearCam:  () => void;
  onOpenPassenger:() => void;
}

export const DockBar = memo(function DockBar({
  smart, appMap, onLaunch, onOpenDrawer, onOpenApps, onOpenSettings,
  onOpenSplit, onOpenRearCam, onOpenPassenger,
}: Props) {
  const notifState  = useNotificationState();
  const traffic     = useTrafficState();
  const dockScroll  = useDragScroll();

  return (
    <div data-dock="main" className="flex items-center justify-center px-6 py-3 flex-shrink-0 relative z-20 overflow-hidden">
      <div className="flex items-center gap-2 p-1 rounded-[2rem] bg-black/60 backdrop-blur-3xl border border-white/5 shadow-[0_15px_40px_rgba(0,0,0,0.7)] max-w-5xl w-full relative overflow-hidden group">
        <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

        <div
          ref={dockScroll.ref}
          onPointerDown={dockScroll.onPointerDown}
          onPointerMove={dockScroll.onPointerMove}
          onPointerUp={dockScroll.onPointerUp}
          onPointerCancel={dockScroll.onPointerUp}
          onClick={dockScroll.onClick}
          className="flex items-center gap-2 overflow-x-auto overflow-y-hidden snap-x snap-mandatory no-scrollbar scroll-smooth px-2 py-1 w-full mask-fade select-none"
        >
          {/* Smart dock apps */}
          {smart.dockIds.slice(0, 5).map((id) => {
            const app = appMap[id];
            if (!app) return null;
            return (
              <button key={id} onClick={() => onLaunch(id)}
                className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
                <span className="text-xl leading-none group-hover:scale-110 transition-transform">{app.icon}</span>
                <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">{app.name}</span>
              </button>
            );
          })}

          <div className="w-px h-6 bg-white/5 mx-1 flex-shrink-0" />

          {/* Notifications */}
          <button onClick={() => onOpenDrawer('notifications')}
            className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group relative snap-center">
            <Bell className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" />
            {notifState.unreadCount > 0 && (
              <span className="absolute top-1.5 right-2.5 min-w-[16px] h-4 bg-blue-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 leading-none">
                {notifState.unreadCount > 9 ? '9+' : notifState.unreadCount}
              </span>
            )}
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Bildirim</span>
          </button>

          {/* Dashcam */}
          <button onClick={() => onOpenDrawer('dashcam')}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/15 active:scale-[0.95] transition-all duration-300 group snap-center">
            <Camera className="w-5 h-5 text-red-400/60 group-hover:text-red-400 transition-colors" />
            <span className="text-red-400/40 group-hover:text-red-400 text-[10px] font-black uppercase tracking-[0.2em]">Dashcam</span>
          </button>

          {/* Trip Log */}
          <button onClick={() => onOpenDrawer('triplog')}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <Route className="w-5 h-5 text-slate-500 group-hover:text-emerald-400 transition-colors" />
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Seyir</span>
          </button>

          {/* DTC */}
          <button onClick={() => onOpenDrawer('dtc')}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <ShieldAlert className="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Arıza</span>
          </button>

          {/* Weather */}
          <button onClick={() => onOpenDrawer('weather')}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <CloudSun className="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Hava</span>
          </button>

          <div className="w-px h-6 bg-white/5 mx-1 flex-shrink-0" />

          <div className="flex-shrink-0 snap-center">
            <VoiceMicButton />
          </div>

          {/* Apps */}
          <button onClick={onOpenApps}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-blue-500/5 border border-blue-500/10 hover:bg-blue-500/20 active:scale-[0.95] transition-all duration-300 group snap-center">
            <LayoutGrid className="w-5 h-5 text-blue-400 group-hover:text-blue-300 transition-colors" />
            <span className="text-blue-400/60 group-hover:text-blue-300 text-[10px] font-black uppercase tracking-[0.2em]">Menü</span>
          </button>

          {/* Split Screen */}
          <button onClick={onOpenSplit}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <span className="text-lg leading-none group-hover:scale-110 transition-transform">⊞</span>
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Split</span>
          </button>

          {/* Rear Camera */}
          <button onClick={onOpenRearCam}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <span className="text-lg leading-none group-hover:scale-110 transition-transform">📸</span>
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Arka Kam</span>
          </button>

          {/* Traffic */}
          <button onClick={() => onOpenDrawer('traffic')}
            className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group relative snap-center">
            <span className="text-lg leading-none group-hover:scale-110 transition-transform">🚦</span>
            {traffic.summary && (
              <span className="absolute top-1.5 right-2 w-2.5 h-2.5 rounded-full border border-black/40"
                style={{ backgroundColor: TRAFFIC_COLORS[traffic.summary.level] }} />
            )}
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Trafik</span>
          </button>

          {/* Sport */}
          <button onClick={() => onOpenDrawer('sport')}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/15 active:scale-[0.95] transition-all duration-300 group snap-center">
            <span className="text-lg leading-none group-hover:scale-110 transition-transform">⚡</span>
            <span className="text-red-400/40 group-hover:text-red-400 text-[10px] font-black uppercase tracking-widest">Sport</span>
          </button>

          {/* Security */}
          <button onClick={() => onOpenDrawer('security')}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <Shield className="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Vale</span>
          </button>

          {/* Entertainment */}
          <button onClick={() => onOpenDrawer('entertainment')}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <span className="text-lg leading-none group-hover:scale-110 transition-transform">🎬</span>
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Eğlence</span>
          </button>

          {/* Passenger */}
          <button onClick={onOpenPassenger}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <Smartphone className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" />
            <span className="text-white/30 group-hover:text-blue-400 text-[10px] font-black uppercase tracking-[0.2em]">Yolcu</span>
          </button>

          {/* Settings */}
          <button onClick={onOpenSettings}
            className="flex-shrink-0 min-w-[108px] h-14 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center">
            <SlidersHorizontal className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors" />
            <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Ayarlar</span>
          </button>
        </div>
      </div>
    </div>
  );
});
