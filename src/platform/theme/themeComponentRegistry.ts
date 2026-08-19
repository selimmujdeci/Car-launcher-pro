/**
 * Tema Bileşen Kayıt Defteri — düzenlenebilir yüzeylerin TEK kimlik kaynağı (araç tarafı).
 *
 * PWA kopyası: website/src/lib/theme/themeComponentRegistry.ts — ilk yorum bloğu
 * dışında BİREBİR aynıdır (themeManifestParity testi kilitler).
 * ---8<--- PARITY-START --->8---
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
  | 'trip'
  /* PR-2a (2026-08-19): kullanıcı *"uygulamanın her noktasını düzenleme"*.
     Ölçüm: bu üç ekran ailesinde SIFIR `data-editable` vardı — yani tema
     onları hiç görmüyordu. */
  | 'climate'
  | 'phone'
  | 'apps'
  /* PR-2b: en çok bakılan iki ekran. `nav` GÜVENLİK YÜZEYİDİR — manevra kartı,
     hız kümesi ve tehlike uyarısı `locked` işaretlidir (gizlenemez). */
  | 'media'
  | 'nav';

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
  { id: 'climate', label: 'İklim Kontrolü', perTheme: false },
  { id: 'phone', label: 'Telefon / Rehber', perTheme: false },
  { id: 'apps', label: 'Uygulamalar', perTheme: false },
  { id: 'media', label: 'Müzik / Medya', perTheme: false },
  { id: 'nav', label: 'Navigasyon / Harita', perTheme: false },
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
  { id: 'dtc-panel', surface: 'diagnostics', type: 'panel', label: 'Arıza Kodu Paneli (tüm sayfa)', themes: null },
  { id: 'diagnostics.code-card', surface: 'diagnostics', type: 'card', label: 'Arıza Kodu Kartları (tümü)', themes: null },
  { id: 'maintenance-panel', surface: 'maintenance', type: 'panel', label: 'Bakım Paneli (tüm sayfa)', themes: null },
  { id: 'maintenance.card', surface: 'maintenance', type: 'card', label: 'Bakım Durum Kartı', themes: null },
  { id: 'maintenance.item', surface: 'maintenance', type: 'card', label: 'Bakım Kalemleri (tümü)', themes: null },
  { id: 'notification-center', surface: 'notifications', type: 'panel', label: 'Bildirim Merkezi (tüm sayfa)', themes: null },
  { id: 'notifications.card', surface: 'notifications', type: 'card', label: 'Bildirim Kartları (tümü)', themes: null },
  { id: 'notifications.call-card', surface: 'notifications', type: 'card', label: 'Gelen Arama Kartı', themes: null },
  { id: 'weather-card', surface: 'weather', type: 'card', label: 'Hava Durumu (tüm sayfa)', themes: null },
  { id: 'weather.station-card', surface: 'weather', type: 'card', label: 'Yakıt İstasyonu Kartları (tümü)', themes: null },
  { id: 'weather.detail', surface: 'weather', type: 'card', label: 'Hava Detay Satırları (tümü)', themes: null },
  { id: 'security-suite', surface: 'security', type: 'card', label: 'Güvenlik Paketi (tüm sayfa)', themes: null },
  { id: 'security.panel', surface: 'security', type: 'panel', label: 'Güvenlik Kartları (tümü)', themes: null },
  { id: 'dashcam', surface: 'dashcam', type: 'card', label: 'Dashcam (tüm sayfa)', themes: null },
  { id: 'dashcam.viewport', surface: 'dashcam', type: 'panel', label: 'Kamera Görüntü Kabı', themes: null },
  { id: 'sport-mode', surface: 'sport', type: 'card', label: 'Spor Modu (tüm sayfa)', themes: null },
  { id: 'sport.gmeter', surface: 'sport', type: 'gauge', label: 'G Göstergesi', themes: null },
  { id: 'sport.peak-card', surface: 'sport', type: 'card', label: 'Tepe Değer Kartları (tümü)', themes: null },
  { id: 'trip-log', surface: 'trip', type: 'card', label: 'Seyahat Kaydı (tüm sayfa)', themes: null },
  { id: 'trip.card', surface: 'trip', type: 'card', label: 'Yolculuk Kartları (tümü)', themes: null },
  { id: 'trip.stat', surface: 'trip', type: 'card', label: 'İstatistik Kutuları (tümü)', themes: null },
  { id: 'trip.summary', surface: 'trip', type: 'card', label: 'Özet Kartları (tümü)', themes: null },

  /* ── İklim Kontrolü (PR-2a) ──────────────────────────────────────────
     "(tümü)" etiketi bilerek yazılıdır: bir kimlik ekranda birden çok düğüme
     iner (iki bölge, dört sıcaklık butonu, üç mod butonu…) ve tek CSS kuralı
     HEPSİNE uygulanır. Sahte "her biri ayrı" iddiası KURULMAZ. */
  { id: 'climate.screen', surface: 'climate', type: 'panel', label: 'İklim Ekranı (tüm sayfa)', themes: null },
  { id: 'climate.header', surface: 'climate', type: 'header', label: 'Üst Bar', themes: null },
  { id: 'climate.cabin-badge', surface: 'climate', type: 'card', label: 'Kabin Sıcaklığı Rozeti', themes: null },
  { id: 'climate.zone', surface: 'climate', type: 'card', label: 'Sürücü / Yolcu Bölgesi (ikisi)', themes: null },
  { id: 'climate.temp-button', surface: 'climate', type: 'card', label: 'Sıcaklık +/− Butonları (tümü)', themes: null },
  { id: 'climate.fan', surface: 'climate', type: 'gauge', label: 'Fan Bloğu', themes: null },
  { id: 'climate.mode-button', surface: 'climate', type: 'card', label: 'Mod Butonları A/C·AUTO·SYNC (tümü)', themes: null },
  { id: 'climate.air-panel', surface: 'climate', type: 'panel', label: 'Hava Yönü Kabı', themes: null },
  { id: 'climate.air-button', surface: 'climate', type: 'card', label: 'Hava Yönü Butonları (tümü)', themes: null },
  { id: 'climate.comfort-panel', surface: 'climate', type: 'panel', label: 'Koltuk/Direksiyon Kabı', themes: null },
  { id: 'climate.heat-row', surface: 'climate', type: 'card', label: 'Isıtma Satırları (tümü)', themes: null },

  /* ── Telefon / Rehber (PR-2a) ──────────────────────────────────────── */
  { id: 'phone.screen', surface: 'phone', type: 'panel', label: 'Telefon Ekranı (tüm sayfa)', themes: null },
  { id: 'phone.search', surface: 'phone', type: 'card', label: 'Arama Kutusu', themes: null },
  { id: 'phone.contact-row', surface: 'phone', type: 'card', label: 'Kişi Satırları (tümü)', themes: null },
  { id: 'phone.number-picker', surface: 'phone', type: 'panel', label: 'Numara Seçici', themes: null },

  /* ── Uygulamalar (PR-2a) ───────────────────────────────────────────── */
  { id: 'apps.screen', surface: 'apps', type: 'panel', label: 'Uygulamalar (tüm sayfa)', themes: null },
  { id: 'apps.header', surface: 'apps', type: 'header', label: 'Başlık', themes: null },
  { id: 'apps.grid', surface: 'apps', type: 'panel', label: 'Izgara Kabı', themes: null },
  { id: 'apps.tile', surface: 'apps', type: 'card', label: 'Uygulama Kartları (tümü)', themes: null },

  /* ── Müzik / Medya (PR-2b) ─────────────────────────────────────────── */
  { id: 'media.screen', surface: 'media', type: 'panel', label: 'Medya Ekranı (tüm sayfa)', themes: null },
  { id: 'media.tabbar', surface: 'media', type: 'dock', label: 'Sekme Çubuğu', themes: null },
  { id: 'media.tab-button', surface: 'media', type: 'dock', label: 'Sekme Butonları (tümü)', themes: null },
  { id: 'media.player', surface: 'media', type: 'panel', label: 'Oynatıcı Sayfası', themes: null },
  { id: 'media.source-badge', surface: 'media', type: 'card', label: 'Kaynak Rozeti', themes: null },
  { id: 'media.album-art', surface: 'media', type: 'card', label: 'Albüm Kapağı', themes: null },
  { id: 'media.track-info', surface: 'media', type: 'card', label: 'Şarkı Bilgisi', themes: null },
  { id: 'media.progress', surface: 'media', type: 'card', label: 'İlerleme Çubuğu', themes: null },
  { id: 'media.transport', surface: 'media', type: 'card', label: 'Oynatma Kontrolleri', themes: null },
  { id: 'media.sources-page', surface: 'media', type: 'panel', label: 'Kaynaklar Sayfası', themes: null },
  { id: 'media.source-card', surface: 'media', type: 'card', label: 'Kaynak Kartları (tümü)', themes: null },

  /* ── Navigasyon / Harita (PR-2b) ───────────────────────────────────────
     GÜVENLİK SINIRI (vizyon anayasası: güvenlik-kritik katmanlar korunur):
     manevra kartı · hız/hız-limiti kümesi · tehlike uyarısı `locked`tır →
     `propsForComponent` bunlardan `visible` yeteneğini DÜŞÜRÜR, yani tema ile
     GİZLENEMEZLER. Renk/yazı/köşe düzenlenebilir; VARLIKLARI pazarlık dışıdır.
     (Anlamlı renkler — kırmızı aşım, amber dikkat — zaten yazı rengi kanalından
     etkilenmez; bkz. #650.) */
  { id: 'nav.screen', surface: 'nav', type: 'panel', label: 'Harita Ekranı (tüm sayfa)', themes: null, locked: true },
  { id: 'nav.maneuver', surface: 'nav', type: 'card', label: 'Manevra Kartı (dönüş talimatı)', themes: null, locked: true },
  { id: 'nav.speed-cluster', surface: 'nav', type: 'gauge', label: 'Hız + Hız Limiti Kümesi', themes: null, locked: true },
  { id: 'nav.hazard', surface: 'nav', type: 'card', label: 'Tehlike Uyarısı', themes: null, locked: true },
  { id: 'nav.current-street', surface: 'nav', type: 'card', label: 'Bulunulan Sokak', themes: null },
  { id: 'nav.street-bar', surface: 'nav', type: 'card', label: 'Cadde Adı Barı', themes: null },
  { id: 'nav.summary', surface: 'nav', type: 'card', label: 'Rota Özet / Varış Kartı', themes: null },
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
