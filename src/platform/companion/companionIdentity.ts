/**
 * companionIdentity.ts — "Yol Arkadaşım" (Companion AI) kimlik modeli.
 *
 * Tek sorumluluk: kullanıcı girdili kimlik alanlarını (asistan adı, hitap,
 * uyandırma cümlesi) TTS ve LLM prompt'una girmeden önce GÜVENLİ hâle
 * getirmek. Motor yok, wake word yok, Gemini yok — yalnız saf fonksiyonlar.
 *
 * Güvenlik garantileri (yapısal):
 *  - Maksimum 24 karakter (COMPANION_TEXT_MAX_LEN)
 *  - TTS'i bozan özel karakterler temizlenir (yalnız harf/rakam/boşluk/'/- kalır)
 *  - Prompt injection kalıpları metinden sökülür
 *  - Boş/bozuk değer her zaman fallback'e düşer — asla undefined/boş ad konuşulmaz
 *
 * Bkz: docs/COMPANION_AI_ARCHITECTURE.md §7 (ayar modeli), §2.5 (bulut sızması).
 */

/* ── Sabitler ───────────────────────────────────────────────── */

export const COMPANION_TEXT_MAX_LEN = 24;
/**
 * Varsayılan asistan adı — ÜRÜN KARARI (2026-06-11): 'Mavi'.
 * Gerekçe: asistan adı artık wake sisteminin MERKEZİ ("Mavi" / "Hey Mavi"
 * ile uyanır); "Yol Arkadaşım" wake cümlesi olarak kullanılamayacak kadar
 * uzun. "Yol Arkadaşım" ÖZELLİĞİN adı olarak kalır (ayar paneli başlığı),
 * 'Mavi' ise asistanın varsayılan KİŞİSEL adıdır — kullanıcı değiştirebilir.
 */
export const DEFAULT_ASSISTANT_NAME = 'Mavi';
export const DEFAULT_WAKE_PHRASE    = 'Hey Mavi';

export type CompanionPersonality = 'sessiz' | 'samimi' | 'neseli' | 'profesyonel';
export type CompanionChattiness  = 'az' | 'normal' | 'sik';

/**
 * Uyanma şekli — wake sözleri asistan ADINDAN türetilir:
 *  - 'name'     → yalnız "{ad}"
 *  - 'hey_name' → yalnız "Hey {ad}"
 *  - 'both'     → ikisi de (varsayılan)
 *  - 'custom'   → kullanıcının yazdığı özel cümle (companionWakePhrase)
 */
export type CompanionWakeMode = 'name' | 'hey_name' | 'both' | 'custom';
// Varsayılan 'hey_name' (2026-06-12): eski 'both' tek kelime "Mavi"yi de wake
// yapıyordu → araç içinde radyo/yolcu "mavi" deyince yanlış tetikleme. Artık
// yalnız "Hey Mavi" (+ Vosk eşdeğerleri ey/hay/hei) uyandırır. Kullanıcı
// dilerse ayarlardan 'name'/'both' seçip tek kelimeyle de uyandırabilir.
export const DEFAULT_WAKE_MODE: CompanionWakeMode = 'hey_name';
const WAKE_MODES: readonly CompanionWakeMode[] = ['name', 'hey_name', 'both', 'custom'];

export const DEFAULT_PERSONALITY: CompanionPersonality = 'samimi';
export const DEFAULT_CHATTINESS:  CompanionChattiness  = 'az';

const PERSONALITIES: readonly CompanionPersonality[] = ['sessiz', 'samimi', 'neseli', 'profesyonel'];
const CHATTINESS_LEVELS: readonly CompanionChattiness[] = ['az', 'normal', 'sik'];

/* ── Prompt injection kalıpları ─────────────────────────────── *
 * Ad/hitap alanları Gemini system prompt'una gömüleceği için (Commit 7)
 * talimat-gaspı kalıpları karakter filtresinden ÖNCE sökülür — aksi hâlde
 * "ignore previous instructions" gibi ifadeler harf filtresinden aynen geçer. */
