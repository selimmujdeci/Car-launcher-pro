/**
 * nativeReadinessModel.ts — ARCH-04/F5 · İZİN → YETENEK → HAZIRLIK → İŞLEM merdiveni (SAF).
 *
 * ── BU DOSYA NE DEĞİLDİR ────────────────────────────────────────────────────
 * (1) İZİN YÖNETİCİSİ DEĞİLDİR: izin İSTEMEZ, sormaz, native'e gitmez.
 * (2) OTORİTE DEĞİLDİR: hiçbir domain gerçeğini yazmaz; yalnız verilen kanıtı
 *     sınıflandırır. Girdi yoksa çıktı `UNKNOWN`'dır — sahte DENIED/GRANTED YOK.
 * (3) İKİNCİ SAĞLIK MOTORU DEĞİLDİR: dayanıklılık kelime dağarcığı ARCH-01'den
 *     ödünç alınır (`FULL·DEGRADED·LIMITED·UNAVAILABLE·UNKNOWN`), yeniden
 *     tanımlanmaz.
 *
 * ── PAZARLIKSIZ DÖRT AYRIM ──────────────────────────────────────────────────
 *   PERMISSION_GRANTED   ≠ CAPABILITY_AVAILABLE
 *   CAPABILITY_AVAILABLE ≠ SERVICE_READY
 *   SERVICE_READY        ≠ OPERATION_SUCCESS
 *   FALLBACK_ACTIVE      ≠ PRIMARY_HEALTHY
 *
 * Örnek (görev metni): Konum izni GRANTED ama sağlayıcı yok → GPS READY YOK.
 * Bluetooth izni GRANTED ama companion oturumu yok → Phone READY YOK.
 *
 * I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { NativeAvailability } from './nativeBoundaryContract';

/* ══════════════════════════════════════════════════════════════════════════
 * Sözlük
 * ════════════════════════════════════════════════════════════════════════ */

/** Capacitor `PermissionState` üstkümesi + "ölçülmedi" ayrımı. */
export type NativePermissionState =
  | 'GRANTED' | 'DENIED' | 'PROMPT' | 'RESTRICTED' | 'NOT_APPLICABLE' | 'UNKNOWN';

export type NativeServiceReadiness = 'READY' | 'NOT_READY' | 'UNKNOWN';

export type NativeOperationAllowance = 'ALLOWED' | 'BLOCKED' | 'UNKNOWN';

/**
 * Son işlem sonucu SINIFI. `UNMEASURED` ile `FAILURE` KARIŞTIRILAMAZ:
 * biri "hiç denenmedi", diğeri "denendi ve düştü" der.
 */
export type NativeLastResultClass =
  | 'SUCCESS' | 'FAILURE' | 'REJECTED_STALE' | 'NOT_SUPPORTED' | 'UNMEASURED' | 'UNKNOWN';

/** Yedek yolun durumu — `ACTIVE` asıl yolun sağlıklı olduğunu ASLA göstermez. */
export type NativeFallbackState = 'NONE' | 'AVAILABLE' | 'ACTIVE' | 'UNKNOWN';

/** ARCH-01 dayanıklılık kelime dağarcığı — burada yeniden tanımlanmaz, kullanılır. */
export type NativeResilienceLevel =
  | 'FULL' | 'DEGRADED' | 'LIMITED' | 'UNAVAILABLE' | 'UNKNOWN';

/* ══════════════════════════════════════════════════════════════════════════
 * Girdi / çıktı
 * ════════════════════════════════════════════════════════════════════════ */

export interface NativeReadinessInput {
  readonly domainId: string;
  /** Bu domain izin gerektiriyor mu; gerektirmiyorsa `NOT_APPLICABLE` verilir. */
  readonly permissionState: NativePermissionState;
  /**
   * Yetenek ÖLÇÜMÜ — köprü metodu var mı / native yüzey taşıyor mu.
   * İzinden TÜRETİLMEZ; ölçülmediyse `UNKNOWN`.
   */
  readonly capabilityAvailable: NativeAvailability;
  /**
   * Servisin GERÇEKTEN çalıştığına dair sahibinden gelen kanıt.
   * `null` = ölçülmedi (varsayılan olarak "çalışmıyor" SAYILMAZ, `UNKNOWN` olur).
   */
  readonly serviceEvidence: boolean | null;
  /** Servisin hazır olmasını engelleyen ölçülmüş sebepler (boş = engel ölçülmedi). */
  readonly blockers: readonly string[];
  readonly lastResult: NativeLastResultClass;
  readonly fallback: NativeFallbackState;
  readonly provenance: readonly string[];
}

