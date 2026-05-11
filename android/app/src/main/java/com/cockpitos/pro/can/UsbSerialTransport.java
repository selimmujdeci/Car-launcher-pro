package com.cockpitos.pro.can;

import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.util.Log;

import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;

import java.io.IOException;
import java.util.Collections;
import java.util.List;

/**
 * ICanTransport — USB-to-serial adaptörler (CH340, CP2102, FTDI, CDC ACM).
 *
 * USB_DEVICE_ATTACHED intent-filter + usb_device_filter.xml kombinasyonu ile
 * cihaz takıldığında Android otomatik izin verir — kullanıcıya dialog çıkmaz.
 *
 * Uygulama zaten çalışırken takılan cihazlar için izin otomatiktir.
 * Uygulama başlarken zaten takılı cihazlar için tek seferlik dialog gerekebilir.
 */
public final class UsbSerialTransport implements ICanTransport {

    private static final String TAG             = "UsbSerialTransport";
    private static final int    READ_TIMEOUT_MS = 100;

    private final Context         _context;
    private final CanFrameParser  _parser  = new CanFrameParser();
    private final byte[]          _buf     = new byte[256];

    private UsbSerialPort       _port       = null;
    private UsbDeviceConnection _connection = null;
    private volatile boolean    _connected  = false;

    public UsbSerialTransport(Context context) {
        _context = context;
    }

    @Override
    public boolean connect(int baudRate) {
        UsbManager usbManager = (UsbManager) _context.getSystemService(Context.USB_SERVICE);
        if (usbManager == null) return false;

        List<UsbSerialDriver> drivers =
            UsbSerialProber.getDefaultProber().findAllDrivers(usbManager);

        if (drivers.isEmpty()) {
            Log.d(TAG, "USB serial cihaz bulunamadı");
            return false;
        }

        for (UsbSerialDriver driver : drivers) {
            UsbDevice device = driver.getDevice();

            if (!usbManager.hasPermission(device)) {
                Log.d(TAG, "USB izni yok: VID=" + device.getVendorId()
                    + " PID=" + device.getProductId());
                // İzin olmadan atla — otomatik izin için USB_DEVICE_ATTACHED intent'i çalışır
                continue;
            }

            UsbDeviceConnection conn = usbManager.openDevice(device);
            if (conn == null) continue;

            List<UsbSerialPort> ports = driver.getPorts();
            if (ports.isEmpty()) { conn.close(); continue; }

            UsbSerialPort port = ports.get(0);
            try {
                port.open(conn);
                port.setParameters(baudRate, 8,
                    UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
                _port       = port;
                _connection = conn;
                _connected  = true;
                _parser.reset();
                Log.i(TAG, "USB serial bağlandı: " + device.getDeviceName()
                    + " VID=" + device.getVendorId() + " @ " + baudRate);
                return true;
            } catch (IOException e) {
                Log.w(TAG, "USB port açma hatası: " + e.getMessage());
                safeClose(port, conn);
            }
        }
        return false;
    }

    @Override
    public List<byte[]> readFrames() throws IOException, InterruptedException {
        if (!_connected || _port == null) return Collections.emptyList();
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
        try {
            int n = _port.read(_buf, READ_TIMEOUT_MS);
            if (n > 0) {
                // Tüm frame'leri döner — eski feedBuf() sadece ilkini döndürüyordu
                return _parser.feedBuf(_buf, n);
            }
            return Collections.emptyList(); // timeout — normal
        } catch (IOException e) {
            _connected = false;
            throw e;
        }
    }

    @Override
    public boolean write(byte[] data) {
        if (!_connected || _port == null) return false;
        try { _port.write(data, 1_000); return true; }
        catch (IOException e) { return false; }
    }

    @Override
    public void disconnect() {
        _connected = false;
        safeClose(_port, _connection);
        _port       = null;
        _connection = null;
        Log.d(TAG, "USB bağlantısı kapatıldı");
    }

    @Override
    public boolean isConnected() { return _connected; }

    @Override
    public String name() { return "USB"; }

    private static void safeClose(UsbSerialPort port, UsbDeviceConnection conn) {
        if (port != null) { try { port.close(); } catch (IOException ignored) {} }
        if (conn != null) { try { conn.close(); } catch (Exception  ignored) {} }
    }
}
