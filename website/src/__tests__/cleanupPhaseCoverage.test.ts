/**
 * cleanupPhaseCoverage — HER TEMİZLİK FAZININ KATILIMCISI OLMALIDIR.
 *
 * ── ÖLÇÜLEN KUSUR (production, 2026-09-17) ───────────────────────────────
 * `DEVICE_AND_PUSH_REVOKE` fazı için hiçbir katılımcı kayıtlı değildi.
 * Koordinatör fazları sırayla yürütür ve katılımcısı olmayan faza gelince
 * koşulsuz durur (`AccountCleanupCoordinator`):
 *
 *   if (!this.registry.hasParticipantForPhase(phase))
 *     return this.persistFailure(entry, 'FAILED_BLOCKING',
 *                                'MISSING_PHASE_PARTICIPANT');
 *
 * Sonuç: ÇIKIŞ HİÇBİR ZAMAN TAMAMLANAMIYORDU (hem Arabam Cebimde hem filo).
 * Kullanıcı telefonda tam olarak şunu gördü:
 *   "Çıkış tamamlanamadı (FAILED_BLOCKING · MISSING_PHASE_PARTICIPANT)"
 *
 * Bu dosyanın ilk testi KAPSAM GUARD'ıdır: `CLEANUP_PHASES`a ileride yeni
 * bir faz eklenir de katılımcısı yazılmazsa çıkış sessizce kırılmak yerine
 * burada düşer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/pushEngine', () => ({
  unsubscribe: vi.fn(async () => undefined),
  initPushEngine: vi.fn(async () => ({ state: 'unsupported' })),
  subscribe: vi.fn(async () => ({ state: 'unsupported' })),
}));

import { CLEANUP_PHASES } from '@/security/accountCleanup/cleanupTypes';
import { createVehicleCleanupComposition } from
  '@/security/accountCleanup/createAccountCleanupRuntime';
import {
  DevicePushRevokeParticipant,
  type DevicePushAdapter,
} from '@/security/accountCleanup/devicePushCleanupParticipants';
import {
  activateAccountSecurityLockdown,
  getCleanupGeneration,
  resetAccountSecurityLockdownForTests,
} from '@/security/accountCleanup/cleanupLockdown';

describe('temizlik fazları · kapsam guard', () => {
  it('HER faz için en az bir katılımcı kayıtlıdır', () => {
    const { participantRegistry } = createVehicleCleanupComposition();

    const uncovered = CLEANUP_PHASES.filter(
      (phase) => !participantRegistry.hasParticipantForPhase(phase),
    );

    /* Eski kodda burada `['DEVICE_AND_PUSH_REVOKE']` kalıyordu ve çıkış
       o faza gelince FAILED_BLOCKING ile duruyordu. */
    expect(uncovered).toEqual([]);
  });

  it('doğrulama fazının ayrıca doğrulayıcı katılımcısı vardır', () => {
    const { participantRegistry } = createVehicleCleanupComposition();
    expect(participantRegistry.hasVerificationParticipant()).toBe(true);
  });
});

