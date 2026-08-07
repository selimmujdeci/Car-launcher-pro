/**
 * conflictEngine.ts — CONFLICT SINIFLANDIRMA VE ÇÖZÜM POLİTİKASI (saf).
 *
 * ANAYASA: sahiplik (ownership) ve şirket (company) conflictlerinde
 * **otomatik local-wins ASLA kullanılmaz**. Güvenli varsayılan
 * **server-wins / fail-closed**'dur. "Zorla devral" seçeneği ÜRETİLMEZ.
 */

import type { ConflictCode, OperationType } from './types';
import { type FleetErrorCode } from '../fleet/errors';

/** Conflict çözüm stratejisi. */
export type Resolution =
  | 'SERVER_WINS'        // sunucu durumu kabul edilir, yerel işlem iptal
  | 'USER_DECISION'      // kullanıcı seçmeli — otomatik çözüm YOK
  | 'CANCEL_OPERATION'   // işlem anlamsız hâle geldi, iptal
  | 'LOCAL_RETRY';       // güvenle tekrar denenebilir

export interface ConflictPolicy {
  code:              ConflictCode;
  /** Kullanıcı kararı olmadan çözülebilir mi. */
  autoResolvable:    boolean;
  requiresUserDecision: boolean;
  cancelOperation:   boolean;
  resolution:        Resolution;
  localRetryAllowed: boolean;
  /** Yerel bekleyen işlem iptal edilirse veri kaybı riski var mı. */
  dataLossRisk:      boolean;
  /** Kullanıcıya gösterilecek "ne oldu" açıklaması (teknik yığın YOK). */
  title:             string;
  explanation:       string;
}

const POLICIES: Readonly<Record<ConflictCode, ConflictPolicy>> = {
  VEHICLE_ALREADY_OWNED: {
    code: 'VEHICLE_ALREADY_OWNED',
    autoResolvable: false, requiresUserDecision: true, cancelOperation: false,
    resolution: 'USER_DECISION', localRetryAllowed: false, dataLossRisk: false,
    title: 'Araç başka bir kullanıcıya ait',
    explanation: 'Siz çevrimdışıyken bu aracı başka bir kullanıcı sahiplendi. Sahiplik otomatik devralınmaz; aracın gerçek sahibiyle iletişime geçin.',
  },
  USER_ALREADY_IN_COMPANY: {
    code: 'USER_ALREADY_IN_COMPANY',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'SERVER_WINS', localRetryAllowed: false, dataLossRisk: false,
    title: 'Kullanıcı zaten bir filoda',
    explanation: 'Eklemek istediğiniz kullanıcı başka bir filoya bağlı. Bir kullanıcı aynı anda yalnız bir filoya üye olabilir.',
  },
  VEHICLE_IN_ANOTHER_COMPANY: {
    code: 'VEHICLE_IN_ANOTHER_COMPANY',
    autoResolvable: false, requiresUserDecision: true, cancelOperation: false,
    resolution: 'USER_DECISION', localRetryAllowed: false, dataLossRisk: false,
    title: 'Araç başka bir filoya bağlı',
    explanation: 'Bu araç başka bir filoya kayıtlı. Araç devri için o filonun yöneticisiyle iletişime geçilmelidir.',
  },
  ROLE_CHANGED_ON_SERVER: {
    code: 'ROLE_CHANGED_ON_SERVER',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'SERVER_WINS', localRetryAllowed: false, dataLossRisk: false,
    title: 'Rolünüz değişti',
    explanation: 'Siz çevrimdışıyken filodaki rolünüz değiştirildi. Bekleyen işlem artık yetkiniz dışında kaldığı için uygulanmadı.',
  },
  MEMBER_REMOVED_ON_SERVER: {
    code: 'MEMBER_REMOVED_ON_SERVER',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'SERVER_WINS', localRetryAllowed: false, dataLossRisk: false,
    title: 'Üye filodan çıkarılmış',
    explanation: 'İşlem yapmak istediğiniz üye sunucuda filodan çıkarılmış. Bekleyen işlem uygulanmadı.',
  },
  PAIRING_CODE_EXPIRED: {
    code: 'PAIRING_CODE_EXPIRED',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'CANCEL_OPERATION', localRetryAllowed: false, dataLossRisk: false,
    title: 'Eşleştirme kodunun süresi doldu',
    explanation: 'Çevrimdışıyken kaydettiğiniz eşleştirme kodunun süresi doldu. Araçtan yeni bir kod alıp tekrar deneyin.',
  },
  PAIRING_CODE_ALREADY_USED: {
    code: 'PAIRING_CODE_ALREADY_USED',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'CANCEL_OPERATION', localRetryAllowed: false, dataLossRisk: false,
    title: 'Kod zaten kullanılmış',
    explanation: 'Bu eşleştirme kodu başka bir istek tarafından kullanılmış. Araçtan yeni bir kod alın.',
  },
  STALE_CLIENT_REVISION: {
    code: 'STALE_CLIENT_REVISION',
    autoResolvable: false, requiresUserDecision: true, cancelOperation: false,
    resolution: 'USER_DECISION', localRetryAllowed: true, dataLossRisk: true,
    title: 'Veriler sunucuda değişti',
    explanation: 'Siz çevrimdışıyken bu kayıt sunucuda güncellendi. Sizin bekleyen değişikliğiniz sunucudakini ezebilir — nasıl devam edileceğine siz karar vermelisiniz.',
  },
  DUPLICATE_OPERATION: {
    code: 'DUPLICATE_OPERATION',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'SERVER_WINS', localRetryAllowed: false, dataLossRisk: false,
    title: 'İşlem zaten uygulanmış',
    explanation: 'Bu işlem daha önce sunucuya ulaşmış ve uygulanmış. Tekrar uygulanmadı.',
  },
  PERMISSION_REVOKED: {
    code: 'PERMISSION_REVOKED',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'SERVER_WINS', localRetryAllowed: false, dataLossRisk: false,
    title: 'Yetkiniz kaldırılmış',
    explanation: 'Bu işlem için yetkiniz sunucuda kaldırılmış. Bekleyen işlem uygulanmadı.',
  },
  COMPANY_DELETED: {
    code: 'COMPANY_DELETED',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'CANCEL_OPERATION', localRetryAllowed: false, dataLossRisk: false,
    title: 'Filo silinmiş',
    explanation: 'İşlem yapmak istediğiniz filo sunucuda silinmiş. Bekleyen işlem uygulanmadı.',
  },
  OWNERSHIP_CHANGED: {
    code: 'OWNERSHIP_CHANGED',
    autoResolvable: false, requiresUserDecision: true, cancelOperation: false,
    resolution: 'USER_DECISION', localRetryAllowed: false, dataLossRisk: false,
    title: 'Araç sahipliği değişti',
    explanation: 'Siz çevrimdışıyken bu aracın sahipliği değişti. Sahiplik otomatik olarak devralınmaz.',
  },
  SERVER_STATE_NEWER: {
    code: 'SERVER_STATE_NEWER',
    autoResolvable: true, requiresUserDecision: false, cancelOperation: true,
    resolution: 'SERVER_WINS', localRetryAllowed: false, dataLossRisk: false,
    title: 'Sunucudaki kayıt daha güncel',
    explanation: 'Sunucudaki kayıt sizin bekleyen işleminizden daha yeni. Sunucu durumu korundu.',
  },
};

