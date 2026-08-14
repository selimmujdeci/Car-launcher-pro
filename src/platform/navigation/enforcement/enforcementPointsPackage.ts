/**
 * enforcementPointsPackage — DENETİM NOKTASI paketinin SAF katmanı.
 *
 * `scripts/fetch-enforcement-points.mjs` tarafından üretilen paketi DOĞRULAR,
 * uzamsal indeksini kurar ve "en yakın nokta" sorgusunu yanıtlar. Bu dosya
 * SAFTIR: I/O · timer · `Date.now` · `Math.random` · global durum · React
 * importu YOKTUR. Aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── NEDEN "DENETİM NOKTASI", "RADAR" DEĞİL (karar K3) ───────────────────────
 * Kaynak (EGM kamuya açık EDS haritası) tip alanı YAYINLAMAZ. Ölçülen paketin
 * **%93'ünde tip bilinmiyor**. "Radar" demek, bilinmeyen bir şeyin ne olduğunu
 * İDDİA etmektir. Bu yüzden ürün dili tip iddiası taşımaz.
 *
 * ── NEDEN HIZ LİMİTİ YOK (karar K4) ─────────────────────────────────────────
 * Kaynakta hız limiti HİÇ yoktur (`speedLimitKph` her kayıtta `null`). Paket
 * hız eşiği İDDİA ETMEZ; limit gerekiyorsa yolun KENDİ limitinden gelir.
 *
 * ── BOŞ LİSTE ≠ "DENETİM YOK" (sessiz sahte güvenin merkezi) ────────────────
 * Sıfır noktalı bir paket GEÇERSİZDİR. Üretici script boş paket yazmayı zaten
 * reddeder; burada da reddedilir → tüketici `UNAVAILABLE` görür. "Yolda denetim
 * yok" izlenimi ASLA veri yokluğundan üretilmez.
 *
 * ── MESAFE KUŞ UÇUŞUDUR (rota boyunca DEĞİL) ────────────────────────────────
 * Buradaki mesafe iki nokta arası büyük-daire mesafesidir. Rota geometrisi
 * BİLİNMEZ — yol dönüyorsa gerçek sürüş mesafesi DAHA UZUNDUR. Bu bilinçli bir
 * yaklaşımdır ve tüketiciye `DERIVED` olarak bildirilir.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme
 * ══════════════════════════════════════════════════════════════════════════ */

/** Paket şemasının DESTEKLENEN sürümü. Farklı sürüm → paket REDDEDİLİR. */
export const ENFORCEMENT_SCHEMA_VERSION = 1;

/**
 * Kaynakta yapılandırılmış tip alanı YOKTUR; bu değerler serbest metinden
 * ÇIKARIMDIR (DERIVED) ve çıkarılamayan her kayıt `UNKNOWN` kalır.
 */
export type EnforcementPointType =
  | 'UNKNOWN'
  | 'AVERAGE_SPEED'
  | 'RED_LIGHT'
  | 'PARKING';

/** Ortalama hız koridorunda uç rolü — yalnız metinden çıkarılabildiyse. */
export type EnforcementPointRole = 'START' | 'END';

export interface EnforcementPoint {
  /**
   * Paket İÇİNDEKİ sıra numarasından türeyen kararlı kimlik (`p-0`, `p-1`…).
   * Kaynakta kimlik alanı yoktur. **Koordinat kimliğe GÖMÜLMEZ** — bu kimlik
   * Guardian olayına ve oradan CAROS LAB'a taşınır; koordinat taşınamaz
   * (gözlemlenebilirlik kuralı 6). Paket yenilenince sıra değişebilir; kimlik
   * yalnız AYNI paket sürümü içinde kararlıdır.
   */
  readonly id:             string;
  readonly lat:            number;
  readonly lng:            number;
  readonly type:           EnforcementPointType;
  readonly role:           EnforcementPointRole | null;
  /** Kaynakta YOK — sözleşme gereği HER ZAMAN `null`. Sahte 0 yazılmaz. */
  readonly speedLimitKph:  null;
  /** Serbest metin yön ipucu — dereceye ÇEVRİLMEZ (kaynakta açı yok). */
  readonly directionHint:  string | null;
  /** Kaynağın ham etiketi. Sürücüye/LAB'a TAŞINMAZ — yalnız kanıt/denetim için. */
  readonly label:          string;
}

