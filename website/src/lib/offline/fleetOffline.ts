/**
 * fleetOffline.ts — TARAYICI TARAFI OFFLINE FİLO ÇEKİRDEĞİ (tekil).
 *
 * DomainQueue + OwnershipSnapshot + SyncOrchestrator'ı tek yerden bağlar.
 * Kullanıcı başına izole: hesap değişiminde önceki kullanıcının kuyruğu ve
 * snapshot'ı OKUNMAZ.
 */

import { DomainQueue } from './domainQueue';
import { BrowserQueueStorage } from './storage';
import { SyncOrchestrator, type SyncTransport, type TransportResult } from './syncOrchestrator';
import { CompositeSyncTransport, RecordsSyncTransport } from './recordsSyncTransport';
import type { QueueItem, OperationType, EnqueueInput } from './types';
import {
  type OfflineClass,
  classifyOffline,
  offlineMessageFor,
} from './offlineClassification';
import {
  type OwnershipSnapshot,
  loadSnapshot,
  saveSnapshot,
  clearAllSnapshots,
} from './ownershipSnapshot';
import { clearAllPendingPairings } from './offlinePairing';
import {
  isPendingPairingRuntimeEmpty,
  resetPendingPairingStore,
} from './pendingPairingService';
import { isFleetErrorCode, messageFor, type FleetErrorCode } from '../fleet/errors';

/** İşlem türü → sunucu ucu ve HTTP metodu. */
const ENDPOINTS: Readonly<Record<OperationType, { path: (item: QueueItem) => string; method: string } | null>> = {
  COMPANY_CREATE:         { path: () => '/api/company', method: 'POST' },
  COMPANY_UPDATE:         { path: () => '/api/company', method: 'PATCH' },
  MEMBER_ADD:             { path: () => '/api/company/members', method: 'POST' },
  MEMBER_ROLE_UPDATE:     { path: (i) => `/api/company/members/${String(i.payload.userId ?? '')}`, method: 'PATCH' },
  MEMBER_REMOVE:          { path: (i) => `/api/company/members/${String(i.payload.userId ?? '')}`, method: 'DELETE' },
  VEHICLE_ASSIGN_COMPANY: { path: () => '/api/company/vehicles/assign', method: 'POST' },
  VEHICLE_REMOVE_COMPANY: { path: () => '/api/company/vehicles/remove', method: 'POST' },
  VEHICLE_PAIR:           { path: () => '/api/vehicle/link', method: 'POST' },
  OWNERSHIP_CLAIM:        { path: () => '/api/vehicle/link', method: 'POST' },
  // Sahiplik devri ONLINE_REQUIRED'dır → kuyruğa hiç girmez, uç noktası YOK.
  // (Doğrudan `start/accept/reject/cancel_vehicle_transfer` RPC'leri çağrılır.)
  VEHICLE_TRANSFER_START:  null,
  VEHICLE_TRANSFER_ACCEPT: null,
  VEHICLE_TRANSFER_REJECT: null,
  VEHICLE_TRANSFER_CANCEL: null,
  // Konum ve araç olayları head unit tarafından gönderilir; PWA kuyruğu taşımaz.
  LOCATION_EVENT:         null,
  VEHICLE_EVENT:          null,
  // Bakım kayıtları HTTP rotasına GİTMEZ — doğrudan Supabase'e yazılırlar
  // (`RecordsSyncTransport`). Burada `null` olmaları "uç yok" demektir,
  // "gönderilemez" demek DEĞİLDİR; yönlendirme `CompositeSyncTransport`tadır.
  FUEL_LOG_ADD:           null,
  SERVICE_RECORD_ADD:     null,
};

