/**
 * tileGrid.ts — NAV v3 · L1 · SLIPPY KARO MATEMATİĞİ (SAF · F1).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F1/1 · v2 §2.
 *
 * SAF: I/O YOK · timer YOK · global durum YOK · React YOK ·
 * `Date.now`/`performance.now` YOK · deterministik.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ÖLÇÜLMÜŞ KUSUR, 2026-09-03) ────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Aynı Web Mercator (slippy / XYZ) karo formülü depoda **ÜÇ AYRI YERDE**
 * bağımsız yazılmıştı:
 *
 *   1. `platform/mapTileProbe.ts:11`          `lngLatToTile()`   — `Math.pow(2,z)` + KIRPMA
 *   2. `core/navigation/CorridorSyncEngine.ts:48` `_tileXY()`    — `1 << z`      + kırpma YOK
 *   3. `platform/offlineTileDownloader.ts:82` `latLonToTileXY()` — `2 ** z`      + kırpma YOK
 *
 * Üçü de aynı matematiği iddia ediyordu ama **davranışları AYNI DEĞİLDİ**:
 * biri sonucu `[0, n-1]`e kırpıyor, ikisi kırpmıyordu; biri `1 << z`
 * kullandığı için `z ≥ 31`de NEGATİF `n` üretirdi. Üç ayrı "aynı" formül,
 * karo kimliğinde sessiz ayrışma demektir — ve karo kimliği yanlışsa
 * "bu bölge önbellekte var" hükmü de yanlıştır.
 *
 * Bu dosya o üç uygulamanın TEK kaynağıdır. Üç çağıran buraya delege edilmiştir;
 * **hiçbirinin sayısal sonucu değişmemiştir** (parite kilidi:
 * `navV3MapStoreF1.test.ts` → "üç eski uygulama ile BİREBİR aynı").
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── İKİ KATMAN: PARİTE vs FAIL-CLOSED ─────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *  · `lngLatToTileRaw*`  — HAM matematik. Doğrulama YOK, kırpma seçilebilir.
 *    Yalnız eski çağıranların **birebir davranışını korumak** için vardır.
 *    Geçersiz girdide (NaN/∞) bugünkü gibi NaN üretir — bu KASITLIDIR.
 *  · `toTile()` / `tileBounds()` / `tilesForBBox()` — KANONİK giriş noktası.
 *    **FAIL-CLOSED**: geçersiz girdi → `null` / boş dizi. Yeni kod ve MapStore
 *    YALNIZ bu katmanı kullanır.
 *
 * Yeni paralel karo sistemi ÜRETİLMEDİ: düzen repoda ne ise odur
 * (Web Mercator XYZ, `z/x/y`, kuzeybatı köşesi çapa).
 */

