package com.cockpitos.pro.can;

import android.content.Context;
import android.content.pm.PackageManager;
import android.provider.Settings;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NWD CAN servisinin aldığı HAM Raise çerçevelerini, servisin kendi hata ayıklama
 * günlüğünden ("CAN" etiketi) okur.
 *
 * NEDEN (saha 2026-10-02, Megane 4 · Raise): NWD SDK'sı bu ROM'da yalnız CarInfo,
 * ham tip 1/3/6 ve klimayı dağıtıyor (geri çağrı kodları 1/2/5). Lastik basıncı
 * (0x61), yol bilgisayarı (0x81) ve merkezi ayarlar (0x71–0x73: masaj, ambiyans)
 * servise gelip üçüncü taraf uygulamalara HİÇ dağıtılmıyor. Okunabilir tek tam
 * kaynak servisin `DataHandler.distribution` günlüğü.
 *
 * ÖN KOŞUL (cihaz başına bir kez, adb):
 *   pm grant com.cockpitos.pro android.permission.READ_LOGS
 *   settings put system canapp_debug 1   (+ NWD CAN servisinin yeniden başlaması)
 * Ön koşul yoksa dinleyici HİÇ veri üretmez ve nedenini tanıya yazar (sahte veri yok).
 *
 * Her çerçevenin başlığı, uzunluğu ve sağlama toplamı doğrulanır; içerik
 * değişmedikçe aynı çerçeve tekrar iletilmez (0x72 ayar no başına ayrı tutulur).
 */
public final class NwdRawFrameTap {

    public interface FrameListener { void onFrame(int type, String dataHex); }
    public interface DiagListener  { void onDiag(String msg); }

    /** JS çözücüsünün tanıdığı tipler — diğerleri (el sıkışma 0x7D, SDK'nın verdikleri) iletilmez. */
    private static final int[] FORWARD = { 0x61, 0x81, 0x71, 0x72, 0x73 };

    private static final Pattern FRAME = Pattern.compile("distribution--1------(2E[0-9A-Fa-f]{6,250})");

    private volatile boolean _running = false;
    /** Doğrulanmış (iletilen ya da süzülen) en az bir ham çerçeve görüldü mü. */
    private volatile long    _framesSeen = 0;
    /** Son doğrulanmış çerçeve (elapsedRealtime, 0 = hiç) — tekrar süzgecinden ÖNCE. */
    private volatile long    _lastFrameAt = 0;
    private volatile Process _proc    = null;
    private Thread           _thread  = null;
    private final Map<Integer, String> _last = new HashMap<>();

    public synchronized boolean start(Context ctx, FrameListener listener, DiagListener diag) {
        if (_running) return true;
        if (ctx.checkSelfPermission("android.permission.READ_LOGS") != PackageManager.PERMISSION_GRANTED) {
            diag.onDiag("Ham CAN dinleyici KULLANILAMIYOR: READ_LOGS izni yok "
                + "(adb: pm grant com.cockpitos.pro android.permission.READ_LOGS)");
            return false;
        }
        int dbg = Settings.System.getInt(ctx.getContentResolver(), "canapp_debug", 0);
        if (dbg != 1) {
            diag.onDiag("Ham CAN dinleyici: canapp_debug=" + dbg + " — NWD ham çerçeve yazmıyor "
                + "(adb: settings put system canapp_debug 1 + NWD CAN servisini yeniden başlat)");
        }
        _running = true;
        _thread = new Thread(() -> loop(listener, diag), "nwd-raw-tap");
        _thread.setDaemon(true);
        _thread.start();
        return true;
    }

    public boolean isRunning() { return _running; }

    public long framesSeen() { return _framesSeen; }

    /** Son doğrulanmış çerçevenin yaşı (ms); hiç gelmediyse -1. */
    public long lastFrameAgeMs() {
        long t = _lastFrameAt;
        return t == 0 ? -1 : android.os.SystemClock.elapsedRealtime() - t;
    }

