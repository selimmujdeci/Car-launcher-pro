package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

/**
 * KwpSilentTimeoutStallTest — P0 "canlı veri 30-60sn sonra donuyor" KÖK NEDEN KANITI.
 *
 * SAHA (2026-07-23, Renault Trafic, KWP/5): OBD bağlanıyor, ilk 30-60sn tüm PID'ler
 * normal akıyor, sonra RPM/coolant DONUYOR. Uygulama BAĞLI görünmeye devam ediyor.
 * Adaptör fiziksel olarak çıkarılıp takılınca veri geri geliyor, ~1dk sonra yine donuyor.
 *
 * ── KANITLANAN ZİNCİR ──────────────────────────────────────────────────────────
 * 1) {@code RfcommChannel.send()} '>' prompt'unu göremeden süre dolarsa EXCEPTION
 *    ATMAZ — eldeki (çoğu zaman BOŞ) yanıtı döner.
 * 2) Boş yanıt {@link ElmResponseParser}'da {@code NO_DATA} değil
 *    {@code TIMEOUT_PARTIAL} sınıfına düşer (ElmResponseParser satır 137-138).
 * 3) {@link ElmProtocol#noteKwpSessionHealth} yalnız {@code NO_DATA} sayar:
 *    {@code if (kind != Kind.NO_DATA) return;} → SESSİZ TIMEOUT sayaca HİÇ girmez.
 * 4) Sonuç: ardışık çekirdek NO_DATA eşiği ASLA dolmaz → **ATPC hiç gönderilmez**,
 *    KWP ölü-oturum kurtarması sessiz timeout'a KÖRDÜR. Oturum ölü kalır; yalnız
 *    adaptörün fiziksel power-cycle'ı ELM327'yi sıfırlayıp akışı geri getirir.
 *
 * Bu dosya o körlüğü KİLİTLER: sessiz timeout da ölü-oturum kanıtıdır.
 */
public class KwpSilentTimeoutStallTest {

    /**
     * {@link KwpRecoveryEvidence} STATİK singleton'dır ve kurtarma TAVANI tutar —
     * sıfırlanmazsa bir testin tükettiği tavan diğerini sessizce bozar (sıra bağımlılığı).
     */
    @Before
    public void resetEvidence() {
        KwpRecoveryEvidence.INSTANCE.reset();
        LiveStreamStopEvidence.INSTANCE.reset();
    }

    /**
     * Gerçek {@code RfcommChannel} timeout davranışını taklit eden kanal:
     * ECU sustuğunda ELM327 prompt'a kadar yanıt üretmez → send() BOŞ string döner
     * (exception YOK — üretimdeki davranışın birebir aynısı).
     */
    private static final class SilentTimeoutChannel implements ElmCommandChannel {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        private final java.util.Map<String, String> responses = new java.util.HashMap<>();
        /** true → çekirdek PID'ler sessiz timeout (boş yanıt) üretir. */
        boolean stalled = false;

        SilentTimeoutChannel on(String cmd, String response) {
            responses.put(cmd, response);
            return this;
        }

        @Override
        public String send(String cmd, int timeoutMs) {
            sent.add(cmd);
            String mapped = responses.get(cmd);
            if (mapped != null) return mapped;
            // Sessiz timeout: '>' görülmedi, tampon boş → trim() sonrası "" döner.
            return stalled ? "" : "NO DATA";
        }

        @Override
        public void close() { /* no-op */ }
    }

    private static ElmProtocol initProtocol(SilentTimeoutChannel ch, String proto) throws Exception {
        ch.on("ATZ", "ELM327 v1.5")
          .on("ATE0", "OK").on("ATL0", "OK").on("ATS0", "OK").on("ATH0", "OK")
          .on("ATAT1", "OK").on("ATSP" + proto, "OK")
          .on("ATSTFF", "OK").on("ATWMC133F13E", "OK").on("ATSW92", "OK")
          .on("0100", "4100983B8011")
          .on("ATDPN", proto);
        ElmProtocol p = new ElmProtocol(ch);
        assertEquals(proto, p.initELM327(proto));
        ch.sent.clear();
        return p;
    }

