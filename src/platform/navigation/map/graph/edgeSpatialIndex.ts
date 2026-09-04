/**
 * edgeSpatialIndex.ts — NAV v3 · L1 · KENAR YAKINLIK İNDEKSİ (SAF · F4).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F4.6/F4.7.
 *
 * SAF: I/O YOK · timer YOK · React YOK · saat OKUMAZ · MODÜL DURUMU YOK
 * (indeks bir NESNEDİR; durum çağıranındır). Aynı girdi → aynı çıktı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN İNDEKS ──────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Aday üretimi GPS kadansında (≈1 Hz) koşar. 295 346 kenarın tamamına her
 * tik'te nokta-segment mesafesi hesaplamak düşük-uç head unit'te SICAK YOLU
 * bloklar (CLAUDE.md: ağır analiz hot-path'e GİRMEZ). Düzgün ızgara indeksi
 * sorguyu ~9 hücreye indirir: tipik 200 m yarıçapta onlarca kenar taranır,
 * yüz binlerce değil.
 *
 * ── GEOMETRİ GERÇEĞİ (§F4.7 — dürüstlük) ─────────────────────────────────
 * `RTG2` **ara poliline geometrisi TAŞIMAZ**: kenar, iki düğüm arasında DÜZ
 * bir segmenttir. Bu indeks de öyle davranır — kıvrımlı bir yolu poliline
 * varmış gibi modellemez. Ölçülen sonuç: `costM` (gerçek yol uzunluğu, seyreltme
 * ÖNCESİ toplanmış) düz segment uzunluğundan UZUN olabilir; ikisi karıştırılmaz
 * ve `alongEdgeM` düz segment üzerinden ölçüldüğü için `costM`'e ORANLANARAK
 * ölçeklenir (kenar başından yol-boyu mesafe sözleşmesi bozulmasın diye).
 *
 * ── GEODEZİ: İKİNCİ OTORİTE YOK ──────────────────────────────────────────
 * İzdüşüm ve mesafe `navigation/core/geo.ts` ile hesaplanır — deponun mevcut
 * ve rota eşleştirmesinde ZATEN kullanılan modeli. Ayrı bir geodezi kurmak
 * "aynı noktaya iki farklı mesafe" demektir.
 */

import type { RoutingGraphView } from './rtg2Reader';
import { hav, projectOnSegment, segmentBearingDeg } from '../../core/geo';

/* ══════════════════════════════════════════════════════════════════════════
   1) SABİTLER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Izgara hücre boyu (derece). 0,05° ≈ 5,5 km — 200 m yarıçaplı sorgu tek
 * hücre + komşuları ile karşılanır. Küçültmek hücre sayısını (belleği)
 * büyütür, büyütmek hücre başına taranan kenarı artırır.
 */
export const GRID_CELL_DEG = 0.05;

/** Bir sorgunun döndürebileceği en fazla kenar (üst sınır güvenliği). */
export const MAX_PROXIMITY_HITS = 64;

/** Enlem derecesi başına metre (küresel yaklaşım — `geo.ts` ile aynı R). */
const M_PER_DEG_LAT = 111_320;

/* ══════════════════════════════════════════════════════════════════════════
   2) YAPI
   ══════════════════════════════════════════════════════════════════════════ */

export interface EdgeSpatialIndex {
  readonly minLat: number;
  readonly minLon: number;
  readonly cellDeg: number;
  readonly rows: number;
  readonly cols: number;
  /** CSR: `offsets[c] .. offsets[c+1]` → hücre `c`'nin kenar aralığı. */
  readonly offsets: Uint32Array;
  readonly ordinals: Uint32Array;
  /** Sorgu içi tekrar-eleme damgası (mutasyon — durum çağıranındır). */
  readonly stamp: Uint32Array;
  /** Son sorgu damgası; her sorguda artar. */
  gen: number;
}

