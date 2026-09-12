/**
 * enforcementPointsSources.ts — CAROS LAB · Denetim Noktası Verisi TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, kendi try/catch'i içinde.
 * HİÇBİR şey başlatmaz/durdurmaz, paket İNDİRMEZ, Guardian tik'ini tetiklemez,
 * ağa çıkmaz, timer kurmaz.
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6) ────────────────────────
 * KOORDİNAT ve NOKTA ETİKETİ bu katmandan GEÇMEZ. Aracın konumu, en yakın
 * noktanın konumu ve kaynağın serbest metin açıklaması TAŞINMAZ — yalnız
 * SAYILAR, DURUMLAR ve MESAFE geçer. (Mesafe skaler bir türevdir, konum değil.)
 */

import {
  getEnforcementSourceStatus, getEnforcementQueryCounters,
  ENFORCEMENT_PACKAGE_URL, type EnforcementSourceStatus,
} from '../navigation/enforcement/enforcementPointsSource';
import {
  getEnforcementGateCounters, type EnforcementGateCounters,
} from '../navigation/guardian/providers/concrete/enforcementMapSource';
import {
  GUARDIAN_ENFORCEMENT_RADIUS_M,
  GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M,
  GUARDIAN_ENFORCEMENT_AHEAD_HALF_ANGLE_DEG,
  GUARDIAN_ENFORCEMENT_MIN_HEADING_SPEED_MPS,
  GUARDIAN_ENFORCEMENT_MAX_FIX_AGE_MS,
  GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
  GUARDIAN_ENFORCEMENT_SEVERITY,
} from '../navigation/guardian/runtime/guardianEnforcementPolicy';

export interface EnforcementPointsRawSnapshot {
  readonly readAt:          number;
  readonly status:          EnforcementSourceStatus;
  readonly queryCount:      number;
  readonly hitCount:        number;
  readonly gates:           EnforcementGateCounters;
  /** Paketin cihazdaki yolu — indirilmez, yalnız gösterilir. */
  readonly packageUrl:      string;
  /* Politika değerleri — eşiği görmeden düşüş sayısı yorumlanamaz. */
  readonly radiusM:                number;
  readonly maxUncertaintyM:        number;
  readonly aheadHalfAngleDeg:      number;
  readonly minHeadingSpeedMps:     number;
  readonly maxFixAgeMs:            number;
  readonly minConfidence:          number;
  readonly severityUnspecified:    string;
}

const _FALLBACK_STATUS: EnforcementSourceStatus = {
  loadState: 'IDLE', fetchedAt: null, pointCount: null, queryablePointCount: null,
  typeCounts: null, sourceId: null, schemaVersion: null, droppedPointCount: null,
  failureKind: null, loadedAtWallMs: null, loadDurationMs: null,
};

const _FALLBACK_GATES: EnforcementGateCounters = {
  readCount: 0, emittedCount: 0, packageNotReady: 0, noLocation: 0,
  staleFix: 0, noSpeed: 0, uncertainPosition: 0, headingUnavailable: 0,
  noPointAhead: 0, lastGate: null, lastUncertaintyM: null, lastDistanceM: null,
};

function _nowWall(): number {
  try { return Date.now(); } catch { return 0; }
}

/** Tek okuma — her alt okuma kendi try/catch'inde; biri düşerse diğerleri kalır. */
export function readEnforcementPointsSnapshot(): EnforcementPointsRawSnapshot {
  let status = _FALLBACK_STATUS;
  try { status = getEnforcementSourceStatus(); } catch { /* fail-soft */ }

  let queryCount = 0;
  let hitCount = 0;
  try {
    const c = getEnforcementQueryCounters();
    queryCount = c.queryCount;
    hitCount = c.hitCount;
  } catch { /* fail-soft */ }

  let gates = _FALLBACK_GATES;
  try { gates = getEnforcementGateCounters(); } catch { /* fail-soft */ }

  return {
    readAt: _nowWall(),
    status,
    queryCount,
    hitCount,
    gates,
    packageUrl:             ENFORCEMENT_PACKAGE_URL,
    radiusM:                GUARDIAN_ENFORCEMENT_RADIUS_M,
    maxUncertaintyM:        GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M,
    aheadHalfAngleDeg:      GUARDIAN_ENFORCEMENT_AHEAD_HALF_ANGLE_DEG,
    minHeadingSpeedMps:     GUARDIAN_ENFORCEMENT_MIN_HEADING_SPEED_MPS,
    maxFixAgeMs:            GUARDIAN_ENFORCEMENT_MAX_FIX_AGE_MS,
    minConfidence:          GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
    severityUnspecified:    String(GUARDIAN_ENFORCEMENT_SEVERITY.unspecified ?? 'TANIMSIZ'),
  };
}
