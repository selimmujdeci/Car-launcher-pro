package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

/**
 * P0-VDK-B3 · POLL MALİYET MUHASEBESİ kilitleri (yerel JVM, cihaz gerekmez).
 *
 * SAHA (2026-08-30 · CAROS LAB TAM KOPYA): `attempted:117 · success:117 · noData:0`
 * "hat kusursuz" diyordu; aynı oturumun ham trafiğinde onlarca NO DATA, `7F1912` ve
 * istek başına dört AT komutu vardı. Kullanıcı verisi maliyeti ile adaptör yönetim
 * maliyeti AYRI ölçülmediği sürece bu çelişki görünmez kalıyordu.
 */
public class PollCostLedgerTest {

    private PollCostLedger led;

    @Before
    public void setUp() {
        led = PollCostLedger.INSTANCE;
        led.reset(1_000L);
    }

    /* ── Sınıflandırma: TEK kaynak, deterministik ───────────────────────────── */

    @Test
    public void classify_pidIstegiPayloadSayilir() {
        assertEquals(PollCostLedger.CostClass.DIAGNOSTIC_PAYLOAD, PollCostLedger.classify("010C"));
        assertEquals(PollCostLedger.CostClass.DIAGNOSTIC_PAYLOAD, PollCostLedger.classify("22F190"));
        assertEquals(PollCostLedger.CostClass.DIAGNOSTIC_PAYLOAD, PollCostLedger.classify("1902FF"));
        assertEquals(PollCostLedger.CostClass.DIAGNOSTIC_PAYLOAD, PollCostLedger.classify("03"));
    }

    @Test
    public void classify_adreslemeVoltajProtokolAyriSiniflar() {
        assertEquals(PollCostLedger.CostClass.HEADER_SWITCH,   PollCostLedger.classify("ATSH7E0"));
        assertEquals(PollCostLedger.CostClass.HEADER_SWITCH,   PollCostLedger.classify("ATCRA7E8"));
        assertEquals(PollCostLedger.CostClass.HEADER_SWITCH,   PollCostLedger.classify("ATAR"));
        assertEquals(PollCostLedger.CostClass.VOLTAGE_READ,    PollCostLedger.classify("ATRV"));
        assertEquals(PollCostLedger.CostClass.PROTOCOL_CHECK,  PollCostLedger.classify("ATDPN"));
        assertEquals(PollCostLedger.CostClass.PROTOCOL_CHECK,  PollCostLedger.classify("ATSP6"));
        // Başlık BASIMI (çıktı biçimi) adresleme DEĞİLDİR.
        assertEquals(PollCostLedger.CostClass.ADAPTER_CONTROL, PollCostLedger.classify("ATH1"));
        assertEquals(PollCostLedger.CostClass.ADAPTER_CONTROL, PollCostLedger.classify("ATE0"));
    }

    /* ── ZORUNLU: 10 PID + 4 AT → 14 komut ama İKİ SINIF AYRI ──────────────── */

    @Test
    public void b3_onPidDortAt_toplamGorunurAmaSiniflarAyri() {
        led.beginCycle(7, false, 10_000L);
        for (int i = 0; i < 10; i++) led.noteCommand("010C", "410C0D49", 40);
        led.noteCommand("ATSH7E0", "OK", 41);
        led.noteCommand("ATCRA7E8", "OK", 41);
        led.noteCommand("ATSH7DF", "OK", 41);
        led.noteCommand("ATAR", "OK", 41);
        led.endCycle(11_000L);

        PollCostLedger.CycleCost c = led.snapshot().lastCycle;
        assertNotNull(c);
        assertEquals(10, c.diagnosticPayloadRequests);
        assertEquals(4, c.adapterControlCommands);
        assertEquals(4, c.headerSwitches);
        // Toplam görünür ama TEK SAYIYA indirgenmemiştir.
        assertEquals(14, c.diagnosticPayloadRequests + c.adapterControlCommands);
    }

    /* ── ZORUNLU: cevapsız maliyet 0 SAYILMAZ ──────────────────────────────── */