export interface EdgeProximityHit {
  readonly ordinal: number;
  /** Gözlemin kenara dik mesafesi (m). */
  readonly perpDistM: number;
  readonly snappedLat: number;
  readonly snappedLon: number;
  /** Kenarın BAŞINDAN (from düğümü) yol-boyu mesafe (m). */
  readonly alongEdgeM: number;
  /** Segmentin gidiş yönü (derece, 0 = Kuzey). `null` = ölçülemedi. */
  readonly bearingDeg: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KURUCU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kenarları düzgün ızgaraya yerleştirir. Bir kenar, sınır kutusunun DEĞDİĞİ
 * her hücreye yazılır (uzun kenar birden çok hücrede görünür) — aksi hâlde
 * hücre sınırına yakın araç, üstünde durduğu yolu bulamazdı.
 */
export function buildEdgeSpatialIndex(
  view: RoutingGraphView, cellDeg: number = GRID_CELL_DEG,
): EdgeSpatialIndex | null {
  if (!view || view.nodeCount === 0) return null;
  const cell = (typeof cellDeg === 'number' && Number.isFinite(cellDeg) && cellDeg > 0)
    ? cellDeg : GRID_CELL_DEG;

  /* ── Sınır kutusu (yalnız SONLU düğümlerden) ──────────────────────────── */
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (let i = 0; i < view.nodeCount; i++) {
    const la = view.nodeLat[i], lo = view.nodeLon[i];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;

  const rows = Math.max(1, Math.floor((maxLat - minLat) / cell) + 1);
  const cols = Math.max(1, Math.floor((maxLon - minLon) / cell) + 1);
  const cellCount = rows * cols;

  const index: EdgeSpatialIndex = {
    minLat, minLon, cellDeg: cell, rows, cols,
    offsets: new Uint32Array(cellCount + 1),
    ordinals: new Uint32Array(0),
    stamp: new Uint32Array(view.edgeCount),
    gen: 0,
  };

  /* ── 1) Hücre başına kenar sayımı ─────────────────────────────────────── */
  const counts = new Uint32Array(cellCount);
  let total = 0;
  const visit = (ordinal: number, fn: (cellIdx: number) => void): void => {
    const a = view.edgeFrom[ordinal], b = view.edgeTo[ordinal];
    const laA = view.nodeLat[a], loA = view.nodeLon[a];
    const laB = view.nodeLat[b], loB = view.nodeLon[b];
    if (!Number.isFinite(laA) || !Number.isFinite(loA)
      || !Number.isFinite(laB) || !Number.isFinite(loB)) return;
    /* Antimeridyen: düzlemsel kutu güvenli DEĞİL → kenar indekslenmez
       (yanlış hücre, yanlış yol demektir; fail-closed). */
    if (Math.abs(loB - loA) > 180) return;

    const r0 = Math.max(0, Math.floor((Math.min(laA, laB) - minLat) / cell));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(laA, laB) - minLat) / cell));
    const c0 = Math.max(0, Math.floor((Math.min(loA, loB) - minLon) / cell));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(loA, loB) - minLon) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) fn(r * cols + c);
    }
  };

  for (let i = 0; i < view.edgeCount; i++) {
    visit(i, (cellIdx) => { counts[cellIdx]++; total++; });
  }

  let acc = 0;
  for (let i = 0; i < cellCount; i++) {
    index.offsets[i] = acc;
    acc += counts[i];
  }
  index.offsets[cellCount] = acc;

  /* ── 2) Doldurma ──────────────────────────────────────────────────────── */
  const ordinals = new Uint32Array(total);
  const cursor = new Uint32Array(cellCount);
  for (let i = 0; i < view.edgeCount; i++) {
    visit(i, (cellIdx) => { ordinals[index.offsets[cellIdx] + cursor[cellIdx]++] = i; });
  }

  return { ...index, ordinals };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) SORGU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Verilen noktanın `radiusM` yarıçapındaki kenarlar — dik mesafeye göre
 * ARTAN sırada. Sonuç sayısı `maxResults` ile sınırlıdır.
 *
 * **FAIL-CLOSED:** geçersiz koordinat/yarıçap → boş liste. En yakın kenarı
 * "her hâlükârda" döndürmez — yarıçap dışı kenar aday DEĞİLDİR (zorla snap
 * yasağı yapısal olarak burada başlar).
 */
