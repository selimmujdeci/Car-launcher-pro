package com.cockpitos.pro.phonehub.link;

import android.Manifest;
import android.os.Build;

import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/**
 * PhoneHubLinkPlugin — Phone Hub bağlantısının JS köprüsü (GÖREV 4 + 14).
 *
 * ── NEDEN CarLauncherPlugin'e EKLENMEDİ ─────────────────────────────────────
 * {@code CarLauncherPlugin} 6266 satır ve 125 metottur. Bağlantı yaşam
 * döngüsü (soket, iş parçacığı, anahtar) oraya karışsaydı, dispose sahipliği
 * o devasa sınıfın yaşam döngüsüne bağlanır ve OBD/CAN koduyla dosya düzeyinde
 * temas ederdi. Ayrı plugin, izolasyonu YAPISAL hâle getirir.
 *
 * ── BU PLUGIN NE YAPMAZ ─────────────────────────────────────────────────────
 * Bluetooth'u AÇMAZ/KAPATMAZ · tarama (discovery) BAŞLATMAZ · eşleştirme
 * (bond) İSTEMEZ · A2DP/HFP'ye DOKUNMAZ · çağrı/SMS/kişi/bildirim OKUMAZ ·
 * OBD'ye tek bir komut GÖNDERMEZ. Yalnız kendi RFCOMM servisini dinler.
 *
 * ── İZİN ────────────────────────────────────────────────────────────────────
 * {@code BLUETOOTH_CONNECT} yalnız API 31+ runtime iznidir ve YALNIZ kullanıcı
 * bağlantı akışını başlattığında istenir. Reddedilirse fail-soft: sunucu
 * başlamaz, kodlanmış hata döner, uygulama çalışmaya devam eder.
 */
