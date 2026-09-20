/**
 * vehicleWakeIdempotencyF08.test.ts — MRI Wave 4 · F-08 (araç tarafı davranış)
 *
 *   Push-to-Wake = "uyan ve kanonik DB dinleyicisine bak". Push katmanı ikinci
 *   bir komut yürütme otoritesi DEĞİLDİR.
 *
 *   1. yeni wake sözleşmesi ({event, vehicle_id, ts} — command_id YOK) wake
 *      olarak tanınır ve kanonik CommandListener'ı başlatır;
 *   2. duplicate wake (FCM çift teslim) ikinci CommandListener/ikinci icra
 *      üretmez: listener canlıyken yalnız pending poll tetiklenir;
 *   3. insan bildirimi olayı (vehicle_offline, command_completed …) araçta wake
 *      TETİKLEMEZ (bir slug = bir semantik; araç insan bildirimi almaz);
 *   4. araç tüketici push'u GÖNDERMEZ: `notifyVehicleEvent` ağa çıkmaz,
 *      sayaçla NOT_WIRED olarak izlenir ve hiçbir hata atmaz (komut akışı
 *      etkilenmez).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Listener = (ev: { data?: Record<string, string>; notification?: { data?: Record<string, string> } }) => void;

const h = vi.hoisted(() => {
  const listeners: Record<string, Listener> = {};
  return {
    listeners,
    startCommandListener: vi.fn(),
    stopCommandListener:  vi.fn(),
    triggerPendingPoll:   vi.fn(),
    active: { value: false },
    fetchMock: vi.fn(),
  };
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    register:           vi.fn(async () => {}),
    addListener:        vi.fn(async (name: string, cb: Listener) => { h.listeners[name] = cb; return { remove: vi.fn() }; }),
  },
}));
vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: vi.fn(async (k: string) => (k === 'veh_vehicle_id' ? 'veh-1' : null)) },
}));
vi.mock('../platform/vehicleIdentityService', () => ({
  ensureDevicePushTokenRegistered: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn() }));
vi.mock('../platform/commandListener', () => ({
  startCommandListener:    h.startCommandListener,
  stopCommandListener:     h.stopCommandListener,
  isCommandListenerActive: () => h.active.value,
  triggerPendingPoll:      h.triggerPendingPoll,
}));

import { initPushService } from '../platform/pushService';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Sunucu wake üreticisinin (fcmDelivery.buildWakeMessage) BİREBİR çıktısı. */
const serverWake = (event: string) => ({ data: { event, vehicle_id: 'veh-1', ts: '1700000000000' } });

describe('F-08 · Push-to-Wake idempotent ve wake-only', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', h.fetchMock);
    await initPushService();          // ilk çağrıda kalıcı dinleyiciyi açar (idempotent)
    /* Ölçüm noktası: dinleyici UYUMUŞ (idle timeout / süreç yeniden başladı)
       varsayılır; wake yolunun onu BİR KEZ açması beklenir. */
    vi.clearAllMocks();
    h.active.value = false;
  });

  it('1. yeni sözleşme (command_id YOK) wake sayılır ve kanonik dinleyiciyi başlatır', async () => {
    h.listeners['pushNotificationReceived'](serverWake('new_command'));
    await flush();
    expect(h.startCommandListener).toHaveBeenCalledTimes(1);
    expect(h.startCommandListener).toHaveBeenCalledWith('veh-1');
  });

  it('2. duplicate wake → ikinci dinleyici/icra YOK; yalnız pending poll', async () => {
    h.listeners['pushNotificationReceived'](serverWake('new_command'));
    await flush();
    expect(h.startCommandListener).toHaveBeenCalledTimes(1);
    h.active.value = true;                     // kanonik dinleyici artık canlı
    h.listeners['pushNotificationReceived'](serverWake('new_command'));
    h.listeners['pushNotificationReceived'](serverWake('command_pending'));
    h.listeners['pushNotificationActionPerformed']({ notification: serverWake('new_command') });
    await flush();
    expect(h.startCommandListener).toHaveBeenCalledTimes(1);   // hâlâ 1
    expect(h.triggerPendingPoll).toHaveBeenCalledTimes(3);     // DB'ye bak, icra ETME
  });

  it('3. insan bildirimi olayı araçta wake tetiklemez', async () => {
    for (const ev of ['vehicle_offline', 'command_completed', 'command_failed', 'health_alert', 'speed_alert', '']) {
      h.listeners['pushNotificationReceived'](serverWake(ev));
    }
    h.listeners['pushNotificationReceived']({ data: { title: 'x', body: 'y' } });
    await flush();
    expect(h.startCommandListener).not.toHaveBeenCalled();
    expect(h.triggerPendingPoll).not.toHaveBeenCalled();
  });
});

describe('F-08 · araç tüketici push otoritesi DEĞİLDİR', () => {
  it('4. commandListener hiçbir push ucunu çağırmaz; tüketici olayı NOT_WIRED olarak sayılır', async () => {
    /* Gerçek modül büyük bir native grafı yükler (Capacitor registerPlugin …);
       burada kaynak kilidi yeterlidir: `triggerPushNotify` gövdesinde ne uç
       adresi ne fetch var — ağa çıkması YAPISAL olarak imkânsız. Komut akışı
       (`commandListenerValidityMotion.test.ts`) bu yolu gerçek modülle koşar. */
    const src = (await import('../platform/commandListener.ts?raw')).default as string;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    expect(code).not.toMatch(/functions\/v1\/(push-notify|consumer-push-notify)/);
    const fn = code.slice(code.indexOf('function triggerPushNotify('), code.indexOf('function triggerPushNotify(') + 900);
    expect(fn).not.toMatch(/fetch\(/);
    expect(fn).toMatch(/_consumerNotifyDropped\+\+/);
    expect(code).toMatch(/CONSUMER_PUSH_REQUESTED[\s\S]{0,80}NOT_WIRED/);
    expect(code).toMatch(/export function getConsumerNotifyDroppedCount/);
  });
});
