/**
 * locationBiasGate.ts — KONUM-ÖNCELİKLİ BELİRSİZLİK ÇÖZÜMÜ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK.
 * Ağ çağrısı YAPMAZ, sağlayıcı seçmez, yeniden deneme tetiklemez — yalnız
 * ELİNDEKİ aday listesini sıralar ve KANITA dayanarak eler.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN (canlı ölçüm · 2026-08-12, konum: Tarsus 36.9175/34.8621) ───────
 * ══════════════════════════════════════════════════════════════════════════
 * Türkiye'de mahalle/cadde adları ÇOK-ŞEHİRLİDİR ("Bağlar Mahallesi" onlarca
 * ilde vardır). Ürünün bu belirsizliği çözen HİÇBİR kuralı yoktu. Ürünün
 * GERÇEK istek kurulumuyla ölçüldü:
 *
 *  1) "Cumhuriyet Mahallesi" (şehir YOK, viewbox=Tarsus) → 4 aday:
 *       Adana 43 km · Mersin 27 km · **Tarsus 3 km** · Konya 83 km
 *     Ürünün SUNDUĞU ilk aday **Adana (43 km)**; kullanıcının 3 km ötesindeki
 *     mahalle listenin ÜÇÜNCÜ sırasındaydı. Viewbox bias sonucu LİSTEYE sokar
 *     ama SIRALAMAZ — "en yakın" kavramı zincirde hiç yoktu.
 *
 *  2) "Bağlar Mahallesi" (şehir YOK, viewbox YOK = harita arama çubuğu zinciri)
 *     → ilk aday **Siverek/Şanlıurfa 405 km**, en yakın aday (Konya/Çumra
 *     200 km) listenin SONUNCUSU; kullanıcının 1 km ötesindeki Tarsus/Bağlar
 *     listede HİÇ YOK.
 *
 *  3) "İstanbul Bağlar Mahallesi" (şehir AÇIKÇA belirtilmiş, viewbox=Tarsus)
 *     → ilk aday **Tarsus'ta bir okul (0 km)**; gerçekten istenen
 *     "Bağlar Mahallesi, Bağcılar, İstanbul" ikinci sıradaydı. Yani şehir
 *     yazmak işe YARAMIYORDU: yakınlık, açıkça istenen şehri eziyordu.
 *
 * Teşhis turunun §3.5 bulgusu (379 km ve 696 km uzaktaki GEVŞETİLMİŞ adaylar
 * sürücüye sunuluyor) bu ölçümlerle aynı kökün üç yüzüdür: **mesafe hiçbir
 * yerde karar değişkeni değildi.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KURAL (kullanıcı sözleşmesi · 2026-08-12) ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * **Şehir belirtilmemişse → en yakın öncelikli. Şehir belirtilmişse → o şehir
 * kesin.** İkincisi PAZARLIKSIZ: biri Tarsus'tayken "İstanbul …" arıyorsa
 * oraya GİDECEĞİ için arıyordur; 693 km uzakta diye reddetmek ürünü kırar.
 *
 *   MOD             ne zaman                       ne yapar
 *   ─────────────── ────────────────────────────── ─────────────────────────
 *   CITY_SCOPED     sorguda İL adı VAR             mesafe kapısı KAPALI;
 *                                                  yalnız o ilin sonuçları
 *   PROXIMITY       il adı YOK + konum VAR         mesafeye göre SIRALA;
 *                                                  uzak GEVŞEK adayı ele
 *   UNMEASURED      il adı YOK + konum YOK         hiçbir şey yapma
 *
 * ── DÜRÜSTLÜK SÖZLEŞMESİ ──────────────────────────────────────────────────
 *  · **Kanıtsız eleme YOK.** Bir aday "yanlış şehirde" diye ancak ADINDA
 *    BAŞKA bir il geçiyorsa elenir. Şehir kanıtı taşımayan aday (Overpass
 *    sokak sonucu yalnız "0469. Sokak" der) ELENMEZ — `UNKNOWN` sayılır ve
 *    kullanıcı onayına düşer. "Bilmiyoruz" ile "yanlış" aynı şey DEĞİLDİR.
 *  · **Uzaklık tek başına RET sebebi değildir.** Kullanıcının YAZDIĞI sorguyla
 *    bulunmuş uzak sonuç ELENMEZ, yalnız `farFromUser` işaretlenir → motor onu
 *    otomatik rotaya çevirmez, onay ister. Yalnız GEVŞETİLMİŞ (kullanıcının
 *    yazmadığı bir varyantla bulunmuş) VE çok uzak aday elenir: iki zayıflık
 *    üst üste gelince aday cevap olmaktan çıkar.
 *  · **Konum yoksa mesafe ÜRETİLMEZ** (`distanceKm: null`) — sahte 0 YASAK.
 *  · Kapı sorguyu DEĞİŞTİRMEZ; `extractStreetQuery` / gevşetme merdiveni /
 *    numara doğrulaması mantığına DOKUNMAZ, onların ÜSTÜNE çalışır.
 */

