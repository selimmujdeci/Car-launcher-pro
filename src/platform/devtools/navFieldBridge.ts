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
 */

import { DEVELOPER_FEATURES_ENABLED } from '../debug/developerFeatures';
import { getRouteState, getNavigationCoreSnapshot } from '../routingService';
import { getNavigationState } from '../navigationService';
import { getRouteRequestSnapshot } from '../navigation/core/routeRequestLedger';
import { getProviderReadinessSnapshot } from '../navigation/core/routeProviderReadiness';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';

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
      fixAgeMs: veh.location?.timestamp != null ? Date.now() - veh.location.timestamp : null,
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
  };
}

/**
 * Köprüyü kurar. Bayrak kapalıysa NO-OP (ve modül zaten elenmiş olur).
 * Yalnız OKUR — hiçbir servisi başlatmaz, hiçbir komut göndermez.
 */
export function installNavFieldBridge(): void {
  if (!DEVELOPER_FEATURES_ENABLED) return;
  try {
    (window as unknown as Record<string, unknown>)['__CAROS_NAV_FIELD__'] = {
      version: 1,
      sample: _sample,
    };
  } catch { /* fail-soft: ölçüm köprüsü ürünü ASLA düşürmez */ }
}