// DİKKAT: JS regex'te \b ve \w yalnız ASCII bilir — Türkçe harfler
// (ö, ı, ş…) kelime karakteri sayılmaz. Türkçe kalıplarda \b/\w yerine
// açık karakter sınıfı kullanılır.
const TR = "a-zA-ZçğıöşüÇĞİÖŞÜâîûÂÎÛ";
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(instruction|prompt|rule|previous|above|system)\w*/gi,
  new RegExp(`(önceki|yukarıdaki|tüm)\\s+(talimat|komut|kural)[${TR}]*\\s*(yok\\s*say|unut|görmezden)[${TR}]*`, 'gi'),
  /\b(system|assistant|user|developer)\s*(prompt|message|role)?\s*:/gi,
  /\b(act\s+as|jailbreak)\b/gi,
  /\bDAN\b/g, // yalnız büyük harf — "Dan" meşru bir isim
  /\{\{[\s\S]*?\}\}|\[\[[\s\S]*?\]\]|<\|[\s\S]*?\|>/g,
  /<\/?[a-zA-Z][^>]*>/g, // tag benzeri her şey (XML/HTML prompt sınırlayıcıları)
];

/* ── Karakter beyaz listesi ─────────────────────────────────── *
 * TTS güvenliği: Türkçe/Latin harf, rakam, boşluk, apostrof, tire.
 * Emoji, tırnak, backtick, süslü/köşeli parantez, kontrol karakteri,
 * satır sonu — hepsi sessizce düşer. */
const ALLOWED_CHARS = /[^a-zA-Z0-9çğıöşüÇĞİÖŞÜâîûÂÎÛ' -]/g;

/* ── Çekirdek sanitizer ─────────────────────────────────────── */

/**
 * Tek geçişli güvenli metin temizliği. Boş sonuç → fallback.
 * Sıra önemli: injection kalıpları → karakter filtresi → whitespace → kırpma.
 */
export function sanitizeCompanionText(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;

  let text = raw;
  for (const pattern of INJECTION_PATTERNS) {
    // lastIndex sıfırlama: global regex'ler çağrılar arasında durum taşır
    pattern.lastIndex = 0;
    text = text.replace(pattern, ' ');
  }
  text = text
    .replace(/\s+/g, ' ')      // önce: \n,\t → boşluk (whitelist silmeden kelimeler yapışmasın)
    .replace(ALLOWED_CHARS, '')
    .replace(/\s+/g, ' ')      // sonra: silinen karakterlerin bıraktığı çift boşluklar
    .trim();

  if (text.length > COMPANION_TEXT_MAX_LEN) {
    text = text.slice(0, COMPANION_TEXT_MAX_LEN).trim();
  }
  // Yalnız apostrof/tire kalan "adlar" anlamsız — fallback'e düş
  if (!/[a-zA-Z0-9çğıöşüÇĞİÖŞÜâîûÂÎÛ]/.test(text)) return fallback;
  return text;
}

/** Asistan adı — boş/bozuk değerde 'Yol Arkadaşım'. */
export function sanitizeAssistantName(raw: unknown): string {
  return sanitizeCompanionText(raw, DEFAULT_ASSISTANT_NAME);
}

/**
 * Kullanıcı hitabı ("bana böyle seslen").
 * Boşsa: kullanıcı adı (varsa, o da sanitize edilir) → yoksa boş string.
 * Boş hitap geçerli bir durumdur — şablonlar hitapsız varyant kullanır.
 */
export function sanitizeUserCallsign(raw: unknown, fallbackUserName?: string): string {
  const callsign = sanitizeCompanionText(raw, '');
  if (callsign) return callsign;
  if (fallbackUserName) return sanitizeCompanionText(fallbackUserName, '');
  return '';
}

/** Uyandırma cümlesi — boş/bozuk değerde 'Hey Mavi'. */
export function sanitizeWakePhrase(raw: unknown): string {
  return sanitizeCompanionText(raw, DEFAULT_WAKE_PHRASE);
}

/** Öğretilen wake örnekleri (Vosk çıktısı) — normalize, max 5, boşlar elenir. */
export const WAKE_ENROLLMENT_MAX = 5;
export function sanitizeWakeEnrollment(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const n = normalizeWakeText(item);
    if (n.length >= 2 && !out.includes(n)) out.push(n);
    if (out.length >= WAKE_ENROLLMENT_MAX) break;
  }
  return out;
}

