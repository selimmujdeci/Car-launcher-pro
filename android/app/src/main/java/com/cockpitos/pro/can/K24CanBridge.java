package com.cockpitos.pro.can;

import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.PermissionInfo;
import android.content.pm.ProviderInfo;
import android.content.pm.ServiceInfo;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * K24CanBridge — K24 / K2401-NWD platformuna özgü çok aşamalı CAN köprüsü.
 *
 * Aşama 1: PackageManager ile com.android.carsetting (+ varyantları) incelenir.
 *           Export edilen service, provider, receiver listesi tanı günlüğüne yazılır.
 * Aşama 2: ServiceManager.getService() reflection ile sistem servisleri sorgulanır.
 * Aşama 3: bindService() ile export edilen servislere bağlanılmaya çalışılır.
 * Aşama 4: ContentProvider polling (fallback, 90 URI).
 * Aşama 5: /proc, /sys, /dev dosya tabanlı okuma denemeleri.
 *
 * READ-ONLY: Araç sistemlerine hiçbir yazma komutu göndermez.
 */
public final class K24CanBridge {

    public interface DecodedListener {
        void onData(VehicleCanData data);
    }

    public interface DiagListener {
        void onDiag(String msg);
    }

    private static final String TAG      = "K24CanBridge";
    // Polling aralığı: 500ms her döngüde 90 ContentProvider URI sorguluyordu → zayıf
    // head-unit'te sürekli CPU yükü/kasma. CAN bu ROM'da kilitli; 3s yeterli (geç veri
    // gelirse yine yakalanır), CPU yükü ~6× azalır.
    private static final long   POLL_MS  = 3000L;

    // Taranacak paket isimleri
    private static final String[] PACKAGES = {
        "com.android.carsetting",
        "com.hiworld.carsetting",
        "com.carsetting.provider",
        "com.k24.carsetting",
        "com.mediatek.carsetting",
        "com.nwd.carsetting",
        "com.autolink.carsetting",
        "com.hiworld.canbox",
        "com.android.car",
        "com.android.carservice",
        // Cihazda bulunan NWD paketleri
        "com.nwd.factory.setting",
        "com.nwd.check.appver",
        "com.nwd.factory",
        "com.nwd.audio",
        // YENİ: keşfedilen NWD servisleri
        "com.nwd.backcar",       // geri vites kamera servisi — reverse signal buradan!
        "com.nwd.usb2cvbs",      // USB2CVBS capture servisi
    };

    // ServiceManager'da aranacak servis isimleri
    private static final String[] SERVICE_NAMES = {
        "carsetting", "car_setting", "CarSetting",
        "canservice", "can_service", "CanService",
        "carservice",  "car_service",
        "hiworld",     "hiworld_can",
        "cansignal",   "vehicle",
        // NWD'ye özgü (güncel bulgular)
        "nwdaudio",    "nwd_audio",   "nwd_can",     "nwdcan",
        "nwdmanager",  "nwd_manager", "NwdManager",  // ← YENİ: logcat'te görüldü
        "nwd.factory.setting", "nwd_factory", "factory_setting",
        // Android Serial Manager — logcat'te "serial" servisi görüldü
        "serial",
    };

    // /proc, /sys ve /dev/socket yolları
    private static final String[] FILE_PATHS = {
        "/proc/can_data", "/proc/driver/can", "/proc/cansetting",
        "/sys/class/can/can0/statistics", "/sys/bus/can",
        "/data/local/tmp/can_data", "/data/carsetting/can.dat",
        // NWD native daemon socket'leri
        "/dev/socket/cansocket", "/dev/socket/nwdcan",
        "/dev/socket/carservice", "/dev/socket/vehicle",
        "/dev/socket/nwd_can", "/dev/socket/factory",
        "/dev/nwdaudio", "/dev/can0", "/dev/can1",
        "/data/nwd/can.dat", "/data/nwd/vehicle.dat",
    };

