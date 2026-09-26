/**
 * pushAuthorityF08.test.ts — MRI Wave 4 · F-08 (PWA tarafı davranış)
 *
 *   İNSANA BİLDİRİM (consumer-push-notify · Web Push · push_subscriptions)
 *   ≠
 *   ARACI UYANDIR    (push-notify · FCM data-only · vehicle_push_tokens)
 *
 * DB yetkileri `supabase/tests/085_push_authority_matrix.sql`te gerçek rol ile,
 * FCM wake sözleşmesi Deno testlerinde (`fcmDelivery.test.ts` 13b/13c), native
 * sınır JUnit'te (`CommandServiceWakeContractTest`) ölçülür. Burada PWA'nın
 * çağıran davranışı kilitlenir:
 *   1. komut yaratılınca ARAÇ WAKE çağrılır — gövde yalnız {event, vehicleId};
 *      komut kimliği / tipi / zarfı / PIN gitmez;
 *   2. wake fetch'i düşerse (ağ hatası / 5xx) komut sonucu DEĞİŞMEZ (pending
 *      truth DB'de; push ≠ komut);
 *   3. vehicleStore watchdog "araç çevrimdışı"nda ARTIK hiçbir push ucunu
 *      çağırmaz (yanlış slug + tarayıcıdan service_role anti-pattern'i);
 *   4. tüketici fonksiyonu wake olaylarını, wake sözleşmesi insan olaylarını
 *      reddeder (bir slug = bir semantik);
 *   5. tarayıcı kodu `consumer-push-notify`yi HİÇ çağırmaz; `push-notify`yi
 *      yalnız commandService (wake) çağırır.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as commandService from '../lib/commandService';
import { useVehicleStore } from '@/store/vehicleStore';
import { TIMING } from '@/lib/constants';
import { isConsumerEvent, CONSUMER_EVENTS, VEHICLE_WAKE_EVENTS } from '../../../supabase/functions/consumer-push-notify/auth';

const mocks = vi.hoisted(() => ({
  supabase: {
    auth: { getSession: vi.fn(), getUser: vi.fn() },
    from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
  },
}));
vi.mock('../lib/supabase', () => ({
  supabaseBrowser: mocks.supabase, isSupabaseConfigured: true, ensurePwaSession: vi.fn(async () => 'tok'),
}));
vi.mock('../security/accountCleanup/accountCleanupRuntime', () => ({
  evaluateAccountScopedCapability: () => ({ allowed: true, generation: 1 }),
  isAccountAccessLocked: () => false,
  captureCleanupGeneration: () => 1,
  isCleanupGenerationCurrent: () => true,
}));
vi.mock('@/lib/vehicles.service', () => ({ fetchVehicles: async () => [] }));
/* E2E zarfı bu testin konusu değil (e2eCommandCrypto.test.ts); başarılı varsayılır. */
vi.mock('@/lib/e2eCommandCrypto', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCarPublicKey: vi.fn(async () => ({ ok: true, publicKey: 'dGVzdC1rZXk=' })),
  encryptE2EPayload: vi.fn(async () => ({ type: 'ecdh_v1', eph_pub: 'ZQ==', iv: 'aXY=', data: 'ZGF0YQ==', ts: Date.now() })),
}));

