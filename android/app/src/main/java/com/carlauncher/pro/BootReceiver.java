package com.carlauncher.pro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

/**
 * BootReceiver — Car Launcher Pro'yu cihaz açıldığında başlatır.
 *
 * Desteklenen boot action'ları:
 *   • BOOT_COMPLETED          — standart Android boot
 *   • LOCKED_BOOT_COMPLETED   — şifreli cihazlar, Direct Boot (API 24+)
 *   • QUICKBOOT_POWERON       — HTC / Xiaomi / bazı OEM'ler
 *
 * Sıra:
 *   1. Foreground service başlat (GPS + mola takibi hazır olsun)
 *   2. MainActivity'yi başlat (kısa gecikmeyle — servis yerleşsin)
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String ACTION_LOCKED_BOOT  = "android.intent.action.LOCKED_BOOT_COMPLETED";
    private static final String ACTION_QUICKBOOT     = "android.intent.action.QUICKBOOT_POWERON";

    /** Servis başladıktan sonra Activity için bekleme (ms) */
    private static final long ACTIVITY_DELAY_MS = 800L;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                      || ACTION_LOCKED_BOOT.equals(action)
                      || ACTION_QUICKBOOT.equals(action);
        if (!isBoot) return;

        // 1. Foreground service'i başlat (GPS, mola hatırlatıcısı)
        startForegroundService(context);

        // 2. Kısa gecikmeyle MainActivity'yi aç — servis foreground'a geçsin
        final Context appCtx = context.getApplicationContext();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            Intent launcher = new Intent(appCtx, MainActivity.class);
            launcher.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
            appCtx.startActivity(launcher);
        }, ACTIVITY_DELAY_MS);
    }

    private void startForegroundService(Context context) {
        try {
            Intent svc = new Intent(context, CarLauncherForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Android 8+: foreground service — BOOT_COMPLETED'dan başlatmak izin verilir
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {
            // Servis başlatılamazsa (izin vb.) Activity açılmaya devam eder
        }
    }
}
