/**
 * Tema Manifesti v2 — CarOS Pro görsel dilinin TEK kanonik sözleşmesi (PWA kopyası).
 *
 * Araç kopyası: src/platform/theme/themeManifest.ts — ilk yorum bloğu dışında
 * BİREBİR aynıdır. Next ayrı bir paket olduğu için mantık burada AYNEN yansıtılır;
 * ayrışma themeManifestParity testiyle kilitlenir.
 *
---8<--- PARITY-START --->8---
 *
 * NEDEN: Tema Stüdyo (Arabam Cebimde) → Araç yolunda daha önce serbest bir
 * `Record<string,string>` CSS-var torbası taşınıyordu: sürümsüz, doğrulanmamış,
 * bileşen kimliği yok. Bu dosya o torbanın yerine geçer:
 *
 *   schemaVersion + themeId + themeVersion + tokens + componentOverrides
 *   + screenOverrides + metadata
 *
 * TASARIM İLKELERİ
 *  1) NULL = DOKUNMA. Her token/stil alanı `null` başlar; null gönderilmez, uygulanmaz.
 *     Hiç özelleştirme yoksa araç EKRANI BUGÜNKÜYLE BİREBİR AYNI kalır (temaların
 *     kendi paletleri `var(--x, <hex>)` fallback'i üzerinden devrede kalır).
 *  2) STRING DEĞİL YAPI. Gradient serbest metin olarak taşınmaz; `Paint` yapısı
 *     (kind/from/to/angle/stops) taşınır ve CSS metnini DAİMA bu dosya üretir →
 *     CSS injection yapısal olarak imkânsız (kullanıcı metni CSS'e hiç girmez).
 *  3) İKİ KAPI. `coerceThemeManifest` fail-SOFT'tur (yerel depo/taslak: bozuğu
 *     onarır). `parseIncomingManifest` fail-CLOSED'dur (araca gelen paket: şema
 *     ihlalinde REDDEDER, sebep döner). Taşıma yolunda daima ikincisi kullanılır.
 *  4) DETERMİNİZM. Aynı manifest → aynı CSS metni (anahtar sırası sabit).
 */

/* ══ Sürüm ═══════════════════════════════════════════════════════════ */

/**
 * v3 = v2 + `layoutOverrides` (yerleşim niyeti manifest'in parçası oldu).
 * v2 paketleri OLDUĞU GİBİ kabul edilir ve boş yerleşimle v3'e taşınır — eski
 * PWA sürümünden gelen paket reddedilmez (geri-uyum sözleşmesi).
 */
export const THEME_SCHEMA_VERSION = 3 as const;
/** v1 = sürümsüz `themeVars` torbası (eski Tema Stüdyo). Taşıma için tanınır. */
export const THEME_SCHEMA_MIN_SUPPORTED = 1 as const;

/* ══ Temel tipler ════════════════════════════════════════════════════ */

export type ThemeBaseId = 'expedition' | 'horizon' | 'tesla' | 'pro';
export const THEME_BASE_IDS: readonly ThemeBaseId[] = ['expedition', 'horizon', 'tesla', 'pro'];

export type PaintKind = 'solid' | 'linear' | 'radial';
const PAINT_KINDS: readonly PaintKind[] = ['solid', 'linear', 'radial'];

/** Arka plan boyası — serbest CSS metni DEĞİL, yapı. CSS'i paintToCss üretir. */
export interface Paint {
  kind: PaintKind;
  /** birinci renk (solid'de tek renk) */
  from: string;
  /** ikinci renk — gradient'te zorunlu, solid'de yok sayılır */
  to: string | null;
  /** linear yön (derece, 0-360); radial'de yok sayılır */
  angle: number;
  /** birinci durak yüzdesi (0-100) */
  stopA: number;
  /** ikinci durak yüzdesi (0-100) */
  stopB: number;
  /** genel saydamlık (0-100) — CSS `opacity` değil, renk alfası değil; katman alfası */
  alpha: number;
}

export type FontId = 'system' | 'orbitron' | 'rajdhani' | 'exo2' | 'sharetech';
const FONT_IDS: readonly FontId[] = ['system', 'orbitron', 'rajdhani', 'exo2', 'sharetech'];

export const FONT_STACKS: Record<FontId, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  orbitron: "'Orbitron', monospace",
  rajdhani: "'Rajdhani', sans-serif",
  exo2: "'Exo 2', sans-serif",
  sharetech: "'Share Tech Mono', monospace",
};

/**
 * TÜRKÇE KAPSAM GERÇEĞİ — ÖLÇÜLDÜ, tahmin değil (#655).
 *
 * Fontlar `public/fonts/` içine gömülüdür. Google'ın `latin-ext` alt kümesini
 * SUNMADIĞI ailelerde Türkçeye özgü harfler YOKTUR ve tarayıcı onları fallback
 * fontla çizer — aynı satırda iki farklı yazı tipi görünür.
 *
 * Ölçüm: her ailenin `unicode-range` birleşimi şu kod noktalarına karşı
 * sınandı — U+011E/011F (Ğ/ğ) · U+015E/015F (Ş/ş) · U+0130 (İ) · U+0131 (ı).
 * (Ç/Ö/Ü zaten Latin-1'dedir, her ailede vardır.)
 *
 * Boş dize = eksik harf YOK. Bu tablo GİZLENMEZ; Stüdyo kullanıcıya söyler.
 */
export const FONT_TURKISH_GAPS: Readonly<Record<FontId, string>> = {
  system:    '',
  orbitron:  'Ğ ğ Ş ş İ',
  rajdhani:  '',
  exo2:      '',
  sharetech: 'Ğ ğ Ş ş İ',
};

export type TextAlign = 'left' | 'center' | 'right';
const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];

/** Düzenlenebilir durum çeşitleri — hepsi GERÇEK DOM kancalarına eşlenir (aşağıda). */
export type StateKey = 'active' | 'selected' | 'disabled' | 'loading' | 'error';
export const STATE_KEYS: readonly StateKey[] = ['active', 'selected', 'disabled', 'loading', 'error'];

/* ══ Global tokenlar ═════════════════════════════════════════════════ */

export interface GlobalTokens {
  // renk
  accentPrimary: string | null;
  accentSecondary: string | null;
  textPrimary: string | null;
  textSecondary: string | null;
  borderColor: string | null;
  glowColor: string | null;
  successColor: string | null;
  warningColor: string | null;
  errorColor: string | null;
  iconNav: string | null;
  iconMedia: string | null;
  iconDock: string | null;
  // arka plan (yapısal boya)
  bgPrimary: Paint | null;
  bgCard: Paint | null;
  // şekil
  radiusCard: number | null;
  radiusBtn: number | null;
  radiusTile: number | null;
  radiusDock: number | null;
  // efekt
  cardBlurPx: number | null;
  glowIntensity: number | null;
  // tipografi
  fontFamily: FontId | null;
  fontWeight: number | null;
  letterSpacing: number | null;
  lineHeight: number | null;
}

export const EMPTY_TOKENS: GlobalTokens = {
  accentPrimary: null,
  accentSecondary: null,
  textPrimary: null,
  textSecondary: null,
  borderColor: null,
  glowColor: null,
  successColor: null,
  warningColor: null,
  errorColor: null,
  iconNav: null,
  iconMedia: null,
  iconDock: null,
  bgPrimary: null,
  bgCard: null,
  radiusCard: null,
  radiusBtn: null,
  radiusTile: null,
  radiusDock: null,
  cardBlurPx: null,
  glowIntensity: null,
  fontFamily: null,
  fontWeight: null,
  letterSpacing: null,
  lineHeight: null,
};

/* ══ Kenarlık deseni ═════════════════════════════════════════════════
 * SABİT LİSTE — serbest metin manifest üzerinden CSS enjeksiyonu yüzeyi açardı.
 * Yazı tipi için AYRI bir liste KURULMAZ: `FontId`/`FONT_STACKS` zaten vardır
 * ve tek otorite odur (ilk denemede ikinci bir set eklenmişti, kaldırıldı).
 * ══════════════════════════════════════════════════════════════════════ */

export const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type BorderStyle = typeof BORDER_STYLES[number];

