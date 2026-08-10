package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * KwpAcquisitionTest — PR-OBD-KWP-1 birim testleri (yerel JVM).
 *
 * Kapsam: withEcuHeader'ın yeni dalları (boş tx = header'a dokunma; 6 hane = KWP ATSH +
 * protokole göre restore), Servis 21 (readDataById), protokol-farkındalı oturum açma,
 * ExtendedNoDataTracker demote disiplini.
 */
public class KwpAcquisitionTest {

    /** ElmProtocolTest.RecordingFakeChannel ile aynı desen — komut sırası + sıralı yanıt kuyruğu. */
    private static final class RecordingFakeChannel implements ElmCommandChannel {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        private final java.util.Map<String, java.util.Deque<String>> queues = new java.util.HashMap<>();
        private final String defaultResponse = "NO DATA";

        RecordingFakeChannel on(String cmd, String... responses) {
            java.util.Deque<String> q = queues.computeIfAbsent(cmd, k -> new java.util.ArrayDeque<>());
            for (String r : responses) q.addLast(r);
            return this;
        }

        @Override
        public String send(String cmd, int timeoutMs) {
            sent.add(cmd);
            java.util.Deque<String> q = queues.get(cmd);
            if (q == null || q.isEmpty()) return defaultResponse;
            return q.size() > 1 ? q.pollFirst() : q.peekFirst();
        }

        @Override
        public void close() { /* no-op */ }
    }

    // ── withEcuHeader: boş tx = varsayılan oturum (header'a HİÇ dokunulmaz) ──

