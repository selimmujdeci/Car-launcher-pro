package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * KwpDeadSessionRecoveryTest — PR-OBD-KWP-RECOVER kilitleri (yerel JVM, cihaz gerekmez).
 *
 * SAHA KANITI (2026-07-16, Renault Trafic, BLE + KWP/5, ham trafik paneli): handshake OK
 * sonrası TÜM Mode-01 istekleri kalıcı "NO DATA" (ATRV/ATH1 OK → adaptör canlı, K-line
 * oturumu ölü). ELM327 oturum düşünce kendiliğinden yeniden init YAPMAZ → sonsuz NO DATA.
 *
 * KİLİTLER:
 *  1. KWP'de ardışık ÇEKİRDEK NO_DATA eşiği → ATPC gönderilir (oturum yeniden kurulur).
 *  2. Araya OK girerse sayaç sıfırlanır → ATPC GÖNDERİLMEZ (sağlıklı oturum bozulmaz).
 *  3. CAN'de (protokol 6) hiçbir koşulda ATPC yok — davranış birebir korunur.
 *  4. Kurtarma süreklidir: ATPC sonrası oturum yine ölürse eşikte İKİNCİ ATPC gelir.
 *  5. KWP init'i ATWM (TesterPresent wakeup mesajı) set eder; CAN init'i ETMEZ.
 */
public class KwpDeadSessionRecoveryTest {

    /** Gönderilen her komutu kaydeden + komut→yanıt haritalı sahte kanal. */
    private static final class RecordingChannel implements ElmCommandChannel {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        private final java.util.Map<String, String> responses = new java.util.HashMap<>();
        private String defaultResponse = "NO DATA";

        RecordingChannel on(String cmd, String response) {
            responses.put(cmd, response);
            return this;
        }

        RecordingChannel defaultTo(String response) {
            this.defaultResponse = response;
            return this;
        }

        @Override
        public String send(String cmd, int timeoutMs) {
            sent.add(cmd);
            return responses.getOrDefault(cmd, defaultResponse);
        }

        @Override
        public void close() { /* no-op */ }
    }

    /** Verilen protokolle GERÇEK init dizisinden geçmiş bir ElmProtocol kurar. */
    private static ElmProtocol initProtocol(RecordingChannel ch, String proto) throws Exception {
        ch.on("ATZ", "ELM327 v1.5")
          .on("ATE0", "OK").on("ATL0", "OK").on("ATS0", "OK").on("ATH0", "OK")
          .on("ATAT1", "OK").on("ATSP" + proto, "OK")
          .on("ATSTFF", "OK").on("ATWMC133F13E", "OK").on("ATSW92", "OK")
          .on("0100", "4100983B8011")
          .on("ATDPN", proto);
        ElmProtocol p = new ElmProtocol(ch);
        assertEquals(proto, p.initELM327(proto));
        ch.sent.clear(); // init komutlarını temizle — testler yalnız poll dönemini ölçsün
        return p;
    }

    private static int countAtpc(java.util.List<String> sent) {
        int n = 0;
        for (String s : sent) if ("ATPC".equals(s)) n++;
        return n;
    }

    // ── Kilit 1: KWP ölü oturum → eşikte ATPC ──────────────────────────────────

    @Test
    public void kwpDeadSession_thresholdConsecutiveCoreNoData_sendsAtpc() throws Exception {
        RecordingChannel ch = new RecordingChannel().defaultTo("NO DATA");
        ElmProtocol p = initProtocol(ch, "5");

        // Eşik-1 kadar çekirdek NO_DATA → henüz ATPC YOK.
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD - 1; i++) {
            assertEquals(-1, p.readPID_speed());
        }
        assertEquals("eşik altında ATPC gönderilmemeli", 0, countAtpc(ch.sent));

        // Eşiği tamamlayan okuma → ATPC.
        assertEquals(-1, p.readPID_rpm());
        assertEquals("eşikte tam 1 ATPC beklenir", 1, countAtpc(ch.sent));
    }

    // ── Kilit 2: araya OK girerse sayaç sıfırlanır — sağlıklı oturum bozulmaz ──

    @Test
    public void kwpHealthySession_okResetsStreak_noAtpc() throws Exception {
        RecordingChannel ch = new RecordingChannel().defaultTo("NO DATA");
        ElmProtocol p = initProtocol(ch, "5");
        ch.on("010C", "410C1AF8"); // RPM yanıt veriyor (sağlıklı oturum)

        // NO_DATA ×(eşik-1) → OK (sayaç sıfır) → NO_DATA ×(eşik-1): hiç ATPC olmamalı.
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD - 1; i++) p.readPID_speed();
        assertTrue(p.readPID_rpm() > 0);
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD - 1; i++) p.readPID_speed();
        assertEquals("OK sayaç sıfırlamalı — ATPC gönderilmemeli", 0, countAtpc(ch.sent));
    }

    // ── Kilit 3: CAN'de kurtarma tamamen pasif ─────────────────────────────────

    @Test
    public void canProtocol_neverSendsAtpc() throws Exception {
        RecordingChannel ch = new RecordingChannel().defaultTo("NO DATA");
        ElmProtocol p = initProtocol(ch, "6");

        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD * 3; i++) p.readPID_speed();
        assertEquals("CAN'de ATPC ASLA gönderilmez", 0, countAtpc(ch.sent));
    }

    // ── Kilit 4: kurtarma sürekli — oturum yine ölürse ikinci ATPC ─────────────

    @Test
    public void kwpRecoveryIsContinuous_secondDeathTriggersSecondAtpc() throws Exception {
        RecordingChannel ch = new RecordingChannel().defaultTo("NO DATA");
        ElmProtocol p = initProtocol(ch, "5");

        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD * 2; i++) p.readPID_speed();
        assertEquals("iki tam eşik = iki ATPC (sayaç ATPC sonrası sıfırdan)", 2, countAtpc(ch.sent));
    }

    // ── Kilit 5: ATWM yalnız KWP init'inde ─────────────────────────────────────

    @Test
    public void kwpInit_setsWakeupMessage_canInitDoesNot() throws Exception {
        RecordingChannel kwp = new RecordingChannel().defaultTo("NO DATA");
        initProtocol(kwp, "5"); // init komutları initProtocol içinde sent.clear() ÖNCESİ kaydedildi
        // initProtocol sent'i temizliyor → ATWM'i doğrulamak için yeniden init et.
        RecordingChannel kwp2 = new RecordingChannel().defaultTo("NO DATA");
        kwp2.on("ATZ", "ELM327 v1.5").on("0100", "4100983B8011").on("ATDPN", "5").defaultTo("OK");
        new ElmProtocol(kwp2).initELM327("5");
        assertTrue("KWP init ATWM (TesterPresent) set etmeli", kwp2.sent.contains("ATWMC133F13E"));
        assertTrue("ATWM, ATSW'den ÖNCE gelmeli (ELM327 sözleşmesi)",
            kwp2.sent.indexOf("ATWMC133F13E") < kwp2.sent.indexOf("ATSW92"));

        RecordingChannel can = new RecordingChannel().defaultTo("OK");
        can.on("ATZ", "ELM327 v1.5").on("0100", "4100983B8011").on("ATDPN", "6");
        new ElmProtocol(can).initELM327("6");
        assertFalse("CAN init'inde ATWM olmamalı", can.sent.contains("ATWMC133F13E"));
        assertFalse("CAN init'inde ATSTFF olmamalı (yavaş-seri profili)", can.sent.contains("ATSTFF"));
    }
}