/* ══ Bileşen stili ═══════════════════════════════════════════════════ */

export interface ComponentStyle {
  visible: boolean | null;
  bg: Paint | null;
  borderColor: string | null;
  borderWidth: number | null;
  radius: number | null;
  textColor: string | null;
  textSecondaryColor: string | null;
  /**
   * ÜÇÜNCÜL yazı rengi. Paletlerdeki `ink3` (en soluk etiketler, ayraç yazıları)
   * bugüne dek SABİT bir hex'ti — hiçbir tema ayarına tepki vermiyordu (#654).
   * Artık `--text-tertiary` değişkenini besler.
   */
  textTertiaryColor: string | null;
  accentColor: string | null;
  iconColor: string | null;
  iconSize: number | null;
  fontWeight: number | null;
  fontScale: number | null;
  letterSpacing: number | null;
  lineHeight: number | null;
  textAlign: TextAlign | null;
  /**
   * Bileşene özgü yazı tipi. TİP GLOBAL TOKENLA AYNI (`FontId`) — ikinci bir
   * font kümesi kurulmaz. Boşsa global token geçerlidir.
   */
  fontFamily: FontId | null;
  /** Kenarlık deseni. `borderWidth` 0 ise etkisizdir (kural yine de yazılır). */
  borderStyle: BorderStyle | null;
  /**
   * Arka plan bulanıklığı (px). PERFORMANS: `backdrop-filter` zayıf GPU'da
   * (Mali-400 sınıfı) pahalıdır; bu yüzden runtime bütçesine ABONEDİR —
   * `--rt-blur` 0 olduğunda değer 0'a çarpılır ve GPU stall OLUŞMAZ.
   * Ürünün başka yerlerinde kullanılan `calc(var(--rt-blur,1) * Npx)` deseninin
   * aynısıdır; ikinci bir bütçe mekanizması kurulmaz.
   */
  backdropBlur: number | null;
  /** Geçiş süresi (ms). 0 = animasyon yok (hareket duyarlılığı / düşük uç). */
  transitionMs: number | null;
  padding: number | null;
  gap: number | null;
  opacity: number | null;
  glowLevel: number | null;
  shadowLevel: number | null;
  /** Durum çeşitleri — yalnız renk/opaklık alt kümesi (yerleşim durum başına DEĞİŞMEZ). */
  states: Partial<Record<StateKey, StateStyle>> | null;
}

export interface StateStyle {
  bg: Paint | null;
  borderColor: string | null;
  textColor: string | null;
  accentColor: string | null;
  opacity: number | null;
  /* ── PR-6 genişletmesi ───────────────────────────────────────────────
   * Durum çeşitleri bugüne dek YALNIZ renk + opaklıktı; "basılı" ya da "hata"
   * hâlinde kenarlığı kalınlaştırmak, köşeyi değiştirmek veya parıltı vermek
   * MÜMKÜN DEĞİLDİ. Eklenen üç alan da mevcut ana stille AYNI birim ve
   * aralıktadır (ikinci bir ölçek kurulmaz).
   *
   * YERLEŞİM ALANLARI BİLEREK YOK: `padding`/`gap`/`fontScale` durum başına
   * değişseydi kart basılıyken zıplardı — dokunmatik ekranda bu bir kusurdur,
   * özellik değil. Bu sınır ana stil yorumunda da beyan edilmişti. */
  borderWidth: number | null;
  radius: number | null;
  glowLevel: number | null;
}

export const EMPTY_COMPONENT_STYLE: ComponentStyle = {
  visible: null,
  bg: null,
  borderColor: null,
  borderWidth: null,
  radius: null,
  textColor: null,
  textSecondaryColor: null,
  textTertiaryColor: null,
  accentColor: null,
  iconColor: null,
  iconSize: null,
  fontWeight: null,
  fontScale: null,
  letterSpacing: null,
  lineHeight: null,
  textAlign: null,
  fontFamily: null,
  borderStyle: null,
  backdropBlur: null,
  transitionMs: null,
  padding: null,
  gap: null,
  opacity: null,
  glowLevel: null,
  shadowLevel: null,
  states: null,
};

export const EMPTY_STATE_STYLE: StateStyle = {
  bg: null,
  borderColor: null,
  textColor: null,
  accentColor: null,
  opacity: null,
  borderWidth: null,
  radius: null,
  glowLevel: null,
};

/* ══ Yerleşim (layout) ═══════════════════════════════════════════════
   İLKE: BURADA İKİNCİ BİR YERLEŞİM MOTORU YOKTUR. Alanlar mevcut
   `layoutSolver`ın GERÇEK ölçüleridir (`CardIntent`: visible · size · ord ·
   growCustom) ve manifest bunları YALNIZ taşır. Çözümü hâlâ solver yapar.

   KAPSAM SINIRI (uydurulmadı): solver'ı fiilen KULLANAN temalar `pro` ve
   `expedition`tır (ProLayout/ExpeditionLayout). Horizon ve Tesla sabit grid
   ile çizilir → o temalarda yerleşim override'ı YOKTUR ve arayüz göstermez.

   DESTEKLENMEYEN (bilerek): `zone` değiştirme (solver kartın bölgesini tema
   manifestinden sabit alır) ve `alignment` (solver'da böyle bir kavram yok).
   Bunlar taşınmaz; sahte alan üretmemek için manifest'e de KONMAZ.            */

export type LayoutSizeClass = 'S' | 'M' | 'L';
const LAYOUT_SIZE_CLASSES: readonly LayoutSizeClass[] = ['S', 'M', 'L'];

/** Solver `CardIntent`inin null-tabanlı (override) hâli. null = dokunma. */
export interface CardLayout {
  visible: boolean | null;
  size: LayoutSizeClass | null;
  /** bölge içi sıra (küçük = önce) */
  ord: number | null;
  /** elle boyut ağırlığı (flex-grow) — solver sınırı 0.5–5 */
  grow: number | null;
  /**
   * GÖRSEL BİRLEŞTİRME: bu kart, aynı bölgede kendisinden hemen SONRAKİ görünür
   * kartla TEK kart gibi çizilir. `layoutSolver.CardIntent.mergeNext` ile birebir
   * aynı anlamdadır; burada yalnız TAŞINIR (bu dosya solver'ı import etmez).
   */
  merge: boolean | null;
}

export const EMPTY_CARD_LAYOUT: CardLayout = {
  visible: null,
  size: null,
  ord: null,
  grow: null,
  merge: null,
};

/* ══ Bölge (sütun) genişliği ══════════════════════════════════════════
 * KULLANICI İSTEĞİ (PR-5): *"sütun genişliği"*. Bugüne dek raylar SABİT
 * `clamp(...)` değerleriyle çiziliyordu ve hiçbir tema ayarıyla değişmiyordu.
 *
 * ÖLÇEK, MUTLAK PİKSEL DEĞİL: kullanıcı 0,6×–1,6× arası bir ÇARPAN seçer ve
 * temanın kendi `clamp()` değerleri o çarpanla ölçeklenir. Gerekçe ölçülmüştür
 * (kütük #x: "HU px/metre ölçüleri telefonda ÇÖKÜYOR") — mutlak piksel farklı
 * ekran boyutlarında taşma/ezilme üretir; oran ise temanın kendi duyarlı
 * sınırlarını KORUR. Alt/üst sınırlar `clamp` içinde yaşamaya devam eder.
 */
export const ZONE_SCALE_MIN = 0.6;
export const ZONE_SCALE_MAX = 1.6;

/** Genişliği ölçeklenebilen bölgeler. Orta sahne (harita) ESNEKTİR ve
 *  kalan alanı alır — onu ölçeklemek anlamsızdır, listeye ALINMAZ. */
export const SCALABLE_ZONES = ['left-rail', 'right-rail'] as const;
export type ScalableZoneId = typeof SCALABLE_ZONES[number];

/** zoneId → genişlik çarpanı. Yok/boş = tema varsayılanı (hiç dokunulmamış). */
export type ZoneWidths = Partial<Record<ScalableZoneId, number>>;

