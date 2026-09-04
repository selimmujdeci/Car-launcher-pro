/**
 * egoAuthority.ts — NAV v3 · L2 · TEK EGO / LOCALIZATION OTORİTESİ (F2).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.5.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── TEK OTORİTE ───────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `RealtimeEgoPose` ve `MatchedRoadPose` **yalnız burada** üretilir. L3+
 * katmanlar ego veya yol-eşleşmesi gerçeği istediğinde bu cepheyi kullanır.
 *
 * **Mevcut çalışan navigasyon MİGRATE EDİLMEDİ (bilinçli):** rota-göreli
 * ilerleme zinciri (`routingService.updateRouteProgress` → `mapMatchModel`)
 * ve `navigationSessionRuntime` tik sahipliği F2'de **DEĞİŞTİRİLMEDİ**. F2'nin
 * işi kanonik L2 çekirdeğini kurmak ve KONTROLLÜ entegrasyon sınırını
 * çizmektir; davranış taşıma ayrı fazdır. İki modül farklı soruları
 * yanıtladığı için ikinci otorite DOĞMAZ:
 *   `mapMatchModel` → "aktif ROTANIN neresindeyim?" (rota-göreli, L4 besler)
 *   `egoAuthority`  → "fiilen NEREDEYİM ve hangi KENARDAYIM?" (ağ-göreli)
 *
 * ── TİK SAHİPLİĞİ YOK ────────────────────────────────────────────────────
 * Bu dosya **timer/abonelik/scheduler KURMAZ**. `observe()` çağrısını, tik
 * sahibi olan katman yapar. F2 yeni bir poll döngüsü EKLEMEZ.
 *
 * ── FAIL-CLOSED ──────────────────────────────────────────────────────────
 *  · Monotonik saat yoksa → hiçbir tazelik/yaş hesaplanmaz, poz yayınlanmaz.
 *  · Doğruluk bilinmiyorsa GNSS ölçümü REDDEDİLİR.
 *  · Reddedilen ölçüm sayaca yazılır ama duruma İŞLENMEZ.
 *  · Aday yoksa `MatchedRoadPose.edgeId` **null** kalır — zorla snap YOK.
 *  · Belirsizlik kalite kapısını aşarsa DR 90 sn dolmadan degrade olur.
 */

import type { Evidenced } from '../contracts/navEvidence';
import { derivedNav, observedNav, unavailableNav } from '../contracts/navEvidence';
import type { MonotonicMs } from '../contracts/navMonotonicTime';
import { asMonotonic } from '../contracts/navMonotonicTime';
import type { MatchedRoadPose, RealtimeEgoPose, RoadMatchState } from '../contracts/navEgoPose';
import type { EgoKalmanState, EgoNoiseParams, EgoRejectReason } from './egoKalman';
import {
  DEFAULT_EGO_NOISE, GNSS_ACCURACY_REJECT_M,
  initEgoState, predictEgo, reanchorIfNeeded,
  updateEgoPosition, updateEgoSpeed, updateEgoHeading, applyZupt,
  egoLatLon, egoSigmaHorizontalM, egoSigmaHeadingRad, egoSigmaSpeedMps,
  IDX_PSI, IDX_V,
} from './egoKalman';
import type { EgoModeVerdict } from './egoModeModel';
import { decideEgoMode, egoConfidenceFromSigma, DR_TOTAL_MAX_MS } from './egoModeModel';
import type { EgoSensorPort, EgoSensorSample } from './egoSensorPort';
import { UNAVAILABLE_EGO_SENSOR_PORT } from './egoSensorPort';
import { productionEgoSensorPort } from './egoSources';
import type { HmmParams, HmmState, HmmDecision } from '../matching/hmmMatchModel';
import { DEFAULT_HMM_PARAMS, EMPTY_HMM_STATE, stepHmm, decodeHmm } from '../matching/hmmMatchModel';
import type { RoadCandidateSource, CandidateSourceOutcome } from '../matching/roadCandidateSource';
import {
  UNAVAILABLE_ROAD_CANDIDATE_SOURCE, candidateRadiusM, rankCandidates,
  productionRoadCandidateSource,
} from '../matching/roadCandidateSource';
/* Tazelik BÜTÇESİ deponun TANIMLI eşiğinden gelir — uydurma eşik YASAK. */
import { LOCATION_STALE_MS } from '../../gpsService';

/* ══════════════════════════════════════════════════════════════════════════
   1) TEŞHİS GÖRÜNTÜSÜ (salt-okunur — LAB için hazır)
   ══════════════════════════════════════════════════════════════════════════ */

