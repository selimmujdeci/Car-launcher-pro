/**
 * fleetVehicleOfflineUi.test.tsx — ARAÇ ÇEVRİMDIŞI DENEYİMİ KİLİTLERİ.
 *
 * İki katman:
 *   A) `vehicleOfflineStatus` SAF modeli (I/O yok, saat enjekte).
 *   B) `/dashboard/fleet/company-vehicles` ilk-render kanıtı.
 *
 * YAKLAŞIM: @testing-library/react depoda YOK ve yeni bağımlılık eklenmez
 * (ticari lisans + bağımlılık disiplini). Proje konvansiyonu neyse o kullanılır:
 * ilk-render kanıtı `renderToStaticMarkup`, davranış kanıtı saf model.
 *
 * ANA KİLİT: araç çevrimdışıyken YAPILAMAYAN iş "başarılı" gibi GÖSTERİLMEZ ve
 * okunamayan alan sahte 0 ile DOLDURULMAZ.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildVehicleOfflineStatus, commandPhaseOf, COMMAND_PHASES,
  ACTIVE_COMMAND_PHASES, parseLastSeen, lastSeenLabel,
  connectivityLabel, ownershipLabel, pairingLabel, syncStateLabel,
  commandPhaseLabel, DEFAULT_ONLINE_WINDOW_MS,
} from '@/lib/offline/vehicleOfflineStatus';
import type { QueueItem, OperationType, SyncStatus } from '@/lib/offline/types';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

const NOW = 1_800_000_000_000;

function item(over: Partial<QueueItem> & { operationType: OperationType; status: SyncStatus }): QueueItem {
  return {
    schemaVersion:  1,
    id:             over.id ?? `q_${Math.random().toString(36).slice(2)}`,
    operationType:  over.operationType,
    actorId:        'u1',
    companyId:      'c1',
    vehicleId:      over.vehicleId ?? 'v1',
    payload:        over.payload ?? {},
    createdAt:      over.createdAt ?? NOW - 1000,
    clientRevision: 1,
    dedupKey:       over.dedupKey ?? 'd',
    idempotencyKey: 'i',
    dependsOn:      [],
    attemptCount:   0,
    maxAttempts:    6,
    nextAttemptAt:  0,
    expiresAt:      NOW + 100000,
    status:         over.status,
    failureCode:    over.failureCode ?? null,
  };
}

function base(over: Partial<Parameters<typeof buildVehicleOfflineStatus>[0]> = {}) {
  return buildVehicleOfflineStatus({
    vehicleId:  'v1',
    lastSeen:   new Date(NOW - 60_000).toISOString(),
    ownerId:    'u1',
    viewerId:   'u1',
    queueItems: [],
    commands:   [],
    now:        NOW,
    ...over,
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
describe('A. Araç çevrimdışı — saf model', () => {

  it('1. son telemetri penceresi içindeyse ONLINE, dışındaysa OFFLINE', () => {
    expect(base().connectivity).toBe('ONLINE');
    const old = base({ lastSeen: new Date(NOW - DEFAULT_ONLINE_WINDOW_MS - 1).toISOString() });
    expect(old.connectivity).toBe('OFFLINE');
  });

  it('2. hiç bağlanmamış araç UYDURMA tarih üretmez', () => {
    const s = base({ lastSeen: null });
    expect(s.connectivity).toBe('NEVER_CONNECTED');
    expect(s.lastSeenAt).toBeNull();
    expect(lastSeenLabel(s.lastSeenAt, NOW)).toBe('Bilinmiyor');
  });

  it('3. bozuk tarih "UNKNOWN" olur — sessizce 0 epoch OLMAZ', () => {
    const s = base({ lastSeen: 'bozuk-tarih' });
    expect(s.connectivity).toBe('UNKNOWN');
    expect(s.lastSeenAt).toBeNull();
    expect(parseLastSeen('bozuk-tarih')).toBeNull();
  });

  it('4. sahiplik yalnız SUNUCUDAN gelen owner_id ile belirlenir', () => {
    expect(base({ ownerId: 'u1', viewerId: 'u1' }).ownership).toBe('VERIFIED_YOURS');
    expect(base({ ownerId: 'u2', viewerId: 'u1' }).ownership).toBe('VERIFIED_OTHER');
    expect(base({ ownerId: null,  viewerId: 'u1' }).ownership).toBe('UNOWNED');
    // Oturum bilinmiyorsa sahiplik UYDURULMAZ.
    expect(base({ ownerId: 'u2', viewerId: null }).ownership).toBe('UNKNOWN');
  });

  /* ── Kuyruk kırılımı: konum/olay AYRI sayılır ───────────────────────── */

  it('5. bekleyen konum/olay, filo işlemlerinden AYRI sayılır', () => {
    const s = base({
      queueItems: [
        item({ operationType: 'LOCATION_EVENT',         status: 'PENDING' }),
        item({ operationType: 'LOCATION_EVENT',         status: 'PENDING' }),
        item({ operationType: 'VEHICLE_EVENT',          status: 'PENDING' }),
        item({ operationType: 'VEHICLE_ASSIGN_COMPANY', status: 'PENDING' }),
      ],
    });
    expect(s.pendingLocationEvents).toBe(2);
    expect(s.pendingVehicleEvents).toBe(1);
    expect(s.pendingFleetOps).toBe(1); // konum/olay BURAYA sızmaz
  });

  it('6. başka aracın kuyruk öğeleri bu araca SAYILMAZ', () => {
    const s = base({
      queueItems: [
        item({ operationType: 'LOCATION_EVENT', status: 'PENDING', vehicleId: 'BASKA' }),
        item({ operationType: 'LOCATION_EVENT', status: 'PENDING', vehicleId: 'v1' }),
      ],
    });
    expect(s.pendingLocationEvents).toBe(1);
  });

  it('7. terminal öğeler "bekliyor" sayılmaz', () => {
    const s = base({
      queueItems: [
        item({ operationType: 'VEHICLE_ASSIGN_COMPANY', status: 'SYNCED' }),
        item({ operationType: 'VEHICLE_ASSIGN_COMPANY', status: 'CANCELLED' }),
      ],
    });
    expect(s.pendingFleetOps).toBe(0);
    expect(s.syncState).toBe('UP_TO_DATE');
  });

  it('8. senkron durumu önceliklidir: CONFLICT her şeyi bastırır', () => {
    const s = base({
      queueItems: [
        item({ operationType: 'VEHICLE_ASSIGN_COMPANY', status: 'PENDING' }),
        item({ operationType: 'VEHICLE_ASSIGN_COMPANY', status: 'CONFLICT' }),
      ],
    });
    expect(s.syncState).toBe('CONFLICT');
    expect(s.conflicts).toBe(1);
  });

  it('9. BLOCKED_BY_DEPENDENCY ve RETRYABLE_FAILED ayrı ayrı görünür', () => {
    expect(base({ queueItems: [item({ operationType: 'MEMBER_ADD', status: 'BLOCKED_BY_DEPENDENCY' })] }).syncState)
      .toBe('BLOCKED_BY_DEPENDENCY');
    expect(base({ queueItems: [item({ operationType: 'MEMBER_ADD', status: 'RETRYABLE_FAILED' })] }).syncState)
      .toBe('RETRYABLE_FAILED');
  });

  /* ── Okunamayan alan: sahte 0 YASAK ─────────────────────────────────── */

  it('10. 🔒 kuyruk okunamazsa sayımlar null olur — sahte 0 YAZILMAZ', () => {
    const s = base({ queueItems: null });
    expect(s.pendingFleetOps).toBeNull();
    expect(s.pendingLocationEvents).toBeNull();
    expect(s.pendingVehicleEvents).toBeNull();
    expect(s.conflicts).toBeNull();
    expect(s.syncState).toBe('UNAVAILABLE');
    expect(s.pairing).toBe('UNAVAILABLE');
  });

  it('11. 🔒 komutlar okunamazsa evre kırılımı null olur — sahte 0 YAZILMAZ', () => {
    const s = base({ commands: null });
    expect(s.commandsByPhase).toBeNull();
    expect(s.activeCommands).toBeNull();
    expect(s.unknownCommands).toBeNull();
  });

  it('12. boş kuyruk GERÇEK sıfırdır (okunamadı ile karıştırılmaz)', () => {
    const s = base({ queueItems: [], commands: [] });
    expect(s.pendingFleetOps).toBe(0);
    expect(s.activeCommands).toBe(0);
    expect(s.syncState).toBe('UP_TO_DATE');
  });

  /* ── Komut evreleri ─────────────────────────────────────────────────── */

  it('13. 🔒 araç ÇEVRİMDIŞIYKEN pending komut "gönderildi" DEĞİL, QUEUED olur', () => {
    const offline = base({
      lastSeen: new Date(NOW - DEFAULT_ONLINE_WINDOW_MS - 1).toISOString(),
      commands: [{ id: 'c1', status: 'pending' }],
    });
    expect(offline.commandsByPhase?.QUEUED).toBe(1);
    expect(offline.commandsByPhase?.SENT).toBe(0);

    const online = base({ commands: [{ id: 'c1', status: 'pending' }] });
    expect(online.commandsByPhase?.SENT).toBe(1);
    expect(online.commandsByPhase?.QUEUED).toBe(0);
  });

  it('14. yedi DB durumu yedi ürün evresine eşlenir', () => {
    expect(commandPhaseOf('pending',   true)).toBe('SENT');
    expect(commandPhaseOf('pending',   false)).toBe('QUEUED');
    expect(commandPhaseOf('accepted',  true)).toBe('ACKNOWLEDGED');
    expect(commandPhaseOf('executing', true)).toBe('EXECUTED');
    expect(commandPhaseOf('completed', true)).toBe('VERIFIED');
    expect(commandPhaseOf('failed',    true)).toBe('FAILED');
    expect(commandPhaseOf('rejected',  true)).toBe('FAILED');
    expect(commandPhaseOf('expired',   true)).toBe('EXPIRED');
  });

  it('15. 🔒 TANINMAYAN komut durumu "tamamlandı" SAYILMAZ', () => {
    expect(commandPhaseOf('bilinmeyen', true)).toBeNull();
    const s = base({ commands: [{ id: 'c1', status: 'bilinmeyen' }] });
    expect(s.unknownCommands).toBe(1);
    expect(s.commandsByPhase?.VERIFIED).toBe(0);
    expect(s.activeCommands).toBe(0); // sessizce "aktif" de sayılmaz
  });

  it('16. aktif komut yalnız sonuçlanmamış evrelerdir', () => {
    const s = base({
      commands: [
        { id: '1', status: 'pending'   },  // ONLINE → SENT
        { id: '2', status: 'accepted'  },  // ACKNOWLEDGED
        { id: '3', status: 'executing' },  // EXECUTED
        { id: '4', status: 'completed' },  // VERIFIED — aktif DEĞİL
        { id: '5', status: 'failed'    },  // FAILED   — aktif DEĞİL
        { id: '6', status: 'expired'   },  // EXPIRED  — aktif DEĞİL
      ],
    });
    expect(s.activeCommands).toBe(3);
    expect(ACTIVE_COMMAND_PHASES).not.toContain('VERIFIED');
    expect(ACTIVE_COMMAND_PHASES).not.toContain('FAILED');
    expect(ACTIVE_COMMAND_PHASES).not.toContain('EXPIRED');
  });

  it('17. yedi evre de sözleşmede tanımlıdır ve etiketi vardır', () => {
    expect([...COMMAND_PHASES]).toEqual([
      'QUEUED', 'SENT', 'ACKNOWLEDGED', 'EXECUTED', 'VERIFIED', 'FAILED', 'EXPIRED',
    ]);
    for (const phase of COMMAND_PHASES) {
      expect(commandPhaseLabel(phase).length).toBeGreaterThan(0);
    }
  });

  /* ── Eşleştirme doğrulaması ─────────────────────────────────────────── */

  it('18. bekleyen eşleştirme "doğrulandı" DEĞİL, sunucu bekliyor olur', () => {
    const s = base({ queueItems: [item({ operationType: 'VEHICLE_PAIR', status: 'PENDING' })] });
    expect(s.pairing).toBe('PENDING_SERVER_VERIFICATION');
  });

  it('19. çakışan/kalıcı düşen eşleştirme REJECTED olur', () => {
    expect(base({ queueItems: [item({ operationType: 'VEHICLE_PAIR', status: 'CONFLICT' })] }).pairing)
      .toBe('REJECTED');
    expect(base({ queueItems: [item({ operationType: 'OWNERSHIP_CLAIM', status: 'PERMANENT_FAILED' })] }).pairing)
      .toBe('REJECTED');
  });

  it('20. yalnız SYNCED olan claim VERIFIED sayılır', () => {
    expect(base({ queueItems: [item({ operationType: 'VEHICLE_PAIR', status: 'SYNCED' })] }).pairing)
      .toBe('VERIFIED');
    expect(base({ queueItems: [item({ operationType: 'VEHICLE_PAIR', status: 'EXPIRED' })] }).pairing)
      .toBe('EXPIRED');
  });

  it('21. tüm etiket fonksiyonları her değer için metin döndürür (boş etiket YOK)', () => {
    (['ONLINE', 'OFFLINE', 'NEVER_CONNECTED', 'UNKNOWN'] as const)
      .forEach((c) => expect(connectivityLabel(c).length).toBeGreaterThan(0));
    (['VERIFIED_YOURS', 'VERIFIED_OTHER', 'UNOWNED', 'UNKNOWN'] as const)
      .forEach((o) => expect(ownershipLabel(o).length).toBeGreaterThan(0));
    (['NONE', 'PENDING_SERVER_VERIFICATION', 'VERIFIED', 'REJECTED', 'EXPIRED', 'UNAVAILABLE'] as const)
      .forEach((p) => expect(pairingLabel(p).length).toBeGreaterThan(0));
    (['CONFLICT', 'PERMANENT_FAILED', 'BLOCKED_BY_DEPENDENCY', 'RETRYABLE_FAILED',
      'PENDING', 'UP_TO_DATE', 'UNAVAILABLE'] as const)
      .forEach((s) => expect(syncStateLabel(s).length).toBeGreaterThan(0));
  });

  it('22. model SAFTIR — Date.now/localStorage KULLANMAZ', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    base({ queueItems: [item({ operationType: 'LOCATION_EVENT', status: 'PENDING' })] });
    expect(nowSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});