export function coerceZoneWidths(raw: unknown): ZoneWidths {
  if (!isObj(raw)) return {};
  const out: ZoneWidths = {};
  for (const z of SCALABLE_ZONES) {
    const v = num((raw as Record<string, unknown>)[z], ZONE_SCALE_MIN, ZONE_SCALE_MAX, false);
    if (v !== null) out[z] = v;
  }
  return out;
}

/** Solver'ın kabul ettiği elle-boyut aralığı (layoutSolver.normalizeIntent ile aynı). */
export const LAYOUT_GROW_MIN = 0.5;
export const LAYOUT_GROW_MAX = 5;
/** Bölge kapasitesi en fazla 16 (dock) → sıra bu aralıkta anlamlıdır. */
export const LAYOUT_ORD_MAX = 31;

/** Ekran (surface) düzeyinde token kısmî override'ı — yalnız o ekranın kökünde uygulanır. */
export interface ScreenOverride {
  accentPrimary: string | null;
  textPrimary: string | null;
  textSecondary: string | null;
  bg: Paint | null;
  radiusCard: number | null;
}

export const EMPTY_SCREEN_OVERRIDE: ScreenOverride = {
  accentPrimary: null,
  textPrimary: null,
  textSecondary: null,
  bg: null,
  radiusCard: null,
};

/* ══ Manifest ════════════════════════════════════════════════════════ */

export interface ThemeManifestMeta {
  /** Kullanıcıya görünen ad (temanın kendi adı; kullanıcı değiştirebilir). */
  name: string;
  /** Üreten taraf — teşhis için; gizli veri TAŞIMAZ. */
  origin: 'pwa-studio' | 'car-local' | 'unknown';
  /** ISO 8601 — üretim anı. Bilinmiyorsa null (sahte tarih YASAK). */
  updatedAt: string | null;
}

export interface ThemeManifest {
  schemaVersion: number;
  themeId: ThemeBaseId;
  /** Her kaydetmede artan tamsayı — araç eski paketi ayırt edebilsin. */
  themeVersion: number;
  tokens: GlobalTokens;
  /** componentId → stil (componentId'ler themeComponentRegistry'den gelir). */
  componentOverrides: Record<string, ComponentStyle>;
  /** screenId → ekran düzeyi override. */
  screenOverrides: Record<string, ScreenOverride>;
  /**
   * SOLVER kart id'si → yerleşim override'ı. Anahtarlar `layoutSolver`
   * manifestlerinin id'leridir (`clock`/`gauge`/`nav`/`speed`/`map`…), bileşen
   * kayıt defterinin id'leri DEĞİL — çevrim `themeComponentRegistry.layoutCardId`
   * üzerinden yapılır. Yalnız solver kullanan temalarda dolar.
   */
  layoutOverrides: Record<string, CardLayout>;
  /**
   * Bölge (sütun) genişlik çarpanları. Boş nesne = hiç dokunulmamış → tema
   * kendi varsayılan genişliklerini kullanır (mevcut ekran birebir korunur).
   */
  zoneWidths: ZoneWidths;
  metadata: ThemeManifestMeta;
}

/* ══ Gerçek 4 tema — kod tabanından çıkarılmış temel palet ════════════
   Bu değerler UYGULANMAZ; yalnız Stüdyo'da "temanın bugünkü değeri" olarak
   gösterilir (kullanıcı dokunmadıkça manifest null taşır → araç değişmez).
   Kaynak: src/components/themes/*.tsx gece paletleri (kanonik varyant).      */

export interface ThemePresetInfo {
  id: ThemeBaseId;
  label: string;
  desc: string;
  /** Temanın gece paletindeki gerçek değerleri (salt gösterim). */
  base: {
    accentPrimary: string;
    accentSecondary: string;
    bgPrimary: string;
    bgCard: string;
    textPrimary: string;
    textSecondary: string;
    borderColor: string;
    successColor: string;
  };
}

export const THEME_PRESETS: Record<ThemeBaseId, ThemePresetInfo> = {
  expedition: {
    id: 'expedition',
    label: 'CarOS Expedition',
    desc: 'Ana tema · offroad · cıvatalı dövme metal (gece: zeytin yeşili)',
    base: {
      accentPrimary: '#F2871C',
      accentSecondary: '#B65F0C',
      bgPrimary: '#131C10',
      bgCard: '#1A241A',
      textPrimary: '#EDE4D2',
      textSecondary: '#A89678',
      borderColor: '#3A4A2A',
      successColor: '#7FB87E',
    },
  },
  horizon: {
    id: 'horizon',
    label: 'CarOS Horizon',
    desc: 'Premium · harita odaklı · soğuk grafit-lacivert',
    base: {
      accentPrimary: '#F2871C',
      accentSecondary: '#FFB35C',
      bgPrimary: '#111A2B',
      bgCard: '#19233A',
      textPrimary: '#E2E8F3',
      textSecondary: '#94A0B8',
      borderColor: '#2A3D5C',
      successColor: '#7FB87E',
    },
  },
  tesla: {
    id: 'tesla',
    label: 'Tesla',
    desc: 'Minimalist premium · koyu espresso + amber',
    base: {
      accentPrimary: '#E0822E',
      accentSecondary: '#F4A24E',
      bgPrimary: '#221B13',
      bgCard: '#30281F',
      textPrimary: '#F2ECE0',
      textSecondary: '#9A9082',
      borderColor: '#4A3D2E',
      successColor: '#9DB857',
    },
  },
  pro: {
    id: 'pro',
    label: 'Glass Pro',
    desc: 'Düşük güç · MBUX/BMW antrasit · en sade',
    base: {
      accentPrimary: '#5B8DFF',
      accentSecondary: '#2F6BFF',
      bgPrimary: '#101117',
      bgCard: '#1E222B',
      textPrimary: '#EEF2F8',
      textSecondary: '#93A0B4',
      borderColor: '#2A2F3A',
      successColor: '#34D399',
    },
  },
};

