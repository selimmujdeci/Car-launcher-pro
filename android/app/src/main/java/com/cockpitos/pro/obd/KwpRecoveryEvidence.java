package com.cockpitos.pro.obd;

/**
 * KwpRecoveryEvidence — KWP ölü-oturum kurtarmasının OTURUMLUK, BOUNDED kanıtı
 * (yalnız gözlemlenebilirlik + tavan; ATPC kararının KENDİSİ ElmProtocol'de kalır).
 *
 * KÖK PROBLEM (saha 2026-07-17, Trafic/KWP): {@link ElmProtocol#noteKwpSessionHealth}
 * ardışık çekirdek NO_DATA görünce ATPC gönderiyordu, ama DIŞARIDAN TAMAMEN GÖRÜNMEZDİ.
 * Tanı raporunda yalnız "OBD_DATA_GATE_TIMEOUT" vardı; şu sorular CEVAPSIZDI:
 *   · kurtarma DENENDİ Mİ, kaç kez?
 *   · ATPC'den sonra veri GERİ GELDİ Mİ (ve kaç ms'de)?
 *   · yoksa Data Gate, kurtarma sürerken bağlantıyı mı YIKTI?
 * Ölçmeden düzeltmek = kör atış. Bu sınıf o körlüğü kapatır.
 *
 * NE YAPMAZ: eşik/Data Gate süresi/CAN kurtarma davranışına DOKUNMAZ. Tek davranışsal
 * ek: oturum başına kurtarma TAVANI ({@link #MAX_RECOVERIES_PER_SESSION}) — eskiden
 * sınırsızdı (her 4 NO_DATA'da sonsuza dek ATPC).
 *
 * EŞ ZAMANLILIK: yazan TEK thread (cmdQueue — noteKwpSessionHealth oradan çağrılır);
 * okuyan Capacitor plugin thread'i ({@link #snapshot()}). Tüm erişim tek {@code lock}
 * altında serileştirilir; okuma NADİR (yalnız "Tanı Gönder") → poll thread'i beklemez.
 *
 * SINIRLAR: sayaçlar saturating int; ham yanıt/log SAKLANMAZ (yalnız sayaç + son durum) —
 * PII-güvenli ve Malı-400 dostu. Android bağımlılığı YOK → JUnit ile saf test edilebilir.
 */
public final class KwpRecoveryEvidence {

    /** Süreç-genişliği tekil — ExtendedPollEvidence ile aynı desen. */
    public static final KwpRecoveryEvidence INSTANCE = new KwpRecoveryEvidence();

    /** Bir bağlantı oturumunda uygulanacak EN FAZLA kurtarma. Aşılırsa ATPC GÖNDERİLMEZ. */
    public static final int MAX_RECOVERIES_PER_SESSION = 3;

    /** Kurtarma akışının son durumu. */
    public enum Status {
        /** Bu oturumda hiç kurtarma tetiklenmedi (KWP değil VEYA oturum sağlıklı). */
        NOT_ATTEMPTED,
        /** ATPC gönderildi, ilk geçerli PID HENÜZ gelmedi. */
        IN_PROGRESS,
        /** ATPC sonrası geçerli PID GELDİ → oturum dirildi. */
        RECOVERED,
        /** ATPC sonrası veri dönmedi (yeni kurtarma gerekti / tavan doldu / gate yıktı). */
        FAILED,
    }

    private final Object lock = new Object();

    /** Şu anki ardışık çekirdek NO_DATA sayısı (eşiğe doğru sayan). */
    private int coreNoDataStreak;
    /** Oturum boyunca görülen EN YÜKSEK ardışık NO_DATA — eşiğe yaklaşıldı mı görünsün. */
    private int maxCoreNoDataStreak;
    /** Kurtarma kaç kez TETİKLENDİ (ATPC gönderildi). */
    private int recoveryCount;
    /** Tavan dolduğu için ATPC'nin GÖNDERİLMEDİĞİ kez. */
    private int suppressedCount;
    /** ATPC gönderme hatası (channel.send throw etti). */
    private int atpcSendFailures;
    /** Son kurtarma tetik zamanı (epoch ms); 0 = hiç. */
    private long lastRecoveryAt;
    /** Son BAŞARILI kurtarmada ATPC→ilk geçerli PID süresi (ms); -1 = ölçülmedi. */
    private long lastRecoveryToFirstPidMs = -1;
    /** Data Gate, kurtarma IN_PROGRESS iken bağlantıyı kaç kez yıktı. */
    private int killedByDataGate;
    private Status status = Status.NOT_ATTEMPTED;
    /** Kurtarma tetiklendiğindeki aktif protokol ("5"/"4"/"3"); null = hiç. */
    private String protocolAtRecovery;

    private KwpRecoveryEvidence() { }

    /** Saturating artış — sayaç taşmaz (bounded telemetri). */
    private static int sat(int v) { return v >= 1_000_000 ? v : v + 1; }

