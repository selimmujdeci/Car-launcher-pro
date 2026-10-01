package com.cockpitos.pro.phonehub.link;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketAddress;
import java.net.SocketTimeoutException;

/**
 * LanClientConnector — telefondaki CarOS Pro'nun Wi-Fi bağlanma yardımcıları (saf java.net).
 *
 * İki keşif yolu vardır, ikisi de YALNIZ yerel adreslere bağlanır:
 *  1. Araç beacon'ı (UDP {@link LanBeacon#UDP_PORT}) — telefon hotspot iken
 *     araç ona bağlı istemcidir; ortak Wi-Fi'de de aynı alt ağdadırlar.
 *  2. Ağ geçidi denemesi — telefon, aracın kendi erişim noktasına bağlıysa
 *     araç ağ geçididir; beacon kaçsa bile {@code geçit:47652} denenir.
 *
 * Bağlanılacak adres {@link LanAddressPolicy} kuralından geçmezse bağlantı
 * DENENMEZ (internet/operatör adresine soket açılmaz).
 */
public final class LanClientConnector {

    private LanClientConnector() { }

    public static final int CONNECT_TIMEOUT_MS = 4_000;

    /** Bulunan araç adayı. */
    public static final class Found {
        public final InetAddress host;
        public final int port;
        public final String idHint;
        Found(InetAddress host, int port, String idHint) {
            this.host = host; this.port = port; this.idHint = idHint;
        }
    }

    /** Beacon dinleme soketi (UDP, joker alıcı — yalnız ALIR, göndermez). */
    public static DatagramSocket openBeaconSocket(int port) throws IOException {
        DatagramSocket s = new DatagramSocket(null);
        s.setReuseAddress(true);
        s.setBroadcast(true);
        s.bind(new InetSocketAddress(port));
        return s;
    }

    /**
     * Süre dolana dek beacon bekler. Politika dışı göndericiler ve bozuk
     * paketler yok sayılır. {@code preferredHint} verilmişse önce ona uyan
     * araç döner; süre dolarken uyan yoksa ilk geçerli aday döner.
     */
    public static Found awaitBeacon(DatagramSocket socket, long timeoutMs,
                                    LanAddressPolicy.Policy policy, String preferredHint) throws IOException {
        long deadline = System.nanoTime() + timeoutMs * 1_000_000L;
        byte[] buf = new byte[LanBeacon.MAX_BYTES + 1];
        Found fallback = null;
        while (true) {
            long leftMs = (deadline - System.nanoTime()) / 1_000_000L;
            if (leftMs <= 0) return fallback;
            socket.setSoTimeout((int) Math.max(1L, Math.min(leftMs, Integer.MAX_VALUE)));
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            try {
                socket.receive(p);
            } catch (SocketTimeoutException e) {
                return fallback;
            }
            LanBeacon.Parsed parsed = LanBeacon.parse(p.getData(), p.getLength());
            if (parsed == null) continue;
            InetAddress sender = senderOf(p);
            if (sender == null || !policy.allows(sender)) continue;
            Found f = new Found(sender, parsed.tcpPort, parsed.idHint);
            if (preferredHint == null || LanBeacon.NO_HINT.equals(preferredHint)
                    || preferredHint.equals(parsed.idHint)) {
                return f;
            }
            if (fallback == null) fallback = f;
        }
    }

    /** Yerel adrese TCP bağlantısı; politika dışı adrese soket AÇILMAZ. */
    public static PhoneHubChannel connect(InetAddress host, int port, int timeoutMs,
                                          LanAddressPolicy.Policy policy) throws IOException {
        if (host == null || !policy.allows(host)) throw new IOException("yerel olmayan adres");
        if (port < 1 || port > 65535) throw new IOException("gecersiz port");
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(host, port), timeoutMs);
        } catch (IOException e) {
            try { s.close(); } catch (IOException ignored) { /* kapanış sessiz */ }
            throw e;
        }
        LanChannel.tune(s);
        return new LanChannel(s);
    }

    /** Göndericinin IP'si — ad çözümlemesi YAPILMAZ (literal adres). */
    private static InetAddress senderOf(DatagramPacket p) {
        SocketAddress sa = p.getSocketAddress();
        if (!(sa instanceof InetSocketAddress)) return null;
        try {
            return InetAddress.getByName(((InetSocketAddress) sa).getHostString());
        } catch (IOException e) {
            return null;
        }
    }
}
