package com.cockpitos.pro.obd;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * ExtendedPollEvidence — PR-OBD-DIAG-3: EXTENDED PID poll hattı için OTURUMLUK,
 * BOUNDED tanı kanıtı biriktiricisi (yalnız gözlemlenebilirlik — davranış DEĞİŞTİRMEZ).
 *
 * KÖK PROBLEM: {@code obdDeep.extended.samples: []} iki tamamen farklı davranışı
 * ayıramıyordu:
 *   H1 — hiç extended sorgu DENENMEDİ (burst/poll wiring çalışmıyor),
 *   H2 — sorgular denendi ama ECU/transport DEĞER üretmedi (NO_DATA/timeout/negatif),
 *   H3 — native BAŞARILI + callback yayıldı ama JS/store'a değer AKMADI (köprü/decode).
 * Bu sınıf her extended denemesinin outcome'unu bounded sayaçlara işler → tek raporla
 * H1/H2/H3/H4 ayrılır.
 *
 * EŞ ZAMANLILIK: TEK yazan poll thread'i (BleObdManager/OBDManager pollLoop) + plugin
 * boundary (setRequestedPids / setBurstEnabled / reset). Okuyan: Capacitor plugin thread'i
 * ({@link #snapshot()}).
 * Tüm erişim tek {@code lock} altında serileştirilir; okuma NADİR (yalnız "Tanı Gönder")
 * olduğundan poll thread'i pratikte hiç beklemez. Sayaç güncellemeleri O(1).
 *
 * SINIRLAR (Malı-400 / bounded telemetri): sayaçlar saturating int; halka en fazla
 * {@link #RING_CAP} kayıt; PID önizlemesi en fazla {@link #PREVIEW_CAP}. Ham yanıt
 * gövdesi SAKLANMAZ (yalnız responseLength) — PII-güvenli. Capacitor/Android bağımlılığı
 * YOK → JUnit ile saf test edilebilir.
 */
public final class ExtendedPollEvidence {

    /** Süreç-genişliği tekil — iki manager da aynı örneğe yazar (aynı anda yalnız biri aktif). */
    public static final ExtendedPollEvidence INSTANCE = new ExtendedPollEvidence();

    /**
     * Bir extended PID denemesinin sonucu — {@link ElmResponseParser.Kind}'den türetilir
     * (+ native-özel {@code CANCELLED}: kopma/kapanışta okunmadan atlanan PID).
     */
    public enum Outcome {
        OK, NO_DATA, BUSY, NEGATIVE_RESPONSE, ERROR,
        TIMEOUT_NO_BYTES, TIMEOUT_PARTIAL, PARSE_ERROR, CANCELLED, UNKNOWN_FAILURE
    }

    private static final int RING_CAP = 8;
    private static final int PREVIEW_CAP = 8;
    /** Saturating tavan — taşma yerine sabitlenir (uzun oturumda sayaç bozulmaz). */
    private static final int SAT = Integer.MAX_VALUE - 1;

    /** Halka kaydı — değişmez. */
    public static final class Attempt {
        public final String pid;
        public final String outcome;
        public final long elapsedMs;
        public final int responseLength;
        public final boolean callbackEmitted;

        Attempt(String pid, String outcome, long elapsedMs, int responseLength, boolean callbackEmitted) {
            this.pid = pid;
            this.outcome = outcome;
            this.elapsedMs = elapsedMs;
            this.responseLength = responseLength;
            this.callbackEmitted = callbackEmitted;
        }
    }

    /** Anlık kanıt kopyası — değişmez (plugin JSObject'e serialize eder). */
    public static final class Snapshot {
        public final boolean present;
        public final String transport;
        public final boolean burstEnabled;
        public final int configuredPidCount;
        public final List<String> configuredPidPreview;
        public final int pollCycles, burstCycles, roundRobinCycles;
        public final int attemptedCount, successCount, noDataCount, busyCount,
                negativeResponseCount, errorCount, timeoutNoBytesCount,
                timeoutPartialCount, parseFailureCount, cancelledCount,
                unknownFailureCount, callbackEmittedCount;
        public final int maxBurstSizeObserved;
        public final String lastAttemptedPid, lastSuccessfulPid, lastOutcome;
        public final long lastElapsedMs, lastPollAt;
        public final List<Attempt> lastAttempts;

        Snapshot(boolean present, String transport, boolean burstEnabled, int configuredPidCount,
                 List<String> configuredPidPreview, int pollCycles, int burstCycles, int roundRobinCycles,
                 int attemptedCount, int successCount, int noDataCount, int busyCount,
                 int negativeResponseCount, int errorCount, int timeoutNoBytesCount,
                 int timeoutPartialCount, int parseFailureCount, int cancelledCount,
                 int unknownFailureCount, int callbackEmittedCount, int maxBurstSizeObserved,
                 String lastAttemptedPid, String lastSuccessfulPid, String lastOutcome,
                 long lastElapsedMs, long lastPollAt, List<Attempt> lastAttempts) {
            this.present = present;
            this.transport = transport;
            this.burstEnabled = burstEnabled;
            this.configuredPidCount = configuredPidCount;
            this.configuredPidPreview = Collections.unmodifiableList(configuredPidPreview);
            this.pollCycles = pollCycles;
            this.burstCycles = burstCycles;
            this.roundRobinCycles = roundRobinCycles;
            this.attemptedCount = attemptedCount;
            this.successCount = successCount;
            this.noDataCount = noDataCount;
            this.busyCount = busyCount;
            this.negativeResponseCount = negativeResponseCount;
            this.errorCount = errorCount;
            this.timeoutNoBytesCount = timeoutNoBytesCount;
            this.timeoutPartialCount = timeoutPartialCount;
            this.parseFailureCount = parseFailureCount;
            this.cancelledCount = cancelledCount;
            this.unknownFailureCount = unknownFailureCount;
            this.callbackEmittedCount = callbackEmittedCount;
            this.maxBurstSizeObserved = maxBurstSizeObserved;
            this.lastAttemptedPid = lastAttemptedPid;
            this.lastSuccessfulPid = lastSuccessfulPid;
            this.lastOutcome = lastOutcome;
            this.lastElapsedMs = lastElapsedMs;
            this.lastPollAt = lastPollAt;
            this.lastAttempts = Collections.unmodifiableList(lastAttempts);
        }

        /** Sayaç bütünlüğü: her deneme TAM bir outcome kaydeder → toplam == attempted. */
        public boolean isCoherent() {
            long sum = (long) successCount + noDataCount + busyCount + negativeResponseCount
                + errorCount + timeoutNoBytesCount + timeoutPartialCount + parseFailureCount
                + cancelledCount + unknownFailureCount;
            return sum == attemptedCount || attemptedCount >= SAT;
        }
    }

    private final Object lock = new Object();

    // ── Niyet (intent) — plugin boundary'de set edilir; reset'i AŞAR (reconnect'te korunur).
    private boolean present = false;
    private String transport = "unknown";
    private boolean burstEnabled = false;
    private int configuredPidCount = 0;
    private final List<String> configuredPidPreview = new ArrayList<>();

    // ── Oturum sayaçları — reset() ile temizlenir (mevcut bağlantı = bir oturum).
    private int pollCycles, burstCycles, roundRobinCycles;
    private int attemptedCount, successCount, noDataCount, busyCount,
            negativeResponseCount, errorCount, timeoutNoBytesCount,
            timeoutPartialCount, parseFailureCount, cancelledCount,
            unknownFailureCount, callbackEmittedCount;
    private int maxBurstSizeObserved;
    private String lastAttemptedPid = null, lastSuccessfulPid = null, lastOutcome = null;
    private long lastElapsedMs = 0, lastPollAt = 0;
    private final ArrayDeque<Attempt> ring = new ArrayDeque<>(RING_CAP);

    private ExtendedPollEvidence() { /* tekil */ }

    private static int sadd(int a) { return a >= SAT ? SAT : a + 1; }

    /**
     * Yeni poll oturumu — mevcut bağlantının pollLoop'u başında çağrılır. Oturum
     * sayaçlarını sıfırlar; NİYET alanlarını (configuredPidCount/preview/burst) KORUR
     * (TS reconnect'te listeyi yeniden göndermeyebilir → son bilinen niyet kalsın).
     */
    public void reset(String transport) {
        synchronized (lock) {
            present = true;
            this.transport = transport != null ? transport : "unknown";
            pollCycles = burstCycles = roundRobinCycles = 0;
            attemptedCount = successCount = noDataCount = busyCount = 0;
            negativeResponseCount = errorCount = timeoutNoBytesCount = 0;
            timeoutPartialCount = parseFailureCount = cancelledCount = 0;
            unknownFailureCount = callbackEmittedCount = 0;
            maxBurstSizeObserved = 0;
            lastAttemptedPid = lastSuccessfulPid = lastOutcome = null;
            lastElapsedMs = lastPollAt = 0;
            ring.clear();
        }
    }

    /**
     * Plugin boundary — TS'in native'e verdiği EXTENDED PID listesi (niyet). configuredPidCount
     * bu sayede poll turu HİÇ çalışmasa bile &gt;0 kalır → H1 (configured&gt;0 &amp; attempted=0) görünür.
     */
    public void setRequestedPids(List<String> pids) {
        synchronized (lock) {
            present = true;
            int n = pids == null ? 0 : pids.size();
            configuredPidCount = n;
            configuredPidPreview.clear();
            if (pids != null) {
                for (int i = 0; i < pids.size() && i < PREVIEW_CAP; i++) configuredPidPreview.add(pids.get(i));
            }
        }
    }

    /** Plugin boundary — teşhis burst niyeti (Canlı Test ekranı görünürlüğü). */
    public void setBurstEnabled(boolean on) {
        synchronized (lock) { present = true; burstEnabled = on; }
    }

    /** Poll turu kadans kanıtı — extended grubu bu turda işlendiğinde çağrılır. */
    public void recordCycle(boolean burst, int configuredThisCycle) {
        synchronized (lock) {
            present = true;
            burstEnabled = burst;
            pollCycles = sadd(pollCycles);
            if (burst) {
                burstCycles = sadd(burstCycles);
                if (configuredThisCycle > maxBurstSizeObserved) maxBurstSizeObserved = configuredThisCycle;
            } else {
                roundRobinCycles = sadd(roundRobinCycles);
            }
        }
    }

    /** Tek extended PID denemesi sonucu (O(1)) — outcome sayacı + last* + halka. */
    public void recordAttempt(String pid, Outcome outcome, long elapsedMs, int responseLength, boolean callbackEmitted) {
        synchronized (lock) {
            present = true;
            attemptedCount = sadd(attemptedCount);
            switch (outcome) {
                case OK:                successCount = sadd(successCount); lastSuccessfulPid = pid; break;
                case NO_DATA:           noDataCount = sadd(noDataCount); break;
                case BUSY:              busyCount = sadd(busyCount); break;
                case NEGATIVE_RESPONSE: negativeResponseCount = sadd(negativeResponseCount); break;
                case ERROR:             errorCount = sadd(errorCount); break;
                case TIMEOUT_NO_BYTES:  timeoutNoBytesCount = sadd(timeoutNoBytesCount); break;
                case TIMEOUT_PARTIAL:   timeoutPartialCount = sadd(timeoutPartialCount); break;
                case PARSE_ERROR:       parseFailureCount = sadd(parseFailureCount); break;
                case CANCELLED:         cancelledCount = sadd(cancelledCount); break;
                default:                unknownFailureCount = sadd(unknownFailureCount); break;
            }
            if (callbackEmitted) callbackEmittedCount = sadd(callbackEmittedCount);
            lastAttemptedPid = pid;
            lastOutcome = outcome.name();
            lastElapsedMs = elapsedMs;
            lastPollAt = System.currentTimeMillis();
            if (ring.size() >= RING_CAP) ring.pollFirst();
            ring.addLast(new Attempt(pid, outcome.name(), elapsedMs, Math.max(0, responseLength), callbackEmitted));
        }
    }

    /** Değişmez anlık kopya (plugin serialize eder). */
    public Snapshot snapshot() {
        synchronized (lock) {
            return new Snapshot(present, transport, burstEnabled, configuredPidCount,
                new ArrayList<>(configuredPidPreview), pollCycles, burstCycles, roundRobinCycles,
                attemptedCount, successCount, noDataCount, busyCount, negativeResponseCount,
                errorCount, timeoutNoBytesCount, timeoutPartialCount, parseFailureCount,
                cancelledCount, unknownFailureCount, callbackEmittedCount, maxBurstSizeObserved,
                lastAttemptedPid, lastSuccessfulPid, lastOutcome, lastElapsedMs, lastPollAt,
                new ArrayList<>(ring));
        }
    }

    /**
     * {@link ElmResponseParser.Result}'ı native {@link Outcome}'a çevirir — TEK yer (kopya yok).
     * OK ama veri boşsa PARSE_ERROR; boş/null ham yanıt TIMEOUT_NO_BYTES, aksi TIMEOUT_PARTIAL.
     */
    public static Outcome fromResult(ElmResponseParser.Result r) {
        if (r == null) return Outcome.UNKNOWN_FAILURE;
        switch (r.kind) {
            case OK:      return (r.dataHex != null && !r.dataHex.isEmpty()) ? Outcome.OK : Outcome.PARSE_ERROR;
            case NO_DATA: return Outcome.NO_DATA;
            case BUSY:    return Outcome.BUSY;
            case NEG_7F:  return Outcome.NEGATIVE_RESPONSE;
            case ERROR:   return Outcome.ERROR;
            case TIMEOUT_PARTIAL:
                return (r.raw == null || r.raw.trim().isEmpty()) ? Outcome.TIMEOUT_NO_BYTES : Outcome.TIMEOUT_PARTIAL;
            default:      return Outcome.UNKNOWN_FAILURE;
        }
    }
}
