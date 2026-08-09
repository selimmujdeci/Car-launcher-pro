package com.cockpitos.pro.obd;

/**
 * PidTimingExperiment — H-A DENEYİ: ELM327 yanıt bekleme süresi (ATST) NO_DATA'ya sebep mi?
 *
 * ── NEDEN (kütük #516 kök neden avı) ────────────────────────────────────────
 * Sahada extended PID denemelerinin **%50'si NO_DATA** dönüyor, ama aynı PID'lerin
 * HEPSİNİN değeri var → "desteklenmiyor" değil, **aralıklı**. NO_DATA'da geçen süre
 * 151–259 ms ölçüldü; Java tarafı timeout'u 1500 ms, yani **pes eden biz değil
 * adaptör**. `ElmInitSequencer.applyProtocolProfile()` yanıt süresini uzatan
 * {@code ATST} komutunu YALNIZ yavaş seri protokollerde (ISO9141/KWP) gönderiyor;
 * **CAN'de hiç göndermiyor** → ELM327 varsayılanı (0x32 × 4 ms ≈ 200 ms) yürürlükte.
 * ELM327'de adaptif zamanlamanın ({@code ATAT1}) TAVANI ATST'dir.
 *
 * ── DENEY ───────────────────────────────────────────────────────────────────
 * AYNI bağlantıda, arka arkaya iki aşama; aralarında BAŞKA HİÇBİR ŞEY değişmez:
 *   A) mevcut ayar (CAN'de ATST'ye DOKUNULMAZ — üretimdeki hâl)
 *   B) {@code ATST<hex>} uzatılmış
 * Her aşamada aynı PID listesi × N tur, PID başına süre ve sonuç kaydedilir.
 * Bitişte ayar **her hâlükârda** geri alınır (finally) — ürün etkilenmez.
 *
 * ── ÜRÜN DAVRANIŞINI DEĞİŞTİRMEZ (pazarlıksız) ──────────────────────────────
 *  · Sonuçlar `ExtendedNoDataTracker`e **BESLENMEZ** — deneyin kendi NO_DATA'ları
 *    ürünün eleme öğrenmesini ZEHİRLEMEZ (aksi hâlde deney, ölçtüğü şeyi bozardı).
 *  · Elenen PID'ler deneyde **ATLANMAZ** — asıl merak edilen tam olarak onlar.
 *  · `ExtendedPollEvidence` sayaçlarına DOKUNULMAZ (ayrı defter).
 *  · Poll döngüsü DURDURULMAZ; deney komutları normal kuyruğa USER önceliğiyle
 *    girer. Çekişme İKİ AŞAMADA DA aynıdır → karşılaştırma geçerli kalır.
 *  · Ham örnekler taşınır; yüzdelik/hüküm hesabı TS tarafında (saf, test edilebilir).
 *
 * Tek atımlık: aynı anda yalnız bir deney koşar; koşarken ikinci istek reddedilir.
 */
final class PidTimingExperiment {

    /** ELM327 ATST varsayılanı (0x32 × 4 ms ≈ 200 ms) — B aşaması sonrası geri dönülen değer. */
    static final String DEFAULT_ST_HEX = "32";

    /** Tavanlar — bounded deney (sonsuz koşum YOK). */
    static final int MAX_PIDS   = 24;
    static final int MAX_ROUNDS = 40;

    /** Tek ölçüm — ham, yorumsuz. */
    static final class Sample {
        final String phase;      // "A" | "B"
        final String pid;        // "23"
        final String outcome;    // OK | NO_DATA | NEG_7F | BUSY | ERROR | TIMEOUT | OTHER
        final long   elapsedMs;
        final int    respLen;

        Sample(String phase, String pid, String outcome, long elapsedMs, int respLen) {
            this.phase = phase; this.pid = pid; this.outcome = outcome;
            this.elapsedMs = elapsedMs; this.respLen = respLen;
        }
    }

    /** Bir aşamanın kaba özeti (ayrıntı TS'te hesaplanır). */
    static final class PhaseMeta {
        String  phase;
        String  stApplied;       // "default" (A) | "FF" (B)
        boolean stCommandOk;     // B: ATST 'OK' döndü mü (klon '?' dönebilir)
        long    startedAt;
        long    finishedAt;
    }

    private final ElmCommandQueue queue;
    private final ElmProtocol     protocol;

    private volatile boolean running = false;
    private volatile String  status  = "idle";   // idle | running | done | failed | aborted
    private volatile String  failReason = null;
    private final java.util.List<Sample>    samples = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
    private final java.util.List<PhaseMeta> phases  = java.util.Collections.synchronizedList(new java.util.ArrayList<>());

    PidTimingExperiment(ElmCommandQueue queue, ElmProtocol protocol) {
        this.queue = queue;
        this.protocol = protocol;
    }

    boolean isRunning() { return running; }
    String  status()    { return status; }
    String  failReason(){ return failReason; }

    java.util.List<Sample>    samplesSnapshot() { synchronized (samples) { return new java.util.ArrayList<>(samples); } }
    java.util.List<PhaseMeta> phasesSnapshot()  { synchronized (phases)  { return new java.util.ArrayList<>(phases);  } }

