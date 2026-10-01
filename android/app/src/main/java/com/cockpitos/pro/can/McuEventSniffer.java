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
import java.util.concurrent.RejectedExecutionException;
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
 *   (1. servis binder transact taraması KALDIRILDI — kör çağrılar araca yazıyordu)
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

    // Spam throttle: mesaj → son log zamanı
    private final java.util.concurrent.ConcurrentHashMap<String, Long> _throttle =
        new java.util.concurrent.ConcurrentHashMap<>();
    private static final long THROTTLE_MS = 10_000;

    private BroadcastReceiver _receiver = null;
    // NOT: final değil — stop() executor'u shutdownNow() ile öldürdükten sonra
    // start() yeniden yaratabilsin diye volatile. Ölü executor'a schedule edilince
    // RejectedExecutionException atılıp process çöküyordu (crash loop).
    private volatile ScheduledExecutorService _exec = _newExec();

    private static ScheduledExecutorService _newExec() {
        return Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "McuEventSniffer");
            t.setDaemon(true);
            return t;
        });
    }

    public McuEventSniffer(Context ctx, DiagListener diag) {
        _ctx  = ctx.getApplicationContext();
        _diag = diag;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public void start() {
        if (!_running.compareAndSet(false, true)) return;
        diag("[McuSniffer] Başlatılıyor — K250/Hiworld MCU event keşfi");
        // Executor önceki stop() ile kapatılmış olabilir → schedule etmeden önce
        // yeniden yarat (start/stop/start senaryosunda RejectedExecutionException önler).
        if (_exec == null || _exec.isShutdown()) {
            _exec = _newExec();
        }
        try {
            _exec.schedule(this::_discover, 500, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException e) {
            // Kemer+askı: yine de reddedilirse asla uncaught exception sızdırma.
            diag("[McuSniffer] schedule reddedildi, başlatma iptal: " + e.getMessage());
            _running.set(false);
            return;
        }
        _registerBroadcasts();
    }

    public void stop() {
        if (!_running.compareAndSet(true, false)) return;
        _unregisterBroadcasts();
        _exec.shutdownNow();
        diag("[McuSniffer] Durduruldu");
    }

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
        _probeDeviceFiles();
        _probeNwdContentProvider();
    }

    // ── 0/1/1b. Servis binder taraması KALDIRILDI (saha 2026-10-01) ─────────────
    // BackcarService / FactorySettingService / CanService'e 1..20 arası KÖR transact
    // atılıyordu. Bu kodlar içinde yazma metotları var (CanService kod 1 = sendCanData):
    // boş Parcel ile çağrılınca klima AUTO/DUAL/buğu kendiliğinden değişti, fan geri
    // döndü (Megane head-unit, her uygulama açılışında). Araca yazan kanıtsız çağrı
    // YASAK — keşif yalnız salt-okunur yollardan (yayın, dosya, provider sorgusu).

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
            // YENİ: kodda araç verisi adayı olarak işaretli — keşfe dahil edildi
            "com.nwd.mycar.provider", "com.nwd.mycar", "com.nwd.car",
        };
        String[] paths = { "/mcu", "/car", "/vehicle", "/signal", "/can", "/status", "" };

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
                        // KEŞİF: ilk satırın değerlerini dök — sinyal isim/değerlerini görmek için
                        if (c.moveToFirst()) {
                            StringBuilder sb = new StringBuilder("  satır[0]: ");
                            for (int i = 0; i < cols.length && i < 24; i++) {
                                String v;
                                try { v = c.getString(i); } catch (Exception ex) { v = "?"; }
                                sb.append(cols[i]).append("=").append(v).append("  ");
                            }
                            diag(sb.toString().trim());
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
