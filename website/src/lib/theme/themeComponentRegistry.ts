/**
 * Tema Bileşen Kayıt Defteri — düzenlenebilir yüzeylerin TEK kimlik kaynağı (PWA kopyası).
 *
 * Araç kopyası: src/platform/theme/themeComponentRegistry.ts — ilk yorum bloğu
 * dışında BİREBİR aynıdır (themeManifestParity testi kilitler).
 *
---8<--- PARITY-START --->8---
 *
 * KİMLİK KURALI (kırılganlık karşıtı): tema, DOM seçicisine veya CSS sınıf adına
 * DEĞİL, kararlı `componentId`'ye bağlanır. Bir bileşenin Tailwind sınıfı değişince
 * tema BOZULMAZ; yalnız `data-editable="<componentId>"` özniteliği taşınır.
 *
 * DÜRÜSTLÜK KURALI: bu defterde YALNIZ kodda GERÇEKTEN `data-editable` ile
 * işaretlenmiş bileşenler bulunur. "İleride yaparız" girdisi YOKTUR —
 * `themeRegistryWiring` testi her id'nin kaynak kodda geçtiğini doğrular.
 */

import type { ThemeBaseId } from './themeManifest';

/* ── Ekranlar (surface) ───────────────────────────────────────────── */

export type ThemeSurfaceId =
  | 'home'
  | 'settings'
  | 'diagnostics'
  | 'maintenance'
  | 'notifications'
  | 'weather'
  | 'security'
  | 'dashcam'
  | 'sport'
  | 'trip';

export interface ThemeSurfaceInfo {
  id: ThemeSurfaceId;
  label: string;
  /** Bu ekranın hangi temalarda ayrı bir görünümü var (home tema başına değişir). */
  perTheme: boolean;
}

export const THEME_SURFACES: readonly ThemeSurfaceInfo[] = [
  { id: 'home', label: 'Ana Ekran', perTheme: true },
  { id: 'settings', label: 'Ayarlar', perTheme: false },
  { id: 'diagnostics', label: 'Arıza Kodları (DTC)', perTheme: false },
  { id: 'maintenance', label: 'Bakım', perTheme: false },
  { id: 'notifications', label: 'Bildirimler', perTheme: false },
  { id: 'weather', label: 'Hava Durumu', perTheme: false },
  { id: 'security', label: 'Güvenlik Paketi', perTheme: false },
  { id: 'dashcam', label: 'Dashcam', perTheme: false },
  { id: 'sport', label: 'Spor Modu', perTheme: false },
  { id: 'trip', label: 'Seyahat Kaydı', perTheme: false },
];

/* ── Bileşen tipleri + yetenekleri ────────────────────────────────── */

export type ThemeComponentType =
  | 'header'
  | 'card'
  | 'gauge'
  | 'map'
  | 'media'
  | 'dock'
  | 'panel';

/** Editörde gösterilecek düzenlenebilir özellik anahtarları (ComponentStyle alanları). */
export type EditableProp =
  | 'bg'
  | 'borderColor'
  | 'borderWidth'
  | 'radius'
  | 'textColor'
  | 'textSecondaryColor'
  | 'accentColor'
  | 'iconColor'
  | 'iconSize'
  | 'fontWeight'
  | 'fontScale'
  | 'letterSpacing'
  | 'lineHeight'
  | 'textAlign'
  | 'padding'
  | 'gap'
  | 'opacity'
  | 'glowLevel'
  | 'shadowLevel'
  | 'visible'
  | 'states';

const SURFACE_PROPS: EditableProp[] = [
  'bg', 'borderColor', 'borderWidth', 'radius', 'opacity', 'glowLevel', 'shadowLevel',
];
const TEXT_PROPS: EditableProp[] = [
  'textColor', 'textSecondaryColor', 'fontWeight', 'fontScale', 'letterSpacing', 'lineHeight', 'textAlign',
];
const ICON_PROPS: EditableProp[] = ['iconColor', 'iconSize'];
const BOX_PROPS: EditableProp[] = ['padding', 'gap'];

/**
 * Tip → desteklenen özellikler. "Her bileşen her özelliği desteklemek zorunda
 * değil" kuralı burada YAŞAR: harita kartında yazı ölçeği yoktur (harita canvas),
 * göstergede padding yoktur (mutlak konumlu yay), dock gizlenemez (locked).
 */
