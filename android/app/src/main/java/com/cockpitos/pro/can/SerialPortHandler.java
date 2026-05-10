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
 * Android head unit'lerde /dev/ttyS* portları genellikle root/system yetkisi
 * gerektirir. Bu sınıf açılış öncesinde iki yöntem dener:
 *
 *   1. "su -c chmod 666 <port>"  — rooted cihazlar (çoğu aftermarket head unit)
 *   2. "chmod 666 <port>"        — zaten yetki varsa veya sistem app olarak kuruluysa
 *
 * Port tarama sırası: önce yaygın head unit yolları, sonra USB serial.
 *
 * Frame protokolü (binary):
 *   [0xAA][ID_HIGH][ID_LOW][DLC][D0..DN][XOR_CRC][0x55]
 *
 * YASAK: Seri porta whitelist dışı veri YAZAMAz.
 */
public final class SerialPortHandler {

    private static final String TAG = "SerialPortHandler";

    /**
     * Head unit'lerde yaygın UART port yolları.
     * Sıralama önemli: önce en yaygın head unit portları dene.
     *
     * Allwinner (A64/H6):     ttyS1, ttyS2, ttyS3
     * Rockchip (RK3399/3288): ttyS1, ttyS4, ttyS5
     * MediaTek (MT8167/8183): ttyMT1, ttyMT2
     * Qualcomm Snapdragon:    ttyHS0, ttyHS1
     * Generic Linux/UART:     ttyS0..ttyS4
     * USB-to-serial (fallback): ttyUSB0..ttyUSB3, ttyACM0
     */
    private static final String[] PORT_CANDIDATES = {
        "/dev/ttyS1",
        "/dev/ttyS2",
        "/dev/ttyS0",
        "/dev/ttyS3",
        "/dev/ttyS4",
        "/dev/ttyMT1",
        "/dev/ttyMT2",
        "/dev/ttyMT0",
        "/dev/ttyHS0",
        "/dev/ttyHS1",
        "/dev/ttyHS2",
        "/dev/ttyAMA0",
        "/dev/ttyUSB0",
        "/dev/ttyUSB1",
        "/dev/ttyACM0",
    };

    public static final int BAUD_38400  = 38400;
    public static final int BAUD_115200 = 115200;

    // Frame protocol
    private static final byte FRAME_START = (byte) 0xAA;
    private static final byte FRAME_END   = (byte) 0x55;
    private static final int  MAX_DLC     = 8;

    private static final int BUF_SIZE    = 8_192;
    private static final int CB_CAPACITY = 65_536;

    // Circular Buffer
    private final byte[]  _cb     = new byte[CB_CAPACITY];
    private volatile int  _cbHead = 0;
    private volatile int  _cbTail = 0;
    private final Object  _cbLock = new Object();

    private volatile BufferedInputStream _bis       = null;
    private volatile OutputStream        _outStream = null;
    private volatile String              _openPort  = null;

    private volatile Thread  _fillThread  = null;
    private volatile boolean _fillRunning = false;

    // ── Bağlantı ────────────────────────────────────────────────────────────

    public boolean open(int baudRate) {
        for (String port : PORT_CANDIDATES) {
            // İzin bypass — root varsa chmod, yoksa doğrudan dene
            tryGrantAccess(port);

            if (tryOpen(port, baudRate)) {
                _openPort = port;
                startFillThread();
                Log.i(TAG, "Port açıldı: " + port + " @ " + baudRate);
                return true;
            }
        }
        Log.w(TAG, "Hiçbir seri port açılamadı — stub mod");
        return false;
    }

    public void close() {
        stopFillThread();
        try { if (_bis       != null) { _bis.close();       _bis       = null; } } catch (IOException ignored) {}
        try { if (_outStream != null) { _outStream.close(); _outStream = null; } } catch (IOException ignored) {}
        _openPort = null;
        synchronized (_cbLock) { _cbHead = 0; _cbTail = 0; }
        Log.d(TAG, "Port kapatıldı");
    }

    public boolean isOpen()   { return _bis != null; }
    public String  openPort() { return _openPort; }

    // ── İzin bypass ─────────────────────────────────────────────────────────