export interface EgoDiagnostics {
  readonly initialized: boolean;
  readonly mode: EgoModeVerdict['mode'];
  readonly modeReason: EgoModeVerdict['reason'];
  readonly guidanceAllowed: boolean;
  readonly degradedByTime: boolean;
  readonly degradedBySigma: boolean;
  /** 1σ yatay belirsizlik (m); ölçülemezse `null`. */
  readonly sigmaHorizontalM: number | null;
  readonly fixAgeMs: number | null;
  /** İşlenen gözlem sayısı. */
  readonly observations: number;
  /** KABUL edilen GNSS konum güncellemesi sayısı. */
  readonly positionUpdatesAccepted: number;
  /** REDDEDİLEN GNSS konum ölçümü sayısı (başarı SAYILMAZ). */
  readonly positionUpdatesRejected: number;
  readonly lastRejectReason: EgoRejectReason | null;
  /** Son Mahalanobis d²; ölçülemezse `null`. */
  readonly lastMahalanobis: number | null;
  readonly zuptApplied: number;
  /** Aday kaynağının son hükmü. */
  readonly candidateOutcome: CandidateSourceOutcome | null;
  readonly candidateCount: number;
  readonly matchOutcome: HmmDecision['outcome'] | null;
  readonly matchReason: HmmDecision['reason'] | null;
  readonly topologyEvidence: boolean;
  /** Monotonik saat okunabiliyor mu (yoksa hiçbir şey yayınlanmaz). */
  readonly monotonicClock: boolean;
}

const _EMPTY_DIAGNOSTICS: EgoDiagnostics = {
  initialized: false, mode: 'NONE', modeReason: 'NO_FIX_YET', guidanceAllowed: false,
  degradedByTime: false, degradedBySigma: false, sigmaHorizontalM: null, fixAgeMs: null,
  observations: 0, positionUpdatesAccepted: 0, positionUpdatesRejected: 0,
  lastRejectReason: null, lastMahalanobis: null, zuptApplied: 0,
  candidateOutcome: null, candidateCount: 0, matchOutcome: null, matchReason: null,
  topologyEvidence: false, monotonicClock: false,
};

export interface EgoAuthority {
  /** Bir gözlem adımı işler. Tik SAHİBİ DEĞİLDİR — çağıran tetikler. */
  observe(): void;
  /** Kanıtlı ham ego pozu. Yayınlanamıyorsa `null`. */
  getRealtimeEgoPose(): RealtimeEgoPose | null;
  /** Kanıtlı yol-eşleşmiş poz. Ego pozu yoksa `null`. */
  getMatchedRoadPose(): MatchedRoadPose | null;
  getDiagnostics(): EgoDiagnostics;
  reset(): void;
}

export interface EgoAuthorityDeps {
  readonly sensor: EgoSensorPort;
  readonly candidates: RoadCandidateSource;
  readonly noise?: EgoNoiseParams;
  readonly hmm?: HmmParams;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) FABRİKA
   ══════════════════════════════════════════════════════════════════════════ */

