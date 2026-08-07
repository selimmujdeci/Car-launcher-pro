/**
 * ownershipTransfer.test.ts — SAHİPLİK DEVRİ İSTEMCİ SÖZLEŞMESİ KİLİTLERİ.
 *
 * Sunucu otoritesi migration 039'dadır ve gerçek SQL matrisiyle doğrulanmıştır
 * (`supabase/verification/local_transfer_matrix.sql` — 44/44 PASS).
 * Buradaki kilitler İSTEMCİ tarafını korur: yanlış kişiye eylem gösterilmesin,
 * çevrimdışıyken devir "yapılabilir" görünmesin, ham hata metni UI'ye sızmasın.
 */

import { describe, it, expect } from 'vitest';
import {
  ownerTypeOf, isActiveTransfer, isOwnershipChanged, availableActions,
  canStartTransfer, isExpired, expiryBucket, toTransferResultCode,
  transferStatusLabel, blockReasonLabel, ownerTypeLabel, expiryBucketLabel,
  transferResultLabel, isOwnerType,
  TRANSFER_STATUSES, TRANSFER_RESULT_CODES, OWNER_TYPES,
  type TransferRecord, type TransferStatus, type OwnerType,
  type TransferResultCode, type ActorContext,
} from '@/lib/fleet/ownershipTransfer';
import { classifyOffline, isQueueableOffline } from '@/lib/offline/offlineClassification';
import { OPERATION_TYPES } from '@/lib/offline/types';

const NOW = 1_800_000_000_000;

function transfer(over: Partial<TransferRecord> = {}): TransferRecord {
  return {
    id:            over.id            ?? 't1',
    vehicleId:     over.vehicleId     ?? 'v1',
    fromOwnerType: over.fromOwnerType ?? 'INDIVIDUAL',
    toOwnerType:   over.toOwnerType   ?? 'INDIVIDUAL',
    status:        over.status        ?? 'PENDING',
    createdAt:     over.createdAt     ?? NOW - 60_000,
    expiresAt:     over.expiresAt     ?? NOW + 3_600_000,
    requestedByMe: over.requestedByMe ?? false,
    targetedAtMe:  over.targetedAtMe  ?? false,
    failureCode:   over.failureCode   ?? null,
  };
}

const ONLINE_MEMBER: ActorContext = { role: 'member', online: true };
const ONLINE_ADMIN:  ActorContext = { role: 'admin',  online: true };
const OFFLINE_ADMIN: ActorContext = { role: 'admin',  online: false };

/* ── 1. SAHİPLİK TÜRÜ ──────────────────────────────────────────────────── */

describe('sahiplik türü · tek otorite', () => {
  it('yalnız owner_id doluysa BİREYSEL', () => {
    expect(ownerTypeOf({ owner_id: 'u1', company_id: null })).toBe('INDIVIDUAL');
  });

  it('yalnız company_id doluysa ŞİRKET', () => {
    expect(ownerTypeOf({ owner_id: null, company_id: 'c1' })).toBe('COMPANY');
  });

  it('ikisi de boşsa SAHİPSİZ', () => {
    expect(ownerTypeOf({ owner_id: null, company_id: null })).toBe('UNOWNED');
  });

  it('İKİSİ BİRDEN doluysa INVALID — sessizce bir taraf SEÇİLMEZ', () => {
    expect(ownerTypeOf({ owner_id: 'u1', company_id: 'c1' })).toBe('INVALID');
  });

  it('sahiplik türü doğrulayıcısı fail-closed', () => {
    for (const t of OWNER_TYPES) expect(isOwnerType(t)).toBe(true);
    expect(isOwnerType('DEVICE')).toBe(false);
    expect(isOwnerType(null)).toBe(false);
  });
});

/* ── 2. ÇEVRİMDIŞI YASAK ───────────────────────────────────────────────── */

