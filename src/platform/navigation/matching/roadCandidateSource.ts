/**
 * roadCandidateSource.ts — NAV v3 · L2 · YOL ADAYI ÜRETİMİ (L1 SINIRI · F2).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.3 · v2 §3.4 · F0 bağımlılık yasası.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── TEK KAPI ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * L2'nin yol ağı hakkında bilgi aldığı **TEK** yer burasıdır ve burası da
 * yalnız **L1 MapStore**'a sorar. Bu dosya:
 *   · raw graph binary OKUMAZ (`routing-graph.bin`),
 *   · tile store / Cache API'ye DOKUNMAZ,
 *   · MapLibre kaynağı KULLANMAZ,
 *   · routing worker internals'ına ERİŞMEZ,
 *   · Overpass/ağ çağrısı YAPMAZ.
 * (Kilit test bu beş yasağı kaynak taramasıyla denetler.)
 *
 * ── F4'TE AÇILDI (F1 borcu B2 kapandı) ───────────────────────────────────
 * F2'de bu kaynak üretimde daima `SOURCE_UNAVAILABLE` dönüyordu çünkü `RTG2`
 * okuyucusu worker'ın içindeydi. F4'te ayrıştırma kanonik okuyucuya taşındı
 * ve graf ana iş parçacığında çözülüyor → **aday akışı GERÇEKTEN üretiliyor.**
 *
 * Bu dosya hâlâ grafı GÖRMEZ: yalnız `MapStore.queryEdgesNear` cephesini
 * çağırır (ham `ArrayBuffer` · düğüm indeksi · okuyucu importu YOK — kilit
 * test denetler).
 *
 * ── ÜÇ HÂL KARIŞTIRILMAZ ─────────────────────────────────────────────────
 *   `UNAVAILABLE` kanıt → kaynak ölçülmedi/okunamadı  → `NOT_MEASURED`/`SOURCE_UNAVAILABLE`
 *   boş dizi            → ÖLÇÜLDÜ, yarıçapta yol YOK  → `NO_COVERAGE`
 *   dolu dizi           → aday var                    → `CANDIDATES`
 *
 * **En yakın yola zorla snap ETMEK YASAK:** yarıçap dışı kenar aday değildir
 * (kapı `edgeSpatialIndex` içinde yapısaldır) ve boş sonuç "yol dışısın"
 * hükmünü L2'ye bırakır.
 */

import type { EvidenceReason } from '../contracts/navEvidence';
import type { MonotonicMs } from '../contracts/navMonotonicTime';
import type { RoadCandidate, NetworkDistanceFn } from './hmmMatchModel';
import { HMM_MAX_CANDIDATES } from './hmmMatchModel';
import { getMapStore } from '../map/store';

/* ══════════════════════════════════════════════════════════════════════════
   1) SORGU SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

export type CandidateSourceOutcome =
  /** Aday üretildi. */
  | 'CANDIDATES'
  /** Kaynak sağlam ama bu konumda kapsam yok. */
  | 'NO_COVERAGE'
  /** Yol ağı veri kümesi kullanılamıyor (yok / okunamıyor). */
  | 'SOURCE_UNAVAILABLE'
  /** Veri kümesi ölçüldü ve BOZUK. */
  | 'SOURCE_INVALID'
  /** Veri kümesi hiç ÖLÇÜLMEDİ — "yok" DEĞİL. */
  | 'NOT_MEASURED';

export interface RoadCandidateQueryResult {
  readonly outcome: CandidateSourceOutcome;
  /** `outcome !== 'CANDIDATES'` iken DAİMA boş. */
  readonly candidates: readonly RoadCandidate[];
  readonly reason: EvidenceReason;
  /** Ağ mesafesi çözücüsü; topoloji bilinmiyorsa daima `null` döndürür. */
  readonly networkDistance: NetworkDistanceFn;
}

export interface RoadCandidateSource {
  query(
    lat: number, lon: number, radiusM: number, nowMonoMs: MonotonicMs,
  ): RoadCandidateQueryResult;
}

/** Topoloji bilinmiyor — geçiş terimi UYGULANMAZ (uydurma mesafe yok). */
export const UNKNOWN_NETWORK_DISTANCE: NetworkDistanceFn = () => null;

