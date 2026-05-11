package com.cockpitos.pro.can;

import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * Ham byte akışından CAN frame'leri çıkarır.
 *
 * Protocol: [0xAA][ID_HIGH][ID_LOW][DLC][D0..DN][XOR_CRC][0x55]
 *
 * Thread-safe DEĞİLDİR — her transport kendi CanFrameParser instance'ını oluşturur.
 */
public final class CanFrameParser {

    private static final String TAG = "CanFrameParser";

    private static final byte FRAME_START = (byte) 0xAA;
    private static final byte FRAME_END   = (byte) 0x55;
    private static final int  MAX_DLC     = 8;
    private static final int  MAX_ACCUM   = 16; // ID(2) + DLC(1) + data(8) + CRC(1) + END(1)

    private final byte[] _accum      = new byte[MAX_ACCUM];
    private int          _len        = 0;
    private boolean      _inFrame    = false;
    private int          _expectedLen= 0;

    // Drop sayacı — feedBuf() başına log için biriktirilir (hot-path'te spam yok)
    private int _dropCount = 0;

    /**
     * Tek bir baytı işler.
     * @return Tamamlanmış, geçerli frame veya null.
     */
    public byte[] feed(byte b) {
        if (!_inFrame) {
            if (b == FRAME_START) {
                _inFrame     = true;
                _len         = 0;
                _expectedLen = 0;
            }
            return null;
        }

        if (_len >= MAX_ACCUM) { _dropCount++; reset(); return null; }

        _accum[_len++] = b;

        // 3. byte: DLC
        if (_len == 3) {
            int dlc = _accum[2] & 0xFF;
            if (dlc > MAX_DLC) { _dropCount++; reset(); return null; }
            _expectedLen = 2 + 1 + dlc + 1 + 1;
        }

        if (_expectedLen > 0 && _len == _expectedLen) {
            _inFrame = false;

            // END byte kontrolü
            if (_accum[_len - 1] != FRAME_END) { _dropCount++; return null; }

            int idH = _accum[0] & 0xFF;
            int idL = _accum[1] & 0xFF;
            int dlc = _accum[2] & 0xFF;

            // XOR checksum
            byte expected = (byte) ((idH ^ idL ^ dlc) & 0xFF);
            for (int i = 0; i < dlc; i++) expected ^= _accum[3 + i];
            if (_accum[3 + dlc] != expected) { _dropCount++; return null; }

            // Çıktı: [ID_HIGH, ID_LOW, D0..DN]
            byte[] frame = new byte[2 + dlc];
            frame[0] = _accum[0];
            frame[1] = _accum[1];
            System.arraycopy(_accum, 3, frame, 2, dlc);
            return frame;
        }

        return null;
    }

    /**
     * Byte dizisindeki tüm tamamlanmış frame'leri döner.
     * Önceki implementasyon sadece ilk frame'i dönüyordu — bu versiyon tüm frame'leri toplar.
     * Bir OS read çağrısında birden fazla frame geldiyse hiçbiri kaybolmaz.
     */
    public List<byte[]> feedBuf(byte[] buf, int len) {
        int prevDrops = _dropCount;
        List<byte[]> frames = new ArrayList<>();
        for (int i = 0; i < len; i++) {
            byte[] frame = feed(buf[i]);
            if (frame != null) frames.add(frame);
        }
        // Hot-path'te spam yok: buffer başına en fazla 1 log
        if (_dropCount > prevDrops) {
            Log.d(TAG, "CRC/format hatası: " + (_dropCount - prevDrops) + " frame atlandı");
        }
        return frames;
    }

    public void reset() {
        _inFrame     = false;
        _len         = 0;
        _expectedLen = 0;
    }
}