export const PROPS_BY_TYPE: Record<ThemeComponentType, EditableProp[]> = {
  header: [...SURFACE_PROPS, ...TEXT_PROPS, ...ICON_PROPS, ...BOX_PROPS, 'accentColor'],
  card: [...SURFACE_PROPS, ...TEXT_PROPS, ...ICON_PROPS, ...BOX_PROPS, 'accentColor', 'visible', 'states'],
  gauge: [...SURFACE_PROPS, 'textColor', 'fontWeight', 'fontScale', 'accentColor', ...ICON_PROPS],
  map: [...SURFACE_PROPS, 'accentColor', ...ICON_PROPS],
  media: [...SURFACE_PROPS, ...TEXT_PROPS, ...ICON_PROPS, ...BOX_PROPS, 'accentColor', 'visible', 'states'],
  dock: [...SURFACE_PROPS, ...ICON_PROPS, ...BOX_PROPS, 'accentColor', 'states'],
  panel: [...SURFACE_PROPS, ...TEXT_PROPS, ...ICON_PROPS, ...BOX_PROPS, 'accentColor', 'visible', 'states'],
};

/* ── Kayıt defteri ────────────────────────────────────────────────── */

export interface ThemeComponentInfo {
  id: string;
  surface: ThemeSurfaceId;
  type: ThemeComponentType;
  label: string;
  /**
   * Bu bileşenin hangi temalarda var olduğu. `null` = tüm temalarda ortak
   * (tema-bağımsız ekranlar: ayarlar, bakım, bildirim, çekmece modülleri).
   */
  themes: ThemeBaseId[] | null;
  /** Güvenlik/chrome: gizlenemez (hız göstergesi, harita, dock). */
  locked?: boolean;
  /**
   * Bu bileşenin `layoutSolver` manifestindeki KART id'si — yerleşim
   * override'ının anahtarı. YALNIZ solver'ı fiilen kullanan temalarda vardır
   * (ProLayout · ExpeditionLayout). Yoksa yerleşim düzenlenemez ve arayüz
   * yerleşim bölümünü GÖSTERMEZ (sahte alan üretilmez).
   */
  layoutCardId?: string;
}

/**
 * `layoutSolver`ı fiilen kullanan temalar. Horizon ve Tesla sabit grid ile
 * çizilir (`HorizonLayout`/`TeslaLayout` solver'ı import ETMEZ) → o temalarda
 * yerleşim düzenleme YOKTUR. Bu liste kod gerçeğidir, tercih değildir.
 */
export const LAYOUT_CAPABLE_THEMES: readonly ThemeBaseId[] = ['pro', 'expedition'];

export function isLayoutCapableTheme(themeId: ThemeBaseId): boolean {
  return (LAYOUT_CAPABLE_THEMES as readonly string[]).includes(themeId);
}