export interface EnforcementPackage {
  readonly schemaVersion:  number;
  readonly sourceId:       string;
  readonly sourceUrl:      string;
  readonly sourceNote:     string;
  /** Paketin ÜRETİLDİĞİ an (ISO 8601) — cihazın "şimdi"si DEĞİL. */
  readonly fetchedAt:      string;
  readonly count:          number;
  readonly typeCounts:     Readonly<Record<string, number>>;
  readonly points:         readonly EnforcementPoint[];
}

/** Paket reddedildiğinde NEDENİ — tüketici sahte "veri yok" üretmesin diye. */
export type EnforcementRejectReason =
  | 'NOT_AN_OBJECT'
  | 'SCHEMA_VERSION_MISMATCH'
  | 'MISSING_SOURCE_FIELDS'
  | 'MISSING_FETCHED_AT'
  | 'POINTS_NOT_ARRAY'
  | 'NO_VALID_POINTS';

export interface EnforcementParseResult {
  readonly pkg:     EnforcementPackage | null;
  readonly reason:  EnforcementRejectReason | null;
  /** Ayrıştırma sırasında ELENEN bozuk kayıt sayısı (sessizce yutulmaz). */
  readonly droppedPointCount: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Doğrulama
 * ══════════════════════════════════════════════════════════════════════════ */

const VALID_TYPES: ReadonlySet<string> = new Set([
  'UNKNOWN', 'AVERAGE_SPEED', 'RED_LIGHT', 'PARKING',
]);
const VALID_ROLES: ReadonlySet<string> = new Set(['START', 'END']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Coğrafi geçerlilik — aralık dışı koordinat sessizce 0'a düşürülmez, ELENİR. */
function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return isFiniteNumber(lat) && isFiniteNumber(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parsePoint(raw: unknown, ordinal: number): EnforcementPoint | null {
  if (!isObject(raw)) return null;
  if (!isValidLatLng(raw.lat, raw.lng)) return null;

  const type = typeof raw.type === 'string' && VALID_TYPES.has(raw.type)
    ? (raw.type as EnforcementPointType)
    : 'UNKNOWN'; // tanınmayan tip TAHMİN EDİLMEZ → UNKNOWN

  const role = typeof raw.role === 'string' && VALID_ROLES.has(raw.role)
    ? (raw.role as EnforcementPointRole)
    : null;

  return {
    id:            `p-${ordinal}`,
    lat:           raw.lat as number,
    lng:           raw.lng as number,
    type,
    role,
    speedLimitKph: null, // sözleşme: kaynakta YOK — gelen değer ne olursa olsun null
    directionHint: isNonEmptyString(raw.directionHint) ? raw.directionHint : null,
    label:         isNonEmptyString(raw.label) ? raw.label : '',
  };
}

/**
 * Ham JSON'u doğrular. Reddederse `pkg: null` + `reason` döner — çağıran
 * `UNAVAILABLE` gösterir. THROW ETMEZ.
 */
export function parseEnforcementPackage(raw: unknown): EnforcementParseResult {
  if (!isObject(raw)) {
    return { pkg: null, reason: 'NOT_AN_OBJECT', droppedPointCount: 0 };
  }
  if (raw.schemaVersion !== ENFORCEMENT_SCHEMA_VERSION) {
    return { pkg: null, reason: 'SCHEMA_VERSION_MISMATCH', droppedPointCount: 0 };
  }
  if (!isNonEmptyString(raw.sourceId) || !isNonEmptyString(raw.sourceUrl)) {
    return { pkg: null, reason: 'MISSING_SOURCE_FIELDS', droppedPointCount: 0 };
  }
  if (!isNonEmptyString(raw.fetchedAt)) {
    // Tazelik gösterilemeyen paket kabul EDİLMEZ — yaşı bilinmeyen veri
    // "taze" gibi görünür ve bu sessiz bir yalandır.
    return { pkg: null, reason: 'MISSING_FETCHED_AT', droppedPointCount: 0 };
  }
  if (!Array.isArray(raw.points)) {
    return { pkg: null, reason: 'POINTS_NOT_ARRAY', droppedPointCount: 0 };
  }

  const points: EnforcementPoint[] = [];
  let dropped = 0;
  for (let i = 0; i < raw.points.length; i++) {
    const p = parsePoint(raw.points[i], i);
    if (p === null) { dropped++; continue; }
    points.push(p);
  }

  if (points.length === 0) {
    // BOŞ LİSTE ≠ "denetim yok". Geçerli bir paket asla sıfır nokta taşımaz.
    return { pkg: null, reason: 'NO_VALID_POINTS', droppedPointCount: dropped };
  }

  const typeCounts: Record<string, number> = {
    UNKNOWN: 0, AVERAGE_SPEED: 0, RED_LIGHT: 0, PARKING: 0,
  };
  for (let i = 0; i < points.length; i++) typeCounts[points[i].type]++;

  return {
    pkg: {
      schemaVersion: ENFORCEMENT_SCHEMA_VERSION,
      sourceId:      raw.sourceId,
      sourceUrl:     raw.sourceUrl,
      sourceNote:    isNonEmptyString(raw.sourceNote) ? raw.sourceNote : '',
      fetchedAt:     raw.fetchedAt,
      count:         points.length, // BEYAN EDİLEN değil, SAYILAN
      typeCounts,
      points,
    },
    reason: null,
    droppedPointCount: dropped,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sürüş ilgisi süzgeci
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * SÜRÜŞ SIRASINDA anlamı olmayan noktaları eler. Bugün yalnız `PARKING`:
 * park ihlali denetimi seyir hâlindeki sürücü için bir risk DEĞİLDİR; uyarı
 * vermek gürültüdür ve gürültü, gerçek uyarının güvenilirliğini yer.
 *
 * Elenen noktalar paketten SİLİNMEZ — yalnız yakınlık sorgusunun dışında
 * kalır. CAROS LAB hem paket toplamını hem sorgulanan alt kümeyi AYRI gösterir
 * ki "1503 nokta var" ile "1495 nokta sorgulanıyor" farkı görünür olsun.
 */
export function filterDrivingRelevantPoints(
  points: readonly EnforcementPoint[],
): readonly EnforcementPoint[] {
  const out: EnforcementPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].type === 'PARKING') continue;
    out.push(points[i]);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Uzamsal indeks
 * ══════════════════════════════════════════════════════════════════════════ */

/** Hücre kenarı (derece). ~0,05° ≈ 5,5 km enlem — ilgi yarıçapımızın (≤2 km)
 *  üstünde, böylece 1 halka komşu taraması YETERLİDİR. */
const CELL_DEG = 0.05;

/** Anahtar paketleme: enlem hücresi × bu çarpan + boylam hücresi. Çarpan tüm
 *  olası boylam hücresi aralığından (±3600) büyük seçilir → çakışma YOK. */
const CELL_KEY_STRIDE = 100_000;

export interface EnforcementIndex {
  readonly points:  readonly EnforcementPoint[];
  readonly cells:   ReadonlyMap<number, readonly number[]>;
}

function cellKey(latCell: number, lngCell: number): number {
  return latCell * CELL_KEY_STRIDE + lngCell;
}

/** Paketin noktalarından hücre indeksi kurar — BİR KEZ, yükleme anında. */
export function buildEnforcementIndex(points: readonly EnforcementPoint[]): EnforcementIndex {
  const cells = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const key = cellKey(
      Math.floor(points[i].lat / CELL_DEG),
      Math.floor(points[i].lng / CELL_DEG),
    );
    const bucket = cells.get(key);
    if (bucket === undefined) cells.set(key, [i]);
    else bucket.push(i);
  }
  return { points, cells };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Geometri (saf)
 * ══════════════════════════════════════════════════════════════════════════ */

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Büyük-daire mesafe (metre) — haversine. */
export function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const dφ = (lat2 - lat1) * DEG_TO_RAD;
  const dλ = (lng2 - lng1) * DEG_TO_RAD;
  const s = Math.sin(dφ / 2) * Math.sin(dφ / 2)
    + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) * Math.sin(dλ / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Başlangıç kerterizi (0..360, kuzeyden saat yönünde). */
export function bearingDegrees(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const dλ = (lng2 - lng1) * DEG_TO_RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const deg = Math.atan2(y, x) * RAD_TO_DEG;
  return deg < 0 ? deg + 360 : deg;
}

/**
 * İki açı arasındaki EN KISA fark (0..180). JS `%` KALAN operatörüdür, modulo
 * DEĞİL — negatif girdide yanlış sonuç verir; bu yüzden normalizasyon açıkça
 * yapılır (aynı kusur `lerpAngle`de yaşandı, kütük #396).
 */
export function angleDeltaDegrees(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d < 0) d += 360;
  return d > 180 ? 360 - d : d;
}

/* ══════════════════════════════════════════════════════════════════════════
 * En yakın nokta sorgusu
 * ══════════════════════════════════════════════════════════════════════════ */

export interface EnforcementQuery {
  readonly lat:              number;
  readonly lng:              number;
  /** Bu yarıçapın dışındaki noktalar HİÇ değerlendirilmez (metre). */
  readonly radiusMeters:     number;
  /**
   * Araç yönü (derece, 0..360) veya `null`. `null` ise yön kapısı UYGULANMAZ
   * ve sonuç `headingKnown:false` ile döner — çağıran fail-closed karar verir.
   */
  readonly headingDegrees:   number | null;
  /** Yön kapısının yarı açısı (derece). Kerteriz bu koninin dışındaysa nokta
   *  ARKADA sayılır ve elenir. */
  readonly aheadHalfAngleDegrees: number;
}

export interface EnforcementHit {
  readonly point:           EnforcementPoint;
  readonly distanceMeters:  number;
  readonly bearingDegrees:  number;
  /** Yön bilinmiyorsa `false` — "önümde" iddiası DOĞRULANMAMIŞ demektir. */
  readonly headingKnown:    boolean;
  /** Yarıçap içinde bulunan (yön kapısından ÖNCEKİ) toplam nokta sayısı. */
  readonly candidateCount:  number;
}

/**
 * Yarıçap içindeki EN YAKIN noktayı döndürür. Yön biliniyorsa yalnız İLERİDEKİ
 * (koni içi) noktalar değerlendirilir — arkada kalan bir noktaya uyarı vermek
 * yanlış alarmdır. Hiçbir aday yoksa `null`.
 *
 * SAF: girdi mutasyona uğramaz, zaman/rastgelelik yok.
 */
export function findNearestEnforcementPoint(
  index: EnforcementIndex,
  query: EnforcementQuery,
): EnforcementHit | null {
  if (!isFiniteNumber(query.lat) || !isFiniteNumber(query.lng)) return null;
  if (!isFiniteNumber(query.radiusMeters) || query.radiusMeters <= 0) return null;

  const latCell = Math.floor(query.lat / CELL_DEG);
  const lngCell = Math.floor(query.lng / CELL_DEG);

  let bestIdx = -1;
  let bestDistance = Infinity;
  let bestBearing = 0;
  let candidateCount = 0;

  const headingKnown = isFiniteNumber(query.headingDegrees);
  const halfAngle = isFiniteNumber(query.aheadHalfAngleDegrees)
    ? query.aheadHalfAngleDegrees
    : 180;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = index.cells.get(cellKey(latCell + dy, lngCell + dx));
      if (bucket === undefined) continue;

      for (let b = 0; b < bucket.length; b++) {
        const p = index.points[bucket[b]];
        const d = haversineMeters(query.lat, query.lng, p.lat, p.lng);
        if (d > query.radiusMeters) continue;
        candidateCount++;

        const bearing = bearingDegrees(query.lat, query.lng, p.lat, p.lng);
        if (headingKnown
            && angleDeltaDegrees(bearing, query.headingDegrees as number) > halfAngle) {
          continue; // arkada kaldı — uyarı verilmez
        }

        if (d < bestDistance) {
          bestDistance = d;
          bestBearing = bearing;
          bestIdx = bucket[b];
        }
      }
    }
  }

  if (bestIdx < 0) return null;

  return {
    point:          index.points[bestIdx],
    distanceMeters: bestDistance,
    bearingDegrees: bestBearing,
    headingKnown,
    candidateCount,
  };
}
