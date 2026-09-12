/**
 * /api/company/members/:userId
 *
 *   PATCH  → rol değiştir  (member.role.update — yalnız admin, son admin korumalı)
 *   DELETE → üyeyi kaldır  (member.remove    — yalnız admin, son admin korumalı)
 *
 * Hedef kullanıcı URL'den; ACTOR ise yalnız oturumdan gelir.
 */

import { NextResponse } from 'next/server';
import {
  resolveActor,
  assertCapability,
  assertCompany,
  fleetError,
  callRpc,
  readJson,
} from '@/lib/fleet/apiAuth';
import { isAssignableRole } from '@/lib/fleet/roles';

interface RouteContext {
  params: Promise<{ userId: string }> | { userId: string };
}

async function resolveUserId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params?.userId ?? '';
}

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  const denied = assertCapability(actor, 'member.role.update');
  if (denied) return denied;

  const userId = await resolveUserId(context);
  if (!userId) return fleetError('invalid_request');

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');

  const role = typeof body.role === 'string' ? body.role : '';
  if (!isAssignableRole(role)) return fleetError('invalid_role');

  const { data, error } = await callRpc<{ user_id: string; company_id: string; role: string }>(
    actor, 'update_member_role', { p_user_id: userId, p_role: role },
  );
  if (error) return fleetError(error);

  return NextResponse.json({ member: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  const denied = assertCapability(actor, 'member.remove');
  if (denied) return denied;

  const userId = await resolveUserId(context);
  if (!userId) return fleetError('invalid_request');

  const { data, error } = await callRpc<{ user_id: string; removed: boolean }>(
    actor, 'remove_company_member', { p_user_id: userId },
  );
  if (error) return fleetError(error);

  return NextResponse.json({ removed: data });
}
