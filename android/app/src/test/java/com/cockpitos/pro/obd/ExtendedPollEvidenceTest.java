package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Before;
import org.junit.Test;

/**
 * ExtendedPollEvidenceTest — PR-OBD-DIAG-3 birim testleri (yerel JVM, cihaz gerekmez).
 *
 * Kapsam: reset/session, requested niyet, kadans (burst/round-robin), outcome sayaçları,
 * halka sınırı (8), saturating overflow yok, fromResult eşlemesi, sayaç bütünlüğü.
 * INSTANCE tekil olduğundan her test @Before ile reset'lenir.
 */
public class ExtendedPollEvidenceTest {

    private ExtendedPollEvidence ev;

    @Before
    public void setUp() {
        ev = ExtendedPollEvidence.INSTANCE;
        ev.reset("test");
        // Niyet alanları reset'i aşar → testler arası sızmasın diye açıkça temizle.
        ev.setRequestedPids(new ArrayList<>());
        ev.setBurstEnabled(false);
    }

    @Test
    public void reset_oturumSayaclariniSifirlar() {
        ev.recordAttempt("21", ExtendedPollEvidence.Outcome.OK, 10, 4, true);
        ev.reset("ble");
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(0, s.attemptedCount);
        assertEquals(0, s.successCount);
        assertEquals(0, s.callbackEmittedCount);
        assertEquals("ble", s.transport);
        assertTrue(s.present);
        assertTrue(s.lastAttempts.isEmpty());
    }

    @Test
    public void requestedPids_configuredSayisiVeOnizleme() {
        ev.setRequestedPids(Arrays.asList("21", "23", "30", "31", "1C", "01", "33", "40", "41"));
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(9, s.configuredPidCount);
        assertEquals(8, s.configuredPidPreview.size()); // PREVIEW_CAP = 8
        assertEquals("21", s.configuredPidPreview.get(0));
    }

    @Test
    public void burstBosListe_hicAttemptYok() {
        // Burst açık ama liste boş → poll turu extended okuması yapmaz (attempted=0).
        ev.setBurstEnabled(true);
        // recordCycle çağrılmaz (pollLoop ext.isEmpty() nedeniyle bloğa girmez).
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(0, s.attemptedCount);
        assertEquals(0, s.pollCycles);
    }

    @Test
    public void h1_configuredVarAttemptYok() {
        // TS liste gönderdi ama poll hiç çalışmadı → configured>0, attempted=0.
        ev.setRequestedPids(Arrays.asList("21", "23"));
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(2, s.configuredPidCount);
        assertEquals(0, s.attemptedCount);
    }

    @Test
    public void roundRobinKadans_turBasinaBirDeneme() {
        ev.recordCycle(false, 5);
        ev.recordAttempt("21", ExtendedPollEvidence.Outcome.OK, 12, 4, true);
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(1, s.pollCycles);
        assertEquals(1, s.roundRobinCycles);
        assertEquals(0, s.burstCycles);
        assertEquals(1, s.attemptedCount);
    }

    @Test
    public void burstKadans_maxBurstGozlemlenir() {
        ev.recordCycle(true, 7);
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(1, s.burstCycles);
        assertEquals(0, s.roundRobinCycles);
        assertEquals(7, s.maxBurstSizeObserved);
        assertTrue(s.burstEnabled);
    }

    @Test
    public void basariliDeneme_successVeCallbackArtar() {
        ev.recordAttempt("23", ExtendedPollEvidence.Outcome.OK, 30, 6, true);
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(1, s.successCount);
        assertEquals(1, s.callbackEmittedCount);
        assertEquals("23", s.lastSuccessfulPid);
        assertEquals("OK", s.lastOutcome);
        assertTrue(s.isCoherent());
    }

    @Test
    public void noData_successArtmaz_callbackYok() {
        ev.recordAttempt("21", ExtendedPollEvidence.Outcome.NO_DATA, 200, 0, false);
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(1, s.attemptedCount);
        assertEquals(0, s.successCount);
        assertEquals(1, s.noDataCount);
        assertEquals(0, s.callbackEmittedCount);
    }

