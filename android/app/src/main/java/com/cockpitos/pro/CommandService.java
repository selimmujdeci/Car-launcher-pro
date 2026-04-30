package com.cockpitos.pro;

import android.app.ActivityManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.cockpitos.pro.can.CanBusManager;
import com.cockpitos.pro.can.McuCommandFactory;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * CommandService — H-4 Native Command Service (FCM arka plan alıcısı)
 *
 * Görev: WebView kapalıyken FCM üzerinden gelen komutları yerel olarak işler.
 *
 * Akış:
 *   FCM push gelir (Supabase Edge Fn: push-notify)
 *     → WebView canlı mı?
 *       Evet → JS tarafı (fcmService.ts → commandListener.ts) devralır; broadcast gönder
 *       Hayır → MCU komutu mu?
 *           Evet + plaintext: CanBusManager ile doğrudan çalıştır
 *           Evet + E2E payload: NativeCryptoManager ile çöz, çalıştır
 *           Hayır: Kuyruğa al, uygulamayı uyandır
 *
 * Güvenlik:
 *   - MCU komutu: sadece whitelist (McuCommandFactory)
 *   - E2E şifre çözme: ECDH-P256 + HKDF-SHA256 + AES-GCM (NativeCryptoManager)
 *   - Kuyruk TTL: MAX_QUEUE_AGE_MS üzeri girdiler CommandPlugin tarafından atılır
 *   - speed guard: lock/unlock için araç hızı JS tarafında da kontrol edilir
 */
public class CommandService extends FirebaseMessagingService {

    private static final String TAG = "CommandService";

    // FCM event adları (Supabase Edge Function: push-notify ile uyumlu)
    private static final String EVENT_NEW_CMD     = "new_command";
    private static final String EVENT_CMD_PENDING = "command_pending";

    // MCU komutları — WebView olmadan doğrudan çalışabilir
    private static final Set<String> MCU_COMMANDS = new HashSet<>(Arrays.asList(
        "lock", "unlock", "horn", "alarm_on", "alarm_off", "lights_on"
    ));

    // SharedPreferences — CarLauncherPlugin.java tarafından da okunur
    static final String  PREFS_NAME    = "native_cmd_queue";
    static final String  KEY_QUEUE     = "queued_commands";
    static final String  KEY_RESULTS   = "cmd_results";
    private static final int MAX_QUEUE = 20;