describe('devir · ÇEVRİMDIŞI YAPILAMAZ', () => {
  it('dört devir işlemi de ONLINE_REQUIRED', () => {
    for (const op of ['VEHICLE_TRANSFER_START','VEHICLE_TRANSFER_ACCEPT',
                      'VEHICLE_TRANSFER_REJECT','VEHICLE_TRANSFER_CANCEL']) {
      expect(classifyOffline(op)).toBe('ONLINE_REQUIRED');
      expect(isQueueableOffline(op)).toBe(false);
    }
  });

  it('devir türleri kuyruk sözleşmesinde TANIMLI (tanınmadan geçemez)', () => {
    for (const op of ['VEHICLE_TRANSFER_START','VEHICLE_TRANSFER_ACCEPT',
                      'VEHICLE_TRANSFER_REJECT','VEHICLE_TRANSFER_CANCEL']) {
      expect(OPERATION_TYPES).toContain(op);
    }
  });

  it('çevrimdışıyken HİÇBİR eylem gösterilmez', () => {
    const t = transfer({ targetedAtMe: true, requestedByMe: true });
    expect(availableActions(t, OFFLINE_ADMIN)).toEqual([]);
  });

  it('çevrimdışıyken devir BAŞLATILAMAZ', () => {
    const check = canStartTransfer({
      vehicle: { owner_id: 'u1', company_id: null, revision: 3 },
      viewerUserId: 'u1', viewerCompanyId: null, viewerRole: 'individual',
      targetType: 'INDIVIDUAL', targetId: 'u2',
      hasActiveTransfer: false, online: false,
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('OFFLINE');
    expect(blockReasonLabel('OFFLINE')).toContain('internet bağlantısı gerekli');
  });
});

/* ── 3. EYLEM GÖRÜNÜRLÜĞÜ ──────────────────────────────────────────────── */

describe('devir · eylem görünürlüğü', () => {
  it('hedef bireysel kullanıcı kabul ve ret görür', () => {
    const t = transfer({ targetedAtMe: true, toOwnerType: 'INDIVIDUAL' });
    expect(availableActions(t, ONLINE_MEMBER)).toEqual(['ACCEPT', 'REJECT']);
  });

  it('ŞİRKET hedefinde member kabul GÖREMEZ, admin görür', () => {
    const t = transfer({ targetedAtMe: true, toOwnerType: 'COMPANY' });
    expect(availableActions(t, ONLINE_MEMBER)).toEqual([]);
    expect(availableActions(t, ONLINE_ADMIN)).toEqual(['ACCEPT', 'REJECT']);
  });

  it('observer şirket hedefinde kabul GÖREMEZ', () => {
    const t = transfer({ targetedAtMe: true, toOwnerType: 'COMPANY' });
    expect(availableActions(t, { role: 'observer', online: true })).toEqual([]);
  });

  it('gönderen yalnız İPTAL görür — kendi transferini kabul EDEMEZ', () => {
    const t = transfer({ requestedByMe: true, targetedAtMe: false });
    expect(availableActions(t, ONLINE_ADMIN)).toEqual(['CANCEL']);
  });

  it('ilgisiz kullanıcı HİÇBİR eylem görmez', () => {
    const t = transfer({ requestedByMe: false, targetedAtMe: false });
    expect(availableActions(t, ONLINE_ADMIN)).toEqual([]);
  });

  it('sonuçlanmış transferde eylem YOKTUR', () => {
    for (const status of TRANSFER_STATUSES.filter((s) => s !== 'PENDING')) {
      const t = transfer({ status: status as TransferStatus, targetedAtMe: true, requestedByMe: true });
      expect(availableActions(t, ONLINE_ADMIN)).toEqual([]);
    }
  });
});

/* ── 4. BAŞLATMA ÖN KONTROLÜ ───────────────────────────────────────────── */

describe('devir · başlatma ön kontrolü (fail-closed)', () => {
  const base = {
    viewerUserId: 'u1', viewerCompanyId: null as string | null,
    viewerRole: 'individual' as const,
    targetType: 'INDIVIDUAL' as OwnerType, targetId: 'u2',
    hasActiveTransfer: false, online: true,
  };

  it('bireysel sahip kendi aracını devredebilir', () => {
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: 'u1', company_id: null, revision: 5 },
    })).toEqual({ allowed: true, reason: null });
  });

  it('sahip OLMAYAN devredemez', () => {
    const r = canStartTransfer({
      ...base, viewerUserId: 'u9', vehicle: { owner_id: 'u1', company_id: null, revision: 5 },
    });
    expect(r).toEqual({ allowed: false, reason: 'NOT_OWNER' });
  });

  it('şirket aracını YALNIZ admin devredebilir', () => {
    const vehicle = { owner_id: null, company_id: 'c1', revision: 5 };
    expect(canStartTransfer({
      ...base, vehicle, viewerCompanyId: 'c1', viewerRole: 'member',
    }).reason).toBe('NOT_OWNER');
    expect(canStartTransfer({
      ...base, vehicle, viewerCompanyId: 'c1', viewerRole: 'admin',
    }).allowed).toBe(true);
  });

  it('BAŞKA şirketin admini devredemez (cross-tenant)', () => {
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: null, company_id: 'c1', revision: 5 },
      viewerCompanyId: 'c2', viewerRole: 'admin',
    }).reason).toBe('NOT_OWNER');
  });

  it('SAHİPSİZ araç devredilemez', () => {
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: null, company_id: null, revision: 5 },
    }).reason).toBe('UNOWNED_VEHICLE');
  });

  it('TUTARSIZ sahiplik devredilemez', () => {
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: 'u1', company_id: 'c1', revision: 5 },
    }).reason).toBe('INVALID_OWNERSHIP');
  });

  it('KENDİNE devir reddedilir', () => {
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: 'u1', company_id: null, revision: 5 }, targetId: 'u1',
    }).reason).toBe('SAME_OWNER');
  });

  it('aktif transfer varken yenisi başlatılamaz', () => {
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: 'u1', company_id: null, revision: 5 },
      hasActiveTransfer: true,
    }).reason).toBe('ACTIVE_TRANSFER_EXISTS');
  });

  it('REVİZYON bilinmiyorsa gönderilmez (optimistic concurrency şart)', () => {
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: 'u1', company_id: null, revision: null },
    }).reason).toBe('UNKNOWN_REVISION');
    expect(canStartTransfer({
      ...base, vehicle: { owner_id: 'u1', company_id: null, revision: NaN },
    }).reason).toBe('UNKNOWN_REVISION');
  });
});

