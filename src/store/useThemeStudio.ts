import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BaseTheme } from './useCarTheme';

// ── Token definitions ─────────────────────────────────────────────────────────

export interface ThemeToken {
  name:            string;
  baseTheme:       BaseTheme;

  // Colors
  accentPrimary:   string;
  accentSecondary: string;
  bgPrimary:       string;
  bgCard:          string;
  textPrimary:     string;
  textSecondary:   string;
  borderColor:     string;
  glowColor:       string;

  // Shapes (px value, stored as number)
  radiusCard:  number;
  radiusBtn:   number;
  radiusTile:  number;
  radiusDock:  number;

  // Effects
  cardBlurPx:    number;   // 0–40
  glowIntensity: number;   // 0–100

  // Typography
  fontFamily:    string;   // 'system' | 'orbitron' | 'rajdhani' | 'exo2' | 'sharetech'
  fontWeight:    number;   // 400–900
  letterSpacing: number;   // 0–5 px

  // Icon tints
  iconNav:   string;
  iconMedia: string;
  iconDock:  string;
}

export interface SavedSlot extends ThemeToken {
  id:      string;
  savedAt: number;
}

// ── Base theme presets (starting-point tokens) ───────────────────────────────

const PRESETS: Record<BaseTheme, Omit<ThemeToken, 'name'>> = {
  pro: {
    baseTheme: 'pro',
    accentPrimary:   '#D4AF37',
    accentSecondary: '#C0392B',
    bgPrimary:       '#1C1C2E',
    bgCard:          'rgba(35,35,58,0.96)',
    textPrimary:     '#F5F0E8',
    textSecondary:   '#B8A89A',
    borderColor:     'rgba(212,175,55,0.30)',
    glowColor:       'rgba(212,175,55,0.25)',
    radiusCard:  18, radiusBtn:  4, radiusTile:  4, radiusDock:  0,
    cardBlurPx:    16, glowIntensity: 60,
    fontFamily: 'orbitron', fontWeight: 900, letterSpacing: 2,
    iconNav:   '#D4AF37', iconMedia: '#2ECC71', iconDock: '#D4AF37',
  },
  tesla: {
    baseTheme: 'tesla',
    accentPrimary:   '#E31937',
    accentSecondary: '#FFFFFF',
    bgPrimary:       '#141414',
    bgCard:          'rgba(20,20,20,0.95)',
    textPrimary:     '#FFFFFF',
    textSecondary:   '#9EA3AE',
    borderColor:     'rgba(227,25,55,0.25)',
    glowColor:       'rgba(227,25,55,0.15)',
    radiusCard:  12, radiusBtn:  6, radiusTile:  8, radiusDock:  0,
    cardBlurPx:    20, glowIntensity: 40,
    fontFamily: 'system', fontWeight: 400, letterSpacing: 0,
    iconNav:   '#E31937', iconMedia: '#FFFFFF', iconDock: '#E31937',
  },
  cockpit: {
    baseTheme: 'cockpit',
    accentPrimary:   '#00D4FF',
    accentSecondary: '#0050FF',
    bgPrimary:       '#05080E',
    bgCard:          'rgba(5,15,30,0.90)',
    textPrimary:     '#E8F4FF',
    textSecondary:   '#5A7A9A',
    borderColor:     'rgba(0,212,255,0.25)',
    glowColor:       'rgba(0,212,255,0.20)',
    radiusCard:  20, radiusBtn:  10, radiusTile:  16, radiusDock:  16,
    cardBlurPx:    28, glowIntensity: 80,
    fontFamily: 'exo2', fontWeight: 700, letterSpacing: 1,
    iconNav:   '#00D4FF', iconMedia: '#00D4FF', iconDock: '#00D4FF',
  },
  mercedes: {
    baseTheme: 'mercedes',
    accentPrimary:   '#C8A96E',
    accentSecondary: '#8A7A5E',
    bgPrimary:       '#080606',
    bgCard:          'rgba(15,12,10,0.95)',
    textPrimary:     '#EDE8E0',
    textSecondary:   '#8A7E72',
    borderColor:     'rgba(200,169,110,0.28)',
    glowColor:       'rgba(200,169,110,0.15)',
    radiusCard:  6, radiusBtn:  6, radiusTile:  6, radiusDock:  0,
    cardBlurPx:    12, glowIntensity: 30,
    fontFamily: 'rajdhani', fontWeight: 600, letterSpacing: 3,
    iconNav:   '#C8A96E', iconMedia: '#C8A96E', iconDock: '#C8A96E',
  },
  audi: {
    baseTheme: 'audi',
    accentPrimary:   '#CC0000',
    accentSecondary: '#FFFFFF',
    bgPrimary:       '#0A0A0A',
    bgCard:          'rgba(12,12,12,0.96)',
    textPrimary:     '#FFFFFF',
    textSecondary:   '#888888',
    borderColor:     'rgba(204,0,0,0.30)',
    glowColor:       'rgba(204,0,0,0.20)',
    radiusCard:  2, radiusBtn:  2, radiusTile:  2, radiusDock:  0,
    cardBlurPx:    8, glowIntensity: 45,
    fontFamily: 'system', fontWeight: 700, letterSpacing: 4,
    iconNav:   '#CC0000', iconMedia: '#FFFFFF', iconDock: '#CC0000',
  },
  oled: {
    baseTheme: 'oled',
    accentPrimary:   '#00E5FF',
    accentSecondary: '#FF1744',
    bgPrimary:       '#000000',
    bgCard:          'rgba(0,0,0,0.99)',
    textPrimary:     '#FFFFFF',
    textSecondary:   '#606060',
    borderColor:     'rgba(0,229,255,0.30)',
    glowColor:       'rgba(0,229,255,0.20)',
    radiusCard:  16, radiusBtn:  8, radiusTile:  12, radiusDock:  0,
    cardBlurPx:    0, glowIntensity: 90,
    fontFamily: 'sharetech', fontWeight: 400, letterSpacing: 1,
    iconNav:   '#00E5FF', iconMedia: '#00E5FF', iconDock: '#00E5FF',
  },
};