function telemetryChain() {
  const result = { data: [], count: 0, error: null };
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockResolvedValue(result) };
}
function insertChain() {
  return { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
           single: vi.fn().mockResolvedValue({ data: { id: 'cmd-1' }, error: null }) };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.test');
  mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1' } } });
  mocks.supabase.from.mockImplementation((t: string) => t === 'vehicle_telemetry' ? telemetryChain() : insertChain());
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, accepted: 1 }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('F-08 · araç wake sözleşmesi (PWA çağıran)', () => {
  it('1. komut yaratılınca yalnız {event:new_command, vehicleId} gider — komut bilgisi yok', async () => {
    const r = await commandService.sendCommand('veh-1', 'lock', {});
    expect(r).toMatchObject({ ok: true, commandId: 'cmd-1' });
    await flush();
    const wakeCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/functions/v1/push-notify'));
    expect(wakeCalls).toHaveLength(1);
    const [, init] = wakeCalls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ event: 'new_command', vehicleId: 'veh-1' });
    for (const k of ['payload', 'command_id', 'cmd_id', 'cmd_type', 'type', 'e2e_payload', 'pin', 'api_key']) {
      expect(body, `wake gövdesi ${k} taşıyor`).not.toHaveProperty(k);
    }
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    /* tüketici ucu tarayıcıdan HİÇ çağrılmaz */
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('consumer-push-notify'))).toBe(false);
  });

  it('1b. buildVehicleWakeBody tam listedir', () => {
    expect(Object.keys(commandService.buildVehicleWakeBody('v')).sort()).toEqual(['event', 'vehicleId']);
  });

  it('2. wake fetch düşerse komut sonucu değişmez (push ≠ komut)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const r1 = await commandService.sendCommand('veh-1', 'lock', {});
    await flush();
    expect(r1).toMatchObject({ ok: true, commandId: 'cmd-1' });

    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, reason: 'FCM_AUTH_FAILED' }) });
    const r2 = await commandService.sendCommand('veh-1', 'horn', {});
    await flush();
    expect(r2).toMatchObject({ ok: true, commandId: 'cmd-1' });
    /* komut satırı yine DB'ye yazıldı (pending truth) */
    expect(mocks.supabase.from).toHaveBeenCalledWith('vehicle_commands');
  });
});

describe('F-08 · "araç çevrimdışı" tarayıcıdan push atmaz', () => {
  it('3. watchdog offline geçişinde hiçbir push ucu çağrılmaz; durum yine offline olur', () => {
    vi.useFakeTimers();
    try {
      useVehicleStore.setState({
        vehicles: {
          A: {
            id: 'A', plate: '34A', name: 'A', status: 'online', lat: 41, lng: 29, speed: 10, rpm: 900,
            lastTimestamp: Date.now() - (TIMING.OFFLINE_TIMEOUT_MS + 1_000), lastSeen: '',
          } as unknown as ReturnType<typeof useVehicleStore.getState>['vehicles'][string],
        },
      });
      const stop = useVehicleStore.getState().startWatchdog();
      vi.advanceTimersByTime(TIMING.WATCHDOG_INTERVAL_MS + 10);
      stop();
      expect(useVehicleStore.getState().vehicles.A.status).toBe('offline');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('F-08 · bir slug = bir semantik', () => {
  it('4. tüketici fonksiyonu wake olaylarını reddeder; küme kesişmez', () => {
    for (const ev of VEHICLE_WAKE_EVENTS) expect(isConsumerEvent(ev), ev).toBe(false);
    for (const ev of CONSUMER_EVENTS) expect(isConsumerEvent(ev), ev).toBe(true);
    expect(isConsumerEvent('')).toBe(false);
    expect(isConsumerEvent(undefined)).toBe(false);
    const inter = (CONSUMER_EVENTS as readonly string[]).filter((e) => (VEHICLE_WAKE_EVENTS as readonly string[]).includes(e));
    expect(inter).toEqual([]);
  });

  it('5. tarayıcı kodu consumer-push-notify çağırmaz; push-notify yalnız commandService (wake)', () => {
    const root = resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { if (!p.includes('__tests__')) walk(p); }
        else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    walk(root);
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    const consumerCallers = files.filter((f) => /functions\/v1\/consumer-push-notify/.test(strip(readFileSync(f, 'utf8'))));
    expect(consumerCallers).toEqual([]);
    const wakeCallers = files
      .filter((f) => /functions\/v1\/push-notify/.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => f.replace(/\\/g, '/').split('/src/')[1]);
    expect(wakeCallers).toEqual(['lib/commandService.ts']);
  });
});
