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
  /* ── Kokpit sayfaları (cockpitPageBus) — saha 2026-09-26: yalnız kaydırmayla
     açılıyordu; "yolculuk bilgisayarını göster" yolculuk DEFTERİNİ açıyordu. ── */
  { id: 'trip-computer',    label: 'Yolculuk bilgisayarı', aliases: ['yolculuk bilgisayari', 'seyir bilgisayari', 'yol bilgisayari', 'trip bilgisayari', 'trip computer', 'yolculuk ozeti'] },
  { id: 'obd-live',         label: 'OBD canlı ekranı', aliases: ['obd ekrani', 'canli obd', 'obd sayfasi', 'obd canli', 'obd paneli', 'obd'] },
  { id: 'cockpit',          label: 'Dijital gösterge', aliases: ['kokpit', 'gosterge paneli', 'gostergeler', 'dijital gosterge', 'dijital kokpit', 'gosterge ekrani'] },
  /* ── Tam ekran harita (mapViewBus) ── */
  { id: 'map',              label: 'Harita',           aliases: ['tam ekran harita', 'harita ekrani', 'buyuk harita', 'haritayi buyut'] },
  /* ── Ayar sekmeleri (settingsFocusBus) — önceden yalnız 4'ü sesle açılıyordu ── */
  { id: 'settings-sound',       label: 'Ses ayarları',        aliases: ['ses ayarlari', 'ses ayari', 'ses secenekleri'] },
  { id: 'settings-appearance',  label: 'Görünüm ayarları',    aliases: ['gorunum ayarlari', 'tema ayarlari', 'ekran ayarlari', 'duvar kagidi ayarlari'] },
  { id: 'settings-navigation',  label: 'Navigasyon ayarları', aliases: ['navigasyon ayarlari', 'harita ayarlari', 'rota ayarlari'] },
  { id: 'settings-assistant',   label: 'Asistan ayarları',    aliases: ['asistan ayarlari', 'mavi ayarlari', 'sesli asistan ayarlari', 'yapay zeka ayarlari'] },
  { id: 'settings-maintenance', label: 'Araç ve bakım ayarları', aliases: ['bakim ayarlari', 'arac ayarlari', 'arac bilgileri'] },
  { id: 'settings-connect',     label: 'Bağlantı ayarları',   aliases: ['baglanti ayarlari', 'obd ayarlari', 'obd baglantisi', 'telefon baglantisi'] },
  { id: 'settings-profiles',    label: 'Sürücü profilleri',   aliases: ['surucu profilleri', 'profil ayarlari', 'profiller', 'surucu ayarlari'] },
  { id: 'settings-about',       label: 'Uygulama hakkında',   aliases: ['hakkinda', 'uygulama hakkinda', 'surum bilgisi', 'versiyon'] },
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

/**
 * Girdinin TAMAMI "<ekran adı> aç/göster/kapat" mı? (yerel kestirme — beyin yok)
 *
 * Yalnız TAM eşleşme: gövde bir alias'a eşit olmalı (Türkçe belirtme/yönelme
 * eki toleranslı: "yolculuk bilgisayarını" = "yolculuk bilgisayari" + "ni").
 * Kısmi/benzer eşleşme `null` döner → metin normal akışına (beyne) gider.
 */
export function matchScreenCommand(spoken: string): { id: string; action: 'open' | 'close' } | null {
  if (typeof spoken !== 'string') return null;
  const n = normalizeScreenText(spoken);
  const m = n.match(/^(.+?)\s+(ac|goster|getir|kapat|gizle)(?:\s+(?:lutfen|misin))?$/);
  if (!m) return null;
  const body = m[1].trim();
  const action: 'open' | 'close' = m[2] === 'kapat' || m[2] === 'gizle' ? 'close' : 'open';
  let best: { id: string; len: number } | null = null;
  for (const screen of SCREEN_CATALOG) {
    for (const alias of screen.aliases) {
      if (!body.startsWith(alias)) continue;
      const rest = body.slice(alias.length);
      if (!/^(?:n?[iu]|y[iu]|n?[ae]|y[ae]|ni|nu)?$/.test(rest)) continue;
      if (!best || alias.length > best.len) best = { id: screen.id, len: alias.length };
    }
  }
  return best ? { id: best.id, action } : null;
}
