package com.cockpitos.pro.phonelink;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * PhoneLinkPortalPlugin — PHONE LINK F3 · misafir portalının Capacitor köprüsü.
 *
 * ── AYRI SAHİPLİK ───────────────────────────────────────────────────────────
 * Portal soketi/thread'i BİLEREK {@code PhoneHubLinkPlugin}'den de
 * {@code CarLauncherPlugin}'den de AYRI tutulur — {@code MainActivity}'nin
 * kendi notunda yazdığı ilkenin aynısı ("soket/iş parçacığı/anahtar sahipliği
 * karışmasın"). Bir portal arızası RFCOMM oturumunu veya launcher'ı ETKİLEMEZ.
 *
 * ── KARAR BURADA DEĞİL ──────────────────────────────────────────────────────
 * Bu sınıf hiçbir token doğrulamaz, hiçbir müzik komutu yürütmez ve hiçbir
 * oturum durumu TUTMAZ. Yalnız: başlat/durdur, isteği TS'e ilet, yanıtı geri
 * al, SSE karesini yaz. Tüm yetki/oturum/müzik kararı
 * {@code phoneLinkPortalHttp.ts} + kanonik F1/F2 zincirindedir.
 *
 * ── LOG YOK ─────────────────────────────────────────────────────────────────
 * Token, parmak izi, gövde veya yol İÇERİĞİ loglanmaz — bu sınıf hiç
 * {@code Log} çağırmaz.
 */
@CapacitorPlugin(name = "PhoneLinkPortal")
public class PhoneLinkPortalPlugin extends Plugin {

    private PhoneLinkPortalServer server;

    @Override
    public void load() {
        server = new PhoneLinkPortalServer(
            (requestId, method, path, streamKey, authorization, origin, body, truncated) -> {
                JSObject ev = new JSObject();
                ev.put("requestId", requestId);
                ev.put("method", method == null ? "" : method);
                ev.put("path", path == null ? "" : path);
                ev.put("streamKey", streamKey);
                ev.put("authorization", authorization);
                ev.put("origin", origin);
                ev.put("body", body == null ? "" : body);
                ev.put("bodyTruncated", truncated);
                notifyListeners("portalRequest", ev);
            });
    }

    @Override
    protected void handleOnDestroy() {
        /* Uygulama ölürken yetim soket/thread BIRAKILMAZ. */
        if (server != null) server.stop();
        super.handleOnDestroy();
    }

    /**
     * Dinleyiciyi açar. Kullanılabilir LAN IPv4 yoksa {@code started:false}
     * döner — sahte bir endpoint ÜRETİLMEZ (TS bunu görünce QR göstermez).
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (server == null) { call.reject("NO_SERVER", "portal server unavailable"); return; }
        boolean ok = server.start();
        JSObject r = new JSObject();
        r.put("started", ok);
        if (ok) {
            r.put("ip", server.getBoundIp());
            r.put("port", server.getBoundPort());
        } else {
            r.put("ip", null);
            r.put("port", 0);
            r.put("reason", "NO_LOCAL_NETWORK");
        }
        call.resolve(r);
    }

    /** Dinleyiciyi ve tüm açık istemcileri kapatır (idempotent). */
    @PluginMethod
    public void stop(PluginCall call) {
        if (server != null) server.stop();
        JSObject r = new JSObject();
        r.put("stopped", true);
        call.resolve(r);
    }

    /** Açık SSE bağlantılarını kapatır — sunucu AÇIK kalır (F3.9 kısmi iptal). */
    @PluginMethod
    public void closeStreams(PluginCall call) {
        if (server != null) server.closeAllStreams();
        call.resolve();
    }

    /** TS'in ürettiği yanıtı bekleyen istek thread'ine teslim eder. */
    @PluginMethod
    public void respond(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null || server == null) { call.resolve(); return; }
        Integer status = call.getInt("status", 500);
        PhoneLinkPortalServer.PortalResponse response = new PhoneLinkPortalServer.PortalResponse(
            status == null ? 500 : status,
            call.getString("contentType"),
            call.getString("body"),
            Boolean.TRUE.equals(call.getBoolean("sseOpen", false)),
            call.getString("streamSessionId"));
        server.deliverResponse(requestId, response);
        call.resolve();
    }

    /**
     * Kanonik Music değişimini açık istemcilere PUSH eder. Polling YOKTUR:
     * bu metot yalnız TS'teki kanonik değişim olayında çağrılır.
     */
    @PluginMethod
    public void pushEvent(PluginCall call) {
        if (server != null) server.pushEvent(call.getString("frame"));
        call.resolve();
    }

    /** LAB gözlemlenebilirliği — sır TAŞIMAZ (ip/port zaten QR'da). */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        boolean running = server != null && server.isRunning();
        r.put("running", running);
        r.put("ip", running ? server.getBoundIp() : null);
        r.put("port", running ? server.getBoundPort() : 0);
        r.put("streamClients", server == null ? 0 : server.getStreamClientCount());
        call.resolve(r);
    }
}
