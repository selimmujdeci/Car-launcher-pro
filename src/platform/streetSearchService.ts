/**
 * streetSearchService — SOKAK/CADDE düzeyinde TAM eşleşmeli adres çözümleme.
 *
 * ── NEDEN VAR (saha 2026-08-03) ────────────────────────────────────────────
 * Kullanıcı: *"herhangi bir sokak/mahalle ne varsa kullanıcı kendi sokağına
 * gidebilmeli"*. Ölçüm bunun Nominatim ile MÜMKÜN OLMADIĞINI gösterdi:
 * `"Tarsus Bağlar Mahallesi 0455 Sokak"` için serbest metin ve yapılandırılmış
 * (`street=`/`city=`) sorguların ONUNDA da istenen numara dönmedi; Nominatim
 * numarayı bulanık eşleştirip aynı bölgeden RASTGELE sokak veriyor
 * (0411 · 0423 · 0436 · 0443 · 0452 · 0478 · 3232 · 1713 · 4072 · 1102 · 0655).
 *
 * Aynı veri Overpass ile DOĞRUDAN sorgulandığında TAM eşleşiyor:
 *   way["highway"]["name"~"^0*469\.? ?Sokak$",i](around:3000,36.9175,34.8621)
 *   → "0469. Sokak" @ 36.9184146, 34.8637155   (ölçüldü)
 *
 * Bu modül o farkı ürüne bağlar: Nominatim başarısız olduğunda OSM'e ADIYLA
 * sorar. Aynı ODbL verisi, `offlineDataService`'in zaten kullandığı Overpass
 * altyapısı — yeni lisans/bağımlılık YOK.
 *
 * ── SINIRLAR (dürüstlük) ───────────────────────────────────────────────────
 * • OSM'de OLMAYAN sokak bulunamaz. Ölçüldü: `0455. Sokak` Tarsus/Bağlar'da
 *   OSM'de YOKTUR (0450·0451·0452·0456·0458 var), Google'da vardır. Hiçbir
 *   sorgu tekniği olmayan veriyi üretemez.
 * • Overpass halka açık ve sık MEŞGUL döner (ölçüm sırasında iki kez
 *   `Dispatcher_Client::request_read_and_idx::timeout` alındı) → bu yol
 *   ZORUNLU DEĞİL, yalnızca EK ŞANStır; hata/timeout sessizce boş döner.
 * • Bir MERKEZ şarttır (yarıçap sorgusu): ya sorgudaki şehrin çapası ya da
 *   kullanıcı konumu. İkisi de yoksa sorgu yapılmaz — tüm Türkiye'yi taramak
 *   Overpass'i de bizi de boğar (ölçüldü: ülke geneli alan sorgusu HTTP 429).
 */

import type { GeoResult } from './geocodingService';

/** Overpass ortak uç noktası — offlineDataService ile AYNI. */
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA       = 'CarOSPro/1.0 (vehicle navigation)';
/** Şehir içi makul yarıçap — "kendi sokağım" senaryosu için fazlasıyla yeter. */
const RADIUS_M   = 20_000;
const MAX_HITS   = 6;

