/**
 * apiAuth.ts — FİLO API ROTALARI İÇİN ORTAK YETKİ + HATA KAPISI.
 *
 * · Kimlik YALNIZ oturumdan (`auth.getUser()`) alınır — istemci gövdesinden
 *   actor `user_id` ASLA okunmaz.
 * · RPC'ler kullanıcının KENDİ oturum istemcisiyle çağrılır; `service_role`
 *   kullanılmaz (SECURITY DEFINER fonksiyonlar `auth.uid()`'i okur).
 * · Tanınmayan Postgres hatası `server_error`'a düşer — ham metin SIZDIRILMAZ.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  type FleetErrorCode,
  errorBody,
  httpStatusFor,
  mapRpcError,
} from './errors';
import { type Capability, type FleetRole, can, isFleetRole } from './roles';

export interface FleetActor {
  userId:    string;
  companyId: string | null;
  role:      FleetRole;
  supabase:  SupabaseClient;
}

export function fleetError(code: FleetErrorCode): NextResponse {
  return NextResponse.json(errorBody(code), { status: httpStatusFor(code) });
}

/**
 * Oturumdaki kullanıcıyı ve üyeliğini çözer.
 * Fail-closed: oturum yoksa/okunamazsa `null` döner.
 */
export async function resolveActor(): Promise<FleetActor | null> {
  if (!isSupabaseConfigured) return null;

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseServerClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', data.user.id)
    .maybeSingle();

  const rawRole = (profile as { role?: unknown } | null)?.role;
  return {
    userId:    data.user.id,
    companyId: ((profile as { company_id?: string | null } | null)?.company_id) ?? null,
    // Bilinmeyen rol → fail-closed en dar yetki.
    role:      isFleetRole(rawRole) ? rawRole : 'individual',
    supabase,
  };
}

/**
 * Yetki kapısı — **sunucu tarafı doğrulama**. UI görünürlüğü yeterli DEĞİLDİR.
 * Yetki yoksa hazır `NextResponse` döner; varsa `null`.
 */
export function assertCapability(actor: FleetActor, capability: Capability): NextResponse | null {
  if (!can(actor.role, capability)) return fleetError('permission_denied');
  return null;
}

/** Şirket üyeliği zorunlu olan uçlar için kapı. */
export function assertCompany(actor: FleetActor): NextResponse | null {
  if (!actor.companyId) return fleetError('no_company');
  return null;
}

export interface RpcOutcome<T> {
  data:  T | null;
  error: FleetErrorCode | null;
}

/** RPC çağrısı + typed hata eşlemesi (tek kapı). */
export async function callRpc<T>(
  actor: FleetActor,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcOutcome<T>> {
  const { data, error } = await actor.supabase.rpc(fn, args);
  if (error) return { data: null, error: mapRpcError(error.message) };
  return { data: (data ?? null) as T | null, error: null };
}

/** Gövdeyi güvenle okur; bozuk JSON → `null`. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