    // ── FCM Token yenileme ──────────────────────────────────────────────────

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // Token yenileme: fcmService.ts (Capacitor PushNotifications plugin)
        // kendi listener'ı üzerinden yeni token'ı alıp Supabase'e kaydeder.
        // Burada sadece logluyoruz — çift kayıt yapmaya gerek yok.
        Log.d(TAG, "FCM token yenilendi (JS tarafı kaydeder)");
    }

    // ── Mesaj alımı ─────────────────────────────────────────────────────────

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();

        String event     = data.getOrDefault("event",      "");
        String cmdType   = data.getOrDefault("cmd_type",   "");
        String cmdId     = data.getOrDefault("cmd_id",     "");
        String vehicleId = data.getOrDefault("vehicle_id", "");
        String e2ePayload = data.getOrDefault("e2e_payload", "");

        Log.d(TAG, "FCM alındı: event=" + event + " type=" + cmdType + " id=" + cmdId);

        if (!EVENT_NEW_CMD.equals(event) && !EVENT_CMD_PENDING.equals(event)) {
            return; // Komut dışı bildirim — yoksay
        }

        boolean webViewActive = isWebViewActive();

        if (webViewActive) {
            // WebView canlı: JS tarafı devralır. Sadece broadcast gönder.
            Log.d(TAG, "WebView aktif — JS CommandListener'a bırakıldı");
            sendCommandBroadcast(vehicleId);
            return;
        }

        // WebView uyku modunda ────────────────────────────────────────────

        if (!e2ePayload.isEmpty()) {
            // E2E şifreli komut — NativeCryptoManager ile çöz
            handleEncryptedCommand(cmdId, e2ePayload, vehicleId);
        } else if (!cmdType.isEmpty() && MCU_COMMANDS.contains(cmdType)) {
            // Plaintext MCU komutu — doğrudan çalıştır
            executeMcuCommandNative(cmdType, cmdId);
        } else {
            // WebView gerekli (navigation, theme, vb.) veya tip bilinmiyor
            if (!cmdId.isEmpty()) queuePendingCommand(cmdId, cmdType, vehicleId);
            wakeApplication();
        }
    }

    // ── E2E Şifreli Komut ─────────────────────────────────────────────────

    private void handleEncryptedCommand(String cmdId, String e2ePayloadJson,
                                        String vehicleId) {
        try {
            NativeCryptoManager.DecryptResult result =
                NativeCryptoManager.decryptCommandPayload(this, e2ePayloadJson);

            if (result == null) {
                Log.w(TAG, "E2E deşifreleme başarısız — kuyruğa al + uyandır");
                queuePendingCommand(cmdId, "", vehicleId);
                wakeApplication();
                return;
            }

            String cmdType = result.type;
            Log.i(TAG, "E2E deşifrelendi: " + cmdType);

            if (MCU_COMMANDS.contains(cmdType)) {
                executeMcuCommandNative(cmdType, cmdId);
            } else {
                // MCU dışı komut — WebView gerekli
                queuePendingCommand(cmdId, cmdType, vehicleId);
                wakeApplication();
            }

        } catch (Exception ex) {
            Log.e(TAG, "E2E hata: " + ex.getMessage(), ex);
            queuePendingCommand(cmdId, "", vehicleId);
            wakeApplication();
        }
    }

    // ── MCU Komut Çalıştırma ─────────────────────────────────────────────

    private void executeMcuCommandNative(String cmdType, String cmdId) {
        Log.i(TAG, "Native MCU komut: " + cmdType);

        // ForegroundService başlatılmamışsa önce başlat
        CarLauncherForegroundService svc = CarLauncherForegroundService.getInstance();
        if (svc == null) {
            Log.w(TAG, "ForegroundService yok — başlatılıyor");
            startForegroundServiceCompat();
            // Servis henüz başlamadı — kuyruğa al, brief wake ile hız kazandır
            queuePendingCommand(cmdId, cmdType, "");
            wakeApplicationBrief();
            return;
        }

        CanBusManager canBus = CarLauncherForegroundService.getCanBusManager();
        if (canBus == null) {
            Log.w(TAG, "CanBusManager null — WebView'a düş");
            queuePendingCommand(cmdId, cmdType, "");
            wakeApplication();
            return;
        }

        byte[] packet = buildMcuPacket(cmdType);
        if (packet == null) {
            Log.w(TAG, "Bilinmeyen MCU tip: " + cmdType);
            writeCommandResult(cmdId, cmdType, "failed");
            return;
        }

        boolean ok = canBus.sendCommand(packet);
        Log.i(TAG, "MCU " + cmdType + " → " + (ok ? "OK" : "HATA"));

        // Sonucu SharedPreferences'a yaz — JS açılınca Supabase'e bildirecek
        writeCommandResult(cmdId, cmdType, ok ? "completed" : "failed");

        // Kısa uyandırma: JS tarafı status güncellesin
        wakeApplicationBrief();
    }

    private static byte[] buildMcuPacket(String cmdType) {
        switch (cmdType) {
            case "lock":      return McuCommandFactory.lockDoors();
            case "unlock":    return McuCommandFactory.unlockDoors();
            case "horn":      return McuCommandFactory.honkHorn();
            case "lights_on": return McuCommandFactory.flashLights();
            case "alarm_on":  return McuCommandFactory.alarmOn();
            case "alarm_off": return McuCommandFactory.alarmOff();
            default:          return null;
        }
    }

    // ── Uygulama Uyandırma ─────────────────────────────────────────────────

    /** Tam uyandırma: ForegroundService + MainActivity ön plana al */
    private void wakeApplication() {
        startForegroundServiceCompat();
        CarLauncherForegroundService svc = CarLauncherForegroundService.getInstance();
        if (svc != null) svc.wakeUp();

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("wake_reason", "remote_command");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: arka plan activity başlatmak PendingIntent gerektirir
            PendingIntent pi = PendingIntent.getActivity(
                this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            try {
                pi.send();
            } catch (PendingIntent.CanceledException e) {
                Log.w(TAG, "PendingIntent iptal edildi", e);
            }
        } else {
            startActivity(intent);
        }
    }

    /** Kısa uyandırma: sadece ForegroundService 30s boost — activity başlatma yok */
    private void wakeApplicationBrief() {
        startForegroundServiceCompat();
        CarLauncherForegroundService svc = CarLauncherForegroundService.getInstance();
        if (svc != null) svc.wakeUp();
    }

    private void startForegroundServiceCompat() {
        Intent svcIntent = new Intent(this, CarLauncherForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(svcIntent);
        } else {
            startService(svcIntent);
        }
    }

    /** WebView aktif durumdayken JS tarafını uyandırmak için local broadcast */
    private void sendCommandBroadcast(String vehicleId) {
        Intent broadcast = new Intent("com.cockpitos.pro.COMMAND_RECEIVED");
        broadcast.setPackage(getPackageName());
        broadcast.putExtra("vehicle_id", vehicleId);
        sendBroadcast(broadcast);
    }

    // ── WebView Aktif Mi? ──────────────────────────────────────────────────

    @SuppressWarnings("deprecation")
    private boolean isWebViewActive() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;

        try {
            List<ActivityManager.RunningTaskInfo> tasks = am.getRunningTasks(1);
            if (tasks == null || tasks.isEmpty()) return false;
            ActivityManager.RunningTaskInfo top = tasks.get(0);
            return top.topActivity != null &&
                   getPackageName().equals(top.topActivity.getPackageName());
        } catch (SecurityException e) {
            Log.w(TAG, "getRunningTasks erişim engeli: " + e.getMessage());
            return false;
        }
    }

    // ── SharedPreferences Kuyruk Yönetimi ─────────────────────────────────

    /** Bekleyen komut ID'sini kuyruğa ekler — JS açılınca Supabase'den tam komutu çeker */
    private void queuePendingCommand(String cmdId, String cmdType, String vehicleId) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            JSONArray queue = parseJsonArray(prefs.getString(KEY_QUEUE, "[]"));

            // Kapasite aşımında en eski girdiyi at
            while (queue.length() >= MAX_QUEUE) queue.remove(0);

            JSONObject entry = new JSONObject();
            entry.put("id",         cmdId);
            entry.put("type",       cmdType);
            entry.put("vehicle_id", vehicleId);
            entry.put("ts",         System.currentTimeMillis());
            queue.put(entry);

            prefs.edit().putString(KEY_QUEUE, queue.toString()).apply();
            Log.d(TAG, "Kuyruğa eklendi: " + cmdId);
        } catch (JSONException e) {
            Log.e(TAG, "Kuyruk yazma hatası", e);
        }
    }

    /** MCU çalıştırma sonucunu yazar — JS Supabase status güncellemesi için okur */
    private void writeCommandResult(String cmdId, String cmdType, String status) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            JSONArray results = parseJsonArray(prefs.getString(KEY_RESULTS, "[]"));

            JSONObject entry = new JSONObject();
            entry.put("id",     cmdId);
            entry.put("type",   cmdType);
            entry.put("status", status);
            entry.put("ts",     System.currentTimeMillis());
            results.put(entry);

            prefs.edit().putString(KEY_RESULTS, results.toString()).apply();
        } catch (JSONException e) {
            Log.e(TAG, "Sonuç yazma hatası", e);
        }
    }

    private static JSONArray parseJsonArray(String raw) {
        try { return new JSONArray(raw != null ? raw : "[]"); }
        catch (JSONException e) { return new JSONArray(); }
    }

    // ── Statik Erişim — CarLauncherPlugin çağırır ─────────────────────────

    public static String getQueuedCommands(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                  .getString(KEY_QUEUE, "[]");
    }

    public static String getCommandResults(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                  .getString(KEY_RESULTS, "[]");
    }

    public static void clearAll(Context ctx) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
           .edit()
           .remove(KEY_QUEUE)
           .remove(KEY_RESULTS)
           .apply();
        Log.d(TAG, "Kuyruk ve sonuçlar temizlendi");
    }
}
