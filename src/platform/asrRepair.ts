/**
 * asrRepair.ts — Offline ASR (Vosk) onarım katmanı.
 *
 * SAF FONKSİYONLAR: servis import'u YOK (companionContext.ts deseni). Online'da
 * Gemini bozuk transcript'i onarıyor ("birez muzuk ac" → "biraz müzik aç");
 * OFFLINE'da bu onarım yoktu — n-best alternatifler doğrudan parseCommandFull'a
 * gidiyordu. Bu modül iki MUHAFAZAKÂR mekanizmayla offline'da benzer bir onarım
 * sağlar:
 *
 *   (a) Bilinen Vosk TR karışıklık sözlüğü — elle seçilmiş, gerçekçi fonetik
 *       hatalar (h-düşmesi, ünsüz kümesi ünlü türemesi, kısaltma/kesme, İngilizce
 *       alıntı kelimenin Türkçe fonetik yazımı).
 *   (b) Domain lexicon snap — komut sözlük-dışı bir token'ı, komut çözümleyicinin
 *       (commandParser) çekirdek anahtar kelimelerinden en yakınına çeker.
 *
 * Fail-soft: onarım gerekmiyor/yapılamıyorsa `null` döner — çağıran orijinal
 * metni kullanır (repairTranscript ASLA orijinal davranışı bozamaz).
 *
 * MUHAFAZAKÂR eşikler (bilinçli — offlineAssistantPrecision bug'ı bir daha
 * yaşanmasın): kaynak token ≥4 harf şart, mesafe 4-6 harfte ≤1 / ≥7 harfte ≤2,
 * token zaten lexicon'daysa dokunulmaz. Kısa fiiller ("aç", "kıs" gibi ≤3 harf)
 * ASLA hedef alınmaz — zayıf fiil 'aç' bağlam ister kuralı (geçmişte offline
 * yanlış müzik açma bug'ı) burada da geçerli.
 */

/* ── TR normalize (commandParser.normalizeText / companionIdentity.normalizeWakeText ile tutarlı) ── */

