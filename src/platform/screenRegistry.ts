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
import { focusSettingsSection } from './settingsFocusBus';
import type { DrawerType } from '../components/layout/DockBar';

export interface ScreenEntry {
  id:      string;
  label:   string;              // TTS/onay metni ("Trafik paneli")
  aliases: readonly string[];   // normalize edilmiş Türkçe tetikleyiciler
  open:    () => void;
  close?:  () => void;          // yoksa 'kapat' → mevcut drawer'ı kapat
}

/** drawerBus tabanlı ekran girişi üretici (open → aç, close → kapat). */
function drawerScreen(id: DrawerType, label: string, aliases: readonly string[]): ScreenEntry {
  return {
    id, label, aliases,
    open:  () => openDrawer(id),
    close: () => openDrawer('none'),
  };
}

// Kanonik ekran listesi. 'super-admin' KASITLI dışarıda (admin-korumalı, sesle
// açılmamalı). Aliases normalize edilmiş (aksan/ek sadeleştirilmiş) gövdelerdir.
const SCREENS: readonly ScreenEntry[] = [
  drawerScreen('traffic',          'Trafik paneli',      ['trafik', 'trafik paneli', 'trafik durumu', 'yol durumu']),
  drawerScreen('weather',          'Hava durumu',        ['hava', 'hava durumu', 'meteoroloji']),
  drawerScreen('climate',          'Klima',              ['klima', 'iklim', 'isitma', 'sogutma', 'klima paneli']),
  drawerScreen('dashcam',          'Araç kamerası',      ['dashcam', 'arac kamerasi', 'kayit', 'kara kutu', 'kamera kaydi', 'sürüş kaydi', 'surus kaydi']),
  drawerScreen('triplog',          'Yolculuk defteri',   ['yolculuk defteri', 'seyir defteri', 'yolculuk gecmisi', 'gezi kaydi', 'yolculuklar', 'triplog', 'yol defteri']),
  drawerScreen('dtc',              'Arıza kodları',      ['ariza kodlari', 'hata kodlari', 'ariza teshis', 'dtc', 'ariza']),
  drawerScreen('notifications',    'Bildirimler',        ['bildirimler', 'bildirim', 'uyarilar', 'bildirim merkezi']),
  drawerScreen('sport',            'Spor modu',          ['spor modu', 'spor', 'performans paneli', 'sport']),
  drawerScreen('security',         'Güvenlik',           ['guvenlik', 'guvenlik paneli']),
  drawerScreen('entertainment',    'Eğlence',            ['eglence', 'eglence merkezi', 'eglence paneli']),
  drawerScreen('vehicle-reminder', 'Bakım hatırlatma',   ['bakim hatirlatma', 'servis hatirlatma', 'bakim', 'servis', 'bakim paneli']),
  drawerScreen('apps',             'Uygulamalar',        ['uygulamalar', 'uygulama listesi', 'tum uygulamalar', 'uygulama cekmecesi']),
  drawerScreen('settings',         'Ayarlar',            ['ayarlar', 'ayar', 'ayarlar menusu']),
  drawerScreen('music',            'Müzik',              ['muzik', 'muzik calar', 'calar', 'muzik paneli']),
  drawerScreen('phone',            'Telefon',            ['telefon', 'arama', 'cevirici']),

  // ── Ayar-içi derin panel: Gemini QR (KeyBeam) — settingsFocusBus ile ──
  {
    id: 'gemini-qr', label: 'Gemini QR',
    aliases: ['gemini qr', 'qr kod', 'qr kodu', 'gemini qr kodu', 'anahtar qr', 'telefonla getir', 'keybeam', 'gemini anahtar qr'],
    open:  () => { openDrawer('settings'); focusSettingsSection('gemini-qr'); },
    close: () => openDrawer('none'),
  },
];

/** Türkçe normalize (appRegistry ile aynı kural — bağımsız tutuldu). */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Komut gürültüsü — "trafik panelini aç" → "trafik paneli" gövdesi kalsın.
const STOPWORDS = new Set(['ac', 'acar', 'acsana', 'baslat', 'goster', 'kapat', 'gizle', 'misin', 'lutfen', 'i', 'yi', 'yu']);

function stripStop(n: string): string {
  return n.split(' ').filter((w) => w && !STOPWORDS.has(w)).join(' ').trim();
}

/**
 * Serbest/sesli bir ekran adını kanonik ekrana çözer. Eşleşme yoksa null
 * (çağıran dürüstçe "bulamadım" der — sahte onay yok).
 */
export function resolveScreen(spoken: string): ScreenEntry | null {
  const raw = norm(spoken);
  const q = stripStop(raw) || raw;
  if (!q || q.length < 2) return null;

  let best: ScreenEntry | null = null;
  let bestScore = 0;

  for (const screen of SCREENS) {
    for (const alias of screen.aliases) {
      let score = 0;
      if (q === alias) {
        score = 1000;
      } else if (q.includes(alias) || alias.includes(q)) {
        const overlap = Math.min(q.length, alias.length);
        if (overlap >= 3) score = 500 + overlap;
      } else {
        // Türkçe ünsüz yumuşaması ("trafik" → "trafiği" = trafigi): gövde-içerme
        // kaçırır (k↔ğ). Ortak önek (LCP) neredeyse tüm alias'ı kapsıyorsa eşleştir.
        let lcp = 0;
        const m = Math.min(q.length, alias.length);
        while (lcp < m && q[lcp] === alias[lcp]) lcp++;
        if (lcp >= 4 && lcp >= alias.length - 2) score = 400 + lcp;
      }
      if (score > bestScore) { bestScore = score; best = screen; }
    }
  }

  return bestScore >= 100 ? best : null;
}

/** @internal testler/tanı için — kanonik ekran kimlikleri. */
export function _screenIds(): string[] {
  return SCREENS.map((s) => s.id);
}
