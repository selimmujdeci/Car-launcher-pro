/**
 * horizonModel.ts — NAV v3 · L3 · CEH ÇEKİRDEĞİ (SAF · F3).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.3/F3.4/F3.9.
 *
 * SAF: I/O YOK · timer YOK · scheduler YOK · React YOK · native YOK ·
 * `Date.now`/`performance.now` YOK · modül durumu YOK · L4 importu YOK.
 * "Şu an", ego, eşleşme ve rota niyeti DIŞARIDAN gelir → testler
 * deterministiktir (aynı girdi = aynı çıktı, kilit test).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÜÇ KARAR, ÜÇ AYRI KANIT ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *  1. **Ufuk çapası** — ham ego pozu (L2). Yoksa/bayatsa ufuk YOK.
 *  2. **Fiziksel yol** — `MatchedRoadPose` (L2). Üretimde bugün YOKTUR
 *     (F1/B2: `RTG2` okuyucusu worker içinde) → kol fiziksel doğrulanamaz.
 *  3. **Rota niyeti** — L4'ten İTİLEN salt-okunur projeksiyon. Bir NİYETTİR;
 *     tek başına "araç bu yolda" DEMEK DEĞİLDİR.
 *
 * ── ZORLA MPP YASAK ──────────────────────────────────────────────────────
 * Fiziksel eşleşme ile rota niyeti ÇELİŞİYORSA (araç rotadan
 * `routeConflictThresholdM` kadar uzakta bir kenara oturmuşsa) tek kola
 * indirgeme YAPILMAZ: iki kol da korunur, `mppPathId = null`, durum
 * `AMBIGUOUS_PATH`. Bu, kavşakta ve paralel yolda yanlış uyarının tek
 * yapısal panzehiridir.
 *
 * ── DEGRADATION ≠ FABRICATION ────────────────────────────────────────────
 * Bir kaynağın yokluğu ufku tamamen öldürmez: ego varken eşleşme yoksa ham
 * ego korunur ama KESİN yol ufku İDDİA EDİLMEZ (`MATCH_UNAVAILABLE`).
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';
import { isMonoStale } from '../contracts/navMonotonicTime';
import type { Evidenced } from '../contracts/navEvidence';
import { derivedNav, unavailableNav } from '../contracts/navEvidence';
import type { MatchedRoadPose, RealtimeEgoPose } from '../contracts/navEgoPose';
import type {
  CehHorizonState, ElectronicHorizon, HorizonObject, HorizonPath, HorizonPathId,
  HorizonPathProvenance,
} from '../contracts/navHorizon';
import {
  MPP_PATH_ID, degradationForHorizonState, horizonBudgetM,
} from '../contracts/navHorizon';
import type { RouteIntentSnapshot } from './routeIntent';
import { routeIntentCarriesDistance } from './routeIntent';
import type { HorizonAttributePorts, HorizonAttributeOutcome } from './horizonAttributePorts';
import { UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS } from './horizonAttributePorts';
import { pointToSegmentDist } from '../core/geo';

/* ══════════════════════════════════════════════════════════════════════════
   1) POLİTİKA SAYILARI — ölçülmüş kalibrasyon DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ Fiziksel doğrulaması OLMAYAN (yalnız rota niyetinden gelen) bir kolun
 * güveni bu tavanı AŞAMAZ. Gerekçe: niyet bir gözlem değildir; paralel yolda
 * rota aynen "doğru" görünür. Sayı sahadan ölçülmemiştir — kütük maddesidir.
 */
export const ROUTE_INTENT_CONFIDENCE_CEIL = 0.6;

/** Kolun MPP sayılabilmesi için gereken en düşük güven (politika). */
export const MPP_MIN_CONFIDENCE = 0.2;

export const BRANCH_ROUTE_PATH_ID: HorizonPathId = 'BRANCH_ROUTE_INTENT';
export const BRANCH_MATCHED_PATH_ID: HorizonPathId = 'BRANCH_MATCHED_ROAD';

