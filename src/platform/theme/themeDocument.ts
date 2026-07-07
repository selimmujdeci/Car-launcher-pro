/**
 * Tema Belgesi (Theme Document) v1 — "Arabam Cebimde" Tema Stüdyo'nun araca giden
 * tek serileştirilebilir paketi.
 *
 * İlke: PİKSEL DEĞİL, KURAL taşınır. Belge; seçili tema (base) + token override +
 * her eleman için stil + YERLEŞİM NİYETİ (zone/boyut sınıfı/öncelik) tutar. Konum/rect
 * SAKLANMAZ — Yerleşim Motoru (solver, Faz 1) telefonda ve araçta AYNI kuralı kendi
 * çözünürlüğünde çözer → farklı ekranda da oturur.
 *
 * Bu dosya Faz 0'dır: saf şema + validator. Runtime render'ı DEĞİŞTİRMEZ; henüz
 * kimse bu belgeden render etmez. useEditStore'a (persist/stabilite-hassas) dokunmaz;
 * layout metası burada ayrı tutulur, EDITABLE_REGISTRY ile parite testiyle bağlanır.
 *
 * Zero-trust: validateThemeDoc HİÇBİR girdide throw etmez — bozuk/eksik alanı clamp'ler
 * veya güvenli varsayılana düşürür (araç tarafı fail-soft apply için sözleşme).
 */
import { EDITABLE_REGISTRY, type ElementStyle } from '../../store/useEditStore';

export const THEME_DOC_VERSION = 1 as const;

/* ── Temel tipler ─────────────────────────────────────────── */

export type ThemeBase = 'pro' | 'tesla' | 'expedition' | 'horizon';
const THEME_BASES: readonly ThemeBase[] = ['pro', 'tesla', 'expedition', 'horizon'];

/** Ekran bölgeleri — serbest tuval değil. Solver widgetları bu zone'lara oturtur.
 *  header/dock = sabit "chrome" (çözülmez), diğer üçü solver'ın sahnesi. */
export type Zone = 'header' | 'left-rail' | 'center-stage' | 'right-rail' | 'dock';
export const ZONES: readonly Zone[] = ['header', 'left-rail', 'center-stage', 'right-rail', 'dock'];

/** Boyut sınıfı — solver yer daralınca S'e / compact'e indirir. */
export type SizeClass = 'S' | 'M' | 'L';
const SIZE_CLASSES: readonly SizeClass[] = ['S', 'M', 'L'];

/** Yerleşim niyeti — kullanıcı bunu söyler, solver geometriyi çözer. */
export interface LayoutMeta {
  zone: Zone;
  /** yüksek = önce yerleşir; güvenlik-kritik en yüksek */
  priority: number;      // 0-100
  sizeClass: SizeClass;
  /** true → silinemez/gizlenemez (güvenlik widget'ları, chrome) */
  locked?: boolean;
}

/** Token override alt kümesi — --oem-* semantik katmanına eşlenir (Faz 1'de uygulanır). */
export interface ThemeTokens {
  accent: string | null;
  accentSecondary: string | null;
  bg: string | null;
  cardBg: string | null;
}
export const DEFAULT_TOKENS: ThemeTokens = {
  accent: null,
  accentSecondary: null,
  bg: null,
  cardBg: null,
};

export interface ThemeElement {
  /** EditPanel/useEditStore ile aynı stil sözleşmesi (kısmi override). */
  style: Partial<ElementStyle>;
  layout: LayoutMeta;
}

export interface ThemeDoc {
  version: number;
  base: ThemeBase;
  tokens: ThemeTokens;
  /** Anahtarlar EDITABLE_REGISTRY id'leri (bilinmeyen id'ler validate'de düşürülür). */
  elements: Record<string, ThemeElement>;
}

/* ── Eleman başına varsayılan yerleşim niyeti ─────────────────
   NOT: Bu değerler Faz 0'da HİÇBİR ŞEYİ render etmez — solver (Faz 1) tüketecek.
   Kaba ama makul başlangıç; ana ekran zone haritasına göre ayarlanır. ── */

const FALLBACK_LAYOUT: LayoutMeta = { zone: 'center-stage', sizeClass: 'M', priority: 30 };

