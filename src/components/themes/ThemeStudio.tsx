import { memo, useState, useCallback } from 'react';
import { useThemeStudio, type ThemeToken, type SavedSlot } from '../../store/useThemeStudio';
import { useCarTheme, type BaseTheme } from '../../store/useCarTheme';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'renkler' | 'sekiller' | 'efektler' | 'yazi' | 'ikonlar' | 'kayitli';

interface Props { onClose: () => void }

// ── Palette presets ───────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  '#E31937','#CC0000','#D4AF37','#C8A96E',
  '#00D4FF','#00E5FF','#22c55e','#a855f7',
  '#f59e0b','#ec4899','#FFFFFF','#6b7280',
];

const BG_COLORS = [
  '#000000','#0A0A0A','#080606','#141414',
  '#05080E','#0c1a2e','#1C1C2E','#0f172a',
];

const FONTS = [
  { id: 'system',    label: 'Sistem Yazı Tipi',  sample: 'Aa' },
  { id: 'orbitron',  label: 'Orbitron',           sample: 'Aa' },
  { id: 'rajdhani',  label: 'Rajdhani',           sample: 'Aa' },
  { id: 'exo2',      label: 'Exo 2',              sample: 'Aa' },
  { id: 'sharetech', label: 'Share Tech Mono',    sample: 'Aa' },
];

const FONT_FAMILY_CSS: Record<string, string> = {
  system:    '-apple-system, sans-serif',
  orbitron:  "'Orbitron', monospace",
  rajdhani:  "'Rajdhani', sans-serif",
  exo2:      "'Exo 2', sans-serif",
  sharetech: "'Share Tech Mono', monospace",
};

const BASE_THEMES: { id: BaseTheme; label: string; accent: string }[] = [
  { id: 'tesla',    label: 'Tesla',    accent: '#E31937' },
  { id: 'pro',      label: 'PRO',      accent: '#D4AF37' },
  { id: 'cockpit',  label: 'Cockpit',  accent: '#00D4FF' },
  { id: 'mercedes', label: 'Mercedes', accent: '#C8A96E' },
  { id: 'audi',     label: 'Audi',     accent: '#CC0000' },
  { id: 'oled',     label: 'OLED',     accent: '#00E5FF' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-black uppercase tracking-[0.35em] mb-2"
      style={{ color: 'rgba(255,255,255,0.25)' }}>
      {children}
    </p>
  );
}