/* ══════════════════════════════════════════════════════════════════════════
   2) GİRDİ
   ══════════════════════════════════════════════════════════════════════════ */

export interface HorizonBuildInput {
  readonly nowMonoMs: MonotonicMs;
  /** Bu ufkun üretim kimliği — çağıran MONOTONİK artırır. */
  readonly generation: number;
  readonly ego: RealtimeEgoPose | null;
  readonly matched: MatchedRoadPose | null;
  readonly route: RouteIntentSnapshot;
  /**
   * L1 yol ağı veri kümesi hükmü: `true` = var · `false` = yok ·
   * **`null` = ÖLÇÜLMEDİ** ("yok" DEĞİL).
   */
  readonly mapAvailable: boolean | null;
  readonly attributes: HorizonAttributePorts;
  /** Ego tazelik bütçesi (ms). `null` → bayatlık HESAPLANMAZ. */
  readonly egoFreshnessBudgetMs: number | null;
  /**
   * Rota ile fiziksel eşleşmenin çelişkili sayıldığı dik mesafe (m).
   * L4'ün KENDİ sapma eşiğidir ve dışarıdan verilir (L3 kendi eşiğini
   * icat ETMEZ). `null` → çelişki kontrolü YAPILMAZ → doğrulama da YOK.
   */
  readonly routeConflictThresholdM: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) YARDIMCILAR (saf)
   ══════════════════════════════════════════════════════════════════════════ */

function _conf(ev: Evidenced<number> | null | undefined): number {
  if (!ev || ev.value === null) return 0;
  const c = ev.confidence;
  return typeof c === 'number' && Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
}

function _num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Eşleşmiş konumun rota çizgisine EN KISA dik mesafesi (m).
 * `null` = hesaplanamadı (geometri yok/bozuk veya eşleşmiş konum yok).
 */
