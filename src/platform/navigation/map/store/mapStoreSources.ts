/**
 * mapStoreSources.ts — NAV v3 · L1 · MEVCUT HARİTA KAYNAKLARININ OKUMA KATMANI (F1).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F1/2 · CLAUDE.md `<x>Sources.ts` deseni.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · SENKRON tek okuma. **Timer YOK · abonelik YOK · ağ çağrısı YOK ·
 *    scheduler YOK · React YOK.** Hiçbir kaynağı BAŞLATMAZ/TETİKLEMEZ.
 *  · Her getter kendi `try/catch`ini taşır — bir kaynak patlarsa MapStore
 *    çökmez, o veri kümesi `PROVIDER_ERROR` ile ölçülmemiş sayılır.
 *  · **Yeni harita otoritesi KURMAZ.** Var olanları OKUR:
 *      `navigation/offlineRoutingStatus` (graf yeteneği — mevcut otorite)
 *      `mapSourceStore` (karo kaynak durumu — mevcut zustand deposu)
 *
 * ── ÖLÇÜLMÜŞ İKİ DÜRÜSTLÜK NOKTASI (2026-09-03) ──────────────────────────
 *  ① `mapSourceStore.sources` ÜRETİMDE BOŞ OLABİLİR: `initializeMapSources()`
 *    üretim kodunda çağrılmıyor (`MapCore.ts:44` bunu açıkça yazıyor),
 *    `refreshMapSources()` yalnız Ayarlar'daki düğmeden koşuyor. Bu durumda
 *    `hasOfflineMapData()` `false` döner — ama bu **"yerel karo yok"
 *    DEĞİL, "hiç ölçülmedi"dir.** Bu katman ikisini AYIRIR (`available: null`).
 *  ② **F2.0'da KAPATILDI (eski F1 borcu B4):** `offlineRoutingStatus` artık
 *    duvar saatinin YANINDA `lastAttemptAtMonoMs` (monotonik) taşıyor ve bu
 *    katman tazelik damgası olarak YALNIZ onu kullanıyor. Duvar saati
 *    (`lastAttemptAt`) yaş hesabına HÂLÂ sokulmaz. Tazelik BÜTÇESİ hâlâ
 *    `null`'dır: graf yeteneği KALICI durumlar üzerinden yürür
 *    (`GRAPH_MISSING`/`GRAPH_CORRUPT`/`WORKER_UNSUPPORTED` tekrar denenmez),
 *    dolayısıyla repoda TANIMLI bir TTL yoktur ve uydurulmaz (açık borç B6).
 *
 * ── BU FAZDA ÖLÇÜLEMEYEN ─────────────────────────────────────────────────
 *  · `POI_DB` — `offlinePoiService` bir yetenek/durum otoritesi YAYINLAMIYOR
 *    (başarısızlıkta sessizce `[]` döner). Uydurma "var/yok" ÜRETİLMEZ.
 *  · ~~Kenar metadatası~~ — **F4'te AÇILDI:** `RTG2` okuyucusu artık kanonik
 *    (`map/graph/rtg2Reader`) ve graf ana iş parçacığında çözülüyor
 *    (`graphResidencyRuntime`). Bu katman yine hiçbir şey BAŞLATMAZ; yalnız
 *    çözülmüş görünüm VARSA okur. Çözülmemişse `null` (fail-closed).
 */

import type {
  MapDataPorts, MapDatasetId, MapDatasetObservation, StaticEdgeMetadata,
  EdgeTopology, NearbyEdge, EdgePosition, RoadCorridor, CorridorEdge,
} from './mapStore';
import { UNMEASURED_DATASET } from './mapStore';
import { corridorLimits, expandBoundedCorridor } from '../graph/boundedCorridor';
import type { EdgeId } from '../../contracts/navEdgeId';
import { isLegacyMonolithEdgeId, toCanonicalEdgeId, toLegacyEdgeRef } from './legacyEdgeIdAdapter';
import { edgeIsOneway, edgeRoadClass } from '../graph/rtg2Reader';
import { edgeEndpoints, isDirectlyConnected, outgoingRange } from '../graph/graphAdjacency';
import { queryEdgesNear } from '../graph/edgeSpatialIndex';
import {
  readEdgeSpatialIndex, readGraphAdjacency, readReverseAdjacency, readRoutingGraphView,
} from '../graph/graphResidencyRuntime';
import type { TileCoord } from './tileGrid';
import { isValidTile } from './tileGrid';
import type { MapSourceMask } from './mapProvenance';
import { MAP_SRC, MAP_SRC_NONE, addSource } from './mapProvenance';
import type { MonotonicMs } from '../../contracts/navMonotonicTime';
import { asMonotonic } from '../../contracts/navMonotonicTime';
import { getOfflineRoutingStatus } from '../../offlineRoutingStatus';
import { useMapSourceStore } from '../../../mapSourceStore';

