/**
 * /api/vehicle/transfer — ARAÇ SAHİPLİĞİ DEVRİ UCU.
 *
 * Otorite migration 039'un SECURITY DEFINER RPC'lerindedir. Bu rota yalnız
 * ince bir kapıdır:
 *   · Kimlik YALNIZ oturumdan (`resolveActor`) — gövdeden actor id OKUNMAZ.
 *   · RPC kullanıcının KENDİ oturum istemcisiyle çağrılır (`auth.uid()` doğru).
 *   · Ham Postgres metni SIZDIRILMAZ — `callRpc` typed koda çevirir.
 *
 * GET    → kullanıcının tarafı olduğu transferler (bounded, RPC 100 ile sınırlar)
 * POST   → devir başlat
 * PATCH  → kabul / ret
 * DELETE → iptal
 */

import { NextResponse } from 'next/server';
import {
  resolveActor, fleetError, callRpc, readJson,
} from '@/lib/fleet/apiAuth';

/** Basit UUID doğrulaması — biçimsiz kimlik RPC'ye HİÇ gitmez. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export async function GET(): Promise<NextResponse> {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const { data, error } = await callRpc<unknown[]>(actor, 'list_vehicle_transfers');
  if (error) return fleetError(error);
  return NextResponse.json({ transfers: data ?? [] });
}

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');

  const vehicleId      = body.vehicleId;
  const toOwnerType    = body.toOwnerType;
  const toOwnerId      = body.toOwnerId;
  const idempotencyKey = body.idempotencyKey;
  const expectedRevision = body.expectedRevision;

  if (!isUuid(vehicleId) || !isUuid(toOwnerId)) return fleetError('invalid_request');
  if (toOwnerType !== 'INDIVIDUAL' && toOwnerType !== 'COMPANY') {
    return fleetError('invalid_request');
  }
  // Idempotency anahtarı ZORUNLU: tekrar gönderim ikinci transfer AÇMAMALI.
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    return fleetError('invalid_request');
  }
  // Revizyon ZORUNLU: optimistic concurrency olmadan devir kabul edilmez.
  if (typeof expectedRevision !== 'number' || !Number.isFinite(expectedRevision)) {
    return fleetError('invalid_request');
  }

  const { data, error } = await callRpc<string>(actor, 'start_vehicle_transfer', {
    p_vehicle_id:        vehicleId,
    p_to_owner_type:     toOwnerType,
    p_to_owner_id:       toOwnerId,
    p_idempotency_key:   idempotencyKey,
    p_expected_revision: expectedRevision,
  });
  if (error) return fleetError(error);
  return NextResponse.json({ transferId: data });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');
  if (!isUuid(body.transferId)) return fleetError('invalid_request');

  const action = body.action;
  if (action !== 'ACCEPT' && action !== 'REJECT') return fleetError('invalid_request');

  const fn = action === 'ACCEPT' ? 'accept_vehicle_transfer' : 'reject_vehicle_transfer';
  const { error } = await callRpc<boolean>(actor, fn, { p_transfer_id: body.transferId });
  if (error) return fleetError(error);

  // "Tamamlandı" YALNIZ RPC transaction'ı commit ettiğinde döner.
  return NextResponse.json({ ok: true, action });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const body = await readJson(request);
  if (!body || !isUuid(body.transferId)) return fleetError('invalid_request');

  const { error } = await callRpc<boolean>(actor, 'cancel_vehicle_transfer', {
    p_transfer_id: body.transferId,
  });
  if (error) return fleetError(error);
  return NextResponse.json({ ok: true });
}
