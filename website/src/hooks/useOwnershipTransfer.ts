'use client';

/**
 * useOwnershipTransfer — SAHİPLİK DEVRİ AKIŞI (tek hook).
 *
 * `useFleet`'ten AYRI tutulur: devir kendi durum makinesine, kendi offline
 * kapısına ve kendi hata sözleşmesine sahiptir; filo hook'una karıştırmak
 * ikinci bir sahiplik otoritesi üretme riski taşır.
 *
 * ANAYASA:
 *   · Devir işlemleri **ONLINE_REQUIRED** — çevrimdışı hiçbiri denenmez ve
 *     kuyruğa ASLA yazılmaz.
 *   · "Tamamlandı" YALNIZ sunucu transaction'ı commit ettiğinde gösterilir.
 *   · Ham backend metni UI'ye taşınmaz — bounded koda çevrilir.
 *   · Çift gönderim engellenir (uçuşta kilidi + idempotency anahtarı).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type TransferRecord, type TransferStatus, type OwnerType, type TransferAction,
  type StartTransferCheck,
  availableActions, canStartTransfer, isActiveTransfer, blockReasonLabel,
} from '@/lib/fleet/ownershipTransfer';
import {
  TransferRequestRunner, transferFailure, uiStateForOutcome,
  type TransferOutcome, type TransferRequest,
} from '@/lib/fleet/transferRequestRunner';
import { isOnline } from '@/lib/offline/fleetOffline';
import type { FleetRole } from '@/lib/fleet/roles';

/* ── UI durumu ─────────────────────────────────────────────────────────── */

export const TRANSFER_UI_STATES = [
  'idle',
  'loading',
  'validating_target',
  'submitting',
  'pending',
  'accepting',
  'rejecting',
  'cancelling',
  'completed',
  'expired',
  'conflict',
  'failed',
  'offline_required',
] as const;
export type TransferUiState = (typeof TRANSFER_UI_STATES)[number];

/**
 * Kullanıcıya dönük sonuç. Karar mantığı `TransferRequestRunner`'dadır —
 * hook yalnız React bağlamasıdır (ikinci otorite YOK).
 */
export type { TransferOutcome } from '@/lib/fleet/transferRequestRunner';


/** Sunucudan gelen ham satır → istemci kaydı (alan adları normalize edilir). */
function toRecord(row: Record<string, unknown>, viewerUserId: string | null, viewerCompanyId: string | null): TransferRecord | null {
  const id        = row.id;
  const vehicleId = row.vehicle_id;
  if (typeof id !== 'string' || typeof vehicleId !== 'string') return null;

  const toOwnerType = row.to_owner_type === 'COMPANY' ? 'COMPANY' : 'INDIVIDUAL';
  const fromOwnerType = row.from_owner_type === 'COMPANY' ? 'COMPANY' : 'INDIVIDUAL';

  // `list_vehicle_transfers` hedef kimliğini DÖNDÜRMEZ (PII daraltması).
  // Taraf olma bilgisi RPC'nin süzgecinden gelir: listede olan kullanıcı
  // zaten taraflardan biridir. Gönderen/hedef ayrımı `requested_by` ile yapılır.
  const requestedByMe = row.requested_by === viewerUserId;

  return {
    id,
    vehicleId,
    fromOwnerType,
    toOwnerType,
    status:     (row.status as TransferStatus) ?? 'PENDING',
    createdAt:  Date.parse(String(row.created_at ?? '')) || 0,
    expiresAt:  Date.parse(String(row.expires_at ?? '')) || 0,
    requestedByMe,
    // Gönderen değilsem ve listedeysem hedef tarafım.
    targetedAtMe: !requestedByMe,
    failureCode: typeof row.failure_code === 'string' ? row.failure_code : null,
  };
}

/* ── Hook ──────────────────────────────────────────────────────────────── */

export interface UseOwnershipTransferInput {
  userId:    string | null;
  companyId: string | null;
  role:      FleetRole;
}

