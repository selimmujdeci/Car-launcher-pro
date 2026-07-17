package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

import org.junit.Test;

/**
 * CapabilityNrcEvidenceTest — PR-CAP-2: NRC baytı JS'e ULAŞIYOR mu?
 *
 * KÖK PROBLEM: eskiden {@code udsRequest} BEŞ ayrı durumu tek {@code null}'a düşürüyordu →
 * plugin {@code supported:false} yapıyordu → JS hepsini KALICI "desteklenmiyor" sayıyordu.
 * Yani "motor çalışınca okunur" (7F-22) veya "güvenlik gerekli" (7F-33) bir DID sonsuza
 * dek yasaklanıyordu. Bu testler o ayrımın native'de KORUNDUĞUNU kilitler.
 *
 * DAVRANIŞ KORUMASI: eski {@code readDataById} (String) yolu BİREBİR aynı kalmalı —
 * {@code readDataByIdDetailed} yalnız EK kanıt taşır.
 */
public class CapabilityNrcEvidenceTest {

    /** Sabit yanıt döndüren sahte kanal (ElmProtocolTest ile aynı desen). */
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

    private static ElmProtocol protoWith(FakeChannel ch) {
        return new ElmProtocol(ch);
    }

    /* ══ ElmResponseParser: NRC çıkarımı ══════════════════════════════════════ */

    @Test
    public void parser_neg7F_nrcBaytiniCikarir() {
        // "7F 22 31" — Mode 22 isteğine requestOutOfRange. mode="62" (pozitif önek) →
        // requestModeHex → "22" → neg needle "7F22" → NRC "31".
        ElmResponseParser.Result r = ElmResponseParser.classify("7F 22 31\r", "62", "F190");
        assertEquals(ElmResponseParser.Kind.NEG_7F, r.kind);
        assertNotNull("NRC çıkarılmalı", r.nrc);
        assertEquals(0x31, r.nrc.intValue());
    }

    @Test
    public void parser_neg7F_guvenlikNrcsi_ayirtEdilir() {
        ElmResponseParser.Result r = ElmResponseParser.classify("7F2233", "62", "F190");
        assertEquals(ElmResponseParser.Kind.NEG_7F, r.kind);
        assertEquals(0x33, r.nrc.intValue()); // securityAccessDenied — 0x31'den FARKLI
    }

    @Test
    public void parser_neg7F_kosulNrcsi_ayirtEdilir() {
        ElmResponseParser.Result r = ElmResponseParser.classify("7F 22 22", "62", "F190");
        assertEquals(ElmResponseParser.Kind.NEG_7F, r.kind);
        assertEquals(0x22, r.nrc.intValue()); // conditionsNotCorrect — GEÇİCİ, kalıcı DEĞİL
    }

    @Test
    public void parser_neg7F_nrcYarimKalmis_nullDoner_amaKindKorunur() {
        // "7F22" — NRC baytı gelmemiş (yarım yanıt). ECU ayrık negatif yanıt VERDİ bilgisi
        // korunmalı; NRC null → JS muhafazakâr dala düşer (kalıcı eleme YOK).
        ElmResponseParser.Result r = ElmResponseParser.classify("7F22", "62", "F190");
        assertEquals(ElmResponseParser.Kind.NEG_7F, r.kind);
        assertNull(r.nrc);
    }

    @Test
    public void parser_neg7F_bozukHexNrc_nullDoner_patlamaz() {
        ElmResponseParser.Result r = ElmResponseParser.classify("7F22ZZ", "62", "F190");
        assertEquals(ElmResponseParser.Kind.NEG_7F, r.kind);
        assertNull(r.nrc);
    }

    @Test
    public void parser_negOlmayanKindlerde_nrcNulldur() {
        assertNull(ElmResponseParser.classify("41 0D 32", "41", "0D").nrc);       // OK
        assertNull(ElmResponseParser.classify("NO DATA", "41", "0D").nrc);        // NO_DATA
        assertNull(ElmResponseParser.classify("CAN ERROR", "41", "0D").nrc);      // ERROR
        assertNull(ElmResponseParser.classify("", "41", "0D").nrc);               // TIMEOUT_PARTIAL
    }

