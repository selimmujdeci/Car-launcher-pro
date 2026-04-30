package com.cockpitos.pro;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.WindowManager;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends BridgeActivity {

    /**
     * Zorunlu çalışma zamanı izinleri.
     * WRITE_SETTINGS ve Bildirim Erişimi BURAYA EKLENMEZ —
     * bunların kendi ayar ekranları var (plugin metotları açar).
     */
    private static final String[] REQUIRED_PERMISSIONS;

    static {
        List<String> perms = new ArrayList<>(Arrays.asList(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.CAMERA
        ));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms.add(Manifest.permission.BLUETOOTH_CONNECT);
            perms.add(Manifest.permission.BLUETOOTH_SCAN);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) { // API 33
            perms.add(Manifest.permission.READ_MEDIA_VIDEO);
            perms.add(Manifest.permission.READ_MEDIA_IMAGES);
            perms.add(Manifest.permission.POST_NOTIFICATIONS); // Bildirim izni — Kısıtlanmış ayar hatasını engeller
        } else if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }

        REQUIRED_PERMISSIONS = perms.toArray(new String[0]);
    }

    private static final String TAG = "MainActivity";

    // ── ANR Watchdog ───────────────────────────────────────────────────────
    /** WebView'ın yanıt verip vermediğini bu sürede kontrol et (ms) */
    private static final long ANR_CHECK_INTERVAL_MS = 5_000L;
    /** Bu sürede UI thread yanıt vermezse restart tetikle (ms) */
    private static final long ANR_TIMEOUT_MS        = 15_000L;

    private final Handler  anrHandler  = new Handler(Looper.getMainLooper());
    private final Handler  bgHandler   = new Handler(
        android.os.HandlerThread.class.cast(
            new android.os.HandlerThread("AnrWatchdog") {{ start(); }}
        ).getLooper()
    );
    private volatile long  lastUiPing  = 0;
    private volatile boolean anrRunning = false;

    private ActivityResultLauncher<String[]> permissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Crash durumunda uygulamayı yeniden başlat — launcher asla kapalı kalmamalı
        installCrashRecovery();
        registerPlugin(CarLauncherPlugin.class);
        super.onCreate(savedInstanceState);

        // ── Ekran ayarları ──
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applyImmersive();

        // ── İzin launcher ──
        permissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            results -> {
                // İzin sonuçlarını logla; uygulama kendi hata yönetimini yapıyor
                // "false" sonuçlar için kullanıcı SetupWizard'dan tekrar yönlendirilebilir
            }
        );

        // ── Eksik izinleri bir seferde iste ──
        requestMissingPermissions();

        // ── Foreground service'i hemen başlat ──
        // GPS start bekleme — launcher her zaman arka planda çalışmalı
        startForegroundServiceNow();

        // ── Pil optimizasyonundan muafiyet iste (MIUI/HyperOS) ──
        requestBatteryOptimizationExemption();

        // ── ANR Watchdog başlat ──
        startAnrWatchdog();
    }

    /**
     * Foreground service'i uygulama açılır açılmaz başlatır.
     * stopWithTask="false" ile uygulama arka plana alınsa bile servis çalışır.
     */
    private void startForegroundServiceNow() {
        try {
            Intent svcIntent = new Intent(this, CarLauncherForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svcIntent);
            } else {
                startService(svcIntent);
            }
        } catch (Exception ignored) {
            // Servis zaten çalışıyorsa veya başlatılamıyorsa sessizce devam et
        }
    }

    /**
     * MIUI/HyperOS ve diğer OEM'lerin agresif pil yönetimini devre dışı bırak.
     * İlk çalıştırmada sistem izin ekranı açılır.
     */
    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            }
        } catch (Exception ignored) {
            // Bazı OEM'lerde bu intent desteklenmiyor — sessizce geç
        }
    }

    /** Henüz verilmemiş izinleri toplu olarak iste. */
    private void requestMissingPermissions() {
        List<String> missing = new ArrayList<>();
        for (String perm : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, perm)
                    != PackageManager.PERMISSION_GRANTED) {
                missing.add(perm);
            }
        }
        if (!missing.isEmpty()) {
            permissionLauncher.launch(missing.toArray(new String[0]));
        }
    }

    @Override
    public void onDestroy() {
        stopAnrWatchdog();
        super.onDestroy();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyImmersive();
        // UI thread aktif — watchdog'a bildir
        lastUiPing = System.currentTimeMillis();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    public void onBackPressed() {
        // Geri basışı JS tarafına ilet — MainLayout öncelik sırasıyla handle eder:
        //   modal → panel → drawer → home (çift basış → arka plana al)
        // super.onBackPressed() çağrılmaz — launcher asla kendi kendine kapanmasın.
        getBridge().triggerWindowJSEvent("carlauncherBackButton", "{}");
    }

    /**
     * Yakalanmamış exception'larda uygulamayı 2 saniye sonra yeniden başlatır.
     * Launcher asla kapalı kalmamalı — araç gösterge paneli her zaman görünür olmalı.
     *
     * Akış:
     *   1. AlarmManager ile 2 sn sonrası için MainActivity PendingIntent kur
     *   2. Mevcut varsayılan handler'a exception'ı ilet (crash log yazılsın)
     *   3. Süreci sonlandır — Android runtime temizlenmiş süreçte yeniden başlar
     */
    private void installCrashRecovery() {
        final Context appCtx = getApplicationContext();
        final Thread.UncaughtExceptionHandler defaultHandler =
            Thread.getDefaultUncaughtExceptionHandler();

        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                Intent restart = new Intent(appCtx, MainActivity.class);
                restart.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                );

                int piFlags = PendingIntent.FLAG_ONE_SHOT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    piFlags |= PendingIntent.FLAG_IMMUTABLE;
                }

                PendingIntent pi = PendingIntent.getActivity(appCtx, 0, restart, piFlags);

                AlarmManager am = (AlarmManager) appCtx.getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    // 2 sn sonra yeniden başlat — sistem temizlenecek zamanı olsun
                    am.set(AlarmManager.RTC, System.currentTimeMillis() + 2_000L, pi);
                }
            } catch (Throwable ignored) {
                // Crash handler'ı çökertme — son çare
            }

            // Varsayılan handler → crash log (Firebase Crashlytics vb.)
            if (defaultHandler != null) {
                defaultHandler.uncaughtException(thread, throwable);
            }

            // Süreci temiz şekilde öldür
            android.os.Process.killProcess(android.os.Process.myPid());
            System.exit(1);
        });
    }

    // ── ANR Watchdog ───────────────────────────────────────────────────────

    /**
     * Background thread'den UI thread'e ping gönderir.
     * UI thread zamanında yanıt vermezse uygulamayı yeniden başlatır.
     *
     * Akış:
     *   [bgThread] → anrHandler.post(ping) → [uiThread] lastUiPing = now
     *   [bgThread] → ANR_TIMEOUT_MS sonra lastUiPing kontrol et
     *   → Eski ise → crash recovery ile restart
     */
    private void startAnrWatchdog() {
        if (anrRunning) return;
        anrRunning  = true;
        lastUiPing  = System.currentTimeMillis();

        bgHandler.post(new Runnable() {
            @Override
            public void run() {
                if (!anrRunning) return;

                // UI thread'e ping gönder
                anrHandler.post(() -> lastUiPing = System.currentTimeMillis());

                // ANR_TIMEOUT_MS sonra kontrol et
                bgHandler.postDelayed(() -> {
                    if (!anrRunning) return;
                    long elapsed = System.currentTimeMillis() - lastUiPing;
                    if (elapsed > ANR_TIMEOUT_MS) {
                        Log.e(TAG, "ANR tespit edildi (" + elapsed + "ms) — restart tetikleniyor");
                        triggerRestart();
                    } else {
                        // Bir sonraki check'i planla
                        bgHandler.postDelayed(this, ANR_CHECK_INTERVAL_MS);
                    }
                }, ANR_TIMEOUT_MS);

                bgHandler.postDelayed(this, ANR_CHECK_INTERVAL_MS);
            }
        });
    }

    private void stopAnrWatchdog() {
        anrRunning = false;
        bgHandler.removeCallbacksAndMessages(null);
        anrHandler.removeCallbacksAndMessages(null);
    }

    private void triggerRestart() {
        try {
            Context ctx = getApplicationContext();
            Intent restart = new Intent(ctx, MainActivity.class);
            restart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_ONE_SHOT |
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(ctx, 1, restart, flags);
            AlarmManager am  = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.set(AlarmManager.RTC, System.currentTimeMillis() + 1_000L, pi);
        } catch (Exception e) {
            Log.e(TAG, "Restart tetiklenemedi: " + e.getMessage());
        }
        android.os.Process.killProcess(android.os.Process.myPid());
    }

    private void applyImmersive() {
        WindowInsetsControllerCompat insets =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        insets.hide(WindowInsetsCompat.Type.systemBars());
        insets.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }
}