function _empty(outcome: CandidateSourceOutcome, reason: EvidenceReason): RoadCandidateQueryResult {
  return { outcome, candidates: [], reason, networkDistance: UNKNOWN_NETWORK_DISTANCE };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ARAMA YARIÇAPI — v2 §3.4
   ══════════════════════════════════════════════════════════════════════════ */

/** v2 §3.4: `r = min(200 m, 3σ_h + 25 m)`. */
export const CANDIDATE_RADIUS_MAX_M = 200;
export const CANDIDATE_RADIUS_BASE_M = 25;

export function candidateRadiusM(sigmaHorizontalM: number | null): number {
  const s = typeof sigmaHorizontalM === 'number' && Number.isFinite(sigmaHorizontalM) && sigmaHorizontalM >= 0
    ? sigmaHorizontalM
    : CANDIDATE_RADIUS_MAX_M;
  return Math.min(CANDIDATE_RADIUS_MAX_M, 3 * s + CANDIDATE_RADIUS_BASE_M);
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ÜRETİM KAYNAĞI — YALNIZ MapStore'a sorar
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * L1 üzerinden aday sorgusu. **Fail-closed:** veri kümesi ölçülmediyse,
 * yoksa veya bozuksa aday ÜRETİLMEZ ve gerekçe makine-okur döner.
 */
export const productionRoadCandidateSource: RoadCandidateSource = {
  query(lat, lon, radiusM, nowMonoMs): RoadCandidateQueryResult {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM) || radiusM <= 0) {
      return _empty('SOURCE_UNAVAILABLE', 'BELOW_QUALITY_GATE');
    }

    let ds;
    try {
      ds = getMapStore().getDatasetStatus('ROUTING_GRAPH', nowMonoMs);
    } catch {
      return _empty('SOURCE_UNAVAILABLE', 'PROVIDER_ERROR');
    }

    /* Ölçülmedi → "yol yok" DEMEK YASAK. */
    if (ds.value === null) return _empty('NOT_MEASURED', ds.reason ?? 'NO_SOURCE');
    if (ds.value.availability === 'INVALID') return _empty('SOURCE_INVALID', 'VERSION_MISMATCH');
    if (ds.value.availability === 'UNAVAILABLE') return _empty('SOURCE_UNAVAILABLE', 'NO_SOURCE');

    /* ── Yakınlık sorgusu — TEK L1 cephesi üzerinden ────────────────────── */
    let near;
    try {
      near = getMapStore().queryEdgesNear(lat, lon, radiusM, nowMonoMs);
    } catch {
      return _empty('SOURCE_UNAVAILABLE', 'PROVIDER_ERROR');
    }

    /* Graf ana iş parçacığında ÇÖZÜLMEMİŞ olabilir (talep-güdümlü sakinlik):
       bu "yol yok" DEĞİL, "ölçülmedi"dir. */
    if (near.value === null) {
      return _empty(
        near.reason === 'NO_SOURCE' ? 'NOT_MEASURED' : 'SOURCE_UNAVAILABLE',
        near.reason ?? 'NO_SOURCE',
      );
    }

    if (near.value.length === 0) {
      /* ÖLÇÜLDÜ ve bu yarıçapta yol YOK → kapsam hükmü (araç ağ dışında). */
      return _empty('NO_COVERAGE', 'COVERAGE_NONE');
    }

    const candidates: RoadCandidate[] = near.value.map((n) => ({
      edgeId: n.edgeId,
      snappedLat: n.snappedLat,
      snappedLon: n.snappedLon,
      perpDistM: n.perpDistM,
      bearingDeg: n.bearingDeg,
      alongEdgeM: n.alongEdgeM,
      metadata: n.metadata,
    }));

    return {
      outcome: 'CANDIDATES',
      candidates,
      reason: near.grade === 'STALE' ? 'STALE_TIMESTAMP' : 'LIVE_SOURCE',
      networkDistance: _networkDistanceVia(nowMonoMs),
    };
  },
};

/**
 * Ağ mesafesi çözücüsü — **L1'in kanıtına bağlıdır.**
 *
 * Topoloji kanıtlayamıyorsa `null` döner ve HMM geçiş terimini UYGULAMAZ
 * (`topologyEvidence: false`). Uydurma mesafe, yanlış kenara yüksek güven
 * demektir.
 */
function _networkDistanceVia(nowMonoMs: MonotonicMs): NetworkDistanceFn {
  return (from, to) => {
    try {
      return getMapStore().networkDistanceM(
        { edgeId: from.edgeId, alongEdgeM: from.alongEdgeM },
        { edgeId: to.edgeId, alongEdgeM: to.alongEdgeM },
        nowMonoMs,
      );
    } catch {
      return null;
    }
  };
}

/** Test/boot öncesi — hiçbir şey bilmeyen kaynak. */
export const UNAVAILABLE_ROAD_CANDIDATE_SOURCE: RoadCandidateSource = {
  query: () => _empty('NOT_MEASURED', 'NO_SOURCE'),
};

/**
 * Adayları dik mesafeye göre sıralar ve v2 §3.4 tavanına (`8`) kırpar.
 * **SAF** — enjekte edilmiş kaynaklarla test edilebilir olsun diye ayrı.
 */
export function rankCandidates(candidates: readonly RoadCandidate[]): readonly RoadCandidate[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  return [...candidates]
    .filter((c) => c && Number.isFinite(c.perpDistM) && c.perpDistM >= 0)
    .sort((a, b) => a.perpDistM - b.perpDistM)
    .slice(0, HMM_MAX_CANDIDATES);
}
