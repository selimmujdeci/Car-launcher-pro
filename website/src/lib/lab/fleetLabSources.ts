/**
 * fleetLabSources.ts — CAROS LAB · FİLO/ÇEVRİMDIŞI TEK OKUMA KATMANI.
 *
 * KURALLAR (CLAUDE.md §Zorunlu Gözlemlenebilirlik):
 *   · SALT-OKUNUR — hiçbir şirket/üyelik/pairing/ownership işlemi TETİKLEMEZ.
 *   · Her getter kendi `try/catch`'i içinde; biri patlarsa panel çökmez.
 *   · Bilinmeyen alan UNKNOWN/UNAVAILABLE döner — sahte 0 / sahte tarih YASAK.
 *   · HASSAS VERİ TAŞINMAZ: kod, api_key, ham payload, isim, plaka YOK.
 *     Yalnız VAR/YOK ve ADET.
 */

import { getQueue, getSnapshot, peekOrchestrator } from '@/lib/offline/fleetOffline';
import {
  peekRealtimeAuthority,
  type RealtimeState, type RealtimeCounters,
} from '@/lib/realtime/realtimeSyncAuthority';
import type { QueueItem, OperationType, SyncStatus } from '@/lib/offline/types';
import type { OwnershipSnapshot } from '@/lib/offline/ownershipSnapshot';
import { readPairingCounts, pairingNamespace } from '@/lib/offline/pendingPairingService';
import {
  peekValidationCollector, type ScenarioRun,
} from '@/lib/validation/phoneValidationScenarios';

/** Gözlemlenebilirlik sınıflandırması — `sessionInspectorModel` sözleşmesi. */
export type Observability = 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE';

/**
 * Bekleyen eşleştirme ADETLERİ — kod ÇÖZÜLMEDEN okunur.
 * Okunamazsa `null` (sahte 0 YAZILMAZ).
 */
export interface PairingClaimCounts {
  pending:  number;
  verified: number;
  rejected: number;
  expired:  number;
  total:    number;
}

export interface FleetLabRawReading {
  userId:            string | null;
  snapshot:          OwnershipSnapshot | null;
  snapshotReadable:  boolean;
  queueItems:        readonly QueueItem[];
  queueReadable:     boolean;
  corruptRecords:    number | null;
  /** Kullanıcı kapsamındaki claim'ler (oturum varsa). */
  pairingClaims:     PairingClaimCounts | null;
  /** Oturumsuz PWA eşleştirme ekranının cihaz kapsamı. */
  devicePairingClaims: PairingClaimCounts | null;
  /** Bilinmeyen şema sürümü yüzünden reddedilen kayıt adedi. */
  schemaRejected:    number | null;
  /** Başka hesaba ait olduğu için reddedilen kayıt adedi (sızıntı kanıtı). */
  foreignAccountRejected: number | null;
  /** Kuyruğun bağlı olduğu hesap, oturumdaki hesapla eşleşiyor mu. */
  accountScopeBound: boolean | null;
  /** Senkron kuşağı — hesap/şirket değişiminde artar. */
  syncGeneration:    number | null;
  /** Bayat kuşak yüzünden yok sayılan sonuç adedi. */
  staleRejects:      number | null;
  /** Şu anda bir senkron turu çalışıyor mu. */
  syncRunning:       boolean | null;
  /** Realtime otoritesi — kayıtlı değilse null (sahte 0 ÜRETİLMEZ). */
  realtime:          RealtimeLabReading | null;
  /** Telefon doğrulama koşumları — henüz koşulmadıysa boş dizi. */
  validationRuns:    readonly ScenarioRun[];
  online:            boolean | null;
  readAt:            number;
}

/** LAB'a taşınan realtime alanları — PII ve ham payload YOK. */
export interface RealtimeLabReading {
  state:                RealtimeState;
  /** Kapsam kuşağı — hesap kimliği TAŞINMAZ, yalnız sayaç. */
  scopeGeneration:      number | null;
  lastServerRevision:   number | null;
  lastEventRevision:    number | null;
  lastGapReason:        string | null;
  lastResyncDurationMs: number | null;
  resyncAttempt:        number;
  counters:             RealtimeCounters;
}

const EMPTY: FleetLabRawReading = {
  userId: null, snapshot: null, snapshotReadable: false,
  queueItems: [], queueReadable: false, corruptRecords: null,
  pairingClaims: null, devicePairingClaims: null,
  schemaRejected: null, foreignAccountRejected: null, accountScopeBound: null,
  syncGeneration: null, staleRejects: null, syncRunning: null,
  realtime: null,
  validationRuns: [],
  online: null, readAt: 0,
};

/**
 * Realtime otoritesini SALT-OKUR. Kayıtlı değilse `null` — LAB bunu
 * UNAVAILABLE gösterir, sahte "sağlıklı" YAZMAZ.
 * Hassas alan taşınmaz: hesap/şirket kimliği DEĞİL, yalnız kuşak sayısı.
 */
