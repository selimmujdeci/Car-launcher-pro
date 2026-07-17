package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * KwpRecoveryEvidenceTest — PR-KWP-EVID: KWP kurtarma akışı ÖLÇÜLEBİLİR mi?
 *
 * SAHA (2026-07-17, Trafic/KWP): tanı raporunda yalnız "OBD_DATA_GATE_TIMEOUT" vardı;
 * kurtarma denendi mi, ATPC sonrası veri döndü mü, yoksa Data Gate kurtarmayı mı yıktı —
 * HİÇBİRİ görünmüyordu. Bu testler istenen 5 senaryoyu kilitler.
 *
 * ElmProtocol ENTEGRASYONU sahte kanal ile UÇTAN UCA sürülür (gerçek noteKwpSessionHealth
 * yolu) — kanıtın YALNIZ saf sınıf değil, gerçek akışta da dolduğu kanıtlanır.
 */
public class KwpRecoveryEvidenceTest {

    /** Komutları kaydeden + komut başına sıralı yanıt kuyruğu olan kanal (son yanıt tekrarlanır). */
    private static class ScriptedChannel implements ElmCommandChannel {
        final List<String> sent = new ArrayList<>();
        final java.util.Map<String, java.util.ArrayDeque<String>> scripts = new java.util.HashMap<>();
        String defaultResponse = "NO DATA";

        ScriptedChannel on(String cmd, String... responses) {
            java.util.ArrayDeque<String> q = new java.util.ArrayDeque<>();
            for (String r : responses) q.add(r);
            scripts.put(cmd, q);
            return this;
        }

        @Override
        public String send(String cmd, int timeoutMs) {
            sent.add(cmd);
            java.util.ArrayDeque<String> q = scripts.get(cmd);
            if (q == null || q.isEmpty()) return defaultResponse;
            return q.size() == 1 ? q.peek() : q.poll();
        }

        @Override
        public void close() { }

        int countOf(String cmd) {
            int n = 0;
            for (String c : sent) if (c.equals(cmd)) n++;
            return n;
        }
    }

    /**
     * Belirtilen protokolde init edilmiş ElmProtocol kurar (KwpDeadSessionRecoveryTest ile
     * AYNI init script'i — tüm init komutları yanıtlanmalı, yoksa init hata dalına düşüp
     * JVM'de mock'suz android.util.Log'a çarpar).
     */
    private static ElmProtocol initProtocol(ScriptedChannel ch, String proto) throws Exception {
        ch.on("ATZ", "ELM327 v1.5")
          .on("ATE0", "OK").on("ATL0", "OK").on("ATS0", "OK").on("ATH0", "OK")
          .on("ATAT1", "OK").on("ATSP" + proto, "OK")
          .on("ATSTFF", "OK").on("ATWMC133F13E", "OK").on("ATSW92", "OK")
          .on("0100", "4100983B8011")
          .on("ATDPN", proto);
        ElmProtocol p = new ElmProtocol(ch);
        assertEquals(proto, p.initELM327(proto));
        ch.sent.clear();                          // init komutlarını ölçüme katma
        KwpRecoveryEvidence.INSTANCE.reset();     // init sırasındaki 0100 kanıta girmesin
        return p;
    }

    /** KWP (proto 5) aktif bir ElmProtocol. */
    private static ElmProtocol kwpProtocol(ScriptedChannel ch) throws Exception {
        return initProtocol(ch, "5");
    }

    /** CAN (proto 6) aktif bir ElmProtocol. */
    private static ElmProtocol canProtocol(ScriptedChannel ch) throws Exception {
        return initProtocol(ch, "6");
    }

    @Before
    public void setUp() {
        KwpRecoveryEvidence.INSTANCE.reset();
    }

    /* ══ 1. KWP recovery TETİKLENMİYOR ═══════════════════════════════════════ */

