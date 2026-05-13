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
 *   "Hadi beni Mersin'e götür"      ← prefix soyma
 *   "Mersin'e sür / rotala / gazla" ← genişletilmiş tetikleyiciler
 *   "Mersin'e"                      ← implicit yönelme eki
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

/** Türkçe aksan kaldır + apostrofları tekleştir. */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/['''‘’`]/g, "'")
    .trim();
}

/* ── Navigation trigger phrases ──────────────────────────── */
// Uzundan kısaya sıralı — en uzun eşleşme önceliklidir

const NAV_TRIGGERS_RAW = [
  'yolculuk başlat',
  'yol tarifi ver',
  'navigasyon başlat',
  'rota oluştur',
  'rota başlat',
  'al beni götür',
  'tarif et',
  'yolculuk',
  'yola çık',
  'rota ver',
  'navige et',
  'yol göster',
  'beni götür',
  'götür beni',
  'götürün',
  'navigasyona ekle',
  'nasıl gidilir',
  'nasıl giderim',
  'nereye gideyim',
  'gidelim',
  'rotala',
  'gidin',
  'gazla',
  'götür',
  'git',
  'sür',
  'bul',
  'göster',
  'nerede',
] as const;

const NAV_TRIGGERS = NAV_TRIGGERS_RAW.map(norm);

/* ── Place-type keywords (navigate_place intent) ─────────── */

const PLACE_KEYWORDS = /hastane|okul|universite|cami|market|alisveris|avm|otel|banka|eczane|sahil|polis|itfaiye|muze|kutuphane|istasyon|terminal|havaalani|liman|koy|ilce|merkez|mahalle|semt|bucak|cadde|sokak|bulvar|meydan|sitesi|apartman/;

/* ── Ev/iş hedefleri — commandParser'a bırak ─────────────── */

const HOME_WORK_EXACT = /^(ev|eve|evime|anasayfa|home|is|ise|isyeri|ofis|ofise|work)$/;

/* ── Public API ──────────────────────────────────────────── */

/**
 * Metin navigasyon isteği içeriyorsa Parse sonucu döner, değilse null.
 * commandParser'da normal keyword scoring'den ÖNCE çağrılır.
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

  /* ── Mahalle / semt / cadde kalıbı (trigger olmaksızın) ──── */
  // "Bağlar Mahallesi", "Çeliktepe Mahallesi'ne", "Kızılay Caddesi" vb.
  // Kullanıcı sadece yer adını söylediğinde de navigate_place döndür.
  const PLACE_SUFFIX_RE = /mahalle(?:si(?:ne|nde|nden|nin)?)?|semt(?:i(?:ne|nde|nden|nin)?)?|cadde(?:si(?:ne|nde|nden)?)?|sokak(?:\w*)?|bulvar(?:\w*)?|meydan(?:\w*)?/i;
  const placeSuffixMatch = raw.match(
    /^(.{2,}?)\s+(?:mahalle(?:si(?:ne|nde|nden|nin)?)?|semt(?:i(?:ne|nde|nden|nin)?)?|cadde(?:si(?:ne|nde|nden)?)?|sokak\w*|bulvar\w*|meydan\w*)\s*$/i
  );
  if (placeSuffixMatch) {
    // suffix'i koruyarak tam yer adını oluştur
    const suffixMatch = raw.match(PLACE_SUFFIX_RE);
    const suffix = suffixMatch ? suffixMatch[0].replace(/(ne|nde|nden|nin)$/i, '') : '';
    const destName = placeSuffixMatch[1].trim() + (suffix ? ' ' + suffix : '');
    if (destName.length >= 2 && !HOME_WORK_EXACT.test(norm(destName.split(' ')[0]))) {
      return buildResult(destName);
    }
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

  if (triggerStart !== -1) {
    // "Hadi beni Mersin'e götür" →
    //   before trigger: "Hadi beni Mersin'e"
    //   stripPrefix   : "Mersin'e"
    //   stripDative   : "Mersin"
    const destRaw = stripDative(stripPrefix(raw.substring(0, triggerStart).trim()));
    if (!destRaw || destRaw.length < 2) return null;
    if (HOME_WORK_EXACT.test(norm(destRaw))) return null;
    return buildResult(destRaw);
  }

  /* ── Metnin başında fiil varsa ("Git X'e" / "Sür X'e") ───── */
  for (const trigger of NAV_TRIGGERS) {
    if (lower.startsWith(trigger + ' ') || lower.startsWith(trigger + "'")) {
      const rest    = raw.slice(trigger.length).trim();
      const cleaned = stripDative(stripPrefix(rest));
      if (cleaned.length >= 2 && !HOME_WORK_EXACT.test(norm(cleaned))) {
        return buildResult(cleaned);
      }
    }
  }

  /* ── Implicit: apostroflu yönelme eki → özel isim ────────── */
  // Türkçe'de özel isimler suffix alırken apostrofu kullanır: "Mersin'e", "İstanbul'a".
  // Trigger olmasa bile bu desen algılandığında navigasyon isteği kabul edilir.
  const implicitMatch = raw.match(/(\S+)['''‘’'`](e|a|ye|ya|ne|na)\s*$/i);
  if (implicitMatch) {
    const dest = implicitMatch[1];
    if (dest.length >= 2 && !HOME_WORK_EXACT.test(norm(dest))) {
      return buildResult(dest);
    }
  }

  return null;
}

/* ── Helpers ─────────────────────────────────────────────── */

/**
 * Cümle başındaki dolgu ön-eklerini soy.
 * "Hadi beni Mersin'e" → "Mersin'e"
 * "Lütfen İzmir'e git" → "İzmir'e git" (trigger ayrıca işlenir)
 */
function stripPrefix(s: string): string {
  return s
    .replace(/^\s*(hadi\s+beni|al\s+beni|hadi|l[uü]tfen|[şs]imdi|beni|can[iı]m)\s+/i, '')
    .trim();
}

/**
 * Türkçe yönelme hâli ekini ve yön bildiren son sözcükleri soy.
 * "Mersin'e" → "Mersin"
 * "Ankara'ya doğru" → "Ankara"
 * "Adana tarafına" → "Adana"
 */
function stripDative(s: string): string {
  return s
    .replace(/\s*['''‘’'`]?(e|a|ye|ya|ne|na)\s*$/i, '')
    .replace(/\s+(i[çc]in|do[ğg]ru|taraf[iı]na|y[oö]n[uü]ne|kar[şs][iı])\s*$/i, '')
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
