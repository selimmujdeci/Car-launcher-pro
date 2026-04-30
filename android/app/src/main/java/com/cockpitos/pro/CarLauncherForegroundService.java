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
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.cockpitos.pro.can.CanBusManager;
import com.cockpitos.pro.can.McuCommandFactory;

/**
 * CarLauncherForegroundService — arka plan GPS + mola hatırlatıcısı.
 *
 * T-5 Hardening eklemeleri:
 *   • wakeUp()          — 30s IMPORTANCE_HIGH moduna geç, sonra LOW'a dön
 *   • Native Heartbeat  — WebView ölünce HttpURLConnection ile Supabase'e GPS gönder
 *   • GPS Buffer        — çevrimdışıyken konumları tampon'a al, bağlantı gelince boşalt
 *   • Android 12+       — ForegroundServiceType uyumluluğu
 */
public class CarLauncherForegroundService extends Service {

    private static final String TAG = "CLFgService";

    // ── Bildirim kanalları ─────────────────────────────────────────────────
    public static final String CHANNEL_ID      = "cockpitos_bg";   // IMPORTANCE_LOW (normal)
    private static final String CHANNEL_WAKE   = "cockpitos_wake"; // IMPORTANCE_HIGH (wake)
    static final int            NOTIF_ID       = 101;

    // ── GPS sabitleri ──────────────────────────────────────────────────────
    private static final long  GPS_INTERVAL_MS   = 1_000L;   // 1s — anlık km takibi
    private static final float GPS_MIN_DIST_M    = 2f;       // 2m minimum hareket
    private static final float MOVING_KMH        = 5f;
    private static final long  PARKED_TIMEOUT_MS = 5 * 60_000L;
    private static final long  BREAK_INTERVAL_MS = 120 * 60_000L;

    // ── Wake-up sabitleri ──────────────────────────────────────────────────
    /** JS tarafının servis uyandırma süresi (ms) */
    private static final long  WAKE_DURATION_MS  = 30_000L;

    // ── Genel veri tamponu (çevrimdışı) ──────────────────────────────────────
    // GPS konumları + JS tarafından emanet edilen JSON bloklar birlikte tutulur.
    private static final int DATA_BUFFER_MAX = 200;

    /** GPS konum tamponu: [ lat, lng, speedKmh, timestampMs ] */
    private final ArrayDeque<double[]>  gpsBuffer  = new ArrayDeque<>();

    /** Genel JSON tamponu: JS'den gelen herhangi bir veri bloğu */
    private final ArrayDeque<String>    dataBuffer = new ArrayDeque<>();

    // ── Singleton ve callback'ler ──────────────────────────────────────────
    public static volatile CarLauncherForegroundService instance = null;
    private static volatile boolean sDashcamRecording            = false;
    private int notifCounter = 0;
    private boolean isHighPriority = false;

    public static void setDashcamRecording(boolean active) { sDashcamRecording = active; }

    public interface LocationCallback {
        void onLocation(double lat, double lng, float speedKmh, float bearing, float accuracy);
    }
    public interface BreakCallback {
        void onBreakReminder(long drivingMinutes);
    }

    private static volatile LocationCallback sLocationCallback;
    private static volatile BreakCallback    sBreakCallback;

    public static void setCallbacks(LocationCallback lc, BreakCallback bc) {
        sLocationCallback = lc;
        sBreakCallback    = bc;
    }

    // ── Servis durumu ──────────────────────────────────────────────────────
    private LocationManager  locationManager;
    private LocationListener locationListener;
    private long drivingStartMs = 0;
    private long lastMovingMs   = 0;

    private final Handler        mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService netExecutor = Executors.newSingleThreadExecutor();

    // ── MCU Watchdog ───────────────────────────────────────────────────────
    /** 1 saniyelik heartbeat aralığı */
    private static final long WATCHDOG_INTERVAL_MS = 1_000L;
    /** CanBusManager referansı — plugin başlatınca inject edilir */
    private static volatile CanBusManager sCanBusManager = null;
    private final Runnable watchdogRunnable = this::sendHeartbeat;

    public static void setCanBusManager(CanBusManager mgr) {
        sCanBusManager = mgr;
    }

    /** H-4: CommandService.java'nın singleton erişimi için */
    public static CarLauncherForegroundService getInstance() {
        return instance;
    }

    /** H-4: CommandService.java'nın MCU komut göndermesi için */
    public static CanBusManager getCanBusManager() {
        return sCanBusManager;
    }

    // Supabase native heartbeat — sadece WebView ölünce kullanılır
    private static volatile String sSupabaseUrl  = null;
    private static volatile String sSupabaseKey  = null;
    private static volatile String sVehicleId    = null;

