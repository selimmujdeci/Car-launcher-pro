/**
 * placeQueryModel — YER ARAMA SORGUSUNUN ANLAMI (SAF KATMAN).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK ·
 * ağ YOK. Yalnız metin → niyet ve aday listesi → sıralama üretir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (canlı ölçüm · 2026-08-23, konum: Tarsus 36.9175/34.8621) ───
 * ══════════════════════════════════════════════════════════════════════════
 * Harita arama çubuğunun çevrimiçi katmanı ürünün kurduğu İSTEĞİN AYNISIYLA
 * koşuldu (`format=jsonv2&limit=8&addressdetails=1`, ülke/viewbox yanlılığı
 * YOK). Ölçülen (en yakın 5 aday, kullanıcıya olan gerçek mesafeyle):
 *
 *   "pastane"  → 372 km · 379 km · 674 km · 676 km · 692 km
 *                (hepsi ADI "Pastane" olan yerler; 5 km içindeki 5 gerçek
 *                 pastane/fırın listeye HİÇ girmedi — Overpass ile ölçüldü:
 *                 Florya Pastanesi 2,17 km · Flamingo Pastanesi 2,23 km)
 *   "eczane"   → 231 km (Lefkoşa) · 368 km · 677 km · 706 km · 743 km (MUSUL/IRAK)
 *                (aynı konumun 2 km'sinde 8, 5 km'sinde **101** eczane var)
 *   "Şok Market" → 372 km · 530 km · 686 km · 691 km · **2706 km (Köln/Almanya)**
 *                (0,85 km'de `shop`+`name~şok` eşleşmesi var — ölçüldü)
 *   "en yakın benzinlik" → **0 sonuç**
 *
 * Yani ürün "kategori" diye bir kavram TANIMIYORDU: `pastane` sorgusunu ADI
 * "pastane" olan yerlerle eşleştiriyor, sürücünün 2 km'sindeki pastaneyi
 * göremiyordu. Bu modül o eksik kavramı — **kategori niyeti** — ve sonuçları
 * "ad benzerliği + kategori + mesafe + şehir bağlamı" ile sıralayan tek
 * puanlama fonksiyonunu getirir.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · Kapı DEĞİLDİR: `locationBiasGate` (şehir/mesafe eleme) ve
 *    `filterNumberedStreetMismatch` (numaralı sokak) mantığına DOKUNMAZ,
 *    onların ÜSTÜNDE yalnız SIRALAMA yapar.
 *  · Alaka taban filtresi (`RELEVANCE_FLOOR`) **liste boşaltmaz**: taban üstü
 *    aday varsa altındakiler düşer, yoksa hepsi korunur. "Bulamamak"
 *    üretilmez — yalnız alakasız aday ÜSTE ÇIKAMAZ.
 *  · Konum yoksa mesafe ÜRETİLMEZ (`distanceKm: null`) — sahte 0 YASAK.
 */

import { foldTr } from '../navigation/core/turkishFold';
import { detectCitiesInQuery } from './locationBiasGate';
import { describeDedupe, type DedupeEvidence, type SearchScoreEvidence } from './searchChainModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) SORGU NORMALİZASYONU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Türkçe adres eklerinin ARAMA ANAHTARI biçimi.
 *
 * ⚠️ `geocodingService.expandTurkishAddressAbbrev` ile AYNI ŞEY DEĞİLDİR ve
 * onun kopyası değildir: orası Nominatim'e GÖNDERİLECEK insan-okur bir sorgu
 * varyantı üretir ("Bağlar mh" → "Bağlar Mahallesi"); burası ise KARŞILAŞTIRMA
 * anahtarı üretir ve ekleri TERS yönde sadeleştirir ("mahallesi" → "mahalle").
 * İki yön de gereklidir: sağlayıcıya uzun biçim gider, eşleştirme kısa biçimde
 * yapılır.
 */
/** TAM biçimler — konumdan bağımsız katlanır (belirsizlik yok). */
const _FULL_FORM_FOLD: Readonly<Record<string, string>> = {
  mahallesi: 'mahalle', mahallesine: 'mahalle', mahalle: 'mahalle',
  caddesi: 'cadde', cadde: 'cadde',
  sokagi: 'sokak', sokak: 'sokak',
  bulvari: 'bulvar', bulvar: 'bulvar',
  sitesi: 'site', site: 'site',
  apartmani: 'apartman', apartman: 'apartman',
};

/**
 * KISALTMALAR — yalnız İLK TOKEN DEĞİLKEN katlanır.
 *
 * ── NEDEN KONUMA BAĞLI (kilit testi bunu yakaladı) ────────────────────────
 * `sok` hem "sokak" kısaltmasıdır hem de **"Şok"** market zincirinin katlanmış
 * hâlidir (`foldTr('Şok') === 'sok'`). Koşulsuz katlansaydı "Şok Market"
 * sorgusu "sokak market"e dönüşür ve ürün bir MARKET yerine SOKAK arardı.
 * Türkçe adres sırasında kısaltma ASLA başta gelmez ("Bağlar mah.", "Atatürk
 * cad."); işletme adı ise gelir ("Şok Market"). Bu yüzden kural konumsaldır ve
 * bilgi kaybı YOKTUR: kısaltma yerinde duruyorsa yine katlanır.
 */
