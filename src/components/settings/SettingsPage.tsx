import { memo, type ReactNode, useState, useCallback, type ComponentType } from 'react';
import {
  Sun, Smartphone, Zap, Palette, Layout, Image as ImageIcon, Check, Layers, PenTool as Tool
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../../data/apps';
import { getPerformanceMode, setPerformanceMode } from '../../platform/performanceMode';
import { setBrightness } from '../../platform/systemSettingsService';
import { MaintenancePanel } from '../obd/MaintenancePanel';

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
  { id: 'none', label: 'Yok', url: 'none' },
  { id: 'road', label: 'Yol', url: 'https://images.unsplash.com/photo-1449034446853-66c86144b0ad?auto=format&fit=crop&w=800&q=60' },
  { id: 'city', label: 'Şehir', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=800&q=60' },
  { id: 'abstract', label: 'Soyut', url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=800&q=60' },
  { id: 'cyber', label: 'Cyber', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&q=60' },
];

/* ── Ana bileşen ─────────────────────────────────────────── */

interface Props {
  onOpenMap?: () => void;
}

function SettingsPageInner({ onOpenMap }: Props) {
  const { settings, updateSettings } = useStore();
  const [tab, setTab] = useState<'general' | 'appearance' | 'performance' | 'maintenance'>('general');

  const handleBrightness = useCallback((v: number) => {
    updateSettings({ brightness: v });
    setBrightness(v);
  }, [updateSettings]);


  return (
    <div className="h-full flex flex-col bg-[#0b1424]">
      {/* Tabs */}
      <div className="flex border-b border-white/5 px-6 pt-4 gap-6">
        {[
          { id: 'general', label: 'Genel', icon: Smartphone },
          { id: 'appearance', label: 'Özelleştirme', icon: Palette },
          { id: 'maintenance', label: 'Bakım', icon: Tool },
          { id: 'performance', label: 'Performans', icon: Zap },
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
                  <Card>
                    <BigSlider
                      icon={Sun}
                      label="Parlaklık"
                      value={settings.brightness}
                      onChange={handleBrightness}
                    />
                    <div className="mt-6">
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
                  <Card className="grid grid-cols-5 gap-2">
                    <ChoiceCard 
                      active={settings.themePack === 'tesla'}
                      onClick={() => updateSettings({ themePack: 'tesla' })}
                      icon={Layout}
                      label="Tesla"
                      desc="Minimalist"
                    />
                    <ChoiceCard 
                      active={settings.themePack === 'big-cards'}
                      onClick={() => updateSettings({ themePack: 'big-cards' })}
                      icon={Layers}
                      label="Sürüş"
                      desc="Büyük"
                    />
                    <ChoiceCard 
                      active={settings.themePack === 'ai-center'}
                      onClick={() => updateSettings({ themePack: 'ai-center' })}
                      icon={Zap}
                      label="Futuristik"
                      desc="Parlak"
                    />
                    <ChoiceCard 
                      active={settings.themePack === 'bmw'}
                      onClick={() => updateSettings({ themePack: 'bmw' })}
                      icon={Palette}
                      label="BMW"
                      desc="M-Sport"
                    />
                    <ChoiceCard 
                      active={settings.themePack === 'mercedes'}
                      onClick={() => updateSettings({ themePack: 'mercedes' })}
                      icon={Smartphone}
                      label="Mercedes"
                      desc="MBUX"
                    />
                  </Card>

                  <SectionTitle>Panel Stili</SectionTitle>
                  <Card className="grid grid-cols-3 gap-3">
                    <ChoiceCard 
                      active={settings.themeStyle === 'glass'}
                      onClick={() => updateSettings({ themeStyle: 'glass' })}
                      icon={ImageIcon}
                      label="Cam"
                    />
                    <ChoiceCard 
                      active={settings.themeStyle === 'neon'}
                      onClick={() => updateSettings({ themeStyle: 'neon' })}
                      icon={Zap}
                      label="Neon"
                    />
                    <ChoiceCard 
                      active={settings.themeStyle === 'minimal'}
                      onClick={() => updateSettings({ themeStyle: 'minimal' })}
                      icon={Smartphone}
                      label="Minimal"
                    />
                  </Card>
                </div>

                <div className="flex flex-col gap-6">
                  <SectionTitle>Widget Tarzı</SectionTitle>
                  <Card className="grid grid-cols-3 gap-3">
                    <ChoiceCard 
                      active={settings.widgetStyle === 'elevated'}
                      onClick={() => updateSettings({ widgetStyle: 'elevated' })}
                      icon={Layers}
                      label="Gölgeli"
                    />
                    <ChoiceCard 
                      active={settings.widgetStyle === 'flat'}
                      onClick={() => updateSettings({ widgetStyle: 'flat' })}
                      icon={Layout}
                      label="Düz"
                    />
                    <ChoiceCard 
                      active={settings.widgetStyle === 'outlined'}
                      onClick={() => updateSettings({ widgetStyle: 'outlined' })}
                      icon={Smartphone}
                      label="Çizgisel"
                    />
                  </Card>

                  <SectionTitle>Düzenleme</SectionTitle>
                  <Card>
                    <ToggleRow 
                      label="Düzenleme Modu" 
                      desc="Ana ekrandaki widget'ları gizle/göster" 
                      value={settings.editMode} 
                      onChange={(v) => updateSettings({ editMode: v })}
                    />
                  </Card>
                </div>
              </div>

              <SectionTitle>Duvar Kağıdı</SectionTitle>
              <Card>
                <div className="grid grid-cols-5 gap-4">
                  {WALLPAPERS.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => updateSettings({ wallpaper: w.url })}
                      className={`relative aspect-video rounded-xl overflow-hidden border-2 transition-all ${
                        settings.wallpaper === w.url ? 'border-blue-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      {w.url === 'none' ? (
                        <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                          <ImageIcon className="w-6 h-6 text-slate-700" />
                        </div>
                      ) : (
                        <img src={w.url} className="w-full h-full object-cover" alt={w.label} />
                      )}
                      <div className="absolute inset-0 bg-black/20 flex items-end p-2">
                        <span className="text-[10px] font-bold text-white uppercase">{w.label}</span>
                      </div>
                      {settings.wallpaper === w.url && (
                        <div className="absolute top-1 right-1 bg-blue-500 rounded-full p-0.5">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
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
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export const SettingsPage = memo(SettingsPageInner);
