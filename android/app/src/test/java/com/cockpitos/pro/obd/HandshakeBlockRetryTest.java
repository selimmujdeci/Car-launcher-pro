package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * HandshakeBlockRetryTest - P0-OBD-CORE-01B KESIF ZINCIRI KILITLERI.
 *
 * =========================================================================
 * OLCULEN KUSUR: performHandshakeRaw tek satirda karar veriyordu:
 *
 *     raws[i] = runner.run(() -> handshakeBitmapRaw(block));
 *     if (!handshakeHasContinuation(raws[i], block)) break;
 *
 * `handshakeBitmapRaw` -> `safeSend` ISTISNAYI YUTUP "" doner.
 * `hasContinuationBit("")` FAIL-CLOSED false doner -> zincir SESSIZCE biter.
 *
 * Yani `0100` continuation biti 1 OLSA BILE `0120`ye gelen TEK bir timeout
 * kesfi bitiriyordu ve urun "arac 15 PID destekliyor" diyordu - KANITSIZ.
 *
 * Bu dosya "KESIN yanit" ile "cevapsizlik" ayrimini kilitler. Ayrim olmadan
 * retry karari verilemez ve "ECU dar" ile "CarOS kirildi" ayrilamaz.
 * =========================================================================
 */
public class HandshakeBlockRetryTest {

    /* =====================================================================
       A) KESIN YANITLAR - tekrar edilmemeli
       ===================================================================== */

    @Test
    public void pozitifYanit_dortBitmapBayti_KESIN() {
        // 41 00 BE 3F A8 11 -> pozitif + 4 bayt -> continuation okunabilir
        assertTrue(ElmProtocol.handshakeBlockConclusive("41 00 BE 3F A8 11", "00"));
        assertTrue(ElmProtocol.handshakeBlockConclusive("41 20 A0 07 B1 10", "20"));
        // ATH1 basligiyla da kesin
        assertTrue(ElmProtocol.handshakeBlockConclusive("7E8 06 41 00 BE 3F A8 11", "00"));
    }

    @Test
    public void acikNegatifYanit_KESIN() {
        // Arac bu blogu HIC bilmiyor - tekrar sormanin anlami yok.
        assertTrue(ElmProtocol.handshakeBlockConclusive("7F 01 12", "20"));
    }

    @Test
    public void adaptorAnlamadi_KESIN() {
        assertTrue(ElmProtocol.handshakeBlockConclusive("?", "20"));
    }

    /* =====================================================================
       B) KESIN OLMAYANLAR - RETRY HAK EDER (asil kilit)
       ===================================================================== */

    /**
     * ANA REGRESYON KILIDI. Bos yanit = `safeSend` istisnayi yutmus olabilir.
     * Bunu "continuation yok" saymak, kesfi tek timeout ile oldurmektir.
     */
    @Test
    public void kilit_bosYanit_KESIN_DEGIL() {
        assertFalse(ElmProtocol.handshakeBlockConclusive("", "20"));
        assertFalse(ElmProtocol.handshakeBlockConclusive("   ", "20"));
        assertFalse(ElmProtocol.handshakeBlockConclusive(null, "20"));
    }

    @Test
    public void kilit_noData_KESIN_DEGIL() {
        // ECU sustu - gecici olabilir, "destek yok" DEGIL.
        assertFalse(ElmProtocol.handshakeBlockConclusive("NO DATA", "20"));
    }

    @Test
    public void kilit_hatHatasi_KESIN_DEGIL() {
        assertFalse(ElmProtocol.handshakeBlockConclusive("CAN ERROR", "20"));
        assertFalse(ElmProtocol.handshakeBlockConclusive("STOPPED", "20"));
        assertFalse(ElmProtocol.handshakeBlockConclusive("BUS ERROR", "20"));
        assertFalse(ElmProtocol.handshakeBlockConclusive("UNABLE TO CONNECT", "20"));
    }

    @Test
    public void kilit_yarimYanit_KESIN_DEGIL() {
        // Baslik var ama 4 bitmap bayti YOK -> continuation OKUNAMAZ.
        assertFalse(ElmProtocol.handshakeBlockConclusive("41 20 A0 07", "20"));
        assertFalse(ElmProtocol.handshakeBlockConclusive("41", "20"));
    }

    /* =====================================================================
       C) CONTINUATION BITI - davranis DEGISMEDI
       ===================================================================== */

    @Test
    public void continuationBiti_sonBaytBit0() {
        assertTrue(ElmProtocol.handshakeHasContinuation("41 00 BE 3F A8 11", "00"));   // bit0=1
        assertFalse(ElmProtocol.handshakeHasContinuation("41 00 BE 3F A8 10", "00"));  // bit0=0
    }

    /**
     * KIRITIK AYRIM: continuation=0 ile cevapsizlik AYNI `false` u uretir
     * ama ANLAMLARI ZITTIR. Bu yuzden zincir karari artik
     * `handshakeBlockConclusive` + `handshakeHasContinuation` IKILISIYLE
     * verilir; tek basina continuation YETMEZ.
     */
    @Test
    public void kilit_continuationSifir_ile_cevapsizlik_AYRI() {
        String bitti   = "41 00 BE 3F A8 10";   // ECU: "sonraki blok YOK"
        String cevapsiz = "";                    // ECU: sustu / timeout

        // Eski kod ikisini de ayni sayardi:
        assertFalse(ElmProtocol.handshakeHasContinuation(bitti, "00"));
        assertFalse(ElmProtocol.handshakeHasContinuation(cevapsiz, "00"));

        // Yeni ayrim onlari AYIRIR:
        assertTrue(ElmProtocol.handshakeBlockConclusive(bitti, "00"));
        assertFalse(ElmProtocol.handshakeBlockConclusive(cevapsiz, "00"));
    }

    /* =====================================================================
       D) BUTCE - deneme tavani tek yerde ve makul
       ===================================================================== */

    @Test
    public void denemeTavani_ikidir() {
        // 1 asil + 1 retry. 6 blok x 2 x 1200 ms = en kotu ~14 s.
        assertEquals(2, ElmProtocol.HANDSHAKE_BLOCK_MAX_ATTEMPTS);
    }

    @Test
    public void blokSirasi_altiStandartBlok() {
        assertEquals(6, ElmProtocol.HANDSHAKE_BLOCKS.length);
        assertEquals("00", ElmProtocol.HANDSHAKE_BLOCKS[0]);
        assertEquals("A0", ElmProtocol.HANDSHAKE_BLOCKS[5]);
    }
}