export const LAYOUT_DEFAULTS: Record<string, LayoutMeta> = {
  // ── Chrome (sabit, çözülmez) ──
  header:              { zone: 'header',       sizeClass: 'L', priority: 100, locked: true },
  'tab-bar':           { zone: 'header',       sizeClass: 'M', priority: 90 },
  dock:                { zone: 'dock',         sizeClass: 'L', priority: 100, locked: true },
  // ── Ana widgetlar ──
  'smart-banner':      { zone: 'center-stage', sizeClass: 'M', priority: 40 },
  speedometer:         { zone: 'left-rail',    sizeClass: 'L', priority: 95, locked: true }, // güvenlik: hız
  'map-card':          { zone: 'center-stage', sizeClass: 'L', priority: 90 },
  'nav-hud':           { zone: 'center-stage', sizeClass: 'L', priority: 88 },
  // ── Dock butonları ──
  'dock-notifications':{ zone: 'dock',         sizeClass: 'S', priority: 57 },
  'dock-navigation':   { zone: 'dock',         sizeClass: 'S', priority: 56 },
  'dock-dashcam':      { zone: 'dock',         sizeClass: 'S', priority: 55 },
  'dock-weather':      { zone: 'dock',         sizeClass: 'S', priority: 54 },
  'dock-security':     { zone: 'dock',         sizeClass: 'S', priority: 53 },
  'dock-entertainment':{ zone: 'dock',         sizeClass: 'S', priority: 52 },
  'dock-voice':        { zone: 'dock',         sizeClass: 'S', priority: 51 },
  'dock-apps':         { zone: 'dock',         sizeClass: 'S', priority: 50 },
  // ── İçerik kartları ──
  'media-hub':         { zone: 'right-rail',   sizeClass: 'L', priority: 70 },
  'digital-cluster':   { zone: 'right-rail',   sizeClass: 'M', priority: 65 },
  'clock-card':        { zone: 'left-rail',    sizeClass: 'M', priority: 60 },
  'tpms-widget':       { zone: 'left-rail',    sizeClass: 'S', priority: 55 },
  'fav-apps':          { zone: 'center-stage', sizeClass: 'M', priority: 50 },
  'phone-panel':       { zone: 'right-rail',   sizeClass: 'M', priority: 48 },
  'obd-panel':         { zone: 'center-stage', sizeClass: 'M', priority: 45 },
  'dtc-panel':         { zone: 'center-stage', sizeClass: 'M', priority: 44 },
  'sport-mode':        { zone: 'right-rail',   sizeClass: 'M', priority: 42 },
  'trip-log':          { zone: 'left-rail',    sizeClass: 'S', priority: 40 },
  'vehicle-reminder':  { zone: 'left-rail',    sizeClass: 'S', priority: 39 },
  'weather-card':      { zone: 'right-rail',   sizeClass: 'S', priority: 38 },
  'security-suite':    { zone: 'center-stage', sizeClass: 'M', priority: 36 },
  entertainment:       { zone: 'center-stage', sizeClass: 'M', priority: 34 },
  dashcam:             { zone: 'center-stage', sizeClass: 'M', priority: 32 },
  'notification-area': { zone: 'right-rail',   sizeClass: 'S', priority: 30 },
};

/** Bir id için varsayılan yerleşim (registry büyüse de güvenli fallback). */
export function defaultLayoutFor(id: string): LayoutMeta {
  return { ...(LAYOUT_DEFAULTS[id] ?? FALLBACK_LAYOUT) };
}

