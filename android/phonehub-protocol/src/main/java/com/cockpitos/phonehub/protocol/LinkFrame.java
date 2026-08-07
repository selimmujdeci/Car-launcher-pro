package com.cockpitos.phonehub.protocol;

import java.util.Arrays;

/**
 * LinkFrame — RFCOMM byte-stream üzerindeki TEK çerçeve (GÖREV 6).
 *
 * ── NEDEN SATIR SONU (newline) İLE AYIRMIYORUZ ──────────────────────────────
 * RFCOMM bir SPP akışıdır: TCP gibi mesaj sınırı YOKTUR. Ham JSON'u '\n' ile
 * ayırmak iki nedenle kırılgandır: (a) yükün içindeki bir '\n' sınırı bozar,
 * (b) şifreli yük ikili veridir ve '\n' baytı doğal olarak geçebilir. Bu yüzden
 * uzunluk-önekli, sağlamalı, sürümlü ikili çerçeveleme kullanılır.
 *
 * ── TEL ÜZERİNDEKİ DÜZEN (big-endian) ───────────────────────────────────────
 * <pre>
 *  ofset  boyut  alan
 *   0      4     magic           'C','P','H','1'
 *   4      1     framingVersion  (bu derlemede 1)
 *   5      1     flags           bit0=ŞİFRELİ · bit1=ACK_İSTENİYOR · diğerleri ayrılmış
 *   6      2     headerLength    genişletilmiş başlık uzunluğu (şifreliyse 12 = nonce)
 *   8      4     payloadLength   tel üzerindeki yük uzunluğu (şifreliyse ciphertext+tag)
 *  12      8     messageId       yön başına monoton artan sayaç
 *  20      4     checksum        CRC32(genişletilmiş başlık ‖ yük)
 *  24    var     genişletilmiş başlık (headerLength bayt)
 *  ..    var     yük (payloadLength bayt)
 * </pre>
 *
 * ── AAD SEÇİMİ (AES-GCM için) ───────────────────────────────────────────────
 * AAD = ilk 20 bayt (magic…messageId) ‖ genişletilmiş başlık. `checksum` alanı
 * AAD'ye DAHİL DEĞİLDİR ve olamaz: sağlama şifreli yükten hesaplanır, yük ise
 * AAD'ye bağlıdır — dahil edilseydi döngüsel bağımlılık oluşurdu. Sağlamanın
 * kurcalanması zaten GCM etiketiyle yakalanır; CRC32 yalnız hat gürültüsünü
 * UCUZCA eler, güvenlik iddiası TAŞIMAZ.
 */
public final class LinkFrame {

    /* ── Sabitler ─────────────────────────────────────────────────────── */

    /** 'C','P','H','1' — CarOS Phone Hub, çerçeveleme 1. */
    public static final byte[] MAGIC = { 0x43, 0x50, 0x48, 0x31 };

    public static final int FIXED_HEADER_BYTES = 24;
    public static final int FRAMING_VERSION = 1;

    /** Genişletilmiş başlık tavanı — bounded ayrıştırma için ŞART. */
    public static final int MAX_HEADER_BYTES = 256;
    /** Yük tavanı (64 KiB). RFCOMM MTU'su çok daha küçüktür; bu üst sınırdır. */
    public static final int MAX_PAYLOAD_BYTES = 64 * 1024;

    /** AES-GCM nonce uzunluğu — şifreli çerçevede genişletilmiş başlığın tamamı. */
    public static final int NONCE_BYTES = 12;

    public static final int FLAG_ENCRYPTED = 0x01;
    public static final int FLAG_ACK_REQUIRED = 0x02;
    /** Tanınan bayrakların birleşimi — bilinmeyen bayrak REDDEDİLİR. */
    public static final int KNOWN_FLAGS = FLAG_ENCRYPTED | FLAG_ACK_REQUIRED;

    /* ── Alanlar ──────────────────────────────────────────────────────── */

    private final int framingVersion;
    private final int flags;
    private final long messageId;
    private final byte[] extendedHeader;
    private final byte[] payload;

