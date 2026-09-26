/**
 * fcmWakeNotExecutorF02.test.ts — MRI F-02: FCM BİR YÜRÜTÜCÜ DEĞİL, WAKE'TİR.
 *
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * Push yolunda kanonik `commandListener`dan BAĞIMSIZ ikinci bir fiziksel
 * yürütücü zinciri duruyordu:
 *   FCM `e2e_payload` → CommandService.handleEncryptedCommand
 *   → NativeCryptoManager.decryptCommandPayload → CanBusManager (CAN icrası)
 *   → SharedPreferences sonuç kuyruğu
 *   → fcmService.drainNativeCommandQueue
 *   → anon apikey ile `PATCH /rest/v1/vehicle_commands` (ikinci status otoritesi).
 *
 * F-08 sonrası sunucu wake üreticisi bu payload'ı ÜRETEMİYORDU (dormant), ama
 * zincir koddaydı ve JS ucundaki anon PATCH, cihaz kimliği doğrulamadan komut
 * durumu yazabiliyordu.
 *
 * ── KİLİTLENEN INVARIANTLAR ──────────────────────────────────────────────
 *   1 · Wake, kanonik dinleyiciye DEVREDER (fetch_pending oradan yapılır).
 *   2 · Wake HİÇBİR koşulda komut durumu yazmaz (anon PATCH yok).
 *   3 · Tekrarlanan wake ikinci bir yürütme/dinleyici üretmez.
 *   4 · `cmd_id`/`cmd_type`/`e2e_payload` taşıyan legacy payload fazladan
 *       hiçbir şey yapmaz — en fazla wake'tir.
 *   5 · Native kuyruk/drain yüzeyi modülde ARTIK YOK; MCU dispatch ve
 *       cross-channel nonce yüzeyleri DURUYOR.
 *
 * Testler modülün GERÇEK davranışına bakar (çağrıldı mı / fetch gitti mi),
 * kaynak metnine değil.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Kanonik dinleyici casusları ─────────────────────────────────────── */
const listener = vi.hoisted(() => ({
  active:              false,
  startCommandListener: vi.fn((_vehicleId: string) => { listener.active = true; }),
  stopCommandListener:  vi.fn(() => { listener.active = false; }),
  triggerPendingPoll:   vi.fn(),
}));

vi.mock('../platform/commandListener', () => ({
  startCommandListener:   listener.startCommandListener,
  stopCommandListener:    listener.stopCommandListener,
  triggerPendingPoll:     listener.triggerPendingPoll,
  isCommandListenerActive: () => listener.active,
}));

/* ── Capacitor: native platform ──────────────────────────────────────── */
vi.mock('@capacitor/core', () => ({
  Capacitor:      { isNativePlatform: () => true },
  registerPlugin: () => ({}),   // nativePlugin.ts modül yükünde çağırır
}));

/* ── Push köprüsü: kayıtlı dinleyicileri yakala ──────────────────────── */
type PushHandler = (payload: unknown) => void;
const push = vi.hoisted(() => ({
  handlers: new Map<string, PushHandler>(),
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    register:           vi.fn(async () => undefined),
    addListener:        vi.fn(async (event: string, cb: PushHandler) => {
      push.handlers.set(event, cb);
      return { remove: vi.fn() };
    }),
  },
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  ensureDevicePushTokenRegistered: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: vi.fn(async () => 'veh-1') },
}));

vi.mock('../platform/debug', () => ({ logInfo: vi.fn() }));

/** Ağ: her çağrı kaydedilir — wake yolunda HİÇBİRİ beklenmiyor. */
const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));

