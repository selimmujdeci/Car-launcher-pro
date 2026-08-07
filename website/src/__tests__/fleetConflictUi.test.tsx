/**
 * fleetConflictUi.test.tsx — ÇAKIŞMA MERKEZİ EKRAN KİLİTLERİ.
 *
 * `fleetRolesAndConflicts.test.ts` conflict POLİTİKASINI kilitler; bu dosya
 * politikanın EKRANA dürüst yansıdığını kilitler. İkisi ayrıdır çünkü doğru
 * politika + yanlış ekran = kullanıcı yine yanlış karar verir.
 *
 * ANA KİLİTLER:
 *   · Ham hata yığını / Postgres kodu ASLA ekrana çıkmaz.
 *   · Sahiplik çakışmasında "zorla devral" DÜĞMESİ ÜRETİLMEZ.
 *   · Her çakışmada "ne oldu · kim etkilendi · sunucu ne diyor · yerelde ne
 *     bekliyordu · seçenekler" beşlisi bulunur.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { CONFLICT_CODES, type ConflictCode, type QueueItem, type OperationType, type SyncStatus }
  from '@/lib/offline/types';
import { policyFor, actionsFor } from '@/lib/offline/conflictEngine';

const NOW = Date.now();

function conflictItem(
  code: string | null,
  over: Partial<QueueItem> = {},
): QueueItem {
  return {
    schemaVersion:  1,
    id:             over.id ?? `q_${code ?? 'null'}`,
    operationType:  (over.operationType ?? 'VEHICLE_ASSIGN_COMPANY') as OperationType,
    actorId:        'u1',
    companyId:      over.companyId ?? 'c1',
    vehicleId:      over.vehicleId ?? null,
    payload:        over.payload ?? {},
    createdAt:      over.createdAt ?? NOW - 5000,
    clientRevision: 1,
    dedupKey:       'd',
    idempotencyKey: 'i',
    dependsOn:      [],
    attemptCount:   1,
    maxAttempts:    6,
    nextAttemptAt:  0,
    expiresAt:      NOW + 100000,
    status:         (over.status ?? 'CONFLICT') as SyncStatus,
    failureCode:    code,
  };
}

/** Render edilmiş HTML'deki <button> metinleri (aksiyon kilidi bunlara bakar). */
function buttonTexts(html: string): string[] {
  // `[...matchAll()]` yerine Array.from: website tsconfig'i ES5 downlevel
  // iteration'a izin vermiyor (Next.js ayarı DEĞİŞTİRİLMEZ).
  return Array.from(html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g))
    .map((m) => m[1].replace(/<[^>]*>/g, '').trim());
}

const fleetState = {
  phase: 'ready' as string,
  company: { id: 'c1', name: 'Test Filo', created_at: '' } as unknown,
  role: 'admin',
  members: [] as unknown[],
  vehicles: [] as unknown[],
  snapshot: null,
  permissions: [] as string[],
  errorCode: null as string | null,
  errorMessage: null as string | null,
  queueItems: [] as QueueItem[],
  pending: [] as QueueItem[],
  conflicts: [] as QueueItem[],
  conflictCodes: [] as unknown[],
  refresh: vi.fn(), sync: vi.fn(), retryItem: vi.fn(), cancelItem: vi.fn(),
  createCompany: vi.fn(), updateCompany: vi.fn(),
  addMember: vi.fn(), updateMemberRole: vi.fn(), removeMember: vi.fn(),
  assignVehicle: vi.fn(), removeVehicle: vi.fn(),
  can: (_c: string) => true,
};

vi.mock('@/hooks/useSessionUser', () => ({
  useSessionUser: () => ({ userId: 'u1', loading: false }),
}));
vi.mock('@/hooks/useFleet', () => ({
  useFleet: () => fleetState,
}));

import FleetConflictsPage from '@/app/dashboard/fleet/conflicts/page';