/* ── Eşikler (dışa açık: kilit testleri eşiği ELLE yazmasın) ─────────────── */

/**
 * Bu mesafenin ötesindeki aday "uzak" sayılır → OTOMATİK rotaya çevrilmez,
 * onay listesine düşer. ELENMEZ (kullanıcı gerçekten uzağa gidiyor olabilir).
 * 100 km: ölçümdeki meşru komşu-il adayları (Adana 43 km · Konya 83 km) bu
 * eşiğin ALTINDA kalır; 200/405/693 km olanlar üstünde.
 */
export const FAR_FROM_USER_KM = 100;

/**
 * GEVŞETİLMİŞ aday bu mesafeden uzaksa TAMAMEN elenir. Teşhis §3.5'te sürücüye
 * sunulan 379 km ve 696 km'lik adaylar tam olarak bu sınıftı: sonuç ne
 * kullanıcının yazdığı sorguyla bulunmuş, ne de ulaşılabilir bir yerde.
 */
export const RELAXED_MAX_KM = 150;

/**
 * Sonuç adının SONUNDAN kaç virgül parçasında il adı aranacağı.
 *
 * NEDEN SONDAN: Nominatim `display_name` sırası "…, ilçe, İL, bölge, posta
 * kodu, Türkiye"dir. Baştan taransaydı SOKAK ADI il sanılırdı — ölçümde
 * gerçekten oldu: "Tarsus Borsa **İstanbul** … Lisesi, …, Mersin, …" kaydı
 * "İstanbul" sorgusunun cevabı sayılırdı. Kuyruk taraması bunu keser.
 */
export const RESULT_CITY_TAIL_SEGMENTS = 4;

/* ── Türkçe normalizasyon ───────────────────────────────────────────────── */

const _TR_MAP: Readonly<Record<string, string>> = {
  'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g',
  'Ü': 'u', 'ü': 'u', 'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c',
};

/**
 * Diyakritiğe ve büyük/küçük harfe DUYARSIZ anahtar üretir.
 *
 * `'İ'.toLowerCase()` İKİ kod birimi üretir (`i` + U+0307 birleşen nokta) ve
 * bu ürünün üç ayrı yerinde kaymaya yol açmıştı (teşhis §3.7). Bu yüzden TR
 * harfleri `toLowerCase`'den ÖNCE elle eşlenir, kalan birleşen işaretler de
 * NFD ayrıştırmasıyla atılır. Saf.
 */
