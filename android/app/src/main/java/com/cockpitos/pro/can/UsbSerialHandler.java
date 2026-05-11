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
import java.util.List;

/**
 * Android USB Host API üzerinden seri port erişimi.
 *
 * Desteklenen chipsetler (usb-serial-for-android aracılığıyla):
 *   CP2102/CP2104 (Silicon Labs), CH340/CH341 (WCH),
 *   FTDI FT232, CDC ACM (Arduino/STM32), Prolific PL2303
 *
 * Kullanım: open() → read() döngüsü → close()
 * read() bloklamayan mode: READ_TIMEOUT_MS kadar bekler, veri gelirse döner.
 */
public final class UsbSerialHandler {

    private static final String TAG              = "UsbSerialHandler";
    private static final int    READ_TIMEOUT_MS  = 100; // non-blocking style
    private static final int    WRITE_TIMEOUT_MS = 1_000;

    private final Context      _context;
    private UsbSerialPort      _port        = null;
    private UsbDeviceConnection _connection = null;
    private String             _openDevice  = null;

    public UsbSerialHandler(Context context) {
        _context = context;
    }

    /**
     * Takılı USB serial cihazları tarar ve izni olan ilkini açar.
     * İzin henüz verilmemişse false döner — CarLauncherPlugin.requestUsbPermission() çağrılmalı.
     *
     * @param baudRate İstenen baud rate (örn. 115200 veya 38400)
     * @return true: port açıldı; false: uygun cihaz yok veya izin yok
     */
    public boolean open(int baudRate) {
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
                Log.w(TAG, "USB izni yok: VID=" + device.getVendorId()
                    + " PID=" + device.getProductId() + " — requestUsbPermission() çağrılmalı");
                continue;
            }

            UsbDeviceConnection conn = usbManager.openDevice(device);
            if (conn == null) {
                Log.w(TAG, "USB cihazı açılamadı: " + device.getDeviceName());
                continue;
            }

            List<UsbSerialPort> ports = driver.getPorts();
            if (ports.isEmpty()) {
                conn.close();
                continue;
            }

            UsbSerialPort port = ports.get(0);
            try {
                port.open(conn);
                port.setParameters(baudRate, 8,
                    UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
                _port       = port;
                _connection = conn;
                _openDevice = device.getDeviceName()
                    + " VID=" + device.getVendorId()
                    + " PID=" + device.getProductId();
                Log.i(TAG, "USB serial açıldı: " + _openDevice + " @ " + baudRate);
                return true;
            } catch (IOException e) {
                Log.w(TAG, "USB port açma hatası: " + e.getMessage());
                safeClose(port, conn);
            }
        }

        return false;
    }

    public void close() {
        safeClose(_port, _connection);
        _port       = null;
        _connection = null;
        _openDevice = null;
    }

    public boolean isOpen()       { return _port != null; }
    public String  openDevice()   { return _openDevice;   }

    /**
     * Veri oku. READ_TIMEOUT_MS kadar bekler; veri gelirse uzunluğu döner.
     * Port kapalı ya da hata durumunda -1 döner.
     */
    public int read(byte[] buf) {
        if (_port == null) return -1;
        try {
            int n = _port.read(buf, READ_TIMEOUT_MS);
            return n >= 0 ? n : 0;
        } catch (IOException e) {
            Log.w(TAG, "USB okuma hatası: " + e.getMessage());
            close();
            return -1;
        }
    }

    /** MCU komut yazma. */
    public boolean write(byte[] data) {
        if (_port == null) return false;
        try {
            _port.write(data, WRITE_TIMEOUT_MS);
            return true;
        } catch (IOException e) {
            Log.w(TAG, "USB yazma hatası: " + e.getMessage());
            return false;
        }
    }

    /**
     * İzni olmayan USB serial cihazları listele.
     * CarLauncherPlugin bu listeyle UsbManager.requestPermission() çağırır.
     */
    public List<UsbDevice> getDevicesNeedingPermission() {
        UsbManager usbManager = (UsbManager) _context.getSystemService(Context.USB_SERVICE);
        List<UsbDevice> result = new java.util.ArrayList<>();
        if (usbManager == null) return result;

        List<UsbSerialDriver> drivers =
            UsbSerialProber.getDefaultProber().findAllDrivers(usbManager);
        for (UsbSerialDriver d : drivers) {
            if (!usbManager.hasPermission(d.getDevice())) {
                result.add(d.getDevice());
            }
        }
        return result;
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private static void safeClose(UsbSerialPort port, UsbDeviceConnection conn) {
        if (port != null) { try { port.close(); } catch (IOException ignored) {} }
        if (conn != null) { try { conn.close(); } catch (Exception ignored) {} }
    }
}
