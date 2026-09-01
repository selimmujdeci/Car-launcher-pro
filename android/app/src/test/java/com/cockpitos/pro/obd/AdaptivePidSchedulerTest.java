package com.cockpitos.pro.obd;

import static org.junit.Assert.*;
import java.util.*;
import org.junit.Test;

public class AdaptivePidSchedulerTest {
    private static List<String> pids(int n) { List<String> x=new ArrayList<>(); for(int i=0;i<n;i++) x.add(String.format("%02X",4+i)); return x; }
    @Test public void eightSupported_allBecomeSchedulable(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(pids(8));assertEquals(8,s.plan(1,3000,8,Set.of(),false).size()); }
    @Test public void sixteenFastElm_budgetAllowsSeveral(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(pids(16));assertTrue(s.plan(1,900,8,Set.of(),false).size()>1); }
    @Test public void thirtyPlus_areNotSlotTruncated(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(pids(35));assertEquals(35,s.activeCount()); }
    @Test public void slowElmRtt_reducesBatch(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(List.of("04","06","07"));for(String p:List.of("04","06","07"))s.record(p,ExtendedPollEvidence.Outcome.OK,1200,1);assertEquals(1,s.plan(20_000,900,8,Set.of(),false).size()); }
    @Test public void kwpRecovery_pausesAggressivePoll(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(pids(8));assertTrue(s.plan(1,900,8,Set.of(),true).isEmpty());assertEquals(1,s.recoveryPauseCount()); }
    @Test public void busyUpdatesCost_withoutPermanentDrop(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(List.of("04"));s.record("04",ExtendedPollEvidence.Outcome.BUSY,800,1);assertEquals(1,s.activeCount()); }
    @Test public void noDataDoesNotDeleteSchedulerState(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(List.of("04"));s.record("04",ExtendedPollEvidence.Outcome.NO_DATA,400,1);assertEquals(1,s.activeCount()); }
    @Test public void timeoutRaisesRttCost(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(List.of("04"));s.record("04",ExtendedPollEvidence.Outcome.TIMEOUT_NO_BYTES,1500,1);assertTrue(s.snapshot().get(0).ewmaRttMs>250); }
    @Test public void hotPidCannotStarveBehindArchival(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(List.of("1F","04"));assertEquals("04",s.plan(1,250,1,Set.of(),false).get(0)); }
    @Test public void healthySlowPid_isNeverPermanentlyRemoved(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(List.of("33"));for(int i=1;i<20;i++)s.record("33",ExtendedPollEvidence.Outcome.OK,900,i*30_000L);assertEquals(1,s.activeCount());assertEquals(19,s.snapshot().get(0).successes); }
    /* ── P0-OBD-CORE-06 ── DÜŞÜK RTT'Lİ HATTA GEREKSİZ DARALMA OLMAMALI ────
       Sahada ölçülen RTT 223–330 ms ve 34/34 başarılıydı: hat SAĞLIKLI. Böyle bir
       hatta zamanlayıcının turu kırpması "8 PID okuyoruz" görüntüsünü ÜRETİRDİ ve
       daralmanın suçunu yanlış yere (zamanlayıcıya) yıkardı. */
    @Test public void lowRttHealthyLine_isNotNarrowed(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        List<String> p=pids(20); s.configure(p);
        for(String x:p) s.record(x,ExtendedPollEvidence.Outcome.OK,250,1);
        // 250 ms RTT × 8 komut = 2000 ms ≤ bütçe → tavan neyse o kadarı seçilmeli.
        assertEquals(8,s.plan(1_000_000L,2_500,8,Set.of(),false).size());
    }
    @Test public void configureAbove16_keepsAllStates(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        s.configure(pids(40)); assertEquals(40,s.activeCount());
    }
    @Test public void skippedDemotedPid_isNotSelected(){ AdaptivePidScheduler s=new AdaptivePidScheduler();s.configure(List.of("04","06"));assertEquals(List.of("06"),s.plan(1,900,8,Set.of("04"),false)); }

    /* ══════════════════════════════════════════════════════════════════════
     * P0-VDK-B3 · AÇLIK KARŞITI YAŞLANMA + KADANS/ERTELEME AYRIMI
     *
     * SAHA (2026-08-30 · CAROS LAB TAM KOPYA): `watched 33 · valued 8 · demoted 0`,
     * ortalama yaş 297 s → 351 s ARTIYORDU. EDF anahtarı hiç okunmamış PID için
     * `targetMs` olduğundan ARCHIVAL PID'ler HOT'ların arkasında SÜRESİZ bekliyordu.
     * ══════════════════════════════════════════════════════════════════════ */