/**
 * Monotonik damgayı `MonotonicMs` markasına çevirir. Geçersiz/eksik damga →
 * `null` (bayatlık HESAPLANMAZ — uydurma yaş yerine yokluk beyanı).
 */
function _mono(v: number | null | undefined): MonotonicMs | null {
  return (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? asMonotonic(v) : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   1) ROUTING GRAPH — mevcut `offlineRoutingStatus` otoritesinden
   ══════════════════════════════════════════════════════════════════════════ */

function _readRoutingGraph(): MapDatasetObservation {
  try {
    const s = getOfflineRoutingStatus();

    /* Hiç denenmedi → hüküm YOK. */
    if (s.state === 'UNKNOWN') return UNMEASURED_DATASET;

    if (s.state === 'AVAILABLE') {
      return {
        available: true,
        invalid: false,
        provenance: addSource(MAP_SRC_NONE, MAP_SRC.PACKAGED_GRAPH),
        reason: 'LIVE_SOURCE',
        /* F2.0: MONOTONİK damga (duvar saati DEĞİL — yukarı ② notu). */
        observedAtMonoMs: _mono(s.lastAttemptAtMonoMs),
        freshnessBudgetMs: null,
      };
    }

    if (s.state === 'GRAPH_CORRUPT') {
      return {
        available: false,
        invalid: true,
        provenance: addSource(MAP_SRC_NONE, MAP_SRC.PACKAGED_GRAPH),
        reason: 'VERSION_MISMATCH',
        observedAtMonoMs: _mono(s.lastAttemptAtMonoMs),
        freshnessBudgetMs: null,
      };
    }

    if (s.state === 'GRAPH_MISSING') {
      return {
        available: false,
        invalid: false,
        /* Yokluk da bir ölçümdür ve kaynağı bellidir: paketlenmiş graf yolu. */
        provenance: addSource(MAP_SRC_NONE, MAP_SRC.PACKAGED_GRAPH),
        reason: 'NO_SOURCE',
        observedAtMonoMs: _mono(s.lastAttemptAtMonoMs),
        freshnessBudgetMs: null,
      };
    }

    /* WORKER_UNSUPPORTED: veri VAR olabilir ama OKUYUCU çalışmıyor →
       veri kümesi hakkında hüküm VERİLEMEZ (yokluk iddia edilmez). */
    return { ...UNMEASURED_DATASET, reason: 'PROVIDER_ERROR' };
  } catch {
    return { ...UNMEASURED_DATASET, reason: 'PROVIDER_ERROR' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   2) TILES — mevcut `mapSourceStore` deposundan
   ══════════════════════════════════════════════════════════════════════════ */

function _readTiles(): MapDatasetObservation {
  try {
    const st = useMapSourceStore.getState();
    const sources = st?.sources;

    /* Depo hiç doldurulmadıysa "karo yok" DEMEK YASAK — ölçülmedi. */
    if (!sources || typeof sources.size !== 'number' || sources.size === 0) {
      return { ...UNMEASURED_DATASET, reason: 'NO_SOURCE' };
    }

    let provenance: MapSourceMask = MAP_SRC_NONE;
    const local = sources.get('local')?.isAvailable === true;
    const cached = sources.get('cached')?.isAvailable === true;
    const online = sources.get('online')?.isAvailable === true;

    if (local) provenance = addSource(provenance, MAP_SRC.PACKAGED_TILES);
    if (cached) provenance = addSource(provenance, MAP_SRC.DEVICE_CACHE);
    if (online) provenance = addSource(provenance, MAP_SRC.ONLINE_TILES);

    const available = local || cached || online;
    if (!available) {
      return {
        available: false,
        invalid: false,
        /* Hangi kaynakların DENENDİĞİ bilinir: depo dolu ama hiçbiri hazır değil. */
        provenance: addSource(MAP_SRC_NONE, MAP_SRC.PACKAGED_TILES),
        reason: 'NO_SOURCE',
        observedAtMonoMs: null,
        freshnessBudgetMs: null,
      };
    }

    return {
      available: true,
      invalid: false,
      provenance,
      reason: 'LIVE_SOURCE',
      /* Depoda monotonik gözlem damgası YOK → bayatlık hesaplanmaz.
         (Açık borç: karo kaynak tazeliği için repoda TANIMLI eşik yok.) */
      observedAtMonoMs: null,
      freshnessBudgetMs: null,
    };
  } catch {
    return { ...UNMEASURED_DATASET, reason: 'PROVIDER_ERROR' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KARO VARLIĞI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tek bir karonun varlığı. Bugün cihazda **karo-başına envanter YOK**
 * (`mapTileProbe` yalnız birkaç örnek karoyu yoklar, tam envanter çıkarmaz).
 * Uydurma "var" üretmemek için daima `null` (bilinmiyor) döner.
 *
 * Bu bir eksiklik değil bir DÜRÜSTLÜK sınırıdır: karo envanteri F3'te
 * (karolu paket + manifest) gelir.
 */
function _readTilePresence(tile: TileCoord): boolean | null {
  if (!isValidTile(tile)) return null;
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KENAR GERÇEĞİ — F4'te AÇILDI (F1 borcu B2 kapandı)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ── ÖNCE NE VARDI ────────────────────────────────────────────────────────
 * `RTG2` okuyucusu `NavigationCompute.worker.ts:_loadGraph()` İÇİNDEYDİ; ana
 * iş parçacığı grafı okuyamıyordu → `readEdgeMetadata` daima `null` dönüyordu
 * ve zincirin tamamı (aday → HMM → `MatchedRoadPose` → CEH fiziksel doğrulama)
 * ÜRETİMDE ÖLÜYDÜ.
 *
 * ── ŞİMDİ ────────────────────────────────────────────────────────────────
 * Ayrıştırma tek kanonik okuyucuda (`map/graph/rtg2Reader`), grafın ana iş
 * parçacığındaki sakinliği `graphResidencyRuntime`da. Bu katman **hiçbir şey
 * BAŞLATMAZ**: yalnız çözülmüş görünüm VARSA okur (`<x>Sources.ts` sözleşmesi
 * bozulmadı — `fetch` burada YOK).
 *
 * ── UYDURMA ALAN YOK (§F4.4) ─────────────────────────────────────────────
 * `RTG2` yalnız `costM` · `oneway` · `roadClass` taşır. Hız limiti, yol adı,
 * şerit sayısı, eğim ve viraj yarıçapı bu binary'de YOKTUR ve bu katman
 * onları ÜRETMEZ. `roadClass = 0` bir sınıf DEĞİL, "BİLİNMİYOR"dur ve öyle
 * taşınır (tüketici 0'dan hız/limit türetemez).
 */

/** Kanonik kimlikten graf sıra numarası + yön. Yabancı ad alanı → `null`. */
function _legacyRef(edgeId: EdgeId): { ordinal: number; dir: 0 | 1 } | null {
  try {
    if (!isLegacyMonolithEdgeId(edgeId)) return null;   // karolu kimlik → reddet
    const ref = toLegacyEdgeRef(edgeId);
    return { ordinal: ref.edgeOrdinal, dir: ref.dir };
  } catch {
    return null;
  }
}

/** Sıra numarasından kanonik kimlik. Kapasite dışı → `null` (sessiz kırpma YOK). */
function _edgeId(ordinal: number, dir: 0 | 1): EdgeId | null {
  try {
    return toCanonicalEdgeId(ordinal, dir);
  } catch {
    return null;
  }
}

function _readEdgeMetadata(edgeId: EdgeId): StaticEdgeMetadata | null {
  try {
    const view = readRoutingGraphView();
    if (view === null) return null;                      // graf çözülmemiş → ölçüm YOK
    const ref = _legacyRef(edgeId);
    if (ref === null || ref.ordinal >= view.edgeCount) return null;

    const lengthM = view.edgeCostM[ref.ordinal];
    if (!Number.isFinite(lengthM)) return null;

    return {
      lengthM,
      oneway: edgeIsOneway(view, ref.ordinal),
      /* 0 = BİLİNMİYOR — varsayılan sınıf UYDURULMAZ (§F4.4). */
      roadClass: edgeRoadClass(view, ref.ordinal),
    };
  } catch {
    return null;
  }
}

function _readEdgeTopology(edgeId: EdgeId): EdgeTopology | null {
  try {
    const view = readRoutingGraphView();
    if (view === null) return null;
    const ref = _legacyRef(edgeId);
    if (ref === null || ref.ordinal >= view.edgeCount) return null;

    const ends = edgeEndpoints(view, ref.ordinal, ref.dir);
    if (ends === null) return null;

    const oneway = edgeIsOneway(view, ref.ordinal);
    /* Tek yönlü kenarın GERİ kolu diye bir şey yoktur — yasak yön üzerinden
       komşuluk iddia etmek, sürücüyü ters yola sokmaktır. */
    if (oneway && ref.dir === 1) return null;

    const outgoing: EdgeId[] = [];
    const incoming: EdgeId[] = [];

    const fwd = readGraphAdjacency();
    if (fwd !== null) {
      const r = outgoingRange(fwd, ends.toNode);
      for (let k = r.start; k < r.end; k++) {
        const ord = fwd.edgeOrdinal[k];
        /* Aynı kenarın kendisi komşusu SAYILMAZ (U dönüşü ayrı bir gerçektir
           ve ufuk kolu olarak üretmek sahte dallanma yaratırdı). */
        if (ord === ref.ordinal) continue;
        const id = _edgeId(ord, fwd.dir[k] as 0 | 1);
        if (id !== null) outgoing.push(id);
      }
    }

    const rev = readReverseAdjacency();
    if (rev !== null) {
      const r = outgoingRange(rev, ends.fromNode);
      for (let k = r.start; k < r.end; k++) {
        const ord = rev.edgeOrdinal[k];
        if (ord === ref.ordinal) continue;
        const id = _edgeId(ord, rev.dir[k] as 0 | 1);
        if (id !== null) incoming.push(id);
      }
    }

    const lengthM = view.edgeCostM[ref.ordinal];

    return {
      edgeId,
      outgoing,
      incoming,
      oneway,
      lengthM: Number.isFinite(lengthM) ? lengthM : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Yakınlıktaki kenarlar.
 *
 * **ÇİFT YÖNLÜ KENAR İKİ ADAY ÜRETİR** (`dir 0` ve `dir 1`): araç yolu hangi
 * yönde kat ediyor sorusunun cevabı yön kanıtıdır ve "paralel yol / ters
 * şerit" ayrımının TEK dayanağı segment yönüdür (`core/geo.ts`). Tek yönlü
 * kenar yalnız ileri kolu üretir.
 *
 * `null` = graf ana iş parçacığında ÇÖZÜLMEMİŞ (ölçülmedi).
 * `[]`   = ÖLÇÜLDÜ ve bu yarıçapta yol YOK. İkisi KARIŞTIRILMAZ.
 */
function _readEdgesNear(lat: number, lon: number, radiusM: number): readonly NearbyEdge[] | null {
  try {
    const view = readRoutingGraphView();
    if (view === null) return null;
    const index = readEdgeSpatialIndex();
    if (index === null) return null;

    const hits = queryEdgesNear(view, index, lat, lon, radiusM);
    const out: NearbyEdge[] = [];

    for (const h of hits) {
      const lengthM = view.edgeCostM[h.ordinal];
      const oneway = edgeIsOneway(view, h.ordinal);
      const metadata: StaticEdgeMetadata | null = Number.isFinite(lengthM)
        ? { lengthM, oneway, roadClass: edgeRoadClass(view, h.ordinal) }
        : null;

      const fwdId = _edgeId(h.ordinal, 0);
      if (fwdId !== null) {
        out.push({
          edgeId: fwdId,
          perpDistM: h.perpDistM,
          snappedLat: h.snappedLat,
          snappedLon: h.snappedLon,
          alongEdgeM: h.alongEdgeM,
          bearingDeg: h.bearingDeg,
          metadata,
        });
      }

      if (!oneway) {
        const revId = _edgeId(h.ordinal, 1);
        if (revId !== null) {
          const len = Number.isFinite(lengthM) ? lengthM : 0;
          out.push({
            edgeId: revId,
            perpDistM: h.perpDistM,
            snappedLat: h.snappedLat,
            snappedLon: h.snappedLon,
            /* Geri kolda mesafe TERS uçtan ölçülür. */
            alongEdgeM: Math.max(0, len - h.alongEdgeM),
            bearingDeg: h.bearingDeg === null ? null : (h.bearingDeg + 180) % 360,
            metadata,
          });
        }
      }
    }

    return out;
  } catch {
    return null;
  }
}

/**
 * İki ağ konumu arası yol-boyu mesafe.
 *
 * **YALNIZ KANITLI iki hâl:**
 *   ① aynı kenar → `|Δ alongEdgeM|`
 *   ② `from`un bitişi `to`nun başına DOĞRUDAN bağlı → kalan + ilerlenen
 * Diğer her durumda `null` — çok adımlı graf araması ufuk tik'inde
 * KOŞULMAZ (hot-path bütçesi) ve uydurma mesafe YASAKTIR.
 */
function _readNetworkDistanceM(from: EdgePosition, to: EdgePosition): number | null {
  try {
    const view = readRoutingGraphView();
    if (view === null) return null;
    const a = _legacyRef(from?.edgeId);
    const b = _legacyRef(to?.edgeId);
    if (a === null || b === null) return null;
    if (a.ordinal >= view.edgeCount || b.ordinal >= view.edgeCount) return null;

    const fromAlong = from.alongEdgeM;
    const toAlong = to.alongEdgeM;
    if (!Number.isFinite(fromAlong) || !Number.isFinite(toAlong)) return null;

    if (a.ordinal === b.ordinal && a.dir === b.dir) {
      return Math.abs(toAlong - fromAlong);
    }

    const adj = readGraphAdjacency();
    if (adj === null) return null;
    if (!isDirectlyConnected(view, adj, a.ordinal, a.dir, b.ordinal, b.dir)) return null;

    const lenA = view.edgeCostM[a.ordinal];
    if (!Number.isFinite(lenA)) return null;
    const remaining = Math.max(0, lenA - fromAlong);
    return remaining + Math.max(0, toAlong);
  } catch {
    return null;
  }
}

/**
 * Sınırlı koridor genişlemesi (F6).
 *
 * Gezinme SAF çekirdekte (`map/graph/boundedCorridor`) yapılır; bu katman
 * yalnız ① graf görünümünü ve komşuluğu okur, ② kimliği kanonikleştirir.
 * **Ham sıra numarası bu fonksiyonun dışına ÇIKMAZ** (F4 K6 kilidi).
 *
 * `null` = graf/komşuluk ana iş parçacığında ÇÖZÜLMEMİŞ (ölçülmedi) —
 * "ileride yol yok" DEĞİL.
 */
function _expandCorridor(start: EdgePosition, budgetM: number): RoadCorridor | null {
  try {
    const view = readRoutingGraphView();
    if (view === null) return null;
    const adj = readGraphAdjacency();
    if (adj === null) return null;

    const ref = _legacyRef(start?.edgeId);
    if (ref === null || ref.ordinal >= view.edgeCount) return null;

    const limits = corridorLimits(budgetM);
    const raw = expandBoundedCorridor(
      view, adj, ref.ordinal, ref.dir, start.alongEdgeM, limits,
    );

    const edges: CorridorEdge[] = [];
    for (const e of raw.edges) {
      const id = _edgeId(e.ordinal, e.dir);
      /* Kimlik uzayına sığmayan kenar SESSİZCE kırpılmaz: koridora GİRMEZ ve
         bu, kapsamın eksik kaldığı anlamına gelir (fail-closed). */
      if (id === null) continue;
      edges.push({
        edgeId: id,
        entryDistanceM: e.entryDistanceM,
        lengthM: e.lengthM,
        depth: e.depth,
      });
    }

    return {
      outcome: raw.outcome,
      startEdgeId: start.edgeId,
      budgetM: limits.budgetM,
      coveredM: raw.coveredM,
      edges,
      nodeExpansions: raw.nodeExpansions,
      branchCount: raw.branchCount,
      /* Kimlik çevirisinde kenar düştüyse koridor da KESİLMİŞ sayılır. */
      truncated: raw.truncated || edges.length !== raw.edges.length,
    };
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5) PORT KÜMESİ
   ══════════════════════════════════════════════════════════════════════════ */

export const productionMapDataPorts: MapDataPorts = {
  readDataset(dataset: MapDatasetId): MapDatasetObservation {
    switch (dataset) {
      case 'ROUTING_GRAPH': return _readRoutingGraph();
      case 'TILES':         return _readTiles();
      /* POI: yetenek/durum otoritesi yok → uydurma üretilmez. */
      case 'POI_DB':        return { ...UNMEASURED_DATASET, reason: 'NO_SOURCE' };
      default:              return UNMEASURED_DATASET;
    }
  },
  readTilePresence: _readTilePresence,
  readEdgeMetadata: _readEdgeMetadata,
  readEdgeTopology: _readEdgeTopology,
  readEdgesNear: _readEdgesNear,
  readNetworkDistanceM: _readNetworkDistanceM,
  expandCorridor: _expandCorridor,
};
