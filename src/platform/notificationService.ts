/**
 * Notification Service — Phone notification mirroring with TTS and voice reply.
 *
 * Architecture:
 *  - Module-level push state (same pattern as obdService / mediaService)
 *  - Native path: CarLauncher 'notification' events (requires Android NotificationListenerService)
 *  - Web/demo path: Mock notifications every ~30s simulating WhatsApp, calls, etc.
 *  - TTS: Web Speech API (SpeechSynthesis) in Turkish
 *  - Voice Reply: SpeechRecognition API → native replyToNotification or console log
 *  - Auto-read modes: 'all' | 'priority' | 'off'
 */

import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';

/* ── Types ───────────────────────────────────────────────── */

export type AutoReadMode = 'all' | 'priority' | 'off';

export type NotificationCategory = 'message' | 'call' | 'missed_call' | 'system' | 'other';

export interface AppNotification {
  id: string;
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
  hasPermission: boolean | null;
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

function _speak(text: string, onEnd?: () => void): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(text);
  utt.lang  = 'tr-TR';
  utt.rate  = 1.05;
  utt.pitch = 1.0;
  utt.volume = 1.0;

  // Try to find a Turkish voice
  const voices = window.speechSynthesis.getVoices();
  const trVoice = voices.find((v) => v.lang.startsWith('tr'));
  if (trVoice) utt.voice = trVoice;

  utt.onend   = () => { onEnd?.(); _setState({ isSpeaking: false }); };
  utt.onerror = () => { _setState({ isSpeaking: false }); };

  _setState({ isSpeaking: true });
  window.speechSynthesis.speak(utt);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
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
};

let _state: NotificationState = { ...INITIAL };
const _listeners = new Set<(s: NotificationState) => void>();
let _mockTimer: ReturnType<typeof setInterval> | null = null;
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

function _addNotification(raw: Omit<AppNotification, 'id' | 'appIcon' | 'category' | 'isRead' | 'isPriority'>): void {
  const category  = _getCategory(raw.packageName, raw.text);
  const isPriority = _isPriority(category);

  const notif: AppNotification = {
    ...raw,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    appIcon: _getIcon(raw.packageName),
    category,
    isRead: false,
    isPriority,
  };

  const notifications = [notif, ..._state.notifications].slice(0, 50);
  const unreadCount   = notifications.filter((n) => !n.isRead).length;

  _setState({ notifications, unreadCount });

  // Auto-read
  const shouldRead =
    _state.autoRead === 'all' ||
    (_state.autoRead === 'priority' && isPriority);

  if (shouldRead) {
    const ttsText = category === 'call'
      ? `Gelen arama: ${raw.sender}`
      : `${raw.appName}. ${raw.sender} diyor ki: ${raw.text}`;
    setTimeout(() => _speak(ttsText), 300);
  }
}

/* ── Mock notifications (web/demo mode) ──────────────────── */

const MOCK_POOL: Array<Omit<AppNotification, 'id' | 'appIcon' | 'category' | 'isRead' | 'isPriority' | 'time'>> = [
  { packageName: 'com.whatsapp', appName: 'WhatsApp', sender: 'Murat', text: 'Neredesin abi, geliyorum' },
  { packageName: 'com.whatsapp', appName: 'WhatsApp', sender: 'Aile Grubu', text: 'Akşama yemek var, gel 🍽️' },
  { packageName: 'org.telegram.messenger', appName: 'Telegram', sender: 'Ahmet', text: 'Toplantı 3\'e ertelendi' },
  { packageName: 'com.android.dialer', appName: 'Telefon', sender: '+90 532 XXX XX XX', text: 'Gelen Arama' },
  { packageName: 'com.android.dialer', appName: 'Telefon', sender: 'Cevapsız: Annem', text: 'Cevapsız arama' },
  { packageName: 'com.google.android.gm', appName: 'Gmail', sender: 'noreply@bank.com', text: 'Hesabınıza 1.250₺ yatırıldı' },
  { packageName: 'com.whatsapp', appName: 'WhatsApp', sender: 'Selim İş', text: 'Raporu gönderin lütfen' },
  { packageName: 'org.telegram.messenger', appName: 'Telegram', sender: 'Car Channel', text: '🚗 Yeni güncelleme mevcut!' },
];

function _startMock(): void {
  if (_mockTimer) return;
  // Fire first mock after 8 seconds, then every 25–45 seconds
  setTimeout(() => {
    _fireRandomMock();
    _mockTimer = setInterval(_fireRandomMock, 30_000 + Math.random() * 15_000);
  }, 8_000);
}

function _fireRandomMock(): void {
  const template = MOCK_POOL[Math.floor(Math.random() * MOCK_POOL.length)];
  _addNotification({ ...template, time: Date.now() });
}

/* ── Native notifications ────────────────────────────────── */

async function _startNative(): Promise<void> {
  try {
    // Request permission via native plugin (if supported)
    try {
      await (CarLauncher as unknown as Record<string, () => Promise<void>>).requestNotificationPermission?.();
      _setState({ hasPermission: true });
    } catch {
      _setState({ hasPermission: true }); // assume granted if method missing
    }

    // Listen for notification events — store handle for cleanup
    const handle = await (CarLauncher as unknown as {
      addListener: (event: string, handler: (data: Record<string, string | number | boolean>) => void) => Promise<{ remove: () => void }>;
    }).addListener('notification', (data) => {
      _addNotification({
        packageName: String(data.packageName ?? ''),
        appName: String(data.appName ?? 'Uygulama'),
        sender: String(data.sender ?? data.title ?? 'Bilinmeyen'),
        text: String(data.text ?? data.body ?? ''),
        time: Number(data.time ?? Date.now()),
      });
    });
    _nativeListenerStop = () => { try { handle.remove(); } catch { /* ignore */ } };

  } catch {
    // Fall back to mock if native not available
    _startMock();
  }
}

/* ── Public API ──────────────────────────────────────────── */

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
    _setState({ hasPermission: true });
    _startMock();
  }
}

export function stopNotificationService(): void {
  if (_mockTimer) { clearInterval(_mockTimer); _mockTimer = null; }
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
        await (CarLauncher as unknown as {
          replyToNotification: (opts: { id: string; text: string }) => Promise<void>;
        }).replyToNotification({ id: notifId, text: transcript });
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
    (CarLauncher as unknown as { dismissNotification: (opts: { id: string }) => Promise<void> })
      .dismissNotification?.({ id }).catch(() => undefined);
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