const _ABBREV_FOLD: Readonly<Record<string, string>> = {
  mah: 'mahalle', mh: 'mahalle',
  cad: 'cadde', cd: 'cadde',
  sok: 'sokak', sk: 'sokak',
  bulv: 'bulvar', blv: 'bulvar',
  apt: 'apartman',
};

/**
 * Sorguyu arama anahtarına çevirir: Türkçe katlama (`foldTr`) + ek sadeleştirme.
 * `foldTr` ı/İ/ş/ğ/ü/ö/ç ailesinin TAMAMINI tek hedefe indirir — bu yüzden
 * "Şifa" ile "sifa", "İstanbul" ile "istanbul" AYNI anahtarı üretir.
 */
export function normalizePlaceQuery(input: unknown): string {
  const s = foldTr(input);
  if (s.length === 0) return '';
  const tokens = s.replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length === 0) continue;
    const full = _FULL_FORM_FOLD[t];
    if (full !== undefined) { out.push(full); continue; }
    const abbr = i > 0 ? _ABBREV_FOLD[t] : undefined;
    out.push(abbr !== undefined ? abbr : t);
  }
  return out.join(' ');
}

/**
 * "en yakın" ailesi — sorgudan ATILIR, yerine `wantsNearest` bayrağı konur.
 * Katlanmış (foldTr) biçimde tutulur.
 */
const _NEAREST_WORDS: readonly string[] = [
  'en yakin', 'en yakindaki', 'yakinimdaki', 'yakinimda', 'yakindaki',
  'yakinda', 'civardaki', 'civarda', 'buralarda', 'buraya yakin',
  'yakinlarda', 'yakinlardaki',
];

/** Aramaya katkısı olmayan bağlaç/soru sözcükleri — anahtardan atılır. */
const _STOP_WORDS: ReadonlySet<string> = new Set([
  'bir', 've', 'ile', 'icin', 'bana', 'bize', 'nerede', 'nerde', 'nereye',
  'var', 'varmi', 'bul', 'bulur', 'goster', 'ara', 'git', 'gidelim', 'gitmek',
  'istiyorum', 'lazim', 'olan', 'olsun',
]);

/* ══════════════════════════════════════════════════════════════════════════
   2) KATEGORİ SÖZLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

export interface PlaceCategoryDef {
  /** Kanonik kategori kimliği — `poi.db` kategori adıyla hizalıdır (varsa). */
  readonly id: string;
  /** Kullanıcıya gösterilebilir Türkçe etiket. */
  readonly label: string;
  /**
   * Sorguda geçtiğinde bu kategoriyi tetikleyen KATLANMIŞ sözcükler.
   * Çok sözcüklü olabilir ("alisveris merkezi") — sözcük SINIRIYLA eşleşir.
   */
  readonly aliases: readonly string[];
  /**
   * Overpass etiket süzgeçleri. Her biri `node[<filtre>](around:…)` biçiminde
   * gömülür. **SABİTTİR** — kullanıcı metni buraya ASLA girmez (enjeksiyon yok).
   */
  readonly tags: readonly string[];
  /** Varsayılan arama yarıçapı (metre). Seyrek kategoriler daha geniştir. */
  readonly radiusM: number;
  /** `poi.db` içindeki kategori adı — çevrimdışı eşleşme için. Yoksa `null`. */
  readonly offlineCat: string | null;
}

/**
 * Türkçe kategori sözlüğü.
 *
 * ── VERİ TEMELİ ────────────────────────────────────────────────────────────
 * Etiketler OSM'in gerçek kullanımından alınmıştır; Türkiye'de yaygın olmayan
 * etiketler EKLENMEMİŞTİR (uydurma kapsam iddiası YASAK). `offlineCat`
 * yalnız `scripts/build-poi-db.mjs` içindeki `CATEGORY_RULES` tablosunda
 * GERÇEKTEN üretilen kategoriler için doludur — orada olmayan bir kategoriyi
 * "çevrimdışı da var" diye işaretlemek sahte kapsam olurdu.
 *
 * Sıra ÖNEMLİDİR: daha SPESİFİK kategori önce gelir ("sarj istasyonu"
 * "istasyon"dan önce eşleşsin diye alias'lar da uzundan kısaya sınanır.)
 */
