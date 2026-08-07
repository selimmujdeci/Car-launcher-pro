package com.cockpitos.phonehub.protocol;

import java.util.Collections;
import java.util.List;

/**
 * LinkSessionSnapshot — CAROS LAB'ın okuduğu SALT-OKUNUR anlık görüntü
 * (GÖREV 14'ün veri sözleşmesi).
 *
 * ── KANITSIZ BİLGİ ÜRETİLMEZ ────────────────────────────────────────────────
 * Bilinmeyen süre alanları {@code -1} taşır, {@code 0} DEĞİL. "0 ms" ölçülmüş
 * bir değer gibi okunur ve yanıltır; {@code -1} açıkça "ölçülmedi" demektir ve
 * ekranda BİLİNMİYOR olarak gösterilir. Aynı biçimde bilinmeyen metin alanları
 * {@code null}'dır, boş dize değil.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Burada MAC · cihaz adı · telefon numarası · ham açık anahtar · ham yük ·
 * oturum anahtarı · doğrulama kodu YOKTUR ve eklenemez (testle kilitli).
 * {@code peerFingerprint} geri çevrilemez bir özettir ve kimlik DOĞRULAMA
 * için değil, "aynı cihaz mı" karşılaştırması için taşınır.
 */
public final class LinkSessionSnapshot {

    /* Kimlik ve durum */
    public long generation;
    public String state;
    public boolean serverSide;
    public String handshakeStage;
    public boolean awaitingUserConfirm;
    public boolean trustSkipped;
    public boolean disposed;

    /* Zamanlama — bilinmiyorsa -1 */
    public long startedAtMs;
    public long establishedAtMs;
    public long negotiationDurationMs = -1L;
    public long lastInboundAgeMs = -1L;

    /* Anlaşma */
    public int protocolVersion;
    public String peerFingerprint;
    public String peerAppVersion;
    public List<String> grantedCapabilities = Collections.emptyList();

    /* Kalp atışı */
    public long heartbeatsSent;
    public long heartbeatsReceived;

    /* Sayaçlar */
    public long framesSent;
    public long framesReceived;
    public long bytesSent;
    public long bytesReceived;
    public long appMessagesReceived;

    /* Kuyruk */
    public int writeQueueDepth;
    public int writeQueueCapacity;
    public long writeQueueRejections;

    /* Çerçeve arızaları */
    public long checksumFailures;
    public long malformedFrames;
    public long oversizeRejections;
    public long resyncEvents;
    public long unknownTypeDropped;

    /* Güvenlik */
    public long decryptFailures;
    public long replayRejections;
    public boolean encryptionActive;

    /* İş parçacığı yaşam döngüsü */
    public boolean readerAlive;
    public boolean writerAlive;

    /* Hata */
    public String lastErrorCode;
    public String disconnectReasonCode;

    /* Tanı defteri */
    public int diagnosticEventCount;
    public long diagnosticDropped;

    /**
     * Şifreleme gerçekten kurulu mu — ekranın "bağlandı" demesi için TEK
     * kabul edilebilir ölçüt. Soketin açık olması yeterli DEĞİLDİR.
     */
    public boolean isTrulyEstablished() {
        return "CONNECTED".equals(state) || "DEGRADED".equals(state)
            ? encryptionActive : false;
    }
}
