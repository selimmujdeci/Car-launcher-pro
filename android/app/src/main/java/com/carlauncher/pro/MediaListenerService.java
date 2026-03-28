package com.carlauncher.pro;

import android.service.notification.NotificationListenerService;

/**
 * MediaListenerService — NotificationListenerService stub.
 *
 * Amacı:
 *   Android, MediaSessionManager.getActiveSessions() çağrısına izin vermek için
 *   uygulamanın aktif bir NotificationListenerService'e sahip olmasını şart koşar.
 *   Bu servis o şartı karşılar.
 *
 * Kullanım:
 *   1. Kullanıcı Ayarlar → Bildirim Erişimi → Car Launcher Pro'yu etkinleştirir.
 *   2. Android bu servisi bağlar (instance != null olur).
 *   3. CarLauncherPlugin, getMediaInfo() çağrısında instance üzerinden
 *      ComponentName'i MediaSessionManager'a verir.
 *
 * NOT: Bu servis bildirimleri OKUMAZ. Sadece MediaSessionManager'a
 * "güvenilir bileşen" kaydı için var.
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
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }
}
