/**
 * Command Parser — maps natural-language text to structured commands.
 *
 * Pure function module: no state, no side effects.
 *
 * Matching strategy (three-tier, first tier to pass wins):
 *   1. Exact substring  — confidence 1.00  (fast path)
 *   2. Token exact      — confidence 0.82  (any significant input word matches)
 *   3. Fuzzy token      — confidence 0.49–0.72  (edit-distance ≤ 35 %)
 *
 * Accent-normalisation is applied to both input and pattern keywords so
 * "muzigi ac" matches "müziği aç", "haritayi ac" matches "haritayı aç", etc.
 *
 * Upgrade path: replace `scorePattern()` with a TF-Lite embedding call;
 * the `ParsedCommand` / `ParseResult` interfaces stay unchanged.
 */

/* ── Types ───────────────────────────────────────────────── */

export type CommandType =
  | 'navigate_home'
  | 'open_maps'
  | 'open_music'
  | 'stop_music'
  | 'open_phone'
  | 'open_settings'
  | 'open_recent'
  | 'show_favorites'
  | 'theme_night'
  | 'theme_dark'
  | 'theme_oled'
  | 'music_spotify'
  | 'music_youtube'
  | 'driving_mode'
  | 'toggle_sleep_mode'
  | 'vehicle_speed'
  | 'vehicle_fuel'
  | 'vehicle_temp';

export type CommandPriority = 'critical' | 'high' | 'normal';

export interface ParsedCommand {
  type:       CommandType;
  raw:        string;        // original, unmodified input
  confidence: number;        // 0–1
  feedback:   string;        // "Harita açılıyor" — shown in Voice UI
  priority:   CommandPriority;
}

/** Shown in the UI when no command matches, as "Did you mean?" chips. */
export interface ParseSuggestion {
  label:   string;  // "Haritayı Aç"
  example: string;  // "haritayı aç"  — tappable shortcut
}

export interface ParseResult {
  command:     ParsedCommand | null;
  suggestions: ParseSuggestion[];  // up to 3, ordered by relevance
}

/* ── Pattern definitions ─────────────────────────────────── */

interface CommandPattern {
  type:     CommandType;
  priority: CommandPriority;
  feedback: string;
  label:    string;    // display name for suggestions
  example:  string;    // example string for suggestions / chip
  keywords: string[];  // substring-match phrases
  tokens:   string[];  // single-word tokens for token-level matching
}

