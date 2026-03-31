import { memo, type ReactNode, useState, useCallback, useRef, useEffect, type ComponentType } from 'react';
import {
  Sun, Smartphone, Zap, Palette, Layout, Image as ImageIcon, Check, Layers, PenTool as Tool, Volume2,
  Plus, Monitor, Upload, Wifi, WifiOff, HardDrive, RefreshCw, Database, Cloud, ArrowLeft, X,
  Download, Trash2, Moon,
} from 'lucide-react';
import { useEditStore } from '../../store/useEditStore';
import { useStore } from '../../store/useStore';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../../data/apps';
import { getPerformanceMode, setPerformanceMode } from '../../platform/performanceMode';
import { setBrightness, setVolume } from '../../platform/systemSettingsService';
import { MaintenancePanel } from '../obd/MaintenancePanel';
import { triggerThemeTransition } from '../../platform/themeTransitionService';
import {
  useMapSources,
  useMapNetworkStatus,
  setActiveMapSource,
  refreshMapSources,
  type MapSource,
} from '../../platform/mapSourceManager';
import { LayoutPreview } from './LayoutPreview';
import { useLayoutSync } from '../../platform/themeLayoutEngine';
import {
  TILE_PRESETS,
  estimateTileCount,
  downloadTileRegion,
  cancelTileDownload,
  clearCachedTiles,
  getCachedTileCount,
  subscribeDownloadState,
  getDownloadState,
  type DownloadState,
} from '../../platform/offlineTileDownloader';

/* ── Harita Kaynak Seçimi ────────────────────────────────── */