function normalizeWord(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── (a) Bilinen Vosk TR karışıklık sözlüğü ─────────────────────
 * key: Vosk'un ürettiği hatalı kelime (normalize edilmiş) → value: doğru kelime.
 * Uydurma şişirme YOK — her satır gerçekçi bir fonetik/telaffuz hatasıdır. */
const KNOWN_CONFUSIONS: Readonly<Record<string, string>> = {
  // dolgu kelime (bağlam örneği)
  birez:      'biraz',
  // müzik
  muzuk:      'muzik',
  mizik:      'muzik',
  mizigi:     'muzigi',
  sariki:     'sarki',
  // navigasyon / harita (h-düşmesi — hızlı konuşmada yaygın)
  arita:      'harita',
  aritayi:    'harita',
  navigasiyon: 'navigasyon',
  naviyasyon: 'navigasyon',
  // telefon (son ünsüz/heceyi yutma)
  telefo:     'telefon',
  // bluetooth / wifi (İngilizce alıntının Türkçe fonetik yazımı)
  blutus:     'bluetooth',
  blutut:     'bluetooth',
  vayfay:     'wifi',
  // medya kontrol
  durtur:     'durdur',
  // araç / hastane / restoran
  hastene:    'hastane',
  restaran:   'restoran',
  eczana:     'eczane',
  // ünsüz kümesi ünlü türemesi (Türkçe fonolojisinde yaygın: alarm→alarim, trafik→tirafik)
  alarim:     'alarm',
  tirafik:    'trafik',
  birifing:   'brifing',
  // k/heceyi düşürme
  sicalik:    'sicaklik',
  parlalik:   'parlaklik',
  sondor:     'sondur',
  // dashcam (İngilizce alıntı, telaffuz sapması)
  daskem:     'dashcam',
  deskem:     'dashcam',
  // yakıt/yakut ünlü karışıklığı
  yakut:      'yakit',
};

/* ── (b) Domain lexicon — commandParser çekirdek anahtar kelimeleri ────────
 * Elle türetilmiş (commandParser.ts PATTERNS token listelerinden), yalnız
 * ≥4 harfli anlamlı domain kelimeleri. Kısa genel fiiller ("ac", "kis", "dur"
 * gibi) BİLİNÇLİ OLARAK YOK — bunlar bağlam ister, snap hedefi olamaz. */
const CORE_LEXICON: ReadonlySet<string> = new Set([
  // müzik / medya
  'muzik', 'muzigi', 'spotify', 'sarki', 'oynat', 'playlist', 'parca', 'dinle',
  'radyo', 'durdur', 'duraklat', 'sonraki', 'onceki', 'video', 'klip',
  'yukselt', 'azalt', 'youtube',
  // navigasyon
  'harita', 'navigasyon', 'navigate', 'waze', 'rota', 'navi',
  // telefon
  'telefon', 'rehber', 'kisi',
  // ayarlar / tema
  'ayar', 'ayarlar', 'settings', 'konfigurasyon', 'favori', 'favoriler',
  'karanlik', 'aydinlik', 'lacivert', 'gunduz',
  // araç sürüş
  'surus', 'araba', 'arac', 'uyku', 'bekleme',
  // araç telemetri
  'hiz', 'kilometre', 'yakit', 'benzin', 'depo', 'motor', 'sicaklik',
  'bakim', 'muayene', 'sigorta', 'kasko', 'servis',
  // hava / trafik
  'hava', 'yagmur', 'bulut', 'derece', 'trafik', 'tikaniklik', 'yogunluk',
  // kamera / dashcam
  'dashcam', 'kamera', 'kayit', 'fotograf',
  // bağlantı
  'bluetooth', 'wifi', 'internet', 'hotspot',
  // ekran
  'parlaklik', 'brightness', 'parlat', 'karart', 'ekran', 'display', 'monitor',
  // yakın yer
  'restoran', 'yemek', 'lokanta', 'hastane', 'doktor', 'saglik', 'eczane',
  // araç sağlığı
  'ariza', 'sorun', 'tarama', 'diagnostic', 'temizle', 'sondur',
  // donanım
  'kilitle', 'emniyet', 'unlock', 'kilid', 'korna', 'isik', 'flash', 'selam',
  'alarm', 'aktif', 'guvenlik', 'iptal', 'arka', 'geri', 'park',
  // durum raporu
  'durum', 'ozet', 'rapor', 'brifing', 'status',
]);

/* ── Levenshtein (commandParser.ts'teki ile aynı algoritma — bağımsız kopya,
 * modül sıfır-import ilkesini korumak için). ── */
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

/**
 * Sözlük-dışı bir token'ı domain lexicon'ındaki en yakın kelimeye çeker.
 * MUHAFAZAKÂR: token <4 harf → dokunma; token zaten lexicon'da → dokunma;
 * mesafe eşiği aşılmadıysa → dokunma. Eşit mesafede lexicon iterasyon sırasına
 * göre ilk bulunan kazanır (deterministik).
 */
function domainLexiconSnap(word: string): string | null {
  if (word.length < 4) return null;
  if (CORE_LEXICON.has(word)) return null;
  // Türkçe çekim ilişkisi (kök+ek): "haritayı" gibi DOĞRU yazılmış çekimli
  // kelimeler lexicon köküyle prefix ilişkisindedir. commandParser bunu zaten
  // Tier-2'de yakalıyor (tok.startsWith(pt) / pt.startsWith(tok)) — burada
  // tekrar dokunmak gereksiz VE doğru kelimeyi anlamsızca kısaltır/bozar.
  for (const lex of CORE_LEXICON) {
    if (lex.length >= 3 && (word.startsWith(lex) || lex.startsWith(word))) return null;
  }
  const maxDist = word.length >= 7 ? 2 : 1;
  let bestWord: string | null = null;
  let bestDist = Infinity;
  for (const lex of CORE_LEXICON) {
    if (Math.abs(lex.length - word.length) > maxDist) continue; // hızlı eleme
    const dist = levenshtein(word, lex);
    if (dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      bestWord = lex;
    }
  }
  return bestWord;
}

/**
 * Bozuk offline STT transcript'ini onarmayı dener.
 *
 * @param text Ham transcript (Vosk n-best alternatiflerinden biri).
 * @returns Onarılmış varyant (en az bir kelime değiştiyse) ya da onarım
 *          gerekmiyorsa/yapılamıyorsa `null` (çağıran orijinali kullanır).
 */
export function repairTranscript(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const words = normalizeWord(trimmed).split(' ').filter(Boolean);
  if (words.length === 0) return null;

  let changed = false;
  const repaired = words.map((w) => {
    const known = KNOWN_CONFUSIONS[w];
    if (known) { changed = true; return known; }
    const snapped = domainLexiconSnap(w);
    if (snapped) { changed = true; return snapped; }
    return w;
  });

  if (!changed) return null;
  return repaired.join(' ');
}
