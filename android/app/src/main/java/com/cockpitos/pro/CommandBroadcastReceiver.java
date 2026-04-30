package com.cockpitos.pro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * CommandBroadcastReceiver — H-4 Local Broadcast Handler
 *
 * CommandService.java WebView aktifken "com.cockpitos.pro.COMMAND_RECEIVED"
 * broadcast'i gönderir. Bu receiver MainActivity üzerinden JS tarafını
 * (fcmService.ts → wakeCommandListener) tetikler.
 *
 * Neden local broadcast?
 *   FCM onMessageReceived() arka plan iş parçacığında çalışır.
 *   JS tarafını doğrudan çağırmak thread-safe değildir.
 *   Local broadcast → MainActivity → JS event-bus güvenli köprüdür.
 */
public class CommandBroadcastReceiver extends BroadcastReceiver {

    private static final String TAG    = "CmdBroadcastReceiver";
    private static final String ACTION = "com.cockpitos.pro.COMMAND_RECEIVED";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION.equals(intent.getAction())) return;

        String vehicleId = intent.getStringExtra("vehicle_id");
        Log.d(TAG, "COMMAND_RECEIVED broadcast — vehicle: " + vehicleId);

        // ForegroundService wake-up: 30s IMPORTANCE_HIGH modu
        CarLauncherForegroundService svc = CarLauncherForegroundService.getInstance();
        if (svc != null) {
            svc.wakeUp();
            Log.d(TAG, "ForegroundService wakeUp() çağrıldı");
        }

        // JS tarafına event gönderme: MainActivity WebView'a postMessage yapabilir.
        // Şu an JS fcmService.ts PushNotifications plugin üzerinden zaten dinliyor.
        // Bu receiver yalnızca ForegroundService wake-up sinyali için kullanılır.
    }
}
