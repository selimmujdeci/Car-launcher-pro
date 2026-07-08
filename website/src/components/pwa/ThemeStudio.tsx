'use client';

import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { sendCommand } from '@/lib/commandService';
import {
  PRO_MANIFEST, GROW_BY_SIZE, defaultIntent, normalizeIntent, solveLayout,
  type LayoutIntent, type Zone, type ManifestEntry,
} from '@/lib/layoutSolver';

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
      style={{ color: 'var(--pwa-text-3)' }}>
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
        <span className="text-[10px] font-semibold" style={{ color: 'var(--pwa-text-2)' }}>{label}</span>
        <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--pwa-text-2)' }}>
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
        <span className="text-[10px] font-semibold" style={{ color: 'var(--pwa-text-2)' }}>{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono" style={{ color: 'var(--pwa-text-3)' }}>{value}</span>
          <label className="relative cursor-pointer">
            <div className="w-7 h-7 rounded-lg border-2 overflow-hidden"
              style={{ borderColor: 'var(--pwa-border)', backgroundColor: value }}>
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
                border: value === c ? '2px solid white' : '1.5px solid var(--pwa-border)',
                boxShadow: value === c ? `0 0 8px ${c}80` : 'none',
              }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Yerleşim Stüdyo (Faz 2) — gerçek minyatür + sürükle/boyut + Araca Gönder ──

const LAYOUT_LS_KEY = 'caros-theme-layout';

const MANIFEST_MAP: Record<string, ManifestEntry> = {};
PRO_MANIFEST.forEach((m) => { MANIFEST_MAP[m.id] = m; });

const RAIL_ZONES: Zone[] = ['left-rail', 'center-stage', 'right-rail'];
const ZONE_STYLE: Record<Zone, React.CSSProperties> = {
  'left-rail': { width: '22%' }, 'center-stage': { flex: 1 }, 'right-rail': { width: '32%' }, 'dock': {},
};

function loadLayout(): LayoutIntent {
  try { const raw = localStorage.getItem(LAYOUT_LS_KEY); if (raw) return normalizeIntent(JSON.parse(raw)); } catch { /* ignore */ }
  return defaultIntent();
}
function saveLayout(l: LayoutIntent) { try { localStorage.setItem(LAYOUT_LS_KEY, JSON.stringify(l)); } catch { /* ignore */ } }

// Dock çizgi ikonları (gerçek DockBar dili — emoji değil). stroke=currentColor.
const DOCK_ICONS: React.ReactNode[] = [
  <><path d="M9 3L3 5v16l6-2 6 2 6-2V3l-6 2-6-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 3v16M15 5v16" stroke="currentColor" strokeWidth="1.8" /></>,
  <><path d="M9 18V5l12-2v11" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" /><circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.8" /></>,
  <><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
  <path d="M5 4h3.5l1.8 4.5-2.3 1.5a11 11 0 005 5l1.5-2.3L20 15.5V19a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M14 21a2 2 0 01-4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  <><path d="M5 11l2-5h10l2 5M3 11h18v5H4a1 1 0 01-1-1v-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M7 16v2M17 16v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
  <path d="M12 12c2-4-1-7-1-9 4 1 6 4 5 7M12 12c4 2 7-1 9-1-1 4-4 6-7 5M12 12c-2 4 1 7 1 9-4-1-6-4-5-7M12 12c-4-2-7 1-9 1 1-4 4-6 7-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  <><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /></>,
];

