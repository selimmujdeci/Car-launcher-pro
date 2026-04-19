/**
 * Music Command Parser — Türkçe müzik komutlarını yapılandırılmış veriye çevirir.
 *
 * Desteklenen kalıplar:
 *   "Spotify'dan Aleyna Tilki aç"
 *   "YouTube Music'ten Enter Sandman çal"
 *   "Müslüm Gürses aç"
 *   "Poweramp'ta karışık müzik aç"
 *   "Bu şarkıyı favorilere ekle"
 *   "Sonraki şarkı"  (→ zaten commandParser'da; burada yakalanmaz)
 *
 * Mimari: Saf fonksiyon — state yok, side-effect yok.
 * commandParser.ts içinde tryParseNavAddress() ile aynı pattern olarak çağrılır.
 */

/* ── Types ───────────────────────────────────────────────── */

export type MusicQueryType = 'artist' | 'track' | 'playlist' | 'generic' | 'shuffle' | 'favorite';

export interface MusicSource {
  /** Android package name; '' → use default / local player */
  pkg:      string;
  /** Kullanıcıya görünen isim */
  name:     string;
  /** Arama URI şablonu; {q} ile yer değiştirilir */
  searchUri: (query: string) => string;
  /** Bridge key (spotify | youtube vb.) — bilinmiyorsa 'generic' */
  bridgeKey: string;
}

export interface ParsedMusicCommand {
  action:      'play' | 'add_favorite' | 'shuffle';
  source:      MusicSource | null;   // null → use active/default source
  query:       string;               // temizlenmiş arama sorgusu
  queryType:   MusicQueryType;
  feedback:    string;               // TTS + UI
  raw:         string;
}

/* ── Source registry ─────────────────────────────────────── */

