package com.cockpitos.pro.can;

import android.util.Log;

import java.util.Collections;
import java.util.List;

/**
 * ICanTransport — Dahili UART (head unit built-in CAN bridge).
 *
 * SerialPortHandler'ı kullanır:
 *   - su / chmod ile izin bypass (rooted head unit'ler)
 *   - Allwinner, Rockchip, MediaTek, Qualcomm, generic Linux UART portları
 *   - USB-to-serial de dahil (/dev/ttyUSB*, ttyACM*) — root varsa çalışır
 */
public final class FileSerialTransport implements ICanTransport {

    private static final String TAG = "FileSerialTransport";

    private final SerialPortHandler _serial;
    private volatile boolean _connected = false;

    public FileSerialTransport() { this(new SerialPortHandler(), false); }

    /** YALNIZ TEST: donanımsız transport — SerialPortHandler test hook'uyla beslenir. */
    FileSerialTransport(SerialPortHandler serial, boolean connected) {
        _serial    = serial;
        _connected = connected;
    }

    @Override
    public boolean connect(int baudRate) {
        if (_connected) return true;
        boolean ok = _serial.open(baudRate);
        _connected = ok;
        if (ok) Log.i(TAG, "UART bağlandı: " + _serial.openPort() + " @ " + baudRate);
        return ok;
    }

    @Override
    public List<byte[]> readFrames() throws java.io.IOException, InterruptedException {
        if (!_connected) return Collections.emptyList();
        byte[] frame = _serial.readNextFrame();
        if (frame == null && !_serial.isOpen()) {
            _connected = false;
            throw new java.io.IOException("UART port kapandı");
        }
        // SerialPortHandler kendi circular buffer parser'ını kullanır — tek frame döner
        return frame != null ? Collections.singletonList(frame) : Collections.emptyList();
    }

    @Override
    public boolean write(byte[] data) {
        return _connected && _serial.writeCommand(data);
    }

    @Override
    public void disconnect() {
        _connected = false;
        _serial.close();
        Log.d(TAG, "UART bağlantısı kapatıldı");
    }

    @Override
    public boolean isConnected() { return _connected && _serial.isOpen(); }

    // ── MRI F-01: yazma yetkisi/gözlem penceresi SerialPortHandler'ın kanıtından gelir ──

    @Override
    public boolean writeAuthorized() { return _connected && _serial.isWriteAuthorized(); }

    @Override
    public boolean observationExpired() {
        if (!_connected || !_serial.observationExpired()) return false;
        _serial.markNoEvidence();   // soğuma kaydı; kapatmayı CanBusManager yapar
        return true;
    }

    @Override
    public String evidenceLabel() { return _serial.evidenceLabel(); }

    @Override
    public String name() {
        String port = _serial.openPort();
        return "UART:" + (port != null ? port : "?");
    }
}
