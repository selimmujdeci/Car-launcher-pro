/**
 * NotificationAccessCard — Telefon Merkezi · bildirim erişimi durumu.
 *
 * Arama/mesaj aktarımı CarOS'un Android "Bildirim erişimi" iznine bağlıdır
 * (companion uygulaması GEREKMEZ). Durum ÖLÇÜLÜR (`refreshNotificationAccess`);
 * `null` = ölçülemedi (eski sürüm) ve "izin var" varsayılmaz. Kullanıcı sistem
 * sayfasından döndüğünde durum yeniden ölçülür.
 */
import { memo, useEffect } from 'react';
import { BellRing, Settings } from 'lucide-react';
import { refreshNotificationAccess, openNotificationAccessSettings } from '../../platform/notificationService';

export const NotificationAccessCard = memo(function NotificationAccessCard({ hasPermission, listenerConnected = null }: {
  hasPermission: boolean | null;
  /** İzin açıkken servis bağlı değilse (`false`) ayrı uyarı gösterilir. */
  listenerConnected?: boolean | null;
}) {
  useEffect(() => {
    void refreshNotificationAccess();
    const recheck = () => { if (document.visibilityState === 'visible') void refreshNotificationAccess(); };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, []);

  const notBound = hasPermission === true && listenerConnected === false;
  if (hasPermission === true && !notBound) return null;

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--oem-warn-soft, rgba(245,158,11,0.10))', border: '1px solid var(--oem-warn, rgba(245,158,11,0.35))' }}>
      <div className="flex items-start gap-3">
        <BellRing className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--oem-warn, #f59e0b)' }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>
            {notBound ? 'Bildirim servisi bağlanamadı'
              : hasPermission === false ? 'Bildirim erişimi kapalı' : 'Bildirim erişimi ölçülemedi'}
          </div>
          <div className="text-xs leading-relaxed mt-1" style={{ color: 'var(--oem-ink-3)' }}>
            {notBound
              ? <>Erişim açık ama sistem CarOS'un bildirim servisini başlatmadı; arama ve mesajlar
                  şu an GELMİYOR. Xiaomi/MIUI'de CarOS için "Otomatik başlatma" iznini açın ya da
                  aşağıdaki sayfada CarOS'u kapatıp yeniden açın.</>
              : <>Gelen arama ve mesajları göstermek, cevaplamak ve yanıtlamak için CarOS'a
                  bildirim erişimi verin. Açılan sayfada CarOS'u etkinleştirip geri dönün.</>}
          </div>
        </div>
      </div>
      <button
        onClick={() => void openNotificationAccessSettings()}
        className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-transform"
        style={{ background: 'var(--oem-warn, #f59e0b)', color: '#0B0F14' }}
      >
        <Settings className="w-3.5 h-3.5" /> {notBound ? 'Erişim ayarlarını aç' : 'Erişim ver'}
      </button>
    </div>
  );
});
