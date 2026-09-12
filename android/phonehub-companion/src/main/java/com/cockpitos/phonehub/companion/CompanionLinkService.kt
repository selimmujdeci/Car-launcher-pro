package com.cockpitos.phonehub.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * CompanionLinkService — bağlantıyı ekran kapalıyken ayakta tutan ön plan
 * servisi (GÖREV 11).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Android, uygulama arka plana düştüğünde süreci ve iş parçacıklarını
 * durdurabilir. Kullanıcı telefonunu cebine koyduğunda CAROS bağlantısının
 * kopması kabul edilemez bir davranış olurdu. Ön plan servisi bunu, kullanıcıya
 * GÖRÜNÜR bir bildirimle ve iptal edilebilir biçimde çözer.
 *
 * ── NE ZAMAN ÇALIŞMAZ ───────────────────────────────────────────────────────
 * Kullanıcı bağlantıyı kesince · kalıcı hata oluşunca · izin reddedilince ·
 * Bluetooth kapalıyken. "Her ihtimale karşı açık kalsın" YOKTUR: gereksiz
 * çalışan bir ön plan servisi pil tüketir ve kullanıcıya rahatsız edici bir
 * kalıcı bildirim gösterir.
 *
 * ── SÜREÇ ÖLÜP DİRİLİRSE ────────────────────────────────────────────────────
 * {@code START_NOT_STICKY}: sistem servisi kendiliğinden diriltmez. Geri
 * yüklenen bir oturum "bağlı" SAYILMAZ; yeniden bağlanma yalnız kullanıcı
 * isteğiyle veya kontrollü politika ile başlar.
 */
class CompanionLinkService : Service() {

    companion object {
        private const val CHANNEL_ID = "phonehub.link"
        private const val NOTIFICATION_ID = 4711

        const val ACTION_START = "com.cockpitos.phonehub.companion.START"
        const val ACTION_DISCONNECT = "com.cockpitos.phonehub.companion.DISCONNECT"

        fun start(context: Context) {
            val intent = Intent(context, CompanionLinkService::class.java)
                .setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CompanionLinkService::class.java))
        }
    }

    private val controller: CompanionLinkController
        get() = CompanionLinkController.get(this, appVersion())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISCONNECT -> {
                /* Bildirimden kesme: kullanıcı KARARI — yeniden bağlanma yok. */
                controller.disconnectByUser()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> startInForeground()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        controller.setForegroundServiceRunning(false)
        super.onDestroy()
    }

    /**
     * Ön plana geçiş. Android 14+ servis TİPİ zorunludur ve yanlış tip
     * çalışma zamanında istisna fırlatır; {@code connectedDevice} bu bağlantı
     * için doğru tiptir.
     */
    private fun startInForeground() {
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            controller.setForegroundServiceRunning(true)
        } catch (e: Exception) {
            /* Ön plana geçilemezse SESSİZ KALINMAZ: durum kullanıcıya
             * yansıtılır ve servis kendini kapatır (yarı çalışan bir servis
             * en kötü durumdur). */
            controller.setForegroundServiceRunning(false)
            stopSelf()
        }
    }

    private fun buildNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, CompanionActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE)

        val disconnectIntent = PendingIntent.getService(
            this, 1,
            Intent(this, CompanionLinkService::class.java).setAction(ACTION_DISCONNECT),
            PendingIntent.FLAG_IMMUTABLE)

        val view = controller.currentView()

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle(getString(R.string.notification_title))
            /* Durum metni PII taşımaz — yalnız bağlantı durumu. */
            .setContentText(view.state.label)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(
                null,
                getString(R.string.notification_action_disconnect),
                disconnectIntent).build())
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.notification_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun appVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }
}