describe('DEVICE_AND_PUSH_REVOKE katılımcısı', () => {
  function adapter(overrides: Partial<DevicePushAdapter> = {}): DevicePushAdapter {
    return {
      revoke: vi.fn(async () => undefined),
      hasSubscription: vi.fn(async () => true),
      ...overrides,
    };
  }

  function contextForCurrentLockdown() {
    return {
      cleanupId: 'cleanup-1',
      reason: 'logout' as const,
      generation: getCleanupGeneration(),
    };
  }

  beforeEach(() => {
    resetAccountSecurityLockdownForTests();
  });

  it('abonelik varsa iptal eder ve CLEARED döner', async () => {
    activateAccountSecurityLockdown('cleanup-1', 'logout', Date.now());
    const deps = adapter();
    const participant = new DevicePushRevokeParticipant(deps);

    /* İkinci okuma "artık yok" demeli ki doğrulama geçsin. */
    let call = 0;
    deps.hasSubscription = vi.fn(async () => { call += 1; return call === 1; });

    const result = await participant.clear(contextForCurrentLockdown());

    expect(result).toEqual({ ok: true, code: 'CLEARED' });
    expect(deps.revoke).toHaveBeenCalledTimes(1);
    expect(participant.phase).toBe('DEVICE_AND_PUSH_REVOKE');
  });

  it('abonelik yoksa iptal DENENMEZ, ALREADY_EMPTY döner', async () => {
    activateAccountSecurityLockdown('cleanup-1', 'logout', Date.now());
    const deps = adapter({ hasSubscription: vi.fn(async () => false) });
    const participant = new DevicePushRevokeParticipant(deps);

    const result = await participant.clear(contextForCurrentLockdown());

    expect(result).toEqual({ ok: true, code: 'ALREADY_EMPTY' });
    expect(deps.revoke).not.toHaveBeenCalled();
  });

  it('iptalden sonra abonelik DURUYORSA "temizlendi" denmez', async () => {
    activateAccountSecurityLockdown('cleanup-1', 'logout', Date.now());
    /* `pushEngine.unsubscribe()` best-effort'tur (hatayı yutar); bu yüzden
       sonucu doğrulamadan başarı iddia etmek sahte kanıt olurdu (§8). */
    const deps = adapter({ hasSubscription: vi.fn(async () => true) });
    const participant = new DevicePushRevokeParticipant(deps);

    const result = await participant.clear(contextForCurrentLockdown());

    expect(result).toMatchObject({ ok: false, failureCode: 'DEVICE_PUSH_STILL_PRESENT' });
  });

  it('temizlik kilidi açık DEĞİLSE çalışmaz (bağlam kapısı)', async () => {
    /* lockdown başlatılmadı → katılımcı kendi başına iş yapamaz. */
    const deps = adapter();
    const participant = new DevicePushRevokeParticipant(deps);

    const result = await participant.clear({
      cleanupId: 'cleanup-1',
      reason: 'logout',
      generation: 0,
    });

    expect(result).toMatchObject({ ok: false, failureCode: 'DEVICE_PUSH_CONTEXT_INVALID' });
    expect(deps.revoke).not.toHaveBeenCalled();
  });

  it('iptal hata fırlatırsa dürüstçe başarısız döner', async () => {
    activateAccountSecurityLockdown('cleanup-1', 'logout', Date.now());
    const deps = adapter({ revoke: vi.fn(async () => { throw new Error('boom'); }) });
    const participant = new DevicePushRevokeParticipant(deps);

    const result = await participant.clear(contextForCurrentLockdown());

    expect(result).toMatchObject({ ok: false, failureCode: 'DEVICE_PUSH_REVOKE_FAILED' });
  });
});

describe('VERIFY_EMPTY · hesap-kapsamlı depo doğrulaması', () => {
  /* ── ÖLÇÜLEN KUSUR (production, 2026-09-18) ─────────────────────────────
     `verifyAccountScopedStorageEmpty`, `GLOBAL_DEVICE` ve `SECURITY_SYSTEM`
     dışındaki HER `CUSTOM` tanım için doğrulayıcı arar; biri eksikse
     `REGISTRY_INVALID` döner. Üç doğrulayıcı eksikti (notification ·
     realtime · mavi) ve çıkış son fazda düşüyordu. Kullanıcının
     telefonunda görülen tam iz:
       "PARTICIPANT_FAILED_BLOCKING · account-scoped-storage-verification:REGISTRY_INVALID"
  */
  beforeEach(() => {
    resetAccountSecurityLockdownForTests();
    window.localStorage.clear();
  });

  it('temiz durumda doğrulama GEÇER (eksik doğrulayıcı yok)', async () => {
    activateAccountSecurityLockdown('cleanup-verify', 'logout', Date.now());
    const { participantRegistry } = createVehicleCleanupComposition();

    const participant = participantRegistry
      .listForPhase('VERIFY_EMPTY')
      .find((candidate) => candidate.id === 'account-scoped-storage-verification');

    expect(participant).toBeDefined();
    expect(participant?.verifyEmpty).toBeTypeOf('function');

    const context = {
      cleanupId: 'cleanup-verify',
      reason: 'logout' as const,
      generation: getCleanupGeneration(),
    };
    /* Koordinatörün sırası: önce `clear()` (doğrulamayı yürütür ve sonucu
       saklar), sonra `verifyEmpty()` (o sonucu okur). */
    const cleared = await participant!.clear(context);
    expect(cleared, JSON.stringify(cleared)).toMatchObject({ ok: true });

    const empty = await participant!.verifyEmpty!(context);

    /* Eski kodda burada `false` dönüyordu (REGISTRY_INVALID) ve koordinatör
       çıkışı FAILED_BLOCKING ile bitiriyordu. */
    expect(empty).toBe(true);
  });
});