    private static int countAtpc(java.util.List<String> sent) {
        int n = 0;
        for (String s : sent) if ("ATPC".equals(s)) n++;
        return n;
    }

    /** ATWS = güçlü kurtarmanın (reinitSession) imzası. */
    private static int countAtws(java.util.List<String> sent) {
        int n = 0;
        for (String s : sent) if ("ATWS".equals(s)) n++;
        return n;
    }

    /* ── KANIT 1: boş yanıt NO_DATA değil TIMEOUT_PARTIAL'dır ─────────────────── */

    @Test
    public void emptyResponse_classifiesAsTimeoutPartial_notNoData() {
        ElmResponseParser.Result r = ElmResponseParser.classify("", "41", "0C");
        assertEquals("boş yanıt NO_DATA sanılıyorsa kurtarma sayacı yanlış beslenir",
                ElmResponseParser.Kind.TIMEOUT_PARTIAL, r.kind);
    }

    /* ── KANIT 2: sessiz timeout kurtarmayı TETİKLEMİYOR (asıl kusur) ─────────── */

    @Test
    public void silentTimeout_onCorePids_triggersAtpcRecovery() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "5");
        ch.stalled = true;                    // ECU sustu — ELM327 prompt üretmiyor

        // Eşik kadar ardışık çekirdek sessiz timeout.
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) {
            assertEquals(-1, p.readPID_rpm());
        }

        assertTrue("sessiz timeout ölü-oturum sayılmıyor → ATPC HİÇ gönderilmiyor "
                + "(saha: veri donuyor, yalnız adaptör power-cycle düzeltiyor)",
                countAtpc(ch.sent) >= 1);
    }

    /* ── KANIT 3: donma KALICI — 20 poll turu boyunca kurtarma yok ────────────── */

    @Test
    public void silentTimeout_isPersistent_recoveryNeverRuns() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "5");
        ch.stalled = true;

        for (int i = 0; i < 20; i++) p.readPID_rpm();

        assertTrue("20 ardışık sessiz timeout'ta bile kurtarma çalışmadı",
                countAtpc(ch.sent) >= 1);
    }

    /* ── KILIT: sağlıklı oturum yanlış-pozitif ATPC ALMAZ ─────────────────────── */

    @Test
    public void healthySession_noFalsePositiveRecovery() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ch.on("010C", "410C1A2B");            // geçerli RPM yanıtı
        ElmProtocol p = initProtocol(ch, "5");

        for (int i = 0; i < 20; i++) p.readPID_rpm();

        assertEquals("sağlıklı oturumda ATPC gönderildi (yanlış pozitif)",
                0, countAtpc(ch.sent));
    }

    /* ── KILIT: araya giren OK sayacı sıfırlar (kesintili ağ ≠ ölü oturum) ────── */

    @Test
    public void intermittentTimeout_withOkBetween_doesNotRecover() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "5");

        for (int i = 0; i < 6; i++) {
            ch.stalled = true;
            p.readPID_rpm();                  // 1 sessiz timeout
            ch.stalled = false;
            ch.on("010C", "410C1A2B");
            assertTrue(p.readPID_rpm() >= 0); // ardından geçerli yanıt → seri kırılır
            ch.on("010C", null);
        }

        assertEquals("tek tük timeout ölü oturum sayıldı (gereksiz ATPC)",
                0, countAtpc(ch.sent));
    }

    /* ── KILIT: uzun sürüşte kurtarma TÜKENMEZ (tavan başarıyla tazelenir) ───── */

    /**
     * SAHA (2026-07-23): Trafic'te KWP oturumu ~dakikada bir ölüyor. Tavan eskiden
     * OTURUM BAŞINA TOPLAM kurtarmaydı ve başarı onu geri vermiyordu → 3. kurtarmadan
     * sonra motor kalıcı susuyordu ("~1 dakika sonra tekrar donuyor, sürekli tekrar").
     * 20 dakikalık sürüşü temsilen 10 ölüm-diriliş turu: her turda kurtarma ÇALIŞMALI.
     */
    @Test
    public void repeatedDeathAndRecovery_overLongDrive_neverExhaustsRecovery() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "5");

        for (int cycle = 0; cycle < 10; cycle++) {
            // Oturum öldü → eşik kadar sessiz timeout → ATPC beklenir.
            ch.stalled = true;
            ch.on("010C", null);
            for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();

            assertEquals("tur " + cycle + ": kurtarma tükendi — uzun sürüşte veri kalıcı donar",
                    cycle + 1, countAtpc(ch.sent));

            // ATPC işe yaradı → veri geri geldi (oturum dirildi).
            ch.stalled = false;
            ch.on("010C", "410C1A2B");
            assertTrue(p.readPID_rpm() >= 0);
        }
    }

    /**
     * MERDİVEN (P0 saha 2026-07-23): ATPC yetmezse GÜÇLÜ kurtarmaya (ATWS+reinit) yüksel.
     * Sessiz timeout üstüne ATPC işe yaramayınca ikinci kurtarma reinit olmalı.
     */
    @Test
    public void silentTimeout_atpcFails_escalatesToReinit() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "5");
        ch.stalled = true;

        // İki tam eşik: 1. ATPC, 2. (ATPC tutmadı) → ATWS+reinit.
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD * 2; i++) p.readPID_rpm();

        assertEquals("ilk deneme ATPC olmalı", 1, countAtpc(ch.sent));
        assertTrue("ATPC yetmeyince ATWS+reinit'e yükselmeli (Trafic ATPC ile uyanmıyor)",
                countAtws(ch.sent) >= 1);
    }

    /**
     * Karşı kilit: kurtarma HİÇ işe yaramıyorsa (ölü ECU) sonsuz tur OLMAZ — merdiven
     * (ATPC + reinit'ler) tavanda durur ("sürekli reconnect döngüsü yasak").
     */
    @Test
    public void deadEcu_recoveryStopsAtCeiling_noInfiniteLoop() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "5");
        ch.stalled = true;                    // ECU hiç dirilmiyor

        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD * 12; i++) p.readPID_rpm();

        // Merdiven: 1 ATPC + (MAX-1) REINIT = MAX toplam kurtarma, sonra dur.
        int total = countAtpc(ch.sent) + countAtws(ch.sent);
        assertEquals("toplam kurtarma denemesi tavanı aşamaz (sonsuz tur yok)",
                KwpRecoveryEvidence.MAX_RECOVERIES_PER_SESSION, total);
        assertEquals("ilk deneme tam 1 ATPC", 1, countAtpc(ch.sent));
    }

    /* ── KÖK NEDEN (P0 saha 2026-07-23, HAM TRAFİK): "BUS INIT: ERROR" ────────── */

    /**
     * SAHA KANITI: Trafic/KWP oturumu ölünce ELM327 NO_DATA değil "BUS INIT: ERROR"
     * döndürüyor (adaptör AT'lere OK). Parser bunu Kind.BUSY sınıflar; recovery eskiden
     * BUSY'yi dışlıyordu → HER core PID = BUS INIT: ERROR olmasına rağmen recovery=0,
     * veri ~2dk donuk. Bus-init hatası artık ölü-oturum sayılıp ATPC/reinit tetiklemeli.
     */
    @Test
    public void busInitError_onCorePids_triggersRecovery() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ch.on("010C", "BUS INIT: ERROR");           // readPID_rpm → 010C
        ElmProtocol p = initProtocol(ch, "5");

        // Eşik kadar ardışık "BUS INIT: ERROR" → recovery (ATPC) beklenir.
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();

        assertTrue("BUS INIT: ERROR ölü-oturum sayılmıyor → recovery HİÇ tetiklenmiyor "
                + "(saha: adaptör canlı, bus init başarısız, veri ~2dk donuk)",
                countAtpc(ch.sent) >= 1);
    }

    /** Yalın "BUS INIT" (init SÜRÜYOR, ERROR yok) recovery TETİKLEMEZ — ELM zaten deniyor. */
    @Test
    public void transientBusInit_noError_doesNotTriggerRecovery() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ch.on("010C", "BUS INIT:");                 // ERROR yok — geçici init
        ElmProtocol p = initProtocol(ch, "5");

        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD * 2; i++) p.readPID_rpm();

        assertEquals("yalın 'BUS INIT' (init sürüyor) recovery tetikledi (yanlış pozitif)",
                0, countAtpc(ch.sent));
    }

    /** UNABLE TO CONNECT de terminal bus-ölüm → recovery tetikler. */
    @Test
    public void unableToConnect_triggersRecovery() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ch.on("010C", "UNABLE TO CONNECT");
        ElmProtocol p = initProtocol(ch, "5");

        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();

        assertTrue("UNABLE TO CONNECT ölü-oturum sayılmalı", countAtpc(ch.sent) >= 1);
    }

    /** CAN'de (protokol 6) bus-init hatası olsa bile KWP recovery TETİKLENMEZ (ayrı motor). */
    @Test
    public void busInitError_onCan_noAtpc() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ch.on("010C", "BUS INIT: ERROR");
        ElmProtocol p = initProtocol(ch, "6");

        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD * 3; i++) p.readPID_rpm();

        assertEquals("CAN'de KWP ATPC recovery tetiklendi (CAN kurtarması TS'in işidir)",
                0, countAtpc(ch.sent));
    }

    /* ── İZLENEBİLİRLİK: akış sessizce duramaz ────────────────────────────────── */

    @Test
    public void stall_recordsTypedStopReason_withEvidence() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ch.on("010C", "410C1A2B");
        ElmProtocol p = initProtocol(ch, "5");

        assertTrue(p.readPID_rpm() >= 0);              // önce sağlıklı paket (künye dolsun)
        ch.stalled = true;
        ch.on("010C", null);
        p.readPID_rpm();                                // sonra sessiz timeout

        LiveStreamStopEvidence.Record r = LiveStreamStopEvidence.INSTANCE.last();
        assertTrue("akış durdu ama HİÇBİR sebep kaydı üretilmedi (sessiz donma)", r != null);
        assertEquals("sessiz timeout READ_TIMEOUT olarak sınıflanmalı",
                LiveStreamStopEvidence.Reason.READ_TIMEOUT, r.reason);
        assertEquals("010C", r.lastSuccessfulPid);
        assertEquals("5", r.protocol);
        assertTrue("son paketten bu yana geçen süre ölçülmemiş", r.elapsedSinceLastPacketMs >= 0);
        assertTrue("requestId üretilmemiş", r.requestId > 0);
    }

    @Test
    public void explicitNoData_classifiedAsEcuNoResponse() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();   // stalled=false → "NO DATA"
        ElmProtocol p = initProtocol(ch, "5");

        p.readPID_rpm();

        LiveStreamStopEvidence.Record r = LiveStreamStopEvidence.INSTANCE.last();
        assertTrue(r != null);
        assertEquals("açık NO DATA, ECU'nun sustuğunun kanıtıdır (ELM canlı)",
                LiveStreamStopEvidence.Reason.ECU_NO_RESPONSE, r.reason);
    }

    @Test
    public void repeatedSameReason_isRecordedButNotSpammed() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "5");
        ch.stalled = true;

        for (int i = 0; i < 12; i++) p.readPID_rpm();

        assertTrue("durma olayları sayılmıyor", LiveStreamStopEvidence.INSTANCE.totalStops() >= 12);
        assertTrue("kayıt halkası sınırsız büyüyor (bellek sızıntısı)",
                LiveStreamStopEvidence.INSTANCE.history().size() <= 20);
    }

    /* ── KILIT: CAN'de (protokol 6) sessiz timeout kurtarması YOK ─────────────── */

    @Test
    public void canProtocol_silentTimeout_noAtpc() throws Exception {
        SilentTimeoutChannel ch = new SilentTimeoutChannel();
        ElmProtocol p = initProtocol(ch, "6");
        ch.stalled = true;

        for (int i = 0; i < 20; i++) p.readPID_rpm();

        assertEquals("CAN'de native ATPC çalıştı — CAN kurtarması TS'in işidir (çift motor)",
                0, countAtpc(ch.sent));
    }
}
