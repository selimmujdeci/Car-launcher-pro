/**
 * vehicleEventDrop.test.ts — pushVehicleEvent sessiz yutma düzeltmesi.
 *
 * Saha hatası (2026-06-11): cihaz eşlenmemişken (veh_api_key yok)
 * vehicleIdentityService.ts'teki `if (!apiKey) return;` tüm
 * voice_diag/system_health/obd_diag eventlerini HİÇBİR İZ BIRAKMADAN
 * yutuyordu → admin incidents tablosu boş, neden teşhis edilemiyor.
 *
 * Kapsam:
 *  - apiKey yokken: console.warn basılır ('missing veh_api_key'), kuyruk
 *    çağrılmaz, sayaç artar
 *  - warn throttle (60sn'de 1 — logcat spam yok) ama SAYAÇ her düşüşte artar
 *  - apiKey varken: warn yok, enqueue çağrılır
 *  - isDevicePaired doğru cevap verir
 *  - UI kaynak-sözleşmesi: not_paired mesajı + Mobil Bağlantı yönlendirmesi
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  apiKey: '' as string,
  enqueued: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: {
    get: vi.fn(async () => M.apiKey),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

vi.mock('../platform/connectivityService', () => ({
  connectivityService: {
    enqueue: vi.fn(async (url: string, _m: string, _h: unknown, body: Record<string, unknown>) => {
      M.enqueued.push({ url, body });
    }),
  },
}));

import {
  pushVehicleEvent,
  getVehicleEventPipelineStatus,
  isDevicePaired,
  _resetVehicleEventGuardForTest,
} from '../platform/vehicleIdentityService';
import { connectivityService } from '../platform/connectivityService';

beforeEach(() => {
  _resetVehicleEventGuardForTest();
  M.apiKey = '';
  M.enqueued = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── 1. Eşlenmemiş cihaz: sessiz yutma YOK ──────────────────── */

describe('pushVehicleEvent — apiKey yokken görünür düşürme', () => {
  it("env gömülü (test ortamı .env'den) — ön koşul", () => {
    // Bu suite'in anlamlı olması için Supabase env build'e gömülü olmalı;
    // değilse drop nedeni 'env eksik' olur ve apiKey dalı hiç çalışmaz.
    expect(getVehicleEventPipelineStatus().configured).toBe(true);
  });

  it('console.warn basılır, kuyruk ÇAĞRILMAZ, sayaç artar', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await pushVehicleEvent('voice_diag', { stage: 'voice_route' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('[VehicleEvent]');
    expect(msg).toContain('missing veh_api_key; device not paired');
    expect(msg).toContain('voice_diag');           // hangi event düştü görünür
    expect(msg).toContain('Mobil Bağlantı');        // yönlendirme önerisi

    expect(connectivityService.enqueue).not.toHaveBeenCalled();

    const status = getVehicleEventPipelineStatus();
    expect(status.droppedNoKeyCount).toBe(1);
    expect(status.lastDropAt).not.toBeNull();
  });

  it('warn 60sn throttle edilir ama SAYAÇ her düşüşte artar', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await pushVehicleEvent('voice_diag',     { a: 1 });
    await pushVehicleEvent('system_health',  { b: 2 });
    await pushVehicleEvent('obd_diag',       { c: 3 });

    expect(warnSpy).toHaveBeenCalledTimes(1); // spam yok
    expect(getVehicleEventPipelineStatus().droppedNoKeyCount).toBe(3); // kayıp görünür
  });

  it('isDevicePaired → false', async () => {
    expect(await isDevicePaired()).toBe(false);
  });
});

/* ── 2. Eşlenmiş cihaz: normal akış bozulmaz ────────────────── */

describe('pushVehicleEvent — apiKey varken normal akış', () => {
  it('warn YOK, push_vehicle_event RPC kuyruğa girer', async () => {
    M.apiKey = 'veh_test_key_123';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await pushVehicleEvent('voice_diag', { stage: 'voice_route', route: 'companion_gemini' });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(M.enqueued).toHaveLength(1);
    expect(M.enqueued[0].url).toContain('/rpc/push_vehicle_event');
    expect(M.enqueued[0].body.p_api_key).toBe('veh_test_key_123');
    expect(M.enqueued[0].body.p_type).toBe('voice_diag');
    expect(getVehicleEventPipelineStatus().droppedNoKeyCount).toBe(0);
  });

  it('isDevicePaired → true', async () => {
    M.apiKey = 'veh_test_key_123';
    expect(await isDevicePaired()).toBe(true);
  });
});

/* ── 3. UI kaynak-sözleşmesi ────────────────────────────────── */

describe('UI — not_paired mesajı ve Mobil Bağlantı yönlendirmesi', () => {
  it('SupportSnapshotCard not_paired mesajını ve yönlendirmeyi içerir', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'settings', 'SupportSnapshotCard.tsx'), 'utf-8');
    expect(src).toContain('not_paired');
    expect(src).toContain('Cihaz eşlenmemiş');
    expect(src).toContain('Mobil Bağlantı');
  });

  it('InspectorPanel (dev inspector) not_paired durumunu gösterir', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'debug', 'devInspector', 'InspectorPanel.tsx'), 'utf-8');
    expect(src).toContain('not_paired');
    expect(src).toContain('Cihaz eşlenmemiş');
    expect(src).toContain('Mobil Bağlantı');
  });
});
