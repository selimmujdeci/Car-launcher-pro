package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.IOException;
import java.util.List;

/**
 * DtcClassParserTest - P0-OBD-09 DTC SINIF PARSER KILITLERI.
 *
 * =========================================================================
 * SAHA KUSURU: ayni arac + ayni adaptorle baska bir OBD uygulamasi
 *   "P0089 - Fuel Pressure Regulator 1 Performance / BEKLIYOR (pending)"
 * gosteriyordu; CarOS ayni DTC yi GOSTERMIYORDU.
 *
 * OLCULEN KOK NEDEN (bu dosyanin varlik sebebi): parser "sayac bayti var mi?"
 * sorusunu BAYT SAYISI PARITESIYLE tahmin ediyordu. Dolgulu (padded) ve
 * cok-cerceveli (ISO-TP) yanitlarda parite ters doner:
 *
 *   "47 01 00 89"          -> [P0089]              dogru
 *   "47 01 00 89 00 00 00" -> [P0100, B0900]       P0089 KAYIP + UYDURMA KOD
 *   ISO-TP cok cerceve     -> [P0200, B0901, ...]  tamamen uydurma
 *
 * Yani urun yalnizca kod kaybetmiyordu; OLMAYAN kod URETIYORDU.
 * Asagidaki kilitler bu davranisin geri gelmesini engeller.
 * =========================================================================
 */
public class DtcClassParserTest {

    private static final String MODE_STORED    = "43";  // Mode 03
    private static final String MODE_PENDING   = "47";  // Mode 07
    private static final String MODE_PERMANENT = "4A";  // Mode 0A

    private static List<String> parse(String raw, String mode) throws IOException {
        return ElmProtocol.parseDtcResponse(raw, mode);
    }

    /* =====================================================================
       A) ANA SAHA KILIDI - P0089 BEKLEYEN (Mode 07)
       ===================================================================== */

    /**
     * ANA REGRESYON KILIDI. Mode 07 yanitinda P0089 geldiginde CarOS bunu
     * PENDING olarak cozmeli; kod KAYBOLMAMALI ve CONFIRMED UYDURULMAMALI.
     * Sekiz gercek adaptor bicimi tek tek denenir - hicbiri kod kaybetmemeli.
     */
    @Test
    public void p0089_mode07_tumGercekBicimlerdeCozulur() throws Exception {
        String[][] cases = {
            { "CAN sayacli dolgusuz",        "47 01 00 89" },
            { "CAN sayacli 8 bayta DOLGULU", "47 01 00 89 00 00 00" },
            { "compact",                     "4701 0089" },
            { "ATH1 basligi + PCI",          "7E8 04 47 01 00 89" },
            { "ATH1 basligi + PCI + dolgu",  "7E8 06 47 01 00 89 00 00" },
            { "K-line sifir dolgulu",        "47 00 89 00 00 00 00" },
        };
        for (String[] c : cases) {
            List<String> out = parse(c[1], MODE_PENDING);
            assertTrue(c[0] + " -> P0089 kayboldu: " + out, out.contains("P0089"));
            assertEquals(c[0] + " -> fazladan UYDURMA kod: " + out, 1, out.size());
        }
    }

    /** Dolgulu cerceve ARTIK uydurma kod uretmiyor (olculen kusur: P0100 + B0900). */
    @Test
    public void p0089_dolguluCerceve_uydurmaKodUretmez() throws Exception {
        List<String> out = parse("47 01 00 89 00 00 00", MODE_PENDING);
        assertFalse("uydurma P0100 geri geldi: " + out, out.contains("P0100"));
        assertFalse("uydurma B0900 geri geldi: " + out, out.contains("B0900"));
        assertEquals(List.of("P0089"), out);
    }

    /** ISO-TP cok cerceveli yanit da dogru cozulur (olculen kusur: P0200/B0901/C3100). */
    @Test
    public void cokCerceveliIsoTp_dogruCozulur() throws Exception {
        List<String> out = parse("0: 10 08 47 02 00 89\n1: 01 71 00 00 00 00 00", MODE_PENDING);
        assertEquals(List.of("P0089", "P0171"), out);
    }

    /* =====================================================================
       B) SINIFLAR AYRI COZULUR - 03 / 07 / 0A
       ===================================================================== */

    @Test
    public void yalnizMode03_storedCozulur() throws Exception {
        assertEquals(List.of("P0089"), parse("43 01 00 89", MODE_STORED));
    }

    @Test
    public void yalnizMode07_pendingCozulur() throws Exception {
        assertEquals(List.of("P0089"), parse("47 01 00 89", MODE_PENDING));
    }

    @Test
    public void yalnizMode0A_permanentCozulur() throws Exception {
        assertEquals(List.of("P0089"), parse("4A 01 00 89", MODE_PERMANENT));
    }

    /**
     * Bir sinifin yaniti DIGER sinifin onekiyle cozulmeye calisilirsa SESSIZCE
     * kod URETILMEMELI - siniflar birbirine karismaz.
     */
    @Test
    public void sinifOnekleriKarismaz() throws Exception {
        // Mode 07 yaniti, Mode 03 onekiyle aranirsa eslesme YOK -> bos.
        assertTrue(parse("47 01 00 89", MODE_STORED).isEmpty());
        assertTrue(parse("43 01 00 89", MODE_PENDING).isEmpty());
        assertTrue(parse("4A 01 00 89", MODE_STORED).isEmpty());
    }

