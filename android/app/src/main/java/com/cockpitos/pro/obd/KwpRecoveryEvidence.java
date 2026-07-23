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

    /**
     * ARDIŞIK BAŞARISIZ kurtarma tavanı. Aşılırsa ATPC GÖNDERİLMEZ (ölü ECU'da sonsuz tur yok).
     *
     * ⚠️ P0 SAHA 2026-07-23 — ANLAM DEĞİŞTİ (kusur düzeltmesi): eskiden bu tavan
     * OTURUM BAŞINA TOPLAM kurtarmayı sınırlıyordu ve {@code recoveryCount} yalnız
     * {@link #reset()} (yeni bağlantı) ile sıfırlanıyordu — BAŞARILI kurtarma bile
     * tavanı geri vermiyordu. Sonuç: KWP oturumu ~dakikada bir ölen bir araçta
     * (Trafic) 3 kurtarmadan sonra motor kalıcı olarak SUSUYOR → veri bir daha
     * akmıyor, yalnız adaptörün fiziksel power-cycle'ı (yeni oturum → reset) düzeltiyor.
     * Bu, kullanıcının "1 dakika sonra tekrar donuyor, sürekli tekrarlanıyor"
     * belirtisinin ikinci nedenidir.
     *
     * DOĞRU SEMANTİK (devre kesici): BAŞARI seriyi SIFIRLAR, yalnız ARDIŞIK
     * BAŞARISIZLIK tavanı doldurur. Böylece hem sonsuz döngü önlenir (ölü ECU'da 3
     * denemede durur) hem 20 dakikalık sürüşte çalışan kurtarma tükenmez.
     */
    public static final int MAX_RECOVERIES_PER_SESSION = 3;

    /**
     * Kaç ardışık BAŞARISIZ ATPC'den sonra GÜÇLÜ kurtarmaya (ATWS+reinit) yükseltilir.
     *
     * ⚠️ P0 SAHA 2026-07-23 (Trafic/KWP "veri ~1 dk sonra tekrar bayat"): saha kanıtı
     * ATPC (Protocol Close) tek başına K-line oturumunu HER ZAMAN diriltmiyor. ATPC
     * ELM327'ye "protokolü bir sonraki istekte yeniden kur" der; ama bazı KWP ECU'ları
     * (Trafic) yalnız protokol resetiyle uyanmıyor, tam ELM warm-start + init dizisi
     * (ATWS + ATSP + 0100) gerekiyor. Eskiden merdiven yoktu: ATPC başarısız olsa bile
     * hep ATPC deneniyor, hiç yükselmiyordu → oturum bayat kalıyordu.
     *
     * MERDİVEN: ATPC (hafif/hızlı) → [bu eşikten sonra] ATWS+reinit (güçlü) → tavan → dur.
     * 1 = ATPC bir şans alır, sonra güce geçilir (bayat kalma süresi kısa).
     */
    public static final int REINIT_AFTER_FAILURES = 1;

    /** Eşik dolunca uygulanacak kurtarma SEVİYESİ (tek karar noktası). */
    public enum RecoveryAction {
        /** Tavan doldu / oturum sağlıklı → hiçbir şey gönderme. */
        NONE,
        /** Hafif: ATPC (Protocol Close) — ELM327 bir sonraki istekte protokolü tazeler. */
        PROTOCOL_CLOSE,
        /** Güçlü: ATWS + tam init (öğrenilmiş protokol korunur) — ATPC yetmediğinde. */
        REINIT,
    }

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
    /** Kurtarma kaç kez TETİKLENDİ (ATPC gönderildi) — oturum toplamı, RAPOR içindir. */
    private int recoveryCount;
    /**
     * ARDIŞIK BAŞARISIZ kurtarma sayısı — TAVAN KARARI BUNA BAKAR (recoveryCount'a DEĞİL).
     * Veri geri geldiğinde ({@link #noteCoreOk}) SIFIRLANIR.
     */
    private int consecutiveFailedRecoveries;
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
            consecutiveFailedRecoveries = 0;
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
                // Kurtarma İŞE YARADI → ardışık başarısızlık serisi kırılır, tavan tazelenir.
                // (Tavan "çalışan kurtarmayı" değil, "ölü ECU'da sonsuz turu" engellemek içindir.)
                consecutiveFailedRecoveries = 0;
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
     * Eşik doldu — HANGİ kurtarma seviyesi uygulanmalı? Tavan + MERDİVEN kararı BURADADIR
     * (tek karar noktası). {@code NONE} dışında bir sonuç döndüğünde sayaçlar "tetiklendi"
     * sayılır (recoveryCount++/status=IN_PROGRESS) — çağıran komutu göndermekle yükümlüdür.
     *
     * MERDİVEN: ilk ardışık başarısızlıklarda ATPC (hafif); {@link #REINIT_AFTER_FAILURES}
     * aşılınca ATWS+reinit (güçlü); {@link #MAX_RECOVERIES_PER_SESSION} aşılınca dur.
     */
    public RecoveryAction nextRecoveryAction(long nowMs, String activeProtocol) {
        synchronized (lock) {
            coreNoDataStreak = 0; // eşik tüketildi
            // Önceki kurtarma hâlâ IN_PROGRESS iken YENİ eşik doldu → öncekisi İŞE YARAMADI.
            // Tavan/merdiven kararından ÖNCE sayılır ki seviye doğru seçilsin.
            if (status == Status.IN_PROGRESS) {
                status = Status.FAILED;
                consecutiveFailedRecoveries = sat(consecutiveFailedRecoveries);
            }
            // TAVAN: toplam kurtarmaya DEĞİL, ARDIŞIK BAŞARISIZ kurtarmaya bakar. Veri bir kez
            // geri geldiyse (noteCoreOk → seri sıfır) motor uzun sürüşte tükenmez.
            if (consecutiveFailedRecoveries >= MAX_RECOVERIES_PER_SESSION) {
                suppressedCount = sat(suppressedCount);
                return RecoveryAction.NONE;
            }
            recoveryCount = sat(recoveryCount);
            lastRecoveryAt = nowMs;
            lastRecoveryToFirstPidMs = -1;
            protocolAtRecovery = activeProtocol;
            status = Status.IN_PROGRESS;
            // MERDİVEN: ATPC birkaç kez başarısızsa güçlü kurtarmaya (reinit) yüksel.
            return consecutiveFailedRecoveries >= REINIT_AFTER_FAILURES
                ? RecoveryAction.REINIT
                : RecoveryAction.PROTOCOL_CLOSE;
        }
    }

    /**
     * Geriye dönük uyumlu boolean sarmalayıcı (eski çağıranlar/testler). Merdiveni
     * {@link #nextRecoveryAction} yönetir; burada yalnız "bir şey yapılmalı mı" sorulur.
     * ⚠️ Durum mutasyonludur → çağrı başına BİR KEZ çağrılmalı (nextRecoveryAction ile
     * BİRLİKTE değil).
     */
    public boolean shouldAttemptRecovery(long nowMs, String activeProtocol) {
        return nextRecoveryAction(nowMs, activeProtocol) != RecoveryAction.NONE;
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
