/**
 * navFieldBridge.ts — GERÇEK ARAÇ ölçümü için SALT-OKUNUR saha köprüsü.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * CAROS LAB · Navigation Core ekranı "açılışta tek okuma + elle YENİLE"
 * desenindedir (bilinçli: sürüşte timer/polling YOK). Bu, ekran başında duran
 * bir geliştirici için doğrudur ama **gerçek araç ölçümü için yetmez**:
 * sürücü direksiyondayken YENİLE'ye basamaz ve zaman-serisi (10 km boyunca
 * `MATCHED` oranı, ETA kararlılığı) elle toplanamaz.
 *
 * Bu köprü, ölçüm koşumunun (CDP over adb) 1 Hz örnekleme yapabilmesi için
 * MEVCUT senkron getter'ları `window` üzerinde açar. **Yeni durum üretmez,
 * yeni okuma yapmaz, hiçbir şeyi başlatmaz.**
 *
 * ── GÜVENLİK / SATIŞ ────────────────────────────────────────────────────────
 * `DEVELOPER_FEATURES_ENABLED` derleme-zamanı sabitidir; satış build'inde
 * `false`'a katlanır ve bu modülün TAMAMI ölü kod olarak elenir (dinamik
 * import da dahil — çağrı noktası da bayrakla korunur). Ürün davranışına
 * hiçbir koşulda dokunmaz: yalnız okur.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Bu köprü LAB ekranından FARKLI bir sözleşmeye tabidir: çıktısı ekrana değil,
 * geliştiricinin kendi makinesindeki ölçüm dosyasına gider ve saha ölçümü
 * konum doğruluğunu değerlendirmek için ham koordinata İHTİYAÇ DUYAR
 * (ör. "servis yoluna atladı mı"). Bu yüzden koordinat BURADA taşınır —
 * ama LAB ekranına ASLA sızmaz (o katman `navigationCoreSources` üzerinden
 * koordinatsız okur). Ölçüm dosyası kişisel veridir; paylaşılmadan önce
 * temizlenmelidir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NAV v3 · F8 — SINIRLI KAYIT + OLAY TÜRETİMİ (bu bölüm) ─────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F8.
 *
 * F3–F7'nin ürettiği salt-okunur teşhis yüzeyleri (`cehAuthority` ·
 * `graphResidencyRuntime` · `enforcementHorizonPort` · `cehShadowRuntime` ·
 * `routeRationaleModel` · `navTickCostModel`) bugüne kadar TEK BİR zaman
 * ekseninde birlikte GÖRÜLEMİYORDU. Bu bölüm onları `NavFieldSample`e
 * ALANLAR olarak ekler ve isteğe bağlı, SINIRLI bir kayda alır.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────
 *  · **İKİNCİ ZAMANLAYICI YOK.** Örnekleme kadansı HÂLÂ dış CDP koşumunundur
 *    (`nav-field-record.mjs`, 1 Hz). Kayıt, dışarıdan gelen HER `sample()`
 *    çağrısına "PİGGYBACK" eder — kendi `setInterval`ini KURMAZ.
 *  · **ÜRETİM KARARINA GERİ BESLENMEZ.** `startFieldRecording`/`stopField
 *    Recording`/`exportFieldTrace` hiçbir navigasyon/CEH/Guardian çağrısı
 *    YAPMAZ; yalnız zaten var olan `_sample()` çıktısını bir diziye YAZAR.
 *  · **ELLE BAŞLAR, ELLE DURUR.** Otomatik başlatma YOK; `installNavFieldBridge`
 *    kayıt açmaz — yalnız köprüyü kurar (mevcut davranış).
 *  · **SINIRLI.** Örnek/olay tavanı aşılırsa YENİ girdi REDDEDİLİR (eski
 *    veri SESSİZCE ezilmez) ve `truncated` AÇIKÇA `true` olur — "kanıt
 *    kayboldu" durumu asla gizlenmez.
 *  · **VARSAYILAN EXPORT HAM KOORDİNAT TAŞIMAZ.** `startFieldRecording({
 *    fieldDebug: true })` açıkça istenmeden `lat`/`lon`/`snappedLat`/
 *    `snappedLon` dışa aktarımda `null`e indirgenir (kayıt İÇİNDE durur,
 *    yalnız `exportFieldTrace()` çıktısı budanır).
 *
 * ── NEDEN `platform/fieldValidation/longRoad*`e BAĞLANMADI (kanıtlı ret) ──
 * O paket OBD/araç-sağlığı alanının KENDİ zamanlayıcı sahibidir (tek
 * `setInterval`, kendi black-box penceresi). Onu navigasyon için yeniden
 * kullanmak ya (a) yabancı bir alanın ÖZEL zamanlayıcısını/deposunu ithal
 * etmek ya da (b) navigasyona İKİNCİ bir zamanlayıcı kurmak anlamına
 * gelirdi — ikisi de CLAUDE.md §CROSS-DOMAIN 8/15 ve bu bölümün "ikinci
 * zamanlayıcı yok" kuralını ihlal eder. Tasarım DESENİ (sınırlı halka,
 * sessiz kayıp yasağı, "dropped" dürüstlüğü) buradan esinlenmiştir; kod
 * PAYLAŞILMAMIŞTIR (ayrı alan, ayrı sahiplik).
 */