/* ══ Zero-trust yardımcıları ═════════════════════════════════════════ */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function inList<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/**
 * Güvenli renk — YALNIZ hex / rgb() / rgba() / hsl() / hsla().
 * `url(`, `;`, `}`, `expression`, yorum dizileri ve değişken referansları REDDEDİLİR.
 * Not: reddedilen değer `null` olur (dokunma) — asla ham metin olarak geçmez.
 */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*(?:,\s*\d{1,3}\s*){2}(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i;
const HSL_RE = /^hsla?\(\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?%\s*,\s*\d{1,3}(?:\.\d+)?%\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i;

export function isSafeColor(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length === 0 || s.length > 40) return false;
  return HEX_RE.test(s) || RGB_RE.test(s) || HSL_RE.test(s);
}

function safeColor(v: unknown): string | null {
  return isSafeColor(v) ? v.trim() : null;
}

/**
 * Sonlu sayı → [min,max] aralığı; geçersizse null.
 *
 * DİKKAT (yakalanmış kusur): `Number(null) === 0` ve `Number('') === 0`. Bu eleme
 * olmadan JSON round-trip'inde manifest'teki her `null` alan aralığın ALT SINIRINA
 * dönüşür (radiusCard: null → 0, fontWeight: null → 300) ve "NULL = DOKUNMA"
 * invaryantı bir kaydet/yükle çevriminde sessizce ÖLÜR — araç görünümü kullanıcı
 * hiçbir şeye dokunmadan değişirdi.
 */
function num(v: unknown, min: number, max: number, round = true): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const c = Math.min(max, Math.max(min, n));
  return round ? Math.round(c) : Math.round(c * 1000) / 1000;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/* ══ Paint ═══════════════════════════════════════════════════════════ */

export function makeSolid(color: string): Paint {
  return { kind: 'solid', from: color, to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 };
}

export function coercePaint(raw: unknown): Paint | null {
  if (!isObj(raw)) return null;
  const from = safeColor(raw.from);
  if (!from) return null; // birinci renk geçersizse boya YOK (dokunma)
  const kind: PaintKind = inList(PAINT_KINDS, raw.kind) ? raw.kind : 'solid';
  const to = safeColor(raw.to);
  // Gradient ikinci rengi olmadan gradient olamaz → solid'e düşer (fail-soft).
  const effKind: PaintKind = kind !== 'solid' && !to ? 'solid' : kind;
  return {
    kind: effKind,
    from,
    to: effKind === 'solid' ? null : to,
    angle: num(raw.angle, 0, 360) ?? 180,
    stopA: num(raw.stopA, 0, 100) ?? 0,
    stopB: num(raw.stopB, 0, 100) ?? 100,
    alpha: num(raw.alpha, 0, 100) ?? 100,
  };
}

/** Paint → CSS. Metin DAİMA burada üretilir; kullanıcı girdisi doğrudan CSS'e girmez. */
export function paintToCss(p: Paint): string {
  const a = Math.min(100, Math.max(0, p.alpha)) / 100;
  const c1 = a >= 1 ? p.from : withAlpha(p.from, a);
  if (p.kind === 'solid' || !p.to) return c1;
  const c2 = a >= 1 ? p.to : withAlpha(p.to, a);
  const s1 = Math.min(p.stopA, p.stopB);
  const s2 = Math.max(p.stopA, p.stopB);
  if (p.kind === 'radial') {
    return `radial-gradient(circle at 50% 40%, ${c1} ${s1}%, ${c2} ${s2}%)`;
  }
  return `linear-gradient(${p.angle}deg, ${c1} ${s1}%, ${c2} ${s2}%)`;
}

/** Doğrulanmış rengi alfa ile sar. Hex/rgb/hsl dışında bir şey buraya GİREMEZ. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  const rgb = colorToRgbTriplet(color);
  if (!rgb) return color;
  return `rgba(${rgb}, ${a})`;
}

/**
 * Renk → "r, g, b" üçlüsü (araçta `rgba(var(--accent-rgb), a)` üretimi için).
 * Çözemezse null — çağıran fail-soft davranır (BOŞ STRİNG DÖNMEZ: boş var
 * fallback'i devreye SOKMAZ ve rgba() geçersiz olur → tüm stil çöker).
 */
export function colorToRgbTriplet(color: string): string | null {
  const s = color.trim();
  const hex = /^#([0-9a-f]{3})$|^#([0-9a-f]{6})$|^#([0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const h = s.slice(1);
    if (h.length === 3) {
      return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16)).join(', ');
    }
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  if (rgb) {
    return `${Math.min(255, +rgb[1])}, ${Math.min(255, +rgb[2])}, ${Math.min(255, +rgb[3])}`;
  }
  return null;
}

/* ══ Coerce (fail-soft) ══════════════════════════════════════════════ */

export function coerceTokens(raw: unknown): GlobalTokens {
  if (!isObj(raw)) return { ...EMPTY_TOKENS };
  return {
    accentPrimary: safeColor(raw.accentPrimary),
    accentSecondary: safeColor(raw.accentSecondary),
    textPrimary: safeColor(raw.textPrimary),
    textSecondary: safeColor(raw.textSecondary),
    borderColor: safeColor(raw.borderColor),
    glowColor: safeColor(raw.glowColor),
    successColor: safeColor(raw.successColor),
    warningColor: safeColor(raw.warningColor),
    errorColor: safeColor(raw.errorColor),
    iconNav: safeColor(raw.iconNav),
    iconMedia: safeColor(raw.iconMedia),
    iconDock: safeColor(raw.iconDock),
    bgPrimary: coercePaint(raw.bgPrimary),
    bgCard: coercePaint(raw.bgCard),
    radiusCard: num(raw.radiusCard, 0, 48),
    radiusBtn: num(raw.radiusBtn, 0, 32),
    radiusTile: num(raw.radiusTile, 0, 36),
    radiusDock: num(raw.radiusDock, 0, 32),
    cardBlurPx: num(raw.cardBlurPx, 0, 40),
    glowIntensity: num(raw.glowIntensity, 0, 100),
    fontFamily: inList(FONT_IDS, raw.fontFamily) ? raw.fontFamily : null,
    fontWeight: snapWeight(raw.fontWeight),
    letterSpacing: num(raw.letterSpacing, -1, 6, false),
    lineHeight: num(raw.lineHeight, 1, 2.2, false),
  };
}

function snapWeight(v: unknown): number | null {
  const n = num(v, 300, 900);
  if (n === null) return null;
  return Math.round(n / 100) * 100;
}

export function coerceStateStyle(raw: unknown): StateStyle {
  if (!isObj(raw)) return { ...EMPTY_STATE_STYLE };
  return {
    bg: coercePaint(raw.bg),
    borderColor: safeColor(raw.borderColor),
    textColor: safeColor(raw.textColor),
    accentColor: safeColor(raw.accentColor),
    opacity: num(raw.opacity, 0, 100),
    borderWidth: num(raw.borderWidth, 0, 6),
    radius: num(raw.radius, 0, 48),
    glowLevel: num(raw.glowLevel, 0, 3),
  };
}

function isEmptyState(s: StateStyle): boolean {
  return !s.bg && !s.borderColor && !s.textColor && !s.accentColor
    && s.opacity === null && s.borderWidth === null && s.radius === null
    && s.glowLevel === null;
}

export function coerceComponentStyle(raw: unknown): ComponentStyle {
  if (!isObj(raw)) return { ...EMPTY_COMPONENT_STYLE };
  let states: Partial<Record<StateKey, StateStyle>> | null = null;
  if (isObj(raw.states)) {
    const acc: Partial<Record<StateKey, StateStyle>> = {};
    for (const k of STATE_KEYS) {
      if (!(k in raw.states)) continue;
      const st = coerceStateStyle((raw.states as Record<string, unknown>)[k]);
      if (!isEmptyState(st)) acc[k] = st;
    }
    if (Object.keys(acc).length > 0) states = acc;
  }
  return {
    visible: bool(raw.visible),
    bg: coercePaint(raw.bg),
    borderColor: safeColor(raw.borderColor),
    borderWidth: num(raw.borderWidth, 0, 6),
    radius: num(raw.radius, 0, 48),
    textColor: safeColor(raw.textColor),
    textSecondaryColor: safeColor(raw.textSecondaryColor),
    textTertiaryColor: safeColor(raw.textTertiaryColor),
    accentColor: safeColor(raw.accentColor),
    iconColor: safeColor(raw.iconColor),
    iconSize: num(raw.iconSize, 12, 48),
    fontWeight: snapWeight(raw.fontWeight),
    fontScale: num(raw.fontScale, 0.8, 1.5, false),
    letterSpacing: num(raw.letterSpacing, -1, 6, false),
    lineHeight: num(raw.lineHeight, 1, 2.2, false),
    textAlign: inList(TEXT_ALIGNS, raw.textAlign) ? raw.textAlign : null,
    /* Liste dışı değer SESSİZCE DÜŞER — ham CSS manifestten geçemez. */
    fontFamily: inList(FONT_IDS, raw.fontFamily) ? raw.fontFamily : null,
    borderStyle: inList(BORDER_STYLES, raw.borderStyle) ? raw.borderStyle : null,
    backdropBlur: num(raw.backdropBlur, 0, 24),
    transitionMs: num(raw.transitionMs, 0, 800),
    padding: num(raw.padding, 0, 40),
    gap: num(raw.gap, 0, 32),
    opacity: num(raw.opacity, 20, 100),
    glowLevel: num(raw.glowLevel, 0, 3),
    shadowLevel: num(raw.shadowLevel, 0, 3),
    states,
  };
}

export function coerceCardLayout(raw: unknown): CardLayout {
  if (!isObj(raw)) return { ...EMPTY_CARD_LAYOUT };
  return {
    visible: bool(raw.visible),
    size: inList(LAYOUT_SIZE_CLASSES, raw.size) ? raw.size : null,
    ord: num(raw.ord, 0, LAYOUT_ORD_MAX),
    grow: num(raw.grow, LAYOUT_GROW_MIN, LAYOUT_GROW_MAX, false),
    merge: bool(raw.merge),
  };
}

export function isEmptyCardLayout(l: CardLayout): boolean {
  return l.visible === null && l.size === null && l.ord === null && l.grow === null;
}

