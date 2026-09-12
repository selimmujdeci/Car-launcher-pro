package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * KwpSessionProbeEvidenceTest — P0-OBD-FINAL-02 · KWP tani oturumu (0x10) probunun
 * NATIVE tarafindaki HAM KANIT sozlesmesi (yerel JVM; cihaz/arac gerekmez).
 *
 * NEDEN BU TEST VAR: TS tarafi ({@code kwpSessionProbe.ts}) sonuclari GUCE gore
 * siralar (POSITIVE > NEGATIVE > MALFORMED > NO_RESPONSE > TRANSPORT_ERROR >
 * NOT_ATTEMPTED) — ama native TEK bir kanit dondurur. Native yanlis kaniti
 * secerse TS o siralamayi HIC goremez: kanit koprude olur. Sahada
 * (2026-08-25 · Protocol 5 / KWP · ECU 7A) tam olarak bu ayrim kritiktir —
 * "adres canli, oturum reddedildi" (NEGATIVE) ile "ECU sustu" (NO_RESPONSE)
 * TAMAMEN FARKLI teshislerdir.
 *
 * GUVENLIK: bu testler yalnizca 0x10 oturum komutunu olcer. POZITIF kanit
 * uretmeyen hicbir senaryo {@code "ok"} DONDURMEZ — 0x18 kapisi TS tarafinda
 * yalnizca {@code "ok"} ile acilir (fail-closed).
 */
public class KwpSessionProbeEvidenceTest {

    /** Komut basina yanit veren, gonderilen komutlari SIRAYLA kaydeden sahte kanal. */
    private static final class Ch implements ElmCommandChannel {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        private final java.util.Map<String, String> responses = new java.util.HashMap<>();
        private final java.util.Set<String> throwOn = new java.util.HashSet<>();
        private String defaultResponse = "NO DATA";

        Ch on(String cmd, String response) { responses.put(cmd, response); return this; }
        Ch throwOn(String cmd) { throwOn.add(cmd); return this; }
        Ch defaultResponse(String r) { defaultResponse = r; return this; }

        @Override
        public String send(String cmd, int timeoutMs) throws Exception {
            sent.add(cmd);
            if (throwOn.contains(cmd)) throw new java.io.IOException("soket dustu");
            return responses.getOrDefault(cmd, defaultResponse);
        }

        @Override
        public void close() { /* no-op */ }
    }

    private static long sessionCommandCount(Ch ch) {
        return ch.sent.stream().filter(c -> c.startsWith("10")).count();
    }

    // ── POZITIF KANIT ────────────────────────────────────────────────────────

    /** 10 81 → 50 81: pozitif olculdu; FAZLADAN TEK KOMUT BILE gonderilmez. */
    @Test
    public void standartOturumPozitif_ikinciKomutGonderilmez() {
        Ch ch = new Ch().on("1081", "50 81");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("ok", ev.outcome);
        assertEquals("1081", ev.request);
        assertEquals("50 81", ev.raw);
        assertNull(ev.nrc);
        assertFalse("pozitif kanit varken 10C0 gonderilmis (gereksiz K-line trafigi)",
                ch.sent.contains("10C0"));
    }

    /** 10 81 sustu → 10 C0 → 50 C0: uretici oturumuna TIRMANIR ve kanit onun olur. */
    @Test
    public void standartSusunca_ureticiOturumunaTirmanir() {
        Ch ch = new Ch().on("1081", "NO DATA").on("10C0", "50C0");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("ok", ev.outcome);
        assertEquals("10C0", ev.request);
        assertEquals("50C0", ev.raw);
        assertEquals("iki komut da gonderilmeliydi", 2, sessionCommandCount(ch));
    }

    // ── KANIT GUCU: EN GUCLU OLCUM KAZANIR (son olcum DEGIL) ─────────────────

    /**
     * ASIL KUSUR: 10 81 ayrik NEGATIF yanit verdi (adres CANLI, oturum RED) ama
     * 10 C0 sustu. Dongu "son"u dondurseydi kanit `no_response` olurdu ve saha
     * teshisi TERSINE donerdi ("ECU yok" denirdi — oysa ECU CEVAP VERMISTI).
     */
    @Test
    public void negatifYanit_sonrakiSessizlikTarafindanEZILMEZ() {
        Ch ch = new Ch().on("1081", "7F 10 12").on("10C0", "NO DATA");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("negative_nrc", ev.outcome);
        assertEquals("1081", ev.request);
        assertEquals("adres canli kaniti (NRC) kayboldu", Integer.valueOf(0x12), ev.nrc);
    }

    /** Cozumlenemeyen yanit (klon adaptor "?") sessizlikten GUCLUDUR — olculdu. */
    @Test
    public void malformedYanit_sessizlikTarafindanEZILMEZ() {
        Ch ch = new Ch().on("1081", "?").on("10C0", "NO DATA");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("malformed", ev.outcome);
        assertEquals("1081", ev.request);
    }