/* ── KAPSAM AYRIMI (P0-NAV-07 · canlı ölçüm 2026-08-23) ──────────────────────
 *
 * ÖLÇÜLEN KUSUR: bu katman sokağı YALNIZ kullanıcının 20 km çevresinde arıyordu.
 * "Yakın POI" için doğru, **hedef adres** için yanlış: Tarsus'taki sürücü
 * Mersin'deki caddeyi arayabilir. `"Kuvayimilliye Caddesi"` (OSM'deki adı
 * "Kuvayi **Milliye** Caddesi" — BOŞLUKLU) ölçümü, Tarsus 36.9175/34.8621:
 *
 *   kullanıcı çevresi **20 km → 0 sonuç**    (793 ms)   ← bildirilen kusur
 *   kullanıcı çevresi **30 km → 6 sonuç**    (4419 ms)  24,6 km'de doğru cadde
 *   kullanıcı çevresi **60 km → 6 sonuç**    (1264 · 2302 ms)
 *   **ÇAPA (Mersin merkezi) + 20 km → 6 sonuç (587 ms)** ← en ucuz VE en doğru
 *
 * Nominatim bu sınıfı ÇÖZEMEZ: `"Kuvayimilliye Caddesi"` viewbox'lı da
 * viewbox'sız da yalnız 702 km'deki bir CAMİYİ, `"Mersin Kuvayimilliye
 * Caddesi"` ise **0 sonuç** döndürdü. Yani doğru cevabı yalnız Overpass'in
 * boşluğa duyarsız regexi verebilir — ama DOĞRU YERDE aranırsa.
 *
 * ── KÖR BÜYÜTME YOK ────────────────────────────────────────────────────────
 * Yarıçap otomatik büyümez. Sıra: (1) ÇAPA varsa orada 20 km · (2) kullanıcı
 * çevresinde 20 km · (3) YALNIZ ikisi de 0 döndüyse kullanıcı çevresinde
 * `WIDE_RADIUS_M`. Üçü de ORTAK bir son tarihi paylaşır, yani toplam süre
 * tek denemeninkiyle aynı tavana bağlıdır ve halka açık Overpass'e ardışık
 * geniş alan sorgusu YAĞDIRILMAZ.
 */
/**
 * Genişletilmiş yarıçap (m). 60 km ÖLÇÜLMÜŞ bir değerdir: 30 km da yeterdi
 * (24,6 km'deki hedefi buldu) ama komşu il merkezleri Türkiye'de tipik olarak
 * 40–70 km aralığındadır; 60 km "yan ildeki cadde" sınıfını kapatırken maliyet
 * ölçümde 1,3–2,3 sn'de kaldı. 100 km denendi ve halka açık sunucuda
 * 429/504 üretti — bu yüzden tavan 60 km'dedir.
 */
export const WIDE_RADIUS_M = 60_000;

/** Çapa aramasının yarıçapı — il merkezinden şehir içi kapsama. */
export const ANCHOR_RADIUS_M = 20_000;

/**
 * TEK denemenin üst sınırı (ms).
 *
 * ── NEDEN DENEME BAŞINA TAVAN (ölçüm bir TASARIM HATASINI ortaya çıkardı) ──
 * İlk uygulamada yalnız ORTAK bir son tarih vardı. Canlı ölçümde yakın deneme
 * yüklü sunucuda **8679 ms** sürdü ve 9 sn'lik ortak bütçenin tamamını yedi →
 * genişletilmiş yarıçap denemesi **hiç koşmadı** ("aç kalma"). Yani bütçe
 * paylaşımı, düzeltmenin kendisini sessizce devre dışı bırakıyordu.
 * Deneme başına tavan bunu keser: yavaş bir deneme sonrakini AÇ BIRAKAMAZ.
 *
 * 6 sn, bu modülün P0-NAV-07 ÖNCESİNDEKİ tek-deneme toleransıyla AYNI sayıdır
 * (eski `TIMEOUT_MS`) — yani "kendi sokağım" yolunun bekleme davranışı
 * DEĞİŞMEZ; değişen tek şey, ikinci denemenin artık aç kalmamasıdır.
 */
export const STREET_ATTEMPT_TIMEOUT_MS = 6_000;

/** Kaç denemeye izin verilirse verilsin, TOPLAM süre bu tavanı aşamaz. */
export const STREET_SEARCH_BUDGET_MS = 12_000;

/** Aramanın yapılacağı merkez. */
export interface StreetSearchOrigin {
  readonly lat: number;
  readonly lng: number;
}

export interface StreetSearchOptions {
  /**
   * Sorguda adı geçen şehrin merkezi (bkz. `geo/cityAnchor`). Verilirse ARAMA
   * ÖNCE ORADA yapılır — kullanıcı konumu ŞART DEĞİLDİR.
   */
  readonly anchor?: StreetSearchOrigin | null;
  /**
   * Kullanıcı çevresinde 20 km hiçbir şey bulamazsa `WIDE_RADIUS_M` denensin mi.
   * Varsayılan `false` — genişletme çağıranın BİLİNÇLİ kararıdır.
   */
  readonly allowWideRadius?: boolean;
}

