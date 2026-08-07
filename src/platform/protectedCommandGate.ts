/**
 * protectedCommandGate.ts — KORUNAN EYLEM KAPISI · WHOLE-INPUT ALLOWLIST (P0)
 *
 * ── ÖNCEKİ ÇÖZÜM NEDEN YETERSİZDİ (bağımsız denetim: REJECTED) ──────────────
 * `hardwareSpeechActGuard` bir **kara liste** (regex ailesi) idi: güvenlik,
 * listenin eksiksiz olmasına bağlıydı. 160 örneklik bağımsız corpus'ta 36 yanlış
 * pozitif üretti — tek tırnaklı alıntı (`'aracı kilitle'`), `... demiştim`,
 * `... yazısını göster`, `araç durduğunda ...`, `... iptal`, `... vazgeç`.
 * Kök sebep değişmemişti: intent hâlâ **cümle içinde kalıp bulunmasıyla**
 * (`padded.includes(...)`) üretiliyordu.
 *
 * ── YENİ SÖZLEŞME: ALLOWLIST-FIRST · UNKNOWN-FIRST · FAIL-CLOSED ───────────
 * Korunan eylem intent'i YALNIZ **normalize edilmiş girdinin TAMAMI** canonical
 * bir komut ifadesine eşitse üretilir. Uzun cümlede kalıbın bulunması YETMEZ.
 * Güvenlik artık bir regex listesinin eksiksizliğine DEĞİL, yapısal bir
 * eşitlik kuralına dayanır — bilinmeyen bir söz edimi kalıbı kapıyı AÇAMAZ.
 *
 * İzin verilen tek esneklik, AÇIK ALLOWLIST hâlindeki nezaket ekleridir
 * (`lütfen` · `mavi` · `mavi lütfen` · `şimdi` önek; `lütfen` sonek). Genel
 * önek/sonek/containment toleransı YOKTUR.
 *
 * SAF MODÜL: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 * Katalog ve normalizasyon DIŞARIDAN enjekte edilir (tek gerçek kaynak
 * `commandParser.PATTERNS`; ikinci bir ifade listesi burada TUTULMAZ).
 */

import type { HardwareSpeechActClass } from './hardwareSpeechActGuard';

/* ── Korunan eylem sınıfları ─────────────────────────────────────────────── */

/**
 * `vehicle` — gerçek aktüatöre dokunan / geri alınamayan araç eylemleri.
 * `view`    — yalnız ekran/görünüm değiştiren UI eylemleri. Aynı fiziksel
 *             donanım ağırlığı YOKTUR, ama phrase-containment kaynaklı yanlış
 *             intent üretmeleri de aynı şekilde engellenir.
 */
export type ProtectedActionClass = 'vehicle' | 'view';

export const PROTECTED_VEHICLE_ACTIONS: ReadonlySet<string> = new Set<string>([
  'hw_lock_doors',
  'hw_unlock_doors',
  'hw_honk_horn',
  'hw_flash_lights',
  'hw_alarm_on',
  'hw_alarm_off',
  'vehicle_clear_dtc',
  'hw_lights_off',
]);

export const PROTECTED_VIEW_ACTIONS: ReadonlySet<string> = new Set<string>([
  'hw_rear_camera',
  'hw_screen_off',
]);

export const PROTECTED_ACTION_TYPES: ReadonlySet<string> = new Set<string>([
  ...PROTECTED_VEHICLE_ACTIONS,
  ...PROTECTED_VIEW_ACTIONS,
]);

export function protectedActionClass(type: string): ProtectedActionClass | null {
  if (PROTECTED_VEHICLE_ACTIONS.has(type)) return 'vehicle';
  if (PROTECTED_VIEW_ACTIONS.has(type))    return 'view';
  return null;
}

/* ── Sözleşme tipleri ────────────────────────────────────────────────────── */

export type ProtectedActionBlockReason =
  /** Komut kalıbı cümlede geçiyor ama girdinin TAMAMI değil. */
  | 'not_whole_input'
  /** Girdi tırnak işareti taşıyor → kullanım değil ZİKİR (mention). */
  | 'quoted';

export type ProtectedMatchKind = 'exact' | 'safe_prefix' | 'safe_suffix';

export interface ProtectedPhraseEntry {
  readonly actionType: string;
  /** NORMALİZE edilmiş canonical ifade (çok kelimeli olmak ZORUNDA). */
  readonly phrase: string;
}

