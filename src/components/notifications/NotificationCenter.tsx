import { memo, useCallback } from 'react';
import {
  Bell, BellOff, Volume2, VolumeX, Mic, MicOff,
  Phone, PhoneOff, PhoneMissed, MessageCircle,
  Mail, X, CheckCheck, ChevronRight,
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
    case 'call':         return <Phone className="w-4 h-4 text-emerald-400" />;
    case 'missed_call':  return <PhoneMissed className="w-4 h-4 text-red-400" />;
    case 'message':      return <MessageCircle className="w-4 h-4 text-blue-400" />;
    case 'system':       return <Bell className="w-4 h-4 text-slate-400" />;
    default:             return <Mail className="w-4 h-4 text-slate-400" />;
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
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 flex flex-col gap-4 animate-slide-up">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <Phone className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <div className="text-primary font-black text-base">{notif.sender}</div>
          <div className="text-emerald-400 text-xs font-medium uppercase tracking-widest">Gelen Arama</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-emerald-400">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-[10px] font-bold">AKTİF</span>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onDismiss}
          className="flex-1 h-12 flex items-center justify-center gap-2 bg-red-500/20 border border-red-500/30 rounded-2xl text-red-400 font-bold text-sm hover:bg-red-500/30 active:scale-95 transition-all"
        >
          <PhoneOff className="w-5 h-5" />
          Reddet
        </button>
        <button
          className="flex-1 h-12 flex items-center justify-center gap-2 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl text-emerald-400 font-bold text-sm hover:bg-emerald-500/30 active:scale-95 transition-all"
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
    <div className={`bg-white/[0.03] border rounded-2xl p-4 transition-colors ${
      notif.isRead ? 'border-white/[0.05]' : 'border-blue-500/20 bg-blue-500/[0.03]'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        {/* App icon */}
        <div className="w-10 h-10 rounded-xl var(--panel-bg-secondary) flex items-center justify-center text-xl flex-shrink-0">
          {notif.appIcon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <CategoryIcon category={notif.category} />
            <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">{notif.appName}</span>
            <span className="ml-auto text-slate-700 text-[10px] tabular-nums flex-shrink-0">{timeStr}</span>
          </div>
          <div className="text-primary font-bold text-sm truncate">{notif.sender}</div>
          <div className="text-slate-400 text-xs leading-relaxed mt-0.5 line-clamp-2">{notif.text}</div>
        </div>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-colors active:scale-90 flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Voice reply state */}
      {myVoice && myVoice !== 'idle' && (
        <div className={`mt-3 text-xs font-bold text-center py-2 rounded-xl ${
          myVoice === 'done'
            ? 'bg-emerald-500/15 text-emerald-400'
            : myVoice === 'error'
            ? 'bg-red-500/15 text-red-400'
            : 'bg-blue-500/15 text-blue-400'
        }`}>
          {isListening && (
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-ping mr-2" />
          )}
          {VOICE_LABELS[myVoice] ?? myVoice}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        {/* Read aloud */}
        <button
          onClick={handleSpeak}
          className={`flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${
            isSpeaking
              ? 'bg-amber-500/20 border-amber-500/30 text-amber-400 hover:bg-amber-500/30'
              : 'var(--panel-bg-secondary) border-white/5 text-slate-400 hover:var(--panel-bg-secondary) hover:text-primary'
          }`}
        >
          {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          {isSpeaking ? 'Durdur' : 'Sesli Oku'}
        </button>

        {/* Voice reply (messages only) */}
        {(notif.category === 'message') && (
          <button
            onClick={handleReply}
            disabled={isListening}
            className={`flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${
              isListening
                ? 'bg-blue-500/30 border-blue-500/50 text-blue-300 animate-pulse'
                : 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20'
            } disabled:cursor-not-allowed`}
          >
            {isListening ? <Mic className="w-3.5 h-3.5 animate-pulse" /> : <Mic className="w-3.5 h-3.5" />}
            {isListening ? 'Dinliyorum…' : 'Sesle Yanıtla'}
          </button>
        )}

        {/* Missed call callback hint */}
        {notif.category === 'missed_call' && (
          <button className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 active:scale-95 transition-all">
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
          <Bell className="w-5 h-5 text-blue-400" />
          <span className="text-primary font-black text-base uppercase tracking-widest">Bildirimler</span>
          {ns.unreadCount > 0 && (
            <span className="bg-blue-500 text-primary text-[10px] font-black px-2 py-0.5 rounded-full">
              {ns.unreadCount}
            </span>
          )}
        </div>
        {ns.notifications.length > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-slate-500 hover:text-primary text-[11px] uppercase tracking-widest transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Tümünü Oku
          </button>
        )}
      </div>

      {/* ── Auto-read setting ─────────────────────────────── */}
      <div>
        <div className="text-slate-600 text-[10px] uppercase tracking-widest mb-2">
          Otomatik Sesli Okuma
        </div>
        <div className="flex gap-2">
          {AUTO_READ_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setAutoRead(value)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-2xl border text-xs font-bold transition-all active:scale-95 ${
                ns.autoRead === value
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                  : 'var(--panel-bg-secondary) border-white/5 text-slate-500 hover:var(--panel-bg-secondary)'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TTS / Mic not available warning */}
      {!('speechSynthesis' in window) && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-amber-400 text-xs flex items-center gap-2">
          <MicOff className="w-4 h-4 flex-shrink-0" />
          Bu tarayıcı Sesli Okuma özelliğini desteklemiyor.
        </div>
      )}

      {/* ── Incoming calls (pinned at top) ────────────────── */}
      {calls.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-slate-500 text-[10px] uppercase tracking-widest flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
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
          <div className="text-slate-500 text-[10px] uppercase tracking-widest">
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
          <BellOff className="w-14 h-14 text-slate-700" />
          <div className="text-slate-600 font-bold text-sm">Bildirim yok</div>
          <div className="text-slate-700 text-xs leading-relaxed max-w-[220px]">
            WhatsApp, aramalar ve diğer bildirimler burada görünecek
          </div>
          <div className="flex items-center gap-1.5 text-slate-600 text-[11px]">
            <ChevronRight className="w-3 h-3" />
            Demo mod: 8 saniye sonra örnek bildirim gelecek
          </div>
        </div>
      ) : null}

      {/* Native permission notice */}
      {ns.hasPermission === false && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
          Bildirim erişim izni reddedildi. Lütfen Android Ayarlar → Özel Uygulama Erişimi → Bildirim Erişimi bölümünden izin verin.
        </div>
      )}
    </div>
  );
}

export const NotificationCenter = memo(NotificationCenterInner);


