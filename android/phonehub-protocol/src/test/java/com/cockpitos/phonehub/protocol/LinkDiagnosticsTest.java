package com.cockpitos.phonehub.protocol;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/**
 * LinkDiagnosticsTest — tanı defterinin sınırları ve gizlilik süzgeci
 * (GÖREV 16 / GÖREV 20).
 */
public class LinkDiagnosticsTest {

    private static LinkDiagnosticEvent event(long t, String details) {
        return new LinkDiagnosticEvent(t, LinkDiagnosticEvent.Side.HEAD_UNIT,
            LinkDiagnosticEvent.Category.SOCKET, "accept", LinkErrorCode.SOCKET_CLOSED,
            LinkDiagnosticEvent.Severity.WARN, 3L, details);
    }

    /* ── Sınırlılık ───────────────────────────────────────────────────── */

    @Test
    public void bufferIsBoundedAndCountsDrops() {
        LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer(10);
        for (int i = 0; i < 25; i++) buf.record(event(i, "olay-" + i));

        assertEquals("kapasite aşılamaz", 10, buf.size());
        assertEquals("düşen olaylar SAYILMALI", 15L, buf.droppedCount());
        assertEquals(25L, buf.totalRecorded());
    }

    @Test
    public void recentReturnsNewestFirstAndIsBounded() {
        LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer(50);
        for (int i = 0; i < 10; i++) buf.record(event(i, "olay-" + i));

        List<LinkDiagnosticEvent> recent = buf.recent(3);
        assertEquals(3, recent.size());
        assertEquals(9L, recent.get(0).timestampMs());
        assertEquals(7L, recent.get(2).timestampMs());
        assertEquals("limit boyutu aşamaz", 10, buf.recent(999).size());
    }

    @Test
    public void clearResetsEverything() {
        LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer(5);
        for (int i = 0; i < 12; i++) buf.record(event(i, "x"));
        buf.clear();
        assertEquals(0, buf.size());
        assertEquals(0L, buf.droppedCount());
        assertEquals(0L, buf.totalRecorded());
    }

    /* ── Gizlilik süzgeci ─────────────────────────────────────────────── */

    @Test
    public void macAddressIsRedacted() {
        LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer();
        buf.record(event(1L, "cihaz AA:BB:CC:DD:EE:FF bağlandı"));

        LinkDiagnosticEvent stored = buf.snapshot().get(0);
        assertEquals("[REDACTED]", stored.safeDetails());
        assertEquals("olay kaybolmamalı, yalnız ayrıntısı maskelenmeli",
            LinkErrorCode.SOCKET_CLOSED, stored.code());
        assertEquals(1L, buf.redactedCount());
    }

    @Test
    public void pairingCodeLikeDigitsAreRedacted() {
        LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer();
        buf.record(event(1L, "kullanıcı 428193 girdi"));
        assertEquals("[REDACTED]", buf.snapshot().get(0).safeDetails());
    }

    @Test
    public void longHexBlobIsRedacted() {
        LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer();
        buf.record(event(1L, "anahtar 0a1b2c3d4e5f60718293a4b5c6d7e8f9 üretildi"));
        assertEquals("[REDACTED]", buf.snapshot().get(0).safeDetails());
    }

    @Test
    public void forbiddenKeywordsAreRedacted() {
        String[] samples = {
            "phone alanı okundu", "sessionKey türetildi", "bearer eklendi",
            "nonce yazıldı", "SSID alındı", "contact listesi",
        };
        for (String s : samples) {
            LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer();
            buf.record(event(1L, s));
            assertEquals("maskelenmeliydi: " + s,
                "[REDACTED]", buf.snapshot().get(0).safeDetails());
        }
    }

    /** Zararsız teknik ayrıntı KORUNMALI — süzgeç her şeyi silmemeli. */
    @Test
    public void harmlessTechnicalDetailIsKept() {
        String[] safe = {
            "accept timeout 30s", "read loop durdu", "queue derinligi 3",
            "backoff 4s", "protokol v1",
        };
        for (String s : safe) {
            LinkDiagnosticBuffer buf = new LinkDiagnosticBuffer();
            buf.record(event(1L, s));
            assertEquals("gereksiz maskelendi: " + s, s, buf.snapshot().get(0).safeDetails());
        }
        assertFalse(LinkDiagnosticBuffer.looksSensitive("accept timeout 30s"));
    }