    /* ══ ElmProtocol.readDataByIdDetailed: uçtan uca kanıt ════════════════════ */

    @Test
    public void detailed_pozitifYanit_OK_veriTasir() throws Exception {
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "62 F190 41 42 43"));
        ElmProtocol.UdsEvidence ev = p.readDataByIdDetailed("22", "F190");
        assertEquals("OK", ev.kind);
        assertEquals("414243", ev.data);
        assertNull(ev.nrc);
    }

    @Test
    public void detailed_noData_NO_DATA_olarakAyrisir_unsupportedDEGIL() {
        // KRİTİK: NO DATA "araç kimliği tanımıyor" DEMEK DEĞİLDİR (bitmap destekli PID de
        // NO DATA verebilir — Trafic/KWP sahası). Eskiden bu da null→supported:false idi.
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "NO DATA"));
        try {
            ElmProtocol.UdsEvidence ev = p.readDataByIdDetailed("22", "F190");
            assertEquals("NO_DATA", ev.kind);
            assertNull(ev.data);
            assertNull(ev.nrc);
        } catch (Exception e) {
            fail("NO DATA fırlatmamalı: " + e);
        }
    }

    @Test
    public void detailed_7F31_kimlikYok_nrcTasir() throws Exception {
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "7F 22 31"));
        ElmProtocol.UdsEvidence ev = p.readDataByIdDetailed("22", "F190");
        assertEquals("NEG_7F", ev.kind);
        assertNull(ev.data);
        assertEquals(0x31, ev.nrc.intValue()); // → TS: unsupported (kalıcı)
    }

    @Test
    public void detailed_7F33_guvenlik_nrcTasir_31DEN_AYRI() throws Exception {
        // BU TESTİN VARLIK SEBEBİ: eskiden 0x31 ve 0x33 AYNI null'a düşüyordu
        // (native classifyNrc ikisini de UNSUPPORTED sayıyor) → JS ayırt EDEMİYORDU.
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "7F 22 33"));
        ElmProtocol.UdsEvidence ev = p.readDataByIdDetailed("22", "F190");
        assertEquals("NEG_7F", ev.kind);
        assertEquals(0x33, ev.nrc.intValue()); // → TS: security_required (0x31'den FARKLI karar)
    }

    @Test
    public void detailed_21_KWP_LID_ayniSozlesme() throws Exception {
        ElmProtocol p = protoWith(new FakeChannel().on("2180", "61 80 0A 0B"));
        ElmProtocol.UdsEvidence ev = p.readDataByIdDetailed("21", "80");
        assertEquals("OK", ev.kind);
        assertEquals("0A0B", ev.data);
    }

    @Test
    public void detailed_hatHatasi_FIRLAR_sessizce_desteklenmiyor_ogrenilmez() {
        // ZERO-TRUST: CAN ERROR araç yeteneği hakkında KANIT DEĞİLDİR. Fırlamalı ki JS
        // 'timeout' saysın ve HİÇBİR ŞEY öğrenmesin. Sessizce evidence dönseydi, kopan bir
        // kablo aracın yeteneklerini "yok" diye öğretirdi.
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "CAN ERROR"));
        try {
            p.readDataByIdDetailed("22", "F190");
            fail("hat hatası IOException fırlatmalıydı");
        } catch (Exception e) {
            // beklenen
        }
    }

    /* ══ DAVRANIŞ KORUMASI: eski String yolu değişmedi ════════════════════════ */

    @Test
    public void geriyeUyum_readDataById_pozitifYanittaAyniVeri() throws Exception {
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "62 F190 41 42 43"));
        assertEquals("414243", p.readDataById("22", "F190"));
    }

    @Test
    public void geriyeUyum_readDataById_noDataDaHalaNull() throws Exception {
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "NO DATA"));
        assertNull(p.readDataById("22", "F190"));
    }

    @Test
    public void geriyeUyum_readDataById_7F31DeHalaNull() throws Exception {
        ElmProtocol p = protoWith(new FakeChannel().on("22F190", "7F 22 31"));
        assertNull(p.readDataById("22", "F190"));
    }
}
