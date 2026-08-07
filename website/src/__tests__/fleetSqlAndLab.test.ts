/**
 * fleetSqlAndLab.test.ts — MIGRATION 036 SÖZLEŞMESİ + CAROS LAB MODELİ.
 *
 * (a) SÖZLEŞME: migration SQL'i METİN olarak okunur; yetki kapıları, son admin
 *     koruması, cross-tenant reddi ve GRANT daraltmaları kilitlenir.
 * (b) LAB: saf model UNKNOWN/UNAVAILABLE üretir, hassas veri TAŞIMAZ.
 *
 * ⚠️ Gerçek Postgres davranışı burada KANITLANMAZ.
 * ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFleetLabModel } from '@/lib/lab/fleetLabModel';
import { countByStatus, countByOperation, type FleetLabRawReading } from '@/lib/lab/fleetLabSources';
import { buildSnapshot } from '@/lib/offline/ownershipSnapshot';
import type { QueueItem } from '@/lib/offline/types';

function loadMigration(fileName: string): string {
  const path = [
    resolve(process.cwd(), '..', 'supabase', 'migrations', fileName),
    resolve(process.cwd(), 'supabase', 'migrations', fileName),
  ].find((p) => existsSync(p));
  return path ? readFileSync(path, 'utf8') : '';
}

const SQL_036 = loadMigration('20260729000036_fleet_management_rpcs.sql');
const SQL_035 = loadMigration('20260729000035_fleet_membership_foundation.sql');

/* ── Migration 036 sözleşmesi ─────────────────────────────────────────── */

describe('036 · dosya', () => {
  it('migration bulunur ve boş değildir', () => {
    expect(SQL_036.length).toBeGreaterThan(1000);
  });

  it('035 uygulanmadan DURUR', () => {
    expect(SQL_036).toMatch(/migration 035 uygulanmamış/);
  });
});

describe('036 · kimlik ve yetki kapıları', () => {
  const WRITE_FUNCTIONS = [
    'update_company', 'delete_company', 'update_member_role',
    'remove_company_member', 'assign_vehicle_to_company', 'remove_vehicle_from_company',
  ];

  it('tüm yazma fonksiyonları kimliği auth.uid() ile alır', () => {
    for (const fn of WRITE_FUNCTIONS) {
      const body = SQL_036.split(`FUNCTION public.${fn}`)[1] ?? '';
      expect(body).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    }
  });

  it('tüm yazma fonksiyonları admin şartı koşar', () => {
    for (const fn of WRITE_FUNCTIONS) {
      const body = (SQL_036.split(`FUNCTION public.${fn}`)[1] ?? '').slice(0, 3000);
      expect(body).toMatch(/not_company_admin/);
    }
  });

  it('kimliksiz çağrı reddedilir', () => {
    const count = (SQL_036.match(/RAISE EXCEPTION 'unauthenticated'/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(WRITE_FUNCTIONS.length);
  });
});

describe('036 · son admin koruması', () => {
  it('rol düşürmede son admin korunur', () => {
    expect(SQL_036).toMatch(/IF v_target_role = 'admin' AND p_role <> 'admin' THEN[\s\S]*?last_admin_protected/);
  });

  it('üye kaldırmada son admin korunur', () => {
    const body = SQL_036.split('FUNCTION public.remove_company_member')[1] ?? '';
    expect(body).toMatch(/last_admin_protected/);
  });

  it('admin kendi rolünü değiştiremez', () => {
    expect(SQL_036).toMatch(/IF p_user_id = v_uid THEN[\s\S]*?cannot_modify_self_role/);
  });

  it('son admin sayımı yarışa karşı advisory kilitle korunur', () => {
    expect(SQL_036).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_co::text, 2\)\)/);
  });
});

