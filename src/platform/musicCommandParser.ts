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
  ymusic: {
    pkg:       'com.kapp.youtube.music',
    name:      'YMusic',
    bridgeKey: 'generic',
    searchUri: (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
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
  [/y\s*m[üu]zik|ymusic|y\s*music/i,  'ymusic'],
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
    // SUFFIX_PATTERN.source sonu '$' içerdiğinden doğrudan '?' ile değiştirilemez:
    // /...ten)$?/i → "Nothing to repeat" hatası ($ anchor sayısal değil, niceleyici alamaz).
    // Çözüm: '$' kaldırılıp gruba '?' eklenir → /...ten)?/i
    const suffixOptional = SUFFIX_PATTERN.source.replace(/\$$/, '') + '?';
    const rawMatch = raw.match(new RegExp(match[0].replace(/\s+/g, '\\s+') + suffixOptional, 'i'));
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
  'baslat', 'goster', 'yukle', 'koy',
];

/* Saha hatası (2026-06-11): "İbrahim Tatlıses'ten müzik açar mısın" gibi
 * ÇEKİMLİ fiiller eşleşmiyordu → cümle companion sohbetine düşüp Gemini
 * sanatçının HAYATINI anlatıyordu. Çekim aileleri:
 *   aç / açar mısın / açabilir misin / açsana (+ cal/koy/oynat/dinle aynı)
 * Soru eki tüm ünlü uyumları: mısın/misin/musun/müsün (+ "mi sin" boşluklu ASR).
 * Sondaki nezaket kelimeleri (bana/lütfen/hadi/bi/bir) yutulur. */
const POLITE_TAIL = String.raw`(?:\s+(?:bana|bize|lütfen|lutfen|hadi|haydi|bi|bir))*`;
const Q_SUFFIX    = String.raw`(?:\s*m[ıiuü]\s*s[ıiuü]n(?:[ıiuü]z)?)`; // "mısın"/"mı sın"/"mısınız"

// Fiil gövdeleri (aksanlı + aksansız) → çekim kombinasyonları tek pattern'de
const VERB_CORE = String.raw`(?:çal(?:ıver)?|cal(?:iver)?|oynat|aç|ac|dinle[t]?|başlat|baslat|göster|goster|yükle|yukle|koy)`;
const VERB_FORMS = String.raw`(?:` +
  VERB_CORE + String.raw`(?:sana|s[ıi]n)?` +                       // aç / açsana / çalsın
  String.raw`|` + VERB_CORE + String.raw`[aıe]r` + Q_SUFFIX +      // açar mısın / çalar mısın / koyar musun
  String.raw`|` + VERB_CORE + String.raw`abil[ıi]r` + Q_SUFFIX +   // açabilir misin / çalabilir misin
  String.raw`|` + VERB_CORE + String.raw`[ıi]r` + Q_SUFFIX +       // dinletir misin / gösterir misin
  String.raw`)`;

// Fiil çekim ekleriyle biten pattern (hem aksan'lı hem aksan'sız form)
const VERB_SUFFIX = new RegExp(String.raw`\s+` + VERB_FORMS + POLITE_TAIL + String.raw`$`, 'i');

// GÜÇLÜ müzik fiilleri — tek başlarına kesin müzik niyeti taşır (çal/oynat/koy/dinle).
// ZAYIF/genel fiiller (aç/başlat/göster/yükle) bunun DIŞINDA: "aç" = Türkçe "open",
// "perdeyi aç"/"X göster" veya Vosk'un yanlış duyduğu cümleler müzik AÇMASIN diye
// zayıf fiil için ayrıca müzik bağlamı (kaynak adı VEYA müzik kelimesi) aranır.
const STRONG_CORE = String.raw`(?:çal(?:ıver)?|cal(?:iver)?|oynat|dinle[t]?|koy)`;
const STRONG_VERB_SUFFIX = new RegExp(
  String.raw`\s+(?:` +
  STRONG_CORE + String.raw`(?:sana|s[ıi]n)?` +
  String.raw`|` + STRONG_CORE + String.raw`[aıe]r` + Q_SUFFIX +
  String.raw`|` + STRONG_CORE + String.raw`abil[ıi]r` + Q_SUFFIX +
  String.raw`|` + STRONG_CORE + String.raw`[ıi]r` + Q_SUFFIX +
  String.raw`)` + POLITE_TAIL + String.raw`$`, 'i');

/* Fiilsiz ama NET müzik istekleri:
 *  - "<sanatçı>'ten müzik" / "tatlısesten şarkı" (ablatif + müzik kelimesi)
 *  - "<sanatçı> şarkıları(nı)" / "<sanatçı> şarkısı" (iyelik çoğul) */
const ABLATIVE_MUSIC  = /['']?(?:dan|den|tan|ten)\s+(?:müzik|muzik|şarkı|sarki|parça|parca)/i;
const VERBLESS_ARTIST = /\S\s+\S*(?:şarkıları(?:nı)?|sarkilari(?:ni)?|şarkısı(?:nı)?|sarkisi(?:ni)?|müzikleri(?:ni)?|muzikleri(?:ni)?)$/i;

// Açık müzik bağlam kelimesi — zayıf fiilli komutun gerçekten müzik olduğunu doğrular.
const MUSIC_CONTEXT_WORD = /(?:müzik|muzik|şarkı|sarki|parça|parca|playlist|çalma\s*list|albüm|albume?|album|karışık|karisik|favori)/i;

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
const MUSIC_GATE = /(?:çal|oynat|aç|dinle|başlat|müzik|şarkı|sanatçı|playlist|karışık|favorilere|spotify|youtube|poweramp|soundcloud|deezer|tidal|amazon|apple|dahili|yerel|ymusic|y\s*müzik)/i;

/* ── Generic/app words — query'den atla ─────────────────── */

const GENERIC_WORDS = new Set([
  'muzik', 'muzigi', 'sarki', 'sarkiyi', 'playlist', 'ses', 'music', 'song', 'audio',
  'bir', 've', 'ile', 'bana', 'benim', 'de', 'da', 'en', 'bir',
]);

/**
 * "aç" fiili tek başına müzik anlamına gelmez.
 * "haritayı aç", "ayarları aç", "kamerayı aç" gibi komutlar
 * müzik parser'ına girip yanlış query oluşturmasın.
 * Kaynak yokken (source=null) bu kelimelerin olduğu query'ler reddedilir.
 */
const NON_MUSIC_TARGETS = new Set([
  'harita', 'haritayi', 'haritaya', 'maps', 'navigasyon', 'navigasyonu',
  'ayar', 'ayarlari', 'ayarlara', 'settings',
  'kamera', 'kamerayi', 'galeri', 'galeriyi',
  'telefon', 'telefonu', 'arama', 'mesaj', 'mesaji',
  'alarm', 'alarmı', 'alarmi', 'takvim', 'takvimi',
  'uygulama', 'uygulamayi', 'sistem',
  // Donanım hedefleri — "kapıyı aç", "kilidi aç" müzik araması DEĞİL (→ hw_unlock_doors)
  'kapi', 'kapiyi', 'kapilari', 'kapilar', 'kilit', 'kilidi', 'kapagi',
  'pencere', 'pencereyi', 'cam', 'bagaj', 'bagaji',
]);

// Tek başına kalan fiil — öncesinde boşluk olmaksızın tam eşleşme.
// Kaynak çıkarımından sonra queryRaw="aç" gibi kalıntı fiilin temizlenmesi için.
const STANDALONE_VERB = new RegExp(String.raw`^` + VERB_FORMS + POLITE_TAIL + String.raw`$`, 'i');

function cleanQuery(q: string): string {
  let r = q
    .replace(VERB_SUFFIX, '')       // " aç" gibi sondaki fiil + boşluk
    .replace(STANDALONE_VERB, '')   // tek başına kalan "aç"/"ac" kalıntısı
    .replace(/^(?:bir\s+)?/i, '')   // "bir" kelimesi başta
    .replace(/\s+/g, ' ')
    .trim();

  // "<sanatçı>'ten müzik aç" kalıbı: VERB_SUFFIX " aç"ı attıktan sonra geriye
  // "İbrahim Tatlıses'ten müzik" kalır. Sondaki jenerik kelimeyi ("müzik/şarkı/
  // parça" + çoğul/iyelik biçimleri: "şarkıları", "müziklerini") ve ardından
  // sanatçıdaki Türkçe ablatif eki ('ten/'den/'tan/'dan) temizle ki arama
  // sorgusu sade sanatçı adı olsun → tüm kaynaklarda bulunur.
  const TRAILING_MUSIC_WORD =
    /\s+(?:müzik(?:leri(?:ni)?|i)?|muzik(?:leri(?:ni)?|i)?|şarkı(?:yı|sı(?:nı)?|ları(?:nı)?)?|sarki(?:yi|si(?:ni)?|lari(?:ni)?)?|parça(?:yı|sı(?:nı)?)?|parca(?:yi|si(?:ni)?)?)$/i;
  const hadMusicWord = TRAILING_MUSIC_WORD.test(r);
  r = r.replace(TRAILING_MUSIC_WORD, '').trim();
  // Apostroflu ek her zaman güvenle silinir ("Tatlıses'ten" → "Tatlıses").
  r = r.replace(/['']\s*(?:dan|den|tan|ten|da|de|ta|te)$/i, '').trim();
  // Apostrofsuz ek yalnızca "X müzik/şarkı" kalıbı kesinleştiyse silinir
  // (ASR apostrofu düşürmüş olabilir: "tatlısesten müzik" → "tatlıses").
  if (hadMusicWord) r = r.replace(/(?:dan|den|tan|ten)$/i, '').trim();

  return r;
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Müzik AKSİYONU istenen ama parser'ın yapılandıramadığı cümleler için
 * sezgi (companion sohbet kapısı): müzik bağlam kelimesi + aksiyon fiili
 * birlikteyse cümle SOHBET DEĞİLDİR — Gemini'nin sanatçının hayatını
 * anlatması yerine zincir komut/semantic yoluna devam etmelidir
 * (saha hatası 2026-06-11: "İbrahim Tatlıses'ten müzik aç" → biyografi).
 * Soru cümleleri ("bu şarkı kimin") sohbete gitmeye devam eder.
 */
export function looksLikeMusicActionRequest(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (!MUSIC_CONTEXT_WORD.test(t)) return false;
  if (/^(?:bu|şu|su|o|kim|kimin|ne|neyin|hangi|kaç|kac)\b/i.test(t)) return false;
  const n = normalizeForDetection(t);
  // Fiil kökü + kontrollü ek seti: aç/açar/açsana/açabilir/açıver...
  // ('calisma' gibi kelimeler eşleşmez — ek seti sınırlı).
  return /(?:^|\s)(?:ac|cal|koy|oynat|baslat|dinle|dinlet)(?:ar|er|ir|iver|sana|sin|abilir|ebilir|tir)?(?:\s|$)/.test(n)
    || ABLATIVE_MUSIC.test(t);
}

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
  // Fiilsiz net istekler: "tatlıses'ten müzik" (ablatif) · "tarkan şarkıları"
  // (iyelik) — soru cümleleri HARİÇ ("bu kimin şarkısı" müzik araması değil).
  const verblessMusic =
    (ABLATIVE_MUSIC.test(trimmed) || VERBLESS_ARTIST.test(trimmed)) &&
    !/^(?:bu|şu|su|o|kim|kimin|ne|neyin|hangi|kaç|kac)\b/i.test(trimmed);
  const hasVerb = VERB_SUFFIX.test(trimmed) ||
    PLAY_VERBS.some(v => normalized.endsWith(' ' + v) || normalized === v) ||
    verblessMusic;

  // Kaynak adı var mı? (verb olmadan da kaynak tek başına komut olabilir)
  const sourceResult = detectSource(normalized, trimmed);
  const hasSource    = sourceResult !== null;

  if (!hasVerb && !hasSource) return null;

  // PRECISION KAPISI: zayıf fiil (aç/başlat/göster/yükle) TEK BAŞINA müzik sayılmaz.
  // Müzik için ya GÜÇLÜ fiil (çal/oynat/çalsın/dinle), ya kaynak adı (Spotify…),
  // ya da açık müzik kelimesi (müzik/şarkı…) gerekir. Aksi halde "perdeyi aç",
  // "X göster" veya Vosk yanlış-transkripsiyonları yanlışlıkla müzik açıyordu.
  // ("müzik aç"/"spotify aç" buradan GEÇER → sonraki adımlar open_music'e yönlendirir.)
  const hasStrongVerb = STRONG_VERB_SUFFIX.test(trimmed);
  const hasMusicWord  = MUSIC_CONTEXT_WORD.test(trimmed);
  if (!hasStrongVerb && !hasSource && !hasMusicWord) return null;

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

  // Query boşsa ve sadece kaynak var → o kaynaktan müzik başlat (uygulamayı ön plana alma)
  if (!query || query.length < 2) {
    if (!source) return null;
    return {
      action:    'play',
      source,
      query:     '',
      queryType: 'generic',
      feedback:  `${source.name}'den müzik başlatılıyor`,
      raw:       trimmed,
    };
  }

  // Generic word kontrolü — tüm tokenlar generic kelimeyse
  const queryTokens = normalizeForDetection(query).split(' ').filter(t => t.length > 1);
  if (queryTokens.length >= 1 && queryTokens.every(t => GENERIC_WORDS.has(t))) {
    // Kaynak tespit edildiyse sadece uygulamayı aç; yoksa müzik komutu değil
    if (source) {
      return { action: 'play', source, query: '', queryType: 'generic', feedback: `${source.name} açılıyor`, raw: trimmed };
    }
    return null;
  }

  // UI hedef kontrolü — kaynak yokken "haritayı", "ayarları" gibi UI bileşen isimleri
  // müzik sorgusu DEĞİLDİR: "haritayı aç" → open_maps, "ayarları aç" → open_settings.
  if (!source && queryTokens.every(t => NON_MUSIC_TARGETS.has(t))) return null;

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