describe('Çakışma merkezi — ekran kilitleri', () => {
  beforeEach(() => {
    fleetState.phase     = 'ready';
    fleetState.conflicts = [];
  });

  it('1. çakışma yoksa boş durum gösterilir (sahte çakışma ÜRETİLMEZ)', () => {
    const html = renderToStaticMarkup(<FleetConflictsPage />);
    expect(html).toContain('Çakışma yok');
  });

  it('2. 🔒 SAHİPLİK çakışmasında "zorla devral" DÜĞMESİ YOKTUR', () => {
    fleetState.conflicts = [conflictItem('VEHICLE_ALREADY_OWNED', { vehicleId: 'v1' })];
    const html = renderToStaticMarkup(<FleetConflictsPage />);

    // Kilit DÜĞMELERDEDİR: açıklama metni "devralınamaz" DEMEK zorunda, ama
    // hiçbir TIKLANABİLİR aksiyon devralma teklif etmemeli.
    const buttons = buttonTexts(html);
    expect(buttons.length).toBeGreaterThan(0);
    for (const label of buttons) {
      expect(label).not.toMatch(/devral|devir|zorla|el koy/i);
    }

    // Aksine, devralınamayacağı AÇIKÇA yazılır.
    expect(html).toContain('zorla devralınamaz');
  });

  it('2b. 🔒 HİÇBİR conflict kodunda devralma düğmesi üretilmez', () => {
    for (const code of CONFLICT_CODES) {
      fleetState.conflicts = [conflictItem(code, { vehicleId: 'v1' })];
      for (const label of buttonTexts(renderToStaticMarkup(<FleetConflictsPage />))) {
        expect(label).not.toMatch(/devral|devir|zorla|el koy/i);
      }
    }
  });

  it('3. 🔒 her conflict kodu ekranda ÇÖKMEDEN ve ham kod SIZDIRMADAN çizilir', () => {
    for (const code of CONFLICT_CODES) {
      fleetState.conflicts = [conflictItem(code, { vehicleId: 'v1' })];
      const html = renderToStaticMarkup(<FleetConflictsPage />);

      // Politikadaki insan-okunur başlık görünür…
      expect(html).toContain(policyFor(code as ConflictCode).title);
      // …ama MAKİNE kodu kullanıcıya SIZMAZ.
      expect(html).not.toContain(code);
    }
  });

  it('4. her çakışmada beş soru da yanıtlanır', () => {
    fleetState.conflicts = [conflictItem('ROLE_CHANGED_ON_SERVER', { vehicleId: null })];
    const html = renderToStaticMarkup(<FleetConflictsPage />);

    expect(html).toContain('Ne oldu?');
    expect(html).toContain('Etkilenen kayıt');
    expect(html).toContain('Yerelde bekleyen işlem');
    expect(html).toContain('Sunucudaki gerçek durum');
  });

  it('5. etkilenen araç / üye / filo ayrımı doğru gösterilir', () => {
    fleetState.conflicts = [conflictItem('VEHICLE_IN_ANOTHER_COMPANY', { vehicleId: 'ARAC-42' })];
    expect(renderToStaticMarkup(<FleetConflictsPage />)).toContain('Araç: ARAC-42');

    fleetState.conflicts = [conflictItem('USER_ALREADY_IN_COMPANY', {
      vehicleId: null, operationType: 'MEMBER_ADD', payload: { userId: 'UYE-7' },
    })];
    expect(renderToStaticMarkup(<FleetConflictsPage />)).toContain('Üye: UYE-7');
  });

  it('6. bekleyen işlemin TÜRÜ Türkçe adıyla yazılır (enum SIZMAZ)', () => {
    fleetState.conflicts = [conflictItem('DUPLICATE_OPERATION', {
      operationType: 'MEMBER_ROLE_UPDATE', vehicleId: null,
    })];
    const html = renderToStaticMarkup(<FleetConflictsPage />);
    expect(html).toContain('Rol değiştirme');
    expect(html).not.toContain('MEMBER_ROLE_UPDATE');
  });

  it('7. 🔒 ekrandaki aksiyonlar politikayla BİREBİR aynıdır', () => {
    const LABEL: Record<string, string> = {
      RETRY:               'Yeniden dene',
      CANCEL:              'Vazgeç',
      ACCEPT_SERVER_STATE: 'Sunucudaki durumu kabul et',
      NOTIFY_ADMIN:        'Yöneticiye bildir',
    };
    for (const code of CONFLICT_CODES) {
      fleetState.conflicts = [conflictItem(code)];
      const html    = renderToStaticMarkup(<FleetConflictsPage />);
      const allowed = actionsFor(code as ConflictCode);

      for (const action of allowed) {
        expect(html).toContain(LABEL[action]);
      }
      // Politika izin VERMEYEN aksiyon ekranda BULUNMAZ.
      for (const action of Object.keys(LABEL)) {
        if (!(allowed as readonly string[]).includes(action)) {
          expect(html).not.toContain(LABEL[action]);
        }
      }
    }
  });

  it('8. veri kaybı riski olan çakışmada kullanıcı UYARILIR', () => {
    const risky = CONFLICT_CODES.filter((c) => policyFor(c as ConflictCode).dataLossRisk);
    expect(risky.length).toBeGreaterThan(0); // politika gerçekten riskli kod tanımlıyor

    for (const code of risky) {
      fleetState.conflicts = [conflictItem(code)];
      const html = renderToStaticMarkup(<FleetConflictsPage />);
      expect(html).toContain('Dikkat');
      expect(html).toContain('üzerine yazılabilir');
    }
  });

  it('9. 🔒 TANINMAYAN hata kodu sessizce yutulmaz, güvenli metinle gösterilir', () => {
    fleetState.conflicts = [conflictItem('BEKLENMEYEN_POSTGRES_HATASI_P0001')];
    const html = renderToStaticMarkup(<FleetConflictsPage />);

    expect(html).toContain('Tanımlanamayan çakışma');
    expect(html).not.toContain('P0001');
    // Tanınmayan çakışma OTOMATİK tekrar denenmez.
    expect(html).toContain('tekrar denenmiyor');
  });

  it('10. birden çok çakışma aynı anda listelenir (biri diğerini gizlemez)', () => {
    fleetState.conflicts = [
      conflictItem('PAIRING_CODE_EXPIRED',   { id: 'a', vehicleId: 'v1' }),
      conflictItem('MEMBER_REMOVED_ON_SERVER', { id: 'b', vehicleId: null }),
    ];
    const html = renderToStaticMarkup(<FleetConflictsPage />);
    expect(html).toContain(policyFor('PAIRING_CODE_EXPIRED').title);
    expect(html).toContain(policyFor('MEMBER_REMOVED_ON_SERVER').title);
  });

  it('11. 🔒 ekran hiçbir sunucu işlemi TETİKLEMEZ (render yan etkisiz)', () => {
    fleetState.conflicts = [conflictItem('VEHICLE_ALREADY_OWNED', { vehicleId: 'v1' })];
    renderToStaticMarkup(<FleetConflictsPage />);

    expect(fleetState.retryItem).not.toHaveBeenCalled();
    expect(fleetState.cancelItem).not.toHaveBeenCalled();
    expect(fleetState.sync).not.toHaveBeenCalled();
    expect(fleetState.assignVehicle).not.toHaveBeenCalled();
    expect(fleetState.removeVehicle).not.toHaveBeenCalled();
  });
});