/* ── Zero-trust clamp yardımcıları ────────────────────────── */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function inList<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/** Sonlu sayıya zorla + [min,max] aralığına sıkıştır; geçersizse undefined. */
function clampNum(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsla?\(|^var\(/;
/** Geçerli CSS renk/var → string, aksi halde null (fail-soft: override yok sayılır). */
function validColor(v: unknown): string | null {
  return typeof v === 'string' && COLOR_RE.test(v.trim()) ? v : null;
}

const FONT_WEIGHTS: readonly (400 | 600 | 700 | 900)[] = [400, 600, 700, 900];
const SIZES: readonly ElementStyle['size'][] = ['small', 'default', 'large'];

/** ElementStyle override'ını STYLE_DEFAULTS aralıklarına clamp'ler (yalnız geçerli anahtarlar). */
export function clampElementStyle(raw: unknown): Partial<ElementStyle> {
  if (!isObj(raw)) return {};
  const out: Partial<ElementStyle> = {};

  if (typeof raw.visible === 'boolean') out.visible = raw.visible;
  if ('bgColor' in raw)     out.bgColor     = validColor(raw.bgColor);
  if ('borderColor' in raw) out.borderColor = validColor(raw.borderColor);
  if ('textColor' in raw)   out.textColor   = validColor(raw.textColor);
  if ('accentColor' in raw) out.accentColor = validColor(raw.accentColor);

  const bgOpacity = clampNum(raw.bgOpacity, 5, 95);
  if (bgOpacity !== undefined) out.bgOpacity = Math.round(bgOpacity);

  const borderWidth = clampNum(raw.borderWidth, 0, 4);
  if (borderWidth !== undefined) out.borderWidth = Math.round(borderWidth);

  if (raw.fontWeight === null) out.fontWeight = null;
  else {
    const fw = Number(raw.fontWeight);
    if (FONT_WEIGHTS.includes(fw as 400 | 600 | 700 | 900)) out.fontWeight = fw as 400 | 600 | 700 | 900;
  }

  if (raw.fontScale === null) out.fontScale = null;
  else { const fs = clampNum(raw.fontScale, 0.8, 1.5); if (fs !== undefined) out.fontScale = fs; }

  if (raw.borderRadius === null) out.borderRadius = null;
  else { const br = clampNum(raw.borderRadius, 0, 3); if (br !== undefined) out.borderRadius = br; }

  if (inList(SIZES, raw.size)) out.size = raw.size;

  const glow = clampNum(raw.glowLevel, 0, 3);
  if (glow !== undefined) out.glowLevel = Math.round(glow) as 0 | 1 | 2 | 3;

  const shadow = clampNum(raw.shadowLevel, 0, 3);
  if (shadow !== undefined) out.shadowLevel = Math.round(shadow) as 0 | 1 | 2 | 3;

  const opacity = clampNum(raw.opacity, 40, 100);
  if (opacity !== undefined) out.opacity = Math.round(opacity);

  return out;
}

/** LayoutMeta'yı geçerli zone/sizeClass/priority'ye clamp'ler; eksik alan varsayılandan gelir. */
export function clampLayoutMeta(raw: unknown, id: string): LayoutMeta {
  const def = defaultLayoutFor(id);
  if (!isObj(raw)) return def;
  const zone = inList(ZONES, raw.zone) ? raw.zone : def.zone;
  const sizeClass = inList(SIZE_CLASSES, raw.sizeClass) ? raw.sizeClass : def.sizeClass;
  const p = clampNum(raw.priority, 0, 100);
  const priority = p === undefined ? def.priority : Math.round(p);
  // locked: varsayılan kilitliyse ASLA açılamaz; değilse kullanıcı kilitleyebilir.
  const locked = def.locked === true ? true : raw.locked === true;
  return locked ? { zone, sizeClass, priority, locked: true } : { zone, sizeClass, priority };
}

function clampTokens(raw: unknown): ThemeTokens {
  if (!isObj(raw)) return { ...DEFAULT_TOKENS };
  return {
    accent:          validColor(raw.accent),
    accentSecondary: validColor(raw.accentSecondary),
    bg:              validColor(raw.bg),
    cardBg:          validColor(raw.cardBg),
  };
}

/* ── Fabrika + validate + serialize ───────────────────────── */

/** Boş (override'sız) tema belgesi — tüm registry id'leri varsayılan yerleşimle. */
export function createDefaultThemeDoc(base: ThemeBase = 'pro'): ThemeDoc {
  const elements: Record<string, ThemeElement> = {};
  for (const id of Object.keys(EDITABLE_REGISTRY)) {
    const layout = defaultLayoutFor(id);
    // Invaryant: kilitli eleman görünür başlar → belge validate altında idempotent kalsın.
    elements[id] = { style: layout.locked ? { visible: true } : {}, layout };
  }
  return { version: THEME_DOC_VERSION, base, tokens: { ...DEFAULT_TOKENS }, elements };
}

/**
 * Zero-trust doğrulama. HİÇBİR girdide throw etmez:
 *  - obje değilse → tam varsayılan belge
 *  - bilinmeyen base → fallbackBase
 *  - bilinmeyen eleman id'si → düşürülür
 *  - out-of-range stil/layout → clamp
 *  - kilitli eleman → görünürlüğü zorla açık (güvenlik gizlenemez)
 */
export function validateThemeDoc(raw: unknown, fallbackBase: ThemeBase = 'pro'): ThemeDoc {
  if (!isObj(raw)) return createDefaultThemeDoc(fallbackBase);

  const base = inList(THEME_BASES, raw.base) ? raw.base : fallbackBase;
  const tokens = clampTokens(raw.tokens);

  // Her registry id'si için varsayılanla başla → sonra doc override'larını uygula.
  const elements: Record<string, ThemeElement> = {};
  for (const id of Object.keys(EDITABLE_REGISTRY)) {
    elements[id] = { style: {}, layout: defaultLayoutFor(id) };
  }

  if (isObj(raw.elements)) {
    for (const [id, el] of Object.entries(raw.elements)) {
      if (!(id in EDITABLE_REGISTRY)) continue; // zero-trust: hayalet id render etme
      const style = clampElementStyle(isObj(el) ? el.style : undefined);
      const layout = clampLayoutMeta(isObj(el) ? el.layout : undefined, id);
      if (layout.locked) style.visible = true; // kilitli eleman gizlenemez
      elements[id] = { style, layout };
    }
  }

  // Doc'ta gelmese bile: varsayılanı kilitli olan elemanların görünürlüğü zorla açık.
  for (const id of Object.keys(EDITABLE_REGISTRY)) {
    if (defaultLayoutFor(id).locked) elements[id].style.visible = true;
  }

  return { version: THEME_DOC_VERSION, base, tokens, elements };
}

export function serializeThemeDoc(doc: ThemeDoc): string {
  return JSON.stringify(doc);
}

/** JSON string → doğrulanmış belge (parse hatası da fail-soft → varsayılan). */
export function parseThemeDoc(json: string, fallbackBase: ThemeBase = 'pro'): ThemeDoc {
  try {
    return validateThemeDoc(JSON.parse(json) as unknown, fallbackBase);
  } catch {
    return createDefaultThemeDoc(fallbackBase);
  }
}
