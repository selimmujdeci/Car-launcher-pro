package com.cockpitos.pro.phonehub.link;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * LanAddressPolicy — Phone Hub'ın Wi-Fi yolunun TEK adres kuralı (SAF).
 *
 * Phone Link YEREL bir bağlantıdır: internete, buluta ya da operatör ağına
 * ÇIKMAZ. Wi-Fi yolunda hem dinlenen hem bağlanılan hem de beacon atılan her
 * adres bu politikadan geçer:
 *
 *   · yalnız IPv4
 *   · yalnız özel ağ (RFC 1918: 10/8 · 172.16/12 · 192.168/16) ya da
 *     bağlantı-yerel (169.254/16)
 *   · loopback, joker (0.0.0.0), çok-noktaya yayın ve CGNAT (100.64/10 —
 *     hücresel operatör) REDDEDİLİR
 *
 * Telefonun hotspot'u (192.168.x / 10.x), aracın kendi erişim noktası ve
 * ev/ofis Wi-Fi'si bu kurala uyar; SIM kartlı bir head unit'in hücresel
 * arayüzü uymaz.
 */
public final class LanAddressPolicy {

    private LanAddressPolicy() { }

    /** Bir adresin Phone Hub için kabul edilip edilmeyeceği. */
    public interface Policy {
        boolean allows(InetAddress address);
    }

    /** Üretim politikası — yalnız özel/bağlantı-yerel IPv4. */
    public static final Policy LOCAL_ONLY = new Policy() {
        @Override public boolean allows(InetAddress address) { return isLocal(address); }
    };

    public static boolean isLocal(InetAddress a) {
        if (!(a instanceof Inet4Address)) return false;
        if (a.isLoopbackAddress() || a.isAnyLocalAddress() || a.isMulticastAddress()) return false;
        return a.isSiteLocalAddress() || a.isLinkLocalAddress();
    }

    /** Açık (UP), loopback olmayan arayüzlerin politikaya uyan IPv4 adresleri. */
    public static List<InetAddress> localAddresses(Policy policy) {
        List<InetAddress> out = new ArrayList<>();
        for (NetworkInterface ni : upInterfaces()) {
            Enumeration<InetAddress> it = ni.getInetAddresses();
            while (it.hasMoreElements()) {
                InetAddress a = it.nextElement();
                if (policy.allows(a)) out.add(a);
            }
        }
        return out;
    }

    /**
     * Beacon hedefleri: politikaya uyan arayüzlerin alt ağ yayın adresleri.
     * 255.255.255.255 KULLANILMAZ — o, varsayılan rotaya (çoğu zaman hücresel
     * ağa) gider; alt ağ yayını yalnız o yerel ağda kalır.
     */
    public static List<InetAddress> broadcastAddresses(Policy policy) {
        List<InetAddress> out = new ArrayList<>();
        for (NetworkInterface ni : upInterfaces()) {
            boolean local = false;
            Enumeration<InetAddress> it = ni.getInetAddresses();
            while (it.hasMoreElements()) {
                if (policy.allows(it.nextElement())) { local = true; break; }
            }
            if (!local) continue;
            for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                InetAddress b = ia.getBroadcast();
                if (b instanceof Inet4Address && !out.contains(b)) out.add(b);
            }
        }
        return out;
    }

    private static List<NetworkInterface> upInterfaces() {
        List<NetworkInterface> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> all = NetworkInterface.getNetworkInterfaces();
            if (all == null) return out;
            for (NetworkInterface ni : Collections.list(all)) {
                try {
                    if (ni.isUp() && !ni.isLoopback()) out.add(ni);
                } catch (SocketException ignored) { /* arayüz okunamadı — atla */ }
            }
        } catch (SocketException ignored) { /* arayüz listesi yok — boş */ }
        return out;
    }
}