export function coerceScreenOverride(raw: unknown): ScreenOverride {
  if (!isObj(raw)) return { ...EMPTY_SCREEN_OVERRIDE };
  return {
    accentPrimary: safeColor(raw.accentPrimary),
    textPrimary: safeColor(raw.textPrimary),
    textSecondary: safeColor(raw.textSecondary),
    bg: coercePaint(raw.bg),
    radiusCard: num(raw.radiusCard, 0, 48),
  };
}

/** Boş stil (hiç override yok) mu? — manifest'i küçük tutmak ve reset için. */
export function isEmptyComponentStyle(s: ComponentStyle): boolean {
  for (const k of Object.keys(EMPTY_COMPONENT_STYLE) as (keyof ComponentStyle)[]) {
    if (k === 'states') continue;
    if (s[k] !== null) return false;
  }
  return s.states === null || Object.keys(s.states).length === 0;
}

export function isEmptyScreenOverride(s: ScreenOverride): boolean {
  return !s.accentPrimary && !s.textPrimary && !s.textSecondary && !s.bg && s.radiusCard === null;
}

/* ══ Fabrika ═════════════════════════════════════════════════════════ */

export function createThemeManifest(themeId: ThemeBaseId, updatedAt: string | null = null): ThemeManifest {
  const id: ThemeBaseId = THEME_BASE_IDS.includes(themeId) ? themeId : 'expedition';
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    themeId: id,
    themeVersion: 1,
    tokens: { ...EMPTY_TOKENS },
    componentOverrides: {},
    screenOverrides: {},
    layoutOverrides: {},
    zoneWidths: {},
    metadata: { name: THEME_PRESETS[id].label, origin: 'pwa-studio', updatedAt },
  };
}

/**
 * Fail-SOFT normalize — YEREL depo / taslak için. Hiçbir girdide throw etmez;
 * bozuk alanı düşürür, aralık dışını clamp'ler. Bilinmeyen componentId'ler
 * KORUNUR (kayıt defteri büyüyebilir; render tarafı zaten yalnız var olanı boyar).
 */
export function coerceThemeManifest(raw: unknown, fallback: ThemeBaseId = 'expedition'): ThemeManifest {
  if (!isObj(raw)) return createThemeManifest(fallback);
  const themeId: ThemeBaseId = inList(THEME_BASE_IDS, raw.themeId) ? raw.themeId : fallback;

  const componentOverrides: Record<string, ComponentStyle> = {};
  if (isObj(raw.componentOverrides)) {
    for (const [id, v] of Object.entries(raw.componentOverrides)) {
      if (!isSafeComponentId(id)) continue;
      const s = coerceComponentStyle(v);
      if (!isEmptyComponentStyle(s)) componentOverrides[id] = s;
    }
  }

  const screenOverrides: Record<string, ScreenOverride> = {};
  if (isObj(raw.screenOverrides)) {
    for (const [id, v] of Object.entries(raw.screenOverrides)) {
      if (!isSafeComponentId(id)) continue;
      const s = coerceScreenOverride(v);
      if (!isEmptyScreenOverride(s)) screenOverrides[id] = s;
    }
  }

  const layoutOverrides: Record<string, CardLayout> = {};
  if (isObj(raw.layoutOverrides)) {
    for (const [id, v] of Object.entries(raw.layoutOverrides)) {
      if (!isSafeComponentId(id)) continue;
      const l = coerceCardLayout(v);
      if (!isEmptyCardLayout(l)) layoutOverrides[id] = l;
    }
  }

  const meta = isObj(raw.metadata) ? raw.metadata : {};
  const name = typeof meta.name === 'string' && meta.name.trim().length > 0
    ? meta.name.trim().slice(0, 48)
    : THEME_PRESETS[themeId].label;
  const origin: ThemeManifestMeta['origin'] =
    meta.origin === 'pwa-studio' || meta.origin === 'car-local' ? meta.origin : 'unknown';
  const updatedAt = typeof meta.updatedAt === 'string' && ISO_RE.test(meta.updatedAt) ? meta.updatedAt : null;

  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    themeId,
    themeVersion: num(raw.themeVersion, 1, 1_000_000) ?? 1,
    tokens: coerceTokens(raw.tokens),
    componentOverrides,
    screenOverrides,
    layoutOverrides,
    zoneWidths: coerceZoneWidths(raw.zoneWidths),
    metadata: { name, origin, updatedAt },
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * componentId / screenId güvenlik kapısı — CSS seçicisine gireceği için
 * yalnız [a-z0-9-._] kabul edilir (tırnak/parantez/boşluk seçiciyi kırabilir).
 */
export function isSafeComponentId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[a-z0-9][a-z0-9._-]*$/i.test(id);
}

/* ══ Fail-CLOSED taşıma kapısı ═══════════════════════════════════════ */

export type ManifestParseResult =
  | { ok: true; manifest: ThemeManifest; migratedFrom: number | null }
  | { ok: false; reason: string };

/**
 * Araca GELEN paket için TEK kapı. Şema ihlalinde REDDEDER (fail-closed):
 * bozuk paket sessizce "uygulandı" sayılmaz — komut `failed` olur.
 *
 * Kabul edilenler:
 *  - schemaVersion === 2 → doğrudan
 *  - schemaVersion === 1 → v1 `themeVars` torbası; tanınırsa v2'ye TAŞINIR
 */
/**
 * TANINMAYAN ALAN ÖLÇÜMÜ (#659).
 *
 * ── KAPATILAN BOŞLUK ──────────────────────────────────────────────────────
 * Manifest şema sürümü BİLEREK yükseltilmiyor (yükseltilseydi eski APK'lı araç
 * manifestin TAMAMINI reddeder ve tema komple ölürdü — bkz. #654). Bunun bedeli
 * şuydu: yeni bir stil alanı ekleyip eski araca gönderdiğinizde araç o alanı
 * SESSİZCE düşürüyordu. Kullanıcı Stüdyo'da bulanıklığı açıyor, araçta hiçbir
 * şey olmuyor ve HİÇBİR YERDE sebebi yazmıyordu.
 *
 * Artık araç, tanımadığı alanların ADLARINI sayar ve bildirir. Böylece
 * "araç bunu uygulamadı" ile "araç bunu bilmiyor" AYRILIR.
 *
 * GİZLİLİK: yalnız ŞEMA ANAHTAR ADLARI toplanır (`backdropBlur` gibi) —
 * kullanıcı değeri, renk, kimlik veya payload ASLA. Liste tavanlıdır.
 */
const KNOWN_COMPONENT_KEYS: ReadonlySet<string> = new Set(Object.keys(EMPTY_COMPONENT_STYLE));
const KNOWN_STATE_KEYS: ReadonlySet<string> = new Set(Object.keys(EMPTY_STATE_STYLE));
const KNOWN_MANIFEST_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion', 'themeId', 'themeVersion', 'tokens', 'componentOverrides',
  'screenOverrides', 'layoutOverrides', 'zoneWidths', 'metadata',
]);
const UNSUPPORTED_CAP = 12;

export function collectUnsupportedKeys(raw: unknown): string[] {
  const bulunan = new Set<string>();
  if (!isObj(raw)) return [];
  for (const k of Object.keys(raw)) {
    if (!KNOWN_MANIFEST_KEYS.has(k)) bulunan.add(k);
  }
  const co = raw.componentOverrides;
  if (isObj(co)) {
    for (const stil of Object.values(co)) {
      if (!isObj(stil)) continue;
      for (const k of Object.keys(stil)) {
        if (!KNOWN_COMPONENT_KEYS.has(k)) bulunan.add(k);
      }
      const st = (stil as Record<string, unknown>).states;
      if (!isObj(st)) continue;
      for (const durum of Object.values(st)) {
        if (!isObj(durum)) continue;
        for (const k of Object.keys(durum)) {
          if (!KNOWN_STATE_KEYS.has(k)) bulunan.add(`states.${k}`);
        }
      }
    }
  }
  /* Sıralı ve tavanlı: rapor kararlı olsun, defter şişmesin. */
  /* `Array.from`: website paketi ES5 hedefliyor ve Set spread'i derlemiyor. */
  return Array.from(bulunan).sort().slice(0, UNSUPPORTED_CAP);
}

