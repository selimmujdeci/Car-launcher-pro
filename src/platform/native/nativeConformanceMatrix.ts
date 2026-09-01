/**
 * nativeConformanceMatrix.ts — ARCH-04/F5 · UYGUNLUK MATRİSİNİ GERÇEK KANITLA DOLDURUR.
 *
 * F1'deki `assessNativeBoundaryConformance()` SAF ve künye-tabanlıdır: "bu
 * yetenek için bir oturum mührü TANIMLI mı" diye sorar. Bu dosya bir adım
 * öteye geçer ve ÜRETİMDE ÖLÇÜLEN kanıdı sorar: mühür gerçekten uygulanıyor
 * mu, köprü bu APK'da VAR mı, gizlilik kapısı fiilen tutuyor mu.
 *
 * ── KRİTİK SATIRDA SAHTE PASS YASAK ────────────────────────────────────────
 * `PASS` yalnız kanıtın tamamı geldiğinde verilir. Kanıt eksikse `UNKNOWN`,
 * kanıt eksik ama sınır zaten kısmen kuruluysa `PARTIAL` yazılır. Bir
 * `UNKNOWN`, "kanıt yok" mu yoksa "uygulama açığı" mı olduğunu ayrıca söyler.
 */

import {
  assessNativeBoundaryConformance, getNativeCapabilityDescriptors,
  type NativeBoundaryConformance, type NativeCapabilityDescriptor,
  type NativeConformanceStatus,
} from './nativeBoundaryContract';
import {
  readNativeHalEvidence, type NativeHalSnapshot, type NativeSourceEvidence,
  type NativeSourceId,
} from './nativeHalEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Yetenek → kaynak eşlemesi
 * ════════════════════════════════════════════════════════════════════════ */

const CAPABILITY_SOURCE: Readonly<Record<string, NativeSourceId>> = Object.freeze({
  'gps.location': 'GPS',
  'obd.diagnostic_pdu': 'OBD',
  'media.playback': 'MEDIA',
  'foreground.location_service': 'FOREGROUND_SERVICE',
  'phone.session': 'PHONE_LINK',
  'can.acquire': 'CAN',
  'safe_storage.atomic_write': 'SAFE_STORAGE',
  'hardware.media_action': 'HARDWARE_MEDIA',
});

/** Kritik satırlar — bu satırlarda kanıtsız `PASS` YASAKTIR. */
export const CRITICAL_CAPABILITY_IDS: readonly string[] = Object.freeze([
  'gps.location', 'obd.diagnostic_pdu', 'media.playback',
  'foreground.location_service', 'phone.session', 'can.acquire',
  'safe_storage.atomic_write', 'hardware.media_action',
]);

/** Bir `UNKNOWN`ın sebebi: kanıt mı eksik, uygulama mı eksik. */
export type ConformanceGapKind = 'NONE' | 'EVIDENCE_MISSING' | 'IMPLEMENTATION_GAP';

