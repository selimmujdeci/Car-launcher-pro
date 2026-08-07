/**
 * fleetRolesAndConflicts.test.ts — ROL/CAPABILITY MATRİSİ + CONFLICT MOTORU.
 *
 * Bu kilitler ürünün güvenlik sözleşmesidir:
 *   · observer SALT-OKUNUR (yazma yetkisi SIFIR)
 *   · bilinmeyen rol → fail-closed (hiçbir yetki yok)
 *   · sahiplik/şirket çakışmasında otomatik local-wins YOK
 *   · "zorla devral" aksiyonu HİÇBİR conflict için üretilmez
 *
 * ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import {
  can, capabilitiesOf, isFleetRole, isAssignableRole,
  CAPABILITIES, FLEET_ROLES, ASSIGNABLE_ROLES,
} from '@/lib/fleet/roles';
import {
  policyFor, actionsFor, toConflictCode, allPolicies,
} from '@/lib/offline/conflictEngine';
import { CONFLICT_CODES } from '@/lib/offline/types';
import {
  mapRpcError, httpStatusFor, messageFor, isFleetErrorCode, FLEET_ERROR_CODES,
} from '@/lib/fleet/errors';

/* ── Rol matrisi ──────────────────────────────────────────────────────── */

describe('rol / capability matrisi', () => {
  it('observer HİÇBİR yazma yetkisine sahip değildir', () => {
    const writes = [
      'company.update', 'company.delete', 'member.invite', 'member.role.update',
      'member.remove', 'vehicle.assign', 'vehicle.remove', 'vehicle.command',
      'vehicle.settings.update',
    ] as const;
    for (const capability of writes) {
      expect(can('observer', capability)).toBe(false);
    }
  });

  it('observer okuma yetkilerine sahiptir', () => {
    expect(can('observer', 'company.read')).toBe(true);
    expect(can('observer', 'member.read')).toBe(true);
    expect(can('observer', 'vehicle.read')).toBe(true);
    expect(can('observer', 'vehicle.location.read')).toBe(true);
  });

  it('member şirket/üyelik yönetemez ama komut gönderebilir', () => {
    expect(can('member', 'vehicle.command')).toBe(true);
    expect(can('member', 'member.invite')).toBe(false);
    expect(can('member', 'member.role.update')).toBe(false);
    expect(can('member', 'company.update')).toBe(false);
    expect(can('member', 'vehicle.assign')).toBe(false);
  });

  it('admin tüm yetkilere sahiptir', () => {
    for (const capability of CAPABILITIES) {
      expect(can('admin', capability)).toBe(true);
    }
  });

  it('individual şirket/üyelik yetkisine sahip DEĞİLDİR', () => {
    expect(can('individual', 'company.read')).toBe(false);
    expect(can('individual', 'member.read')).toBe(false);
    expect(can('individual', 'member.invite')).toBe(false);
    expect(can('individual', 'vehicle.assign')).toBe(false);
  });

  it('bilinmeyen rol fail-closed — hiçbir yetki vermez', () => {
    for (const capability of CAPABILITIES) {
      expect(can('super_hacker', capability)).toBe(false);
      expect(can(null, capability)).toBe(false);
      expect(can(undefined, capability)).toBe(false);
      expect(can(42, capability)).toBe(false);
    }
    expect(capabilitiesOf('bilinmeyen')).toEqual([]);
  });

  it('rol doğrulayıcıları yalnız bilinen değerleri kabul eder', () => {
    for (const role of FLEET_ROLES) expect(isFleetRole(role)).toBe(true);
    expect(isFleetRole('super_admin')).toBe(false);
    for (const role of ASSIGNABLE_ROLES) expect(isAssignableRole(role)).toBe(true);
    // 'individual' ATANAMAZ — yalnız sistem tarafından verilir.
    expect(isAssignableRole('individual')).toBe(false);
  });
});

/* ── Conflict motoru ──────────────────────────────────────────────────── */

