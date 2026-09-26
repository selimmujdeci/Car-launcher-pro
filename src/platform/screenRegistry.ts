/**
 * screenRegistry.ts — Sesli asistanın "X'i aç/kapat" komutuyla erişebileceği
 * UYGULAMA İÇİ ekranlar/paneller kaydı. appRegistry (yüklü Android uygulamaları)
 * ile kardeş: burası uygulamanın KENDİ iç yüzeyi (drawer'lar + ayar bölümleri).
 *
 * Çoğu ekran drawerBus üzerinden açılır (tek openDrawer çağrısı); Gemini QR gibi
 * ayar-içi derin paneller settingsFocusBus ile hedeflenir. React'siz (platform-saf)
 * — commandExecutor/intentEngine buradan resolveScreen ile çözer.
 */

import { openDrawer } from './drawerBus';
import { focusSettingsSection, type SettingsSection } from './settingsFocusBus';
import { requestCockpitPage, type CockpitPageTarget } from './cockpitPageBus';
import { setFullMapView } from './mapViewBus';
import type { DrawerType } from '../components/layout/DockBar';
/* SAF KATALOG (kimlik · etiket · alias) + sesli ad çözümü — TEK KAYNAK.
   Burada yalnız AÇMA/KAPAMA davranışı bağlanır. */
import { SCREEN_CATALOG, resolveScreenEntry, type ScreenCatalogEntry } from './screenCatalog';

export interface ScreenEntry {
  id:      string;
  label:   string;              // TTS/onay metni ("Trafik paneli")
  aliases: readonly string[];   // normalize edilmiş Türkçe tetikleyiciler
  /** `false` → sahip reddetti (ör. geri viteste kokpit); çağıran "açtım" DEMEZ. */
  open:    () => void | boolean;
  close?:  () => void;          // yoksa 'kapat' → mevcut drawer'ı kapat
}

/** Katalog girişine açma/kapama davranışı bağlar. */
function bindScreen(c: ScreenCatalogEntry): ScreenEntry {
  const base = { id: c.id, label: c.label, aliases: c.aliases };
  // Patch 9A: canlı sensör bölümü DTC drawer'ının içinde — ayrı sesli kimlikle açılır.
  if (c.id === 'sensors') return { ...base, open: () => openDrawer('dtc'), close: () => openDrawer('none') };
  // Ayar-içi derin panel: Gemini QR (KeyBeam) — settingsFocusBus ile.
  if (c.id === 'gemini-qr') {
    return { ...base, open: () => { openDrawer('settings'); focusSettingsSection('gemini-qr'); }, close: () => openDrawer('none') };
  }
  // Kokpit sayfaları: çekmece/harita kapanır, sayfa sahibi (CockpitPager) güvenliği uygular.
  const cockpit: Record<string, CockpitPageTarget> = { 'trip-computer': 'trip', 'obd-live': 'obd', cockpit: 'cockpit' };
  if (cockpit[c.id]) {
    const page = cockpit[c.id];
    return {
      ...base,
      open: () => { openDrawer('none'); setFullMapView(false); return requestCockpitPage(page); },
      close: () => { requestCockpitPage('home'); },
    };
  }
  if (c.id === 'map') {
    return { ...base, open: () => { openDrawer('none'); setFullMapView(true); }, close: () => setFullMapView(false) };
  }
  // Ayar sekmesi: ayarlar açılır + ilgili sekmeye odaklanılır.
  if (c.id.startsWith('settings-')) {
    const section = c.id.slice('settings-'.length) as SettingsSection;
    return { ...base, open: () => { openDrawer('settings'); focusSettingsSection(section); }, close: () => openDrawer('none') };
  }
  return { ...base, open: () => openDrawer(c.id as DrawerType), close: () => openDrawer('none') };
}

// Kanonik ekran listesi — `screenCatalog.SCREEN_CATALOG` (tek kaynak) + davranış.
const SCREENS: readonly ScreenEntry[] = SCREEN_CATALOG.map(bindScreen);

/**
 * Serbest/sesli bir ekran adını kanonik ekrana çözer. Eşleşme yoksa null
 * (çağıran dürüstçe "bulamadım" der — sahte onay yok). Puanlama `screenCatalog`ta.
 */
export function resolveScreen(spoken: string): ScreenEntry | null {
  const hit = resolveScreenEntry(spoken);
  return hit ? (SCREENS.find((s) => s.id === hit.id) ?? null) : null;
}

/** @internal testler/tanı için — kanonik ekran kimlikleri. */
export function _screenIds(): string[] {
  return SCREENS.map((s) => s.id);
}

/** Kanonik ekran kimlikleri (dış kullanım — nav Action Registry kaynağı). */
export function screenIds(): readonly string[] {
  return SCREENS.map((s) => s.id);
}

/**
 * Kanonik ekranı KİMLİĞİYLE (fuzzy DEĞİL) getirir — nav Action Registry handler'ı bu kesin
 * erişimi kullanır (resolveScreen serbest/sesli metin içindir). Bilinmeyen id → null (fail-closed).
 */
export function getScreenById(id: string): ScreenEntry | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  return SCREENS.find((s) => s.id === id) ?? null;
}
