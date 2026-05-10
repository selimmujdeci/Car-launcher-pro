package com.cockpitos.pro.can;

import android.content.Context;
import android.util.Log;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Hibrit CAN bus orkestratörü.
 *
 * Üç transport katmanını sırayla dener, bağlananı kullanır:
 *
 *   1. FileSerial  — Dahili UART (/dev/ttyS*, ttyMT*, ttyHS*), su ile chmod bypass
 *   2. UsbSerial   — USB-to-serial adaptörler (CH340, CP2102, FTDI, CDC ACM)
 *   3. BtSerial    — Bluetooth RFCOMM (HC-05/HC-06, BT-CAN köprüler)
 *
 * Transport başarısız olursa 5s sonra sıfırdan tekrar dener.
 * Disconnect anında onTransportLost callback'i çağrılır — mapper reset için kullanılır.
 *
 * YASAK: Bu sınıf CAN bus'a veya seri porta hiçbir şekilde veri YAZAMAz.
 */
public final class CanBusManager {

    public interface FrameListener {
        void onFrame(byte[] frame);
    }

    private static final String TAG = "CanBusManager";

    private static final int[] BAUD_PRIORITIES = {
        SerialPortHandler.BAUD_115200,
        SerialPortHandler.BAUD_38400,
    };

    private static final long RECONNECT_DELAY_MS = 5_000L;

    public enum ConnectionMode { UART, USB, BLUETOOTH, NONE }

    private volatile boolean       _running    = false;
    private          Thread        _readThread = null;
    private          FrameListener _listener   = null;
    private          Context       _context    = null;
    private          Runnable      _onTransportLost = null;

    private volatile ICanTransport  _active = null;
    private volatile ConnectionMode _mode   = ConnectionMode.NONE;

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * @param listener        Frame callback (her geçerli frame için)
     * @param context         USB transport için gerekli (null → USB atlanır)
     * @param onTransportLost Transport koptuğunda çağrılır — VehicleSignalMapper.reset() gibi
     *                        temizlik işlemleri için. Read thread'inden çağrılır.
     */
    public synchronized void start(FrameListener listener, Context context, Runnable onTransportLost) {
        if (_running) return;
        _context         = context;
        _listener        = listener;
        _onTransportLost = onTransportLost;
        _running         = true;
        _readThread      = new Thread(this::readLoop, "CanBusReader");
        _readThread.setDaemon(true);
        _readThread.start();
        Log.i(TAG, "CanBusManager (hibrit) başlatıldı");
    }

    /** Geriye dönük uyumluluk — onTransportLost yok. */
    public synchronized void start(FrameListener listener, Context context) {
        start(listener, context, null);
    }

    /** Geriye dönük uyumluluk. */
    public synchronized void start(FrameListener listener) {
        start(listener, null, null);
    }

    public synchronized void stop() {
        _running = false;
        ICanTransport t = _active;
        if (t != null) { t.disconnect(); _active = null; }
        _mode = ConnectionMode.NONE;
        if (_readThread != null) { _readThread.interrupt(); _readThread = null; }
        Log.i(TAG, "CanBusManager durduruldu");
    }

    public ConnectionMode getConnectionMode() { return _mode; }

    public String openPortPath() {
        ICanTransport t = _active;
        return t != null ? t.name() : null;
    }

    public boolean sendCommand(byte[] packet) {
        ICanTransport t = _active;
        return t != null && t.write(packet);
    }

    public List<android.hardware.usb.UsbDevice> getDevicesNeedingUsbPermission() {
        return new ArrayList<>();
    }

    // ── Okuma döngüsü ─────────────────────────────────────────────────────────

    private void readLoop() {
        if (!tryConnect()) {
            Log.w(TAG, "İlk bağlantı başarısız — 5s'de tekrar denenecek");
        }

        while (_running && !Thread.currentThread().isInterrupted()) {
            try {
                ICanTransport transport = _active;

                if (transport == null || !transport.isConnected()) {
                    Thread.sleep(RECONNECT_DELAY_MS);
                    if (_running) tryConnect();
                    continue;
                }

                // readFrames() — bir OS chunk'ındaki tüm frame'leri döner
                List<byte[]> frames = transport.readFrames();
                if (!frames.isEmpty()) {
                    FrameListener cb = _listener;
                    if (cb != null) {
                        for (byte[] frame : frames) {
                            cb.onFrame(frame);
                        }
                    }
                }
                // boş liste = timeout/no data — döngü devam

            } catch (IOException e) {
                Log.w(TAG, "Transport hatası: " + e.getMessage() + " — yeniden bağlanılıyor");
                notifyTransportLost();
                ICanTransport t = _active;
                if (t != null) { t.disconnect(); }
                _active = null;
                _mode   = ConnectionMode.NONE;

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;

            } catch (Exception e) {
                Log.w(TAG, "Beklenmeyen hata: " + e.getMessage());
                try { Thread.sleep(500); }
                catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
            }
        }

        ICanTransport t = _active;
        if (t != null) { t.disconnect(); _active = null; }
        _mode = ConnectionMode.NONE;
        // Normal döngü bitişinde de mapper'ı sıfırla (stop() → interrupt → burası)
        notifyTransportLost();
        Log.d(TAG, "readLoop sonlandı");
    }

    /** onTransportLost'u güvenle çağırır — null check + tek satır log. */
    private void notifyTransportLost() {
        Runnable onLost = _onTransportLost;
        if (onLost != null) {
            try { onLost.run(); }
            catch (Exception e) { Log.w(TAG, "onTransportLost hatası: " + e.getMessage()); }
        }
    }

    private boolean tryConnect() {
        List<ICanTransport> candidates = buildCandidates();

        for (int baud : BAUD_PRIORITIES) {
            for (ICanTransport transport : candidates) {
                if (!_running) return false;
                try {
                    if (transport.connect(baud)) {
                        _active = transport;
                        _mode   = modeOf(transport);
                        Log.i(TAG, "Bağlandı → " + transport.name() + " @ " + baud);
                        return true;
                    }
                } catch (Exception e) {
                    Log.d(TAG, transport.name() + " bağlantı hatası: " + e.getMessage());
                }
            }
        }

        _mode = ConnectionMode.NONE;
        return false;
    }

    private List<ICanTransport> buildCandidates() {
        List<ICanTransport> list = new ArrayList<>();
        list.add(new FileSerialTransport());
        if (_context != null) list.add(new UsbSerialTransport(_context));
        list.add(new BtSerialTransport());
        return list;
    }

    private static ConnectionMode modeOf(ICanTransport t) {
        if (t instanceof FileSerialTransport) return ConnectionMode.UART;
        if (t instanceof UsbSerialTransport)  return ConnectionMode.USB;
        if (t instanceof BtSerialTransport)   return ConnectionMode.BLUETOOTH;
        return ConnectionMode.NONE;
    }
}