const SOURCES: Record<string, MusicSource> = {
  spotify: {
    pkg:       'com.spotify.music',
    name:      'Spotify',
    bridgeKey: 'spotify',
    searchUri: (q) => `spotify:search:${encodeURIComponent(q)}`,
  },
  youtube_music: {
    pkg:       'com.google.android.apps.youtube.music',
    name:      'YouTube Music',
    bridgeKey: 'youtube',
    searchUri: (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
  },
  youtube: {
    pkg:       'com.google.android.youtube',
    name:      'YouTube',
    bridgeKey: 'youtube',
    searchUri: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  },
  poweramp: {
    pkg:       'com.maxmpz.audioplayer',
    name:      'Poweramp',
    bridgeKey: 'generic',
    searchUri: () => '',   // Poweramp açılır, arama desteklenmiyor
  },
  soundcloud: {
    pkg:       'com.soundcloud.android',
    name:      'SoundCloud',
    bridgeKey: 'generic',
    searchUri: (q) => `https://soundcloud.com/search?q=${encodeURIComponent(q)}`,
  },
  deezer: {
    pkg:       'com.deezer.android.app',
    name:      'Deezer',
    bridgeKey: 'generic',
    searchUri: (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}`,
  },
  tidal: {
    pkg:       'com.tidal.android',
    name:      'Tidal',
    bridgeKey: 'generic',
    searchUri: (q) => `tidal://search?q=${encodeURIComponent(q)}`,
  },
  amazon: {
    pkg:       'com.amazon.music',
    name:      'Amazon Müzik',
    bridgeKey: 'generic',
    searchUri: () => '',
  },
  apple: {
    pkg:       'com.apple.android.music',
    name:      'Apple Music',
    bridgeKey: 'generic',
    searchUri: (q) => `music://search?term=${encodeURIComponent(q)}`,
  },
  local: {
    pkg:       '',
    name:      'Dahili Müzik',
    bridgeKey: 'local',
    searchUri: (q) => `content://media/external/audio/media?query=${encodeURIComponent(q)}`,
  },
};

/* ── Keyword → source mapping ────────────────────────────── */

// Uzundan kısaya — ilk eşleşme kazanır
const SOURCE_KEYWORDS: [RegExp, string][] = [
  [/youtube\s*music|yt\s*music|youtube\s*müzik/i, 'youtube_music'],
  [/youtube/i,        'youtube'],
  [/spotify/i,        'spotify'],
  [/poweramp/i,       'poweramp'],
  [/soundcloud/i,     'soundcloud'],
  [/deezer/i,         'deezer'],
  [/tidal/i,          'tidal'],
  [/amazon\s*müzik|amazon\s*music|amazon/i, 'amazon'],
  [/apple\s*müzik|apple\s*music/i, 'apple'],
  [/dahili|yerel|local|dahili\s*müzik|telefon\s*müzik/i, 'local'],
];

/** Türkçe ekler kaldır (Spotify'dan → Spotify) */
const SUFFIX_PATTERN = /['']?(da|de|dan|den|ta|te|tan|ten|'da|'de|'dan|'den|'ta|'te|'tan|'ten)$/i;

function detectSource(normalized: string, raw: string): { source: MusicSource; remainingRaw: string } | null {
  for (const [pattern, key] of SOURCE_KEYWORDS) {
    const match = normalized.match(pattern);
    if (!match) continue;

    // Source kelimesi + eklerini raw input'tan temizle
    // Normalize üzerinde çalış — pozisyon bul
    const idx   = normalized.indexOf(match[0].toLowerCase().replace(/\s+/g, ' '));
    if (idx === -1) continue;

    // Eşleşen alanı raw'da da bul (büyük/küçük harf korunsun)
    // Basit: raw içinde normalized match'e karşılık gelen segment'i sil
    const rawMatch = raw.match(new RegExp(match[0].replace(/\s+/g, '\\s+') + SUFFIX_PATTERN.source + '?', 'i'));
    let remaining  = rawMatch ? raw.replace(rawMatch[0], '').trim() : raw;

    // "Spotify'dan ... aç" → "dan" önce boşluk + kaynak vardı
    // Baştaki / sondaki edatları temizle
    remaining = remaining
      .replace(/^(?:(?:den|dan|tan|ten|da|de|ta|te)\s+)/i, '')
      .trim();

    return { source: SOURCES[key], remainingRaw: remaining };
  }
  return null;
}

/* ── Query type inference ────────────────────────────────── */

const ARTIST_HINTS  = /\b(?:sanatçı|sanatçısı|şarkıları|şarkısı|albümler|albümü|albümü|grubu|grubu)\b/i;
const PLAYLIST_HINTS = /\b(?:playlist|çalma\s*list|liste|mix|karışık\s*playlist)\b/i;

function inferQueryType(query: string, raw: string): MusicQueryType {
  if (PLAYLIST_HINTS.test(raw)) return 'playlist';
  if (ARTIST_HINTS.test(raw)) return 'artist';
  // "karışık" tek başına → shuffle
  if (/\bkarışık\b/i.test(query) && query.replace(/karışık/i, '').trim().length < 3) return 'shuffle';
  return 'generic';
}

/* ── Music action verbs ──────────────────────────────────── */

// Türkçe müzik fiilleri (normalize edilmiş)
const PLAY_VERBS = [
  'caliiver', 'caliver', 'cal', 'oynat', 'oynat', 'calsin', 'ac', 'dinle',
  'baslat', 'goster', 'yukle',
];

// Fiil çekim ekleriyle biten pattern
const VERB_SUFFIX = /\s+(?:çal(?:ıver)?|oynat|aç|dinle|başlat|göster|yükle|çalsın)(?:\s+bana)?$/i;

const ADD_FAVORITE_PATTERN = /(?:bu\s+şarkıyı?\s+)?favor[iı](?:ler)?(?:ime|e)?\s+ekle/i;
const SHUFFLE_PATTERN      = /karışık(?:\s+(?:aç|çal|oynat|başlat))?|shuffle(?:\s+(?:aç|çal|oynat))?/i;

/* ── Normalisation ───────────────────────────────────────── */

function normalizeForDetection(s: string): string {
  return s.toLowerCase()
    .replace(/['''\u2018\u2019\u0060]/g, "'")
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Keyword gates ───────────────────────────────────────── */

// Bu kelimelerden biri varsa → müzik komutu olabilir
const MUSIC_GATE = /(?:çal|oynat|aç|dinle|başlat|müzik|şarkı|sanatçı|playlist|karışık|favorilere|spotify|youtube|poweramp|soundcloud|deezer|tidal|amazon|apple|dahili|yerel)/i;

/* ── Generic/app words — query'den atla ─────────────────── */

const GENERIC_WORDS = new Set([
  'muzik', 'muzigi', 'sarki', 'sarkiyi', 'playlist', 'ses', 'music', 'song', 'audio',
  'bir', 've', 'ile', 'bana', 'benim', 'de', 'da', 'en', 'bir',
]);

function cleanQuery(q: string): string {
  return q
    .replace(VERB_SUFFIX, '')              // fiil kaldır
    .replace(/^(?:bir\s+)?/i, '')          // "bir" kelimesi başta
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Verilen ham metni müzik komutuna parse etmeyi dener.
 * Eşleşme yoksa null döner → commandParser genel matching'e devam eder.
 */
export function tryParseMusicCommand(raw: string): ParsedMusicCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Hızlı gate: müzikle ilgili bir şey var mı?
  if (!MUSIC_GATE.test(trimmed)) return null;

  const normalized = normalizeForDetection(trimmed);

  /* ── 1. Favorilere ekle ───────────────────────── */
  if (ADD_FAVORITE_PATTERN.test(trimmed)) {
    return {
      action:    'add_favorite',
      source:    null,
      query:     '',
      queryType: 'favorite',
      feedback:  'Şarkı favorilere ekleniyor',
      raw:       trimmed,
    };
  }

  /* ── 2. Müzik fiili var mı? ───────────────────── */
  const hasVerb = VERB_SUFFIX.test(trimmed) ||
    PLAY_VERBS.some(v => normalized.endsWith(' ' + v) || normalized === v);

  // Kaynak adı var mı? (verb olmadan da kaynak tek başına komut olabilir)
  const sourceResult = detectSource(normalized, trimmed);
  const hasSource    = sourceResult !== null;

  if (!hasVerb && !hasSource) return null;

  /* ── 3. Kaynak ve kalan sorguyu ayıkla ───────── */
  let source: MusicSource | null = null;
  let queryRaw = trimmed;

  if (sourceResult) {
    source   = sourceResult.source;
    queryRaw = sourceResult.remainingRaw;
  }

  /* ── 4. Shuffle komutu ───────────────────────── */
  if (SHUFFLE_PATTERN.test(queryRaw)) {
    const srcName = source?.name ?? 'Müzik';
    return {
      action:    'shuffle',
      source,
      query:     'shuffle',
      queryType: 'shuffle',
      feedback:  `${srcName}'de karışık çalınıyor`,
      raw:       trimmed,
    };
  }

  /* ── 5. Query temizle ────────────────────────── */
  const query = cleanQuery(queryRaw);

  // Query boşsa ve sadece kaynak var → uygulamayı aç
  if (!query || query.length < 2) {
    if (!source) return null;
    return {
      action:    'play',
      source,
      query:     '',
      queryType: 'generic',
      feedback:  `${source.name} açılıyor`,
      raw:       trimmed,
    };
  }

  // Generic word kontrolü — tek generic kelime varsa skip
  const queryTokens = normalizeForDetection(query).split(' ').filter(t => t.length > 1);
  if (queryTokens.length === 1 && GENERIC_WORDS.has(queryTokens[0])) return null;

  /* ── 6. Query type inference ─────────────────── */
  const queryType = inferQueryType(query, trimmed);

  /* ── 7. Feedback ─────────────────────────────── */
  const srcName = source?.name ?? 'Müzik';
  const cleanedQuery = query
    .replace(ARTIST_HINTS, '').replace(PLAYLIST_HINTS, '')
    .replace(/\s+/g, ' ').trim();

  const feedback = source
    ? `${srcName}'de "${cleanedQuery}" aranıyor`
    : `"${cleanedQuery}" aranıyor`;

  return {
    action:    'play',
    source,
    query:     cleanedQuery || query,
    queryType,
    feedback,
    raw:       trimmed,
  };
}