const PATTERNS: CommandPattern[] = [
  {
    type: 'navigate_home', priority: 'critical',
    feedback: 'Eve gidiyoruz',
    label: 'Eve Git', example: 'eve git',
    keywords: ['eve git', 'eve dön', 'eve gidelim', 'anasayfa', 'ana sayfa', 'home'],
    tokens:   ['eve', 'home', 'anasayfa'],
  },
  {
    type: 'open_maps', priority: 'critical',
    feedback: 'Harita açılıyor',
    label: 'Haritayı Aç', example: 'haritayı aç',
    keywords: [
      'haritayı aç', 'harita aç', 'google maps', 'maps aç', 'waze aç',
      'navigasyonu aç', 'navigasyon aç', 'navigasyonu başlat', 'navigasyon başlat',
      'map aç', 'yol tarifi', 'nereye git', 'rota başlat',
    ],
    tokens: ['harita', 'maps', 'map', 'navigasyon', 'navigate', 'waze', 'rota'],
  },
  {
    type: 'open_music', priority: 'high',
    feedback: 'Müzik başlatılıyor',
    label: 'Müziği Aç', example: 'müziği aç',
    keywords: [
      'müziği aç', 'müzik aç', 'spotify aç', 'müzik çal', 'şarkı aç',
      'şarkı çal', 'müzik başlat', 'play music', 'music aç',
    ],
    tokens: ['müzik', 'müziği', 'spotify', 'şarkı', 'music', 'çal'],
  },
  {
    type: 'stop_music', priority: 'high',
    feedback: 'Müzik duraklatıldı',
    label: 'Müziği Durdur', example: 'müziği durdur',
    keywords: [
      'müziği durdur', 'müziği kapat', 'müzik kapat', 'müzik durdur',
      'durdur', 'duraklat', 'pause', 'stop music',
    ],
    tokens: ['durdur', 'duraklat', 'kapat', 'pause', 'stop'],
  },
  {
    type: 'open_phone', priority: 'critical',
    feedback: 'Telefon açılıyor',
    label: 'Telefonu Aç', example: 'telefonu aç',
    keywords: ['telefonu aç', 'telefon aç', 'telefon', 'arama yap', 'call'],
    tokens:   ['telefon', 'call', 'çevir'],
  },
  {
    type: 'open_settings', priority: 'normal',
    feedback: 'Ayarlar açılıyor',
    label: 'Ayarları Aç', example: 'ayarları aç',
    keywords: ['ayarları aç', 'ayarlar aç', 'ayarlara git', 'settings', 'ayarlar'],
    tokens:   ['ayar', 'settings', 'setting'],
  },
  {
    type: 'open_recent', priority: 'normal',
    feedback: 'Son uygulama açılıyor',
    label: 'Son Uygulamayı Aç', example: 'son uygulamayı aç',
    keywords: ['son uygulamayı aç', 'son uygulama', 'önceki uygulama', 'geri dön'],
    tokens:   ['son', 'önceki', 'recent', 'last'],
  },
  {
    type: 'show_favorites', priority: 'normal',
    feedback: 'Uygulamalar açılıyor',
    label: 'Favorileri Göster', example: 'favorileri göster',
    keywords: ['favorileri göster', 'favoriler', 'favori uygulamalar', 'uygulamaları aç', 'apps'],
    tokens:   ['favori', 'favorites', 'uygulama', 'apps'],
  },
  {
    type: 'theme_night', priority: 'normal',
    feedback: 'Gece modu aktif',
    label: 'Gece Moduna Geç', example: 'gece moduna geç',
    keywords: ['gece moduna geç', 'gece modu', 'karanlık mod', 'dark mod', 'oled modu', 'karanlık tema'],
    tokens:   ['gece', 'karanlık', 'dark', 'oled'],
  },
  {
    type: 'theme_dark', priority: 'normal',
    feedback: 'Koyu tema etkinleştirildi',
    label: 'Koyu Temaya Geç', example: 'koyu temaya geç',
    keywords: ['koyu temaya geç', 'koyu tema', 'dark theme', 'lacivert'],
    tokens:   ['koyu', 'dark', 'lacivert', 'tema'],
  },
  {
    type: 'theme_oled', priority: 'normal',
    feedback: 'OLED modu etkinleştirildi',
    label: 'OLED Moduna Geç', example: 'oled moduna geç',
    keywords: ['oled moduna geç', 'oled modu', 'oled theme', 'siyah tema'],
    tokens:   ['oled', 'siyah', 'tema'],
  },
  {
    type: 'music_spotify', priority: 'normal',
    feedback: 'Spotify seçildi',
    label: 'Spotify Seç', example: 'spotify seç',
    keywords: ['spotify seç', 'spotify', 'spotify müzik'],
    tokens:   ['spotify', 'müzik'],
  },
  {
    type: 'music_youtube', priority: 'normal',
    feedback: 'YouTube seçildi',
    label: 'YouTube Seç', example: 'youtube seç',
    keywords: ['youtube seç', 'youtube music', 'youtube'],
    tokens:   ['youtube', 'müzik'],
  },
  {
    type: 'driving_mode', priority: 'normal',
    feedback: 'Sürüş modu aktif',
    label: 'Sürüş Moduna Geç', example: 'sürüş moduna geç',
    keywords: ['sürüş moduna geç', 'sürüş modu', 'driving mode', 'araba modu'],
    tokens:   ['sürüş', 'driving', 'araba', 'araç'],
  },
  {
    type: 'toggle_sleep_mode', priority: 'normal',
    feedback: 'Uyku modu değiştirildi',
    label: 'Uyku Modunu Aç/Kapat', example: 'uyku modunu aç',
    keywords: ['uyku modunu aç', 'uyku modunu kapat', 'uyku modu', 'sleep mode'],
    tokens:   ['uyku', 'sleep', 'modu'],
  },
  {
    type: 'vehicle_speed', priority: 'normal',
    feedback: 'Hız gösteriliyor',
    label: 'Hızı Göster', example: 'hızım kaç',
    keywords: ['hızım kaç', 'hız kaç', 'hız nedir', 'ne kadar hızlı', 'hız göster', 'current speed'],
    tokens:   ['hız', 'speed', 'kaç', 'nedir'],
  },
  {
    type: 'vehicle_fuel', priority: 'normal',
    feedback: 'Yakıt durumu gösteriliyor',
    label: 'Yakıt Durumunu Göster', example: 'yakıt durumum ne',
    keywords: ['yakıt durumum ne', 'yakıt kaç', 'yakıt nedir', 'yakıt miktarı', 'fuel level', 'kalan yakıt'],
    tokens:   ['yakıt', 'fuel', 'tank', 'kalan'],
  },
  {
    type: 'vehicle_temp', priority: 'normal',
    feedback: 'Motor sıcaklığı gösteriliyor',
    label: 'Motor Sıcaklığını Göster', example: 'motor sıcaklığı kaç',
    keywords: ['motor sıcaklığı kaç', 'motor sıcaklığı nedir', 'motor ısısı', 'engine temp', 'sıcaklık kaç'],
    tokens:   ['motor', 'sıcaklık', 'temp', 'temperature', 'ısı'],
  },
];

