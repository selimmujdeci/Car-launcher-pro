/**
 * notificationMirrorService.test.ts — Telefon Merkezi bildirim aktarımı (TS ayağı).
 *
 * Kilitler: izin ÖLÇÜLÜR (yöntem yoksa "var" varsayılmaz) · native anahtar
 * kimliktir, aynı anahtar çoğalmaz · yalnız YENİ içerik seslendirilir, süren
 * görüşme her güncellemede yeniden duyurulmaz · arama bildirimi kalkınca kart
 * kapanır, mesaj kalır · bildirimde olmayan eylem native'e HİÇ gitmez
 * (sahte başarı yok) · sesli okuma kanonik asistan sesiyle ve güvenlik
 * kilidinde susar.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const handlers: Record<string, (data: Record<string, unknown>) => void> = {};
const plugin = {
  addListener: vi.fn(async (event: string, fn: (data: Record<string, unknown>) => void) => {
    handlers[event] = fn;
    return { remove: vi.fn() };
  }),
  getNotificationAccess: vi.fn(async () => ({ granted: true }) as { granted: boolean } | undefined),
  invokeNotificationAction: vi.fn(async () => ({ ok: true })),
  replyToNotification: vi.fn(async () => ({ ok: true })),
  dismissNotification: vi.fn(async () => ({ ok: true })),
  replayActiveCallNotifications: vi.fn(async () => ({ replayed: true }) as { replayed: boolean; activeCallKeys?: string[] }),
};
const speakAssistant = vi.fn();

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: plugin }));
vi.mock('../platform/ttsService', () => ({ speakAssistant, ttsCancel: vi.fn() }));

type Svc = typeof import('../platform/notificationService');
let svc: Svc;

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function post(data: Record<string, unknown>) {
  handlers.notification?.({ packageName: 'com.whatsapp', appName: 'WhatsApp', time: 1, ...data });
}
const state = () => {
  let snap!: ReturnType<Svc['useNotificationState']>;
  svc.onNotificationState((s) => { snap = s; })();
  return snap;
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  for (const k of Object.keys(handlers)) delete handlers[k];
  for (const fn of Object.values(plugin)) fn.mockClear();
  plugin.getNotificationAccess.mockImplementation(async () => ({ granted: true }));
  plugin.replayActiveCallNotifications.mockImplementation(async () => ({ replayed: true }));
  speakAssistant.mockClear();
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).__SAFETY_LOCK__;
  svc = await import('../platform/notificationService');
  svc.startNotificationService();
  await flush();
});

afterEach(() => {
  svc.stopNotificationService();
  vi.useRealTimers();
});

describe('izin', () => {
  it('🔒 saha (MIUI): izin açık ama servis BAĞLI DEĞİL ölçülür; ilk olay bağlı olduğunu kanıtlar', async () => {
    plugin.getNotificationAccess.mockImplementation(async () => ({ granted: true, connected: false }) as { granted: boolean });
    await svc.refreshNotificationAccess();
    expect(state()).toMatchObject({ hasPermission: true, listenerConnected: false });
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    expect(state().listenerConnected).toBe(true);
    handlers.notificationListenerLost?.({});
    expect(state().listenerConnected).toBe(false);
  });

  it('ölçülür; köprü yöntemi yoksa "var" VARSAYILMAZ (null)', async () => {
    expect(state().hasPermission).toBe(true);
    plugin.getNotificationAccess.mockImplementation(async () => undefined);
    expect(await svc.refreshNotificationAccess()).toBeNull();
    expect(state().hasPermission).toBeNull();
  });
});

describe('aktarım', () => {
  it('native anahtar kimliktir; aynı anahtar ÇOĞALMAZ, tanınmayan eylem DÜŞER', () => {
    post({ key: 'k1', category: 'message', sender: 'Ali', text: 'naber',
      actions: [{ kind: 'REPLY', title: 'Yanıtla' }, { kind: 'OTHER', title: 'Okundu' }, { kind: 'HACK', title: 'x' }] });
    post({ key: 'k1', category: 'message', sender: 'Ali', text: 'orada mısın' });
    const list = state().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('k1');
    expect(list[0].text).toBe('orada mısın');
    post({ key: 'k1', category: 'message', sender: 'Ali', text: 'x', actions: [{ kind: 'REPLY', title: 'Yanıtla' }, { kind: 'HACK', title: 'x' }] });
    expect(state().notifications[0].actions).toEqual([{ kind: 'REPLY', title: 'Yanıtla' }]);
  });

  it('🔒 yalnız YENİ içerik okunur; süren görüşme güncellemesi yeniden DUYURULMAZ', () => {
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });   // aynı içerik
    vi.advanceTimersByTime(400);
    expect(speakAssistant).toHaveBeenCalledTimes(1);

    post({ key: 'c', category: 'call', sender: 'Ayşe', text: 'Gelen arama',
      actions: [{ kind: 'ANSWER', title: 'Cevapla' }, { kind: 'DECLINE', title: 'Reddet' }] });
    vi.advanceTimersByTime(400);
    expect(speakAssistant).toHaveBeenLastCalledWith('Gelen arama: Ayşe', expect.any(Function));

    post({ key: 'c', category: 'call', sender: 'Ayşe', text: 'Süren arama', actions: [{ kind: 'HANG_UP', title: 'Kapat' }] });
    vi.advanceTimersByTime(400);
    expect(speakAssistant).toHaveBeenCalledTimes(2);
  });

  it('🔒 görüşme sürerken gelen mesaj konuşmanın ÜSTÜNE okunmaz', () => {
    post({ key: 'c', category: 'call', sender: 'Ayşe', text: 'Süren arama', actions: [{ kind: 'HANG_UP', title: 'Kapat' }] });
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    vi.advanceTimersByTime(400);
    expect(speakAssistant).not.toHaveBeenCalled();
    expect(state().notifications.map((n) => n.id)).toEqual(['m', 'c']);   // liste yine dolar
  });

  it('güvenlik kilidinde KONUŞULMAZ', () => {
    (window as unknown as Record<string, unknown>).__SAFETY_LOCK__ = true;
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    vi.advanceTimersByTime(400);
    expect(speakAssistant).not.toHaveBeenCalled();
  });

  it('🔒 kaçmış kaldırma: native aktif listesinde olmayan arama kartı BUDANIR; eski APK budamaz', async () => {
    post({ key: 'c1', category: 'call', sender: 'Ayşe', text: 'Süren arama' });
    post({ key: 'c2', category: 'call', sender: 'Veli', text: 'Gelen arama' });
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });

    await svc.reconcileActiveCalls();                      // liste yok (eski APK)
    expect(state().notifications).toHaveLength(3);

    plugin.replayActiveCallNotifications.mockImplementation(async () => ({ replayed: true, activeCallKeys: ['c2'] }));
    await svc.reconcileActiveCalls();
    expect(state().notifications.map((n) => n.id).sort()).toEqual(['c2', 'm']);

    plugin.replayActiveCallNotifications.mockImplementation(async () => ({ replayed: false, activeCallKeys: [] }));
    await svc.reconcileActiveCalls();                      // dinleyici yok → görüşme iddiası sürmez
    expect(state().notifications.map((n) => n.id)).toEqual(['m']);
  });

  it('🔒 dinleyici koparsa arama kartları kapanır (takılı susma yok), izin yeniden ölçülür', async () => {
    post({ key: 'c', category: 'call', sender: 'Ayşe', text: 'Süren arama' });
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    plugin.getNotificationAccess.mockClear();
    plugin.getNotificationAccess.mockImplementation(async () => ({ granted: false }));
    handlers.notificationListenerLost?.({});
    await flush();
    expect(state().notifications.map((n) => n.id)).toEqual(['m']);
    expect(plugin.getNotificationAccess).toHaveBeenCalledTimes(1);
    expect(state().hasPermission).toBe(false);
  });

  it('arama bildirimi kalkınca kart kapanır; mesaj geçmişte KALIR', () => {
    post({ key: 'c', category: 'call', sender: 'Ayşe', text: 'Gelen arama' });
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    handlers.notificationRemoved?.({ key: 'c' });
    handlers.notificationRemoved?.({ key: 'm' });
    expect(state().notifications.map((n) => n.id)).toEqual(['m']);
  });
});

describe('eylemler — sahte başarı yok', () => {
  it('🔒 bildirimde olmayan eylem native\'e HİÇ gitmez', async () => {
    post({ key: 'c', category: 'call', sender: 'Ayşe', text: 'Gelen arama', actions: [{ kind: 'DECLINE', title: 'Reddet' }] });
    expect(await svc.answerCall('c')).toEqual({ ok: false, reason: 'no_such_action' });
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    expect(await svc.replyToMessage('m', 'Tamam.')).toEqual({ ok: false, reason: 'no_reply_action' });
    expect(plugin.invokeNotificationAction).not.toHaveBeenCalled();
    expect(plugin.replyToNotification).not.toHaveBeenCalled();
  });

  it('var olan eylem gerçek anahtarla gider; native reddi ok:false döner', async () => {
    post({ key: 'c', category: 'call', sender: 'Ayşe', text: 'Gelen arama', actions: [{ kind: 'ANSWER', title: 'Cevapla' }] });
    expect(await svc.answerCall('c')).toEqual({ ok: true, reason: undefined });
    expect(plugin.invokeNotificationAction).toHaveBeenCalledWith({ key: 'c', kind: 'ANSWER' });

    plugin.invokeNotificationAction.mockImplementationOnce(async () => ({ ok: false, reason: 'send_failed' }) as { ok: boolean });
    expect((await svc.answerCall('c')).ok).toBe(false);
  });

  it('hazır yanıt gönderilince mesaj okundu olur; cevapsız aramada "Geri ara" çalışır', async () => {
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam', actions: [{ kind: 'REPLY', title: 'Yanıtla' }] });
    expect((await svc.replyToMessage('m', 'Sürüyorum, sonra yazarım.')).ok).toBe(true);
    expect(plugin.replyToNotification).toHaveBeenCalledWith({ key: 'm', text: 'Sürüyorum, sonra yazarım.' });
    expect(state().notifications.find((n) => n.id === 'm')?.isRead).toBe(true);

    post({ key: 'x', category: 'missed_call', sender: 'Ayşe', text: '1 cevapsız arama', actions: [{ kind: 'CALL_BACK', title: 'Geri ara' }] });
    expect((await svc.callBack('x')).ok).toBe(true);
    expect(plugin.invokeNotificationAction).toHaveBeenCalledWith({ key: 'x', kind: 'CALL_BACK' });
  });

  it('kapatma gerçek anahtarı gönderir', () => {
    post({ key: 'm', category: 'message', sender: 'Ali', text: 'selam' });
    svc.dismissNotification('m');
    expect(plugin.dismissNotification).toHaveBeenCalledWith({ key: 'm' });
    expect(state().notifications).toHaveLength(0);
  });

  it('tanıma motoru olmayan ortamda sesli yanıt SUNULMAZ', () => {
    expect(svc.isVoiceReplySupported()).toBe(false);
  });
});
