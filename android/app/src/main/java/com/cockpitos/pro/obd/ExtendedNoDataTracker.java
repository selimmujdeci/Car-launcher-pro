package com.cockpitos.pro.obd;

/**
 * EXTENDED poll NO_DATA öğrenmesi — ELEME ÇAĞLAYANINI KIRAN sürüm (kütük #524).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ESKİ TASARIMIN SAHADA ÖLÇÜLEN KUSURU ─────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Eski kural basitti: 3 ardışık NO_DATA → PID KALICI "sorma" listesine girer ve
 * oturum boyunca BİR DAHA HİÇ sorulmaz. Sahada gözlenen sonuç (2026-08-10):
 * izlenen PID sayısı 10-12'ye çıkıyor, sonra **6'da sabitleniyor** ve hayatta
 * kalanlar yalnızca ÇEKİRDEK PID'ler (devir, hız) oluyor — extended olanların
 * tamamı eleniyordu.
 *
 * Kusur üç yerdeydi:
 *  (1) **Kalıcılık:** bir kez OK dönmüş, yani ARACIN VERDİĞİ KANITLANMIŞ bir PID
 *      de kalıcı eleniyordu. Aralıklı cevap veren PID (kütük #516: %50 NO_DATA)
 *      3 ardışık boşluğu İSTATİSTİKSEL OLARAK kaçınılmaz biçimde yakalar →
 *      eleme kaçınılmazdı, "destek yok" kanıtı ise YOKTU.
 *  (2) **Stabilizasyon yok:** bağlantının hemen ardından, hat daha oturmamışken
 *      gelen NO_DATA'lar tam yetkili kanıt sayılıyordu. Oysa saha gözlemi
 *      "bağlantıdan sonra veriler bir süre bayat, sonra kendiliğinden oturuyor".
 *  (3) **Toplu eleme hat olayı sayılmıyordu:** kısa pencerede HERKESİN elenmesi
 *      "bu araç hiçbir şey desteklemiyor" değil, "hat bir an için düştü"
 *      demektir. Eski kod ikisini ayırt etmiyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── YENİ KURALLAR ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *  · **Bir kez OK dönen PID KALICI ELENMEZ.** Yalnız GEÇİCİ duraklatılır ve
 *    artan aralıklarla ({@link #PAUSE_LADDER}) yeniden denenir. Araç o PID'i
 *    verdiğini bir kez kanıtladıysa, sonraki sessizlik "destek yok" DEĞİLDİR.
 *  · **Hiç OK dönmemiş PID** eşiği aşarsa kalıcı elenir — ama bu bile
 *    {@link #reset}/{@link #onListChanged} ile sıfırlanır (oturum-içi).
 *  · **Stabilizasyon penceresi:** bağlantıdan sonraki ilk
 *    {@link #STABILIZE_CYCLES} turda NO_DATA eleme kanıtı SAYILMAZ.
 *  · **Toplu eleme = hat olayı:** {@link #BULK_WINDOW_CYCLES} tur içinde
 *    {@link #BULK_MIN_DEMOTES} veya daha fazla PID elenirse bu bir HAT olayıdır;
 *    tüm eleme SIFIRLANIR ve olay SAYILIR (gizlenmez).
 *  · TIMEOUT/ERROR hâlâ NÖTRDÜR — bağlantı sorunu "araç desteklemiyor" kanıtı
 *    değildir (zero-trust telemetry).
 *
 * Duraklatma merdiveni tur cinsindendir (duvar saati YOK): tur süresi cihaz
 * tier'ine ve protokole göre değişir; tur saymak her koşulda aynı anlamı taşır.
 *
 * Thread-safety: poll thread'i yazar, setExtendedPids plugin thread'inden gelir →
 * ConcurrentHashMap/keySet. İki manager (Classic/BLE) AYRI instance tutar.
 */
final class ExtendedNoDataTracker {

    /** Ardışık NO_DATA eşiği — ilk 1-2 yanıt ECU-meşgul kaynaklı geçici olabilir. */
    static final int DEMOTE_THRESHOLD = 3;

