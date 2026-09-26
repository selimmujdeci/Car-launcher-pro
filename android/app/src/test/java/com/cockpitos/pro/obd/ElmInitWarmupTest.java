package com.cockpitos.pro.obd;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

/**
 * P0-OBD-WARMUP-SEARCH — `0100` warm-up penceresi ve `SEARCHING` uzatması.
 *
 * ── KÖK NEDEN (saha 2026-09-13, Renault + ELM327 v2.2, classic SPP) ───────────
 * Car Scanner AYNI dongle + AYNI araçta veri alırken CarOS bağlanamıyordu.
 * Ham iz: ATZ…ATSP0 komutlarının HEPSİ 40-80 ms'de "OK" döndü, ardından
 * `0100` → `ELM partial response timeout` (5,3 sn), HER turda.
 *
 * `partial` bayrağı tanım gereği "KISMİ YANIT VARDI" demektir
 * ({@link ElmPromptTimeoutException}: {@code partial = !partialResponse.isEmpty()}),
 * yani adaptör CEVAP VERİYORDU. ATSP0 otomatik aramada ELM327 önce `SEARCHING...`
 * yayar; nihai yanıt saniyeler sonra gelir. Kodda "SEARCHING görülürse pencereyi
 * uzat" çaresi ZATEN yazılıydı ama ERİŞİLEMEZDİ: `sendChecked` kısmi timeout'ta
 * İSTİSNA fırlattığı için `warm` dizisi hiç oluşmuyor, `if` satırına HİÇ
 * gelinmiyordu. Kısmi yanıt istisnanın İÇİNDE taşınıyor ve kimse okumuyordu.
 *
 * Bu testler o iki davranışı kilitler:
 *   (1) kısmi timeout'ta yanıt İSTİSNADAN okunur → uzatma gerçekten çalışır;
 *   (2) TAM yanıt gelmişse uzatma ÇALIŞMAZ (fail-open kapalı).
 *
 * Android/Bluetooth mock'u gerekmez — {@link ElmCommandChannel} tek metotlu saf
 * arayüzdür, sahte kanal yeterlidir.
 */
public class ElmInitWarmupTest {

    /** Komut → yanıt senaryosu çalıştıran sahte kanal; her komutu ve timeout'u kaydeder. */
    private static final class FakeChannel implements ElmCommandChannel {
        /** cmd → sırayla dönecek sonuçlar. Sonuç ya String'dir ya fırlatılacak Exception. */
        final Map<String, List<Object>> script = new LinkedHashMap<>();
        final List<String>  sentCommands = new ArrayList<>();
        final List<Integer> sentTimeouts = new ArrayList<>();
        /** Scriptte karşılığı olmayan komutlar için varsayılan yanıt. */
        String fallback = "OK";

        FakeChannel on(String cmd, Object... results) {
            List<Object> l = new ArrayList<>();
            for (Object r : results) l.add(r);
            script.put(cmd, l);
            return this;
        }

        @Override public String send(String cmd, int timeoutMs) throws Exception {
            sentCommands.add(cmd);
            sentTimeouts.add(timeoutMs);
            List<Object> l = script.get(cmd);
            if (l == null || l.isEmpty()) return fallback;
            Object r = l.remove(0);
            if (r instanceof Exception) throw (Exception) r;
            return (String) r;
        }

        @Override public void close() { /* no-op */ }

        /** Bir komutun kaç kez gönderildiği. */
        int countOf(String cmd) {
            int n = 0;
            for (String c : sentCommands) if (cmd.equals(c)) n++;
            return n;
        }

        /** Bir komutun İLK gönderiminde kullanılan timeout. Hiç gönderilmediyse -1. */
        int firstTimeoutOf(String cmd) {
            for (int i = 0; i < sentCommands.size(); i++) {
                if (cmd.equals(sentCommands.get(i))) return sentTimeouts.get(i);
            }
            return -1;
        }
    }