    public static void setSupabaseConfig(String url, String anonKey, String vehicleId) {
        sSupabaseUrl = url;
        sSupabaseKey = anonKey;
        sVehicleId   = vehicleId;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannels();
        startForeground(NOTIF_ID, buildNotification("GPS takibi aktif", false));
        startLocationUpdates();
        scheduleBreakCheck();
        startWatchdog();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIF_ID, buildNotification("GPS takibi aktif", false));
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        instance = null;
        stopWatchdog();
        stopLocationUpdates();
        mainHandler.removeCallbacksAndMessages(null);
        netExecutor.shutdown();
        super.onDestroy();
    }

    // ── Wake-Up: 30s IMPORTANCE_HIGH → IMPORTANCE_LOW ─────────────────────

    /**
     * JS tarafından veya FCM push geldiğinde çağrılır.
     * Servisi 30 saniye yüksek öncelikli moda çeker (Android Doze'u atlar),
     * sonra otomatik olarak düşük önceliğe döner (CPU tasarrufu).
     */
    public void wakeUp() {
        if (isHighPriority) {
            // Zaten uyanık — timer'ı sıfırla
            mainHandler.removeCallbacksAndMessages("wake_down");
        } else {
            isHighPriority = true;
            // IMPORTANCE_HIGH bildirimiyle foreground'u güncelle
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification("Komut alındı — işleniyor…", true));
            Log.d(TAG, "wakeUp: IMPORTANCE_HIGH moda geçildi");
        }

        // 30s sonra LOW'a dön
        Runnable wakeDown = () -> {
            isHighPriority = false;
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification("GPS takibi aktif", false));
            Log.d(TAG, "wakeDown: IMPORTANCE_LOW moduna döndü");
        };
        mainHandler.postDelayed(wakeDown, WAKE_DURATION_MS);
    }

    // ── MCU Watchdog Heartbeat ─────────────────────────────────────────────

    /**
     * 1 Hz heartbeat döngüsünü başlatır.
     * Seri port kapalıysa silent fail — port açılınca heartbeat otomatik gider.
     * Native katman donarsa heartbeat kesilir → MCU Safe Mode'a girer.
     */
    private void startWatchdog() {
        mainHandler.postDelayed(watchdogRunnable, WATCHDOG_INTERVAL_MS);
        Log.d(TAG, "MCU watchdog başlatıldı (1Hz heartbeat)");
    }

    private void stopWatchdog() {
        mainHandler.removeCallbacks(watchdogRunnable);
        Log.d(TAG, "MCU watchdog durduruldu");
    }

    private void sendHeartbeat() {
        if (!_alive()) {
            stopWatchdog();
            return;
        }

        CanBusManager mgr = sCanBusManager;
        if (mgr != null) {
            byte[] packet = McuCommandFactory.heartbeat();
            if (packet != null) {
                boolean sent = mgr.sendCommand(packet);
                // Silent operation: sadece verbose seviyede log
                if (sent) Log.v(TAG, "Heartbeat gönderildi");
                // Sessiz fail: gönderilmese bile sistemi durdurmaz
            }
        }
        // Her 1 saniyede bir tekrarla
        mainHandler.postDelayed(watchdogRunnable, WATCHDOG_INTERVAL_MS);
    }

    /** Servisin hâlâ aktif olup olmadığını kontrol eder. */
    private boolean _alive() { return instance != null; }

    // ── Konum güncellemeleri ───────────────────────────────────────────────

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location loc) {
                float speedKmh = loc.getSpeed() * 3.6f;
                updateDrivingState(speedKmh);

                LocationCallback cb = sLocationCallback;
                if (cb != null) {
                    // WebView aktif — normal yol
                    cb.onLocation(loc.getLatitude(), loc.getLongitude(),
                                  speedKmh, loc.getBearing(), loc.getAccuracy());
                } else {
                    // WebView ölü — native heartbeat
                    nativeHeartbeat(loc.getLatitude(), loc.getLongitude(), speedKmh);
                }

                if (++notifCounter % 5 == 0) {
                    String txt = sDashcamRecording
                        ? String.format("GPS %.0f km/h • Dashcam kaydı", speedKmh)
                        : String.format("GPS takibi aktif • %.0f km/h", speedKmh);
                    updateNotification(txt);
                }
            }

            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(@NonNull String provider) {}
            @Override public void onProviderDisabled(@NonNull String provider) {}
        };

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, GPS_INTERVAL_MS, GPS_MIN_DIST_M,
                    locationListener, Looper.getMainLooper());
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 10_000L, 50f,
                    locationListener, Looper.getMainLooper());
            }
        } catch (SecurityException ignored) {}
    }

    private void stopLocationUpdates() {
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); }
            catch (SecurityException ignored) {}
        }
    }

    // ── Native Heartbeat (WebView ölünce) ──────────────────────────────────

    /**
     * WebView aktif değilken GPS konumunu Supabase'e doğrudan HTTP ile iletir.
     * Çevrimdışıysa tampona alır, bağlantı gelince boşaltır.
     */
    /**
     * JS tarafından çevrimdışı veri emanet etmek için kullanılır.
     * Bağlantı gelince connectivityService (JS) bu tamponu okur ve gönderir.
     */
    public void enqueueData(String jsonPayload) {
        synchronized (dataBuffer) {
            if (dataBuffer.size() >= DATA_BUFFER_MAX) dataBuffer.pollFirst();
            dataBuffer.addLast(jsonPayload);
        }
        Log.d(TAG, "dataBuffer: " + dataBuffer.size() + " öğe");
    }

    /** Tampondaki tüm öğeleri alır ve tamponu temizler (JS drain için). */
    public String[] drainDataBuffer() {
        synchronized (dataBuffer) {
            String[] arr = dataBuffer.toArray(new String[0]);
            dataBuffer.clear();
            return arr;
        }
    }

    private void nativeHeartbeat(double lat, double lng, float speedKmh) {
        if (sSupabaseUrl == null || sVehicleId == null) return;

        double[] point = { lat, lng, speedKmh, System.currentTimeMillis() };

        if (!isOnline()) {
            // Çevrimdışı — GPS tamponuna al
            synchronized (gpsBuffer) {
                if (gpsBuffer.size() >= DATA_BUFFER_MAX) gpsBuffer.pollFirst();
                gpsBuffer.addLast(point);
            }
            return;
        }

        // GPS tamponunu boşalt
        drainGpsBuffer();

        // Mevcut konumu gönder
        sendLocationToSupabase(lat, lng, speedKmh);
    }

    private void drainGpsBuffer() {
        synchronized (gpsBuffer) {
            while (!gpsBuffer.isEmpty() && isOnline()) {
                double[] p = gpsBuffer.pollFirst();
                if (p != null) sendLocationToSupabase(p[0], p[1], (float) p[2]);
            }
        }
    }

    private void sendLocationToSupabase(double lat, double lng, float speedKmh) {
        if (sSupabaseUrl == null || sSupabaseKey == null || sVehicleId == null) return;

        netExecutor.execute(() -> {
            try {
                URL url = new URL(sSupabaseUrl + "/rest/v1/vehicle_locations");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("apikey", sSupabaseKey);
                conn.setRequestProperty("Authorization", "Bearer " + sSupabaseKey);
                conn.setRequestProperty("Prefer", "return=minimal");
                conn.setConnectTimeout(5_000);
                conn.setReadTimeout(5_000);
                conn.setDoOutput(true);

                String body = String.format(
                    "{\"vehicle_id\":\"%s\",\"lat\":%.7f,\"lng\":%.7f}",
                    sVehicleId, lat, lng
                );

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                conn.disconnect();
                if (code < 300) Log.d(TAG, "Native heartbeat gönderildi: " + code);
                else Log.w(TAG, "Native heartbeat hatası: " + code);
            } catch (Exception e) {
                Log.w(TAG, "Native heartbeat exception: " + e.getMessage());
            }
        });
    }

    private boolean isOnline() {
        try {
            ConnectivityManager cm =
                (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Exception e) { return false; }
    }

    // ── Sürüş süresi takibi ───────────────────────────────────────────────

    private void updateDrivingState(float speedKmh) {
        long now = System.currentTimeMillis();
        if (speedKmh >= MOVING_KMH) {
            if (drivingStartMs == 0) drivingStartMs = now;
            lastMovingMs = now;
        } else if (drivingStartMs > 0) {
            if ((now - lastMovingMs) > PARKED_TIMEOUT_MS) {
                drivingStartMs = 0;
                lastMovingMs   = 0;
            }
        }
    }

    private void scheduleBreakCheck() {
        mainHandler.postDelayed(new Runnable() {
            @Override public void run() {
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

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            // Normal kanal (IMPORTANCE_LOW) — sürekli çalışırken
            NotificationChannel low = new NotificationChannel(
                CHANNEL_ID, "Arka Plan Konum Servisi", NotificationManager.IMPORTANCE_LOW);
            low.setDescription("Caros Pro arka plan GPS takibi");
            low.setShowBadge(false);
            low.enableLights(false);
            low.enableVibration(false);
            nm.createNotificationChannel(low);

            // Wake kanalı (IMPORTANCE_HIGH) — komut alındığında
            NotificationChannel high = new NotificationChannel(
                CHANNEL_WAKE, "Komut Uyandırma", NotificationManager.IMPORTANCE_HIGH);
            high.setDescription("Uzak komut alındığında kısa süre aktif");
            high.setShowBadge(false);
            high.enableVibration(false);
            nm.createNotificationChannel(high);
        }
    }

    Notification buildNotification(String text, boolean highPriority) {
        String channel = highPriority ? CHANNEL_WAKE : CHANNEL_ID;
        int priority   = highPriority
            ? NotificationCompat.PRIORITY_HIGH
            : NotificationCompat.PRIORITY_LOW;

        Intent openApp = new Intent(this, MainActivity.class);
        openApp.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT |
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        return new NotificationCompat.Builder(this, channel)
            .setContentTitle("Caros Pro")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(!highPriority)
            .setPriority(priority)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    // Geriye dönük uyumluluk — highPriority=false varsayılan
    Notification buildNotification(String text) {
        return buildNotification(text, false);
    }

    public void updateNotification(String text) {
        NotificationManager nm =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(text, isHighPriority));
    }
}
