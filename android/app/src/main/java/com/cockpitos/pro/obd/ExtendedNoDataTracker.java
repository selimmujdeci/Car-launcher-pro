package com.cockpitos.pro.obd;

/**
 * PR-OBD-KWP-1 — EXTENDED poll NO_DATA öğrenme (demotion).
 *
 * KÖK NEDEN: araç desteklemediği (veya bu protokolde vermediği) bir extended PID her poll
 * turunda YENİDEN sorgulanıyordu. Trafic/KWP sahasında 39 PID'in 39'u NO_DATA döndü — F0-4
 * ile yanıt penceresi ~1 sn'ye çıktığı için (ATST FF) her başarısız sorgu artık turu ~1 sn
 * bekletir → 39 PID'lik burst turu ~40 sn'ye şişer, hot-path açlığı ve "takılma" hissi doğar.
 *
 * ÇÖZÜM: aynı PID {@value #DEMOTE_THRESHOLD} kez ARDIŞIK NO_DATA (veya ECU'nun açık 7F
 * reddi) dönerse OTURUM-İÇİ "sorma" listesine alınır (demote). Bir kez OK dönerse sayaç
 * sıfırlanır. TIMEOUT/ERROR NÖTRDÜR — bağlantı sorunudur, "araç desteklemiyor" kanıtı
 * DEĞİLDİR (yanlış-negatif öğrenme yasak, zero-trust).
 *
 * SINIRLAR (bilinçli):
 *  - Kalıcı DEĞİL, oturum-içi: yeni bağlantı ({@link #reset}) veya izlenen liste değişimi
 *    ({@link #onListChanged}) tüm öğrenmeyi sıfırlar — araç/koşul değişmiş olabilir.
 *  - Demotion KANIT ÜRETİR, gizlemez: ilk demote anında çağıran TS'e olay yollar
 *    (obdExtendedPidStatus) → UI "NO_DATA — araç bu PID'i vermiyor" gerçek nedenini gösterir.
 *
 * Thread-safety: poll thread'i yazar, setExtendedPids plugin thread'inden gelir →
 * ConcurrentHashMap/keySet. İki manager (Classic/BLE) AYRI instance tutar (ayrı transport).
 */
final class ExtendedNoDataTracker {

    /** Ardışık NO_DATA eşiği — ilk 1-2 yanıt ECU-meşgul kaynaklı geçici olabilir. */
    static final int DEMOTE_THRESHOLD = 3;

    private final java.util.concurrent.ConcurrentHashMap<String, Integer> streaks =
        new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Set<String> demoted =
        java.util.concurrent.ConcurrentHashMap.newKeySet();
    private volatile java.util.List<String> lastList = java.util.Collections.emptyList();

    /** Bu PID bu oturumda demote edildi mi (poll turu onu atlamalı mı)? */
    boolean shouldSkip(String pid) {
        return demoted.contains(pid);
    }

    /**
     * Bir extended sorgu sonucunu işler.
     *
     * @return true = bu kayıtla PID İLK KEZ demote edildi — çağıran TS'e bildirmeli
     *         (sonraki kayıtlar false döner; olay fırtınası yok).
     */
    boolean recordOutcome(String pid, ElmResponseParser.Result r) {
        if (r == null) return false;                       // iptal/kuyruk kapandı — nötr
        if (r.kind == ElmResponseParser.Kind.OK) {
            streaks.remove(pid);                            // canlı veri → temiz sayfa
            return false;
        }
        boolean vehicleSaysNo = r.kind == ElmResponseParser.Kind.NO_DATA
            || r.kind == ElmResponseParser.Kind.NEG_7F;
        if (!vehicleSaysNo) return false;                   // timeout/error → nötr (kanıt değil)
        int s = streaks.merge(pid, 1, Integer::sum);
        if (s >= DEMOTE_THRESHOLD) {
            return demoted.add(pid);                        // yalnız İLK ekleme true döner
        }
        return false;
    }

    /** İzlenen liste İÇERİK olarak değişti mi? Değiştiyse öğrenme sıfırlanır (yeni talep = yeni şans). */
    void onListChanged(java.util.List<String> newList) {
        if (!newList.equals(lastList)) {
            streaks.clear();
            demoted.clear();
            lastList = newList;
        }
    }

    /** Yeni bağlantı/oturum — tüm öğrenme sıfırlanır (farklı araç olabilir). */
    void reset() {
        streaks.clear();
        demoted.clear();
        lastList = java.util.Collections.emptyList();
    }

    /** Teşhis görünürlüğü: şu an demote edilmiş PID sayısı. */
    int demotedCount() {
        return demoted.size();
    }
}
