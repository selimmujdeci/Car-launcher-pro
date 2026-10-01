package com.cockpitos.pro.phonehub.link;

import java.nio.charset.StandardCharsets;

/**
 * LanBeacon — araç ünitesinin yerel ağdaki "buradayım" duyurusu (SAF).
 *
 * Biçim (ASCII, tek satır, ≤ {@link #MAX_BYTES}):
 * <pre>CAROSHUB 1 &lt;tcpPort&gt; &lt;kimlikİpucu&gt;</pre>
 *
 * Kimlik ipucu, aracın kimlik parmak izinin İLK 8 karakteridir (gizli değil;
 * zaten el sıkışmada açık anahtar olarak gider). Telefon, daha önce güvendiği
 * aracı aynı ağda birden çok CarOS varsa öne alabilsin diye vardır — GÜVEN
 * ÜRETMEZ: bağlantı yine imzalı el sıkışmadan ve kullanıcı onayından geçer.
 * Beacon'da sır, cihaz adı, MAC ya da IP listesi YOKTUR.
 */
public final class LanBeacon {

    private LanBeacon() { }

    /** Beacon UDP portu (telefon bu porttan dinler). */
    public static final int UDP_PORT = 47653;
    public static final String MAGIC = "CAROSHUB";
    public static final int VERSION = 1;
    public static final int MAX_BYTES = 64;
    public static final int ID_HINT_CHARS = 8;
    /** İpucu bilinmiyorsa yazılan yer tutucu. */
    public static final String NO_HINT = "-";

    public static final class Parsed {
        public final int tcpPort;
        public final String idHint;
        Parsed(int tcpPort, String idHint) { this.tcpPort = tcpPort; this.idHint = idHint; }
    }

    /** Parmak izinden ipucu (8 küçük harf onaltılık) ya da {@link #NO_HINT}. */
    public static String hintOf(String fingerprint) {
        if (fingerprint == null) return NO_HINT;
        String f = fingerprint.trim().toLowerCase(java.util.Locale.ROOT);
        if (f.length() < ID_HINT_CHARS || !isHex(f.substring(0, ID_HINT_CHARS))) return NO_HINT;
        return f.substring(0, ID_HINT_CHARS);
    }

    public static byte[] encode(int tcpPort, String idHint) {
        if (tcpPort < 1 || tcpPort > 65535) throw new IllegalArgumentException("port");
        String hint = idHint == null || !(NO_HINT.equals(idHint) || isHintShape(idHint)) ? NO_HINT : idHint;
        return (MAGIC + " " + VERSION + " " + tcpPort + " " + hint).getBytes(StandardCharsets.US_ASCII);
    }

    /** Geçersiz/yabancı paket için {@code null} — tahmin YOK. */
    public static Parsed parse(byte[] data, int length) {
        if (data == null || length <= 0 || length > MAX_BYTES || length > data.length) return null;
        String s = new String(data, 0, length, StandardCharsets.US_ASCII);
        String[] p = s.split(" ");
        if (p.length != 4 || !MAGIC.equals(p[0])) return null;
        if (!String.valueOf(VERSION).equals(p[1])) return null;
        int port;
        try {
            port = Integer.parseInt(p[2]);
        } catch (NumberFormatException e) {
            return null;
        }
        if (port < 1 || port > 65535) return null;
        String hint = p[3];
        if (!NO_HINT.equals(hint) && !isHintShape(hint)) return null;
        return new Parsed(port, hint);
    }

    private static boolean isHintShape(String h) {
        return h.length() == ID_HINT_CHARS && isHex(h);
    }

    private static boolean isHex(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            boolean ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            if (!ok) return false;
        }
        return true;
    }
}
