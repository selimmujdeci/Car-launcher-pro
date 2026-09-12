// @vitest-environment jsdom
/**
 * dormantCompletionWiring.test.tsx — P0 COMPLETION KİLİTLERİ.
 *
 * A · AccountCleanup SSR güvenliği (prerender kırığının kökü)
 * B · Trip detay + kanıt
 * C · Fleet insight detay + kanıt zinciri
 * D · Araç-kapsamlı AI izni
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

/* KISMİ mock: AccountCleanup bu modülden `SUPABASE_AUTH_COOKIE_PREFIX` de
   alır. Tüm modülü ezmek o zinciri kırardı — yalnız istemci fabrikası
   değiştirilir, kalan export'lar GERÇEK kalır. */
vi.mock('@/lib/supabaseBrowser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabaseBrowser')>();
  return { ...actual, getSupabaseBrowserClient: () => ({ rpc: mocks.rpc }) };
});

import {
  readSubjectEvidence, readFleetInsights, readFleetInsightChain,
} from '@/lib/lab/intelligenceLabSource';
import { setAiGatewayAccess, aiGatewayResultLabel } from '@/lib/fleet/aiGatewayAdmin';
import { FleetInsightDetail } from '@/components/dashboard/FleetInsightDetail';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.rpc.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* ══════════════════════════════════════════════════════════════════════
   A · ACCOUNTCLEANUP SSR GÜVENLİĞİ
   ════════════════════════════════════════════════════════════════════ */

