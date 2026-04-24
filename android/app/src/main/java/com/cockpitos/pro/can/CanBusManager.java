package com.cockpitos.pro.can;

import android.util.Log;

/**
 * READ-ONLY CAN bus reader.
 *
 * Vendor API yoksa stub çalışır — gerçek implementasyon için:
 *   Option A) Linux SocketCAN:
 *     socket(AF_CAN, SOCK_RAW, CAN_RAW)  [system app / root gerektirir]
 *   Option B) Vendor SDK:
 *     com.hiworld.canbox.CanManager veya OEM-spesifik API
 *   Option C) UART/USB serial bridge:
 *     /dev/ttyUSB0 veya vendor serial port
 *
 * YASAK: Bu sınıf CAN bus'a hiçbir şekilde veri YAZAMAz.
 */
public final class CanBusManager {

    public interface FrameListener {
        /** Ham CAN frame (11-bit ID [2 byte] + 8 byte data) geldiğinde çağrılır. */
        void onFrame(byte[] frame);
    }

    private static final String TAG = "CanBusManager";

    private volatile boolean   _running = false;
    private          Thread    _readThread;
    private          FrameListener _listener;

    /** READ-ONLY: CAN bus okuma döngüsünü başlatır. */
    public synchronized void start(FrameListener listener) {
        if (_running) return;
        _listener = listener;
        _running  = true;
        _readThread = new Thread(this::readLoop, "CanBusReader");
        _readThread.setDaemon(true);
        _readThread.start();
        Log.d(TAG, "CAN bus reader started (stub mode)");
    }

    /** Okuma döngüsünü durdurur ve kaynakları serbest bırakır. */
    public synchronized void stop() {
        _running = false;
        if (_readThread != null) {
            _readThread.interrupt();
            _readThread = null;
        }
        Log.d(TAG, "CAN bus reader stopped");
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private void readLoop() {
        while (_running && !Thread.currentThread().isInterrupted()) {
            try {
                byte[] frame = readNextFrame();
                if (frame != null && _listener != null) {
                    _listener.onFrame(frame);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                Log.w(TAG, "CAN read error: " + e.getMessage());
            }
        }
    }

    /**
     * Bir sonraki CAN frame'ini okur.
     *
     * Stub: null döner (gerçek veri yok).
     * Vendor API bağlandığında bu metod doldurulacak.
     *
     * Frame formatı: [ ID_HIGH, ID_LOW, D0, D1, D2, D3, D4, D5, D6, D7 ]
     */
    private byte[] readNextFrame() throws InterruptedException {
        // Stub: gerçek vendor API olmadan blok etme
        Thread.sleep(1000);
        return null;
    }
}
