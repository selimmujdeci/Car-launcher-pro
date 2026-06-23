package com.cockpitos.pro;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.content.ComponentCallbacks2;
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

    /**
     * ANR watchdog tick — TEK seferlik kendini yeniden planlar (callback çoğalması YOK).
     * Eski sürümde her tick hem bir gecikmeli "check" hem kendini planlıyor, check de
     * tekrar planlıyordu → pending callback sayısı katlanarak büyüyor, AnrWatchdog thread'i
     * giderek artan CPU yakıp cihazı ısıtıyordu. Bu Runnable döngü başına TAM 1 sonraki
     * tick planlar.
     */
    private final Runnable anrTick = new Runnable() {
        @Override
        public void run() {
            if (!anrRunning) return;

            // UI thread önceki ping'i işledi mi? İşlemediyse lastUiPing eskir, elapsed büyür.
            long elapsed = System.currentTimeMillis() - lastUiPing;
            if (elapsed > ANR_TIMEOUT_MS) {
                Log.e(TAG, "ANR tespit edildi (" + elapsed + "ms) — restart tetikleniyor");
                triggerRestart();
                return; // restart yolu — yeniden planlama yok
            }

            // UI thread'e taze ping gönder (yanıt verirse lastUiPing güncellenir).
            anrHandler.post(() -> lastUiPing = System.currentTimeMillis());

            // Bir sonraki kontrolü TEK SEFER planla.
            bgHandler.postDelayed(this, ANR_CHECK_INTERVAL_MS);
        }
    };

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

        // ── Head unit yatay rotasyon kilidi ──
        // K24/NWD paneli fiziksel YATAY ama Android display'i 720x1280 DİKEY raporluyor ve
        // OEM manifest screenOrientation'ı (sensorLandscape) YOKSAYIYOR. ROM her boot'ta
        // otomatik-döndürmeyi sıfırlıyor → app açılışta sistem rotasyonunu YATAY'a kendisi kilitler.
        // (Saha doğrulaması 2026-06-14: accelerometer_rotation=0 + user_rotation=90 ile CarOS Pro
        // düz yatay görünüyor — kullanıcı teyit etti. Eski WebView setRotation hack'i kaldırıldı.)
        applyHeadUnitLandscapeRotation();

        // ── NWD CAN bilgi yönlendirmesi (canlı CarInfo akışı bize gelsin) ──
        // NWD CanService tam CarInfo'yu (hız vb.) yalnız `can_send_info_package_name`'deki
        // pakete sürekli push eder (default OEM launcher). CarOS Pro launcher olduğundan
        // kendini bu pakete yazar → NwdCanClient sürekli canlı CarInfo alır.
        // (Saha doğrulaması 2026-06-15: bu ayar bizi gösterince app'e canlı hız aktı.)
        applyCanInfoRouting();
    }

    /** Rotasyon bir kez uygulandı mı (gereksiz tekrar layout önler). */
    private boolean huRotationApplied = false;
    /** CAN yönlendirmesi bir kez uygulandı mı. */
    private boolean canRoutingApplied = false;
    /** can_send_info_package_name'i savunan observer (OEM listeye launcher eklerse geri yazar). */
    private ContentObserver _canRoutingObserver = null;
    private static final String CAN_ROUTING_KEY = "can_send_info_package_name";

    /**
     * NWD head unit'te kendimizi `can_send_info_package_name`'e yazarız ki CanService
     * tam CarInfo akışını (hız vb.) sürekli bizim app'e push etsin (outer SDK / NwdCanClient).
     * Per-package opt-in flag'leri de set edilir. Yalnız NWD head unit'inde; WRITE_SETTINGS
     * yoksa veya hata olursa sessizce geçer (NwdCanClient yine sporadik veri alır — fail-soft).
     */
    private void applyCanInfoRouting() {
        try {
            if (canRoutingApplied) return;
            String nwdOri = getSystemProp("ro.boot.nwd.orientation");
            if (nwdOri == null || nwdOri.isEmpty() || "0".equals(nwdOri)) return;
            if (!Settings.System.canWrite(this)) {
                Log.w(TAG, "CAN routing: WRITE_SETTINGS izni yok — can_send_info_package_name yazılamıyor");
                return;
            }
            String pkg = getPackageName();
            // 1) EN KRİTİK: can_send_info_package_name (OEM'in BİLDİĞİ anahtar — yazılabilir olabilir).
            //    CİHAZDA KANIT (2026-06-23): OEM CanService bu anahtarda TEK-PAKET TAM string eşleşmesi
            //    yapar; OEM boot'ta/çalışırken launcher'ı EKLER ("...pro,com.android.launcher") →
            //    virgüllü listede CarInfo akışı DURUR. assertCanRouting değeri tam paketimize yazar.
            boolean routed = assertCanRouting(pkg);
            // 2) Per-package opt-in flag'leri — DİNAMİK adlı anahtarlar; bu ROM bunları reddedebilir
            //    ("secure settings" hatası). Ayrı try'larda — biri düşse de routing/observer bozulmaz.
            try { Settings.System.putInt(getContentResolver(), pkg + "can_send_carinfo_data_to_out", 1); }
            catch (Throwable t) { Log.w(TAG, "opt-in carinfo yazılamadı (zararsız): " + t.getMessage()); }
            try { Settings.System.putInt(getContentResolver(), pkg + "can_send_doorinfo_data_to_out", 1); }
            catch (Throwable t) { Log.w(TAG, "opt-in doorinfo yazılamadı (zararsız): " + t.getMessage()); }
            // 3) Savunma observer'ı — değer yazılabiliyorsa anlamlı (OEM listeye launcher eklerse geri yaz).
            if (routed) {
                _canRoutingObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
                    @Override public void onChange(boolean selfChange) { assertCanRouting(getPackageName()); }
                };
                getContentResolver().registerContentObserver(
                    Settings.System.getUriFor(CAN_ROUTING_KEY), false, _canRoutingObserver);
                Log.i(TAG, "CAN routing: can_send_info_package_name=" + pkg + " (savunmalı — observer aktif)");
            } else {
                Log.w(TAG, "CAN routing: anahtar yazılamadı (OEM koruması) — sistem-app gerekir; sporadik CarInfo");
            }
            canRoutingApplied = true;
        } catch (Throwable t) {
            // fail-soft: yönlendirilemezse NwdCanClient yine sporadik CarInfo alır
            Log.e(TAG, "CAN routing hata: " + t.getMessage());
        }
    }

    /**
     * can_send_info_package_name'i yalnız değer tam paketimiz DEĞİLSE geri yazar.
     * Eşitse yazmaz → ContentObserver geri-besleme döngüsü oluşmaz.
     * @return değer (artık) tam paketimiz mi — yani yönlendirme aktif mi.
     */
    private boolean assertCanRouting(String pkg) {
        try {
            String cur = Settings.System.getString(getContentResolver(), CAN_ROUTING_KEY);
            if (pkg.equals(cur)) return true;
            Settings.System.putString(getContentResolver(), CAN_ROUTING_KEY, pkg);
            Log.i(TAG, "CAN routing yeniden uygulandı (eski: " + cur + ")");
            // Yazma reddedilmiş olabilir (OEM secure) — gerçekten oturdu mu doğrula.
            return pkg.equals(Settings.System.getString(getContentResolver(), CAN_ROUTING_KEY));
        } catch (Throwable t) {
            Log.e(TAG, "assertCanRouting hata: " + t.getMessage());
            return false;
        }
    }

    /**
     * WebView'i fiziksel yatay panele oturtmak için native 90° döndürür.
     * Yalnızca display DİKEY raporladığında (heightPixels > widthPixels) devreye girer;
     * gerçekten yatay raporlayan cihazlara DOKUNMAZ. Hata olursa sessizce geçer
     * (uygulama döndürülmemiş haliyle yine çalışır — fail-soft).
     */
    private void applyHeadUnitLandscapeRotation() {
        try {
            if (huRotationApplied) return;
            // Sadece NWD head unit panelinde (fiziksel yatay, Android dikey raporluyor).
            // ro.boot.nwd.orientation=90 → panel döndürülmüş. Normal telefon/tablette boş → DOKUNMA.
            String nwdOri = getSystemProp("ro.boot.nwd.orientation");
            if (nwdOri == null || nwdOri.isEmpty() || "0".equals(nwdOri)) return;

            if (!Settings.System.canWrite(this)) {
                Log.w(TAG, "HU rotation: WRITE_SETTINGS izni yok — sistem rotasyonu kilitlenemiyor");
                return;
            }
            // Otomatik döndürmeyi kapat + kullanıcı rotasyonunu YATAY (90°) sabitle.
            Settings.System.putInt(getContentResolver(), Settings.System.ACCELEROMETER_ROTATION, 0);
            Settings.System.putInt(getContentResolver(), Settings.System.USER_ROTATION, android.view.Surface.ROTATION_90);
            huRotationApplied = true;
            Log.i(TAG, "HU rotation: sistem yatay kilitlendi (accel=0, user_rotation=90, nwdOri=" + nwdOri + ")");
        } catch (Throwable t) {
            // fail-soft: kilitlenemezse app yine çalışır
            Log.e(TAG, "HU rotation hata: " + t.getMessage());
        }
    }

    /** SystemProperties.get — head unit tespiti için (reflection, gizli API). */
    private String getSystemProp(String key) {
        try {
            Class<?> sp = Class.forName("android.os.SystemProperties");
            return (String) sp.getMethod("get", String.class, String.class).invoke(null, key, "");
        } catch (Throwable t) {
            return "";
        }
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
        if (_canRoutingObserver != null) {
            try { getContentResolver().unregisterContentObserver(_canRoutingObserver); }
            catch (Throwable ignored) {}
            _canRoutingObserver = null;
        }
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
        // Tek tick zinciri — anrTick kendini döngü başına TAM 1 kez yeniden planlar.
        bgHandler.postDelayed(anrTick, ANR_CHECK_INTERVAL_MS);
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

    // ── LMK Memory Pressure ────────────────────────────────────────────────
    /**
     * Android LMK (Low Memory Killer) sisteminin bellek baskısı sinyallerini yakalar.
     * TRIM_MEMORY_RUNNING_CRITICAL → JS'e "CRITICAL" seviyesi iletilir.
     * TRIM_MEMORY_MODERATE         → JS'e "MODERATE" seviyesi iletilir.
     *
     * CarLauncherPlugin.broadcastMemoryPressure() JS tarafındaki memoryWatchdog dinleyicisini
     * tetikler; orası runtimeManager.setMode(SAFE_MODE) ve cache temizleme işlerini yapar.
     */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        String pressureLevel = null;
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
            pressureLevel = "CRITICAL";
        } else if (level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE) {
            pressureLevel = "MODERATE";
        }
        if (pressureLevel != null) {
            Log.w(TAG, "onTrimMemory level=" + level + " → " + pressureLevel);
            CarLauncherPlugin.broadcastMemoryPressure(pressureLevel);
        }
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