    /** Yeni bağlantı = yeni oturum → oturum sayaçları temizlenir. */
    public void reset() {
        synchronized (lock) {
            coreNoDataStreak = 0;
            maxCoreNoDataStreak = 0;
            recoveryCount = 0;
            suppressedCount = 0;
            atpcSendFailures = 0;
            lastRecoveryAt = 0;
            lastRecoveryToFirstPidMs = -1;
            killedByDataGate = 0;
            status = Status.NOT_ATTEMPTED;
            protocolAtRecovery = null;
        }
    }

    /**
     * Çekirdek Mode-01 yanıtı GEÇERLİ geldi (OK).
     * Kurtarma sürüyorduysa ({@link Status#IN_PROGRESS}) → RECOVERED + süre ölçülür.
     *
     * @param nowMs epoch ms (enjekte edilebilir — test determinizmi)
     */
    public void noteCoreOk(long nowMs) {
        synchronized (lock) {
            coreNoDataStreak = 0;
            if (status == Status.IN_PROGRESS) {
                status = Status.RECOVERED;
                lastRecoveryToFirstPidMs = lastRecoveryAt > 0 ? Math.max(0, nowMs - lastRecoveryAt) : -1;
            }
        }
    }

    /** Çekirdek Mode-01 yanıtı NO_DATA geldi → ardışık sayaç ilerler. */
    public void noteCoreNoData() {
        synchronized (lock) {
            coreNoDataStreak++;
            if (coreNoDataStreak > maxCoreNoDataStreak) maxCoreNoDataStreak = coreNoDataStreak;
        }
    }

    /**
     * Eşik doldu — kurtarma UYGULANMALI MI? Tavan kontrolü BURADADIR (tek karar noktası).
     *
     * @return true = ATPC gönder (sayaçlar tetiklenmiş sayılır) · false = tavan doldu, GÖNDERME
     */
    public boolean shouldAttemptRecovery(long nowMs, String activeProtocol) {
        synchronized (lock) {
            coreNoDataStreak = 0; // eşik tüketildi (davranış: eski kodla aynı)
            if (recoveryCount >= MAX_RECOVERIES_PER_SESSION) {
                suppressedCount = sat(suppressedCount);
                // Tavan dolduysa oturum kurtarılamamış demektir — IN_PROGRESS'te asılı kalma.
                if (status == Status.IN_PROGRESS) status = Status.FAILED;
                return false;
            }
            // Önceki kurtarma hâlâ IN_PROGRESS iken YENİ eşik doldu → öncekisi İŞE YARAMADI.
            if (status == Status.IN_PROGRESS) status = Status.FAILED;
            recoveryCount = sat(recoveryCount);
            lastRecoveryAt = nowMs;
            lastRecoveryToFirstPidMs = -1;
            protocolAtRecovery = activeProtocol;
            status = Status.IN_PROGRESS;
            return true;
        }
    }

    /** ATPC gönderimi başarısız oldu (channel hatası) — fail-soft, sonraki eşikte tekrar denenir. */
    public void noteAtpcSendFailed() {
        synchronized (lock) {
            atpcSendFailures = sat(atpcSendFailures);
            status = Status.FAILED;
        }
    }

    /**
     * JS Data Gate bağlantıyı yıktı. Kurtarma IN_PROGRESS idiyse: ATPC'ye veri döndürme
     * ŞANSI TANINMADAN oturum kapatıldı demektir — sahadaki en kritik hipotez.
     * Data Gate NATIVE'in bilmediği bir JS kavramıdır → JS köprüden bildirir.
     */
    public void noteDataGateTeardown() {
        synchronized (lock) {
            if (status == Status.IN_PROGRESS) {
                killedByDataGate = sat(killedByDataGate);
                status = Status.FAILED;
            }
        }
    }

    /** Değişmez kanıt görüntüsü. */
    public static final class Snapshot {
        public final int coreNoDataStreak;
        public final int maxCoreNoDataStreak;
        public final int recoveryCount;
        public final int suppressedCount;
        public final int atpcSendFailures;
        public final long lastRecoveryAt;
        public final long lastRecoveryToFirstPidMs;
        public final int killedByDataGate;
        public final String status;
        public final String protocolAtRecovery;
        public final int threshold;
        public final int maxPerSession;

        Snapshot(int streak, int maxStreak, int recoveries, int suppressed, int atpcFails,
                 long lastAt, long toFirstPid, int gateKills, String st, String proto) {
            this.coreNoDataStreak = streak;
            this.maxCoreNoDataStreak = maxStreak;
            this.recoveryCount = recoveries;
            this.suppressedCount = suppressed;
            this.atpcSendFailures = atpcFails;
            this.lastRecoveryAt = lastAt;
            this.lastRecoveryToFirstPidMs = toFirstPid;
            this.killedByDataGate = gateKills;
            this.status = st;
            this.protocolAtRecovery = proto;
            this.threshold = ElmProtocol.KWP_DEAD_SESSION_THRESHOLD;
            this.maxPerSession = MAX_RECOVERIES_PER_SESSION;
        }
    }

    public Snapshot snapshot() {
        synchronized (lock) {
            return new Snapshot(coreNoDataStreak, maxCoreNoDataStreak, recoveryCount,
                suppressedCount, atpcSendFailures, lastRecoveryAt, lastRecoveryToFirstPidMs,
                killedByDataGate, status.name(), protocolAtRecovery);
        }
    }
}