export function normalizeTrKey(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let out = '';
  for (const ch of input) out += _TR_MAP[ch] ?? ch;
  return out
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // NFD birleşen işaretleri
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function _tokens(input: string): string[] {
  const n = normalizeTrKey(input);
  return n.length === 0 ? [] : n.split(' ');
}

/* ── İl sözlüğü (81 il — statik olgu, lisans/bağımlılık YOK) ─────────────── */

const _PROVINCES: readonly string[] = [
  'adana', 'adiyaman', 'afyonkarahisar', 'agri', 'aksaray', 'amasya', 'ankara',
  'antalya', 'ardahan', 'artvin', 'aydin', 'balikesir', 'bartin', 'batman',
  'bayburt', 'bilecik', 'bingol', 'bitlis', 'bolu', 'burdur', 'bursa',
  'canakkale', 'cankiri', 'corum', 'denizli', 'diyarbakir', 'duzce', 'edirne',
  'elazig', 'erzincan', 'erzurum', 'eskisehir', 'gaziantep', 'giresun',
  'gumushane', 'hakkari', 'hatay', 'igdir', 'isparta', 'istanbul', 'izmir',
  'kahramanmaras', 'karabuk', 'karaman', 'kars', 'kastamonu', 'kayseri',
  'kilis', 'kirikkale', 'kirklareli', 'kirsehir', 'kocaeli', 'konya',
  'kutahya', 'malatya', 'manisa', 'mardin', 'mersin', 'mugla', 'mus',
  'nevsehir', 'nigde', 'ordu', 'osmaniye', 'rize', 'sakarya', 'samsun',
  'siirt', 'sinop', 'sivas', 'sanliurfa', 'sirnak', 'tekirdag', 'tokat',
  'trabzon', 'tunceli', 'usak', 'van', 'yalova', 'yozgat', 'zonguldak',
];

/** Halk arasında kullanılan/eski adlar — OSM kayıtlarında da geçerler. */
const _CITY_ALIAS: Readonly<Record<string, string>> = {
  urfa:   'sanliurfa',
  antep:  'gaziantep',
  maras:  'kahramanmaras',
  icel:   'mersin',
  afyon:  'afyonkarahisar',
  izmit:  'kocaeli',
};

const _PROVINCE_SET: ReadonlySet<string> = new Set(_PROVINCES);

/** Dışa açık — kilit testleri listeyi ELLE kopyalamasın. */
export const TR_PROVINCE_COUNT = _PROVINCES.length;

function _canonicalCity(token: string): string | null {
  if (_PROVINCE_SET.has(token)) return token;
  const alias = _CITY_ALIAS[token];
  return alias !== undefined ? alias : null;
}

/**
 * İl adından SONRA gelirse o sözcük bir ŞEHİR BİLDİRİMİ değil, bir YER ADIDIR:
 * "Ankara Caddesi" Adana'da bir caddedir, Ankara ili değil.
 */
const _PLACE_SUFFIX = new Set([
  'cadde', 'caddesi', 'cad', 'cd', 'sokak', 'sokagi', 'sok', 'sk',
  'bulvar', 'bulvari', 'bulv', 'blv', 'yol', 'yolu',
  'mahalle', 'mahallesi', 'mah', 'mh', 'apartmani', 'apt', 'sitesi',
]);

/**
 * Sorguda AÇIKÇA belirtilmiş il adlarını çıkarır (kanonik, tekil).
 *
 * "Ankara Caddesi" gibi il adının bir YER ADININ parçası olduğu durumlar
 * ayıklanır (bkz. `_PLACE_SUFFIX`). Saf fonksiyon.
 */
export function detectCitiesInQuery(query: string): string[] {
  const tokens = _tokens(query);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const city = _canonicalCity(tokens[i]);
    if (city === null) continue;
    const next = tokens[i + 1];
    if (next !== undefined && _PLACE_SUFFIX.has(next)) continue;  // "Ankara Caddesi"
    if (!out.includes(city)) out.push(city);
  }
  return out;
}

/**
 * Sonuç adının KUYRUĞUNDA geçen il adları (idari kanıt).
 * Kuyruk taşımayan ad (ör. Overpass'in verdiği yalın "0469. Sokak") → boş dizi.
 * Saf fonksiyon.
 */
export function detectCitiesInResult(fullName: string): string[] {
  if (typeof fullName !== 'string' || fullName.length === 0) return [];
  const segments = fullName.split(',').map((s) => s.trim()).filter(Boolean);
  const tail = segments.slice(Math.max(0, segments.length - RESULT_CITY_TAIL_SEGMENTS));
  const out: string[] = [];
  for (const seg of tail) {
    for (const tok of _tokens(seg)) {
      const city = _canonicalCity(tok);
      if (city !== null && !out.includes(city)) out.push(city);
    }
  }
  return out;
}

/* ── Mesafe ─────────────────────────────────────────────────────────────── */

/** Haversine (km). Saf. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Kapı ───────────────────────────────────────────────────────────────── */

export interface BiasCandidate {
  readonly lat: number;
  readonly lng: number;
  /** Sağlayıcının verdiği TAM ad — şehir kanıtı YALNIZ buradan okunur. */
  readonly fullName: string;
  /** Kullanıcının yazdığı sorguyla değil, gevşetilmiş varyantla bulunduysa. */
  readonly relaxed?: boolean;
}

export interface Origin {
  readonly lat: number;
  readonly lng: number;
}

/** Adayın SORGUDAKİ şehre göre idari kanıtı. */
export type CityEvidence =
  /** Adayın kuyruğunda sorgudaki il GEÇİYOR. */
  | 'MATCH'
  /** Kuyrukta BAŞKA bir il geçiyor, sorgudaki YOK → yanlış şehir. */
  | 'MISMATCH'
  /** Adayda il kanıtı YOK (ya da sorguda il belirtilmemiş) → iddia edilmez. */
  | 'UNKNOWN';

export interface BiasedCandidate<T> {
  readonly item: T;
  /** Ölçülen mesafe (km). Konum yoksa `null` — sahte 0 YASAK. */
  readonly distanceKm: number | null;
  /** `FAR_FROM_USER_KM` üstü → otomatik rota YOK, onay istenir. */
  readonly farFromUser: boolean;
  readonly cityEvidence: CityEvidence;
}

export type LocationBiasMode = 'CITY_SCOPED' | 'PROXIMITY' | 'UNMEASURED';