/* ── Sorgudan sokak adı çıkarma (SAF) ───────────────────────────────────── */

export interface StreetQuery {
  /** Overpass `name` regex'i (POSIX, `,i` ile kullanılır) */
  nameRegex: string;
  /** İnsan-okur etiket — sonuç adı olarak kullanılır */
  label:     string;
  kind:      'numbered' | 'named';
  /**
   * Adlı sorguda denenen gövde adayları — UZUNDAN KISAYA (en ayırt edici önce).
   * Boşluklar ATILMIŞ hâlde tutulur (karşılaştırma boşluğa duyarsız yapılır).
   *
   * NEDEN LİSTE: "Ankara Kızılay Atatürk Bulvarı"nda hangi sözcüklerin idari
   * önek, hangilerinin sokak adı olduğunu sözlüksüz BİLEMEYİZ. Tek bir tahmin
   * yapmak yerine 1–3 sözcüklük son ekleri aday olarak deneriz; hangisi
   * eşleşirse sonucun AYIRT EDİCİLİĞİ ona göre işaretlenir (bkz. `relaxed`).
   * Numaralı sorgularda boştur.
   */
  candidates: readonly string[];
}

/** POSIX regex için kaçış — kullanıcı metni doğrudan regex'e GİRMEZ. */
function _esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const _NUMBERED_RE = /(\d{2,5})\s*\.?\s*(sokak|sokağı|sok|sk|cadde|caddesi|cad|cd|bulvar|bulvarı|blv)\b/i;

/** Yol tipi sözcüğü — TEK token olarak sınanır (sondan yakalama için). */
const _ROAD_TYPE_TOKEN = /^(sokak|sokağı|sokagi|sok|sk|cadde|caddesi|cad|cd|bulvar|bulvarı|bulvari|bulv|blv)\.?$/i;

/**
 * İdari/adres yapısı sözcükleri — sokak ADININ PARÇASI DEĞİLDİR.
 * Bunlardan SONRASI sokak adıdır; öncesi (il/ilçe/mahalle) atılır.
 */
const _ADMIN_TOKEN = /^(mahalle|mahallesi|mahallesine|mah|mh|semt|semti|ilçe|ilçesi|ilce|ilcesi|köy|köyü|koy|koyu|mevki|mevkii|no|numara)\.?$/i;

/**
 * Sokak adı gövdesi için üst sınır — daha uzunu idari önek taşımaya başlar.
 * Dışa açık: kilit testi eşiği ELLE yazmasın, otoriteden okusun.
 */
export const STREET_NAME_MAX_TOKENS = 3;

/** Türkçe yol tipi sözcüğünü OSM'in kullandığı kanonik biçime eşler. */
function _osmType(word: string): 'Sokak' | 'Cadde' | 'Bulvar' {
  const w = word.toLowerCase().replace(/\.$/, '');
  /* `cd` kısaltması `cad`la BAŞLAMAZ; eski kod bu yüzden onu Sokak sanıyordu
     (ölçüldü 2026-08-11: "… Kuvayimilliye cd." → `^… ?Sokak.*$`). */
  if (w === 'cd' || w.startsWith('cad')) return 'Cadde';
  if (w === 'blv' || w.startsWith('bul')) return 'Bulvar';
  return 'Sokak';
}

/**
 * Gövdeyi BOŞLUĞA DUYARSIZ bir POSIX desenine çevirir.
 *
 * NEDEN (ölçüldü 2026-08-11): kullanıcı `Kuvayimilliye` yazıyor, OSM'de ad
 * `Kuvayi Milliye Caddesi`. İkisi AYNI yeri kasteder ama düz literal eşleşme
 * boşluk yüzünden düşer — ölçülen 6 ürün başarısızlığının 4'ü tam olarak buydu.
 * Bu yüzden her karakter arasına `?` ile OPSİYONEL boşluk konur ve
 * karşılaştırma "boşluklar atılınca aynı mı" sorusuna indirgenir.
 *
 * BİLGİ KAYBI YOK: harf atılmaz, sıra korunur, gövde kısaltılmaz. Yalnız
 * boşluk esnetilir — Türkçe imlada birleşik/ayrı yazım gerçekten değişkendir.
 */