/** Wake push'unun teslimi (fcmService `pushNotificationReceived` dinler). */
function deliverPush(data: Record<string, string>): void {
  const handler = push.handlers.get('pushNotificationReceived');
  if (!handler) throw new Error('pushNotificationReceived dinleyicisi kurulmadı');
  handler({ data });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('F-02 · FCM = wake sinyali, komut yürütücüsü değil', () => {
  let cleanup: () => void = () => {};

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    push.handlers.clear();
    listener.active = false;
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();

    const mod = await import('../platform/fcmService');
    cleanup = await mod.initFcmService();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── 1 · Wake → kanonik dinleyici devri ────────────────────────────────

  it('wake payload kanonik CommandListener\'a DEVREDER', async () => {
    deliverPush({ event: 'new_command', vehicle_id: 'veh-1', ts: '1700000000000' });
    await flush();

    expect(listener.startCommandListener).toHaveBeenCalledWith('veh-1');
  });

  it('dinleyici zaten canlıysa yeniden kurulmaz, yalnız bekleyenler yoklanır', async () => {
    listener.active = true;
    deliverPush({ event: 'command_pending', vehicle_id: 'veh-1', ts: '1' });
    await flush();

    expect(listener.triggerPendingPoll).toHaveBeenCalledTimes(1);
    expect(listener.startCommandListener).not.toHaveBeenCalled();
  });

  // ── 2 · Wake komut durumu YAZMAZ ──────────────────────────────────────

  it('başlatma sırasında `vehicle_commands` durumuna anon PATCH GİTMEZ', () => {
    /* Eski `drainNativeCommandQueue` yolu burada anon apikey ile PATCH
       atıyordu: cihaz kimliği doğrulamayan ikinci status otoritesi. */
    const patched = fetchSpy.mock.calls.filter(([url, init]) =>
      String(url).includes('vehicle_commands')
      || (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patched).toHaveLength(0);
  });

  it('wake teslimi komutu `completed`/`failed` olarak İŞARETLEMEZ', async () => {
    deliverPush({ event: 'new_command', vehicle_id: 'veh-1', ts: '1' });
    await flush();

    const bodies = fetchSpy.mock.calls
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ''));
    expect(bodies.some((b) => b.includes('completed') || b.includes('failed'))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('wake BAŞARISIZ olsa bile (vehicle_id yok) komut `failed` yazılmaz', async () => {
    const mod = await import('../platform/sensitiveKeyStore');
    (mod.sensitiveKeyStore.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    deliverPush({ event: 'new_command', vehicle_id: 'veh-1', ts: '1' });
    await flush();

    expect(listener.startCommandListener).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled(); // komut DB'de pending kalır
  });

  // ── 3 · Tekrarlanan wake ikinci yürütme üretmez ───────────────────────

  it('aynı wake iki kez gelirse dinleyici İKİ kez kurulmaz', async () => {
    deliverPush({ event: 'new_command', vehicle_id: 'veh-1', ts: '1' });
    deliverPush({ event: 'new_command', vehicle_id: 'veh-1', ts: '1' });
    await flush();

    expect(listener.startCommandListener).toHaveBeenCalledTimes(1);
  });

  // ── 4 · Legacy / malicious payload yetki kazandırmaz ──────────────────

  it('cmd_id + cmd_type + e2e_payload taşıyan legacy payload yalnız wake\'tir', async () => {
    deliverPush({
      event:       'new_command',
      vehicle_id:  'veh-1',
      ts:          '1',
      cmd_id:      'cmd-1',
      cmd_type:    'unlock',
      e2e_payload: '{"type":"ecdh_v1","eph_pub":"..."}',
    });
    await flush();

    /* Yapılan TEK şey: kanonik dinleyiciyi uyandırmak. Fiziksel icra,
       decrypt ve status yazımı YOK. */
    expect(listener.startCommandListener).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 5 · Modül yüzeyi: ikinci yürütücünün JS ucu kalmadı ─────────────────

describe('F-02 · nativeCommandBridge yüzeyi', () => {
  it('native kuyruk/drain/anahtar-senkron yüzeyi ARTIK YOK', async () => {
    vi.resetModules();
    const bridge = await import('../platform/nativeCommandBridge');
    for (const removed of [
      'drainNativeCommandQueue',
      'getNativeCommandResults',
      'getQueuedNativeCommands',
      'clearNativeCommandQueue',
      'syncKeysToNative',
    ]) {
      expect(bridge, `ikinci yürütücünün yüzeyi geri gelmiş: ${removed}`)
        .not.toHaveProperty(removed);
    }
  });

  it('kanonik MCU dispatch ve cross-channel nonce yüzeyleri DURUYOR', async () => {
    vi.resetModules();
    const bridge = await import('../platform/nativeCommandBridge');
    expect(typeof bridge.executeMcuCommand).toBe('function');
    expect(typeof bridge.checkCrossChannelNonceReplay).toBe('function');
  });
});