describe('conflict motoru', () => {
  it('her conflict kodunun tanımlı politikası vardır', () => {
    for (const code of CONFLICT_CODES) {
      const policy = policyFor(code);
      expect(policy).toBeDefined();
      expect(policy.code).toBe(code);
      expect(policy.title.length).toBeGreaterThan(0);
      expect(policy.explanation.length).toBeGreaterThan(0);
    }
    expect(allPolicies()).toHaveLength(CONFLICT_CODES.length);
  });

  it('sahiplik çakışmaları OTOMATİK çözülmez — kullanıcı kararı ister', () => {
    for (const code of ['VEHICLE_ALREADY_OWNED', 'OWNERSHIP_CHANGED'] as const) {
      const policy = policyFor(code);
      expect(policy.autoResolvable).toBe(false);
      expect(policy.requiresUserDecision).toBe(true);
      expect(policy.resolution).toBe('USER_DECISION');
      // Sahipliği yerelde "kazanmak" mümkün olmamalı.
      expect(policy.localRetryAllowed).toBe(false);
    }
  });

  it('şirket çakışmaları güvenli varsayılan server-wins ile çözülür', () => {
    for (const code of ['USER_ALREADY_IN_COMPANY', 'PERMISSION_REVOKED', 'ROLE_CHANGED_ON_SERVER'] as const) {
      const policy = policyFor(code);
      expect(policy.resolution).toBe('SERVER_WINS');
      expect(policy.cancelOperation).toBe(true);
    }
  });

  it('HİÇBİR conflict "zorla devral" aksiyonu üretmez', () => {
    for (const code of CONFLICT_CODES) {
      const actions = actionsFor(code) as readonly string[];
      expect(actions).not.toContain('FORCE_TAKEOVER');
      expect(actions).not.toContain('LOCAL_WINS');
      expect(actions).not.toContain('OVERRIDE');
    }
  });

  it('sahiplik çakışmasında yeniden deneme sunulmaz', () => {
    expect(actionsFor('VEHICLE_ALREADY_OWNED')).not.toContain('RETRY');
    expect(actionsFor('OWNERSHIP_CHANGED')).not.toContain('RETRY');
  });

  it('her conflict en az "kabul et" ve "vazgeç" seçeneği sunar', () => {
    for (const code of CONFLICT_CODES) {
      const actions = actionsFor(code);
      expect(actions).toContain('ACCEPT_SERVER_STATE');
      expect(actions).toContain('CANCEL');
    }
  });

  it('veri kaybı riski yalnız bayat revizyonda işaretlenir', () => {
    expect(policyFor('STALE_CLIENT_REVISION').dataLossRisk).toBe(true);
    expect(policyFor('DUPLICATE_OPERATION').dataLossRisk).toBe(false);
  });

  it('sunucu hata kodu doğru conflict koduna çevrilir', () => {
    expect(toConflictCode('vehicle_owned_by_another_user', 'VEHICLE_PAIR')).toBe('VEHICLE_ALREADY_OWNED');
    expect(toConflictCode('vehicle_owned_by_another_user', 'VEHICLE_ASSIGN_COMPANY')).toBe('OWNERSHIP_CHANGED');
    expect(toConflictCode('user_belongs_to_another_company', 'MEMBER_ADD')).toBe('USER_ALREADY_IN_COMPANY');
    expect(toConflictCode('pairing_code_expired', 'VEHICLE_PAIR')).toBe('PAIRING_CODE_EXPIRED');
    expect(toConflictCode('stale_client_revision', 'COMPANY_UPDATE')).toBe('STALE_CLIENT_REVISION');
    expect(toConflictCode('company_deleted', 'COMPANY_UPDATE')).toBe('COMPANY_DELETED');
  });

  it('conflict OLMAYAN hatalar null döner (normal hata yolu)', () => {
    expect(toConflictCode('invalid_company_name', 'COMPANY_CREATE')).toBeNull();
    expect(toConflictCode('server_error', 'COMPANY_CREATE')).toBeNull();
    expect(toConflictCode('unauthenticated', 'MEMBER_ADD')).toBeNull();
  });
});

/* ── Hata sözleşmesi ──────────────────────────────────────────────────── */

describe('typed hata sözleşmesi', () => {
  it('her kodun HTTP durumu ve Türkçe mesajı vardır', () => {
    for (const code of FLEET_ERROR_CODES) {
      expect(httpStatusFor(code)).toBeGreaterThanOrEqual(400);
      expect(messageFor(code).length).toBeGreaterThan(0);
    }
  });

  it('tanınmayan Postgres hatası server_error olur — ham metin sızmaz', () => {
    expect(mapRpcError('duplicate key value violates unique constraint "x"')).toBe('server_error');
    expect(mapRpcError('')).toBe('server_error');
    expect(mapRpcError(null)).toBe('server_error');
    expect(mapRpcError(undefined)).toBe('server_error');
  });

  it('bilinen RPC hataları typed koda çevrilir', () => {
    expect(mapRpcError('ERROR: not_company_admin')).toBe('not_company_admin');
    expect(mapRpcError('last_admin_protected')).toBe('last_admin_protected');
    expect(mapRpcError('already_member_of_company')).toBe('already_member_of_company');
  });

  it('kod doğrulayıcı yalnız bilinen kodları kabul eder', () => {
    expect(isFleetErrorCode('permission_denied')).toBe(true);
    expect(isFleetErrorCode('uydurma_kod')).toBe(false);
    expect(isFleetErrorCode(null)).toBe(false);
  });

  it('yetki reddi 403, kimlik yok 401, çakışma 409 döner', () => {
    expect(httpStatusFor('permission_denied')).toBe(403);
    expect(httpStatusFor('unauthenticated')).toBe(401);
    expect(httpStatusFor('last_admin_protected')).toBe(409);
  });
});