    @Test
    public void withEcuHeader_bosTx_headerKomutuGondermez() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("22F190", "62 F1 90 56 46 31");
        ElmProtocol elm = new ElmProtocol(ch);
        String data = elm.withEcuHeader("", "", () -> elm.readDataById("22", "F190"));
        assertEquals("564631", data);
        // Kanıt: ATSH/ATCRA HİÇ gönderilmedi — istek mevcut oturumdan gitti.
        for (String cmd : ch.sent) {
            assertFalse("header komutu gönderilmemeli: " + cmd, cmd.startsWith("ATSH"));
            assertFalse("ATCRA gönderilmemeli: " + cmd, cmd.startsWith("ATCRA"));
        }
    }

    // ── withEcuHeader: 6 hane = KWP dalı (ATSH + protokole göre restore, ATCRA YOK) ──

    @Test
    public void withEcuHeader_kwp6Hane_atshVeProtokolBazliRestore() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "5")            // aktif protokol: KWP fast
            .on("ATSH8110F1", "OK")
            .on("21A0", "61 A0 12 34")
            .on("ATSHC133F1", "OK");     // KWP fonksiyonel varsayılana restore
        ElmProtocol elm = new ElmProtocol(ch);
        String data = elm.withEcuHeader("8110F1", "", () -> elm.readDataById("21", "A0"));
        assertEquals("1234", data);
        assertTrue(ch.sent.contains("ATSH8110F1"));
        assertTrue("KWP restore C133F1 olmalı", ch.sent.contains("ATSHC133F1"));
        for (String cmd : ch.sent) {
            assertFalse("KWP dalında ATCRA gönderilmemeli: " + cmd, cmd.startsWith("ATCRA"));
        }
    }

    @Test
    public void withEcuHeader_iso9141_restore686AF1() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "3")            // ISO 9141-2
            .on("ATSH8110F1", "OK")
            .on("22F190", "62 F1 90 41")
            .on("ATSH686AF1", "OK");
        ElmProtocol elm = new ElmProtocol(ch);
        elm.withEcuHeader("8110F1", "", () -> elm.readDataById("22", "F190"));
        assertTrue("ISO 9141 restore 686AF1 olmalı", ch.sent.contains("ATSH686AF1"));
    }

    @Test
    public void withEcuHeader_kwpRestoreBasarisiz_HeaderRestoreException() {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "5")
            .on("ATSH8110F1", "OK")
            .on("21A0", "61 A0 12");
            // ATSHC133F1 → default "NO DATA" (okish değil) → restore başarısız
        ElmProtocol elm = new ElmProtocol(ch);
        try {
            elm.withEcuHeader("8110F1", "", () -> elm.readDataById("21", "A0"));
            org.junit.Assert.fail("HeaderRestoreException bekleniyordu");
        } catch (Exception e) {
            assertTrue("sessiz yutma yasak: " + e.getClass(),
                e instanceof ElmProtocol.HeaderRestoreException);
        }
    }

    // ── Servis 21 (ReadDataByLocalIdentifier) ────────────────────────────────

    @Test
    public void readDataById_servis21_pozitifYanit61() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("2180", "61 80 0A 0B 0C");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("0A0B0C", elm.readDataById("21", "80"));
    }

    @Test
    public void readDataById_servis21_7F21_12_desteklenmiyorNull() throws Exception {
        // NRC 0x12 subFunctionNotSupported → UNSUPPORTED → null (bir daha sorulmaz).
        RecordingFakeChannel ch = new RecordingFakeChannel().on("2180", "7F 21 12");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readDataById("21", "80"));
    }

    @Test
    public void readDataById_servis22_mevcutDavranisKorunur() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("22F190", "62 F1 90 56 46");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("5646", elm.readDataById("22", "F190"));
        assertEquals("5646", elm.readDataById(null, "F190")); // null service → '22'
    }

    // ── Protokol-farkındalı oturum açma ──────────────────────────────────────

    @Test
    public void openExtendedSession_canYolu1003() {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "6")
            .on("1003", "50 03 00 32 01 F4");
        ElmProtocol elm = new ElmProtocol(ch);
        assertTrue(elm.openExtendedSession());
        assertTrue(ch.sent.contains("1003"));
        assertFalse(ch.sent.contains("1081"));
    }

    @Test
    public void openExtendedSession_kwpYolu1081SonraC0() {
        // 1081 reddedilir (default NO DATA) → 10C0 olumlu → true.
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "5")
            .on("10C0", "50 C0");
        ElmProtocol elm = new ElmProtocol(ch);
        assertTrue(elm.openExtendedSession());
        assertTrue("önce standart 1081 denenmeli", ch.sent.contains("1081"));
        assertTrue(ch.sent.contains("10C0"));
        assertFalse("KWP'de 1003 gönderilmez", ch.sent.contains("1003"));
    }

    // ── ExtendedNoDataTracker — demote disiplini (#524 ile tur-bilincli) ────

    /* #524: imza `(pid, result, cycle)` oldu — duraklatma merdiveni TUR cinsindendir.
       Bu testler KALDIRILMADI, yeni sözleşmeye taşındı: stabilizasyon penceresini
       geçmiş bir tur numarasıyla çağrılırlar (aksi hâlde NO_DATA kanıt sayılmaz). */
    private static long c0() { return ExtendedNoDataTracker.STABILIZE_CYCLES + 100; }

    private static ElmResponseParser.Result result(ElmResponseParser.Kind kind) {
        return new ElmResponseParser.Result(kind, kind == ElmResponseParser.Kind.OK ? "8C" : null, "raw");
    }

    @Test
    public void tracker_ucArdisikNoData_demoteEderVeTekKezBildirir() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = c0();
        assertFalse(t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c));
        assertFalse(t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c + 1));
        assertTrue("3. NO_DATA'da İLK KEZ demote bildirilmeli",
            t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c + 2));
        assertTrue(t.shouldSkip("5C", c + 3));
        // Sonraki kayıtlar tekrar bildirmez (olay fırtınası yasak).
        assertFalse(t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c + 4));
    }

    @Test
    public void tracker_okArayaGirerseSayacSifirlanir() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = c0();
        t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c);
        t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c + 1);
        t.recordOutcome("5C", result(ElmResponseParser.Kind.OK), c + 2);   // canlı veri → temiz sayfa
        assertFalse(t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c + 3));
        assertFalse(t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c + 4));
        assertFalse("OK sonrası sayac sıfırdan başlamalı", t.shouldSkip("5C", c + 5));
    }

    @Test
    public void tracker_timeoutVeErrorNotr_demoteEtmez() {
        // TIMEOUT/ERROR bağlantı sorunudur — "araç desteklemiyor" kanıtı DEĞİLDİR.
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = c0();
        for (int i = 0; i < 10; i++) {
            assertFalse(t.recordOutcome("5C", result(ElmResponseParser.Kind.TIMEOUT_PARTIAL), c + i));
            assertFalse(t.recordOutcome("5C", result(ElmResponseParser.Kind.ERROR), c + i));
        }
        assertFalse(t.shouldSkip("5C", c + 20));
    }

    @Test
    public void tracker_listeIcerigiDegisince_ogrenmeSifirlanir() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = c0();
        java.util.List<String> list1 = java.util.Arrays.asList("5C", "5E");
        t.onListChanged(list1);
        for (int i = 0; i < 3; i++) t.recordOutcome("5C", result(ElmResponseParser.Kind.NO_DATA), c + i);
        assertTrue(t.shouldSkip("5C", c + 5));
        t.onListChanged(list1);                                      // AYNI liste → öğrenme KORUNUR
        assertTrue(t.shouldSkip("5C", c + 6));
        t.onListChanged(java.util.Arrays.asList("5C", "5E", "0A")); // yeni içerik → yeni şans
        assertFalse(t.shouldSkip("5C", c + 7));
    }
}