    /**
     * Deneyi çalıştırır (ÇAĞIRAN THREAD'i bloklar — plugin arka plan thread'inden çağırmalı).
     *
     * @param pids     ölçülecek PID listesi ("23", "2C" …) — bounded.
     * @param rounds   aşama başına tur sayısı — bounded.
     * @param stHexB   B aşamasında uygulanacak ATST değeri (hex, ör. "FF").
     */
    void run(java.util.List<String> pids, int rounds, String stHexB) {
        if (running) { return; }
        running = true;
        status = "running";
        failReason = null;
        samples.clear();
        phases.clear();

        final java.util.List<String> list = normalizePids(pids);
        final int n = Math.max(1, Math.min(MAX_ROUNDS, rounds));

        try {
            if (list.isEmpty()) {
                status = "failed";
                failReason = "PID listesi boş — ölçülecek bir şey yok (varsayılan ÜRETİLMEZ).";
                return;
            }

            // ── A) mevcut ayar — ATST'ye DOKUNULMAZ (üretimdeki gerçek hâl) ──
            runPhase("A", list, n, null, true);

            // ── B) ATST uzatılmış ──
            boolean ok = applyStTimeout(stHexB);
            runPhase("B", list, n, stHexB, ok);

            status = "done";
        } catch (Throwable t) {
            status = "failed";
            failReason = String.valueOf(t.getMessage());
        } finally {
            /* AYAR HER HÂLÜKÂRDA GERİ ALINIR — deney ürünü kalıcı etkilemez.
               Ürün CAN'de ATST'yi hiç göndermediği için "geri alma" = belgelenmiş
               ELM327 varsayılanını (0x32) yazmaktır. Bu, hiç göndermemekle AYNI
               etkiyi verir ve durumu belirsiz bırakmaz. */
            try { applyStTimeout(DEFAULT_ST_HEX); } catch (Throwable ignored) { }
            running = false;
        }
    }

    /* ── Aşama ──────────────────────────────────────────────────────────── */

    private void runPhase(String phase, java.util.List<String> pids, int rounds,
                          String stHex, boolean stOk) {
        PhaseMeta meta = new PhaseMeta();
        meta.phase = phase;
        meta.stApplied = (stHex == null || stHex.isEmpty()) ? "default" : stHex.toUpperCase();
        meta.stCommandOk = stOk;
        meta.startedAt = System.currentTimeMillis();
        phases.add(meta);

        for (int r = 0; r < rounds; r++) {
            for (String pid : pids) {
                if (!running) { status = "aborted"; meta.finishedAt = System.currentTimeMillis(); return; }
                measureOne(phase, pid);
            }
        }
        meta.finishedAt = System.currentTimeMillis();
    }

    /**
     * TEK ölçüm. Sonuç `ExtendedNoDataTracker`e VERİLMEZ ve `ExtendedPollEvidence`e
     * işlenmez — deney kendi defterini tutar, ürünün öğrenmesini kirletmez.
     */
    private void measureOne(String phase, String pid) {
        long t0 = System.currentTimeMillis();
        ElmResponseParser.Result r = null;
        try {
            r = queue.submit(ElmCommandQueue.Priority.USER, null,
                () -> protocol.readPidClassified(pid)).get();
        } catch (Exception ignored) {
            r = null;
        }
        long dt = System.currentTimeMillis() - t0;
        String outcome = classify(r);
        int len = (r != null && r.raw != null) ? r.raw.length() : 0;
        samples.add(new Sample(phase, pid, outcome, dt, len));
    }

    private static String classify(ElmResponseParser.Result r) {
        if (r == null) return "OTHER";
        switch (r.kind) {
            case OK:              return "OK";
            case NO_DATA:         return "NO_DATA";
            case NEG_7F:          return "NEG_7F";
            case BUSY:            return "BUSY";
            case ERROR:           return "ERROR";
            case TIMEOUT_PARTIAL: return "TIMEOUT_PARTIAL";
            default:              return "OTHER";
        }
    }

    /** {@code ATST<hex>} gönderir. Klon '?' dönerse false (deney yine koşar, meta'da işaretlenir). */
    private boolean applyStTimeout(String stHex) {
        if (stHex == null || stHex.isEmpty()) return false;
        try {
            String resp = queue.submit(ElmCommandQueue.Priority.USER, null,
                () -> protocol.setResponseTimeout(stHex)).get();
            return resp != null && resp.toUpperCase().contains("OK");
        } catch (Exception e) {
            return false;
        }
    }

    /* ── Girdi normalizasyonu ───────────────────────────────────────────── */

    private static java.util.List<String> normalizePids(java.util.List<String> in) {
        java.util.LinkedHashSet<String> out = new java.util.LinkedHashSet<>();
        if (in == null) return new java.util.ArrayList<>(out);
        for (String raw : in) {
            if (raw == null) continue;
            String p = raw.trim().toUpperCase();
            if (p.length() != 2) continue;                       // yalnız 2 haneli Mode-01 PID
            if (!p.matches("[0-9A-F]{2}")) continue;
            out.add(p);
            if (out.size() >= MAX_PIDS) break;
        }
        return new java.util.ArrayList<>(out);
    }

    /** Koşan deneyi durdurur (kullanıcı iptali) — mevcut komut kesilmez. */
    void abort() { running = false; }
}
