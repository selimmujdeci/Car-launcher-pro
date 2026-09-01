package com.cockpitos.pro.obd;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Extended Mode-01 PID'leri için bounded, RTT-duyarlı deadline scheduler.
 * I/O/queue sahibi DEĞİLDİR; yalnız hangi PID'lerin mevcut hat bütçesine sığdığını seçer.
 */
public final class AdaptivePidScheduler {
    public static final long HOT_MS = 10_000, MEDIUM_MS = 30_000,
            SLOW_MS = 120_000, ARCHIVAL_MS = 600_000;
    private static final long DEFAULT_RTT_MS = 250, MIN_COST_MS = 40, MAX_COST_MS = 2_000;

    /* ══════════════════════════════════════════════════════════════════════
     * P0-VDK-B3 · AÇLIK (STARVATION) KARŞITI YAŞLANMA — AÇIK TAM SAYI, AI YOK
     *
     * ── ÖLÇÜLEN KUSUR (saha 2026-08-30 · CAROS LAB TAM KOPYA) ─────────────
     * `watched 33 · valued 8 · demoted 0` ve ortalama yaş her turda ARTIYORDU
     * (297 s → 351 s). Sebep sıralama anahtarındaydı: hiç başarılı olmamış bir
     * PID için anahtar `targetMs`tir; ARCHIVAL (600 s) bir PID, HOT (10 s)
     * PID'lerin HER ZAMAN arkasında kalır ve `maxCommands` tavanı yüzünden
     * sıraya HİÇ giremez → süresiz açlık.
     *
     * Düzeltme mevcut EDF'in İÇİNDE tek terimdir — ikinci scheduler KURULMAZ:
     * gerçekten ertelenmiş her tur, PID'in deadline anahtarını sabit bir miktar
     * öne çeker. Deterministik ve TAVANLI (sıralama tümüyle tersine dönmez).
     * ════════════════════════════════════════════════════════════════════ */

    /** Bütçe yüzünden ertelenen her tur için deadline anahtarından düşülen süre (ms). */
    public static final long STARVATION_AGING_MS_PER_DEFER = 500;
    /** Yaşlanmanın toplam tavanı (ms) — HOT PID'ler kalıcı olarak geriye itilemez. */
    public static final long STARVATION_AGING_CAP_MS = 300_000;

    public static final class PidState {
        public final String pid; public final long targetMs;
        public long lastAttemptAt, lastSuccessAt, notBeforeAt, ewmaRttMs = DEFAULT_RTT_MS, maxAgeMs;
        public long totalObservedAgeMs;
        public int ageSamples;
        public int attempts, successes, deadlineMisses, deferredCount;
        /**
         * P0-VDK-B3 — KADANS penceresi yüzünden atlanan tur sayısı.
         *
         * ⚠️ Bu ERTELEME DEĞİLDİR: PID'in okunma zamanı henüz gelmemiştir (normal
         * çalışma). Eskiden `deferredCount`a yazılıyordu → "ertelendi" sayısı
         * şişiyor, gerçek açlık sinyali kadans gürültüsünün içinde kayboluyordu
         * ve yaşlanma başarılı PID'leri de öne çekerdi. İki sayaç AYRILDI.
         */
        public int notYetDueCount;
        /** Yaşlanmanın şu anki değeri (ms) — LAB'da açlık kanıtı olarak okunur. */
        public long agingMs() {
            return Math.min(STARVATION_AGING_CAP_MS, (long) deferredCount * STARVATION_AGING_MS_PER_DEFER);
        }
        PidState(String pid) { this.pid = pid; this.targetMs = targetFor(pid); }
        public long age(long now) { return lastSuccessAt == 0 ? Long.MAX_VALUE : Math.max(0, now-lastSuccessAt); }
        public long averageAgeMs() { return ageSamples == 0 ? 0 : totalObservedAgeMs / ageSamples; }
    }

    private final Map<String, PidState> states = new HashMap<>();
    private int deferredTotal, recoveryPauseCount;
    private long lastBudgetMs;

    public synchronized void configure(List<String> pids) {
        Set<String> wanted = new HashSet<>();
        if (pids != null) for (String p : pids) if (p != null) wanted.add(p.toUpperCase());
        states.keySet().retainAll(wanted);
        for (String p : wanted) states.computeIfAbsent(p, PidState::new);
    }

    public synchronized void resetSession() {
        for (PidState s : states.values()) {
            s.lastAttemptAt=s.lastSuccessAt=s.notBeforeAt=s.maxAgeMs=s.totalObservedAgeMs=0;
            s.ewmaRttMs=DEFAULT_RTT_MS; s.ageSamples=0;
            s.attempts=s.successes=s.deadlineMisses=s.deferredCount=s.notYetDueCount=0;
        }
        deferredTotal=recoveryPauseCount=0; lastBudgetMs=0;
    }

