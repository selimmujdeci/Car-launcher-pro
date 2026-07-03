/**
 * companionMemory.ts — "Yol Arkadaşım" uzun-dönem kişisel hafıza.
 *
 * Kullanıcının AÇIKÇA hatırlanmasını istediği kalıcı fact'ler ("arabam dizel",
 * "ben hep 95 benzin alırım", "kızımın adı Elif"). Oturumlar arası kalıcıdır
 * (safeStorage) ve her beyin/sohbet çağrısına bağlam olarak enjekte edilir.
 *
 * Tasarım kararları:
 *  - AÇIK talep: yalnız kullanıcı "şunu unutma / aklında tut / not al" derse
 *    beyin REMEMBER üretir. Otomatik "her şeyi hatırlama" YOK (ürkütücü + gürültü).
 *  - Sınırlı: MAX_FACTS kısa fact (token + gizlilik). Taşınca en eski atılır.
 *  - Gizlilik: forget (tekil fuzzy sil) + "hepsini unut" (temizle) desteklenir.
 *  - Zero-Leak / I/O: safeStorage debounce'lu yazım (yüksek frekans yok — nadir).
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';

export interface CompanionFact {
  id:   string;
  text: string;
}

const STORAGE_KEY = 'companion_memory_v1';
const MAX_FACTS   = 15;    // token + gizlilik sınırı; taşınca en eski düşer
const MAX_LEN     = 120;   // tek fact üst sınırı (uzun paragraf hatırlama yok)

let _facts: CompanionFact[] | null = null; // lazy-load cache

/** Türkçe-duyarsız basit normalizasyon — dedup ve fuzzy forget için. */
function _norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function _load(): CompanionFact[] {
  if (_facts !== null) return _facts;
  try {
    const raw = safeGetRaw(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CompanionFact[];
      if (Array.isArray(parsed)) {
        _facts = parsed
          .filter((f) => f && typeof f.id === 'string' && typeof f.text === 'string' && f.text.trim())
          .slice(-MAX_FACTS);
        return _facts;
      }
    }
  } catch { /* bozuk kayıt → boş başla */ }
  _facts = [];
  return _facts;
}

function _save(): void {
  try {
    safeSetRaw(STORAGE_KEY, JSON.stringify(_facts ?? []));
  } catch { /* quota — sessiz */ }
}

/** Benzersiz id — çakışmasız (ts + kısa sayaç). */
let _seq = 0;
function _newId(): string {
  _seq = (_seq + 1) % 100000;
  return `f${Date.now().toString(36)}${_seq.toString(36)}`;
}

/**
 * Yeni fact ekle. Boş/çok kısa → null. Zaten varsa (normalize eşleşme) tekrar
 * eklemez, mevcut fact'i döner. Taşarsa en eski fact düşer. Eklenen/mevcut döner.
 */
export function addFact(text: string): CompanionFact | null {
  const clean = (text ?? '').trim().slice(0, MAX_LEN).trim();
  if (clean.length < 2) return null;
  const facts = _load();
  const key = _norm(clean);
  const existing = facts.find((f) => _norm(f.text) === key);
  if (existing) return existing;
  const fact: CompanionFact = { id: _newId(), text: clean };
  facts.push(fact);
  if (facts.length > MAX_FACTS) facts.splice(0, facts.length - MAX_FACTS); // en eskiyi at
  _save();
  return fact;
}

/** Tüm fact'ler (kayıt sırası — en eski → en yeni). */
export function getFacts(): CompanionFact[] {
  return [..._load()];
}

/**
 * Fact unut. query "hepsi/her şey/tümü/tamamını" içeriyorsa TÜMÜNÜ temizler
 * (döner: 'all'). Aksi hâlde en iyi fuzzy eşleşmeyi siler (döner: silinen metin).
 * Eşleşme yoksa null.
 */
export function forgetFact(query: string): string | 'all' | null {
  const q = _norm(query ?? '');
  if (!q) return null;
  if (/\b(hepsi|hepsini|her ?şey|her ?şeyi|tümü|tümünü|tamamını|tamamı)\b/.test(q)) {
    clearFacts();
    return 'all';
  }
  const facts = _load();
  if (facts.length === 0) return null;
  // En iyi eşleşme: query fact içinde ya da fact query içinde geçiyorsa; yoksa
  // en fazla ortak kelimeli fact. Sıfır örtüşmede silme (yanlış fact silinmesin).
  // Primitive index takibi (closure-narrowing tuzağından kaçınır).
  const qWords = q.split(' ').filter((w) => w.length > 1);
  let bestIdx = -1;
  let bestScore = 0;
  for (let idx = 0; idx < facts.length; idx++) {
    const fn = _norm(facts[idx].text);
    let score = 0;
    if (fn.includes(q) || q.includes(fn)) score = 100;
    else score = qWords.filter((w) => fn.includes(w)).length;
    if (score > 0 && score > bestScore) { bestScore = score; bestIdx = idx; }
  }
  if (bestIdx < 0) return null;
  const [removed] = facts.splice(bestIdx, 1);
  _save();
  return removed.text;
}

/** Tüm hafızayı temizle. */
export function clearFacts(): void {
  _facts = [];
  try { safeRemoveRaw(STORAGE_KEY); } catch { /* sessiz */ }
}

/**
 * Beyin/sohbet system prompt'una girecek hafıza bölümü. Fact yoksa boş string
 * (prompt'a hiç girmez). Fact'ler madde madde; beyne "uygun olduğunda kullan,
 * her cevapta sıralama" talimatıyla verilir (rakam okuyan robot olmasın).
 */
export function buildMemoryPromptSection(): string {
  const facts = _load();
  if (facts.length === 0) return '';
  const list = facts.map((f) => `- ${f.text}`).join(' ');
  return `KULLANICI HAKKINDA HATIRLADIKLARIN (kalıcı, önceki oturumlardan — kullanıcı böyle istedi): ${list} Bunları uygun olduğunda doğal biçimde kullan; her cevapta sıralama, yalnız konuyla ilgiliyse hatırla.`;
}

/** @internal — testler arası izolasyon. */
export function _resetCompanionMemoryForTest(): void {
  _facts = null;
  _seq = 0;
  try { safeRemoveRaw(STORAGE_KEY); } catch { /* sessiz */ }
}
