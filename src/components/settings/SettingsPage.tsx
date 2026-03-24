import { memo, useState, useEffect, type ReactNode } from 'react';
import { Sun, Volume2, Grid3x3, Map, Music, Moon, Smartphone, Clock, Zap } from 'lucide-react';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../../data/apps';
import type { NavOptionKey, MusicOptionKey } from '../../data/apps';
import { getPerformanceMode, setPerformanceMode } from '../../platform/performanceMode';
import { getMapSources, getActiveMapSourceId, setActiveMapSource } from '../../platform/mapSourceManager';

export interface Settings {
  brightness: number;
  volume: number;
  theme: 'dark' | 'oled';
  themePack: 'tesla' | 'big-cards' | 'ai-center';
  themeStyle: 'glass' | 'neon' | 'minimal';
  widgetStyle: 'elevated' | 'flat' | 'outlined';
  widgetLayout: 'dashboard' | 'focus-nav' | 'focus-media' | 'focus-obd';
  use24Hour: boolean;
  showSeconds: boolean;
  clockStyle: 'digital' | 'analog';
  gridColumns: 3 | 4 | 5;
  defaultNav: NavOptionKey;
  defaultMusic: MusicOptionKey;
  sleepMode: boolean;
  widgetOrder: string[];
  widgetVisible: Record<string, boolean>;
  dockPins: string[] | null;
}

