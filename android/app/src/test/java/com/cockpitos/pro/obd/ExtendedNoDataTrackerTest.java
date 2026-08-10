package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * ExtendedNoDataTrackerTest — ELEME ÇAĞLAYANI kilitleri (kütük #524).
 *
 * SAHA (2026-08-10): izlenen PID sayısı 10-12'ye çıkıp **6'da sabitleniyordu**;
 * hayatta kalanlar yalnız çekirdek PID'lerdi. Extended olanlar 3 ardışık NO_DATA
 * sonrası KALICI eleniyor ve bir daha HİÇ sorulmuyordu. Aralıklı cevap veren bir
 * PID (%50 NO_DATA — kütük #516) 3 ardışık boşluğu istatistiksel olarak kaçınılmaz
 * biçimde yakalar → eleme kaçınılmazdı, "destek yok" kanıtı ise YOKTU.
 *
 * Bu testler yeni sözleşmeyi kilitler: bir kez OK dönen PID KALICI ELENEMEZ.
 */
public class ExtendedNoDataTrackerTest {

    private static ElmResponseParser.Result ok() {
        return new ElmResponseParser.Result(ElmResponseParser.Kind.OK, "1AF8", "41 0C 1A F8");
    }
    private static ElmResponseParser.Result noData() {
        return new ElmResponseParser.Result(ElmResponseParser.Kind.NO_DATA, null, "NO DATA");
    }
    private static ElmResponseParser.Result timeout() {
        return new ElmResponseParser.Result(ElmResponseParser.Kind.TIMEOUT_PARTIAL, null, "");
    }

    /** Stabilizasyon penceresini geçmiş bir tur numarası. */
    private static long past() {
        return ExtendedNoDataTracker.STABILIZE_CYCLES + 100;
    }

    /* ── Stabilizasyon ─────────────────────────────────────────────────────── */

    @Test
    public void stabilizasyonPenceresindeNoDataElemeUretmez() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        // Pencere içinde ARDIŞIK NO_DATA yağmuru — eleme OLMAMALI.
        for (int c = 0; c < ExtendedNoDataTracker.STABILIZE_CYCLES; c++) {
            t.recordOutcome("23", noData(), c);
        }
        assertFalse("stabilizasyon penceresinde elendi", t.shouldSkip("23", 5));
        assertEquals(0, t.permanentCount());
        assertTrue("yutulan NO_DATA sayilmadi", t.suppressedDuringStabilize() > 0);
        assertTrue(t.stabilizing(1));
        assertFalse(t.stabilizing(ExtendedNoDataTracker.STABILIZE_CYCLES + 1));
    }

    /* ── Kalıcı eleme yalnız HİÇ OK dönmemişler için ───────────────────────── */

    @Test
    public void hicOkDonmeyenPidKaliciElenir() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        for (int i = 0; i < ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        assertTrue("hic OK donmemis PID elenmedi", t.shouldSkip("23", c + 10));
        assertEquals(1, t.permanentCount());
    }

    @Test
    public void birKezOkDonenPidKALICIELENMEZ_yalnizDuraklatilir() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        t.recordOutcome("23", ok(), c);                       // araç verdiğini KANITLADI
        for (int i = 1; i <= ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        assertEquals("OK donmus PID KALICI elendi — cagLayanin kokU budur",
            0, t.permanentCount());
        assertEquals(1, t.pausedCount());
        assertTrue("duraklatma suresinde sorgulanmis", t.shouldSkip("23", c + 5));
    }

    @Test
    public void duraklatilmisPidSureDoluncaSirayaGeriGirer() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        t.recordOutcome("23", ok(), c);
        for (int i = 1; i <= ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        /* Duraklatma SON NO_DATA turundan itibaren sayilir (c + DEMOTE_THRESHOLD). */
        long startedAt = c + ExtendedNoDataTracker.DEMOTE_THRESHOLD;
        long pause = ExtendedNoDataTracker.PAUSE_LADDER[0];
        assertTrue("duraklatma suresi dolmadan siraya girdi",
            t.shouldSkip("23", startedAt + pause - 1));
        assertFalse("duraklatma dolunca siraya donmedi — PID UNUTULDU",
            t.shouldSkip("23", startedAt + pause + 1));
    }

    @Test
    public void duraklatmaAraligiARTAR() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        t.recordOutcome("23", ok(), c);
        // 1. duraklatma
        for (int i = 1; i <= ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        long first = ExtendedNoDataTracker.PAUSE_LADDER[0];
        c = c + first + 2;
        t.shouldSkip("23", c);   // süre doldu → sıraya döner
        // 2. duraklatma — daha UZUN olmalı
        for (int i = 1; i <= ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        long second = ExtendedNoDataTracker.PAUSE_LADDER[1];
        assertTrue("ikinci duraklatma birinciden uzun degil",
            second > first);
        assertTrue("ikinci duraklatma uygulanmamis", t.shouldSkip("23", c + first + 1));
    }

    @Test
    public void okDonusuMerdiveniSIFIRLAR() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        t.recordOutcome("23", ok(), c);
        for (int i = 1; i <= ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        assertEquals(1, t.pausedCount());
        t.recordOutcome("23", ok(), c + 100);               // veri geri geldi
        assertEquals("OK sonrasi duraklatma kalkmadi", 0, t.pausedCount());
        assertFalse(t.shouldSkip("23", c + 101));
    }

    /* ── TIMEOUT/ERROR nötr kalmalı (zero-trust) ───────────────────────────── */

    @Test
    public void timeoutElemeKanitiDEGILDIR() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        for (int i = 0; i < 10; i++) t.recordOutcome("23", timeout(), c + i);
        assertFalse("timeout eleme uretti — baglanti sorunu destek kaniti DEGILDIR",
            t.shouldSkip("23", c + 20));
        assertEquals(0, t.permanentCount());
    }

    /* ── Toplu eleme = HAT OLAYI ───────────────────────────────────────────── */

    @Test
    public void topluElemeHatOlayidir_elemeSifirlanirVeSAYILIR() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        // Kısa pencerede BULK_MIN_DEMOTES kadar AYRI PID elensin.
        String[] pids = { "23", "2C", "33", "45" };
        for (int p = 0; p < ExtendedNoDataTracker.BULK_MIN_DEMOTES; p++) {
            for (int i = 0; i < ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
                t.recordOutcome(pids[p], noData(), c + i);
            }
        }
        assertTrue("toplu eleme HAT OLAYI olarak sayilmadi", t.bulkResetCount() >= 1);
        assertEquals("hat olayindan sonra eleme sifirlanmadi", 0, t.permanentCount());
        assertEquals(0, t.pausedCount());
        for (String pid : pids) {
            assertFalse(pid + " hat olayindan sonra hala elenmis", t.shouldSkip(pid, c + 50));
        }
    }

    /* ── Oturum sınırları ──────────────────────────────────────────────────── */

    @Test
    public void resetTumOgrenmeyiVeStabilizasyonuSifirlar() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        for (int i = 0; i < ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        assertTrue(t.shouldSkip("23", c + 10));
        t.reset(c + 20);
        assertFalse("reset sonrasi eleme kalmis", t.shouldSkip("23", c + 21));
        assertEquals(0, t.permanentCount());
        assertTrue("reset stabilizasyon penceresini baslatmadi", t.stabilizing(c + 21));
    }

    @Test
    public void listeDegisimiOgrenmeyiSifirlar() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        for (int i = 0; i < ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("23", noData(), c + i);
        }
        assertTrue(t.shouldSkip("23", c + 10));
        t.onListChanged(java.util.Arrays.asList("23", "2C"));
        assertFalse("liste degisiminde ogrenme sifirlanmadi", t.shouldSkip("23", c + 11));
    }

    /* ── Görünürlük (LAB) ──────────────────────────────────────────────────── */

    @Test
    public void gorunurlukAlanlariGercekDegerTasir() {
        ExtendedNoDataTracker t = new ExtendedNoDataTracker();
        t.reset(0);
        long c = past();
        t.recordOutcome("2C", ok(), c);
        for (int i = 1; i <= ExtendedNoDataTracker.DEMOTE_THRESHOLD; i++) {
            t.recordOutcome("2C", noData(), c + i);
        }
        assertEquals(1, t.everOkCount());
        assertEquals(1, t.pausedCount());
        assertTrue("duraklatilan PID kalan tur bilgisi tasimiyor",
            t.pausedRemaining(c + 5).containsKey("2C"));
        assertTrue(t.pausedRemaining(c + 5).get("2C") > 0);
    }
}
