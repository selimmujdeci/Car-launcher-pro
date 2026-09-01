package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/**
 * P0-VDK-F4A — GENEL PDU KOPRUSUNUN NATIVE KAPI KILIDI.
 *
 * Bu testin tek isi su iddiayi KANITLAMAKTIR: "TS/CDDL bozulsa bile destructive
 * bir servis native katmandan GECEMEZ." Sadece genel bir fonksiyon yazmak PASS
 * degildir; kapinin kapali oldugu gosterilmelidir.
 */
public class DiagnosticServiceGateTest {

    /** Gorevin sayadigi destructive kume — TEK BAYT BILE cikamaz. */
    private static final List<String> DESTRUCTIVE = Arrays.asList(
        "04", "11", "14", "27", "28", "2E", "2F", "31", "34", "35", "36", "37", "3B", "85");

    @Test
    public void destructiveServicesCanNeverBeSent() {
        for (String sid : DESTRUCTIVE) {
            assertFalse("destructive servis gecti: " + sid,
                DiagnosticServiceGate.isAllowed(sid, "", ""));
            assertEquals("gerekce kodu yanlis: " + sid,
                DiagnosticServiceGate.DENY_SERVICE_NOT_READ_ONLY,
                DiagnosticServiceGate.judge(sid, "", ""));
        }
    }

    /** Alt fonksiyon ya da govde ile gizlenmis destructive istek de gecemez. */
    @Test
    public void destructiveServicesCannotHideBehindArguments() {
        for (String sid : DESTRUCTIVE) {
            assertFalse(sid + " alt fonksiyonla gecti",
                DiagnosticServiceGate.isAllowed(sid, "01", "FFFF"));
            assertFalse(sid + " kucuk harfle gecti",
                DiagnosticServiceGate.isAllowed(sid.toLowerCase(), "", ""));
            assertFalse(sid + " bosluklu gecti",
                DiagnosticServiceGate.isAllowed(" " + sid + " ", "", ""));
        }
    }

    /** Beyaz liste disindaki HER SEY reddedilir — fail-closed. */
    @Test
    public void unknownServicesAreRejectedByDefault() {
        for (int i = 0; i < 256; i++) {
            String sid = String.format("%02X", i);
            boolean allowed = DiagnosticServiceGate.isAllowed(sid, "02", "FF");
            boolean whitelisted = DiagnosticServiceGate.readOnlyServices().contains(sid);
            if (!whitelisted) {
                assertFalse("beyaz liste disi servis gecti: " + sid, allowed);
            }
        }
    }

    /** Bozuk bicim bir "belki"dir; belkiler hatta cikmaz. */
    @Test
    public void malformedRequestsAreRejected() {
        assertEquals(DiagnosticServiceGate.DENY_MALFORMED,
            DiagnosticServiceGate.judge("1", "", ""));
        assertEquals(DiagnosticServiceGate.DENY_MALFORMED,
            DiagnosticServiceGate.judge("190", "", ""));
        assertEquals(DiagnosticServiceGate.DENY_MALFORMED,
            DiagnosticServiceGate.judge("22", "", "F19"));
        assertEquals(DiagnosticServiceGate.DENY_MALFORMED,
            DiagnosticServiceGate.judge("19", "022", ""));
        assertEquals(DiagnosticServiceGate.DENY_MALFORMED,
            DiagnosticServiceGate.judge("", "", ""));
        StringBuilder huge = new StringBuilder();
        for (int i = 0; i < 200; i++) huge.append("AA");
        assertEquals(DiagnosticServiceGate.DENY_MALFORMED,
            DiagnosticServiceGate.judge("22", "", huge.toString()));
    }

    /** UDS 0x19 alt fonksiyon uzayi mevcut kapiyla AYNI kumede tutulur. */
    @Test
    public void uds19SubFunctionsAreFiltered() {
        for (String ok : new String[] { "01", "02", "03", "06", "0A" }) {
            assertTrue("19-" + ok + " gecmeliydi",
                DiagnosticServiceGate.isAllowed("19", ok, "FF"));
        }
        for (String bad : new String[] { "04", "05", "14", "15", "FF", "00" }) {
            assertEquals("19-" + bad + " gecmemeliydi",
                DiagnosticServiceGate.DENY_SUBFUNCTION_NOT_READ_ONLY,
                DiagnosticServiceGate.judge("19", bad, ""));
        }
        assertEquals("alt fonksiyonsuz 0x19 gecmemeli",
            DiagnosticServiceGate.DENY_SUBFUNCTION_NOT_READ_ONLY,
            DiagnosticServiceGate.judge("19", "", ""));
    }

