package com.cockpitos.pro.phonelink;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * PhoneInternetObserverPlugin — PHONE LINK F5.4/F5.19 · ağ GÖZLEMİ.
 *
 * ── BU SINIF KARAR VERMEZ ───────────────────────────────────────────────────
 * Burada hiçbir yetki, kimlik, güven, rol veya "internet kullanılabilir mi"
 * kararı YOKTUR. Sınıfın tek işi {@link ConnectivityManager}'ın söylediği
 * SINIRLI GERÇEKLERİ olduğu gibi TS'e taşımaktır. Politika, capability ve
 * durum türetimi TAMAMEN TS tarafındadır ({@code phoneLinkInternetPolicy.ts}) —
 * F2/F4'ün "opak native, dar TS" deseninin aynısı.
 *
 * Özellikle: native ASLA "bu telefon güvenilir", "bu sürücüdür" ya da
 * "internet capability ver" DEMEZ.
 *
 * ── VERİ DÜZLEMİ BURADA DEĞİL ───────────────────────────────────────────────
 * Hiçbir paket taşınmaz. VPN yok, proxy yok, NAT yok, DNS yok, socket yok,
 * tethering çağrısı yok, Wi-Fi'a bağlanma yok. Veri düzlemi TAMAMEN Android'in
 * kendi network stack'idir; bu sınıf yalnız onu İZLER.
 *
 * ── POLLING/TIMER YOK (F5.16) ───────────────────────────────────────────────
 * Tek kaynak {@code registerNetworkCallback}'tir. Ping döngüsü, HTTP probe,
 * hız testi, {@code ScheduledExecutorService}, {@code Timer} ve
 * {@code postDelayed} KULLANILMAZ. Gözlemci yalnız {@code start()} ile
 * kaydolur; {@code stop()} ile TAMAMEN sökülür — kullanılmadığında sıfır
 * çalışma zamanı maliyeti.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * SSID, hotspot parolası, BSSID, IP adresi, ağ kimlik bilgisi ve ham yük
 * TAŞINMAZ ve LOGLANMAZ — bu sınıf hiç {@code Log} çağırmaz.
 *
 * ── İZİN ────────────────────────────────────────────────────────────────────
 * Yalnız {@code ACCESS_NETWORK_STATE} gerekir ve manifest'te ZATEN VARDIR.
 * F5 hiçbir yeni izin EKLEMEZ.
 */
@CapacitorPlugin(name = "PhoneInternetObserver")
public class PhoneInternetObserverPlugin extends Plugin {

    /** Bant genişliği tahmini API 21+ mevcut; alt sınırımız 24 olduğu için güvenli. */
    private static final int UNKNOWN_KBPS = -1;

    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback callback;
    private final AtomicBoolean observing = new AtomicBoolean(false);

    @Override
    public void load() {
        cm = (ConnectivityManager) getContext().getApplicationContext()
            .getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    @Override
    protected void handleOnDestroy() {
        stopObservingInternal();
        super.handleOnDestroy();
    }

    /* ── Gerçeklerin çıkarılması (SABİT alanlar, yorum YOK) ─────────────── */

    /**
     * {@link NetworkCapabilities} → sınırlı gerçek kümesi.
     *
     * "Bağlı = internet var" VARSAYILMAZ: {@code validated} AYRI bir alandır
     * ve {@code NET_CAPABILITY_VALIDATED}'dan gelir. Captive portal da ayrı
     * taşınır. Ölçülemeyen her şey {@code null}/{@code -1}'dir — sahte değer
     * ÜRETİLMEZ.
     */
    private static JSObject factsOf(NetworkCapabilities caps) {
        JSObject f = new JSObject();
        if (caps == null) {
            f.put("present", false);
            f.put("transport", "UNKNOWN");
            f.put("hasInternetCapability", false);
            f.put("validated", (Boolean) null);
            f.put("captivePortal", (Boolean) null);
            f.put("metered", (Boolean) null);
            f.put("downstreamKbps", UNKNOWN_KBPS);
            f.put("upstreamKbps", UNKNOWN_KBPS);
            return f;
        }

        f.put("present", true);
        f.put("transport", transportOf(caps));
        f.put("hasInternetCapability",
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));

        /* VALIDATED: gerçekten dış ağa çıkılabildiğini OS doğruladı mı. */
        f.put("validated", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));