    /**
     * Bağlantıdan sonra bu kadar TUR boyunca NO_DATA eleme kanıtı SAYILMAZ.
     * Saha gözlemi: hat bağlantının hemen ardından oturmuş değildir. 10 tur,
     * varsayılan ~3 sn'lik turda ~30 sn'ye denk gelir — ECU'nun uyanması ve
     * protokol oturmasının tipik süresi.
     */
    static final int STABILIZE_CYCLES = 10;

    /**
     * GEÇİCİ duraklatma merdiveni (tur). Bir kez OK dönmüş PID susarsa sırayla
     * bu kadar tur beklenir, sonra YENİDEN denenir. Artan aralık: ısrarla susan
     * PID hattı meşgul etmesin, ama asla UNUTULMASIN.
     */
    static final int[] PAUSE_LADDER = { 20, 60, 180, 600 };

    /** Toplu eleme penceresi (tur) — bu pencerede biriken elemeler birlikte değerlendirilir. */
    static final int BULK_WINDOW_CYCLES = 30;
    /** Pencerede bu kadar PID elenirse HAT OLAYI sayılır (tek PID'in susması değil). */
    static final int BULK_MIN_DEMOTES = 3;

    /** Eleme sebebi — LAB'da gösterilir; "neden sorulmuyor" sorusu cevapsız kalmaz. */
    static final String REASON_NEVER_OK = "hiç OK dönmedi (kalıcı — oturum içi)";
    static final String REASON_PAUSED   = "OK dönmüştü, şimdi susuyor (geçici duraklatma)";

    private final java.util.concurrent.ConcurrentHashMap<String, Integer> streaks =
        new java.util.concurrent.ConcurrentHashMap<>();
    /** Hiç OK dönmemiş + eşiği aşmış → oturum-içi kalıcı eleme. */
    private final java.util.Set<String> permanent =
        java.util.concurrent.ConcurrentHashMap.newKeySet();
    /** Bu PID bu oturumda EN AZ BİR KEZ veri verdi — kalıcı elenemez. */
    private final java.util.Set<String> everOk =
        java.util.concurrent.ConcurrentHashMap.newKeySet();
    /** PID → duraklatmanın biteceği tur numarası. */
    private final java.util.concurrent.ConcurrentHashMap<String, Long> pausedUntil =
        new java.util.concurrent.ConcurrentHashMap<>();
    /** PID → kaçıncı duraklatma (merdiven basamağı). */
    private final java.util.concurrent.ConcurrentHashMap<String, Integer> pauseLevel =
        new java.util.concurrent.ConcurrentHashMap<>();

    private volatile java.util.List<String> lastList = java.util.Collections.emptyList();
    /** Oturumun başladığı tur — stabilizasyon penceresi buradan ölçülür. */
    private volatile long sessionStartCycle = 0;
    /** Toplu eleme penceresindeki eleme anları (tur numaraları). */
    private final java.util.concurrent.ConcurrentLinkedQueue<Long> recentDemotes =
        new java.util.concurrent.ConcurrentLinkedQueue<>();
    /** Kaç kez toplu eleme (hat olayı) tespit edilip eleme sıfırlandı. */
    private volatile int bulkResetCount = 0;
    /** #532 — TS'e bildirilmeyi bekleyen hat olayı var mı (tek-atımlık bayrak). */
    private volatile boolean bulkResetPending = false;
    /** Son hat olayının tur numarası — -1 = hiç olmadı. */
    private volatile long lastBulkCycle = -1;
    /** Stabilizasyon penceresinde yutulan (kanıt sayılmayan) NO_DATA adedi. */
    private volatile int suppressedDuringStabilize = 0;

    /**
     * Bu PID bu turda ATLANMALI mı?
     *
     * @param cycle güncel poll turu — duraklatma merdiveni tur cinsindendir.
     */
    boolean shouldSkip(String pid, long cycle) {
        if (permanent.contains(pid)) return true;
        Long until = pausedUntil.get(pid);
        if (until == null) return false;
        if (cycle >= until) {
            /* Duraklatma doldu → SIRAYA GERİ GİRER. Streak sıfırlanır ki tek bir
               NO_DATA anında yeniden elemesin; merdiven basamağı KORUNUR (ısrarla
               susuyorsa bir sonraki duraklatma daha uzun olsun). */
            pausedUntil.remove(pid);
            streaks.remove(pid);
            return false;
        }
        return true;
    }

