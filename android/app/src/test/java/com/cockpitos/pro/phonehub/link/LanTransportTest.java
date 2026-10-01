package com.cockpitos.pro.phonehub.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.cockpitos.phonehub.protocol.LinkDiagnosticBuffer;
import com.cockpitos.phonehub.protocol.LinkDiagnosticEvent;
import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.cockpitos.phonehub.protocol.LinkIdentitySigner;
import com.cockpitos.phonehub.protocol.LinkKeyExchange;
import com.cockpitos.phonehub.protocol.LinkSession;

import org.junit.After;
import org.junit.Test;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.Signature;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * LanTransportTest — Phone Link'in yerel Wi-Fi yolu (gerçek soketler, JVM).
 *
 * Üretim politikası yalnız özel/bağlantı-yerel IPv4'e izin verir; test
 * makinesinde yalnız loopback olduğu için sunucu/istemci testleri loopback'i
 * de kabul eden bir TEST politikasıyla koşar. Üretim politikasının loopback'i
 * REDDETTİĞİ ayrıca kilitlenir.
 */
public class LanTransportTest {

    private static final long WAIT_MS = 8_000L;

    /** Test politikası: üretim kuralı + loopback. */
    private static final LanAddressPolicy.Policy LOOPBACK_OK = new LanAddressPolicy.Policy() {
        @Override public boolean allows(InetAddress a) {
            return a != null && (a.isLoopbackAddress() || LanAddressPolicy.isLocal(a));
        }
    };

    private final List<Runnable> cleanup = new ArrayList<>();

    @After
    public void tearDown() {
        for (Runnable r : cleanup) {
            try { r.run(); } catch (RuntimeException ignored) { /* temizlik */ }
        }
        cleanup.clear();
    }