export interface NativeDomainReadiness {
  readonly domainId: string;
  readonly permissionState: NativePermissionState;
  readonly capabilityAvailable: NativeAvailability;
  readonly serviceReady: NativeServiceReadiness;
  readonly operationAllowed: NativeOperationAllowance;
  readonly lastResult: NativeLastResultClass;
  readonly fallback: NativeFallbackState;
  readonly resilience: NativeResilienceLevel;
  readonly blockers: readonly string[];
  readonly reason: string;
  readonly provenance: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Merdiven
 * ════════════════════════════════════════════════════════════════════════ */

/** İzin bir KAPI'dır: kapalıysa hazırlık düşer, açıksa hazırlık ÜRETMEZ. */
function _permissionBlocks(p: NativePermissionState): boolean {
  return p === 'DENIED' || p === 'RESTRICTED';
}

/**
 * Yetenek → hazırlık. Kural: yetenek AVAILABLE olsa bile sahibinden gelen
 * açık `serviceEvidence === true` yoksa READY YOKTUR.
 */
export function projectServiceReadiness(
  capability: NativeAvailability,
  serviceEvidence: boolean | null,
  permission: NativePermissionState,
  blockers: readonly string[],
): NativeServiceReadiness {
  if (_permissionBlocks(permission)) return 'NOT_READY';
  if (capability === 'UNAVAILABLE') return 'NOT_READY';
  if (serviceEvidence === false) return 'NOT_READY';
  if (blockers.length > 0) return 'NOT_READY';
  if (capability !== 'AVAILABLE') return 'UNKNOWN';
  /* İzin hâlâ bilinmiyorsa hazırlık İDDİA EDİLMEZ (izin gerekmeyen domain
     çağıran tarafından `NOT_APPLICABLE` olarak verilir). */
  if (permission === 'UNKNOWN' || permission === 'PROMPT') return 'UNKNOWN';
  return serviceEvidence === true ? 'READY' : 'UNKNOWN';
}

/**
 * Hazırlık → izin verilen işlem. `SERVICE_READY ≠ OPERATION_SUCCESS`:
 * bu fonksiyon işlemin BAŞARILI olacağını DEĞİL, denenmesine izin
 * verildiğini söyler. Geçmiş `lastResult` hazırlığı YÜKSELTMEZ.
 */
export function projectOperationAllowance(
  readiness: NativeServiceReadiness,
  permission: NativePermissionState,
  blockers: readonly string[],
): NativeOperationAllowance {
  if (_permissionBlocks(permission)) return 'BLOCKED';
  if (blockers.length > 0) return 'BLOCKED';
  if (readiness === 'NOT_READY') return 'BLOCKED';
  return readiness === 'READY' ? 'ALLOWED' : 'UNKNOWN';
}

/**
 * Dayanıklılık seviyesi. **Yedek yol aktifken ASLA `FULL` dönmez** —
 * sahte "tam sağlıklı" üretmek bu projenin defalarca ödediği kusur sınıfıdır.
 */
export function projectResilience(
  readiness: NativeServiceReadiness,
  fallback: NativeFallbackState,
  capability: NativeAvailability,
): NativeResilienceLevel {
  if (fallback === 'ACTIVE') {
    /* Yedek taşıyor: asıl yol hazır görünse bile TAM sağlıklı DEĞİLDİR. */
    return readiness === 'READY' ? 'DEGRADED' : 'LIMITED';
  }
  if (readiness === 'READY') return 'FULL';
  if (capability === 'UNAVAILABLE') {
    return fallback === 'AVAILABLE' ? 'LIMITED' : 'UNAVAILABLE';
  }
  return 'UNKNOWN';
}

const EMPTY: readonly string[] = Object.freeze([]);

export function projectDomainReadiness(input: NativeReadinessInput): NativeDomainReadiness {
  const blockers = Object.freeze([...input.blockers]);
  const serviceReady = projectServiceReadiness(
    input.capabilityAvailable, input.serviceEvidence, input.permissionState, blockers);
  const operationAllowed = projectOperationAllowance(serviceReady, input.permissionState, blockers);
  const resilience = projectResilience(serviceReady, input.fallback, input.capabilityAvailable);
  return Object.freeze({
    domainId: input.domainId,
    permissionState: input.permissionState,
    capabilityAvailable: input.capabilityAvailable,
    serviceReady,
    operationAllowed,
    lastResult: input.lastResult,
    fallback: input.fallback,
    resilience,
    blockers,
    reason: _reason(input, serviceReady),
    provenance: Object.freeze([...input.provenance]),
  });
}

function _reason(input: NativeReadinessInput, readiness: NativeServiceReadiness): string {
  if (_permissionBlocks(input.permissionState)) {
    return `izin ${input.permissionState} — hazırlık DÜŞER`;
  }
  if (input.capabilityAvailable === 'UNAVAILABLE') {
    return 'köprü/yetenek yok — izin durumu bunu DEĞİŞTİRMEZ';
  }
  if (input.blockers.length > 0) {
    return `engel: ${input.blockers.join(', ')}`;
  }
  if (readiness === 'READY') {
    return input.fallback === 'ACTIVE'
      ? 'asıl yol hazır ama yedek de aktif — TAM SAĞLIKLI DEĞİL'
      : 'sahibinden gelen açık hazırlık kanıtı var';
  }
  if (input.permissionState === 'GRANTED' && input.serviceEvidence !== true) {
    return 'İZİN VERİLDİ ≠ HAZIR — sahibinden çalışma kanıtı YOK';
  }
  return 'ölçüm yok — KAYNAK YOK (sahte hazır/değil üretilmedi)';
}

/** Ölçüm hiç yapılamamış domain için dürüst boş satır. */
export function unmeasuredDomainReadiness(
  domainId: string, provenance: readonly string[] = EMPTY,
): NativeDomainReadiness {
  return projectDomainReadiness({
    domainId,
    permissionState: 'UNKNOWN',
    capabilityAvailable: 'UNKNOWN',
    serviceEvidence: null,
    blockers: EMPTY,
    lastResult: 'UNMEASURED',
    fallback: 'UNKNOWN',
    provenance,
  });
}

/** Capacitor `PermissionState` string'ini sözlüğe çevirir — bilinmeyen → `UNKNOWN`. */
export function normalizePermissionState(raw: unknown): NativePermissionState {
  if (typeof raw !== 'string') return 'UNKNOWN';
  switch (raw) {
    case 'granted': return 'GRANTED';
    case 'denied': return 'DENIED';
    case 'prompt': case 'prompt-with-rationale': return 'PROMPT';
    case 'limited': case 'restricted': return 'RESTRICTED';
    default: return 'UNKNOWN';
  }
}
