/**
 * phoneCallDuck.test.ts — görüşme sürerken müzik susar (kanonik 'PHONE' duck).
 *
 * Kilitler: arama bildirimi varken TEK istek tutulur (çoğalmaz) · "Yoksay"
 * (okundu) kartı gizler ama arama sürdüğü için susma sürer · son arama
 * kalkınca bırakılır · durdurunca susma ses yolunda KALMAZ · yalnız mesaj
 * bildirimi müziği SUSTURMAZ.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppNotification, NotificationState } from '../platform/notificationService';

let emit: (s: NotificationState) => void = () => {};
const releases: number[] = [];
let requested = 0;

vi.mock('../platform/notificationService', () => ({
  onNotificationState: (fn: (s: NotificationState) => void) => { emit = fn; return () => { emit = () => {}; }; },
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: (reason: string) => {
    const id = ++requested;
    expect(reason).toBe('PHONE');
    return { reason, release: () => { releases.push(id); } };
  },
}));

import { startPhoneCallDuck, stopPhoneCallDuck, hasActiveCall, CALL_DUCK_RELEASE_GRACE_MS } from '../platform/phoneCallDuck';

const n = (id: string, category: AppNotification['category'], isRead = false): AppNotification => ({
  id, category, isRead, packageName: 'p', appName: 'a', appIcon: '', sender: 's', text: 't', time: 1, isPriority: true,
});
const st = (notifications: AppNotification[]): NotificationState => ({
  notifications, unreadCount: 0, autoRead: 'off', isSpeaking: false, voiceReply: null, hasPermission: true,
});

beforeEach(() => {
  vi.useFakeTimers();
  stopPhoneCallDuck();
  releases.length = 0;
  requested = 0;
  startPhoneCallDuck();
});
afterEach(() => { vi.useRealTimers(); });

describe('phoneCallDuck', () => {
  it('yalnız arama bildirimi görüşme sayılır', () => {
    expect(hasActiveCall([n('m', 'message'), n('x', 'missed_call')])).toBe(false);
    expect(hasActiveCall([n('c', 'call', true)])).toBe(true);
  });

  it('🔒 arama boyunca TEK istek; "Yoksay" susmayı BİTİRMEZ; arama bitince bırakılır', () => {
    emit(st([n('m', 'message')]));
    expect(requested).toBe(0);
    emit(st([n('c', 'call')]));
    emit(st([n('c', 'call', true), n('m', 'message')]));   // Yoksay + yeni mesaj
    expect(requested).toBe(1);
    expect(releases).toEqual([]);
    emit(st([n('m', 'message')]));                          // görüşme bitti
    expect(releases).toEqual([]);                           // bırakma payı
    vi.advanceTimersByTime(CALL_DUCK_RELEASE_GRACE_MS);
    expect(releases).toEqual([1]);
    emit(st([n('c2', 'call')]));                            // yeni arama → yeni istek
    expect(requested).toBe(2);
  });

  it('🔒 saha: çalan→süren geçişinde bildirim silinip yeniden gelince müzik bir an bile AÇILMAZ', () => {
    emit(st([n('c', 'call')]));                             // çalıyor
    emit(st([]));                                           // MIUI: sil…
    vi.advanceTimersByTime(400);
    emit(st([n('c', 'call')]));                             // …~0,4 sn sonra süren arama
    vi.advanceTimersByTime(CALL_DUCK_RELEASE_GRACE_MS * 2);
    expect(requested).toBe(1);
    expect(releases).toEqual([]);
  });

  it('🔒 durdurunca susma ses yolunda KALMAZ', () => {
    emit(st([n('c', 'call')]));
    stopPhoneCallDuck();
    expect(releases).toEqual([1]);
    emit(st([n('c', 'call')]));                             // söküldü → etkisiz
    expect(requested).toBe(1);
  });
});