/* ── Wake word türetme + eşleşme (asistan adı merkezli) ─────── */

/** Önerilen wake cümlesi — asistan adı değişince UI bu öneriyi gösterir. */
export function suggestWakePhrase(assistantName: unknown): string {
  return `Hey ${sanitizeAssistantName(assistantName)}`;
}

/**
 * Wake eşleşme normalizasyonu: Türkçe küçük harf (İ→i dahil), aksan
 * sadeleştirme (ı/ö/ü/ç/ş/ğ/â/î/û → ASCII), noktalama temizliği.
 * "MAVİ?", "mavi", "Hey Mavi!" → hepsi aynı forma iner.
 */
export function normalizeWakeText(raw: string): string {
  return raw
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tek-kelimelik wake için minimum normalize uzunluk — altı yanlış tetikler. */
const MIN_BARE_NAME_LEN = 3;

/**
 * Vosk Türkçe modeli "hey" İngilizce kelimesini güvenilir tanımaz —
 * sahada "hey mavi" çoğu kez "ey mavi"/"hay mavi" olarak döner ve wake
 * hiç tetiklenmezdi. "hey {ad}" varyantı bu eşdeğer öneklerle genişletilir.
 */
const HEY_EQUIVALENTS = ['hey', 'ey', 'hay', 'hei'] as const;

function heyVariants(name: string): string[] {
  return HEY_EQUIVALENTS.map((h) => `${h} ${name}`);
}

/**
 * Aktif wake sözlerini (normalize edilmiş) kimlikten türetir.
 * Asistan adı wake sisteminin MERKEZİ: ad değişince sözler otomatik değişir.
 * Güvenlik: ad sanitize'dan geçmiştir; çok kısa ad (<3) tek başına
 * tetikleyici OLMAZ — yalnız "hey {ad}" varyantı kalır (yanlış tetikleme).
 */
export function resolveWakeWords(identity: Pick<CompanionIdentity, 'assistantName' | 'wakeMode' | 'wakePhrase'>): string[] {
  const name = normalizeWakeText(identity.assistantName);
  const words: string[] = [];

  if (identity.wakeMode === 'custom') {
    const custom = normalizeWakeText(identity.wakePhrase);
    if (custom.length >= MIN_BARE_NAME_LEN) {
      // "hey ..." ile başlayan özel cümle de Vosk eşdeğerleriyle genişler
      // (boş cümlenin fallback'i 'Hey Mavi' buradan geçer).
      return custom.startsWith('hey ') ? heyVariants(custom.slice(4)) : [custom];
    }
    // Özel cümle çok kısaysa güvenli varsayılana düş (fail-soft)
    return name ? heyVariants(name) : heyVariants(normalizeWakeText(DEFAULT_ASSISTANT_NAME));
  }
  if ((identity.wakeMode === 'name' || identity.wakeMode === 'both') && name.length >= MIN_BARE_NAME_LEN) {
    words.push(name);
  }
  if (identity.wakeMode === 'hey_name' || identity.wakeMode === 'both' || words.length === 0) {
    if (name) words.push(...heyVariants(name));
  }
  return words.length > 0 ? words : heyVariants(normalizeWakeText(DEFAULT_ASSISTANT_NAME));
}

/**
 * Transcript wake sözlerinden birini içeriyor mu — KELİME SINIRLI ardışık
 * eşleşme ("mavi" ⊄ "maviş"; "hey mavi naber" → eşleşir).
 */
export function matchesWakeTranscript(transcript: string, wakeWords: readonly string[]): boolean {
  const tWords = normalizeWakeText(transcript).split(' ').filter(Boolean);
  if (tWords.length === 0) return false;
  for (const phrase of wakeWords) {
    const pWords = phrase.split(' ').filter(Boolean);
    if (pWords.length === 0) continue;
    for (let i = 0; i + pWords.length <= tWords.length; i++) {
      let ok = true;
      for (let j = 0; j < pWords.length; j++) {
        if (tWords[i + j] !== pWords[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

/* ── Fonetik ESNEK eşleşme (sözlük-dışı / özel wake kelimeleri) ──
 * Vosk grammar YALNIZ modelin sözlüğündeki kelimeleri tanır → kullanıcının
 * yazdığı uydurma/sözlük-dışı kelime ("asist", "kaptan3") grammar'dan sessizce
 * düşer ve wake HİÇ tetiklenmez. Çözüm: özel modda SERBEST tanıma yapılır (Vosk
 * en yakın gerçek kelimeleri döker) ve bu çıktı hedefe FONETİK olarak yakınsa
 * (normalize Levenshtein) eşleşir. İki kaynak:
 *   - typed: kullanıcının yazdığı cümle (tolerans yüksek — telaffuz tahmini)
 *   - enrolled: kullanıcının SÖYLEYEREK öğrettiği örnekler = Vosk'un gerçekte
 *     duyduğu çıktı (yüksek güven — daha sıkı eşik). */

function _levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** İki wake dizesinin normalize benzerliği (0..1). Boşlukları kaldırır. */
export function wakeSimilarity(a: string, b: string): number {
  const na = normalizeWakeText(a).replace(/\s+/g, '');
  const nb = normalizeWakeText(b).replace(/\s+/g, '');
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - _levenshtein(na, nb) / maxLen;
}

// Eşikler saha ile ayarlanır: düşük = daha çok yanlış tetik, yüksek = uyanmama.
const FUZZY_TYPED_THRESHOLD  = 0.72;  // yazılan cümle (telaffuz tahmini toleransı)
const FUZZY_TYPED_MIN_LEN    = 4;     // <4 harf tek başına fonetik eşleşmez (yanlış tetik)
const FUZZY_ENROLL_THRESHOLD = 0.82;  // öğretilen örnek = Vosk'un duyduğu → daha sıkı
const FUZZY_ENROLL_MIN_LEN   = 3;

function _fuzzyHit(
  tWords: readonly string[],
  targets: readonly string[],
  threshold: number,
  minLen: number,
): boolean {
  for (const raw of targets) {
    const P = normalizeWakeText(raw).split(' ').filter(Boolean);
    const targetStr = P.join('');
    if (targetStr.length < minLen) continue;
    const pLen = P.length;
    // Vosk hedefi bölebilir/birleştirebilir → ±1 kelimelik pencereler dene.
    for (let w = Math.max(1, pLen - 1); w <= pLen + 1; w++) {
      for (let i = 0; i + w <= tWords.length; i++) {
        const cand = tWords.slice(i, i + w).join('');
        if (!cand) continue;
        const sim = 1 - _levenshtein(cand, targetStr) / Math.max(cand.length, targetStr.length);
        if (sim >= threshold) return true;
      }
    }
  }
  return false;
}

/**
 * ÖZEL/sözlük-dışı wake eşleşmesi: serbest tanıma çıktısını (transcript) hem
 * yazılan hedeflere hem öğretilen örneklere fonetik yakınlıkla dener.
 * Kelime-sınırlı TAM eşleşme (matchesWakeTranscript) yetersiz kaldığında kullanılır.
 */
export function fuzzyMatchesWake(
  transcript: string,
  typedTargets: readonly string[],
  enrolled: readonly string[] = [],
): boolean {
  const tWords = normalizeWakeText(transcript).split(' ').filter(Boolean);
  if (tWords.length === 0) return false;
  // 1) Önce TAM eşleşme (in-vocab kelimeler + öğretilen örnekler birebir).
  if (matchesWakeTranscript(transcript, typedTargets)) return true;
  if (enrolled.length && matchesWakeTranscript(transcript, enrolled)) return true;
  // 2) Öğretilen örnekler (Vosk'un duyduğu) — yüksek güven, sıkı eşik.
  if (enrolled.length && _fuzzyHit(tWords, enrolled, FUZZY_ENROLL_THRESHOLD, FUZZY_ENROLL_MIN_LEN)) return true;
  // 3) Yazılan cümle — fonetik tolerans.
  return _fuzzyHit(tWords, typedTargets, FUZZY_TYPED_THRESHOLD, FUZZY_TYPED_MIN_LEN);
}

/* ── Wake phrase risk uyarısı ───────────────────────────────── */

const TURKISH_VOWELS = /[aeıioöuüâîûAEIİOÖUÜÂÎÛ]/g;

/**
 * Kısa/tek kelimelik uyandırma cümlesi yanlış tetikleme riski taşır
 * (yol gürültüsü, radyo, yolcu konuşması — mimari doküman §2.3).
 * Tek kelime VE ≤3 sesli harf ("Mavi", "Can") → uyarı metni; aksi hâlde null.
 */
export function getWakePhraseWarning(phrase: string): string | null {
  const clean = sanitizeCompanionText(phrase, '');
  if (!clean) return null;
  const words = clean.split(' ');
  if (words.length > 1) return null;
  const vowelCount = (clean.match(TURKISH_VOWELS) ?? []).length;
  if (vowelCount > 3) return null;
  return `"${clean}" gibi kısa isimler araç içinde yanlışlıkla tetiklenebilir (yanlış tetikleme) — "Hey ${clean}" daha güvenlidir.`;
}

/* ── Kimlik çözücü ──────────────────────────────────────────── */

export interface CompanionIdentity {
  enabled:         boolean;
  assistantName:   string;
  userCallsign:    string;
  personality:     CompanionPersonality;
  chattiness:      CompanionChattiness;
  wakeWordEnabled: boolean;
  wakeMode:        CompanionWakeMode;
  wakePhrase:      string;
  /** Söyleyerek öğretilen wake örnekleri (Vosk çıktısı, normalize). */
  wakeEnrollment:  string[];
}

/** Ayarlardan okunan ham değerler (persist'ten bozuk gelebilir). */
export interface CompanionSettingsInput {
  companionEnabled?:         unknown;
  companionAssistantName?:   unknown;
  companionUserCallsign?:    unknown;
  companionPersonality?:     unknown;
  companionChattiness?:      unknown;
  companionWakeWordEnabled?: unknown;
  companionWakeMode?:        unknown;
  companionWakePhrase?:      unknown;
  companionWakeEnrollment?:  unknown;
}

function asPersonality(raw: unknown): CompanionPersonality {
  return PERSONALITIES.includes(raw as CompanionPersonality)
    ? (raw as CompanionPersonality) : DEFAULT_PERSONALITY;
}

function asChattiness(raw: unknown): CompanionChattiness {
  return CHATTINESS_LEVELS.includes(raw as CompanionChattiness)
    ? (raw as CompanionChattiness) : DEFAULT_CHATTINESS;
}

function asWakeMode(raw: unknown): CompanionWakeMode {
  return WAKE_MODES.includes(raw as CompanionWakeMode)
    ? (raw as CompanionWakeMode) : DEFAULT_WAKE_MODE;
}

/**
 * Persist'ten gelen ham ayarları her zaman güvenli bir kimliğe çevirir.
 * Companion motoru (Commit 4) ve Gemini prompt'u (Commit 7) ayarları
 * DOĞRUDAN okumaz — yalnız bu çözücüden geçen değerleri kullanır.
 */
export function resolveCompanionIdentity(
  settings: CompanionSettingsInput,
  fallbackUserName?: string,
): CompanionIdentity {
  return {
    enabled:         settings.companionEnabled === true,
    assistantName:   sanitizeAssistantName(settings.companionAssistantName),
    userCallsign:    sanitizeUserCallsign(settings.companionUserCallsign, fallbackUserName),
    personality:     asPersonality(settings.companionPersonality),
    chattiness:      asChattiness(settings.companionChattiness),
    wakeWordEnabled: settings.companionWakeWordEnabled === true,
    wakeMode:        asWakeMode(settings.companionWakeMode),
    wakePhrase:      sanitizeWakePhrase(settings.companionWakePhrase),
    wakeEnrollment:  sanitizeWakeEnrollment(settings.companionWakeEnrollment),
  };
}