const MapSourcePanel = memo(function MapSourcePanel() {
  const mapState     = useMapSources();
  const sources: MapSource[] = Array.from(mapState.sources.values());
  const activeId     = mapState.activeSourceId;
  const { isOnline } = useMapNetworkStatus();
  const { updateSettings } = useStore();
  const [refreshing, setRefreshing] = useState(false);

  const handleSelect = useCallback((id: string) => {
    const ok = setActiveMapSource(id);
    if (ok) updateSettings({ activeMapSourceId: id });
  }, [updateSettings]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshMapSources();
    setRefreshing(false);
  }, []);

  return (
    <div className="flex flex-col gap-5 pt-5 border-t border-white/5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
          <span className="text-slate-200 text-[11px] font-black uppercase tracking-[0.2em]">Harita Kaynağı</span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border backdrop-blur-md transition-all ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-red-500/10 text-red-400 border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]'}`}>
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span className="text-[10px] font-black uppercase tracking-widest">{isOnline ? 'ÇEVRİMİÇİ' : 'ÇEVRİMDIŞI'}</span>
          </div>
          <button
            onClick={handleRefresh}
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center active:scale-90 transition-all hover:bg-white/10 hover:border-white/20 shadow-lg"
            title="Kaynakları Yenile"
          >
            <RefreshCw className={`w-4 h-4 text-slate-300 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-[2rem] bg-white/[0.05] border border-white/10 transition-all">
          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden mb-4">
             <div className="h-full bg-blue-500/70 rounded-full animate-boot-bar" />
          </div>
          <div className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em]">KAYNAKLAR TARANIYOR</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sources.map((src) => {
            const isOfflineType = src.type === 'offline';
            const isCached      = src.id === 'cached';
            const Icon          = isOfflineType ? HardDrive : isCached ? Database : Cloud;
            const isActive      = activeId === src.id;
            
            return (
              <button
                key={src.id}
                onClick={() => src.isAvailable && handleSelect(src.id)}
                disabled={!src.isAvailable}
                className={`group relative flex items-center gap-4 px-5 py-4 rounded-[1.5rem] border transition-all duration-300 overflow-hidden ${
                  isActive
                    ? 'bg-blue-600/15 border-blue-400/70 shadow-[0_0_24px_rgba(59,130,246,0.2)] ring-2 ring-blue-500/30'
                    : src.isAvailable
                      ? 'bg-white/[0.05] border-white/[0.1] text-slate-300 hover:bg-white/[0.08] hover:border-white/[0.18]'
                      : 'bg-white/[0.03] border-white/[0.07] text-slate-600 cursor-not-allowed opacity-50'
                }`}
              >
                {isActive && (
                   <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-transparent pointer-events-none" />
                )}
                
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-500 ${
                  isActive ? 'bg-blue-600 text-white scale-105 shadow-blue-600/40' : src.isAvailable ? 'bg-white/[0.06] border border-white/10 text-slate-400 group-hover:text-blue-300 group-hover:border-blue-500/30' : 'bg-white/[0.04] border border-white/[0.06] text-slate-600'
                }`}>
                  <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-[1.5px]'}`} />
                </div>

                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`text-[13px] font-black uppercase tracking-wider truncate ${isActive ? 'text-white' : src.isAvailable ? 'text-slate-300' : 'text-slate-500'}`}>
                      {src.name}
                    </div>
                    {isActive && (
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)] animate-pulse" />
                    )}
                  </div>
                  <div className={`text-[10px] font-bold tracking-tight truncate leading-none ${isActive ? 'text-blue-400/80' : src.isAvailable ? 'text-slate-500' : 'text-slate-600'}`}>
                    {src.description}
                  </div>
                  {src.tileCount != null && src.tileCount > 0 && src.isAvailable && (
                    <div className="text-[10px] font-black text-slate-600 mt-2 flex items-center gap-1.5 bg-black/20 self-start px-2 py-0.5 rounded-md border border-white/5 uppercase tracking-tighter">
                      <Database className="w-2.5 h-2.5" />
                      {src.tileCount.toLocaleString()} Karo {src.cacheSize ? `· ${src.cacheSize}` : ''}
                    </div>
                  )}
                </div>

                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                  isActive ? 'border-blue-400 bg-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'border-white/15 bg-white/[0.04] text-transparent'
                }`}>
                  <Check className="w-3.5 h-3.5 stroke-[3.5px]" />
                </div>

                {!src.isAvailable && (
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-slate-800/60 border border-white/10 text-slate-400 text-[8px] font-black uppercase tracking-widest">
                    BAĞLANTI YOK
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

/* ── Çevrimdışı Tile İndirici ────────────────────────────── */

const OfflineTilePanel = memo(function OfflineTilePanel() {
  const [dl, setDl]             = useState<DownloadState>(getDownloadState());
  const [cachedCount, setCached] = useState<number>(0);
  const [clearing, setClearing]  = useState(false);

  useEffect(() => {
    getCachedTileCount().then(setCached).catch(() => undefined);
  }, [dl.status]);

  useEffect(() => {
    return subscribeDownloadState(setDl);
  }, []);

  const handleDownload = useCallback((presetId: string) => {
    if (dl.status === 'downloading') return;
    downloadTileRegion(presetId).catch(() => undefined);
  }, [dl.status]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    await clearCachedTiles();
    setCached(0);
    setClearing(false);
  }, []);

  const isDownloading = dl.status === 'downloading';
  const pct = dl.total > 0 ? Math.round((dl.done / dl.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 pt-5 border-t border-white/5">
      {/* Başlık */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
          <span className="text-slate-200 text-[11px] font-black uppercase tracking-[0.2em]">Çevrimdışı Harita İndir</span>
        </div>
        {cachedCount > 0 && (
          <button
            onClick={handleClear}
            disabled={isDownloading || clearing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-widest active:scale-90 transition-all disabled:opacity-40"
          >
            <Trash2 className="w-3 h-3" />
            {clearing ? 'Siliniyor…' : `${cachedCount.toLocaleString()} tile sil`}
          </button>
        )}
      </div>

      {/* Aktif indirme — ilerleme çubuğu */}
      {isDownloading && (
        <div className="flex flex-col gap-2 px-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs">{dl.presetName} indiriliyor…</span>
            <span className="text-blue-400 text-xs font-bold tabular-nums">{dl.done}/{dl.total}</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600 text-[10px]">
              {dl.failedCount > 0 ? `${dl.failedCount} hata` : 'İndiriliyor…'}
            </span>
            <button
              onClick={cancelTileDownload}
              className="text-red-400 text-[10px] font-bold uppercase tracking-widest active:opacity-60"
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {/* Tamamlandı/Hata mesajı */}
      {(dl.status === 'done' || dl.status === 'cancelled' || dl.status === 'error') && (
        <div className={`px-4 py-3 rounded-xl border text-xs font-medium ${
          dl.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
          dl.status === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
          'bg-slate-700/30 border-white/10 text-slate-400'
        }`}>
          {dl.status === 'done' && `✓ ${dl.presetName} indirildi — ${dl.done.toLocaleString()} tile`}
          {dl.status === 'cancelled' && 'İndirme iptal edildi'}
          {dl.status === 'error' && `Hata: ${dl.errorMsg ?? 'Bilinmiyor'}`}
        </div>
      )}

      {/* Preset butonları */}
      <div className="grid grid-cols-2 gap-2">
        {TILE_PRESETS.map((preset) => {
          const count     = estimateTileCount(preset);
          const isActive  = dl.presetId === preset.id && isDownloading;
          return (
            <button
              key={preset.id}
              onClick={() => handleDownload(preset.id)}
              disabled={isDownloading}
              className={`flex flex-col gap-1.5 p-3.5 rounded-2xl border text-left transition-all active:scale-[0.97] disabled:opacity-50 ${
                isActive
                  ? 'bg-blue-600/20 border-blue-500/40'
                  : 'bg-white/[0.04] border-white/8 hover:bg-white/[0.07] hover:border-white/15'
              }`}
            >
              <div className="flex items-center gap-2">
                <Download className={`w-4 h-4 ${isActive ? 'text-blue-400 animate-pulse' : 'text-slate-400'}`} />
                <span className="text-white text-sm font-bold">{preset.name}</span>
              </div>
              <span className="text-slate-500 text-[10px]">
                Z{preset.minZoom}–Z{preset.maxZoom} · ~{count.toLocaleString()} tile
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-slate-700 text-[9px] px-1 leading-relaxed">
        Tile'lar OpenStreetMap sunucusundan indirilir ve tarayıcı önbelleğine kaydedilir.
        İnternet bağlantısı kesildiğinde bu bölgeler haritada çalışmaya devam eder.
      </p>
    </div>
  );
});

/* ── Yardımcı bileşenler ─────────────────────────────────── */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-1 h-5 bg-blue-500 rounded-full" />
      <span className="text-slate-500 text-xs font-medium tracking-widest uppercase">{children}</span>
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode, className?: string }) {
  return (
    <div className={`bg-[#0d1628] rounded-2xl border border-white/5 shadow-xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function BigSlider({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: typeof Sun;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-blue-400" />
          <span className="text-white text-base font-medium">{label}</span>
        </div>
        <span className="text-blue-400 text-lg font-semibold tabular-nums w-10 text-right">{value}</span>
      </div>
      <div className="relative py-2">
        <div className="h-3 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-[width] duration-75"
            style={{ width: `${value}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

function ChoiceCard({
  active,
  onClick,
  icon: Icon,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
  desc?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-2xl border transition-all duration-200 active:scale-[0.95] ${
        active
          ? 'bg-blue-600/20 border-blue-500/50 shadow-lg shadow-blue-500/10'
          : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
      }`}
    >
      <Icon className={`w-6 h-6 ${active ? 'text-blue-400' : 'text-slate-500'}`} />
      <span className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-400'}`}>{label}</span>
      {desc && <span className="text-[10px] text-slate-600 text-center leading-tight">{desc}</span>}
    </button>
  );
}

function ColButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-4 rounded-2xl text-base font-semibold transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.97] border ${
        active
          ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/25 active:bg-blue-700'
          : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200 hover:border-white/10'
      }`}
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onChange(!value)}
      className="flex items-center justify-between pb-5 mb-5 border-b border-white/5 last:border-0 last:pb-0 last:mb-0 active:opacity-70 transition-opacity duration-100"
    >
      <div>
        <div className="text-white text-base font-medium">{label}</div>
        <div className="text-slate-500 text-sm mt-0.5">{desc}</div>
      </div>
      <div
        className={`w-14 h-7 rounded-full relative transition-[background-color] duration-200 flex-shrink-0 pointer-events-none ${value ? 'bg-blue-600' : 'bg-white/10'}`}
      >
        <span
          className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-[left] duration-200 ${value ? 'left-7' : 'left-0.5'}`}
        />
      </div>
    </div>
  );
}

const WALLPAPERS = [
  { id: 'none', label: 'Klasik', url: 'none' },
  { id: 'carbon', label: 'Karbon', url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=1200&q=80' },
  { id: 'midnight', label: 'Gece', url: 'https://images.unsplash.com/photo-1614850523296-e8c041de4398?auto=format&fit=crop&w=1200&q=80' },
  { id: 'minimal', label: 'Minimal', url: 'https://images.unsplash.com/photo-1550684376-efcbd6e3f031?auto=format&fit=crop&w=1200&q=80' },
  { id: 'liquid', label: 'Sıvı', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80' },
  { id: 'horizon', label: 'Ufuk', url: 'https://images.unsplash.com/photo-1519608487953-e999c86e74c0?auto=format&fit=crop&w=1200&q=80' },
  { id: 'tech', label: 'Teknoloji', url: 'https://images.unsplash.com/photo-1504333638930-c8787321eee0?auto=format&fit=crop&w=1200&q=80' },
  { id: 'deep', label: 'Derinlik', url: 'https://images.unsplash.com/photo-1439405326854-014607f694d7?auto=format&fit=crop&w=1200&q=80' },
];

/* ── Ana bileşen ─────────────────────────────────────────── */

interface Props {
  onOpenMap?: () => void;
  onClose?: () => void;
}

function SettingsPageInner({ onOpenMap, onClose }: Props) {
  const { settings, updateSettings } = useStore();
  const [tab, setTab] = useState<'general' | 'appearance' | 'performance' | 'maintenance'>('general');
  const { locked: layoutLocked, toggleLock, resetAll: resetPersonalization } = useEditStore();

  // DOM'da data-layout attribute'unu tema değişince güncelle
  useLayoutSync();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBrightness = useCallback((v: number) => {
    updateSettings({ brightness: v });
    setBrightness(v);
  }, [updateSettings]);

  const handleVolume = useCallback((v: number) => {
    updateSettings({ volume: v });
    setVolume(v);
  }, [updateSettings]);

  // ── Theme change wrappers — route through crossfade overlay ──
  const applyThemePack = useCallback((pack: string) => {
    triggerThemeTransition(() => updateSettings({ themePack: pack as import('../../store/useStore').ThemePack }), pack);
  }, [updateSettings]);

  const applyThemeStyle = useCallback((style: import('../../store/useStore').ThemeStyle) => {
    triggerThemeTransition(() => updateSettings({ themeStyle: style }));
  }, [updateSettings]);

  const applyWidgetStyle = useCallback((style: import('../../store/useStore').WidgetStyle) => {
    triggerThemeTransition(() => updateSettings({ widgetStyle: style }));
  }, [updateSettings]);

  const handleCustomWallpaper = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        updateSettings({ wallpaper: url });
      };
      reader.readAsDataURL(file);
    }
  };


  return (
    <div className="h-full flex flex-col bg-[#0b1424]">
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-3 px-5 py-3 bg-white/10 border border-white/20 rounded-2xl active:scale-90 transition-transform hover:bg-white/20"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
          <span className="text-white text-sm font-black uppercase tracking-widest">Geri</span>
        </button>
        <span className="text-white text-base font-black uppercase tracking-[0.2em]">Ayarlar</span>
        <button
          onClick={onClose}
          className="w-14 h-14 flex items-center justify-center bg-white/10 border border-white/20 rounded-2xl active:scale-90 transition-transform hover:bg-red-500/30 hover:border-red-400/40"
        >
          <X className="w-6 h-6 text-white" />
        </button>
      </div>
      {/* Tabs */}
      <div className="flex border-b border-white/5 px-6 pt-4 gap-6">
        {[
          { id: 'general',     label: 'Genel',       icon: Smartphone },
          { id: 'appearance',  label: 'Tema',        icon: Palette    },
          { id: 'maintenance', label: 'Bakım',       icon: Tool       },
          { id: 'performance', label: 'Performans',  icon: Zap        },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`flex items-center gap-2 pb-4 border-b-2 transition-all duration-200 ${
              tab === t.id ? 'border-blue-500 text-white' : 'border-transparent text-slate-500'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-bold uppercase tracking-widest">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-6">
        <div className="flex flex-col gap-6">
          
          {tab === 'maintenance' && (
            <div className="max-w-3xl mx-auto w-full animate-fade-in">
              <MaintenancePanel />
            </div>
          )}

          {tab === 'general' && (
            <>
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-6">
                  <SectionTitle>Temel Ayarlar</SectionTitle>
                  <Card>
                    <ToggleRow 
                      label="24 Saat Formatı" 
                      desc="Saat görünümünü değiştirir" 
                      value={settings.use24Hour} 
                      onChange={(v) => updateSettings({ use24Hour: v })}
                    />
                    <ToggleRow 
                      label="Saniyeleri Göster" 
                      desc="Dijital saatte saniyeleri göster" 
                      value={settings.showSeconds} 
                      onChange={(v) => updateSettings({ showSeconds: v })}
                    />
                    <ToggleRow
                      label="Çevrimdışı Harita"
                      desc="Ana ekranda mini harita göster"
                      value={settings.offlineMap}
                      onChange={(v) => updateSettings({ offlineMap: v })}
                    />
                    {settings.offlineMap && <MapSourcePanel />}
                    {settings.offlineMap && <OfflineTilePanel />}
                    <ToggleRow
                      label="Düşük Güç Modu"
                      desc="Animasyonları kapatır, performansı artırır"
                      value={settings.performanceMode}
                      onChange={(v) => {
                        updateSettings({ performanceMode: v });
                        setPerformanceMode(v ? 'lite' : 'balanced');
                      }}
                    />
                    <ToggleRow
                      label="Uyandırma Kelimesi"
                      desc='"Hey Car" diyerek asistanı aktif et'
                      value={settings.wakeWordEnabled ?? false}
                      onChange={(v) => updateSettings({ wakeWordEnabled: v })}
                    />
                    {(settings.wakeWordEnabled) && (
                      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20 -mt-2 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
                        <span className="text-amber-400/80 text-[10px] font-bold leading-tight">Mikrofon arka planda sürekli dinliyor</span>
                      </div>
                    )}
                    <ToggleRow
                      label="Mola Hatırlatıcı"
                      desc="Uzun sürüşlerde kahve molası öner"
                      value={settings.breakReminderEnabled ?? false}
                      onChange={(v) => updateSettings({ breakReminderEnabled: v })}
                    />
                    <ToggleRow
                      label="Akıllı Bağlam"
                      desc="Hıza, müziğe ve rotaya göre arayüzü otomatik uyarla"
                      value={settings.smartContextEnabled ?? true}
                      onChange={(v) => updateSettings({ smartContextEnabled: v })}
                    />
                    <ToggleRow
                      label="Otomatik Parlaklık"
                      desc="Gün doğumu/batımına göre parlaklık ayarla"
                      value={settings.autoBrightnessEnabled ?? false}
                      onChange={(v) => updateSettings({ autoBrightnessEnabled: v })}
                    />
                    <ToggleRow
                      label="Otomatik Tema (Gün/Gece)"
                      desc="Gece OLED, gündüz koyu temaya geç"
                      value={settings.autoThemeEnabled ?? false}
                      onChange={(v) => updateSettings({ autoThemeEnabled: v })}
                    />

                    {/* Ekran Modu — Karanlık / Aydınlık / OLED */}
                    <div className="flex flex-col gap-2">
                      <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Ekran Modu</span>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { id: 'dark',  icon: '🌙', label: 'Karanlık' },
                          { id: 'light', icon: '☀️', label: 'Aydınlık' },
                          { id: 'oled',  icon: '⬛', label: 'OLED' },
                        ] as const).map(({ id, icon, label }) => (
                          <button
                            key={id}
                            onClick={() => updateSettings({ theme: id })}
                            className={`
                              flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-all duration-200 active:scale-95
                              ${settings.theme === id
                                ? 'bg-blue-500/20 border-blue-400/50 text-blue-300'
                                : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:bg-white/[0.08]'
                              }
                            `}
                          >
                            <span className="text-xl">{icon}</span>
                            <span className="text-[10px] font-black uppercase tracking-wider">{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {onOpenMap && (
                      <button
                        onClick={onOpenMap}
                        className="w-full mt-2 py-3 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 text-sm font-semibold hover:bg-blue-600/30 active:scale-[0.97] transition-all duration-150"
                      >
                        TAM EKRAN HARİTAYI AÇ
                      </button>
                    )}
                  </Card>
                </div>
                <div className="flex flex-col gap-6">
                  <SectionTitle>Kontroller</SectionTitle>
                  <Card className="flex flex-col gap-6">
                    <BigSlider
                      icon={Sun}
                      label="Parlaklık"
                      value={settings.brightness}
                      onChange={handleBrightness}
                    />
                    <BigSlider
                      icon={Volume2}
                      label="Ses"
                      value={settings.volume}
                      onChange={handleVolume}
                    />
                    <div className="mt-2">
                      <SectionTitle>Uygulama Düzeni</SectionTitle>
                      <div className="flex gap-2">
                        {[3, 4, 5].map(n => (
                          <ColButton 
                            key={n} 
                            active={settings.gridColumns === n} 
                            onClick={() => updateSettings({ gridColumns: n })}
                          >
                            {n} Kolon
                          </ColButton>
                        ))}
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
              
              <SectionTitle>Varsayılan Uygulamalar</SectionTitle>
              <Card>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-white text-sm font-medium mb-3">Navigasyon</div>
                    <div className="flex gap-2">
                      {Object.entries(NAV_OPTIONS).map(([id, app]) => (
                        <ChoiceCard 
                          key={id}
                          active={settings.defaultNav === id}
                          onClick={() => updateSettings({ defaultNav: id })}
                          icon={() => <span className="text-xl">{app.icon}</span>}
                          label={app.name}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-white text-sm font-medium mb-3">Müzik</div>
                    <div className="flex gap-2">
                      {Object.entries(MUSIC_OPTIONS).map(([id, app]) => (
                        <ChoiceCard 
                          key={id}
                          active={settings.defaultMusic === id}
                          onClick={() => updateSettings({ defaultMusic: id })}
                          icon={() => <span className="text-xl">{app.icon}</span>}
                          label={app.name}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </>
          )}

          {tab === 'appearance' && (
            <>
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-6">
                  <SectionTitle>Tema Paketi</SectionTitle>
                  <Card className="flex flex-col gap-6">
                    {/* ── Layout önizleme — aktif temayı gösterir ── */}
                    <LayoutPreview pack={settings.themePack} />

                    <div>
                      <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3">Marka & Stil</div>
                      <div className="grid grid-cols-5 gap-2">
                        <ChoiceCard active={settings.themePack === 'tesla'} onClick={() => applyThemePack('tesla')} icon={Layout} label="Tesla" />
                        <ChoiceCard active={settings.themePack === 'bmw'} onClick={() => applyThemePack('bmw')} icon={Palette} label="BMW" />
                        <ChoiceCard active={settings.themePack === 'mercedes'} onClick={() => applyThemePack('mercedes')} icon={Smartphone} label="Mercedes" />
                        <ChoiceCard active={settings.themePack === 'audi'} onClick={() => applyThemePack('audi')} icon={Layers} label="Audi" />
                        <ChoiceCard active={settings.themePack === 'porsche'} onClick={() => applyThemePack('porsche')} icon={Zap} label="Porsche" />
                      </div>
                    </div>

                    <div>
                      <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3">Atmosfer & Neon</div>
                      <div className="grid grid-cols-5 gap-2">
                        <ChoiceCard active={settings.themePack === 'cyberpunk'} onClick={() => applyThemePack('cyberpunk')} icon={Zap} label="Neon" />
                        <ChoiceCard active={settings.themePack === 'midnight'} onClick={() => applyThemePack('midnight')} icon={ImageIcon} label="Gece" />
                        <ChoiceCard active={settings.themePack === 'glass-pro'} onClick={() => applyThemePack('glass-pro')} icon={Layers} label="Cam Pro" />
                        <ChoiceCard active={settings.themePack === 'ambient'} onClick={() => applyThemePack('ambient')} icon={Sun} label="Ortam" />
                        <ChoiceCard active={settings.themePack === 'galaxy'} onClick={() => applyThemePack('galaxy')} icon={Zap} label="Galaksi" />
                      </div>
                    </div>

                    <div>
                      <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3">Sport & Teknik</div>
                      <div className="grid grid-cols-5 gap-2">
                        <ChoiceCard active={settings.themePack === 'redline'} onClick={() => applyThemePack('redline')} icon={Zap} label="Redline" />
                        <ChoiceCard active={settings.themePack === 'electric'} onClick={() => applyThemePack('electric')} icon={Zap} label="Elektrik" />
                        <ChoiceCard active={settings.themePack === 'carbon'} onClick={() => applyThemePack('carbon')} icon={Layers} label="Karbon" />
                        <ChoiceCard active={settings.themePack === 'night-city'} onClick={() => applyThemePack('night-city')} icon={Layout} label="Şehir" />
                        <ChoiceCard active={settings.themePack === 'range-rover'} onClick={() => applyThemePack('range-rover')} icon={Smartphone} label="Range" />
                      </div>
                    </div>

                    <div>
                      <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3">Minimal & Soft</div>
                      <div className="grid grid-cols-5 gap-2">
                        <ChoiceCard active={settings.themePack === 'minimal-dark'} onClick={() => applyThemePack('minimal-dark')} icon={Smartphone} label="Koyu" />
                        <ChoiceCard active={settings.themePack === 'minimal-light'} onClick={() => applyThemePack('minimal-light')} icon={Sun} label="Açık" />
                        <ChoiceCard active={settings.themePack === 'monochrome'} onClick={() => applyThemePack('monochrome')} icon={Palette} label="Mono" />
                        <ChoiceCard active={settings.themePack === 'arctic'} onClick={() => applyThemePack('arctic')} icon={ImageIcon} label="Arktik" />
                        <ChoiceCard active={settings.themePack === 'sunset'} onClick={() => applyThemePack('sunset')} icon={Sun} label="Günbatımı" />
                      </div>
                    </div>
                  </Card>

                  <SectionTitle>Panel Stili</SectionTitle>
                  <Card className="grid grid-cols-3 gap-3">
                    <ChoiceCard
                      active={settings.themeStyle === 'glass'}
                      onClick={() => applyThemeStyle('glass')}
                      icon={ImageIcon}
                      label="Cam"
                    />
                    <ChoiceCard
                      active={settings.themeStyle === 'neon'}
                      onClick={() => applyThemeStyle('neon')}
                      icon={Zap}
                      label="Neon"
                    />
                    <ChoiceCard
                      active={settings.themeStyle === 'minimal'}
                      onClick={() => applyThemeStyle('minimal')}
                      icon={Smartphone}
                      label="Minimal"
                    />
                  </Card>

                  <SectionTitle>Ses Paneli Stili</SectionTitle>
                  <Card className="grid grid-cols-5 gap-2">
                    <ChoiceCard
                      active={settings.volumeStyle === 'minimal_pro'}
                      onClick={() => updateSettings({ volumeStyle: 'minimal_pro' })}
                      icon={Smartphone}
                      label="Minimal Pro"
                    />
                    <ChoiceCard
                      active={settings.volumeStyle === 'tesla_ultra'}
                      onClick={() => updateSettings({ volumeStyle: 'tesla_ultra' })}
                      icon={Zap}
                      label="Tesla Ultra"
                    />
                    <ChoiceCard
                      active={settings.volumeStyle === 'bmw_polished'}
                      onClick={() => updateSettings({ volumeStyle: 'bmw_polished' })}
                      icon={Layout}
                      label="BMW M"
                    />
                    <ChoiceCard
                      active={settings.volumeStyle === 'glass_orb'}
                      onClick={() => updateSettings({ volumeStyle: 'glass_orb' })}
                      icon={Layers}
                      label="Glass Orb"
                    />
                    <ChoiceCard
                      active={settings.volumeStyle === 'ambient_line'}
                      onClick={() => updateSettings({ volumeStyle: 'ambient_line' })}
                      icon={Sun}
                      label="Ambient"
                    />
                  </Card>

                  <SectionTitle>Swipe Ses Kontrolü</SectionTitle>
                  <Card>
                    <p className="text-slate-500 text-xs mb-3 leading-relaxed">
                      Ekran kenarından yukarı/aşağı kaydırarak sisteme sesi değiştir.
                      Sürüş sırasında butona basmadan ses kontrolü sağlar.
                    </p>
                    <div className="flex gap-2">
                      {(
                        [
                          { value: 'off',   label: 'Kapalı'    },
                          { value: 'left',  label: 'Sol Kenar' },
                          { value: 'right', label: 'Sağ Kenar' },
                        ] as const
                      ).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => updateSettings({ gestureVolumeSide: value })}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                            settings.gestureVolumeSide === value
                              ? 'bg-blue-500 text-white shadow-[0_2px_12px_rgba(59,130,246,0.4)]'
                              : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Card>
                </div>

                <div className="flex flex-col gap-6">
                  <SectionTitle>Widget Tarzı</SectionTitle>
                  <Card className="grid grid-cols-3 gap-3">
                    <ChoiceCard
                      active={settings.widgetStyle === 'elevated'}
                      onClick={() => applyWidgetStyle('elevated')}
                      icon={Layers}
                      label="Gölgeli"
                    />
                    <ChoiceCard
                      active={settings.widgetStyle === 'flat'}
                      onClick={() => applyWidgetStyle('flat')}
                      icon={Layout}
                      label="Düz"
                    />
                    <ChoiceCard
                      active={settings.widgetStyle === 'outlined'}
                      onClick={() => applyWidgetStyle('outlined')}
                      icon={Smartphone}
                      label="Çizgisel"
                    />
                  </Card>

                </div>
              </div>

              <SectionTitle>Düzenleme Kilidi</SectionTitle>
              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white text-sm font-bold mb-0.5">Düzen Kilidi</div>
                    <div className="text-slate-500 text-[11px] leading-relaxed">
                      Kilitliyken ana ekranda hiçbir widget düzenlenemez veya taşınamaz.
                      Sürüş sırasında yanlışlıkla değişikliği önler.
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 ml-4">
                    <button
                      onClick={toggleLock}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-[12px] uppercase tracking-widest transition-all active:scale-95 border ${
                        layoutLocked
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      }`}
                    >
                      {layoutLocked ? '🔒 Kilitli' : '🔓 Açık'}
                    </button>
                    <button
                      onClick={resetPersonalization}
                      className="text-slate-600 text-[10px] font-bold hover:text-slate-400 transition-colors active:scale-95"
                    >
                      Widget'ları sıfırla
                    </button>
                  </div>
                </div>
              </Card>

              <SectionTitle>Duvar Kağıdı</SectionTitle>
              <Card>
                <div className="grid grid-cols-4 lg:grid-cols-5 gap-4">
                  {/* Hazır Duvar Kağıtları */}
                  {WALLPAPERS.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => updateSettings({ wallpaper: w.url })}
                      className={`group relative aspect-video rounded-2xl overflow-hidden border-2 transition-all duration-300 ${
                        settings.wallpaper === w.url 
                          ? 'border-blue-500 scale-105 shadow-lg shadow-blue-500/20' 
                          : 'border-white/5 opacity-50 hover:opacity-100 hover:border-white/20'
                      }`}
                    >
                      {w.url === 'none' ? (
                        <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center gap-2">
                          <Monitor className="w-6 h-6 text-slate-700 group-hover:text-blue-500 transition-colors" />
                          <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider">Orijinal</span>
                        </div>
                      ) : (
                        <>
                          <img src={w.url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={w.label} />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
                          <div className="absolute bottom-2 left-3">
                            <span className="text-[10px] font-black text-white uppercase tracking-widest drop-shadow-md">{w.label}</span>
                          </div>
                        </>
                      )}
                      
                      {settings.wallpaper === w.url && (
                        <div className="absolute top-2 right-2 bg-blue-500 shadow-lg rounded-full p-1 animate-in zoom-in duration-300">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  ))}

                  {/* Özel Duvar Kağıdı Yükle */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`group relative aspect-video rounded-2xl overflow-hidden border-2 border-dashed transition-all duration-300 ${
                      settings.wallpaper.startsWith('data:') 
                        ? 'border-blue-500 scale-105 shadow-lg shadow-blue-500/20' 
                        : 'border-white/10 hover:border-blue-500/50 hover:bg-blue-500/5'
                    }`}
                  >
                    {settings.wallpaper.startsWith('data:') ? (
                      <>
                        <img src={settings.wallpaper} className="w-full h-full object-cover" alt="Custom" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Upload className="w-6 h-6 text-white" />
                        </div>
                        <div className="absolute bottom-2 left-3">
                          <span className="text-[10px] font-black text-white uppercase tracking-widest drop-shadow-md">Özel Görsel</span>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                        <Plus className="w-6 h-6 text-slate-500 group-hover:text-blue-400 transition-colors" />
                        <span className="text-[10px] text-slate-500 group-hover:text-blue-400 font-bold uppercase tracking-wider">Kendi Görselin</span>
                      </div>
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      onChange={handleCustomWallpaper}
                    />
                    {settings.wallpaper.startsWith('data:') && (
                      <div className="absolute top-2 right-2 bg-blue-500 shadow-lg rounded-full p-1">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                </div>
              </Card>
            </>
          )}

          {tab === 'performance' && (
            <div className="flex flex-col gap-6">
              <SectionTitle>Sistem Performansı</SectionTitle>
              <Card>
                <div className="space-y-4">
                  {(['lite', 'balanced', 'premium'] as const).map((mode) => {
                    const isSelected = getPerformanceMode() === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => { setPerformanceMode(mode); updateSettings({}); }}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                          isSelected ? 'bg-blue-600/20 border-blue-500 shadow-lg shadow-blue-500/10' : 'bg-white/5 border-white/5 opacity-60'
                        }`}
                      >
                        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-2xl">
                          {mode === 'lite' ? '⚡' : mode === 'balanced' ? '⚙️' : '🚀'}
                        </div>
                        <div className="flex-1 text-left">
                          <div className="text-white font-bold capitalize">{mode === 'lite' ? 'Hafif' : mode === 'balanced' ? 'Dengeli' : 'Premium'}</div>
                          <div className="text-xs text-slate-500">
                            {mode === 'lite' ? 'Düşük donanım için optimize edildi.' : mode === 'balanced' ? 'Çoğu cihaz için önerilen mod.' : 'En iyi görsel kalite ve sık veri güncellemesi.'}
                          </div>
                        </div>
                        {isSelected && <Check className="w-5 h-5 text-blue-500" />}
                      </button>
                    );
                  })}
                </div>
              </Card>
              <SectionTitle>Güç Yönetimi</SectionTitle>
              <Card>
                <ToggleRow
                  label="Uyku Modu"
                  desc="Ekranı kapatarak güç tasarrufu sağlar"
                  value={settings.sleepMode}
                  onChange={(v) => updateSettings({ sleepMode: v })}
                />
                <ToggleRow
                  label="OBD Otomatik Uyku"
                  desc="Motor durursa (RPM = 0) ekran otomatik kapanır"
                  value={settings.obdAutoSleep ?? false}
                  onChange={(v) => updateSettings({ obdAutoSleep: v })}
                />
                {settings.obdAutoSleep && (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Moon className="w-4 h-4 text-blue-400" />
                        <span className="text-white text-sm font-medium">Uyku Gecikmesi</span>
                      </div>
                      <span className="text-blue-400 text-sm font-bold tabular-nums">
                        {settings.obdSleepDelayMin ?? 5} dk
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {[1, 2, 5, 10, 15].map((min) => (
                        <button
                          key={min}
                          onClick={() => updateSettings({ obdSleepDelayMin: min })}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
                            (settings.obdSleepDelayMin ?? 5) === min
                              ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/25'
                              : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200'
                          }`}
                        >
                          {min}dk
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export const SettingsPage = memo(SettingsPageInner);
