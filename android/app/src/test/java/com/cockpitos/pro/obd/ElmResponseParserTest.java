package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * ElmResponseParserTest — Patch 4 birim testleri (yerel JVM, cihaz/emülatör gerekmez).
 *
 * Kapsam: çok-ECU çoklu 41xx bloğu, 7F negatif yanıt, STOPPED/BUFFER FULL/CAN ERROR,
 * boş/kısmi (timeout) yanıt, boşluklu/boşluksuz format — DAVRANIŞ KORUMASI: OK durumunda
 * dönen dataHex, eski {@code indexOf("41XX")+substring} ile BİREBİR aynı baytları verir.
 */
public class ElmResponseParserTest {

    @Test
    public void ok_boslukluYanit_dogruBaytiCikarir() {
        // "41 0D 32" → speed formülü substring(0,2) = "32" (0x32 = 50 km/h)
        ElmResponseParser.Result r = ElmResponseParser.classify("41 0D 32\r", "41", "0D");
        assertEquals(ElmResponseParser.Kind.OK, r.kind);
        assertEquals("32", r.dataHex.substring(0, 2));
    }

    @Test
    public void ok_boslukluOlmayanYanit_ayniSonucuVerir() {
        // Aynı veri, boşluksuz format — eski indexOf davranışıyla birebir aynı sonuç.
        ElmResponseParser.Result r = ElmResponseParser.classify("410D32", "41", "0D");
        assertEquals(ElmResponseParser.Kind.OK, r.kind);
        assertEquals("32", r.dataHex.substring(0, 2));
    }

    @Test
    public void ok_cokEcuYaniti_ilkEslesenBlogu_eskiIndexOfIleBirebirAyni() {
        // Çok-ECU: iki ayrı "41 0D" bloğu (farklı ECU'lardan). Eski kod da indexOf ile
        // İLK bloğu alıyordu — DAVRANIŞ KORUMASI: bu sınıf da aynısını yapmalı.
        String raw = "7E8 04 41 0D 3C\r7E9 04 41 0D 50\r";
        ElmResponseParser.Result r = ElmResponseParser.classify(raw, "41", "0D");
        assertEquals(ElmResponseParser.Kind.OK, r.kind);
        // Eski davranış referansı: aynı stringde ham indexOf("410D") + substring(idx+4,idx+6).
        String compact = raw.replaceAll("\\s+", "").toUpperCase();
        int idx = compact.indexOf("410D");
        String expected = compact.substring(idx + 4, idx + 6);
        assertEquals(expected, r.dataHex.substring(0, 2));
    }

    @Test
    public void neg7f_negatifYanitSiniflandirilir() {
        // "7F 01 12" — Mode 01 için negatif yanıt (NRC 0x12 = subFunctionNotSupported benzeri).
        ElmResponseParser.Result r = ElmResponseParser.classify("7F 01 12", "41", "0D");
        assertEquals(ElmResponseParser.Kind.NEG_7F, r.kind);
        assertNull(r.dataHex);
    }

    @Test
    public void noData_ecuDesteklemiyor() {
        ElmResponseParser.Result r = ElmResponseParser.classify("NO DATA", "41", "2F");
        assertEquals(ElmResponseParser.Kind.NO_DATA, r.kind);
    }

    @Test
    public void busy_searchingProtokolAramasiSurüyor() {
        ElmResponseParser.Result r = ElmResponseParser.classify("SEARCHING...", "41", "00");
        assertEquals(ElmResponseParser.Kind.BUSY, r.kind);
    }

    @Test
    public void busy_busInit() {
        ElmResponseParser.Result r = ElmResponseParser.classify("BUS INIT: ERROR", "41", "0C");
        // BUS INIT metni içerdiği için BUSY sayılır (ERROR kelimesi de var ama BUSY kontrolü ÖNCE çalışır).
        assertEquals(ElmResponseParser.Kind.BUSY, r.kind);
    }

    @Test
    public void error_stopped() {
        ElmResponseParser.Result r = ElmResponseParser.classify("STOPPED", "41", "0D");
        assertEquals(ElmResponseParser.Kind.ERROR, r.kind);
    }

    @Test
    public void error_bufferFull() {
        ElmResponseParser.Result r = ElmResponseParser.classify("BUFFER FULL", "41", "0D");
        assertEquals(ElmResponseParser.Kind.ERROR, r.kind);
    }

    @Test
    public void error_canError() {
        ElmResponseParser.Result r = ElmResponseParser.classify("CAN ERROR", "41", "0D");
        assertEquals(ElmResponseParser.Kind.ERROR, r.kind);
    }

    @Test
    public void error_unableToConnect() {
        ElmResponseParser.Result r = ElmResponseParser.classify("UNABLE TO CONNECT", "41", "00");
        assertEquals(ElmResponseParser.Kind.ERROR, r.kind);
    }

    @Test
    public void error_soruIsaretiDesteklenmeyenKomut() {
        ElmResponseParser.Result r = ElmResponseParser.classify("?", "41", "0D");
        assertEquals(ElmResponseParser.Kind.ERROR, r.kind);
    }

    @Test
    public void timeoutPartial_bosYanit() {
        ElmResponseParser.Result r = ElmResponseParser.classify("", "41", "0D");
        assertEquals(ElmResponseParser.Kind.TIMEOUT_PARTIAL, r.kind);
    }

    @Test
    public void timeoutPartial_nullYanit() {
        ElmResponseParser.Result r = ElmResponseParser.classify(null, "41", "0D");
        assertEquals(ElmResponseParser.Kind.TIMEOUT_PARTIAL, r.kind);
    }

    @Test
    public void timeoutPartial_kismiGurultuluYanit() {
        // Deadline dolarken yarım kalmış, tanınmayan bir bayt akışı (beklenen "410D" YOK).
        ElmResponseParser.Result r = ElmResponseParser.classify("41 0", "41", "0D");
        assertEquals(ElmResponseParser.Kind.TIMEOUT_PARTIAL, r.kind);
    }
}
