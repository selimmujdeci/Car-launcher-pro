/**
 * taskClassifier — kullanıcı isteğini Faz 1 görev sınıflarından birine eşler.
 *
 * ── KURALLAR ────────────────────────────────────────────────────────────────
 *  - YEREL, DETERMİNİSTİK, SINIRLI: AI çağrısı YOK, ağ YOK, rastgelelik YOK.
 *    Aynı metin → her zaman aynı sınıf.
 *  - Belirsizse `general_chat` (fail-safe: en ucuz/en hızlı strateji).
 *  - Kullanıcı metni LOGLANMAZ, saklanmaz, dışarı verilmez — yalnız sınıf döner.
 *  - Girdi uzunluğu SINIRLIDIR: yalnız baştan `MAX_SCAN_CHARS` karakter taranır
 *    (uzun metinde CPU harcamamak için — araç içi düşük uçlu donanım).
 *
 * Anahtar kelimeler Türkçe sürüş bağlamına göre seçilmiştir; normalize edilmiş
 * (aksansız, küçük harf) metin üzerinde çalışır.
 */

import type { MaviTaskType } from './orchestratorTypes';

/** Taranacak azami karakter — sınırsız metin CPU yakmasın. */
const MAX_SCAN_CHARS = 600;
/** Bu uzunluğun üstündeki istek "uzun açıklama" adayı sayılır. */
const LONG_REQUEST_CHARS = 400;
/** Bu uzunluğun altındaki istek "kısa cevap" adayı sayılır. */
const SHORT_REQUEST_CHARS = 40;

/** Türkçe karakterleri sadeleştirir (offlineConversationEngine ile aynı yaklaşım). */
function normalize(text: string): string {
  return text.slice(0, MAX_SCAN_CHARS).toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sıra ÖNEMLİDİR: ilk eşleşen kazanır (en spesifik → en genel). */
const RULES: ReadonlyArray<{ readonly task: MaviTaskType; readonly keywords: readonly string[] }> = [
  {
    task: 'code_analysis',
    keywords: ['kod', 'fonksiyon', 'derleme', 'hata ayikla', 'debug', 'stack trace',
               'javascript', 'typescript', 'python', 'sql sorgu', 'regex', 'algoritma'],
  },
  {
    task: 'vehicle_question',
    keywords: ['motor', 'yakit', 'benzin', 'dizel', 'lastik', 'fren', 'akü', 'aku',
               'arıza', 'ariza', 'hata kodu', 'dtc', 'yag', 'sicaklik', 'devir', 'rpm',
               'menzil', 'sarj', 'batarya', 'klima', 'far', 'bakim', 'vites', 'egzoz',
               'araba', 'arac', 'aracin'],
  },
  {
    task: 'technical_analysis',
    keywords: ['neden', 'nicin', 'analiz', 'karsilastir', 'kiyasla', 'avantaj', 'dezavantaj',
               'hesapla', 'verim', 'performans', 'tekni'],
  },
  {
    task: 'long_explanation',
    keywords: ['detayli anlat', 'uzun uzun', 'ayrintili', 'detayli aciklama',
               'nasil calisir', 'adim adim', 'ogret', 'anlat bana'],
  },
];

/**
 * Metni görev sınıfına eşler. ASLA throw etmez; boş/geçersiz girdi →
 * `general_chat`.
 */
export function classifyTask(text: string): MaviTaskType {
  if (typeof text !== 'string') return 'general_chat';
  const raw = text.trim();
  if (!raw) return 'general_chat';

  const normalized = normalize(raw);
  if (!normalized) return 'general_chat';

  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword)) return rule.task;
    }
  }

  // Anahtar kelime yok → uzunluk sezgisi (yalnız KARAR YOKKEN devreye girer).
  if (raw.length >= LONG_REQUEST_CHARS)  return 'long_explanation';
  if (raw.length <= SHORT_REQUEST_CHARS) return 'short_answer';
  return 'general_chat';
}
