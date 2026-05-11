package com.cockpitos.pro.can;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * ICanTransport — Bluetooth RFCOMM serial (HC-05, HC-06, BT-CAN köprüler).
 *
 * Eşleştirilmiş (paired) Bluetooth cihazları tarar.
 * Önce "CAN", "UART", "Serial", "MCU" adını içerenleri dener,
 * sonra diğer paired cihazları — bağlananla devam eder.
 *
 * İzin: Sadece BLUETOOTH_CONNECT (API 31+) gerekir — zaten manifest'te var.
 * Kullanıcıya dialog çıkmaz: cihaz zaten Android Ayarları'ndan eşleştirilmiş.
 */
public final class BtSerialTransport implements ICanTransport {

    private static final String TAG = "BtSerialTransport";

    // SPP (Serial Port Profile) standart UUID
    private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private static final int CONNECT_TIMEOUT_MS = 3_000;
    private static final int READ_TIMEOUT_MS    = 100;

    private final CanFrameParser  _parser     = new CanFrameParser();
    private final byte[]          _buf        = new byte[256];

    private BluetoothSocket  _socket     = null;
    private InputStream      _inputStream = null;
    private volatile boolean _connected  = false;
    private String           _deviceName = null;

    @Override
    public boolean connect(int baudRate) {
        // baudRate BT'de kullanılmaz (SPP baud'u cihaz firmware'inde sabit)
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            Log.d(TAG, "Bluetooth kapalı veya desteklenmiyor");
            return false;
        }

        Set<BluetoothDevice> bonded;
        try { bonded = adapter.getBondedDevices(); }
        catch (SecurityException e) { Log.w(TAG, "BT izni yok"); return false; }

        if (bonded == null || bonded.isEmpty()) {
            Log.d(TAG, "Eşleştirilmiş BT cihazı yok");
            return false;
        }

        // Öncelik: CAN/UART/MCU/Serial içerenler → sonra diğerleri
        List<BluetoothDevice> priority  = new ArrayList<>();
        List<BluetoothDevice> secondary = new ArrayList<>();

        for (BluetoothDevice dev : bonded) {
            String devName = safeGetName(dev);
            if (devName == null) { secondary.add(dev); continue; }
            String upper = devName.toUpperCase();
            if (upper.contains("CAN") || upper.contains("UART")
                    || upper.contains("MCU") || upper.contains("SERIAL")
                    || upper.contains("HC-0") || upper.contains("HC05")
                    || upper.contains("HC06") || upper.contains("ESP")) {
                priority.add(dev);
            } else {
                secondary.add(dev);
            }
        }

        // Önce öncelikli, sonra diğerleri
        priority.addAll(secondary);

        for (BluetoothDevice dev : priority) {
            if (tryConnectDevice(dev)) return true;
        }

        Log.d(TAG, "Hiçbir BT cihazına bağlanılamadı");
        return false;
    }

    private boolean tryConnectDevice(BluetoothDevice dev) {
        String devName = safeGetName(dev);
        Log.d(TAG, "BT deneniyor: " + devName);
        try {
            BluetoothSocket socket =
                dev.createRfcommSocketToServiceRecord(SPP_UUID);

            // Discovery bağlantıyı yavaşlatır — kapat
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter != null) {
                try { adapter.cancelDiscovery(); } catch (SecurityException ignored) {}
            }

            socket.connect();
            _socket      = socket;
            _inputStream = socket.getInputStream();
            _connected   = true;
            _deviceName  = devName;
            _parser.reset();
            Log.i(TAG, "BT serial bağlandı: " + devName);
            return true;
        } catch (IOException | SecurityException e) {
            Log.d(TAG, devName + " bağlantı başarısız: " + e.getMessage());
            return false;
        }
    }

    @Override
    public List<byte[]> readFrames() throws IOException, InterruptedException {
        if (!_connected || _inputStream == null) return Collections.emptyList();
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();

        try {
            int available = _inputStream.available();
            if (available <= 0) {
                Thread.sleep(READ_TIMEOUT_MS);
                return Collections.emptyList();
            }
            int toRead = Math.min(available, _buf.length);
            int n = _inputStream.read(_buf, 0, toRead);
            if (n < 0) {
                _connected = false;
                throw new IOException("BT stream kapandı");
            }
            // Tüm frame'leri döner — eski feedBuf() sadece ilkini döndürüyordu
            return _parser.feedBuf(_buf, n);
        } catch (IOException e) {
            _connected = false;
            throw e;
        }
    }

    @Override
    public boolean write(byte[] data) {
        if (!_connected || _socket == null) return false;
        try {
            _socket.getOutputStream().write(data);
            _socket.getOutputStream().flush();
            return true;
        } catch (IOException e) {
            Log.w(TAG, "BT yazma hatası: " + e.getMessage());
            return false;
        }
    }

    @Override
    public void disconnect() {
        _connected = false;
        if (_inputStream != null) { try { _inputStream.close(); } catch (IOException ignored) {} }
        if (_socket      != null) { try { _socket.close();      } catch (IOException ignored) {} }
        _socket      = null;
        _inputStream = null;
        Log.d(TAG, "BT bağlantısı kapatıldı");
    }

    @Override
    public boolean isConnected() { return _connected; }

    @Override
    public String name() { return "BT:" + (_deviceName != null ? _deviceName : "?"); }

    private static String safeGetName(BluetoothDevice dev) {
        try { return dev.getName(); }
        catch (SecurityException e) { return null; }
    }
}