export interface ProtectedWholeInputMatch {
  readonly matched: boolean;
  readonly actionType?: string;
  readonly actionClass?: ProtectedActionClass;
  readonly canonicalPhrase?: string;
  readonly matchKind?: ProtectedMatchKind;
  readonly blockedReason?: ProtectedActionBlockReason;
  /** Blokluyken hangi korunan eylem ZİKREDİLDİ (gözlemlenebilirlik). */
  readonly mentionedActionType?: string;
  readonly mentionedActionClass?: ProtectedActionClass;
}

/** `ParseResult` üzerinden voiceService'e taşınan typed güvenlik kararı. */
export interface ProtectedActionSafetyDecision {
  readonly protectedActionMentioned: boolean;
  readonly blocked: boolean;
  readonly reason?: ProtectedActionBlockReason;
  readonly actionType?: string;
  readonly actionClass?: ProtectedActionClass;
  /** Yalnız GÖZLEM: hangi söz edimi kanıtı görüldü (karar otoritesi DEĞİL). */
  readonly speechActClass?: HardwareSpeechActClass;
  readonly speechActCue?: string;
}

export interface ProtectedGateContext {
  readonly catalog: readonly ProtectedPhraseEntry[];
  /** commandParser'ın `normalizeText`i — İKİNCİ bir normalizasyon kurulmaz. */
  readonly normalize: (input: string) => string;
}

/* ── Nezaket ekleri (AÇIK ALLOWLIST) ─────────────────────────────────────── */

/**
 * ⚠️ Genel önek/sonek toleransı YOKTUR. Bu listeler ürün politikasıdır:
 * yeni bir biçim ancak buraya AÇIKÇA eklenerek desteklenir.
 * Normalize edilmiş (aksansız) biçimde yazılır. Uzun olan önce denenir.
 */
const SAFE_PREFIXES: readonly string[] = ['mavi lutfen', 'mavi', 'lutfen', 'simdi'];
const SAFE_SUFFIXES: readonly string[] = ['lutfen'];

/**
 * Tırnak işaretleri. Korunan canonical ifadelerin HİÇBİRİ kesme işareti
 * içermez (doğrulaması kilit testindedir) → tek bir işaret bile bu sınıfta
 * ZİKİR kanıtıdır. ("Ahmet'i ara" korunan bir eylem DEĞİLDİR, etkilenmez.)
 */