function _spaceLoose(body: string): string {
  const bare = body.replace(/\s+/g, '');
  return [...bare].map(_esc).join(' ?');
}

/** Boşluk ve büyük/küçük harf farkını atarak karşılaştırma anahtarı üretir. */
function _bodyKey(s: string): string {
  return s.replace(/\s+/g, '').toLocaleLowerCase('tr');
}

/**
 * Serbest metinden sokak/cadde sorgusu çıkarır. Bulamazsa `null`.
 *
 * Numaralı: "Bağlar Mahallesi 0455 Sokak" → `^0*455\.? ?Sokak.*`
 *   (baştaki sıfırlar ve nokta OSM ile kullanıcı arasında değişir;
 *    `0455. Sokak` ↔ `455 sokak` ikisi de aynı yeri kasteder) — DEĞİŞMEDİ.
 *
 * ── ADLI YOL: GÖVDE SONDAN YAKALANIR (düzeltme 2026-08-11) ─────────────────
 * ÖNCEKİ KUSUR (ölçüldü, kütük #544): gövde sorgunun BAŞINDAN yakalanıyordu →
 * il ve mahalle adı da Overpass regexine giriyordu:
 *     "Mersin Yenişehir Mahallesi Kuvayimilliye Caddesi"
 *       → `^Mersin Yenişehir Mahallesi Kuvayimilliye ?Cadde.*$`
 * OSM'de ad yalnız "Kuvayi Milliye Caddesi" olduğu için bu desen ASLA
 * eşleşmiyordu; yani #336'da "son şans" diye kurulan katman adlı yollarda
 * YAPISAL OLARAK ÖLÜYDÜ (3/3 yan yana ölçümle kanıtlandı: ürün regexi YOK,
 * öneksiz kontrol VAR).
 *
 * ŞİMDİ: yol tipi sözcüğü SONDAN bulunur, öncesindeki idari sözcüklerden
 * (mahalle/ilçe/köy…) SONRASI alınır ve 1–3 sözcüklük son ekler ADAY olarak
 * denenir. Hangi adayın eşleştiği sonucun ayırt ediciliğini belirler:
 * daha kısa bir adayla eşleşen sonuç `relaxed` işaretlenir (bkz.
 * `searchStreetByName`) → onay istenir, sessizce rotaya çevrilmez.
 */
export function extractStreetQuery(query: string): StreetQuery | null {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return null;

  const num = _NUMBERED_RE.exec(q);
  if (num) {
    const bare = num[1].replace(/^0+/, '') || '0';
    const type = _osmType(num[2]);
    return {
      nameRegex:  `^0*${bare}\\.? ?${type}.*$`,
      label:      `${num[1]}. ${type}`,
      kind:       'numbered',
      candidates: [],
    };
  }

  /* ── Adlı yol: yol tipini SONDAN bul ─────────────────────────────────── */
  const tokens = q.split(' ');
  let typeAt = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (_ROAD_TYPE_TOKEN.test(tokens[i])) { typeAt = i; break; }
  }
  if (typeAt <= 0) return null;              // yol tipi yok ya da gövde yok

  const type = _osmType(tokens[typeAt]);

  /* İdari sözcükten SONRASI sokak adıdır (en SONDAKİ idari sözcük esas alınır:
     "Mersin Yenişehir Mahallesi Kuvayimilliye" → "Kuvayimilliye"). */
  let start = 0;
  for (let i = typeAt - 1; i >= 0; i--) {
    if (_ADMIN_TOKEN.test(tokens[i])) { start = i + 1; break; }
  }
  const nameTokens = tokens.slice(start, typeAt);
  if (nameTokens.length === 0) return null;

  /* Aday son ekler — UZUNDAN KISAYA. Üst sınır aşılırsa idari önek sızmaya
     başlar (ölçülen kusurun kaynağı buydu). */
  const maxLen = Math.min(STREET_NAME_MAX_TOKENS, nameTokens.length);
  const candidates: string[] = [];
  for (let len = maxLen; len >= 1; len--) {
    const cand = nameTokens.slice(nameTokens.length - len).join(' ');
    /* Tek harfli/çok kısa gövde ayırt edici DEĞİLDİR → yanlış sokağa götürebilir. */
    if (_bodyKey(cand).length < 3) continue;
    candidates.push(cand);
  }
  if (candidates.length === 0) return null;

  /* Tek sorguda hepsini dene: `^(uzun|orta|kısa) ?Tip.*$`. Ayırt ediciliği
     sonuçtan SONRA ölçeriz — Overpass alternatifleri sıralamaz. */
  const alt = candidates.map(_spaceLoose).join('|');
  return {
    nameRegex:  `^(${alt}) ?${type}.*$`,
    label:      `${candidates[0]} ${type}`,
    kind:       'named',
    candidates: candidates.map(_bodyKey),
  };
}

