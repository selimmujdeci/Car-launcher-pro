'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { sendCommand } from '@/lib/commandService';

// ── Types ─────────────────────────────────────────────────────────────────────

type StudioTab = 'renkler' | 'sekiller' | 'efektler' | 'yazi' | 'ikonlar';

interface ThemeToken {
  name: string;
  baseTheme: string;
  accentPrimary: string;
  accentSecondary: string;
  bgPrimary: string;
  bgCard: string;
  textPrimary: string;
  textSecondary: string;
  borderColor: string;
  glowColor: string;
  radiusCard: number;
  radiusBtn: number;
  radiusTile: number;
  radiusDock: number;
  cardBlurPx: number;
  glowIntensity: number;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: number;
  iconNav: string;
  iconMedia: string;
  iconDock: string;
}

// ── Presets (mirrors car app useThemeStudio.ts) ───────────────────────────────

const PRESETS: Record<string, ThemeToken> = {
  pro: {
    name: 'PRO', baseTheme: 'pro',
    accentPrimary: '#D4AF37', accentSecondary: '#C0392B',
    bgPrimary: '#1C1C2E', bgCard: 'rgba(35,35,58,0.96)',
    textPrimary: '#F5F0E8', textSecondary: '#B8A89A',
    borderColor: 'rgba(212,175,55,0.30)', glowColor: 'rgba(212,175,55,0.25)',
    radiusCard: 18, radiusBtn: 4, radiusTile: 4, radiusDock: 0,
    cardBlurPx: 16, glowIntensity: 60,
    fontFamily: 'orbitron', fontWeight: 900, letterSpacing: 2,
    iconNav: '#D4AF37', iconMedia: '#2ECC71', iconDock: '#D4AF37',
  },
  tesla: {
    name: 'TESLA', baseTheme: 'tesla',
    accentPrimary: '#E31937', accentSecondary: '#FFFFFF',
    bgPrimary: '#141414', bgCard: 'rgba(20,20,20,0.95)',
    textPrimary: '#FFFFFF', textSecondary: '#9EA3AE',
    borderColor: 'rgba(227,25,55,0.25)', glowColor: 'rgba(227,25,55,0.15)',
    radiusCard: 12, radiusBtn: 6, radiusTile: 8, radiusDock: 0,
    cardBlurPx: 20, glowIntensity: 40,
    fontFamily: 'system', fontWeight: 400, letterSpacing: 0,
    iconNav: '#E31937', iconMedia: '#FFFFFF', iconDock: '#E31937',
  },
  cockpit: {
    name: 'COCKPIT', baseTheme: 'cockpit',
    accentPrimary: '#00D4FF', accentSecondary: '#0050FF',
    bgPrimary: '#05080E', bgCard: 'rgba(5,15,30,0.90)',
    textPrimary: '#E8F4FF', textSecondary: '#5A7A9A',
    borderColor: 'rgba(0,212,255,0.25)', glowColor: 'rgba(0,212,255,0.20)',
    radiusCard: 20, radiusBtn: 10, radiusTile: 16, radiusDock: 16,
    cardBlurPx: 28, glowIntensity: 80,
    fontFamily: 'exo2', fontWeight: 700, letterSpacing: 1,
    iconNav: '#00D4FF', iconMedia: '#00D4FF', iconDock: '#00D4FF',
  },
  mercedes: {
    name: 'MERCEDES', baseTheme: 'mercedes',
    accentPrimary: '#C8A96E', accentSecondary: '#8A7A5E',
    bgPrimary: '#080606', bgCard: 'rgba(15,12,10,0.95)',
    textPrimary: '#EDE8E0', textSecondary: '#8A7E72',
    borderColor: 'rgba(200,169,110,0.28)', glowColor: 'rgba(200,169,110,0.15)',
    radiusCard: 6, radiusBtn: 6, radiusTile: 6, radiusDock: 0,
    cardBlurPx: 12, glowIntensity: 30,
    fontFamily: 'rajdhani', fontWeight: 600, letterSpacing: 3,
    iconNav: '#C8A96E', iconMedia: '#C8A96E', iconDock: '#C8A96E',
  },
  audi: {
    name: 'AUDI', baseTheme: 'audi',
    accentPrimary: '#CC0000', accentSecondary: '#FFFFFF',
    bgPrimary: '#0A0A0A', bgCard: 'rgba(12,12,12,0.96)',
    textPrimary: '#FFFFFF', textSecondary: '#888888',
    borderColor: 'rgba(204,0,0,0.30)', glowColor: 'rgba(204,0,0,0.20)',
    radiusCard: 2, radiusBtn: 2, radiusTile: 2, radiusDock: 0,
    cardBlurPx: 8, glowIntensity: 45,
    fontFamily: 'system', fontWeight: 700, letterSpacing: 4,
    iconNav: '#CC0000', iconMedia: '#FFFFFF', iconDock: '#CC0000',
  },
};

