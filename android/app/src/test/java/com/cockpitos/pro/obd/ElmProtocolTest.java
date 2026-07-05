package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.IOException;
import java.util.List;

/**
 * ElmProtocolTest — Patch 11A/11B birim testleri (yerel JVM, cihaz/emülatör gerekmez).
 *
 * Kapsam: Mode 03/07/0A DTC parser genellemesi (43/47/4A TEK parser — kopyalama yok),
 * Mode 0A "desteklenmiyor" (null) / "kod yok" (boş liste) ayrımı, Mode 02 freeze frame
 * DTC + PID ham okuma (frame# baytı soyma).
 *
 * DAVRANIŞ KORUMASI: Mode 03 (readDTCs) senaryoları Patch 8 öncesi testlerle AYNI
 * beklenen sonuçları üretir — parser genellemesi 43 yolunu bit-birebir korumalı.
 */
public class ElmProtocolTest {

    /** Sabit yanıt döndüren sahte kanal — komuta göre farklı cevap verebilir. */
    private static final class FakeChannel implements ElmCommandChannel {
        private final java.util.Map<String, String> responses = new java.util.HashMap<>();
        private String defaultResponse = "NO DATA";

        FakeChannel on(String cmd, String response) {
            responses.put(cmd, response);
            return this;
        }

        @Override
        public String send(String cmd, int timeoutMs) {
            return responses.getOrDefault(cmd, defaultResponse);
        }

        @Override
        public void close() { /* no-op */ }
    }

    /**
     * Patch 12A testleri için: gönderilen HER komutu sırayla kaydeder (header-restore komut
     * sırasını doğrulamak için) + komut başına SIRALI yanıt kuyruğu destekler (0x78 pending
     * zincirini simüle etmek için — kuyruktaki SON öğe kalıcı olarak tekrarlanır).
     */
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

    // ── Mode 03 (kayıtlı) — davranış korumasi ───────────────────────────────

    @Test
    public void readDTCs_canSayacBaytiIleTekKod() throws Exception {
        // CAN: 43 sonrası bayt sayısı TEK (1 sayaç + 2 bayt kod = 3 bayt) → sayaç atılır.
        FakeChannel ch = new FakeChannel().on("03", "43 01 01 71");
        ElmProtocol elm = new ElmProtocol(ch);
        List<String> codes = elm.readDTCs();
        assertEquals(1, codes.size());
        assertEquals("P0171", codes.get(0));
    }

    @Test
    public void readDTCs_klineSifirDolgulu_cokKod() throws Exception {
        // K-line: sayaç yok, 3 çift sabit, kullanılmayanlar 0000 ile doldurulur.
        FakeChannel ch = new FakeChannel().on("03", "43 01 71 04 20 00 00");
        ElmProtocol elm = new ElmProtocol(ch);
        List<String> codes = elm.readDTCs();
        assertEquals(2, codes.size());
        assertTrue(codes.contains("P0171"));
        assertTrue(codes.contains("P0420"));
    }

    @Test
    public void readDTCs_cokEcu_ayriSatirlarBirlesir() throws Exception {
        // Her ECU kendi satırında ayrı "43" bloğu (K-line stili, sayaç yok — sıfır dolgulu).
        FakeChannel ch = new FakeChannel().on("03", "7E8 43 01 71 00 00\n7E9 43 01 20 00 00");
        ElmProtocol elm = new ElmProtocol(ch);
        List<String> codes = elm.readDTCs();
        assertTrue(codes.contains("P0171"));
        assertTrue(codes.contains("P0120"));
    }

    @Test
    public void readDTCs_noData_bosListe() throws Exception {
        FakeChannel ch = new FakeChannel().on("03", "NO DATA");
        ElmProtocol elm = new ElmProtocol(ch);
        assertTrue(elm.readDTCs().isEmpty());
    }

    @Test(expected = IOException.class)
    public void readDTCs_error_istisnaFirlatir() throws Exception {
        FakeChannel ch = new FakeChannel().on("03", "STOPPED");
        ElmProtocol elm = new ElmProtocol(ch);
        elm.readDTCs();
    }

    // ── Mode 07 (bekleyen) ───────────────────────────────────────────────────

    @Test
    public void readPendingDTCs_47OnekiyleAyrisir() throws Exception {
        FakeChannel ch = new FakeChannel().on("07", "47 01 01 71");
        ElmProtocol elm = new ElmProtocol(ch);
        List<String> codes = elm.readPendingDTCs();
        assertEquals(1, codes.size());
        assertEquals("P0171", codes.get(0));
    }