    @Test
    public void tumOutcomeSayaclariTutarli() {
        ev.recordAttempt("a", ExtendedPollEvidence.Outcome.OK, 1, 2, true);
        ev.recordAttempt("b", ExtendedPollEvidence.Outcome.NO_DATA, 1, 0, false);
        ev.recordAttempt("c", ExtendedPollEvidence.Outcome.BUSY, 1, 0, false);
        ev.recordAttempt("d", ExtendedPollEvidence.Outcome.NEGATIVE_RESPONSE, 1, 0, false);
        ev.recordAttempt("e", ExtendedPollEvidence.Outcome.ERROR, 1, 0, false);
        ev.recordAttempt("f", ExtendedPollEvidence.Outcome.TIMEOUT_NO_BYTES, 1, 0, false);
        ev.recordAttempt("g", ExtendedPollEvidence.Outcome.TIMEOUT_PARTIAL, 1, 0, false);
        ev.recordAttempt("h", ExtendedPollEvidence.Outcome.PARSE_ERROR, 1, 0, false);
        ev.recordAttempt("i", ExtendedPollEvidence.Outcome.CANCELLED, 1, 0, false);
        ev.recordAttempt("j", ExtendedPollEvidence.Outcome.UNKNOWN_FAILURE, 1, 0, false);
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(10, s.attemptedCount);
        assertTrue(s.isCoherent());
    }

    @Test
    public void halka_enFazla8Kayit_enEskisiDuser() {
        for (int i = 0; i < 12; i++) {
            ev.recordAttempt("P" + i, ExtendedPollEvidence.Outcome.OK, i, 2, true);
        }
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(8, s.lastAttempts.size());
        // En eski (P0..P3) düşmüş; ilk kalan P4 olmalı.
        assertEquals("P4", s.lastAttempts.get(0).pid);
        assertEquals("P11", s.lastAttempts.get(7).pid);
    }

    @Test
    public void fromResult_kindEslemesi() {
        assertEquals(ExtendedPollEvidence.Outcome.OK,
            ExtendedPollEvidence.fromResult(new ElmResponseParser.Result(ElmResponseParser.Kind.OK, "1AF8", "411AF8")));
        assertEquals(ExtendedPollEvidence.Outcome.PARSE_ERROR,
            ExtendedPollEvidence.fromResult(new ElmResponseParser.Result(ElmResponseParser.Kind.OK, "", "41")));
        assertEquals(ExtendedPollEvidence.Outcome.NO_DATA,
            ExtendedPollEvidence.fromResult(new ElmResponseParser.Result(ElmResponseParser.Kind.NO_DATA, null, "NO DATA")));
        assertEquals(ExtendedPollEvidence.Outcome.NEGATIVE_RESPONSE,
            ExtendedPollEvidence.fromResult(new ElmResponseParser.Result(ElmResponseParser.Kind.NEG_7F, null, "7F0111")));
        assertEquals(ExtendedPollEvidence.Outcome.ERROR,
            ExtendedPollEvidence.fromResult(new ElmResponseParser.Result(ElmResponseParser.Kind.ERROR, null, "CAN ERROR")));
        // Boş ham → NO_BYTES, dolu-ama-tanınmayan → PARTIAL.
        assertEquals(ExtendedPollEvidence.Outcome.TIMEOUT_NO_BYTES,
            ExtendedPollEvidence.fromResult(new ElmResponseParser.Result(ElmResponseParser.Kind.TIMEOUT_PARTIAL, null, "")));
        assertEquals(ExtendedPollEvidence.Outcome.TIMEOUT_PARTIAL,
            ExtendedPollEvidence.fromResult(new ElmResponseParser.Result(ElmResponseParser.Kind.TIMEOUT_PARTIAL, null, "41 0D")));
        assertEquals(ExtendedPollEvidence.Outcome.UNKNOWN_FAILURE,
            ExtendedPollEvidence.fromResult(null));
    }

    @Test
    public void saturating_negatifOlmaz() {
        // Küçük ölçekte overflow'u zorlayamayız; sadece monoton artışı ve non-negatif kanıtla.
        for (int i = 0; i < 1000; i++) {
            ev.recordAttempt("x", ExtendedPollEvidence.Outcome.OK, 1, 2, true);
        }
        ExtendedPollEvidence.Snapshot s = ev.snapshot();
        assertEquals(1000, s.attemptedCount);
        assertTrue(s.successCount > 0);
    }
}