    /** Hat hatasi ECU hakkinda BIR SEY SOYLEMEZ → gercek bir olcum onu EZER. */
    @Test
    public void transportHatasi_gercekOlcumTarafindanEZILIR() {
        Ch ch = new Ch().throwOn("1081").on("10C0", "NO DATA");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("no_response", ev.outcome);
        assertEquals("10C0", ev.request);
    }

    // ── SESSIZLIK / HAT HATASI ──────────────────────────────────────────────

    /**
     * Iki komut da sustu → NO_RESPONSE. "NO DATA" adaptorun GERCEK cevabidir
     * (ECU sustu, ADAPTOR sustu degil) → ham kanit olarak KORUNUR; yalnizca
     * HIC yanit gelmeyen durumda {@code raw} null olur (bir alttaki test).
     */
    @Test
    public void ikisiDeSustu_noResponseVeHamYanitKorunur() {
        Ch ch = new Ch().defaultResponse("NO DATA");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("no_response", ev.outcome);
        assertEquals("adaptorun gercek cevabi atilmis", "NO DATA", ev.raw);
        assertNull(ev.nrc);
    }

    /** Bos yanit (prompt timeout) da sessizliktir — "ok" SAYILMAZ. */
    @Test
    public void bosYanit_sessizlikSayilir() {
        Ch ch = new Ch().defaultResponse("");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("no_response", ev.outcome);
        assertNull(ev.raw);
    }

    /** Iki komutta da hat hatasi → transport_error; ECU hakkinda hukum YOK. */
    @Test
    public void hatHatasi_transportErrorOlarakOlculur() {
        Ch ch = new Ch().throwOn("1081").throwOn("10C0");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("transport_error", ev.outcome);
        assertNull(ev.raw);
    }

    /** BUS ERROR gibi hat cevaplari da ECU kaniti DEGILDIR. */
    @Test
    public void busError_transportErrorSayilir() {
        Ch ch = new Ch().defaultResponse("BUS ERROR");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertEquals("transport_error", ev.outcome);
    }

    /** Yanlis pozitif onek (50 C0 gelirken 10 81 soruldu) POZITIF SAYILMAZ. */
    @Test
    public void yanlisPozitifOnek_okSayilmaz() {
        Ch ch = new Ch().on("1081", "50 C0").on("10C0", "NO DATA");
        ElmProtocol.SessionEvidence ev = new ElmProtocol(ch).probeKwpSessionRaw();

        assertFalse("baska komutun pozitif oneki 'ok' sayilmis", "ok".equals(ev.outcome));
        assertEquals("malformed", ev.outcome);
    }

    // ── HEDEF ECU HEADER'I: ATOMIK SET → GONDER → RESTORE ───────────────────

    /**
     * KWP hedefinde {@code ATSH<tx>} ayarlanir, oturum komutu O HEADER ile gider,
     * ardindan KWP varsayilan fonksiyonel header'ina DONULUR. {@code ATCRA}
     * K-line'da GONDERILMEZ (klonlarda "?" uretir — kutuk #831).
     */
    @Test
    public void hedefEcuHeaderi_atomikSetVeRestore_ATCRAyok() throws Exception {
        Ch ch = new Ch()
                .on("ATDPN", "5")
                .on("ATSH817AF1", "OK")
                .on("ATSHC133F1", "OK")
                .on("1081", "5081");

        ElmProtocol.SessionEvidence ev =
                new ElmProtocol(ch).probeKwpSessionFromEcu("817AF1", "86F17A");

        assertEquals("ok", ev.outcome);

        int set = ch.sent.indexOf("ATSH817AF1");
        int cmd = ch.sent.indexOf("1081");
        assertTrue("hedef header ayarlanmadi", set >= 0);
        assertTrue("oturum komutu hedef header AYARLANMADAN gonderilmis", set < cmd);
        assertTrue("KWP varsayilan header'ina donulmedi",
                ch.sent.lastIndexOf("ATSHC133F1") > cmd);
        for (String c : ch.sent) {
            assertFalse("K-line'da ATCRA gonderilmis: " + c, c.startsWith("ATCRA"));
        }
    }

    /** ISO 9141-2 ('3') hattinda restore hedefi 68 6A F1'dir (C1 33 F1 DEGIL). */
    @Test
    public void iso9141Restore_686AF1() throws Exception {
        Ch ch = new Ch()
                .on("ATDPN", "3")
                .on("ATSH8110F1", "OK")
                .on("ATSH686AF1", "OK")
                .on("1081", "NO DATA");

        new ElmProtocol(ch).probeKwpSessionFromEcu("8110F1", "486B10");

        assertTrue("ISO 9141-2 varsayilan header'ina donulmedi",
                ch.sent.contains("ATSH686AF1"));
        assertFalse("KWP2000 header'ina yanlislikla donulmus",
                ch.sent.contains("ATSHC133F1"));
    }
}
