package com.cockpitos.pro.can;

import android.util.Log;

/**
 * READ-ONLY CAN bus okuyucu.
 *
 * T-7: SerialPortHandler aracılığıyla gerçek UART/MCU bridge'den veri okur.
 * Seri port açılamazsa stub modda çalışmaya devam eder (sistem çökmez).
 *
 * Baud rate önceliği: 115200 → 38400 (başarılı olana kadar denenir).
 *
 * YASAK: Bu sınıf CAN bus'a veya seri porta hiçbir şekilde veri YAZAMAz.
 */
public final class CanBusManager {

    public interface FrameListener {
        /** Ham CAN frame geldiğinde: [ ID_HIGH, ID_LOW, D0..DN ] */
        void onFrame(byte[] frame);
    }

    private static final String TAG = "CanBusManager";

    /** Önce yüksek baud rate, sonra düşük dene */
    private static final int[] BAUD_PRIORITIES = {
        SerialPortHandler.BAUD_115200,
        SerialPortHandler.BAUD_38400,
    };

    /** Seri port açılamazsa stub döngü aralığı (ms) */
    private static final long STUB_LOOP_MS = 2_000L;

    /** Port hata sonrası yeniden deneme aralığı (ms) */
    private static final long RECONNECT_DELAY_MS = 5_000L;

    private volatile boolean      _running    = false;
    private          Thread       _readThread = null;
    private          FrameListener _listener   = null;
    private final    SerialPortHandler _serial = new SerialPortHandler();

    // ── Public API ────────────────────────────────────────────────────────────

    /** READ-ONLY: CAN bus okuma döngüsünü başlatır. */
    public synchronized void start(FrameListener listener) {
        if (_running) return;
        _listener = listener;
        _running  = true;
        _readThread = new Thread(this::readLoop, "CanBusReader");
        _readThread.setDaemon(true);
        _readThread.start();
        Log.i(TAG, "CanBusManager başlatıldı");
    }

    /** Okuma döngüsünü durdurur ve seri portu kapatır. */
    public synchronized void stop() {
        _running = false;
        _serial.close();
        if (_readThread != null) {
            _readThread.interrupt();
            _readThread = null;
        }
        Log.i(TAG, "CanBusManager durduruldu");
    }

    /** Hangi seri portun açık olduğunu döner (debug için). */
    public String openPortPath() { return _serial.openPort(); }

    /**
     * MCU'ya komut paketi gönderir.
     * SerialPortHandler'ın writeCommand güvenlik kontrollerinden geçer.
     *
     * @param packet McuCommandFactory tarafından oluşturulmuş doğrulanmış paket
     * @return true: başarıyla gönderildi, false: port kapalı veya red
     */
    public boolean sendCommand(byte[] packet) {
        return _serial.writeCommand(packet);
    }

    // ── Okuma döngüsü ─────────────────────────────────────────────────────────

    private void readLoop() {
        // Seri portu açmayı dene
        boolean portOpened = tryOpenPort();
        if (!portOpened) {
            Log.w(TAG, "Seri port açılamadı — stub modda devam ediliyor");
        }

        while (_running && !Thread.currentThread().isInterrupted()) {
            try {
                if (!_serial.isOpen()) {
                    // Yeniden bağlanmayı dene
                    Thread.sleep(RECONNECT_DELAY_MS);
                    if (_running) {
                        portOpened = tryOpenPort();
                        if (!portOpened) continue;
                    }
                    continue;
                }

                byte[] frame = _serial.readNextFrame();

                if (frame != null) {
                    FrameListener cb = _listener;
                    if (cb != null) cb.onFrame(frame);
                } else if (!_serial.isOpen()) {
                    // Port kapandı — yeniden bağlanma döngüsüne gir
                    Log.w(TAG, "Seri port kapandı, yeniden bağlanılıyor…");
                }

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                Log.w(TAG, "CAN okuma hatası: " + e.getMessage());
                // Beklenmeyen hata — kısa bekle, devam et
                try { Thread.sleep(500); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt(); break;
                }
            }
        }

        _serial.close();
        Log.d(TAG, "readLoop sonlandı");
    }

    private boolean tryOpenPort() {
        for (int baud : BAUD_PRIORITIES) {
            if (_serial.open(baud)) return true;
        }
        return false;
    }
}