function Slider({
  label, value, min, max, step = 1, unit,
  onChange,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline">
        <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</span>
        <span className="text-[10px] font-mono tabular-nums" style={{ color: 'rgba(255,255,255,0.65)' }}>
          {typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full cursor-pointer appearance-none"
        style={{ accentColor: 'var(--accent-primary, #60a5fa)' }}
      />
    </div>
  );
}

function ColorPicker({
  label, value, presets, onChange,
}: {
  label: string; value: string; presets?: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>{value}</span>
          <label className="relative cursor-pointer">
            <div className="w-7 h-7 rounded-lg border-2 overflow-hidden"
              style={{ borderColor: 'rgba(255,255,255,0.15)', backgroundColor: value }}>
              <input type="color" value={value.startsWith('#') ? value : '#000000'}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
            </div>
          </label>
        </div>
      </div>
      {presets && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((c) => (
            <button key={c} onClick={() => onChange(c)}
              className="w-7 h-7 rounded-lg transition-all active:scale-90"
              style={{
                backgroundColor: c,
                border: value === c ? '2px solid white' : '1.5px solid rgba(255,255,255,0.1)',
                boxShadow: value === c ? `0 0 8px ${c}80` : 'none',
              }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live Preview ──────────────────────────────────────────────────────────────

function LivePreview({ t }: { t: ThemeToken }) {
  return (
    <div className="rounded-2xl overflow-hidden flex-shrink-0"
      style={{
        background: t.bgCard,
        border: `1px solid ${t.borderColor}`,
        boxShadow: `0 0 20px ${t.glowColor}`,
        backdropFilter: `blur(${t.cardBlurPx}px)`,
        borderRadius: t.radiusCard,
        width: '100%',
        padding: '12px',
      }}>
      {/* Mini header */}
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-2 h-2 rounded-full" style={{ background: t.accentPrimary, boxShadow: `0 0 6px ${t.accentPrimary}` }} />
        <span className="text-[10px] font-bold" style={{
          color: t.textPrimary,
          fontFamily: FONT_FAMILY_CSS[t.fontFamily],
          fontWeight: t.fontWeight,
          letterSpacing: `${t.letterSpacing}px`,
        }}>
          ÖNIZLEME
        </span>
        <div className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold"
          style={{
            background: `${t.accentPrimary}22`,
            color: t.accentPrimary,
            borderRadius: t.radiusBtn,
            border: `1px solid ${t.accentPrimary}44`,
          }}>
          Online
        </div>
      </div>

      {/* Mini buttons */}
      <div className="flex gap-1.5 mb-2">
        {['KİLİTLE', 'AÇ'].map((lbl, i) => (
          <div key={lbl} className="flex-1 py-1.5 text-center text-[8px] font-black"
            style={{
              background: i === 0 ? `${t.accentSecondary}18` : `${t.accentPrimary}18`,
              color:       i === 0 ? t.accentSecondary : t.accentPrimary,
              border:      `1.5px solid ${i === 0 ? t.accentSecondary : t.accentPrimary}44`,
              borderRadius: t.radiusBtn,
              letterSpacing: `${t.letterSpacing}px`,
              fontFamily: FONT_FAMILY_CSS[t.fontFamily],
              fontWeight: t.fontWeight,
            }}>
            {lbl}
          </div>
        ))}
      </div>

      {/* Mini telemetry */}
      <div className="flex gap-1">
        {[{ l: 'Hız', v: '72', u: 'km/h' }, { l: 'Yakıt', v: '68', u: '%' }, { l: 'Motor', v: '88', u: '°C' }].map(({ l, v, u }) => (
          <div key={l} className="flex-1 py-1 text-center"
            style={{ background: `${t.accentPrimary}10`, borderRadius: t.radiusTile, border: `1px solid ${t.accentPrimary}20` }}>
            <div className="text-[7px] font-bold" style={{ color: `${t.textSecondary}` }}>{l}</div>
            <div className="text-[11px] font-black tabular-nums" style={{ color: t.accentPrimary }}>{v}</div>
            <div className="text-[7px]" style={{ color: `${t.textSecondary}88` }}>{u}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Saved slot card ───────────────────────────────────────────────────────────

function SlotCard({ slot, onLoad, onDelete }: { slot: SavedSlot; onLoad: () => void; onDelete: () => void }) {
  const ago = (() => {
    const m = Math.round((Date.now() - slot.savedAt) / 60_000);
    if (m < 1)   return 'Az önce';
    if (m < 60)  return `${m} dk`;
    const h = Math.round(m / 60);
    if (h < 24)  return `${h} sa`;
    return `${Math.round(h / 24)} gün`;
  })();

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {/* Color chip */}
      <div className="flex gap-1 flex-shrink-0">
        <div className="w-4 h-8 rounded-sm" style={{ background: slot.accentPrimary }} />
        <div className="w-4 h-8 rounded-sm" style={{ background: slot.bgPrimary, border: '1px solid rgba(255,255,255,0.1)' }} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-white/80 leading-tight truncate">{slot.name}</p>
        <p className="text-[9px] text-white/30 mt-0.5">{slot.baseTheme.toUpperCase()} · {ago} önce</p>
      </div>

      <div className="flex gap-1.5 flex-shrink-0">
        <button onClick={onLoad}
          className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all active:scale-90"
          style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa' }}>
          Yükle
        </button>
        <button onClick={onDelete}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-90"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main ThemeStudio ──────────────────────────────────────────────────────────

export const ThemeStudio = memo(function ThemeStudio({ onClose }: Props) {
  const { current, slots, applyToken, saveSlot, loadSlot, deleteSlot, resetToBase } = useThemeStudio();
  const { setTheme } = useCarTheme();

  const [tab,      setTab]      = useState<Tab>('renkler');
  const [saveName, setSaveName] = useState('');
  const [saved,    setSaved]    = useState(false);

  const t = current;

  const patch = useCallback((p: Partial<ThemeToken>) => applyToken(p), [applyToken]);

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    saveSlot(saveName);
    setSaveName('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [saveName, saveSlot]);

  const handleBaseSelect = useCallback((base: BaseTheme) => {
    resetToBase(base);
    setTheme(base); // sync data-theme attribute for CSS overrides
  }, [resetToBase, setTheme]);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'renkler',  label: 'Renkler'  },
    { id: 'sekiller', label: 'Şekiller' },
    { id: 'efektler', label: 'Efektler' },
    { id: 'yazi',     label: 'Yazı'     },
    { id: 'ikonlar',  label: 'İkonlar'  },
    { id: 'kayitli',  label: `Kayıtlı${slots.length ? ` (${slots.length})` : ''}` },
  ];

  return (
    <div className="fixed inset-0 z-[9100] flex flex-col"
      style={{ background: 'rgba(4,8,16,0.97)', backdropFilter: 'blur(24px)' }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <button onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2l10 10M12 2L2 12" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="flex-1">
          <p className="text-sm font-black text-white leading-tight">Tema Stüdyo</p>
          <p className="text-[9px] text-white/30 mt-0.5">Her detayı özelleştir · Canlı önizleme</p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, var(--accent-primary, #3b82f6), var(--accent-secondary, #1d4ed8))',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(59,130,246,0.25)',
          }}>
          Uygula ✓
        </button>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 flex flex-col gap-4">

          {/* Live preview */}
          <LivePreview t={t} />

          {/* Base theme row */}
          <div>
            <SectionTitle>Başlangıç Teması</SectionTitle>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {BASE_THEMES.map(({ id, label, accent }) => (
                <button key={id} onClick={() => handleBaseSelect(id)}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-all active:scale-90"
                  style={{
                    background: t.baseTheme === id ? `${accent}18` : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${t.baseTheme === id ? `${accent}60` : 'rgba(255,255,255,0.08)'}`,
                  }}>
                  <div className="w-5 h-5 rounded-full" style={{ background: accent, boxShadow: t.baseTheme === id ? `0 0 8px ${accent}` : 'none' }} />
                  <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: t.baseTheme === id ? accent : 'rgba(255,255,255,0.3)' }}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {TABS.map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id)}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                style={{
                  background: tab === id ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)',
                  color:       tab === id ? '#60a5fa' : 'rgba(255,255,255,0.35)',
                  border:      `1px solid ${tab === id ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.07)'}`,
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex flex-col gap-5">

            {/* ── RENKLER ─────────────────────────────────────────────────── */}
            {tab === 'renkler' && (
              <>
                <ColorPicker label="Ana Vurgu Rengi" value={t.accentPrimary}
                  presets={ACCENT_COLORS}
                  onChange={(v) => patch({ accentPrimary: v })} />

                <ColorPicker label="İkincil Vurgu" value={t.accentSecondary}
                  presets={ACCENT_COLORS}
                  onChange={(v) => patch({ accentSecondary: v })} />

                <ColorPicker label="Arka Plan" value={t.bgPrimary}
                  presets={BG_COLORS}
                  onChange={(v) => patch({ bgPrimary: v })} />

                <ColorPicker label="Kart Arkaplanı" value={t.bgCard}
                  onChange={(v) => patch({ bgCard: v })} />

                <ColorPicker label="Ana Metin" value={t.textPrimary}
                  presets={['#FFFFFF','#F5F0E8','#EDE8E0','#E8F4FF','#CCCCCC']}
                  onChange={(v) => patch({ textPrimary: v })} />

                <ColorPicker label="İkincil Metin" value={t.textSecondary}
                  presets={['#888888','#9EA3AE','#B8A89A','#5A7A9A','#8A7A5E','#606060']}
                  onChange={(v) => patch({ textSecondary: v })} />

                <ColorPicker label="Kenarlık Rengi" value={t.borderColor}
                  onChange={(v) => patch({ borderColor: v })} />

                <ColorPicker label="Parlaklık / Glow" value={t.glowColor}
                  onChange={(v) => patch({ glowColor: v })} />
              </>
            )}

            {/* ── ŞEKİLLER ────────────────────────────────────────────────── */}
            {tab === 'sekiller' && (
              <>
                <div className="p-3 rounded-2xl flex flex-col gap-4"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <SectionTitle>Köşe Yuvarlaklığı</SectionTitle>
                  <Slider label="Kart" value={t.radiusCard} min={0} max={40} unit="px"
                    onChange={(v) => patch({ radiusCard: v })} />
                  <Slider label="Buton" value={t.radiusBtn} min={0} max={28} unit="px"
                    onChange={(v) => patch({ radiusBtn: v })} />
                  <Slider label="Kutucuk / Tile" value={t.radiusTile} min={0} max={32} unit="px"
                    onChange={(v) => patch({ radiusTile: v })} />
                  <Slider label="Dock" value={t.radiusDock} min={0} max={24} unit="px"
                    onChange={(v) => patch({ radiusDock: v })} />
                </div>

                {/* Shape preset buttons */}
                <div>
                  <SectionTitle>Hızlı Şekil Profili</SectionTitle>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Keskin', icon: '▭', r: { radiusCard: 2, radiusBtn: 2, radiusTile: 2, radiusDock: 0 } },
                      { label: 'Modern', icon: '▢', r: { radiusCard: 12, radiusBtn: 8, radiusTile: 10, radiusDock: 4 } },
                      { label: 'Yuvarlak', icon: '◯', r: { radiusCard: 28, radiusBtn: 20, radiusTile: 20, radiusDock: 16 } },
                    ].map(({ label, icon, r }) => (
                      <button key={label} onClick={() => patch(r)}
                        className="flex flex-col items-center gap-1 py-3 rounded-xl transition-all active:scale-95"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <span className="text-xl">{icon}</span>
                        <span className="text-[9px] font-bold text-white/50">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── EFEKTLER ────────────────────────────────────────────────── */}
            {tab === 'efektler' && (
              <div className="flex flex-col gap-5">
                <div className="p-3 rounded-2xl flex flex-col gap-4"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <SectionTitle>Cam / Blur Efekti</SectionTitle>
                  <Slider label="Bulanıklık" value={t.cardBlurPx} min={0} max={40} unit="px"
                    onChange={(v) => patch({ cardBlurPx: v })} />
                  <Slider label="Parlaklık Yoğunluğu" value={t.glowIntensity} min={0} max={100} unit="%"
                    onChange={(v) => patch({ glowIntensity: v })} />
                </div>

                {/* Effect presets */}
                <div>
                  <SectionTitle>Hızlı Efekt Profili</SectionTitle>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'OLED\nSıfır', blur: 0,  glow: 100 },
                      { label: 'Glass\nOrta',  blur: 20, glow: 50  },
                      { label: 'Frosted\nYüksek', blur: 40, glow: 30 },
                    ].map(({ label, blur, glow }) => (
                      <button key={label}
                        onClick={() => patch({ cardBlurPx: blur, glowIntensity: glow })}
                        className="flex flex-col items-center gap-1 py-3 rounded-xl transition-all active:scale-95"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <span className="text-[9px] font-bold text-white/50 text-center leading-snug whitespace-pre-line">{label}</span>
                        <span className="text-[8px] text-white/25">{blur}px / %{glow}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── YAZI ────────────────────────────────────────────────────── */}
            {tab === 'yazi' && (
              <>
                <div>
                  <SectionTitle>Yazı Tipi</SectionTitle>
                  <div className="flex flex-col gap-2">
                    {FONTS.map(({ id, label }) => (
                      <button key={id} onClick={() => patch({ fontFamily: id })}
                        className="flex items-center justify-between px-3 py-3 rounded-xl transition-all active:scale-[0.98]"
                        style={{
                          background: t.fontFamily === id ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.04)',
                          border: `1.5px solid ${t.fontFamily === id ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.07)'}`,
                        }}>
                        <span className="text-xs text-white/60">{label}</span>
                        <span className="text-base" style={{
                          fontFamily: FONT_FAMILY_CSS[id],
                          color: t.fontFamily === id ? '#60a5fa' : 'rgba(255,255,255,0.3)',
                        }}>
                          CAROS PRO
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-2xl flex flex-col gap-4"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <SectionTitle>Yazı Ayarları</SectionTitle>
                  <Slider label="Kalınlık" value={t.fontWeight} min={400} max={900} step={100} unit=""
                    onChange={(v) => patch({ fontWeight: v })} />
                  <Slider label="Harf Aralığı" value={t.letterSpacing} min={0} max={6} step={0.5} unit="px"
                    onChange={(v) => patch({ letterSpacing: v })} />
                </div>
              </>
            )}

            {/* ── İKONLAR ─────────────────────────────────────────────────── */}
            {tab === 'ikonlar' && (
              <>
                {/* Quick: all icons to accent */}
                <button onClick={() => patch({ iconNav: t.accentPrimary, iconMedia: t.accentPrimary, iconDock: t.accentPrimary })}
                  className="w-full py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-[0.97]"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                  Tümünü Ana Renge Eşitle
                </button>

                <ColorPicker label="Navigasyon İkonları" value={t.iconNav}
                  presets={ACCENT_COLORS}
                  onChange={(v) => patch({ iconNav: v })} />

                <ColorPicker label="Medya İkonları" value={t.iconMedia}
                  presets={ACCENT_COLORS}
                  onChange={(v) => patch({ iconMedia: v })} />

                <ColorPicker label="Dock İkonları" value={t.iconDock}
                  presets={ACCENT_COLORS}
                  onChange={(v) => patch({ iconDock: v })} />

                {/* Icon style preview */}
                <div className="p-3 rounded-2xl"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <SectionTitle>İkon Önizlemesi</SectionTitle>
                  <div className="flex items-center justify-around py-2">
                    {[
                      { color: t.iconNav,   icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.8"/></svg>, label: 'Nav' },
                      { color: t.iconMedia, icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M9 18V6l12-3v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8"/><circle cx="18" cy="15" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>, label: 'Medya' },
                      { color: t.iconDock,  icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="14" y="7" width="7" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.8"/><rect x="3" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.8"/></svg>, label: 'Dock' },
                    ].map(({ color, icon, label }) => (
                      <div key={label} className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                          style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
                          {icon}
                        </div>
                        <span className="text-[8px] font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── KAYITLI ─────────────────────────────────────────────────── */}
            {tab === 'kayitli' && (
              <>
                {/* Save current */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Tema adı girin…"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    className="flex-1 px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                  <button onClick={handleSave}
                    disabled={!saveName.trim()}
                    className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40"
                    style={{
                      background: saved ? 'rgba(52,211,153,0.2)' : 'rgba(59,130,246,0.2)',
                      border: `1.5px solid ${saved ? 'rgba(52,211,153,0.4)' : 'rgba(59,130,246,0.4)'}`,
                      color: saved ? '#34d399' : '#60a5fa',
                    }}>
                    {saved ? '✓ Kaydedildi' : 'Kaydet'}
                  </button>
                </div>

                {slots.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-white/20">Henüz kaydedilmiş tema yok</p>
                    <p className="text-[10px] text-white/15 mt-1">Bir tema oluşturup adını vererek kaydedin</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {slots.map((slot) => (
                      <SlotCard
                        key={slot.id}
                        slot={slot}
                        onLoad={() => loadSlot(slot.id)}
                        onDelete={() => deleteSlot(slot.id)}
                      />
                    ))}
                  </div>
                )}

                <p className="text-center text-[9px] text-white/20">
                  {slots.length}/6 slot kullanıldı
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
