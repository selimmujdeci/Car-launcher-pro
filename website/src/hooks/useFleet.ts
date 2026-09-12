'use client';

/**
 * useFleet — filo durumu + eylemler (çevrimiçi/çevrimdışı tek kapı).
 *
 * Çevrimiçiyken doğrudan API çağrılır; çevrimdışıyken işlem domain kuyruğuna
 * PENDING olarak yazılır ve kullanıcıya "kaydedildi, senkron bekliyor" denir —
 * **"başarılı" DENMEZ**.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getQueue, getOrchestrator, isOnline, storeSnapshot, getSnapshot,
  enqueueOfflineMutation,
} from '@/lib/offline/fleetOffline';
import { type OfflineClass, classifyOffline } from '@/lib/offline/offlineClassification';
import { buildSnapshot, type OwnershipSnapshot } from '@/lib/offline/ownershipSnapshot';
import type { QueueItem, OperationType, ConflictCode } from '@/lib/offline/types';
import { type FleetRole, type Capability, can, capabilitiesOf } from '@/lib/fleet/roles';
import { type FleetErrorCode, isFleetErrorCode, messageFor } from '@/lib/fleet/errors';
import {
  evaluateAccountScopedCapability,
  getAccountCleanupRuntime,
} from '@/security/accountCleanup/accountCleanupRuntime';

export interface CompanyInfo {
  id:         string;
  name:       string;
  created_at: string;
}

export interface MemberInfo {
  user_id:    string;
  full_name:  string | null;
  role:       string;
  created_at: string;
}

export interface CompanyVehicleInfo {
  vehicle_id: string;
  name:       string | null;
  plate:      string | null;
  owner_id:   string | null;
  last_seen:  string | null;
  /**
   * Sunucudan gelen araç revizyonu (migration 040). Sahiplik devri bunu
   * ZORUNLU tutar; yoksa `null` kalır ve devir fail-closed reddedilir.
   * UYDURULMAZ.
   */
  revision?:  number | null;
}

export type FleetPhase = 'loading' | 'ready' | 'error' | 'offline';

export interface FleetActionResult {
  ok:       boolean;
  queued:   boolean;
  code:     FleetErrorCode | null;
  message:  string | null;
  /**
   * İşlemin çevrimdışı sınıfı. UI, `OFFLINE_DEFERRED` sonucu ASLA
   * "tamamlandı" olarak göstermez — sunucu onayı bekleniyor demektir.
   */
  offlineClass: OfflineClass | null;
  /** Sunucu doğruladı mı — "Kaydedildi" YALNIZ bu true iken yazılabilir. */
  serverConfirmed: boolean;
}

const OK: FleetActionResult = {
  ok: true, queued: false, code: null, message: null,
  offlineClass: null, serverConfirmed: true,
};

function fail(code: FleetErrorCode): FleetActionResult {
  return {
    ok: false, queued: false, code, message: messageFor(code),
    offlineClass: null, serverConfirmed: false,
  };
}

