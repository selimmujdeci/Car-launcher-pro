/**
 * Edit Style Engine
 * Mağazadaki her element stilini CSS olarak üretir ve <head>'e enjekte eder.
 * - .speedometer-container ve .map-container için CSS değişkenleri (theme-layouts !important uyumu)
 * - Diğer tüm elementler için !important geçersiz kılma
 * - Global tip stili < Lokal element override (cascade sırası)
 */
import type { ElementStyle } from '../store/useEditStore';
import { EDITABLE_REGISTRY } from '../store/useEditStore';

const STYLE_TAG_ID = 'car-edit-engine-v3';

/* ── Renk Paleti ─────────────────────────────────────────────── */
export const COLOR_PRESETS = [
  { id: 'default', label: 'Varsayılan', value: null         },
  { id: 'blue',    label: 'Mavi',       value: '#1d4ed8'    },
  { id: 'cyan',    label: 'Cyan',       value: '#0891b2'    },
  { id: 'violet',  label: 'Mor',        value: '#7c3aed'    },
  { id: 'red',     label: 'Kırmızı',   value: '#b91c1c'    },
  { id: 'orange',  label: 'Turuncu',   value: '#c2410c'    },
  { id: 'amber',   label: 'Amber',     value: '#b45309'    },
  { id: 'green',   label: 'Yeşil',     value: '#15803d'    },
  { id: 'teal',    label: 'Teal',       value: '#0f766e'    },
  { id: 'slate',   label: 'Gri',        value: '#334155'    },
  { id: 'rose',    label: 'Pembe',     value: '#be185d'    },
  { id: 'lime',    label: 'Lime',       value: '#4d7c0f'    },
] as const;

export type ColorPresetId = (typeof COLOR_PRESETS)[number]['id'];

/* ── WCAG Kontrast ───────────────────────────────────────────── */
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0;
  const parse = (s: string) => parseInt(s, 16) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return (
    0.2126 * lin(parse(h.slice(0, 2))) +
    0.7152 * lin(parse(h.slice(2, 4))) +
    0.0722 * lin(parse(h.slice(4, 6)))
  );
}

export function getContrastColor(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.179 ? '#0f172a' : '#ffffff';
}

/* ── Yardımcı fonksiyonlar ───────────────────────────────────── */
function hexAlpha(hex: string, pct: number): string {
  const a = Math.round(Math.min(95, Math.max(5, pct)) / 100 * 255)
    .toString(16).padStart(2, '0');
  return hex + a;
}

function glowStr(color: string, level: 0 | 1 | 2 | 3): string {
  const cfg: Record<number, string> = {
    0: 'none',
    1: `0 0 14px ${color}55`,
    2: `0 0 28px ${color}77, 0 0 56px ${color}33`,
    3: `0 0 40px ${color}99, 0 0 80px ${color}44`,
  };
  return cfg[level] ?? 'none';
}

function shadowStr(level: 0 | 1 | 2 | 3): string {
  const cfg: Record<number, string> = {
    0: 'none',
    1: '0 4px 20px rgba(0,0,0,0.55)',
    2: '0 8px 36px rgba(0,0,0,0.75)',
    3: '0 16px 56px rgba(0,0,0,0.90)',
  };
  return cfg[level] ?? 'none';
}

function speedoWidth(size: 'small' | 'default' | 'large'): string {
  if (size === 'small') return '11rem';
  if (size === 'large') return '24rem';
  return '18rem';
}

function sizeZoom(size: 'small' | 'default' | 'large'): string | null {
  if (size === 'small') return '0.82';
  if (size === 'large') return '1.20';
  return null;
}

