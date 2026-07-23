package com.cockpitos.pro.obd;

/**
 * LiveStreamStopEvidence — CANLI VERİ AKIŞININ DURMA SEBEBİNİN tek kayıt noktası.
 *
 * KURAL (P0 saha 2026-07-23, Trafic/KWP "veri 30-60sn sonra donuyor"):
 * **AKIŞ SESSİZCE DURAMAZ.** Bir çekirdek PID isteği veri getirmediğinde burada tipli
 * bir SEBEP KODU + tek satır künye üretilir. Sahada "neden dondu?" sorusu tahminle
 * değil KANITLA yanıtlanır.
 *
 * ── NEDEN AYRI SINIF ───────────────────────────────────────────────────────────
 * {@link KwpRecoveryEvidence} KURTARMANIN muhasebesini tutar (ATPC denendi mi, işe
 * yaradı mı). Bu sınıf ise DURMANIN muhasebesini tutar — biri "tedavi", diğeri
 * "teşhis". Karar mantığı burada YOKTUR: bu sınıf asla "dur" demez, yalnız yazar.
 *
 * ── SINIRLAR (otomotiv) ────────────────────────────────────────────────────────
 *   - Sabit boyutlu halka (bellek sızıntısı yok)
 *   - Ardışık AYNI sebep tekrar tekrar BASILMAZ (logcat spam'i yok) — sayaçla özetlenir
 *   - VIN/plaka/konum gibi PII kaydedilmez; yalnız PID + ham ELM yanıtı
 *   - {@code android.util.Log} çağrısı JVM unit testte mock'suz diye korunur
 */
public final class LiveStreamStopEvidence {

    /** Süreç-genişliği tekil — KwpRecoveryEvidence ile aynı desen. */
    public static final LiveStreamStopEvidence INSTANCE = new LiveStreamStopEvidence();

    /** Saklanan en fazla kayıt. */
    private static final int MAX_RECORDS = 20;

    /** Akışın durma sebebi — tipli, tahmin değil ölçüm. */
    public enum Reason {
        /** ELM327 açıkça "NO DATA" dedi → adaptör canlı, ECU yanıtsız. */
        NO_DATA,
        /** '>' prompt'u süresinde gelmedi, tampon BOŞ → ELM327 hiç konuşmadı. */
        READ_TIMEOUT,
        /** ELM327 komuta yanıt üretmedi ('?'/boş, adaptör durum makinesi karışmış). */
        ELM_NO_RESPONSE,
        /** ECU susuyor (K-line oturumu ölü) — ELM canlı. */
        ECU_NO_RESPONSE,
        /** "BUS INIT: ERROR" — ELM327 K-line/KWP bus'ını init edemedi (adaptör canlı, bus ölü). */
        BUS_INIT_ERROR,
        /** Soket/stream hatası (broken pipe, stream kapandı). */
        SOCKET_ERROR,
        /** Komut kuyruğu ilerlemiyor (worker bloklandı / iş birikti). */
        COMMAND_QUEUE_STALL,
        /** KWP wakeup/TesterPresent uygulanamadı → P3 oturum düşmesi riski. */
        KEEP_ALIVE_FAILED,
        /** KWP P3 oturum zaman aşımı (uzun sessizlik sonrası ECU oturumu kapattı). */
        SESSION_TIMEOUT,
        UNKNOWN,
    }

    /** Tek bir durma olayının künyesi (tüm alanlar opsiyonel olabilir — UYDURULMAZ). */
    public static final class Record {
        public final Reason reason;
        public final long   timestamp;
        public final String protocol;
        public final String adapter;
        public final long   requestId;
        public final String lastSuccessfulPid;
        public final String lastSuccessfulResponse;
        public final long   elapsedSinceLastPacketMs;
        public final int    queueDepth;
        public final String connectionState;
        public final int    recoveryAttempt;

        Record(Reason reason, long timestamp, String protocol, String adapter, long requestId,
               String lastSuccessfulPid, String lastSuccessfulResponse,
               long elapsedSinceLastPacketMs, int queueDepth, String connectionState,
               int recoveryAttempt) {
            this.reason = reason;
            this.timestamp = timestamp;
            this.protocol = protocol;
            this.adapter = adapter;
            this.requestId = requestId;
            this.lastSuccessfulPid = lastSuccessfulPid;
            this.lastSuccessfulResponse = lastSuccessfulResponse;
            this.elapsedSinceLastPacketMs = elapsedSinceLastPacketMs;
            this.queueDepth = queueDepth;
            this.connectionState = connectionState;
            this.recoveryAttempt = recoveryAttempt;
        }
    }