/**
 * Dönen adın KAÇINCI adayla eşleştiğini verir: 0 = en uzun (en ayırt edici),
 * büyüdükçe daha zayıf. Eşleşme bulunamazsa aday sayısı döner (en zayıf).
 * Numaralı sorgularda aday yoktur → daima 0 (tam eşleşme zaten filtrelenmiştir).
 * Saf fonksiyon.
 */
function _candidateRank(sq: StreetQuery, osmName: string): number {
  if (sq.candidates.length === 0) return 0;
  const key = _bodyKey(osmName);
  for (let i = 0; i < sq.candidates.length; i++) {
    if (key.startsWith(sq.candidates[i])) return i;
  }
  return sq.candidates.length;
}

/* ── Overpass sorgusu ───────────────────────────────────────────────────── */

interface OverpassWay {
  id?:     number;
  tags?:   Record<string, string>;
  center?: { lat: number; lon: number };
}

/** TEK Overpass denemesi. Ortak SON TARİHE uyar. `null` = hata/timeout. */
async function _streetAttempt(
  sq:       StreetQuery,
  origin:   StreetSearchOrigin,
  radiusM:  number,
  deadline: number,
): Promise<GeoResult[] | null> {
  /* Deneme başına tavan + kalan ORTAK bütçe; hangisi küçükse o. */
  const budget = Math.min(STREET_ATTEMPT_TIMEOUT_MS, deadline - Date.now());
  if (budget <= 0) return null;

  const ql =
    `[out:json][timeout:${Math.max(3, Math.round(budget / 1000))}];` +
    `way["highway"]["name"~"${sq.nameRegex}",i](around:${Math.round(radiusM)},${origin.lat},${origin.lng});` +
    `out center ${MAX_HITS};`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const res = await fetch(OVERPASS, {
      method:  'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(ql)}`,
      signal:  ctrl.signal,
    });
    // Overpass meşgulken JSON değil HTML hata sayfası döner → parse patlamasın.
    const text = await res.text();
    if (!text.startsWith('{')) return null;

    const data = JSON.parse(text) as { elements?: OverpassWay[] };
    const out: GeoResult[] = [];
    const seen = new Set<string>();

    for (const el of data.elements ?? []) {
      const c    = el.center;
      const name = el.tags?.name;
      if (!c || !name) continue;
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      // Aynı sokak birden çok way parçası olabilir — ada göre tekille.
      if (seen.has(name)) continue;
      seen.add(name);
      /* AYIRT EDİCİLİK: sonuç EN UZUN adayla mı eşleşti, yoksa daha kısa bir
         son ekle mi? "Gazi Mustafa Kemal Bulvarı" ararken "Namık Kemal
         Bulvarı" da 1 sözcüklük adayı karşılar — ikisini AYNI güvenle
         sunmak yanlış yere götürmek olur. Kısa adayla eşleşen sonuç
         `relaxed` işaretlenir; motor onu otomatik rotaya ÇEVİRMEZ, onay
         listesine koyar (mevcut #334/#335 mekanizması, yeni kapı değil). */
      const rank = _candidateRank(sq, name);
      out.push({
        id:       `osm-way-${el.id ?? name}`,
        name,
        fullName: name,
        lat:      c.lat,
        lng:      c.lon,
        type:     'highway/street',
        source:   'online',
        ...(rank > 0 ? { relaxed: true } : {}),
      });
      if (out.length >= MAX_HITS) break;
    }
    /* En ayırt edici (en uzun adayla eşleşen) sonuç önce. */
    return out.sort(
      (a, b) => _candidateRank(sq, a.name) - _candidateRank(sq, b.name),
    );
  } catch {
    return null; // ağ/abort/parse — navigasyon bu yola BAĞIMLI DEĞİLDİR
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sokağı OSM'de ADIYLA arar. Bulunamaz/hata/timeout → **boş dizi** (fail-soft).
 *
 * MERKEZ SIRASI (bkz. yukarıdaki KAPSAM AYRIMI ölçümü):
 *   1. `opts.anchor` (sorgudaki şehrin merkezi) + `ANCHOR_RADIUS_M`
 *      → kullanıcı konumu ŞART DEĞİL; hedef adres kullanıcının çevresine
 *        HAPSEDİLMEZ.
 *   2. kullanıcı konumu + `RADIUS_M` (DEĞİŞMEDİ — "kendi sokağım" yolu)
 *   3. YALNIZ 1 ve 2 boş döndüyse ve `opts.allowWideRadius` ise
 *      kullanıcı konumu + `WIDE_RADIUS_M`
 *
 * Her deneme `STREET_ATTEMPT_TIMEOUT_MS` ile TEK TEK sınırlıdır (yavaş bir
 * deneme sonrakini AÇ BIRAKAMAZ — ölçülen tasarım hatası) ve hepsi birlikte
 * `STREET_SEARCH_BUDGET_MS` tavanını aşamaz; bütçe bitmişse sonraki deneme
 * ağa HİÇ ÇIKMAZ. Hiçbir merkez yoksa sorgu YAPILMAZ (yarıçapsız tarama
 * yasağı korunur).
 */
export async function searchStreetByName(
  query: string,
  lat?:  number,
  lng?:  number,
  opts:  StreetSearchOptions = {},
): Promise<GeoResult[]> {
  const sq = extractStreetQuery(query);
  if (!sq) return [];

  const userOk = lat != null && lng != null
    && Number.isFinite(lat) && Number.isFinite(lng);
  const anchor = opts.anchor ?? null;
  const anchorOk = anchor !== null
    && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)
    && !(anchor.lat === 0 && anchor.lng === 0);

  /* Ne çapa ne kullanıcı konumu var → tüm Türkiye'yi taramak YASAK. */
  if (!anchorOk && !userOk) return [];

  const deadline = Date.now() + STREET_SEARCH_BUDGET_MS;

  /* 1 — ÇAPA: sorguda şehir adı geçiyorsa cevap ORADADIR. */
  if (anchorOk && anchor !== null) {
    const hit = await _streetAttempt(sq, anchor, ANCHOR_RADIUS_M, deadline);
    if (hit !== null && hit.length > 0) return hit;
  }

  if (!userOk) return [];

  const user: StreetSearchOrigin = { lat: lat as number, lng: lng as number };

  /* 2 — Kullanıcı çevresi (DAVRANIŞ DEĞİŞMEDİ). */
  const near = await _streetAttempt(sq, user, RADIUS_M, deadline);
  if (near !== null && near.length > 0) return near;

  /* 3 — Genişletilmiş yarıçap. `near === null` (hata/timeout) bu dala GİRMEZ:
     "sorgu düştü" ile "burada gerçekten yok" AYNI ŞEY DEĞİLDİR ve düşen bir
     sorguyu daha GENİŞ alanla tekrarlamak halka açık sunucuyu zorlamaktır. */
  if (opts.allowWideRadius === true && near !== null && near.length === 0) {
    const wide = await _streetAttempt(sq, user, WIDE_RADIUS_M, deadline);
    if (wide !== null) return wide;
  }

  return [];
}
