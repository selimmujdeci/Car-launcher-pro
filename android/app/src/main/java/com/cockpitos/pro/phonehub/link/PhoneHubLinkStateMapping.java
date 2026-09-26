package com.cockpitos.pro.phonehub.link;

import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.cockpitos.phonehub.protocol.LinkSession;

/**
 * PhoneHubLinkStateMapping — PHONE LINK F4.1 · native lifecycle geçişinin
 * KANONİK yansıması.
 *
 * ── YENİ LIFECYCLE AUTHORITY DEĞİL ──────────────────────────────────────────
 * Burada hiçbir durum ÜRETİLMEZ ve hiçbir geçiş KARARI verilmez. Gerçek durum
 * makinesi {@code LinkSession} içindedir ve tek sahibi
 * {@link PhoneHubLinkController}'dır. Bu sınıf yalnız o makinenin SEKİZ iç
 * durumunu, TS'in tüketebileceği ALTI kanonik yaşam döngüsü durumuna ÇEVİRİR.
 *
 * ── SAF VE ANDROID'SİZ ──────────────────────────────────────────────────────
 * Yalnız enum→enum eşlemesi. Bu sayede Android framework'ü olmadan, düz
 * JUnit'te sürülebilir (bkz. {@code PhoneHubLinkStateEventTest}) — cihaz
 * gerektiren yüzey büyümez.
 *
 * ── NEDEN "DEGRADED" KENDİ DURUMU ───────────────────────────────────────────
 * DEGRADED'ı ESTABLISHED'a katlamak İKİNCİ BİR GERÇEK üretirdi: TS'teki
 * kanonik {@code deriveUserState()} zaten DEGRADED oturumu WEAK → LINKED
 * sayar (ACTIVE DEĞİL). Kanonik event o hükümle ÇELİŞMEMELİDİR, bu yüzden
 * DEGRADED olduğu gibi taşınır ve yorumu TS'in mevcut otoritesine bırakılır.
 *
 * ── NEDEN "CLOSING" ZATEN DISCONNECTED ──────────────────────────────────────
 * FAIL-CLOSED: kapanış BAŞLADIĞI anda yetki düşmelidir. CLOSING'i "hâlâ
 * bağlı" saymak, kapanış ile temizlik arasında yetkili bir pencere bırakırdı.
 */
public final class PhoneHubLinkStateMapping {

    private PhoneHubLinkStateMapping() {}

    /** Kanonik yaşam döngüsü durumu — TS bu adları görür. */
    public enum LinkState {
        DISCONNECTED,
        CONNECTING,
        AUTHENTICATING,
        ESTABLISHED,
        DEGRADED,
        FAILED
    }

    /**
     * Geçişin SINIRLI gerekçe kategorisi. Serbest metin, güvenlik ayrıntısı,
     * exception mesajı veya stack trace TAŞIMAZ — yalnız bu sabit küme.
     */
    public enum LinkStateReason {
        USER_DISCONNECT,
        REMOTE_DISCONNECT,
        TRANSPORT_LOST,
        AUTH_FAILED,
        PROTOCOL_ERROR,
        SESSION_REPLACED,
        LIFECYCLE_STOP,
        UNKNOWN
    }

    /** {@code LinkSession.State} → kanonik durum. Tam ve dallanmasız. */
    public static LinkState toLinkState(LinkSession.State state) {
        if (state == null) return LinkState.DISCONNECTED;
        switch (state) {
            case HANDSHAKING:            return LinkState.CONNECTING;
            case AWAITING_USER_CONFIRM:  return LinkState.AUTHENTICATING;
            case CONNECTED:              return LinkState.ESTABLISHED;
            case DEGRADED:               return LinkState.DEGRADED;
            case FAILED:                 return LinkState.FAILED;
            /* IDLE / CLOSING / CLOSED: oturum yok ya da kapanıyor →
             * yetki DERHAL düşmeli (fail-closed, bkz. dosya üstü not). */
            case IDLE:
            case CLOSING:
            case CLOSED:
            default:                     return LinkState.DISCONNECTED;
        }
    }

    /** Bu durumda yetki verilebilir mi — TS'in hükmüyle AYNI eşik. */
    public static boolean isAuthoritativeState(LinkState state) {
        return state == LinkState.ESTABLISHED;
    }

    /**
     * {@code LinkErrorCode} → sınırlı gerekçe kategorisi.
     *
     * Hata kodunun KENDİSİ taşınmaz: kodlar (ör. {@code DECRYPTION_FAILED},
     * {@code REPLAY_REJECTED}) saldırgana güvenlik katmanının iç davranışını
     * anlatır. TS'in ihtiyacı olan tek şey "hangi kategori" bilgisidir.
     */
    public static LinkStateReason toReason(LinkErrorCode code) {
        if (code == null) return LinkStateReason.UNKNOWN;
        switch (code) {
            case SOCKET_CLOSED:
                return LinkStateReason.REMOTE_DISCONNECT;

            case READ_FAILED:
            case WRITE_FAILED:
            case HEARTBEAT_TIMEOUT:
            case RECONNECT_EXHAUSTED:
            case CLIENT_CONNECT_TIMEOUT:
            case CLIENT_CONNECT_FAILED:
            case SERVER_ACCEPT_FAILED:
                return LinkStateReason.TRANSPORT_LOST;

            case DECRYPTION_FAILED:
            case REPLAY_REJECTED:
            case PAIRING_REQUIRED:
            case PAIRING_CODE_EXPIRED:
            case PAIRING_REJECTED:
            case TRUSTED_PEER_MISMATCH:
            case SECURITY_NOT_IMPLEMENTED:
                return LinkStateReason.AUTH_FAILED;

            case FRAME_TOO_LARGE:
            case FRAME_MALFORMED:
            case CHECKSUM_FAILED:
            case PROTOCOL_VERSION_MISMATCH:
            case CAPABILITY_NEGOTIATION_FAILED:
                return LinkStateReason.PROTOCOL_ERROR;

            case TRANSPORT_DISPOSED:
                return LinkStateReason.LIFECYCLE_STOP;

            /* Bayat nesil: oturum yenisiyle değiştirildi. */
            case SESSION_GENERATION_STALE:
                return LinkStateReason.SESSION_REPLACED;

            case SERVER_LISTEN_FAILED:
            case FOREGROUND_SERVICE_FAILED:
            case BLUETOOTH_UNAVAILABLE:
            case BLUETOOTH_DISABLED:
            case BLUETOOTH_PERMISSION_REQUIRED:
            case BLUETOOTH_PERMISSION_DENIED:
            case NO_BONDED_DEVICE:
            case DEVICE_NOT_SELECTED:
                return LinkStateReason.LIFECYCLE_STOP;

            /* Bu ikisi GERÇEKTEN sınıflandırılamaz — dürüstçe UNKNOWN
             * kalır; uydurma bir kategori ÜRETİLMEZ. */
            case FIELD_TEST_REQUIRED:
            case UNKNOWN_ERROR:
            default:
                return LinkStateReason.UNKNOWN;
        }
    }
}
