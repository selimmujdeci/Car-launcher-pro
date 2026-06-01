package com.cockpitos.pro.can;

import android.content.Context;
import android.os.IBinder;
import android.os.Parcel;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.lang.reflect.Method;

/**
 * HiworldAdapter — Hiworld H1W0 built-in CAN bridge okuyucu.
 *
 * Desteklenen head unit platformları ve tipik seri port atamaları:
 *
 *   K24 / K6  (MediaTek MT8667/MT8168)  : ttyMT3, ttyMT1
 *   Rockchip  (RK3229 / RK3288 / PX5)   : ttyS4,  ttyS1
 *   Allwinner (H6 / T7 / A133)           : ttyS1,  ttyS3
 *   Snapdragon (SA8155 / SA8295)         : ttyHS0, ttyHS1
 *   Generic Android head unit            : ttyS0..ttyS4
 *
 * Çalışma akışı:
 *   1. Port listesini sırayla tara — port açılabiliyor mu kontrol et
 *   2. Açılan portta 3 saniye Hiworld frame gözlemle (protokol doğrulama)
 *   3. Doğrulanırsa sürekli okuma döngüsüne geç → DecodedListener çağır
 *   4. Port kapanırsa 5 saniye bekle, yeniden tara
 *
 * CanBusManager ile paralel çalışır. İkisi de canData event'i emit edebilir;
 * JS fusion katmanı birden fazla kaynağı zaten yönetir (CAN+OBD+GPS+HAL).
 *
 * YASAK: Araç sistemlerine hiçbir yazma veya kontrol komutu gönderilmez.
 */
public final class HiworldAdapter {

    public interface DecodedListener {
        void onData(VehicleCanData data);
    }

    private static final String TAG  = "HiworldAdapter";
    // K24 / K6 (MediaTek) platformlar 115200 kullanabilir; 38400 Hiworld standart baud hızı.
    // Ek baud rate'ler: 57600 (bazı Hiworld CAN box'lar), 9600 (eski adaptörler)
    private static final int[] BAUDS = { 
        115200,  // K24/K6 MediaTek primary
        38400,   // Hiworld standart
        57600,   // Bazı Hiworld CAN box'lar
        9600     // Eski USB serial adaptörler
    };

    // Platform öncelik sırasına göre port adayları
    // Hiworld CAN box USB üzerinden bağlıysa ttyUSB* ve ttyACM* kullanılır
    private static final String[] PORTS = {
        "/dev/ttyMT3",   // K24 / K6 platform (MediaTek) — MCU primary UART
        "/dev/ttyMT1",   // K24 / K6 alternative
        "/dev/ttyS4",    // Rockchip RK3229/3288/PX5
        "/dev/ttyS3",    // Allwinner H6/T7
        "/dev/ttyS1",    // Generic / Allwinner A133
        "/dev/ttyS2",    // Generic fallback
        "/dev/ttyMT2",   // MediaTek secondary
        "/dev/ttyMT0",   // MediaTek fallback
        "/dev/ttyHS0",   // Snapdragon SA series
        "/dev/ttyHS1",   // Snapdragon alternative
        "/dev/ttyS0",    // Last resort
        // Hiworld CAN box USB bağlantısı — en yaygın USB serial portlar
        "/dev/ttyUSB0",  // USB-to-Serial (CH340, PL2303, FTDI)
        "/dev/ttyUSB1",  // USB-to-Serial ikinci port
        "/dev/ttyUSB2",  // USB-to-Serial üçüncü port
        "/dev/ttyACM0",  // USB ACM modem (CDC-ACM)
        "/dev/ttyACM1",  // USB ACM ikinci port
        "/dev/ttyAMA0",  // Bluetooth SPP fallback
    };

    // Protokol doğrulama penceresi: bu süre içinde geçerli frame gelmeli
    private static final long VALIDATE_MS   = 3_000L;
    private static final long RECONNECT_MS  = 5_000L;
    private static final long NO_PORT_MS    = 10_000L;

    private volatile boolean       _running  = false;
    private          Thread        _thread   = null;
    private          DecodedListener _listener = null;
    private          Context       _ctx      = null;

