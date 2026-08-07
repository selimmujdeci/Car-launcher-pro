package com.cockpitos.phonehub.companion

import com.cockpitos.phonehub.protocol.LinkErrorCode

/**
 * CompanionUiState — telefon uygulamasının ANA DURUMLARI (GÖREV 2).
 *
 * ── NEDEN AYRI BİR UI DURUMU ────────────────────────────────────────────────
 * Protokol tarafında zaten `LinkSession.State` var; ama o teknik bir durumdur
 * (HANDSHAKING, DEGRADED…). Kullanıcının görmesi gereken şey farklıdır:
 * "Bluetooth kapalı" ve "İzin gerekli" protokolün hiç haberi olmayan
 * durumlardır, çünkü daha bağlantı denenmemiştir bile. Bu enum o iki dünyayı
 * ayırır — teknik durum LAB'a, bu durum kullanıcıya gider.
 *
 * ── KANITSIZ İYİMSERLİK YOK ─────────────────────────────────────────────────
 * "Bağlandı" durumuna YALNIZ şifreli oturum gerçekten kurulduğunda geçilir.
 * Soketin açılmış olması, el sıkışmanın başlamış olması ya da kullanıcının
 * kodu onaylamış olması TEK BAŞINA yetmez.
 */
enum class CompanionUiState(val label: String, val detail: String) {

    BLUETOOTH_OFF(
        "Bluetooth Kapalı",
        "Bağlanmak için telefonun Bluetooth'unu açın."),

    PERMISSION_REQUIRED(
        "İzin Gerekli",
        "CAROS'a bağlanabilmek için Bluetooth izni gerekiyor."),

    PERMISSION_DENIED_PERMANENTLY(
        "İzin Reddedildi",
        "İzni sistem ayarlarından açmanız gerekiyor."),

    NO_PAIRED_CAROS(
        "Eşleştirilmiş CAROS Bulunamadı",
        "Önce telefonun Bluetooth ayarlarından CAROS cihazıyla eşleştirin."),

    SELECTING_DEVICE(
        "Cihaz Seçiliyor",
        "Eşleştirilmiş cihazlardan CAROS'u seçin."),

    CONNECTING(
        "Bağlanıyor",
        "CAROS ile bağlantı kuruluyor."),

    AUTHENTICATING(
        "Kimlik Doğrulanıyor",
        "Cihaz kimlikleri karşılıklı doğrulanıyor."),

    NEGOTIATING(
        "Protokol Görüşülüyor",
        "Sürüm ve yetenekler üzerinde anlaşılıyor."),

    AWAITING_CONFIRMATION(
        "Doğrulama Bekleniyor",
        "Ekrandaki kodun CAROS ekranındakiyle aynı olduğunu doğrulayın."),

    CONNECTED(
        "Bağlandı",
        "CAROS ile güvenli bağlantı kuruldu."),

    WEAK_CONNECTION(
        "Zayıf Bağlantı",
        "Bağlantı var ama yanıtlar gecikiyor."),

    RECONNECTING(
        "Yeniden Bağlanıyor",
        "Bağlantı koptu, yeniden deneniyor."),

    DISCONNECTED(
        "Bağlantı Kesildi",
        "CAROS ile bağlantı yok."),

    ERROR(
        "Hata",
        "Bağlantı kurulamadı.");

    /** Kullanıcı bu durumdayken "Bağlan" düğmesini görmeli mi. */
    fun canStartConnection(): Boolean = when (this) {
        SELECTING_DEVICE, DISCONNECTED, ERROR -> true
        else -> false
    }

    /** Kullanıcı bu durumdayken "Bağlantıyı Kes" düğmesini görmeli mi. */
    fun canDisconnect(): Boolean = when (this) {
        CONNECTING, AUTHENTICATING, NEGOTIATING, AWAITING_CONFIRMATION,
        CONNECTED, WEAK_CONNECTION, RECONNECTING -> true
        else -> false
    }
}

/**
 * Ekrana taşınan tam görünüm modeli.
 *
 * PII TAŞIMAZ: cihaz adı yalnız kullanıcının SEÇTİĞİ cihazı ayırt etmek için
 * BELLEKTE tutulur ve kalıcı kayda YAZILMAZ; MAC hiçbir yerde bulunmaz.
 */
data class CompanionView(
    val state: CompanionUiState,
    /** Kullanıcının onaylaması gereken kod — YALNIZ ekranda, loglanmaz. */
    val pairingCode: String? = null,
    val pairingExpiresAtMs: Long = -1L,
    val errorCode: LinkErrorCode? = null,
    val grantedCapabilityCount: Int = 0,
    val protocolVersion: Int = -1,
    val peerFingerprintShort: String? = null,
    val lastSeenAgeMs: Long = -1L,
    val reconnectAttempt: Int = 0,
    val foregroundServiceRunning: Boolean = false,
    val trustedPeerKnown: Boolean = false,
) {
    /** Kullanıcıya gösterilecek hata metni — teknik kod DEĞİL. */
    fun userMessage(): String = errorCode?.userMessage() ?: state.detail
}
