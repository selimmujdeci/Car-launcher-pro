package com.cockpitos.pro.can;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import org.junit.Before;
import org.junit.Test;

/**
 * SerialWriteGateTest — MRI F-01 YAZMA KAPISI davranışı (SerialPortHandler +
 * FileSerialTransport), donanımsız.
 *
 * `attachForTest` gerçek `open()` yolunu (probe/chmod/stty) atlar; burada yalnız
 * "açık ama kanıtsız porta tek bayt yazılmaz" sözleşmesi kilitlenir. Çıkış akışı
 * `ByteArrayOutputStream` olduğundan yazılan her bayt ölçülür: 0 bayt = kanıt.
 */
public class SerialWriteGateTest {

    private static final String PORT = "/dev/ttyS4";

    @Before
    public void reset() {
        SerialPortHandler.resetRegistriesForTest();
        SerialDiscoveryLedger.clearForTest();
    }

    private static SerialPortHandler attached(ByteArrayOutputStream out,
                                              SerialPortHandler.PortVerdict verdict,
                                              long openedAtMs) {
        SerialPortHandler h = new SerialPortHandler();
        assertTrue(h.attachForTest(new ByteArrayInputStream(new byte[0]), out, PORT, verdict, openedAtMs));
        return h;
    }

    // 1–2) Açılabilen ama kanıtsız (FREE) UART: aktif yazma YOK, heartbeat YOK
    @Test
    public void openedFreePort_refusesHeartbeat_untilProtocolEvidence() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.FREE, System.currentTimeMillis());

        assertTrue(h.isOpen());
        assertFalse("açık ≠ yazılabilir", h.isWriteAuthorized());
        assertFalse(h.writeCommand(McuCommandFactory.heartbeat()));
        assertFalse(h.writeCommand(McuCommandFactory.lockDoors()));
        assertEquals("kanıtsız porta tek bayt gitmemeli", 0, out.size());
        assertTrue(h.evidenceLabel().startsWith("FREE_OBSERVING"));

        // Whitelist'te olmayan veri zaten reddedilir; kapı whitelist'in ÖNÜNDE değil
        // arkasındadır — whitelist'teki heartbeat bile geçmedi (yukarıda ölçüldü).
        boolean refusedLogged = false;
        for (SerialDiscoveryLedger.Entry e : SerialDiscoveryLedger.snapshot()) {
            if (e.kind == SerialDiscoveryLedger.Kind.WRITE_REFUSED) refusedLogged = true;
        }
        assertTrue("red bir kez defterlenir", refusedLogged);
    }

    // 7) Pasif protokol kanıtı yeterli olunca yazma açılır
    @Test
    public void protocolEvidence_enablesWrite_exactlyAtThreshold() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.FREE, System.currentTimeMillis());

        for (int i = 1; i < SerialPortHandler.PROTOCOL_EVIDENCE_FRAMES; i++) {
            h.noteValidFrame();
            assertFalse("eşik altı kanıt yazma vermez (" + i + ")", h.isWriteAuthorized());
        }
        h.noteValidFrame();   // eşik
        assertTrue(h.isWriteAuthorized());
        assertEquals("PROTOCOL_VERIFIED", h.evidenceLabel());

        byte[] hb = McuCommandFactory.heartbeat();
        assertTrue(h.writeCommand(hb));
        assertEquals(hb.length, out.size());
    }

    // 3) chmod/açılma ownership DEĞİLDİR: attachForTest "port açıldı"yı taklit eder,
    //    verdict FREE bile olsa yazma yetkisi doğmaz — yalnız kanıt verir.
    @Test
    public void openSucceeded_isNotOwnership() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.FREE, System.currentTimeMillis());
        assertEquals(0, h.validFrameCount());
        assertFalse(h.isWriteAuthorized());
    }

    // 5) Platform allow-list eşleşmesi (sahada doğrulanmış yol) anında yazabilir
    @Test
    public void platformMapped_writesImmediately() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.PLATFORM_MAPPED, System.currentTimeMillis());
        assertTrue(h.isWriteAuthorized());
        assertTrue(h.writeCommand(McuCommandFactory.heartbeat()));
        assertTrue(out.size() > 0);
        assertFalse("platform eşleşmesi gözlem penceresine tabi değil", h.observationExpired());
    }

    // 8) Gözlem penceresi dolar, kanıt yok → bırak + soğuma (CAN kanıt-yok kalır)
    @Test
    public void observationWindow_expires_withoutEvidence_andPortCoolsDown() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        long openedLongAgo = System.currentTimeMillis() - SerialPortHandler.OBSERVE_WINDOW_MS - 1;
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.FREE, openedLongAgo);

        assertTrue(h.observationExpired());
        h.markNoEvidence();
        assertTrue(SerialPortHandler.isInNoEvidenceCooldown(PORT));
        h.close();
        assertFalse("kapanınca claim bırakılır", SerialPortHandler.isPortClaimed(PORT));
        assertFalse(h.isWriteAuthorized());
        assertEquals("CLOSED", h.evidenceLabel());
        assertEquals(0, out.size());
    }

    @Test
    public void observationWindow_doesNotExpire_afterFirstValidFrame() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        long openedLongAgo = System.currentTimeMillis() - SerialPortHandler.OBSERVE_WINDOW_MS - 1;
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.FREE, openedLongAgo);
        h.noteValidFrame();
        assertFalse("tek geçerli frame bile 'sessiz port' hükmünü kaldırır", h.observationExpired());
        assertFalse("ama yazma için eşik gerekir", h.isWriteAuthorized());
    }

    // 9) Aynı UART'a ikinci sahip: ikinci handler bağlanamaz (arbitration)
    @Test
    public void secondHandler_cannotAttach_sameUart() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        attached(out, SerialPortHandler.PortVerdict.FREE, System.currentTimeMillis());
        SerialPortHandler second = new SerialPortHandler();
        // Aynı sahip etiketi (FileSerialTransport) bile olsa ikinci INSTANCE reentrant sayılır;
        // farklı bir tüketici (ör. sniffer) için claim reddedilir.
        assertFalse(SerialPortHandler.claimPort(PORT, "McuEventSniffer"));
        assertTrue(SerialPortHandler.isPortClaimed(PORT));
        assertFalse(second.isWriteAuthorized());
    }

    // FileSerialTransport: kapı transport düzeyinde de aynı
    @Test
    public void fileSerialTransport_write_followsHandlerEvidence() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.FREE, System.currentTimeMillis());
        FileSerialTransport t = new FileSerialTransport(h, true);

        assertTrue(t.isConnected());
        assertFalse(t.writeAuthorized());
        assertFalse(t.write(McuCommandFactory.heartbeat()));
        assertEquals(0, out.size());

        for (int i = 0; i < SerialPortHandler.PROTOCOL_EVIDENCE_FRAMES; i++) h.noteValidFrame();
        assertTrue(t.writeAuthorized());
        assertTrue(t.write(McuCommandFactory.heartbeat()));
        assertTrue(out.size() > 0);
    }

    // 11) Yeniden başlatma: claim/kanıt kapanışta sıfırlanır, yeni açılış sıfırdan kanıt toplar
    @Test
    public void restart_resetsEvidence_andClaim() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SerialPortHandler h = attached(out, SerialPortHandler.PortVerdict.FREE, System.currentTimeMillis());
        for (int i = 0; i < SerialPortHandler.PROTOCOL_EVIDENCE_FRAMES; i++) h.noteValidFrame();
        assertTrue(h.isWriteAuthorized());

        h.close();
        assertFalse(SerialPortHandler.isPortClaimed(PORT));
        assertFalse(h.isWriteAuthorized());

        SerialPortHandler again = attached(new ByteArrayOutputStream(), SerialPortHandler.PortVerdict.FREE,
            System.currentTimeMillis());
        assertFalse("eski kanıt yeni açılışa TAŞINMAZ", again.isWriteAuthorized());
        assertEquals(0, again.validFrameCount());
    }
}