    private final Object lock = new Object();
    private final java.util.ArrayDeque<Record> records = new java.util.ArrayDeque<>();

    /* Taşıma bağlamı — OBDManager/BleObdManager doldurur (native tarafın bildiği alanlar). */
    private volatile String adapter         = null;
    private volatile String connectionState = null;
    private volatile int    queueDepth      = -1;

    /* Ardışık aynı sebebi bastırma (logcat spam'i yok). */
    private Reason lastLoggedReason  = null;
    private int    suppressedRepeats = 0;
    private long   totalStops        = 0;

    private LiveStreamStopEvidence() { }

    /** Taşıma bağlamını günceller (ucuz, sık çağrılabilir). */
    public void setTransportContext(String adapter, String connectionState, int queueDepth) {
        this.adapter         = adapter;
        this.connectionState = connectionState;
        this.queueDepth      = queueDepth;
    }

    /** Yeni bağlantı = yeni oturum → kayıtlar temizlenir. */
    public void reset() {
        synchronized (lock) {
            records.clear();
            lastLoggedReason  = null;
            suppressedRepeats = 0;
            totalStops        = 0;
        }
    }

    /**
     * Akışın durduğunu KAYDEDER ve (yeni bir sebepse) tek satır basar.
     * ASLA throw etmez — teşhis katmanı OBD akışını düşüremez (fail-soft).
     */
    public void noteStop(Reason reason, long nowMs, String protocol, long requestId,
                         String lastSuccessfulPid, String lastSuccessfulResponse,
                         long elapsedSinceLastPacketMs, int recoveryAttempt) {
        Record rec = new Record(
                reason == null ? Reason.UNKNOWN : reason, nowMs, protocol, adapter, requestId,
                lastSuccessfulPid, lastSuccessfulResponse, elapsedSinceLastPacketMs,
                queueDepth, connectionState, recoveryAttempt);

        boolean shouldLog;
        synchronized (lock) {
            totalStops++;
            records.addLast(rec);
            if (records.size() > MAX_RECORDS) records.removeFirst();

            shouldLog = rec.reason != lastLoggedReason;
            if (shouldLog) {
                lastLoggedReason  = rec.reason;
                suppressedRepeats = 0;
            } else {
                suppressedRepeats++;
            }
        }
        if (shouldLog) emit(rec);
    }

    /** Akış GERİ GELDİ → bastırma durumu sıfırlanır ki sonraki durma yeniden loglansın. */
    public void noteFlowing() {
        synchronized (lock) {
            lastLoggedReason  = null;
            suppressedRepeats = 0;
        }
    }

    private void emit(Record r) {
        try {
            android.util.Log.w("OBD",
                    "LIVE_STREAM_STOP_REASON=" + r.reason
                    + " timestamp=" + r.timestamp
                    + " protocol=" + str(r.protocol)
                    + " adapter=" + str(r.adapter)
                    + " requestId=" + r.requestId
                    + " lastSuccessfulPid=" + str(r.lastSuccessfulPid)
                    + " lastSuccessfulResponse=" + str(r.lastSuccessfulResponse)
                    + " elapsedSinceLastPacket=" + r.elapsedSinceLastPacketMs + "ms"
                    + " queueDepth=" + (r.queueDepth < 0 ? "?" : r.queueDepth)
                    + " connectionState=" + str(r.connectionState)
                    + " recoveryAttempt=" + r.recoveryAttempt);
        } catch (Throwable ignored) {
            // JVM unit test: android.util.Log mock yok — kayıt yine halkada durur.
        }
    }

    private static String str(String s) { return (s == null || s.isEmpty()) ? "?" : s; }

    /** Son durma kaydı (hiç yoksa null) — tanı raporu için. */
    public Record last() {
        synchronized (lock) { return records.peekLast(); }
    }

    /** Oturumda kaç kez akış durdu (bastırılanlar dahil). */
    public long totalStops() {
        synchronized (lock) { return totalStops; }
    }

    /** Sınırlı geçmiş (en eskiden yeniye). */
    public java.util.List<Record> history() {
        synchronized (lock) { return new java.util.ArrayList<>(records); }
    }
}