    // ContentProvider authority'leri
    private static final String[] AUTHORITIES = {
        "com.android.carsetting","com.hiworld.carsetting",
        "com.carsetting.provider","com.k24.carsetting",
        "com.mediatek.carsetting","com.nwd.carsetting",
        "com.autolink.carsetting","com.hiworld.canbox",
        "com.carservice.provider","android.car.provider",
        // NWD'ye özgü authority'ler
        "com.nwd.factory.setting","com.nwd.factory",
        "com.nwd.vehicle","com.nwd.can",
        "com.nwd.check.appver","com.nwd.audio",
        // Cihazda keşfedildi (paket taraması): com.nwd.mycar prv=1 → araç verisi adayı.
        // exp=false olabilir; SecurityException dönerse tanı günlüğü kesin teyit verir.
        "com.nwd.mycar.provider","com.nwd.mycar",
    };
    private static final String[] PATHS = {
        "/can","/vehicle","/signals","/data","/can_data","/speed","/status","/info","",
        "/factory","/setting","/sensor","/obd",
    };

    // Sütun adı varyantları
    private static final String[] COL_SPEED    = { "speed","vehicle_speed","vehicleSpeed","car_speed","Speed","SPEED","spd","kph" };
    private static final String[] COL_RPM      = { "rpm","engine_rpm","engineRpm","RPM","revs" };
    private static final String[] COL_FUEL     = { "fuel","fuel_level","fuelLevel","FuelLevel","fuel_pct","fuel_percent" };
    private static final String[] COL_COOLANT  = { "coolant","coolant_temp","coolantTemp","water_temp","waterTemp","engine_temp" };
    private static final String[] COL_OIL_TEMP = { "oil_temp","oilTemp","OilTemp","engine_oil_temp" };
    private static final String[] COL_THROTTLE = { "throttle","throttle_pos","throttlePos","accel","pedal" };
    private static final String[] COL_REVERSE  = { "reverse","is_reverse","isReverse","gear_reverse","reverseGear" };
    private static final String[] COL_GEAR     = { "gear","gear_pos","gearPos","gear_position","current_gear" };
    private static final String[] COL_BATT     = { "battery_volt","battVolt","batt_volt","battery_voltage","volt_12v" };
    private static final String[] COL_DOOR     = { "door","door_open","doorOpen","door_status","doorStatus" };
    private static final String[] COL_LIGHTS   = { "headlight","headlights","light","lights","headlight_on" };

    private static final float SPEED_MAX = 300f, RPM_MAX = 12_000f;
    private static final float TEMP_MIN  = -40f, TEMP_MAX = 150f;

    private volatile boolean       _started   = false;
    private DecodedListener        _listener  = null;
    private DiagListener           _diag      = null;
    private Context                _ctx       = null;
    private String                 _activeUri = null;
    private ContentObserver        _observer  = null;
    private boolean                _inspected = false; // paket incelemesi bir kez yapılır
    private final Handler          _handler   = new Handler(Looper.getMainLooper());
    // Permission Denial dönen URI'ler — tek executor thread'inden erişilir, tekrar denenmez.
    private final java.util.Set<String> _blocked = new java.util.HashSet<>();

