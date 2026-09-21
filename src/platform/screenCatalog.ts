/**
 * screenCatalog.ts — Sesle erişilebilen UYGULAMA İÇİ ekranların SAF kataloğu
 * (kimlik · etiket · Türkçe alias'lar) + sesli ad → ekran çözümü.
 *
 * `screenRegistry` bu kataloğa AÇMA/KAPAMA davranışını (drawerBus ·
 * settingsFocusBus) bağlar; katalog kendisi I/O'suz, bus'sız, yan etkisizdir.
 * Bu ayrım Mavi beyin prompt'unun (`companionBrainKnowledge`) ve voice
 * katmanının ekran adlarını, açma davranışının import zincirini (drawerBus →
 * diagnosticTrail → obdService) sürüklemeden okuyabilmesi içindir.
 *
 * TEK KAYNAK: alias listesi YALNIZ burada yazılır. Çözüm puanlaması
 * `screenRegistry.resolveScreen`dan birebir taşındı (davranış değişmedi).
 */

export interface ScreenCatalogEntry {
  readonly id: string;
  readonly label: string;             // TTS/onay metni ("Trafik paneli")
  readonly aliases: readonly string[];// normalize edilmiş Türkçe tetikleyiciler
}

// Kanonik ekran listesi. 'super-admin' KASITLI dışarıda (admin-korumalı, sesle
// açılmamalı). Aliases normalize edilmiş (aksan/ek sadeleştirilmiş) gövdelerdir.
export const SCREEN_CATALOG: readonly ScreenCatalogEntry[] = Object.freeze([
  { id: 'traffic',          label: 'Trafik paneli',    aliases: ['trafik', 'trafik paneli', 'trafik durumu', 'yol durumu'] },
  { id: 'weather',          label: 'Hava durumu',      aliases: ['hava', 'hava durumu', 'meteoroloji'] },
  { id: 'climate',          label: 'Klima',            aliases: ['klima', 'iklim', 'isitma', 'sogutma', 'klima paneli'] },
  { id: 'dashcam',          label: 'Araç kamerası',    aliases: ['dashcam', 'arac kamerasi', 'kayit', 'kara kutu', 'kamera kaydi', 'sürüş kaydi', 'surus kaydi'] },
  { id: 'triplog',          label: 'Yolculuk defteri', aliases: ['yolculuk defteri', 'seyir defteri', 'yolculuk gecmisi', 'gezi kaydi', 'yolculuklar', 'triplog', 'yol defteri'] },
  { id: 'dtc',              label: 'Arıza kodları',    aliases: ['ariza kodlari', 'hata kodlari', 'ariza teshis', 'dtc', 'ariza'] },
  // Patch 9A: canlı sensör bölümü DTC drawer'ının içinde — ayrı sesli kimlikle açılır.
  { id: 'sensors',          label: 'Canlı sensörler',  aliases: ['sensorler', 'sensor paneli', 'canli sensorler', 'canli veri', 'motor verileri', 'arac verileri', 'telemetri'] },
  { id: 'notifications',    label: 'Bildirimler',      aliases: ['bildirimler', 'bildirim', 'uyarilar', 'bildirim merkezi'] },
  { id: 'sport',            label: 'Spor modu',        aliases: ['spor modu', 'spor', 'performans paneli', 'sport'] },
  { id: 'security',         label: 'Güvenlik',         aliases: ['guvenlik', 'guvenlik paneli'] },
  { id: 'entertainment',    label: 'Eğlence',          aliases: ['eglence', 'eglence merkezi', 'eglence paneli'] },
  { id: 'vehicle-reminder', label: 'Bakım hatırlatma', aliases: ['bakim hatirlatma', 'servis hatirlatma', 'bakim', 'servis', 'bakim paneli'] },
  { id: 'apps',             label: 'Uygulamalar',      aliases: ['uygulamalar', 'uygulama listesi', 'tum uygulamalar', 'uygulama cekmecesi'] },
  { id: 'settings',         label: 'Ayarlar',          aliases: ['ayarlar', 'ayar', 'ayarlar menusu'] },
  { id: 'music',            label: 'Müzik',            aliases: ['muzik', 'muzik calar', 'calar', 'muzik paneli'] },
  { id: 'phone',            label: 'Telefon',          aliases: ['telefon', 'arama', 'cevirici'] },
  // ── Ayar-içi derin panel: Gemini QR (KeyBeam) — settingsFocusBus ile ──
  { id: 'gemini-qr',        label: 'Gemini QR',        aliases: ['gemini qr', 'qr kod', 'qr kodu', 'gemini qr kodu', 'anahtar qr', 'telefonla getir', 'keybeam', 'gemini anahtar qr'] },
]);

/** Türkçe normalize (appRegistry ile aynı kural — bağımsız tutuldu). */
export function normalizeScreenText(s: string): string {
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
 * Serbest/sesli bir ekran adını kanonik katalog girişine çözer. Eşleşme yoksa
 * null (çağıran dürüstçe "bulamadım" der — sahte onay yok). SAF.
 */
export function resolveScreenEntry(spoken: string): ScreenCatalogEntry | null {
  if (typeof spoken !== 'string') return null;
  const raw = normalizeScreenText(spoken);
  const q = stripStop(raw) || raw;
  if (!q || q.length < 2) return null;

  let best: ScreenCatalogEntry | null = null;
  let bestScore = 0;

  for (const screen of SCREEN_CATALOG) {
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
