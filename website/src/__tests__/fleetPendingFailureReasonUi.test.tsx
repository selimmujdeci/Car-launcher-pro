/**
 * fleetPendingFailureReasonUi.test.tsx — BEKLEYEN İŞLEM "NEDEN" KİLİDİ.
 *
 * KAYNAK: staging doğrulaması (2026-07-29). Sunucunun GERÇEKTEN döndürdüğü
 * kodlar ölçüldü:
 *   last_admin_protected · cannot_modify_self_role · not_company_admin ·
 *   user_belongs_to_another_company · vehicle_in_another_company ·
 *   vehicle_owned_by_another_user · target_user_not_found · invalid_role ·
 *   invalid_company_name · no_company
 *
 * Bunların bir kısmı conflict DEĞİL (iş kuralı reddi) → `PERMANENT_FAILED`.
 * Ekran önceden yalnız "Gönderilemedi" yazıyordu; kullanıcı NEDENİNİ göremiyordu.
 * Bu kilit, nedenin gösterildiğini ve ham kodun SIZMADIĞINI garanti eder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { QueueItem, OperationType, SyncStatus } from '@/lib/offline/types';
import { FLEET_ERROR_CODES, messageFor } from '@/lib/fleet/errors';

const NOW = Date.now();

/** Staging'de sunucudan GERÇEKTEN gözlenen kodlar. */
const OBSERVED_ON_STAGING = [
  'last_admin_protected',
  'cannot_modify_self_role',
  'not_company_admin',
  'user_belongs_to_another_company',
  'vehicle_in_another_company',
  'vehicle_owned_by_another_user',
  'target_user_not_found',
  'invalid_role',
  'invalid_company_name',
  'no_company',
] as const;

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    schemaVersion: 1,
    id: over.id ?? 'q1',
    operationType: (over.operationType ?? 'MEMBER_REMOVE') as OperationType,
    actorId: 'u1', companyId: 'c1', vehicleId: over.vehicleId ?? null,
    payload: over.payload ?? {}, createdAt: NOW - 1000, clientRevision: 1,
    dedupKey: 'd', idempotencyKey: 'i', dependsOn: [],
    attemptCount: over.attemptCount ?? 1, maxAttempts: 6,
    nextAttemptAt: 0, expiresAt: NOW + 100000,
    status: (over.status ?? 'PERMANENT_FAILED') as SyncStatus,
    failureCode: over.failureCode ?? null,
  };
}

const fleetState = {
  phase: 'ready' as string,
  company: { id: 'c1', name: 'Filo', created_at: '' } as unknown,
  role: 'admin', members: [] as unknown[], vehicles: [] as unknown[],
  snapshot: null, permissions: [] as string[],
  errorCode: null as string | null, errorMessage: null as string | null,
  queueItems: [] as QueueItem[], pending: [] as QueueItem[], conflicts: [] as QueueItem[],
  // Bu senaryolarda kuyruk GERÇEKTEN okunmuştur; ekran "okunamadı" durumunu
  // yalnız `queueKnown === false` iken gösterir (telefonda ölçülen yalan
  // "Bekleyen işlem yok" kusurunun düzeltmesi).
  queueKnown: true,
  conflictCodes: [] as unknown[],
  refresh: vi.fn(), sync: vi.fn(), retryItem: vi.fn(), cancelItem: vi.fn(),
  createCompany: vi.fn(), updateCompany: vi.fn(),
  addMember: vi.fn(), updateMemberRole: vi.fn(), removeMember: vi.fn(),
  assignVehicle: vi.fn(), removeVehicle: vi.fn(),
  can: (_c: string) => true,
};

vi.mock('@/hooks/useSessionUser', () => ({ useSessionUser: () => ({ userId: 'u1', loading: false }) }));
vi.mock('@/hooks/useFleet', () => ({ useFleet: () => fleetState }));

import FleetPendingPage from '@/app/dashboard/fleet/pending/page';

describe('Bekleyen işlemler — başarısızlık nedeni', () => {
  beforeEach(() => { fleetState.queueItems = []; fleetState.pending = []; });

  it('1. 🔒 staging"de gözlenen HER kod için kullanıcıya NEDEN gösterilir', () => {
    for (const code of OBSERVED_ON_STAGING) {
      fleetState.queueItems = [item({ failureCode: code })];
      const html = renderToStaticMarkup(<FleetPendingPage />);

      expect(html).toContain(messageFor(code));
      // Makine kodu kullanıcıya SIZMAZ.
      expect(html).not.toContain(code);
    }
  });

  it('2. son admin reddi AÇIKÇA açıklanır (kör "Gönderilemedi" DEĞİL)', () => {
    fleetState.queueItems = [item({ operationType: 'MEMBER_REMOVE', failureCode: 'last_admin_protected' })];
    const html = renderToStaticMarkup(<FleetPendingPage />);

    expect(html).toContain('Gönderilemedi — tekrar denenmeyecek');
    expect(html).toContain('Son yöneticiyi kaldıramaz');
  });

  it('3. 🔒 TANINMAYAN kod ham hâlde GÖSTERİLMEZ', () => {
    fleetState.queueItems = [item({ failureCode: 'ERR_P0001_pg_internal_boom' })];
    const html = renderToStaticMarkup(<FleetPendingPage />);

    expect(html).not.toContain('P0001');
    expect(html).not.toContain('ERR_');
    expect(html).toContain('Sunucu bu işlemi kabul etmedi');
  });

  it('4. hata kodu YOKSA fazladan satır çizilmez', () => {
    fleetState.queueItems = [item({ status: 'PENDING', failureCode: null })];
    const html = renderToStaticMarkup(<FleetPendingPage />);

    expect(html).toContain('Sırada bekliyor');
    expect(html).not.toContain('Sunucu bu işlemi kabul etmedi');
  });

  it('5. 🔒 tanımlı TÜM hata kodlarının Türkçe mesajı vardır (boş mesaj YOK)', () => {
    for (const code of FLEET_ERROR_CODES) {
      const msg = messageFor(code);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain(code); // mesaj kodun kendisi olamaz
    }
  });

  it('6. 🔒 ekran render sırasında hiçbir işlem TETİKLEMEZ', () => {
    fleetState.queueItems = [item({ failureCode: 'last_admin_protected' })];
    renderToStaticMarkup(<FleetPendingPage />);

    expect(fleetState.sync).not.toHaveBeenCalled();
    expect(fleetState.retryItem).not.toHaveBeenCalled();
    expect(fleetState.cancelItem).not.toHaveBeenCalled();
  });
});