export function useOwnershipTransfer(input: UseOwnershipTransferInput) {
  const { userId, companyId, role } = input;

  const [uiState, setUiState]     = useState<TransferUiState>('idle');
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [outcome, setOutcome]     = useState<TransferOutcome | null>(null);
  const mountedRef = useRef(true);

  /** Kapıların TEK sahibi. Ref: render'lar arasında kilit korunur. */
  const runnerRef = useRef<TransferRequestRunner | null>(null);
  if (runnerRef.current === null) {
    runnerRef.current = new TransferRequestRunner({
      isOnline,
      send: async (request) => {
        const res = await fetch('/api/vehicle/transfer', {
          method:  request.method,
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(request.body),
        });
        let body: unknown = null;
        try { body = await res.json(); } catch { /* gövdesiz yanıt */ }
        return { ok: res.ok, status: res.status, body };
      },
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    if (!isOnline()) { if (mountedRef.current) setUiState('offline_required'); return; }

    setUiState('loading');
    try {
      const res = await fetch('/api/vehicle/transfer');
      if (!res.ok) {
        const body = (await res.json()) as { code?: unknown };
        if (mountedRef.current) { setOutcome(transferFailure(body?.code)); setUiState('failed'); }
        return;
      }
      const body = (await res.json()) as { transfers?: Record<string, unknown>[] };
      const rows = (body.transfers ?? [])
        .map((row) => toRecord(row, userId, companyId))
        .filter((r): r is TransferRecord => r !== null);

      if (mountedRef.current) {
        setTransfers(rows);
        setUiState(rows.some((t) => isActiveTransfer(t.status)) ? 'pending' : 'idle');
      }
    } catch {
      if (mountedRef.current) setUiState('offline_required');
    }
  }, [userId, companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /* ── Ortak istek yürütücüsü ──────────────────────────────────────────── */

  const send = useCallback(async (
    busyState: TransferUiState,
    request: TransferRequest,
  ): Promise<TransferOutcome> => {
    if (!userId) return transferFailure('permission_denied');

    if (mountedRef.current && isOnline()) { setUiState(busyState); setOutcome(null); }

    // Tüm kapılar (çevrimdışı · çift gönderim · redaksiyon · "tamamlandı"
    // dürüstlüğü) runner'dadır — hook yalnız sonucu ekrana yansıtır.
    const result = await runnerRef.current!.run(request);

    if (mountedRef.current) {
      setOutcome(result);
      setUiState(uiStateForOutcome(result));
    }
    if (result.ok) await refresh();
    return result;
  }, [userId, refresh]);

  /* ── Eylemler ────────────────────────────────────────────────────────── */

  const start = useCallback(async (params: {
    vehicle:     { id: string; owner_id: string | null; company_id: string | null; revision: number | null };
    targetType:  OwnerType;
    targetId:    string;
  }): Promise<TransferOutcome> => {
    const check: StartTransferCheck = canStartTransfer({
      vehicle:           params.vehicle,
      viewerUserId:      userId,
      viewerCompanyId:   companyId,
      viewerRole:        role,
      targetType:        params.targetType,
      targetId:          params.targetId,
      hasActiveTransfer: transfers.some(
        (t) => t.vehicleId === params.vehicle.id && isActiveTransfer(t.status),
      ),
      online: isOnline(),
    });

    if (!check.allowed) {
      const result: TransferOutcome = {
        ok: false,
        code: check.reason === 'OFFLINE' ? 'ONLINE_REQUIRED' : 'CROSS_TENANT_DENIED',
        message: blockReasonLabel(check.reason!),
      };
      if (mountedRef.current) {
        setOutcome(result);
        setUiState(check.reason === 'OFFLINE' ? 'offline_required' : 'failed');
      }
      return result;
    }

    return send('submitting', {
      method: 'POST',
      body: {
        vehicleId:        params.vehicle.id,
        toOwnerType:      params.targetType,
        toOwnerId:        params.targetId,
        idempotencyKey:   newIdempotencyKey(params.vehicle.id, params.targetId),
        expectedRevision: params.vehicle.revision,
      },
    });
  }, [userId, companyId, role, transfers, send]);

  const accept = useCallback((transferId: string) =>
    send('accepting', { method: 'PATCH', body: { transferId, action: 'ACCEPT' } }),
  [send]);

  const reject = useCallback((transferId: string) =>
    send('rejecting', { method: 'PATCH', body: { transferId, action: 'REJECT' } }),
  [send]);

  const cancel = useCallback((transferId: string) =>
    send('cancelling', { method: 'DELETE', body: { transferId } }),
  [send]);

  /* ── Türetilmiş görünüm ──────────────────────────────────────────────── */

  const incoming = transfers.filter((t) => t.targetedAtMe && isActiveTransfer(t.status));
  const outgoing = transfers.filter((t) => t.requestedByMe && isActiveTransfer(t.status));
  const history  = transfers.filter((t) => !isActiveTransfer(t.status));

  return {
    uiState, outcome, transfers, incoming, outgoing, history,
    refresh, start, accept, reject, cancel,
    /** Bir transfer için kullanıcının görebileceği eylemler. */
    actionsFor: (transfer: TransferRecord): readonly TransferAction[] =>
      availableActions(transfer, { role, online: isOnline() }),
    /** Devir başlatılabilir mi (UI butonunu gizlemek için — güvenlik DEĞİL). */
    canStart: (vehicle: { id: string; owner_id: string | null; company_id: string | null; revision: number | null }, targetType: OwnerType, targetId: string | null) =>
      canStartTransfer({
        vehicle, viewerUserId: userId, viewerCompanyId: companyId, viewerRole: role,
        targetType, targetId,
        hasActiveTransfer: transfers.some((t) => t.vehicleId === vehicle.id && isActiveTransfer(t.status)),
        online: isOnline(),
      }),
  };
}

/**
 * İdempotency anahtarı — aynı araç+hedef için kararlı bir gövde + rastgele kuyruk.
 * `Math.random` yerine crypto; yoksa zaman damgası (test ortamı).
 */
function newIdempotencyKey(vehicleId: string, targetId: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  return `xfer:${vehicleId.slice(0, 8)}:${targetId.slice(0, 8)}:${rand}`;
}
