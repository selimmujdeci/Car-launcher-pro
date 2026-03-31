/**
 * Theme Layout Engine
 *
 * Her tema paketi = farklı fiziksel layout.
 * CSS grid/flex/order ile DOM hiyerarşisi değiştirmeden layout değişir.
 *
 * Layout variants:
 *   map-first  — Tesla: harita dominan, speedo ince sol
 *   cockpit    — BMW/Porsche: speedo büyük sol, harita sağ küçük
 *   glass      — Mercedes: dengeli 2-sütun, geniş radius
 *   sport      — Audi/Redline: eşit sütunlar, keskin köşeler
 *   content    — BigCards/AI: içerik merkezi, harita küçük
 *   minimal    — Minimal temalar: sade, az hareket
 *   balanced   — Diğer atmosferik temalar için
 *
 * CSS variables applied per layout variant (see theme-packs.css):
 *   --l-map-flex-basis   map container genişliği (flex-basis)
 *   --l-map-min-w        map minimum genişlik
 *   --l-speedo-order     speedo CSS order
 *   --l-content-order    content CSS order
 *   --l-map-order        map CSS order
 */

import type { ThemePack } from '../store/useStore';
import { useStore } from '../store/useStore';
import { useEffect } from 'react';

/* ── Types ────────────────────────────────────────────────── */

export type LayoutVariant =
  | 'map-first'  // Tesla: harita dominan
  | 'cockpit'    // BMW, Porsche: speedo dominan
  | 'glass'      // Mercedes, Glass Pro: dengeli cam
  | 'sport'      // Audi, Redline, Electric: agresif eşit
  | 'content'    // Big Cards, AI Center: içerik odaklı
  | 'minimal'    // Minimal Dark/Light, Monochrome
  | 'balanced';  // Default diğerleri

export interface LayoutConfig {
  variant:     LayoutVariant;
  label:       string;
  description: string;
  /** Map flex-basis percentage (e.g. "45%") */
  mapBasis:    string;
  /** Speedometer basis / rem width hint */
  speedoBasis: string;
  /** Preview accent color (theme primary) */
  accentHex:   string;
  /** Preview theme background */
  bgHex:       string;
}

/* ── Theme → Layout map (all 23 packs) ───────────────────── */

