/**
 * phoneLinkRole.ts — PHONE LINK F3.0 · Rol türetme otoritesi (PRIMARY kapısı).
 *
 * ── DÜZELTİLEN İHLAL ─────────────────────────────────────────────────────────
 * F1/F2'de rol `phoneHubUserModel.deriveTrustLevel() === 'TRUSTED'` hükmünden
 * türetiliyordu. Bu hüküm "bu telefon native `PhoneHubTrustStore`'un kayıtlı
 * güvenilen parmak izidir" der — yani CİHAZ GÜVENİ. Onu PRIMARY'ye çevirmek
 *
 *     TRUSTED DEVICE  ≠  PRIMARY DRIVER
 *
 * kuralını ihlal eder. Kriptografik olarak güvenilen bir telefon güvenilir bir
 * CİHAZ olabilir; SÜRÜCÜNÜN KİMLİĞİ DEĞİLDİR (telefon ödünç verilebilir,
 * çalınabilir, yolcuda olabilir).
 *
 * Bu, deponun KENDİ kanonik otoritesinin zaten yazdığı kuraldır
 * (`fleet/driverAuthentication.ts`):
 *   · "Eşleşmiş bir telefonun araçta olması, SAHİBİNİN araçta olduğunu
 *      kanıtlamaz."
 *   · `sourceAuthenticationCeiling('PHONE' | 'BLUETOOTH') === 'PARTIAL'`
 *     → telefon/BT kaynağı TASARIM GEREĞİ kimlik kanıtı sayılmaz.
 *
 * ── YENİ OTORİTE KURULMADI ───────────────────────────────────────────────────
 * Bu modül kendi kişi/sürücü otoritesini İCAT ETMEZ. Yalnız MEVCUT kanonik
 * `readDriverAuthentication()` hükmünü OKUR ve iki kapıyı sorar.
 *
 * ── İKİ KAPI (İKİSİ DE ZORUNLU) ──────────────────────────────────────────────
 *  1) KİŞİ KANITI    — kanonik doğrulama `AUTHENTICATED` + `usable` + `driverId`
 *                      (bu yalnız `VERIFIED` seviyeyle, yani NFC/PIN ile olur).
 *  2) CİHAZ↔KİŞİ BAĞI — "kanıtlanan kişi ŞU ANKİ telefonun sahibidir" hükmü.
 *
 * (2) için depoda KANONİK BİR OTORİTE YOKTUR: `DriverAuthentication` hiçbir
 * cihaz/parmak izi alanı TAŞIMAZ (bilinçli gizlilik kararı). Bu bağ F3
 * kapsamında hazır olmadığı için — ve F3 yeni bir person/driver otoritesi
 * kurmayı YASAKLADIĞI için — sonuç FAIL-CLOSED'dur:
 *
 *     linked trusted phone  →  GUEST
 *
 * PRIMARY bu fazda YAPISAL OLARAK ulaşılamazdır. Bu bir eksiklik değil,
 * kanıtın gerçekten yok olmasının dürüst karşılığıdır. (2) için kanonik bir
 * bağ eklendiği gün BURAYA tek bir kapı bağlanır; başka hiçbir yer
 * değişmez.
 */

import { readDriverAuthentication } from '../fleet/driverAuthentication';
import type { PhoneAttachmentState } from './phoneLinkAttachment';

/** F1 minimum rol modeli. Tam bir RoleArbiter DEĞİLDİR. */
export type PhoneLinkRole = 'GUEST' | 'PRIMARY';

/**
 * Rolün NEDEN o rol olduğu — sessiz düşüş YOK. LAB/UI bunu gösterebilir;
 * hiçbir sır (driverId, fingerprint, token) TAŞIMAZ.
 */
export type PhoneLinkRoleReason =
  /** Oturum kriptografik olarak kurulmamış → rol sorulamaz. */
  | 'link_not_active'
  /** Kanonik sürücü doğrulama otoritesinde kayıt yok. */
  | 'no_driver_authentication'
  /** Kayıt var ama kanıt sayılmıyor (PARTIAL/expired/araç bağı yok). */
  | 'driver_authentication_not_proof'
  /** Kişi kanıtlandı ama "bu telefon O kişinin" diyen kanonik bağ YOK. */
  | 'no_device_person_binding'
  /** Her iki kapı da geçildi. */
  | 'driver_identity_proven';

export interface PhoneLinkRoleEvidence {
  readonly role: PhoneLinkRole;
  readonly reason: PhoneLinkRoleReason;
}

const GUEST_LINK_NOT_ACTIVE: PhoneLinkRoleEvidence = Object.freeze({
  role: 'GUEST', reason: 'link_not_active',
});

/**
 * KAPI 2 — "kanıtlanan kişi ŞU ANKİ bağlı telefonun sahibidir" hükmü.
 *
 * Böyle bir kanonik otorite YOKTUR (bkz. dosya üstü not): `DriverAuthentication`
 * cihaz alanı taşımaz ve F3 yeni bir person/device otoritesi kurmayı yasaklar.
 * Kanıt yoksa `false` — "herhalde aynı kişidir" VARSAYILMAZ.
 *
 * Bu fonksiyon bilerek AYRI ve İSİMLİDİR: eksik olanın TAM OLARAK NE olduğunu
 * kodda görünür kılar ve gelecekteki kanonik bağın tek bağlanma noktasıdır.
 */
function hasCanonicalDevicePersonBinding(
  _driverId: string, _deviceFingerprint: string | null,
): boolean {
  return false;
}

/**
 * Kanonik rol kararı. FAIL-CLOSED: her belirsizlik `GUEST`tir.
 *
 * `nowMs` ve `deviceFingerprint` açık girdidir — bu fonksiyon kendi saatini
 * veya kendi cihaz görüşünü ÜRETMEZ.
 */
export function derivePhoneLinkRole(input: {
  readonly attachmentState: PhoneAttachmentState;
  readonly deviceFingerprint: string | null;
  readonly nowMs: number;
}): PhoneLinkRoleEvidence {
  if (input.attachmentState !== 'ACTIVE') return GUEST_LINK_NOT_ACTIVE;

  /* KAPI 1 — kanonik kişi kanıtı. Karar BİZE ait değil; yalnız okunur. */
  let resolution;
  try {
    resolution = readDriverAuthentication(input.nowMs).resolution;
  } catch {
    /* Otorite okunamadıysa kanıt YOKTUR — fail-closed. */
    return Object.freeze({ role: 'GUEST', reason: 'no_driver_authentication' });
  }

  if (resolution.decision === 'NO_AUTHENTICATION') {
    return Object.freeze({ role: 'GUEST', reason: 'no_driver_authentication' });
  }
  if (!resolution.usable || resolution.decision !== 'AUTHENTICATED' || resolution.driverId === null) {
    return Object.freeze({ role: 'GUEST', reason: 'driver_authentication_not_proof' });
  }

  /* KAPI 2 — cihaz↔kişi bağı. F3'te kanonik karşılığı YOK → fail-closed. */
  if (!hasCanonicalDevicePersonBinding(resolution.driverId, input.deviceFingerprint)) {
    return Object.freeze({ role: 'GUEST', reason: 'no_device_person_binding' });
  }

  return Object.freeze({ role: 'PRIMARY', reason: 'driver_identity_proven' });
}
