package com.cockpitos.pro.can;

import java.util.ArrayList;
import java.util.List;

/**
 * Ham CAN frame baytlarını decode eder.
 *
 * Frame layout: [ ID_HIGH, ID_LOW, D0, D1, D2, D3, D4, D5, D6, D7 ]
 * Minimum frame uzunluğu: 2 (ID) + en az 1 data baytı = 3 byte
 */
public final class CanFrameDecoder {

    public static final class CanSignal {
        public final int    canId;
        public final byte[] data;   // 0–8 byte payload

        CanSignal(int canId, byte[] data) {
            this.canId = canId;
            this.data  = data;
        }
    }

    /**
     * Ham frame'i CAN ID + data payload çiftine dönüştürür.
     * Geçersiz uzunlukta frame → boş liste döner.
     */
    public List<CanSignal> decode(byte[] frame) {
        List<CanSignal> out = new ArrayList<>();
        if (frame == null || frame.length < 3) return out;

        int canId = ((frame[0] & 0xFF) << 8) | (frame[1] & 0xFF);
        int dataLen = Math.min(frame.length - 2, 8);
        byte[] data = new byte[dataLen];
        System.arraycopy(frame, 2, data, 0, dataLen);

        out.add(new CanSignal(canId, data));
        return out;
    }

    /** Tek baytı unsigned int olarak okur. */
    public static int u8(byte[] d, int i) {
        return i < d.length ? (d[i] & 0xFF) : 0;
    }

    /** İki baytı big-endian unsigned int olarak okur. */
    public static int u16be(byte[] d, int i) {
        if (i + 1 >= d.length) return 0;
        return ((d[i] & 0xFF) << 8) | (d[i + 1] & 0xFF);
    }
}