export interface NativeConformanceRow {
  readonly capabilityId: string;
  readonly domain: string;
  readonly owner: string;
  readonly bridge: string;
  readonly ownerKnown: boolean;
  readonly bridgeKnown: boolean;
  readonly resultSemanticsKnown: boolean;
  /** Bayat koruma ÖLÇÜLDÜ mü (künye değil, üretim kanıtı). */
  readonly staleGuardObserved: boolean;
  readonly permissionSemanticsKnown: boolean;
  readonly fallbackSemanticsKnown: boolean;
  readonly privacyGuard: boolean;
  readonly authorityBypassRisk: boolean;
  readonly status: NativeConformanceStatus;
  readonly gap: ConformanceGapKind;
  readonly evidence: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Hüküm (SAF — kanıt ENJEKTE edilir)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tek satırın hükmü. `source` `null` ise kaynak hiç okunamadı: bu bir
 * BAŞARISIZLIK değil, KANIT EKSİKLİĞİDİR ve öyle etiketlenir.
 */
export function assessConformanceRow(
  descriptor: NativeCapabilityDescriptor,
  source: NativeSourceEvidence | null,
  staticVerdict: NativeBoundaryConformance,
): NativeConformanceRow {
  const ownerKnown = descriptor.owner.length > 0 && !descriptor.owner.includes('Plugin');
  const bridgeKnown = descriptor.bridge.length > 0;
  const capabilityMeasured = source !== null
    && source.readiness.capabilityAvailable !== 'UNKNOWN';
  const staleGuardObserved = source !== null && source.staleGuard === true;
  /* İzin anlamı BİLİNİR: ya izin gerekmediği açıkça beyan edilmiş
     (`NOT_APPLICABLE`) ya da izin durumu GERÇEKTEN ölçülmüş. */
  const permissionSemanticsKnown = source !== null
    && source.readiness.permissionState !== 'UNKNOWN';
  const fallbackSemanticsKnown = source !== null
    && source.readiness.fallback !== 'UNKNOWN';
  /* Gizlilik: hassas sınıf yetenekler ham içerik taşımayan kanıt yüzeyinden
     geçmek ZORUNDA; `REFERENCE_ONLY`/`NONE` zaten yapısal olarak güvenlidir. */
  const privacyGuard = descriptor.privacy !== 'SENSITIVE' || source !== null;
  const authorityBypassRisk = staticVerdict.authorityBypass;

  const allKnown = ownerKnown && bridgeKnown && staleGuardObserved
    && permissionSemanticsKnown && fallbackSemanticsKnown && privacyGuard
    && !authorityBypassRisk;

  let status: NativeConformanceStatus;
  let gap: ConformanceGapKind;
  if (allKnown && capabilityMeasured) {
    status = 'PASS';
    gap = 'NONE';
  } else if (!ownerKnown || !bridgeKnown || authorityBypassRisk) {
    /* Sahip/köprü belirsiz veya atlatma riski var → UYGULAMA AÇIĞI. */
    status = 'UNKNOWN';
    gap = 'IMPLEMENTATION_GAP';
  } else if (source === null) {
    status = 'UNKNOWN';
    gap = 'EVIDENCE_MISSING';
  } else {
    status = 'PARTIAL';
    gap = capabilityMeasured ? 'EVIDENCE_MISSING' : 'EVIDENCE_MISSING';
  }

  return Object.freeze({
    capabilityId: descriptor.id,
    domain: descriptor.domain,
    owner: descriptor.owner,
    bridge: descriptor.bridge,
    ownerKnown,
    bridgeKnown,
    resultSemanticsKnown: staticVerdict.resultSemanticsKnown || source !== null,
    staleGuardObserved,
    permissionSemanticsKnown,
    fallbackSemanticsKnown,
    privacyGuard,
    authorityBypassRisk,
    status,
    gap,
    evidence: source === null
      ? 'kaynak okunamadı — KAYNAK YOK'
      : `readiness=${source.readiness.serviceReady}; op=${source.readiness.operationAllowed}; `
        + `resilience=${source.readiness.resilience}; lastResult=${source.lastResultClass}; `
        + `staleRejected=${source.staleRejectedCount ?? 'UNKNOWN'}`,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Matris
 * ════════════════════════════════════════════════════════════════════════ */

export interface NativeConformanceMatrix {
  readonly rows: readonly NativeConformanceRow[];
  readonly pass: number;
  readonly partial: number;
  readonly unknown: number;
  readonly implementationGaps: readonly string[];
  readonly evidenceGaps: readonly string[];
  readonly criticalRowsWithFakePass: readonly string[];
}

export function buildNativeConformanceMatrix(
  hal: NativeHalSnapshot = readNativeHalEvidence(),
): NativeConformanceMatrix {
  const rows = getNativeCapabilityDescriptors().map((descriptor) => {
    const sourceId = CAPABILITY_SOURCE[descriptor.id];
    const source = sourceId === undefined
      ? null
      : hal.sources.find((s) => s.sourceId === sourceId) ?? null;
    return assessConformanceRow(descriptor, source, assessNativeBoundaryConformance(descriptor));
  });
  return Object.freeze({
    rows: Object.freeze(rows),
    pass: rows.filter((r) => r.status === 'PASS').length,
    partial: rows.filter((r) => r.status === 'PARTIAL').length,
    unknown: rows.filter((r) => r.status === 'UNKNOWN').length,
    implementationGaps: Object.freeze(
      rows.filter((r) => r.gap === 'IMPLEMENTATION_GAP').map((r) => r.capabilityId)),
    evidenceGaps: Object.freeze(
      rows.filter((r) => r.gap === 'EVIDENCE_MISSING').map((r) => r.capabilityId)),
    /* Kritik satırda kanıtsız PASS — YAPISAL OLARAK BOŞ olmalı. */
    criticalRowsWithFakePass: Object.freeze(rows
      .filter((r) => r.status === 'PASS' && CRITICAL_CAPABILITY_IDS.includes(r.capabilityId)
        && (!r.staleGuardObserved || !r.permissionSemanticsKnown || r.authorityBypassRisk))
      .map((r) => r.capabilityId)),
  });
}