function MiniTileInner({ id, t }: { id: string; t: ThemeToken }) {
  const acc = t.accentPrimary, ink = t.textPrimary, ink2 = t.textSecondary;
  const tile = `${ink2}22`;
  const chip = (txt: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: tile, color: ink2, borderRadius: 5, padding: '1px 5px', fontSize: 7, fontWeight: 600, width: 'fit-content' }}>{txt}</span>
  );
  switch (id) {
    // Saat — gerçek ClockCard: büyük saat + tarih (etiketsiz)
    case 'clock':
      return (<>
        <span style={{ fontSize: 21, fontWeight: 800, color: ink, lineHeight: 1, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>12:16</span>
        <span style={{ fontSize: 8, fontWeight: 500, color: ink2, marginTop: 3 }}>Salı, 7 Tem</span>
      </>);
    // Sürüş — gerçek GaugeCard imzası: 270° hız halkası + ortada hız + D chip
    case 'gauge': {
      const R = 15, cx = 18, cy = 18, START = 135, SPAN = 270, pct = 0.36;
      const rad = (d: number) => (d * Math.PI) / 180;
      const pt = (a: number) => `${(cx + R * Math.cos(rad(a))).toFixed(2)} ${(cy + R * Math.sin(rad(a))).toFixed(2)}`;
      const arcP = (a1: number, a2: number) => `M${pt(a1)} A${R} ${R} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${pt(a2)}`;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
          <div style={{ position: 'relative', width: 36, height: 36 }}>
            <svg viewBox="0 0 36 36" width="36" height="36" style={{ overflow: 'visible' }}>
              <path d={arcP(START, START + SPAN)} fill="none" stroke={tile} strokeWidth="3.5" strokeLinecap="round" />
              <path d={arcP(START, START + pct * SPAN)} fill="none" stroke={acc} strokeWidth="3.5" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${acc})` }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>72</span>
              <span style={{ fontSize: 4, fontWeight: 700, letterSpacing: '0.15em', color: ink2, marginTop: 1 }}>KM/S</span>
            </div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: tile, borderRadius: 5, padding: '1px 5px', fontSize: 7, fontWeight: 600, color: ink2 }}>
            <span style={{ color: acc, fontWeight: 800 }}>D</span>320 km
          </span>
        </div>
      );
    }
    // Ayarlar — gerçek SettingsCard: dişli ikon karesi + başlık + alt satır
    case 'settings':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%' }}>
          <div style={{ width: 22, height: 22, borderRadius: 7, background: tile, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ color: ink2 }}>
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: ink, lineHeight: 1 }}>Ayarlar</div>
            <div style={{ fontSize: 7, color: ink2, marginTop: 2 }}>Sistem · Tema</div>
          </div>
        </div>
      );
    // Harita — gerçek NavCard: harita tuvali (yollar + rota + pin + dönüş kartı)
    case 'nav':
      return (
        <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 30, borderRadius: 7, overflow: 'hidden' }}>
          <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <rect width="100" height="60" fill={`${ink2}10`} />
            <path d="M8 60 L22 32 L52 22" fill="none" stroke={ink2} strokeWidth="1" opacity="0.35" />
            <path d="M58 60 L72 38 L100 32" fill="none" stroke={ink2} strokeWidth="1" opacity="0.35" />
            <path d="M-5 46 Q28 42 44 26 T105 10" fill="none" stroke={acc} strokeWidth="3.2" strokeLinecap="round" />
          </svg>
          <div style={{ position: 'absolute', left: '42%', top: '34%', width: 7, height: 7, borderRadius: '50% 50% 50% 0', background: acc, transform: 'rotate(-45deg)', boxShadow: `0 0 4px ${acc}` }} />
          <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 7, fontWeight: 600, color: ink, background: t.bgCard, borderRadius: 4, padding: '1px 4px' }}>↱ 2.4 km · Sahil Yolu</span>
        </div>
      );
    // Müzik — albüm + EQ çubukları (gerçek mini medya)
    case 'music':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg,#7c3aed,#db2777)', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 10 }}>
              {[0.5, 0.9, 0.6, 1].map((s, i) => (<div key={i} style={{ width: 2, height: `${s * 100}%`, background: '#fff', borderRadius: 1, opacity: 0.9 }} />))}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: ink, lineHeight: 1 }}>Çalmıyor</div>
            <div style={{ fontSize: 7, color: ink2, marginTop: 2 }}>Medya</div>
          </div>
        </div>
      );
    // Araç Durumu — durum + batarya/menzil chip'leri
    case 'vehicle':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          <span style={{ fontSize: 6, letterSpacing: '0.14em', color: ink2, textTransform: 'uppercase' }}>Araç Durumu</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#34d399', lineHeight: 1 }}>Normal</span>
          <div style={{ display: 'flex', gap: 4 }}>{chip('🔋 78%')}{chip('320 km')}</div>
        </div>
      );
    default: return null;
  }
}

function LayoutStudio({ token, vehicleId }: { token: ThemeToken; vehicleId: string | null }) {
  const [intent, setIntent] = useState<LayoutIntent>(() => loadLayout());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [sync, setSync] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle');
  const dragRef = useRef<{ id: string; zone: Zone } | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startY: number; base: number } | null>(null);
  // Basılı-tut → boyutlandır: parmak ~300ms sabit kalırsa resize moduna geç;
  // eşik üstü hareket önce olursa sürükle (sırala) moduna düşer.
  const pressRef = useRef<{ id: string; zone: Zone; startX: number; startY: number; base: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  const solved = useMemo(() => solveLayout(intent), [intent]);
  const commit = useCallback((next: LayoutIntent) => { setIntent(next); saveLayout(next); }, []);
  const clearPress = () => { if (pressRef.current) { clearTimeout(pressRef.current.timer); pressRef.current = null; } };

  // Global pointer takibi — sürükle (zone içi sırala) + basılı-tut/köşe-çek (boyut). Refs → bayat closure yok.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const rz = resizeRef.current;
      if (rz) {
        const d = ((e.clientX - rz.startX) + (e.clientY - rz.startY)) / 60;
        const g = Math.max(0.5, Math.min(5, rz.base + d));
        setIntent((prev) => { const n = { ...prev, [rz.id]: { ...prev[rz.id], growCustom: g } }; saveLayout(n); return n; });
        return;
      }
      const pr = pressRef.current;
      if (pr) {
        // Eşiği aşan hareket → basılı-tut iptal, sürükle (sırala) başlat.
        if (Math.abs(e.clientX - pr.startX) > 8 || Math.abs(e.clientY - pr.startY) > 8) {
          clearTimeout(pr.timer);
          dragRef.current = { id: pr.id, zone: pr.zone };
          setDraggingId(pr.id);
          pressRef.current = null;
        }
      }
      const dg = dragRef.current;
      if (!dg) return;
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const overEl = under?.closest('[data-card]') as HTMLElement | null;
      const overId = overEl?.getAttribute('data-card');
      if (!overId || overId === dg.id) return;
      const om = MANIFEST_MAP[overId];
      if (!om || om.zone !== dg.zone) return;
      setIntent((prev) => {
        const a = prev[dg.id].ord, b = prev[overId].ord;
        const n = { ...prev, [dg.id]: { ...prev[dg.id], ord: b }, [overId]: { ...prev[overId], ord: a } };
        saveLayout(n); return n;
      });
    };
    const up = () => { clearPress(); dragRef.current = null; resizeRef.current = null; setDraggingId(null); setResizingId(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const onCardDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if ((e.target as HTMLElement).closest('[data-resize]')) return;
    const m = MANIFEST_MAP[id]; if (!m || m.zone === 'dock') return;
    const c = intent[id];
    const base = c.growCustom != null ? c.growCustom : GROW_BY_SIZE[c.size];
    const startX = e.clientX, startY = e.clientY;
    const timer = setTimeout(() => {
      // Sabit basılı tutuldu → boyutlandır moduna gir (aynı parmak hareketiyle boyut değişir).
      resizeRef.current = { id, startX, startY, base };
      setResizingId(id);
      pressRef.current = null;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(15); } catch { /* yoksa yok */ } }
    }, 300);
    pressRef.current = { id, zone: m.zone, startX, startY, base, timer };
  };
  const onResizeDown = (e: React.PointerEvent<HTMLSpanElement>, id: string) => {
    e.stopPropagation();
    const c = intent[id];
    resizeRef.current = { id, startX: e.clientX, startY: e.clientY, base: c.growCustom != null ? c.growCustom : GROW_BY_SIZE[c.size] };
    setResizingId(id);
  };

  const send = async () => {
    if (!vehicleId) return;
    setSync('sending');
    const res = await sendCommand(vehicleId, 'layout_change', { layout: intent });
    setSync(res.ok ? 'ok' : 'fail');
    setTimeout(() => setSync('idle'), 2000);
  };

  const cardStyle = (id: string, grow: number): React.CSSProperties => ({
    flexGrow: grow, flexBasis: 0, minHeight: 26, position: 'relative', overflow: 'hidden',
    display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: '7px 9px',
    borderRadius: Math.min(token.radiusTile + 4, 14), background: token.bgCard,
    border: `1px solid ${token.borderColor}`, color: token.textPrimary,
    cursor: MANIFEST_MAP[id].zone === 'dock' ? 'default' : 'grab', touchAction: 'none', userSelect: 'none',
    boxShadow: draggingId === id ? '0 10px 24px rgba(0,0,0,0.5)'
      : resizingId === id ? `0 0 0 2px ${token.accentPrimary}, 0 6px 18px rgba(0,0,0,0.4)` : 'none',
    transform: draggingId === id ? 'scale(1.03)' : resizingId === id ? 'scale(1.01)' : 'none',
    transition: 'flex-grow .45s cubic-bezier(.34,1.2,.64,1), box-shadow .2s, transform .15s',
  });

  const sendColor = sync === 'ok' ? '#34d399' : sync === 'fail' ? '#f87171' : sync === 'sending' ? '#60a5fa' : token.accentPrimary;
  const sendLabel = sync === 'ok' ? '✓ Araca gönderildi' : sync === 'fail' ? '✗ Gönderilemedi' : sync === 'sending' ? '● Gönderiliyor…' : 'Araca Gönder';

  return (
    <div className="flex flex-col gap-3">
      {/* Minyatür — token renkleriyle canlı; kartları elle çek/boyutlandır */}
      <div style={{ background: token.bgPrimary, border: `1px solid ${token.borderColor}`, borderRadius: token.radiusCard, padding: 10, aspectRatio: '16 / 8', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 7 }}>
          {RAIL_ZONES.map((z) => (
            <div key={z} style={{ ...ZONE_STYLE[z], display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
              {solved[z].items.map((it) => (
                <div key={it.id} data-card={it.id} onPointerDown={(e) => onCardDown(e, it.id)} style={cardStyle(it.id, it.grow)}>
                  {MANIFEST_MAP[it.id].locked && <span style={{ position: 'absolute', top: 5, right: 6, fontSize: 8, color: token.accentPrimary }}>🔒</span>}
                  <MiniTileInner id={it.id} t={token} />
                  <span data-resize={it.id} onPointerDown={(e) => onResizeDown(e, it.id)} style={{ position: 'absolute', right: 2, bottom: 2, width: 15, height: 15, display: 'grid', placeItems: 'center', cursor: 'nwse-resize', color: token.textSecondary, fontSize: 10, touchAction: 'none' }}>⤡</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Dock — kilitli chrome (gerçek DockBar: çizgi ikonlar, dock-ikon rengi) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', background: token.bgCard, border: `1px solid ${token.borderColor}`, borderRadius: Math.min(token.radiusDock + 6, 12), overflow: 'hidden' }}>
          {DOCK_ICONS.map((icon, i) => (
            <div key={i} style={{ width: 22, height: 22, borderRadius: 7, background: `${token.iconDock}1f`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ color: token.iconDock }}>{icon}</svg>
            </div>
          ))}
          <span style={{ marginLeft: 'auto', display: 'grid', placeItems: 'center', color: token.accentPrimary }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </span>
        </div>
      </div>

      <p className="text-[9px] font-mono" style={{ color: 'var(--pwa-text-3)' }}>⠿ tut-sürükle · basılı tut ↔ boyutlandır (ya da ⤡ köşe)</p>

      {/* Araca Gönder (commit) + Sıfırla */}
      <div className="flex gap-2">
        <button onClick={() => commit(defaultIntent())} className="text-[11px] font-bold px-3 py-2.5 rounded-xl"
          style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}>
          Sıfırla
        </button>
        <button onClick={send} disabled={!vehicleId || sync === 'sending'}
          className="flex-1 text-[12px] font-black uppercase tracking-wider px-3 py-2.5 rounded-xl transition-all active:scale-[0.98]"
          style={{ background: `${sendColor}18`, border: `1.5px solid ${sendColor}55`, color: sendColor, opacity: vehicleId ? 1 : 0.5 }}>
          {!vehicleId ? '⚠ Araç Bağlı Değil' : sendLabel}
        </button>
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

  const syncColor = sync === 'ok' ? '#34d399' : sync === 'fail' ? '#f87171' : sync === 'sending' ? '#60a5fa' : 'var(--pwa-text-3)';
  const syncLabel = sync === 'ok' ? '✓ Gönderildi' : sync === 'fail' ? '✗ Hata' : sync === 'sending' ? '● Gönderiliyor…' : '● Araca İletiliyor';

  return (
    <div className="flex flex-col">

      {/* ── SABİT ÜST: başlık + CANLI MAKET + Araca Gönder — ayarlar altında kayarken sabit kalır ── */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          marginTop: -20, paddingTop: 16, paddingBottom: 12, marginBottom: 4,
          background: 'var(--pwa-panel)',
          borderBottom: '1px solid var(--pwa-border-soft)',
          boxShadow: '0 14px 22px -12px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-black pwa-text">Tema Stüdyo</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--pwa-text-3)' }}>Maket sabit · aşağıdan renk &amp; şekil ver</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all"
            style={{
              background: sync !== 'idle' ? `${syncColor}15` : 'var(--pwa-surface)',
              border: `1px solid ${syncColor}40`,
              color: syncColor,
            }}>
            {!vehicleId ? '⚠ Araç Bağlı Değil' : syncLabel}
          </div>
        </div>

        {/* Canlı maket — kartları elle sürükle / basılı tutup boyutlandır + Araca Gönder */}
        <LayoutStudio token={token} vehicleId={vehicleId} />
      </div>

      {/* ── KAYAN AYARLAR (renk / şekil / efekt / yazı / ikon) ── */}
      <div className="flex flex-col gap-4 pt-4">

      {/* Base theme row */}
      <div>
        <SectionTitle>Başlangıç Teması</SectionTitle>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button key={key} onClick={() => applyPreset(key)}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-all active:scale-90"
              style={{
                background: token.baseTheme === key ? `${preset.accentPrimary}18` : 'var(--pwa-surface)',
                border: `1.5px solid ${token.baseTheme === key ? `${preset.accentPrimary}60` : 'var(--pwa-border)'}`,
              }}>
              <div className="w-4 h-4 rounded-full" style={{
                background: preset.accentPrimary,
                boxShadow: token.baseTheme === key ? `0 0 8px ${preset.accentPrimary}` : 'none',
              }} />
              <span className="text-[8px] font-black uppercase tracking-widest" style={{
                color: token.baseTheme === key ? preset.accentPrimary : 'var(--pwa-text-3)',
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
              background: tab === id ? 'rgba(59,130,246,0.2)' : 'var(--pwa-surface)',
              color:       tab === id ? '#60a5fa' : 'var(--pwa-text-3)',
              border:      `1px solid ${tab === id ? 'rgba(59,130,246,0.4)' : 'var(--pwa-border-soft)'}`,
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
              style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
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
                    style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)' }}>
                    <span className="text-xl">{icon}</span>
                    <span className="text-[9px] font-bold pwa-text-2">{label}</span>
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
              style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
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
                    style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)' }}>
                    <span className="text-[9px] font-bold pwa-text-2 text-center leading-snug whitespace-pre-line">{label}</span>
                    <span className="text-[8px] pwa-text-3">{blur}px / %{glow}</span>
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
                      background: token.fontFamily === id ? 'rgba(59,130,246,0.12)' : 'var(--pwa-surface)',
                      border: `1.5px solid ${token.fontFamily === id ? 'rgba(59,130,246,0.4)' : 'var(--pwa-border-soft)'}`,
                    }}>
                    <span className="text-xs pwa-text-2">{label}</span>
                    <span className="text-sm" style={{
                      fontFamily: FONT_CSS[id],
                      color: token.fontFamily === id ? '#60a5fa' : 'var(--pwa-text-3)',
                    }}>
                      CAROS
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 rounded-2xl flex flex-col gap-4"
              style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
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
              style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}>
              Tümünü Ana Renge Eşitle
            </button>
            <ColorPicker label="Navigasyon İkonları" value={token.iconNav}   presets={ACCENT_COLORS} onChange={(v) => patch({ iconNav: v })} />
            <ColorPicker label="Medya İkonları"      value={token.iconMedia} presets={ACCENT_COLORS} onChange={(v) => patch({ iconMedia: v })} />
            <ColorPicker label="Dock İkonları"       value={token.iconDock}  presets={ACCENT_COLORS} onChange={(v) => patch({ iconDock: v })} />
            <div className="p-3 rounded-2xl" style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
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
                    <span className="text-[8px] font-bold" style={{ color: 'var(--pwa-text-3)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
});
