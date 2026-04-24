package com.cockpitos.pro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

/**
 * CarLauncherForegroundService — arka plan GPS + mola hatırlatıcısı.
 *
 * Uygulama minimize edildiğinde:
 *   • LocationManager aracılığıyla GPS/Network konum güncellemelerini alır
 *   • CarLauncherPlugin'e geri dönüş (callback) mekanizmasıyla konum gönderir
 *   • Sürüş süresini takip eder — BREAK_INTERVAL_MS geçince breakCallback tetiklenir
 *   • Persistent bildirim gösterir (Android foreground service zorunluluğu)
 *   • START_STICKY: sistem sonlandırırsa otomatik yeniden başlatılır
 */
public class CarLauncherForegroundService extends Service {

    // ── Sabitler ───────────────────────────────────────────────────────────

    public static final String CHANNEL_ID = "cockpitos_bg";
    static final int           NOTIF_ID   = 101;

    /** GPS güncelleme aralığı (ms) */
    private static final long  GPS_INTERVAL_MS    = 3_000L;
    /** GPS minimum hareket (metre) */
    private static final float GPS_MIN_DIST_M     = 5f;
    /** Araç "hareket ediyor" eşiği (km/h) */
    private static final float MOVING_KMH         = 5f;
    /** Bu süre hareketsiz kalınca sürüş sayacı sıfırlanır (ms) */
    private static final long  PARKED_TIMEOUT_MS  = 5 * 60_000L;
    /** Mola hatırlatma aralığı (ms) */
    private static final long  BREAK_INTERVAL_MS  = 120 * 60_000L;

    // ── Singleton ve callback'ler ──────────────────────────────────────────

    /** Plugin'in erişmesi için singleton referans */
    public static volatile CarLauncherForegroundService instance = null;

    /** Dashcam kaydı aktif mi? CarLauncherPlugin.setDashcamActive() ile güncellenir. */
    private static volatile boolean sDashcamRecording = false;

    /** Bildirim güncelleme sayacı — her konumda değil 5'te bir güncelle */
    private int notifCounter = 0;

    /** Dashcam kayıt durumunu foreground servise bildir. */
    public static void setDashcamRecording(boolean active) {
        sDashcamRecording = active;
    }

    public interface LocationCallback {
        void onLocation(double lat, double lng, float speedKmh, float bearing, float accuracy);
    }

    public interface BreakCallback {
        void onBreakReminder(long drivingMinutes);
    }

    private static volatile LocationCallback sLocationCallback;
    private static volatile BreakCallback    sBreakCallback;

    /**
     * Plugin bu metodu çağırarak callback'leri kaydeder.
     * Thread-safe: volatile alanlar.
     */
    public static void setCallbacks(LocationCallback lc, BreakCallback bc) {
        sLocationCallback = lc;
        sBreakCallback    = bc;
    }

    // ── Servis durumu ──────────────────────────────────────────────────────

    private LocationManager  locationManager;
    private LocationListener locationListener;

    private long drivingStartMs = 0;
    private long lastMovingMs   = 0;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ── Lifecycle ──────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        startForeground(NOTIF_ID, buildNotification("GPS takibi aktif"));
        startLocationUpdates();
        scheduleBreakCheck();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // START_STICKY: sistem servisi öldürürse Intent=null ile yeniden başlat
        // Foreground bildirim yeniden oluşturulur — GPS takibi devam eder
        startForeground(NOTIF_ID, buildNotification("GPS takibi aktif"));
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // Bağlı servis değil
    }

    @Override
    public void onDestroy() {
        instance = null;
        stopLocationUpdates();
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    // ── Konum güncellemeleri ───────────────────────────────────────────────

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                float speedKmh = loc.getSpeed() * 3.6f;
                updateDrivingState(speedKmh);

                LocationCallback cb = sLocationCallback;
                if (cb != null) {
                    cb.onLocation(
                        loc.getLatitude(),
                        loc.getLongitude(),
                        speedKmh,
                        loc.getBearing(),
                        loc.getAccuracy()
                    );
                }

                // 5 konum güncellemesinde bir bildirimi yenile
                if (++notifCounter % 5 == 0) {
                    String txt = sDashcamRecording
                        ? String.format("GPS %.0f km/h • Dashcam kaydı", speedKmh)
                        : String.format("GPS takibi aktif • %.0f km/h", speedKmh);
                    updateNotification(txt);
                }
            }

            // API 29 ve altı için gerekli override'lar
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
        };

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    GPS_INTERVAL_MS,
                    GPS_MIN_DIST_M,
                    locationListener,
                    Looper.getMainLooper()
                );
            }
            // Ağ konumu — GPS sinyali zayıfken yedek kaynak
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    10_000L,
                    50f,
                    locationListener,
                    Looper.getMainLooper()
                );
            }
        } catch (SecurityException ignored) {
            // İzin henüz verilmemişse sessizce atla
        }
    }

    private void stopLocationUpdates() {
        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException ignored) {}
        }
    }

    // ── Sürüş süresi takibi ───────────────────────────────────────────────

    private void updateDrivingState(float speedKmh) {
        long now = System.currentTimeMillis();

        if (speedKmh >= MOVING_KMH) {
            if (drivingStartMs == 0) drivingStartMs = now;
            lastMovingMs = now;
        } else if (drivingStartMs > 0) {
            // 5 dakika hareketsiz → sayacı sıfırla
            if ((now - lastMovingMs) > PARKED_TIMEOUT_MS) {
                drivingStartMs = 0;
                lastMovingMs   = 0;
            }
        }
    }

    /** Dakikada bir mola kontrolü yapar. */
    private void scheduleBreakCheck() {
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (drivingStartMs > 0) {
                    long elapsed = System.currentTimeMillis() - drivingStartMs;
                    if (elapsed >= BREAK_INTERVAL_MS) {
                        BreakCallback cb = sBreakCallback;
                        if (cb != null) cb.onBreakReminder(elapsed / 60_000L);
                    }
                }
                mainHandler.postDelayed(this, 60_000L);
            }
        }, 60_000L);
    }

    // ── Bildirim ───────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Arka Plan Konum Servisi",
                NotificationManager.IMPORTANCE_LOW
            );
            ch.setDescription("CockpitOS arka plan GPS takibi");
            ch.setShowBadge(false);
            ch.enableLights(false);
            ch.enableVibration(false);

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    Notification buildNotification(String text) {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT |
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CockpitOS")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /** Bildirim metnini güncelle (örn. sürüş süresi) */
    public void updateNotification(String text) {
        NotificationManager nm =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(text));
    }
}
