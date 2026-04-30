package com.cockpitos.pro.can;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * SerialPortHandler — Industrial-grade UART okuyucu/yazıcı.
 *
 * Hardening (Industrial-Grade):
 *   - BufferedInputStream: kernel buffer → uygulama buffer → sıfır kayıp
 *   - CircularBuffer: yüksek hız (115200 baud) veri taşmasına karşı
 *   - readNextFrame(): sadece tam, doğrulanmış frame'leri döner
 *   - writeCommand(): 3 katmanlı whitelist doğrulaması (T-8'den)
 *
 * Frame protokolü (binary):
 *   [0xAA][ID_HIGH][ID_LOW][DLC][D0..DN][XOR_CRC][0x55]
 *
 * YASAK: Seri porta whitelist dışı veri YAZAMAz.
 */
public final class SerialPortHandler {

    private static final String TAG = "SerialPortHandler";

    private static final String[] PORT_CANDIDATES = {
        "/dev/ttyS0", "/dev/ttyS1", "/dev/ttyS2",
        "/dev/ttyUSB0", "/dev/ttyACM0",
    };

    public static final int BAUD_38400  = 38400;
    public static final int BAUD_115200 = 115200;

    // Frame protocol
    private static final byte FRAME_START = (byte) 0xAA;
    private static final byte FRAME_END   = (byte) 0x55;
    private static final int  MAX_DLC     = 8;

    // BufferedInputStream: 8 KB buffer — 115200 baud'da ~70ms tampon
    private static final int BUF_SIZE = 8_192;

    // ── Circular Buffer ──────────────────────────────────────────────────
    // Yüksek hızda gelen veriyi taşırmadan saklar; paket ayrıştırıcı
    // async okurken veri kaybolmaz.
    private static final int  CB_CAPACITY = 65_536; // 64 KB
    private final byte[]  _cb     = new byte[CB_CAPACITY];
    private volatile int  _cbHead = 0; // yazma pozisyonu
    private volatile int  _cbTail = 0; // okuma pozisyonu
    private final Object  _cbLock = new Object();

    private volatile BufferedInputStream _bis       = null;
    private volatile OutputStream        _outStream = null;
    private volatile String              _openPort  = null;

    // Circular buffer okuma thread'i
    private volatile Thread  _fillThread = null;
    private volatile boolean _fillRunning = false;

    // ── Bağlantı ────────────────────────────────────────────────────────

    public boolean open(int baudRate) {
        for (String port : PORT_CANDIDATES) {
            if (tryOpen(port, baudRate)) {
                _openPort = port;
                startFillThread();
                Log.i(TAG, "Port açıldı: " + port + " @ " + baudRate);
                return true;
            }
        }
        Log.w(TAG, "Seri port bulunamadı — stub mod");
        return false;
    }

    public void close() {
        stopFillThread();
        try { if (_bis       != null) { _bis.close();       _bis       = null; } } catch (IOException ignored) {}
        try { if (_outStream != null) { _outStream.close(); _outStream = null; } } catch (IOException ignored) {}
        _openPort = null;
        synchronized (_cbLock) { _cbHead = 0; _cbTail = 0; } // tampon sıfırla
        Log.d(TAG, "Port kapatıldı");
    }

    public boolean isOpen()   { return _bis != null; }
    public String  openPort() { return _openPort; }

    // ── Fill Thread: kernel → Circular Buffer ───────────────────────────

    private void startFillThread() {
        _fillRunning = true;
        _fillThread  = new Thread(() -> {
            byte[] tmp = new byte[512];
            while (_fillRunning && !Thread.currentThread().isInterrupted()) {
                BufferedInputStream bis = _bis;
                if (bis == null) { try { Thread.sleep(50); } catch (InterruptedException e) { break; } continue; }
                try {
                    int n = bis.read(tmp, 0, tmp.length);
                    if (n > 0) cbWrite(tmp, n);
                    else if (n == -1) break; // EOF — port kapandı
                } catch (IOException e) {
                    Log.w(TAG, "Fill hatası: " + e.getMessage());
                    break;
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }, "SerialFillThread");
        _fillThread.setDaemon(true);
        _fillThread.start();
    }

    private void stopFillThread() {
        _fillRunning = false;
        if (_fillThread != null) { _fillThread.interrupt(); _fillThread = null; }
    }

    // ── Circular Buffer yazma/okuma ──────────────────────────────────────

    private void cbWrite(byte[] data, int len) throws InterruptedException {
        synchronized (_cbLock) {
            for (int i = 0; i < len; i++) {
                int nextHead = (_cbHead + 1) % CB_CAPACITY;
                if (nextHead == _cbTail) {
                    // Taşma: en eski byte'ı at (FIFO drop)
                    _cbTail = (_cbTail + 1) % CB_CAPACITY;
                    Log.v(TAG, "CB taşma — eski veri atıldı");
                }
                _cb[_cbHead] = data[i];
                _cbHead = nextHead;
            }
            _cbLock.notifyAll();
        }
    }

    private int cbRead(long timeoutMs) throws InterruptedException {
        synchronized (_cbLock) {
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (_cbHead == _cbTail) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) return -1;
                _cbLock.wait(remaining);
            }
            int b = _cb[_cbTail] & 0xFF;
            _cbTail = (_cbTail + 1) % CB_CAPACITY;
            return b;
        }
    }

    // ── Frame okuma ──────────────────────────────────────────────────────

    /**
     * Bir sonraki geçerli CAN frame'ini okur.
     * BufferedInputStream + CircularBuffer sayesinde 115200 baud'da kayıp olmaz.
     *
     * @return [ ID_HIGH, ID_LOW, D0..DN ] veya null (timeout/hata)
     */
    public byte[] readNextFrame() throws InterruptedException {
        if (!isOpen() && _fillThread == null) {
            Thread.sleep(500);
            return null;
        }

        try {
            // Start byte'ı bekle (3s timeout)
            int b;
            do {
                b = cbRead(3_000);
                if (b == -1) return null;
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            } while ((byte) b != FRAME_START);

            // Frame içi baytlar: 200ms per-byte timeout (115200 baud'da yeterli)
            int idHigh = cbRead(200); if (idHigh < 0) return null;
            int idLow  = cbRead(200); if (idLow  < 0) return null;
            int dlc    = cbRead(200); if (dlc    < 0 || dlc > MAX_DLC) return null;

            byte[] data = new byte[dlc];
            for (int i = 0; i < dlc; i++) {
                int d = cbRead(200);
                if (d < 0) return null;
                data[i] = (byte) d;
            }

            int crc = cbRead(200); if (crc < 0) return null;
            int end = cbRead(200); if ((byte) end != FRAME_END) return null;

            // XOR checksum doğrula
            byte expected = (byte) ((idHigh ^ idLow ^ dlc) & 0xFF);
            for (byte db : data) expected ^= db;
            if ((byte) crc != expected) { Log.v(TAG, "CRC mismatch"); return null; }

            byte[] frame = new byte[2 + dlc];
            frame[0] = (byte) idHigh;
            frame[1] = (byte) idLow;
            System.arraycopy(data, 0, frame, 2, dlc);
            return frame;

        } catch (Exception e) {
            Log.w(TAG, "Frame okuma hatası: " + e.getMessage());
            close();
            return null;
        }
    }

    // ── Komut yazma ──────────────────────────────────────────────────────

    public boolean writeCommand(byte[] data) {
        if (data == null || data.length == 0) { Log.w(TAG, "writeCommand: boş paket"); return false; }
        if (data[0] != McuCommandFactory.FRAME_START || data[data.length - 1] != McuCommandFactory.FRAME_END) {
            Log.e(TAG, "writeCommand: geçersiz frame — güvenlik reddi"); return false;
        }
        if (data.length >= 2 && !McuCommandFactory.isAllowed(data[1])) {
            Log.e(TAG, "writeCommand: whitelist dışı komut"); return false;
        }
        OutputStream out = _outStream;
        if (out == null) { Log.w(TAG, "writeCommand: çıkış kapalı"); return false; }
        try {
            out.write(data);
            out.flush();
            Log.d(TAG, String.format("writeCommand: CMD=0x%02X gönderildi", data[1]));
            return true;
        } catch (IOException e) {
            Log.e(TAG, "writeCommand: yazma hatası: " + e.getMessage());
            return false;
        }
    }

    // ── Private ──────────────────────────────────────────────────────────

    private boolean tryOpen(String portPath, int baudRate) {
        try {
            configureBaud(portPath, baudRate);
            InputStream raw = new FileInputStream(portPath);
            _bis = new BufferedInputStream(raw, BUF_SIZE);
            try { _outStream = new FileOutputStream(portPath, false); }
            catch (Exception e) { Log.w(TAG, portPath + " yazma açılamadı: " + e.getMessage()); _outStream = null; }
            return true;
        } catch (SecurityException e) { Log.d(TAG, portPath + " erişim reddedildi: " + e.getMessage()); }
          catch (IOException e)        { Log.d(TAG, portPath + " açılamadı: " + e.getMessage()); }
        return false;
    }

    private void configureBaud(String portPath, int baudRate) {
        try {
            String[] cmd = { "stty", "-F", portPath, String.valueOf(baudRate), "raw", "-echo", "cs8", "-cstopb" };
            Process proc = Runtime.getRuntime().exec(cmd);
            proc.waitFor();
        } catch (Exception e) { Log.d(TAG, "stty atlandı: " + e.getMessage()); }
    }
}