export function parseIncomingManifest(raw: unknown): ManifestParseResult {
  if (!isObj(raw)) return { ok: false, reason: 'Manifest bir nesne değil' };

  const sv = raw.schemaVersion;
  if (typeof sv !== 'number' || !Number.isFinite(sv)) {
    return { ok: false, reason: 'schemaVersion eksik veya sayı değil' };
  }
  if (sv > THEME_SCHEMA_VERSION) {
    return { ok: false, reason: `Desteklenmeyen ileri şema sürümü: ${sv} (bu araç en fazla ${THEME_SCHEMA_VERSION})` };
  }
  if (sv < THEME_SCHEMA_MIN_SUPPORTED) {
    return { ok: false, reason: `Desteklenmeyen eski şema sürümü: ${sv}` };
  }
  if (!inList(THEME_BASE_IDS, raw.themeId)) {
    return { ok: false, reason: 'themeId bilinmeyen bir tema' };
  }
  if ('tokens' in raw && raw.tokens !== undefined && !isObj(raw.tokens)) {
    return { ok: false, reason: 'tokens bir nesne değil' };
  }
  if ('componentOverrides' in raw && raw.componentOverrides !== undefined && !isObj(raw.componentOverrides)) {
    return { ok: false, reason: 'componentOverrides bir nesne değil' };
  }
  if ('screenOverrides' in raw && raw.screenOverrides !== undefined && !isObj(raw.screenOverrides)) {
    return { ok: false, reason: 'screenOverrides bir nesne değil' };
  }
  if ('layoutOverrides' in raw && raw.layoutOverrides !== undefined && !isObj(raw.layoutOverrides)) {
    return { ok: false, reason: 'layoutOverrides bir nesne değil' };
  }

  const manifest = coerceThemeManifest(raw, raw.themeId);
  return { ok: true, manifest, migratedFrom: sv === THEME_SCHEMA_VERSION ? null : sv };
}

export function serializeThemeManifest(m: ThemeManifest): string {
  return JSON.stringify(m);
}

/** JSON metni → fail-closed sonuç (parse hatası da REDDEDİLİR). */
export function parseThemeManifestJson(json: string): ManifestParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'Manifest JSON olarak çözümlenemedi' };
  }
  return parseIncomingManifest(raw);
}

/* ══ Token → CSS değişkenleri ════════════════════════════════════════ */

/**
 * Manifest tokenları → `--*` CSS değişkenleri.
 * YALNIZ kullanıcının dokunduğu (null olmayan) tokenlar döner; geri kalanı
 * temanın kendi paletine bırakılır (`var(--x, <tema hex>)` fallback'i).
 *
 * Anahtar isimleri MEVCUT tema katmanıyla birebir (geri-uyum): tema
 * layout'ları `var(--accent-primary, …)` / `rgba(var(--accent-rgb, …), a)` okur.
 */
export function manifestToCssVars(m: ThemeManifest): Record<string, string> {
  const t = m.tokens;
  const out: Record<string, string> = {};
  const put = (k: string, v: string | null | undefined) => {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  };

  if (t.accentPrimary) {
    put('--accent-primary', t.accentPrimary);
    put('--pack-accent', t.accentPrimary);
    put('--premium-accent', t.accentPrimary);
    put('--accent-blue', t.accentPrimary);
    put('--neon-accent', t.accentPrimary);
    put('--dock-icon-color-active', t.accentPrimary);
    put('--accent-rgb', colorToRgbTriplet(t.accentPrimary));
  }
  if (t.accentSecondary) put('--accent-secondary', t.accentSecondary);
  if (t.bgPrimary) {
    const css = paintToCss(t.bgPrimary);
    put('--bg-primary', css);
    put('--pack-bg', css);
  }
  if (t.bgCard) {
    const css = paintToCss(t.bgCard);
    put('--bg-card', css);
    put('--pack-card-bg', css);
  }
  if (t.textPrimary) {
    put('--text-primary', t.textPrimary);
    put('--text-primary-var', t.textPrimary);
  }
  if (t.textSecondary) {
    put('--text-secondary', t.textSecondary);
    put('--text-secondary-var', t.textSecondary);
  }
  if (t.borderColor) {
    put('--border-color', t.borderColor);
    put('--pack-border', t.borderColor);
  }
  if (t.glowColor) {
    put('--accent-glow', t.glowColor);
    put('--pack-glow', t.glowColor);
  }
  if (t.successColor) put('--color-success', t.successColor);
  if (t.warningColor) put('--color-warning', t.warningColor);
  if (t.errorColor) put('--color-error', t.errorColor);
  if (t.iconNav) put('--icon-color-nav', t.iconNav);
  if (t.iconMedia) put('--icon-color-media', t.iconMedia);
  if (t.iconDock) put('--dock-icon-color', t.iconDock);

  if (t.radiusCard !== null) {
    put('--radius-card', `${t.radiusCard}px`);
    put('--card-radius', `${t.radiusCard}px`);
  }
  if (t.radiusBtn !== null) put('--radius-btn', `${t.radiusBtn}px`);
  if (t.radiusTile !== null) put('--radius-tile', `${t.radiusTile}px`);
  if (t.radiusDock !== null) put('--radius-dock', `${t.radiusDock}px`);
  if (t.cardBlurPx !== null) {
    put('--card-blur', `${t.cardBlurPx}px`);
    put('--glass-blur', `blur(${t.cardBlurPx}px)`);
  }
  if (t.glowIntensity !== null) put('--glow-intensity', String(t.glowIntensity));
  if (t.fontFamily) put('--font-ui', FONT_STACKS[t.fontFamily]);
  if (t.fontWeight !== null) put('--font-weight-ui', String(t.fontWeight));
  if (t.letterSpacing !== null) put('--letter-spacing-ui', `${t.letterSpacing}px`);
  if (t.lineHeight !== null) put('--line-height-ui', String(t.lineHeight));

  return out;
}

/** Manifest'in HİÇ dokunmadığı ama daha önce set edilmiş olabilecek var'ların tam listesi. */
export const ALL_MANAGED_CSS_VARS: readonly string[] = [
  '--accent-primary', '--accent-rgb', '--accent-secondary', '--pack-accent', '--premium-accent',
  '--accent-blue', '--neon-accent', '--dock-icon-color-active',
  '--bg-primary', '--pack-bg', '--bg-card', '--pack-card-bg',
  '--text-primary', '--text-primary-var', '--text-secondary', '--text-secondary-var',
  '--border-color', '--pack-border', '--accent-glow', '--pack-glow',
  '--color-success', '--color-warning', '--color-error',
  '--icon-color-nav', '--icon-color-media', '--dock-icon-color',
  '--radius-card', '--card-radius', '--radius-btn', '--radius-tile', '--radius-dock',
  '--card-blur', '--glass-blur', '--glow-intensity',
  '--font-ui', '--font-weight-ui', '--letter-spacing-ui', '--line-height-ui',
];

/* ══ Bileşen stili → CSS ═════════════════════════════════════════════ */

/** Durum → GERÇEK DOM kancası. Uydurma `[data-state]` sözleşmesi KURULMAZ. */
const STATE_SELECTOR_SUFFIX: Record<StateKey, string[]> = {
  active: [':active', '[data-active="true"]'],
  selected: ['[aria-selected="true"]', '[data-selected="true"]'],
  disabled: [':disabled', '[aria-disabled="true"]'],
  loading: ['[aria-busy="true"]'],
  error: ['[aria-invalid="true"]', '[data-error="true"]'],
};

function glowShadow(color: string, level: number): string {
  if (level <= 0) return '';
  const map: Record<number, string> = {
    1: `0 0 14px ${withAlpha(color, 0.33)}`,
    2: `0 0 28px ${withAlpha(color, 0.47)}, 0 0 56px ${withAlpha(color, 0.2)}`,
    3: `0 0 40px ${withAlpha(color, 0.6)}, 0 0 80px ${withAlpha(color, 0.27)}`,
  };
  return map[Math.min(3, Math.round(level))] ?? '';
}

