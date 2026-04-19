/**
 * Address Parser — Türkçe doğal dil metninden navigasyon hedefini çıkarır.
 *
 * Desteklenen desenler:
 *   "Bağlar Mahallesi 0455 Sokak'a git"
 *   "GMK Bulvarı 123'e götür"
 *   "Mersin Şehir Hastanesi'ne rota ver"
 *   "Pozcu'ya gidelim"
 *   "En yakın benzinliğe git"
 *   "En yakın otoparka götür"
 */

export type NavIntent =
  | 'navigate_address'
  | 'navigate_place'
  | 'find_nearby_gas'
  | 'find_nearby_parking';

export interface ParsedNavAddress {
  intent:      NavIntent;
  destination: string;   // geocoding için temizlenmiş sorgu
  displayText: string;   // UI'da gösterilecek metin
  feedback:    string;   // TTS için
}

/* ── Normalisation ───────────────────────────────────────── */

/** Türkçe aksan kaldır + apostrofları tekleştir.
 *  Karakter → karakter dönüşümü: pozisyonlar korunur. */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/['''\u2018\u2019\u0060]/g, "'")
    .trim();
}

/* ── Navigation trigger phrases ──────────────────────────── */
// Uzundan kısaya sıralı — ilk eşleşme en uzun olanı alır

const NAV_TRIGGERS_RAW = [
  'yol tarifi ver',
  'rota oluştur',
  'rota başlat',
  'rota ver',
  'navigasyon başlat',
  'navige et',
  'yol göster',
  'al beni götür',
  'beni götür',
  'götür beni',
  'götürün',
  'götür',
  'gidelim',
  'gidin',
  'git',
] as const;

const NAV_TRIGGERS = NAV_TRIGGERS_RAW.map(norm);

/* ── Place-type keywords (NAVIGATE_PLACE intent) ─────────── */

const PLACE_KEYWORDS = /hastane|okul|universite|cami|market|alisveris|avm|otel|banka|eczane|sahil|polis|itfaiye|muze|kutuphane|istasyon|terminal|havaalani|liman|koy|ilce|merkez/;

/* ── Public API ──────────────────────────────────────────── */

/**
 * Metin navigasyon isteği içeriyorsa Parse sonucu döner, değilse null.
 * Bu fonksiyon commandParser'da normal keyword scoring'den ÖNCE çağrılır.
 */
export function tryParseNavAddress(rawText: string): ParsedNavAddress | null {
  const raw   = rawText.trim();
  const lower = norm(raw);

  /* ── Yakın benzinlik ─────────────────────────────────────── */
  if (
    /en\s*yakin\s*(benzin|yakit|akaryakit|petrol)/.test(lower) ||
    /benzinli[g]/.test(lower) ||
    /yakit\s*istasyon/.test(lower) ||
    /akaryakit/.test(lower) ||
    /petrol\s*istasyon/.test(lower)
  ) {
    return {
      intent:      'find_nearby_gas',
      destination: '__nearby_gas__',
      displayText: 'En yakın benzinlik',
      feedback:    'En yakın benzinlik aranıyor',
    };
  }

  /* ── Yakın otopark ───────────────────────────────────────── */
  if (
    /en\s*yakin\s*(otopark|park\s*yer|park\s*alan)/.test(lower) ||
    /otopark/.test(lower) ||
    /park\s*yer/.test(lower)
  ) {
    return {
      intent:      'find_nearby_parking',
      destination: '__nearby_parking__',
      displayText: 'En yakın otopark',
      feedback:    'En yakın otopark aranıyor',
    };
  }

  /* ── Sondan navigasyon fiili ara ─────────────────────────── */
  let triggerStart = -1;
  let triggerLength = 0;

  for (const trigger of NAV_TRIGGERS) {
    const idx = lower.lastIndexOf(trigger);
    if (idx === -1) continue;

    // Fiil metnin sonuna yakın olmalı (arkasında yalnızca boşluk/noktalama)
    const after = lower.slice(idx + trigger.length).trim();
    if (after.length > 0) continue;

    // En uzun ve en sondaki eşleşmeyi tercih et
    if (idx > triggerStart || (idx === triggerStart && trigger.length > triggerLength)) {
      triggerStart  = idx;
      triggerLength = trigger.length;
    }
  }

  /* Metnin başında fiil varsa ("Git X'e" formatı) ─────────── */
  if (triggerStart === -1) {
    for (const trigger of NAV_TRIGGERS) {
      if (lower.startsWith(trigger + ' ') || lower.startsWith(trigger + "'")) {
        const rest = raw.slice(trigger.length).trim();
        const cleaned = stripDative(rest);
        if (cleaned.length >= 2) {
          return buildResult(cleaned);
        }
      }
    }
    return null;
  }

  /* Hedef metni: fiilden önceki kısım, Türkçe hal eki soyulmuş */
  const destRaw = stripDative(raw.substring(0, triggerStart).trim());
  if (!destRaw || destRaw.length < 2) return null;

  return buildResult(destRaw);
}

/* ── Helpers ─────────────────────────────────────────────── */

/** Türkçe yönelme hâli ekini soy: X'e, X'a, X'ye, X'ya, X'ne, X'na */
function stripDative(s: string): string {
  return s
    .replace(/\s*['''\u2018\u2019'`]?(e|a|ye|ya|ne|na)\s*$/i, '')
    .replace(/\s+(için|doğru|karşı)\s*$/i, '')
    .trim();
}

function buildResult(dest: string): ParsedNavAddress {
  const isPlace = PLACE_KEYWORDS.test(norm(dest));
  return {
    intent:      isPlace ? 'navigate_place' : 'navigate_address',
    destination: dest,
    displayText: dest,
    feedback:    `${dest} için rota aranıyor`,
  };
}