    /**
     * Bir extended sorgu sonucunu işler.
     *
     * @param cycle güncel poll turu.
     * @return true = bu kayıtla PID İLK KEZ elendi/duraklatıldı — çağıran TS'e
     *         bildirmeli (sonraki kayıtlar false döner; olay fırtınası yok).
     */
    boolean recordOutcome(String pid, ElmResponseParser.Result r, long cycle) {
        if (r == null) return false;                       // iptal/kuyruk kapandı — nötr
        if (r.kind == ElmResponseParser.Kind.OK) {
            /* CANLI VERİ — temiz sayfa. Araç bu PID'i verdiğini KANITLADI: artık
               kalıcı elenemez ve merdiven başa döner. */
            everOk.add(pid);
            streaks.remove(pid);
            pausedUntil.remove(pid);
            pauseLevel.remove(pid);
            permanent.remove(pid);
            return false;
        }
        boolean vehicleSaysNo = r.kind == ElmResponseParser.Kind.NO_DATA
            || r.kind == ElmResponseParser.Kind.NEG_7F;
        if (!vehicleSaysNo) return false;                   // timeout/error → nötr (kanıt değil)

        /* STABİLİZASYON: hat kendini kanıtlayana kadar sessizlik ELEME KANITI DEĞİLDİR.
           Sayılır ama karar üretmez — kaç tanesinin yutulduğu LAB'da görünür. */
        if (cycle - sessionStartCycle < STABILIZE_CYCLES) {
            suppressedDuringStabilize++;
            return false;
        }

        int s = streaks.merge(pid, 1, Integer::sum);
        if (s < DEMOTE_THRESHOLD) return false;

        boolean first;
        if (everOk.contains(pid)) {
            /* GEÇİCİ DURAKLATMA — bu PID'in çalıştığı KANITLANMIŞTIR; susması
               "desteklenmiyor" değildir. Artan aralıkla yeniden denenir. */
            int lvl = pauseLevel.merge(pid, 1, Integer::sum);
            int idx = Math.min(lvl - 1, PAUSE_LADDER.length - 1);
            first = pausedUntil.put(pid, cycle + PAUSE_LADDER[idx]) == null;
            streaks.remove(pid);
        } else {
            /* Hiç OK dönmemiş → oturum-içi kalıcı eleme (eski davranış korunur). */
            first = permanent.add(pid);
        }

        if (first) {
            recentDemotes.add(cycle);
            checkBulk(cycle);
        }
        return first;
    }

    /**
     * TOPLU ELEME = HAT OLAYI. Kısa pencerede çok sayıda PID'in birden susması,
     * araçların ayrı ayrı "desteklemiyorum" demesi değil; hattın bir an düşmesidir.
     * Tespit edilince tüm eleme SIFIRLANIR (PID'ler sıraya geri döner) ve olay
     * SAYILIR — sessizce yutulmaz.
     */
    private void checkBulk(long cycle) {
        Long head;
        while ((head = recentDemotes.peek()) != null && cycle - head > BULK_WINDOW_CYCLES) {
            recentDemotes.poll();
        }
        if (recentDemotes.size() < BULK_MIN_DEMOTES) return;
        bulkResetCount++;
        lastBulkCycle = cycle;
        /* #532: TS'e bildirilmek üzere işaretle. SAHA (2026-08-11): hat olayı
           2 kez tetiklendi ve native eleme SIFIRLANDI, ama TS tarafındaki
           `_unavailable` kaydı kalıcı kaldı → `timeline.demoted: 1` ile
           `elim.permanentCount: 0` AYNI snapshot'ta çelişti. Sıfırlama tek
           taraflı kalırsa ikinci otorite yeniden doğar. */
        bulkResetPending = true;
        permanent.clear();
        pausedUntil.clear();
        streaks.clear();
        recentDemotes.clear();
        /* pauseLevel KORUNUR: hat olayı elemeyi geri alır ama geçmişi silmez —
           gerçekten ısrarla susan bir PID bir sonraki turda daha uzun duraklar. */
    }