function depthShadow(level: number): string {
  const map: Record<number, string> = {
    0: '',
    1: '0 4px 20px rgba(0, 0, 0, 0.55)',
    2: '0 8px 36px rgba(0, 0, 0, 0.75)',
    3: '0 16px 56px rgba(0, 0, 0, 0.9)',
  };
  return map[Math.min(3, Math.max(0, Math.round(level)))] ?? '';
}

/** Tek bileşenin CSS bloğu. Deterministik sıra; her değer bu dosyada üretilir. */
/**
 * Seçici ÖZGÜLLÜĞÜ — saha ölçümüyle belirlendi (cihaz: Redmi Note 13, compat mod).
 *
 * ÖLÇÜLEN KUSUR: düz `[data-editable="x"]` özgüllüğü (0,1,0)'dır ve uygulamadaki
 * `html[data-compat-mode="true"] *` kuralı (0,1,1) onu YENER. Sonuç: kullanıcının
 * Stüdyo'da seçtiği arka plan/gradient ve köşe yarıçapı araca gidiyor, CSS
 * üretiliyor, ama EKRANDA HİÇBİR ŞEY OLMUYORDU — yalnız `color` geçiyordu
 * (o özellik compat kuralında yok). Sessiz başarısızlık.
 *
 * ÇÖZÜM: aynı özniteliği iki kez + `html` ile (0,2,1) → mevcut `!important`
 * katmanlarının üstüne çıkar. Yeni bir katman/`@layer` KURULMAZ; yalnız
 * kullanıcının açık seçimi, kör genel kuralın önüne geçer.
 */
function editableSelector(id: string): string {
  return `html [data-editable="${id}"][data-editable]`;
}

export function componentStyleToCss(id: string, s: ComponentStyle): string {
  if (!isSafeComponentId(id)) return '';
  const sel = editableSelector(id);
  const decls: string[] = [];

  if (s.visible === false) decls.push('display: none !important;');
  if (s.bg) decls.push(`background: ${paintToCss(s.bg)} !important;`);
  if (s.borderColor) decls.push(`border-color: ${s.borderColor} !important;`);
  if (s.borderWidth !== null) {
    decls.push(`border-width: ${s.borderWidth}px !important;`);
    /* Desen seçilmediyse eski davranış BİREBİR korunur (`solid`). */
    decls.push(`border-style: ${s.borderStyle ?? 'solid'} !important;`);
  } else if (s.borderStyle) {
    /* Kalınlık verilmemiş ama desen seçilmişse deseni yine uygula — kullanıcı
       mevcut kalınlığı korumak isteyebilir; sahte bir kalınlık UYDURULMAZ. */
    decls.push(`border-style: ${s.borderStyle} !important;`);
  }
  if (s.radius !== null) decls.push(`border-radius: ${s.radius}px !important;`);
  /* YAZI RENGİ — `color` TEK BAŞINA YETMEZ (saha kusuru, 2026-08-19).
   *
   * KULLANICI: *"yazılar renk değiştirmiyor"*. Ölçüm: tema düzenleri yazı
   * rengini INLINE STYLE ile verir ve değeri paletten alır; palet ise
   * değişkene bağlıdır:
   *     ink:  'var(--text-primary,  #EDE4D2)'
   *     ink2: 'var(--text-secondary, #A89678)'
   * Yani her yazı düğümü kendi `color`unu KENDİ üzerinde tanımlar → kartın
   * kökündeki `color` bildirimi ona ASLA miras kalmaz. `--text-primary` ise
   * yalnız `<html>` üzerinde tanımlıydı, kart üzerinde DEĞİL → kullanıcının
   * seçtiği renk hiçbir yazıya ulaşmıyordu. (`--text-secondary` zaten
   * yazılıyordu; ölü olan BİRİNCİL yoldu.)
   *
   * Çözüm paletin ZATEN okuduğu kanaldan gider: değişken kartın kökünde
   * tanımlanır, alt yazılar miras alır. Blanket `sel *` kuralı BİLEREK
   * kullanılmadı — o kural uyarı/kritik renkleri de ezerdi (`var(--oem-warn)`,
   * `inkCritical`), yani güvenlik anlamını yok ederdi. Bu yolla anlamlı
   * renkler doğası gereği korunur.
   *
   * `color` bildirimi de KORUNUR: değişkeni kullanmayan, rengi miras alan
   * düğümler (düz metin, `currentColor`) onunla boyanır. */
  if (s.textColor) {
    decls.push(`color: ${s.textColor} !important;`);
    decls.push(`--text-primary: ${s.textColor};`);
  }
  if (s.textSecondaryColor) decls.push(`--text-secondary: ${s.textSecondaryColor};`);
  /* Üçüncül renk: paletlerdeki `ink3` bu değişkeni okur (#654). Değişken
     olmadan o yazılar SABİT hex'te kalıyor ve hiçbir ayara tepki vermiyordu. */
  if (s.textTertiaryColor) decls.push(`--text-tertiary: ${s.textTertiaryColor};`);
  if (s.accentColor) {
    decls.push(`--pack-accent: ${s.accentColor};`);
    const rgb = colorToRgbTriplet(s.accentColor);
    if (rgb) decls.push(`--accent-rgb: ${rgb};`);
    decls.push(`--accent-primary: ${s.accentColor};`);
  }
  if (s.fontWeight !== null) decls.push(`font-weight: ${s.fontWeight} !important;`);
  if (s.fontScale !== null) decls.push(`font-size: ${s.fontScale}em !important;`);
  if (s.fontFamily) {
    /* Yığın SABİT tablodan gelir; manifest ham CSS TAŞIMAZ (enjeksiyon yüzeyi yok). */
    decls.push(`font-family: ${FONT_STACKS[s.fontFamily]} !important;`);
  }
  if (s.letterSpacing !== null) decls.push(`letter-spacing: ${s.letterSpacing}px !important;`);
  if (s.lineHeight !== null) decls.push(`line-height: ${s.lineHeight} !important;`);
  if (s.textAlign) decls.push(`text-align: ${s.textAlign} !important;`);
  if (s.padding !== null) decls.push(`padding: ${s.padding}px !important;`);
  if (s.gap !== null) decls.push(`gap: ${s.gap}px !important;`);
  if (s.opacity !== null) decls.push(`opacity: ${s.opacity / 100} !important;`);
  if (s.backdropBlur !== null && s.backdropBlur > 0) {
    /* RUNTIME BÜTÇESİNE ABONE: `--rt-blur` düşük uçta (Mali-400 sınıfı) 0'dır →
       çarpım 0px olur ve GPU stall OLUŞMAZ. Ürünün mevcut deseninin aynısı;
       ikinci bir bütçe mekanizması KURULMAZ. */
    const b = `calc(var(--rt-blur, 1) * ${s.backdropBlur}px)`;
    decls.push(`backdrop-filter: blur(${b}) !important;`, `-webkit-backdrop-filter: blur(${b}) !important;`);
  }
  if (s.transitionMs !== null) {
    /* 0 = animasyon YOK (hareket duyarlılığı / düşük uç). `none` yerine 0ms
       yazılır ki mevcut geçiş tanımları ezilsin. */
    decls.push(`transition-duration: ${s.transitionMs}ms !important;`);
  }

  const glowColor = s.accentColor ?? s.borderColor ?? s.textColor;
  const parts = [
    s.glowLevel !== null && glowColor ? glowShadow(glowColor, s.glowLevel) : '',
    s.shadowLevel !== null ? depthShadow(s.shadowLevel) : '',
  ].filter(Boolean);
  if (parts.length > 0) decls.push(`box-shadow: ${parts.join(', ')} !important;`);
  else if (s.shadowLevel === 0) decls.push('box-shadow: none !important;');

  const blocks: string[] = [];
  if (decls.length > 0) blocks.push(`${sel} {\n  ${decls.join('\n  ')}\n}`);

  // İkon rengi/boyutu → içerideki svg'lere (lucide `currentColor` kullanır ama
  // bazı ikonlar sabit fill alır; her ikisini de hedefle).
  const iconDecls: string[] = [];
  if (s.iconColor) iconDecls.push(`color: ${s.iconColor} !important;`, `stroke: ${s.iconColor} !important;`);
  if (s.iconSize !== null) iconDecls.push(`width: ${s.iconSize}px !important;`, `height: ${s.iconSize}px !important;`);
  if (iconDecls.length > 0) blocks.push(`${sel} svg {\n  ${iconDecls.join('\n  ')}\n}`);

  // Yazı ağırlığı/hizası alt metinlere de geçsin (kart içi etiketler).
  if (s.fontWeight !== null) blocks.push(`${sel} * {\n  font-weight: ${s.fontWeight} !important;\n}`);
  if (s.fontFamily) {
    blocks.push(`${sel} * { font-family: ${FONT_STACKS[s.fontFamily]} !important; }`);
  }

  if (s.states) {
    for (const key of STATE_KEYS) {
      const st = s.states[key];
      if (!st) continue;
      const stDecls: string[] = [];
      if (st.bg) stDecls.push(`background: ${paintToCss(st.bg)} !important;`);
      if (st.borderColor) stDecls.push(`border-color: ${st.borderColor} !important;`);
      if (st.textColor) stDecls.push(`color: ${st.textColor} !important;`);
      if (st.accentColor) stDecls.push(`--pack-accent: ${st.accentColor};`);
      if (st.opacity !== null) stDecls.push(`opacity: ${st.opacity / 100} !important;`);
      if (st.borderWidth !== null) {
        stDecls.push(`border-width: ${st.borderWidth}px !important;`);
        /* Desen ana stilden miras alınır; durum başına desen YOKTUR (gereksiz
           genişleme). Kalınlık verildiyse stil `solid` DEĞİL, ana stilin
           seçimi geçerli kalsın diye burada yazılmaz. */
      }
      if (st.radius !== null) stDecls.push(`border-radius: ${st.radius}px !important;`);
      if (st.glowLevel !== null) {
        /* Parıltı rengi durum → ana stil sırasıyla çözülür; hiçbiri yoksa
           parıltı YAZILMAZ (renksiz gölge sahte bir efekt olurdu). */
        const gc = st.accentColor ?? st.borderColor ?? st.textColor
          ?? s.accentColor ?? s.borderColor ?? s.textColor;
        if (gc) {
          const g = glowShadow(gc, st.glowLevel);
          if (g) stDecls.push(`box-shadow: ${g} !important;`);
          else if (st.glowLevel === 0) stDecls.push('box-shadow: none !important;');
        }
      }
      if (stDecls.length === 0) continue;
      const selectors = STATE_SELECTOR_SUFFIX[key].map((suffix) => `${sel}${suffix}`).join(',\n');
      blocks.push(`${selectors} {\n  ${stDecls.join('\n  ')}\n}`);
    }
  }

  return blocks.join('\n');
}

