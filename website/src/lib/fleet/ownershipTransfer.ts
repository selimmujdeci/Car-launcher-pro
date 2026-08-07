/**
 * ownershipTransfer.ts — ARAÇ SAHİPLİĞİ DEVRİ · İSTEMCİ SÖZLEŞMESİ (saf).
 *
 * Sunucu otoritesi migration 039'dadır (`start/accept/reject/cancel_vehicle_transfer`).
 * Bu dosya UI'nin ihtiyaç duyduğu **saf** karar mantığını taşır:
 * hangi eylem kime görünür, hangi durum ne anlama gelir, hangi metin yazılır.
 *
 * ANAYASA:
 *   · Devir ÇEVRİMDIŞI YAPILAMAZ — sahiplik değişimi kuyruğa alınamaz.
 *   · "Tamamlandı" YALNIZ sunucu COMPLETED dönerse yazılır.
 *   · UI görünürlüğü güvenlik DEĞİLDİR; sunucu her çağrıda ayrıca doğrular.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

import type { FleetRole } from './roles';

/* ── Sahiplik türü ─────────────────────────────────────────────────────── */

export const OWNER_TYPES = ['INDIVIDUAL', 'COMPANY'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export function isOwnerType(value: unknown): value is OwnerType {
  return typeof value === 'string' && (OWNER_TYPES as readonly string[]).includes(value);
}

/**
 * Aracın GERÇEK sahiplik türü.
 *
 * `vehicle_pairings` ve cihaz kimliği (api_key) SAHİPLİK DEĞİLDİR —
 * bu fonksiyon yalnız `owner_id` / `company_id` alanlarına bakar.
 */
export function ownerTypeOf(vehicle: {
  owner_id: string | null;
  company_id: string | null;
}): OwnerType | 'UNOWNED' | 'INVALID' {
  const hasOwner   = !!vehicle.owner_id;
  const hasCompany = !!vehicle.company_id;
  // İkisi birden dolu olamaz — sunucu kısıtı bunu engeller; istemci de
  // sessizce bir tarafı seçmez, açıkça INVALID der.
  if (hasOwner && hasCompany) return 'INVALID';
  if (hasCompany) return 'COMPANY';
  if (hasOwner)   return 'INDIVIDUAL';
  return 'UNOWNED';
}

/* ── Transfer durumu ───────────────────────────────────────────────────── */

export const TRANSFER_STATUSES = [
  'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'FAILED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** Hâlâ sonuç bekleyen tek durum. */
export function isActiveTransfer(status: TransferStatus): boolean {
  return status === 'PENDING';
}

/** Sahiplik GERÇEKTEN değişti mi — yalnız COMPLETED. */
export function isOwnershipChanged(status: TransferStatus): boolean {
  return status === 'COMPLETED';
}

export interface TransferRecord {
  id:              string;
  vehicleId:       string;
  fromOwnerType:   OwnerType;
  toOwnerType:     OwnerType;
  status:          TransferStatus;
  createdAt:       number;
  expiresAt:       number;
  requestedByMe:   boolean;
  /** Çağıran kullanıcı bu transferin HEDEF tarafında mı. */
  targetedAtMe:    boolean;
  failureCode:     string | null;
}

/* ── Eylem görünürlüğü ─────────────────────────────────────────────────── */

export const TRANSFER_ACTIONS = ['ACCEPT', 'REJECT', 'CANCEL'] as const;
export type TransferAction = (typeof TRANSFER_ACTIONS)[number];

export interface ActorContext {
  /** Çağıranın filo rolü (şirket hedefli transferlerde kabul yetkisi için). */
  role:     FleetRole;
  /** Ağ durumu — devir işlemleri ÇEVRİMDIŞI yapılamaz. */
  online:   boolean;
}

/**
 * Bir transfer için kullanıcıya gösterilecek eylemler.
 *
 * FAIL-CLOSED: aktif olmayan transferde hiçbir eylem yoktur; çevrimdışıyken
 * hiçbir eylem gösterilmez (kuyruğa alınamayacak bir şey "yapılabilir"
 * gösterilmemelidir).
 */
export function availableActions(
  transfer: TransferRecord,
  actor: ActorContext,
): readonly TransferAction[] {
  if (!isActiveTransfer(transfer.status)) return [];
  if (!actor.online) return [];

  const actions: TransferAction[] = [];

  // Kabul/ret YALNIZ hedef tarafın hakkıdır.
  if (transfer.targetedAtMe) {
    // Şirket hedefinde kabul yetkisi admin'dedir (sunucu da doğrular).
    const canAccept = transfer.toOwnerType === 'INDIVIDUAL' || actor.role === 'admin';
    if (canAccept) { actions.push('ACCEPT'); actions.push('REJECT'); }
  }

  // İptal gönderen tarafın hakkıdır.
  if (transfer.requestedByMe) actions.push('CANCEL');

  return actions;
}

/** Transferin süresi doldu mu (görsel uyarı için; otorite sunucudadır). */
export function isExpired(transfer: TransferRecord, now: number): boolean {
  return transfer.status === 'PENDING' && transfer.expiresAt <= now;
}

/**
 * Kalan süre kovası — LAB'a **tam zaman damgası taşınmaz**, yalnız kaba kova.
 * Böylece gözlem yüzeyi kullanıcı davranışını zaman üzerinden izlenebilir kılmaz.
 */
export type ExpiryBucket = 'EXPIRED' | 'UNDER_5_MIN' | 'UNDER_1_HOUR' | 'OVER_1_HOUR';

export function expiryBucket(transfer: TransferRecord, now: number): ExpiryBucket {
  const remaining = transfer.expiresAt - now;
  if (remaining <= 0)          return 'EXPIRED';
  if (remaining <= 5 * 60_000) return 'UNDER_5_MIN';
  if (remaining <= 60 * 60_000) return 'UNDER_1_HOUR';
  return 'OVER_1_HOUR';
}

/* ── Başlatma ön kontrolü ──────────────────────────────────────────────── */

export type TransferBlockReason =
  | 'OFFLINE'
  | 'NOT_OWNER'
  | 'UNOWNED_VEHICLE'
  | 'INVALID_OWNERSHIP'
  | 'SAME_OWNER'
  | 'ACTIVE_TRANSFER_EXISTS'
  | 'UNKNOWN_REVISION';

export interface StartTransferCheck {
  allowed: boolean;
  reason:  TransferBlockReason | null;
}

/**
 * Devir başlatılabilir mi — **istemci ön kontrolü**.
 *
 * Bu bir güvenlik kapısı DEĞİLDİR (sunucu ayrıca doğrular); amacı kullanıcıya
 * dürüst geri bildirim vermek ve başarısız olacağı belli bir çağrıyı hiç
 * yapmamaktır. Belirsiz her durumda `allowed:false` (fail-closed).
 */
export function canStartTransfer(input: {
  vehicle:         { owner_id: string | null; company_id: string | null; revision: number | null };
  viewerUserId:    string | null;
  viewerCompanyId: string | null;
  viewerRole:      FleetRole;
  targetType:      OwnerType;
  targetId:        string | null;
  hasActiveTransfer: boolean;
  online:          boolean;
}): StartTransferCheck {
  if (!input.online)            return { allowed: false, reason: 'OFFLINE' };
  if (input.hasActiveTransfer)  return { allowed: false, reason: 'ACTIVE_TRANSFER_EXISTS' };

  // Optimistic concurrency için revizyon ZORUNLUDUR; bilinmiyorsa gönderme.
  if (input.vehicle.revision === null || !Number.isFinite(input.vehicle.revision)) {
    return { allowed: false, reason: 'UNKNOWN_REVISION' };
  }

  const ownerType = ownerTypeOf(input.vehicle);
  if (ownerType === 'UNOWNED') return { allowed: false, reason: 'UNOWNED_VEHICLE' };
  if (ownerType === 'INVALID') return { allowed: false, reason: 'INVALID_OWNERSHIP' };

  // Devretme yetkisi: bireysel sahip kendisi, şirket aracında YALNIZ admin.
  if (ownerType === 'INDIVIDUAL') {
    if (!input.viewerUserId || input.vehicle.owner_id !== input.viewerUserId) {
      return { allowed: false, reason: 'NOT_OWNER' };
    }
  } else {
    const sameCompany = !!input.viewerCompanyId && input.vehicle.company_id === input.viewerCompanyId;
    if (!sameCompany || input.viewerRole !== 'admin') {
      return { allowed: false, reason: 'NOT_OWNER' };
    }
  }

  // Kendine devir anlamsızdır.
  const currentOwnerId = ownerType === 'COMPANY' ? input.vehicle.company_id : input.vehicle.owner_id;
  if (input.targetType === ownerType && input.targetId && input.targetId === currentOwnerId) {
    return { allowed: false, reason: 'SAME_OWNER' };
  }

  return { allowed: true, reason: null };
}

/* ── Kullanıcıya dönük metinler (düz Türkçe, teknik terim YOK) ─────────── */

export function transferStatusLabel(status: TransferStatus): string {
  switch (status) {
    case 'PENDING':   return 'Onay bekliyor';
    case 'ACCEPTED':  return 'Kabul edildi';
    case 'REJECTED':  return 'Reddedildi';
    case 'CANCELLED': return 'İptal edildi';
    case 'EXPIRED':   return 'Süresi doldu';
    case 'COMPLETED': return 'Devir tamamlandı';
    case 'FAILED':    return 'Devir yapılamadı';
  }
}

export function blockReasonLabel(reason: TransferBlockReason): string {
  switch (reason) {
    case 'OFFLINE':
      return 'Bu işlem için internet bağlantısı gerekli. Sahiplik devri çevrimdışı yapılamaz.';
    case 'NOT_OWNER':
      return 'Bu aracı devretme yetkiniz yok.';
    case 'UNOWNED_VEHICLE':
      return 'Bu aracın sahibi yok. Önce eşleştirme yapılmalı.';
    case 'INVALID_OWNERSHIP':
      return 'Aracın sahiplik bilgisi tutarsız. Destekle iletişime geçin.';
    case 'SAME_OWNER':
      return 'Araç zaten seçtiğiniz sahibe ait.';
    case 'ACTIVE_TRANSFER_EXISTS':
      return 'Bu araç için bekleyen bir devir işlemi var. Önce onu sonuçlandırın.';
    case 'UNKNOWN_REVISION':
      return 'Araç bilgisi güncel değil. Sayfayı yenileyip tekrar deneyin.';
  }
}

export function ownerTypeLabel(type: OwnerType): string {
  return type === 'INDIVIDUAL' ? 'Bireysel kullanıcı' : 'Filo (şirket)';
}

export function expiryBucketLabel(bucket: ExpiryBucket): string {
  switch (bucket) {
    case 'EXPIRED':      return 'Süresi doldu';
    case 'UNDER_5_MIN':  return '5 dakikadan az';
    case 'UNDER_1_HOUR': return '1 saatten az';
    case 'OVER_1_HOUR':  return '1 saatten fazla';
  }
}

/* ── Bounded hata sözleşmesi (ham backend metni UI'ye ASLA gitmez) ─────── */

export const TRANSFER_RESULT_CODES = [
  'OWNERSHIP_CHANGED',
  'MEMBERSHIP_REVOKED',
  'REVISION_GAP',
  'SNAPSHOT_REQUIRED',
  'SNAPSHOT_FAILED',
  'STALE_SCOPE',
  'STALE_MUTATION',
  'TRANSFER_EXPIRED',
  'TRANSFER_CONFLICT',
  'CROSS_TENANT_DENIED',
  'ONLINE_REQUIRED',
  'UNKNOWN',
] as const;
export type TransferResultCode = (typeof TRANSFER_RESULT_CODES)[number];

/**
 * Sunucu hata kodunu **bounded** istemci koduna çevirir.
 * Tanınmayan kod `UNKNOWN` olur — ham metin ASLA taşınmaz.
 */
export function toTransferResultCode(serverCode: unknown): TransferResultCode {
  switch (serverCode) {
    case 'stale_client_revision':          return 'REVISION_GAP';
    case 'duplicate_operation':            return 'TRANSFER_CONFLICT';
    case 'pairing_code_expired':           return 'TRANSFER_EXPIRED';
    case 'permission_denied':
    case 'not_company_admin':              return 'CROSS_TENANT_DENIED';
    case 'vehicle_owned_by_another_user':
    case 'vehicle_belongs_to_another_company': return 'OWNERSHIP_CHANGED';
    case 'requires_online':                return 'ONLINE_REQUIRED';
    default:                               return 'UNKNOWN';
  }
}

export function transferResultLabel(code: TransferResultCode): string {
  switch (code) {
    case 'OWNERSHIP_CHANGED':   return 'Aracın sahipliği bu sırada değişti.';
    case 'MEMBERSHIP_REVOKED':  return 'Filo üyeliğiniz kaldırıldığı için işlem uygulanmadı.';
    case 'REVISION_GAP':        return 'Araç bilgisi değişmiş. Sayfayı yenileyip tekrar deneyin.';
    case 'SNAPSHOT_REQUIRED':   return 'Veriler doğrulanıyor, lütfen bekleyin.';
    case 'SNAPSHOT_FAILED':     return 'Sunucuyla eşitlenemedi. Bağlantınızı kontrol edin.';
    case 'STALE_SCOPE':         return 'Hesap değiştiği için işlem uygulanmadı.';
    case 'STALE_MUTATION':      return 'Bekleyen işlem artık geçerli değil.';
    case 'TRANSFER_EXPIRED':    return 'Devir isteğinin süresi doldu. Yeniden başlatın.';
    case 'TRANSFER_CONFLICT':   return 'Bu araç için zaten bekleyen bir devir var.';
    case 'CROSS_TENANT_DENIED': return 'Bu işlem için yetkiniz yok.';
    case 'ONLINE_REQUIRED':     return 'Bu işlem için internet bağlantısı gerekli.';
    case 'UNKNOWN':             return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
  }
}
