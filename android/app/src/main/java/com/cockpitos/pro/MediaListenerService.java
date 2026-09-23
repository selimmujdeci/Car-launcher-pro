package com.cockpitos.pro;

import android.service.notification.NotificationListenerService;

import com.cockpitos.pro.media.MediaManager;

/**
 * MediaListenerService — NotificationListenerService stub.
 *
 * Amacı:
 *   Android, MediaSessionManager.getActiveSessions() çağrısına izin vermek için
 *   uygulamanın aktif bir NotificationListenerService'e sahip olmasını şart koşar.
 *   Bu servis o şartı karşılar.
 *
 * Kullanım:
 *   1. Kullanıcı Ayarlar → Bildirim Erişimi → CockpitOS'u etkinleştirir.
 *   2. Android bu servisi bağlar (instance != null olur).
 *   3. CarLauncherPlugin, getMediaInfo() çağrısında instance üzerinden
 *      ComponentName'i MediaSessionManager'a verir.
 *
 * Telefon Merkezi (2026-09-23): AYNI izinle arama · cevapsız arama · mesaj
 * bildirimleri {@link com.cockpitos.pro.notify.NotificationMirror} üzerinden JS'e
 * aktarılır (diğer kategoriler aktarılmaz, içerik loglanmaz/diske yazılmaz).
 * Yeni izin ya da ikinci bir dinleyici servisi KURULMADI.
 */
public class MediaListenerService extends NotificationListenerService {

    /**
     * CarLauncherPlugin'in MediaSessionManager.getActiveSessions() çağrısı için
     * kullandığı singleton referans.
     * volatile: plugin ve sistem thread'leri arasında güvenli görünürlük.
     */
    public static volatile MediaListenerService instance = null;

    @Override
    public void onListenerConnected() {
        instance = this;
        replayActiveCalls();
        // Plugin yüklüyse, OnActiveSessionsChangedListener'ı şimdi attach et —
        // böylece müzik halihazırda çalıyorsa anında metadata UI'a düşer.
        try { MediaManager.getInstance(this).attachMediaSessionsListener(); } catch (Throwable ignored) {}
    }

    /**
     * Uygulama bir görüşme sırasında (yeniden) başladıysa süren arama kartı
     * kaybolmasın: YALNIZ aktif arama bildirimleri yeniden aktarılır — eski
     * mesajlar tekrar okunmasın diye mesajlar replay EDİLMEZ. JS dinleyicisi
     * kurulduktan sonra da çağrılır (servis ondan önce bağlanmış olabilir).
     */
    public void replayActiveCalls() {
        try {
            android.service.notification.StatusBarNotification[] active = getActiveNotifications();
            if (active != null) {
                for (android.service.notification.StatusBarNotification sbn : active) {
                    android.app.Notification n = sbn.getNotification();
                    if (n != null && android.app.Notification.CATEGORY_CALL.equals(n.category)) {
                        com.cockpitos.pro.notify.NotificationMirror.onPosted(sbn, getPackageManager(), getPackageName());
                    }
                }
            }
        } catch (Throwable ignored) {}
    }

    @Override
    public void onNotificationPosted(android.service.notification.StatusBarNotification sbn) {
        com.cockpitos.pro.notify.NotificationMirror.onPosted(sbn, getPackageManager(), getPackageName());
    }

    @Override
    public void onNotificationRemoved(android.service.notification.StatusBarNotification sbn) {
        com.cockpitos.pro.notify.NotificationMirror.onRemoved(sbn);
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
        try { MediaManager.getInstance(this).detachMediaSessionsListener(); } catch (Throwable ignored) {}
    }

    @Override
    public void onDestroy() {
        instance = null;
        try { MediaManager.getInstance(this).detachMediaSessionsListener(); } catch (Throwable ignored) {}
        super.onDestroy();
    }
}