        /* CAPTIVE PORTAL: "bağlı ama giriş sayfası bekliyor". */
        f.put("captivePortal",
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL));

        /* METERED: NOT_METERED yokluğu "ölçülü" demektir. NOT_METERED bilgisi
         * her ROM'da güvenilir olmayabilir; yine de OS'un tek beyanı budur ve
         * TS tarafı UNKNOWN'ı ÜCRETSİZ SAYMAZ. */
        f.put("metered", !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));

        f.put("downstreamKbps", caps.getLinkDownstreamBandwidthKbps());
        f.put("upstreamKbps", caps.getLinkUpstreamBandwidthKbps());
        return f;
    }

    /**
     * Taşıma sınıfı. ⚠️ Bu bir KÖKEN İDDİASI DEĞİLDİR: {@code WIFI}, bağlı
     * ağın telefonun hotspot'u OLDUĞUNU söylemez (F5.6). Telefon hotspot'u ile
     * ev/ofis Wi-Fi'ı işletim sistemi seviyesinde AYNI görünür; bu ayrımı TS
     * tarafı yalnız KANIT varsa yapar, yoksa UNKNOWN bırakır.
     */
    private static String transportOf(NetworkCapabilities caps) {
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "WIFI";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ETHERNET";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "CELLULAR";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)) return "BLUETOOTH";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_USB)) return "USB";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "VPN";
        return "UNKNOWN";
    }

    private void emit(JSObject facts) {
        notifyListeners("networkFacts", facts);
    }

    /* ── Yaşam döngüsü ─────────────────────────────────────────────────── */

    /**
     * Gözlemi başlatır. İdempotenttir. Kayıt başarısızsa sahte bir "başladı"
     * İDDİA EDİLMEZ — {@code observing:false} döner.
     */
    @PluginMethod
    public void start(PluginCall call) {
        JSObject r = new JSObject();
        if (cm == null) {
            r.put("observing", false);
            r.put("reason", "NO_CONNECTIVITY_SERVICE");
            call.resolve(r);
            return;
        }
        if (observing.get()) {
            r.put("observing", true);
            call.resolve(r);
            return;
        }

        ConnectivityManager.NetworkCallback cb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                emit(factsOf(caps));
            }

            @Override
            public void onLost(Network network) {
                /* Ağ gitti — sahte "hâlâ bağlı" ÜRETİLMEZ. */
                emit(factsOf(null));
            }

            @Override
            public void onUnavailable() {
                emit(factsOf(null));
            }
        };

        try {
            NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
            cm.registerNetworkCallback(request, cb);
            callback = cb;
            observing.set(true);
            r.put("observing", true);
            /* İlk gerçek ANINDA verilir — çağıran ilk olayı beklemek zorunda
             * kalmasın (bu bir POLLING değil, tek atışlık okuma). */
            emit(currentFacts());
        } catch (Exception e) {
            callback = null;
            observing.set(false);
            r.put("observing", false);
            r.put("reason", "REGISTER_FAILED");
        }
        call.resolve(r);
    }

    /** Gözlemi TAMAMEN söker. İdempotent; yetim callback BIRAKMAZ. */
    @PluginMethod
    public void stop(PluginCall call) {
        stopObservingInternal();
        JSObject r = new JSObject();
        r.put("observing", false);
        call.resolve(r);
    }

    private void stopObservingInternal() {
        ConnectivityManager.NetworkCallback cb = callback;
        callback = null;
        observing.set(false);
        if (cb != null && cm != null) {
            try { cm.unregisterNetworkCallback(cb); } catch (Exception ignored) {}
        }
    }

    /** Tek atışlık okuma — döngü DEĞİL. Çağıran istediğinde bir kez çeker. */
    @PluginMethod
    public void getFacts(PluginCall call) {
        JSObject facts = currentFacts();
        facts.put("observing", observing.get());
        call.resolve(facts);
    }

    private JSObject currentFacts() {
        if (cm == null) return factsOf(null);
        try {
            Network active = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? cm.getActiveNetwork() : null;
            if (active == null) return factsOf(null);
            return factsOf(cm.getNetworkCapabilities(active));
        } catch (Exception e) {
            return factsOf(null);
        }
    }
}