    /** ATZ/ATE0/… hepsi OK dönen, ATDPN'i verilen protokolü döndüren taban senaryo. */
    private static FakeChannel baseChannel(String dpn) {
        FakeChannel ch = new FakeChannel();
        ch.on("ATZ", "ELM327 v2.2");
        ch.on("ATDPN", dpn);
        return ch;
    }

    // ── (1) ASIL DÜZELTME: kısmi timeout'ta uzatma ERİŞİLEBİLİR ──────────────────

    @Test public void kismiTimeoutta_SEARCHING_varsa_uzatmaCALISIR_veInitGECER() throws Exception {
        FakeChannel ch = baseChannel("7");
        // Sahadaki birebir durum: prompt görülmeden pencere doldu, elde "SEARCHING..." var.
        ch.on("0100", new ElmPromptTimeoutException("SEARCHING...", true));
        // Uzatma turu (boş komut = "devam eden yanıtı beklemeye devam et") gerçek yanıtı getirir.
        ch.on("", "SEARCHING...4100983B0011");

        String proto = new ElmInitSequencer(ch).init(null);

        assertEquals("ATDPN ile okunan aktif protokol dönmeli", "7", proto);
        assertEquals("uzatma turu TAM OLARAK bir kez çalışmalı", 1, ch.countOf(""));
    }

    @Test public void kismiTimeoutta_SEARCHING_YOKSA_hataYUTULMAZ() {
        FakeChannel ch = baseChannel("6");
        // Kısmi yanıt arama bildirimi DEĞİL → bu gerçek bir iletişim arızasıdır.
        ch.on("0100", new ElmPromptTimeoutException("41 00 98 3B", false));

        try {
            new ElmInitSequencer(ch).init(null);
            fail("arama DIŞI kısmi timeout dürüstçe fırlatılmalı — yutulursa " +
                 "bağlı-ama-ölü oturum doğar");
        } catch (Exception e) {
            assertTrue("tipli istisna korunmalı", e instanceof ElmPromptTimeoutException);
            assertEquals("uzatma turu HİÇ çalışmamalı", 0, ch.countOf(""));
        }
    }

    // ── (2) FAIL-OPEN KAPATMASI: tam yanıt EZİLMEZ ──────────────────────────────

    @Test public void tamYanitta_SEARCHING_iceriyorsa_gercekHATA_gizlenmez() {
        FakeChannel ch = baseChannel("6");
        /* ÖLÇÜLEN FAIL-OPEN: eski koşul yalnız "SEARCHING içeriyor mu" idi ve
           TAMAMLANMIŞ yanıtı da uzatma turuyla eziyordu. Uzatma "?" dönünce hata
           deseni kaybolur, UnableToConnectException ATILMAZ ve bağlı-ama-ölü
           oturum doğardı. Artık tam yanıt korunur. */
        ch.on("0100", "SEARCHING...UNABLE TO CONNECT");
        ch.on("", "?");

        try {
            new ElmInitSequencer(ch).init(null);
            fail("UNABLE TO CONNECT dürüstçe UnableToConnectException olmalı");
        } catch (Exception e) {
            assertTrue("sert hata tipli gelmeli, generic IOException değil",
                e instanceof ElmInitSequencer.UnableToConnectException);
            assertEquals("tam yanıt geldiğinde uzatma turu ÇALIŞMAMALI (ezme yok)",
                0, ch.countOf(""));
        }
    }

    @Test public void tamYanitta_SEARCHING_iceriyorsa_gercekYUK_ezilmez() throws Exception {
        FakeChannel ch = baseChannel("7");
        // Sahada birebir görülen tam yanıt: arama bildirimi + GERÇEK yük birlikte.
        ch.on("0100", "SEARCHING...4100983B0011");
        ch.on("", "?");

        String proto = new ElmInitSequencer(ch).init(null);

        assertEquals("7", proto);
        assertEquals("yük varken uzatma turu ÇALIŞMAMALI", 0, ch.countOf(""));
    }

