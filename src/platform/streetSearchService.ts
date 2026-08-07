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
}

/** POSIX regex için kaçış — kullanıcı metni doğrudan regex'e GİRMEZ. */
function _esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const _NUMBERED_RE = /(\d{2,5})\s*\.?\s*(sokak|sokağı|sok|sk|cadde|caddesi|cad|cd|bulvar|bulvarı|blv)\b/i;
const _NAMED_RE    = /([\p{L}\p{M}][\p{L}\p{M}\s.'-]{2,60}?)\s+(sokak|sokağı|sok|sk|cadde|caddesi|cad|cd|bulvar|bulvarı|blv)\b/iu;

/** Türkçe yol tipi sözcüğünü OSM'in kullandığı kanonik biçime eşler. */
function _osmType(word: string): 'Sokak' | 'Cadde' | 'Bulvar' {
  const w = word.toLowerCase();
  if (w.startsWith('cad')) return 'Cadde';
  if (w.startsWith('bul') || w === 'blv') return 'Bulvar';
  return 'Sokak';
}

/**
 * Serbest metinden sokak/cadde sorgusu çıkarır. Bulamazsa `null`.
 *
 * Numaralı: "Bağlar Mahallesi 0455 Sokak" → `^0*455\.? ?Sokak.*`
 *   (baştaki sıfırlar ve nokta OSM ile kullanıcı arasında değişir;
 *    `0455. Sokak` ↔ `455 sokak` ikisi de aynı yeri kasteder)
 * Adlı: "Şamil Başayev Caddesi" → `^Şamil Başayev Cadde.*`
 *   (ek/çekim farkı için sonu serbest bırakılır)
 */
export function extractStreetQuery(query: string): StreetQuery | null {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return null;

  const num = _NUMBERED_RE.exec(q);
  if (num) {
    const bare = num[1].replace(/^0+/, '') || '0';
    const type = _osmType(num[2]);
    return {
      nameRegex: `^0*${bare}\\.? ?${type}.*$`,
      label:     `${num[1]}. ${type}`,
      kind:      'numbered',
    };
  }

  const named = _NAMED_RE.exec(q);
  if (named) {
    const base = named[1].trim();
    // Tek harfli/çok kısa gövde ayırt edici değildir → yanlış sokağa götürebilir.
    if (base.length < 3) return null;
    const type = _osmType(named[2]);
    return {
      nameRegex: `^${_esc(base)} ?${type}.*$`,
      label:     `${base} ${type}`,
      kind:      'named',
    };
  }

  return null;
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
      out.push({
        id:       `osm-way-${el.id ?? name}`,
        name,
        fullName: name,
        lat:      c.lat,
        lng:      c.lon,
        type:     'highway/street',
        source:   'online',
      });
      if (out.length >= MAX_HITS) break;
    }
    return out;
  } catch {
    return []; // ağ/abort/parse — navigasyon bu yola BAĞIMLI DEĞİLDİR
  } finally {
    clearTimeout(timer);
  }
}
