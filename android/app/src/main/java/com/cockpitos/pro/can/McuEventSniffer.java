package com.cockpitos.pro.can;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.Parcel;
import android.util.Log;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * McuEventSniffer — Patch 5
 *
 * K250 / K2401-NWD / Hiworld MCU event keşif katmanı.
 *
 * Hedef:
 *   reverse / door / ACC / speed / steering-wheel key eventlerini bul.
 *
 * Yöntemler (öncelik sırasıyla):
 *   1. com.nwd.factory.service.FactorySettingService IBinder transact
 *      → UiService değil, veri servisi → kamera ekranı AÇMAZ
 *   2. NWD/Hiworld'e özgü broadcast action genişletilmesi
 *   3. /dev/socket + /dev/nwd* dosya keşfi
 *   4. Hiworld ContentProvider'a hedefli sütun sorgusu
 *
 * Güvenlik:
 *   - Araç sistemlerine hiçbir YAZMA veya KONTROL komutu gönderilmez.
 *   - Parse edilemeyen paketler loglanır, işlenmez.
 *   - Main thread bloke edilmez — tüm operasyonlar arka planda.
 *   - Log spam throttle: aynı mesaj 10s'de 1 kez.
 *
 * Sonuçlar DiagListener üzerinden iletilir (mevcut canDiag mekanizması).
 */
public final class McuEventSniffer {

    public interface DiagListener {
        void onDiag(String line);
    }

    private static final String TAG = "McuEventSniffer";

    // Hiworld FactorySettingService — UiService DEĞİL (kamera açmaz)
    private static final String NWD_PKG_FACTORY  = "com.nwd.factory.setting";
    private static final String NWD_SVC_DATA     = "com.nwd.factory.service.FactorySettingService";

    // NWD/K250'ye özgü broadcast action'ları (K24 listesine ek olarak)
    private static final String[] NWD_ACTIONS = {
        "com.nwd.factory.action.CAR_STATUS",
        "com.nwd.factory.action.MCU_DATA",
        "com.nwd.factory.action.VEHICLE_SIGNAL",
        "com.nwd.car.STATUS_CHANGED",
        "com.nwd.car.MCU_EVENT",
        "com.nwd.canbox.DATA",
        "com.nwd.can.REVERSE",
        "com.nwd.can.DOOR",
        "com.nwd.can.ACC",
        "com.nwd.can.SPEED",
        "com.hiworld.mcu.DATA",
        "com.hiworld.car.STATUS",
        "com.hiworld.factory.CAN_DATA",
        "android.intent.action.CAR_REVERSE",
        "android.car.action.VEHICLE_EVENT",
        "com.android.car.action.MCU_EVENT",
    };

    // NWD ContentProvider — hedefli MCU sütunları
    private static final String[] MCU_COL_REVERSE = { "reverse","car_reverse","isReverse","reverse_gear","mcu_reverse" };
    private static final String[] MCU_COL_DOOR    = { "door","door_open","car_door","mcu_door","door_status" };
    private static final String[] MCU_COL_ACC     = { "acc","car_acc","acc_status","mcu_acc","power_acc" };
    private static final String[] MCU_COL_STEER   = { "steer","steering_key","wheel_key","mcu_steer","steering_button" };

    // Cihaz dosyaları (read-only)
    private static final String[] DEVICE_FILES = {
        "/dev/nwdmcu", "/dev/hiworld", "/dev/nwd_can",
        "/dev/ttyMT3", "/dev/ttyMT0", "/dev/ttyMT1",
        "/dev/socket/nwd_mcu", "/dev/socket/hiworld_can",
        "/proc/nwd/can", "/proc/nwd/mcu",
        "/sys/class/nwd/can", "/sys/bus/nwd",
    };

    private final Context   _ctx;
    private final DiagListener _diag;
    private final AtomicBoolean _running  = new AtomicBoolean(false);
    private final AtomicBoolean _svcBound = new AtomicBoolean(false);

    // Spam throttle: mesaj → son log zamanı
    private final java.util.concurrent.ConcurrentHashMap<String, Long> _throttle =
        new java.util.concurrent.ConcurrentHashMap<>();
    private static final long THROTTLE_MS = 10_000;