    public synchronized void stop() {
        _running = false;
        Process p = _proc;
        if (p != null) p.destroy();
        if (_thread != null) _thread.interrupt();
        _thread = null;
        synchronized (_last) { _last.clear(); }
    }

    /**
     * Bu tipin tekrar süzgecini sıfırlar: sonraki çerçeve içeriği AYNI olsa bile bir kez
     * iletilir. Yazma/istek öncesi çağrılır — araç değeri değiştirmeden yanıtlarsa da
     * JS taze bir yankı görür (aksi hâlde "yanıt yok" sanılırdı).
     */
    public void forget(int type) {
        synchronized (_last) {
            if (type == 0x72) _last.keySet().removeIf(k -> (k & 0xFF00) == 0x7200);
            else _last.remove(type);
        }
    }

    private void loop(FrameListener listener, DiagListener diag) {
        long backoffMs = 1000;
        while (_running) {
            try {
                Process p = new ProcessBuilder("logcat", "-v", "raw", "-s", "CAN:D")
                    .redirectErrorStream(true).start();
                _proc = p;
                diag.onDiag("Ham CAN dinleyici başladı");
                try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                    String line;
                    while (_running && (line = r.readLine()) != null) {
                        Matcher m = FRAME.matcher(line);
                        if (!m.find()) continue;
                        byte[] f = parse(m.group(1));
                        if (f == null) continue;
                        _framesSeen++;
                        _lastFrameAt = android.os.SystemClock.elapsedRealtime();
                        int type = f[1] & 0xFF;
                        if (!forwarded(type)) continue;
                        String dataHex = dataHex(f);
                        int key = (type == 0x72 && f.length > 4) ? (0x7200 | (f[3] & 0xFF)) : type;
                        synchronized (_last) {
                            if (dataHex.equals(_last.get(key))) continue;
                            _last.put(key, dataHex);
                        }
                        listener.onFrame(type, dataHex);
                    }
                }
                backoffMs = 1000;
            } catch (Throwable t) {
                diag.onDiag("Ham CAN dinleyici hatası: " + t.getMessage());
            } finally {
                Process p = _proc;
                _proc = null;
                if (p != null) p.destroy();
            }
            if (!_running) break;
            try { Thread.sleep(backoffMs); } catch (InterruptedException ie) { break; }
            backoffMs = Math.min(backoffMs * 2, 30_000);
        }
    }

    private static boolean forwarded(int type) {
        for (int t : FORWARD) if (t == type) return true;
        return false;
    }

    /**
     * "2E72029B00F0" → doğrulanmış tam çerçeve; başlık / uzunluk / sağlama toplamı
     * tutmazsa null. Sağlama: ~(tip + uzunluk + veri) & 0xFF.
     */
    static byte[] parse(String hex) {
        if (hex == null || (hex.length() & 1) != 0) return null;
        int n = hex.length() / 2;
        if (n < 4) return null;
        byte[] f = new byte[n];
        try {
            for (int i = 0; i < n; i++) f[i] = (byte) Integer.parseInt(hex.substring(2 * i, 2 * i + 2), 16);
        } catch (NumberFormatException e) {
            return null;
        }
        if ((f[0] & 0xFF) != 0x2E) return null;
        if (n != (f[2] & 0xFF) + 4) return null;
        int sum = 0;
        for (int i = 1; i < n - 1; i++) sum += f[i] & 0xFF;
        if (((~sum) & 0xFF) != (f[n - 1] & 0xFF)) return null;
        return f;
    }

    /** Veri bölümü (tip/uzunluk/sağlama hariç) bitişik hex. */
    static String dataHex(byte[] f) {
        StringBuilder sb = new StringBuilder();
        for (int i = 3; i < f.length - 1; i++) {
            sb.append(Character.toUpperCase(Character.forDigit((f[i] >> 4) & 0xF, 16)))
              .append(Character.toUpperCase(Character.forDigit(f[i] & 0xF, 16)));
        }
        return sb.toString();
    }
}
