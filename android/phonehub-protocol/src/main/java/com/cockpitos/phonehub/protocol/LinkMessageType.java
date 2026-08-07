package com.cockpitos.phonehub.protocol;

/**
 * LinkMessageType — çerçeve yükünün İLK BAYTI (mesaj ayırıcı).
 *
 * ── NEDEN AYRI BİR BAYT, YÜKÜN İÇİNDE BİR ALAN DEĞİL ────────────────────────
 * El sıkışma yükleri İMZALANIR ve imza bit-bit aynılık ister. Tür bilgisini
 * yükün içine koymak, imzalanan baytları değiştirmek demektir; ayrı bir önek
 * baytı imzalanan gövdeyi olduğu gibi bırakır. Ayrıca uygulama mesajları
 * (TypeScript JSON zarfı) bu katman için OPAKTIR — türü yükün içinden
 * okumaya çalışmak, opaklığı bozardı.
 *
 * Bilinmeyen tür DÜŞÜRÜLÜR ama bağlantıyı ÖLDÜRMEZ: ileri sürümde eklenen bir
 * mesaj eski bir uçta sessizce yok sayılmalı, kopmaya yol açmamalıdır
 * ("taşınabilir ama çalıştırılmaz" — GÖREV 6).
 */
public final class LinkMessageType {

    public static final byte CLIENT_HELLO   = 0x01;
    public static final byte SERVER_HELLO   = 0x02;
    public static final byte CLIENT_AUTH    = 0x03;
    public static final byte CONFIRM        = 0x04;
    public static final byte CONFIRM_ACK    = 0x05;

    public static final byte HEARTBEAT      = 0x10;
    public static final byte HEARTBEAT_ACK  = 0x11;

    public static final byte APPLICATION    = 0x20;

    private LinkMessageType() { }

    /** Tür baytını yükün önüne ekler. */
    public static byte[] prefix(byte type, byte[] body) {
        byte[] b = body == null ? new byte[0] : body;
        byte[] out = new byte[b.length + 1];
        out[0] = type;
        System.arraycopy(b, 0, out, 1, b.length);
        return out;
    }

    /** Tür baytını okur; yük boşsa 0 döner (bilinmeyen olarak ele alınır). */
    public static byte typeOf(byte[] framed) {
        return (framed == null || framed.length == 0) ? 0 : framed[0];
    }

    /** Tür baytı ÇIKARILMIŞ gövde. */
    public static byte[] body(byte[] framed) {
        if (framed == null || framed.length <= 1) return new byte[0];
        byte[] out = new byte[framed.length - 1];
        System.arraycopy(framed, 1, out, 0, out.length);
        return out;
    }

    public static boolean isHandshake(byte type) {
        return type == CLIENT_HELLO || type == SERVER_HELLO || type == CLIENT_AUTH
            || type == CONFIRM || type == CONFIRM_ACK;
    }

    public static String label(byte type) {
        switch (type) {
            case CLIENT_HELLO:  return "CLIENT_HELLO";
            case SERVER_HELLO:  return "SERVER_HELLO";
            case CLIENT_AUTH:   return "CLIENT_AUTH";
            case CONFIRM:       return "CONFIRM";
            case CONFIRM_ACK:   return "CONFIRM_ACK";
            case HEARTBEAT:     return "HEARTBEAT";
            case HEARTBEAT_ACK: return "HEARTBEAT_ACK";
            case APPLICATION:   return "APPLICATION";
            default:            return "UNKNOWN";
        }
    }
}