    private BroadcastReceiver _receiver = null;
    private final ScheduledExecutorService _exec =
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "McuEventSniffer");
            t.setDaemon(true);
            return t;
        });

    public McuEventSniffer(Context ctx, DiagListener diag) {
        _ctx  = ctx.getApplicationContext();
        _diag = diag;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public void start() {
        if (!_running.compareAndSet(false, true)) return;
        diag("[McuSniffer] Başlatılıyor — K250/Hiworld MCU event keşfi");
        _exec.schedule(this::_discover, 500, TimeUnit.MILLISECONDS);
        _registerBroadcasts();
    }

    public void stop() {
        if (!_running.compareAndSet(true, false)) return;
        _unregisterBroadcasts();
        _exec.shutdownNow();
        diag("[McuSniffer] Durduruldu");
    }

    // Geri vites kamera servisi — exp=true, araç durumunu biliyor
    private static final String NWD_PKG_BACKCAR = "com.nwd.backcar";
    private static final String NWD_SVC_BACKCAR = "com.nwd.backcar.BackcarService";

    // USB2CVBS capture servisi — kamera sinyal kaynağı
    private static final String NWD_PKG_USB2CVBS = "com.nwd.usb2cvbs";
    private static final String NWD_SVC_CAPTURE  = "com.nwd.usb2cvbs.service.CaptureService";

    // BackcarService broadcast'leri — geri vites tetikleyicileri
    private static final String[] BACKCAR_ACTIONS = {
        "com.nwd.backcar.action.REVERSE_ON",
        "com.nwd.backcar.action.REVERSE_OFF",
        "com.nwd.backcar.CAMERA_ON",
        "com.nwd.backcar.CAMERA_OFF",
        "com.nwd.backcar.STATUS",
        "com.nwd.backcar.CAR_REVERSE",
        "android.intent.action.REVERSE_CAMERA",
        "com.nwd.action.REVERSE",
        "com.nwd.action.BACKCAR",
    };

    // ── Keşif sırası ─────────────────────────────────────────────────────────

    private void _discover() {
        _probeBackcarService();      // ← YENİ: geri vites kamera servisi
        _probeFactorySettingService();
        _probeDeviceFiles();
        _probeNwdContentProvider();
    }

    // ── 0. BackcarService — geri vites kamera + araç durumu ─────────────────

    private void _probeBackcarService() {
        diag("[McuSniffer] BackcarService probe başlıyor...");
        try {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(NWD_PKG_BACKCAR, NWD_SVC_BACKCAR));
            boolean bound = _ctx.bindService(intent, new ServiceConnection() {
                @Override
                public void onServiceConnected(ComponentName name, IBinder binder) {
                    String desc = safeDescriptor(binder);
                    diag("[McuSniffer] ★ BackcarService BAĞLANDI: " + desc);
                    for (int code = 1; code <= 20; code++) {
                        Parcel req = Parcel.obtain(), resp = Parcel.obtain();
                        try {
                            if (!desc.equals("(null)") && !desc.startsWith("(hata")) {
                                req.writeInterfaceToken(desc);
                            }
                            if (!binder.transact(code, req, resp, 0)) continue;
                            int sz = resp.dataAvail();
                            if (sz == 0) continue;
                            byte[] raw = new byte[Math.min(sz, 64)];
                            resp.setDataPosition(0);
                            for (int i = 0; i < raw.length; i++) raw[i] = resp.readByte();
                            StringBuilder hex = new StringBuilder();
                            for (byte b : raw) hex.append(String.format("%02X", b));
                            resp.setDataPosition(0);
                            int exc = (sz >= 4) ? resp.readInt() : -99;
                            int val = (sz >= 8) ? resp.readInt() : -99;
                            String str = null;
                            try { resp.setDataPosition(0); resp.readException(); str = resp.readString(); }
                            catch (Exception ignored) {}
                            diag(String.format("[BackcarSvc][%d] sz=%d hex=%s exc=%d int=%d%s",
                                code, sz, hex, exc, val,
                                (str != null && !str.isEmpty() ? " str=\"" + str + "\"" : "")));
                        } catch (Exception e) {
                            diag("[BackcarSvc][" + code + "] hata: " + e.getMessage());
                        } finally { req.recycle(); resp.recycle(); }
                    }
                    try { _ctx.unbindService(this); } catch (Exception ignored) {}
                }
                @Override public void onServiceDisconnected(ComponentName n) {
                    diag("[McuSniffer] BackcarService bağlantısı kesildi");
                }
            }, Context.BIND_AUTO_CREATE);
            diag("[McuSniffer] BackcarService bind " + (bound ? "OK" : "BAŞARISIZ — paket yok?"));
        } catch (Exception e) {
            diag("[McuSniffer] BackcarService hata: " + e.getMessage());
        }

        // USB2CVBS CaptureService
        try {
            Intent intent2 = new Intent();
            intent2.setComponent(new ComponentName(NWD_PKG_USB2CVBS, NWD_SVC_CAPTURE));
            _ctx.bindService(intent2, new ServiceConnection() {
                @Override public void onServiceConnected(ComponentName n, IBinder b) {
                    diag("[McuSniffer] ★ CaptureService BAĞLANDI: " + safeDescriptor(b));
                    try { _ctx.unbindService(this); } catch (Exception ignored) {}
                }
                @Override public void onServiceDisconnected(ComponentName n) {}
            }, Context.BIND_AUTO_CREATE);
        } catch (Exception ignored) {}
    }

    // ── 1. FactorySettingService IBinder transact ─────────────────────────────

    private void _probeFactorySettingService() {
        diag("[McuSniffer] FactorySettingService probe başlıyor...");
        try {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(NWD_PKG_FACTORY, NWD_SVC_DATA));
            boolean bound = _ctx.bindService(intent, new ServiceConnection() {
                @Override
                public void onServiceConnected(ComponentName name, IBinder binder) {
                    _svcBound.set(true);
                    diag("[McuSniffer] FactorySettingService BAĞLANDI: " + name.flattenToShortString());
                    diag("[McuSniffer] IBinder descriptor: " + safeDescriptor(binder));
                    _transactProbe(binder, name.flattenToShortString());
                    // Bağlantıyı hemen kapat — side effect olmasın
                    try { _ctx.unbindService(this); } catch (Exception ignored) {}
                    _svcBound.set(false);
                }
                @Override
                public void onServiceDisconnected(ComponentName name) {
                    _svcBound.set(false);
                }
            }, Context.BIND_AUTO_CREATE);
            diag("[McuSniffer] FactorySettingService bind " + (bound ? "başlatıldı" : "BAŞARISIZ"));
        } catch (Exception e) {
            diag("[McuSniffer] FactorySettingService bind hatası: " + e.getMessage());
        }
    }

    /** Güvenli IBinder.getInterfaceDescriptor() — null/exception korumalı */
    private static String safeDescriptor(IBinder b) {
        try { String d = b.getInterfaceDescriptor(); return d != null ? d : "(null)"; }
        catch (Exception e) { return "(hata: " + e.getMessage() + ")"; }
    }

    /** Transact code 1–20 arasında kör deneme — sadece READ */
    private void _transactProbe(IBinder binder, String svcName) {
        for (int code = 1; code <= 20; code++) {
            if (!_running.get()) return;
            try {
                Parcel req  = Parcel.obtain();
                Parcel resp = Parcel.obtain();
                try {
                    String desc = safeDescriptor(binder);
                    if (!desc.equals("(null)") && !desc.startsWith("(hata")) {
                        req.writeInterfaceToken(desc);
                    }
                    boolean ok = binder.transact(code, req, resp, 0);
                    int size = resp.dataAvail();
                    if (ok && size > 0) {
                        // Yanıt geldi — tüm byte'ları hex olarak logla (parse etme)
                        int readLen = Math.min(size, 128);
                        byte[] bytes = new byte[readLen];
                        resp.setDataPosition(0);
                        for (int i = 0; i < readLen; i++) bytes[i] = resp.readByte();
                        String hex = bytesToHex(bytes);
                        String truncNote = size > 128 ? " (+…" + (size - 128) + ")" : "";
                        diag(String.format(
                            "[McuSniffer] TRANSACT HIT %s code=%d size=%d%s hex=%s",
                            svcName, code, size, truncNote, hex));
                    }
                } finally {
                    req.recycle();
                    resp.recycle();
                }
            } catch (Exception e) {
                // Çoğu code başarısız olacak — sadece beklenmedik hataları logla
                if (e.getMessage() != null && !e.getMessage().contains("UNKNOWN_TRANSACTION")) {
                    throttledDiag("[McuSniffer] transact[" + code + "] hata: " + e.getMessage());
                }
            }
        }
    }

    // ── 2. Broadcast action genişletmesi ─────────────────────────────────────

    private void _registerBroadcasts() {
        _receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                if (!_running.get()) return;
                _onIntent(intent);
            }
        };
        IntentFilter filter = new IntentFilter();
        for (String action : NWD_ACTIONS)     filter.addAction(action);
        for (String action : BACKCAR_ACTIONS) filter.addAction(action);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                _ctx.registerReceiver(_receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                _ctx.registerReceiver(_receiver, filter);
            }
            diag("[McuSniffer] " + NWD_ACTIONS.length + " NWD action dinleniyor");
        } catch (Exception e) {
            diag("[McuSniffer] Broadcast kayıt hatası: " + e.getMessage());
        }
    }

    private void _unregisterBroadcasts() {
        if (_receiver != null) {
            try { _ctx.unregisterReceiver(_receiver); } catch (Exception ignored) {}
            _receiver = null;
        }
    }

    // Fiziksel olay anahtar kelimeleri — throttle bypass edilir
    private static final String[] PHYSICAL_KEYWORDS = {
        "reverse", "door", "acc", "light", "steer", "speed", "gear", "can"
    };

    /** Gelen intent'i parse etmeden logla — güvenlik: sadece log */
    private void _onIntent(Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        long ts = System.currentTimeMillis();
        StringBuilder sb = new StringBuilder();
        sb.append("[McuSniffer] INTENT ts=").append(ts)
          .append(" action=").append(action);

        // Tüm extra key/value'ları logla — veri değiştirme yok, sadece okuma
        if (intent.getExtras() != null && !intent.getExtras().isEmpty()) {
            sb.append("\n  extras:");
            for (String key : intent.getExtras().keySet()) {
                Object val = intent.getExtras().get(key);
                String valStr = (val != null) ? val.toString() : "null";
                // Binary/byte[] verisini hex olarak göster
                if (val instanceof byte[]) {
                    valStr = "bytes[" + ((byte[]) val).length + "]=" + bytesToHex((byte[]) val);
                }
                sb.append("\n    ").append(key).append(" = ").append(valStr);
            }
        } else {
            sb.append("\n  extras: (yok)");
        }

        String msg = sb.toString();

        // Fiziksel olay içeriyorsa throttle bypass
        String actionLc = action.toLowerCase();
        boolean isPhysical = false;
        for (String kw : PHYSICAL_KEYWORDS) {
            if (actionLc.contains(kw)) { isPhysical = true; break; }
        }

        if (isPhysical) {
            diag(msg); // throttle yok — her fiziksel event loglanır
        } else {
            throttledDiag(msg);
        }
    }

    // ── 3. Device file keşfi ─────────────────────────────────────────────────

    private void _probeDeviceFiles() {
        List<String> found = new ArrayList<>();
        for (String path : DEVICE_FILES) {
            File f = new File(path);
            if (f.exists()) {
                found.add(path + (f.canRead() ? "[r]" : "[!r]"));
            }
        }
        if (found.isEmpty()) {
            diag("[McuSniffer] MCU cihaz dosyası bulunamadı");
        } else {
            diag("[McuSniffer] MCU cihaz dosyaları: " + String.join(", ", found));
        }
    }

    // ── 4. NWD ContentProvider hedefli sorgu ─────────────────────────────────

    private void _probeNwdContentProvider() {
        // K24CanBridge zaten geniş tarama yapıyor; burada yalnızca MCU sütunlarını hedefle
        String[] authorities = {
            "com.nwd.factory.setting", "com.nwd.factory", "com.nwd.vehicle",
        };
        String[] paths = { "/mcu", "/car", "/vehicle", "/signal", "" };

        ContentResolver cr = _ctx.getContentResolver();
        for (String auth : authorities) {
            for (String path : paths) {
                if (!_running.get()) return;
                String uriStr = "content://" + auth + path;
                try {
                    Cursor c = cr.query(Uri.parse(uriStr), null, null, null, null);
                    if (c == null) continue;
                    try {
                        if (c.getCount() == 0) continue;
                        // Sütun adlarını logla — değerleri parse etme
                        String[] cols = c.getColumnNames();
                        diag("[McuSniffer] ContentProvider HIT: " + uriStr +
                             " | sütunlar: " + String.join(", ", cols));
                        // MCU sinyali olabilecek sütunlar var mı?
                        for (String col : cols) {
                            String lc = col.toLowerCase();
                            if (_containsAny(lc, MCU_COL_REVERSE)) diag("  → REVERSE sütunu: " + col);
                            if (_containsAny(lc, MCU_COL_DOOR))    diag("  → DOOR sütunu: " + col);
                            if (_containsAny(lc, MCU_COL_ACC))     diag("  → ACC sütunu: " + col);
                            if (_containsAny(lc, MCU_COL_STEER))   diag("  → STEERING sütunu: " + col);
                        }
                    } finally {
                        c.close();
                    }
                } catch (SecurityException se) {
                    throttledDiag("[McuSniffer] ContentProvider izin: " + uriStr);
                } catch (Exception ignored) {}
            }
        }
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    private static boolean _containsAny(String s, String[] variants) {
        for (String v : variants) if (s.contains(v)) return true;
        return false;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02X ", b));
        return sb.toString().trim();
    }

    private void diag(String msg) {
        Log.d(TAG, msg);
        if (_diag != null) _diag.onDiag(msg);
    }

    /** Aynı mesajı 10s'de 1 kez logla */
    private void throttledDiag(String msg) {
        long now  = System.currentTimeMillis();
        Long last = _throttle.get(msg);
        if (last != null && now - last < THROTTLE_MS) return;
        // Harita büyüklüğünü sınırla
        if (_throttle.size() > 256) _throttle.clear();
        _throttle.put(msg, now);
        diag(msg);
    }
}