    /** İzlenen liste İÇERİK olarak değişti mi? Değiştiyse öğrenme sıfırlanır (yeni talep = yeni şans). */
    void onListChanged(java.util.List<String> newList) {
        if (!newList.equals(lastList)) {
            clearAll();
            lastList = newList;
        }
    }

    /**
     * Yeni bağlantı/oturum — tüm öğrenme sıfırlanır (farklı araç olabilir) ve
     * STABİLİZASYON penceresi bu turdan itibaren başlar.
     */
    void reset(long cycle) {
        clearAll();
        lastList = java.util.Collections.emptyList();
        sessionStartCycle = cycle;
        bulkResetCount = 0;
        lastBulkCycle = -1;
        suppressedDuringStabilize = 0;
    }

    private void clearAll() {
        streaks.clear();
        permanent.clear();
        everOk.clear();
        pausedUntil.clear();
        pauseLevel.clear();
        recentDemotes.clear();
    }

    /* ── Görünürlük (LAB) — "neden sorulmuyor" sorusu cevapsız kalmasın ────── */

    /**
     * #525 — bu PID KALICI mı elendi yoksa GEÇİCİ mi duraklatıldı?
     * Çağıran TS'e doğru sebebi bildirmek zorundadır: TS tarafı "no_data"yı
     * KALICI "araç vermiyor" olarak kaydediyordu ve geçici duraklatma da aynı
     * kanaldan gidince PID sıraya geri girse bile TS onu elenmiş sayıyordu
     * (saha 2026-08-10: native 0 elenmiş derken timeline 3 diyordu).
     */
    boolean isPermanent(String pid) { return permanent.contains(pid); }

    /** Oturum-içi KALICI elenmiş PID sayısı (hiç OK dönmemiş olanlar). */
    int permanentCount() { return permanent.size(); }
    /** Şu an GEÇİCİ duraklatılmış PID sayısı. */
    int pausedCount()    { return pausedUntil.size(); }
    /** En az bir kez veri vermiş PID sayısı — kalıcı elenemezler. */
    int everOkCount()    { return everOk.size(); }
    /** Kaç kez toplu eleme (hat olayı) tespit edilip eleme sıfırlandı. */
    int bulkResetCount() { return bulkResetCount; }

    /**
     * #532 — hat olayı bildirimi bekliyorsa `true` döner ve bayrağı TÜKETİR.
     * Çağıran TS'e bildirmekle yükümlüdür; iki kez bildirilmez.
     */
    boolean consumeBulkResetPending() {
        if (!bulkResetPending) return false;
        bulkResetPending = false;
        return true;
    }
    /** Son hat olayının tur numarası; -1 = hiç olmadı. */
    long lastBulkCycle() { return lastBulkCycle; }
    /** Stabilizasyon penceresinde kanıt sayılmayan NO_DATA adedi. */
    int suppressedDuringStabilize() { return suppressedDuringStabilize; }
    /** Stabilizasyon penceresi hâlâ açık mı. */
    boolean stabilizing(long cycle) { return cycle - sessionStartCycle < STABILIZE_CYCLES; }

    /** Kalıcı elenmiş PID'ler (bounded kopya). */
    java.util.List<String> permanentPids() { return new java.util.ArrayList<>(permanent); }
    /** Duraklatılmış PID → kalan tur sayısı (bounded kopya). */
    java.util.Map<String, Long> pausedRemaining(long cycle) {
        java.util.Map<String, Long> out = new java.util.LinkedHashMap<>();
        for (java.util.Map.Entry<String, Long> e : pausedUntil.entrySet()) {
            out.put(e.getKey(), Math.max(0L, e.getValue() - cycle));
        }
        return out;
    }
}