@CapacitorPlugin(
    name = "PhoneHubLink",
    permissions = {
        @Permission(alias = "btConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
    }
)
public class PhoneHubLinkPlugin extends Plugin implements
        PhoneHubLinkController.ApplicationMessageListener,
        PhoneHubLinkController.LinkStateListener,
        PhoneHubClientController.StateListener {

    private String appVersion() {
        try {
            return getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            /* Sürüm okunamazsa "?" kalır — sahte bir sürüm UYDURULMAZ. */
            return "?";
        }
    }

    private PhoneHubLinkController controller() {
        return PhoneHubLinkController.get(getContext(), appVersion());
    }

    /** Telefon rolü — aynı CarOS Pro telefonda araca bağlanırken. */
    private PhoneHubClientController client() {
        return PhoneHubClientController.get(getContext(), appVersion());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * F2 — uygulama mesajı köprüsü (native → JS TEK giriş noktası)
     * ════════════════════════════════════════════════════════════════════ */

    /** Eklenti yaşam döngüsüne bağlanır — kayıt burada, ayrılma {@link #handleOnDestroy}de. */
    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        controller().setApplicationMessageListener(this);
        /* F4.1 — yaşam döngüsü köprüsü de AYNI noktada bağlanır. */
        controller().setLinkStateListener(this);
        client().setStateListener(this);
    }

    /**
     * Zero-leak (F2 kapı 20): eklenti yok edildiğinde dinleyici SÖKÜLÜR —
     * bundan sonra native tarafta gelen hiçbir mesaj bu örneğe ULAŞMAZ.
     */
    @Override
    protected void handleOnDestroy() {
        controller().setApplicationMessageListener(null);
        /* Zero-leak: her iki dinleyici de SÖKÜLÜR. */
        controller().setLinkStateListener(null);
        client().setStateListener(null);
        super.handleOnDestroy();
    }

    /**
     * {@link PhoneHubLinkController.ApplicationMessageListener} — native
     * ESTABLISHED oturumdan gelen kanıtı (fingerprint + nesil) opak yükle
     * birlikte JS'e İLETİR. Hiçbir ayrıştırma/karar BURADA verilmez.
     */
    @Override
    public void onApplicationMessage(String peerFingerprintRef, long sessionEpoch, String payloadUtf8) {
        JSObject data = new JSObject();
        data.put("fingerprint", peerFingerprintRef);
        data.put("sessionEpoch", sessionEpoch);
        data.put("payload", payloadUtf8);
        notifyListeners("applicationMessage", data);
    }

    /**
     * {@link PhoneHubLinkController.LinkStateListener} — F4.1 kanonik yaşam
     * döngüsü geçişi. Hiçbir karar BURADA verilmez; olay olduğu gibi taşınır.
     *
     * Yük SABİT alanlıdır ve kripto materyali, eşleşme kodu, ham anahtar,
     * hata kodu, exception mesajı veya stack trace TAŞIMAZ.
     */
    @Override
    public void onLinkStateChanged(String state, long sessionEpoch, String fingerprint, String reason) {
        JSObject data = new JSObject();
        data.put("protocolVersion", 1);
        data.put("state", state);
        /* Oturum yokken uydurma nesil ÜRETİLMEZ — null taşınır. */
        data.put("sessionEpoch", sessionEpoch < 0 ? null : sessionEpoch);
        data.put("deviceFingerprint", fingerprint);
        data.put("reason", reason);
        notifyListeners("linkState", data);
    }

    /**
     * TS ingress'inin karar verdiği ACK/REJECTED yanıtını (veya ileride başka
     * bir uygulama mesajını) mevcut şifreli oturumdan gönderir. Bu metot da
     * yetki KARARI VERMEZ — yalnız zaten üretilmiş baytı taşır.
     */
    @PluginMethod
    public void sendApplicationMessage(PluginCall call) {
        String payload = call.getString("payload");
        JSObject ret = new JSObject();
        if (payload == null) {
            ret.put("sent", false);
            call.resolve(ret);
            return;
        }
        boolean sent = controller().sendApplicationMessage(payload);
        ret.put("sent", sent);
        call.resolve(ret);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sunucu yaşam döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * RFCOMM sunucusunu başlatır. İzin gerekiyorsa ÖNCE ister — sessizce
     * başarısız olmaz, kullanıcıya sistem diyaloğu gösterilir.
     */
    @PluginMethod
    public void startServer(PluginCall call) {
        /* askPermission=false: açılışta diyalog AÇILMAZ — Bluetooth izni yoksa
           yalnız yerel Wi-Fi yolu başlar (hibrit: biri yoksa diğeri). */
        boolean ask = !Boolean.FALSE.equals(call.getBoolean("askPermission", true));
        if (ask && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("btConnect") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("btConnect", call, "onConnectPermission");
            return;
        }
        finishStart(call);
    }

    @PermissionCallback
    private void onConnectPermission(PluginCall call) {
        /* İzin reddedilse de Wi-Fi yolu açılır; Bluetooth kendi engelini raporlar. */
        finishStart(call);
    }

    private void finishStart(PluginCall call) {
        PhoneHubLinkController c = controller();
        boolean started = c.startServer();
        JSObject ret = new JSObject();
        ret.put("started", started);
        ret.put("bluetoothListening", c.isBluetoothListening());
        ret.put("wifiListening", c.isWifiListening());
        if (!started) {
            LinkErrorCode blocker = c.snapshotBlocker();
            ret.put("errorCode", blocker == null
                ? LinkErrorCode.SERVER_LISTEN_FAILED.name() : blocker.name());
            ret.put("userMessage", blocker == null
                ? LinkErrorCode.SERVER_LISTEN_FAILED.userMessage() : blocker.userMessage());
        }
        call.resolve(ret);
    }

    /** Sunucuyu durdurur: worker · soket · oturum · anahtar hepsi bırakılır. */
    @PluginMethod
    public void stopServer(PluginCall call) {
        controller().stopServer();
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    /** Yalnız aktif oturumu keser; sunucu dinlemeye devam eder. */
    @PluginMethod
    public void disconnectSession(PluginCall call) {
        controller().disconnectSession();
        JSObject ret = new JSObject();
        ret.put("disconnected", true);
        call.resolve(ret);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Eşleştirme
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Onay bekleyen doğrulama kodu. YALNIZ kullanıcı ekranı çağırır; tanı
     * anlık görüntüsünde ve LAB'da bu değer YOKTUR.
     */
    @PluginMethod
    public void getPairingCode(PluginCall call) {
        String code = controller().pendingPairingCodeForDisplay();
        JSObject ret = new JSObject();
        ret.put("awaiting", code != null);
        /* Kod yoksa boş dize DEĞİL, açıkça null döner. */
        if (code != null) ret.put("code", code);
        call.resolve(ret);
    }

    @PluginMethod
    public void confirmPairing(PluginCall call) {
        Boolean accepted = call.getBoolean("accepted");
        if (accepted == null) {
            call.reject("accepted alanı zorunlu");
            return;
        }
        boolean ok = controller().confirmPairing(accepted);
        JSObject ret = new JSObject();
        ret.put("applied", ok);
        ret.put("accepted", accepted);
        call.resolve(ret);
    }

    @PluginMethod
    public void forgetTrustedPhone(PluginCall call) {
        controller().forgetTrustedPhone();
        JSObject ret = new JSObject();
        ret.put("forgotten", true);
        call.resolve(ret);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Tanı
     * ════════════════════════════════════════════════════════════════════ */

    /** CAROS LAB'ın okuduğu SALT-OKUNUR anlık görüntü. */
    @PluginMethod
    public void getSnapshot(PluginCall call) {
        try {
            JSONObject snapshot = controller().snapshotJson();
            call.resolve(JSObject.fromJSONObject(snapshot));
        } catch (org.json.JSONException e) {
            /* Anlık görüntü kurulamadıysa BOŞ ama DÜRÜST bir yanıt döner —
             * sahte "sağlıklı" bir nesne uydurmak yasaktır. */
            JSObject ret = new JSObject();
            ret.put("schemaVersion", 1);
            ret.put("error", "SNAPSHOT_BUILD_FAILED");
            call.resolve(ret);
        }
    }

    /** Sayaçları sıfırlar — aktif bağlantıyı KESMEZ. */
    @PluginMethod
    public void resetCounters(PluginCall call) {
        controller().resetCounters();
        JSObject ret = new JSObject();
        ret.put("reset", true);
        call.resolve(ret);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * TELEFON ROLÜ — aynı CarOS Pro telefonda araca bağlanır (Wi-Fi + Bluetooth)
     * ════════════════════════════════════════════════════════════════════ */

    @Override
    public void onClientStateChanged(String phase) {
        JSObject data = new JSObject();
        data.put("phase", phase);
        notifyListeners("clientState", data);
    }

    @Override
    public void onClientApplicationMessage(String peerFingerprint, long sessionEpoch, String payloadUtf8) {
        JSObject data = new JSObject();
        data.put("fingerprint", peerFingerprint);
        data.put("sessionEpoch", sessionEpoch);
        data.put("payload", payloadUtf8);
        notifyListeners("clientApplicationMessage", data);
    }

    /**
     * "Araca bağlan" — kullanıcı eylemidir; Android 12+'da Bluetooth yolu için
     * izin burada istenir. Reddedilirse Wi-Fi yolu yine denenir.
     */
    @PluginMethod
    public void clientConnect(PluginCall call) {
        boolean ask = !Boolean.FALSE.equals(call.getBoolean("askPermission", true));
        if (ask && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("btConnect") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("btConnect", call, "onClientConnectPermission");
            return;
        }
        finishClientConnect(call);
    }

    @PermissionCallback
    private void onClientConnectPermission(PluginCall call) {
        finishClientConnect(call);
    }

    private void finishClientConnect(PluginCall call) {
        client().connect();
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void clientDisconnect(PluginCall call) {
        client().disconnect();
        JSObject ret = new JSObject();
        ret.put("disconnected", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getClientSnapshot(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(client().snapshotJson()));
        } catch (org.json.JSONException e) {
            JSObject ret = new JSObject();
            ret.put("schemaVersion", 1);
            ret.put("error", "SNAPSHOT_BUILD_FAILED");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void getClientPairingCode(PluginCall call) {
        String code = client().pendingPairingCodeForDisplay();
        JSObject ret = new JSObject();
        ret.put("awaiting", code != null);
        if (code != null) ret.put("code", code);
        call.resolve(ret);
    }

    @PluginMethod
    public void confirmClientPairing(PluginCall call) {
        Boolean accepted = call.getBoolean("accepted");
        if (accepted == null) {
            call.reject("accepted alanı zorunlu");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("applied", client().confirmPairing(accepted));
        ret.put("accepted", accepted);
        call.resolve(ret);
    }

    @PluginMethod
    public void forgetTrustedCar(PluginCall call) {
        client().forgetTrustedCar();
        JSObject ret = new JSObject();
        ret.put("forgotten", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void sendClientApplicationMessage(PluginCall call) {
        String payload = call.getString("payload");
        JSObject ret = new JSObject();
        ret.put("sent", payload != null && client().sendApplicationMessage(payload));
        call.resolve(ret);
    }
}
