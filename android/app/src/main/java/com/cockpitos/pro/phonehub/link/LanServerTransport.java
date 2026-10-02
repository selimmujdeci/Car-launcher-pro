package com.cockpitos.pro.phonehub.link;

import com.cockpitos.phonehub.protocol.LinkDiagnosticBuffer;
import com.cockpitos.phonehub.protocol.LinkDiagnosticEvent;
import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.cockpitos.phonehub.protocol.LinkSession;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LanServerTransport — araç ünitesinin YEREL Wi-Fi dinleyicisi (Bluetooth'un eşi).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Bazı head unit'lerde (ör. K24/NWD) Android Bluetooth yığını hiç ayağa
 * kalkmaz; radyo üreticinin kendi modülündedir. Telefondaki CarOS Pro, aynı
 * yerel ağdaysa (telefonun hotspot'u, aracın erişim noktası ya da ortak Wi-Fi)
 * bu yoldan bağlanır. Bluetooth varsa iki yol BİRLİKTE açıktır; hangisi önce
 * bağlanırsa oturum odur (tek oturum kuralı controller'dadır).
 *
 * ── YALNIZ YEREL ────────────────────────────────────────────────────────────
 * Her kabul edilen bağlantının HEM uzak HEM yerel adresi
 * {@link LanAddressPolicy} kuralından geçer; geçmeyen soket hemen kapatılır ve
 * sayılır. Beacon yalnız yerel alt ağ yayın adreslerine gider.
 *
 * ── GÜVEN BURADA DEĞİL ──────────────────────────────────────────────────────
 * Kabul edilen soket yalnız akış verir. Kimlik, şifreleme ve 6 haneli kod
 * onayı {@code LinkSession}'dadır — Bluetooth ile birebir aynı.
 *
 * ── SINIRLI KAYNAK ──────────────────────────────────────────────────────────
 * İki iş parçacığı (kabul + beacon), tek dinleme soketi, tek beacon soketi.
 * Beacon yalnız bağlı telefon YOKKEN atılır. Durdurunca hepsi bırakılır.
 */
public final class LanServerTransport {

    /** Tercih edilen TCP portu; doluysa çekirdek boş bir port verir (beacon onu duyurur). */
    public static final int PREFERRED_TCP_PORT = 47652;
    static final long BEACON_INTERVAL_MS = 2_000L;
    /** Durdururken kabul iş parçacığının bitmesi için en çok bu kadar beklenir. */
    static final long STOP_JOIN_MS = 1_000L;

    public interface Callback {
        /**
         * Yerel ağdan yeni bağlantı. {@code false} dönerse kanal kapatılır
         * (ör. başka taşımada zaten bir oturum var).
         */
        boolean onChannelAccepted(PhoneHubChannel channel);
    }

    /** Beacon'ın gideceği yer — testte enjekte edilir, üretimde UDP alt ağ yayını. */
    public interface BeaconSink {
        int send(byte[] payload);
        void close();
    }

    /** Kimlik ipucu kaynağı (aracın parmak izinin ilk 8 karakteri). */
    public interface HintSource {
        String hint();
    }

    public enum ServerState { STOPPED, LISTENING, CLIENT_CONNECTED, ERROR }

    private final LinkDiagnosticBuffer diagnostics;
    private final LinkSession.MonotonicClock clock;
    private final LanAddressPolicy.Policy policy;
    private final Callback callback;
    private final HintSource hintSource;
    private final int preferredPort;
    private volatile BeaconSink beaconSink;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean disposed = new AtomicBoolean(false);

    private volatile ServerSocket listenSocket;
    private volatile Socket activeSocket;
    private volatile Thread acceptThread;
    private volatile Thread beaconThread;

    private volatile ServerState state = ServerState.STOPPED;
    private volatile LinkErrorCode lastError;
    private volatile long acceptedCount;
    private volatile long rejectedSecondClientCount;
    private volatile long rejectedNonLocalCount;
    private volatile long beaconsSent;

    public LanServerTransport(LinkDiagnosticBuffer diagnostics, LinkSession.MonotonicClock clock,
                              LanAddressPolicy.Policy policy, HintSource hintSource,
                              Callback callback) {
        this(diagnostics, clock, policy, hintSource, callback, PREFERRED_TCP_PORT, null);
    }

    /** Test kurucusu: port ve beacon hedefi enjekte edilir. */
    LanServerTransport(LinkDiagnosticBuffer diagnostics, LinkSession.MonotonicClock clock,
                       LanAddressPolicy.Policy policy, HintSource hintSource, Callback callback,
                       int preferredPort, BeaconSink beaconSink) {
        this.diagnostics = diagnostics;
        this.clock = clock == null ? LinkSession.SYSTEM_CLOCK : clock;
        this.policy = policy == null ? LanAddressPolicy.LOCAL_ONLY : policy;
        this.hintSource = hintSource;
        this.callback = callback;
        this.preferredPort = preferredPort;
        this.beaconSink = beaconSink;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yaşam döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    /** Dinlemeyi başlatır. İdempotent; zaten çalışıyorsa true. */
    public synchronized boolean start() {
        if (disposed.get()) {
            lastError = LinkErrorCode.TRANSPORT_DISPOSED;
            return false;
        }
        if (running.get()) return true;

        ServerSocket ss = bind(preferredPort);
        if (ss == null && preferredPort != 0) ss = bind(0);
        if (ss == null) {
            state = ServerState.ERROR;
            lastError = LinkErrorCode.SERVER_LISTEN_FAILED;
            record(LinkDiagnosticEvent.Severity.ERROR, "listen", LinkErrorCode.SERVER_LISTEN_FAILED,
                "wifi dinleme acilamadi");
            return false;
        }
        listenSocket = ss;
        if (beaconSink == null) beaconSink = new UdpBroadcastSink(policy);
        running.set(true);
        state = ServerState.LISTENING;
        record(LinkDiagnosticEvent.Severity.INFO, "listen", null, "wifi dinlemede");

        acceptThread = new Thread(new Runnable() {
            @Override public void run() { acceptLoop(); }
        }, "phonehub-lan-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();

        beaconThread = new Thread(new Runnable() {
            @Override public void run() { beaconLoop(); }
        }, "phonehub-lan-beacon");
        beaconThread.setDaemon(true);
        beaconThread.start();
        return true;
    }

    /** Dinlemeyi ve beacon'ı durdurur; istenirse aktif bağlantıyı da kapatır. */
    public synchronized void stop(boolean closeActive) {
        running.set(false);
        ServerSocket ls = listenSocket;
        listenSocket = null;
        if (ls != null) {
            try { ls.close(); } catch (IOException ignored) { /* kapanış sessiz */ }
        }
        Thread a = acceptThread;
        acceptThread = null;
        if (a != null) {
            a.interrupt();
            /* Bazı JVM'lerde dinleme soketinin GERÇEK kapanışı accept()'te bekleyen
               iş parçacığı uyanana dek ertelenir; o arada port bağlantı kabul eder.
               Port gerçekten bırakılsın diye kısa süre beklenir (kendi iş
               parçacığından çağrılırsa beklenmez). */
            if (a != Thread.currentThread()) {
                try {
                    a.join(STOP_JOIN_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        Thread b = beaconThread;
        beaconThread = null;
        if (b != null) b.interrupt();
        BeaconSink sink = beaconSink;
        if (sink != null) sink.close();
        if (closeActive) {
            Socket s = activeSocket;
            activeSocket = null;
            closeQuietly(s);
        }
        state = ServerState.STOPPED;
    }

    public void dispose() {
        if (!disposed.compareAndSet(false, true)) return;
        stop(true);
    }

    /** Oturum kapandı → yeni bağlantı kabul edilebilir, beacon yeniden başlar. */
    public void onActiveSessionClosed() {
        Socket s = activeSocket;
        activeSocket = null;
        closeQuietly(s);
        if (running.get() && !disposed.get()) state = ServerState.LISTENING;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kabul döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    private void acceptLoop() {
        while (running.get() && !disposed.get()) {
            ServerSocket server = listenSocket;
            if (server == null) return;
            Socket s;
            try {
                s = server.accept();
            } catch (IOException e) {
                if (!running.get() || disposed.get()) return;   // kasıtlı kapanış
                continue;
            }
            if (!running.get() || disposed.get()) {   // durdurulurken son anda gelen bağlantı
                closeQuietly(s);
                return;
            }

            if (!policy.allows(s.getInetAddress()) || !policy.allows(s.getLocalAddress())) {
                rejectedNonLocalCount++;
                record(LinkDiagnosticEvent.Severity.WARN, "non-local", null, "yerel olmayan baglanti reddedildi");
                closeQuietly(s);
                continue;
            }
            if (activeSocket != null) {
                rejectedSecondClientCount++;
                record(LinkDiagnosticEvent.Severity.WARN, "second-client", null, "ikinci istemci reddedildi");
                closeQuietly(s);
                continue;
            }

            LanChannel.tune(s);
            activeSocket = s;
            acceptedCount++;
            state = ServerState.CLIENT_CONNECTED;
            record(LinkDiagnosticEvent.Severity.INFO, "accept", null, "wifi istemcisi kabul edildi");

            boolean taken = callback != null && callback.onChannelAccepted(new LanChannel(s));
            if (!taken) {
                activeSocket = null;
                if (running.get()) state = ServerState.LISTENING;   // kapatmadan ÖNCE: karşı uç -1 okuyunca durum tutarlı
                closeQuietly(s);
            }
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Beacon — yalnız bağlı telefon YOKKEN
     * ════════════════════════════════════════════════════════════════════ */

    private void beaconLoop() {
        while (running.get() && !disposed.get()) {
            ServerSocket server = listenSocket;
            BeaconSink sink = beaconSink;
            if (server != null && sink != null && activeSocket == null) {
                String hint = hintSource == null ? LanBeacon.NO_HINT : hintSource.hint();
                int sent = sink.send(LanBeacon.encode(server.getLocalPort(), hint));
                if (sent > 0) beaconsSent += sent;
            }
            try {
                Thread.sleep(BEACON_INTERVAL_MS);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Durum
     * ════════════════════════════════════════════════════════════════════ */

    public ServerState state() { return state; }
    public LinkErrorCode lastError() { return lastError; }
    public boolean isRunning() { return running.get(); }
    public boolean hasActiveSocket() { return activeSocket != null; }
    public long acceptedCount() { return acceptedCount; }
    public long rejectedSecondClientCount() { return rejectedSecondClientCount; }
    public long rejectedNonLocalCount() { return rejectedNonLocalCount; }
    public long beaconsSent() { return beaconsSent; }

    /** Dinlenen port; dinlemiyorsa -1. */
    public int port() {
        ServerSocket s = listenSocket;
        return s == null ? -1 : s.getLocalPort();
    }

    /** Telefonun ulaşabileceği yerel adresler (ekranda gösterim için). */
    public List<String> localAddresses() {
        List<String> out = new ArrayList<>();
        for (InetAddress a : LanAddressPolicy.localAddresses(policy)) out.add(a.getHostAddress());
        return out;
    }

    public void resetCounters() {
        acceptedCount = 0L;
        rejectedSecondClientCount = 0L;
        rejectedNonLocalCount = 0L;
        beaconsSent = 0L;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Joker adrese bağlanır (Wi-Fi sonradan açılırsa yeni arayüz de kapsanır);
     * yerel olmayan her bağlantı kabul döngüsünde reddedilir.
     */
    private static ServerSocket bind(int port) {
        ServerSocket ss = null;
        try {
            ss = new ServerSocket();
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(port), 4);
            return ss;
        } catch (IOException e) {
            if (ss != null) {
                try { ss.close(); } catch (IOException ignored) { /* kapanış sessiz */ }
            }
            return null;
        }
    }

    private void record(LinkDiagnosticEvent.Severity severity, String stage, LinkErrorCode code,
                        String details) {
        if (diagnostics == null) return;
        diagnostics.record(clock.nowMs(), LinkDiagnosticEvent.Side.HEAD_UNIT,
            LinkDiagnosticEvent.Category.SOCKET, stage, code, severity, 0L, details);
    }

    private static void closeQuietly(Socket s) {
        if (s == null) return;
        try { s.close(); } catch (IOException ignored) { /* kapanış sessiz */ }
    }

    /** Üretim beacon hedefi: yerel alt ağ yayın adresleri, UDP. */
    static final class UdpBroadcastSink implements BeaconSink {
        private final LanAddressPolicy.Policy policy;
        private DatagramSocket socket;

        UdpBroadcastSink(LanAddressPolicy.Policy policy) {
            this.policy = policy;
        }

        @Override public synchronized int send(byte[] payload) {
            List<InetAddress> targets = LanAddressPolicy.broadcastAddresses(policy);
            if (targets.isEmpty()) return 0;
            try {
                if (socket == null || socket.isClosed()) {
                    socket = new DatagramSocket();
                    socket.setBroadcast(true);
                }
            } catch (IOException e) {
                return 0;
            }
            int n = 0;
            for (InetAddress t : targets) {
                try {
                    socket.send(new DatagramPacket(payload, payload.length, t, LanBeacon.UDP_PORT));
                    n++;
                } catch (IOException ignored) { /* tek hedef düştü — diğerleri sürer */ }
            }
            return n;
        }

        @Override public synchronized void close() {
            if (socket != null) socket.close();
            socket = null;
        }
    }
}