    /** 🔒 B3 — düşük öncelikli (ARCHIVAL) PID sonunda MUTLAKA sıra alır. */
    @Test public void b3_archivalPidSonundaSiraAlir_aclikYok(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        s.configure(List.of("04","1F"));           // 04 = HOT · 1F = ARCHIVAL
        boolean archivalSelected=false;
        for(int cycle=0; cycle<200 && !archivalSelected; cycle++){
            List<String> plan=s.plan(1L, 250, 1, Set.of(), false);   // turda TEK slot
            if(plan.contains("1F")) { archivalSelected=true; break; }
            if(!plan.isEmpty()) s.record(plan.get(0), ExtendedPollEvidence.Outcome.OK, 200, 1L);
        }
        assertTrue("ARCHIVAL PID 200 turda hiç sıra alamadı — açlık", archivalSelected);
    }

    /** 🔒 B3 — kadans penceresi ERTELEME sayılmaz (açlık sinyali kirlenmez). */
    @Test public void b3_kadansPenceresiErtelemeSayilmaz(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        s.configure(List.of("04"));
        s.record("04", ExtendedPollEvidence.Outcome.OK, 200, 1_000L);
        s.plan(1_100L, 900, 8, Set.of(), false);   // henüz zamanı gelmedi
        AdaptivePidScheduler.PidState st=s.snapshot().get(0);
        assertEquals("kadans atlaması 'ertelendi' sayıldı", 0, st.deferredCount);
        assertEquals(1, st.notYetDueCount);
        assertEquals("ertelenmemiş PID yaşlanmamalı", 0, st.agingMs());
    }

    /** 🔒 B3 — bütçe biterse ERTELENİR; desteklenmiyor SAYILMAZ (durum silinmez). */
    @Test public void b3_butceBitince_DEFERRED_unsupportedDegil(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        List<String> p=pids(10); s.configure(p);
        for(String x:p) s.record(x, ExtendedPollEvidence.Outcome.OK, 1_500, 1L);
        List<String> plan=s.plan(1_000_000L, 250, 8, Set.of(), false);
        assertTrue("bütçe dar → hepsi seçilemez", plan.size()<p.size());
        assertTrue("ertelenen PID sayılmalı", s.deferredTotal()>0);
        assertEquals("ertelenen PID scheduler'dan DÜŞÜRÜLEMEZ", 10, s.activeCount());
    }

    /** 🔒 B3 — yaşlanma TAVANLI: HOT PID kalıcı olarak geriye itilemez. */
    @Test public void b3_yaslanmaTavanli_hotPidGeriyeItilmez(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        s.configure(List.of("04","1F"));
        for(int i=0;i<10_000;i++) s.noteDeferred("1F");
        AdaptivePidScheduler.PidState archival=s.snapshot().stream()
            .filter(x->x.pid.equals("1F")).findFirst().orElseThrow();
        assertEquals(AdaptivePidScheduler.STARVATION_AGING_CAP_MS, archival.agingMs());
        /* Tavan ARCHIVAL(600 s) − 300 s = 300 s > HOT(10 s) → HOT hâlâ önde. */
        assertEquals("04", s.plan(1L, 250, 1, Set.of(), false).get(0));
    }

    /** 🔒 B3 — başarılı okuma biriken yaşlanmayı TÜKETİR (kalıcı öncelik yok). */
    @Test public void b3_basariliOkumaYaslanmayiTuketir(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        s.configure(List.of("1F"));
        for(int i=0;i<50;i++) s.noteDeferred("1F");
        assertTrue(s.snapshot().get(0).agingMs()>0);
        s.record("1F", ExtendedPollEvidence.Outcome.OK, 200, 1_000L);
        assertEquals(0, s.snapshot().get(0).agingMs());
    }

    /** 🔒 B3 — kurtarma sırasında poll İKİNCİ OTORİTE olmaz (plan boş kalır). */
    @Test public void b3_recoverySirasindaPollIkinciOtoriteOlmaz(){
        AdaptivePidScheduler s=new AdaptivePidScheduler();
        s.configure(pids(8));
        assertTrue(s.plan(1L, 5_000, 8, Set.of(), true).isEmpty());
        assertEquals("kurtarma duraklaması sayılmalı", 1, s.recoveryPauseCount());
        assertEquals("PID durumları KORUNUR", 8, s.activeCount());
    }
}