export const PLACE_CATEGORIES: readonly PlaceCategoryDef[] = [
  /* YARIÇAP ÖLÇÜLDÜ: aynı noktada 2 km'de 8, 5 km'de **101** eczane var.
     4 km'lik sorgu halka açık Overpass'te süre tavanına takılıyordu (7 sn'de
     0 sonuç). 2,5 km yoğun yerleşimde fazlasıyla yeter; SEYREK bölgede
     `RADIUS_ESCALATION` zaten otomatik büyütür — kapsam KAYBI yok. */
  { id: 'eczane',      label: 'Eczane',            offlineCat: 'eczane',
    aliases: ['eczane', 'eczanesi', 'ecza', 'nobetci eczane'],
    tags: ['"amenity"="pharmacy"'], radiusM: 2500 },

  { id: 'benzinlik',   label: 'Benzinlik',         offlineCat: 'benzinlik',
    aliases: ['benzinlik', 'benzin', 'benzinci', 'akaryakit', 'petrol ofisi',
              'yakit', 'mazot', 'motorin', 'lpg', 'istasyon'],
    tags: ['"amenity"="fuel"'], radiusM: 6000 },

  { id: 'sarj',        label: 'Şarj istasyonu',    offlineCat: 'sarj',
    aliases: ['sarj', 'sarj istasyonu', 'elektrikli sarj', 'sarj noktasi'],
    tags: ['"amenity"="charging_station"'], radiusM: 15000 },

  { id: 'pastane',     label: 'Pastane / Fırın',   offlineCat: null,
    aliases: ['pastane', 'pastanesi', 'pastahane', 'pasta', 'tatlici',
              'tatli', 'firin', 'firini', 'ekmek', 'borekci', 'borek',
              'sekerci', 'baklavaci'],
    tags: ['"shop"~"^(pastry|bakery|confectionery)$"'], radiusM: 5000 },

  { id: 'market',      label: 'Market',            offlineCat: 'market',
    aliases: ['market', 'marketi', 'bakkal', 'supermarket', 'sarkuteri',
              'gida', 'bufe'],
    tags: ['"shop"~"^(supermarket|convenience|greengrocer|butcher)$"'], radiusM: 4000 },

  { id: 'hastane',     label: 'Hastane',           offlineCat: 'hastane',
    aliases: ['hastane', 'hastanesi', 'acil', 'acil servis', 'devlet hastanesi'],
    tags: ['"amenity"="hospital"'], radiusM: 15000 },

  { id: 'saglik',      label: 'Sağlık kuruluşu',   offlineCat: 'saglik',
    aliases: ['saglik ocagi', 'aile hekimi', 'klinik', 'poliklinik',
              'doktor', 'tip merkezi', 'saglik merkezi', 'dis hekimi', 'disci'],
    tags: ['"amenity"~"^(clinic|doctors|dentist)$"'], radiusM: 8000 },

  { id: 'veteriner',   label: 'Veteriner',         offlineCat: null,
    aliases: ['veteriner', 'veterinerlik', 'hayvan hastanesi'],
    tags: ['"amenity"="veterinary"'], radiusM: 15000 },

  { id: 'otopark',     label: 'Otopark',           offlineCat: 'otopark',
    aliases: ['otopark', 'otoparki', 'park yeri', 'arac parki', 'katli otopark'],
    tags: ['"amenity"="parking"'], radiusM: 3000 },

  { id: 'restoran',    label: 'Restoran',          offlineCat: 'restoran',
    aliases: ['restoran', 'restorani', 'lokanta', 'lokantasi', 'yemek',
              'kebapci', 'pideci', 'doner', 'donerci', 'pizzaci', 'balikci',
              'esnaf lokantasi'],
    tags: ['"amenity"~"^(restaurant|fast_food)$"'], radiusM: 4000 },

  { id: 'kafe',        label: 'Kafe',              offlineCat: 'kafe',
    aliases: ['kafe', 'kafesi', 'cafe', 'kahve', 'kahveci', 'kiraathane',
              'cay bahcesi', 'kahvalti'],
    tags: ['"amenity"="cafe"'], radiusM: 4000 },

  { id: 'banka',       label: 'Banka',             offlineCat: 'banka',
    aliases: ['banka', 'bankasi', 'sube'],
    tags: ['"amenity"="bank"'], radiusM: 5000 },

  { id: 'atm',         label: 'ATM',               offlineCat: 'atm',
    aliases: ['atm', 'para cekme', 'bankamatik'],
    tags: ['"amenity"="atm"'], radiusM: 4000 },

  { id: 'otel',        label: 'Otel / Konaklama',  offlineCat: 'otel',
    aliases: ['otel', 'oteli', 'konaklama', 'pansiyon', 'motel', 'apart otel',
              'misafirhane'],
    tags: ['"tourism"~"^(hotel|motel|guest_house|hostel|apartment)$"'], radiusM: 12000 },

  { id: 'okul',        label: 'Okul',              offlineCat: null,
    aliases: ['okul', 'okulu', 'lise', 'lisesi', 'ilkokul', 'ortaokul',
              'anaokulu', 'kres', 'ilkogretim'],
    tags: ['"amenity"~"^(school|kindergarten)$"'], radiusM: 8000 },

  { id: 'universite',  label: 'Üniversite',        offlineCat: null,
    aliases: ['universite', 'universitesi', 'fakulte', 'fakultesi',
              'yuksekokul', 'kampus'],
    tags: ['"amenity"~"^(university|college)$"'], radiusM: 25000 },

  { id: 'avm',         label: 'AVM',               offlineCat: null,
    aliases: ['avm', 'alisveris merkezi', 'mall', 'carsi', 'alisveris'],
    tags: ['"shop"="mall"', '"landuse"="retail"'], radiusM: 20000 },

  { id: 'sanayi',      label: 'Sanayi sitesi',     offlineCat: null,
    /* NOT: alias'lar KATLANMIŞ yazılır — "sanayi sitesi" anahtarı
       "sanayi site"tir (bkz. `_FULL_FORM_FOLD`). Kilit testi bunu doğrular. */
    aliases: ['sanayi', 'sanayi site', 'sanayi bolgesi', 'osb',
              'organize sanayi', 'kucuk sanayi'],
    tags: ['"landuse"~"^(industrial)$"', '"industrial"'], radiusM: 25000 },

  { id: 'cami',        label: 'Cami',              offlineCat: null,
    aliases: ['cami', 'camii', 'camisi', 'mescit', 'mescidi'],
    tags: ['"amenity"="place_of_worship"'], radiusM: 4000 },

  { id: 'postane',     label: 'Postane / PTT',     offlineCat: null,
    aliases: ['postane', 'postanesi', 'ptt', 'kargo', 'kargo subesi'],
    tags: ['"amenity"="post_office"', '"shop"="outpost"'], radiusM: 8000 },

  { id: 'polis',       label: 'Polis / Karakol',   offlineCat: 'polis',
    aliases: ['polis', 'karakol', 'emniyet', 'polis merkezi', 'jandarma'],
    tags: ['"amenity"="police"'], radiusM: 12000 },

  { id: 'itfaiye',     label: 'İtfaiye',           offlineCat: 'itfaiye',
    aliases: ['itfaiye', 'itfaiyesi'],
    tags: ['"amenity"="fire_station"'], radiusM: 20000 },

  { id: 'oto-servis',  label: 'Oto servis',        offlineCat: 'oto-servis',
    aliases: ['oto servis', 'oto tamir', 'tamirci', 'tamirhane', 'oto sanayi',
              'servis', 'oto elektrik', 'kaporta'],
    tags: ['"shop"~"^(car_repair|car_parts)$"'], radiusM: 8000 },

  { id: 'lastik',      label: 'Lastikçi',          offlineCat: 'lastik',
    aliases: ['lastik', 'lastikci', 'lastikcisi', 'jant'],
    tags: ['"shop"="tyres"'], radiusM: 10000 },

  { id: 'oto-yikama',  label: 'Oto yıkama',        offlineCat: 'oto-yikama',
    aliases: ['oto yikama', 'araba yikama', 'yikama', 'kuafor oto'],
    tags: ['"amenity"="car_wash"'], radiusM: 8000 },

  { id: 'berber',      label: 'Berber / Kuaför',   offlineCat: null,
    aliases: ['berber', 'kuafor', 'kuaforu', 'erkek kuaforu'],
    tags: ['"shop"="hairdresser"'], radiusM: 4000 },

  { id: 'dinlenme',    label: 'Dinlenme tesisi',   offlineCat: 'dinlenme',
    aliases: ['dinlenme tesisi', 'dinlenme', 'mola', 'mola yeri', 'servis alani'],
    tags: ['"highway"~"^(services|rest_area)$"'], radiusM: 20000 },

  { id: 'tuvalet',     label: 'Tuvalet',           offlineCat: 'tuvalet',
    aliases: ['tuvalet', 'wc', 'lavabo'],
    tags: ['"amenity"="toilets"'], radiusM: 6000 },
];