describe('036 · cross-tenant reddi', () => {
  it('başka şirketin üyesine işlem yapılamaz', () => {
    const count = (SQL_036.match(/user_belongs_to_another_company/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('başka filoya ait araç atanamaz', () => {
    expect(SQL_036).toMatch(/IF v_veh_co IS NOT NULL AND v_veh_co <> v_co THEN[\s\S]*?vehicle_in_another_company/);
  });

  it('SAHİPSİZ araç filoya çekilemez (fail-closed)', () => {
    expect(SQL_036).toMatch(/IF v_owner IS NULL THEN[\s\S]*?vehicle_owned_by_another_user/);
  });

  it('aracın sahibi şirket üyesi değilse atanamaz', () => {
    expect(SQL_036).toMatch(/v_owner <> v_uid AND \(v_owner_co IS NULL OR v_owner_co <> v_co\)/);
  });

  it('okuma RPC"leri yalnız kendi şirketini döndürür', () => {
    const members = SQL_036.split('FUNCTION public.list_company_members')[1] ?? '';
    expect(members).toMatch(/WHERE p\.company_id = v_co/);
    const vehicles = SQL_036.split('FUNCTION public.list_company_vehicles')[1] ?? '';
    expect(vehicles).toMatch(/WHERE v\.company_id = v_co/);
  });
});

describe('036 · GRANT ve kapsam sınırı', () => {
  it('hiçbir RPC anon"a açık değildir', () => {
    expect(SQL_036).toMatch(/REVOKE ALL ON FUNCTION public\.update_company\(text\)\s+FROM PUBLIC, anon/);
    expect(SQL_036).toMatch(/REVOKE ALL ON FUNCTION public\.delete_company\(\)\s+FROM PUBLIC, anon/);
    expect(SQL_036).toMatch(/anon''a AÇIK — güvenlik ihlali/);
  });

  it('araç silinmez — filo silinince yalnız bağ kopar', () => {
    expect(SQL_036).toMatch(/UPDATE public\.vehicles SET company_id = NULL WHERE company_id = v_co/);
    expect(SQL_036).not.toMatch(/DELETE FROM public\.vehicles/);
  });

  it('filodan çıkarma sahipliği DEĞİŞTİRMEZ', () => {
    const body = SQL_036.split('FUNCTION public.remove_vehicle_from_company')[1] ?? '';
    expect(body).toMatch(/SET company_id = NULL/);
    expect(body).not.toMatch(/owner_id\s*=/);
  });

  it('034/035 sözleşmelerine dokunmaz', () => {
    expect(SQL_036).not.toMatch(/CREATE OR REPLACE FUNCTION public\.pair_vehicle_to_user/);
    expect(SQL_036).not.toMatch(/CREATE OR REPLACE FUNCTION public\.create_company/);
    expect(SQL_036).not.toMatch(/DROP TABLE/);
  });
});

/* ── pair_vehicle revoke sözleşmesi (035) ─────────────────────────────── */

describe('pair_vehicle revoke sözleşmesi', () => {
  it('anon ve authenticated EXECUTE geri alınır', () => {
    expect(SQL_035).toMatch(/REVOKE ALL ON FUNCTION public\.pair_vehicle\(text\) FROM PUBLIC, anon, authenticated/);
  });

  it('yalnız service_role kalır', () => {
    expect(SQL_035).toMatch(/GRANT EXECUTE ON FUNCTION public\.pair_vehicle\(text\) TO service_role/);
  });

  it('gövde değiştirilmez', () => {
    expect(SQL_035).not.toMatch(/CREATE OR REPLACE FUNCTION public\.pair_vehicle\b/);
  });
});

/* ── CAROS LAB modeli ─────────────────────────────────────────────────── */

function makeItem(over: Partial<QueueItem>): QueueItem {
  return {
    schemaVersion: 1,
    id: 'i1', operationType: 'COMPANY_CREATE', actorId: 'u1', companyId: null,
    vehicleId: null, payload: {}, createdAt: 1000, clientRevision: 3,
    dedupKey: 'd', idempotencyKey: 'k', dependsOn: [], attemptCount: 0,
    maxAttempts: 6, nextAttemptAt: 0, expiresAt: 9_999_999, status: 'PENDING',
    failureCode: null, ...over,
  };
}

const NOW = 2_000_000;

describe('CAROS LAB · filo/çevrimdışı modeli', () => {
  it('kullanıcı yoksa panel UNAVAILABLE olur ve sahte veri üretmez', () => {
    const model = buildFleetLabModel({
      userId: null, snapshot: null, snapshotReadable: false,
      queueItems: [], queueReadable: false, corruptRecords: null,
      pairingClaims: null, devicePairingClaims: null,
      schemaRejected: null, foreignAccountRejected: null, accountScopeBound: null,
      syncGeneration: null, staleRejects: null, syncRunning: null, realtime: null, validationRuns: [],
      online: null, readAt: 0,
    }, NOW);
    expect(model.health).toBe('UNAVAILABLE');
    expect(model.identity.find((f) => f.label === 'Aktif kullanıcı')?.value).toBe('YOK');
    expect(model.permissions.every((f) => f.value === 'UNKNOWN')).toBe(true);
  });

  it('okunamayan kuyruk UNAVAILABLE gösterir — sahte 0 YAZMAZ', () => {
    const model = buildFleetLabModel({
      userId: 'u1', snapshot: null, snapshotReadable: true,
      queueItems: [], queueReadable: false, corruptRecords: null,
      pairingClaims: null, devicePairingClaims: null,
      schemaRejected: null, foreignAccountRejected: null, accountScopeBound: null,
      syncGeneration: null, staleRejects: null, syncRunning: null, realtime: null, validationRuns: [],
      online: true, readAt: NOW,
    }, NOW);
    expect(model.queue.find((f) => f.label === 'Kuyruk boyutu')?.value).toBe('UNAVAILABLE');
    expect(model.health).toBe('DEGRADED');
  });

  it('bayat snapshot STALE olarak işaretlenir', () => {
    const snapshot = buildSnapshot({
      userId: 'u1', companyId: 'c1', companyRole: 'admin',
      ownedVehicleIds: ['v1'], accessibleVehicleIds: ['v1'],
      serverRevision: 9, verifiedAt: 0, ttlMs: 1000,
    });
    const model = buildFleetLabModel({
      userId: 'u1', snapshot, snapshotReadable: true,
      queueItems: [], queueReadable: true, corruptRecords: 0,
      pairingClaims: null, devicePairingClaims: null,
      schemaRejected: null, foreignAccountRejected: null, accountScopeBound: null,
      syncGeneration: null, staleRejects: null, syncRunning: null, realtime: null, validationRuns: [],
      online: true, readAt: NOW,
    }, NOW);
    expect(model.permissions.every((f) => f.origin === 'STALE')).toBe(true);
    expect(model.permissions.find((f) => f.label === 'Anlık görüntü bayat mı')?.value).toBe('EVET');
  });

  it('kuyruk sayımları ve senkron durumu doğru türetilir', () => {
    const reading: FleetLabRawReading = {
      userId: 'u1', snapshot: null, snapshotReadable: true,
      queueItems: [
        makeItem({ id: 'a', status: 'CONFLICT', failureCode: 'VEHICLE_ALREADY_OWNED' }),
        makeItem({ id: 'b', status: 'BLOCKED_BY_DEPENDENCY' }),
        makeItem({ id: 'c', status: 'PERMANENT_FAILED', failureCode: 'invalid_request' }),
        makeItem({ id: 'd', operationType: 'VEHICLE_PAIR', status: 'PENDING' }),
        makeItem({ id: 'e', operationType: 'VEHICLE_PAIR', status: 'EXPIRED' }),
      ],
      queueReadable: true, corruptRecords: 2,
      pairingClaims: null, devicePairingClaims: null,
      schemaRejected: null, foreignAccountRejected: null, accountScopeBound: null,
      syncGeneration: null, staleRejects: null, syncRunning: null, realtime: null, validationRuns: [],
      online: true, readAt: NOW,
    };
    const model = buildFleetLabModel(reading, NOW);
    const get = (label: string) => model.queue.find((f) => f.label === label)?.value;

    expect(get('Kuyruk boyutu')).toBe('5');
    expect(get('Çakışma')).toBe('1');
    expect(get('Bağımlılıkla engellenen')).toBe('1');
    expect(get('Kalıcı hata')).toBe('1');
    expect(get('Bozuk kayıt (karantina)')).toBe('2');

    const sync = (label: string) => model.sync.find((f) => f.label === label)?.value;
    expect(sync('Senkron durumu')).toBe('CONFLICT');
    // Etiketler "(kuyruk)" ile ayrıldı: eşleştirme artık İKİ kaynaktan gözlenir —
    // domain kuyruğu ve çevrimdışı claim deposu. Karışmamaları için ayrı adlanır.
    expect(sync('Bekleyen eşleştirme (kuyruk)')).toBe('1');
    expect(sync('Süresi dolmuş eşleştirme (kuyruk)')).toBe('1');
    // Claim deposu bu okumada üretilmedi → sahte 0 değil, UNAVAILABLE.
    expect(sync('Çevrimdışı eşleştirme talebi · durum')).toBe('UNAVAILABLE');
  });

  it('işlem türüne göre kırılım üretir', () => {
    const model = buildFleetLabModel({
      userId: 'u1', snapshot: null, snapshotReadable: true,
      queueItems: [
        makeItem({ id: 'a', operationType: 'MEMBER_ADD' }),
        makeItem({ id: 'b', operationType: 'MEMBER_ADD' }),
        makeItem({ id: 'c', operationType: 'COMPANY_CREATE' }),
      ],
      queueReadable: true, corruptRecords: 0,
      pairingClaims: null, devicePairingClaims: null,
      schemaRejected: null, foreignAccountRejected: null, accountScopeBound: null,
      syncGeneration: null, staleRejects: null, syncRunning: null, realtime: null, validationRuns: [],
      online: true, readAt: NOW,
    }, NOW);
    expect(model.byOperation.find((f) => f.label === 'MEMBER_ADD')?.value).toBe('2');
    expect(model.byOperation.find((f) => f.label === 'COMPANY_CREATE')?.value).toBe('1');
  });

  it('LAB HASSAS VERİ taşımaz — kod/anahtar/ham payload gösterilmez', () => {
    const model = buildFleetLabModel({
      userId: 'gizli-kullanici-id',
      snapshot: buildSnapshot({
        userId: 'gizli-kullanici-id', companyId: 'gizli-sirket-id', companyRole: 'admin',
        ownedVehicleIds: ['gizli-arac-1'], accessibleVehicleIds: ['gizli-arac-1'],
        serverRevision: 1, verifiedAt: NOW,
      }),
      snapshotReadable: true,
      queueItems: [makeItem({ payload: { code: '123456', apiKey: 'sir' } })],
      queueReadable: true, corruptRecords: 0,
      pairingClaims: null, devicePairingClaims: null,
      schemaRejected: null, foreignAccountRejected: null, accountScopeBound: null,
      syncGeneration: null, staleRejects: null, syncRunning: null, realtime: null, validationRuns: [],
      online: true, readAt: NOW,
    }, NOW);

    const rendered = JSON.stringify(model);
    expect(rendered).not.toContain('gizli-kullanici-id');
    expect(rendered).not.toContain('gizli-sirket-id');
    expect(rendered).not.toContain('gizli-arac-1');
    expect(rendered).not.toContain('123456');
    expect(rendered).not.toContain('sir');
    // Yalnız VAR/YOK ve ADET gösterilir.
    expect(model.identity.find((f) => f.label === 'Şirket kimliği')?.value).toBe('VAR');
    expect(model.permissions.find((f) => f.label === 'Sahip olunan araç')?.value).toBe('1');
  });

  it('sayım yardımcıları saf ve doğrudur', () => {
    const items = [makeItem({ status: 'PENDING' }), makeItem({ status: 'SYNCED' })];
    expect(countByStatus(items).PENDING).toBe(1);
    expect(countByStatus(items).SYNCED).toBe(1);
    expect(countByOperation(items).COMPANY_CREATE).toBe(2);
  });
});