/* ── CSS bloğu üret (tek element) ───────────────────────────── */
function buildBlock(selector: string, style: Partial<ElementStyle>, type: string): string {
  const r: string[] = [];

  // Arka plan
  if (style.bgColor) {
    const bg = hexAlpha(style.bgColor, style.bgOpacity ?? 80);
    r.push(`  background-color: ${bg} !important;`);
    r.push(`  --speedo-bg: ${bg};`);
  }

  // Kenarlık rengi
  if (style.borderColor) {
    const bc = style.borderColor + 'c0';
    r.push(`  border-color: ${bc} !important;`);
    r.push(`  --speedo-border: ${bc};`);
    r.push(`  --map-border: ${bc};`);
  }

  // Kenarlık kalınlığı
  if (style.borderWidth !== undefined && style.borderWidth !== 2) {
    r.push(`  border-width: ${style.borderWidth}px !important;`);
    r.push(`  --speedo-border-w: ${style.borderWidth}px;`);
    r.push(`  --map-border-w: ${style.borderWidth}px;`);
  }

  // Yazı rengi
  if (style.textColor) {
    r.push(`  color: ${style.textColor} !important;`);
    r.push(`  --speedo-color: ${style.textColor};`);
  }

  // Vurgu rengi
  if (style.accentColor) {
    r.push(`  --pack-accent: ${style.accentColor};`);
    r.push(`  --pack-glow: ${style.accentColor}66;`);
  }

  // Köşe yarıçapı
  if (style.borderRadius !== undefined && style.borderRadius !== null) {
    const rad = `${style.borderRadius}rem`;
    r.push(`  border-radius: ${rad} !important;`);
    r.push(`  --map-radius: ${rad};`);
  }

  // Glow + Shadow birleşik box-shadow
  const gl = style.glowLevel ?? 0;
  const sl = style.shadowLevel ?? 1;
  const glColor = style.accentColor ?? style.borderColor ?? style.bgColor ?? '#3b82f6';
  if (gl > 0 || sl !== 1) {
    const parts = [
      gl > 0 ? glowStr(glColor, gl as 0 | 1 | 2 | 3) : '',
      shadowStr(sl as 0 | 1 | 2 | 3),
    ].filter((s) => s && s !== 'none').join(', ') || 'none';
    r.push(`  box-shadow: ${parts} !important;`);
    r.push(`  --speedo-shadow: ${parts};`);
    r.push(`  --map-shadow: ${parts};`);
  }

  // Saydamlık
  if (style.opacity !== undefined && style.opacity < 100) {
    r.push(`  opacity: ${style.opacity / 100} !important;`);
  }

  // Boyut
  if (style.size && style.size !== 'default') {
    if (type === 'speedo') {
      r.push(`  --speedo-w: ${speedoWidth(style.size)};`);
    } else {
      const z = sizeZoom(style.size);
      if (z) r.push(`  zoom: ${z};`);
    }
  } else if (type === 'speedo') {
    r.push(`  --speedo-w: ${speedoWidth('default')};`);
  }

  // Yazı kalınlığı (ayrı selector — tüm child metin etiketlerine)
  const extraLines: string[] = [];
  if (style.fontWeight) {
    extraLines.push(`${selector} * { font-weight: ${style.fontWeight} !important; }`);
  }

  // Font scale (speedo'ya özel değişkenler + genel zoom)
  if (style.fontScale && style.fontScale !== 1) {
    const fs = style.fontScale;
    r.push(`  --speedo-font: calc(6rem * ${fs});`);
    r.push(`  --speedo-unit-font: calc(0.7rem * ${fs});`);
    r.push(`  --speedo-data-size: calc(1.5rem * ${fs});`);
    if (type !== 'speedo') {
      // Diğer elementlere zoom ile uygula
      const currentZoom = style.size && style.size !== 'default' ? sizeZoom(style.size) : null;
      if (!currentZoom) r.push(`  zoom: ${fs};`);
    }
  }

  if (r.length === 0 && extraLines.length === 0) return '';
  const block = r.length ? `${selector} {\n${r.join('\n')}\n}` : '';
  return [block, ...extraLines].filter(Boolean).join('\n');
}

/* ── Ana enjeksiyon fonksiyonu ───────────────────────────────── */
export function generateAndInjectStyles(
  elements: Record<string, Partial<ElementStyle>>,
  globalTypes: Record<string, Partial<ElementStyle>>,
): void {
  const blocks: string[] = [];

  // 1. Global tip stilleri (önce — düşük öncelik)
  for (const [type, style] of Object.entries(globalTypes)) {
    const block = buildBlock(`[data-editable-type="${type}"]`, style, type);
    if (block) blocks.push(block);
  }

  // 2. Lokal element stilleri (sonra — yüksek öncelik, cascade'de kazanır)
  for (const [id, style] of Object.entries(elements)) {
    const info = EDITABLE_REGISTRY[id];
    const type = info?.type ?? 'card';
    const block = buildBlock(`[data-editable="${id}"]`, style, type);
    if (block) blocks.push(block);
  }

  let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = STYLE_TAG_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = blocks.join('\n\n');
}
