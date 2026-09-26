package com.cockpitos.pro;

import android.app.ActivityManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * CommandService — araç WAKE transportu (FCM arka plan alıcısı).
 *
 * MRI F-02: bu servis ARTIK BİR KOMUT YÜRÜTÜCÜSÜ DEĞİLDİR.
 *
 *   FCM = WAKE SİNYALİ,  FCM != COMMAND EXECUTOR
 *
 * Akış (tek dal):
 *   FCM data mesajı gelir (Supabase Edge Fn: push-notify → fcmDelivery.buildWakeMessage)
 *     → olay wake ailesinden mi? (new_command | command_pending) değilse YOK SAY
 *     → WebView canlı mı?
 *         Evet → broadcast (ForegroundService boost); kanonik JS dinleyicisi zaten açık
 *         Hayır → wakeApplication() → MainActivity/WebView → fcmService → commandListener
 *
 * Fiziksel uzak komut otoritesi TEKTİR:
 *   vehicle_commands (DB) → commandListener (JS) → yetki + hareket güvenliği +
 *   E2E/replay kontrolü → MCU/CAN.
 *
 * Bu servis şunları YAPMAZ (F-02'de kaldırıldı):
 *   - E2E payload çözme (NativeCryptoManager.decryptCommandPayload)
 *   - lock/unlock/horn/lights/alarm gibi fiziksel komut icrası
 *   - ikinci komut kuyruğu / sonuç (status) otoritesi
 *
 * FCM `data` içeriği ne taşırsa taşısın (cmd_id, cmd_type, e2e_payload dâhil)
 * bu servisten fiziksel icra BAŞLATILAMAZ: icra dalı yapısal olarak yoktur.
 */
public class CommandService extends FirebaseMessagingService {

    private static final String TAG = "CommandService";

    // FCM event adları (Supabase Edge Function: push-notify ile uyumlu)
    private static final String EVENT_NEW_CMD     = "new_command";
    private static final String EVENT_CMD_PENDING = "command_pending";

    /**
     * Kanonik wake üreticisinin (`fcmDelivery.buildWakeMessage`) ASLA yazmadığı,
     * kaldırılmış native yürütücüye ait eski anahtarlar. Yalnız GÖZLEM içindir:
     * sınıflandırmaya ve icraya etkisi YOKTUR (otorite değil).
     */
    static final Set<String> LEGACY_COMMAND_KEYS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("cmd_id", "cmd_type", "e2e_payload")));

    // ── FCM veri sınıflandırması (SAF — MRI F-08 + F-02) ───────────────────
    //
    // `onMessageReceived` dallanmasını YALNIZ buradan alır ve karar YALNIZ
    // `event` alanına bakar. Android bağımlılığı taşımadığı için JVM'de
    // (CommandServiceWakeContractTest) kanıtlanır.
    //
    // F-02: eskiden üçüncü bir değer (ENCRYPTED_COMMAND) vardı ve `e2e_payload`
    // üst düzey anahtarıyla native decrypt + CAN icrasına gidiyordu. O dal
    // kaldırıldı; artık wake ailesinden her mesaj WAKE_ONLY'dir. Payload
    // içeriği bir icra yetkisi ÜRETEMEZ.

    /** FCM `data` haritasının yorumu — iki olasılık vardır, üçüncüsü yoktur. */
    enum FcmDataKind {
        /** Wake ailesinden değil → yok sayılır (insan bildirimi vb.). */
        IGNORE,
        /** Uyan ve kanonik DB dinleyicisine bak — fiziksel icra YOK. */
        WAKE_ONLY
    }

    /** Saf karar: Android çağrısı yok. */
    static FcmDataKind classifyFcmData(Map<String, String> data) {
        if (data == null) return FcmDataKind.IGNORE;
        String event = data.getOrDefault("event", "");
        if (!EVENT_NEW_CMD.equals(event) && !EVENT_CMD_PENDING.equals(event)) {
            return FcmDataKind.IGNORE;
        }
        return FcmDataKind.WAKE_ONLY;
    }

    /**
     * Saf gözlem yüklemi: mesaj kaldırılmış yürütücünün anahtarlarını taşıyor mu?
     * Yalnız loglama içindir — dönüş değeri hiçbir dalı açmaz/kapatmaz.
     */
    static boolean carriesLegacyCommandKeys(Map<String, String> data) {
        if (data == null) return false;
        for (String key : LEGACY_COMMAND_KEYS) {
            String value = data.get(key);
            if (value != null && !value.isEmpty()) return true;
        }
        return false;
    }

    // ── FCM Token yenileme ──────────────────────────────────────────────────

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // ÖLÇÜLEN GERÇEK (PROD-1A1): merged manifest'te MESSAGING_EVENT'i
        // dinleyen İKİ servis var (bu servis + Capacitor'ın MessagingService'i)
        // ve Firebase yalnız BİRİNE dağıtır. Bu servis kazanırsa Capacitor'ın
        // `registration` listener'ı ÇALIŞMAZ — yani "JS tarafı hemen kaydeder"
        // GARANTİ DEĞİLDİR.
        //
        // Kurtarma AÇILIŞ düzeyindedir: her başlangıçta PushNotifications
        // .register() güncel token'ı yeniden teslim eder ve
        // vehicleIdentityService.ensureDevicePushTokenRegistered() onu cihaz
        // kimliğiyle kaydeder. Yani oturum içi bir rotasyon en geç BİR SONRAKİ
        // AÇILIŞTA yakalanır; bu pencere bilinçli olarak kabul edilmiştir
        // (native-JS köprüsü kurmak asgari yamanın dışındadır).
        //
        // Token DEĞERİ loglanmaz.
        Log.d(TAG, "FCM token yenilendi (kayıt: JS tarafı, en geç sonraki açılışta)");
    }

    // ── Mesaj alımı — TEK DAL: uyandır ──────────────────────────────────────

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();

        if (classifyFcmData(data) == FcmDataKind.IGNORE) {
            return; // Wake ailesinden değil — araçta işlenmez
        }

        if (carriesLegacyCommandKeys(data)) {
            /* Kanonik sunucu bu anahtarları üretmez. Geldiyse sözleşme dışıdır:
               İCRA EDİLMEZ, çözülmez, "tamamlandı" yazılmaz — yalnız kaydedilir.
               Mesaj yine de zararsız bir wake olarak ele alınır; komut gerçekten
               varsa kanonik dinleyici onu DB'den kendi yetkisiyle okur. */
            Log.w(TAG, "Wake mesajı sözleşme dışı komut anahtarı taşıyor — icra YOK");
        }

        String vehicleId = data.getOrDefault("vehicle_id", "");
        Log.d(TAG, "Wake alındı: event=" + data.getOrDefault("event", ""));

        if (isWebViewActive()) {
            // WebView canlı: kanonik JS dinleyicisi devralır. Sadece broadcast gönder.
            Log.d(TAG, "WebView aktif — kanonik JS CommandListener'a bırakıldı");
            sendCommandBroadcast(vehicleId);
            return;
        }

        // WebView uykuda: uygulamayı uyandır. Komut bilgisini native TAŞIMAZ;
        // uyanan kanonik dinleyici bekleyenleri DB'den çeker (fetch_pending).
        wakeApplication();
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

    private void startForegroundServiceCompat() {
        ForegroundServiceBoundary.requestStart(this, "CommandService");
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
}
