package com.cockpitos.pro.media;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * MÜZİK HUB PAKET B — Native olay izinin DAVRANIŞ KİLİTLERİ (JVM).
 *
 * Kilitlenen sözleşmeler: bounded halka · ardışık tekrar bastırma · monotonic
 * sıra · **gizlilik** (URL/başlık/token kod alanından geçemez).
 *
 * SDK sabitlenmiştir: Robolectric 4.13 en fazla SDK 34 çalıştırır (proje
 * targetSdk 36). SystemClock dışında Android bağımlılığı yoktur.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class CarosMediaEventLogTest {

    private CarosMediaEventLog log;

    @Before
    public void setUp() {
        // Context yalnız Robolectric ortamını kurmak için — log onu kullanmaz.
        ApplicationProvider.getApplicationContext();
        log = new CarosMediaEventLog();
    }

    @Test
    public void ringIsBounded_andDroppedCountIsVisible() {
        for (int i = 0; i < CarosMediaEventLog.MAX_EVENTS + 25; i++) {
            log.record(CarosMediaEventLog.EV_COMMAND_RECEIVED, "c" + i, 1L);
        }
        assertEquals(CarosMediaEventLog.MAX_EVENTS, log.size());
        assertEquals(25L, log.getDropped());
        assertEquals(CarosMediaEventLog.MAX_EVENTS + 25L, log.getTotal());
    }

    @Test
    public void consecutiveIdenticalEvents_areCollapsed() {
        log.record(CarosMediaEventLog.EV_FOCUS_DUCK, "NAVIGATION", 1L);
        log.record(CarosMediaEventLog.EV_FOCUS_DUCK, "NAVIGATION", 1L);
        log.record(CarosMediaEventLog.EV_FOCUS_DUCK, "NAVIGATION", 1L);

        assertEquals("focus churn halkayı DOLDURMAMALI", 1, log.size());
        String[] snap = log.snapshot(10);
        assertEquals(1, snap.length);
        // seq|atMs|type|code|generation|repeat
        assertTrue(snap[0].endsWith("|2"));
    }

    @Test
    public void differentGeneration_startsNewEntry() {
        log.record(CarosMediaEventLog.EV_FOCUS_DUCK, "NAVIGATION", 1L);
        log.record(CarosMediaEventLog.EV_FOCUS_DUCK, "NAVIGATION", 2L);
        assertEquals("generation değişimi AYRI olaydır", 2, log.size());
    }

    /* ── GİZLİLİK: serbest metin kod alanından GEÇEMEZ ───────────────────── */

    @Test
    public void urlsAndTitles_areRejectedFromCodeField() {
        assertEquals("invalid", CarosMediaEventLog.sanitizeCode("https://cdn.example.com/a.mp3"));
        assertEquals("invalid", CarosMediaEventLog.sanitizeCode("Sezen Aksu — Şarkı"));
        assertEquals("invalid", CarosMediaEventLog.sanitizeCode("Bearer abc def"));
        assertEquals("invalid", CarosMediaEventLog.sanitizeCode("content://media/external/1"));
    }

    @Test
    public void shortSafeCodes_areKept() {
        assertEquals("focus_denied", CarosMediaEventLog.sanitizeCode("focus_denied"));
        assertEquals("INDEX_DRIFT", CarosMediaEventLog.sanitizeCode("INDEX_DRIFT"));
        assertEquals("player_error_2001", CarosMediaEventLog.sanitizeCode("player_error_2001"));
        assertEquals("", CarosMediaEventLog.sanitizeCode(null));
    }

    @Test
    public void oversizedCode_isRejected() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 200; i++) sb.append('a');
        assertEquals("invalid", CarosMediaEventLog.sanitizeCode(sb.toString()));
    }

    @Test
    public void recordedEventsNeverContainRawText() {
        log.record(CarosMediaEventLog.EV_COMMAND_ACCEPTED, "https://stream.example/x", 1L);
        String[] snap = log.snapshot(10);
        assertEquals(1, snap.length);
        assertTrue("ham URL kayda GİREMEZ", snap[0].contains("invalid"));
        assertTrue(!snap[0].contains("example"));
    }

    /* ── Sıra ve sınırlar ────────────────────────────────────────────────── */

    @Test
    public void snapshotReturnsNewestEvents_withinLimit() {
        for (int i = 0; i < 10; i++) log.record(CarosMediaEventLog.EV_PLAYBACK_STATE, "s" + i, 1L);
        String[] snap = log.snapshot(3);
        assertEquals(3, snap.length);
        assertTrue("en YENİ kayıtlar dönmeli", snap[2].contains("s9"));
    }

    @Test
    public void snapshotLimitIsClamped() {
        log.record(CarosMediaEventLog.EV_SERVICE_CREATED, "", 1L);
        assertEquals(0, log.snapshot(-5).length);
        assertEquals(1, log.snapshot(999).length);
    }

    @Test
    public void sequenceIsMonotonic() {
        log.record(CarosMediaEventLog.EV_SERVICE_CREATED, "", 1L);
        log.record(CarosMediaEventLog.EV_PLAYER_CREATED, "", 1L);
        String[] snap = log.snapshot(10);
        long first = Long.parseLong(snap[0].split("\\|")[0]);
        long second = Long.parseLong(snap[1].split("\\|")[0]);
        assertTrue(second > first);
    }

    @Test
    public void clearResetsCounters() {
        log.record(CarosMediaEventLog.EV_SERVICE_CREATED, "", 1L);
        log.clear();
        assertEquals(0, log.size());
        assertEquals(0L, log.getTotal());
        assertEquals(0L, log.getDropped());
    }

    @Test
    public void nullTypeIsIgnored_andDoesNotThrow() {
        log.record(null, "x", 1L);
        assertEquals(0, log.size());
    }
}