export function policyFor(code: ConflictCode): ConflictPolicy {
  return POLICIES[code];
}

export function allPolicies(): readonly ConflictPolicy[] {
  return Object.values(POLICIES);
}

/**
 * Sunucu hata kodu + işlem türü → conflict kodu.
 * Eşleşme yoksa `null` (conflict değil; normal hata olarak işlenir).
 */
export function toConflictCode(
  errorCode: FleetErrorCode,
  operationType: OperationType,
): ConflictCode | null {
  switch (errorCode) {
    case 'vehicle_owned_by_another_user':
      return operationType === 'OWNERSHIP_CLAIM' || operationType === 'VEHICLE_PAIR'
        ? 'VEHICLE_ALREADY_OWNED'
        : 'OWNERSHIP_CHANGED';
    case 'already_member_of_company':
    case 'user_belongs_to_another_company':
      return 'USER_ALREADY_IN_COMPANY';
    case 'vehicle_in_another_company':
    case 'vehicle_belongs_to_another_company':
      return 'VEHICLE_IN_ANOTHER_COMPANY';
    case 'pairing_code_expired':
      return 'PAIRING_CODE_EXPIRED';
    case 'pairing_code_already_used':
      return 'PAIRING_CODE_ALREADY_USED';
    case 'stale_client_revision':
      return 'STALE_CLIENT_REVISION';
    case 'duplicate_operation':
      return 'DUPLICATE_OPERATION';
    case 'permission_denied':
    case 'not_company_admin':
      return 'PERMISSION_REVOKED';
    case 'company_deleted':
      return 'COMPANY_DELETED';
    case 'target_user_not_found':
      return operationType === 'MEMBER_ROLE_UPDATE' || operationType === 'MEMBER_REMOVE'
        ? 'MEMBER_REMOVED_ON_SERVER'
        : null;
    default:
      return null;
  }
}

/** Kullanıcıya sunulacak aksiyonlar. "Zorla devral" ASLA üretilmez. */
export type ConflictAction =
  | 'RETRY'
  | 'CANCEL'
  | 'ACCEPT_SERVER_STATE'
  | 'NOTIFY_ADMIN';

export function actionsFor(code: ConflictCode): readonly ConflictAction[] {
  const policy = policyFor(code);
  const actions: ConflictAction[] = [];
  if (policy.localRetryAllowed) actions.push('RETRY');
  actions.push('ACCEPT_SERVER_STATE');
  actions.push('CANCEL');
  if (
    code === 'VEHICLE_IN_ANOTHER_COMPANY' ||
    code === 'PERMISSION_REVOKED' ||
    code === 'ROLE_CHANGED_ON_SERVER' ||
    code === 'MEMBER_REMOVED_ON_SERVER'
  ) {
    actions.push('NOTIFY_ADMIN');
  }
  return actions;
}