    @Test
    public void b3_noResponseMaliyeti0Sayilmaz() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("1902FF", "NO DATA", 453);
        led.noteCommand("0A", "NO DATA", 456);
        led.endCycle(1_000L);

        PollCostLedger.CycleCost c = led.snapshot().lastCycle;
        assertEquals(2, c.noResponses);
        assertEquals(909, c.noResponseMs);
        assertTrue("cevapsız istek yine de payload isteğidir", c.diagnosticPayloadRequests == 2);
    }

    @Test
    public void b3_negatifYanitCevapsizlikDEGILdirAmaMaliyetSayilir() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("1903", "7F1912", 427);
        led.endCycle(1_000L);

        PollCostLedger.CycleCost c = led.snapshot().lastCycle;
        assertEquals("negatif yanıt 'cevap yok' sayıldı", 0, c.noResponses);
        assertEquals(1, c.negativeResponses);
        assertEquals("bilgi üretmeyen süre kaybolmamalı", 427, c.noResponseMs);
    }

    @Test
    public void b3_dusenKomutMaliyeti0Sayilmaz() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("010C", "⚠ Stream kapandı", 3_000);
        led.endCycle(1_000L);
        assertEquals(1, led.snapshot().lastCycle.noResponses);
        assertEquals(3_000, led.snapshot().lastCycle.noResponseMs);
    }

    /* ── Gereksiz adresleme TESPİTİ (ölçüm — kör optimizasyon YOK) ─────────── */

    @Test
    public void b3_kullanilmadanEzilenHeaderYazimiTespitEdilir() {
        led.beginCycle(1, false, 0L);
        /* Saha imzası: restore → set (arada HİÇ payload yok) → ATSH7DF boşa gitti. */
        led.noteCommand("ATSH7DF", "OK", 41);
        led.noteCommand("ATAR", "OK", 41);
        led.noteCommand("ATSH7E0", "OK", 41);
        led.noteCommand("ATCRA7E8", "OK", 41);
        led.noteCommand("22F190", "62F190…", 450);
        led.endCycle(1_000L);

        PollCostLedger.CycleCost c = led.snapshot().lastCycle;
        assertEquals(4, c.headerSwitches);
        /* ATAR·ATSH7E0·ATCRA7E8 — her biri kendinden önceki yazımı kullanılmadan ezdi. */
        assertEquals(3, c.redundantHeaderSwitches);
    }

    @Test
    public void b3_payloadGidenHeaderYaziminaGereksiz_DENMEZ() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("ATSH7E0", "OK", 41);
        led.noteCommand("010C", "410C0D49", 400);   // yazım KULLANILDI
        led.noteCommand("ATSH7E1", "OK", 41);
        led.noteCommand("010D", "410D00", 400);     // yazım KULLANILDI
        led.endCycle(1_000L);
        assertEquals(0, led.snapshot().lastCycle.redundantHeaderSwitches);
    }

    /* ── Voltaj kadansı ve protokol sorgusu ayrı sınıflarda ────────────────── */

    @Test
    public void b3_voltajVeProtokolAyriSayilir_kadansBozulmaz() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("ATRV", "12.6V", 60);
        led.noteCommand("ATDPN", "A6", 45);
        led.endCycle(1_000L);
        PollCostLedger.CycleCost c = led.snapshot().lastCycle;
        assertEquals(1, c.voltageReads);
        assertEquals(1, c.protocolChecks);
        // İkisi de adaptör yönetimi toplamına dahildir; payload'a KARIŞMAZ.
        assertEquals(2, c.adapterControlCommands);
        assertEquals(0, c.diagnosticPayloadRequests);
    }

    /* ── Burst ile normal tur AYRI ölçülür ─────────────────────────────────── */

    @Test
    public void b3_burstVeNormalTurAyriOlculur() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("010C", "410C0D49", 400);
        led.endCycle(500L);
        led.beginCycle(2, true, 500L);
        for (int i = 0; i < 9; i++) led.noteCommand("0121", "4121…", 300);
        led.endCycle(3_500L);

        PollCostLedger.Snapshot s = led.snapshot();
        assertEquals(2, s.cyclesRecorded);
        assertEquals(1, s.burstCyclesRecorded);
        assertTrue(s.lastCycle.burst);
        assertEquals(9, s.lastCycle.diagnosticPayloadRequests);
        assertEquals(3_000, s.lastCycle.elapsedMs);
    }

    /* ── Tur DIŞI komutlar poll bütçesine YAZILMAZ ama görünmez de kalmaz ──── */

    @Test
    public void b3_turDisiKomutlarPollBudgetineYazilmaz() {
        // Handshake/keşif: tur açık değil.
        led.noteCommand("ATZ", "ELM327 v1.5", 1_000);
        led.noteCommand("0100", "4100BE3FA813", 430);
        PollCostLedger.Snapshot s = led.snapshot();
        assertEquals(2, s.unattributedCommands);
        assertEquals("tur kaydı üretilmemeli", 0, s.cyclesRecorded);
        // Oturum toplamında YİNE de görünür — kayıp maliyet olamaz.
        assertEquals(1, s.totalPayloadRequests);
        assertEquals(1, s.totalAdapterCommands);
    }

    /* ── Sahte 0 yasağı ────────────────────────────────────────────────────── */

    @Test
    public void b3_olculmeyenAlanSahte0Uretmez() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("010C", "410C0D49", 400);
        led.endCycle(500L);
        assertEquals("retry ölçülmüyor → UNKNOWN olmalı, 0 DEĞİL",
                PollCostLedger.UNKNOWN, led.snapshot().lastCycle.retries);
    }

    @Test
    public void b3_resetOncesiPresentFalse_kaynakYokIle0AyriDir() {
        // reset() çağrılmadan hiçbir ölçüm yoksa `present` kanıtın VARLIĞINI söyler.
        PollCostLedger.Snapshot s = led.snapshot();
        assertTrue("setUp reset çağırdı", s.present);
        assertEquals(0, s.cyclesRecorded);
    }

    /* ── Bounded halka ─────────────────────────────────────────────────────── */

    @Test
    public void b3_turHalkasiSinirli() {
        for (int i = 0; i < 50; i++) {
            led.beginCycle(i, false, i * 100L);
            led.noteCommand("010C", "410C0D49", 40);
            led.endCycle(i * 100L + 50L);
        }
        PollCostLedger.Snapshot s = led.snapshot();
        assertTrue("halka bounded olmalı", s.recentCycles.size() <= 32);
        assertEquals(50, s.cyclesRecorded);
        assertEquals(49, s.lastCycle.cycleId);
    }

    @Test
    public void b3_acikTurBeginCycleIleKapanir_kayipTurYok() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("010C", "410C0D49", 40);
        led.beginCycle(2, false, 100L);   // endCycle çağrılmadan yeni tur
        PollCostLedger.Snapshot s = led.snapshot();
        assertEquals("önceki tur kaybolmamalı", 1, s.cyclesRecorded);
        assertEquals(1, s.lastCycle.cycleId);
    }

    @Test
    public void b3_resetYeniMuhasebeDonemiBaslatir() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("010C", "410C0D49", 40);
        led.endCycle(100L);
        led.reset(9_999L);
        PollCostLedger.Snapshot s = led.snapshot();
        assertEquals(9_999L, s.sessionEpoch);
        assertEquals(0, s.cyclesRecorded);
        assertEquals(0, s.totalPayloadRequests);
        assertTrue(s.recentCycles.isEmpty());
    }

    @Test
    public void b3_bytesOlculur() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("010C", "410C0D49", 40);
        led.endCycle(100L);
        PollCostLedger.CycleCost c = led.snapshot().lastCycle;
        assertEquals(5, c.bytesTx);    // "010C" + CR
        assertEquals(8, c.bytesRx);
    }

    @Test
    public void b3_nullYanitCevapsizSayilir() {
        led.beginCycle(1, false, 0L);
        led.noteCommand("010C", null, 5_000);
        led.endCycle(100L);
        assertEquals(1, led.snapshot().lastCycle.noResponses);
        assertFalse(led.snapshot().lastCycle.burst);
    }
}
