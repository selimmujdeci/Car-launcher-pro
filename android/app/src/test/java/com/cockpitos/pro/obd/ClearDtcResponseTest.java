package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * ClearDtcResponseTest - P0-OBD-10 MODE 04 (DTC SILME) YANIT SINIFLANDIRMA KILITLERI.
 *
 * =========================================================================
 * SAHA KUSURU: gercek aracta P0089 BEKLEYEN (Mode 07) olarak dogru okunuyordu
 * ama "HAFIZAYI TEMIZLE" kodu silmiyordu ve urun TEK BIR KANIT uretemiyordu.
 *
 * OLCULEN KOK NEDEN (bu dosyanin varlik sebebi): eski kod
 *
 *     String r = channel.send("04", 4000).replaceAll("\\s+","").toUpperCase();
 *     return r.contains("44");
 *
 * yaziyordu. Uc olculebilir kusur:
 *   (1) "44" HIZASIZ eslesebiliyordu -> "7F 04 44" (NRC 0x44) NEGATIF yaniti
 *       "silindi" olarak okunuyordu (SAHTE BASARI).
 *   (2) NO DATA / timeout / negatif yanit / bus hatasi HEPSI ayni `false` a
 *       dusuyordu -> "neden silinmedi" sorusu YANITLANAMIYORDU.
 *   (3) Ham yanit atiliyordu -> saha teshisi imkansizdi.
 *
 * Asagidaki kilitler bu davranisin geri gelmesini engeller.
 * =========================================================================
 */
public class ClearDtcResponseTest {

    private static String outcome(String raw) {
        return ElmProtocol.classifyClearResponse(raw)[0];
    }

    private static String nrc(String raw) {
        return ElmProtocol.classifyClearResponse(raw)[1];
    }

    /* =====================================================================
       A) BASARILI MODE 04 - gercek adaptor bicimleri
       ===================================================================== */

    @Test
    public void basariliMode04_tumGercekBicimlerdePozitif() {
        String[][] cases = {
            { "cikplak",                 "44" },
            { "dolgulu",                 "44 00 00 00" },
            { "ATH1 basligi + PCI",      "7E8 01 44" },
            { "ATH1 + PCI + dolgu",      "7E8 03 44 00 00" },
            { "bosluklu / CR",           " 44 \r" },
            { "cok-ECU (iki motor bloku)", "7E8 01 44\n7E9 01 44" },
        };
        for (String[] c : cases) {
            assertEquals(c[0], "POSITIVE", outcome(c[1]));
            assertNull(c[0], nrc(c[1]));
        }
    }

    /* =====================================================================
       B) ANA KILIT - HIZASIZ "44" SAHTE BASARI URETMEZ
       ===================================================================== */

    /**
     * ANA REGRESYON KILIDI. NRC degeri 0x44 olan bir NEGATIF yanit
     * ("7F 04 44") eski `contains("44")` mantiginda "silindi" okunuyordu.
     * Bu kilit o sahte basariyi kalici olarak kapatir.
     */
    @Test
    public void kilit_negatifYanitNRC44_pozitifSanilmaz() {
        assertEquals("NEGATIVE", outcome("7E8 03 7F 04 44"));
        assertEquals("44", nrc("7E8 03 7F 04 44"));
        assertNotEquals("POSITIVE", outcome("7E8 03 7F 04 44"));
    }

    @Test
    public void negatifYanit_NRCTasinir() {
        assertEquals("NEGATIVE", outcome("7F 04 22"));
        assertEquals("22", nrc("7F 04 22"));

        assertEquals("NEGATIVE", outcome("7F0421"));
        assertEquals("21", nrc("7F0421"));

        // ATH1 basligiyla da ayni sonuc (hiza duzeltmesi calisiyor).
        assertEquals("NEGATIVE", outcome("7E8 03 7F 04 31"));
        assertEquals("31", nrc("7E8 03 7F 04 31"));
    }

    /* =====================================================================
       C) BASARISIZLIK SINIFLARI AYRI TUTULUR
       ===================================================================== */

    @Test
    public void noData_ECUSustu_busHatasiyleKaristirilmaz() {
        assertEquals("NO_DATA", outcome("NO DATA"));
        assertEquals("NO_DATA", outcome("NODATA"));
        assertNotEquals("BUS_ERROR", outcome("NO DATA"));
        // "NO DATA" icindeki D ve A harfleri HEX sanilip 44 aranmamali.
        assertNotEquals("POSITIVE", outcome("NO DATA"));
    }

    @Test
    public void timeout_bosYanit_NO_RESPONSE() {
        assertEquals("NO_RESPONSE", outcome(""));
        assertEquals("NO_RESPONSE", outcome("   "));
        assertEquals("NO_RESPONSE", outcome(null));
    }

    @Test
    public void hatHatalari_BUS_ERROR() {
        String[] raws = {
            "UNABLE TO CONNECT", "CAN ERROR", "BUS ERROR", "STOPPED",
            "BUFFER FULL", "DATA ERROR", "BUS INIT: ERROR",
        };
        for (String raw : raws) assertEquals(raw, "BUS_ERROR", outcome(raw));
    }

    @Test
    public void adaptorAnlamadi_UNSUPPORTED() {
        assertEquals("UNSUPPORTED", outcome("?"));
    }

    @Test
    public void taninmayanYanit_UNKNOWN_hukumUydurulmaz() {
        assertEquals("UNKNOWN", outcome("01 02 03"));
    }

    /* =====================================================================
       D) SOZLUK BUTUNLUGU - TS tarafiyla BIREBIR ayni olmali
       ===================================================================== */

    /**
     * Native ve TS ({@code dtcClearModel.DtcClearCommandOutcome}) AYNI sozlugu
     * kullanir. Buradaki liste degisirse TS tarafi da degismek ZORUNDADIR;
     * aksi halde TS "tanimadigi sinif" gorup ham yanittan yeniden cozumler ve
     * iki otorite olusur.
     */
    @Test
    public void sozluk_yalnizBilinenSiniflarUretilir() {
        String[] raws = {
            "44", "7F 04 22", "NO DATA", "", "CAN ERROR", "?", "01 02 03",
        };
        java.util.Set<String> allowed = java.util.Set.of(
            "POSITIVE", "NEGATIVE", "NO_DATA", "NO_RESPONSE", "BUS_ERROR", "UNSUPPORTED", "UNKNOWN");
        for (String raw : raws) {
            String o = outcome(raw);
            org.junit.Assert.assertTrue("beklenmeyen sinif: " + o, allowed.contains(o));
        }
    }
}
