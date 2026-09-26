package com.cockpitos.pro.phonehub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.cockpitos.phonehub.protocol.LinkSession;
import com.cockpitos.pro.phonehub.link.PhoneHubLinkStateMapping;
import com.cockpitos.pro.phonehub.link.PhoneHubLinkStateMapping.LinkState;
import com.cockpitos.pro.phonehub.link.PhoneHubLinkStateMapping.LinkStateReason;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * PhoneHubLinkStateEventTest — PHONE LINK F4.1/F4.18 · kanonik lifecycle olayı.
 *
 * Eşleme SAF olduğu için Android framework'ü olmadan, düz JVM'de sürülür —
 * cihaz gerektiren yüzey BÜYÜMEZ (F4.18 kuralı).
 */
public class PhoneHubLinkStateEventTest {

    private static final String LINK_DIR =
        "src/main/java/com/cockpitos/pro/phonehub/link/";

    private static String read(String fileName) throws IOException {
        File f = new File(LINK_DIR + fileName);
        assertTrue("kaynak bulunamadı: " + f.getPath(), f.isFile());
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }

    /* ── Durum eşlemesi ─────────────────────────────────────────────────── */

    /** Yalnız CONNECTED kanonik ESTABLISHED üretir. */
    @Test
    public void establishedOnlyFromConnected() {
        assertEquals(LinkState.ESTABLISHED,
            PhoneHubLinkStateMapping.toLinkState(LinkSession.State.CONNECTED));
        for (LinkSession.State s : LinkSession.State.values()) {
            if (s == LinkSession.State.CONNECTED) continue;
            assertFalse("ESTABLISHED yalnız CONNECTED'dan gelmeli: " + s,
                PhoneHubLinkStateMapping.toLinkState(s) == LinkState.ESTABLISHED);
        }
    }

    /** FAIL-CLOSED: kapanış BAŞLADIĞI anda durum DISCONNECTED olur. */
    @Test
    public void closingAndClosedAreImmediatelyDisconnected() {
        assertEquals(LinkState.DISCONNECTED,
            PhoneHubLinkStateMapping.toLinkState(LinkSession.State.CLOSING));
        assertEquals(LinkState.DISCONNECTED,
            PhoneHubLinkStateMapping.toLinkState(LinkSession.State.CLOSED));
        assertEquals(LinkState.DISCONNECTED,
            PhoneHubLinkStateMapping.toLinkState(LinkSession.State.IDLE));
        assertEquals(LinkState.DISCONNECTED, PhoneHubLinkStateMapping.toLinkState(null));
    }

    /** DEGRADED katlanmaz — TS'in kanonik hükmüyle çelişmemesi için. */
    @Test
    public void degradedIsNotFoldedIntoEstablished() {
        assertEquals(LinkState.DEGRADED,
            PhoneHubLinkStateMapping.toLinkState(LinkSession.State.DEGRADED));
        assertFalse(PhoneHubLinkStateMapping.isAuthoritativeState(LinkState.DEGRADED));
    }

    /** Yetki YALNIZ ESTABLISHED'da verilebilir. */
    @Test
    public void onlyEstablishedIsAuthoritative() {
        for (LinkState s : LinkState.values()) {
            assertEquals("yetki eşiği yalnız ESTABLISHED: " + s,
                s == LinkState.ESTABLISHED, PhoneHubLinkStateMapping.isAuthoritativeState(s));
        }
    }

    /** Eşleme TAM: her native durumun bir kanonik karşılığı var. */
    @Test
    public void everyNativeStateMapsToSomething() {
        for (LinkSession.State s : LinkSession.State.values()) {
            assertNotNull("eşlenmemiş durum: " + s, PhoneHubLinkStateMapping.toLinkState(s));
        }
    }

    /* ── Gerekçe eşlemesi ───────────────────────────────────────────────── */

    /** Her hata kodu SINIRLI bir kategoriye düşer; UNKNOWN sızıntısı yok. */
    @Test
    public void everyErrorCodeMapsToBoundedReason() {
        /* Yalnız GERÇEKTEN sınıflandırılamayan iki kod UNKNOWN kalabilir —
         * geri kalan her kod sınırlı bir kategoriye düşmelidir. */
        for (LinkErrorCode code : LinkErrorCode.values()) {
            LinkStateReason reason = PhoneHubLinkStateMapping.toReason(code);
            assertNotNull("eşlenmemiş hata kodu: " + code, reason);
            if (code == LinkErrorCode.UNKNOWN_ERROR || code == LinkErrorCode.FIELD_TEST_REQUIRED) {
                assertEquals(LinkStateReason.UNKNOWN, reason);
                continue;
            }
            assertFalse("her kod sınıflandırılmalı: " + code, reason == LinkStateReason.UNKNOWN);
        }
        assertEquals(LinkStateReason.UNKNOWN, PhoneHubLinkStateMapping.toReason(null));
        assertEquals(LinkStateReason.SESSION_REPLACED,
            PhoneHubLinkStateMapping.toReason(LinkErrorCode.SESSION_GENERATION_STALE));
    }