/** Temaya özgü ana ekran kartları — id deseni: `<themeId>.<kart>`. */
const HOME_COMPONENTS: ThemeComponentInfo[] = [
  // ── Expedition ──
  { id: 'expedition.header', surface: 'home', type: 'header', label: 'Üst Bar', themes: ['expedition'] },
  { id: 'expedition.speed', surface: 'home', type: 'gauge', label: 'Hız & Saat Plakası', themes: ['expedition'], locked: true, layoutCardId: 'speed' },
  { id: 'expedition.range', surface: 'home', type: 'card', label: 'Menzil Plakası', themes: ['expedition'], layoutCardId: 'range' },
  { id: 'expedition.map', surface: 'home', type: 'map', label: 'Harita Plakası', themes: ['expedition'], locked: true, layoutCardId: 'map' },
  { id: 'expedition.music', surface: 'home', type: 'media', label: 'Müzik Plakası', themes: ['expedition'], layoutCardId: 'music' },
  { id: 'expedition.vehicle', surface: 'home', type: 'card', label: 'Araç Durumu Plakası', themes: ['expedition'], layoutCardId: 'vehicle' },
  { id: 'expedition.clock', surface: 'home', type: 'card', label: 'Marka Saati', themes: ['expedition'] },
  { id: 'expedition.dock', surface: 'home', type: 'dock', label: 'Dock Bar', themes: ['expedition'], locked: true, layoutCardId: 'dock' },
  /* Dock butonları TOPLUCA. Aynı kimlik 17 butonda birden bulunur; tek CSS
     kuralı hepsine iner. Ölçüm (probe) `querySelector` kullandığı için Stüdyo
     overlay'inde YALNIZ İLK buton kutusu görünür — bu bilinen ve beyan edilen
     sınırdır, sahte bir "her buton ayrı" iddiası kurulmaz. */
  { id: 'expedition.dock-buttons', surface: 'home', type: 'dock', label: 'Dock Butonları (tümü)', themes: ['expedition'] },
  // ── Horizon ──
  { id: 'horizon.topbar', surface: 'home', type: 'header', label: 'Üst Bar', themes: ['horizon'] },
  { id: 'horizon.drivemode', surface: 'home', type: 'card', label: 'Sürüş Modu Kartı', themes: ['horizon'] },
  { id: 'horizon.speed', surface: 'home', type: 'gauge', label: 'Hız Kartı', themes: ['horizon'], locked: true },
  { id: 'horizon.range', surface: 'home', type: 'card', label: 'Menzil Kartı', themes: ['horizon'] },
  { id: 'horizon.consumption', surface: 'home', type: 'card', label: 'Tüketim Kartı', themes: ['horizon'] },
  { id: 'horizon.map', surface: 'home', type: 'map', label: 'Harita (Hero)', themes: ['horizon'], locked: true },
  { id: 'horizon.media', surface: 'home', type: 'media', label: 'Medya Kartı', themes: ['horizon'] },
  { id: 'horizon.vehicle', surface: 'home', type: 'card', label: 'Araç Durumu', themes: ['horizon'] },
  { id: 'horizon.dock', surface: 'home', type: 'dock', label: 'Dock Bar', themes: ['horizon'], locked: true },
  // ── Tesla ──
  { id: 'tesla.status', surface: 'home', type: 'header', label: 'Durum Kümesi', themes: ['tesla'] },
  { id: 'tesla.clock', surface: 'home', type: 'card', label: 'Saat Kartı', themes: ['tesla'] },
  { id: 'tesla.speed', surface: 'home', type: 'gauge', label: 'Hız Göstergesi', themes: ['tesla'], locked: true },
  { id: 'tesla.fuel', surface: 'home', type: 'card', label: 'Yakıt Kartı', themes: ['tesla'] },
  { id: 'tesla.map', surface: 'home', type: 'map', label: 'Harita Kartı', themes: ['tesla'], locked: true },
  { id: 'tesla.music', surface: 'home', type: 'media', label: 'Müzik Kartı', themes: ['tesla'] },
  { id: 'tesla.vehicle', surface: 'home', type: 'card', label: 'Araç Kartı', themes: ['tesla'] },
  { id: 'tesla.dock', surface: 'home', type: 'dock', label: 'Dock Bar', themes: ['tesla'], locked: true },
  // ── Glass Pro ──
  { id: 'pro.clock', surface: 'home', type: 'card', label: 'Saat Kartı', themes: ['pro'], layoutCardId: 'clock' },
  { id: 'pro.gauge', surface: 'home', type: 'gauge', label: 'Hız & Menzil', themes: ['pro'], locked: true, layoutCardId: 'gauge' },
  { id: 'pro.settings', surface: 'home', type: 'card', label: 'Ayarlar Kartı', themes: ['pro'], layoutCardId: 'settings' },
  { id: 'pro.map', surface: 'home', type: 'map', label: 'Harita Kartı', themes: ['pro'], locked: true, layoutCardId: 'nav' },
  { id: 'pro.music', surface: 'home', type: 'media', label: 'Müzik Kartı', themes: ['pro'], layoutCardId: 'music' },
  { id: 'pro.vehicle', surface: 'home', type: 'card', label: 'Araç Durumu', themes: ['pro'], layoutCardId: 'vehicle' },
  { id: 'pro.dock', surface: 'home', type: 'dock', label: 'Dock Bar', themes: ['pro'], locked: true, layoutCardId: 'dock' },
];