function readRealtime(): RealtimeLabReading | null {
  try {
    const authority = peekRealtimeAuthority();
    if (!authority) return null;
    const view = authority.view();
    return {
      state:                view.state,
      scopeGeneration:      view.scope?.generation ?? null,
      lastServerRevision:   view.lastServerRevision,
      lastEventRevision:    view.lastEventRevision,
      lastGapReason:        view.lastGapReason,
      lastResyncDurationMs: view.lastResyncDurationMs,
      resyncAttempt:        view.resyncAttempt,
      counters:             view.counters,
    };
  } catch {
    return null;
  }
}

/** Telefon doğrulama koşumları — okunamazsa boş (sahte PASS ÜRETİLMEZ). */
function readValidationRuns(): readonly ScenarioRun[] {
  try {
    return peekValidationCollector()?.all() ?? [];
  } catch {
    return [];
  }
}

/** Salt-okuma; hiçbir gönderim/doğrulama TETİKLEMEZ. */
function readPairing(namespace: string): PairingClaimCounts | null {
  try {
    return readPairingCounts(namespace);
  } catch {
    return null;
  }
}

function readOnline(): boolean | null {
  try {
    if (typeof navigator === 'undefined') return null;
    return navigator.onLine !== false;
  } catch {
    return null;
  }
}

function readSnapshot(userId: string): { snapshot: OwnershipSnapshot | null; ok: boolean } {
  try {
    return { snapshot: getSnapshot(userId), ok: true };
  } catch {
    return { snapshot: null, ok: false };
  }
}

/**
 * Tek okuma. Abonelik/timer KURMAZ — çağıran ekran açılışta bir kez ve
 * kullanıcı "YENİLE" dedikçe çağırır.
 */
export async function readFleetLab(userId: string | null): Promise<FleetLabRawReading> {
  // Cihaz kapsamı oturumdan BAĞIMSIZ okunur: PWA eşleştirme ekranı oturum
  // açılmadan da claim üretebilir, LAB bunu görmezden gelmemeli.
  const devicePairing = readPairing(pairingNamespace(null));

  if (!userId) {
    return {
      ...EMPTY,
      devicePairingClaims: devicePairing,
      realtime: readRealtime(),
      validationRuns: readValidationRuns(),
      online: readOnline(),
      readAt: Date.now(),
    };
  }

  const snap = readSnapshot(userId);

  let queueItems: readonly QueueItem[] = [];
  let queueReadable = false;
  let corruptRecords: number | null = null;
  let schemaRejected: number | null = null;
  let foreignAccountRejected: number | null = null;
  let accountScopeBound: boolean | null = null;
  try {
    const queue = getQueue(userId);
    queueItems  = await queue.all();
    corruptRecords         = queue.getCorruptCount();
    schemaRejected         = queue.getSchemaRejectedCount();
    foreignAccountRejected = queue.getForeignAccountCount();
    accountScopeBound      = queue.getAccountId() === userId;
    queueReadable  = true;
  } catch {
    queueReadable = false;
  }

  // Senkron otoritesi YALNIZ varsa okunur — LAB yeni bir otorite KURMAZ.
  let syncGeneration: number | null = null;
  let staleRejects:   number | null = null;
  let syncRunning:    boolean | null = null;
  try {
    const orchestrator = peekOrchestrator();
    if (orchestrator) {
      syncGeneration = orchestrator.getGeneration();
      staleRejects   = orchestrator.getStaleRejectCount();
      syncRunning    = orchestrator.isRunning();
    }
  } catch {
    /* okunamadı → UNAVAILABLE; sahte 0 YAZILMAZ */
  }

  return {
    userId,
    snapshot:         snap.snapshot,
    snapshotReadable: snap.ok,
    queueItems,
    queueReadable,
    corruptRecords,
    pairingClaims:       readPairing(pairingNamespace(userId)),
    devicePairingClaims: devicePairing,
    schemaRejected,
    foreignAccountRejected,
    accountScopeBound,
    syncGeneration,
    staleRejects,
    syncRunning,
    realtime:         readRealtime(),
    validationRuns:   readValidationRuns(),
    online:           readOnline(),
    readAt:           Date.now(),
  };
}

/* ── Türetilmiş sayımlar (saf) ─────────────────────────────────────────── */

export function countByStatus(items: readonly QueueItem[]): Record<SyncStatus, number> {
  const out: Record<SyncStatus, number> = {
    PENDING: 0, BLOCKED_BY_DEPENDENCY: 0, SYNCING: 0, SYNCED: 0,
    RETRYABLE_FAILED: 0, PERMANENT_FAILED: 0, CONFLICT: 0, EXPIRED: 0, CANCELLED: 0,
  };
  for (const item of items) out[item.status] += 1;
  return out;
}

export function countByOperation(items: readonly QueueItem[]): Partial<Record<OperationType, number>> {
  const out: Partial<Record<OperationType, number>> = {};
  for (const item of items) out[item.operationType] = (out[item.operationType] ?? 0) + 1;
  return out;
}
