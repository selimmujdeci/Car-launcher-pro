package com.cockpitos.pro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
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
    static final String ACTION_LOCKED_BOOT = "android.intent.action.LOCKED_BOOT_COMPLETED";
    static final String ACTION_QUICKBOOT   = "android.intent.action.QUICKBOOT_POWERON";

    /**
     * QUICKBOOT_POWERON için kabul edilen azami açılış-sonrası süre (ms).
     *
     * NEDEN VAR: `BOOT_COMPLETED` ve `LOCKED_BOOT_COMPLETED` AOSP'de **protected
     * broadcast**'tir — bunları yalnız sistem yollayabilir, üçüncü taraf uygulama
     * `sendBroadcast` denerse framework SecurityException atar (açık component'e
     * yollasa bile). `android.intent.action.QUICKBOOT_POWERON` ise AOSP'nin korumalı
     * listesinde DEĞİLDİR (MTK/Xiaomi/HTC türevi ROM'lardan gelir; bazı ROM'lar
     * kendi listesine ekler, GARANTİ EDİLEMEZ) → receiver `exported="true"` olduğu
     * için herhangi bir uygulama bu action ile sahte broadcast yollayıp GPS servisini
     * ve kalıcı bildirimi başlatabiliyordu.
     *
     * ÇÖZÜM (fail-closed): korumasız action YALNIZ gerçek açılış penceresinde kabul
     * edilir. Bu pencerede sahte broadcast'in saldırgana kazandırdığı bir şey yoktur —
     * meşru açılış yayını zaten o anda geliyor. Pencere dışındaki her QUICKBOOT REDDEDİLİR.
     *
     * ⚠️ SINIR: Android'de bir broadcast'in GERÇEK göndericisi receiver tarafından
     * doğrulanamaz (`sendBroadcast` çağıranın uid'i onReceive'e taşınmaz) ve korumasız
     * bir action için manifest `android:permission` da çözüm değildir — o, GÖNDERENİN
     * izne sahip olmasını şart koşar; QUICKBOOT'u yollayan OEM bileşeni sistem uid'i
     * olmayabilir, o zaman meşru açılış SESSİZCE kaybolurdu (satılan bilinmeyen head
     * unit ROM'larında doğrulanamaz bir risk). Bu yüzden zaman penceresi seçildi.
     * 3 dk: yavaş head unit'lerde açılış yayını gecikmeli gelebilir.
     */
    static final long QUICKBOOT_MAX_UPTIME_MS = 180_000L;

    /**
     * Saf karar: bu action bir başlatma yetkisi veriyor mu?
     * (Cihazsız birim testi için `static` ve Android çağrısı YOK.)
     *
     * @param action        gelen intent action'ı (null olabilir)
     * @param uptimeMs      cihazın açılıştan beri geçen süresi (SystemClock.elapsedRealtime)
     */
    static boolean isAcceptedBootAction(String action, long uptimeMs) {
        if (action == null) return false;
        // Protected broadcast — sahte yollanamaz, zaman kapısı GEREKMEZ.
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || ACTION_LOCKED_BOOT.equals(action)) return true;
        // Korumasız OEM action — yalnız gerçek açılış penceresinde.
        if (ACTION_QUICKBOOT.equals(action)) return uptimeMs >= 0L && uptimeMs <= QUICKBOOT_MAX_UPTIME_MS;
        return false;   // bilinmeyen action → HİÇBİR ŞEY başlatılmaz
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (!isAcceptedBootAction(action, SystemClock.elapsedRealtime())) {
            if (ACTION_QUICKBOOT.equals(action)) {
                Log.w(TAG, "QUICKBOOT_POWERON açılış penceresi dışında geldi — REDDEDİLDİ (sahte broadcast koruması).");
            }
            return;
        }

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