export const THEME_LAYOUTS: Record<ThemePack, LayoutConfig> = {
  // ── Otomobil markaları ─────────────────────────────────
  tesla: {
    variant:     'map-first',
    label:       'Tesla',
    description: 'Geniş harita, ince speedo, sıfır gürültü',
    mapBasis:    '45%',
    speedoBasis: '13rem',
    accentHex:   '#e8e8e8',
    bgHex:       '#050505',
  },
  bmw: {
    variant:     'cockpit',
    label:       'BMW M',
    description: 'Speedo egemen, agresif cockpit',
    mapBasis:    '26%',
    speedoBasis: '22rem',
    accentHex:   '#1d4ed8',
    bgHex:       '#010410',
  },
  mercedes: {
    variant:     'glass',
    label:       'Mercedes',
    description: 'Dengeli 2-sütun, altın cam efekti',
    mapBasis:    '38%',
    speedoBasis: '18rem',
    accentHex:   '#d4af37',
    bgHex:       '#090907',
  },
  audi: {
    variant:     'sport',
    label:       'Audi',
    description: 'Teknik hassasiyet, net grid',
    mapBasis:    '36%',
    speedoBasis: '20rem',
    accentHex:   '#c0392b',
    bgHex:       '#030608',
  },
  porsche: {
    variant:     'cockpit',
    label:       'Porsche',
    description: 'Speedo ekrana hükümdar',
    mapBasis:    '28%',
    speedoBasis: '24rem',
    accentHex:   '#d4a227',
    bgHex:       '#050505',
  },
  'range-rover': {
    variant:     'glass',
    label:       'Range Rover',
    description: 'Lüks denge, toprak tonları',
    mapBasis:    '40%',
    speedoBasis: '17rem',
    accentHex:   '#8b7355',
    bgHex:       '#0a0804',
  },

  // ── Atmosfer & Neon ────────────────────────────────────
  cyberpunk: {
    variant:     'sport',
    label:       'Cyberpunk',
    description: 'Neon ızgara, dijital cockpit',
    mapBasis:    '35%',
    speedoBasis: '19rem',
    accentHex:   '#06b6d4',
    bgHex:       '#010611',
  },
  midnight: {
    variant:     'balanced',
    label:       'Gece',
    description: 'Derin gece, sıcak parıltı',
    mapBasis:    '42%',
    speedoBasis: '17rem',
    accentHex:   '#6366f1',
    bgHex:       '#040212',
  },
  'glass-pro': {
    variant:     'glass',
    label:       'Glass Pro',
    description: 'Tam frosted glass deneyimi',
    mapBasis:    '40%',
    speedoBasis: '18rem',
    accentHex:   '#38bdf8',
    bgHex:       '#050a14',
  },
  ambient: {
    variant:     'balanced',
    label:       'Ortam',
    description: 'Hafif nefes alan ambians',
    mapBasis:    '42%',
    speedoBasis: '17rem',
    accentHex:   '#34d399',
    bgHex:       '#020a06',
  },
  galaxy: {
    variant:     'balanced',
    label:       'Galaksi',
    description: 'Uzay derinliği, derin siyah',
    mapBasis:    '42%',
    speedoBasis: '17rem',
    accentHex:   '#818cf8',
    bgHex:       '#03020f',
  },

  // ── Performans ─────────────────────────────────────────
  redline: {
    variant:     'sport',
    label:       'Redline',
    description: 'Kırmızı çizgi, tam gaz',
    mapBasis:    '33%',
    speedoBasis: '21rem',
    accentHex:   '#ef4444',
    bgHex:       '#080202',
  },
  electric: {
    variant:     'sport',
    label:       'Elektrik',
    description: 'EV enerjisi, yeşil vurgu',
    mapBasis:    '34%',
    speedoBasis: '20rem',
    accentHex:   '#22c55e',
    bgHex:       '#010a04',
  },
  carbon: {
    variant:     'sport',
    label:       'Karbon',
    description: 'Karbon fiber doku',
    mapBasis:    '35%',
    speedoBasis: '19rem',
    accentHex:   '#94a3b8',
    bgHex:       '#070707',
  },
  'night-city': {
    variant:     'balanced',
    label:       'Şehir Geceleri',
    description: 'Kentsel ışıklar, hareket',
    mapBasis:    '42%',
    speedoBasis: '17rem',
    accentHex:   '#f59e0b',
    bgHex:       '#05040a',
  },

  // ── Minimal ────────────────────────────────────────────
  'minimal-dark': {
    variant:     'minimal',
    label:       'Koyu Minimal',
    description: 'Saf minimal, sıfır gürültü',
    mapBasis:    '38%',
    speedoBasis: '15rem',
    accentHex:   '#64748b',
    bgHex:       '#080808',
  },
  'minimal-light': {
    variant:     'minimal',
    label:       'Açık Minimal',
    description: 'Gündüz modu, sade',
    mapBasis:    '38%',
    speedoBasis: '15rem',
    accentHex:   '#475569',
    bgHex:       '#f8fafc',
  },
  monochrome: {
    variant:     'minimal',
    label:       'Monokrom',
    description: 'Siyah-beyaz, net kontrast',
    mapBasis:    '40%',
    speedoBasis: '16rem',
    accentHex:   '#e2e8f0',
    bgHex:       '#050505',
  },
  arctic: {
    variant:     'glass',
    label:       'Arktik',
    description: 'Soğuk buz mavisi, kristal',
    mapBasis:    '40%',
    speedoBasis: '17rem',
    accentHex:   '#7dd3fc',
    bgHex:       '#020d14',
  },
  sunset: {
    variant:     'balanced',
    label:       'Günbatımı',
    description: 'Turuncu altın ışık',
    mapBasis:    '42%',
    speedoBasis: '17rem',
    accentHex:   '#fb923c',
    bgHex:       '#0a0302',
  },

  // ── Özel Layout ────────────────────────────────────────
  'big-cards': {
    variant:     'content',
    label:       'Büyük Kartlar',
    description: 'İçerik merkezi, harita küçük',
    mapBasis:    '30%',
    speedoBasis: '16rem',
    accentHex:   '#6366f1',
    bgHex:       '#04040e',
  },
  'ai-center': {
    variant:     'content',
    label:       'AI Merkezi',
    description: 'Yapay zeka odaklı, asistan büyük',
    mapBasis:    '28%',
    speedoBasis: '15rem',
    accentHex:   '#06b6d4',
    bgHex:       '#020812',
  },
  'tesla-x-night': {
    variant:     'map-first',
    label:       'Tesla X Gece',
    description: 'Tesla karanlık, harita dominant',
    mapBasis:    '47%',
    speedoBasis: '12rem',
    accentHex:   '#3b82f6',
    bgHex:       '#020202',
  },
};

/* ── Default fallback ─────────────────────────────────────── */

const DEFAULT_LAYOUT: LayoutConfig = {
  variant:     'balanced',
  label:       'Dengeli',
  description: 'Varsayılan dengeli düzen',
  mapBasis:    '42%',
  speedoBasis: '18rem',
  accentHex:   '#3b82f6',
  bgHex:       '#0f172a',
};

/* ── Public API ───────────────────────────────────────────── */

export function getLayoutConfig(pack: ThemePack): LayoutConfig {
  return THEME_LAYOUTS[pack] ?? DEFAULT_LAYOUT;
}

/**
 * React hook — returns layout config for the currently active theme.
 * Automatically updates when the theme pack changes.
 */
export function useThemeLayout(): LayoutConfig {
  const pack = useStore((s) => s.settings.themePack);
  return getLayoutConfig(pack);
}

/**
 * React hook — syncs theme pack changes to the DOM data-layout attribute.
 * Mount once at the app root level (e.g. in MainLayout or App).
 */
export function useLayoutSync(): void {
  const pack = useStore((s) => s.settings.themePack);
  useEffect(() => {
    const config = getLayoutConfig(pack);
    document.documentElement.setAttribute('data-layout', config.variant);
  }, [pack]);
}