    /** Earliest-deadline-first; RTT yalnız aynı bütçeye kaç komut sığacağını belirler. */
    public synchronized List<String> plan(long now, long budgetMs, int maxCommands,
                                          Set<String> skipped, boolean recoveryActive) {
        lastBudgetMs = Math.max(0, budgetMs);
        if (recoveryActive) { recoveryPauseCount++; deferAll(skipped); return Collections.emptyList(); }
        List<PidState> due = new ArrayList<>();
        for (PidState s : states.values()) {
            if (skipped != null && skipped.contains(s.pid)) continue;
            /* B3: kadans penceresi ERTELEME DEĞİLDİR — ayrı sayılır, açlık sinyalini kirletmez. */
            if (now < s.notBeforeAt) { s.notYetDueCount++; continue; }
            long age = s.age(now);
            if (age == Long.MAX_VALUE || age >= s.targetMs) due.add(s);
        }
        /* B3: deadline anahtarı yaşlanmayla öne çekilir → hiçbir PID süresiz beklemez.
           Eşitlik bozucular DEĞİŞMEDİ (ucuz olan önce, sonra alfabetik → deterministik). */
        due.sort(Comparator
            .comparingLong((PidState s) ->
                (s.lastSuccessAt == 0 ? s.targetMs : s.lastSuccessAt + s.targetMs) - s.agingMs())
            .thenComparingLong(s -> s.ewmaRttMs).thenComparing(s -> s.pid));
        List<String> out = new ArrayList<>(); long used = 0;
        for (PidState s : due) {
            long cost = Math.max(MIN_COST_MS, Math.min(MAX_COST_MS, s.ewmaRttMs));
            if (out.size() >= Math.max(1, maxCommands) || (!out.isEmpty() && used + cost > budgetMs)) {
                s.deferredCount++; deferredTotal++; continue;
            }
            out.add(s.pid); used += cost;
        }
        return out;
    }

    public synchronized void record(String pid, ExtendedPollEvidence.Outcome outcome, long rttMs, long now) {
        PidState s = states.get(pid); if (s == null) return;
        s.attempts++; s.lastAttemptAt = now;
        long bounded = Math.max(MIN_COST_MS, Math.min(MAX_COST_MS, rttMs));
        s.ewmaRttMs = (s.ewmaRttMs * 3 + bounded) / 4;
        long age = s.age(now); if (age != Long.MAX_VALUE) {
            s.maxAgeMs = Math.max(s.maxAgeMs, age); s.totalObservedAgeMs += age; s.ageSamples++;
        }
        if (age != Long.MAX_VALUE && age > s.targetMs) s.deadlineMisses++;
        if (outcome == ExtendedPollEvidence.Outcome.OK) {
            s.successes++; s.lastSuccessAt = now; s.notBeforeAt = now + s.targetMs;
            /* B3: PID sıra aldı → biriken yaşlanma TÜKETİLDİ. Aksi hâlde bir kez aç
               kalmış PID kalıcı olarak öne geçer ve bu kez HOT PID'leri aç bırakırdı. */
            s.deferredCount = 0;
        } else if (outcome == ExtendedPollEvidence.Outcome.BUSY) {
            s.notBeforeAt = now + Math.max(1_000, Math.min(s.targetMs / 4, s.ewmaRttMs * 2));
        } else if (outcome == ExtendedPollEvidence.Outcome.NO_DATA) {
            s.notBeforeAt = now + Math.max(3_000, s.targetMs / 4);
        } else {
            s.notBeforeAt = now + Math.max(5_000, s.targetMs / 2);
        }
    }

    public synchronized void noteDeferred(String pid) {
        PidState s=states.get(pid); if(s!=null){s.deferredCount++;deferredTotal++;}
    }

    private void deferAll(Set<String> skipped) {
        for (PidState s : states.values()) if (skipped == null || !skipped.contains(s.pid)) {
            s.deferredCount++; deferredTotal++;
        }
    }

    public synchronized List<PidState> snapshot() { return new ArrayList<>(states.values()); }
    public synchronized int activeCount() { return states.size(); }
    public synchronized int deferredTotal() { return deferredTotal; }
    public synchronized int recoveryPauseCount() { return recoveryPauseCount; }
    public synchronized long lastBudgetMs() { return lastBudgetMs; }

    static long targetFor(String pid) {
        int p; try { p = Integer.parseInt(pid, 16); } catch (Exception e) { return MEDIUM_MS; }
        if (p==0x04 || (p>=0x06&&p<=0x1B) || (p>=0x22&&p<=0x2E)
                || (p>=0x43&&p<=0x4C) || (p>=0x55&&p<=0x5A) || (p>=0x61&&p<=0x69)) return HOT_MS;
        if (p==0x33 || (p>=0x3C&&p<=0x3F) || p==0x42 || p==0x46 || p==0x59
                || p==0x5C || p==0x5E || p==0x6B || p==0x78 || p==0x79 || p==0x7C || p==0x83) return MEDIUM_MS;
        if (p==0x01 || p==0x1C || p==0x1F || p==0x21 || p==0x30 || p==0x31
                || p==0x4D || p==0x4E || p==0x50 || p==0x51) return ARCHIVAL_MS;
        return SLOW_MS;
    }
}
