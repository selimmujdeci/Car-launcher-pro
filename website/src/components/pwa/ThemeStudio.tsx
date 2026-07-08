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

// Hex → "r, g, b" (araç tarafında rgba(var(--accent-rgb), a) ile alfa üretmek için).
// Geçersiz/eksik hex'te fail-soft: nötr gri döner (BOŞ STRİNG DÖNME — CSS custom
// property set edilip boş bırakılırsa var(--x, fallback) fallback'i DEVREYE GİRMEZ,
// rgba() geçersiz olur ve tüm stil çöker; bu yüzden her zaman geçerli bir triplet).
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return '128, 128, 128';
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

function tokenToVars(t: ThemeToken): Record<string, string> {
  return {
    '--accent-primary':      t.accentPrimary,
    '--accent-rgb':          hexToRgb(t.accentPrimary),
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

// ── Gerçek uygulama önizlemesi (iframe) ──────────────────────────────────────
// Sahte maket yerine GERÇEK araç uygulaması (car-launcher-pro) iframe'e gömülür;
// kullanıcı renk/şekil/font değiştirdikçe postMessage ile CANLI tema uygulanır
// (birebir önizleme). Uygulama demo modunda ana ekranı gösterir; iframe içindeki
// themePreviewBridge 'caros-preview-ready' der, biz temayı yollarız.
const PREVIEW_URL    = 'https://car-launcher-pro.vercel.app/';
const PREVIEW_ORIGIN = 'https://car-launcher-pro.vercel.app';
const PREVIEW_W = 1180;   // araç ekranı mantıksal genişliği (ölçeklenir)
const PREVIEW_H = 720;


// ── Main ──────────────────────────────────────────────────────────────────────

interface Props { vehicleId: string | null }

export const ThemeStudio = memo(function ThemeStudio({ vehicleId }: Props) {
  const tokenRef  = useRef<ThemeToken>(load());
  const [token,   setToken]   = useState<ThemeToken>(() => tokenRef.current);
  const [tab,     setTab]     = useState<StudioTab>('renkler');
  const [sync,    setSync]    = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle');

  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Gerçek uygulama iframe önizlemesi (canlı tema postMessage ile)
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  const postPreview = useCallback((t: ThemeToken) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'caros-theme-preview', vars: tokenToVars(t) }, PREVIEW_ORIGIN,
      );
    } catch { /* ignore */ }
  }, []);

  // iframe'i PWA kutusuna sığdır (araç ekranını ölçekle)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const compute = () => setScale(el.clientWidth / PREVIEW_W);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // iframe içindeki köprü "hazır" derse mevcut temayı yolla
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin === PREVIEW_ORIGIN && (e.data as { type?: string })?.type === 'caros-preview-ready') {
        postPreview(tokenRef.current);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [postPreview]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const patch = useCallback((p: Partial<ThemeToken>) => {
    const next = { ...tokenRef.current, ...p };
    tokenRef.current = next;
    setToken({ ...next });
    save(next);
    // YALNIZ iframe önizlemesine yansıt — araca DOKUNMA. Araç ancak
    // kullanıcı "Araca Gönder" deyince değişir (sendToVehicle).
    postPreview(next);
  }, [postPreview]);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    patch(preset);
  }, [patch]);

  // Araca Gönder — mevcut temayı gerçek araca uygula (theme_change)
  const sendToVehicle = useCallback(async () => {
    if (!vehicleId) return;
    setSync('sending');
    const r = await sendCommand(vehicleId, 'theme_change', { themeVars: tokenToVars(tokenRef.current) });
    setSync(r.ok ? 'ok' : 'fail');
    setTimeout(() => { if (mountedRef.current) setSync('idle'); }, 2000);
  }, [vehicleId]);

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
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--pwa-text-3)' }}>Gerçek ekran · canlı önizleme · aşağıdan renk &amp; şekil ver</p>
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

        {/* GERÇEK uygulama iframe önizlemesi — birebir, canlı tema (postMessage) */}
        <div ref={wrapRef} style={{ position: 'relative', width: '100%', aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}`, overflow: 'hidden', borderRadius: 14, border: '1px solid var(--pwa-border)', background: '#000' }}>
          <iframe
            ref={iframeRef}
            src={PREVIEW_URL}
            title="Araç ekranı canlı önizleme"
            onLoad={() => setTimeout(() => postPreview(tokenRef.current), 400)}
            style={{ position: 'absolute', top: 0, left: 0, width: PREVIEW_W, height: PREVIEW_H, border: 0, transformOrigin: 'top left', transform: `scale(${scale})`, colorScheme: 'normal' }}
          />
          <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.4)', borderRadius: 5, padding: '2px 6px', pointerEvents: 'none' }}>
            CANLI ÖNİZLEME
          </span>
        </div>

        {/* Araca Gönder + Sıfırla */}
        <div className="flex gap-2 mt-2.5">
          <button onClick={() => patch(PRESETS.pro)}
            className="text-[11px] font-bold px-3 py-2.5 rounded-xl"
            style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}>
            Sıfırla
          </button>
          <button onClick={sendToVehicle} disabled={!vehicleId || sync === 'sending'}
            className="flex-1 text-[12px] font-black uppercase tracking-wider px-3 py-2.5 rounded-xl transition-all active:scale-[0.98]"
            style={{ background: `${syncColor}18`, border: `1.5px solid ${syncColor}55`, color: syncColor, opacity: vehicleId ? 1 : 0.5 }}>
            {!vehicleId ? '⚠ Araç Bağlı Değil' : sync === 'ok' ? '✓ Araca Gönderildi' : sync === 'sending' ? '● Gönderiliyor…' : 'Araca Gönder'}
          </button>
        </div>
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