const QUOTE_MARK_RE = /["'«»“”„‟‘’`´]/;
const QUOTE_MARK_RE_ALL = /["'«»“”„‟‘’`´]/g;

/* ── Çekirdek ────────────────────────────────────────────────────────────── */

const NO_MATCH: ProtectedWholeInputMatch = { matched: false };

/**
 * ZİKİR (mention) araması — intent ÜRETMEZ, yalnız "bu cümlede korunan bir
 * eylemden söz ediliyor" der. Blok kararının kapsamını belirler.
 *
 * TÜRKÇE EKLEŞME KURALI: canonical ifadenin kelimeleri girdide ARDIŞIK
 * bulunmalıdır; **yalnız SON kelime** ek alabilir (kilitle → kilitleyebilir,
 * kilitlememi, kilitledim). Baştaki kelimeler TAM eşleşmek zorundadır — aksi
 * hâlde "ses çıkar" (korna) kalıbı "sesi çıkar" (ses açma) komutunu yutardı.
 *
 * Bu kural olmadan "kapıları kilitleyebilir misin" hiçbir zikir üretmiyor,
 * dolayısıyla semantic yol AÇIK kalıyordu (denetim bulgusu #2'nin asıl riski).
 */
function findMention(
  normalized: string,
  catalog: readonly ProtectedPhraseEntry[],
): ProtectedPhraseEntry | null {
  const tokens = normalized.split(' ').filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  let best: ProtectedPhraseEntry | null = null;
  for (const entry of catalog) {
    if (!entry.phrase.includes(' ')) continue;          // tek kelime ZİKİR sayılmaz
    if (best !== null && entry.phrase.length <= best.phrase.length) continue;
    const words = entry.phrase.split(' ');
    const last  = words.length - 1;
    for (let start = 0; start + words.length <= tokens.length; start++) {
      let ok = true;
      for (let i = 0; i < words.length && ok; i++) {
        const tok = tokens[start + i];
        ok = i === last
          ? (tok === words[i] || tok.startsWith(words[i]))   // yalnız SON kelime ek alabilir
          : tok === words[i];
      }
      if (ok) { best = entry; break; }
    }
  }
  return best;
}

/** Katalogda TAM EŞİT ifade; en UZUN eşleşme kazanır (deterministik). */
function findExact(
  normalized: string,
  catalog: readonly ProtectedPhraseEntry[],
): ProtectedPhraseEntry | null {
  let best: ProtectedPhraseEntry | null = null;
  for (const entry of catalog) {
    if (!entry.phrase.includes(' ')) continue;          // tek kelime KOMUT değildir
    if (entry.phrase !== normalized) continue;
    // Eşitlikte ifade uzunlukları da eşittir → katalog sırası (PATTERNS sırası)
    // belirleyicidir; ilk giren kazanır → aynı girdi HER ZAMAN aynı sonucu verir.
    if (best === null) best = entry;
  }
  return best;
}

function hit(
  entry: ProtectedPhraseEntry,
  matchKind: ProtectedMatchKind,
): ProtectedWholeInputMatch {
  return {
    matched:         true,
    actionType:      entry.actionType,
    actionClass:     protectedActionClass(entry.actionType) ?? 'vehicle',
    canonicalPhrase: entry.phrase,
    matchKind,
  };
}

function blocked(
  entry: ProtectedPhraseEntry,
  reason: ProtectedActionBlockReason,
): ProtectedWholeInputMatch {
  return {
    matched:              false,
    blockedReason:        reason,
    mentionedActionType:  entry.actionType,
    mentionedActionClass: protectedActionClass(entry.actionType) ?? 'vehicle',
  };
}

/**
 * Korunan eylem kapısı — TEK karar noktası.
 *
 * · `matched:true`  → girdinin TAMAMI canonical bir komuttur, intent üretilebilir.
 * · `matched:false` + `blockedReason` → korunan eylem ZİKREDİLDİ ama komut
 *   biçiminde DEĞİL → hiçbir yol (explicit · scored · semantic) intent üretemez.
 * · `matched:false` + reason YOK → korunan eylemle ilgisi yok; genel parser
 *   davranışı DEĞİŞMEZ.
 *
 * Fail-soft: geçersiz girdi/katalog → NO_MATCH (kapı yeni kırılma noktası açmaz).
 */
export function matchProtectedWholeInput(
  rawInput: string,
  ctx: ProtectedGateContext,
): ProtectedWholeInputMatch {
  if (typeof rawInput !== 'string') return NO_MATCH;
  const raw = rawInput.trim();
  if (!raw) return NO_MATCH;
  const catalog = Array.isArray(ctx?.catalog) ? ctx.catalog : [];
  if (catalog.length === 0) return NO_MATCH;

  let normalized: string;
  try {
    /* Tırnaklar normalizasyondan ÖNCE boşluğa indirgenir: parser'ın
     * `normalizeText`i yalnız ASCII tırnağı temizler, kıvrık tırnak (“ ” ‘ ’ « »)
     * kelimeye YAPIŞIK kalıyor ve zikir araması onu göremiyordu. */
    normalized = ctx.normalize(raw.replace(QUOTE_MARK_RE_ALL, ' '));
  } catch {
    return NO_MATCH;
  }
  if (!normalized) return NO_MATCH;

  /* 1 ── ZİKİR (tırnak) — kullanımdan ÖNCE elenir. Normalizasyon tırnağı
   *      boşluğa çevirdiği için `'aracı kilitle'` aksi hâlde TAM EŞLEŞME
   *      görünüyordu (bağımsız denetimin 1. bypass sınıfı). */
  if (QUOTE_MARK_RE.test(raw)) {
    const mention = findMention(normalized, catalog);
    return mention ? blocked(mention, 'quoted') : NO_MATCH;
  }

  /* 2 ── Girdinin TAMAMI canonical ifade mi? (en uzun tam eşleşme kazanır) */
  const exact = findExact(normalized, catalog);
  if (exact) return hit(exact, 'exact');

  /* 3 ── AÇIK ALLOWLIST nezaket ekleri. Ek soyulduktan sonra kalan metin
   *      canonical ifadeye TAM EŞİT olmak zorundadır. */
  for (const prefix of SAFE_PREFIXES) {
    if (!normalized.startsWith(`${prefix} `)) continue;
    const rest = normalized.slice(prefix.length + 1).trim();
    const m = rest ? findExact(rest, catalog) : null;
    if (m) return hit(m, 'safe_prefix');
  }
  for (const suffix of SAFE_SUFFIXES) {
    if (!normalized.endsWith(` ${suffix}`)) continue;
    const rest = normalized.slice(0, normalized.length - suffix.length - 1).trim();
    const m = rest ? findExact(rest, catalog) : null;
    if (m) return hit(m, 'safe_suffix');
  }

  /* 4 ── Komut biçiminde değil. Korunan eylem ZİKREDİLDİYSE fail-closed. */
  const mention = findMention(normalized, catalog);
  return mention ? blocked(mention, 'not_whole_input') : NO_MATCH;
}