/* ── Yardımcı bileşenler ─────────────────────────────────── */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-1 h-5 bg-blue-500 rounded-full" />
      <span className="text-slate-500 text-xs font-medium tracking-widest uppercase">{children}</span>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[#0d1628] rounded-2xl border border-white/5 shadow-xl p-5">
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

function ThemeCard({
  active,
  onClick,
  icon: Icon,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Moon;
  label: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-2 py-5 rounded-2xl border transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] ${
        active
          ? 'bg-blue-600/20 border-blue-500/40 shadow-lg shadow-blue-600/10 active:bg-blue-600/30'
          : 'bg-white/5 border-white/5 hover:bg-white/[0.08] hover:border-white/10'
      }`}
    >
      <Icon className={`w-6 h-6 ${active ? 'text-blue-400' : 'text-slate-500'}`} />
      <span className={`text-base font-semibold ${active ? 'text-white' : 'text-slate-400'}`}>{label}</span>
      <span className={`text-xs ${active ? 'text-slate-400' : 'text-slate-600'}`}>{desc}</span>
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
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onChange(!value)}
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

function AppPickerRow<K extends string>({
  icon: Icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: typeof Map;
  label: string;
  options: Record<K, { name: string; icon: string }>;
  value: K;
  onChange: (v: K) => void;
}) {
  return (
    <div className="pb-4 mb-4 border-b border-white/5 last:border-0 last:pb-0 last:mb-0">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-blue-400" />
        <span className="text-white text-sm font-medium">{label}</span>
      </div>
      <div className="flex gap-2">
        {(Object.entries(options) as [K, { name: string; icon: string }][]).map(([id, app]) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-xl border transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.97] ${
              value === id
                ? 'bg-blue-600/20 border-blue-500/40 text-white active:bg-blue-600/30'
                : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200'
            }`}
          >
            <span className="text-xl">{app.icon}</span>
            <span className="font-medium text-sm truncate">{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Ana bileşen ─────────────────────────────────────────── */

interface Props {
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => void;
}

function SettingsPageInner({ settings, onUpdate }: Props) {
  const [mapSources, setMapSources] = useState<any[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  useEffect(() => {
    const sources = getMapSources();
    setMapSources(sources);
    setActiveSourceId(getActiveMapSourceId());
  }, []);

  const handleMapSourceChange = (sourceId: string) => {
    setActiveMapSource(sourceId);
    setActiveSourceId(sourceId);
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="p-6 flex flex-col gap-5">

        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-white">Ayarlar</h2>
          <span className="text-[11px] text-slate-600 bg-white/5 border border-white/5 rounded-full px-3 py-1">
            Car Launcher Pro
          </span>
        </div>

        <div className="grid grid-cols-2 gap-5">

          {/* SOL ── Görünüm + Düzen */}
          <div className="flex flex-col gap-5">

            <div>
              <SectionTitle>Görünüm</SectionTitle>
              <Card>
                <div className="flex items-center gap-3 mb-4">
                  <Moon className="w-5 h-5 text-blue-400" />
                  <span className="text-white text-base font-medium">Tema Rengi</span>
                </div>
                <div className="flex gap-4 mb-5">
                  <ThemeCard
                    active={settings.theme === 'dark'}
                    onClick={() => onUpdate({ theme: 'dark' })}
                    icon={Moon}
                    label="Koyu"
                    desc="Lacivert zemin"
                  />
                  <ThemeCard
                    active={settings.theme === 'oled'}
                    onClick={() => onUpdate({ theme: 'oled' })}
                    icon={Smartphone}
                    label="OLED"
                    desc="Tam siyah"
                  />
                </div>
                <div className="pb-5 mb-5 border-b border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-blue-400 text-sm">🎨</span>
                    <span className="text-white text-sm font-medium">Tema Paketi</span>
                  </div>
                  <div className="flex gap-2">
                    {(['tesla', 'big-cards', 'ai-center'] as const).map((pack) => (
                      <button
                        key={pack}
                        onClick={() => onUpdate({ themePack: pack })}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-[transform,background-color,border-color] duration-150 active:scale-95 border ${
                          settings.themePack === pack
                            ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/25'
                            : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:border-white/10'
                        }`}
                      >
                        {pack === 'tesla' ? '⚡ Tesla' : pack === 'big-cards' ? '🎯 Big Cards' : '🤖 AI'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pb-5 mb-5 border-b border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-blue-400 text-sm">✨</span>
                    <span className="text-white text-sm font-medium">Panel Stili</span>
                  </div>
                  <div className="flex gap-2">
                    {(['glass', 'neon', 'minimal'] as const).map((style) => (
                      <button
                        key={style}
                        onClick={() => onUpdate({ themeStyle: style })}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-[transform,background-color,border-color] duration-150 active:scale-95 border ${
                          settings.themeStyle === style
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/25'
                            : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:border-white/10'
                        }`}
                      >
                        {style === 'glass' ? '🔷 Cam' : style === 'neon' ? '⚡ Neon' : '▫️ Minimal'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pb-5 mb-5 border-b border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-blue-400 text-sm">📦</span>
                    <span className="text-white text-sm font-medium">Widget Görünümü</span>
                  </div>
                  <div className="flex gap-2">
                    {(['elevated', 'flat', 'outlined'] as const).map((wStyle) => (
                      <button
                        key={wStyle}
                        onClick={() => onUpdate({ widgetStyle: wStyle })}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-[transform,background-color,border-color] duration-150 active:scale-95 border ${
                          settings.widgetStyle === wStyle
                            ? 'bg-purple-600 text-white border-purple-500 shadow-lg shadow-purple-600/25'
                            : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:border-white/10'
                        }`}
                      >
                        {wStyle === 'elevated' ? '⬆️ Yükseltilmiş' : wStyle === 'flat' ? '▬ Düz' : '⬜ Kenarlı'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <BigSlider
                    icon={Sun}
                    label="Parlaklık"
                    value={settings.brightness}
                    onChange={(v) => onUpdate({ brightness: v })}
                  />
                </div>
              </Card>
            </div>

            <div>
              <SectionTitle>Uygulama Düzeni</SectionTitle>
              <Card>
                <div className="flex items-center gap-3 mb-4">
                  <Grid3x3 className="w-5 h-5 text-blue-400" />
                  <span className="text-white text-base font-medium">Grid Sütun Sayısı</span>
                </div>
                <div className="flex gap-4">
                  {([3, 4, 5] as const).map((n) => (
                    <ColButton
                      key={n}
                      active={settings.gridColumns === n}
                      onClick={() => onUpdate({ gridColumns: n })}
                    >
                      {n} Kolon
                    </ColButton>
                  ))}
                </div>
              </Card>
            </div>

          </div>

          {/* SAĞ ── Ses + Saat + Varsayılan Uygulamalar */}
          <div className="flex flex-col gap-5">

            <div>
              <SectionTitle>Ses</SectionTitle>
              <Card>
                <BigSlider
                  icon={Volume2}
                  label="Ses Seviyesi"
                  value={settings.volume}
                  onChange={(v) => onUpdate({ volume: v })}
                />
              </Card>
            </div>

            <div>
              <SectionTitle>Saat</SectionTitle>
              <Card>
                <div className="flex items-center gap-3 mb-4">
                  <Clock className="w-5 h-5 text-blue-400" />
                  <span className="text-white text-base font-medium">Saat Görünümü</span>
                </div>
                <div className="flex gap-3 mb-5">
                  <ColButton
                    active={settings.clockStyle === 'digital'}
                    onClick={() => onUpdate({ clockStyle: 'digital' })}
                  >
                    🔢 Dijital
                  </ColButton>
                  <ColButton
                    active={settings.clockStyle === 'analog'}
                    onClick={() => onUpdate({ clockStyle: 'analog' })}
                  >
                    🕐 Analog
                  </ColButton>
                </div>
                <ToggleRow
                  label="24 Saat Formatı"
                  desc="13:00 yerine 1:00 PM göster"
                  value={settings.use24Hour}
                  onChange={(v) => onUpdate({ use24Hour: v })}
                />
                <ToggleRow
                  label="Saniye Göster"
                  desc="Saat: Dakika: Saniye formatı"
                  value={settings.showSeconds}
                  onChange={(v) => onUpdate({ showSeconds: v })}
                />
              </Card>
            </div>

            <div>
              <SectionTitle>Varsayılan Uygulamalar</SectionTitle>
              <Card>
                <AppPickerRow
                  icon={Map}
                  label="Navigasyon"
                  options={NAV_OPTIONS}
                  value={settings.defaultNav}
                  onChange={(v) => onUpdate({ defaultNav: v })}
                />
                <AppPickerRow
                  icon={Music}
                  label="Müzik"
                  options={MUSIC_OPTIONS}
                  value={settings.defaultMusic}
                  onChange={(v) => onUpdate({ defaultMusic: v })}
                />
              </Card>
            </div>

            <div>
              <SectionTitle>Ek Modlar</SectionTitle>
              <Card>
                <ToggleRow
                  label="Uyku Modu"
                  desc="Araç parkedken ekranı kapat"
                  value={settings.sleepMode}
                  onChange={(v) => onUpdate({ sleepMode: v })}
                />
                <div className="pt-5 mt-5 border-t border-white/5">
                  <div className="flex items-center gap-3 mb-5">
                    <Zap className="w-5 h-5 text-blue-400" />
                    <div>
                      <span className="text-white text-base font-semibold">Performans Modu</span>
                      <p className="text-xs text-slate-500 mt-0.5">Cihazınıza uygun mod seçin</p>
                    </div>
                  </div>

                  {/* Premium mode cards layout */}
                  <div className="space-y-2">
                    {(['lite', 'balanced', 'premium'] as const).map((mode) => {
                      const isSelected = getPerformanceMode() === mode;
                      const configs = {
                        lite: {
                          icon: '⚡',
                          label: 'Hafif',
                          desc: 'Minimum işlem yükü, en akıcı deneyim. Update sıklığı düşük, görsel efektler kapalı.',
                          specs: '30s OBD poll • No effects • Fast',
                          color: 'from-amber-600/20 to-amber-500/10 border-amber-500/30',
                          activeColor: 'from-amber-600/40 to-amber-500/20 border-amber-500/60 shadow-lg shadow-amber-600/20',
                        },
                        balanced: {
                          icon: '⚙️',
                          label: 'Dengeli',
                          desc: 'Optimal denge. Tüm özellikler aktif, cihazınız yeterli performans gösterir. (Önerilen)',
                          specs: '10s OBD poll • All features • Balanced',
                          color: 'from-blue-600/20 to-blue-500/10 border-blue-500/30',
                          activeColor: 'from-blue-600/40 to-blue-500/20 border-blue-500/60 shadow-lg shadow-blue-600/20',
                        },
                        premium: {
                          icon: '🚀',
                          label: 'Premium',
                          desc: 'Maksimum kalite. Sık updates, zengin görsel efektler, smooth animations. Yüksek performans gerektir.',
                          specs: '3s OBD poll • Enhanced effects • Premium',
                          color: 'from-purple-600/20 to-purple-500/10 border-purple-500/30',
                          activeColor: 'from-purple-600/40 to-purple-500/20 border-purple-500/60 shadow-lg shadow-purple-600/20',
                        },
                      };

                      const config = configs[mode];

                      return (
                        <button
                          key={mode}
                          onClick={() => setPerformanceMode(mode)}
                          className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 active:scale-95 bg-gradient-to-br ${
                            isSelected ? config.activeColor : config.color
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="text-2xl flex-shrink-0 mt-0.5">{config.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                                  {config.label}
                                </h3>
                                {isSelected && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-white font-medium">
                                    Aktif
                                  </span>
                                )}
                              </div>
                              <p className={`text-xs mb-2 leading-relaxed ${isSelected ? 'text-slate-200' : 'text-slate-400'}`}>
                                {config.desc}
                              </p>
                              <div className={`text-xs font-mono ${isSelected ? 'text-blue-300' : 'text-slate-500'}`}>
                                {config.specs}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Current mode info */}
                  <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-xs text-slate-400">
                      <span className="text-blue-400 font-semibold">
                        {getPerformanceMode() === 'lite' && '⚡ Hafif Mod'}
                        {getPerformanceMode() === 'balanced' && '⚙️ Dengeli Mod'}
                        {getPerformanceMode() === 'premium' && '🚀 Premium Mod'}
                      </span>
                      {' aktif. '}
                      {getPerformanceMode() === 'lite' && 'OBD, AI ve animasyonlar minimal. Eski cihazlar için ideal.'}
                      {getPerformanceMode() === 'balanced' && 'Çoğu cihaz için en uygun. Tüm özellikler dengeli şekilde çalışır.'}
                      {getPerformanceMode() === 'premium' && 'Tüm efektler açık. Yüksek performans cihazlar için optimize.'}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Map Source Section */}
            {mapSources.length > 0 && (
              <div>
                <Card>
                  <div className="flex items-center gap-3 mb-5">
                    <Map className="w-5 h-5 text-teal-400" />
                    <div>
                      <span className="text-white text-base font-semibold">Harita Kaynağı</span>
                      <p className="text-xs text-slate-500 mt-0.5">Yerel veya online harita seç</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {mapSources.map((source) => (
                      <button
                        key={source.id}
                        onClick={() => handleMapSourceChange(source.id)}
                        className={`w-full text-left p-3 rounded-xl transition-all ${
                          activeSourceId === source.id
                            ? 'bg-teal-600/40 border-2 border-teal-500/60 shadow-lg shadow-teal-600/20'
                            : 'bg-white/5 border-2 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-white font-semibold text-sm">{source.name}</div>
                            <div className="text-xs text-slate-400 mt-1">{source.description}</div>
                            {source.type === 'offline' && source.tileCount && (
                              <div className="text-xs text-emerald-400 mt-1">
                                📦 {source.tileCount} tiles • {source.cacheSize}
                              </div>
                            )}
                          </div>
                          <div className="ml-3 flex-shrink-0">
                            {activeSourceId === source.id && (
                              <div className="w-2 h-2 rounded-full bg-teal-400" />
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* Widget Layout Section */}
            <div>
              <Card>
                <div className="flex items-center gap-3 mb-5">
                  <Grid3x3 className="w-5 h-5 text-cyan-400" />
                  <div>
                    <span className="text-white text-base font-semibold">Widget Düzeni</span>
                    <p className="text-xs text-slate-500 mt-0.5">Ana widgetlerin odak noktasını seç</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {(['dashboard', 'focus-nav', 'focus-media', 'focus-obd'] as const).map((layout) => {
                    const isSelected = settings.widgetLayout === layout;
                    const configs = {
                      dashboard: {
                        icon: '🎯',
                        label: 'Dashboard',
                        desc: 'Tüm widgetler dengeli boyutta. Full kontrol paneli görünümü.',
                      },
                      'focus-nav': {
                        icon: '🗺️',
                        label: 'Navigasyon Odaklı',
                        desc: 'Harita widgeti büyütülür. Sürüş ve navigasyon için optimize.',
                      },
                      'focus-media': {
                        icon: '🎵',
                        label: 'Müzik Odaklı',
                        desc: 'Müzik kontrolü büyütülür. Şarkı seçimi ve kontrol için ideal.',
                      },
                      'focus-obd': {
                        icon: '🔧',
                        label: 'OBD Verisi Odaklı',
                        desc: 'Motor bilgileri büyütülür. Aracın durumunu takip etmek için.',
                      },
                    };
                    const config = configs[layout];

                    return (
                      <button
                        key={layout}
                        onClick={() => onUpdate({ widgetLayout: layout })}
                        className={`w-full text-left p-3 rounded-xl transition-all ${
                          isSelected
                            ? 'bg-cyan-600/40 border-2 border-cyan-500/60 shadow-lg shadow-cyan-600/20'
                            : 'bg-white/5 border-2 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{config.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-white font-semibold text-sm">{config.label}</div>
                            <div className="text-xs text-slate-400 mt-1">{config.desc}</div>
                          </div>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
export const SettingsPage = memo(SettingsPageInner);