/** Tema-bağımsız ekranlar (her temada aynı bileşen render edilir). */
const SHARED_COMPONENTS: ThemeComponentInfo[] = [
  { id: 'settings-page', surface: 'settings', type: 'panel', label: 'Ayarlar Sayfası (tüm sayfa)', themes: null },
  /* AYARLARIN İÇ YAPISI (2026-08-18) — kullanıcı: *"ayarlarda istediğim yeri
     düzenleyemiyorum"*. Ölçüm: ana ekranda 33 düzenlenebilir bileşen vardı,
     ayarlarda YALNIZ 1 (tüm sayfa tek panel). Bu girdiler sayfanın gerçek
     yapı taşlarını açar. "(tümü)" etiketi bilerek yazılıdır: bir kimlik
     ekranda birden çok düğüme iner ve tek CSS kuralı HEPSİNE uygulanır —
     Stüdyo overlay'i her örneği ayrı dokunma alanı olarak çizer, ama hepsi
     aynı düzenleyiciyi açar (sahte "her biri ayrı" iddiası KURULMAZ). */
  { id: 'settings.header', surface: 'settings', type: 'header', label: 'Üst Bar (Geri + Başlık)', themes: null },
  { id: 'settings.nav-item', surface: 'settings', type: 'card', label: 'Kategori Menüsü Öğeleri (tümü)', themes: null },
  { id: 'settings.hero', surface: 'settings', type: 'header', label: 'Sayfa Başlığı', themes: null },
  { id: 'settings.section-title', surface: 'settings', type: 'header', label: 'Bölüm Başlıkları (tümü)', themes: null },
  { id: 'settings.panel', surface: 'settings', type: 'panel', label: 'Kart Kabı (tümü)', themes: null },
  { id: 'settings.tile', surface: 'settings', type: 'card', label: 'Ayar Kartları (tümü)', themes: null },
  { id: 'settings.toggle', surface: 'settings', type: 'card', label: 'Aç/Kapa Anahtarları (tümü)', themes: null },
  { id: 'settings.slider', surface: 'settings', type: 'card', label: 'Kaydırıcılar (tümü)', themes: null },
  { id: 'dtc-panel', surface: 'diagnostics', type: 'panel', label: 'Arıza Kodu Paneli', themes: null },
  { id: 'maintenance-panel', surface: 'maintenance', type: 'panel', label: 'Bakım Paneli', themes: null },
  { id: 'notification-center', surface: 'notifications', type: 'panel', label: 'Bildirim Merkezi', themes: null },
  { id: 'weather-card', surface: 'weather', type: 'card', label: 'Hava Durumu', themes: null },
  { id: 'security-suite', surface: 'security', type: 'card', label: 'Güvenlik Paketi', themes: null },
  { id: 'dashcam', surface: 'dashcam', type: 'card', label: 'Dashcam', themes: null },
  { id: 'sport-mode', surface: 'sport', type: 'card', label: 'Spor Modu', themes: null },
  { id: 'trip-log', surface: 'trip', type: 'card', label: 'Seyahat Kaydı', themes: null },
];

export const THEME_COMPONENTS: readonly ThemeComponentInfo[] = [...HOME_COMPONENTS, ...SHARED_COMPONENTS];

const BY_ID: Record<string, ThemeComponentInfo> = (() => {
  const m: Record<string, ThemeComponentInfo> = {};
  for (const c of THEME_COMPONENTS) m[c.id] = c;
  return m;
})();

export function getThemeComponent(id: string): ThemeComponentInfo | null {
  return BY_ID[id] ?? null;
}

/** Bir tema için düzenlenebilir bileşenler (o temaya ait + tema-bağımsız olanlar). */
export function componentsForTheme(themeId: ThemeBaseId): ThemeComponentInfo[] {
  return THEME_COMPONENTS.filter((c) => c.themes === null || c.themes.includes(themeId));
}

/** Bir tema + ekran için bileşenler (Stüdyo'nun ekran gezinmesi bunu kullanır). */
export function componentsForSurface(themeId: ThemeBaseId, surface: ThemeSurfaceId): ThemeComponentInfo[] {
  return componentsForTheme(themeId).filter((c) => c.surface === surface);
}

/** Bir temada gerçekten içerik barındıran ekranlar. */
export function surfacesForTheme(themeId: ThemeBaseId): ThemeSurfaceInfo[] {
  return THEME_SURFACES.filter((s) => componentsForSurface(themeId, s.id).length > 0);
}

/** Bileşenin desteklediği düzenlenebilir özellikler (kilitliyse `visible` düşer). */
export function propsForComponent(info: ThemeComponentInfo): EditableProp[] {
  const base = PROPS_BY_TYPE[info.type] ?? PROPS_BY_TYPE.card;
  return info.locked ? base.filter((p) => p !== 'visible') : base;
}

/**
 * Bu bileşenin yerleşimi düzenlenebilir mi?
 * İki şart birden: (a) tema solver kullanıyor, (b) bileşenin solver kart karşılığı var.
 * Şartlardan biri yoksa arayüz yerleşim bölümünü HİÇ göstermez (sahte alan yok).
 */
export function layoutCardIdFor(info: ThemeComponentInfo, themeId: ThemeBaseId): string | null {
  if (!isLayoutCapableTheme(themeId)) return null;
  if (!info.layoutCardId) return null;
  if (info.themes !== null && !info.themes.includes(themeId)) return null;
  return info.layoutCardId;
}

/** Bir temada yerleşimi düzenlenebilen bileşenler (sıra düzenleyicisi bunu kullanır). */
export function layoutComponentsForTheme(themeId: ThemeBaseId): ThemeComponentInfo[] {
  return componentsForTheme(themeId).filter((c) => layoutCardIdFor(c, themeId) !== null);
}
