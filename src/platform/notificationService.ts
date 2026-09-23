/**
 * Notification Service — Phone notification mirroring with TTS and voice reply.
 *
 * Architecture:
 *  - Module-level push state (same pattern as obdService / mediaService)
 *  - Native path: CarLauncher 'notification' events (requires Android NotificationListenerService)
 *  - Web/demo path: bildirim yok (simülasyon kaldırıldı — ticari sürüm)
 *  - TTS: kanonik asistan sesi (`ttsService.speakAssistant` — Mavi ile aynı
 *    ses zinciri ve müzik kısma yolu). Tarayıcı SpeechSynthesis KULLANILMAZ:
 *    Android WebView onu desteklemez ve ses/kısma tutarsız olurdu.
 *  - Native kaynak (2026-09-23): `NotificationMirror` YALNIZ arama · cevapsız
 *    arama · mesaj bildirimlerini gerçek anahtarı ve eylemleriyle aktarır;
 *    cevapla/reddet/kapat/yanıtla o eylemlerle yapılır (sahte başarı YOK).
 *  - Voice Reply: SpeechRecognition API → bildirimin yanıt eylemi. Android
 *    WebView bu API'yi SUNMAZ → `isVoiceReplySupported()` false ve düğme
 *    gösterilmez (mikrofonun sahibi Mavi; ikinci bir mikrofon yolu açılmaz).
 *  - Auto-read modes: 'all' | 'priority' | 'off'
 */

import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import { speakAssistant, ttsCancel } from './ttsService';

/* ── Types ───────────────────────────────────────────────── */

export type AutoReadMode = 'all' | 'priority' | 'off';

export type NotificationCategory = 'message' | 'call' | 'missed_call' | 'system' | 'other';

export type NotificationActionKind = 'ANSWER' | 'DECLINE' | 'HANG_UP' | 'REPLY' | 'CALL_BACK';
type CallActionKind = Exclude<NotificationActionKind, 'REPLY'>;

export interface NotificationActionInfo {
  readonly kind: NotificationActionKind;
  readonly title: string;
}

export interface AppNotification {
  /** Native bildirim anahtarı (native'de) — eylemler bununla hedeflenir. */
  id: string;
  /** Kalıcı/süren bildirim mi (ör. süren görüşme). */
  ongoing?: boolean;
  /** Bildirimin GERÇEKTEN taşıdığı eylemler — olmayan eylem düğmesi gösterilmez. */
  actions?: readonly NotificationActionInfo[];
  packageName: string;
  appName: string;
  appIcon: string;       // emoji fallback
  sender: string;
  text: string;
  time: number;          // timestamp ms
  category: NotificationCategory;
  isRead: boolean;
  isPriority: boolean;
}

export type VoiceReplyState = 'idle' | 'listening' | 'sending' | 'done' | 'error';

export interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  autoRead: AutoReadMode;
  isSpeaking: boolean;
  voiceReply: { notifId: string; state: VoiceReplyState } | null;
  /** `null` = ölçülemedi (eski APK/web) — "izin var" VARSAYILMAZ. */
  hasPermission: boolean | null;
  /** Bildirim dinleyici servisi şu an BAĞLI mı. İzin açık olsa da sistem
   *  servisi başlatmayabilir (saha: MIUI AutoStart reddi). `null` = ölçülemedi. */
  listenerConnected: boolean | null;
}

export interface NotificationActionResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/* ── Emoji icons per package ─────────────────────────────── */

const APP_ICONS: Record<string, string> = {
  'com.whatsapp':              '💬',
  'com.whatsapp.w4b':          '💬',
  'org.telegram.messenger':    '✈️',
  'com.instagram.android':     '📸',
  'com.facebook.katana':       '👤',
  'com.twitter.android':       '🐦',
  'com.google.android.gm':     '📧',
  'com.samsung.android.email': '📧',
  'com.android.dialer':        '📞',
  'com.google.android.dialer': '📞',
  'com.android.mms':           '💬',
  'com.samsung.android.messaging': '💬',
  'com.spotify.music':         '🎵',
  'com.google.android.youtube':'▶️',
};

function _getIcon(pkg: string): string {
  return APP_ICONS[pkg] ?? '🔔';
}

function _getCategory(pkg: string, text: string): NotificationCategory {
  if (pkg.includes('dialer') || pkg.includes('phone')) {
    return text.toLowerCase().includes('cevapsız') || text.toLowerCase().includes('missed')
      ? 'missed_call' : 'call';
  }
  if (
    pkg.includes('whatsapp') || pkg.includes('telegram') || pkg.includes('message') ||
    pkg.includes('mms') || pkg.includes('sms')
  ) return 'message';
  if (pkg.includes('system') || pkg.includes('android')) return 'system';
  return 'other';
}

