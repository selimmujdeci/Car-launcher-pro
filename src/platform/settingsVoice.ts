/**
 * settingsVoice — Sesli ayar kontrolü registry'si ve eşleştiricisi.
 *
 * Amaç: Kullanıcı "performans modunu aç", "birimleri imperial yap", "parlaklığı
 * azalt", "wifi aç", "duvar kağıdını değiştir" gibi cümlelerle ayarları sesle
 * değiştirebilsin. Her ayar burada TEK SATIR olarak tanımlanır; yeni ayar eklemek
 * için sadece registry'ye giriş eklenir (ölçeklenebilir).
 *
 * Akış: commandParser ön-kontrolü → matchVoiceSetting() → ParsedCommand('set_setting')
 *       → intentEngine(SET_SETTING) → useVoiceCommandHandler.applySetting().
 *
 * Yanlış pozitif koruması: eşleşme için DAİMA bir fiil (aç/kapat/artır/azalt/yap)
 * gerekir; çıplak ayar adı ("performans modu nedir") komut sayılmaz.
 */

/* ── Tipler ──────────────────────────────────────────────── */

export type SettingKind = 'bool' | 'enum' | 'number' | 'openTab';
export type SettingAction = 'on' | 'off' | 'inc' | 'dec' | 'set' | 'open';

export interface VoiceSetting {
  /** AppSettings anahtarı veya özel ('wifi','bluetooth'). */
  key:      string;
  kind:     SettingKind;
  /** Türkçe adlar (normalize edilmiş — aksansız, küçük harf). */
  aliases:  string[];
  /** Sesli/görsel geri bildirim için okunabilir ad. */
  label:    string;
  /** enum: değer alias'ı (normalize) → gerçek değer. */
  values?:  Record<string, string>;
  /** number: aralık ve mutlak değer dışı (inc/dec) registry'ce mi işlensin. */
  min?:     number;
  max?:     number;
  /** number: false ise inc/dec mevcut komutlara (volume_up/down) bırakılır. */
  incDec?:  boolean;
  /** number: değer native köprüden uygulanır (parlaklık). */
  native?:  boolean;
  /** openTab: hedef ayar sekmesi anahtarı (UI tarafının yorumlayacağı). */
  tab?:     string;
}

export interface VoiceSettingMatch {
  key:    string;
  kind:   SettingKind;
  action: SettingAction;
  value?: string | number;
  label:  string;
}

/* ── Normalizasyon (commandParser.normalizeText ile SENKRON tutulmalı) ──
 * Döngüsel import'tan kaçınmak için burada bağımsız kopya tutulur. Mantık
 * birebir aynı: küçük harf + Türkçe aksan sadeleştirme + noktalama→boşluk. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[.,!?;:'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Fiil sözlükleri (normalize edilmiş) ─────────────────── */

const ON_WORDS  = ['ac', 'acar', 'acsana', 'acabilir', 'aciver', 'etkinlestir', 'aktiflestir',
                   'aktif', 'baslat', 'acik', 'acmak'];
const OFF_WORDS = ['kapat', 'kapa', 'kapatsana', 'kapatabilir', 'kapali', 'devre',
                   'pasif', 'durdur', 'iptal', 'kaldir', 'sustur'];
const INC_WORDS = ['artir', 'arttir', 'yukselt', 'cogalt', 'yukari', 'fazlalastir'];
const DEC_WORDS = ['azalt', 'dusur', 'kis', 'asagi', 'kisalt'];
const SET_WORDS = ['yap', 'ayarla', 'olsun', 'getir', 'cek', 'sec'];
/** openTab için yeterli olan "düzenleme niyeti" fiilleri. */
const OPEN_WORDS = ['degistir', 'duzenle', 'ayarla', 'sec', 'gir', 'guncelle', 'ac'];

function hasWord(tokens: string[], words: string[]): boolean {
  for (const t of tokens) for (const w of words) if (t === w || t.startsWith(w)) return true;
  return false;
}

/** "%50", "50", "yuzde 50" → 0–100 arası tam sayı; yoksa null. */
function extractPercent(normalized: string): number | null {
  const m = normalized.match(/(\d{1,3})/);
  if (m) {
    const v = parseInt(m[1], 10);
    if (Number.isFinite(v)) return Math.max(0, Math.min(100, v));
  }
  if (/\b(maksimum|maximum|tam|sonuna)\b/.test(normalized)) return 100;
  if (/\b(minimum|en dusuk|sonuna kadar kis)\b/.test(normalized)) return 0;
  if (/\b(yari|yarim|orta)\b/.test(normalized)) return 50;
  return null;
}

/* ── Registry ────────────────────────────────────────────── */

