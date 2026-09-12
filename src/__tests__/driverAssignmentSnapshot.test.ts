/**
 * driverAssignmentSnapshot.test.ts — HEAD UNIT SÜRÜCÜ SNAPSHOT KİLİTLERİ.
 *
 * ── DURUM ─────────────────────────────────────────────────────────────
 * Bu zincir gerçek head unit'te HİÇ ÇALIŞTIRILMADI. Aşağıdakiler
 * SÖZLEŞME kilitleridir; saha doğrulaması `BLOCKED_REAL_DEVICE`'tır ve
 * "çalışıyor" olarak sunulmaz.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseAssignmentSnapshot, evaluateSnapshotFreshness,
  UNKNOWN_SNAPSHOT, SNAPSHOT_MAX_AGE_MS,
} from '../platform/fleet/driverAssignmentSnapshot';

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
const H = 3_600_000;

/** Sunucunun (`get_active_driver_assignment`) döndürdüğü biçim. */
function serverOk(over: Record<string, unknown> = {}) {
  return {
    status: 'ACTIVE',
    driverId: 'd-1',
    assignmentId: 'a-1',
    assignmentRevision: 2,
    displayName: 'Ahmet',
    source: 'FLEET_ADMIN',
    confidence: 'HIGH',
    validFrom: new Date(NOW - 2 * H).toISOString(),
    validUntil: null,
    capturedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

describe('Head unit snapshot · A. Ayrıştırma', () => {
  it('A1. 🔒 geçerli yanıt snapshot a dönüşür', () => {
    const s = parseAssignmentSnapshot(serverOk(), NOW);
    expect(s.status).toBe('ACTIVE');
    expect(s.driverId).toBe('d-1');
    expect(s.assignmentRevision).toBe(2);
    expect(s.capturedAtMs).toBe(NOW);
  });

  it('A2. 🔒 sunucu ACTIVE demediyse UNKNOWN (uydurma YOK)', () => {
    const s = parseAssignmentSnapshot(
      { status: 'UNKNOWN', reason: 'NO_ACTIVE_ASSIGNMENT' }, NOW);
    expect(s.status).toBe('UNKNOWN');
    expect(s.driverId).toBeNull();
    expect(s.reason).toBe('NO_ACTIVE_ASSIGNMENT');
  });

  it('A3. 🔒 sürücü kimliği yoksa ACTIVE İDDİA EDİLMEZ', () => {
    const s = parseAssignmentSnapshot(serverOk({ driverId: null }), NOW);
    expect(s.status).toBe('UNKNOWN');
  });

  it('A4. 🔒 bozuk/boş yanıt çökertmez, UNKNOWN üretir', () => {
    for (const bad of [null, undefined, 0, 'x', [], {}]) {
      const s = parseAssignmentSnapshot(bad, NOW);
      expect(s.status).toBe('UNKNOWN');
      expect(s.driverId).toBeNull();
    }
  });

  it('A5. 🔒 snapshot HASSAS kişisel veri taşımaz', () => {
    const s = parseAssignmentSnapshot(
      serverOk({ phone: '+90555', licenseNumber: '123', email: 'a@b.c' }), NOW);
    const json = JSON.stringify(s);
    expect(json).not.toContain('+90555');
    expect(json).not.toContain('licenseNumber');
    expect(json).not.toContain('a@b.c');
    expect(Object.keys(s)).not.toContain('phone');
  });

  it('A6. 🔒 boş şablon tüm alanları null (sahte 0/tarih YOK)', () => {
    expect(UNKNOWN_SNAPSHOT.driverId).toBeNull();
    expect(UNKNOWN_SNAPSHOT.capturedAtMs).toBeNull();
    expect(UNKNOWN_SNAPSHOT.assignmentRevision).toBeNull();
  });
});

describe('Head unit snapshot · B. Tazelik — SÜRESİZ CACHE YOK', () => {
  it('B1. 🔒 taze snapshot ACTIVE', () => {
    const s = parseAssignmentSnapshot(serverOk(), NOW);
    expect(evaluateSnapshotFreshness(s, NOW + 60_000)).toBe('ACTIVE');
  });

  it('B2. 🔒 yaş sınırını aşan snapshot STALE', () => {
    const s = parseAssignmentSnapshot(serverOk(), NOW);
    expect(evaluateSnapshotFreshness(s, NOW + SNAPSHOT_MAX_AGE_MS + 1)).toBe('STALE');
  });

  it('B3. 🔒 atama süresi dolmuşsa STALE', () => {
    const s = parseAssignmentSnapshot(
      serverOk({ validUntil: new Date(NOW + H).toISOString() }), NOW);
    expect(evaluateSnapshotFreshness(s, NOW + 2 * H)).toBe('STALE');
  });

  it('B4. 🔒 atama henüz başlamadıysa STALE', () => {
    const s = parseAssignmentSnapshot(
      serverOk({ validFrom: new Date(NOW + 5 * H).toISOString() }), NOW);
    expect(evaluateSnapshotFreshness(s, NOW)).toBe('STALE');
  });

  it('B5. 🔒 UNKNOWN snapshot tazelenmez', () => {
    expect(evaluateSnapshotFreshness(UNKNOWN_SNAPSHOT, NOW)).toBe('UNKNOWN');
  });

  it('B6. 🔒 yaş sınırı bir vardiyayı kapsar ama sınırsız DEĞİL', () => {
    expect(SNAPSHOT_MAX_AGE_MS).toBeGreaterThanOrEqual(8 * H);
    expect(SNAPSHOT_MAX_AGE_MS).toBeLessThanOrEqual(24 * H);
  });
});

describe('Head unit snapshot · C. Sözleşme sınırları', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverAssignmentSnapshot.ts'), 'utf8');

  it('C1. 🔒 sürücü SEÇİMİ açılmadı (güvenli kimlik doğrulama yok)', () => {
    /* Serbest seçim, "kim olduğunu iddia eden herkes o kişi sayılır"
       demektir ve attribution'ı kanıt olmaktan çıkarır. */
    expect(SRC).not.toMatch(/selectDriver|setDriver|chooseDriver|assignDriver/);
  });

  it('C2. 🔒 timer/abonelik YOK — snapshot trip boyunca DONDURULUR', () => {
    expect(SRC).not.toContain('setInterval');
    expect(SRC).not.toContain('setTimeout');
    expect(SRC).not.toContain('addEventListener');
  });

  it('C3. 🔒 yalnız okuma RPC si çağrılır', () => {
    expect(SRC).toContain('get_active_driver_assignment');
    expect(SRC).not.toContain('create_vehicle_driver_assignment');
    expect(SRC).not.toContain('manually_assign_trip_driver');
    expect(SRC).not.toContain('create_fleet_driver');
  });

  it('C4. 🔒 LAB okuma yüzeyi ağ çağrısı TETİKLEMEZ', () => {
    const fn = SRC.slice(SRC.indexOf('export function readDriverSnapshot'));
    expect(fn).not.toContain('await');
    expect(fn).not.toContain('capture(');
  });
});

describe('Head unit snapshot · D. LAB gözlem yüzeyi', () => {
  const SCREEN = readFileSync(
    join(process.cwd(), 'src/components/devtools/screens/FleetDriverIdentityScreen.tsx'),
    'utf8');

  it('D1. 🔒 §18 alanları gözlenir', () => {
    for (const field of [
      'activeAssignmentStatus', 'activeDriverRef', 'assignmentSource',
      'assignmentConfidence', 'assignmentAge', 'assignmentRevision',
      'snapshotFreshness', 'captureCount', 'lastCaptureFailure',
    ]) {
      expect(SCREEN).toContain(field);
    }
  });

  it('D2. 🔒 KİŞİSEL VERİ export edilmez — ad yerine bounded referans', () => {
    /* `displayName` snapshot'ta VAR ama LAB ekranına BASILMAZ.
       Kilit ALAN ERİŞİMİNİ hedefler, kelimeyi değil: `phoneHubDriverSource`
       bir durum etiketidir, kişisel veri değil — serbest `phone` araması
       onu yanlışlıkla sızıntı sayar. */
    expect(SCREEN).toContain('drv:');
    expect(SCREEN).not.toMatch(/\{s\?\.displayName\}|\{s\.displayName\}/);
    expect(SCREEN).not.toMatch(/\bs\??\.(phone|licenseNumber|email|employeeCode|linkedUserId)\b/);
    expect(SCREEN).not.toMatch(/snapshot\.(phone|licenseNumber|email)\b/);
  });

  it('D3. 🔒 salt-okunur — aktif komut YOK', () => {
    for (const forbidden of [
      'capture(', 'callVehicleRpc', 'setInterval', 'setTimeout',
      'create_fleet_driver', 'manually_assign_trip_driver',
    ]) {
      expect(SCREEN).not.toContain(forbidden);
    }
  });

  it('D4. 🔒 gerçek cihaz durumu DÜRÜSTÇE gösterilir', () => {
    expect(SCREEN).toContain('BLOCKED_REAL_DEVICE');
  });
});
