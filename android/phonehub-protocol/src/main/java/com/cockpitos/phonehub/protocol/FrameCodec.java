package com.cockpitos.phonehub.protocol;

import java.util.zip.CRC32;

/**
 * FrameCodec — {@link LinkFrame} ⇄ bayt dizisi (GÖREV 6, yazma yönü).
 *
 * Saf ve durumsuzdur: modül durumu, zaman, rastgelelik ve I/O YOKTUR. Aynı
 * çerçeve her zaman aynı baytları üretir → testler deterministiktir.
 *
 * ASLA throw ETMEZ: tavan aşımı gibi durumlar {@link EncodeResult} içinde
 * kodlanmış hata olarak döner. "Sessizce kırp ve gönderdim de" YOKTUR.
 */
public final class FrameCodec {

    private FrameCodec() { }

    /** Kodlama sonucu — ya baytlar ya da SABİT hata kodu. */
    public static final class EncodeResult {
        public final byte[] bytes;
        public final LinkErrorCode error;

        private EncodeResult(byte[] bytes, LinkErrorCode error) {
            this.bytes = bytes;
            this.error = error;
        }

        public boolean ok() { return error == null; }

        static EncodeResult ok(byte[] b) { return new EncodeResult(b, null); }
        static EncodeResult fail(LinkErrorCode c) { return new EncodeResult(null, c); }
    }

    /** CRC32(genişletilmiş başlık ‖ yük) — hat gürültüsü eleyicisi. */
    public static long checksumOf(byte[] extendedHeader, byte[] payload) {
        CRC32 crc = new CRC32();
        if (extendedHeader != null && extendedHeader.length > 0) crc.update(extendedHeader);
        if (payload != null && payload.length > 0) crc.update(payload);
        return crc.getValue();
    }

    /**
     * Çerçeveyi tel üzerindeki baytlara dönüştürür.
     *
     * Reddedilen durumlar (fail-closed):
     *  · başlık > {@link LinkFrame#MAX_HEADER_BYTES}      → FRAME_TOO_LARGE
     *  · yük    > {@link LinkFrame#MAX_PAYLOAD_BYTES}     → FRAME_TOO_LARGE
     *  · tanınmayan bayrak                                 → FRAME_MALFORMED
     *  · şifreli ama nonce uzunluğu yanlış                 → FRAME_MALFORMED
     *  · çerçeveleme sürümü desteklenmiyor                 → FRAME_MALFORMED
     */
    public static EncodeResult encode(LinkFrame frame) {
        if (frame == null) return EncodeResult.fail(LinkErrorCode.FRAME_MALFORMED);

        byte[] ext = frame.extendedHeader();
        byte[] payload = frame.payload();

        if (frame.framingVersion() != LinkFrame.FRAMING_VERSION) {
            return EncodeResult.fail(LinkErrorCode.FRAME_MALFORMED);
        }
        if ((frame.flags() & ~LinkFrame.KNOWN_FLAGS) != 0) {
            return EncodeResult.fail(LinkErrorCode.FRAME_MALFORMED);
        }
        if (ext.length > LinkFrame.MAX_HEADER_BYTES) {
            return EncodeResult.fail(LinkErrorCode.FRAME_TOO_LARGE);
        }
        if (payload.length > LinkFrame.MAX_PAYLOAD_BYTES) {
            return EncodeResult.fail(LinkErrorCode.FRAME_TOO_LARGE);
        }
        /* Şifreli çerçevede nonce ZORUNLU ve tam uzunlukta olmalı — eksik nonce
         * ile "şifreli" bayrağı taşımak, karşı tarafta sahte güven yaratır. */
        if (frame.isEncrypted() && ext.length != LinkFrame.NONCE_BYTES) {
            return EncodeResult.fail(LinkErrorCode.FRAME_MALFORMED);
        }

        long crc = checksumOf(ext, payload);

        byte[] out = new byte[LinkFrame.FIXED_HEADER_BYTES + ext.length + payload.length];
        System.arraycopy(LinkFrame.MAGIC, 0, out, 0, 4);
        out[4] = (byte) frame.framingVersion();
        out[5] = (byte) frame.flags();
        out[6] = (byte) ((ext.length >>> 8) & 0xFF);
        out[7] = (byte) (ext.length & 0xFF);
        out[8]  = (byte) ((payload.length >>> 24) & 0xFF);
        out[9]  = (byte) ((payload.length >>> 16) & 0xFF);
        out[10] = (byte) ((payload.length >>> 8) & 0xFF);
        out[11] = (byte) (payload.length & 0xFF);
        long id = frame.messageId();
        for (int i = 0; i < 8; i++) {
            out[12 + i] = (byte) ((id >>> (56 - 8 * i)) & 0xFF);
        }
        out[20] = (byte) ((crc >>> 24) & 0xFF);
        out[21] = (byte) ((crc >>> 16) & 0xFF);
        out[22] = (byte) ((crc >>> 8) & 0xFF);
        out[23] = (byte) (crc & 0xFF);

        System.arraycopy(ext, 0, out, LinkFrame.FIXED_HEADER_BYTES, ext.length);
        System.arraycopy(payload, 0, out,
            LinkFrame.FIXED_HEADER_BYTES + ext.length, payload.length);

        return EncodeResult.ok(out);
    }
}