    /* =====================================================================
       C) NO DATA / MALFORMED / PARTIAL - FAIL-CLOSED
       ===================================================================== */

    @Test
    public void noData_bosListe_arizaYokDEMEK_degil() throws Exception {
        /* Parser bos liste doner; "ariza yok" hukmunu VERMEZ - o karar
           ust katmanda kapsam (completeness) bilgisiyle birlikte verilir. */
        assertTrue(parse("NO DATA", MODE_PENDING).isEmpty());
        assertTrue(parse("NO DATA", MODE_STORED).isEmpty());
    }

    @Test
    public void malformedYanit_istisnaFirlatir() {
        for (String bad : new String[] { "STOPPED", "CAN ERROR", "BUS ERROR",
                                          "UNABLE TO CONNECT", "?" }) {
            try {
                parse(bad, MODE_PENDING);
                fail("malformed yanit sessizce yutuldu: " + bad);
            } catch (IOException expected) { /* fail-closed */ }
        }
    }

    /**
     * KISMI ISO-TP: sayac 3 kod diyor ama govdede 1 kod var. Eksik listeyi
     * sessizce dondurmek "daha az ariza var" demektir -> fail-closed.
     */
    @Test
    public void kismiYanit_sessizceEksikListeDONDURMEZ() {
        try {
            List<String> out = parse("47 03 00 89", MODE_PENDING);
            fail("kismi yanit sessizce kabul edildi: " + out);
        } catch (IOException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("Kismi"));
        }
    }

    @Test
    public void bosGovde_kodUretmez() throws Exception {
        assertTrue(parse("47", MODE_PENDING).isEmpty());
        assertTrue(parse("47 00", MODE_PENDING).isEmpty());
    }

    /* =====================================================================
       D) MEVCUT DAVRANIS KORUNUYOR (regresyon)
       ===================================================================== */

    @Test
    public void modOnekArtigi_sahteKodUretmez() throws Exception {
        assertFalse(parse("43 01 43 00", MODE_STORED).contains("C0300"));
        assertFalse(parse("47 01 47 00", MODE_PENDING).contains("C0700"));
    }

    @Test
    public void klineSifirDolgulu_cokKod_korunur() throws Exception {
        List<String> out = parse("43 01 71 04 20 00 00", MODE_STORED);
        assertTrue(out.contains("P0171"));
        assertTrue(out.contains("P0420"));
    }

    @Test
    public void cokEcuAyriSatirlar_korunur() throws Exception {
        List<String> out = parse("7E8 43 01 71 00 00\n7E9 43 01 20 00 00", MODE_STORED);
        assertTrue(out.contains("P0171"));
        assertTrue(out.contains("P0120"));
    }

    @Test
    public void dolguluTekKod_P0100_dogruCozulur() throws Exception {
        /* Sonu 0x00 ile biten GERCEK kod (P0100 = 01 00) dolgu sanilmamali. */
        assertEquals(List.of("P0100"), parse("43 01 01 00 00 00 00", MODE_STORED));
    }

    /* =====================================================================
       E) HIZA GUVENLIGI
       ===================================================================== */

    /**
     * SID YALNIZ CIFT hizada aranmali. Hizasiz bir "47" yakalanirsa govde yarim
     * bayt kayar ve TUM kodlar sessizce bozulur.
     */
    @Test
    public void sidYalnizCiftHizadaAranir() throws Exception {
        /* "A4 70 10 08 9x" icinde hizasiz bir "47" vardir; gercek SID yoktur. */
        assertTrue(parse("A4 70 10 08", MODE_PENDING).isEmpty());
    }

    /* =====================================================================
       F) readDtcClass - HAM + COZUMLENMIS kanit birlikte tasinir
       ===================================================================== */

    private static final class Ch implements ElmCommandChannel {
        private final java.util.Map<String, String> r = new java.util.HashMap<>();
        Ch on(String c, String v) { r.put(c, v); return this; }
        @Override public String send(String cmd, int t) { return r.getOrDefault(cmd, "NO DATA"); }
        @Override public void close() { }
    }

    @Test
    public void readDtcClass_hamYanitiDaTasir() throws Exception {
        ElmProtocol elm = new ElmProtocol(new Ch().on("07", "47 01 00 89 00 00 00"));
        ElmProtocol.DtcClassResult r = elm.readDtcClass("07");
        assertTrue(r.supported);
        assertEquals(List.of("P0089"), r.codes);
        assertTrue("ham yanit tasinmadi: " + r.raw, r.raw.contains("47"));
    }

    @Test
    public void readDtcClass_negatifYanit_desteklenmiyor() throws Exception {
        ElmProtocol elm = new ElmProtocol(new Ch().on("0A", "7F 0A 11"));
        ElmProtocol.DtcClassResult r = elm.readDtcClass("0A");
        assertFalse("acik negatif yanit destekleniyor sayildi", r.supported);
        assertTrue(r.codes.isEmpty());
    }

    @Test
    public void readDtcClass_noData_desteklenirAmaKodYok() throws Exception {
        ElmProtocol elm = new ElmProtocol(new Ch().on("07", "NO DATA"));
        ElmProtocol.DtcClassResult r = elm.readDtcClass("07");
        assertTrue("NO DATA desteklenmiyor SAYILDI", r.supported);
        assertTrue(r.codes.isEmpty());
    }
}