import { getLocationEvidence } from '../gpsService';
import { DEVELOPER_FEATURES_ENABLED } from '../debug/developerFeatures';
import { getRouteState, getNavigationCoreSnapshot } from '../routingService';
import { getNavigationState } from '../navigationService';
import { getRouteRequestSnapshot } from '../navigation/core/routeRequestLedger';
import { getProviderReadinessSnapshot } from '../navigation/core/routeProviderReadiness';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { getCehAuthority } from '../navigation/horizon/cehAuthority';
import { getGraphResidencySnapshot } from '../navigation/map/graph/graphResidencyRuntime';
import { getEnforcementHorizonPortSnapshot } from '../navigation/enforcementHorizonPort';
import { getCehShadowSnapshot } from '../navigation/shadow/cehShadowRuntime';
import { getRouteRationaleLedger } from '../navigation/core/routeRationaleModel';
import { getNavTickCostSnapshot } from '../navigation/core/navTickCostModel';

/** Bir okumanın hatasını yutar — TEK bölümün çökmesi tüm örneği DÜŞÜRMEZ. */
function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Ölçüm örneği — saha koşumunun JSONL satırı. */
export interface NavFieldSample {
  readonly tWall: number;   // Date.now()
  readonly tMono: number;   // performance.now()
  readonly nav: {
    status: string; isNavigating: boolean; isGuidanceActive: boolean; isRerouting: boolean;
    distanceM: number | null; etaS: number | null;
  };
  readonly veh: {
    speedKmh: number | null; headingDeg: number | null;
    lat: number | null; lon: number | null; accuracyM: number | null;
    fixAgeMs: number | null;
  };
  readonly match: {
    state: string | null; confidence: number | null; segIdx: number | null;
    lateralM: number | null; headingDeltaDeg: number | null;
    alongRemainingM: number | null; reasons: readonly string[];
    snappedLat: number | null; snappedLon: number | null;
  };
  readonly offRoute: {
    state: string; evidence: number; required: number; requiredMs: number;
    confirmedAtMs: number | null; reasons: readonly string[];
  };
  readonly route: {
    serverUsed: string | null; steps: number; stepIdx: number;
    nextManeuverM: number | null; distSource: string;
    totalM: number; geometryPts: number;
    anchorsResolved: number; anchorsUnresolved: number;
    validation: string | null;
    /**
     * Hangi kontroller WARN/FAIL verdi (kütük #407). Sahada rota doğrulaması
     * 399/399 örnekte `DEGRADED` çıktı ama HANGİ kritere takıldığı hiçbir yerde
     * görünmüyordu → düzeltilemez bir kusur. Artık sebep kimlikleri yayınlanır.
     */
    validationWarnIds: string[] | null;
    validationFailIds: string[] | null;
    lanesSteps: number; roundaboutSteps: number; roundaboutWithExit: number;
  };
  readonly req: {
    currentId: number; committed: number; staleRejected: number;
    invalidRejected: number; superseded: number; failed: number;
    suppressed: number;
    detectToCommitMs: number | null;
    detectToFirstInstrMs: number | null;
    requestToResponseMs: number | null;
    offRouteDetectedAtMs: number | null;
  };
  readonly provider: {
    localState: string; probeCount: number; skippedCount: number;
    lastSource: string; straightLineCount: number; remoteFailures: number;
  };
  readonly corridorM: number;
  readonly fetchInFlight: boolean;