    @Test public void yalnizcaAramaBildirimiVarsa_tamYanitta_da_uzatilir() throws Exception {
        FakeChannel ch = baseChannel("6");
        // Prompt görüldü ama içerik SADECE arama bildirimi → henüz veri yok, beklemeye devam.
        ch.on("0100", "SEARCHING...");
        ch.on("", "41 00 BE 3F A8 13");

        String proto = new ElmInitSequencer(ch).init(null);

        assertEquals("6", proto);
        assertEquals("içerik yokken uzatma turu çalışmalı", 1, ch.countOf(""));
    }

    // ── (3) PENCERE BOYUTLARI: otomatik arama ≠ zorlanmış protokol ───────────────

    @Test public void otomatikAramada_warmupPenceresi_GENIS_zorlanmisProtokolde_ESKI() throws Exception {
        FakeChannel auto = baseChannel("7");
        auto.on("0100", "4100983B0011");
        new ElmInitSequencer(auto).init(null);           // ATSP0 → otomatik arama

        FakeChannel forced = baseChannel("6");
        forced.on("0100", "4100BE3FA813");
        new ElmInitSequencer(forced).init("6");          // ATSP6 → arama YOK

        int autoMs   = auto.firstTimeoutOf("0100");
        int forcedMs = forced.firstTimeoutOf("0100");

        assertTrue("otomatik aramada pencere ZORLANMIŞTAN geniş olmalı — 5 sn'nin " +
            "yetmediği sahada ölçüldü", autoMs > forcedMs);
        assertEquals("zorlanmış protokolde eski 5 sn AYNEN korunmalı (çalışan CAN " +
            "yolunda regresyon yok)", 5_000, forcedMs);
        assertTrue("ATSP0 penceresi JS connect bütçesine (15 sn) sığmalı: " +
            "AT dizisi + warmup + uzatma < 15 sn", autoMs <= 9_000);
    }

    @Test public void zorlanmisProtokolde_ATSP_numarasi_gonderilir() throws Exception {
        FakeChannel ch = baseChannel("5");
        ch.on("0100", "4100BE3FA813");

        new ElmInitSequencer(ch).init("5");

        assertTrue("zorlanmış protokolde ATSP5 gitmeli", ch.sentCommands.contains("ATSP5"));
        assertFalse("otomatik arama komutu GİTMEMELİ", ch.sentCommands.contains("ATSP0"));
    }

    @Test public void otomatikProtokolde_ATSP0_gonderilir() throws Exception {
        FakeChannel ch = baseChannel("7");
        ch.on("0100", "4100983B0011");

        new ElmInitSequencer(ch).init(null);

        assertTrue("protokol bilinmiyorsa ATSP0 gitmeli", ch.sentCommands.contains("ATSP0"));
    }

    // ── (4) ZORLANMIŞ PROTOKOLDE NO DATA = YANLIŞ PROTOKOL (mevcut davranış kilidi) ──

    @Test public void zorlanmisProtokolde_NODATA_sertHataOlur() {
        FakeChannel ch = baseChannel("6");
        // Sahada ölçülmüş sınıf: yanlış protokol zorlanınca ECU hiç yanıtlamaz.
        ch.on("0100", "NO DATA");

        try {
            new ElmInitSequencer(ch).init("6");
            fail("zorlanmış protokolde NO DATA, JS'in bir sonraki protokol adayına " +
                 "geçebilmesi için UnableToConnectException olmalı");
        } catch (Exception e) {
            assertTrue(e instanceof ElmInitSequencer.UnableToConnectException);
        }
    }

    @Test public void otomatikProtokolde_NODATA_sertHataDEGIL() throws Exception {
        FakeChannel ch = baseChannel("7");
        /* ATSP0 yolunda ELM tüm protokolleri KENDİ tarar; NO DATA burada
           "bu PID yok" anlamına gelebilir ve protokol döngüsünü ilerletmemeli. */
        ch.on("0100", "NO DATA");

        assertEquals("otomatik yolda NO DATA init'i düşürmemeli", "7",
            new ElmInitSequencer(ch).init(null));
    }
}
