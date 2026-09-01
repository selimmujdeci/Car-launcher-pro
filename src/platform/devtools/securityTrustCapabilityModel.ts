/**
 * securityTrustCapabilityModel — ARCH-05 LAB projeksiyonu.
 *
 * SALT-OKUNUR ve İKİNCİ OTORİTE DEĞİL: hüküm, eşik ve yetki burada
 * HESAPLANMAZ; `security/authorization` (karar kuralı) ile
 * `security/enforcement` (politika sabitleri) OKUNUR. Bu ekranda hesaplanan
 * hiçbir değer üretim kararına geri BESLENMEZ.
 *
 * GİZLİLİK: ham cihaz kimliği, kişi kimliği, token, VIN, konum, ham komut ve
 * yük bu modele GİRMEZ. `SecurityDecisionEvidence` zaten sınırlı ve
 * maskelenmiş bir projeksiyondur; buraya yalnız o taşınır.
 */

import { CAPABILITIES, getRecentSecurityDecisions } from '../security/authorization';
import {
  CAPABILITY_STATUS, UNMODELLED_CAPABILITIES, principalGrantMatrix,
  readSecurityContext,
} from '../security/enforcement';

export function getSecurityTrustCapabilityLabModel() {
  /* Bağlam okunamazsa satır UYDURULMAZ — `UNKNOWN` dürüst cevaptır. */
  let context: { vehicleRef: string | null; motion: string };
  try {
    const ctx = readSecurityContext();
    context = { vehicleRef: ctx.vehicleRef, motion: ctx.motion };
  } catch { context = { vehicleRef: null, motion: 'UNKNOWN' }; }

  let decisions: ReturnType<typeof getRecentSecurityDecisions> = [];
  try { decisions = getRecentSecurityDecisions(); } catch { decisions = []; }

  let grants: readonly { principal: string; capabilities: readonly string[] }[] = [];
  try {
    grants = Object.freeze(Object.entries(principalGrantMatrix()).map(([principal, caps]) =>
      Object.freeze({ principal, capabilities: Object.freeze([...caps] as string[]) })));
  } catch { grants = []; }

  return Object.freeze({
    /* Yetenek sözleşmesi + ÜRÜNDEKİ dürüst durum (SUPPORTED_GATED ·
       DENY_DEFAULT · NOT_SUPPORTED). "Bilinmiyor → izinli" YOKTUR. */
    capabilities: Object.freeze(Object.values(CAPABILITIES).map(
      ({ id, owner, riskClass, requiresAuthenticatedPrincipal, requiresAttachedSession, requiresVehicleScope, parkedOnly, requiresNativePermission }) =>
        Object.freeze({
          id, owner, riskClass,
          requiresAuthenticatedPrincipal, requiresAttachedSession,
          requiresVehicleScope, parkedOnly, requiresNativePermission,
          status: CAPABILITY_STATUS[id] ?? 'NOT_SUPPORTED',
        }))),
    /* Sözleşmede KARŞILIĞI OLMAYAN yetenek adları — sessizce gizlenmez. */
    unmodelled: Object.freeze(Object.entries(UNMODELLED_CAPABILITIES).map(
      ([id, status]) => Object.freeze({ id, status }))),
    /* Hangi çağıran sınıfı NEYİ alabilir — politikanın tamamı tek ekranda. */
    grants,
    context,
    decisions,
    /* Kural 4: LAB aktif komut GÖNDERMEZ ve yetki ÜRETEMEZ. */
    readOnly: true,
  });
}
