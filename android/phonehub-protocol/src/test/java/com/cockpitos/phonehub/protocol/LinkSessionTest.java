package com.cockpitos.phonehub.protocol;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * LinkSessionTest — İKİ GERÇEK OTURUM birbirine bağlanır (GÖREV 20).
 *
 * ── NEDEN BU TEST DEĞERLİ ───────────────────────────────────────────────────
 * Burada mock yoktur. İki {@link LinkSession} nesnesi gerçek iş parçacıkları,
 * gerçek çerçeveleme, gerçek AES-GCM ve gerçek el sıkışma ile bir boru
 * (piped stream) üzerinden konuşur. Sahada değişecek TEK şey, boruların yerini
 * bir {@code BluetoothSocket}'in alması olacaktır.
 */
public class LinkSessionTest {

    private static final long WAIT_MS = 15_000L;

    private final List<LinkSession> opened = new CopyOnWriteArrayList<>();

    @After
    public void tearDown() {
        for (LinkSession s : opened) s.close(LinkErrorCode.SOCKET_CLOSED);
        opened.clear();
    }

    /** Olayları toplayan dinleyici. */
    private static final class Collector implements LinkSession.Listener {
        final CountDownLatch established = new CountDownLatch(1);
        final CountDownLatch codeReady = new CountDownLatch(1);
        final CountDownLatch closed = new CountDownLatch(1);
        final List<String> states = new CopyOnWriteArrayList<>();
        final List<String> errors = new CopyOnWriteArrayList<>();
        final List<byte[]> messages = new CopyOnWriteArrayList<>();
        final AtomicReference<String> pairingCode = new AtomicReference<>();
        volatile List<String> granted = Collections.emptyList();

        @Override public void onStateChanged(LinkSession.State s, long g) {
            states.add(s.name());
            if (s == LinkSession.State.CLOSED || s == LinkSession.State.FAILED) closed.countDown();
        }
        @Override public void onApplicationMessage(byte[] p, long g) { messages.add(p); }
        @Override public void onPairingCodeReady(String c, long exp, long g) {
            pairingCode.set(c);
            codeReady.countDown();
        }
        @Override public void onEstablished(List<String> caps, long g) {
            granted = new ArrayList<>(caps);
            established.countDown();
        }
        @Override public void onError(LinkErrorCode c, String d, long g) { errors.add(c.name()); }
    }

    /** Bir çift bağlı oturum. */
    private static final class Pair {
        LinkSession server;
        LinkSession client;
        Collector serverEvents;
        Collector clientEvents;
    }

    private Pair connect(String trustedByClient, String trustedByServer,
                         long heartbeatIntervalMs, long heartbeatTimeoutMs) throws Exception {
        PipedOutputStream clientOut = new PipedOutputStream();
        PipedInputStream serverIn = new PipedInputStream(clientOut, 1 << 16);
        PipedOutputStream serverOut = new PipedOutputStream();
        PipedInputStream clientIn = new PipedInputStream(serverOut, 1 << 16);

        Collector serverEvents = new Collector();
        Collector clientEvents = new Collector();

        LinkSession.Config serverCfg = new LinkSession.Config();
        serverCfg.serverSide = true;
        serverCfg.signer = new InMemoryIdentitySigner();
        serverCfg.capabilities = Arrays.asList("HEALTH", "MEDIA", "CALLS");
        serverCfg.appVersion = "1.0.2";
        serverCfg.trustedPeerFingerprint = trustedByServer;
        serverCfg.side = LinkDiagnosticEvent.Side.HEAD_UNIT;
        serverCfg.listener = serverEvents;
        serverCfg.heartbeatIntervalMs = heartbeatIntervalMs;
        serverCfg.heartbeatTimeoutMs = heartbeatTimeoutMs;

        LinkSession.Config clientCfg = new LinkSession.Config();
        clientCfg.serverSide = false;
        clientCfg.signer = new InMemoryIdentitySigner();
        clientCfg.capabilities = Arrays.asList("HEALTH", "MEDIA", "NOTIFICATIONS");
        clientCfg.appVersion = "1.0.0";
        clientCfg.trustedPeerFingerprint = trustedByClient;
        clientCfg.side = LinkDiagnosticEvent.Side.PHONE;
        clientCfg.listener = clientEvents;
        clientCfg.heartbeatIntervalMs = heartbeatIntervalMs;
        clientCfg.heartbeatTimeoutMs = heartbeatTimeoutMs;

        Pair p = new Pair();
        p.server = new LinkSession(serverCfg, 1L);
        p.client = new LinkSession(clientCfg, 1L);
        p.serverEvents = serverEvents;
        p.clientEvents = clientEvents;
        opened.add(p.server);
        opened.add(p.client);

        assertTrue(p.server.start(serverIn, serverOut));
        assertTrue(p.client.start(clientIn, clientOut));
        return p;
    }