/** HTTP taşıyıcı — idempotency key başlıkla gider. */
export class HttpSyncTransport implements SyncTransport {
  async send(item: QueueItem): Promise<TransportResult> {
    const endpoint = ENDPOINTS[item.operationType];
    if (!endpoint) {
      return { ok: false, retryable: false, errorCode: 'invalid_request' };
    }

    let response: Response;
    try {
      response = await fetch(endpoint.path(item), {
        method: endpoint.method,
        headers: {
          'Content-Type':    'application/json',
          'Idempotency-Key': item.idempotencyKey,
        },
        body: endpoint.method === 'DELETE' ? undefined : JSON.stringify(item.payload),
      });
    } catch {
      return { ok: false, retryable: true, errorCode: 'network_error' };
    }

    if (response.ok) return { ok: true };

    let code: FleetErrorCode = 'server_error';
    try {
      const body = (await response.json()) as { code?: unknown };
      if (isFleetErrorCode(body?.code)) code = body.code;
    } catch {
      /* gövde okunamadı → server_error */
    }

    // 5xx ve 429 yeniden denenebilir; 4xx kalıcıdır.
    const retryable = response.status >= 500 || response.status === 429;
    return retryable
      ? { ok: false, retryable: true, errorCode: code }
      : { ok: false, retryable: false, errorCode: code };
  }
}

/* ── Tekil örnek ───────────────────────────────────────────────────────── */

let _userId: string | null = null;
let _queue:  DomainQueue | null = null;
let _orchestrator: SyncOrchestrator | null = null;

/** Profil hazır mı — `/api/company` 200 dönüyorsa profil satırı vardır. */
class ApiProfileReadiness {
  async isReady(): Promise<boolean> {
    try {
      const res = await fetch('/api/company', { method: 'GET' });
      return res.ok;
    } catch {
      return false; // çevrimdışı → senkron denenmez
    }
  }
}

export function getQueue(userId: string): DomainQueue {
  if (_queue && _userId === userId) return _queue;

  // HESAP DEĞİŞİMİ — önceki hesabın senkron turu DERHAL geçersiz kılınır.
  // Uçuştaki yanıtlar tamamlansa bile yeni hesabın kuyruğuna yazamaz.
  _orchestrator?.abort();

  _userId = userId;
  _queue  = new DomainQueue({
    storage:   new BrowserQueueStorage(userId),
    // İkinci savunma hattı: namespace kirlenirse bile yabancı kayıt yüklenmez.
    accountId: userId,
  });
  _orchestrator = null;
  return _queue;
}

export function getOrchestrator(userId: string): SyncOrchestrator {
  const queue = getQueue(userId);
  if (!_orchestrator) {
    _orchestrator = new SyncOrchestrator(
      queue,
      new CompositeSyncTransport(new HttpSyncTransport(), new RecordsSyncTransport()),
      new ApiProfileReadiness(),
    );
  }
  return _orchestrator;
}

/** Kuyruğa yazma sonucu — çağıran ekran bunu DÜRÜSTÇE göstermek zorundadır. */
export interface OfflineEnqueueResult {
  ok:        boolean;
  item:      QueueItem | null;
  klass:     OfflineClass;
  /** Reddedildiyse typed sebep; kabul edildiyse null. */
  errorCode: FleetErrorCode | null;
  /** Kullanıcıya gösterilecek Türkçe metin. */
  message:   string;
}

/**
 * ÇEVRİMDIŞI YAZMA İÇİN TEK KAPI.
 *
 * · `ONLINE_REQUIRED` işlem kuyruğa ALINMAZ — rol değişikliği, üye çıkarma,
 *   eşleştirme ve sahiplik devri çevrimdışı "kaydedildi" gösterilemez.
 * · `OFFLINE_DEFERRED` kuyruğa alınır ama mesajı TAMAMLANDI DEMEZ.
 * · Kuyruk doluysa sessiz kayıp yok — `offline_queue_full` ile reddedilir.
 */
export async function enqueueOfflineMutation(
  userId: string,
  input: EnqueueInput,
): Promise<OfflineEnqueueResult> {
  const klass = classifyOffline(input.operationType);

  if (klass === 'ONLINE_REQUIRED') {
    return {
      ok: false, item: null, klass,
      errorCode: 'requires_online',
      message: offlineMessageFor(input.operationType),
    };
  }

  // Hesap uyuşmazlığı kuyruk doluluğuyla KARIŞTIRILMAZ — ikisi farklı arızadır
  // ve kullanıcıya farklı şey söylenir.
  if (input.actorId !== userId) {
    return {
      ok: false, item: null, klass,
      errorCode: 'permission_denied',
      message: messageFor('permission_denied'),
    };
  }

  const item = await getQueue(userId).enqueue(input);
  if (!item) {
    return {
      ok: false, item: null, klass,
      errorCode: 'offline_queue_full',
      message: messageFor('offline_queue_full'),
    };
  }

  return {
    ok: true, item, klass,
    errorCode: null,
    message: offlineMessageFor(input.operationType),
  };
}

