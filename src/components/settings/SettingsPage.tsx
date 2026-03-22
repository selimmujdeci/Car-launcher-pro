import { memo, type ReactNode } from 'react';
import { Sun, Volume2, Grid3x3, Map, Music, Moon, Smartphone, Clock } from 'lucide-react';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../../data/apps';
import type { NavOptionKey, MusicOptionKey } from '../../data/apps';

export interface Settings {
  brightness: number;
  volume: number;
  theme: 'dark' | 'oled';
  use24Hour: boolean;
  showSeconds: boolean;
  gridColumns: 3 | 4 | 5;
  defaultNav: NavOptionKey;
  defaultMusic: MusicOptionKey;
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
                  <span className="text-white text-base font-medium">Tema</span>
                </div>
                <div className="flex gap-4">
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
                <div className="mt-5">
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

          </div>
        </div>

      </div>
    </div>
  );
}
export const SettingsPage = memo(SettingsPageInner);