    /** Güvenlik ayrıntısı kategoriye GÖMÜLÜR — kodun kendisi taşınmaz. */
    @Test
    public void securityCodesCollapseToAuthFailed() {
        assertEquals(LinkStateReason.AUTH_FAILED,
            PhoneHubLinkStateMapping.toReason(LinkErrorCode.DECRYPTION_FAILED));
        assertEquals(LinkStateReason.AUTH_FAILED,
            PhoneHubLinkStateMapping.toReason(LinkErrorCode.REPLAY_REJECTED));
        assertEquals(LinkStateReason.AUTH_FAILED,
            PhoneHubLinkStateMapping.toReason(LinkErrorCode.TRUSTED_PEER_MISMATCH));
    }

    /* ── Olay yükü kilitleri (kaynak denetimi) ──────────────────────────── */

    /** Olay yükü kripto materyali / kod / stack trace TAŞIMAZ. */
    @Test
    public void eventPayloadCarriesNoSecretsOrCodes() throws IOException {
        String plugin = read("PhoneHubLinkPlugin.java");
        int start = plugin.indexOf("public void onLinkStateChanged");
        assertTrue("onLinkStateChanged bulunamadı", start > 0);
        String body = plugin.substring(start, plugin.indexOf("notifyListeners(\"linkState\"", start) + 64);

        assertFalse(body.contains("getMessage"));
        assertFalse(body.contains("getStackTrace"));
        assertFalse(body.contains("pairingCode"));
        assertFalse(body.contains("getPairingCode"));
        assertFalse(body.contains("errorCode"));
        assertFalse(body.contains("signer"));
        assertFalse(body.contains("Key"));

        /* Yük SABİT alanlıdır. */
        assertTrue(body.contains("\"protocolVersion\""));
        assertTrue(body.contains("\"state\""));
        assertTrue(body.contains("\"sessionEpoch\""));
        assertTrue(body.contains("\"deviceFingerprint\""));
        assertTrue(body.contains("\"reason\""));
    }

    /** Geçiş dedupe edilir — aynı (durum, nesil) ikinci kez yayılmaz. */
    @Test
    public void transitionsAreDeduped() throws IOException {
        String controller = read("PhoneHubLinkController.java");
        assertTrue(controller.contains("lastEmittedKey"));
        assertTrue(controller.contains("if (key.equals(lastEmittedKey)) return;"));
    }

    /** F4.5 SIRA: otorite olayı, native kaynak temizliğinden ÖNCE yayılır. */
    @Test
    public void authorityEventPrecedesNativeCleanup() throws IOException {
        String controller = read("PhoneHubLinkController.java");
        int emit = controller.indexOf("emitLinkState(state, generation);");
        int cleanup = controller.indexOf("server.onActiveSessionClosed();", emit);
        assertTrue("emitLinkState bulunamadı", emit > 0);
        assertTrue("temizlik olaydan SONRA olmalı", cleanup > emit);
    }

    /** Dinleyici sökülebilir (zero-leak) ve köprü hatası oturumu bozmaz. */
    @Test
    public void listenerIsDetachableAndFailSoft() throws IOException {
        String controller = read("PhoneHubLinkController.java");
        assertTrue(controller.contains("public void setLinkStateListener(LinkStateListener listener)"));
        assertTrue("köprü hatası yutulmalı", controller.contains("catch (RuntimeException ignored)"));

        String plugin = read("PhoneHubLinkPlugin.java");
        assertTrue("yıkımda dinleyici sökülmeli",
            plugin.contains("controller().setLinkStateListener(null);"));
    }

    /** Lifecycle köprüsü hiçbir timer/polling KURMAZ. */
    @Test
    public void lifecycleBridgeAddsNoTimers() throws IOException {
        String controller = read("PhoneHubLinkController.java");
        assertFalse(controller.contains("ScheduledExecutorService"));
        assertFalse(controller.contains("postDelayed"));
        assertFalse(controller.contains("new Timer("));
    }
}