/**
 * SALT-OKUMA: mevcut senkron otoritesi (varsa). CAROS LAB bunu kullanır —
 * `getOrchestrator` gibi YENİ örnek KURMAZ, çünkü gözlem gözlenen sistemi
 * değiştirmemelidir.
 */
export function peekOrchestrator(): SyncOrchestrator | null {
  return _orchestrator;
}

/** SALT-OKUMA: kuyruğun şu an bağlı olduğu hesap (yoksa null). */
export function activeQueueAccountId(): string | null {
  return _userId;
}

/** Cleanup prepare: uçuştaki senkron kuşağını yeni batch başlamadan öldürür. */
export function prepareOfflineQueueCleanup(): void {
  _orchestrator?.abort();
}

export function getSnapshot(userId: string): OwnershipSnapshot | null {
  return loadSnapshot(userId);
}

export function storeSnapshot(snapshot: OwnershipSnapshot): void {
  saveSnapshot(snapshot);
}

/** Temizlik sonucu — DOĞRULANMIŞ olmadan yeni oturum güvenli sayılmaz. */
export interface OfflineResetResult {
  ok: boolean;
  /** Temizlikten sonra hâlâ duran filo anahtarlarının ADEDİ (içerik OKUNMAZ). */
  residualKeys: number;
  /** Depo sayılamadı (SSR / kısıtlı mod) → doğrulama yapılamadı. */
  verifiable: boolean;
}

/** Temizlik sonrası kalıntı taraması — yalnız ADET, içerik okunmaz. */
function countResidualFleetKeys(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    let count = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('caros.fleet.')) count += 1;
    }
    return count;
  } catch {
    return null;
  }
}

type OfflineAuthorityPrefix =
  | 'caros.fleet.queue.'
  | 'caros.fleet.snapshot.'
  | 'caros.fleet.pairing.';

function removeKeysByPrefix(prefix: OfflineAuthorityPrefix): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function hasKeysByPrefix(prefix: OfflineAuthorityPrefix): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (window.localStorage.key(index)?.startsWith(prefix)) return true;
    }
    return false;
  } catch {
    return null;
  }
}

export async function cleanupOfflineQueueAuthority(): Promise<boolean> {
  prepareOfflineQueueCleanup();
  if (_queue) await _queue.clear();
  _queue = null;
  _orchestrator = null;
  _userId = null;
  return removeKeysByPrefix('caros.fleet.queue.');
}

export function verifyOfflineQueueAuthorityEmpty(): boolean {
  return _queue === null && _orchestrator === null && _userId === null &&
    hasKeysByPrefix('caros.fleet.queue.') === false;
}

export function cleanupOwnershipSnapshotAuthority(): boolean {
  clearAllSnapshots();
  return removeKeysByPrefix('caros.fleet.snapshot.');
}

export function verifyOwnershipSnapshotAuthorityEmpty(): boolean {
  return hasKeysByPrefix('caros.fleet.snapshot.') === false;
}

export function preparePendingPairingCleanup(): void {
  resetPendingPairingStore();
}

export function cleanupPendingPairingAuthority(): boolean {
  preparePendingPairingCleanup();
  clearAllPendingPairings();
  return removeKeysByPrefix('caros.fleet.pairing.');
}

export function verifyPendingPairingAuthorityEmpty(): boolean {
  return isPendingPairingRuntimeEmpty() &&
    hasKeysByPrefix('caros.fleet.pairing.') === false;
}

/**
 * Çıkış / hesap değişimi — kuyruk, snapshot ve bekleyen pairing TAMAMEN silinir.
 * Başka kullanıcının verisi yeni oturuma SIZAMAZ.
 *
 * Sıra ÖNEMLİ: önce uçuştaki senkron turu geçersiz kılınır (`abort`), sonra
 * kalıcı depo silinir. Ters sırada, uçuştaki bir yanıt temizlenmiş kuyruğa
 * yeniden yazabilirdi.
 *
 * DÖNEN DEĞER DOĞRULAMADIR: `ok:false` ise çağıran oturumu fail-closed
 * başlatmalıdır — "sildim herhâlde" varsayımı sızıntının ta kendisidir.
 */