/** Karo koordinatı — `z/x/y` (XYZ / slippy düzeni, kuzeybatı çapası). */
export interface TileCoord {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** Coğrafi sınır kutusu — TileJSON 2.x sırası: `[batı, güney, doğu, kuzey]`. */
export type LngLatBBox = readonly [west: number, south: number, east: number, north: number];

/** Web Mercator'ın temsil edebildiği enlem tavanı (±). */
export const MERCATOR_LAT_LIMIT = 85.0511287798066;

export const TILE_Z_MIN = 0;
/** Üst sınır: `2 ** 30` hâlâ güvenli tam sayı; pratikte karo şeması ≤ 22 kullanır. */
export const TILE_Z_MAX = 30;

/** Bir `bbox` sorgusunun döndürebileceği azami karo (sınırsız kuyruk YASAK). */
export const TILE_BBOX_MAX_RESULTS = 4096;

/* ══════════════════════════════════════════════════════════════════════════
   1) HAM MATEMATİK — eski çağıranlarla BİREBİR parite katmanı
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ham slippy dönüşümü, **kırpma YOK**.
 * `CorridorSyncEngine._tileXY` ve `offlineTileDownloader.latLonToTileXY`
 * ile birebir aynı sayıyı üretir.
 *
 * Not: eski `CorridorSyncEngine` `1 << z` kullanıyordu; burada `2 ** z`
 * kullanılır. `z ≤ 30` için ikisi AYNI değeri verir (korridor `z ∈ [10,13]`
 * kullanır); `z ≥ 31`de `1 << z` NEGATİF üretirdi — bu bir kusurdu, düzeltildi.
 */
export function lngLatToTileRawUnclamped(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

/**
 * Ham slippy dönüşümü, **sonuç `[0, n-1]`e kırpılır**.
 * `mapTileProbe.lngLatToTile` ile birebir aynı sayıyı üretir.
 */
export function lngLatToTileRawClamped(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const { x, y } = lngLatToTileRawUnclamped(lng, lat, z);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KANONİK, FAIL-CLOSED KATMAN
   ══════════════════════════════════════════════════════════════════════════ */

function _isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Zoom geçerli mi (tam sayı, `[TILE_Z_MIN, TILE_Z_MAX]`). */
export function isValidZoom(z: unknown): z is number {
  return typeof z === 'number' && Number.isInteger(z) && z >= TILE_Z_MIN && z <= TILE_Z_MAX;
}

/** Karo koordinatı yapısal ve aralık olarak geçerli mi. */
export function isValidTile(t: unknown): t is TileCoord {
  if (!t || typeof t !== 'object') return false;
  const c = t as { z?: unknown; x?: unknown; y?: unknown };
  if (!isValidZoom(c.z)) return false;
  const n = 2 ** c.z;
  return Number.isInteger(c.x) && Number.isInteger(c.y)
    && (c.x as number) >= 0 && (c.x as number) < n
    && (c.y as number) >= 0 && (c.y as number) < n;
}

/**
 * Kanonik dönüşüm — **FAIL-CLOSED**.
 * Geçersiz zoom / sonlu olmayan koordinat → `null` (uydurma karo üretilmez).
 * Enlem Mercator tavanına kırpılır (kutuplar temsil edilemez, bu bir hata değil).
 */
export function toTile(lng: number, lat: number, z: number): TileCoord | null {
  if (!isValidZoom(z) || !_isFiniteNum(lng) || !_isFiniteNum(lat)) return null;
  const clampedLat = Math.max(-MERCATOR_LAT_LIMIT, Math.min(MERCATOR_LAT_LIMIT, lat));
  /* Boylam sarmalanır (±180 dışı geçerli bir girdidir, hata değil). */
  let wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180) wrapped = 180 - 1e-9;
  const { x, y } = lngLatToTileRawClamped(wrapped, clampedLat, z);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { z, x, y };
}

/**
 * Karonun kuzeybatı köşesinin coğrafi konumu. Geçersiz karo → `null`.
 * Kenar durumu: `x === n` / `y === n` da kabul edilir (sınır kutusu hesabı için).
 */
export function tileNorthWest(z: number, x: number, y: number): { lng: number; lat: number } | null {
  if (!isValidZoom(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  const n = 2 ** z;
  if (x < 0 || x > n || y < 0 || y > n) return null;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lng, lat: (latRad * 180) / Math.PI };
}

/** Karonun sınır kutusu `[batı, güney, doğu, kuzey]`. Geçersiz karo → `null`. */
export function tileBounds(t: TileCoord): LngLatBBox | null {
  if (!isValidTile(t)) return null;
  const nw = tileNorthWest(t.z, t.x, t.y);
  const se = tileNorthWest(t.z, t.x + 1, t.y + 1);
  if (nw === null || se === null) return null;
  return [nw.lng, se.lat, se.lng, nw.lat];
}

/** Kararlı metin anahtarı — önbellek/set anahtarı olarak kullanılır. */
export function tileKey(t: TileCoord): string {
  return `${t.z}/${t.x}/${t.y}`;
}

/** `tileKey` çıktısını geri çözer. Biçim/aralık dışı → `null`. */
export function parseTileKey(key: string): TileCoord | null {
  if (typeof key !== 'string') return null;
  const m = /^(\d{1,2})\/(\d{1,10})\/(\d{1,10})$/.exec(key);
  if (!m) return null;
  const t = { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
  return isValidTile(t) ? t : null;
}

/** Bir üst zoom seviyesindeki ata karo. `z === 0` veya geçersiz → `null`. */
export function parentTile(t: TileCoord): TileCoord | null {
  if (!isValidTile(t) || t.z === TILE_Z_MIN) return null;
  return { z: t.z - 1, x: Math.floor(t.x / 2), y: Math.floor(t.y / 2) };
}

/**
 * Bir sınır kutusunu kapsayan karolar (verilen zoom'da).
 * **FAIL-CLOSED ve SINIRLI:** geçersiz girdi → `[]`; sonuç
 * `TILE_BBOX_MAX_RESULTS` ile sınırlıdır (sınırsız kuyruk YASAK — v2 §8.4).
 */
export function tilesForBBox(bbox: LngLatBBox, z: number): TileCoord[] {
  if (!isValidZoom(z) || !Array.isArray(bbox) || bbox.length !== 4) return [];
  const [w, s, e, n] = bbox;
  if (!_isFiniteNum(w) || !_isFiniteNum(s) || !_isFiniteNum(e) || !_isFiniteNum(n)) return [];
  if (w > e || s > n) return [];

  const nw = toTile(w, n, z);
  const se = toTile(e, s, z);
  if (nw === null || se === null) return [];

  const out: TileCoord[] = [];
  for (let x = Math.min(nw.x, se.x); x <= Math.max(nw.x, se.x); x++) {
    for (let y = Math.min(nw.y, se.y); y <= Math.max(nw.y, se.y); y++) {
      if (out.length >= TILE_BBOX_MAX_RESULTS) return out;
      out.push({ z, x, y });
    }
  }
  return out;
}
