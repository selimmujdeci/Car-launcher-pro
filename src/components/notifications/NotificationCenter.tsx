import { memo, useCallback } from 'react';
import {
  Bell, BellOff, Volume2, VolumeX, Mic, MicOff,
  Phone, PhoneOff, PhoneMissed, MessageCircle,
  Mail, X, CheckCheck,
} from 'lucide-react';
import {
  useNotificationState,
  speakNotification,
  startVoiceReply,
  dismissNotification,
  markAllRead,
  setAutoRead,
  stopSpeaking,
  type AppNotification,
  type AutoReadMode,
  type NotificationCategory,
} from '../../platform/notificationService';

/* ── Category icon ───────────────────────────────────────── */

function CategoryIcon({ category }: { category: NotificationCategory }) {
  switch (category) {
    case 'call':         return <Phone className="w-4 h-4" style={{ color: 'var(--oem-good, #22c55e)' }} />;
    case 'missed_call':  return <PhoneMissed className="w-4 h-4" style={{ color: 'var(--oem-danger, #ef4444)' }} />;
    case 'message':      return <MessageCircle className="w-4 h-4" style={{ color: 'var(--oem-info, #60a5fa)' }} />;
    case 'system':       return <Bell className="w-4 h-4" style={{ color: 'var(--oem-ink-3)' }} />;
    default:             return <Mail className="w-4 h-4" style={{ color: 'var(--oem-ink-3)' }} />;
  }
}

/* ── Voice reply state badge ─────────────────────────────── */

const VOICE_LABELS: Record<string, string> = {
  listening: 'Dinliyorum…',
  sending:   'Gönderiliyor…',
  done:      'Gönderildi ✓',
  error:     'Hata — Tekrar deneyin',
};

/* ── Incoming call card ──────────────────────────────────── */

const IncomingCallCard = memo(function IncomingCallCard({ notif, onDismiss }: { notif: AppNotification; onDismiss: () => void }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4 animate-slide-up"
      style={{ background: 'var(--oem-good-soft, rgba(34,197,94,0.10))', border: '1px solid var(--oem-good, rgba(34,197,94,0.35))' }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--oem-good-soft, rgba(34,197,94,0.18))' }}>
          <Phone className="w-5 h-5" style={{ color: 'var(--oem-good, #22c55e)' }} />
        </div>
        <div>
          <div className="font-black text-base" style={{ color: 'var(--oem-ink)' }}>{notif.sender}</div>
          <div className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--oem-good, #22c55e)' }}>Gelen Arama</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5" style={{ color: 'var(--oem-good, #22c55e)' }}>
          <div className="w-1.5 h-1.5 rounded-full animate-ping" style={{ background: 'var(--oem-good, #22c55e)' }} />
          <span className="text-[10px] font-bold">AKTİF</span>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onDismiss}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl font-bold text-sm active:scale-95 transition-all"
          style={{ background: 'var(--oem-danger-soft, rgba(239,68,68,0.15))', border: '1px solid var(--oem-danger, rgba(239,68,68,0.35))', color: 'var(--oem-danger, #ef4444)' }}
        >
          <PhoneOff className="w-5 h-5" />
          Reddet
        </button>
        <button
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl font-bold text-sm active:scale-95 transition-all"
          style={{ background: 'var(--oem-good-soft, rgba(34,197,94,0.15))', border: '1px solid var(--oem-good, rgba(34,197,94,0.35))', color: 'var(--oem-good, #22c55e)' }}
        >
          <Phone className="w-5 h-5" />
          Cevapla
        </button>
      </div>
    </div>
  );
});

/* ── Notification card ───────────────────────────────────── */