export interface LocationBiasResult<T> {
  /** Elenmemiş adaylar — PROXIMITY modunda EN YAKIN ÖNCE. */
  readonly kept: readonly BiasedCandidate<T>[];
  /** Mesafe kapısının eledİĞİ (yalnız gevşetilmiş + çok uzak) aday sayısı. */
  readonly droppedFar: number;
  /** Yanlış şehir kanıtıyla elenen aday sayısı. */
  readonly droppedWrongCity: number;
  /** Sorguda AÇIKÇA belirtilen iller (kanonik). Boş = belirtilmemiş. */
  readonly citiesInQuery: readonly string[];
  readonly mode: LocationBiasMode;
}

/**
 * Adayları konum/şehir kanıtına göre sıralar ve eler.
 *
 * @param query   kullanıcının sorgusu — YALNIZ il adı okumak için (değiştirilmez)
 * @param items   sağlayıcıdan gelen adaylar (sıra korunur / mesafeye göre değişir)
 * @param origin  kullanıcının konumu; yoksa `null` → mesafe ÜRETİLMEZ
 */
export function applyLocationBias<T extends BiasCandidate>(
  query:  string,
  items:  readonly T[],
  origin: Origin | null,
): LocationBiasResult<T> {
  const cities = detectCitiesInQuery(query);

  const originOk = origin !== null
    && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
    && !(origin.lat === 0 && origin.lng === 0);   // Null Island konum DEĞİLDİR

  const distOf = (it: T): number | null => {
    if (!originOk || origin === null) return null;
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) return null;
    return Math.round(haversineKm(origin.lat, origin.lng, it.lat, it.lng) * 10) / 10;
  };

  /* ── ŞEHİR BELİRTİLMİŞ: mesafe kapısı KAPALI, şehir KESİN ─────────────── */
  if (cities.length > 0) {
    const scored = items.map((it) => {
      const found = detectCitiesInResult(it.fullName);
      const evidence: CityEvidence =
        found.some((c) => cities.includes(c)) ? 'MATCH'
          : found.length > 0                  ? 'MISMATCH'
            : 'UNKNOWN';
      return { it, evidence, km: distOf(it) };
    });

    const matched = scored.filter((s) => s.evidence === 'MATCH');
    /* İstenen şehirde EN AZ BİR aday varsa cevap ODUR: şehir kanıtı taşımayan
       adaylar da elenir, çünkü kanıtlı bir eşleşmenin yanında kanıtsız aday
       sunmak belirsizliği geri getirir. Kanıtlı eşleşme YOKSA kanıtsızlar
       KORUNUR (elenen yalnız BAŞKA ilde olduğu KANITLI olanlardır). */
    const keptScored = matched.length > 0
      ? matched
      : scored.filter((s) => s.evidence !== 'MISMATCH');

    return {
      kept: keptScored.map((s) => ({
        item:         s.it,
        distanceKm:   s.km,
        /* Mesafe burada bir RET ya da onay sebebi DEĞİLDİR: şehir açıkça
           istendi. Ama şehri DOĞRULANAMAYAN aday onaya düşer (aşağıdaki
           `cityEvidence` alanını motor okur). */
        farFromUser:  false,
        cityEvidence: s.evidence,
      })),
      droppedFar:       0,
      droppedWrongCity: scored.length - keptScored.length,
      citiesInQuery:    cities,
      mode:             'CITY_SCOPED',
    };
  }

  /* ── ŞEHİR BELİRTİLMEMİŞ + KONUM YOK: ölçülemez, dokunulmaz ──────────── */
  if (!originOk) {
    return {
      kept: items.map((it) => ({
        item: it, distanceKm: null, farFromUser: false, cityEvidence: 'UNKNOWN',
      })),
      droppedFar:       0,
      droppedWrongCity: 0,
      citiesInQuery:    [],
      mode:             'UNMEASURED',
    };
  }

  /* ── ŞEHİR BELİRTİLMEMİŞ + KONUM VAR: EN YAKIN ÖNCE ──────────────────── */
  let droppedFar = 0;
  const scored: BiasedCandidate<T>[] = [];
  for (const it of items) {
    const km = distOf(it);
    /* Mesafesi ÖLÇÜLEMEYEN aday (bozuk koordinat) elenmez ama öne de geçemez. */
    if (km !== null && it.relaxed === true && km > RELAXED_MAX_KM) { droppedFar++; continue; }
    scored.push({
      item:         it,
      distanceKm:   km,
      farFromUser:  km !== null && km > FAR_FROM_USER_KM,
      cityEvidence: 'UNKNOWN',
    });
  }

  /* Ölçülemeyen mesafe sona — "bilinmiyor" en yakın SAYILMAZ. */
  scored.sort((a, b) => {
    if (a.distanceKm === null && b.distanceKm === null) return 0;
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  return {
    kept:             scored,
    droppedFar,
    droppedWrongCity: 0,
    citiesInQuery:    [],
    mode:             'PROXIMITY',
  };
}