export function getPreset(base: BaseTheme): ThemeToken {
  return { name: base.toUpperCase(), ...PRESETS[base] };
}

// ── CSS var application ───────────────────────────────────────────────────────

const FONT_MAP: Record<string, string> = {
  system:    `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  orbitron:  `'Orbitron', monospace`,
  rajdhani:  `'Rajdhani', sans-serif`,
  exo2:      `'Exo 2', sans-serif`,
  sharetech: `'Share Tech Mono', monospace`,
};

export function applyTokens(t: ThemeToken): void {
  const r = document.documentElement;
  const s = r.style;

  s.setProperty('--accent-primary',          t.accentPrimary);
  s.setProperty('--accent-secondary',        t.accentSecondary);
  s.setProperty('--pack-accent',             t.accentPrimary);
  s.setProperty('--premium-accent',          t.accentPrimary);
  s.setProperty('--accent-blue',             t.accentPrimary);

  s.setProperty('--bg-primary',              t.bgPrimary);
  s.setProperty('--pack-bg',                 t.bgPrimary);
  s.setProperty('--bg-card',                 t.bgCard);
  s.setProperty('--pack-card-bg',            t.bgCard);

  s.setProperty('--text-primary',            t.textPrimary);
  s.setProperty('--text-primary-var',        t.textPrimary);
  s.setProperty('--text-secondary',          t.textSecondary);
  s.setProperty('--text-secondary-var',      t.textSecondary);

  s.setProperty('--border-color',            t.borderColor);
  s.setProperty('--pack-border',             t.borderColor);
  s.setProperty('--dock-border',             t.borderColor);

  s.setProperty('--accent-glow',             t.glowColor);
  s.setProperty('--pack-glow',               t.glowColor);

  s.setProperty('--radius-card',             `${t.radiusCard}px`);
  s.setProperty('--radius-btn',              `${t.radiusBtn}px`);
  s.setProperty('--radius-tile',             `${t.radiusTile}px`);
  s.setProperty('--radius-dock',             `${t.radiusDock}px`);

  s.setProperty('--glass-blur',              `blur(${t.cardBlurPx}px)`);
  s.setProperty('--card-blur',               `blur(${t.cardBlurPx}px) saturate(1.4)`);

  const glowAlpha = (t.glowIntensity / 100).toFixed(2);
  s.setProperty('--btn-glow', `0 0 ${Math.round(t.glowIntensity / 5)}px ${t.accentPrimary}${Math.round(t.glowIntensity * 2.55).toString(16).padStart(2, '0')}`);

  s.setProperty('--font-ui',                 FONT_MAP[t.fontFamily] ?? FONT_MAP.system);
  s.setProperty('--font-weight-ui',          String(t.fontWeight));
  s.setProperty('--letter-spacing-ui',       `${t.letterSpacing}px`);

  s.setProperty('--icon-color-nav',          t.iconNav);
  s.setProperty('--icon-color-media',        t.iconMedia);
  s.setProperty('--dock-icon-color',         t.iconDock);
  s.setProperty('--dock-icon-color-active',  t.accentPrimary);

  // Inject Google Fonts if needed
  const needsGF = ['orbitron', 'rajdhani', 'exo2', 'sharetech'].includes(t.fontFamily);
  if (needsGF) {
    const id = 'theme-studio-gf';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id   = id;
      link.rel  = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;600;700&family=Exo+2:wght@400;700&family=Share+Tech+Mono&display=swap';
      document.head.appendChild(link);
    }
  }

  void glowAlpha; // suppress unused lint
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface ThemeStudioState {
  current:     ThemeToken;
  slots:       SavedSlot[];
  applyToken:  (patch: Partial<ThemeToken>) => void;
  saveSlot:    (name: string) => void;
  loadSlot:    (id: string) => void;
  deleteSlot:  (id: string) => void;
  resetToBase: (base: BaseTheme) => void;
}

export const useThemeStudio = create<ThemeStudioState>()(
  persist(
    (set, get) => ({
      current: getPreset('tesla'),
      slots:   [],

      applyToken: (patch) => {
        const next = { ...get().current, ...patch };
        applyTokens(next);
        set({ current: next });
      },

      saveSlot: (name) => {
        const cur     = get().current;
        const slots   = get().slots;
        const MAX     = 6;
        const newSlot: SavedSlot = {
          ...cur,
          id:      `slot-${Date.now()}`,
          name:    name.trim() || `Tema ${slots.length + 1}`,
          savedAt: Date.now(),
        };
        const updated = [newSlot, ...slots].slice(0, MAX);
        set({ slots: updated });
      },

      loadSlot: (id) => {
        const slot = get().slots.find((s) => s.id === id);
        if (!slot) return;
        applyTokens(slot);
        set({ current: slot });
      },

      deleteSlot: (id) => {
        set({ slots: get().slots.filter((s) => s.id !== id) });
      },

      resetToBase: (base) => {
        const preset = getPreset(base);
        applyTokens(preset);
        set({ current: preset });
      },
    }),
    {
      name: 'caros-theme-studio',
      onRehydrateStorage: () => (state) => {
        if (state?.current) applyTokens(state.current);
      },
    },
  ),
);
