package com.cockpitos.pro.obd;

import static org.junit.Assert.*;

import org.junit.Test;

/**
 * EcuDtcClassRoutingTest — P0-OBD-FINAL-01 · ECU-BASINA DTC + OLCULEN SONUC.
 *
 * =========================================================================
 * SAHA KUSURU (2026-08-25, Protocol 5 / KWP): coklu-ECU taramasi
 * {@code readDtcsFromEcu} kullaniyordu ve o yol YALNIZ kod listesi donuyordu.
 * Sonuc olarak ust katmanda su uc durum AYNI goruntuye cokuyordu:
 *     "43 00 00"  (POZITIF, 0 kod - servis calisti)
 *     "NO DATA"   (ECU SUSTU  - HIC olcum yok)
 *     "7F 03 11"  (servis desteklenmiyor)
 * Bu ayrim olmadan ne kapsam durustce raporlanabilir ne de bir ECU'ya
 * fiziksel istegin ULASTIGI (adreslenebilirlik) olculebilir - ki KWP 0x18
 * kapisi tam olarak bu olcume baglidir.
 *
 * BU DOSYA sunlari kilitler:
 *   1) readDtcClassFromEcu HAM yaniti ve olculen sonucu TASIR,
 *   2) istek FIZIKSEL header ile gonderilir ve header MUTLAKA geri alinir,
 *   3) ECU sessizligi ASLA "OK" sayilmaz.
 * =========================================================================
 */
public class EcuDtcClassRoutingTest {

    /** Gonderilen komutlari SIRAYLA kaydeden sahte kanal. */
    private static final class Ch implements ElmCommandChannel {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        final java.util.Map<String, String> r = new java.util.HashMap<>();
        Ch on(String c, String v) { r.put(c, v); return this; }
        public String send(String c, int t) {
            sent.add(c);
            return r.getOrDefault(c, "NO DATA");
        }
        public void close() {}
    }

    /** CAN 11-bit yolu: ATSH + ATCRA ayarlanir, okunur, varsayilana DONULUR. */
    @Test public void can11bit_fizikselHeaderIleGonderilirVeGeriAlinir() throws Exception {
        Ch ch = new Ch()
            .on("ATSH7E1", "OK").on("ATCRA7E9", "OK")
            .on("ATSH7DF", "OK").on("ATCRA", "OK")
            .on("03", "43 01 01 03");
        ElmProtocol.DtcClassResult r = new ElmProtocol(ch).readDtcClassFromEcu("7E1", "7E9", "03");

        assertEquals("OK", r.outcome);
        assertEquals(1, r.codes.size());
        assertTrue("ham yanit tasinmiyor", r.raw.contains("43"));
        // Header ONCE ayarlanmali, komut ARADA, restore SONRA.
        int set = ch.sent.indexOf("ATSH7E1");
        int cmd = ch.sent.indexOf("03");
        assertTrue("ATSH gonderilmedi", set >= 0);
        assertTrue("komut header'dan ONCE gitti (yanlis ECU'ya sizinti)", cmd > set);
        assertTrue("varsayilan header'a DONULMEDI (sonraki poll bozulur)",
                ch.sent.lastIndexOf("ATSH7DF") > cmd);
    }

    /** KWP 6 haneli tx: ATCRA GONDERILMEZ (K-line'da anlamsiz), restore C133F1. */
    @Test public void kwp_ucBaytHeader_atcraGondermez() throws Exception {
        Ch ch = new Ch()
            .on("ATSH8110F1", "OK").on("ATSHC133F1", "OK").on("ATDPN", "5")
            .on("03", "43 00 00 00 00 00 00");
        ElmProtocol.DtcClassResult r = new ElmProtocol(ch).readDtcClassFromEcu("8110F1", "486B10", "03");

        assertEquals("OK", r.outcome);
        assertTrue("KWP'de POZITIF bos yanit 'kod yok' demektir", r.codes.isEmpty());
        for (String c : ch.sent) {
            assertFalse("K-line'da ATCRA gonderilmis (klonlarda '?' uretir)", c.startsWith("ATCRA"));
        }
        assertTrue("KWP varsayilan header'ina donulmedi", ch.sent.contains("ATSHC133F1"));
    }

    /**
     * ANA KILIT: ECU SUSTU. Bu "kod yok" DEGILDIR - hic olcum YOKTUR.
     * Ust katman bu sonucu adreslenebilirlik kanitina cevirir; "OK" donerse
     * ulasilamayan bir ECU "tarandi/temiz" sayilir.
     */
    @Test public void kilit_ecuSusarsaOkSayilmaz() throws Exception {
        Ch ch = new Ch()
            .on("ATSH8118F1", "OK").on("ATSHC133F1", "OK").on("ATDPN", "5");
        ElmProtocol.DtcClassResult r = new ElmProtocol(ch).readDtcClassFromEcu("8118F1", "486B18", "03");

        assertEquals("NO_RESPONSE", r.outcome);
        assertTrue(r.codes.isEmpty());
    }

    /** Acik negatif yanit (7F) SERVIS yokluğudur; ADRES yine de ULASILABILIRDIR. */
    @Test public void negatifYanit_unsupportedOlarakSiniflanir() throws Exception {
        Ch ch = new Ch()
            .on("ATSH8128F1", "OK").on("ATSHC133F1", "OK").on("ATDPN", "5")
            .on("0A", "7F 0A 11");
        ElmProtocol.DtcClassResult r = new ElmProtocol(ch).readDtcClassFromEcu("8128F1", "486B28", "0A");

        assertEquals("UNSUPPORTED", r.outcome);
        assertFalse(r.supported);
        assertTrue("ham 7F yaniti kaybolmus", r.raw.contains("7F"));
    }
}