export const VOICE_SETTINGS: VoiceSetting[] = [
  /* Boolean toggle'lar */
  { key: 'performanceMode',       kind: 'bool', label: 'Performans modu',
    aliases: ['performans modu', 'performans', 'yuksek performans', 'guc modu'] },
  { key: 'smartContextEnabled',   kind: 'bool', label: 'Smart Engine',
    aliases: ['smart engine', 'akilli motor', 'akilli oneriler', 'akilli baglam', 'smart mod', 'akilli mod'] },
  { key: 'offlineMap',            kind: 'bool', label: 'Çevrimdışı harita',
    aliases: ['cevrimdisi harita', 'offline harita', 'offline map', 'cevrimdisi map', 'gomulu harita'] },
  { key: 'wakeWordEnabled',       kind: 'bool', label: 'Sesli asistan',
    aliases: ['sesli asistan', 'uyandirma kelimesi', 'hey araba', 'wake word', 'sesli komut'] },
  { key: 'breakReminderEnabled',  kind: 'bool', label: 'Mola hatırlatıcı',
    aliases: ['mola hatirlatici', 'mola hatirlatma', 'mola uyarisi', 'mola modu'] },
  { key: 'autoBrightnessEnabled', kind: 'bool', label: 'Otomatik parlaklık',
    // Kök 'otomatik parlak' — Türkçe ünsüz yumuşaması (parlaklık→parlaklığı) eşleşmeyi
    // bozuyordu. En uzun-alias kuralı sayesinde brightness'ın 'parlak' kökünü gölgeler.
    aliases: ['otomatik parlak', 'oto parlak', 'otomatik aydinlatma'] },
  { key: 'autoThemeEnabled',      kind: 'bool', label: 'Otomatik tema',
    aliases: ['otomatik tema', 'oto tema', 'otomatik tema gecisi'] },
  { key: 'dockAutoHide',          kind: 'bool', label: 'Dock otomatik gizleme',
    aliases: ['dock otomatik gizle', 'dock gizleme', 'menu cubugu gizle', 'alt bar gizle'] },
  { key: 'obdAutoSleep',          kind: 'bool', label: 'OBD otomatik uyku',
    aliases: ['obd otomatik uyku', 'obd uyku', 'obd uyku modu'] },
  { key: 'autoNavOnStart',        kind: 'bool', label: 'Hızlı harita',
    aliases: ['hizli harita', 'acilista navigasyon', 'baslangicta navigasyon', 'otomatik navigasyon'] },
  { key: 'sleepMode',             kind: 'bool', label: 'Uyku modu',
    aliases: ['uyku modu', 'ekran uyku', 'uyku'] },
  { key: 'showSeconds',           kind: 'bool', label: 'Saniye göstergesi',
    aliases: ['saniye gosterimi', 'saniye goster', 'saniyeler'] },
  { key: 'use24Hour',             kind: 'bool', label: '24 saat formatı',
    aliases: ['24 saat', 'yirmi dort saat', '24 saat formati'] },

  /* Enum seçimler */
  { key: 'unitSystem', kind: 'enum', label: 'Birim sistemi',
    aliases: ['birim sistemi', 'birimler', 'olcu birimi', 'birim'],
    values: { 'metrik': 'metric', 'metric': 'metric', 'kilometre': 'metric',
              'imperial': 'imperial', 'mil': 'imperial', 'ingiliz': 'imperial' } },
  { key: 'defaultNav', kind: 'enum', label: 'Varsayılan navigasyon',
    aliases: ['varsayilan navigasyon', 'navigasyon uygulamasi', 'harita uygulamasi'],
    values: { 'google': 'maps', 'maps': 'maps', 'google maps': 'maps',
              'waze': 'waze', 'yandex': 'yandex' } },
  { key: 'defaultMusic', kind: 'enum', label: 'Varsayılan müzik',
    aliases: ['varsayilan muzik', 'muzik uygulamasi', 'muzik kaynagi'],
    values: { 'spotify': 'spotify', 'youtube': 'youtube', 'yu tup': 'youtube' } },
  { key: 'hotspotMode', kind: 'enum', label: 'Hotspot modu',
    aliases: ['hotspot modu', 'hotspot baglantisi', 'telefon baglantisi'],
    values: { 'otomatik': 'auto', 'oto': 'auto', 'sor': 'ask', 'sorsun': 'ask',
              'kapali': 'off', 'kapat': 'off' } },
  { key: 'language', kind: 'enum', label: 'Dil',
    aliases: ['dil', 'uygulama dili', 'lisan'],
    values: { 'turkce': 'tr', 'turkish': 'tr', 'ingilizce': 'en', 'english': 'en' } },

  /* Sayısal */
  { key: 'brightness', kind: 'number', label: 'Parlaklık', min: 0, max: 100, incDec: true, native: true,
    // Kök 'parlak' — "parlaklığı" (yumuşamış) dahil tüm çekimleri yakalar.
    aliases: ['parlak', 'isik seviyesi', 'aydinlatma'] },
  { key: 'volume', kind: 'number', label: 'Ses', min: 0, max: 100, incDec: false,
    aliases: ['ses seviyesi', 'ses duzeyi'] },

  /* Native (özel) */
  { key: 'wifi', kind: 'bool', label: 'WiFi',
    aliases: ['wifi', 'wi-fi', 'kablosuz ag', 'internet baglantisi'] },
  { key: 'bluetooth', kind: 'bool', label: 'Bluetooth',
    aliases: ['bluetooth', 'bt baglantisi'] },

  /* openTab — sesle pratik girilemeyen ayarlar → ilgili sekmeyi aç */
  { key: 'wallpaper',        kind: 'openTab', label: 'Duvar kağıdı', tab: 'appearance',
    aliases: ['duvar kagidi', 'arka plan', 'wallpaper', 'arkaplan'] },
  { key: 'geminiApiKey',     kind: 'openTab', label: 'Asistan API anahtarı', tab: 'assistant',
    aliases: ['api anahtari', 'api key', 'gemini anahtari', 'yapay zeka anahtari'] },
  { key: 'homeLocation',     kind: 'openTab', label: 'Ev konumu', tab: 'locations',
    aliases: ['ev konumu', 'ev adresi', 'ev adresim'] },
  { key: 'workLocation',     kind: 'openTab', label: 'İş konumu', tab: 'locations',
    aliases: ['is konumu', 'is adresi', 'is adresim', 'ofis konumu'] },
  { key: 'wakeWord',         kind: 'openTab', label: 'Uyandırma kelimesi', tab: 'assistant',
    aliases: ['ozel uyandirma kelimesi', 'uyandirma sozcugu', 'tetikleme kelimesi'] },
];

