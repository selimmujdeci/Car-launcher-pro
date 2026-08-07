/**
 * /api/company/members
 *
 *   GET  → filo üyelerini listele  (member.read)
 *   POST → filoya üye ekle          (member.invite — yalnız admin)
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

interface MemberRow {
  user_id:    string;
  full_name:  string | null;
  role:       string;
  created_at: string;
}

export async function GET() {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  const denied = assertCapability(actor, 'member.read');
  if (denied) return denied;

  const { data, error } = await callRpc<MemberRow[]>(actor, 'list_company_members');
  if (error) return fleetError(error);

  const members = Array.isArray(data) ? data : [];
  return NextResponse.json({
    members,
    adminCount: members.filter((m) => m.role === 'admin').length,
  });
}

export async function POST(request: Request) {
  const actor = await resolveActor();
  if (!actor) return fleetError('unauthenticated');

  const noCompany = assertCompany(actor);
  if (noCompany) return noCompany;

  // Observer/member üye ekleyemez — sunucu tarafında da doğrulanır.
  const denied = assertCapability(actor, 'member.invite');
  if (denied) return denied;

  const body = await readJson(request);
  if (!body) return fleetError('invalid_request');

  const userId = typeof body.userId === 'string' ? body.userId : '';
  const role   = typeof body.role === 'string' ? body.role : 'member';
  if (!userId) return fleetError('invalid_request');
  if (!isAssignableRole(role)) return fleetError('invalid_role');

  const { data, error } = await callRpc<{ user_id: string; company_id: string; role: string }>(
    actor, 'add_company_member', { p_user_id: userId, p_role: role },
  );
  if (error) return fleetError(error);

  return NextResponse.json({ member: data }, { status: 201 });
}