/* ── Text normalisation ──────────────────────────────────── */

/** Lowercase + strip Turkish accents + collapse punctuation to spaces. */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[.,!?;:'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Pre-normalised patterns (computed once at module load) ─ */

interface NormalizedPattern extends Omit<CommandPattern, 'keywords' | 'tokens'> {
  keywords: string[];
  tokens:   string[];
}

const NORM_PATTERNS: NormalizedPattern[] = PATTERNS.map((p) => ({
  ...p,
  keywords: p.keywords.map(normalizeText),
  tokens:   p.tokens.map(normalizeText),
}));

/* ── Levenshtein distance ────────────────────────────────── */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev] = [[...curr], prev]; // swap rows
  }
  return prev[b.length];
}

/* ── Pattern scoring ─────────────────────────────────────── */

const EXACT_SCORE  = 1.00;
const TOKEN_SCORE  = 0.82;
const FUZZY_MIN    = 0.65;   // minimum similarity for fuzzy acceptance
const FUZZY_SCALE  = 0.88;   // score multiplier for fuzzy matches
const THRESHOLD    = 0.50;   // minimum score to accept a command

function scorePattern(
  normalized:   string,
  inputTokens:  string[],
  pattern:      NormalizedPattern,
): number {
  // Tier 1 — exact substring
  for (const kw of pattern.keywords) {
    if (normalized.includes(kw) || (kw.length >= 4 && kw.includes(normalized))) {
      return EXACT_SCORE;
    }
  }

  // Tier 2 — token exact / substring
  for (const tok of inputTokens) {
    if (tok.length < 2) continue;
    for (const pt of pattern.tokens) {
      if (tok === pt || tok.includes(pt) || pt.includes(tok)) return TOKEN_SCORE;
    }
  }

  // Tier 3 — fuzzy token matching via Levenshtein
  let best = 0;
  for (const tok of inputTokens) {
    if (tok.length < 3) continue;
    for (const pt of pattern.tokens) {
      if (pt.length < 3) continue;
      const dist = levenshtein(tok, pt);
      const sim  = 1 - dist / Math.max(tok.length, pt.length);
      if (sim >= FUZZY_MIN) best = Math.max(best, sim * FUZZY_SCALE);
    }
  }
  return best;
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Full parse — returns command + ranked suggestions.
 * Use this everywhere; `parseCommand` is a thin compatibility wrapper.
 */
export function parseCommandFull(input: string): ParseResult {
  const normalized   = normalizeText(input);
  if (!normalized) return { command: null, suggestions: [] };
  const inputTokens  = normalized.split(' ').filter((t) => t.length > 0);

  const scored = NORM_PATTERNS.map((p) => ({
    pattern: p,
    score:   scorePattern(normalized, inputTokens, p),
  }));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score >= THRESHOLD) {
    return {
      command: {
        type:       best.pattern.type,
        raw:        input.trim(),
        confidence: best.score,
        feedback:   best.pattern.feedback,
        priority:   best.pattern.priority,
      },
      suggestions: [],
    };
  }

  // No match — return top 3 as suggestions
  return {
    command: null,
    suggestions: scored.slice(0, 3).map(({ pattern }) => ({
      label:   pattern.label,
      example: pattern.example,
    })),
  };
}

/** Backward-compatible thin wrapper. */
export function parseCommand(input: string): ParsedCommand | null {
  return parseCommandFull(input).command;
}

/** Display label for a command type (used in feedback). */
export function commandLabel(type: CommandType): string {
  return PATTERNS.find((p) => p.type === type)?.label ?? type;
}
