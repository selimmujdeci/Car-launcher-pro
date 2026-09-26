package com.cockpitos.pro.can;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * CanBusManagerWriteGateTest — MRI F-01, orkestratör düzeyi (gerçek okuma
 * thread'iyle, donanımsız sahte transport).
 *
 * Kilitlenen sözleşmeler:
 *   · "bağlandı" ≠ "yazılabilir": sendCommand (= ForegroundService heartbeat'in
 *     tek yolu) kanıtsız transporta tek çağrı bile iletmez.
 *   · Kanıt gelince aynı transport yazar (yeni transport/otorite kurulmaz).
 *   · Gözlem penceresi dolarsa transport BIRAKILIR ve keşif diğer adaya geçer.
 *   · stop()/start() sonrası kapı sıfırdan başlar (yanlış porta miras yok).
 *   · ICanTransport varsayılanı FAIL-CLOSED'dur.
 */
public class CanBusManagerWriteGateTest {

    /** Kontrol edilebilir sahte transport. */
    private static final class FakeTransport implements ICanTransport {
        final String label;
        final AtomicBoolean authorized = new AtomicBoolean(false);
        final AtomicBoolean expired    = new AtomicBoolean(false);
        final AtomicInteger writes     = new AtomicInteger(0);
        final AtomicInteger connects   = new AtomicInteger(0);
        volatile boolean connectable   = true;
        volatile boolean connected     = false;
        volatile List<byte[]> nextFrames = Collections.emptyList();

        FakeTransport(String label) { this.label = label; }

        @Override public boolean connect(int baudRate) {
            connects.incrementAndGet();
            if (!connectable) return false;
            connected = true;
            return true;
        }
        @Override public List<byte[]> readFrames() throws InterruptedException {
            List<byte[]> f = nextFrames;
            nextFrames = Collections.emptyList();
            if (f.isEmpty()) Thread.sleep(10);
            return f;
        }
        @Override public boolean write(byte[] data) { writes.incrementAndGet(); return true; }
        @Override public void disconnect() { connected = false; }
        @Override public boolean isConnected() { return connected; }
        @Override public String name() { return label; }
        @Override public boolean writeAuthorized() { return connected && authorized.get(); }
        @Override public boolean observationExpired() { return connected && expired.get(); }
        @Override public String evidenceLabel() { return authorized.get() ? "FAKE_VERIFIED" : "FAKE_OBSERVING"; }
    }

    private CanBusManager mgr;

    @Before public void setUp() {
        SerialDiscoveryLedger.clearForTest();
        mgr = new CanBusManager();
    }

    @After public void tearDown() { mgr.stop(); }

    private static void waitUntil(java.util.function.BooleanSupplier cond, long timeoutMs) throws InterruptedException {
        /* En az 10 sn (2026-09-25): CI'da 2 sn yük altında yetmedi — aynı commit'te
           bir koşu geçip diğeri "koşul zaman aşımı" ile düştü. Koşul sağlanınca hemen
           çıkılır; süre yalnız BAŞARISIZLIK anını belirler, testin anlamı değişmez. */
        long deadline = System.currentTimeMillis() + Math.max(timeoutMs, 10_000);
        while (!cond.getAsBoolean()) {
            if (System.currentTimeMillis() > deadline) throw new AssertionError("koşul zaman aşımı");
            Thread.sleep(10);
        }
    }

    private static List<ICanTransport> only(ICanTransport... t) {
        List<ICanTransport> l = new ArrayList<>();
        Collections.addAll(l, t);
        return l;
    }

    // 10) Doğrulanmış transport yok → heartbeat (sendCommand) HİÇBİR transporta yazmaz
    @Test
    public void connectedButUnverified_transport_neverReceivesWrites() throws Exception {
        FakeTransport t = new FakeTransport("UART:/dev/ttyS4");
        mgr.setCandidatesForTest(only(t));
        mgr.start(frame -> {}, null, null);
        waitUntil(() -> mgr.openPortPath() != null, 2_000);

        assertEquals(CanBusManager.ConnectionMode.NONE, modeOfFake());   // sahte → NONE (modeOf tanımıyor)
        assertFalse(mgr.isWriteAuthorized());
        for (int i = 0; i < 5; i++) assertFalse(mgr.sendCommand(McuCommandFactory.heartbeat()));
        assertEquals("kanıtsız transporta yazma çağrısı bile gitmemeli", 0, t.writes.get());

        boolean refused = false;
        for (SerialDiscoveryLedger.Entry e : SerialDiscoveryLedger.snapshot()) {
            if (e.kind == SerialDiscoveryLedger.Kind.WRITE_REFUSED) refused = true;
        }
        assertTrue(refused);
    }

    private CanBusManager.ConnectionMode modeOfFake() { return mgr.getConnectionMode(); }

    // 7) Kanıt gelince AYNI transport yazar; VERIFIED_TRANSPORT bir kez defterlenir
    @Test
    public void evidence_enablesWrite_onSameTransport() throws Exception {
        FakeTransport t = new FakeTransport("UART:/dev/ttyS4");
        mgr.setCandidatesForTest(only(t));
        mgr.start(frame -> {}, null, null);
        waitUntil(() -> mgr.openPortPath() != null, 2_000);

        assertFalse(mgr.sendCommand(McuCommandFactory.heartbeat()));
        t.authorized.set(true);
        t.nextFrames = Collections.singletonList(new byte[]{0x01, 0x02});
        waitUntil(() -> mgr.isWriteAuthorized(), 2_000);

        assertTrue(mgr.sendCommand(McuCommandFactory.heartbeat()));
        assertEquals(1, t.writes.get());
        assertEquals("FAKE_VERIFIED", mgr.activeEvidenceLabel());

        waitUntil(() -> {
            for (SerialDiscoveryLedger.Entry e : SerialDiscoveryLedger.snapshot()) {
                if (e.kind == SerialDiscoveryLedger.Kind.VERIFIED_TRANSPORT) return true;
            }
            return false;
        }, 2_000);
    }

    // 8) Gözlem penceresi dolar → transport bırakılır → keşif diğer adaya geçer
    @Test
    public void observationExpiry_releasesTransport_andDiscoveryContinues() throws Exception {
        FakeTransport silent = new FakeTransport("UART:/dev/ttyS4");
        FakeTransport usb    = new FakeTransport("USB");
        usb.connectable = false;                       // ilk turda USB yok
        mgr.setCandidatesForTest(only(silent, usb));
        mgr.start(frame -> {}, null, null);
        waitUntil(() -> "UART:/dev/ttyS4".equals(mgr.openPortPath()), 2_000);

        silent.connectable = false;                    // soğumaya alındı gibi: tekrar bağlanmasın
        silent.expired.set(true);
        waitUntil(() -> !silent.connected, 2_000);
        assertEquals(0, silent.writes.get());
        assertFalse(mgr.isWriteAuthorized());

        usb.connectable = true;                        // bir sonraki keşif turunda USB gelir
        waitUntil(() -> "USB".equals(mgr.openPortPath()), 10_000);

        boolean timeoutLogged = false;
        for (SerialDiscoveryLedger.Entry e : SerialDiscoveryLedger.snapshot()) {
            if (e.kind == SerialDiscoveryLedger.Kind.SELECTED_TRANSPORT && "USB".equals(e.subject)) timeoutLogged = true;
        }
        assertTrue("yeni aday SELECTED_TRANSPORT olarak defterlenmeli", timeoutLogged);
    }

    // 11) stop()/start(): kapı sıfırdan, eski yetki miras kalmaz
    @Test
    public void restart_doesNotInheritWriteAuthorization() throws Exception {
        FakeTransport t = new FakeTransport("UART:/dev/ttyS4");
        t.authorized.set(true);
        mgr.setCandidatesForTest(only(t));
        mgr.start(frame -> {}, null, null);
        waitUntil(() -> mgr.isWriteAuthorized(), 2_000);
        mgr.stop();
        assertFalse(t.connected);
        assertFalse("durmuş yöneticide yazma yetkisi yok", mgr.isWriteAuthorized());
        assertFalse(mgr.sendCommand(McuCommandFactory.heartbeat()));

        FakeTransport fresh = new FakeTransport("UART:/dev/ttyS4");   // kanıtsız yeni açılış
        mgr.setCandidatesForTest(only(fresh));
        mgr.start(frame -> {}, null, null);
        waitUntil(() -> mgr.openPortPath() != null, 2_000);
        assertFalse("yeni açılış eski kanıtı miras almaz", mgr.isWriteAuthorized());
        assertEquals(0, fresh.writes.get());
    }

    // ICanTransport varsayılanı fail-closed: override etmeyen transport yazamaz
    @Test
    public void transportDefault_isFailClosed() {
        ICanTransport minimal = new ICanTransport() {
            @Override public boolean connect(int baudRate) { return true; }
            @Override public List<byte[]> readFrames() { return Collections.emptyList(); }
            @Override public boolean write(byte[] data) { return true; }
            @Override public void disconnect() {}
            @Override public boolean isConnected() { return true; }
            @Override public String name() { return "MINIMAL"; }
        };
        assertFalse(minimal.writeAuthorized());
        assertFalse(minimal.observationExpired());
        assertEquals("NONE", minimal.evidenceLabel());
    }
}
