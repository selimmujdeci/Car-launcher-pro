/**
 * PhoneCallsTab — Telefon Merkezi · Aramalar.
 *
 * Üç gerçek veri kaynağı:
 *  1. Numara çevirme — `phoneCallAction.callNumber()` (mevcut native CALL/DIAL yolu).
 *  2. Son aramalar   — `contactsService.getRecentContacts()`; yalnız BU EKRANDAN
 *     yapılan ve `recordCall()` ile işaretlenen aramalar (gerçek sistem CallLog
 *     erişimi bu derlemede YOK — icat edilmez, olmayan bir yetenek UYDURULMAZ).
 *  3. Gelen arama/görüşme durumu — `notificationService` (category 'call' /
 *     'missed_call'). ── DÜRÜSTLÜK NOTU: bu kaynağın native ayağı (Android
 *     NotificationListenerService), depo taramasıyla doğrulandığı üzere, bu
 *     derlemede henüz UYGULANMADI (`MediaListenerService` yalnız
 *     MediaSessionManager için var olan bir stub'tur, bildirim OKUMAZ). Bu
 *     yüzden gerçek cihazda bu bölüm normalde boş görünür — "arama yok"
 *     ile "okuyamıyoruz" KARIŞTIRILMASIN diye bu gerçek açıkça yazılır.
 */
import { memo, useState } from 'react';
import { Phone, Delete, PhoneMissed, PhoneIncoming, History } from 'lucide-react';
import { getRecentContacts, useContactsState } from '../../platform/contactsService';
import { useNotificationState } from '../../platform/notificationService';
import { callNumber } from './phoneCallAction';

const DIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  return `${Math.floor(hr / 24)} gün önce`;
}

export const PhoneCallsTab = memo(function PhoneCallsTab() {
  const [dial, setDial] = useState('');
  // Rehber değişince (favori/son arama güncellemesi) liste tazelensin diye
  // abone olunur — asıl veri `getRecentContacts()`ten okunur.
  useContactsState();
  const recent = getRecentContacts(6);
  const { notifications } = useNotificationState();
  const callNotifs = notifications
    .filter((n) => n.category === 'call' || n.category === 'missed_call')
    .slice(0, 5);

  return (
    <div data-editable="phone.calls-tab" data-editable-type="panel" className="h-full flex flex-col overflow-y-auto no-scrollbar">

      {/* Gelen arama / görüşme durumu */}
      <div className="flex-shrink-0 p-4 pb-2">
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>
          Gelen Arama / Görüşme Durumu
        </div>
        {callNotifs.length === 0 ? (
          <div className="rounded-2xl px-4 py-3 text-xs leading-relaxed"
            style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-3)' }}>
            Şu an bildirilen bir arama yok. Bu cihazda bildirim yansıtma (gelen arama/mesaj
            için Android Bildirim Dinleyici erişimi) bu sürümde etkin değil — gerçek destek
            eklendiğinde bu alan otomatik dolacak.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {callNotifs.map((n) => (
              <div key={n.id} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl"
                style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
                {n.category === 'missed_call'
                  ? <PhoneMissed className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-danger, #ef4444)' }} />
                  : <PhoneIncoming className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-good, #22c55e)' }} />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate" style={{ color: 'var(--oem-ink)' }}>{n.sender}</div>
                  <div className="text-[11px]" style={{ color: 'var(--oem-ink-3)' }}>{relativeTime(n.time)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Numara çevirme */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>
          Numara Çevir
        </div>
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-3"
          style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
          <input
            type="tel"
            value={dial}
            onChange={(e) => setDial(e.target.value.replace(/[^\d+*#]/g, ''))}
            placeholder="Numara girin…"
            className="flex-1 bg-transparent text-lg font-bold tracking-wider outline-none"
            style={{ color: 'var(--oem-ink)' }}
          />
          {dial && (
            <button onClick={() => setDial((d) => d.slice(0, -1))} aria-label="Sil"
              style={{ color: 'var(--oem-ink-3)' }}>
              <Delete className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {DIAL_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setDial((d) => d + k)}
              className="py-3 rounded-2xl text-lg font-bold active:scale-95 transition-transform"
              style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink)' }}
            >
              {k}
            </button>
          ))}
        </div>
        <button
          onClick={() => { if (dial.trim()) { callNumber(dial); setDial(''); } }}
          disabled={!dial.trim()}
          className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm active:scale-[0.98] transition-transform disabled:opacity-40"
          style={{ background: 'var(--oem-good, #22c55e)', color: '#0B0F14' }}
        >
          <Phone className="w-4 h-4" /> Ara
        </button>
      </div>

      {/* Son aramalar */}
      <div className="flex-1 px-4 pb-4">
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1 flex items-center gap-1.5" style={{ color: 'var(--oem-ink-3)' }}>
          <History className="w-3 h-3" /> Son Aramalar
        </div>
        {recent.length === 0 ? (
          <div className="text-xs text-center py-6" style={{ color: 'var(--oem-ink-3)' }}>
            Bu ekrandan henüz arama yapılmadı.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recent.map((c) => (
              <button
                key={c.id}
                onClick={() => callNumber(c.phones[0]?.number ?? '', c.id)}
                className="flex items-center gap-3 px-4 py-2.5 rounded-2xl w-full text-left active:scale-[0.98] transition-transform"
                style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}
              >
                <Phone className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-info, #60a5fa)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate" style={{ color: 'var(--oem-ink)' }}>{c.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--oem-ink-3)' }}>
                    {c.lastCalled != null ? relativeTime(c.lastCalled) : '—'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