export async function resetOfflineState(): Promise<OfflineResetResult> {
  await cleanupOfflineQueueAuthority();
  cleanupOwnershipSnapshotAuthority();
  cleanupPendingPairingAuthority();

  const residual = countResidualFleetKeys();
  if (residual === null) {
    // Sayılamadı → temizliği DOĞRULANMIŞ ilan etmiyoruz.
    return { ok: false, residualKeys: 0, verifiable: false };
  }
  return { ok: residual === 0, residualKeys: residual, verifiable: true };
}

/* ── Kapsam korumalı temizlik (hidrasyon yolu) ─────────────────────────── */

/**
 * KAPSAM KORUMALI TEMİZLİK — oturum HİDRASYONU için.
 *
 * ── NEDEN AYRI BİR KAPI VAR ───────────────────────────────────────────
 * `resetOfflineState()` HER ŞEYİ siler ve yalnız gerçek bir hesap
 * DEĞİŞİMİNDE doğrudur. Sayfa ilk açıldığında ise hesap değişmemiştir:
 * mevcut oturum yeniden okunur. O anda her şeyi silmek, kullanıcının
 * çevrimdışı sıraya aldığı işlemleri SESSİZCE yok eder — telefonda
 * ölçüldü: bekleyen işlem sayfa geçişinde kayboluyor ve ekran
 * "Tüm işlemleriniz sunucuya iletildi" diyordu (yalan tamamlanma).
 *
 * Bu fonksiyon güvenlik amacını KORUR: başka hesaba ait hiçbir kayıt
 * ayakta kalmaz. Yalnız (a) şu anki hesabın kendi kayıtları ve
 * (b) oturumdan bağımsız CİHAZ kapsamı eşleştirme kaydı bırakılır.
 *
 * `userId` yoksa (çıkış yapılmış) davranış tam temizliktir — hiçbir
 * çevrimdışı kayıt oturumsuz ayakta kalmaz.
 */
export async function retainOnlyAccountOfflineState(
  userId: string | null,
): Promise<OfflineResetResult> {
  if (!userId) return resetOfflineState();

  // Uçuştaki senkron turu her hâlükârda geçersiz kılınır.
  prepareOfflineQueueCleanup();

  if (typeof window === 'undefined') {
    return { ok: false, residualKeys: 0, verifiable: false };
  }

  const PREFIXES: readonly OfflineAuthorityPrefix[] = [
    'caros.fleet.queue.',
    'caros.fleet.snapshot.',
    'caros.fleet.pairing.',
  ];
  // Cihaz kapsamı eşleştirme oturuma bağlı DEĞİLDİR (oturumsuz PWA ekranı
  // üretir) → hesap hidrasyonunda silinmez.
  const KEEP_NAMESPACES = new Set<string>([userId, 'device']);

  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const prefix = PREFIXES.find((p) => key.startsWith(p));
      if (!prefix) continue;
      const namespace = key.slice(prefix.length);
      // `caros.fleet.queue.corrupt.<ns>` gibi ara segmentli anahtarlar da
      // son segmentten çözülür — bilinmeyen biçim FAIL-CLOSED silinir.
      const owner = namespace.includes('.')
        ? namespace.slice(namespace.lastIndexOf('.') + 1)
        : namespace;
      if (!KEEP_NAMESPACES.has(owner)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    return { ok: false, residualKeys: 0, verifiable: false };
  }

  // Bellekteki otoriteler bu hesaba ait DEĞİLSE bırakılır (hesap değişimi
  // değil; `getQueue` zaten kullanıcı değişince yeniden kurar).
  const residual = countForeignFleetKeys(userId);
  if (residual === null) return { ok: false, residualKeys: 0, verifiable: false };
  return { ok: residual === 0, residualKeys: residual, verifiable: true };
}

/** Şu anki hesaba ve cihaz kapsamına AİT OLMAYAN filo anahtarı adedi. */
function countForeignFleetKeys(userId: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    let count = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith('caros.fleet.')) continue;
      if (key.endsWith(`.${userId}`) || key.endsWith('.device')) continue;
      count += 1;
    }
    return count;
  } catch {
    return null;
  }
}

/** Tarayıcı çevrimiçi mi (SSR'da true varsayılır — sunucuda kuyruk yok). */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}