function _isPriority(category: NotificationCategory): boolean {
  return category === 'call' || category === 'missed_call' || category === 'message';
}

/* ── TTS ─────────────────────────────────────────────────── */

let _speakToken = 0;

function _speak(text: string, onEnd?: () => void): void {
  /* Silence Gate (CLAUDE.md §2.3): manevra/ivme kilidinde konuşulmaz. */
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) return;
  const token = ++_speakToken;
  const done = () => { if (token === _speakToken && _state.isSpeaking) _setState({ isSpeaking: false }); };
  _setState({ isSpeaking: true });
  speakAssistant(text, () => { onEnd?.(); done(); });
  /* speakAssistant başka bir sözle kesilirse bitiş BİLDİRMEZ → "Durdur"
     düğmesi takılı kalmasın diye söz uzunluğuna göre üst sınır. */
  setTimeout(done, Math.min(60_000, 4_000 + text.length * 90));
}

export function stopSpeaking(): void {
  ttsCancel();
  _setState({ isSpeaking: false });
}

/* ── Voice recognition ───────────────────────────────────── */

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEvent = {
  results: { [index: number]: { [index: number]: { transcript: string } } };
};

/** Sesli yanıt bu ortamda gerçekten mümkün mü (Android WebView: HAYIR). */
export function isVoiceReplySupported(): boolean {
  if (typeof window === 'undefined') return false;
  const W = window as unknown as Record<string, unknown>;
  return typeof (W.SpeechRecognition ?? W.webkitSpeechRecognition) === 'function';
}

function _getSpeechRecognition(): SpeechRecognitionInstance | null {
  const W = window as unknown as Record<string, unknown>;
  const Ctor = (W.SpeechRecognition ?? W.webkitSpeechRecognition) as (new () => SpeechRecognitionInstance) | undefined;
  return Ctor ? new Ctor() : null;
}

/* ── Module state ────────────────────────────────────────── */

const INITIAL: NotificationState = {
  notifications: [],
  unreadCount: 0,
  autoRead: 'priority',
  isSpeaking: false,
  voiceReply: null,
  hasPermission: null,
  listenerConnected: null,
};

let _state: NotificationState = { ...INITIAL };
const _listeners = new Set<(s: NotificationState) => void>();
let _nativeListenerStop: (() => void) | null = null;
let _started = false;

function _notify(): void {
  const snap = { ..._state, notifications: [..._state.notifications] };
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<NotificationState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

/* ── Add notification ────────────────────────────────────── */

const NATIVE_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(['message', 'call', 'missed_call']);
const ACTION_KINDS: ReadonlySet<string> = new Set(['ANSWER', 'DECLINE', 'HANG_UP', 'REPLY', 'CALL_BACK']);

/** Bildirim bu eylemi GERÇEKTEN taşıyor mu — UI düğmeyi yalnız o zaman gösterir. */
export function hasAction(n: AppNotification, kind: NotificationActionKind): boolean {
  return (n.actions ?? []).some((a) => a.kind === kind);
}

type RawNotification = Omit<AppNotification, 'id' | 'appIcon' | 'category' | 'isRead' | 'isPriority'> & {
  key?: string;
  category?: string;
};

/** Native eylem listesini doğrular — tanınmayan tür DÜŞER (uydurma düğme yok). */
function _parseActions(raw: unknown): NotificationActionInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is { kind: string; title?: unknown } => !!a && typeof (a as { kind?: unknown }).kind === 'string')
    .filter((a) => ACTION_KINDS.has(a.kind))
    .map((a) => ({ kind: a.kind as NotificationActionKind, title: typeof a.title === 'string' ? a.title : '' }));
}