    /* ══════════════════════════════════════════════════════════════════════
     * A · Beacon biçimi
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void beaconRoundTrip() {
        byte[] b = LanBeacon.encode(47652, "a1b2c3d4");
        LanBeacon.Parsed p = LanBeacon.parse(b, b.length);
        assertNotNull(p);
        assertEquals(47652, p.tcpPort);
        assertEquals("a1b2c3d4", p.idHint);
        assertTrue(b.length <= LanBeacon.MAX_BYTES);
    }

    @Test
    public void beaconRejectsForeignOrBrokenPackets() {
        assertNull(parse("CAROSHUB 2 47652 a1b2c3d4"));       // sürüm
        assertNull(parse("NOTCAROS 1 47652 a1b2c3d4"));       // imza
        assertNull(parse("CAROSHUB 1 0 a1b2c3d4"));           // port
        assertNull(parse("CAROSHUB 1 70000 a1b2c3d4"));
        assertNull(parse("CAROSHUB 1 abc a1b2c3d4"));
        assertNull(parse("CAROSHUB 1 47652 ZZZZZZZZ"));       // ipucu biçimi
        assertNull(parse("CAROSHUB 1 47652"));                // eksik alan
        assertNull(LanBeacon.parse(new byte[200], 200));      // aşırı uzun
        assertNotNull(parse("CAROSHUB 1 47652 -"));            // ipucu yok = geçerli
    }

    @Test
    public void beaconHintNeverInventsIdentity() {
        assertEquals("0123abcd", LanBeacon.hintOf("0123ABCDffffffffffffffffffffffff"));
        assertEquals(LanBeacon.NO_HINT, LanBeacon.hintOf(null));
        assertEquals(LanBeacon.NO_HINT, LanBeacon.hintOf("xyz"));
        /* Bozuk ipucu kodlanırken yer tutucuya düşer, uydurulmaz. */
        String s = new String(LanBeacon.encode(1234, "not-hex!"), StandardCharsets.US_ASCII);
        assertEquals("CAROSHUB 1 1234 -", s);
    }

    private static LanBeacon.Parsed parse(String s) {
        byte[] b = s.getBytes(StandardCharsets.US_ASCII);
        return LanBeacon.parse(b, b.length);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * B · Yalnız yerel adres
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void productionPolicyAllowsOnlyPrivateAndLinkLocalIpv4() throws Exception {
        String[] allowed = { "192.168.43.1", "10.0.0.5", "172.16.0.1", "172.31.255.254", "169.254.10.1" };
        String[] denied = {
            "127.0.0.1", "0.0.0.0", "8.8.8.8", "100.64.1.1", "172.32.0.1",
            "224.0.0.251", "255.255.255.255", "::1", "fe80::1",
        };
        for (String a : allowed) {
            assertTrue(a, LanAddressPolicy.isLocal(InetAddress.getByName(a)));
        }
        for (String d : denied) {
            assertFalse(d, LanAddressPolicy.isLocal(InetAddress.getByName(d)));
        }
    }

    @Test
    public void clientNeverOpensSocketToNonLocalAddress() throws Exception {
        try {
            LanClientConnector.connect(InetAddress.getByName("8.8.8.8"), 443, 500,
                LanAddressPolicy.LOCAL_ONLY);
            fail("yerel olmayan adrese bağlanılmamalı");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("yerel olmayan"));
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * C · Sunucu: kabul, ret, beacon
     * ════════════════════════════════════════════════════════════════════ */

    private static final class SinkCollector implements LanServerTransport.BeaconSink {
        final List<String> payloads = new CopyOnWriteArrayList<>();
        @Override public int send(byte[] payload) {
            payloads.add(new String(payload, StandardCharsets.US_ASCII));
            return 1;
        }
        @Override public void close() { }
    }

    private static class Accepting implements LanServerTransport.Callback {
        final List<PhoneHubChannel> channels = new CopyOnWriteArrayList<>();
        final CountDownLatch first = new CountDownLatch(1);
        volatile boolean take = true;
        @Override public boolean onChannelAccepted(PhoneHubChannel channel) {
            if (!take) return false;
            channels.add(channel);
            first.countDown();
            return true;
        }
    }

    private LanServerTransport server(LanAddressPolicy.Policy policy, Accepting cb, SinkCollector sink) {
        final LanServerTransport t = new LanServerTransport(new LinkDiagnosticBuffer(),
            LinkSession.SYSTEM_CLOCK, policy,
            new LanServerTransport.HintSource() { @Override public String hint() { return "0123abcd"; } },
            cb, 0, sink);
        cleanup.add(new Runnable() { @Override public void run() { t.dispose(); } });
        return t;
    }

    @Test
    public void acceptsLocalClientAndBeaconsOnlyWhileFree() throws Exception {
        SinkCollector sink = new SinkCollector();
        Accepting cb = new Accepting();
        LanServerTransport t = server(LOOPBACK_OK, cb, sink);
        assertTrue(t.start());
        int port = t.port();
        assertTrue(port > 0);
        assertEquals(LanServerTransport.ServerState.LISTENING, t.state());

        waitUntil(new Check() { @Override public boolean ok() { return !sink.payloads.isEmpty(); } });
        assertEquals("CAROSHUB 1 " + port + " 0123abcd", sink.payloads.get(0));

        PhoneHubChannel client = LanClientConnector.connect(InetAddress.getLoopbackAddress(), port,
            2_000, LOOPBACK_OK);
        cleanupChannel(client);
        assertTrue(cb.first.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertEquals(PhoneHubChannel.Transport.WIFI, cb.channels.get(0).transport());
        assertEquals(LanServerTransport.ServerState.CLIENT_CONNECTED, t.state());

        /* Bağlı telefon varken beacon SUSAR. */
        int before = sink.payloads.size();
        Thread.sleep(LanServerTransport.BEACON_INTERVAL_MS + 600L);
        assertTrue("bağlıyken en fazla bir geç beacon", sink.payloads.size() <= before + 1);

        /* Oturum kapanınca yeniden dinlemeye ve beacon'a döner. */
        t.onActiveSessionClosed();
        assertEquals(LanServerTransport.ServerState.LISTENING, t.state());
        final int after = sink.payloads.size();
        waitUntil(new Check() { @Override public boolean ok() { return sink.payloads.size() > after; } });
    }

    @Test
    public void secondClientIsRejectedWithoutDisturbingFirst() throws Exception {
        Accepting cb = new Accepting();
        LanServerTransport t = server(LOOPBACK_OK, cb, new SinkCollector());
        assertTrue(t.start());
        PhoneHubChannel a = LanClientConnector.connect(InetAddress.getLoopbackAddress(), t.port(), 2_000, LOOPBACK_OK);
        cleanupChannel(a);
        assertTrue(cb.first.await(WAIT_MS, TimeUnit.MILLISECONDS));

        PhoneHubChannel b = LanClientConnector.connect(InetAddress.getLoopbackAddress(), t.port(), 2_000, LOOPBACK_OK);
        cleanupChannel(b);
        assertEquals("ikinci soket sunucu tarafından kapatılmalı", -1, b.input().read());
        assertEquals(1L, t.rejectedSecondClientCount());
        assertEquals(1, cb.channels.size());
        assertTrue(t.hasActiveSocket());
    }

    @Test
    public void productionServerRejectsNonLocalPeer() throws Exception {
        final Accepting cb = new Accepting();
        final LanServerTransport t = server(LanAddressPolicy.LOCAL_ONLY, cb, new SinkCollector());
        assertTrue(t.start());
        PhoneHubChannel c = LanClientConnector.connect(InetAddress.getLoopbackAddress(), t.port(), 2_000, LOOPBACK_OK);
        cleanupChannel(c);
        assertEquals("loopback (yerel ağ değil) reddedilmeli", -1, c.input().read());
        waitUntil(new Check() { @Override public boolean ok() { return t.rejectedNonLocalCount() == 1L; } });
        assertTrue(cb.channels.isEmpty());
    }

    @Test
    public void refusedChannelIsClosedAndServerKeepsListening() throws Exception {
        Accepting cb = new Accepting();
        cb.take = false;   // controller: başka taşımada oturum var
        LanServerTransport t = server(LOOPBACK_OK, cb, new SinkCollector());
        assertTrue(t.start());
        PhoneHubChannel c = LanClientConnector.connect(InetAddress.getLoopbackAddress(), t.port(), 2_000, LOOPBACK_OK);
        cleanupChannel(c);
        assertEquals(-1, c.input().read());
        assertFalse(t.hasActiveSocket());
        assertEquals(LanServerTransport.ServerState.LISTENING, t.state());
    }

    @Test
    public void stopReleasesPort() throws Exception {
        LanServerTransport t = server(LOOPBACK_OK, new Accepting(), new SinkCollector());
        assertTrue(t.start());
        int port = t.port();
        t.stop(true);
        assertEquals(-1, t.port());
        assertFalse(t.isRunning());
        try {
            LanClientConnector.connect(InetAddress.getLoopbackAddress(), port, 1_000, LOOPBACK_OK);
            fail("durdurulan sunucu bağlantı kabul etmemeli");
        } catch (IOException expected) { /* beklenen */ }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * D · Telefon: beacon keşfi
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void clientFindsCarFromBeaconAndPrefersTrustedHint() throws Exception {
        final DatagramSocket rx = LanClientConnector.openBeaconSocket(0);
        cleanup.add(new Runnable() { @Override public void run() { rx.close(); } });
        int rxPort = rx.getLocalPort();
        DatagramSocket tx = new DatagramSocket();
        try {
            send(tx, "çöp paket", rxPort);
            send(tx, "CAROSHUB 1 5000 ffffffff", rxPort);   // başka araç
            send(tx, "CAROSHUB 1 6000 0123abcd", rxPort);   // güvenilen araç
        } finally {
            tx.close();
        }
        LanClientConnector.Found f = LanClientConnector.awaitBeacon(rx, 2_000, LOOPBACK_OK, "0123abcd");
        assertNotNull(f);
        assertEquals(6000, f.port);
        assertEquals("0123abcd", f.idHint);
        assertTrue(f.host.isLoopbackAddress());
    }

    @Test
    public void clientIgnoresBeaconFromNonLocalSender() throws Exception {
        final DatagramSocket rx = LanClientConnector.openBeaconSocket(0);
        cleanup.add(new Runnable() { @Override public void run() { rx.close(); } });
        DatagramSocket tx = new DatagramSocket();
        try {
            send(tx, "CAROSHUB 1 6000 0123abcd", rx.getLocalPort());
        } finally {
            tx.close();
        }
        assertNull("loopback gönderici üretim politikasında yok sayılmalı",
            LanClientConnector.awaitBeacon(rx, 700, LanAddressPolicy.LOCAL_ONLY, null));
    }

    private static void send(DatagramSocket tx, String s, int port) throws IOException {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        tx.send(new DatagramPacket(b, b.length, InetAddress.getLoopbackAddress(), port));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * E · Uçtan uca: Wi-Fi üzerinden AYNI şifreli el sıkışma + kod onayı
     * ════════════════════════════════════════════════════════════════════ */

    private static final class TestSigner implements LinkIdentitySigner {
        private final KeyPair kp;
        TestSigner() {
            try {
                kp = LinkKeyExchange.generateEphemeralKeyPair();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        @Override public byte[] identityPublicKeySpki() { return kp.getPublic().getEncoded(); }
        @Override public boolean isHardwareBacked() { return false; }
        @Override public byte[] sign(byte[] data) {
            try {
                Signature s = Signature.getInstance(LinkKeyExchange.SIGNATURE_ALGORITHM);
                s.initSign(kp.getPrivate());
                s.update(data);
                return s.sign();
            } catch (Exception e) {
                return null;
            }
        }
    }

    private static final class Events implements LinkSession.Listener {
        final CountDownLatch code = new CountDownLatch(1);
        final CountDownLatch established = new CountDownLatch(1);
        final CountDownLatch message = new CountDownLatch(1);
        final AtomicReference<String> pairingCode = new AtomicReference<>();
        final AtomicReference<String> lastMessage = new AtomicReference<>();
        @Override public void onPairingCodeReady(String c, long exp, long g) { pairingCode.set(c); code.countDown(); }
        @Override public void onEstablished(List<String> caps, long g) { established.countDown(); }
        @Override public void onApplicationMessage(byte[] p, long g) {
            lastMessage.set(new String(p, StandardCharsets.UTF_8));
            message.countDown();
        }
        @Override public void onStateChanged(LinkSession.State s, long g) { }
        @Override public void onError(LinkErrorCode c, String d, long g) { }
    }

    private static LinkSession.Config cfg(boolean serverSide, Events events) {
        LinkSession.Config c = new LinkSession.Config();
        c.serverSide = serverSide;
        c.signer = new TestSigner();
        c.capabilities = Arrays.asList("HEALTH");
        c.appVersion = "test";
        c.side = serverSide ? LinkDiagnosticEvent.Side.HEAD_UNIT : LinkDiagnosticEvent.Side.PHONE;
        c.listener = events;
        return c;
    }

    @Test
    public void fullEncryptedHandshakeOverWifi() throws Exception {
        final Events serverEvents = new Events();
        final AtomicReference<LinkSession> serverSession = new AtomicReference<>();
        LanServerTransport t = server(LOOPBACK_OK, new Accepting() {
            @Override public boolean onChannelAccepted(PhoneHubChannel channel) {
                LinkSession s = new LinkSession(cfg(true, serverEvents), 1L);
                serverSession.set(s);
                try {
                    return s.start(channel.input(), channel.output());
                } catch (IOException e) {
                    return false;
                }
            }
        }, new SinkCollector());
        assertTrue(t.start());

        Events clientEvents = new Events();
        PhoneHubChannel ch = LanClientConnector.connect(InetAddress.getLoopbackAddress(), t.port(), 2_000, LOOPBACK_OK);
        final LinkSession client = new LinkSession(cfg(false, clientEvents), 1L);
        cleanup.add(new Runnable() { @Override public void run() { client.close(LinkErrorCode.SOCKET_CLOSED); } });
        assertTrue(client.start(ch.input(), ch.output()));

        assertTrue("telefon kodu görmeli", clientEvents.code.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue("araç kodu görmeli", serverEvents.code.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertEquals("iki ekrandaki kod AYNI olmalı (MITM yok)",
            clientEvents.pairingCode.get(), serverEvents.pairingCode.get());

        final LinkSession server = serverSession.get();
        cleanup.add(new Runnable() { @Override public void run() { server.close(LinkErrorCode.SOCKET_CLOSED); } });
        assertTrue(server.confirmPairing(true));
        assertTrue(client.confirmPairing(true));
        assertTrue(clientEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(serverEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(client.snapshot().encryptionActive);

        assertTrue(client.sendApplicationMessage("{\"t\":\"nav\"}".getBytes(StandardCharsets.UTF_8)));
        assertTrue(serverEvents.message.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertEquals("{\"t\":\"nav\"}", serverEvents.lastMessage.get());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yardımcılar
     * ════════════════════════════════════════════════════════════════════ */

    private interface Check { boolean ok(); }

    private static void waitUntil(Check c) throws InterruptedException {
        long end = System.currentTimeMillis() + WAIT_MS;
        while (System.currentTimeMillis() < end) {
            if (c.ok()) return;
            Thread.sleep(20L);
        }
        fail("koşul süre içinde sağlanmadı");
    }

    private void cleanupChannel(final PhoneHubChannel ch) {
        cleanup.add(new Runnable() { @Override public void run() { ch.closeQuietly(); } });
    }
}