    @Test
    public void senaryo1_saglikliOturum_kurtarmaTetiklenmez() throws Exception {
        ScriptedChannel ch = new ScriptedChannel().on("010C", "41 0C 1B 90"); // OK
        ElmProtocol p = kwpProtocol(ch);
        for (int i = 0; i < 10; i++) p.readPID_rpm();

        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals("NOT_ATTEMPTED", s.status);
        assertEquals(0, s.recoveryCount);
        assertEquals(0, s.coreNoDataStreak);
        assertEquals(0, ch.countOf("ATPC"));
    }

    @Test
    public void senaryo1b_esikALTINDA_NO_DATA_kurtarmaTetiklemez() throws Exception {
        // Eşik 4 — 3 ardışık NO_DATA kurtarma BAŞLATMAMALI (tek kayıp frame paniği yok).
        ScriptedChannel ch = new ScriptedChannel().on("010C", "NO DATA");
        ElmProtocol p = kwpProtocol(ch);
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD - 1; i++) p.readPID_rpm();

        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals("NOT_ATTEMPTED", s.status);
        assertEquals(0, s.recoveryCount);
        assertEquals(0, ch.countOf("ATPC"));
        assertEquals(ElmProtocol.KWP_DEAD_SESSION_THRESHOLD - 1, s.coreNoDataStreak);
        assertEquals(ElmProtocol.KWP_DEAD_SESSION_THRESHOLD - 1, s.maxCoreNoDataStreak);
    }

    /* ══ 2. ATPC sonrası veri DÖNÜYOR → RECOVERED ════════════════════════════ */

    @Test
    public void senaryo2_atpcSonrasiVeriDonuyor_RECOVERED() throws Exception {
        // 4 NO_DATA → ATPC → sonraki istek OK (oturum dirildi).
        ScriptedChannel ch = new ScriptedChannel();
        ch.on("010C", "NO DATA", "NO DATA", "NO DATA", "NO DATA", "41 0C 1B 90");
        ElmProtocol p = kwpProtocol(ch);
        for (int i = 0; i < 5; i++) p.readPID_rpm();

        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals("RECOVERED", s.status);
        assertEquals(1, s.recoveryCount);
        assertEquals(1, ch.countOf("ATPC"));
        assertEquals("5", s.protocolAtRecovery);
        assertTrue("ATPC→ilk geçerli PID süresi ölçülmeli", s.lastRecoveryToFirstPidMs >= 0);
        assertTrue("son kurtarma zamanı damgalanmalı", s.lastRecoveryAt > 0);
        assertEquals(0, s.killedByDataGate);
    }

    /* ══ 3. ATPC sonrası veri DÖNMÜYOR → FAILED + TAVAN ══════════════════════ */

    @Test
    public void senaryo3_atpcSonrasiVeriDonmuyor_FAILED_veTavanDolar() throws Exception {
        ScriptedChannel ch = new ScriptedChannel().on("010C", "NO DATA"); // ASLA dönmüyor
        ElmProtocol p = kwpProtocol(ch);
        // Bol bol tur çevir — tavan olmasaydı sonsuza dek ATPC giderdi.
        for (int i = 0; i < 60; i++) p.readPID_rpm();

        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals("FAILED", s.status);
        assertEquals("kurtarma oturum başına BOUNDED olmalı",
            KwpRecoveryEvidence.MAX_RECOVERIES_PER_SESSION, s.recoveryCount);
        assertEquals("tavan aşıldıktan sonra ATPC GÖNDERİLMEMELİ",
            KwpRecoveryEvidence.MAX_RECOVERIES_PER_SESSION, ch.countOf("ATPC"));
        assertTrue("tavan sonrası bastırma sayılmalı", s.suppressedCount > 0);
    }

    @Test
    public void senaryo3b_yeniOturum_tavaniSifirlar() throws Exception {
        ScriptedChannel ch = new ScriptedChannel().on("010C", "NO DATA");
        ElmProtocol p = kwpProtocol(ch);
        for (int i = 0; i < 60; i++) p.readPID_rpm();
        assertEquals(KwpRecoveryEvidence.MAX_RECOVERIES_PER_SESSION,
            KwpRecoveryEvidence.INSTANCE.snapshot().recoveryCount);

        // Yeni bağlantı = yeni oturum (manager.connect → reset).
        KwpRecoveryEvidence.INSTANCE.reset();
        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals("NOT_ATTEMPTED", s.status);
        assertEquals(0, s.recoveryCount);
        assertEquals(0, s.suppressedCount);
    }

    /* ══ 4. Data Gate, recovery DEVAM EDERKEN disconnect ediyor ══════════════ */

    @Test
    public void senaryo4_dataGateKurtarmaSurerkenYikiyor() throws Exception {
        ScriptedChannel ch = new ScriptedChannel().on("010C", "NO DATA");
        ElmProtocol p = kwpProtocol(ch);
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();
        assertEquals("ATPC gitti, veri henüz gelmedi", "IN_PROGRESS",
            KwpRecoveryEvidence.INSTANCE.snapshot().status);

        // JS Data Gate 18s doldu → bağlantıyı yıkıyor (ATPC'ye veri döndürme ŞANSI TANIMADAN).
        KwpRecoveryEvidence.INSTANCE.noteDataGateTeardown();

        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals("FAILED", s.status);
        assertEquals("sahadaki en kritik hipotez ölçülebilir olmalı", 1, s.killedByDataGate);
    }

    @Test
    public void senaryo4b_dataGate_kurtarmaYOKKEN_sayacArtirmaz() throws Exception {
        // Gate sağlıklı/kurtarmasız oturumu yıkarsa bu KWP kurtarmasının suçu DEĞİLDİR.
        KwpRecoveryEvidence.INSTANCE.noteDataGateTeardown();
        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals(0, s.killedByDataGate);
        assertEquals("NOT_ATTEMPTED", s.status);
    }

    /* ══ 5. CAN protokolünde KWP kurtarma UYGULANMAZ ═════════════════════════ */

    @Test
    public void senaryo5_CAN_kwpKurtarmaUygulanmaz_alanlarBOS() throws Exception {
        ScriptedChannel ch = new ScriptedChannel().on("010C", "NO DATA"); // CAN'de de NO DATA
        ElmProtocol p = canProtocol(ch);
        for (int i = 0; i < 30; i++) p.readPID_rpm();

        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        // CAN'de kurtarma TS tarafındadır (PR-CAN-RECOVER); native KWP yolu HİÇ çalışmaz.
        assertEquals("CAN'de KWP kurtarması UYGULANMAZ", "NOT_ATTEMPTED", s.status);
        assertEquals(0, s.recoveryCount);
        assertEquals(0, ch.countOf("ATPC"));
        // Sayaçlar da dolmamalı — kanıt "bu araçta KWP kurtarması devrede DEĞİL" demeli.
        assertEquals(0, s.coreNoDataStreak);
        assertEquals(0, s.maxCoreNoDataStreak);
        assertEquals(null, s.protocolAtRecovery);
    }

    /* ══ Kanıt sözleşmesi ════════════════════════════════════════════════════ */

    @Test
    public void snapshot_esikVeTavaniRaporlar() {
        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertEquals(ElmProtocol.KWP_DEAD_SESSION_THRESHOLD, s.threshold);
        assertEquals(KwpRecoveryEvidence.MAX_RECOVERIES_PER_SESSION, s.maxPerSession);
    }

    @Test
    public void atpcGonderimHatasi_kanitaIslenir() throws Exception {
        ScriptedChannel ch = new ScriptedChannel() {
            @Override public String send(String cmd, int timeoutMs) {
                if ("ATPC".equals(cmd)) throw new RuntimeException("kanal koptu");
                return super.send(cmd, timeoutMs);
            }
        }.on("010C", "NO DATA");
        ElmProtocol p = kwpProtocol(ch);
        for (int i = 0; i < ElmProtocol.KWP_DEAD_SESSION_THRESHOLD; i++) p.readPID_rpm();

        KwpRecoveryEvidence.Snapshot s = KwpRecoveryEvidence.INSTANCE.snapshot();
        assertTrue("ATPC gitmediyse SESSİZ kalmamalı", s.atpcSendFailures > 0);
        assertEquals("FAILED", s.status);
    }
}