/* ── 5. DURUM ANLAMI ───────────────────────────────────────────────────── */

describe('devir · durum anlamı', () => {
  it('YALNIZ PENDING aktiftir', () => {
    for (const s of TRANSFER_STATUSES) {
      expect(isActiveTransfer(s as TransferStatus)).toBe(s === 'PENDING');
    }
  });

  it('sahiplik YALNIZ COMPLETED ile değişmiş sayılır', () => {
    for (const s of TRANSFER_STATUSES) {
      expect(isOwnershipChanged(s as TransferStatus)).toBe(s === 'COMPLETED');
    }
    // "ACCEPTED" tek başına DEVİR TAMAMLANDI DEMEK DEĞİLDİR.
    expect(isOwnershipChanged('ACCEPTED')).toBe(false);
  });

  it('süre dolumu yalnız PENDING için anlamlıdır', () => {
    expect(isExpired(transfer({ expiresAt: NOW - 1 }), NOW)).toBe(true);
    expect(isExpired(transfer({ expiresAt: NOW + 1 }), NOW)).toBe(false);
    expect(isExpired(transfer({ status: 'COMPLETED', expiresAt: NOW - 1 }), NOW)).toBe(false);
  });

  it('kalan süre KOVA olarak verilir — tam zaman damgası taşınmaz', () => {
    expect(expiryBucket(transfer({ expiresAt: NOW - 1 }), NOW)).toBe('EXPIRED');
    expect(expiryBucket(transfer({ expiresAt: NOW + 60_000 }), NOW)).toBe('UNDER_5_MIN');
    expect(expiryBucket(transfer({ expiresAt: NOW + 30 * 60_000 }), NOW)).toBe('UNDER_1_HOUR');
    expect(expiryBucket(transfer({ expiresAt: NOW + 5 * 3_600_000 }), NOW)).toBe('OVER_1_HOUR');
  });

  it('her durum ve tür için Türkçe etiket vardır', () => {
    for (const s of TRANSFER_STATUSES) expect(transferStatusLabel(s as TransferStatus).length).toBeGreaterThan(3);
    for (const t of OWNER_TYPES)       expect(ownerTypeLabel(t as OwnerType).length).toBeGreaterThan(3);
    for (const b of ['EXPIRED','UNDER_5_MIN','UNDER_1_HOUR','OVER_1_HOUR'] as const) {
      expect(expiryBucketLabel(b).length).toBeGreaterThan(3);
    }
  });
});

/* ── 6. HATA SÖZLEŞMESİ (ham metin sızmaz) ─────────────────────────────── */

describe('devir · bounded hata sözleşmesi', () => {
  it('sunucu kodları bounded istemci koduna çevrilir', () => {
    expect(toTransferResultCode('stale_client_revision')).toBe('REVISION_GAP');
    expect(toTransferResultCode('duplicate_operation')).toBe('TRANSFER_CONFLICT');
    expect(toTransferResultCode('pairing_code_expired')).toBe('TRANSFER_EXPIRED');
    expect(toTransferResultCode('not_company_admin')).toBe('CROSS_TENANT_DENIED');
    expect(toTransferResultCode('permission_denied')).toBe('CROSS_TENANT_DENIED');
  });

  it('TANINMAYAN kod UNKNOWN olur — ham metin TAŞINMAZ', () => {
    expect(toTransferResultCode('ERROR: relation "x" does not exist')).toBe('UNKNOWN');
    expect(toTransferResultCode(null)).toBe('UNKNOWN');
    expect(toTransferResultCode(undefined)).toBe('UNKNOWN');
    expect(toTransferResultCode(42)).toBe('UNKNOWN');
  });

  it('her sonuç kodu kullanıcıya dönük Türkçe metin taşır', () => {
    for (const code of TRANSFER_RESULT_CODES) {
      const label = transferResultLabel(code as TransferResultCode);
      expect(label.length).toBeGreaterThan(5);
      // Teknik sızıntı olmamalı.
      expect(label).not.toMatch(/SELECT|ERROR:|null|undefined|SQLSTATE/i);
    }
  });

  it('kullanıcıya gösterilen metinler SQL/teknik terim içermez', () => {
    for (const r of ['OFFLINE','NOT_OWNER','UNOWNED_VEHICLE','INVALID_OWNERSHIP',
                     'SAME_OWNER','ACTIVE_TRANSFER_EXISTS','UNKNOWN_REVISION'] as const) {
      expect(blockReasonLabel(r)).not.toMatch(/SELECT|uuid|revision_|SQLSTATE/i);
    }
  });
});