    @Test
    public void readPendingDTCs_noData_bosListe() throws Exception {
        FakeChannel ch = new FakeChannel().on("07", "NO DATA");
        ElmProtocol elm = new ElmProtocol(ch);
        assertTrue(elm.readPendingDTCs().isEmpty());
    }

    // ── Mode 0A (kalıcı) — desteklenmiyor/kod-yok ayrımı ────────────────────

    @Test
    public void readPermanentDTCs_4aOnekiyleKodDoner() throws Exception {
        FakeChannel ch = new FakeChannel().on("0A", "4A 01 01 71");
        ElmProtocol elm = new ElmProtocol(ch);
        List<String> codes = elm.readPermanentDTCs();
        assertEquals(1, codes.size());
        assertEquals("P0171", codes.get(0));
    }

    @Test
    public void readPermanentDTCs_noData_desteklenirAmaKodYok_bosListe() throws Exception {
        FakeChannel ch = new FakeChannel().on("0A", "NO DATA");
        ElmProtocol elm = new ElmProtocol(ch);
        List<String> codes = elm.readPermanentDTCs();
        assertTrue(codes.isEmpty()); // null DEĞİL — "desteklenmiyor" ile karıştırılmaz
    }

    @Test
    public void readPermanentDTCs_acikNegatifYanit_desteklenmiyor_null() throws Exception {
        FakeChannel ch = new FakeChannel().on("0A", "7F 0A 11");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readPermanentDTCs());
    }

    @Test
    public void readPermanentDTCs_soruIsareti_desteklenmiyor_null() throws Exception {
        FakeChannel ch = new FakeChannel().on("0A", "?");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readPermanentDTCs());
    }

    // ── Mode 02 (freeze frame) ───────────────────────────────────────────────

    @Test
    public void readFreezeFrameDtcRaw_kodliYanit_dtcCozer() {
        FakeChannel ch = new FakeChannel().on("020200", "42 02 00 01 71");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("P0171", elm.readFreezeFrameDtcRaw());
    }

    @Test
    public void readFreezeFrameDtcRaw_sifirDtc_freezeFrameYok_null() {
        FakeChannel ch = new FakeChannel().on("020200", "42 02 00 00 00");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readFreezeFrameDtcRaw());
    }

    @Test
    public void readFreezeFramePidRaw_frameBaytiSoyulur() {
        // Mode 02, PID 0C (RPM) — yanıt "42 0C <frame#=00> 1A F8"; frame# soyulunca "1AF8" kalmalı.
        FakeChannel ch = new FakeChannel().on("020C00", "42 0C 00 1A F8");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("1AF8", elm.readFreezeFramePidRaw("0C"));
    }

    @Test
    public void readFreezeFramePidRaw_noData_null() {
        FakeChannel ch = new FakeChannel().on("020C00", "NO DATA");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readFreezeFramePidRaw("0C"));
    }

    // ── Patch 12A: withEcuHeader — atomik ECU adresleme + restore ───────────

    @Test
    public void withEcuHeader_basliktaAyarlar_okurVeVarsayilanaRestoreEder() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATSH7E0", "OK").on("ATCRA7E8", "OK")
            .on("22F190", "62 F1 90 30 31")
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);

        String result = elm.withEcuHeader("7E0", "7E8", () -> elm.readDid("F190"));

        assertEquals("3031", result);
        assertEquals(java.util.Arrays.asList("ATSH7E0", "ATCRA7E8", "22F190", "ATSH7DF", "ATAR"), ch.sent);
    }

    @Test
    public void withEcuHeader_actionExceptionAtsaBile_restoreCalisir_orijinalFirlatilir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATSH7E0", "OK").on("ATCRA7E8", "OK")
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);
        RuntimeException boom = new RuntimeException("action patladi");

        try {
            elm.withEcuHeader("7E0", "7E8", () -> { throw boom; });
            fail("exception bekleniyordu");
        } catch (RuntimeException e) {
            assertEquals(boom, e);
        }
        assertEquals(java.util.Arrays.asList("ATSH7E0", "ATCRA7E8", "ATSH7DF", "ATAR"), ch.sent);
    }

    @Test
    public void withEcuHeader_atarBasarisiz_atcraBosFallbackIleBasarir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATSH7E0", "OK").on("ATCRA7E8", "OK")
            .on("22F190", "62F19031")
            .on("ATSH7DF", "OK").on("ATAR", "?").on("ATCRA", "OK");
        ElmProtocol elm = new ElmProtocol(ch);

        String result = elm.withEcuHeader("7E0", "7E8", () -> elm.readDid("F190"));

        assertEquals("31", result);
        assertTrue(ch.sent.contains("ATCRA"));
    }

    @Test
    public void withEcuHeader_restoreTamamenBasarisiz_actionBasariliysaHeaderRestoreExceptionFirlatir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATSH7E0", "OK").on("ATCRA7E8", "OK")
            .on("22F190", "62F19031")
            .on("ATSH7DF", "OK").on("ATAR", "?").on("ATCRA", "?");
        ElmProtocol elm = new ElmProtocol(ch);

        try {
            elm.withEcuHeader("7E0", "7E8", () -> elm.readDid("F190"));
            fail("HeaderRestoreException bekleniyordu");
        } catch (ElmProtocol.HeaderRestoreException expected) {
            // beklenen — action başarılı olsa da restore başarısızlığı sessiz geçilmez.
        }
    }

    @Test
    public void withEcuHeader_actionHemFirlatirHemRestoreBasarisiz_orijinalOncelikli_suppressedEklenir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATSH7E0", "OK").on("ATCRA7E8", "OK")
            .on("ATSH7DF", "?"); // restore ilk adımda başarısız
        ElmProtocol elm = new ElmProtocol(ch);
        RuntimeException boom = new RuntimeException("action patladi");

        try {
            elm.withEcuHeader("7E0", "7E8", () -> { throw boom; });
            fail("exception bekleniyordu");
        } catch (RuntimeException e) {
            assertEquals(boom, e);
            assertEquals(1, e.getSuppressed().length);
            assertTrue(e.getSuppressed()[0] instanceof ElmProtocol.HeaderRestoreException);
        }
    }

    @Test(expected = IOException.class)
    public void withEcuHeader_headerAyarlanamazsa_actionCalismazAmaRestoreDenenir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATSH7E0", "?") // header kurulamadı
            .on("ATCRA7E8", "OK")
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);
        final boolean[] actionCalled = { false };

        try {
            elm.withEcuHeader("7E0", "7E8", () -> { actionCalled[0] = true; return "unused"; });
        } finally {
            assertFalse(actionCalled[0]);
            assertTrue(ch.sent.contains("ATSH7DF")); // restore yine de denendi
        }
    }

    // ── Patch 13: withEcuHeader — 29-bit genişletilmiş adresleme (ATCP/ATSP7) ────

    @Test
    public void withEcuHeader29Bit_dogruSiradaKurarOkurVeRestoreEder() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "6") // henüz 29-bit değil → ATSP7 gerekir
            .on("ATSP7", "OK")
            .on("ATCP18", "OK")
            .on("ATSHDADAF1", "OK")
            .on("ATCRA18DAF1DA", "OK")
            .on("229002", "62 90 02 12 C0")
            .on("ATSP6", "OK")
            .on("ATSH7DF", "OK")
            .on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);

        String result = elm.withEcuHeader("18DADAF1", "18DAF1DA", () -> elm.readDid("9002"));

        assertEquals("12C0", result);
        assertEquals(java.util.Arrays.asList(
            "ATDPN", "ATSP7", "ATCP18", "ATSHDADAF1", "ATCRA18DAF1DA", "229002",
            "ATCP18", "ATSP6", "ATSH7DF", "ATAR"
        ), ch.sent);
    }

    @Test
    public void withEcuHeader29Bit_zatenProtokol7ise_atsp7AtlanirVeRestoreEdilmez() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "A7") // ELM327 otomatik-tespit + protokol 7 (zaten 29-bit)
            .on("ATCP18", "OK")
            .on("ATSHDADAF1", "OK")
            .on("ATCRA18DAF1DA", "OK")
            .on("229002", "62900212C0")
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);

        String result = elm.withEcuHeader("18DADAF1", "18DAF1DA", () -> elm.readDid("9002"));

        assertEquals("12C0", result);
        // ATSP7 hiç gönderilmedi (zaten 29-bit) VE protokol restore'u da yok (protocolSwitched=false).
        assertFalse(ch.sent.contains("ATSP7"));
        assertFalse(ch.sent.contains("ATSP6"));
        assertEquals(java.util.Arrays.asList(
            "ATDPN", "ATCP18", "ATSHDADAF1", "ATCRA18DAF1DA", "229002",
            "ATCP18", "ATSH7DF", "ATAR"
        ), ch.sent);
    }

    @Test
    public void withEcuHeader29Bit_atcpDesteklenmiyor_klonDurustlugu_actionCagrilmazNullDoner() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "6")
            .on("ATSP7", "OK")
            .on("ATCP18", "?") // klon ATCP'yi desteklemiyor
            .on("ATSP6", "OK")
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);
        final boolean[] actionCalled = { false };

        String result = elm.withEcuHeader("18DADAF1", "18DAF1DA", () -> { actionCalled[0] = true; return "unused"; });

        assertNull(result);
        assertFalse("action hiç çağrılmamalı (klon dürüstlüğü)", actionCalled[0]);
        // ATCP hiç set edilemediği için restore'da TEKRAR denenmez (cpSet=false) — yalnız
        // protokol restore (gerçekten değiştirilmişti) + her zaman header restore.
        assertEquals(java.util.Arrays.asList(
            "ATDPN", "ATSP7", "ATCP18", "ATSP6", "ATSH7DF", "ATAR"
        ), ch.sent);
    }

    @Test
    public void withEcuHeader29Bit_atsp7Desteklenmiyor_klonDurustlugu_atcpHicDenenmez() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "6")
            .on("ATSP7", "?") // klon 29-bit protokolü hiç desteklemiyor
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);
        final boolean[] actionCalled = { false };

        String result = elm.withEcuHeader("18DADAF1", "18DAF1DA", () -> { actionCalled[0] = true; return "unused"; });

        assertNull(result);
        assertFalse(actionCalled[0]);
        // ATCP'ye hiç ulaşılmadı (protokol geçişi başarısız) — restore'da ne ATCP18 ne ATSP
        // denenir (ikisi de hiç set edilmedi), yalnız her-zaman header restore çalışır.
        assertEquals(java.util.Arrays.asList("ATDPN", "ATSP7", "ATSH7DF", "ATAR"), ch.sent);
    }

    @Test
    public void withEcuHeader29Bit_actionExceptionAtsaBile_tamRestoreCalisir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "6").on("ATSP7", "OK").on("ATCP18", "OK")
            .on("ATSHDADAF1", "OK").on("ATCRA18DAF1DA", "OK")
            .on("ATSP6", "OK").on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);
        RuntimeException boom = new RuntimeException("action patladi");

        try {
            elm.withEcuHeader("18DADAF1", "18DAF1DA", () -> { throw boom; });
            fail("exception bekleniyordu");
        } catch (RuntimeException e) {
            assertEquals(boom, e);
        }
        assertEquals(java.util.Arrays.asList(
            "ATDPN", "ATSP7", "ATCP18", "ATSHDADAF1", "ATCRA18DAF1DA",
            "ATCP18", "ATSP6", "ATSH7DF", "ATAR"
        ), ch.sent);
    }

    @Test
    public void withEcuHeader29Bit_protokolRestoreBasarisiz_actionBasariliysaHataFirlatir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "6").on("ATSP7", "OK").on("ATCP18", "OK")
            .on("ATSHDADAF1", "OK").on("ATCRA18DAF1DA", "OK")
            .on("229002", "62900212C0")
            .on("ATSP6", "?") // protokol restore başarısız
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);

        try {
            elm.withEcuHeader("18DADAF1", "18DAF1DA", () -> elm.readDid("9002"));
            fail("HeaderRestoreException bekleniyordu");
        } catch (ElmProtocol.HeaderRestoreException expected) {
            // beklenen — action başarılı olsa da protokol restore başarısızlığı sessiz geçilmez.
        }
        // Header restore YİNE DE denendi (protokol restore başarısız olsa bile).
        assertTrue(ch.sent.contains("ATSH7DF"));
        assertTrue(ch.sent.contains("ATAR"));
    }

    @Test
    public void withEcuHeader29Bit_atshBasarisiz_hardFailIOException_cpVeProtokolRestoreEdilir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATDPN", "6").on("ATSP7", "OK").on("ATCP18", "OK")
            .on("ATSHDADAF1", "?") // ATSH/ATCRA için klon toleransı YOK — hard fail
            .on("ATCRA18DAF1DA", "OK")
            .on("ATSP6", "OK").on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);
        final boolean[] actionCalled = { false };

        try {
            elm.withEcuHeader("18DADAF1", "18DAF1DA", () -> { actionCalled[0] = true; return "unused"; });
            fail("IOException bekleniyordu (ATSH/ATCRA için klon toleransı yok)");
        } catch (IOException expected) {
            // beklenen — ATSH/ATCRA başarısızlığı HER ZAMAN hard-fail (11-bit ile aynı disiplin).
        }
        assertFalse(actionCalled[0]);
        // setEcuHeader ATSH+ATCRA'yı ÖNCE gönderir SONRA ikisini doğrular (Patch 12A davranışı,
        // 11-bit ile AYNI) — ATSH "?" dönse bile ATCRA da gönderilmiş olur. cpSet=true olduğu
        // için ATCP18 restore DENENİR, protokol de restore edilir.
        assertEquals(java.util.Arrays.asList(
            "ATDPN", "ATSP7", "ATCP18", "ATSHDADAF1", "ATCRA18DAF1DA",
            "ATCP18", "ATSP6", "ATSH7DF", "ATAR"
        ), ch.sent);
    }

    @Test
    public void withEcuHeader11Bit_29BitEklendiktenSonraDaDegismez() throws Exception {
        // Regresyon: 3 hex hane tx'ler HÂLÂ eski 11-bit yoluna gider — ATDPN/ATSP7/ATCP'ye
        // hiç dokunmaz (dispatcher tx.length()==8 kontrolüyle dallanıyor).
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("ATSH7E0", "OK").on("ATCRA7E8", "OK")
            .on("22F190", "62 F1 90 30 31")
            .on("ATSH7DF", "OK").on("ATAR", "OK");
        ElmProtocol elm = new ElmProtocol(ch);

        String result = elm.withEcuHeader("7E0", "7E8", () -> elm.readDid("F190"));

        assertEquals("3031", result);
        assertEquals(java.util.Arrays.asList("ATSH7E0", "ATCRA7E8", "22F190", "ATSH7DF", "ATAR"), ch.sent);
        assertFalse(ch.sent.contains("ATDPN"));
    }

    // ── Patch 12A: readDid — UDS Mode 22 ReadDataByIdentifier ────────────────

    @Test
    public void readDid_pozitifYanit_tekCerceve_dataDoner() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("22F190", "62 F1 90 30 31 32 33");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("30313233", elm.readDid("F190"));
    }

    @Test
    public void readDid_isoTpCokCerceve_birlesir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("22F190", "0:62 F1 90 30 31 32\n1:33 34 35 36 37 38");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("303132333435363738", elm.readDid("F190"));
    }

    @Test
    public void readDid_nrc31_requestOutOfRange_desteklenmiyor_null() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("22F190", "7F 22 31");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readDid("F190"));
    }

    @Test
    public void readDid_nrc33_securityAccessDenied_desteklenmiyor_null() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("22F190", "7F 22 33");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readDid("F190"));
    }

    @Test
    public void readDid_nrc78_responsePending_bekleyipBasariliSonucDoner() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("22F190", "7F 22 78")
            .on("", "62 F1 90 41 42");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("4142", elm.readDid("F190"));
        assertEquals(java.util.Arrays.asList("22F190", ""), ch.sent);
    }

    @Test
    public void readDid_nrc78_pekCokKezTekrarEttiktenSonraBasarir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("22F190", "7F 22 78")
            .on("", "7F 22 78", "7F 22 78", "62 F1 90 41");
        ElmProtocol elm = new ElmProtocol(ch);
        assertEquals("41", elm.readDid("F190"));
    }

    @Test(expected = IOException.class)
    public void readDid_digerNrc_hataFirlatir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("22F190", "7F 22 22"); // conditionsNotCorrect
        ElmProtocol elm = new ElmProtocol(ch);
        elm.readDid("F190");
    }

    @Test
    public void readDid_noData_desteklenmiyor_null() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("22F190", "NO DATA");
        ElmProtocol elm = new ElmProtocol(ch);
        assertNull(elm.readDid("F190"));
    }

    @Test(expected = IOException.class)
    public void readDid_stopped_hataFirlatir() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel().on("22F190", "STOPPED");
        ElmProtocol elm = new ElmProtocol(ch);
        elm.readDid("F190");
    }

    @Test(expected = IOException.class)
    public void readDid_pendingZamanAsimi_kisaTimeoutIleHizliBiter() throws Exception {
        RecordingFakeChannel ch = new RecordingFakeChannel()
            .on("22F190", "7F 22 78").on("", "7F 22 78");
        ElmProtocol elm = new ElmProtocol(ch);
        elm.readDid("F190", 30); // 30ms kısa üst sınır — test 10sn değil, hızlı biter
    }
}
