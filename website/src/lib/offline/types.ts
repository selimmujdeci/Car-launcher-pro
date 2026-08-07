/**
 * types.ts — OFFLINE DOMAIN KUYRUĞU SÖZLEŞMESİ (saf, I/O yok).
 *
 * Mevcut `connectivityService` (head unit, IndexedDB, telemetri kuyruğu)
 * DEĞİŞTİRİLMEZ. Bu, ownership/fleet alanı için AYRI ve typed bir kuyruktur.
 */

/* ── İşlem türleri ─────────────────────────────────────────────────────── */

export const OPERATION_TYPES = [
  'COMPANY_CREATE',
  'COMPANY_UPDATE',
  'MEMBER_ADD',
  'MEMBER_ROLE_UPDATE',
  'MEMBER_REMOVE',
  'VEHICLE_PAIR',
  'VEHICLE_ASSIGN_COMPANY',
  'VEHICLE_REMOVE_COMPANY',
  'OWNERSHIP_CLAIM',
  // Sahiplik devri — hepsi ONLINE_REQUIRED (bkz. offlineClassification.ts).
  // Kuyruk sözleşmesinde YER ALIRLAR ki sınıflandırma kapsamı eksiksiz olsun
  // ve bir gün yanlışlıkla kuyruğa yazılırsa tür tanınmadan geçmesin.
  'VEHICLE_TRANSFER_START',
  'VEHICLE_TRANSFER_ACCEPT',
  'VEHICLE_TRANSFER_REJECT',
  'VEHICLE_TRANSFER_CANCEL',
  'LOCATION_EVENT',
  'VEHICLE_EVENT',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/**
 * SENKRONİZASYON SIRASI (domain bağımlılığı).
 * Düşük sayı önce gider. `dependsOn` bundan BAĞIMSIZ olarak ayrıca zorlanır.
 *
 *  1 profile readiness  → 2 company → 3 membership → 4 ownership claim
 *  → 5 pairing → 6 company vehicle assignment → 7 location → 8 vehicle event
 */
export const DOMAIN_ORDER: Readonly<Record<OperationType, number>> = {
  COMPANY_CREATE:         2,
  COMPANY_UPDATE:         2,
  MEMBER_ADD:             3,
  MEMBER_ROLE_UPDATE:     3,
  MEMBER_REMOVE:          3,
  OWNERSHIP_CLAIM:        4,
  VEHICLE_PAIR:           5,
  VEHICLE_ASSIGN_COMPANY: 6,
  VEHICLE_REMOVE_COMPANY: 6,
  // Devir sahiplikten SONRA, telemetriden ÖNCE gelir. (Pratikte kuyruğa
  // girmezler — ONLINE_REQUIRED — ama sıra sözleşmesi eksiksiz olmalıdır.)
  VEHICLE_TRANSFER_START:  6,
  VEHICLE_TRANSFER_ACCEPT: 6,
  VEHICLE_TRANSFER_REJECT: 6,
  VEHICLE_TRANSFER_CANCEL: 6,
  LOCATION_EVENT:         7,
  VEHICLE_EVENT:          8,
};

/* ── Senkron durumları ─────────────────────────────────────────────────── */

export const SYNC_STATUSES = [
  'PENDING',
  'BLOCKED_BY_DEPENDENCY',
  'SYNCING',
  'SYNCED',
  'RETRYABLE_FAILED',
  'PERMANENT_FAILED',
  'CONFLICT',
  'EXPIRED',
  'CANCELLED',
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Kuyruktan çıkarılabilir (artık gönderilmeyecek) durumlar. */
export const TERMINAL_STATUSES: readonly SyncStatus[] = [
  'SYNCED',
  'PERMANENT_FAILED',
  'EXPIRED',
  'CANCELLED',
];

export function isTerminal(status: SyncStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/* ── Conflict kodları ──────────────────────────────────────────────────── */

export const CONFLICT_CODES = [
  'VEHICLE_ALREADY_OWNED',
  'USER_ALREADY_IN_COMPANY',
  'VEHICLE_IN_ANOTHER_COMPANY',
  'ROLE_CHANGED_ON_SERVER',
  'MEMBER_REMOVED_ON_SERVER',
  'PAIRING_CODE_EXPIRED',
  'PAIRING_CODE_ALREADY_USED',
  'STALE_CLIENT_REVISION',
  'DUPLICATE_OPERATION',
  'PERMISSION_REVOKED',
  'COMPANY_DELETED',
  'OWNERSHIP_CHANGED',
  'SERVER_STATE_NEWER',
] as const;
export type ConflictCode = (typeof CONFLICT_CODES)[number];

/* ── Kuyruk öğesi ──────────────────────────────────────────────────────── */

/**
 * Kuyruk öğesi şema sürümü.
 *
 * Bu sayı, ÖĞE ALANLARININ anlamı değiştiğinde artar. Daha YÜKSEK sürümlü bir
 * kayıt (ör. yeni sürümden geri dönülen tarayıcı) ASLA yorumlanmaz — eski kod
 * yeni alanları bilmediği için "anladım" varsayması sessiz veri bozulmasıdır.
 * Fail-closed: bilinmeyen sürüm karantinaya alınır, kuyruğa girmez.
 */
export const QUEUE_ITEM_SCHEMA_VERSION = 1 as const;

/** Depolanan zarfın sürümü (öğe şemasından AYRI evrimleşebilir). */
export const QUEUE_ENVELOPE_VERSION = 1 as const;

export interface QueueItem {
  /** Yazıldığı andaki öğe şeması. Eksikse 1 varsayılır (geriye dönük kayıt). */
  schemaVersion:   number;
  id:              string;
  operationType:   OperationType;
  /** Kuyruğun sahibi hesap. Depo namespace'i ile EŞLEŞMEK ZORUNDADIR. */
  actorId:         string;
  companyId:       string | null;
  vehicleId:       string | null;
  payload:         Readonly<Record<string, unknown>>;
  createdAt:       number;
  clientRevision:  number;
  /** Aynı mantıksal işlemin kuyrukta tekrarlanmasını engeller. */
  dedupKey:        string;
  /** Sunucuya gönderilirken tekrar-güvenliği sağlar (at-most-once etki). */
  idempotencyKey:  string;
  /** Bu öğeler SYNCED olmadan gönderilmez. */
  dependsOn:       readonly string[];
  attemptCount:    number;
  maxAttempts:     number;
  nextAttemptAt:   number;
  expiresAt:       number;
  status:          SyncStatus;
  failureCode:     string | null;
}

/** Yeni öğe eklerken zorunlu alanlar; gerisi kuyruk tarafından üretilir. */
export interface EnqueueInput {
  operationType:   OperationType;
  actorId:         string;
  companyId?:      string | null;
  vehicleId?:      string | null;
  payload:         Readonly<Record<string, unknown>>;
  dedupKey:        string;
  idempotencyKey:  string;
  dependsOn?:      readonly string[];
  clientRevision?: number;
  maxAttempts?:    number;
  /** Öğenin geçerlilik süresi (ms). Varsayılan `DEFAULT_TTL_MS`. */
  ttlMs?:          number;
}

/* ── Kuyruk sınırları ──────────────────────────────────────────────────── */

/** Kuyruk BOUNDED — sınırsız büyüme yok. */
export const MAX_QUEUE_SIZE = 500;
/** Varsayılan TTL: 7 gün. Süresi geçen öğe EXPIRED olur, gönderilmez. */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Varsayılan deneme sınırı — sonsuz retry YOK (poison-item koruması). */
export const DEFAULT_MAX_ATTEMPTS = 6;
/** Üstel backoff tabanı ve tavanı. */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS  = 5 * 60 * 1000;

/**
 * Deneme sayısına göre bir sonraki denemenin gecikmesi (deterministik).
 * `Math.random()` KULLANILMAZ — test edilebilirlik ve tekrar üretilebilirlik için.
 */
export function backoffDelayMs(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  const raw = BACKOFF_BASE_MS * Math.pow(2, attemptCount - 1);
  return Math.min(raw, BACKOFF_MAX_MS);
}