    /** Gorevin zorunlu tuttugu urun yollari kapidan GECER. */
    @Test
    public void requiredReadOnlyProductPathsPass() {
        assertTrue("1902FF", DiagnosticServiceGate.isAllowed("19", "02", "FF"));
        assertTrue("190A", DiagnosticServiceGate.isAllowed("19", "0A", ""));
        assertTrue("03", DiagnosticServiceGate.isAllowed("03", "", ""));
        assertTrue("07", DiagnosticServiceGate.isAllowed("07", "", ""));
        assertTrue("0A", DiagnosticServiceGate.isAllowed("0A", "", ""));
        assertTrue("3E00", DiagnosticServiceGate.isAllowed("3E", "00", ""));
        assertTrue("18", DiagnosticServiceGate.isAllowed("18", "", "00FF00"));
        assertTrue("13", DiagnosticServiceGate.isAllowed("13", "", ""));
        assertTrue("22F190", DiagnosticServiceGate.isAllowed("22", "", "F190"));
    }

    /**
     * IKI KAPI AYRISAMAZ: matris kapisindan gecen her servis burada da gecer.
     * (Ters yon esitlik DEGILDIR — bilincli fark yalniz 06 ve 3E'dir.)
     */
    @Test
    public void gateCoversExistingMatrixWhitelist() {
        for (String sid : ElmProtocol.KWP_PROBE_ALLOWED_SIDS) {
            assertTrue("matris kapisindaki servis genel kapida yok: " + sid,
                DiagnosticServiceGate.readOnlyServices().contains(sid));
        }
        java.util.Set<String> extra =
            new java.util.LinkedHashSet<>(DiagnosticServiceGate.readOnlyServices());
        extra.removeAll(ElmProtocol.KWP_PROBE_ALLOWED_SIDS);
        assertEquals("genel kapi beklenmedik sekilde genisletilmis: " + extra,
            new java.util.LinkedHashSet<>(Arrays.asList("06", "3E")), extra);
    }

    /** Beyaz liste ile yasakli liste KESISMEZ. */
    @Test
    public void whitelistAndDenylistNeverIntersect() {
        for (String sid : DiagnosticServiceGate.destructiveServices()) {
            assertFalse("servis hem beyaz hem yasakli listede: " + sid,
                DiagnosticServiceGate.readOnlyServices().contains(sid));
        }
        assertTrue("gorevin destructive kumesi eksik",
            DiagnosticServiceGate.destructiveServices().containsAll(DESTRUCTIVE));
    }

    /**
     * POZITIF YANIT ONEKI SERVISE OZEL DAL OLMADAN URETILIR.
     *
     * Yankilanan bayt sayisi VERIDIR; onek {@code SID+0x40} evrensel kuralindan
     * gelir. Bu test, yeni bir servisin kod degisikligi olmadan dogru oneki
     * uretebildigini gosterir.
     */
    @Test
    public void positiveNeedleIsDerivedGenerically() {
        assertEquals("5902", DiagnosticServiceGate.positiveNeedle("19", "02", "FF", 1));
        assertEquals("590A", DiagnosticServiceGate.positiveNeedle("19", "0A", "", 1));
        assertEquals("58", DiagnosticServiceGate.positiveNeedle("18", "", "00FF00", 0));
        assertEquals("53", DiagnosticServiceGate.positiveNeedle("13", "", "", 0));
        assertEquals("62F190", DiagnosticServiceGate.positiveNeedle("22", "", "F190", 2));
        assertEquals("6180", DiagnosticServiceGate.positiveNeedle("21", "", "80", 1));
        assertEquals("7E", DiagnosticServiceGate.positiveNeedle("3E", "00", "", 0));
        assertEquals("43", DiagnosticServiceGate.positiveNeedle("03", "", "", 0));
        /* echoBytes istekten uzunsa var olan kadari alinir — uydurma bayt YOK. */
        assertEquals("5902", DiagnosticServiceGate.positiveNeedle("19", "02", "", 4));
        assertEquals("", DiagnosticServiceGate.positiveNeedle("1", "", "", 0));
    }
}
