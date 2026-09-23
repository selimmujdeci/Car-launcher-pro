/**
 * PhoneMessagesTab — Telefon Merkezi · Mesajlar.
 *
 * ── GERÇEK VERİ KAYNAĞI, İKİNCİ SİSTEM YOK ──────────────────────────────────
 * Tek kaynak `notificationService` (category 'message') — NotificationCenter'ın
 * kullandığı AYNI otorite. İkinci bir mesaj/bildirim borusu KURULMAZ.
 *
 * ── KAYNAK (2026-09-23) ─────────────────────────────────────────────────────
 * Native `NotificationMirror` (MediaListenerService = NotificationListener),
 * CarOS'un çalıştığı cihazdaki mesaj bildirimlerini gerçek anahtarı ve yanıt
 * eylemiyle aktarır. Companion uygulaması GEREKMEZ. Erişim kapalıysa boş
 * liste "mesajın yok" diye sunulmaz — izin kartı gösterilir.
 */
import { memo } from 'react';
import { MessageSquare, Volume2, VolumeX } from 'lucide-react';
import { useNotificationState, speakNotification, stopSpeaking } from '../../platform/notificationService';
import { NotificationAccessCard } from './NotificationAccessCard';
import { MessageQuickReplies } from './MessageQuickReplies';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  return `${Math.floor(hr / 24)} gün önce`;
}

export const PhoneMessagesTab = memo(function PhoneMessagesTab() {
  const { notifications, hasPermission, isSpeaking } = useNotificationState();
  const messages = notifications.filter((n) => n.category === 'message');

  return (
    <div data-editable="phone.messages-tab" data-editable-type="panel" className="h-full flex flex-col overflow-y-auto no-scrollbar p-4 gap-3">
      <NotificationAccessCard hasPermission={hasPermission} />

      {messages.length === 0 ? (
        hasPermission === true && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
              <MessageSquare className="w-6 h-6" style={{ color: 'var(--oem-ink-3)' }} />
            </div>
            <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>Yeni mesaj yok</div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--oem-ink-3)' }}>
              Bu cihaza gelen mesaj bildirimleri (WhatsApp, SMS, Telegram…) burada görünür;
              yanıt destekleyenlere tek dokunuşla hazır yanıt gönderebilirsiniz.
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          {messages.map((n) => (
            <div key={n.id} className="flex items-start gap-3 px-4 py-3 rounded-2xl"
              style={{ background: 'var(--oem-surface-2)', border: `1px solid ${n.isRead ? 'var(--oem-line)' : 'var(--oem-info, rgba(59,130,246,0.35))'}` }}>
              <MessageSquare className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--oem-info, #60a5fa)' }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold truncate" style={{ color: 'var(--oem-ink)' }}>{n.sender}</span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--oem-ink-3)' }}>
                    {n.appName} · {relativeTime(n.time)}
                  </span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-2)' }}>{n.text}</div>
                <MessageQuickReplies notif={n} />
              </div>
              <button
                onClick={() => (isSpeaking ? stopSpeaking() : speakNotification(n))}
                aria-label={isSpeaking ? 'Okumayı durdur' : 'Sesli oku'}
                className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 active:scale-90 transition-transform"
                style={{ background: 'var(--oem-surface-0)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-2)' }}
              >
                {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