/** Alias → kategori indeksi; UZUN alias önce sınanır (spesifik kazanır). */
const _ALIAS_INDEX: ReadonlyArray<readonly [string, PlaceCategoryDef]> = (() => {
  const pairs: Array<[string, PlaceCategoryDef]> = [];
  for (const cat of PLACE_CATEGORIES) {
    for (const a of cat.aliases) pairs.push([a, cat]);
  }
  return pairs.sort((x, y) => y[0].length - x[0].length);
})();

/** Kanonik kimlikten tanım — bilinmeyen kimlik `null`. */
export function findPlaceCategory(id: string): PlaceCategoryDef | null {
  for (const c of PLACE_CATEGORIES) if (c.id === id) return c;
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) NİYET ÇÖZÜMLEME
   ══════════════════════════════════════════════════════════════════════════ */

export interface PlaceQueryIntent {
  /** Kullanıcının yazdığı ham sorgu (DEĞİŞTİRİLMEZ). */
  readonly raw: string;
  /** Karşılaştırma anahtarı — katlanmış + ek sadeleştirilmiş. */
  readonly key: string;
  /** Tespit edilen kategori; yoksa `null`. */
  readonly category: PlaceCategoryDef | null;
  /** "en yakın …" ailesi geçti mi → mesafe ağırlığı artar. */
  readonly wantsNearest: boolean;
  /**
   * Kategori ve "en yakın" sözcükleri ÇIKARILDIKTAN sonra kalan ayırt edici
   * metin ("en yakın florya pastanesi" → "florya"). Boşsa `''`.
   */
  readonly residual: string;
  /**
   * Sorgu bir İŞLETME/YER ADI arıyor gibi mi (kategori yok, adres yapısı yok)?
   * Overpass ad-araması yalnız bu durumda anlamlıdır.
   */
  readonly looksLikeName: boolean;
  /** Sorgu bir adres/idari birim yapısı taşıyor mu (mahalle/cadde/sokak…). */
  readonly hasAddressStructure: boolean;
}