function _addNotification(raw: RawNotification): void {
  const category: NotificationCategory = raw.category && NATIVE_CATEGORIES.has(raw.category as NotificationCategory)
    ? raw.category as NotificationCategory
    : _getCategory(raw.packageName, raw.text);
  const isPriority = _isPriority(category);
  const id = raw.key || `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  /* Aynı anahtar = AYNI bildirimin güncellemesi (yeni mesaj, süren görüşme
     sayacı). Listede çoğaltılmaz; yalnız YENİ içerik seslendirilir. */
  const previous = raw.key ? _state.notifications.find((n) => n.id === id) : undefined;
  const isNewContent = !previous || previous.text !== raw.text || previous.sender !== raw.sender;

  const notif: AppNotification = {
    packageName: raw.packageName,
    appName: raw.appName,
    sender: raw.sender,
    text: raw.text,
    time: raw.time,
    ongoing: raw.ongoing,
    actions: raw.actions,
    id,
    appIcon: _getIcon(raw.packageName),
    category,
    isRead: previous ? previous.isRead && !isNewContent : false,
    isPriority,
  };

  const rest = _state.notifications.filter((n) => n.id !== id);

  // Silence Gate (CLAUDE.md §2.3): manevra/ivme kilidi aktifse TTS ve UI popup bypass.
  // Bildirim listeye sessizce eklenir; _notify() çağrılmaz → React subscriber'lar tetiklenmez.
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SAFETY_LOCK__) {
    _state.notifications = [notif, ...rest].slice(0, 50);
    _state.unreadCount   = _state.notifications.filter((n) => !n.isRead).length;
    return;
  }

  const notifications = [notif, ...rest].slice(0, 50);
  const unreadCount   = notifications.filter((n) => !n.isRead).length;

  _setState({ notifications, unreadCount });

  /* Auto-read: yalnız YENİ içerik; arama yalnız ÇALARKEN (cevaplanabilirken)
     duyurulur — süren görüşmenin her güncellemesinde tekrar okunmaz. */
  const ringing = category !== 'call' || hasAction(notif, 'ANSWER');
  /* Başka bir görüşme sürerken hiçbir şey seslendirilmez — konuşmanın üstüne okunmaz. */
  const otherCallActive = rest.some((n) => n.category === 'call');
  const shouldRead = isNewContent && ringing && !otherCallActive && (
    _state.autoRead === 'all' ||
    (_state.autoRead === 'priority' && isPriority));

  if (shouldRead) {
    const ttsText = category === 'call'
      ? `Gelen arama: ${raw.sender}`
      : `${raw.appName}. ${raw.sender} diyor ki: ${raw.text}`;
    setTimeout(() => _speak(ttsText), 300);
  }
}

/* ── Native notifications ────────────────────────────────── */

/** İzni ÖLÇER; ölçülemezse `null` — "izin var" VARSAYILMAZ. */
export async function refreshNotificationAccess(): Promise<boolean | null> {
  let granted: boolean | null = null;
  let connected: boolean | null = null;
  try {
    const res = await CarLauncher.getNotificationAccess?.();
    granted = typeof res?.granted === 'boolean' ? res.granted : null;
    connected = typeof res?.connected === 'boolean' ? res.connected : null;
  } catch { granted = null; }
  if (granted !== _state.hasPermission || connected !== _state.listenerConnected) {
    _setState({ hasPermission: granted, listenerConnected: connected });
  }
  return granted;
}

/**
 * Native'deki AKTİF arama bildirimlerini yeniden yayınlatır ve listede artık
 * aktif olmayan arama kartlarını budar — kaçmış bir kaldırma "görüşme sürüyor"
 * (ve müziğin susması) iddiasını TAKILI bırakamaz. Eski APK (liste yok) →
 * budama YOK. Dinleyici bağlı değilse native boş liste döner: sinyal yokken
 * görüşme iddiası sürdürülmez.
 */
export async function reconcileActiveCalls(): Promise<void> {
  let res: { replayed: boolean; activeCallKeys?: string[] } | undefined;
  try { res = await CarLauncher.replayActiveCallNotifications?.(); } catch { return; }
  const active = res?.activeCallKeys;
  if (!Array.isArray(active)) return;
  _pruneCalls(new Set(active));
}

/** Arama kartlarını budar; `keep` yoksa HEPSİ (arama sinyali yok). */
function _pruneCalls(keep: ReadonlySet<string> | null): void {
  const notifications = _state.notifications.filter((n) => n.category !== 'call' || (keep !== null && keep.has(n.id)));
  if (notifications.length === _state.notifications.length) return;
  _setState({ notifications, unreadCount: notifications.filter((n) => !n.isRead).length });
}

/** Sistem "Bildirim erişimi" sayfasını açar (kullanıcı CarOS'u etkinleştirir). */
export async function openNotificationAccessSettings(): Promise<boolean> {
  try { return (await CarLauncher.openNotificationAccessSettings?.())?.opened === true; } catch { return false; }
}

async function _startNative(): Promise<void> {
  try {
    await refreshNotificationAccess();

    const bridge = CarLauncher as unknown as {
      addListener: (event: string, handler: (data: Record<string, unknown>) => void) => Promise<{ remove: () => void }>;
    };
    const handle = await bridge.addListener('notification', (data) => {
      /* Olay geldiyse dinleyici BAĞLIDIR (ölçüm, varsayım değil). */
      if (_state.listenerConnected !== true) _setState({ listenerConnected: true });
      _addNotification({
        key: typeof data.key === 'string' ? data.key : undefined,
        category: typeof data.category === 'string' ? data.category : undefined,
        packageName: String(data.packageName ?? ''),
        appName: String(data.appName ?? 'Uygulama'),
        sender: String(data.sender ?? data.title ?? 'Bilinmeyen'),
        text: String(data.text ?? data.body ?? ''),
        time: Number(data.time ?? Date.now()),
        ongoing: data.ongoing === true,
        actions: _parseActions(data.actions),
      });
    });
    /* Arama bildirimi kalktı = görüşme bitti/reddedildi → kart kapanır.
       Mesajlar oturum geçmişinde KALIR (okunmak için). */
    const removed = await bridge.addListener('notificationRemoved', (data) => {
      const key = typeof data.key === 'string' ? data.key : '';
      const target = _state.notifications.find((n) => n.id === key);
      if (!target || target.category !== 'call') return;
      const notifications = _state.notifications.filter((n) => n.id !== key);
      _setState({ notifications, unreadCount: notifications.filter((n) => !n.isRead).length });
    });
    /* Sistem dinleyiciyi kopardı (erişim geri alındı vb.) → arama sinyali
       YOK: görüşme iddiası (ve müziğin susması) sürdürülmez; izin yeniden
       ölçülür. */
    const lost = await bridge.addListener('notificationListenerLost', () => {
      _setState({ listenerConnected: false });
      _pruneCalls(null);
      void refreshNotificationAccess();
    });
    /* Ön plana her dönüşte aktif aramalar native'le uzlaştırılır (olay
       tetiklemeli; zamanlayıcı/yoklama YOK). */
    const onVisible = () => { if (document.visibilityState === 'visible') void reconcileActiveCalls(); };
    document.addEventListener('visibilitychange', onVisible);
    _nativeListenerStop = () => {
      try { handle.remove(); } catch { /* ignore */ }
      try { removed.remove(); } catch { /* ignore */ }
      try { lost.remove(); } catch { /* ignore */ }
      document.removeEventListener('visibilitychange', onVisible);
    };
    /* Dinleyici servisi bizden ÖNCE bağlanmış olabilir → görüşme sürerken
       açılan uygulamada arama kartı kaybolmasın. */
    await reconcileActiveCalls();

  } catch {
    // Native dinleyici kurulamadı → bildirim yok (simülasyona düşülmez).
    // İzin/listener yokken sessiz kal; startNotificationService retry'e izin verir.
    _setState({ hasPermission: false });
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function addSystemNotification(sender: string, text: string, isPriority = false): void {
  _addNotification({
    packageName: 'com.android.systemui',
    appName: 'Sistem',
    sender,
    text,
    time: Date.now(),
  });
  if (isPriority) {
    // Priority notifications are already handled by _addNotification for auto-read
    // but we can ensure immediate feedback if needed.
  }
}

export function startNotificationService(): void {
  if (_started) return;
  _started = true;

  if (Capacitor.isNativePlatform()) {
    // Await via void + catch — prevents unhandled promise rejection
    _startNative().catch(() => {
      // _startNative already falls back to mock on failure; this is a safety net
      _started = false; // allow retry
    });
  } else {
    // Web/demo: simülasyon bildirimi yok. Native köprü olmadan bildirim gelmez.
    _setState({ hasPermission: false });
  }
}

export function stopNotificationService(): void {
  if (_nativeListenerStop) {
    const stop = _nativeListenerStop;
    _nativeListenerStop = null;
    try { stop(); } catch { /* ignore */ }
  }
  stopSpeaking();
  _started = false;
}

export function speakNotification(notif: AppNotification): void {
  const text = notif.category === 'call' || notif.category === 'missed_call'
    ? `${notif.appName}. ${notif.sender}`
    : `${notif.appName}. ${notif.sender} diyor ki: ${notif.text}`;
  _speak(text);
}

export async function startVoiceReply(notifId: string): Promise<void> {
  const rec = _getSpeechRecognition();
  if (!rec) {
    _setState({ voiceReply: { notifId, state: 'error' } });
    return;
  }

  // Stop any current TTS before listening
  stopSpeaking();

  _setState({ voiceReply: { notifId, state: 'listening' } });

  rec.lang             = 'tr-TR';
  rec.continuous       = false;
  rec.interimResults   = false;
  rec.maxAlternatives  = 1;

  rec.onresult = async (e) => {
    const transcript = e.results[0]?.[0]?.transcript ?? '';
    if (!transcript) { _setState({ voiceReply: { notifId, state: 'error' } }); return; }

    _setState({ voiceReply: { notifId, state: 'sending' } });

    try {
      if (Capacitor.isNativePlatform()) {
        const res = await replyToMessage(notifId, transcript);
        if (!res.ok) { _setState({ voiceReply: { notifId, state: 'error' } }); return; }
      }
    } catch {
      // ignore
    }

    _setState({ voiceReply: { notifId, state: 'done' } });
    setTimeout(() => _setState({ voiceReply: null }), 2_000);
  };

  rec.onerror = () => {
    _setState({ voiceReply: { notifId, state: 'error' } });
    setTimeout(() => _setState({ voiceReply: null }), 2_000);
  };

  rec.onend = () => {
    if (_state.voiceReply?.state === 'listening') {
      _setState({ voiceReply: { notifId, state: 'error' } });
      setTimeout(() => _setState({ voiceReply: null }), 2_000);
    }
  };

  rec.start();
}

export function dismissNotification(id: string): void {
  const notifications = _state.notifications.filter((n) => n.id !== id);
  _setState({ notifications, unreadCount: notifications.filter((n) => !n.isRead).length });

  if (Capacitor.isNativePlatform()) {
    CarLauncher.dismissNotification?.({ key: id }).catch(() => undefined);
  }
}

/** Yalnız ekranda gizler — telefondaki bildirime/aramaya DOKUNMAZ ("Yoksay"). */
export function markNotificationRead(id: string): void {
  const notifications = _state.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
  _setState({ notifications, unreadCount: notifications.filter((n) => !n.isRead).length });
}

async function _invoke(id: string, kind: CallActionKind): Promise<NotificationActionResult> {
  const n = _state.notifications.find((x) => x.id === id);
  if (!n || !hasAction(n, kind)) return { ok: false, reason: 'no_such_action' };
  try {
    const res = await CarLauncher.invokeNotificationAction?.({ key: id, kind });
    return res ? { ok: res.ok === true, reason: res.reason } : { ok: false, reason: 'bridge_missing' };
  } catch {
    return { ok: false, reason: 'bridge_error' };
  }
}

/** Gelen aramayı bildirimin KENDİ eylemiyle cevaplar; eylem yoksa ok:false. */
export function answerCall(id: string): Promise<NotificationActionResult> { return _invoke(id, 'ANSWER'); }
export function declineCall(id: string): Promise<NotificationActionResult> { return _invoke(id, 'DECLINE'); }
export function hangUpCall(id: string): Promise<NotificationActionResult> { return _invoke(id, 'HANG_UP'); }
/** Cevapsız aramayı bildirimin "Geri ara" eylemiyle arar. */
export async function callBack(id: string): Promise<NotificationActionResult> {
  const res = await _invoke(id, 'CALL_BACK');
  if (res.ok) markNotificationRead(id);
  return res;
}

/** Mesaja bildirimin yanıt eylemiyle cevap verir (hazır yanıt / sesli yanıt). */
export async function replyToMessage(id: string, text: string): Promise<NotificationActionResult> {
  const n = _state.notifications.find((x) => x.id === id);
  if (!n || !hasAction(n, 'REPLY')) return { ok: false, reason: 'no_reply_action' };
  try {
    const res = await CarLauncher.replyToNotification?.({ key: id, text });
    if (res?.ok === true) markNotificationRead(id);
    return res ? { ok: res.ok === true, reason: res.reason } : { ok: false, reason: 'bridge_missing' };
  } catch {
    return { ok: false, reason: 'bridge_error' };
  }
}

export function markAllRead(): void {
  const notifications = _state.notifications.map((n) => ({ ...n, isRead: true }));
  _setState({ notifications, unreadCount: 0 });
}

export function setAutoRead(mode: AutoReadMode): void {
  _setState({ autoRead: mode });
  localStorage.setItem('car-launcher-notif-autoread', mode);
}

// Load persisted autoRead setting
const _savedAutoRead = localStorage.getItem('car-launcher-notif-autoread') as AutoReadMode | null;
if (_savedAutoRead) _state.autoRead = _savedAutoRead;

export function onNotificationState(fn: (s: NotificationState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state, notifications: [..._state.notifications] });
  return () => { _listeners.delete(fn); };
}

export function useNotificationState(): NotificationState {
  const [s, setS] = useState<NotificationState>({ ..._state, notifications: [..._state.notifications] });
  useEffect(() => onNotificationState(setS), []);
  return s;
}