const LS_KEY = 'caros-theme-studio';

function load(): ThemeToken {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as ThemeToken;
  } catch { /* ignore */ }
  return PRESETS.pro;
}

function save(t: ThemeToken) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

// ── Token → CSS var map (matches car app applyTokens) ────────────────────────

const FONT_MAP: Record<string, string> = {
  system:    `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  orbitron:  `'Orbitron', monospace`,
  rajdhani:  `'Rajdhani', sans-serif`,
  exo2:      `'Exo 2', sans-serif`,
  sharetech: `'Share Tech Mono', monospace`,
};

const FONT_CSS: Record<string, string> = {
  system:    '-apple-system, sans-serif',
  orbitron:  "'Orbitron', monospace",
  rajdhani:  "'Rajdhani', sans-serif",
  exo2:      "'Exo 2', sans-serif",
  sharetech: "'Share Tech Mono', monospace",
};

function tokenToVars(t: ThemeToken): Record<string, string> {
  return {
    '--accent-primary':      t.accentPrimary,
    '--accent-secondary':    t.accentSecondary,
    '--pack-accent':         t.accentPrimary,
    '--premium-accent':      t.accentPrimary,
    '--accent-blue':         t.accentPrimary,
    '--neon-accent':         t.accentPrimary,
    '--bg-primary':          t.bgPrimary,
    '--bg-card':             t.bgCard,
    '--pack-bg':             t.bgPrimary,
    '--pack-card-bg':        t.bgCard,
    '--text-primary':        t.textPrimary,
    '--text-primary-var':    t.textPrimary,
    '--text-secondary':      t.textSecondary,
    '--text-secondary-var':  t.textSecondary,
    '--border-color':        t.borderColor,
    '--pack-border':         t.borderColor,
    '--accent-glow':         t.glowColor,
    '--pack-glow':           t.glowColor,
    '--radius-card':         `${t.radiusCard}px`,
    '--card-radius':         `${t.radiusCard}px`,
    '--radius-btn':          `${t.radiusBtn}px`,
    '--radius-tile':         `${t.radiusTile}px`,
    '--radius-dock':         `${t.radiusDock}px`,
    '--card-blur':           `${t.cardBlurPx}px`,
    '--glass-blur':          `blur(${t.cardBlurPx}px)`,
    '--font-ui':             FONT_MAP[t.fontFamily] ?? FONT_MAP.system,
    '--font-weight-ui':      String(t.fontWeight),
    '--letter-spacing-ui':   `${t.letterSpacing}px`,
    '--icon-color-nav':      t.iconNav,
    '--icon-color-media':    t.iconMedia,
    '--dock-icon-color':     t.iconDock,
    '--dock-icon-color-active': t.accentPrimary,
    '__baseTheme':           t.baseTheme,
  };
}

// ── Accent / bg color presets ─────────────────────────────────────────────────

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
  { id: 'system',    label: 'Sistem' },
  { id: 'orbitron',  label: 'Orbitron' },
  { id: 'rajdhani',  label: 'Rajdhani' },
  { id: 'exo2',      label: 'Exo 2' },
  { id: 'sharetech', label: 'Share Tech Mono' },
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

function Slider({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number;
  step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline">
        <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</span>
        <span className="text-[10px] font-mono tabular-nums" style={{ color: 'rgba(255,255,255,0.65)' }}>
          {Number.isInteger(value) ? value : value.toFixed(1)}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full cursor-pointer appearance-none"
        style={{ accentColor: 'var(--accent-primary, #3b82f6)' }}
      />
    </div>
  );
}

function ColorPicker({ label, value, presets, onChange }: {
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

function LivePreview({ t }: { t: ThemeToken }) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: t.bgCard,
        border: `1px solid ${t.borderColor}`,
        boxShadow: `0 0 20px ${t.glowColor}`,
        backdropFilter: `blur(${t.cardBlurPx}px)`,
        borderRadius: t.radiusCard,
        padding: '12px',
      }}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-2 h-2 rounded-full" style={{ background: t.accentPrimary, boxShadow: `0 0 6px ${t.accentPrimary}` }} />
        <span className="text-[10px] font-bold" style={{
          color: t.textPrimary,
          fontFamily: FONT_CSS[t.fontFamily],
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
          Canlı
        </div>
      </div>
      <div className="flex gap-1.5 mb-2">
        {['KİLİTLE', 'AÇ'].map((lbl, i) => (
          <div key={lbl} className="flex-1 py-1.5 text-center text-[8px] font-black"
            style={{
              background: `${i === 0 ? t.accentSecondary : t.accentPrimary}18`,
              color: i === 0 ? t.accentSecondary : t.accentPrimary,
              border: `1.5px solid ${i === 0 ? t.accentSecondary : t.accentPrimary}44`,
              borderRadius: t.radiusBtn,
            }}>
            {lbl}
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {[{ l: 'Hız', v: '72', u: 'km/h' }, { l: 'Yakıt', v: '68', u: '%' }, { l: 'Motor', v: '88', u: '°C' }].map(({ l, v, u }) => (
          <div key={l} className="flex-1 py-1 text-center"
            style={{ background: `${t.accentPrimary}10`, borderRadius: t.radiusTile, border: `1px solid ${t.accentPrimary}20` }}>
            <div className="text-[7px] font-bold" style={{ color: t.textSecondary }}>{l}</div>
            <div className="text-[11px] font-black tabular-nums" style={{ color: t.accentPrimary }}>{v}</div>
            <div className="text-[7px]" style={{ color: `${t.textSecondary}88` }}>{u}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props { vehicleId: string | null }

export const ThemeStudio = memo(function ThemeStudio({ vehicleId }: Props) {
  const tokenRef  = useRef<ThemeToken>(load());
  const [token,   setToken]   = useState<ThemeToken>(() => tokenRef.current);
  const [tab,     setTab]     = useState<StudioTab>('renkler');
  const [sync,    setSync]    = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle');

  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<Record<string, string>>({});
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const patch = useCallback((p: Partial<ThemeToken>) => {
    const next = { ...tokenRef.current, ...p };
    tokenRef.current = next;
    setToken({ ...next });
    save(next);

    if (!vehicleId) return;
    latestRef.current = tokenToVars(next);
    if (timerRef.current) return;
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      if (!mountedRef.current) return;
      setSync('sending');
      const result = await sendCommand(vehicleId, 'theme_change', { themeVars: latestRef.current });
      if (!mountedRef.current) return;
      setSync(result.ok ? 'ok' : 'fail');
      setTimeout(() => { if (mountedRef.current) setSync('idle'); }, 2000);
    }, 150);
  }, [vehicleId]);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    patch(preset);
  }, [patch]);

  const TABS: { id: StudioTab; label: string }[] = [
    { id: 'renkler',  label: 'Renkler'  },
    { id: 'sekiller', label: 'Şekiller' },
    { id: 'efektler', label: 'Efektler' },
    { id: 'yazi',     label: 'Yazı'     },
    { id: 'ikonlar',  label: 'İkonlar'  },
  ];

  const syncColor = sync === 'ok' ? '#34d399' : sync === 'fail' ? '#f87171' : sync === 'sending' ? '#60a5fa' : 'rgba(255,255,255,0.2)';
  const syncLabel = sync === 'ok' ? '✓ Gönderildi' : sync === 'fail' ? '✗ Hata' : sync === 'sending' ? '● Gönderiliyor…' : '● Araca İletiliyor';

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-black text-white">Tema Stüdyo</p>
          <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Her detayı özelleştir · Canlı önizleme</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all"
          style={{
            background: sync !== 'idle' ? `${syncColor}15` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${syncColor}40`,
            color: syncColor,
          }}>
          {!vehicleId ? '⚠ Araç Bağlı Değil' : syncLabel}
        </div>
      </div>

      {/* Live preview */}
      <LivePreview t={token} />

      {/* Base theme row */}
      <div>
        <SectionTitle>Başlangıç Teması</SectionTitle>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button key={key} onClick={() => applyPreset(key)}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-all active:scale-90"
              style={{
                background: token.baseTheme === key ? `${preset.accentPrimary}18` : 'rgba(255,255,255,0.04)',
                border: `1.5px solid ${token.baseTheme === key ? `${preset.accentPrimary}60` : 'rgba(255,255,255,0.08)'}`,
              }}>
              <div className="w-4 h-4 rounded-full" style={{
                background: preset.accentPrimary,
                boxShadow: token.baseTheme === key ? `0 0 8px ${preset.accentPrimary}` : 'none',
              }} />
              <span className="text-[8px] font-black uppercase tracking-widest" style={{
                color: token.baseTheme === key ? preset.accentPrimary : 'rgba(255,255,255,0.3)',
              }}>
                {preset.name}
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
      <div className="flex flex-col gap-5 pb-4">

        {/* ── RENKLER ─────────────────────────────────────────────────────────── */}
        {tab === 'renkler' && (
          <>
            <ColorPicker label="Ana Vurgu Rengi" value={token.accentPrimary}
              presets={ACCENT_COLORS}
              onChange={(v) => patch({ accentPrimary: v })} />
            <ColorPicker label="İkincil Vurgu" value={token.accentSecondary}
              presets={ACCENT_COLORS}
              onChange={(v) => patch({ accentSecondary: v })} />
            <ColorPicker label="Arka Plan" value={token.bgPrimary}
              presets={BG_COLORS}
              onChange={(v) => patch({ bgPrimary: v })} />
            <ColorPicker label="Kart Arkaplanı" value={token.bgCard}
              onChange={(v) => patch({ bgCard: v })} />
            <ColorPicker label="Ana Metin" value={token.textPrimary}
              presets={['#FFFFFF','#F5F0E8','#EDE8E0','#E8F4FF','#CCCCCC']}
              onChange={(v) => patch({ textPrimary: v })} />
            <ColorPicker label="İkincil Metin" value={token.textSecondary}
              presets={['#888888','#9EA3AE','#B8A89A','#5A7A9A','#8A7A5E','#606060']}
              onChange={(v) => patch({ textSecondary: v })} />
            <ColorPicker label="Kenarlık Rengi" value={token.borderColor}
              onChange={(v) => patch({ borderColor: v })} />
            <ColorPicker label="Parlaklık / Glow" value={token.glowColor}
              onChange={(v) => patch({ glowColor: v })} />
          </>
        )}

        {/* ── ŞEKİLLER ─────────────────────────────────────────────────────────── */}
        {tab === 'sekiller' && (
          <>
            <div className="p-3 rounded-2xl flex flex-col gap-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <SectionTitle>Köşe Yuvarlaklığı</SectionTitle>
              <Slider label="Kart"         value={token.radiusCard} min={0} max={40} unit="px" onChange={(v) => patch({ radiusCard: v })} />
              <Slider label="Buton"        value={token.radiusBtn}  min={0} max={28} unit="px" onChange={(v) => patch({ radiusBtn: v })} />
              <Slider label="Kutucuk"      value={token.radiusTile} min={0} max={32} unit="px" onChange={(v) => patch({ radiusTile: v })} />
              <Slider label="Dock"         value={token.radiusDock} min={0} max={24} unit="px" onChange={(v) => patch({ radiusDock: v })} />
            </div>
            <div>
              <SectionTitle>Hızlı Şekil Profili</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Keskin',   icon: '▭', r: { radiusCard: 2,  radiusBtn: 2,  radiusTile: 2,  radiusDock: 0  } },
                  { label: 'Modern',   icon: '▢', r: { radiusCard: 12, radiusBtn: 8,  radiusTile: 10, radiusDock: 4  } },
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

        {/* ── EFEKTLER ─────────────────────────────────────────────────────────── */}
        {tab === 'efektler' && (
          <div className="flex flex-col gap-5">
            <div className="p-3 rounded-2xl flex flex-col gap-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <SectionTitle>Cam / Blur Efekti</SectionTitle>
              <Slider label="Bulanıklık"         value={token.cardBlurPx}    min={0} max={40} unit="px" onChange={(v) => patch({ cardBlurPx: v })} />
              <Slider label="Parlaklık Yoğunluğu" value={token.glowIntensity} min={0} max={100} unit="%" onChange={(v) => patch({ glowIntensity: v })} />
            </div>
            <div>
              <SectionTitle>Hızlı Efekt Profili</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'OLED\nSıfır',    blur: 0,  glow: 100 },
                  { label: 'Glass\nOrta',    blur: 20, glow: 50  },
                  { label: 'Frosted\nYüksek',blur: 40, glow: 30  },
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

        {/* ── YAZI ─────────────────────────────────────────────────────────────── */}
        {tab === 'yazi' && (
          <>
            <div>
              <SectionTitle>Yazı Tipi</SectionTitle>
              <div className="flex flex-col gap-2">
                {FONTS.map(({ id, label }) => (
                  <button key={id} onClick={() => patch({ fontFamily: id })}
                    className="flex items-center justify-between px-3 py-3 rounded-xl transition-all active:scale-[0.98]"
                    style={{
                      background: token.fontFamily === id ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1.5px solid ${token.fontFamily === id ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.07)'}`,
                    }}>
                    <span className="text-xs text-white/60">{label}</span>
                    <span className="text-sm" style={{
                      fontFamily: FONT_CSS[id],
                      color: token.fontFamily === id ? '#60a5fa' : 'rgba(255,255,255,0.3)',
                    }}>
                      CAROS
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 rounded-2xl flex flex-col gap-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <SectionTitle>Yazı Ayarları</SectionTitle>
              <Slider label="Kalınlık"     value={token.fontWeight}    min={400} max={900} step={100} unit=""   onChange={(v) => patch({ fontWeight: v })} />
              <Slider label="Harf Aralığı" value={token.letterSpacing} min={0}   max={6}   step={0.5} unit="px" onChange={(v) => patch({ letterSpacing: v })} />
            </div>
          </>
        )}

        {/* ── İKONLAR ──────────────────────────────────────────────────────────── */}
        {tab === 'ikonlar' && (
          <>
            <button onClick={() => patch({ iconNav: token.accentPrimary, iconMedia: token.accentPrimary, iconDock: token.accentPrimary })}
              className="w-full py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-[0.97]"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
              Tümünü Ana Renge Eşitle
            </button>
            <ColorPicker label="Navigasyon İkonları" value={token.iconNav}   presets={ACCENT_COLORS} onChange={(v) => patch({ iconNav: v })} />
            <ColorPicker label="Medya İkonları"      value={token.iconMedia} presets={ACCENT_COLORS} onChange={(v) => patch({ iconMedia: v })} />
            <ColorPicker label="Dock İkonları"       value={token.iconDock}  presets={ACCENT_COLORS} onChange={(v) => patch({ iconDock: v })} />
            <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <SectionTitle>İkon Önizlemesi</SectionTitle>
              <div className="flex items-center justify-around py-2">
                {[
                  { color: token.iconNav,   label: 'Nav',   path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z' },
                  { color: token.iconMedia, label: 'Medya', path: 'M9 18V6l12-3v12' },
                  { color: token.iconDock,  label: 'Dock',  path: 'M3 3h7v4H3zM14 3h7v8h-7zM3 10h7v11H3zM14 14h7v6h-7z' },
                ].map(({ color, label, path }) => (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                      style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <span className="text-[8px] font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
