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
 * • Kullanıcı konumu ŞARTTIR (yarıçap sorgusu). Konum yoksa sorgu yapılmaz —
 *   tüm Türkiye'yi taramak Overpass'i de bizi de boğar.
 */

import type { GeoResult } from './geocodingService';

/** Overpass ortak uç noktası — offlineDataService ile AYNI. */
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA       = 'CarOSPro/1.0 (vehicle navigation)';
/** Halka açık Overpass yavaş olabilir; navigasyonu BEKLETMEZ. */
const TIMEOUT_MS = 6_000;
/** Şehir içi makul yarıçap — "kendi sokağım" senaryosu için fazlasıyla yeter. */
const RADIUS_M   = 20_000;
const MAX_HITS   = 6;

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

/**
 * Sokağı OSM'de ADIYLA arar. Bulunamaz/hata/timeout → **boş dizi** (fail-soft).
 * Konum verilmezse sorgu YAPILMAZ (yarıçapsız tarama yasak).
 */
export async function searchStreetByName(
  query: string,
  lat?:  number,
  lng?:  number,
): Promise<GeoResult[]> {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const sq = extractStreetQuery(query);
  if (!sq) return [];

  const ql =
    `[out:json][timeout:${Math.round(TIMEOUT_MS / 1000)}];` +
    `way["highway"]["name"~"${sq.nameRegex}",i](around:${RADIUS_M},${lat},${lng});` +
    `out center ${MAX_HITS};`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OVERPASS, {
      method:  'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(ql)}`,
      signal:  ctrl.signal,
    });
    // Overpass meşgulken JSON değil HTML hata sayfası döner → parse patlamasın.
    const text = await res.text();
    if (!text.startsWith('{')) return [];

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
    return []; // ağ/abort/parse — navigasyon bu yola BAĞIMLI DEĞİLDİR
  } finally {
    clearTimeout(timer);
  }
}