const NotificationCard = memo(function NotificationCard({
  notif,
  isSpeaking,
  voiceState,
}: {
  notif: AppNotification;
  isSpeaking: boolean;
  voiceState: { notifId: string; state: string } | null;
}) {
  const myVoice      = voiceState?.notifId === notif.id ? voiceState.state : null;
  const timeStr      = new Date(notif.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const isListening  = myVoice === 'listening';

  const handleSpeak = useCallback(() => {
    if (isSpeaking) { stopSpeaking(); return; }
    speakNotification(notif);
  }, [notif, isSpeaking]);

  const handleReply = useCallback(() => {
    startVoiceReply(notif.id);
  }, [notif.id]);

  const handleDismiss = useCallback(() => {
    dismissNotification(notif.id);
  }, [notif.id]);

  if (notif.category === 'call') {
    return <IncomingCallCard notif={notif} onDismiss={handleDismiss} />;
  }

  return (
    <div className="rounded-2xl p-4 transition-colors"
      style={{
        background: notif.isRead ? 'var(--oem-surface-2, rgba(255,255,255,0.03))' : 'var(--oem-info-soft, rgba(59,130,246,0.04))',
        border: `1px solid ${notif.isRead ? 'var(--oem-line, rgba(255,255,255,0.06))' : 'var(--oem-info, rgba(59,130,246,0.22))'}`,
      }}>
      {/* Header */}
      <div className="flex items-start gap-3">
        {/* App icon */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: 'var(--oem-surface-3, rgba(255,255,255,0.06))' }}>
          {notif.appIcon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <CategoryIcon category={notif.category} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--oem-ink-3)' }}>{notif.appName}</span>
            <span className="ml-auto text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--oem-ink-3)', opacity: 0.6 }}>{timeStr}</span>
          </div>
          <div className="font-bold text-sm truncate" style={{ color: 'var(--oem-ink)' }}>{notif.sender}</div>
          <div className="text-xs leading-relaxed mt-0.5 line-clamp-2" style={{ color: 'var(--oem-ink-2)' }}>{notif.text}</div>
        </div>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors active:scale-90 flex-shrink-0"
          style={{ color: 'var(--oem-ink-3)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Voice reply state */}
      {myVoice && myVoice !== 'idle' && (
        <div
          className="mt-3 text-xs font-bold text-center py-2 rounded-xl"
          style={
            myVoice === 'done'
              ? { background: 'var(--oem-good-soft)', color: 'var(--oem-good, #22c55e)' }
              : myVoice === 'error'
              ? { background: 'var(--oem-danger-soft)', color: 'var(--oem-danger, #ef4444)' }
              : { background: 'var(--oem-info-soft)', color: 'var(--oem-info, #60a5fa)' }
          }>
          {isListening && (
            <span className="inline-block w-2 h-2 rounded-full animate-ping mr-2" style={{ background: 'var(--oem-info, #60a5fa)' }} />
          )}
          {VOICE_LABELS[myVoice] ?? myVoice}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        {/* Read aloud */}
        <button
          onClick={handleSpeak}
          className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
          style={isSpeaking
            ? { background: 'var(--oem-warn-soft)', border: '1px solid var(--oem-warn, rgba(245,158,11,0.4))', color: 'var(--oem-warn, #f59e0b)' }
            : { background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-2)' }
          }
        >
          {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          {isSpeaking ? 'Durdur' : 'Sesli Oku'}
        </button>

        {/* Voice reply (messages only) */}
        {(notif.category === 'message') && (
          <button
            onClick={handleReply}
            disabled={isListening}
            className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:cursor-not-allowed"
            style={isListening
              ? { background: 'var(--oem-info-soft)', border: '1px solid var(--oem-info, rgba(59,130,246,0.6))', color: 'var(--oem-info, #60a5fa)', opacity: 1 }
              : { background: 'var(--oem-info-soft)', border: '1px solid var(--oem-info, rgba(59,130,246,0.25))', color: 'var(--oem-info, #60a5fa)' }
            }
          >
            <Mic className={`w-3.5 h-3.5 ${isListening ? 'animate-pulse' : ''}`} />
            {isListening ? 'Dinliyorum…' : 'Sesle Yanıtla'}
          </button>
        )}

        {/* Missed call callback hint */}
        {notif.category === 'missed_call' && (
          <button
            className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold active:scale-95 transition-all"
            style={{ background: 'var(--oem-good-soft)', border: '1px solid var(--oem-good, rgba(34,197,94,0.28))', color: 'var(--oem-good, #22c55e)' }}>
            <Phone className="w-3.5 h-3.5" />
            Geri Ara
          </button>
        )}
      </div>
    </div>
  );
});

/* ── Auto-read toggle ────────────────────────────────────── */

const AUTO_READ_OPTIONS: Array<{ value: AutoReadMode; label: string; icon: typeof Bell }> = [
  { value: 'off',      label: 'Kapalı',     icon: BellOff },
  { value: 'priority', label: 'Öncelikli',  icon: Bell },
  { value: 'all',      label: 'Hepsi',      icon: Volume2 },
];

/* ── Main component ──────────────────────────────────────── */

function NotificationCenterInner() {
  const ns = useNotificationState();

  const calls    = ns.notifications.filter((n) => n.category === 'call');
  const others   = ns.notifications.filter((n) => n.category !== 'call');

  return (
    <div className="flex flex-col gap-4 p-4 pb-6">

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5" style={{ color: 'var(--oem-info, #60a5fa)' }} />
          <span className="font-black text-base uppercase tracking-widest" style={{ color: 'var(--oem-ink)' }}>Bildirimler</span>
          {ns.unreadCount > 0 && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
              style={{ background: 'var(--oem-info, #3b82f6)', color: 'var(--oem-accent-ink, #fff)' }}>
              {ns.unreadCount}
            </span>
          )}
        </div>
        {ns.notifications.length > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest transition-colors"
            style={{ color: 'var(--oem-ink-3)' }}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Tümünü Oku
          </button>
        )}
      </div>

      {/* ── Auto-read setting ─────────────────────────────── */}
      <div>
        <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--oem-ink-3)' }}>
          Otomatik Sesli Okuma
        </div>
        <div className="flex gap-2">
          {AUTO_READ_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setAutoRead(value)}
              className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-2xl text-xs font-bold transition-all active:scale-95"
              style={ns.autoRead === value
                ? { background: 'var(--oem-accent-soft, rgba(224,162,60,0.16))', border: '1px solid var(--oem-accent, rgba(224,162,60,0.45))', color: 'var(--oem-accent, #E0A23C)' }
                : { background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-3)' }
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TTS / Mic not available warning */}
      {!('speechSynthesis' in window) && (
        <div className="rounded-xl p-3 text-xs flex items-center gap-2"
          style={{ background: 'var(--oem-warn-soft)', border: '1px solid var(--oem-warn, rgba(245,158,11,0.3))', color: 'var(--oem-warn, #f59e0b)' }}>
          <MicOff className="w-4 h-4 flex-shrink-0" />
          Bu tarayıcı Sesli Okuma özelliğini desteklemiyor.
        </div>
      )}

      {/* ── Incoming calls (pinned at top) ────────────────── */}
      {calls.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-widest flex items-center gap-2" style={{ color: 'var(--oem-ink-3)' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-ping" style={{ background: 'var(--oem-good, #22c55e)' }} />
            Aktif Aramalar
          </div>
          {calls.map((n) => (
            <NotificationCard
              key={n.id}
              notif={n}
              isSpeaking={ns.isSpeaking}
              voiceState={ns.voiceReply}
            />
          ))}
        </div>
      )}

      {/* ── Other notifications ───────────────────────────── */}
      {others.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--oem-ink-3)' }}>
            Son Bildirimler
          </div>
          {others.map((n) => (
            <NotificationCard
              key={n.id}
              notif={n}
              isSpeaking={ns.isSpeaking}
              voiceState={ns.voiceReply}
            />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <BellOff className="w-14 h-14" style={{ color: 'var(--oem-ink-3)', opacity: 0.35 }} />
          <div className="font-bold text-sm" style={{ color: 'var(--oem-ink-3)' }}>Bildirim yok</div>
          <div className="text-xs leading-relaxed max-w-[220px]" style={{ color: 'var(--oem-ink-3)', opacity: 0.65 }}>
            WhatsApp, aramalar ve diğer bildirimler burada görünecek
          </div>
        </div>
      ) : null}

      {/* Native permission notice */}
      {ns.hasPermission === false && (
        <div className="rounded-2xl p-4 text-sm"
          style={{ background: 'var(--oem-danger-soft)', border: '1px solid var(--oem-danger, rgba(239,68,68,0.3))', color: 'var(--oem-danger, #ef4444)' }}>
          Bildirim erişim izni reddedildi. Lütfen Android Ayarlar → Özel Uygulama Erişimi → Bildirim Erişimi bölümünden izin verin.
        </div>
      )}
    </div>
  );
}

export const NotificationCenter = memo(NotificationCenterInner);