export function createEgoAuthority(deps: EgoAuthorityDeps): EgoAuthority {
  const sensor = deps?.sensor ?? UNAVAILABLE_EGO_SENSOR_PORT;
  const candidateSource = deps?.candidates ?? UNAVAILABLE_ROAD_CANDIDATE_SOURCE;
  const noise = deps?.noise ?? DEFAULT_EGO_NOISE;
  const hmmParams = deps?.hmm ?? DEFAULT_HMM_PARAMS;

  let kf: EgoKalmanState | null = null;
  let hmm: HmmState = EMPTY_HMM_STATE;
  let pose: RealtimeEgoPose | null = null;
  let matched: MatchedRoadPose | null = null;
  let diag: EgoDiagnostics = _EMPTY_DIAGNOSTICS;
  /** Aynı fix'in tekrar tekrar işlenmesini engeller (monotonik fix anı). */
  let lastAppliedFixMonoMs: number | null = null;

  function _reset(): void {
    kf = null;
    hmm = EMPTY_HMM_STATE;
    pose = null;
    matched = null;
    diag = _EMPTY_DIAGNOSTICS;
    lastAppliedFixMonoMs = null;
  }

  function _observe(): void {
    let s: EgoSensorSample;
    try {
      s = sensor.read();
    } catch {
      diag = { ..._EMPTY_DIAGNOSTICS, observations: diag.observations + 1 };
      pose = null; matched = null;
      return;
    }

    const now = s.nowMonoMs;
    const observations = diag.observations + 1;

    /* FAIL-CLOSED: monotonik saat yoksa hiçbir yaş/tazelik hesaplanamaz →
       hiçbir poz YAYINLANMAZ (uydurma zaman, uydurma konum demektir). */
    if (now === null) {
      pose = null; matched = null;
      diag = { ..._EMPTY_DIAGNOSTICS, observations, monotonicClock: false };
      return;
    }

    let accepted = diag.positionUpdatesAccepted;
    let rejected = diag.positionUpdatesRejected;
    let zupts = diag.zuptApplied;
    let lastReject: EgoRejectReason | null = diag.lastRejectReason;
    let lastMahalanobis: number | null = diag.lastMahalanobis;

    /* ── 1) TAHMİN ────────────────────────────────────────────────────── */
    if (kf !== null) {
      const dt = (now as number) - (kf.tsMonoMs as number);
      if (dt > 0) kf = predictEgo(kf, dt, s.yawRateRadPerSec, noise);
      kf = reanchorIfNeeded(kf);
    }

    /* ── 2) GNSS KONUM GÜNCELLEMESİ (yalnız YENİ fix için) ────────────── */
    const fixMonoMs = s.fixAgeMs !== null ? (now as number) - s.fixAgeMs : null;
    const isNewFix = fixMonoMs !== null
      && (lastAppliedFixMonoMs === null || fixMonoMs > lastAppliedFixMonoMs);

    if (isNewFix && s.lat !== null && s.lon !== null) {
      if (kf === null) {
        /* İLK FIX — doğruluk kapısı burada da geçerli (kanıtsız başlangıç yok). */
        if (s.accuracyM !== null && s.accuracyM > 0 && s.accuracyM <= GNSS_ACCURACY_REJECT_M) {
          kf = initEgoState({
            lat: s.lat, lon: s.lon, accuracyM: s.accuracyM,
            headingRad: s.gnssHeadingDeg !== null ? (s.gnssHeadingDeg * Math.PI) / 180 : null,
            speedMps: s.gnssSpeedMps ?? s.busSpeedMps,
            tsMonoMs: now,
          });
          if (kf !== null) { accepted++; lastAppliedFixMonoMs = fixMonoMs; }
        } else {
          rejected++;
          lastReject = s.accuracyM === null || s.accuracyM <= 0 ? 'BAD_INPUT' : 'ACCURACY_CEILING';
        }
      } else {
        const r = updateEgoPosition(kf, s.lat, s.lon, s.accuracyM, noise);
        lastMahalanobis = r.mahalanobis;
        if (r.accepted) {
          kf = r.state; accepted++; lastAppliedFixMonoMs = fixMonoMs;
        } else {
          /* REDDEDİLEN ÖLÇÜM BAŞARI SAYILMAZ: durum değişmedi, sayaç arttı. */
          rejected++; lastReject = r.rejectReason;
        }
      }
    }

    /* ── 3) HIZ / ZUPT / YÖN ──────────────────────────────────────────── */
    if (kf !== null) {
      const z = applyZupt(kf, s.busSpeedMps, s.yawRateRadPerSec);
      if (z.accepted) { kf = z.state; zupts++; }
      else if (s.busSpeedMps !== null) {
        /* v2 §3.2: `R_obd_speed = (0.3 m/s)²`. */
        kf = updateEgoSpeed(kf, s.busSpeedMps, 0.3).state;
      } else if (s.gnssSpeedMps !== null) {
        /* v2 §3.2: `R_gnss_speed = (0.5 + 0.05·v)²`. */
        kf = updateEgoSpeed(kf, s.gnssSpeedMps, 0.5 + 0.05 * s.gnssSpeedMps).state;
      }

      if (s.gnssHeadingDeg !== null) {
        /* Yön belirsizliği hıza bağlı: yavaşta GNSS yönü gürültülüdür. */
        const v = kf.x[IDX_V];
        const sigmaDeg = v > 0 ? Math.min(90, 5 + 60 / Math.max(v, 1)) : 90;
        kf = updateEgoHeading(kf, (s.gnssHeadingDeg * Math.PI) / 180, (sigmaDeg * Math.PI) / 180, v).state;
      }
    }

    /* ── 4) MOD HÜKMÜ ─────────────────────────────────────────────────── */
    const sigmaH = kf !== null ? egoSigmaHorizontalM(kf) : null;
    const sigmaHFinite = sigmaH !== null && Number.isFinite(sigmaH) ? sigmaH : null;
    const verdict = decideEgoMode({
      hasEverFixed: kf !== null && s.hasEverFixed,
      fixAgeMs: s.fixAgeMs,
      producer: s.producer,
      hasSpeedSource: s.busSpeedMps !== null || s.gnssSpeedMps !== null,
      sigmaHorizontalM: sigmaHFinite,
    });

    /* ── 5) RealtimeEgoPose ───────────────────────────────────────────── */
    if (kf === null || verdict.mode === 'NONE') {
      pose = null;
      matched = null;
      diag = {
        ..._EMPTY_DIAGNOSTICS, observations, monotonicClock: true,
        mode: verdict.mode, modeReason: verdict.reason,
        guidanceAllowed: verdict.guidanceAllowed,
        degradedByTime: verdict.degradedByTime, degradedBySigma: verdict.degradedBySigma,
        sigmaHorizontalM: sigmaHFinite, fixAgeMs: s.fixAgeMs,
        positionUpdatesAccepted: accepted, positionUpdatesRejected: rejected,
        lastRejectReason: lastReject, lastMahalanobis, zuptApplied: zupts,
      };
      return;
    }

    const { lat, lon } = egoLatLon(kf);
    const conf = egoConfidenceFromSigma(sigmaHFinite);
    const posSource = verdict.mode === 'DR_ONLY' || verdict.mode === 'LAST_KNOWN'
      ? 'DEAD_RECKONING' as const
      : 'GNSS' as const;
    const obsAt = asMonotonic(
      s.fixAgeMs !== null ? Math.max(0, (now as number) - s.fixAgeMs) : (now as number),
    );

    /* Konum bir FÜZYON ÇIKTISIDIR: ham ölçüm değil, deterministik türetme →
       `DERIVED`. "GPS var → güven 1" YASAK; güven yalnız σ'dan gelir. */
    const evPos = (v: number): Evidenced<number> => derivedNav<number>(v, {
      source: posSource, confidence: conf,
      observedAtMonoMs: obsAt, freshnessBudgetMs: LOCATION_STALE_MS,
    });

    const sigmaPsi = egoSigmaHeadingRad(kf);
    const headingConf = Number.isFinite(sigmaPsi)
      ? Math.max(0, Math.min(1, 1 - sigmaPsi / (Math.PI / 2)))
      : 0;
    const sigmaV = egoSigmaSpeedMps(kf);
    const speedConf = Number.isFinite(sigmaV) ? Math.max(0, Math.min(1, 1 - sigmaV / 10)) : 0;

    pose = {
      kind: 'REALTIME_EGO',
      tsMonoMs: now,
      lat: evPos(lat),
      lon: evPos(lon),
      headingDeg: headingConf > 0
        ? derivedNav<number>(((kf.x[IDX_PSI] * 180) / Math.PI + 360) % 360, {
            source: posSource, confidence: headingConf,
            observedAtMonoMs: obsAt, freshnessBudgetMs: LOCATION_STALE_MS,
          })
        : unavailableNav<number>(posSource, 'BELOW_QUALITY_GATE'),
      speedMps: s.busSpeedMps !== null
        ? observedNav<number>(kf.x[IDX_V], {
            source: 'VEHICLE_BUS', confidence: speedConf,
            observedAtMonoMs: obsAt, freshnessBudgetMs: LOCATION_STALE_MS,
          })
        : derivedNav<number>(kf.x[IDX_V], {
            source: posSource, confidence: speedConf,
            observedAtMonoMs: obsAt, freshnessBudgetMs: LOCATION_STALE_MS,
          }),
      mode: verdict.mode,
      horizontalSigmaM: sigmaHFinite,
    };

    /* ── 6) HMM YOL EŞLEŞTİRME (L1 sınırı üzerinden) ──────────────────── */
    let candidateOutcome: CandidateSourceOutcome | null = null;
    let candidateCount = 0;
    let decision: HmmDecision | null = null;

    try {
      const q = candidateSource.query(lat, lon, candidateRadiusM(sigmaHFinite), now);
      candidateOutcome = q.outcome;
      const ranked = rankCandidates(q.candidates);
      candidateCount = ranked.length;
      if (ranked.length > 0) {
        hmm = stepHmm(
          hmm,
          { lat, lon, headingDeg: pose.headingDeg.value, tsMonoMs: now },
          ranked, q.networkDistance, hmmParams,
        );
        decision = decodeHmm(hmm, hmmParams);
      } else {
        /* Aday yok → trellis İLERLETİLMEZ ve önceki eşleşme TAŞINMAZ. */
        hmm = EMPTY_HMM_STATE;
      }
    } catch {
      candidateOutcome = 'SOURCE_UNAVAILABLE';
      hmm = EMPTY_HMM_STATE;
    }

    matched = _buildMatchedPose(pose, decision, candidateOutcome, now);

    diag = {
      initialized: true,
      mode: verdict.mode, modeReason: verdict.reason,
      guidanceAllowed: verdict.guidanceAllowed,
      degradedByTime: verdict.degradedByTime, degradedBySigma: verdict.degradedBySigma,
      sigmaHorizontalM: sigmaHFinite, fixAgeMs: s.fixAgeMs,
      observations, positionUpdatesAccepted: accepted, positionUpdatesRejected: rejected,
      lastRejectReason: lastReject, lastMahalanobis, zuptApplied: zupts,
      candidateOutcome, candidateCount,
      matchOutcome: decision?.outcome ?? null,
      matchReason: decision?.reason ?? null,
      topologyEvidence: decision?.topologyEvidence === true,
      monotonicClock: true,
    };
  }

  return {
    observe: _observe,
    getRealtimeEgoPose: () => pose,
    getMatchedRoadPose: () => matched,
    getDiagnostics: () => diag,
    reset: _reset,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) EŞLEŞME POZU — zorla snap YAPISAL OLARAK imkânsız
   ══════════════════════════════════════════════════════════════════════════ */

function _matchState(
  decision: HmmDecision | null, outcome: CandidateSourceOutcome | null,
): RoadMatchState {
  if (decision !== null && decision.outcome === 'MATCHED') return 'MATCHED';
  if (decision !== null && decision.outcome === 'AMBIGUOUS') return 'MATCH_UNCERTAIN';
  if (decision !== null && decision.outcome === 'INSUFFICIENT_METADATA') return 'MATCH_UNCERTAIN';
  /* Kaynak SAĞLAM ama bu konumda kapsam yoksa araç ağın dışındadır. */
  if (outcome === 'NO_COVERAGE') return 'OFF_NETWORK';
  /* Kaynak yok/ölçülmedi/bozuk → "yol dışındasın" DEMEK YASAK, bilmiyoruz. */
  return 'UNAVAILABLE';
}

function _buildMatchedPose(
  raw: RealtimeEgoPose,
  decision: HmmDecision | null,
  outcome: CandidateSourceOutcome | null,
  now: MonotonicMs,
): MatchedRoadPose {
  const state = _matchState(decision, outcome);
  const isMatched = state === 'MATCHED' && decision?.candidate != null;
  const c = isMatched ? decision!.candidate! : null;
  const conf = isMatched ? decision!.confidence : 0;

  const ev = (v: number | null): Evidenced<number> => (v === null
    ? unavailableNav<number>('MAP_MATCH', 'NO_SOURCE')
    : derivedNav<number>(v, {
        source: 'MAP_MATCH', confidence: conf,
        observedAtMonoMs: now, freshnessBudgetMs: LOCATION_STALE_MS,
      }));

  return {
    kind: 'MATCHED_ROAD',
    tsMonoMs: now,
    matchState: state,
    /* Kenar kimliği YALNIZ `MATCHED` iken taşınır — zorla snap yapısal olarak
       imkânsız. Aday kimliği zaten kanonik `EdgeId`dir (L1 sınırı üretir). */
    edgeId: c !== null ? c.edgeId : null,
    alongEdgeM: ev(c !== null ? c.alongEdgeM : null),
    snappedLat: ev(c !== null ? c.snappedLat : null),
    snappedLon: ev(c !== null ? c.snappedLon : null),
    /* MAP-LOCK KORUMASI: ham poz DAİMA taşınır (F0 sözleşmesi). */
    rawPose: raw,
    lateralOffsetM: c !== null && Number.isFinite(c.perpDistM) ? c.perpDistM : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ÜRETİM TEKİLİ
   ══════════════════════════════════════════════════════════════════════════ */

let _instance: EgoAuthority | null = null;

/**
 * Üretim L2 cephesi (tekil). **Timer kurmaz · abonelik açmaz · hiçbir sensörü
 * başlatmaz** — yalnız `observe()` çağrıldığında senkron okur.
 */
export function getEgoAuthority(): EgoAuthority {
  if (_instance === null) {
    _instance = createEgoAuthority({
      sensor: productionEgoSensorPort,
      candidates: productionRoadCandidateSource,
    });
  }
  return _instance;
}

/** DR süre tavanının dışa açık kopyası (kilit test + LAB için). */
export const EGO_DR_MAX_MS = DR_TOTAL_MAX_MS;

/** @internal testler arası izolasyon. */
export function _resetEgoAuthorityForTest(): void {
  _instance = null;
}