    public LinkFrame(int framingVersion, int flags, long messageId,
                     byte[] extendedHeader, byte[] payload) {
        this.framingVersion = framingVersion;
        this.flags = flags;
        this.messageId = messageId;
        this.extendedHeader = extendedHeader == null ? new byte[0] : extendedHeader.clone();
        this.payload = payload == null ? new byte[0] : payload.clone();
    }

    public int framingVersion() { return framingVersion; }
    public int flags() { return flags; }
    public long messageId() { return messageId; }
    public boolean isEncrypted() { return (flags & FLAG_ENCRYPTED) != 0; }
    public boolean isAckRequired() { return (flags & FLAG_ACK_REQUIRED) != 0; }

    /** Kopya döner — çağıran iç durumu DEĞİŞTİREMEZ. */
    public byte[] extendedHeader() { return extendedHeader.clone(); }
    public byte[] payload() { return payload.clone(); }

    public int payloadLength() { return payload.length; }

    /**
     * Şifreli çerçevenin nonce'u. Şifreli değilse veya başlık beklenen uzunlukta
     * değilse null — çağıran bunu DECRYPTION_FAILED sayar (sahte nonce üretilmez).
     */
    public byte[] nonceOrNull() {
        if (!isEncrypted() || extendedHeader.length != NONCE_BYTES) return null;
        return extendedHeader.clone();
    }

    /**
     * Bu çerçevenin AAD'si — GCM'e verilecek ek doğrulanmış veri.
     * Sağlama alanı bilinçli olarak DIŞARIDADIR (sınıf açıklamasındaki gerekçe).
     */
    public byte[] additionalAuthenticatedData() {
        return additionalAuthenticatedData(
            framingVersion, flags, messageId, extendedHeader, payload.length);
    }

    /**
     * AAD'yi UZUNLUKTAN üretir — mühürleme sırasında henüz bir çerçeve nesnesi
     * (ve şifreli yük) yoktur. Sahte bir yük dizisi ayırmamak için gereklidir:
     * 64 KiB'lik bir mesajda boşuna 64 KiB ayırmak hot-path'te ölçülebilir.
     */
    public static byte[] additionalAuthenticatedData(
            int framingVersion, int flags, long messageId,
            byte[] extendedHeader, int payloadLength) {
        byte[] ext = extendedHeader == null ? new byte[0] : extendedHeader;
        byte[] aad = new byte[20 + ext.length];
        System.arraycopy(MAGIC, 0, aad, 0, 4);
        aad[4] = (byte) framingVersion;
        aad[5] = (byte) flags;
        aad[6] = (byte) ((ext.length >>> 8) & 0xFF);
        aad[7] = (byte) (ext.length & 0xFF);
        aad[8]  = (byte) ((payloadLength >>> 24) & 0xFF);
        aad[9]  = (byte) ((payloadLength >>> 16) & 0xFF);
        aad[10] = (byte) ((payloadLength >>> 8) & 0xFF);
        aad[11] = (byte) (payloadLength & 0xFF);
        for (int i = 0; i < 8; i++) {
            aad[12 + i] = (byte) ((messageId >>> (56 - 8 * i)) & 0xFF);
        }
        System.arraycopy(ext, 0, aad, 20, ext.length);
        return aad;
    }

    /**
     * PII TAŞIMAYAN özet — loglanabilir. Yük İÇERİĞİ asla yer almaz, yalnız
     * uzunluk ve bayraklar.
     */
    @Override
    public String toString() {
        return "LinkFrame{v=" + framingVersion
            + ",flags=0x" + Integer.toHexString(flags)
            + ",id=" + messageId
            + ",hdr=" + extendedHeader.length
            + ",len=" + payload.length + "}";
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof LinkFrame)) return false;
        LinkFrame f = (LinkFrame) o;
        return framingVersion == f.framingVersion
            && flags == f.flags
            && messageId == f.messageId
            && Arrays.equals(extendedHeader, f.extendedHeader)
            && Arrays.equals(payload, f.payload);
    }

    @Override
    public int hashCode() {
        int h = framingVersion;
        h = 31 * h + flags;
        h = 31 * h + (int) (messageId ^ (messageId >>> 32));
        h = 31 * h + Arrays.hashCode(extendedHeader);
        h = 31 * h + Arrays.hashCode(payload);
        return h;
    }
}