    /**
     * Portu okuma-yazma için erişilebilir yapar.
     *
     * 1. su ile chmod (rooted cihaz — çoğu aftermarket head unit)
     * 2. chmod'u doğrudan (sistem app veya zaten izinli)
     *
     * Her iki yöntem de sessizce başarısız olabilir — tryOpen() zaten test eder.
     */
    private static void tryGrantAccess(String portPath) {
        // Yöntem 1: root ile chmod
        runSilent(new String[]{ "su", "-c", "chmod 666 " + portPath });
        // Yöntem 2: root olmadan chmod (sistem uygulaması veya önceden izinli)
        runSilent(new String[]{ "chmod", "666", portPath });
    }

    private static void runSilent(String[] cmd) {
        try {
            Process p = Runtime.getRuntime().exec(cmd);
            p.waitFor();
        } catch (Exception ignored) {
            // Sessizce geç — başarısız olursa tryOpen() zaten reddeder
        }
    }

    // ── Fill Thread: kernel → Circular Buffer ───────────────────────────────

    private void startFillThread() {
        _fillRunning = true;
        _fillThread  = new Thread(() -> {
            byte[] tmp = new byte[512];
            while (_fillRunning && !Thread.currentThread().isInterrupted()) {
                BufferedInputStream bis = _bis;
                if (bis == null) {
                    try { Thread.sleep(50); } catch (InterruptedException e) { break; }
                    continue;
                }
                try {
                    int n = bis.read(tmp, 0, tmp.length);
                    if (n > 0) cbWrite(tmp, n);
                    else if (n == -1) break;
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

    // ── Circular Buffer ──────────────────────────────────────────────────────

    private void cbWrite(byte[] data, int len) throws InterruptedException {
        synchronized (_cbLock) {
            for (int i = 0; i < len; i++) {
                int nextHead = (_cbHead + 1) % CB_CAPACITY;
                if (nextHead == _cbTail) {
                    _cbTail = (_cbTail + 1) % CB_CAPACITY;
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

    // ── Frame okuma ──────────────────────────────────────────────────────────

    public byte[] readNextFrame() throws InterruptedException {
        if (!isOpen() && _fillThread == null) {
            Thread.sleep(500);
            return null;
        }

        try {
            int b;
            do {
                b = cbRead(3_000);
                if (b == -1) return null;
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            } while ((byte) b != FRAME_START);

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

    // ── Komut yazma ──────────────────────────────────────────────────────────

    public boolean writeCommand(byte[] data) {
        if (data == null || data.length == 0) return false;
        if (data[0] != McuCommandFactory.FRAME_START || data[data.length - 1] != McuCommandFactory.FRAME_END) {
            Log.e(TAG, "writeCommand: geçersiz frame"); return false;
        }
        if (data.length >= 2 && !McuCommandFactory.isAllowed(data[1])) {
            Log.e(TAG, "writeCommand: whitelist dışı komut"); return false;
        }
        OutputStream out = _outStream;
        if (out == null) return false;
        try { out.write(data); out.flush(); return true; }
        catch (IOException e) { Log.e(TAG, "writeCommand hatası: " + e.getMessage()); return false; }
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private boolean tryOpen(String portPath, int baudRate) {
        try {
            configureBaud(portPath, baudRate);
            InputStream raw = new FileInputStream(portPath);
            _bis = new BufferedInputStream(raw, BUF_SIZE);
            try { _outStream = new FileOutputStream(portPath, false); }
            catch (Exception e) { _outStream = null; }
            return true;
        } catch (SecurityException e) { Log.d(TAG, portPath + " erişim reddedildi"); }
          catch (IOException e)        { Log.d(TAG, portPath + " açılamadı"); }
        return false;
    }

    private void configureBaud(String portPath, int baudRate) {
        // stty önce su ile dene (rooted), sonra doğrudan
        String sttyCmd = "stty -F " + portPath + " " + baudRate + " raw -echo cs8 -cstopb";
        runSilent(new String[]{"su", "-c", sttyCmd});
        runSilent(new String[]{"sh", "-c", sttyCmd});
    }
}