    /** Olay satırı dışa aktarılabilir olmalı ve kodu taşımalı. */
    @Test
    public void exportLineCarriesStructuredFields() {
        LinkDiagnosticEvent e = event(1234L, "read loop durdu");
        String line = e.toLine();
        assertTrue(line.contains("HEAD_UNIT"));
        assertTrue(line.contains("SOCKET"));
        assertTrue(line.contains("SOCKET_CLOSED"));
        assertTrue(line.contains("g3"));
    }

    /** Ayrıntı tavanı aşılırsa kırpılır (sınırsız metin yok). */
    @Test
    public void detailsAreClamped() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 500; i++) sb.append('a');
        LinkDiagnosticEvent e = event(1L, sb.toString());
        assertEquals(LinkDiagnosticEvent.MAX_DETAIL_CHARS, e.safeDetails().length());
    }

    /* ── UUID otoritesi ───────────────────────────────────────────────── */

    /** Phone Hub UUID'si OBD'nin SPP'sinden FARKLI olmalı (GÖREV 17). */
    @Test
    public void phoneHubUuidIsDistinctFromObdSpp() {
        assertTrue(PhoneHubUuid.isDistinctFromObdSpp());
        assertFalse(PhoneHubUuid.SERVICE_UUID_STRING
            .equalsIgnoreCase(PhoneHubUuid.RESERVED_SPP_UUID));
        assertEquals(PhoneHubUuid.SERVICE_UUID_STRING,
            PhoneHubUuid.serviceUuid().toString());
    }

    /** Servis adı PII taşımamalı. */
    @Test
    public void serviceNameCarriesNoPii() {
        assertEquals("CarOS Phone Hub", PhoneHubUuid.SERVICE_NAME);
    }

    /* ── Hata kodu sözleşmesi (GÖREV 15) ──────────────────────────────── */

    @Test
    public void reconnectPolicyIsFailClosed() {
        assertTrue(LinkErrorCode.SOCKET_CLOSED.isReconnectable());
        assertTrue(LinkErrorCode.CLIENT_CONNECT_TIMEOUT.isReconnectable());
        assertTrue(LinkErrorCode.HEARTBEAT_TIMEOUT.isReconnectable());

        assertFalse("izin reddinde yeniden denenmemeli",
            LinkErrorCode.BLUETOOTH_PERMISSION_DENIED.isReconnectable());
        assertFalse("protokol uyuşmazlığında yeniden denenmemeli",
            LinkErrorCode.PROTOCOL_VERSION_MISMATCH.isReconnectable());
        assertFalse("eşleştirme reddinde yeniden denenmemeli",
            LinkErrorCode.PAIRING_REJECTED.isReconnectable());
        assertFalse("güven uyuşmazlığında yeniden denenmemeli",
            LinkErrorCode.TRUSTED_PEER_MISMATCH.isReconnectable());
        assertFalse(LinkErrorCode.RECONNECT_EXHAUSTED.isReconnectable());
    }

    @Test
    public void securityEventsAreClassified() {
        assertTrue(LinkErrorCode.DECRYPTION_FAILED.isSecurityEvent());
        assertTrue(LinkErrorCode.REPLAY_REJECTED.isSecurityEvent());
        assertTrue(LinkErrorCode.TRUSTED_PEER_MISMATCH.isSecurityEvent());
        assertFalse(LinkErrorCode.SOCKET_CLOSED.isSecurityEvent());
    }

    @Test
    public void everyErrorCodeHasUserMessage() {
        for (LinkErrorCode c : LinkErrorCode.values()) {
            assertTrue("kullanıcı mesajı boş: " + c,
                c.userMessage() != null && !c.userMessage().isEmpty());
        }
    }

    @Test
    public void unknownErrorNameFallsBackSafely() {
        assertEquals(LinkErrorCode.UNKNOWN_ERROR, LinkErrorCode.fromName("YOK_BOYLE_KOD"));
        assertEquals(LinkErrorCode.UNKNOWN_ERROR, LinkErrorCode.fromName(null));
        assertEquals(LinkErrorCode.SOCKET_CLOSED, LinkErrorCode.fromName("SOCKET_CLOSED"));
    }
}