const _ADDRESS_STRUCT_RE = /\b(mahalle|cadde|sokak|bulvar|site|apartman|kume|kumeevler|koy|mevki|blok)\b/;

/** Sözcük sınırıyla alt dize araması (katlanmış metinde). Saf. */
function _hasPhrase(key: string, phrase: string): boolean {
  if (phrase.length === 0) return false;
  const padded = ` ${key} `;
  return padded.includes(` ${phrase} `);
}

/** Bir ifadeyi anahtardan çıkarır (tüm geçişleri). Saf. */
function _stripPhrase(key: string, phrase: string): string {
  const padded = ` ${key} `;
  return padded.split(` ${phrase} `).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Serbest metinden arama niyetini çıkarır. Saf — ağ/zaman/global durum YOK.
 *
 * Örnekler (ölçülen davranış, `searchGeocodingV2.test.ts` kilitler):
 *   "en yakın benzinlik"   → category=benzinlik · wantsNearest=true · residual=''
 *   "florya pastanesi"     → category=pastane   · residual='florya'
 *   "Bağlar Mahallesi"     → category=null      · hasAddressStructure=true
 *   "Şok Market"           → category=market    · residual='sok'
 */
export function detectPlaceIntent(rawQuery: string): PlaceQueryIntent {
  const raw = typeof rawQuery === 'string' ? rawQuery : '';
  const key = normalizePlaceQuery(raw);

  if (key.length === 0) {
    return {
      raw, key: '', category: null, wantsNearest: false, residual: '',
      looksLikeName: false, hasAddressStructure: false,
    };
  }

  /* 1) "en yakın" ailesi — bulunursa çıkarılır, bayrağa dönüşür. */
  let rest = key;
  let wantsNearest = false;
  for (const w of _NEAREST_WORDS) {
    if (_hasPhrase(rest, w)) { wantsNearest = true; rest = _stripPhrase(rest, w); }
  }

  /* 2) Kategori — UZUN alias önce (spesifik kazanır: "sarj istasyonu" ≠ "istasyon"). */
  let category: PlaceCategoryDef | null = null;
  for (const [alias, def] of _ALIAS_INDEX) {
    if (_hasPhrase(rest, alias)) { category = def; rest = _stripPhrase(rest, alias); break; }
  }

  /* 3) Kalan metinden dolgu sözcüklerini at. */
  const residual = rest
    .split(' ')
    .filter((t) => t.length > 0 && !_STOP_WORDS.has(t))
    .join(' ')
    .trim();

  const hasAddressStructure = _ADDRESS_STRUCT_RE.test(key);

  /* Ad araması: kategori YOK, adres yapısı YOK, salt rakam DEĞİL, ≥3 harf. */
  const looksLikeName =
    category === null &&
    !hasAddressStructure &&
    residual.length >= 3 &&
    /[a-z]/.test(residual);

  return { raw, key, category, wantsNearest, residual, looksLikeName, hasAddressStructure };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) BENZERLİK
   ══════════════════════════════════════════════════════════════════════════ */

function _trigrams(text: string): Set<string> {
  const padded = `  ${text}  `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

/** Sørensen–Dice trigram benzerliği (0–1). Saf. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = _trigrams(a);
  const tb = _trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return (2 * hit) / (ta.size + tb.size);
}

/**
 * Sorgu anahtarının aday metniyle eşleşme gücü (0–1).
 * Tam > önek > içerme > trigram — "sadece exact match" YASAĞININ karşılığı.
 */
export function textMatchScore(queryKey: string, candidateKey: string): number {
  if (!queryKey || !candidateKey) return 0;
  if (candidateKey === queryKey) return 1;
  if (candidateKey.startsWith(queryKey)) return 0.92;
  if (candidateKey.includes(queryKey)) return 0.82;

  /* Sorgunun HER sözcüğü adayda geçiyorsa güçlü kısmi eşleşme
     ("sifa eczanesi" ↔ "sifa eczanesi ismet pasa bulvar"). */
  const qTokens = queryKey.split(' ').filter((t) => t.length >= 2);
  if (qTokens.length > 0 && qTokens.every((t) => candidateKey.includes(t))) return 0.78;

  return diceSimilarity(queryKey, candidateKey);
}

/* ══════════════════════════════════════════════════════════════════════════
   5) SIRALAMA
   ══════════════════════════════════════════════════════════════════════════ */

/** Adayı ÜRETEN katman — kaynak güveni ve gözlemlenebilirlik için taşınır. */
export type PlaceLayer =
  | 'HISTORY'            // cihaz-içi geçmiş / favori
  | 'OFFLINE_POI'        // indirilmiş poi.db
  | 'NOMINATIM'          // çevrimiçi serbest metin
  | 'OVERPASS_CATEGORY'  // çevrimiçi kategori + yarıçap
  | 'OVERPASS_NAME'      // çevrimiçi işletme adı + yarıçap
  | 'OVERPASS_STREET';   // çevrimiçi sokak adı tam eşleşme

export interface RankablePlace {
  readonly id: string;
  readonly name: string;
  readonly address?: string;
  readonly lat: number;
  readonly lng: number;
  /** Kanonik kategori kimliği — bilinmiyorsa `null`/eksik (uydurma YASAK). */
  readonly categoryId?: string | null;
  readonly layer: PlaceLayer;
}

export interface RankedPlace<T extends RankablePlace> {
  readonly item: T;
  /** Ölçülen mesafe (km). Konum yoksa `null` — sahte 0 YASAK. */
  readonly distanceKm: number | null;
  readonly score: number;
  /**
   * Puanın BİLEŞENLERİ — "bu sonuç neden birinci" sorusunun cevabı (P0-NAV-08).
   *
   * Eskiden yalnız toplam taşınıyordu; sahada bir sonucun neden üste çıktığı
   * ÖLÇÜLEMİYORDU. Bileşenler HAM (0–1) puanlardır — ağırlıklar niyete göre
   * değişir (bkz. `rankPlaces` içindeki `W`), bu yüzden ham puanı taşımak
   * ağırlıklı payı taşımaktan daha çok bilgi verir. `layerBonus` mutlaktır.
   */
  readonly breakdown: SearchScoreEvidence;
}

/**
 * Alaka tabanı. Bu puanın ALTINDAKİ aday, ÜSTÜNDE aday VARSA düşer.
 * Üstünde aday YOKSA hiçbir şey düşmez — taban listeyi BOŞALTMAZ.
 *
 * 0,18: ölçümdeki "Köln/Şok Market 2706 km" ve "Musul/Eczane 743 km" gibi
 * adaylar bu tabanın altında kalır; "Konya/Bağlar Mahallesi 200 km" gibi
 * meşru ama uzak adaylar üstünde kalır (elenmez, yalnız alta sıralanır).
 */
export const RELEVANCE_FLOOR = 0.18;

/**
 * KATEGORİ sorgusunda mesafe TAVANI (km) — bu mesafenin ötesindeki aday ELENİR.
 *
 * ── NEDEN SADECE KATEGORİ SORGUSUNDA ──────────────────────────────────────
 * "pastane" / "en yakın eczane" **doğası gereği yerel** bir sorudur: sürücü
 * gidebileceği bir yeri sorar. Ölçümde "Şok Market" sorgusuna Nominatim
 * **Köln/Almanya (2706 km)**, "eczane" sorgusuna **Musul/Irak (743 km)**
 * döndürdü; ikisi de ad+kategori bakımından mükemmel eşleşiyor, bu yüzden
 * alaka tabanı onları ELEYEMEZ — eleyen tek doğru ölçüt MESAFEDİR.
 *
 * ── NEDEN ŞEHİR ADI VARSA UYGULANMAZ ──────────────────────────────────────
 * "İstanbul eczane" yazan sürücü oraya GİDİYOR olabilir; 693 km diye reddetmek
 * ürünü kırar (`locationBiasGate`'in CITY_SCOPED sözleşmesiyle AYNI ilke).
 * Sorguda il adı geçiyorsa tavan KAPALIDIR ve şehir kapısı zaten devrededir.
 *
 * 150 km: `locationBiasGate.RELAXED_MAX_KM` ile AYNI sayı — iki kapının aynı
 * "ulaşılamaz" kavramını farklı eşiklerle tanımlaması kafa karışıklığı olurdu.
 */
export const CATEGORY_MAX_KM = 150;

/** Katman güven ikramiyesi — kullanıcının KENDİ yerleri en güvenilir kanıttır. */
const _LAYER_BONUS: Readonly<Record<PlaceLayer, number>> = {
  HISTORY:           0.08,
  OVERPASS_CATEGORY: 0.04,
  OVERPASS_STREET:   0.03,
  OFFLINE_POI:       0.02,
  OVERPASS_NAME:     0.02,
  NOMINATIM:         0.00,
};

/** Haversine (km). Saf. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Mesafe → 0–1 puan. `null` (konum yok) **0,35** döner: bu bir mesafe İDDİASI
 * değildir, "ölçülemedi" durumunun nötr ağırlığıdır — ölçülmüş yakın adayın
 * altında, ölçülmüş uzak adayın üstünde kalır.
 */
function _distanceScore(km: number | null, decayKm: number): number {
  if (km === null) return 0.35;
  if (!Number.isFinite(km) || km < 0) return 0.35;
  return 1 / (1 + km / decayKm);
}

/** Adayın kategori kanıtı sorgudaki kategoriyle uyuşuyor mu (0–1). */
function _categoryScore(intent: PlaceQueryIntent, cand: RankablePlace, candKey: string): number {
  const want = intent.category;
  if (want === null) return 0;
  if (cand.categoryId != null && cand.categoryId === want.id) return 1;
  /* Etiket yoksa ADDAN kanıt aranır: "Florya Pastanesi" adı `pastane`
     alias'ını taşır. Bu bir TAHMİN değil, metin KANITIDIR. */
  for (const a of want.aliases) if (_hasPhrase(candKey, a) || candKey.includes(a)) return 0.85;
  return 0;
}

/**
 * Sorgudaki il/ilçe/mahalle sözcükleri adayın adresinde geçiyor mu.
 * `locationBiasGate`'in ŞEHİR KAPISININ YERİNE GEÇMEZ — o eler, bu sıralar.
 */
function _contextScore(intent: PlaceQueryIntent, candKey: string): number {
  const qTokens = intent.key.split(' ').filter((t) => t.length >= 4);
  if (qTokens.length === 0) return 0;
  let hit = 0;
  for (const t of qTokens) if (candKey.includes(t)) hit++;
  return hit / qTokens.length;
}

/** Üç haneye yuvarla — kanıt alanları okunabilir kalsın. */
function _r3(v: number): number { return Math.round(v * 1000) / 1000; }

export interface RankOptions {
  /** Kullanıcının konumu; yoksa `null` → mesafe ÜRETİLMEZ. */
  readonly origin: { readonly lat: number; readonly lng: number } | null;
  /** Sonuç üst sınırı. */
  readonly limit: number;
}

/**
 * Adayları TEK listede birleştirir, tekilleştirir ve sıralar.
 *
 * Ağırlıklar niyete göre değişir — ölçülen gerekçe:
 *  · KATEGORİ sorgusunda ("pastane") ad benzerliği YANILTICIDIR: doğru cevap
 *    "Florya Pastanesi"dir ve sorguyla ad benzerliği düşüktür. Bu yüzden
 *    kategori kanıtı ve mesafe baskındır.
 *  · AD sorgusunda ("Şifa Eczanesi") ad benzerliği baskındır; mesafe
 *    belirsizliği çözer (aynı adlı iki yer → yakın olan üste).
 */
export function rankPlaces<T extends RankablePlace>(
  intent: PlaceQueryIntent,
  candidates: readonly T[],
  opts: RankOptions,
): RankedPlace<T>[] {
  if (candidates.length === 0) return [];

  const originOk =
    opts.origin !== null &&
    Number.isFinite(opts.origin.lat) && Number.isFinite(opts.origin.lng) &&
    !(opts.origin.lat === 0 && opts.origin.lng === 0);   // Null Island konum DEĞİLDİR

  const isCategory = intent.category !== null;
  const W = isCategory
    ? { name: 0.20, cat: 0.35, dist: 0.42, ctx: 0.03 }
    : { name: 0.60, cat: 0.03, dist: 0.30, ctx: 0.07 };
  const decayKm = intent.wantsNearest ? 2.5 : isCategory ? 6 : 25;

  /* Kategori sorgusunda ad benzerliği ARTIK sorgunun tamamıyla değil,
     AYIRT EDİCİ KALAN metinle ölçülür ("en yakın florya pastanesi" → "florya"). */
  const nameKey = isCategory && intent.residual.length >= 3 ? intent.residual : intent.key;

  /* Mesafe tavanı YALNIZ kategori sorgusunda ve YALNIZ sorguda il adı YOKKEN
     çalışır (bkz. CATEGORY_MAX_KM). Şehir açıkça istendiyse kapı zaten
     `locationBiasGate`tedir; burada ikinci kez karar VERİLMEZ. */
  const capKm = isCategory && originOk && detectCitiesInQuery(intent.raw).length === 0
    ? CATEGORY_MAX_KM
    : Number.POSITIVE_INFINITY;

  const scored: RankedPlace<T>[] = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;

    const candKey = normalizePlaceQuery(`${c.name} ${c.address ?? ''}`);
    const km = originOk && opts.origin !== null
      ? Math.round(haversineKm(opts.origin.lat, opts.origin.lng, c.lat, c.lng) * 10) / 10
      : null;

    /* Ölçülemeyen mesafe ELEME sebebi DEĞİLDİR — "bilmiyoruz" ≠ "uzak". */
    if (km !== null && km > capKm) continue;

    const nameScore = textMatchScore(nameKey, candKey);
    const catScore  = _categoryScore(intent, c, candKey);
    const distScore = _distanceScore(km, decayKm);
    const ctxScore  = _contextScore(intent, candKey);

    const layerBonus = _LAYER_BONUS[c.layer];
    const score =
      W.name * nameScore +
      W.cat  * catScore  +
      W.dist * distScore +
      W.ctx  * ctxScore  +
      layerBonus;

    const total = Math.round(score * 1000) / 1000;
    scored.push({
      item: c,
      distanceKm: km,
      score: total,
      breakdown: {
        total,
        name:       _r3(nameScore),
        category:   _r3(catScore),
        distance:   _r3(distScore),
        context:    _r3(ctxScore),
        layerBonus: _r3(layerBonus),
      },
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    /* Eşit puanda ölçülmüş yakın önce; ölçülemeyen sona. */
    if (a.distanceKm === null && b.distanceKm === null) return 0;
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  /* Alaka tabanı — BOŞALTMAZ (bkz. RELEVANCE_FLOOR). */
  const above = scored.filter((s) => s.score >= RELEVANCE_FLOOR);
  const kept = above.length > 0 ? above : scored;

  return kept.slice(0, Math.max(0, opts.limit));
}

/* ══════════════════════════════════════════════════════════════════════════
   6) TEKİLLEŞTİRME
   ══════════════════════════════════════════════════════════════════════════ */

/** Katman güveni — çakışan iki kayıttan HANGİSİNİN kalacağını belirler. */
const _LAYER_RICHNESS: Readonly<Record<PlaceLayer, number>> = {
  HISTORY:           5,   // kullanıcının kendi kaydı — adı onun verdiği addır
  OVERPASS_CATEGORY: 4,   // kategori etiketi KANITLI
  OVERPASS_STREET:   3,
  NOMINATIM:         2,   // tam idari adres taşır
  OVERPASS_NAME:     2,
  OFFLINE_POI:       1,
};

/**
 * Aynı yeri gösteren adayları teker: koordinat ~11 m'de aynıysa, VEYA ad
 * aynıyken ~110 m'de aynıysa tek kayıt kalır. Daha ZENGİN katman kazanır.
 *
 * NEDEN İKİ ANAHTAR: aynı eczaneyi Nominatim ve Overpass birkaç metre farkla
 * verir (koordinat anahtarı yakalar); `poi.db` ile Overpass arasında fark
 * 50-100 m'ye çıkabilir (ad anahtarı yakalar). 110 m'nin ötesinde AYNI ADLI
 * iki yer GERÇEKTEN farklı olabilir (ölçüm: 5 km'de dört ayrı "Şok") — bu
 * yüzden yarıçap dar tutulur ve birleştirme YAPILMAZ.
 */
export function dedupePlaces<T extends RankablePlace>(candidates: readonly T[]): T[] {
  const byCoord = new Map<string, T>();
  const byName  = new Map<string, T>();
  const out: T[] = [];

  const replace = (prev: T, next: T): boolean =>
    _LAYER_RICHNESS[next.layer] > _LAYER_RICHNESS[prev.layer];

  for (const c of candidates) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const coordKey = `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`;
    const nameKey  = `${normalizePlaceQuery(c.name)}@${c.lat.toFixed(3)}_${c.lng.toFixed(3)}`;

    const prev = byCoord.get(coordKey) ?? byName.get(nameKey);
    if (prev !== undefined) {
      if (replace(prev, c)) {
        const i = out.indexOf(prev);
        if (i >= 0) out[i] = c;
        byCoord.set(coordKey, c);
        byName.set(nameKey, c);
      }
      continue;
    }
    byCoord.set(coordKey, c);
    byName.set(nameKey, c);
    out.push(c);
  }
  return out;
}

/**
 * `dedupePlaces` + KANIT: kaç aday girdi, kaç kaldı, kaç tanesi birleşti.
 *
 * NEDEN AYRI FONKSİYON (P0-NAV-08): `dedupePlaces`in dönüş tipi değiştirilseydi
 * mevcut TÜM çağıranlar bozulurdu. Birleştirmenin kendisi TEK yerde kalır —
 * bu sarmalayıcı yalnız ÖLÇER, karar vermez. Sessiz düşen aday sahada
 * görünmüyordu: "8 aday bulundu" ile "8 aday bulundu, 5'i birleşti" farklı
 * teşhislerdir.
 */
export function dedupePlacesWithEvidence<T extends RankablePlace>(
  candidates: readonly T[],
): { readonly kept: T[]; readonly evidence: DedupeEvidence } {
  const kept = dedupePlaces(candidates);
  return { kept, evidence: describeDedupe(candidates.length, kept.length) };
}
