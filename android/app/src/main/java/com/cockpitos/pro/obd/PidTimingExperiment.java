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
 * ── DENEY: ÜÇ AŞAMA (A → B → A') ────────────────────────────────────────────
 * AYNI bağlantıda, arka arkaya; aralarında BAŞKA HİÇBİR ŞEY değişmez:
 *   A ) mevcut ayar (CAN'de ATST'ye DOKUNULMAZ — üretimdeki hâl)
 *   B ) {@code ATST<hex>} uzatılmış
 *   A') ATST eski hâline döner — AYNI ölçüm TEKRARLANIR
 *
 * ── NEDEN ÜÇÜNCÜ AŞAMA (kritik) ─────────────────────────────────────────────
 * Saha gözlemi: bağlantıdan sonra veriler bir süre bayat, sonra KENDİLİĞİNDEN
 * oturuyor. B, A'dan SONRA koştuğu için hat kendiliğinden oturmuş olacak ve B
 * daha iyi çıkacaktır — **ATST hiçbir şey yapmasa bile**. İki aşamalı tasarım
 * ZAMANIN etkisi ile ATST'nin etkisini AYIRAMAZ. Üçüncü aşama bu karışıklığı
 * çözer:
 *   · A' YİNE KÖTÜ  → düzelme ATST'den geldi, geri alınınca kayboldu → KÖK BUDUR.
 *   · A' de İYİ     → düzelme ZAMANDAN geldi; ATST'nin katkısı BELİRSİZDİR.
 *
 * Her aşamada aynı PID listesi × N tur; PID başına süre/sonuç ve aşamanın
 * **bağlantıdan kaç ms sonra** başladığı kaydedilir (zaman ekseni hükmün parçası).
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
        final String phase;      // "A" | "B" | "A2"
        final String pid;        // "23"
        final String outcome;    // OK | NO_DATA | NEG_7F | BUSY | ERROR | TIMEOUT_PARTIAL | OTHER
        /**
         * B4 (#518) — SAF komut süresi: komut kuyruktan ALINDIKTAN sonra geçen süre.
         * Eskiden kuyruk beklemesi de buna dahildi → "ECU ne kadar bekletti" sorusu
         * kuyruk çekişmesiyle KARIŞIYORDU. Rotasyon tasarımının (#515) girdisi budur.
         */
        final long   elapsedMs;
        /** B4 — komutun kuyrukta beklediği süre. -1 = ölçülemedi. */
        final long   queueWaitMs;
        final int    respLen;

        Sample(String phase, String pid, String outcome, long elapsedMs, long queueWaitMs, int respLen) {
            this.phase = phase; this.pid = pid; this.outcome = outcome;
            this.elapsedMs = elapsedMs; this.queueWaitMs = queueWaitMs; this.respLen = respLen;
        }
    }

    /** Bir aşamanın kaba özeti (ayrıntı TS'te hesaplanır). */
    static final class PhaseMeta {
        String  phase;           // "A" | "B" | "A2"
        /**
         * B3 (#518) — A aşamasında **'UNKNOWN'**, 'default' DEĞİL: adaptörün gerçek
         * ST değeri OKUNAMIYOR (ATST sorgulanamaz). "default" yazmak, doğrulanmamış
         * bir kesinlik iddiasıdır — ELM327 varsayılanı 0x32 olsa da klon adaptör
         * başka bir değerle gelmiş olabilir.
         */
        String  stApplied;       // "UNKNOWN" (A) | "FF" (B) | "32" (A')
        boolean stCommandOk;     // ATST 'OK' döndü mü (klon '?' dönebilir)
        long    startedAt;
        long    finishedAt;
        /** Bağlantı kurulduktan kaç ms SONRA bu aşama başladı. -1 = bilinmiyor. */
        long    sinceConnectMs;
        /** B2 — bu aşamada kullanılan okuma deadline'ı (ms). ATST'ye göre ölçeklenir. */
        int     readDeadlineMs;
    }

    private final ElmCommandQueue queue;
    private final ElmProtocol     protocol;

    private volatile boolean running = false;
    private volatile String  status  = "idle";   // idle | running | done | failed | aborted
    private volatile String  failReason = null;
    /** B7 (#518) — ATST geri alma SONUCU: "true" | "false" | "UNKNOWN". Sessiz yutma YOK. */
    private volatile String  stRestored = "UNKNOWN";
    private final java.util.List<Sample>    samples = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
    private final java.util.List<PhaseMeta> phases  = java.util.Collections.synchronizedList(new java.util.ArrayList<>());

    PidTimingExperiment(ElmCommandQueue queue, ElmProtocol protocol) {
        this.queue = queue;
        this.protocol = protocol;
    }

    boolean isRunning() { return running; }
    String  status()    { return status; }
    String  failReason(){ return failReason; }
    String  stRestored() { return stRestored; }

    java.util.List<Sample>    samplesSnapshot() { synchronized (samples) { return new java.util.ArrayList<>(samples); } }
    java.util.List<PhaseMeta> phasesSnapshot()  { synchronized (phases)  { return new java.util.ArrayList<>(phases);  } }

    /**
     * Deneyi çalıştırır (ÇAĞIRAN THREAD'i bloklar — plugin arka plan thread'inden çağırmalı).
     *
     * @param pids     ölçülecek PID listesi ("23", "2C" …) — bounded.
     * @param rounds   aşama başına tur sayısı — bounded.
     * @param stHexB   B aşamasında uygulanacak ATST değeri (hex, ör. "FF").
     */
    void run(java.util.List<String> pids, int rounds, String stHexB, long connectedAtMs) {
        if (running) { return; }
        running = true;
        status = "running";
        failReason = null;
        stRestored = "UNKNOWN";
        samples.clear();
        phases.clear();
        /* B5: deney penceresi AÇILIR — sonraki saha okumaları bu trafiği ayırabilsin. */
        ExtendedPollEvidence.INSTANCE.markExperimentStart(System.currentTimeMillis());

        final java.util.List<String> list = normalizePids(pids);
        final int n = Math.max(1, Math.min(MAX_ROUNDS, rounds));

        try {
            if (list.isEmpty()) {
                status = "failed";
                failReason = "PID listesi boş — ölçülecek bir şey yok (varsayılan ÜRETİLMEZ).";
                return;
            }

            // ── A) mevcut ayar — ATST'ye DOKUNULMAZ (üretimdeki gerçek hâl) ──
            // B3: gerçek ST OKUNAMIYOR → 'UNKNOWN'. Deadline varsayılan.
            runPhase("A", list, n, null, true, connectedAtMs, 1500);
            if (!running) { status = "aborted"; return; }

            // ── B) ATST uzatılmış ──
            boolean okB = applyStTimeout(stHexB);
            runPhase("B", list, n, stHexB, okB, connectedAtMs, deadlineFor(stHexB));
            if (!running) { status = "aborted"; return; }

            // ── A') ATST GERİ ALINIR ve AYNI ölçüm tekrarlanır ────────────────
            // Kontrol aşaması: B'deki iyileşme ATST'den mi yoksa hattın
            // kendiliğinden oturmasından mı geldi? A' bunu ayırır.
            boolean okA2 = applyStTimeout(DEFAULT_ST_HEX);
            runPhase("A2", list, n, DEFAULT_ST_HEX, okA2, connectedAtMs, deadlineFor(DEFAULT_ST_HEX));

            /* B7: iptal edilmiş bir deney ASLA "done" raporlanmaz. */
            status = running ? "done" : "aborted";
        } catch (Throwable t) {
            status = "failed";
            failReason = String.valueOf(t.getMessage());
        } finally {
            /* AYAR HER HÂLÜKÂRDA GERİ ALINIR — deney ürünü kalıcı etkilemez.
               Ürün CAN'de ATST'yi hiç göndermediği için "geri alma" = belgelenmiş
               ELM327 varsayılanını (0x32) yazmaktır. Bu, hiç göndermemekle AYNI
               etkiyi verir ve durumu belirsiz bırakmaz. */
            try {
                stRestored = applyStTimeout(DEFAULT_ST_HEX) ? "true" : "false";
            } catch (Throwable ignored) {
                stRestored = "UNKNOWN";   // B7: sessiz yutma YOK — belirsizlik BELİRSİZ yazılır
            }
            ExtendedPollEvidence.INSTANCE.markExperimentEnd(System.currentTimeMillis());
            running = false;
        }
    }

    /* ── Aşama ──────────────────────────────────────────────────────────── */

    private void runPhase(String phase, java.util.List<String> pids, int rounds,
                          String stHex, boolean stOk, long connectedAtMs, int deadlineMs) {
        PhaseMeta meta = new PhaseMeta();
        meta.phase = phase;
        meta.stApplied = (stHex == null || stHex.isEmpty()) ? "UNKNOWN" : stHex.toUpperCase();
        meta.readDeadlineMs = deadlineMs;
        meta.stCommandOk = stOk;
        meta.startedAt = System.currentTimeMillis();
        /* Zaman ekseni: hattın kendiliğinden oturması bu sayıyla okunur. Bağlantı
           damgası yoksa -1 (sahte 0 YAZILMAZ). */
        meta.sinceConnectMs = connectedAtMs > 0 ? (meta.startedAt - connectedAtMs) : -1L;
        phases.add(meta);

        for (int r = 0; r < rounds; r++) {
            for (String pid : pids) {
                if (!running) { status = "aborted"; meta.finishedAt = System.currentTimeMillis(); return; }
                measureOne(phase, pid, deadlineMs);
            }
        }
        meta.finishedAt = System.currentTimeMillis();
    }

    /**
     * TEK ölçüm. Sonuç `ExtendedNoDataTracker`e VERİLMEZ ve `ExtendedPollEvidence`e
     * işlenmez — deney kendi defterini tutar, ürünün öğrenmesini kirletmez.
     */
    private void measureOne(String phase, String pid, int deadlineMs) {
        final long tSubmit = System.currentTimeMillis();
        /* B4: komutun GERÇEKTEN başladığı an — kuyruk beklemesini saf süreden ayırır. */
        final long[] tStart = { -1L };
        ElmResponseParser.Result r = null;
        try {
            r = queue.submit(ElmCommandQueue.Priority.USER, null, () -> {
                tStart[0] = System.currentTimeMillis();
                return protocol.readPidClassified(pid, deadlineMs);
            }).get();
        } catch (Exception ignored) {
            r = null;
        }
        final long tEnd = System.currentTimeMillis();
        final long queueWaitMs = tStart[0] > 0 ? (tStart[0] - tSubmit) : -1L;
        final long elapsedMs   = tStart[0] > 0 ? (tEnd - tStart[0]) : (tEnd - tSubmit);
        String outcome = classify(r);
        int len = (r != null && r.raw != null) ? r.raw.length() : 0;
        samples.add(new Sample(phase, pid, outcome, elapsedMs, queueWaitMs, len));
    }

    /**
     * B2 — ATST'ye göre okuma deadline'ı: {@code max(1500, stMs + 600)}.
     * ELM327: ST değeri × 4 ms. `FF` → 1020 ms → deadline 1620 ms (sabit 1500'de
     * yalnız ~480 ms marj kalırdı ve uzatmanın kazandırdığı pencereyi BİZ keserdik).
     */
    private static int deadlineFor(String stHex) {
        try {
            int st = Integer.parseInt(stHex.trim(), 16);
            return Math.max(1500, (st * 4) + 600);
        } catch (Exception e) {
            return 1500;
        }
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