export function matchedDistanceToRouteM(
  matched: MatchedRoadPose | null,
  geometry: readonly (readonly [number, number])[] | null,
): number | null {
  if (!matched || matched.matchState !== 'MATCHED') return null;
  const lat = _num(matched.snappedLat.value);
  const lon = _num(matched.snappedLon.value);
  if (lat === null || lon === null) return null;
  if (!Array.isArray(geometry) || geometry.length < 2) return null;

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < geometry.length - 1; i++) {
    const a = geometry[i];
    const b = geometry[i + 1];
    if (!a || !b) continue;
    const d = pointToSegmentDist(lat, lon, a[1], a[0], b[1], b[0]);
    if (Number.isFinite(d) && d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * Rota niyetinden manevra ufuk nesneleri. Yalnız ÖNDE olan ve bütçe içindeki
 * manevralar taşınır; çapası çözülmemiş manevra ATLANIR (uydurma mesafe yok).
 */
export function maneuverObjects(
  route: RouteIntentSnapshot,
  pathId: HorizonPathId,
  budgetM: number,
  nowMonoMs: MonotonicMs,
  confidence: number,
): readonly HorizonObject[] {
  if (!routeIntentCarriesDistance(route)) return [];
  const vehicleRemaining = route.vehicleAlongRemainingM as number;
  const out: HorizonObject[] = [];

  for (const m of route.maneuvers) {
    const rem = _num(m?.alongRemainingM);
    if (rem === null) continue;                    // çapa çözülemedi → ATLA
    const dist = vehicleRemaining - rem;
    if (!Number.isFinite(dist) || dist <= 0) continue;  // geride kalmış manevra
    if (dist > budgetM) continue;                  // ufuk bütçesi dışında

    const type = typeof m.maneuverType === 'string' && m.maneuverType.length > 0
      ? m.maneuverType : 'unknown';
    const mod = typeof m.maneuverModifier === 'string' && m.maneuverModifier.length > 0
      ? m.maneuverModifier : 'unknown';

    out.push({
      kind: 'MANEUVER',
      id: `mnv:${route.routeRevision}:${m.stepIndex}`,
      pathId,
      distanceFromEgoM: derivedNav<number>(dist, {
        source: 'ROUTE_PROVIDER',
        confidence,
        observedAtMonoMs: route.observedAtMonoMs ?? nowMonoMs,
        freshnessBudgetMs: null,
      }),
      label: derivedNav<string>(`${type}:${mod}`, {
        source: 'ROUTE_PROVIDER',
        confidence,
        observedAtMonoMs: route.observedAtMonoMs ?? nowMonoMs,
        freshnessBudgetMs: null,
      }),
      /* Manevranın SAYISAL büyüklüğü yoktur — sıfır DEĞİL, yokluk beyanı. */
      magnitude: unavailableNav<number>('ROUTE_PROVIDER', 'NO_SOURCE'),
      /* Manevra rota niyetinden gelir, kenara OTURMAZ — F6 alanı boş kalır. */
      edgeId: null,
    });
  }

  out.sort((a, b) => (a.distanceFromEgoM.value ?? 0) - (b.distanceFromEgoM.value ?? 0));
  return out;
}

function _emptyHorizon(
  input: HorizonBuildInput,
  state: CehHorizonState,
  reason: ElectronicHorizon['reason'],
): ElectronicHorizon {
  return {
    kind: 'ELECTRONIC_HORIZON',
    generation: input.generation,
    tsMonoMs: input.nowMonoMs,
    state,
    reason,
    egoAnchor: state === 'EGO_UNAVAILABLE' ? null : input.ego,
    matchedAnchor: null,
    paths: [],
    mppPathId: null,
    ambiguous: false,
    degradation: degradationForHorizonState(state),
    budgetM: horizonBudgetM(input.ego?.speedMps?.value ?? null),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) MOTOR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tek bir ufuk üretir. **Saf** — aynı girdi daima aynı çıktıyı verir.
 */
export function buildHorizon(input: HorizonBuildInput): ElectronicHorizon {
  const ports = input.attributes ?? UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS;
  const now = input.nowMonoMs;
  const ego = input.ego;

  /* ── 1) EGO KAPISI ──────────────────────────────────────────────────── */
  if (ego === null || ego === undefined) {
    return _emptyHorizon(input, 'EGO_UNAVAILABLE', 'NO_SOURCE');
  }
  if (ego.mode === 'NONE' || ego.mode === 'LAST_KNOWN') {
    /* Canlı kaynak yok → ufkun çapası yok. Son bilinen konum ufuk ÇAPASI
       OLAMAZ (bayat konumdan taze ufuk üretmek yalan söylemektir). */
    return _emptyHorizon(input, 'EGO_UNAVAILABLE', 'BELOW_QUALITY_GATE');
  }
  if (isMonoStale(ego.tsMonoMs, now, input.egoFreshnessBudgetMs)) {
    return _emptyHorizon(input, 'EGO_STALE', 'STALE_TIMESTAMP');
  }

  const budgetM = horizonBudgetM(ego.speedMps?.value ?? null);
  const egoConf = _conf(ego.lat);

  /* ── 2) KAYNAKLAR ───────────────────────────────────────────────────── */
  const matched = input.matched;
  const hasPhysicalMatch = !!matched
    && matched.matchState === 'MATCHED'
    && matched.edgeId !== null;
  const hasRoute = routeIntentCarriesDistance(input.route);

  /* ── 3) ÇELİŞKİ: NİYET ↔ FİZİKSEL GERÇEK ────────────────────────────── */
  let conflict = false;
  let confirmed = false;
  if (hasPhysicalMatch && hasRoute) {
    const thr = _num(input.routeConflictThresholdM);
    const d = matchedDistanceToRouteM(matched, input.route.geometry);
    if (thr !== null && d !== null) {
      conflict = d > thr;
      confirmed = !conflict;
    }
    /* Eşik veya geometri yoksa: ne doğrulanır ne çelişir (fail-closed). */
  }

  /* ── 4) KOLLAR ──────────────────────────────────────────────────────── */
  const paths: HorizonPath[] = [];
  let state: CehHorizonState;
  let mppPathId: HorizonPathId | null = null;
  let ambiguous = false;
  let attrOutcome: HorizonAttributeOutcome = 'NOT_MEASURED';

  /**
   * Öznitelik sorgusunun FİZİKSEL çapası (F6). Yalnız gerçek eşleşme varken
   * doludur; eşleşme yoksa üç alan da `null` kalır ve port koridor kuramaz —
   * uydurma çapa, uydurma mesafe demektir.
   */
  const anchorAlongM = hasPhysicalMatch ? _num(matched!.alongEdgeM.value) : null;
  const anchorLat = hasPhysicalMatch ? _num(matched!.snappedLat.value) : null;
  const anchorLon = hasPhysicalMatch ? _num(matched!.snappedLon.value) : null;

  const readAttrs = (
    pathId: HorizonPathId, provenance: HorizonPathProvenance,
  ): readonly HorizonObject[] => {
    try {
      const r = ports.readAhead({
        pathId,
        provenance,
        startEdgeId: hasPhysicalMatch ? matched!.edgeId : null,
        startAlongEdgeM: anchorAlongM,
        anchorLat,
        anchorLon,
        budgetM,
        nowMonoMs: now,
      });
      attrOutcome = r?.outcome ?? 'SOURCE_UNAVAILABLE';
      return r?.outcome === 'OBJECTS' && Array.isArray(r.objects) ? r.objects : [];
    } catch {
      attrOutcome = 'SOURCE_UNAVAILABLE';
      return [];
    }
  };

  const routeLengthM = (): Evidenced<number> => {
    const remaining = input.route.vehicleAlongRemainingM as number;
    const covered = Math.min(budgetM, Math.max(0, remaining));
    return derivedNav<number>(covered, {
      source: 'ROUTE_PROVIDER',
      confidence: egoConf,
      observedAtMonoMs: input.route.observedAtMonoMs ?? now,
      freshnessBudgetMs: null,
    });
  };

  if (conflict) {
    /* ÇELİŞKİ → ZORLA İNDİRGEME YOK: iki kol da korunur, MPP YOK. */
    ambiguous = true;
    state = 'AMBIGUOUS_PATH';

    const routeConf = Math.min(egoConf, ROUTE_INTENT_CONFIDENCE_CEIL);
    paths.push({
      pathId: BRANCH_ROUTE_PATH_ID,
      provenance: 'ROUTE_INTENT',
      isMostProbable: false,
      confidence: routeConf,
      physicallyConfirmed: false,
      lengthM: routeLengthM(),
      startEdgeId: null,
      objects: maneuverObjects(input.route, BRANCH_ROUTE_PATH_ID, budgetM, now, routeConf),
    });
    paths.push({
      pathId: BRANCH_MATCHED_PATH_ID,
      provenance: 'MATCHED_ROAD_TOPOLOGY',
      isMostProbable: false,
      confidence: Math.min(egoConf, _conf(matched!.snappedLat)),
      physicallyConfirmed: true,
      /* Topoloji (ardıl kenarlar) L1'de YOK → kapsanan mesafe ÖLÇÜLEMEZ. */
      lengthM: unavailableNav<number>('MAP_PACKAGE', 'NO_SOURCE'),
      startEdgeId: matched!.edgeId,
      objects: readAttrs(BRANCH_MATCHED_PATH_ID, 'MATCHED_ROAD_TOPOLOGY'),
    });
  } else if (hasRoute) {
    const provenance: HorizonPathProvenance = confirmed ? 'ROUTE_INTENT_CONFIRMED' : 'ROUTE_INTENT';
    const conf = confirmed
      ? Math.min(egoConf, _conf(matched!.snappedLat))
      : Math.min(egoConf, ROUTE_INTENT_CONFIDENCE_CEIL);
    const objects = [
      ...maneuverObjects(input.route, MPP_PATH_ID, budgetM, now, conf),
      ...readAttrs(MPP_PATH_ID, provenance),
    ];

    paths.push({
      pathId: MPP_PATH_ID,
      provenance,
      isMostProbable: conf >= MPP_MIN_CONFIDENCE,
      confidence: conf,
      physicallyConfirmed: confirmed,
      lengthM: routeLengthM(),
      startEdgeId: confirmed ? matched!.edgeId : null,
      objects,
    });

    if (conf < MPP_MIN_CONFIDENCE) {
      /* Güven MPP eşiğinin altında → kol taşınır ama MPP İLAN EDİLMEZ. */
      mppPathId = null;
      state = 'HORIZON_PARTIAL';
    } else {
      mppPathId = MPP_PATH_ID;
      /* Fiziksel doğrulama YOKSA ufuk "kesin" sayılamaz — niyet ufkudur. */
      state = confirmed ? 'HORIZON_AVAILABLE' : 'HORIZON_PARTIAL';
    }
  } else if (hasPhysicalMatch) {
    /* Rota yok → serbest sürüş ufku. Topoloji L1'de olmadığı için yalnız
       BULUNULAN kenar bilinir; ileri kapsam ÜRETİLEMEZ. */
    const conf = Math.min(egoConf, _conf(matched!.snappedLat));
    const objects = readAttrs(MPP_PATH_ID, 'MATCHED_ROAD_TOPOLOGY');
    paths.push({
      pathId: MPP_PATH_ID,
      provenance: 'MATCHED_ROAD_TOPOLOGY',
      isMostProbable: conf >= MPP_MIN_CONFIDENCE,
      confidence: conf,
      physicallyConfirmed: true,
      lengthM: unavailableNav<number>('MAP_PACKAGE', 'NO_SOURCE'),
      startEdgeId: matched!.edgeId,
      objects,
    });
    mppPathId = conf >= MPP_MIN_CONFIDENCE ? MPP_PATH_ID : null;
    state = objects.length === 0 ? 'INSUFFICIENT_METADATA' : 'HORIZON_PARTIAL';
  } else {
    /* ── HİÇ KOL YOK — nedeni AYRIŞTIR ─────────────────────────────────
       "Ölçülmedi" ile "yok" ve "eşleşemedi" ayrı hükümlerdir. */
    if (input.mapAvailable === false) {
      state = 'MAP_UNAVAILABLE';
    } else if (matched !== null && matched.matchState !== 'MATCHED') {
      state = 'MATCH_UNAVAILABLE';
    } else if (input.mapAvailable === null) {
      state = 'MAP_UNAVAILABLE';
    } else {
      state = 'NO_HORIZON_SOURCE';
    }

    return {
      kind: 'ELECTRONIC_HORIZON',
      generation: input.generation,
      tsMonoMs: now,
      state,
      reason: input.mapAvailable === null ? 'NO_SOURCE' : 'COVERAGE_NONE',
      /* Ego KORUNUR: harita yok diye konum gerçeği kaybolmaz (degradation
         ≠ fabrication). Ama yol ufku İDDİA EDİLMEZ. */
      egoAnchor: ego,
      matchedAnchor: matched,
      paths: [],
      mppPathId: null,
      ambiguous: false,
      degradation: degradationForHorizonState(state),
      budgetM,
    };
  }

  return {
    kind: 'ELECTRONIC_HORIZON',
    generation: input.generation,
    tsMonoMs: now,
    state,
    reason: attrOutcome === 'NOT_MEASURED' ? 'NO_SOURCE' : 'DETERMINISTIC_DERIVATION',
    egoAnchor: ego,
    matchedAnchor: matched,
    paths,
    mppPathId,
    ambiguous,
    degradation: degradationForHorizonState(state),
    budgetM,
  };
}
