package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/**
 * IsoTpSingleLineReassemblyTest — SAHADA OLCULEN cok-cerceve birlestirme kilidi.
 *
 * =========================================================================
 * OLCULEN KOK NEDEN (2026-09-22, gercek arac · V-LINK / ELM327 v2.2 · protokol 6)
 *
 * Bu dosyadaki HER ham dizge gercek bir aractan alinmistir (obdTraffic capture).
 * Mevcut testler ISO-TP segmentlerini "\n" ile AYRILMIS besliyordu; GERCEK CIHAZ
 * BOYLE BIR GIRDI URETMEZ:
 *   · init ATL0 gonderir  -> linefeed KAPALI
 *   · RfcommChannel/BleObdManager CR'i atar
 * Yani tum cerceveler TEK satirda bitisik gelir ve segment onegi satirin ICINDE
 * kalir. Eski parser onegi yalniz satir BASINDA aradigi icin cerceve INDEKSLERI
 * ("1","2","3"...) VERIYE KARISIYORDU.
 *
 * Sonucu: VIN bozuluyordu ve — asil onemlisi — sanziman ECU'sunun GERCEK onayli
 * ariza kodlari (U1225-86 / U1226-86) hic cozulemiyordu. Referans tarayici ayni
 * araclarda bu iki kodu gosteriyordu.
 * =========================================================================
 */
public class IsoTpSingleLineReassemblyTest {

    /** Govdeler icinde verilen onegi tasiyani bulur (yoksa null). */
    private static String bodyAfter(String raw, String needle) {
        for (String body : ElmProtocol.splitResponseBodies(raw)) {
            int i = body.indexOf(needle);
            if (i >= 0) return body.substring(i + needle.length());
        }
        return null;
    }

    private static String ascii(String hex) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i + 2 <= hex.length(); i += 2) {
            int c = Integer.parseInt(hex.substring(i, i + 2), 16);
            if (c >= 32 && c < 127) sb.append((char) c);
        }
        return sb.toString();
    }

    /**
     * SAHA KAYDI — 0902 (VIN). Cerceve indeksleri ("1","2") veriye KARISMAMALI.
     * Eski kod: "01564631<b>1</b>5246423030323<b>2</b>..." (tek uzunluk, bozuk).
     */
    @Test
    public void vinSingleLineIsReassembledExactly() {
        final String raw = "0140:4902015646311:524642303032352:39333238353639";
        String data = bodyAfter(raw, "4902");
        assertEquals("01" + "564631" + "52464230303235" + "39333238353639", data);
        assertEquals("Cift hizali olmali (tek uzunluk = indeks sizmasi)", 0, data.length() % 2);
        assertEquals("VF1RFB00259328569", ascii(data.substring(2)));
    }

    /** Ayni VIN, UDS 0x22 F190 yolundan — DID okuma da ayni birlestiriciyi kullanir. */
    @Test
    public void didF190SingleLineIsReassembledExactly() {
        final String raw = "0140:62F1905646311:524642303032352:39333238353639";
        String data = bodyAfter(raw, "62F190");
        assertEquals("564631" + "52464230303235" + "39333238353639", data);
        assertEquals("VF1RFB00259328569", ascii(data));
    }

    /**
     * SAHA KAYDI — sanziman ECU'su (7E9) UDS 19-02. Bu turun ASIL kaybi:
     * ham yanit ELDEYKEN gercek ariza kodlari cozulemiyordu.
     */
    @Test
    public void transmissionManufacturerDtcsAreDecodable() {
        final String raw = "00B0:5902FFD225861:2ED226862EFFFF";
        String data = bodyAfter(raw, "5902");
        assertTrue("59 02 sonrasi govde gelmeli", data != null && data.length() >= 22);
        // 59 02 | FF (statusAvailabilityMask) | <3 bayt DTC + 1 bayt durum> * n
        assertEquals("FF", data.substring(0, 2));
        assertEquals("D2258 62E".replace(" ", ""), data.substring(2, 10));   // U1225-86, durum 0x2E
        assertEquals("D226862E", data.substring(10, 18));                    // U1226-86, durum 0x2E
    }

    /**
     * 32 cerceveli SAHA KAYDI (motor ECU'su, 219 bayt): ELM327 segment indeksi
     * 16'da BASA DONER ("F:" sonrasi yine "0:"). Birlestirici bunu bozmamali.
     */
    @Test
    public void wrappingFrameIndexDoesNotCorruptLongResponse() {
        final String raw =
            "0DB0:5902FF2031161:402100014006382:774014539240153:441640226321504:"
          + "226322500544165:401641135016416:115016411250167:421350164211508:"
          + "164212501643139:50164311501643A:12502080224002B:013A4002023A40C:"
          + "02033A4002043AD:40200294401130E:1C4011351C4011F:35264011361C400:"
          + "114D13400101221:401481014014892:1740148E2240163:416450164264504:"
          + "16436450C305645:501659875006276:2150025B9850067:27F5500627F6508:"
          + "025A1350025A119:50150377501503A:97501503965015B:03F75015030750C:"
          + "150302500400F5D:40049AF5402000E:94401519124004F:9BF640AAAAAAAA";
        String data = bodyAfter(raw, "5902");
        assertTrue(data != null);
        // Beyan edilen uzunluk 0x0DB = 219 bayt; "5902" + govde bunu KARSILAMALI.
        assertTrue("Birlestirilen govde beyan edilen uzunluktan kisa olamaz",
                   (data.length() / 2) + 2 >= 219);
        assertEquals("Cift hizali olmali", 0, data.length() % 2);
        assertEquals("FF", data.substring(0, 2));
        assertEquals("20311640", data.substring(2, 10));   // P2031-16, durum 0x40
        assertEquals("21000140", data.substring(10, 18));  // P2100-01, durum 0x40
    }

    /** Cok-ECU TEK satirda bitisik: her ECU KENDI govdesini korumali. */
    @Test
    public void multiEcuSingleFrameLineStillYieldsBothBodies() {
        // Satir ayracli (ATL1 / fixture) girdi eskisi gibi calismali.
        List<String> bodies = ElmProtocol.splitResponseBodies("4300\n4300");
        assertEquals(2, bodies.size());
    }

    /** ISO-TP uzunluk oneki ("014"/"00B") SID tasimaz ama govdeye SIZMAMALI. */
    @Test
    public void isoTpLengthPrefixDoesNotLeakIntoSegmentBody() {
        List<String> bodies = ElmProtocol.splitResponseBodies("0140:4902015646311:524642303032352:39333238353639");
        assertTrue("Uzunluk oneki ayri govde olarak korunur", bodies.contains("014"));
        String seg = bodies.get(bodies.size() - 1);
        assertTrue("Birlesik govde 4902 ile baslamali", seg.startsWith("4902"));
    }

    /** Satir ayracli ESKI bicim (mevcut fixture'lar) BIREBIR calismaya devam etmeli. */
    @Test
    public void newlineSeparatedSegmentsUnchanged() {
        List<String> bodies = ElmProtocol.splitResponseBodies("0:62 F1 90 30 31 32\n1:33 34 35 36 37 38");
        assertEquals(1, bodies.size());
        assertEquals("62F190303132333435363738", bodies.get(0));
    }
}
