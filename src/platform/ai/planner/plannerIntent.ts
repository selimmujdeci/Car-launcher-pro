/**
 * plannerIntent — kullanıcı metninden DETERMİNİSTİK niyet ipuçları.
 *
 * Görev tipi (taskClassifier) "hangi strateji" sorusunu yanıtlar; bu modül
 * "araç sorusunun İÇİNDE tam olarak ne isteniyor" sorusunu yanıtlar → plan
 * gereksiz araç çalıştırmaz.
 *
 * ── KURALLAR ────────────────────────────────────────────────────────────────
 *  - YEREL, DETERMİNİSTİK, SINIRLI: AI yok, ağ yok, rastgelelik yok.
 *  - Kullanıcı metni LOGLANMAZ/saklanmaz — yalnız boolean ipuçlarına çevrilir.
 *  - Belirsizse İKİSİ de açılır (bilgi eksiği yüzünden yanlış cevap vermektense
 *    bir okuma fazladan yapılır; okumalar salt-okunurdur).
 */

import type { PlannerHints } from './plannerTypes';

/** Taranacak azami karakter — uzun metinde CPU yakılmaz. */
const MAX_SCAN_CHARS = 400;

function normalize(text: string): string {
  return text.slice(0, MAX_SCAN_CHARS).toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Arıza/tanı sorusu işaretleri. */
const DIAGNOSTIC_WORDS = [
  'ariza', 'hata kodu', 'hata kodlari', 'dtc', 'motor lambasi', 'uyari isigi',
  'check engine', 'kirmizi isik', 'servis lambasi', 'ariza var mi', 'sorun var mi',
];

/** Anlık ölçüm sorusu işaretleri. */
const LIVE_WORDS = [
  'yakit', 'benzin', 'depo', 'sicaklik', 'isindi', 'isiniyor', 'derece',
  'devir', 'rpm', 'hiz', 'aku', 'voltaj', 'gerilim', 'kac', 'ne kadar', 'kalan',
];

/**
 * Metinden plan ipuçlarını çıkarır. Metin yoksa/eşleşme yoksa İKİSİ de açık
 * (fail-open YALNIZ salt-okunur okumalar için — yürütme kapıları değişmez).
 */
export function derivePlannerHints(text: string | undefined): PlannerHints {
  const normalized = typeof text === 'string' ? normalize(text) : '';
  if (!normalized) return { wantsDiagnostics: true, wantsLiveData: true };

  const wantsDiagnostics = DIAGNOSTIC_WORDS.some((w) => normalized.includes(w));
  const wantsLiveData    = LIVE_WORDS.some((w) => normalized.includes(w));

  // Hiçbiri eşleşmediyse ayrım yapılamıyor → ikisi de.
  if (!wantsDiagnostics && !wantsLiveData) return { wantsDiagnostics: true, wantsLiveData: true };
  return { wantsDiagnostics, wantsLiveData };
}