    /** Kullanıcı onayı gereken tam akışı sonuna kadar sürer. */
    private Pair connectAndConfirm() throws Exception {
        Pair p = connect(null, null, 10_000L, 30_000L);

        assertTrue("istemci kodu görmeli",
            p.clientEvents.codeReady.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue("sunucu kodu görmeli",
            p.serverEvents.codeReady.await(WAIT_MS, TimeUnit.MILLISECONDS));

        assertEquals("iki uçtaki kod AYNI olmalı",
            p.clientEvents.pairingCode.get(), p.serverEvents.pairingCode.get());

        assertTrue(p.server.confirmPairing(true));
        assertTrue(p.client.confirmPairing(true));

        assertTrue("istemci oturumu kurulmalı",
            p.clientEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue("sunucu oturumu kurulmalı",
            p.serverEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));
        return p;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Uçtan uca
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void twoSessionsCompleteHandshakeOverStreams() throws Exception {
        Pair p = connectAndConfirm();

        assertEquals(LinkSession.State.CONNECTED, p.client.state());
        assertEquals(LinkSession.State.CONNECTED, p.server.state());
        assertTrue(p.client.snapshot().isTrulyEstablished());
        assertTrue(p.server.snapshot().isTrulyEstablished());
        assertTrue("şifreleme etkin olmalı", p.server.snapshot().encryptionActive);
    }

    @Test
    public void applicationMessagesFlowBothWays() throws Exception {
        Pair p = connectAndConfirm();

        assertTrue(p.client.sendApplicationMessage(
            "{\"from\":\"phone\"}".getBytes(StandardCharsets.UTF_8)));
        assertTrue(p.server.sendApplicationMessage(
            "{\"from\":\"headunit\"}".getBytes(StandardCharsets.UTF_8)));

        assertTrue(waitFor(p.serverEvents.messages, 1));
        assertTrue(waitFor(p.clientEvents.messages, 1));

        assertEquals("{\"from\":\"phone\"}",
            new String(p.serverEvents.messages.get(0), StandardCharsets.UTF_8));
        assertEquals("{\"from\":\"headunit\"}",
            new String(p.clientEvents.messages.get(0), StandardCharsets.UTF_8));
    }

    /** El sıkışma bitmeden uygulama mesajı GÖNDERİLEMEZ. */
    @Test
    public void applicationMessageRejectedBeforeEstablishment() throws Exception {
        Pair p = connect(null, null, 10_000L, 30_000L);
        assertFalse("kurulmamış oturumda gönderim reddedilmeli",
            p.client.sendApplicationMessage("erken".getBytes(StandardCharsets.UTF_8)));
    }

    /** Bu fazda YALNIZ HEALTH granted. */
    @Test
    public void onlyHealthCapabilityIsGranted() throws Exception {
        Pair p = connectAndConfirm();
        assertEquals(Collections.singletonList("HEALTH"), p.serverEvents.granted);
        assertEquals(Collections.singletonList("HEALTH"), p.clientEvents.granted);
        assertFalse(p.server.snapshot().grantedCapabilities.contains("MEDIA"));
    }

    /**
     * ERKEN PEER CONFIRM OTURUMU ÖLDÜRMEMELİ — kütük #678.
     *
     * İki uçta da kullanıcı onayı isteniyorsa onaylar asla aynı anda olmaz; biri
     * önce basar. Önce basanın CONFIRM'ü, henüz onaylamamış uca AWAITING_USER_CONFIRM
     * aşamasındayken ulaşır. Eskiden `LinkHandshake.onConfirm` bu aşamayı kabul
     * etmiyordu → UNKNOWN_ERROR → `failAndClose` → oturum ölüyordu; ikinci kullanıcı
     * kodu onaylamaya fırsat bulamıyordu. CI'da flaky olarak yüzeye çıktı ve düşen
     * assertion her seferinde `client.confirmPairing(true)` idi.
     *
     * BU KİLİT YARIŞA BIRAKILMAZ: istemcinin sunucu CONFIRM'ünü GERÇEKTEN işlediği
     * `framesReceived` sayacıyla ölçülür — "bir süre uyu" ile değil. Böylece kilit
     * kusur geri gelirse HER koşumda ısırır, bazen değil.
     */
    @Test
    public void peerConfirmBeforeLocalUserConfirmDoesNotKillSession() throws Exception {
        final Pair p = connect(null, null, 10_000L, 30_000L);
        assertTrue(p.clientEvents.codeReady.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(p.serverEvents.codeReady.await(WAIT_MS, TimeUnit.MILLISECONDS));

        final long framesBefore = p.client.snapshot().framesReceived;

        /* YALNIZ sunucu onaylar → CONFIRM istemciye gider. */
        assertTrue("sunucu onayi kabul edilmeli", p.server.confirmPairing(true));

        /* Çerçevenin istemci tarafından işlendiği ÖLÇÜLÜR (tahmin edilmez). */
        assertTrue("istemci sunucunun CONFIRM cercevesini islemeli",
            waitUntil(() -> p.client.snapshot().framesReceived > framesBefore));

        /* ESKİ KUSUR TAM BURADAYDI: istemci UNKNOWN_ERROR ile kapanmış olurdu. */
        assertFalse("erken peer CONFIRM oturumu OLDURMEMELI", p.client.isDisposed());
        assertTrue("kullanici onayi HALA bekleniyor olmali",
            p.client.snapshot().awaitingUserConfirm);

        /* ONAY ATLANMAZ: peer confirm tek başına oturumu KURMAMALI. */
        assertFalse("kullanici onaylamadan oturum KURULMAMALI",
            p.clientEvents.established.await(100L, TimeUnit.MILLISECONDS));

        /* Kullanıcı onaylayınca iki uç da kurulur — sıra bağımsızlığı korunur. */
        assertTrue("gec gelen kullanici onayi KABUL EDILMELI", p.client.confirmPairing(true));
        assertTrue(p.clientEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(p.serverEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));
    }
    /* ══════════════════════════════════════════════════════════════════════
     * Kullanıcı reddi
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void userRejectionClosesSession() throws Exception {
        Pair p = connect(null, null, 10_000L, 30_000L);
        assertTrue(p.clientEvents.codeReady.await(WAIT_MS, TimeUnit.MILLISECONDS));

        assertFalse("red oturumu kurmamalı", p.client.confirmPairing(false));
        assertTrue(p.clientEvents.closed.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(p.client.isDisposed());
        assertEquals(LinkErrorCode.PAIRING_REJECTED, p.client.lastError());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kalp atışı
     * ════════════════════════════════════════════════════════════════════ */

    /** Sessiz kalan bağlantı önce DEGRADED, sonra HEARTBEAT_TIMEOUT olur. */
    @Test
    public void heartbeatKeepsSessionAlive() throws Exception {
        Pair p = connect(null, null, 150L, 3_000L);
        /* İKİ ucun da kodu üretmesi beklenir: yalnız istemciyi beklemek yarış
         * yaratır (sunucu henüz AWAITING_USER_CONFIRM'e geçmemiş olabilir). */
        assertTrue(p.clientEvents.codeReady.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(p.serverEvents.codeReady.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(p.server.confirmPairing(true));
        assertTrue(p.client.confirmPairing(true));
        assertTrue(p.clientEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));

        Thread.sleep(900L);

        LinkSessionSnapshot s = p.client.snapshot();
        assertTrue("kalp atışı gönderilmeli", s.heartbeatsSent > 0);
        assertTrue("kalp atışı alınmalı", p.server.snapshot().heartbeatsReceived > 0);
        assertEquals("canlı bağlantı DEGRADED olmamalı",
            LinkSession.State.CONNECTED, p.client.state());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kapanış ve zero-leak
     * ════════════════════════════════════════════════════════════════════ */

    /** close() sonrası iş parçacıkları ÖLMELİ ve dirilmemeli. */
    @Test
    public void closeStopsThreadsAndPreventsResurrection() throws Exception {
        Pair p = connectAndConfirm();
        assertTrue(p.client.snapshot().readerAlive);
        assertTrue(p.client.snapshot().writerAlive);

        p.client.close(LinkErrorCode.SOCKET_CLOSED);

        long deadline = System.currentTimeMillis() + 5_000L;
        while (System.currentTimeMillis() < deadline) {
            LinkSessionSnapshot s = p.client.snapshot();
            if (!s.readerAlive && !s.writerAlive) break;
            Thread.sleep(25L);
        }
        LinkSessionSnapshot after = p.client.snapshot();
        assertFalse("okuyucu iş parçacığı ölmeli", after.readerAlive);
        assertFalse("yazıcı iş parçacığı ölmeli", after.writerAlive);
        assertTrue(after.disposed);

        assertFalse("kapatılmış oturum yeniden başlatılamaz",
            p.client.start(new PipedInputStream(), new PipedOutputStream()));
        assertFalse("kapatılmış oturumda gönderim yok",
            p.client.sendApplicationMessage("x".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void closeIsIdempotent() throws Exception {
        Pair p = connectAndConfirm();
        p.client.close(LinkErrorCode.SOCKET_CLOSED);
        p.client.close(LinkErrorCode.READ_FAILED);
        assertEquals("ilk kapanış nedeni korunmalı",
            LinkErrorCode.SOCKET_CLOSED, p.client.disconnectReason());
    }

    /** Karşı taraf kapanınca bu taraf EOF görüp temiz kapanmalı. */
    @Test
    public void peerCloseIsDetectedAsCleanDisconnect() throws Exception {
        Pair p = connectAndConfirm();
        p.client.close(LinkErrorCode.SOCKET_CLOSED);

        assertTrue("sunucu kopmayı görmeli",
            p.serverEvents.closed.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(p.server.isDisposed());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Anlık görüntü sözleşmesi
     * ════════════════════════════════════════════════════════════════════ */

    /** Sayaç sıfırlama AKTİF bağlantıyı kesmemeli. */
    @Test
    public void resetCountersKeepsSessionAlive() throws Exception {
        Pair p = connectAndConfirm();
        p.client.sendApplicationMessage("bir".getBytes(StandardCharsets.UTF_8));
        assertTrue(waitFor(p.serverEvents.messages, 1));

        p.server.resetCounters();
        assertEquals(0L, p.server.snapshot().framesReceived);
        assertEquals("bağlantı ayakta kalmalı",
            LinkSession.State.CONNECTED, p.server.state());

        p.client.sendApplicationMessage("iki".getBytes(StandardCharsets.UTF_8));
        assertTrue("sıfırlama sonrası mesaj hâlâ akmalı",
            waitFor(p.serverEvents.messages, 2));
    }

    /** Ölçülmemiş süreler 0 değil -1 olmalı (sahte değer yasağı). */
    @Test
    public void unmeasuredDurationsAreMinusOneNotZero() throws Exception {
        Pair p = connect(null, null, 10_000L, 30_000L);
        LinkSessionSnapshot s = p.client.snapshot();
        assertEquals("kurulmamış oturumda süre BİLİNMİYOR olmalı",
            -1L, s.negotiationDurationMs);
        assertFalse(s.isTrulyEstablished());
    }

    /** Anlık görüntüde doğrulama kodu veya anahtar OLMAMALI. */
    @Test
    public void snapshotCarriesNoSecret() throws Exception {
        Pair p = connectAndConfirm();
        String code = p.clientEvents.pairingCode.get();
        assertNotNull(code);

        LinkSessionSnapshot s = p.client.snapshot();
        String dump = s.state + s.handshakeStage + s.peerFingerprint
            + s.peerAppVersion + s.lastErrorCode + s.disconnectReasonCode;
        assertFalse("doğrulama kodu anlık görüntüde görünmemeli", dump.contains(code));
    }

    /** Tanı defterinde doğrulama kodu ASLA yer almamalı. */
    @Test
    public void diagnosticBufferNeverContainsPairingCode() throws Exception {
        Pair p = connectAndConfirm();
        String code = p.clientEvents.pairingCode.get();

        StringBuilder all = new StringBuilder();
        for (LinkDiagnosticEvent e : p.client.diagnostics().snapshot()) {
            all.append(e.toLine()).append('\n');
        }
        assertFalse("kod deftere sızmamalı", all.toString().contains(code));
        assertTrue("defterde olay olmalı", p.client.diagnostics().size() > 0);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Güven kaydı
     * ════════════════════════════════════════════════════════════════════ */

    /** Güvenilen cihazda kullanıcı onayı istenmeden oturum kurulmalı. */
    @Test
    public void trustedPeersEstablishWithoutUserPrompt() throws Exception {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        InMemoryIdentitySigner headUnitId = new InMemoryIdentitySigner();

        PipedOutputStream clientOut = new PipedOutputStream();
        PipedInputStream serverIn = new PipedInputStream(clientOut, 1 << 16);
        PipedOutputStream serverOut = new PipedOutputStream();
        PipedInputStream clientIn = new PipedInputStream(serverOut, 1 << 16);

        Collector serverEvents = new Collector();
        Collector clientEvents = new Collector();

        LinkSession.Config sc = new LinkSession.Config();
        sc.serverSide = true; sc.signer = headUnitId;
        sc.capabilities = Arrays.asList("HEALTH"); sc.appVersion = "1.0.2";
        sc.trustedPeerFingerprint = phoneId.fingerprint();
        sc.listener = serverEvents;

        LinkSession.Config cc = new LinkSession.Config();
        cc.serverSide = false; cc.signer = phoneId;
        cc.capabilities = Arrays.asList("HEALTH"); cc.appVersion = "1.0.0";
        cc.trustedPeerFingerprint = headUnitId.fingerprint();
        cc.listener = clientEvents;

        LinkSession server = new LinkSession(sc, 2L);
        LinkSession client = new LinkSession(cc, 2L);
        opened.add(server);
        opened.add(client);

        assertTrue(server.start(serverIn, serverOut));
        assertTrue(client.start(clientIn, clientOut));

        assertTrue("güvenilen cihazda onaysız kurulmalı",
            clientEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));
        assertTrue(serverEvents.established.await(WAIT_MS, TimeUnit.MILLISECONDS));

        assertEquals("kullanıcıya kod SORULMAMALI", 1L, clientEvents.codeReady.getCount());
        assertTrue(client.snapshot().trustSkipped);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yardımcı
     * ════════════════════════════════════════════════════════════════════ */

    private static boolean waitFor(List<byte[]> list, int expected) throws Exception {
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (list.size() >= expected) return true;
            Thread.sleep(20L);
        }
        return false;
    }

    /** Zamana DEĞİL koşula bağlı bekleme — "yeterince uyu" desenini değiştirir. */
    private interface Cond { boolean ok(); }

    private static boolean waitUntil(Cond c) throws Exception {
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (c.ok()) return true;
            Thread.sleep(5L);
        }
        return c.ok();
    }
}
