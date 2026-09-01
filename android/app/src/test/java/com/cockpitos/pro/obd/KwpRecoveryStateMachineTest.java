package com.cockpitos.pro.obd;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

/** P0-OBD-CORE-01: KWP/ISO ayrımlı recovery durum makinesi kilitleri. */
public class KwpRecoveryStateMachineTest {
    private static final class Channel implements ElmCommandChannel {
        final List<String> sent = new ArrayList<>();
        boolean timeout;
        boolean partial;
        boolean failReinit;
        String protocol = "5";

        @Override public String send(String cmd, int timeoutMs) throws Exception {
            sent.add(cmd);
            if ("ATZ".equals(cmd)) return "ELM327";
            if (cmd.startsWith("AT") && !"ATDPN".equals(cmd)) {
                if (failReinit && "ATWS".equals(cmd)) throw new java.io.IOException("drop");
                return "OK";
            }
            if ("ATDPN".equals(cmd)) return protocol;
            if ("0100".equals(cmd)) return "4100BE1FA813";
            if (timeout) throw new ElmPromptTimeoutException(partial ? "41 0C 1A" : "", true);
            if ("010C".equals(cmd)) return "410C1AF8";
            if ("0105".equals(cmd)) return "NO DATA";
            if ("03".equals(cmd)) return "43 00 00";
            if (cmd.startsWith("01")) return "410C1AF8";
            return "NO DATA";
        }
        @Override public void close() { }
    }

    @Before public void reset() { KwpRecoveryEvidence.INSTANCE.reset(); }

    private static ElmProtocol kwp(Channel ch) throws Exception {
        ElmProtocol p = new ElmProtocol(ch);
        assertEquals("5", p.initELM327("5"));
        ch.sent.clear();
        return p;
    }

    @Test public void promptTimeout_isTypedAndCounted() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); ch.timeout = true;
        p.readPID_rpm();
        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals(1, s.promptTimeoutCount); assertEquals("PROMPT_TIMEOUT", s.lastEvent);
    }

    @Test public void partialTimeout_isNotPromptOrNoData() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); ch.timeout = true; ch.partial = true;
        p.readPID_rpm();
        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals(1, s.partialTimeoutCount); assertEquals(0, s.promptTimeoutCount);
        assertEquals(0, s.noDataCount);
    }

    @Test public void explicitNoData_staysSeparate() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); p.readPID_temp();
        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals(1, s.noDataCount); assertEquals(0, s.promptTimeoutCount);
    }

    @Test public void consecutiveTimeout_entersSessionRecovery() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); ch.timeout = true;
        for (int i=0; i<ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();
        assertTrue(ch.sent.contains("ATPC"));
        assertEquals(1, KwpRecoveryEvidence.INSTANCE.snapshot().sessionRecoveryCount);
    }

    @Test public void successfulRecovery_recordsRecovered() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); ch.timeout = true;
        for (int i=0; i<ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();
        ch.timeout = false; assertTrue(p.readPID_rpm() >= 0);
        assertEquals("RECOVERED", KwpRecoveryEvidence.INSTANCE.snapshot().lastEvent);
    }

    @Test public void failedStrongRecovery_requestsExistingReconnect() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); ch.timeout = true;
        for (int i=0; i<ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();
        ch.failReinit = true;
        for (int i=0; i<ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();
        assertTrue(KwpRecoveryEvidence.INSTANCE.consumeTransportReconnectRequest());
        assertEquals("RECOVERY_FAILED", KwpRecoveryEvidence.INSTANCE.snapshot().lastEvent);
    }

    @Test public void dtcScanTimeout_participatesWithoutPreemption() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); ch.timeout = true;
        try { p.readDTCs(); fail(); } catch (java.io.IOException expected) { }
        assertEquals(1, KwpRecoveryEvidence.INSTANCE.snapshot().promptTimeoutCount);
        assertEquals("03", ch.sent.get(0));
    }

    @Test public void extendedPollTimeout_participatesInRecovery() throws Exception {
        Channel ch = new Channel(); ElmProtocol p = kwp(ch); ch.timeout = true;
        p.readPidClassified("42");
        assertEquals(1, KwpRecoveryEvidence.INSTANCE.snapshot().promptTimeoutCount);
    }

    @Test public void latePartialResponse_isQuarantinedAsTimeout() {
        ElmPromptTimeoutException e = new ElmPromptTimeoutException("41 0C 1A", true);
        assertTrue(e.partial); assertTrue(e.resynced); assertEquals("41 0C 1A", e.partialResponse);
    }

    @Test public void canRegression_doesNotEnterKwpMachine() throws Exception {
        Channel ch = new Channel(); ch.protocol = "6"; ElmProtocol p = new ElmProtocol(ch);
        assertEquals("6", p.initELM327("6")); ch.sent.clear(); ch.timeout = true;
        for (int i=0; i<ElmProtocol.KWP_DEAD_SESSION_THRESHOLD * 2; i++) p.readPID_rpm();
        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals("NONE", s.lastEvent); assertEquals(0, s.sessionRecoveryCount);
        assertFalse(ch.sent.contains("ATPC"));
    }
}