    private final ScheduledExecutorService _exec = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "K24CanPoller");
        t.setDaemon(true);
        return t;
    });
    private ScheduledFuture<?> _task = null;

    // ── Public API ────────────────────────────────────────────────────────────

    public synchronized void start(DecodedListener listener, Context context) {
        start(listener, null, context);
    }

    public synchronized void start(DecodedListener listener, DiagListener diagListener, Context context) {
        if (_started) return;
        _listener = listener;
        _diag     = diagListener;
        _ctx      = context.getApplicationContext();
        _started  = true;
        diag("K24CanBridge başlatıldı");
        // İnceleme 20s sonra — UI hazır olduktan sonra çalışsın (K250 CPU relief)
        _exec.schedule(this::runInspection, 20_000, TimeUnit.MILLISECONDS);
        // Polling döngüsü — 3s sonra başlat (startup yükünü azalt)
        _task = _exec.scheduleAtFixedRate(this::tick, 3_000, POLL_MS, TimeUnit.MILLISECONDS);
    }

    public synchronized void stop() {
        if (!_started) return;
        _started   = false;
        // _inspected SIFIRLANMIYOR: ağır keşif (getInstalledPackages + getprop + servis
        // tarama) process başına BİR kez koşsun. Late-recovery her restart'ta tekrar
        // çalıştırıp head-unit'i kasıyordu. (Süreç yeniden başlayınca yine taranır.)
        _blocked.clear();   // yeniden başlatmada provider'ları tekrar dene
        if (_task != null) { _task.cancel(false); _task = null; }
        _unregisterObserver();
        diag("K24CanBridge durduruldu");
    }

    // ── İnceleme (bir kez) ───────────────────────────────────────────────────

    private void runInspection() {
        if (!_started || _ctx == null || _inspected) return;
        _inspected = true;
        // Ağır işlemleri sıralı yap — hepsi aynı anda değil
        probeSystemProperties();  // YENİ: getprop araç durumu taraması (hızlı, en yüksek umut)
        inspectFiles();           // hızlı
        inspectServiceManager();  // orta
        // Paket taraması ve nwdaudio probe en ağır — 2s arayla çalıştır
        _exec.schedule(this::inspectPackages, 2_000,  TimeUnit.MILLISECONDS);
        _exec.schedule(this::probeNwdAudio,   5_000,  TimeUnit.MILLISECONDS);
        // mycar izin sonucu — GEÇ ve TEKRARLI logla → diğer dökümlerin ALTINDA,
        // log'un en sonunda görünür (kullanıcı kaydırmadan bulsun). Kararı bu belirliyor.
        _exec.schedule(this::probeMyCarPermission, 12_000, TimeUnit.MILLISECONDS);
        _exec.schedule(this::probeMyCarPermission, 25_000, TimeUnit.MILLISECONDS);
    }

    // ── Aşama 0: System property (getprop) taraması ─────────────────────────────
    // NWD/Hiworld MCU'ları araç durumunu çoğu zaman system property'lere yansıtır
    // (persist.sys.car.*, sys.nwd.*, vb.). Bu, app izniyle okunabilen READ-ONLY bir
    // kanaldır; serial/SELinux kilidine takılmaz. Bulunursa tick() bu prop'ları poll
    // edebilir. Şimdilik KEŞİF: ilgili tüm prop'ları tanı günlüğüne yaz.
    private void probeSystemProperties() {
        java.io.BufferedReader br = null;
        Process proc = null;
        try {
            proc = Runtime.getRuntime().exec("getprop");
            br = new java.io.BufferedReader(new java.io.InputStreamReader(proc.getInputStream()));
            java.util.regex.Pattern pat = java.util.regex.Pattern.compile(
                "car|can|nwd|hiworld|mcu|reverse|speed|gear|door|vehicle|acc[_.\\]]|kbus|kcan|illum|headlight|wheel",
                java.util.regex.Pattern.CASE_INSENSITIVE);
            String line;
            int hits = 0;
            while ((line = br.readLine()) != null) {
                if (pat.matcher(line).find()) {
                    diag("PROP: " + line.trim());
                    if (++hits >= 80) { diag("PROP: (… liste kesildi)"); break; }
                }
            }
            diag(hits == 0 ? "getprop: ilgili araç property'si yok" : ("getprop: " + hits + " ilgili property bulundu"));
        } catch (Exception e) {
            diag("getprop hatası: " + e.getMessage());
        } finally {
            if (br != null) { try { br.close(); } catch (Exception ignored) {} }
            if (proc != null) { try { proc.destroy(); } catch (Exception ignored) {} }
        }
    }

    // ── Ana tick ─────────────────────────────────────────────────────────────

    private void tick() {
        if (!_started || _ctx == null) return;

        // Aktif URI varsa direkt kullan
        if (_activeUri != null) {
            VehicleCanData d = queryUri(_activeUri);
            if (d != null) { dispatch(d); return; }
            diag("URI kesildi: " + _activeUri);
            _unregisterObserver();
            _activeUri = null;
        }

        // ContentProvider tarama
        for (String auth : AUTHORITIES) {
            if (!_started) return;
            for (String path : PATHS) {
                String uri = "content://" + auth + path;
                if (_blocked.contains(uri)) continue; // export edilmemiş/izinli — tekrar deneme
                VehicleCanData d = queryUri(uri);
                if (d != null) {
                    _activeUri = "content://" + auth + path;
                    diag("BULUNDU ContentProvider: " + _activeUri);
                    _registerObserver(_activeUri);
                    dispatch(d);
                    return;
                }
            }
        }
    }

    // ── Aşama 0b: mycar provider izin seviyesi ─────────────────────────────────
    // com.nwd.mycar.provider araç verisi taşıyor ama SecurityException veriyor.
    // Korumalı iznin ADINI ve SEVİYESİNİ raporla: normal/dangerous ise manifest'e
    // <uses-permission> ekleyip erişebiliriz; signature/system ise OEM imzası gerekir.
    private void probeMyCarPermission() {
        diag("══════════ MYCAR İZİN SONUCU ══════════");
        try {
            PackageManager pm = _ctx.getPackageManager();
            String[] auths = { "com.nwd.mycar.provider", "com.nwd.mycar", "com.nwd.car" };
            for (String auth : auths) {
                ProviderInfo pi;
                try { pi = pm.resolveContentProvider(auth, 0); }
                catch (Exception e) { diag("mycar(" + auth + ") çözülemedi: " + e.getMessage()); continue; }
                if (pi == null) { diag("mycar(" + auth + "): provider yok"); continue; }
                diag("mycar PROVIDER: auth=" + auth + " pkg=" + pi.packageName
                    + " exported=" + pi.exported
                    + " read=" + pi.readPermission + " write=" + pi.writePermission);
                String[] perms = { pi.readPermission, pi.writePermission };
                for (String perm : perms) {
                    if (perm == null || perm.isEmpty()) continue;
                    try {
                        PermissionInfo info = pm.getPermissionInfo(perm, 0);
                        int prot = info.protectionLevel & PermissionInfo.PROTECTION_MASK_BASE;
                        boolean askable = (prot == PermissionInfo.PROTECTION_NORMAL
                                        || prot == PermissionInfo.PROTECTION_DANGEROUS);
                        String lvl = prot == PermissionInfo.PROTECTION_NORMAL    ? "normal"
                                   : prot == PermissionInfo.PROTECTION_DANGEROUS ? "dangerous"
                                   : prot == PermissionInfo.PROTECTION_SIGNATURE ? "signature"
                                   : "diğer(" + prot + ")";
                        diag("  → izin '" + perm + "' seviye=" + lvl
                            + (askable ? "  ✓ İSTENEBİLİR (manifest'e ekle)"
                                       : "  ✗ sistem/imza — OEM imzası gerekir"));
                    } catch (Exception e) {
                        diag("  → izin '" + perm + "' tanımsız/alınamadı: " + e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            diag("probeMyCarPermission hatası: " + e.getMessage());
        }
        diag("═══════════════════════════════════════");
    }

    // ── Aşama 1: Paket incelemesi (TÜM paketler) ────────────────────────────

    private void inspectPackages() {
        PackageManager pm = _ctx.getPackageManager();

        // Tüm yüklü paketleri tara — car/can/vehicle/hiworld/nwd/setting içerenleri raporla
        List<PackageInfo> all;
        try {
            all = pm.getInstalledPackages(0);
        } catch (Exception e) {
            diag("Paket listesi alınamadı: " + e.getMessage());
            all = new ArrayList<>();
        }

        List<String> carPkgs = new ArrayList<>();
        for (PackageInfo pi : all) {
            String p = pi.packageName.toLowerCase();
            if (p.contains("can") || p.contains("car") || p.contains("vehicle")
                    || p.contains("hiworld") || p.contains("nwd") || p.contains("setting")
                    || p.contains("launcher") || p.contains("cockpit")) {
                carPkgs.add(pi.packageName);
            }
        }

        if (carPkgs.isEmpty()) {
            diag("İlgili paket bulunamadı (" + all.size() + " paket tarandı)");
        } else {
            diag("İlgili paketler (" + carPkgs.size() + "):");
            for (String pkg : carPkgs) {
                try {
                    PackageInfo pi = pm.getPackageInfo(pkg,
                        PackageManager.GET_SERVICES | PackageManager.GET_PROVIDERS);
                    int svcCount = pi.services  != null ? pi.services.length  : 0;
                    int prvCount = pi.providers != null ? pi.providers.length : 0;
                    diag("  " + pkg + " [svc=" + svcCount + " prv=" + prvCount + "]");

                    if (pi.services != null) {
                        for (ServiceInfo si : pi.services) {
                            String shortName = si.name.startsWith(pkg)
                                ? si.name.substring(pkg.length()) : si.name;
                            diag("    S:" + shortName + " exp=" + si.exported);
                            // tryBindService kaldırıldı — BIND_AUTO_CREATE OEM kamera UI'ını tetikliyor
                        }
                    }
                    if (pi.providers != null) {
                        for (ProviderInfo pr : pi.providers) {
                            diag("    P:" + pr.authority + " exp=" + pr.exported);
                        }
                    }
                } catch (Exception ignored) {
                    diag("  " + pkg);
                }
            }
        }
    }

    // ── Aşama 2: ServiceManager — TÜM servisler ────────────────────────────

    private void inspectServiceManager() {
        try {
            Class<?> sm = Class.forName("android.os.ServiceManager");

            // Bilinen CAN isimlerini dene
            java.lang.reflect.Method getService = sm.getMethod("getService", String.class);
            for (String name : SERVICE_NAMES) {
                try {
                    if (getService.invoke(null, name) != null) diag("SvcMgr HIT: " + name);
                } catch (Exception ignored) {}
            }

            // Tüm sistem servislerini listele — filtresiz
            try {
                java.lang.reflect.Method listServices = sm.getMethod("listServices");
                Object result = listServices.invoke(null);
                if (result instanceof String[]) {
                    String[] services = (String[]) result;
                    diag("Tüm svc sayısı: " + services.length);
                    // Satır başına 5 servis — tanı günlüğü çok uzamasın
                    StringBuilder sb = new StringBuilder();
                    int count = 0;
                    for (String s : services) {
                        sb.append(s).append(" ");
                        count++;
                        if (count % 8 == 0) {
                            diag("svc: " + sb.toString().trim());
                            sb = new StringBuilder();
                        }
                    }
                    if (sb.length() > 0) diag("svc: " + sb.toString().trim());
                }
            } catch (Exception e) {
                diag("listServices hatası: " + e.getMessage());
            }

        } catch (Exception e) {
            diag("ServiceManager hatası: " + e.getMessage());
        }
    }

    // ── Aşama 3: Dosya / socket tabanlı okuma ────────────────────────────────

    private void inspectFiles() {
        for (String path : FILE_PATHS) {
            File f = new File(path);
            if (f.exists()) {
                diag("DOSYA/SOCKET MEVCUT" + (f.canRead() ? " [okunabilir]" : " [izin yok]") + ": " + path);
            }
        }
    }

    // ── Aşama 4: nwdaudio + nwdmanager + serial IBinder transact probe ──────────

    // ── nwdaudio canlı polling ────────────────────────────────────────────────
    // transact[1-3] yanıt veriyor. Değerlerin araç durumuyla değişip değişmediğini
    // görmek için 2s aralıkla poll ediyoruz. Önceki değerden farklıysa logla.

    private android.os.IBinder _nwdAudioBinder = null;
    private String             _nwdAudioIface  = null;
    private final int[]        _nwdLastVals    = new int[32]; // transact code → last int value
    private volatile boolean   _nwdPolling     = false;

    private void probeNwdAudio() {
        try {
            Class<?> sm = Class.forName("android.os.ServiceManager");
            java.lang.reflect.Method getService = sm.getMethod("getService", String.class);

            probeNwdManager(getService);
            probeSerialService(getService);

            // nwdaudio — yanıt veriyor, içeriği tam decode et
            String[] nwdServices = { "nwdaudio", "nwd_audio", "nwd.audio", "nwd_can", "nwdcan" };
            for (String name : nwdServices) {
                try {
                    Object obj = getService.invoke(null, name);
                    if (!(obj instanceof android.os.IBinder)) continue;
                    android.os.IBinder b = (android.os.IBinder) obj;
                    String iface = b.getInterfaceDescriptor();
                    diag("NWD BINDER BULUNDU: " + name + " iface=" + iface);
                    _nwdAudioBinder = b;
                    _nwdAudioIface  = iface != null ? iface : "";

                    // İlk tarama: kod 1-30 arası — tam decode
                    java.util.Arrays.fill(_nwdLastVals, Integer.MIN_VALUE);
                    _nwdFullScan(b, _nwdAudioIface);

                    // Canlı polling başlat (2s arayla — değer değişimini yakala)
                    if (!_nwdPolling) {
                        _nwdPolling = true;
                        // 2s → 10s: nwdaudio binder transact'i sürekli CPU yiyordu; değer
                        // değişimini yakalamak için 10s yeterli, yük 5× azalır.
                        _exec.scheduleAtFixedRate(this::_nwdPollTick, 10_000, 10_000, TimeUnit.MILLISECONDS);
                    }
                    break; // ilk bulunan yeterli
                } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            diag("probeNwdAudio hatası: " + e.getMessage());
        }
    }

    /** Kod 1-30 arası tam tarama — hex dump + int + string deneme */
    private void _nwdFullScan(android.os.IBinder b, String iface) {
        for (int code = 1; code <= 30; code++) {
            android.os.Parcel req  = android.os.Parcel.obtain();
            android.os.Parcel resp = android.os.Parcel.obtain();
            try {
                req.writeInterfaceToken(iface);
                if (!b.transact(code, req, resp, 0)) continue;
                int size = resp.dataAvail();
                if (size == 0) continue;

                // Tam byte dump
                byte[] raw = new byte[Math.min(size, 64)];
                resp.setDataPosition(0);
                for (int i = 0; i < raw.length; i++) raw[i] = resp.readByte();

                // Integer yorumu (exception kodu atla)
                resp.setDataPosition(0);
                int excCode = (size >= 4) ? resp.readInt() : -1;
                int intVal  = (size >= 8) ? resp.readInt() : -1;

                // String yorumu
                String strVal = null;
                try {
                    resp.setDataPosition(0);
                    resp.readException(); // exception'ı atla
                    strVal = resp.readString();
                } catch (Exception ignored) {}

                String hexStr = _toHex(raw);
                diag(String.format("nwdaudio[%d] size=%d hex=%s exc=%d int=%d%s",
                    code, size, hexStr, excCode, intVal,
                    (strVal != null && !strVal.isEmpty() ? " str=\"" + strVal + "\"" : "")));

                // Polling için son değeri kaydet (exception sonrası int)
                if (code < _nwdLastVals.length) _nwdLastVals[code] = intVal;

            } catch (Exception e) {
                // silent — çoğu kod yanıtsız
            } finally {
                req.recycle();
                resp.recycle();
            }
        }
    }

    /** 2s polling tick — sadece değişen değerleri logla */
    private void _nwdPollTick() {
        android.os.IBinder b = _nwdAudioBinder;
        if (b == null || !_started) return;

        // Yalnızca önceden yanıt veren kodları kontrol et (1-10)
        for (int code = 1; code <= 10; code++) {
            android.os.Parcel req  = android.os.Parcel.obtain();
            android.os.Parcel resp = android.os.Parcel.obtain();
            try {
                req.writeInterfaceToken(_nwdAudioIface);
                if (!b.transact(code, req, resp, 0)) continue;
                if (resp.dataAvail() < 8) continue;

                resp.setDataPosition(0);
                resp.readInt(); // exception kodu
                int val = resp.readInt();

                if (code < _nwdLastVals.length && val != _nwdLastVals[code]) {
                    diag(String.format("nwdaudio[%d] DEĞİŞTİ: %d → %d",
                        code, _nwdLastVals[code], val));
                    _nwdLastVals[code] = val;
                }
            } catch (Exception ignored) {
            } finally {
                req.recycle();
                resp.recycle();
            }
        }
    }

    private static String _toHex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02X", x));
        return sb.toString();
    }

    // ── ContentProvider sorgusu ───────────────────────────────────────────────

    // ── nwdmanager probe ──────────────────────────────────────────────────────

    private void probeNwdManager(java.lang.reflect.Method getService) {
        String[] candidates = { "nwdmanager", "nwd_manager", "NwdManager" };
        for (String name : candidates) {
            try {
                Object binder = getService.invoke(null, name);
                if (!(binder instanceof android.os.IBinder)) continue;
                android.os.IBinder b = (android.os.IBinder) binder;
                String iface = b.getInterfaceDescriptor();
                diag("NWDMANAGER BINDER BULUNDU: " + name + " iface=" + (iface != null ? iface : "null"));

                // Transact 1-10 probe
                for (int code = 1; code <= 10; code++) {
                    android.os.Parcel req  = android.os.Parcel.obtain();
                    android.os.Parcel resp = android.os.Parcel.obtain();
                    try {
                        if (iface != null) req.writeInterfaceToken(iface);
                        boolean ok = b.transact(code, req, resp, 0);
                        if (ok && resp.dataAvail() > 0) {
                            // dataAvail() okudukça azalır → önce boyutu yakala, sonra hex dök.
                            // transact[2] 564B veri döndürüyor (tanı bulgusu); payload'u görmeliyiz.
                            int sz = resp.dataAvail();
                            int readLen = Math.min(sz, 256);
                            byte[] bytes = new byte[readLen];
                            resp.setDataPosition(0);
                            for (int i = 0; i < readLen; i++) bytes[i] = resp.readByte();
                            String trunc = sz > 256 ? " (+…" + (sz - 256) + ")" : "";
                            diag("NWDMANAGER transact[" + code + "] → " + sz + "B" + trunc
                                + " hex=" + _toHex(bytes));
                        }
                    } catch (Exception ignored) {}
                    finally { req.recycle(); resp.recycle(); }
                }
            } catch (Exception ignored) {}
        }
    }

    // ── serial (SerialManager) probe ─────────────────────────────────────────

    private void probeSerialService(java.lang.reflect.Method getService) {
        try {
            Object binder = getService.invoke(null, "serial");
            if (!(binder instanceof android.os.IBinder)) {
                diag("SerialManager: binder null (izin yok veya servis kapalı)");
                return;
            }
            android.os.IBinder b = (android.os.IBinder) binder;
            diag("SerialManager BINDER BULUNDU — port listesi sorgulanıyor");

            // getSerialPorts() — transact code 1
            android.os.Parcel req  = android.os.Parcel.obtain();
            android.os.Parcel resp = android.os.Parcel.obtain();
            try {
                req.writeInterfaceToken("android.hardware.ISerialManager");
                boolean ok = b.transact(1, req, resp, 0);
                if (ok) {
                    try { resp.readException(); } catch (Exception ignored) {}
                    String[] ports = resp.createStringArray();
                    if (ports != null && ports.length > 0) {
                        diag("SerialManager PORT LİSTESİ: " + java.util.Arrays.toString(ports));
                    } else {
                        diag("SerialManager getSerialPorts → boş (izin kısıtı olabilir)");
                    }
                } else {
                    diag("SerialManager transact(1) başarısız");
                }
            } finally {
                req.recycle();
                resp.recycle();
            }
        } catch (Exception e) {
            diag("SerialManager probe hatası: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    private VehicleCanData queryUri(String uriStr) {
        try {
            // Provider HİÇ yoksa cr.query() exception fırlatmaz, null döner ama framework
            // her çağrıda "E/ActivityThread: Failed to find provider info" loglar. Bu
            // ROM'da olmayan authority'ler (ör. com.hiworld.canbox) her 3sn × 234 URI
            // tekrar sorgulanıp CPU/GC/log seli yapıyordu. Authority'yi bir kez çöz;
            // yoksa kalıcı kara listeye al (PowerVR/Allwinner zayıf cihazda kritik).
            Uri u = Uri.parse(uriStr);
            String auth = u.getAuthority();
            if (auth != null && _ctx.getPackageManager().resolveContentProvider(auth, 0) == null) {
                _blocked.add(uriStr);
                return null;
            }
            ContentResolver cr = _ctx.getContentResolver();
            try (Cursor c = cr.query(u, null, null, null, null)) {
                if (c == null || c.getCount() == 0) return null;
                c.moveToFirst();
                return extractRow(c);
            }
        } catch (SecurityException se) {
            // export edilmemiş provider → kalıcı kilit. Bir kez logla, bir daha deneme
            // (her 500ms tekrar denemek log'u şişirir ve broadcast satırlarını gizler).
            if (_blocked.add(uriStr)) {
                diag("İzin kilidi (atlanıyor): " + uriStr);
            }
        } catch (Exception ignored) {}
        return null;
    }

    private VehicleCanData extractRow(Cursor c) {
        if (c.getColumnNames() == null || c.getColumnNames().length == 0) return null;
        VehicleCanData.Builder b = new VehicleCanData.Builder();
        boolean any = false;

        int nameIdx  = findColumn(c, "name","key","signal","signal_name");
        int valueIdx = findColumn(c, "value","val","data","signal_value");

        if (nameIdx >= 0 && valueIdx >= 0) {
            do {
                String name = c.getString(nameIdx);
                String val  = c.getString(valueIdx);
                if (name == null || val == null) continue;
                name = name.toLowerCase().trim();
                try {
                    float fv = Float.parseFloat(val);
                    boolean bv = fv != 0f;
                    if      (matchesAny(name, COL_SPEED)   && fv >= 0 && fv <= SPEED_MAX) { b.speed(fv);       any = true; }
                    else if (matchesAny(name, COL_RPM)     && fv >= 0 && fv <= RPM_MAX)   { b.rpm(fv);         any = true; }
                    else if (matchesAny(name, COL_FUEL)    && fv >= 0 && fv <= 100)        { b.fuel(fv);        any = true; }
                    else if (matchesAny(name, COL_COOLANT) && fv >= TEMP_MIN && fv <= TEMP_MAX) { b.coolantTemp(fv); any = true; }
                    else if (matchesAny(name, COL_REVERSE))                                { b.reverse(bv);     any = true; }
                    else if (matchesAny(name, COL_GEAR))                                   { b.gearPos((int)fv); any = true; }
                } catch (NumberFormatException ignored) {}
            } while (c.moveToNext());
            return any ? b.build() : null;
        }

        Float speed = getColFloat(c, COL_SPEED);
        if (speed    != null && speed >= 0 && speed <= SPEED_MAX)        { b.speed(speed);         any = true; }
        Float rpm   = getColFloat(c, COL_RPM);
        if (rpm      != null && rpm >= 0 && rpm <= RPM_MAX)              { b.rpm(rpm);             any = true; }
        Float fuel  = getColFloat(c, COL_FUEL);
        if (fuel     != null && fuel >= 0 && fuel <= 100)                { b.fuel(fuel);            any = true; }
        Float cool  = getColFloat(c, COL_COOLANT);
        if (cool     != null && cool >= TEMP_MIN && cool <= TEMP_MAX)    { b.coolantTemp(cool);     any = true; }
        Boolean rev = getColBool(c, COL_REVERSE);
        if (rev      != null)                                             { b.reverse(rev);          any = true; }
        Integer gear = getColInt(c, COL_GEAR);
        if (gear     != null)                                             { b.gearPos(gear);         any = true; }

        return any ? b.build() : null;
    }

    // ── ContentObserver ───────────────────────────────────────────────────────

    private void _registerObserver(String uriStr) {
        _unregisterObserver();
        final Uri uri = Uri.parse(uriStr);
        _observer = new ContentObserver(_handler) {
            @Override public void onChange(boolean selfChange) {
                if (_started) _exec.execute(K24CanBridge.this::tick);
            }
        };
        try { _ctx.getContentResolver().registerContentObserver(uri, true, _observer); }
        catch (Exception ignored) {}
    }

    private void _unregisterObserver() {
        if (_observer != null && _ctx != null) {
            try { _ctx.getContentResolver().unregisterContentObserver(_observer); }
            catch (Exception ignored) {}
            _observer = null;
        }
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    private void dispatch(VehicleCanData data) {
        DecodedListener cb = _listener;
        if (cb != null) cb.onData(data);
    }

    private void diag(String msg) {
        Log.d(TAG, msg);
        DiagListener cb = _diag;
        if (cb != null) cb.onDiag(msg);
    }

    // ── Cursor yardımcıları ───────────────────────────────────────────────────

    private static int findColumn(Cursor c, String... names) {
        for (String n : names) { int i = c.getColumnIndex(n); if (i >= 0) return i; }
        return -1;
    }
    private static Float getColFloat(Cursor c, String[] keys) {
        for (String k : keys) {
            int i = c.getColumnIndex(k); if (i < 0) continue;
            try {
                int t = c.getType(i);
                if (t == Cursor.FIELD_TYPE_FLOAT)   return c.getFloat(i);
                if (t == Cursor.FIELD_TYPE_INTEGER)  return (float) c.getInt(i);
                if (t == Cursor.FIELD_TYPE_STRING) { String s = c.getString(i); if (s != null) return Float.parseFloat(s.trim()); }
            } catch (Exception ignored) {}
        }
        return null;
    }
    private static Integer getColInt(Cursor c, String[] keys) {
        Float f = getColFloat(c, keys); return f != null ? Math.round(f) : null;
    }
    private static Boolean getColBool(Cursor c, String[] keys) {
        for (String k : keys) {
            int i = c.getColumnIndex(k); if (i < 0) continue;
            try {
                int t = c.getType(i);
                if (t == Cursor.FIELD_TYPE_INTEGER) return c.getInt(i) != 0;
                if (t == Cursor.FIELD_TYPE_STRING)  { String s = c.getString(i); if (s != null) return "1".equals(s.trim()) || "true".equalsIgnoreCase(s.trim()); }
            } catch (Exception ignored) {}
        }
        return null;
    }
    private static boolean matchesAny(String name, String[] variants) {
        for (String v : variants) if (v.equalsIgnoreCase(name)) return true;
        return false;
    }
}
