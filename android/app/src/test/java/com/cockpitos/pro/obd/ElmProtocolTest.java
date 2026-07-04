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
}