/** key → VoiceSetting (handler'da label/kind lookup için). */
const BY_KEY: Record<string, VoiceSetting> = Object.fromEntries(
  VOICE_SETTINGS.map((s) => [s.key, s]),
);

export function getVoiceSetting(key: string): VoiceSetting | undefined {
  return BY_KEY[key];
}

/* ── Eşleştirici ─────────────────────────────────────────── */

/**
 * Ham sesli girdiyi ayar komutuna çevirir. Eşleşme yoksa null
 * (komut müzik/nav/pattern skorlamasına / semantik NLP'ye devam eder).
 */
export function matchVoiceSetting(raw: string): VoiceSettingMatch | null {
  const n = normalize(raw);
  if (!n) return null;
  const tokens = n.split(' ');

  // En uzun alias eşleşmesini bul (substring) — "is konumu" > "is".
  let best: VoiceSetting | null = null;
  let bestLen = 0;
  for (const s of VOICE_SETTINGS) {
    for (const a of s.aliases) {
      if (n.includes(a) && a.length > bestLen) { best = s; bestLen = a.length; }
    }
  }
  if (!best) return null;

  const onV  = hasWord(tokens, ON_WORDS);
  const offV = hasWord(tokens, OFF_WORDS);
  const incV = hasWord(tokens, INC_WORDS);
  const decV = hasWord(tokens, DEC_WORDS);
  const setV = hasWord(tokens, SET_WORDS);

  switch (best.kind) {
    case 'openTab': {
      // Düzenleme niyeti fiili gerekir; aksi halde yanlış pozitif (soru cümlesi).
      if (hasWord(tokens, OPEN_WORDS)) {
        return { key: best.key, kind: 'openTab', action: 'open', label: best.label };
      }
      return null;
    }

    case 'enum': {
      // Önce istenen değeri bul. "metrik yap", "navigasyonu waze yap".
      if (best.values) {
        let valHit: string | null = null;
        let valLen = 0;
        for (const [alias, val] of Object.entries(best.values)) {
          if (n.includes(alias) && alias.length > valLen) { valHit = val; valLen = alias.length; }
        }
        if (valHit) return { key: best.key, kind: 'enum', action: 'set', value: valHit, label: best.label };
      }
      return null; // ayar adı var ama hedef değer yok → belirsiz
    }

    case 'number': {
      const pct = extractPercent(n);
      if (pct !== null && (setV || onV)) {
        return { key: best.key, kind: 'number', action: 'set', value: pct, label: best.label };
      }
      // inc/dec yalnızca registry üstleniyorsa (brightness). volume → mevcut volume_up/down.
      if (best.incDec) {
        if (incV) return { key: best.key, kind: 'number', action: 'inc', label: best.label };
        if (decV) return { key: best.key, kind: 'number', action: 'dec', label: best.label };
      }
      return null;
    }

    case 'bool':
    default: {
      // Önce KAPAT (daha spesifik), sonra AÇ. Fiil yoksa eşleşme yok.
      if (offV) return { key: best.key, kind: 'bool', action: 'off', label: best.label };
      if (onV)  return { key: best.key, kind: 'bool', action: 'on',  label: best.label };
      return null;
    }
  }
}
