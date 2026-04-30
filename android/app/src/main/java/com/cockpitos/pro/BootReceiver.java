package com.cockpitos.pro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * BootReceiver — Caros Pro'yu cihaz açıldığında başlatır.
 *
 * T-5 Hardening:
 *   • Android 12+ (API 31+): BOOT_COMPLETED'dan Activity başlatmak yasak.
 *     Sadece ForegroundService başlatılır; Activity sistem tarafından yönetilir.
 *   • Direct Boot (API 24+): LOCKED_BOOT_COMPLETED ile şifreli cihazda da çalışır.
 *   • OEM uyumluluğu: QUICKBOOT_POWERON (Xiaomi/HTC) desteği.
 *
 * AndroidManifest'te gereken izinler:
 *   <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG              = "CLBootReceiver";
    private static final String ACTION_LOCKED_BOOT = "android.intent.action.LOCKED_BOOT_COMPLETED";
    private static final String ACTION_QUICKBOOT   = "android.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                      || ACTION_LOCKED_BOOT.equals(action)
                      || ACTION_QUICKBOOT.equals(action);
        if (!isBoot) return;

        Log.i(TAG, "Boot detected: " + action);

        // Foreground service başlat (GPS + mola takibi)
        // Android 12+: Activity başlatmak yasak — sadece servis
        startForegroundServiceSafe(context);
    }

    private void startForegroundServiceSafe(Context context) {
        try {
            Intent svc = new Intent(context, CarLauncherForegroundService.class);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Android 8+ (API 26+): startForegroundService zorunlu
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
            Log.i(TAG, "ForegroundService başlatıldı (API " + Build.VERSION.SDK_INT + ")");
        } catch (Exception e) {
            // Android 12+ bazen BOOT_COMPLETED'da kısıtlama uygular
            // Hata sessizce yutulur — uygulama kullanıcı açınca başlar
            Log.w(TAG, "ForegroundService başlatılamadı: " + e.getMessage());
        }
    }
}
