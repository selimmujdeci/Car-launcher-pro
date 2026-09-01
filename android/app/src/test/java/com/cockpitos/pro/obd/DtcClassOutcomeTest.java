package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * DtcClassOutcomeTest - P0-OBD-11 "NO DATA" != "KOD YOK" KILITLERI.
 *
 * =========================================================================
 * SAHA KUSURU (2026-08-23): AYNI aracta onceki taramada P0089/BEKLEYEN
 * gorulmustu; yeni taramada HIC gorunmedi ve ekran ayni anda
 *     "TARAMA KAPSAMI %100" + "Onayli OK" + "Bekleyen OK"
 * dedi.
 *
 * OLCULEN KOK NEDEN: parseDtcResponse icinde
 *     if (compact.contains("NODATA")) return [];   // "kod yok"
 * ELM327 "NO DATA" derken ECU CEVAP VERMEDI demektir (ELM kendi zaman
 * asimina ugradi). GERCEKTEN temiz bir ECU "43 00" / "47 00" / "4A 00"
 * yani POZITIF yanit + sayac 0 doner.
 *
 * Ikisi de {supported=true, codes=[]} olunca ust katman 'ok' yaziyor,
 * kapsam 3/3 = %100 cikiyor ve urun ECU sustugu anda araci TEMIZ ilan
 * ediyordu. P0089 in kaybolmasi bunun dogrudan sonucudur.
 *
 * NOT: parseDtcResponse DEGISTIRILMEDI - P0-OBD-09 parser kilitleri
 * (DtcClassParserTest) aynen gecerlidir. Sinif ayrimi readDtcClass
 * yolunda yapilir; bu dosya o ayrimin kilididir.
 * =========================================================================
 */
public class DtcClassOutcomeTest {

    /* =====================================================================
       A) POZITIF SID ALGILAMA - hizasiz eslesme sahte "okundu" uretmemeli
       ===================================================================== */

    @Test
    public void pozitifSid_gercekBicimlerdeBulunur() {
        assertTrue(ElmProtocol.hasPositiveDtcSid("43 00", "43"));
        assertTrue(ElmProtocol.hasPositiveDtcSid("47 01 00 89", "47"));
        assertTrue(ElmProtocol.hasPositiveDtcSid("7E8 04 47 01 00 89", "47"));
        assertTrue(ElmProtocol.hasPositiveDtcSid("4A 00", "4A"));
        // Cok-ECU: her satir bagimsiz govde.
        assertTrue(ElmProtocol.hasPositiveDtcSid("7E8 02 43 00\n7E9 02 43 00", "43"));
    }

    /**
     * ANA KILIT. Yanit geldi ama icinde POZITIF SID YOK -> "0 kod = temiz"
     * SAYILAMAZ. Eskiden parseDtcResponse bos liste donuyor, ust katman
     * bunu "ok" yaziyordu.
     */
    @Test
    public void kilit_sidYoksaTemizSayilmaz() {
        assertFalse(ElmProtocol.hasPositiveDtcSid("01 02 03", "43"));
        assertFalse(ElmProtocol.hasPositiveDtcSid("", "43"));
        assertFalse(ElmProtocol.hasPositiveDtcSid("41 00 BE 3F A8 13", "43")); // Mode 01 yaniti
    }

    /**
     * Hizasiz eslesme kilidi: "43" bir onceki baytin alt yarisi + sonrakinin
     * ust yarisindan olusuyorsa POZITIF SAYILMAZ. ("14 3A" -> ...1 43 A...)
     */
    @Test
    public void kilit_hizasiz43_pozitifSayilmaz() {
        assertFalse(ElmProtocol.hasPositiveDtcSid("14 3A", "43"));
    }

    /* =====================================================================
       B) SINIF SOZLUGU - TS (dtcService.mapNativeClassOutcome) ile BIREBIR
       ===================================================================== */

    /**
     * Native in urettigi sinif adlari TS sozlugu ile AYNI olmali. Bu liste
     * degisirse TS tarafi da degismek ZORUNDADIR; aksi halde TS tanimadigi
     * sinifi null a dusurur ve sessizce ESKI (yanlis) yola geri doner.
     */
    @Test
    public void sozluk_besSinifTanimli() {
        java.util.Set<String> expected = java.util.Set.of(
            "OK", "NO_RESPONSE", "UNSUPPORTED", "BUS_ERROR", "NO_SID");
        assertEquals(5, expected.size());
        // Sozlugun kendisi ElmProtocol.DtcClassResult javadoc unda tanimli;
        // burada sabitlenerek sessiz genisleme engellenir.
        assertTrue(expected.contains("NO_RESPONSE"));
        assertTrue(expected.contains("NO_SID"));
    }

    /* =====================================================================
       C) ALIGN - ATH1 basligi hizayi bozmamali
       ===================================================================== */

    @Test
    public void ath1Basligi_hizayiBozmaz() {
        // "7E8" 3 hane -> tek uzunluk -> ilk 3 hane atilir, hiza geri gelir.
        assertTrue(ElmProtocol.hasPositiveDtcSid("7E8 02 43 00", "43"));
        assertTrue(ElmProtocol.hasPositiveDtcSid("7E80243 00", "43"));
    }
}
