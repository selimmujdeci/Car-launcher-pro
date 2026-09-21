/**
 * PhoneMessagesTab — Telefon Merkezi · Mesajlar.
 *
 * ── GERÇEK VERİ KAYNAĞI, İKİNCİ SİSTEM YOK ──────────────────────────────────
 * Tek kaynak `notificationService` (category 'message') — NotificationCenter'ın
 * kullandığı AYNI otorite. İkinci bir mesaj/bildirim borusu KURULMAZ.
 *
 * ── DÜRÜSTLÜK NOTU (kod taramasıyla doğrulandı) ─────────────────────────────
 * Bu derlemede gerçek bir Android `NotificationListenerService` uygulaması
 * YOK: `MediaListenerService` yalnız `MediaSessionManager` şartını karşılamak
 * için var olan bir stub'tur ve KENDİ yorumunda "bildirimleri OKUMAZ" der;
 * native tarafta `notifyListeners("notification", …)` çağıran hiçbir kod
 * bulunamadı. Sonuç: bu ekran normalde HİÇBİR ZAMAN mesaj almaz — boş listeyi
 * "mesajın yok" diye sunmak YANILTICI olur, bu yüzden engel AÇIKÇA yazılır.
 * Gerçek veri gelirse (native taraf tamamlanırsa) bu ekran EK KOD GEREKMEDEN
 * dolmaya başlar.
 */
import { memo } from 'react';
import { MessageSquare, ShieldAlert } from 'lucide-react';
import { useNotificationState } from '../../platform/notificationService';

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
  const { notifications } = useNotificationState();
  const messages = notifications.filter((n) => n.category === 'message');

  return (
    <div data-editable="phone.messages-tab" data-editable-type="panel" className="h-full flex flex-col overflow-y-auto no-scrollbar p-4">
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--oem-warn-soft, rgba(245,158,11,0.12))', border: '1px solid var(--oem-warn, rgba(245,158,11,0.3))' }}>
            <ShieldAlert className="w-6 h-6" style={{ color: 'var(--oem-warn, #f59e0b)' }} />
          </div>
          <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>Mesajlar bu sürümde kullanılamıyor</div>
          <div className="text-xs leading-relaxed" style={{ color: 'var(--oem-ink-3)' }}>
            Mesaj gösterebilmek için Android bildirim erişimi (Bildirim Dinleyici) gerekir;
            bu cihazda henüz etkin/uygulanmış değil. Sahte veya örnek mesaj gösterilmez —
            gerçek erişim eklendiğinde bu ekran otomatik dolacak.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {messages.map((n) => (
            <div key={n.id} className="flex items-start gap-3 px-4 py-3 rounded-2xl"
              style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
              <MessageSquare className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--oem-info, #60a5fa)' }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold truncate" style={{ color: 'var(--oem-ink)' }}>{n.sender}</span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--oem-ink-3)' }}>{relativeTime(n.time)}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-2)' }}>{n.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
