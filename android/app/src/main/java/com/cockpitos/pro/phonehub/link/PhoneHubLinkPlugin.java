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
        PhoneHubLinkController.LinkStateListener {

    private PhoneHubLinkController controller() {
        String version = "?";
        try {
            version = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            /* Sürüm okunamazsa "?" kalır — sahte bir sürüm UYDURULMAZ. */
        }
        return PhoneHubLinkController.get(getContext(), version);
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("btConnect") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("btConnect", call, "onConnectPermission");
            return;
        }
        finishStart(call);
    }

    @PermissionCallback
    private void onConnectPermission(PluginCall call) {
        if (getPermissionState("btConnect") != com.getcapacitor.PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("started", false);
            ret.put("errorCode", LinkErrorCode.BLUETOOTH_PERMISSION_DENIED.name());
            ret.put("userMessage", LinkErrorCode.BLUETOOTH_PERMISSION_DENIED.userMessage());
            call.resolve(ret);
            return;
        }
        finishStart(call);
    }

    private void finishStart(PluginCall call) {
        PhoneHubLinkController c = controller();
        boolean started = c.startServer();
        JSObject ret = new JSObject();
        ret.put("started", started);
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
}