    /** DiagListener — isteğe bağlı, tanı mesajlarını CarLauncherPlugin'e iletir */
    public interface DiagListener {
        void onDiag(String msg);
    }
    private DiagListener _diag = null;

    // ── Public API ────────────────────────────────────────────────────────────

    public synchronized void start(DecodedListener listener) {
        start(listener, null, null);
    }

    public synchronized void start(DecodedListener listener, Context ctx, DiagListener diag) {
        if (_running) return;
        _listener = listener;
        _ctx      = ctx;
        _diag     = diag;
        _running  = true;
        _thread   = new Thread(this::loop, "HiworldReader");
        _thread.setDaemon(true);
        _thread.start();
        Log.i(TAG, "HiworldAdapter başlatıldı");
    }

    public synchronized void stop() {
        _running = false;
        if (_thread != null) { _thread.interrupt(); _thread = null; }
        Log.i(TAG, "HiworldAdapter durduruldu");
    }

    // ── Ana döngü ────────────────────────────────────────────────────────────

    /** Port + baud çifti taşıyıcısı. */
    private static final class PortBaud {
        final String port;
        final int    baud;
        PortBaud(String port, int baud) { this.port = port; this.baud = baud; }
    }

    private void loop() {
        // Önce SerialManager API dene (sistem izni — doğrudan dosya erişiminden güçlü)
        if (_ctx != null) {
            diag("[Hiworld] SerialManager API deneniyor...");
            if (trySerialManagerLoop()) return; // başarılıysa buradan çıkar
            diag("[Hiworld] SerialManager API başarısız → doğrudan dosya erişimine geçiliyor");
        }

        // Fallback: doğrudan dosya erişimi
        while (_running && !Thread.currentThread().isInterrupted()) {
            PortBaud port = findPort();
            if (port == null) {
                Log.d(TAG, "Hiworld port bulunamadı — " + (NO_PORT_MS / 1000) + "s bekleniyor");
                sleepSafe(NO_PORT_MS);
                continue;
            }
            Log.i(TAG, "Hiworld port açıldı: " + port.port + " @ " + port.baud);
            readLoopStream(port.port, new java.io.File(port.port), null);
            if (_running) {
                Log.w(TAG, "Hiworld okuma döngüsü sona erdi — " + (RECONNECT_MS / 1000) + "s sonra yeniden dene");
                sleepSafe(RECONNECT_MS);
            }
        }
        Log.d(TAG, "HiworldAdapter loop sonlandı");
    }

    // ── SerialManager API ─────────────────────────────────────────────────────
    // android.hardware.ISerialManager (hidden system API)
    //   transact 1 = getSerialPorts()  → String[]
    //   transact 2 = openSerialPort(name, speed) → ParcelFileDescriptor
    //
    // Bu yol root gerektirmez — sistem servisi doğrudan port FD döner.

    private static final String SERIAL_IFACE = "android.hardware.ISerialManager";

