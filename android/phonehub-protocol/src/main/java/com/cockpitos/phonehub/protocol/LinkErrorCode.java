package com.cockpitos.phonehub.protocol;

/**
 * LinkErrorCode — Phone Hub bağlantısının KARARLI hata sözlüğü (GÖREV 15).
 *
 * ── NEDEN SERBEST METİN DEĞİL ───────────────────────────────────────────────
 * Sahada bir arıza ancak SABİT bir kodla karşılaştırılabilir. Serbest exception
 * metni cihazdan cihaza (ve Android sürümünden sürüme) değişir, PII sızdırabilir
 * ve kütükte "aynı hata mı" sorusunu cevaplayamaz hâle getirir. Bu yüzden her
 * arıza tam olarak BİR koda düşer; kod bilinmiyorsa {@link #UNKNOWN_ERROR}
 * kullanılır ve "başarılı" DAVRANILMAZ.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Kodun kendisi PII taşımaz. Ham exception metni bu sınıfa GİRMEZ; yalnız
 * ayıklanmış (sanitize edilmiş) ayrıntı ayrı alanda ve yalnız debug logunda
 * taşınır (GÖREV 16).
 *
 * ── FIELD_TEST_REQUIRED ─────────────────────────────────────────────────────
 * Bu bir arıza DEĞİLDİR: "bu şey ancak gerçek araçta/head unit'te ölçülebilir"
 * demektir. Kodun kendisi bir kanıt boşluğunu görünür kılar; sessizce
 * "sağlıklı" varsaymayı engeller.
 */
public enum LinkErrorCode {

    /* ── Bluetooth ortamı ─────────────────────────────────────────────── */
    BLUETOOTH_UNAVAILABLE("Bu cihazda Bluetooth yok"),
    BLUETOOTH_DISABLED("Bluetooth kapalı"),
    BLUETOOTH_PERMISSION_REQUIRED("Bluetooth izni gerekli"),
    BLUETOOTH_PERMISSION_DENIED("Bluetooth izni reddedildi"),
    NO_BONDED_DEVICE("Eşleştirilmiş cihaz yok"),
    DEVICE_NOT_SELECTED("Cihaz seçilmedi"),

    /* ── Sunucu (head unit) ───────────────────────────────────────────── */
    SERVER_LISTEN_FAILED("Sunucu dinlemeye başlayamadı"),
    SERVER_ACCEPT_FAILED("Gelen bağlantı kabul edilemedi"),

    /* ── İstemci (telefon) ────────────────────────────────────────────── */
    CLIENT_CONNECT_TIMEOUT("Bağlantı zaman aşımına uğradı"),
    CLIENT_CONNECT_FAILED("Bağlantı kurulamadı"),

    /* ── Soket / akış ─────────────────────────────────────────────────── */
    SOCKET_CLOSED("Bağlantı kapandı"),
    READ_FAILED("Veri okunamadı"),
    WRITE_FAILED("Veri gönderilemedi"),

    /* ── Çerçeveleme ──────────────────────────────────────────────────── */
    FRAME_TOO_LARGE("Çerçeve tavanı aşıldı"),
    FRAME_MALFORMED("Çerçeve bozuk"),
    CHECKSUM_FAILED("Sağlama toplamı tutmadı"),

    /* ── Güvenlik ─────────────────────────────────────────────────────── */
    DECRYPTION_FAILED("Şifre çözülemedi"),
    REPLAY_REJECTED("Tekrar saldırısı reddedildi"),
    SECURITY_NOT_IMPLEMENTED("Güvenlik katmanı bu derlemede uygulanmadı"),

    /* ── Eşleştirme ve güven ──────────────────────────────────────────── */
    PAIRING_REQUIRED("Eşleştirme onayı gerekli"),
    PAIRING_CODE_EXPIRED("Doğrulama kodu süresi doldu"),
    PAIRING_REJECTED("Eşleştirme reddedildi"),
    TRUSTED_PEER_MISMATCH("Güvenilen cihaz kimliği uyuşmuyor"),

    /* ── Anlaşma ──────────────────────────────────────────────────────── */
    PROTOCOL_VERSION_MISMATCH("Protokol sürümü uyuşmuyor"),
    CAPABILITY_NEGOTIATION_FAILED("Yetenek anlaşması başarısız"),

    /* ── Yaşam döngüsü ────────────────────────────────────────────────── */
    HEARTBEAT_TIMEOUT("Kalp atışı alınamadı"),
    RECONNECT_EXHAUSTED("Yeniden bağlanma denemeleri tükendi"),
    FOREGROUND_SERVICE_FAILED("Ön plan servisi başlatılamadı"),
    TRANSPORT_DISPOSED("Taşıma kapatılmış"),
    SESSION_GENERATION_STALE("Bayat oturum nesli reddedildi"),

    /* ── Kanıt boşluğu (arıza DEĞİL) ──────────────────────────────────── */
    FIELD_TEST_REQUIRED("Gerçek araç/head unit ölçümü gerekli"),

    /* ── Son çare ─────────────────────────────────────────────────────── */
    UNKNOWN_ERROR("Bilinmeyen hata");

    private final String userMessage;

    LinkErrorCode(String userMessage) {
        this.userMessage = userMessage;
    }

    /** Kullanıcıya gösterilebilir, teknik olmayan Türkçe mesaj. */
    public String userMessage() {
        return userMessage;
    }

    /**
     * Bu hata sonrası otomatik yeniden bağlanma DENENMELİ mi?
     *
     * Fail-closed: yalnız GEÇİCİ olduğu kanıtlanabilir arızalar true döner.
     * İzin, protokol, güven ve kullanıcı kararı içeren hatalar ASLA yeniden
     * denenmez — yoksa kullanıcı reddettiği bir şeyi sürekli geri isteyen bir
     * uygulama ile karşılaşır ve pil tükenir.
     */
    public boolean isReconnectable() {
        switch (this) {
            case SOCKET_CLOSED:
            case READ_FAILED:
            case WRITE_FAILED:
            case CLIENT_CONNECT_TIMEOUT:
            case CLIENT_CONNECT_FAILED:
            case SERVER_ACCEPT_FAILED:
            case HEARTBEAT_TIMEOUT:
                return true;
            default:
                return false;
        }
    }

    /** Güvenlik olayı mı — art arda görülmesi oturumu kapatmalıdır. */
    public boolean isSecurityEvent() {
        switch (this) {
            case DECRYPTION_FAILED:
            case REPLAY_REJECTED:
            case TRUSTED_PEER_MISMATCH:
            case CHECKSUM_FAILED:
                return true;
            default:
                return false;
        }
    }

    /** Bilinmeyen/boş girdi UNKNOWN_ERROR'a düşer; ASLA throw etmez. */
    public static LinkErrorCode fromName(String name) {
        if (name == null || name.isEmpty()) return UNKNOWN_ERROR;
        for (LinkErrorCode c : values()) {
            if (c.name().equals(name)) return c;
        }
        return UNKNOWN_ERROR;
    }
}