  /* ── NAV v3 · F8 — F3/CEH teşhisi (salt-okunur, `getDiagnostics()`) ────── */
  readonly ceh: {
    state: string; generation: number; ambiguous: boolean;
    physicallyConfirmed: boolean; mppPresent: boolean; pathCount: number;
    objectCount: number; horizonAgeMs: number | null; mapAvailable: boolean | null;
    boundDomains: readonly string[]; errorCount: number;
  } | null;

  /* ── NAV v3 · F8 — F4/graf sakinliği teşhisi (`graphResidencyRuntime`) ── */
  readonly graph: {
    state: string; holders: number; loadCount: number;
    nodeCount: number | null; edgeCount: number | null; version: 1 | 2 | null;
    parseMs: number | null; adjacencyBuilt: boolean;
  } | null;

  /* ── NAV v3 · F8 — F6/sınırlı koridor + eşleştirme teşhisi
     (`enforcementHorizonPort`; ham `ordinal` L1 dışına ÇIKMAZ — yalnız
     hüküm/sayaç okunur, ham kimlik burada da YOKTUR). ─────────────────── */
  readonly roadCorridor: {
    calls: number; lastOutcome: string | null; lastCorridorOutcome: string | null;
    lastCorridorEdgeCount: number | null; lastCorridorNodeExpansions: number | null;
    lastCorridorTruncated: boolean | null; lastCandidateCount: number | null;
    lastObjectCount: number | null; lastDurationMs: number | null;
  } | null;
  readonly enforcement: {
    matchedToEdge: number; ambiguousEdge: number; noEdgeMatch: number;
    outsideCoverage: number; notMeasured: number;
    onewayImplied: number; unknownDirection: number;
    lastOutcome: string | null;
  } | null;

  /* ── NAV v3 · F8 — F5/gölge karşılaştırma teşhisi (`cehShadowRuntime`) ── */
  readonly shadow: {
    active: boolean; ticks: number; errorCount: number;
    comparable: number; divergent: number; divergenceRatio: number | null;
    cutoverState: string; cutoverUnmet: readonly string[];
    guardianWouldEmitCount: number; sideEffectCount: number;
  } | null;

  /* ── NAV v3 · F8 — F7/rota gerekçe defteri (`routeRationaleModel`) ─────
     Koordinat/geometri TAŞIMAZ (kaynak sözleşmesi zaten yasaklıyor). ──── */
  readonly rationale: {
    decisions: number; overrodeProviderFirst: number;
    maxDurationPenaltyS: number | null;
    lastFactor: string | null; lastChosenIdx: number | null;
    lastDurationPenaltyS: number | null; lastAcceptedCount: number | null;
  } | null;

  /* ── NAV v3 · F8 — sıcak-yol maliyeti (`navTickCostModel`) ─────────────
     Değişen bir davranış DEĞİL — P0-NAV-19'da zaten ölçülüyordu; F8 onu
     örneğe TAŞIR (ikinci ölçüm otoritesi kurmaz, yalnız OKUR). ─────────── */
  readonly perf: {
    mapMatchP50Ms: number | null; mapMatchP95Ms: number | null; mapMatchMaxMs: number | null;
    progressP50Ms: number | null; progressP95Ms: number | null; progressMaxMs: number | null;
  } | null;
}