/** Ekran düzeyi override → o ekranın kökünde (`[data-theme-surface="id"]`) CSS. */
export function screenOverrideToCss(id: string, s: ScreenOverride): string {
  if (!isSafeComponentId(id)) return '';
  // Bileşen seçicisiyle AYNI özgüllük gerekçesi (bkz. editableSelector).
  const sel = `html [data-theme-surface="${id}"][data-theme-surface]`;
  const decls: string[] = [];
  if (s.accentPrimary) {
    decls.push(`--accent-primary: ${s.accentPrimary};`, `--pack-accent: ${s.accentPrimary};`);
    const rgb = colorToRgbTriplet(s.accentPrimary);
    if (rgb) decls.push(`--accent-rgb: ${rgb};`);
  }
  if (s.textPrimary) decls.push(`--text-primary: ${s.textPrimary};`);
  if (s.textSecondary) decls.push(`--text-secondary: ${s.textSecondary};`);
  if (s.bg) decls.push(`--bg-primary: ${paintToCss(s.bg)};`);
  if (s.radiusCard !== null) decls.push(`--radius-card: ${s.radiusCard}px;`, `--card-radius: ${s.radiusCard}px;`);
  if (decls.length === 0) return '';
  return `${sel} {\n  ${decls.join('\n  ')}\n}`;
}

/** Tüm manifest → tek CSS metni (deterministik: id'ler alfabetik). */
export function manifestToCss(m: ThemeManifest): string {
  const blocks: string[] = [];
  for (const id of Object.keys(m.screenOverrides).sort()) {
    const css = screenOverrideToCss(id, m.screenOverrides[id]);
    if (css) blocks.push(css);
  }
  for (const id of Object.keys(m.componentOverrides).sort()) {
    const css = componentStyleToCss(id, m.componentOverrides[id]);
    if (css) blocks.push(css);
  }
  return blocks.join('\n\n');
}

/* ══ Yerleşim → solver niyeti ════════════════════════════════════════ */

/**
 * Manifest yerleşim override'ları → `layoutSolver.normalizeIntent`in beklediği
 * HAM niyet blob'u (kısmi). Yalnız kullanıcının dokunduğu alanlar konur; solver
 * eksikleri kendi varsayılanından tamamlar → hiç dokunulmamışsa ekran aynı kalır.
 *
 * Çıktı bilerek `Record<string, Record<string, unknown>>`dur: bu dosya
 * layoutSolver'ı IMPORT ETMEZ (saf sözleşme katmanı, tek yönlü bağımlılık).
 */
export function manifestToLayoutIntent(m: ThemeManifest): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const id of Object.keys(m.layoutOverrides).sort()) {
    const l = m.layoutOverrides[id];
    const partial: Record<string, unknown> = {};
    if (l.visible !== null) partial.visible = l.visible;
    if (l.size !== null) partial.size = l.size;
    if (l.ord !== null) partial.ord = l.ord;
    // growCustom: solver'da `null` "boyut sınıfından türet" demektir; kullanıcı
    // elle boyutu geri alınca null göndeririz, dokunmadıysa alanı hiç koymayız.
    if (l.grow !== null) partial.growCustom = l.grow;
    if (l.merge !== null) partial.mergeNext = l.merge;
    if (Object.keys(partial).length > 0) out[id] = partial;
  }
  return out;
}

/** Manifest'te kaç yerleşim override'ı var (gözlem sayacı). */
export function layoutOverrideCount(m: ThemeManifest): number {
  return Object.keys(m.layoutOverrides).length;
}

/* ══ v1 → v2 taşıma ══════════════════════════════════════════════════
   Eski Tema Stüdyo `themeVars` torbası (yalnız CSS var'ları) — araç eski
   PWA sürümünden paket alabilir. Tanınan var'lar tokenlara çevrilir.       */

export function migrateLegacyThemeVars(
  vars: Record<string, unknown> | null | undefined,
  themeId: ThemeBaseId,
): ThemeManifest {
  const m = createThemeManifest(themeId);
  if (!isObj(vars)) return m;
  const read = (k: string): string | null => safeColor(vars[k]);
  const px = (k: string, min: number, max: number): number | null => {
    const v = vars[k];
    if (typeof v !== 'string') return num(v, min, max);
    return num(parseFloat(v), min, max);
  };
  m.tokens.accentPrimary = read('--accent-primary');
  m.tokens.accentSecondary = read('--accent-secondary');
  m.tokens.textPrimary = read('--text-primary');
  m.tokens.textSecondary = read('--text-secondary');
  m.tokens.borderColor = read('--border-color');
  m.tokens.glowColor = read('--accent-glow');
  m.tokens.iconNav = read('--icon-color-nav');
  m.tokens.iconMedia = read('--icon-color-media');
  m.tokens.iconDock = read('--dock-icon-color');
  const bg = read('--bg-primary');
  if (bg) m.tokens.bgPrimary = makeSolid(bg);
  const card = read('--bg-card');
  if (card) m.tokens.bgCard = makeSolid(card);
  m.tokens.radiusCard = px('--radius-card', 0, 48);
  m.tokens.radiusBtn = px('--radius-btn', 0, 32);
  m.tokens.radiusTile = px('--radius-tile', 0, 36);
  m.tokens.radiusDock = px('--radius-dock', 0, 32);
  m.tokens.cardBlurPx = px('--card-blur', 0, 40);
  m.tokens.fontWeight = snapWeight(vars['--font-weight-ui']);
  m.tokens.letterSpacing = px('--letter-spacing-ui', -1, 6);
  m.metadata.origin = 'pwa-studio';
  return m;
}