    private boolean trySerialManagerLoop() {
        // Yol A: ServiceManager reflection
        IBinder binder = getSerialBinder();
        // Yol B: context.getSystemService("serial") — farklı izin katmanı
        if (binder == null && _ctx != null) {
            binder = getSerialBinderViaContext();
        }
        if (binder == null) {
            diag("[Hiworld] SerialManager binder null — izin yok veya servis kapalı");
            return false;
        }
        diag("[Hiworld] SerialManager binder BULUNDU ✓");

        // 1. Port listesi — her iki yol için
        String[] availPorts = serialGetPorts(binder);
        if (availPorts != null && availPorts.length > 0) {
            diag("[Hiworld] SerialManager portlar: " + java.util.Arrays.toString(availPorts));
        } else {
            diag("[Hiworld] SerialManager getSerialPorts → boş, PORTS dizisi taranıyor");
            availPorts = PORTS;
        }

        // 2. Her port + baud — hata sebebini logla
        while (_running && !Thread.currentThread().isInterrupted()) {
            ParcelFileDescriptor pfd = null;
            String openedPort = null;
            int    openedBaud = 0;

            outer:
            for (String p : availPorts) {
                if (!_running) break;
                for (int baud : BAUDS) {
                    String err = serialOpenPortWithError(binder, p, baud, _pfdResult);
                    if (_pfdResult[0] != null) {
                        pfd = _pfdResult[0];
                        _pfdResult[0] = null;
                        openedPort = p;
                        openedBaud = baud;
                        break outer;
                    }
                    // Her başarısız deneyi logla — sadece ilk baud için
                    if (baud == BAUDS[0]) {
                        diag("[Hiworld] " + p + " → " + (err != null ? err : "null FD"));
                    }
                }
            }

            if (pfd == null) {
                diag("[Hiworld] SerialManager: hiçbir port açılamadı — " + (NO_PORT_MS / 1000) + "s bekleniyor");
                sleepSafe(NO_PORT_MS);
                continue;
            }

            diag("[Hiworld] ★ SerialManager PORT AÇILDI: " + openedPort + " @ " + openedBaud);
            try (ParcelFileDescriptor closePfd = pfd) {
                FileInputStream fis = new FileInputStream(closePfd.getFileDescriptor());
                readLoopStream(openedPort, null, fis);
            } catch (IOException e) {
                diag("[Hiworld] FD kapatma: " + e.getMessage());
            }

            if (_running) sleepSafe(RECONNECT_MS);
        }
        return true;
    }

    // Tek elemanlı array — metod return + hata mesajı aynı anda döndürmek için
    private final ParcelFileDescriptor[] _pfdResult = new ParcelFileDescriptor[1];

    /** openSerialPort + hata mesajı döner */
    private String serialOpenPortWithError(IBinder binder, String port, int baud,
                                           ParcelFileDescriptor[] result) {
        result[0] = null;
        Parcel req = Parcel.obtain(), resp = Parcel.obtain();
        try {
            req.writeInterfaceToken(SERIAL_IFACE);
            req.writeString(port);
            req.writeInt(baud);
            if (!binder.transact(2, req, resp, 0)) return "transact false";
            try { resp.readException(); } catch (Exception ex) { return "exc: " + ex.getMessage(); }
            result[0] = resp.readFileDescriptor();
            return null;
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        } finally {
            req.recycle();
            resp.recycle();
        }
    }

    /** Yol B: context.getSystemService("serial") → farklı izin katmanı */
    private IBinder getSerialBinderViaContext() {
        try {
            Object svc = _ctx.getSystemService("serial");
            if (svc == null) { diag("[Hiworld] getSystemService(serial) → null"); return null; }
            diag("[Hiworld] getSystemService(serial) → " + svc.getClass().getName());
            // SerialManager'dan IBinder'ı çek
            java.lang.reflect.Field[] fields = svc.getClass().getDeclaredFields();
            for (java.lang.reflect.Field f : fields) {
                f.setAccessible(true);
                Object val = f.get(svc);
                if (val instanceof IBinder) {
                    diag("[Hiworld] SerialManager IBinder alanı: " + f.getName());
                    return (IBinder) val;
                }
            }
            // Proxy mi? getClass().getMethod("getISerialManager") dene
            try {
                java.lang.reflect.Method m = svc.getClass().getMethod("getSerialPorts");
                String[] ports = (String[]) m.invoke(svc);
                diag("[Hiworld] getSystemService().getSerialPorts() → " +
                     java.util.Arrays.toString(ports));
            } catch (Exception ignored) {}
        } catch (Exception e) {
            diag("[Hiworld] getSystemService(serial) hata: " + e.getMessage());
        }
        return null;
    }

    private IBinder getSerialBinder() {
        try {
            Class<?> sm = Class.forName("android.os.ServiceManager");
            Method   gs = sm.getMethod("getService", String.class);
            return (IBinder) gs.invoke(null, "serial");
        } catch (Exception e) {
            Log.d(TAG, "getSerialBinder: " + e.getMessage());
            return null;
        }
    }

    private String[] serialGetPorts(IBinder binder) {
        Parcel req = Parcel.obtain(), resp = Parcel.obtain();
        try {
            req.writeInterfaceToken(SERIAL_IFACE);
            if (!binder.transact(1, req, resp, 0)) return null;
            resp.readException();
            return resp.createStringArray();
        } catch (Exception e) {
            Log.d(TAG, "serialGetPorts: " + e.getMessage());
            return null;
        } finally {
            req.recycle();
            resp.recycle();
        }
    }