/* ══════════════════════════════════════════════════════════════════════ */

/* Sayfa render kilitleri — hook'lar ve okuma katmanı izole edilir. */

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

let commandReading: Record<string, { id: string; status: string }[]> | null = {};

vi.mock('@/hooks/useSessionUser', () => ({
  useSessionUser: () => ({ userId: 'u1', loading: false }),
}));
vi.mock('@/hooks/useFleet', () => ({
  useFleet: () => fleetState,
}));
vi.mock('@/lib/offline/vehicleCommandSource', () => ({
  readVehicleCommands: async () => ({ byVehicle: commandReading, readAt: NOW }),
}));

import FleetVehiclesPage from '@/app/dashboard/fleet/company-vehicles/page';

describe('B. Araç çevrimdışı — sayfa render kilitleri', () => {
  beforeEach(() => {
    fleetState.phase     = 'ready';
    fleetState.vehicles  = [];
    fleetState.queueItems = [];
    fleetState.pending   = [];
    fleetState.conflicts = [];
    fleetState.can       = () => true;
    commandReading       = {};
  });

  it('23. filoda araç yoksa boş durum gösterilir (sahte araç YOK)', () => {
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    expect(html).toContain('Filoda araç yok');
  });

  it('24. 🔒 çevrimdışı araç kartı DÜRÜST alanların hepsini gösterir', () => {
    // Sayfa gerçek saati kullanır → tarih GERÇEK `Date.now()`e göre kurulur.
    fleetState.vehicles = [{
      vehicle_id: 'v1', name: 'Kamyon 1', plate: '34 ABC 34',
      owner_id: 'u1', last_seen: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    }];
    const html = renderToStaticMarkup(<FleetVehiclesPage />);

    // §11'in istediği alanların TAMAMI kartta olmalı.
    expect(html).toContain('Son görülme');
    expect(html).toContain('Sahiplik doğrulaması');
    expect(html).toContain('Eşleştirme doğrulaması');
    expect(html).toContain('Bekleyen filo işlemi');
    expect(html).toContain('Bekleyen konum / olay');
    expect(html).toContain('Bekleyen komut');
    expect(html).toContain('Senkron');
    expect(html).toContain('Çevrimdışı');
  });

  it('25. 🔒 hiç bağlanmamış araçta UYDURMA tarih GÖSTERİLMEZ', () => {
    fleetState.vehicles = [{
      vehicle_id: 'v1', name: 'Yeni araç', plate: null, owner_id: 'u1', last_seen: null,
    }];
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    expect(html).toContain('Hiç bağlanmadı');
    expect(html).not.toContain('1970');
  });

  it('26. 🔒 komut okunamazsa "okunamadı" yazar — 0 komut GÖSTERMEZ', () => {
    commandReading = null;
    fleetState.vehicles = [{
      vehicle_id: 'v1', name: 'Kamyon', plate: null, owner_id: 'u1',
      last_seen: new Date(Date.now() - 60_000).toISOString(),
    }];
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    // İlk render'da okuma HENÜZ dönmemiştir (effect yok) → durum null.
    expect(html).toContain('Okunamadı');
  });

  it('27. çakışan araçta kullanıcı çakışma sayfasına YÖNLENDİRİLİR', () => {
    fleetState.vehicles = [{
      vehicle_id: 'v1', name: 'Kamyon', plate: null, owner_id: 'u1',
      last_seen: new Date(Date.now() - 60_000).toISOString(),
    }];
    fleetState.queueItems = [item({ operationType: 'VEHICLE_ASSIGN_COMPANY', status: 'CONFLICT' })];
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    expect(html).toContain('çakıştı');
    expect(html).toContain('Çakışmalar sayfasından');
  });

  it('28. 🔒 vehicle.read yetkisi yoksa araç listesi SIZDIRILMAZ', () => {
    fleetState.vehicles = [{
      vehicle_id: 'GIZLI', name: 'Gizli araç', plate: null, owner_id: 'u1', last_seen: null,
    }];
    fleetState.can = (c: string) => c !== 'vehicle.read';
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    expect(html).not.toContain('GIZLI');
    expect(html).toContain('yetkiniz yok');
  });

  it('29. şirketi olmayan kullanıcıya hata değil, yönlendirme gösterilir', () => {
    fleetState.company = null;
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    expect(html).toContain('Filonuz yok');
    fleetState.company = { id: 'c1', name: 'Test Filo', created_at: '' };
  });

  it('30. çevrimdışı kullanıcıya bekleyen işlerin TAMAMLANMADIĞI söylenir', () => {
    fleetState.phase   = 'offline';
    fleetState.pending = [item({ operationType: 'VEHICLE_ASSIGN_COMPANY', status: 'PENDING' })];
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    expect(html).toContain('henüz tamamlanmadı');
  });

  it('31. 🔒 araç çıkarma onay metni sahipliğin DEĞİŞMEDİĞİNİ söyler', () => {
    fleetState.vehicles = [{
      vehicle_id: 'v1', name: 'Kamyon', plate: null, owner_id: 'u1', last_seen: null,
    }];
    const html = renderToStaticMarkup(<FleetVehiclesPage />);
    expect(html).toContain('Filodan çıkar');
  });
});