function _sample(): NavFieldSample {
  const rs = getRouteState();
  const core = getNavigationCoreSnapshot();
  const nav = getNavigationState();
  const req = getRouteRequestSnapshot();
  const prov = getProviderReadinessSnapshot();
  const veh = useUnifiedVehicleStore.getState();
  const fix = core.fix;
  const now = performance.now();

  let lanesSteps = 0, roundaboutSteps = 0, roundaboutWithExit = 0;
  for (const s of rs.steps) {
    if (s.lanes && s.lanes.length > 0) lanesSteps++;
    const t = s.maneuverType;
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') {
      roundaboutSteps++;
      if (s.roundaboutExit != null) roundaboutWithExit++;
    }
  }

  return {
    tWall: Date.now(),
    tMono: now,
    nav: {
      // #416: oturum açık olmak ≠ rehberlik sürüyor olmak. İkisi AYRI yayınlanır.
      status: nav.status, isNavigating: nav.isNavigating,
      isGuidanceActive: nav.isGuidanceActive, isRerouting: nav.isRerouting,
      distanceM: nav.distanceMeters ?? null, etaS: nav.etaSeconds ?? null,
    },
    veh: {
      speedKmh: veh.speed ?? null,
      headingDeg: Number.isFinite(veh.heading ?? NaN) ? (veh.heading as number) : null,
      lat: veh.location?.latitude ?? null,
      lon: veh.location?.longitude ?? null,
      accuracyM: veh.location?.accuracy ?? null,
      /* G1 (#527): TEK OTORİTE — duvar saatiyle yeniden hesaplama KALDIRILDI.
         Saha ölçümünün (#508) dayandığı sayı buradan geldiği için, yaşın
         monotonik ve tek kaynaklı olması ölçümün geçerliliğinin şartıdır. */
      fixAgeMs: getLocationEvidence().fixAgeMs,
    },
    match: {
      state: fix?.state ?? null,
      confidence: fix?.confidence ?? null,
      segIdx: fix?.segIdx ?? null,
      lateralM: fix?.lateralM ?? null,
      headingDeltaDeg: fix?.headingDeltaDeg ?? null,
      alongRemainingM: fix?.alongRemainingM ?? null,
      reasons: fix?.reasons ?? [],
      snappedLat: fix?.snappedLat ?? null,
      snappedLon: fix?.snappedLon ?? null,
    },
    offRoute: {
      state: core.offRoute.state,
      evidence: core.offRoute.evidenceCount,
      required: core.offRoute.requiredEvidence,
      requiredMs: core.offRoute.requiredEvidenceMs,
      confirmedAtMs: core.offRoute.confirmedAtMs,
      reasons: core.offRoute.reasons,
    },
    route: {
      serverUsed: rs.serverUsed,
      steps: rs.steps.length,
      stepIdx: rs.currentStepIndex,
      nextManeuverM: Number.isFinite(rs.distanceToNextTurnMeters) ? rs.distanceToNextTurnMeters : null,
      distSource: rs.distanceToNextTurnSource,
      totalM: rs.totalDistanceMeters,
      geometryPts: rs.geometry?.length ?? 0,
      anchorsResolved: rs.maneuverAnchors.filter(a => a.geometryIndex >= 0).length,
      anchorsUnresolved: rs.maneuverAnchors.filter(a => a.geometryIndex < 0).length,
      validation: rs.validation?.verdict ?? null,
      validationWarnIds: rs.validation
        ? rs.validation.checks.filter((c) => c.status === 'WARN').map((c) => c.id)
        : null,
      validationFailIds: rs.validation
        ? rs.validation.checks.filter((c) => c.status === 'FAIL').map((c) => c.id)
        : null,
      lanesSteps, roundaboutSteps, roundaboutWithExit,
    },
    req: {
      currentId: req.currentId,
      committed: req.committedCount,
      staleRejected: req.staleRejectedCount,
      invalidRejected: req.invalidRejectedCount,
      superseded: req.supersededCount,
      failed: req.failedCount,
      suppressed: req.suppressedDuplicateCount,
      detectToCommitMs: req.latency.detectToCommitMs ?? req.lastCompletedLatency.detectToCommitMs,
      detectToFirstInstrMs: req.latency.detectToFirstInstructionMs
        ?? req.lastCompletedLatency.detectToFirstInstructionMs,
      requestToResponseMs: req.latency.requestToResponseMs ?? req.lastCompletedLatency.requestToResponseMs,
      offRouteDetectedAtMs: req.latency.offRouteDetectedAtMs,
    },
    provider: {
      localState: prov.localState,
      probeCount: prov.localProbeCount,
      skippedCount: prov.localSkippedCount,
      lastSource: prov.lastSource,
      straightLineCount: prov.straightLineCount,
      remoteFailures: prov.remoteFailureCount,
    },
    corridorM: core.corridorM,
    fetchInFlight: core.fetchInFlight,

    ceh: _safe(() => {
      const d = getCehAuthority().getDiagnostics();
      return {
        state: d.state, generation: d.generation, ambiguous: d.ambiguous,
        physicallyConfirmed: d.physicallyConfirmed, mppPresent: d.mppPresent,
        pathCount: d.pathCount, objectCount: d.objectCount,
        horizonAgeMs: d.horizonAgeMs, mapAvailable: d.mapAvailable,
        boundDomains: d.boundDomains, errorCount: d.errorCount,
      };
    }, null),

    graph: _safe(() => {
      const g = getGraphResidencySnapshot();
      return {
        state: g.state, holders: g.holders, loadCount: g.loadCount,
        nodeCount: g.nodeCount, edgeCount: g.edgeCount, version: g.version,
        parseMs: g.parseMs, adjacencyBuilt: g.adjacencyBuilt,
      };
    }, null),

    roadCorridor: _safe(() => {
      const p = getEnforcementHorizonPortSnapshot();
      return {
        calls: p.calls, lastOutcome: p.lastOutcome,
        lastCorridorOutcome: p.lastCorridorOutcome,
        lastCorridorEdgeCount: p.lastCorridorEdgeCount,
        lastCorridorNodeExpansions: p.lastCorridorNodeExpansions,
        lastCorridorTruncated: p.lastCorridorTruncated,
        lastCandidateCount: p.lastCandidateCount,
        lastObjectCount: p.lastObjectCount,
        lastDurationMs: p.lastDurationMs,
      };
    }, null),

    enforcement: _safe(() => {
      const p = getEnforcementHorizonPortSnapshot();
      const m = p.cumulativeMatch;
      return {
        matchedToEdge: m.matchedToEdge, ambiguousEdge: m.ambiguousEdge,
        noEdgeMatch: m.noEdgeMatch, outsideCoverage: m.outsideCoverage,
        notMeasured: m.notMeasured, onewayImplied: m.onewayImplied,
        unknownDirection: m.unknownDirection, lastOutcome: m.lastOutcome,
      };
    }, null),

    shadow: _safe(() => {
      const s = getCehShadowSnapshot();
      return {
        active: s.active, ticks: s.ticks, errorCount: s.errorCount,
        comparable: s.total.comparable, divergent: s.total.divergences,
        divergenceRatio: s.divergenceRatio,
        cutoverState: s.cutover.state, cutoverUnmet: s.cutover.unmet,
        guardianWouldEmitCount: s.guardianWouldEmitCount,
        sideEffectCount: s.sideEffectCount,
      };
    }, null),

    rationale: _safe(() => {
      const r = getRouteRationaleLedger();
      return {
        decisions: r.decisions, overrodeProviderFirst: r.overrodeProviderFirst,
        maxDurationPenaltyS: r.maxDurationPenaltyS,
        lastFactor: r.last?.decidingFactor ?? null,
        lastChosenIdx: r.last?.chosenIdx ?? null,
        lastDurationPenaltyS: r.last?.durationPenaltyS ?? null,
        lastAcceptedCount: r.last?.acceptedCount ?? null,
      };
    }, null),

    perf: _safe(() => {
      const p = getNavTickCostSnapshot();
      return {
        mapMatchP50Ms: p.mapMatch.p50Ms, mapMatchP95Ms: p.mapMatch.p95Ms,
        mapMatchMaxMs: p.mapMatch.maxMs,
        progressP50Ms: p.progressTick.p50Ms, progressP95Ms: p.progressTick.p95Ms,
        progressMaxMs: p.progressTick.maxMs,
      };
    }, null),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   NAV v3 · F8 — OLAY TÜRETİMİ (örnekten örneğe FARK, saf sınıflandırma)
   ══════════════════════════════════════════════════════════════════════════ */

/** Bounded olay sözlüğü — türetilen alan yalnız BUNLARDAN biri olabilir. */
export type NavFieldEventKind =
  | 'MATCH_STATE_CHANGED'
  | 'CEH_STATE_CHANGED'
  | 'CORRIDOR_TRUNCATED'
  | 'ENFORCEMENT_ACQUIRED'
  | 'ENFORCEMENT_LOST'
  | 'SHADOW_DIVERGENCE'
  | 'ROUTE_SELECTED'
  | 'RATIONALE_UNKNOWN'
  | 'GRAPH_RESIDENCY_CHANGED';

export const NAV_FIELD_EVENT_KINDS: readonly NavFieldEventKind[] = [
  'MATCH_STATE_CHANGED', 'CEH_STATE_CHANGED', 'CORRIDOR_TRUNCATED',
  'ENFORCEMENT_ACQUIRED', 'ENFORCEMENT_LOST', 'SHADOW_DIVERGENCE',
  'ROUTE_SELECTED', 'RATIONALE_UNKNOWN', 'GRAPH_RESIDENCY_CHANGED',
] as const;

/**
 * Bir OLAY — durum GEÇİŞİ. **Koordinat TAŞIMAZ** (yalnız enum/sayı/kimlik).
 * `atSampleIndex`, bu olayın hangi örnekle AYNI ANDA türetildiğini
 * gösterir — örnek dizisiyle olay dizisi bu alanla hizalanır.
 */
export interface NavFieldEvent {
  readonly kind: NavFieldEventKind;
  readonly atSampleIndex: number;
  readonly tMono: number;
  readonly from: string | null;
  readonly to: string | null;
}

interface _PrevClassification {
  matchState: string | null;
  cehState: string | null;
  corridorTruncated: boolean | null;
  enforcementAcquired: boolean;
  divergenceHigh: boolean;
  routeRequestId: number | null;
  graphState: string | null;
  rationaleFactor: string | null;
}

/** Gölge fark oranı bu eşiği aşarsa `SHADOW_DIVERGENCE` olayı türetilir. */
const SHADOW_DIVERGENCE_EVENT_THRESHOLD = 0.02; // `cehCutoverGate.CEH_CUTOVER_MAX_DIVERGENCE_RATIO` ile AYNI politika sayısı

/**
 * İki ardışık örnek arasındaki OLAYLARI türetir. **SAF** — I/O yok, saat
 * OKUMAZ (zaman damgası örneğin KENDİSİNDEN alınır), modül durumu YOK.
 * Girdi/prev `null` ise (ilk örnek) olay üretilmez — "geçiş" tanımsızdır.
 */
export function deriveFieldEvents(
  sample: NavFieldSample, prev: _PrevClassification | null, atSampleIndex: number,
): { events: readonly NavFieldEvent[]; next: _PrevClassification } {
  const next: _PrevClassification = {
    matchState: sample.match.state,
    cehState: sample.ceh?.state ?? null,
    corridorTruncated: sample.roadCorridor?.lastCorridorTruncated ?? null,
    enforcementAcquired: (sample.roadCorridor?.lastObjectCount ?? 0) > 0,
    divergenceHigh: (sample.shadow?.divergenceRatio ?? 0) > SHADOW_DIVERGENCE_EVENT_THRESHOLD,
    routeRequestId: sample.req.currentId,
    graphState: sample.graph?.state ?? null,
    rationaleFactor: sample.rationale?.lastFactor ?? null,
  };

  if (prev === null) return { events: [], next };

  const events: NavFieldEvent[] = [];
  const push = (kind: NavFieldEventKind, from: string | null, to: string | null): void => {
    events.push({ kind, atSampleIndex, tMono: sample.tMono, from, to });
  };

  if (next.matchState !== prev.matchState) {
    push('MATCH_STATE_CHANGED', prev.matchState, next.matchState);
  }
  if (next.cehState !== prev.cehState) {
    push('CEH_STATE_CHANGED', prev.cehState, next.cehState);
  }
  if (next.corridorTruncated === true && prev.corridorTruncated !== true) {
    push('CORRIDOR_TRUNCATED', String(prev.corridorTruncated), 'true');
  }
  if (next.enforcementAcquired && !prev.enforcementAcquired) {
    push('ENFORCEMENT_ACQUIRED', 'false', 'true');
  } else if (!next.enforcementAcquired && prev.enforcementAcquired) {
    push('ENFORCEMENT_LOST', 'true', 'false');
  }
  if (next.divergenceHigh && !prev.divergenceHigh) {
    push('SHADOW_DIVERGENCE', 'below', 'above');
  }
  if (next.routeRequestId !== prev.routeRequestId) {
    push('ROUTE_SELECTED', String(prev.routeRequestId), String(next.routeRequestId));
  }
  if (next.rationaleFactor === 'UNKNOWN' && prev.rationaleFactor !== 'UNKNOWN') {
    /* F7'nin "görünür arıza" sinyali — GEÇİŞ olarak yakalanır (bir kez, o
       geçişte), her örnekte TEKRAR üretilmez. Fail-closed hükmün SAHADA hiç
       çıkmadığının kanıtı #1271'in kabul ölçütü tam olarak budur. */
    push('RATIONALE_UNKNOWN', prev.rationaleFactor, 'UNKNOWN');
  }
  if (next.graphState !== prev.graphState) {
    push('GRAPH_RESIDENCY_CHANGED', prev.graphState, next.graphState);
  }

  return { events, next };
}

/* ══════════════════════════════════════════════════════════════════════════
   NAV v3 · F8 — SINIRLI KAYIT (manuel başlar/durur; ikinci zamanlayıcı YOK)
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir örnek dizisi + bir olay dizisi ayrı ayrı sınırlıdır. */
export const FIELD_TRACE_MAX_SAMPLES = 3_600; // 1 Hz × 60 dk — tipik sürüş-günü penceresi
export const FIELD_TRACE_MAX_EVENTS = 512;    // geçişler örneklerden çok daha seyrektir

export const FIELD_TRACE_SCHEMA = 'caros.nav.fieldtrace.v1';

export interface NavFieldTraceProvenance {
  readonly schemaVersion: string;
  /** `import.meta.env.VITE_APP_VERSION` — okunamazsa `null` (uydurulmaz). */
  readonly appVersion: string | null;
  /** `import.meta.env.VITE_GIT_REVISION` — mevcut `longRoadSources` deseniyle AYNI. */
  readonly gitRevision: string | null;
  /** Yalnız bu oturuma özgü, kişisel olmayan rastgele kimlik. */
  readonly sessionId: string;
  readonly recordingLabel: string | null;
  readonly startedAtWallMs: number;
  readonly startedAtMonoMs: number;
}

export interface NavFieldTraceOverflow {
  readonly samplesTruncated: boolean;
  readonly eventsTruncated: boolean;
  readonly overflowSampleCount: number;
  readonly overflowEventCount: number;
}

export interface NavFieldTraceStatus {
  readonly recording: boolean;
  readonly sampleCount: number;
  readonly eventCount: number;
  readonly overflow: NavFieldTraceOverflow;
  readonly fieldDebug: boolean;
  readonly startedAtWallMs: number | null;
}

export interface NavFieldTrace {
  readonly provenance: NavFieldTraceProvenance;
  readonly samples: readonly NavFieldSample[];
  readonly events: readonly NavFieldEvent[];
  readonly overflow: NavFieldTraceOverflow;
  /**
   * Dışa aktarım budandı mı (ham koordinat düşürüldü). `fieldDebug` KAPALI
   * (varsayılan) iken DAİMA `true`dır — bu bir gizlilik BEYANIDIR, dışa
   * aktarılan dosyaya bakan kişi koordinatın neden yok olduğunu bilsin.
   */
  readonly coordinatesRedacted: boolean;
}

let _recording = false;
let _fieldDebug = false;
let _samples: NavFieldSample[] = [];
let _events: NavFieldEvent[] = [];
let _prevClass: _PrevClassification | null = null;
let _overflowSamples = 0;
let _overflowEvents = 0;
let _provenance: NavFieldTraceProvenance | null = null;

function _newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* aşağıya düş */ }
  return `sess-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * Kaydı BAŞLATIR. **Elle çağrılır** — otomatik tetikleyici YOKTUR.
 * Zaten kayıttaysa ÖNCEKİ oturum sıfırlanır (üst üste kayıt karışmaz).
 */
export function startFieldRecording(opts?: { label?: string; fieldDebug?: boolean }): NavFieldTraceStatus {
  _recording = true;
  _fieldDebug = opts?.fieldDebug === true;
  _samples = [];
  _events = [];
  _prevClass = null;
  _overflowSamples = 0;
  _overflowEvents = 0;
  const nowWall = Date.now();
  const nowMono = performance.now();
  _provenance = {
    schemaVersion: FIELD_TRACE_SCHEMA,
    appVersion: _safe(() => (import.meta.env.VITE_APP_VERSION as string | undefined) ?? null, null),
    gitRevision: _safe(() => (import.meta.env.VITE_GIT_REVISION as string | undefined) ?? null, null),
    sessionId: _newSessionId(),
    recordingLabel: typeof opts?.label === 'string' ? opts.label.slice(0, 64) : null,
    startedAtWallMs: nowWall,
    startedAtMonoMs: nowMono,
  };
  return getFieldRecordingStatus();
}

/** Kaydı DURDURUR (dondurur) — dizi TEMİZLENMEZ; `exportFieldTrace()` hâlâ okuyabilir. */
export function stopFieldRecording(): NavFieldTraceStatus {
  _recording = false;
  return getFieldRecordingStatus();
}

/** Salt-okunur durum — ölçüm koşumunun ilerleme göstergesi. Yan etkisi YOKTUR. */
export function getFieldRecordingStatus(): NavFieldTraceStatus {
  return {
    recording: _recording,
    sampleCount: _samples.length,
    eventCount: _events.length,
    overflow: {
      samplesTruncated: _overflowSamples > 0,
      eventsTruncated: _overflowEvents > 0,
      overflowSampleCount: _overflowSamples,
      overflowEventCount: _overflowEvents,
    },
    fieldDebug: _fieldDebug,
    startedAtWallMs: _provenance?.startedAtWallMs ?? null,
  };
}

function _redactSample(sample: NavFieldSample): NavFieldSample {
  if (_fieldDebug) return sample;
  return {
    ...sample,
    veh: { ...sample.veh, lat: null, lon: null },
    match: { ...sample.match, snappedLat: null, snappedLon: null },
  };
}

/**
 * Kayıtlıyken çağrılır, `sample()`in HER çağrısına PİGGYBACK eder — kendi
 * zamanlayıcısı YOKTUR. Kayıt kapalıyken NO-OP (hiçbir dizi büyümez).
 *
 * SINIR AŞILDIĞINDA: yeni girdi REDDEDİLİR (en eski veri KORUNUR — bir hata
 * senaryosunun BAŞLANGICI genelde en değerli kısımdır) ve `overflow*`
 * sayaçları SESSİZCE DEĞİL, AÇIKÇA artar.
 */
function _pushToTrace(s: NavFieldSample): void {
  if (!_recording) return;
  const idx = _samples.length;
  if (_samples.length < FIELD_TRACE_MAX_SAMPLES) {
    _samples.push(s);
  } else {
    _overflowSamples++;
  }

  const { events, next } = deriveFieldEvents(s, _prevClass, idx);
  _prevClass = next;
  for (const e of events) {
    if (_events.length < FIELD_TRACE_MAX_EVENTS) _events.push(e);
    else _overflowEvents++;
  }
}

/**
 * Salt-okunur dışa aktarım. **Belirleyici sıra** (kayıt sırası) · **şema
 * sürümlü** · **bounded** (kayıt zaten sınırlıydı). Hiç kayıt yapılmadıysa
 * `null` — sahte boş trace ÜRETİLMEZ.
 */
export function exportFieldTrace(): NavFieldTrace | null {
  if (_provenance === null) return null;
  return {
    provenance: _provenance,
    samples: _samples.map(_redactSample),
    events: _events,
    overflow: {
      samplesTruncated: _overflowSamples > 0,
      eventsTruncated: _overflowEvents > 0,
      overflowSampleCount: _overflowSamples,
      overflowEventCount: _overflowEvents,
    },
    coordinatesRedacted: !_fieldDebug,
  };
}

/** @internal testler arası izolasyon. */
export function _resetFieldRecordingForTest(): void {
  _recording = false;
  _fieldDebug = false;
  _samples = [];
  _events = [];
  _prevClass = null;
  _overflowSamples = 0;
  _overflowEvents = 0;
  _provenance = null;
}

/**
 * Köprüyü kurar. Bayrak kapalıysa NO-OP (ve modül zaten elenmiş olur).
 * Yalnız OKUR — hiçbir servisi başlatmaz, hiçbir komut göndermez.
 *
 * F8: `sample()` ARTIK iki iş yapar — (1) mevcut davranış: örneği DÖNDÜRÜR;
 * (2) kayıt açıksa aynı örneği `_pushToTrace` ile sınırlı diziye YAZAR. Dış
 * CDP koşumu değişmeden AYNI 1 Hz çağrısını yapmaya devam eder; ikinci bir
 * zamanlayıcı bu yüzden GEREKMEZ.
 */
export function installNavFieldBridge(): void {
  if (!DEVELOPER_FEATURES_ENABLED) return;
  try {
    (window as unknown as Record<string, unknown>)['__CAROS_NAV_FIELD__'] = {
      version: 2,
      sample: () => {
        const s = _sample();
        _pushToTrace(s);
        return s;
      },
      startRecording: startFieldRecording,
      stopRecording: stopFieldRecording,
      recordingStatus: getFieldRecordingStatus,
      exportTrace: exportFieldTrace,
    };
  } catch { /* fail-soft: ölçüm köprüsü ürünü ASLA düşürmez */ }
}