    private ParcelFileDescriptor serialOpenPort(IBinder binder, String port, int baud) {
        Parcel req = Parcel.obtain(), resp = Parcel.obtain();
        try {
            req.writeInterfaceToken(SERIAL_IFACE);
            req.writeString(port);
            req.writeInt(baud);
            if (!binder.transact(2, req, resp, 0)) return null;
            resp.readException();
            return resp.readFileDescriptor();
        } catch (Exception e) {
            // Beklenen hata: çoğu port açılamayacak
            return null;
        } finally {
            req.recycle();
            resp.recycle();
        }
    }

    // ── Birleşik okuma döngüsü (hem doğrudan hem SerialManager FD için) ───────

    private void readLoopStream(String portLabel, java.io.File fileOrNull, FileInputStream fisOrNull) {
        HiworldProtocolParser parser = new HiworldProtocolParser();
        byte[] buf = new byte[512];

        try {
            FileInputStream fis = (fisOrNull != null) ? fisOrNull
                                                      : new FileInputStream(fileOrNull);
            BufferedInputStream bis = new BufferedInputStream(fis, 4_096);

            if (!validateProtocol(bis, parser)) {
                diag("[Hiworld] " + portLabel + " — Hiworld protokolü doğrulanamadı");
                if (fisOrNull == null) bis.close();
                return;
            }
            diag("[Hiworld] " + portLabel + " — protokol DOĞRULANDI, okuma başlıyor");

            while (_running && !Thread.currentThread().isInterrupted()) {
                int n = bis.read(buf, 0, buf.length);
                if (n == -1) break;
                if (n > 0) {
                    VehicleCanData data = parser.feed(buf, n);
                    DecodedListener cb = _listener;
                    if (data != null && cb != null) cb.onData(data);
                }
            }
            if (fisOrNull == null) bis.close();

        } catch (IOException e) {
            Log.w(TAG, portLabel + " okuma hatası: " + e.getMessage());
        }
    }

    /**
     * Port üzerinde Hiworld frame gelip gelmediğini doğrula.
     * VALIDATE_MS içinde geçerli frame üretilirse true döner.
     */
    private boolean validateProtocol(BufferedInputStream bis, HiworldProtocolParser parser) {
        long deadline = System.currentTimeMillis() + VALIDATE_MS;
        byte[] tmp = new byte[64];
        try {
            while (System.currentTimeMillis() < deadline && _running) {
                int avail = bis.available();
                if (avail > 0) {
                    int n = bis.read(tmp, 0, Math.min(tmp.length, avail));
                    if (n > 0 && parser.feed(tmp, n) != null) return true;
                } else {
                    Thread.sleep(50);
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    // ── Port tarama ──────────────────────────────────────────────────────────

    private PortBaud findPort() {
        for (String p : PORTS) {
            if (!_running) return null;
            grantAccess(p);
            // Her iki baud hızını dene: 115200 (K24/K6 MediaTek) önce, 38400 standart sonra
            for (int baud : BAUDS) {
                configureBaud(p, baud);
                try (FileInputStream test = new FileInputStream(p)) {
                    return new PortBaud(p, baud); // açılabildi → aday
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    private void diag(String msg) {
        Log.d(TAG, msg);
        DiagListener cb = _diag;
        if (cb != null) cb.onDiag(msg);
    }

    private static void grantAccess(String port) {
        exec(new String[]{ "su", "-c", "chmod 666 " + port });
        exec(new String[]{ "sh", "-c", "chmod 666 " + port });
    }

    private static void configureBaud(String port, int baud) {
        String cmd = "stty -F " + port + " " + baud + " raw -echo cs8 -cstopb";
        exec(new String[]{ "su", "-c", cmd });
        exec(new String[]{ "sh", "-c", cmd });
    }

    private static void exec(String[] cmd) {
        try { Runtime.getRuntime().exec(cmd).waitFor(); } catch (Exception ignored) {}
    }

    private void sleepSafe(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