/** Kullanıcı-benzersiz idempotency anahtarı (Math.random yerine crypto). */
function newKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${performance.now()}`;
  return `${prefix}:${rand}`;
}

export function useFleet(userId: string | null) {
  const [phase, setPhase]       = useState<FleetPhase>('loading');
  const [company, setCompany]   = useState<CompanyInfo | null>(null);
  const [role, setRole]         = useState<FleetRole>('individual');
  const [members, setMembers]   = useState<MemberInfo[]>([]);
  const [vehicles, setVehicles] = useState<CompanyVehicleInfo[]>([]);
  const [queueItems, setQueue]  = useState<QueueItem[]>([]);
  const [snapshot, setSnapshot] = useState<OwnershipSnapshot | null>(null);
  const [errorCode, setError]   = useState<FleetErrorCode | null>(null);
  /**
   * Kuyruk GERÇEKTEN okundu mu.
   *
   * ONARILAN KUSUR (telefonda ölçüldü): `refreshQueue()` yetki kapısı
   * kapalıyken sessizce geri dönüyordu ve `queueItems` boş kalıyordu; ekran
   * bunu "Bekleyen işlem yok — Tüm işlemleriniz sunucuya iletildi" diye
   * yorumluyordu. Oysa depoda bekleyen bir işlem vardı: yani "okunamadı"
   * durumu "boş" gibi sunuluyordu (yalan tamamlanma).
   */
  const [queueKnown, setQueueKnown] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!userId) return;
    const access = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (!access.allowed) return;
    const items = await getQueue(userId).all();
    const current = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (mountedRef.current && current.allowed && current.generation === access.generation) {
      setQueue([...items]);
      setQueueKnown(true);
    }
  }, [userId]);

  /** Sunucudan durum çeker; çevrimdışıysa son doğrulanmış snapshot'a düşer. */
  const refresh = useCallback(async () => {
    if (!userId) return;
    const access = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (!access.allowed) return;
    /**
     * `loading`'de MAHSUR KALMA koruması (telefonda ölçüldü).
     *
     * `refresh()` en başta `loading` yazıp, kapsam/kuşak kapısı arada
     * değişirse hiçbir terminal duruma geçmeden `return` ediyordu. Sonuç:
     * ekran süresiz "Üyeler yükleniyor…" kalıyor, form hiç render edilmiyor
     * ve kullanıcı çevrimdışı bir işlem SIRAYA ALAMIYORDU. Terminal duruma
     * geçilmediyse aşağıda dürüst bir duruma düşülür.
     */
    let terminal = false;
    const bitirme = () => {
      if (terminal || !mountedRef.current) return;
      setPhase(isOnline() ? 'ready' : 'offline');
    };
    setPhase('loading');
    setError(null);

    if (!isOnline()) {
      const snap = getSnapshot(userId);
      const current = evaluateAccountScopedCapability('QUEUE_SYNC');
      if (mountedRef.current && current.allowed && current.generation === access.generation) {
        setSnapshot(snap);
        setRole(snap?.companyRole ?? 'individual');
        setPhase('offline');
        terminal = true;
      }
      bitirme();
      await refreshQueue();
      return;
    }

    try {
      const res  = await fetch('/api/company');
      const body = (await res.json()) as {
        company?: CompanyInfo | null; role?: string; code?: unknown;
      };

      if (!res.ok) {
        const code = isFleetErrorCode(body?.code) ? body.code : 'server_error';
        if (mountedRef.current) { setError(code); setPhase('error'); terminal = true; }
        bitirme();
        return;
      }

      const nextRole: FleetRole = (body.role as FleetRole) ?? 'individual';
      const nextCompany = body.company ?? null;

      let nextMembers: MemberInfo[] = [];
      let nextVehicles: CompanyVehicleInfo[] = [];

      if (nextCompany && can(nextRole, 'member.read')) {
        const r = await fetch('/api/company/members');
        if (r.ok) nextMembers = ((await r.json()) as { members: MemberInfo[] }).members ?? [];
      }
      if (nextCompany && can(nextRole, 'vehicle.read')) {
        const r = await fetch('/api/company/vehicles');
        if (r.ok) nextVehicles = ((await r.json()) as { vehicles: CompanyVehicleInfo[] }).vehicles ?? [];
      }

      // Son DOĞRULANMIŞ erişim → snapshot (offline fail-closed kararları için).
      const snap = buildSnapshot({
        userId,
        companyId:            nextCompany?.id ?? null,
        companyRole:          nextRole,
        ownedVehicleIds:      nextVehicles.filter((v) => v.owner_id === userId).map((v) => v.vehicle_id),
        accessibleVehicleIds: nextVehicles.map((v) => v.vehicle_id),
        serverRevision:       Date.now(),
        verifiedAt:           Date.now(),
      });
      storeSnapshot(snap);

      const current = evaluateAccountScopedCapability('QUEUE_SYNC');
      if (mountedRef.current && current.allowed && current.generation === access.generation) {
        setCompany(nextCompany);
        setRole(nextRole);
        setMembers(nextMembers);
        setVehicles(nextVehicles);
        setSnapshot(snap);
        setPhase('ready');
        terminal = true;
      }
      bitirme();
      await refreshQueue();
    } catch {
      if (mountedRef.current) { setPhase('offline'); terminal = true; }
      bitirme();
      await refreshQueue();
    }
  }, [userId, refreshQueue]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const runtime = getAccountCleanupRuntime();

    /**
     * SOĞUK AÇILIŞ KAPISI (telefonda ölçüldü).
     *
     * `evaluateCapability` runtime `initialized` olana kadar
     * `RUNTIME_UNAVAILABLE` döner. Bu hook runtime'ı hiç `initialize()`
     * etmediği için soğuk açılışta kapı KALICI olarak kapalı kalıyordu:
     * kuyruk hiç okunmuyor, ekran "Bekleyen işlem yok" diyordu. Başlatmayı
     * burada tetikleriz ve yetki geldiğinde kuyruğu GERÇEKTEN okuruz.
     */
    // Savunmalı çağrı: test/mock runtime'larında `initialize` bulunmayabilir.
    const baslat = (runtime as { initialize?: () => Promise<unknown> }).initialize;
    if (typeof baslat === 'function') {
      try { void Promise.resolve(baslat.call(runtime)).catch(() => { /* fail-soft */ }); }
      catch { /* fail-soft */ }
    }

    return runtime.subscribe(() => {
      if (!mountedRef.current) return;
      if (!evaluateAccountScopedCapability('QUEUE_SYNC').allowed) {
        setPhase('loading');
        setCompany(null);
        setRole('individual');
        setMembers([]);
        setVehicles([]);
        setQueue([]);
        // Yetki yokken kuyruk BİLİNMİYOR — "boş" DEĞİL.
        setQueueKnown(false);
        setSnapshot(null);
        setError(null);
        return;
      }
      // Kapı açıldı → kuyruk okunur (soğuk açılışta boş kalmasın).
      void refreshQueue();
    });
  }, [refreshQueue]);

  /* ── Ortak eylem yürütücüsü ─────────────────────────────────────────── */

  const perform = useCallback(async (
    operationType: OperationType,
    request: { url: string; method: string; body?: Record<string, unknown> },
    meta: { dedupKey: string; vehicleId?: string | null; payload: Record<string, unknown> },
    requiredCapability: Capability,
  ): Promise<FleetActionResult> => {
    if (!userId) return fail('unauthenticated');
    const access = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (!access.allowed) return fail('account_cleanup_in_progress');

    // Yetki kapısı — UI'da da doğrulanır; sunucu ayrıca doğrular.
    if (!can(role, requiredCapability)) return fail('permission_denied');

    /**
     * Çevrimdışı yol — TEK KAPI.
     *
     * Güvenlik/sahiplik işlemleri (`ONLINE_REQUIRED`) burada REDDEDİLİR:
     * kuyruğa alınıp "kaydedildi" denirse kullanıcı henüz kimsenin vermediği
     * bir yetkiyi verilmiş sayar.
     */
    const queueOffline = async (): Promise<FleetActionResult> => {
      const current = evaluateAccountScopedCapability('QUEUE_SYNC');
      if (!current.allowed || current.generation !== access.generation) {
        return fail('account_cleanup_in_progress');
      }
      const outcome = await enqueueOfflineMutation(userId, {
        operationType,
        actorId:        userId,
        companyId:      company?.id ?? null,
        vehicleId:      meta.vehicleId ?? null,
        payload:        meta.payload,
        dedupKey:       meta.dedupKey,
        idempotencyKey: newKey(operationType),
      });
      await refreshQueue();

      if (!outcome.ok) {
        return {
          ok: false, queued: false,
          code: outcome.errorCode, message: outcome.message,
          offlineClass: outcome.klass, serverConfirmed: false,
        };
      }
      return {
        ok: true, queued: true, code: null, message: outcome.message,
        offlineClass: outcome.klass,
        // Kuyruğa yazmak SUNUCU ONAYI DEĞİLDİR.
        serverConfirmed: false,
      };
    };

    if (!isOnline()) return queueOffline();

    try {
      const res = await fetch(request.url, {
        method:  request.method,
        headers: { 'Content-Type': 'application/json' },
        body:    request.body ? JSON.stringify(request.body) : undefined,
      });
      if (res.ok) { await refresh(); return OK; }

      const body = (await res.json()) as { code?: unknown };
      return fail(isFleetErrorCode(body?.code) ? body.code : 'server_error');
    } catch {
      // Ağ koptu → aynı kapıdan geç. "Başarılı" DENMEZ.
      return queueOffline();
    }
  }, [userId, role, company, refresh, refreshQueue]);

  /* ── Eylemler ───────────────────────────────────────────────────────── */

  const createCompany = useCallback((name: string) =>
    perform('COMPANY_CREATE',
      { url: '/api/company', method: 'POST', body: { name } },
      { dedupKey: `company_create:${userId}`, payload: { name } },
      'vehicle.read', // bireysel kullanıcı da şirket kurabilir → şirket yetkisi aranmaz
    ), [perform, userId]);

  const updateCompany = useCallback((name: string) =>
    perform('COMPANY_UPDATE',
      { url: '/api/company', method: 'PATCH', body: { name } },
      { dedupKey: `company_update:${company?.id ?? ''}`, payload: { name } },
      'company.update',
    ), [perform, company]);

  const addMember = useCallback((targetUserId: string, memberRole: string) =>
    perform('MEMBER_ADD',
      { url: '/api/company/members', method: 'POST', body: { userId: targetUserId, role: memberRole } },
      { dedupKey: `member_add:${targetUserId}`, payload: { userId: targetUserId, role: memberRole } },
      'member.invite',
    ), [perform]);

  const updateMemberRole = useCallback((targetUserId: string, memberRole: string) =>
    perform('MEMBER_ROLE_UPDATE',
      { url: `/api/company/members/${targetUserId}`, method: 'PATCH', body: { role: memberRole } },
      { dedupKey: `member_role:${targetUserId}:${memberRole}`, payload: { userId: targetUserId, role: memberRole } },
      'member.role.update',
    ), [perform]);

  const removeMember = useCallback((targetUserId: string) =>
    perform('MEMBER_REMOVE',
      { url: `/api/company/members/${targetUserId}`, method: 'DELETE' },
      { dedupKey: `member_remove:${targetUserId}`, payload: { userId: targetUserId } },
      'member.remove',
    ), [perform]);

  const assignVehicle = useCallback((vehicleId: string) =>
    perform('VEHICLE_ASSIGN_COMPANY',
      { url: '/api/company/vehicles/assign', method: 'POST', body: { vehicleId } },
      { dedupKey: `vehicle_assign:${vehicleId}`, vehicleId, payload: { vehicleId } },
      'vehicle.assign',
    ), [perform]);

  const removeVehicle = useCallback((vehicleId: string) =>
    perform('VEHICLE_REMOVE_COMPANY',
      { url: '/api/company/vehicles/remove', method: 'POST', body: { vehicleId } },
      { dedupKey: `vehicle_remove:${vehicleId}`, vehicleId, payload: { vehicleId } },
      'vehicle.remove',
    ), [perform]);

  /* ── Senkron ve conflict ────────────────────────────────────────────── */

  const sync = useCallback(async () => {
    if (!userId || !isOnline()) return;
    const access = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (!access.allowed) return;
    await getOrchestrator(userId).drain();
    const current = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (!current.allowed || current.generation !== access.generation) return;
    await refreshQueue();
    await refresh();
  }, [userId, refresh, refreshQueue]);

  const retryItem = useCallback(async (id: string) => {
    if (!userId) return;
    if (!evaluateAccountScopedCapability('QUEUE_SYNC').allowed) return;
    await getQueue(userId).retry(id);
    await refreshQueue();
  }, [userId, refreshQueue]);

  const cancelItem = useCallback(async (id: string) => {
    if (!userId) return;
    if (!evaluateAccountScopedCapability('QUEUE_SYNC').allowed) return;
    await getQueue(userId).cancel(id);
    await refreshQueue();
  }, [userId, refreshQueue]);

  /* ── BAĞLANTI GERİ GELİNCE KUYRUK GERÇEKTEN GÖNDERİLİR ──────────────────
   * ONARILAN KUSUR (telefonda ölçüldü): çevrimdışı bannerı "bağlantı geri
   * geldiğinde gönderilecek" DİYORDU ama hiçbir otomatik senkron yoktu —
   * uçak modu kapatıldıktan 40 sn sonra sunucuya TEK bir istek bile gitmedi
   * ve işlem PENDING kaldı. Kullanıcı "Şimdi gönder"e basmadıkça kuyruk
   * süresiz bekliyordu; bu, ekranın verdiği sözün tutulmamasıdır.
   *
   * Çift gönderim riski YOK: `SyncOrchestrator` kendi `running` kilidiyle
   * ikinci turu başlatmaz (P3'te ağ katmanında ölçüldü: PATCH tam 1 kez).
   */
  const syncRef    = useRef(sync);
  const refreshRef = useRef(refresh);
  useEffect(() => { syncRef.current = sync; refreshRef.current = refresh; }, [sync, refresh]);

  useEffect(() => {
    if (!userId) return;
    const onOnline = () => { void syncRef.current(); };
    // Çevrimdışına düşüldüğünde ekran GERÇEĞİ göstermeli: `phase` yenilenir,
    // böylece çevrimdışı kapıları (devir ekranı vb.) beklemeden devreye girer.
    const onOffline = () => { void refreshRef.current(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [userId]);

  const conflicts = queueItems.filter((i) => i.status === 'CONFLICT');
  const pending   = queueItems.filter(
    (i) => i.status === 'PENDING' || i.status === 'BLOCKED_BY_DEPENDENCY' || i.status === 'RETRYABLE_FAILED',
  );

  return {
    phase, company, role, members, vehicles, snapshot,
    permissions: capabilitiesOf(role),
    errorCode, errorMessage: errorCode ? messageFor(errorCode) : null,
    queueItems, pending, conflicts,
    /** Kuyruk okunabildi mi — `false` ise "bekleyen yok" DENEMEZ. */
    queueKnown,
    conflictCodes: conflicts.map((c) => c.failureCode as ConflictCode | null),
    refresh, sync, retryItem, cancelItem,
    createCompany, updateCompany,
    addMember, updateMemberRole, removeMember,
    assignVehicle, removeVehicle,
    can: (capability: Capability) => can(role, capability),
    /** UI, çevrimdışıyken bir işlemin yapılabilirliğini buradan sorar. */
    offlineClassOf: (operationType: OperationType) => classifyOffline(operationType),
  };
}