describe('A · AccountCleanup SSR-safe', () => {
  it('modül import ANINDA throw ETMEZ', async () => {
    // Prerender kırığı import-time değil render-time idi; yine de kilitlenir.
    await expect(import('@/security/accountCleanup/useAccountCleanupRuntime'))
      .resolves.toBeTruthy();
  });

  it('sunucu anlık görüntüsü FAIL-CLOSED (lockdown açık, boot CHECKING)', async () => {
    const m = await import('@/security/accountCleanup/accountCleanupRuntime');
    const snap = m.getAccountCleanupServerSnapshot();
    expect(snap.initialized).toBe(false);
    expect(snap.lockdownActive).toBe(true);
    expect(snap.bootStatus).toBe('CHECKING');
  });

  it('SUNUCUDA runtime materyalleşmez — browser-only guard KORUNUR', async () => {
    const m = await import('@/security/accountCleanup/accountCleanupRuntime');
    const realWindow = globalThis.window;
    // @ts-expect-error — SSR benzetimi
    delete globalThis.window;
    try {
      // Guard GEVŞETİLMEDİ: sunucuda hâlâ fırlatır.
      expect(() => m.getAccountCleanupRuntime()).toThrow('ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY');
    } finally {
      globalThis.window = realWindow;
    }
  });

  it('tarayıcıda runtime alınabilir (davranış değişmedi)', async () => {
    const m = await import('@/security/accountCleanup/accountCleanupRuntime');
    expect(() => m.getAccountCleanupRuntime()).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   B · TRIP DETAY + KANIT
   ════════════════════════════════════════════════════════════════════ */

describe('B · trip kanıtı', () => {
  it('TRIP öznesiyle RPC çağrılır', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await readSubjectEvidence('u', 'TRIP', 't-1');
    expect(mocks.rpc).toHaveBeenCalledWith('get_subject_evidence', {
      p_subject_kind: 'TRIP', p_subject_id: 't-1',
    });
  });

  it('tripId yoksa RPC ÇAĞRILMAZ (kanıt sorulamaz)', async () => {
    await readSubjectEvidence('u', 'TRIP', null);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('okunamadı ≠ kanıt yok', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const r = await readSubjectEvidence('u', 'TRIP', 't-1');
    expect(r.readable).toBe(false);
    expect(r.rows).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/denied/);
  });

  it('TripView sunucu kimliğini taşır (kanıt okuması için şart)', async () => {
    const { buildTripsView } = await import('@/lib/fleet/vehicleTripsView');
    const v = buildTripsView({
      rows: [{ trip_key: 'k1', trip_id: 'srv-uuid-1' }],
      readable: true, now: 1000,
    } as never);
    expect(v.trips[0].tripId).toBe('srv-uuid-1');
  });

  it('sunucu kimliği yoksa tripId NULL (uydurulmaz)', async () => {
    const { buildTripsView } = await import('@/lib/fleet/vehicleTripsView');
    const v = buildTripsView({
      rows: [{ trip_key: 'k1' }], readable: true, now: 1000,
    } as never);
    expect(v.trips[0].tripId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   C · FLEET INSIGHT DETAY + ZİNCİR
   ════════════════════════════════════════════════════════════════════ */

describe('C · insight detay ve kanıt zinciri', () => {
  it('içgörü listesi RPC ile okunur', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await readFleetInsights('u');
    expect(mocks.rpc).toHaveBeenCalledWith('list_fleet_insights', { p_limit: 50 });
  });

  it('zincir RPC içgörü kimliğiyle çağrılır', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await readFleetInsightChain('u', 'i-1');
    expect(mocks.rpc).toHaveBeenCalledWith('get_fleet_insight_chain', { p_insight_id: 'i-1' });
  });

  it('içgörü yoksa SAHTE içgörü üretilmez', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await act(async () => { root.render(<FleetInsightDetail userId="u" />); });
    const t = container.textContent ?? '';
    expect(t).toMatch(/Henüz içgörü üretilmedi/);
    expect(t).toMatch(/demek değildir/);      // "filo sağlıklı" iması YOK
  });

  it('okunamadıysa "içgörü yok" DENMEZ', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    await act(async () => { root.render(<FleetInsightDetail userId="u" />); });
    expect(container.textContent ?? '').toMatch(/OKUNAMADI/);
  });

  it('SINGLE_VEHICLE_ONLY sınırı GİZLENMEZ + ham uuid basılmaz', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        insight_id: '11111111-2222-3333-4444-555555555555',
        type: 'FUEL_OUTLIER', state: 'ACTIVE', confidence: 'MEDIUM',
        subject_kind: 'VEHICLE', subject_id: '99999999-8888-7777-6666-555555555555',
        unknown_reason: 'SINGLE_VEHICLE_ONLY', evidence_count: 1,
      }],
      error: null,
    });
    await act(async () => { root.render(<FleetInsightDetail userId="u" />); });
    const t = container.textContent ?? '';
    expect(t).toMatch(/YALNIZ TEK ARAÇ/);
    expect(t).not.toContain('11111111-2222-3333-4444-555555555555');
    expect(t).not.toContain('99999999-8888-7777-6666-555555555555');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   D · ARAÇ-KAPSAMLI AI İZNİ
   ════════════════════════════════════════════════════════════════════ */

describe('D · araç-kapsamlı AI izni', () => {
  it('araç kimliğiyle RPC çağrılır (şirket geneli DEĞİL)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'GRANTED', error: null });
    await setAiGatewayAccess(true, 'veh-1', 'kademeli');
    expect(mocks.rpc).toHaveBeenCalledWith('set_ai_gateway_access', {
      p_enabled: true, p_vehicle_id: 'veh-1', p_reason: 'kademeli',
    });
  });

  it('şirket geneli izinde vehicle_id NULL gider', async () => {
    mocks.rpc.mockResolvedValue({ data: 'GRANTED', error: null });
    await setAiGatewayAccess(true, null, 'sirket');
    expect(mocks.rpc).toHaveBeenCalledWith('set_ai_gateway_access', {
      p_enabled: true, p_vehicle_id: null, p_reason: 'sirket',
    });
  });

  it('sunucu reddi bounded koda indirgenir', async () => {
    mocks.rpc.mockResolvedValue({ data: 'DENIED_VEHICLE_SCOPE', error: null });
    const r = await setAiGatewayAccess(true, 'other-tenant-veh', 'x');
    expect(r).toBe('DENIED_VEHICLE_SCOPE');
    expect(aiGatewayResultLabel(r)).toMatch(/bu şirkete ait değil/);
  });

  it('TANINMAYAN sunucu yanıtı yukarı TAŞINMAZ (fail-closed)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'ERROR: relation does not exist', error: null });
    const r = await setAiGatewayAccess(true, null, 'x');
    expect(r).toBe('UNREADABLE');
    expect(aiGatewayResultLabel(r)).not.toMatch(/relation/);
  });

  it('teknik SQL hatası kullanıcıya SIZMAZ', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function' } });
    const r = await setAiGatewayAccess(true, null, 'x');
    expect(aiGatewayResultLabel(r)).not.toMatch(/permission denied/);
  });
});