export function queryEdgesNear(
  view: RoutingGraphView,
  index: EdgeSpatialIndex,
  lat: number, lon: number, radiusM: number,
  maxResults: number = MAX_PROXIMITY_HITS,
): readonly EdgeProximityHit[] {
  if (!view || !index) return [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (!Number.isFinite(radiusM) || radiusM <= 0) return [];
  const cap = Number.isInteger(maxResults) && maxResults > 0
    ? Math.min(maxResults, MAX_PROXIMITY_HITS) : MAX_PROXIMITY_HITS;

  /* Yarıçapı dereceye çevir — boylamda enlem daralması hesaba katılır. */
  const dLat = radiusM / M_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = radiusM / (M_PER_DEG_LAT * cosLat);

  const r0 = Math.max(0, Math.floor((lat - dLat - index.minLat) / index.cellDeg));
  const r1 = Math.min(index.rows - 1, Math.floor((lat + dLat - index.minLat) / index.cellDeg));
  const c0 = Math.max(0, Math.floor((lon - dLon - index.minLon) / index.cellDeg));
  const c1 = Math.min(index.cols - 1, Math.floor((lon + dLon - index.minLon) / index.cellDeg));
  if (r1 < r0 || c1 < c0) return [];

  /* Damga tabanlı tekrar-eleme: aynı kenar birden çok hücrede olabilir. */
  const gen = index.gen + 1;
  index.gen = gen;

  const hits: EdgeProximityHit[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cellIdx = r * index.cols + c;
      const start = index.offsets[cellIdx];
      const end = index.offsets[cellIdx + 1];
      for (let k = start; k < end; k++) {
        const ord = index.ordinals[k];
        if (index.stamp[ord] === gen) continue;
        index.stamp[ord] = gen;

        const hit = projectOntoEdge(view, ord, lat, lon);
        if (hit === null || hit.perpDistM > radiusM) continue;
        hits.push(hit);
      }
    }
  }

  hits.sort((a, b) => a.perpDistM - b.perpDistM);
  return hits.length > cap ? hits.slice(0, cap) : hits;
}

/**
 * Noktayı tek bir kenara dik izdüşürür. **SAF** ve sınırlı: sonlu olmayan
 * koordinat, sıfır uzunluklu segment ve antimeridyen geçişi `null` döner
 * (NaN/taşma sessizce yayılmaz).
 */
export function projectOntoEdge(
  view: RoutingGraphView, ordinal: number, lat: number, lon: number,
): EdgeProximityHit | null {
  if (!view || !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= view.edgeCount) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const a = view.edgeFrom[ordinal];
  const b = view.edgeTo[ordinal];
  const laA = view.nodeLat[a], loA = view.nodeLon[a];
  const laB = view.nodeLat[b], loB = view.nodeLon[b];
  if (!Number.isFinite(laA) || !Number.isFinite(loA)
    || !Number.isFinite(laB) || !Number.isFinite(loB)) return null;
  if (Math.abs(loB - loA) > 180) return null;   // antimeridyen — fail-closed
  if (laA === laB && loA === loB) return null;  // sıfır uzunluk

  const t = projectOnSegment(lat, lon, laA, loA, laB, loB);
  const snappedLat = laA + t * (laB - laA);
  const snappedLon = loA + t * (loB - loA);
  const perpDistM = hav(lat, lon, snappedLat, snappedLon);
  if (!Number.isFinite(perpDistM)) return null;

  /* `alongEdgeM`: kenar BAŞINDAN yol-boyu mesafe. Düz segment üzerindeki
     oran (`t`), kenarın GERÇEK uzunluğuna (`costM`) ölçeklenir — kıvrımlı
     yolda düz segment kısa çıkar ve ölçeklemeden mesafe sistematik olarak
     eksik olurdu. `costM` yoksa düz segment uzunluğu kullanılır. */
  const straightM = hav(laA, loA, laB, loB);
  const realM = view.edgeCostM[ordinal];
  const lengthM = (Number.isFinite(realM) && realM > 0) ? realM : straightM;
  const alongEdgeM = Number.isFinite(lengthM) ? t * lengthM : 0;

  const bearing = segmentBearingDeg(laA, loA, laB, loB);

  return {
    ordinal,
    perpDistM,
    snappedLat,
    snappedLon,
    alongEdgeM,
    bearingDeg: Number.isFinite(bearing) ? bearing : null,
  };
}
