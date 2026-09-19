package com.cockpitos.pro.can;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * SerialPortHandler — Industrial-grade UART okuyucu/yazıcı.
 *
 * Android head unit'lerde /dev/ttyS* portları genellikle root/system yetkisi
 * gerektirir. Bu sınıf açılış öncesinde iki yöntem dener:
 *
 *   1. "su -c chmod 666 <port>"  — rooted cihazlar (çoğu aftermarket head unit)
 *   2. "chmod 666 <port>"        — zaten yetki varsa veya sistem app olarak kuruluysa
 *
 * Port tarama sırası: önce yaygın head unit yolları, sonra USB serial.
 *
 * Frame protokolü (binary):
 *   [0xAA][ID_HIGH][ID_LOW][DLC][D0..DN][XOR_CRC][0x55]
 *
 * YASAK: Seri porta whitelist dışı veri YAZAMAz.
 *
 * ── MRI F-01 (2026-09-19) — KANITSIZ PORTA DOKUNMA ─────────────────────────
 * Eski davranış "açılabilen ilk porta bağlan → heartbeat yaz → cevap bekle"
 * idi. K24'te /dev/ttyS2 OEM MCU hattıyla çakışıp cihazı resetledi; deny-list
 * yalnız o üniteyi kurtardı. Sistemik invariant artık şudur:
 *
 *   openable port ≠ owned port ≠ CAN port ≠ safe-to-write port
 *
 * Yeni sıra: DISCOVER → (sahiplik kararı) → OBSERVE (salt-okuma) → IDENTIFY
 * (CRC'li protokol kanıtı) → SELECT → ancak sonra ACTIVE WRITE.
 *
 *   · Bir port ancak POZİTİF kanıtla AÇILIR: platform allow-list eşleşmesi
 *     (`KNOWN_CAN_PORTS`) ya da root ile ÖLÇÜLMÜŞ "hiçbir süreç bu portu
 *     tutmuyor" (`/proc/<pid>/fd` taraması). Ölçülemiyorsa (root yok) port
 *     UNPROVABLE'dır ve HİÇ açılmaz — "dosya var", "chmod başarılı",
 *     "115200 kabul etti" kanıt DEĞİLDİR.
 *   · `su chmod` / `stty` yalnız kararı geçmiş porta uygulanır.
 *   · Yazma (`writeCommand`) ancak `isWriteAuthorized()` iken mümkündür:
 *     platform eşleşmesi VEYA pasif olarak okunmuş ≥ PROTOCOL_EVIDENCE_FRAMES
 *     CRC-geçerli frame. Heartbeat da bu kapıdan geçer (CanBusManager).
 *   · Gözlem penceresinde tek geçerli frame gelmezse port kapatılır, süreli
 *     olarak yeniden denenmez ve CAN "kanıt yok" olarak kalır (fail-closed).
 *   · Tek fiziksel port → tek aktif sahip: `claimPort/releasePort` kaydı.
 */
public final class SerialPortHandler {

    private static final String TAG = "SerialPortHandler";

    // ── MRI F-01: sahiplik kararı ve yazma kapısı ────────────────────────────

    /** Aday port için verilen karar — yalnız FREE ve PLATFORM_MAPPED açılabilir. */
    public enum PortVerdict {
        /** cmdline/init.rc/sabit liste: OEM bileşenine ait — DOKUNMA. */
        OEM_OWNED,
        /** Ölçüldü: başka bir süreç portu açık tutuyor — DOKUNMA. */
        FOREIGN_HELD,
        /** Sahiplik ölçülemedi (root/erişim yok) — kanıtsız, AÇILMAZ. */
        UNPROVABLE,
        /** Ölçüldü: hiçbir süreç tutmuyor — salt-okuma gözlem yapılabilir. */
        FREE,
        /** Sahada doğrulanmış platform→CAN UART eşleşmesi — gözlem + yazma. */
        PLATFORM_MAPPED,
    }

    /**
     * SAHADA DOĞRULANMIŞ platform → CAN UART eşleşmeleri (POZİTİF allow-list).
     * Anahtar `ro.hardware`/`ro.product.device` içinde geçer; değer TEK port.
     *
     * BUGÜN BOŞTUR — bilinçli. Repo'da UART üzerinden CAN aldığı sahada
     * kanıtlanmış hiçbir head unit yoktur (K24 CAN'ı OEM broadcast'inden alır).
     * Kanıtsız bir satır eklemek, tam olarak kaçınılan "ilk açılan port" yalanını
     * başka adla geri getirir. Satır eklemenin şartı: o ünitede CRC'li frame
     * akışının ölçülüp DEVICE_VALIDATION_LEDGER'a yazılmış olması.
     */
    static final String[][] KNOWN_CAN_PORTS = {};

    /** Pasif protokol kanıtı eşiği: bu kadar CRC-geçerli frame → yazma yetkisi. */
    static final int  PROTOCOL_EVIDENCE_FRAMES = 3;
    /** Gözlem penceresi: bu süre içinde tek geçerli frame yoksa port bırakılır. */
    static final long OBSERVE_WINDOW_MS        = 20_000L;
    /** Kanıt vermeyen port bu süre yeniden denenmez (tarama fırtınası önleme). */
    static final long NO_EVIDENCE_COOLDOWN_MS  = 10 * 60_000L;
    /** Root sahiplik probu için üst süre — `su` diyaloğu asılı kalmasın. */
    private static final long PROBE_TIMEOUT_MS  = 4_000L;

    /** Tek fiziksel port → tek aktif sahip. Değer: sahip etiketi. */
    private static final java.util.concurrent.ConcurrentHashMap<String, String> _claims =
        new java.util.concurrent.ConcurrentHashMap<>();
    /** Gözlem penceresinde kanıt vermeyen portlar → yeniden deneme zamanı (epoch ms). */
    private static final java.util.concurrent.ConcurrentHashMap<String, Long> _noEvidenceUntil =
        new java.util.concurrent.ConcurrentHashMap<>();

    /** Portu bu sahip adına kilitler; başkası tutuyorsa false (ARBITRATION_CONFLICT). */
    static boolean claimPort(String portPath, String owner) {
        String prev = _claims.putIfAbsent(portPath, owner);
        if (prev != null && !prev.equals(owner)) {
            SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.ARBITRATION_CONFLICT,
                portPath, "held_by=" + prev + " requested_by=" + owner);
            return false;
        }
        return true;
    }

    /** Sahiplik kaydını yalnız aynı sahip bırakabilir. */
    static void releasePort(String portPath, String owner) {
        if (portPath == null) return;
        _claims.remove(portPath, owner);
    }

    /** Port şu an bir sahip tarafından tutuluyor mu (arbitration sorgusu). */
    public static boolean isPortClaimed(String portPath) {
        return portPath != null && _claims.containsKey(portPath);
    }

    /** Port kanıt-yok soğumasında mı (tarama bu porta dönmez). */
    static boolean isInNoEvidenceCooldown(String portPath) {
        Long until = _noEvidenceUntil.get(portPath);
        return until != null && System.currentTimeMillis() < until;
    }

    /** Yalnız test: kayıt/soğuma/önbellek durumunu sıfırlar. */
    static void resetRegistriesForTest() {
        _claims.clear();
        _noEvidenceUntil.clear();
        _ownedCache.clear();
    }

    /** Bu açılışın kararı (kapalıyken null). */
    private volatile PortVerdict _openVerdict = null;
    /** Açılıştan beri okunan CRC-geçerli frame sayısı (pasif kanıt). */
    private volatile int  _validFrames  = 0;
    /** Portun açıldığı an (gözlem penceresi tabanı). */
    private volatile long _openedAtMs   = 0L;
    /** Yazma reddi yalnız bir kez loglanır (spam yok). */
    private volatile boolean _writeRefusedLogged = false;

    /**
     * Head unit'lerde yaygın UART port yolları.
     * Sıralama önemli: önce en yaygın head unit portları dene.
     *
     * Allwinner (A64/H6):     ttyS1, ttyS2, ttyS3
     * Rockchip (RK3399/3288): ttyS1, ttyS4, ttyS5
     * MediaTek (MT8167/8183): ttyMT1, ttyMT2
     * Qualcomm Snapdragon:    ttyHS0, ttyHS1
     * Generic Linux/UART:     ttyS0..ttyS4
     * USB-to-serial (fallback): ttyUSB0..ttyUSB3, ttyACM0
     */
    /** Sistem sahipliği kararının önbelleği — port taraması sıcak yolda çalışır. */
    private static final java.util.concurrent.ConcurrentHashMap<String, Boolean> _ownedCache =
        new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * SAHADA ÖLÇÜLMÜŞ port sahipliği — init.rc okunamasa bile geçerli son savunma.
     *
     * Anahtar: `ro.hardware` veya `ro.product.device` · Değer: DOKUNULMAZ portlar.
     * K24 (Allwinner ceres-b3 / sun50iw10p1), 2026-08-05 canlı ölçüm:
     *   ttyS1 = OEM Bluetooth HCI (gocsdk_8800 @1.5 Mbaud) — açılırsa BT TAMAMEN ölür
     *   ttyS3 = GNSS/GPS HAL
     *   ttyS0 = kernel konsolu
     * Bu ünitede CAN, UART'tan DEĞİL OEM broadcast'inden gelir
     * (bkz. SystemCanBroadcastAdapter) — port taraması burada zaten kazanç sağlamaz,
     * yalnız zarar verir.
     *
     * ── ttyS2 EKLENDİ (SAHA 2026-09-03, ölçülmüş sert reset zinciri) ──────────
     * Aynı sınıf hata, bu kez ttyS2'de ve sonucu çok daha ağır: cihaz komple
     * resetleniyordu. Canlı yakalanan zincir:
     *   21:14:01.897  CanBusManager başlatıldı
     *   21:14:02.111  Bağlandı → UART:/dev/ttyS2 @ 115200      ← port AÇILDI
     *   21:14:02.220  Heartbeat gönderildi                      ← MCU'ya yazım başladı
     *   21:14:04.287  Heartbeat gönderildi
     *   21:14:16      cihaz ÖLDÜ (kernel log'unda TEK satır uyarı yok)
     * Kernel'de hiçbir panic/oops/watchdog izi olmaması, gücün YAZILIMDAN DEĞİL
     * MCU tarafından kesildiğinin kanıtıdır. ttyS2 bu ünitede OEM'in MCU kontrol
     * hattıdır: `nwdapp_UartCommunication` aynı hatta kendi çerçevelerini yazar
     * (ör. `F004001800001C`). İki yazıcı = bozulan protokol = MCU kartı resetler.
     * Kullanıcı gözlemiyle birebir örtüşür: uygulama KAPALIYKEN cihaz günlerce
     * ayakta, AÇILINCA dakikalar içinde reset.
     */
    private static final String[][] KNOWN_OWNED_PORTS = {
        { "sun50iw10p1", "/dev/ttyS1", "/dev/ttyS2", "/dev/ttyS3", "/dev/ttyS0" },
        { "ceres-b3",    "/dev/ttyS1", "/dev/ttyS2", "/dev/ttyS3", "/dev/ttyS0" },
    };

    /** UART sahipliğinin yazılı olduğu init dosyaları (head unit ROM'ları). */
    private static final String[] INIT_RC_FILES = {
        "/vendor/etc/init/hw/init.sun50iw10p1.rc",   // Allwinner K24 / ceres-b3
        "/vendor/etc/init/hw/init.rk30board.rc",     // Rockchip
        "/vendor/etc/init/hw/init.mt8167.rc",        // MediaTek
        "/init.rc",
    };

    private static final String[] PORT_CANDIDATES = {
        "/dev/ttyS1",
        "/dev/ttyS2",
        "/dev/ttyS0",
        "/dev/ttyS3",
        "/dev/ttyS4",
        "/dev/ttyMT1",
        "/dev/ttyMT2",
        "/dev/ttyMT0",
        "/dev/ttyHS0",
        "/dev/ttyHS1",
        "/dev/ttyHS2",
        "/dev/ttyAMA0",
        "/dev/ttyUSB0",
        "/dev/ttyUSB1",
        "/dev/ttyACM0",
    };

    public static final int BAUD_38400  = 38400;
    public static final int BAUD_115200 = 115200;

    // Frame protocol
    private static final byte FRAME_START = (byte) 0xAA;
    private static final byte FRAME_END   = (byte) 0x55;
    private static final int  MAX_DLC     = 8;

    private static final int BUF_SIZE    = 8_192;
    private static final int CB_CAPACITY = 65_536;

    // Circular Buffer
    private final byte[]  _cb     = new byte[CB_CAPACITY];
    private volatile int  _cbHead = 0;
    private volatile int  _cbTail = 0;
    private final Object  _cbLock = new Object();

    private volatile BufferedInputStream _bis       = null;
    private volatile OutputStream        _outStream = null;
    private volatile String              _openPort  = null;

    private volatile Thread  _fillThread  = null;
    private volatile boolean _fillRunning = false;

    // ── Bağlantı ────────────────────────────────────────────────────────────

    public boolean open(int baudRate) {
        for (String port : PORT_CANDIDATES) {
            // SAHA 2026-08-05 (K24 / Allwinner sun50iw10p1): SAHİPLİ PORTA DOKUNMA.
            // Bu ünitede /dev/ttyS1, OEM Bluetooth yığınının (gocsdk_8800, 1.5 Mbaud)
            // HCI hattıdır. Port taraması onu açınca iki süreç aynı UART'tan okuyor,
            // HCI çerçeveleri bölünüyor ve OEM daemon'ı "Cur BT Init Failed" verip
            // kendini öldürüyor; yeniden başlarken de `svc bluetooth disable` çağırıyor.
            // Sonuç: head unit'in Bluetooth'u TAMAMEN ölüyor ve hiçbir OBD adaptörü
            // (bizimki dahil) bulunamıyor. Aynı tuzak ttyS0 (kernel konsolu) ve
            // GPS/GNSS portu için de geçerlidir.
            if (!new java.io.File(port).exists()) continue;   // yok → aday bile değil
            SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.CANDIDATE_DISCOVERED, port, "baud=" + baudRate);

            if (isPortOwnedBySystem(port)) {
                Log.w(TAG, "Port ATLANDI (sistem sahipli, ör. OEM Bluetooth UART): " + port);
                SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.REJECTED_OEM_OWNED, port, null);
                continue;
            }

            Long until = _noEvidenceUntil.get(port);
            if (until != null && System.currentTimeMillis() < until) {
                SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.REJECTED_COOLDOWN, port,
                    "retry_in_ms=" + (until - System.currentTimeMillis()));
                continue;
            }

            /* MRI F-01: POZİTİF kanıt olmadan port AÇILMAZ (chmod/stty de yapılmaz).
               Platform eşleşmesi yoksa sahiplik root ile ÖLÇÜLÜR; ölçülemiyorsa
               UNPROVABLE → fail-closed. "Deneyip görmek" artık bir seçenek değil:
               bir OEM UART'ını ikinci okuyucu olarak açmak bile HCI/GNSS akışını
               böler (2026-08-05 BT ölümü). */
            PortVerdict verdict = decideVerdict(
                false,
                isPlatformMappedCanPort(port),
                probeForeignOwner(port));
            switch (verdict) {
                case FOREIGN_HELD:
                    SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.REJECTED_FOREIGN_HELD, port, null);
                    continue;
                case UNPROVABLE:
                    SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.REJECTED_UNPROVABLE, port,
                        "root_probe_unavailable");
                    continue;
                case OEM_OWNED:
                    SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.REJECTED_OEM_OWNED, port, null);
                    continue;
                case FREE:
                case PLATFORM_MAPPED:
                    break;
            }

            if (!claimPort(port, CLAIM_OWNER)) continue;   // başka sahip → dokunma

            // İzin bypass — YALNIZ kararı geçmiş portta (root varsa chmod, yoksa doğrudan)
            tryGrantAccess(port);

            if (tryOpen(port, baudRate)) {
                _openPort     = port;
                _openVerdict  = verdict;
                _validFrames  = 0;
                _openedAtMs   = System.currentTimeMillis();
                _writeRefusedLogged = false;
                startFillThread();
                Log.i(TAG, "Port açıldı (" + verdict + ", salt-gözlem): " + port + " @ " + baudRate);
                SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.OBSERVING, port,
                    "verdict=" + verdict + " baud=" + baudRate);
                if (verdict == PortVerdict.PLATFORM_MAPPED) {
                    SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.WRITE_ENABLED, port, "platform_mapped");
                }
                return true;
            }
            releasePort(port, CLAIM_OWNER);
        }
        Log.w(TAG, "Hiçbir seri port açılamadı — stub mod");
        return false;
    }

    /** Bu sınıfın sahiplik etiketi (claim kaydı). */
    static final String CLAIM_OWNER = "FileSerialTransport";

    public void close() {
        stopFillThread();
        try { if (_bis       != null) { _bis.close();       _bis       = null; } } catch (IOException ignored) {}
        try { if (_outStream != null) { _outStream.close(); _outStream = null; } } catch (IOException ignored) {}
        releasePort(_openPort, CLAIM_OWNER);
        _openPort    = null;
        _openVerdict = null;
        _validFrames = 0;
        _openedAtMs  = 0L;
        synchronized (_cbLock) { _cbHead = 0; _cbTail = 0; }
        Log.d(TAG, "Port kapatıldı");
    }

    public boolean isOpen()   { return _bis != null; }
    public String  openPort() { return _openPort; }

    // ── MRI F-01: yazma kapısı / gözlem penceresi ───────────────────────────

    /**
     * Bu porta AKTİF yazma yetkisi var mı?
     * Platform eşleşmesi VEYA pasif olarak okunmuş ≥ PROTOCOL_EVIDENCE_FRAMES
     * CRC-geçerli frame. Başka hiçbir şey ("açıldı", "chmod oldu") yetki vermez.
     */
    public boolean isWriteAuthorized() {
        PortVerdict v = _openVerdict;
        if (v == null || !isOpen()) return false;
        return v == PortVerdict.PLATFORM_MAPPED || _validFrames >= PROTOCOL_EVIDENCE_FRAMES;
    }

    /** Okunan CRC-geçerli frame sayısı (teşhis). */
    public int validFrameCount() { return _validFrames; }

    /** Karar etiketi (teşhis; kapalıyken "CLOSED"). */
    public String evidenceLabel() {
        PortVerdict v = _openVerdict;
        if (v == null) return "CLOSED";
        if (isWriteAuthorized()) return v == PortVerdict.PLATFORM_MAPPED ? "PLATFORM_MAPPED" : "PROTOCOL_VERIFIED";
        return v + "_OBSERVING(" + _validFrames + "/" + PROTOCOL_EVIDENCE_FRAMES + ")";
    }

    /**
     * Gözlem penceresi doldu ve TEK geçerli frame gelmedi mi? Çağıran portu
     * kapatır; port soğumaya alınır ki tarama aynı sessiz porta dönüp durmasın.
     */
    public boolean observationExpired() {
        if (!isOpen() || _validFrames > 0 || _openVerdict == PortVerdict.PLATFORM_MAPPED) return false;
        return System.currentTimeMillis() - _openedAtMs > OBSERVE_WINDOW_MS;
    }

    /** Kanıt vermeyen portu soğumaya alır (çağıran ardından close() çağırır). */
    public void markNoEvidence() {
        String p = _openPort;
        if (p == null) return;
        _noEvidenceUntil.put(p, System.currentTimeMillis() + NO_EVIDENCE_COOLDOWN_MS);
        SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.NO_EVIDENCE_TIMEOUT, p,
            "window_ms=" + OBSERVE_WINDOW_MS + " cooldown_ms=" + NO_EVIDENCE_COOLDOWN_MS);
    }

    /**
     * YALNIZ TEST: donanımsız açık port taklidi. Gerçek `open()` yolunu (probe,
     * chmod, stty, fill thread) ATLAR; yalnız yazma kapısı / gözlem penceresi /
     * claim davranışını doğrulamak içindir.
     */
    boolean attachForTest(InputStream in, OutputStream out, String port, PortVerdict verdict, long openedAtMs) {
        if (!claimPort(port, CLAIM_OWNER)) return false;
        _bis          = new BufferedInputStream(in, BUF_SIZE);
        _outStream    = out;
        _openPort     = port;
        _openVerdict  = verdict;
        _validFrames  = 0;
        _openedAtMs   = openedAtMs;
        _writeRefusedLogged = false;
        return true;
    }

    /** CRC-geçerli frame okundu — pasif kanıt sayacı (readNextFrame ve test hook'u). */
    void noteValidFrame() {
        int n = ++_validFrames;
        if (n == PROTOCOL_EVIDENCE_FRAMES) {
            SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.PASSIVE_EVIDENCE, _openPort,
                "frames=" + n);
            if (_openVerdict != PortVerdict.PLATFORM_MAPPED) {
                SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.WRITE_ENABLED, _openPort, "protocol_verified");
            }
        }
    }

    /**
     * SAF karar — girdiler dışarıdan (test edilebilir, Android'e bağımsız).
     *
     * @param oemOwned        cmdline/init.rc/sabit liste sahipli mi
     * @param platformMapped  KNOWN_CAN_PORTS eşleşmesi var mı
     * @param foreignOwner    root probu: TRUE=başka süreç tutuyor, FALSE=serbest,
     *                        null=ölçülemedi
     */
    static PortVerdict decideVerdict(boolean oemOwned, boolean platformMapped, Boolean foreignOwner) {
        if (oemOwned)                 return PortVerdict.OEM_OWNED;
        if (platformMapped)           return PortVerdict.PLATFORM_MAPPED;
        if (foreignOwner == null)     return PortVerdict.UNPROVABLE;
        if (foreignOwner)             return PortVerdict.FOREIGN_HELD;
        return PortVerdict.FREE;
    }

    /** `KNOWN_CAN_PORTS` allow-list eşleşmesi (ro.hardware / ro.product.device). */
    static boolean isPlatformMappedCanPort(String portPath) {
        return isPlatformMappedCanPort(portPath, systemProp("ro.hardware"), systemProp("ro.product.device"));
    }

    static boolean isPlatformMappedCanPort(String portPath, String hw, String dev) {
        for (String[] row : KNOWN_CAN_PORTS) {
            if (row.length < 2) continue;
            String plat = row[0];
            boolean hit = (hw != null && hw.contains(plat)) || (dev != null && dev.contains(plat));
            if (hit && row[1].equals(portPath)) return true;
        }
        return false;
    }

    /**
     * Root ile açık dosya tanıtıcısı taraması: portu tutan BAŞKA bir süreç var mı?
     *
     * Komut önce `/proc/1/fd`'yi listeleyebildiğini kanıtlar (yoksa root yok →
     * null = ölçülemedi), sonra tüm süreçlerin fd'lerinde port yolunu arar.
     * Kendi sürecimiz henüz portu açmadığı için kendi pid'imiz eşleşmez.
     * Süre sınırlı: `su` onay diyaloğu asılı kalırsa null döner (fail-closed).
     */
    private static Boolean probeForeignOwner(String portPath) {
        // Root yoksa her aday için `su` denemek anlamsız — sonuç bir süre önbelleklenir.
        Long unavailableUntil = _probeUnavailableUntil;
        if (unavailableUntil != null && System.currentTimeMillis() < unavailableUntil) return null;
        String script =
            "ls /proc/1/fd >/dev/null 2>&1 && echo CAROS_ENUM_OK; " +
            "for p in /proc/[0-9]*; do ls -l \"$p/fd\" 2>/dev/null | grep -qF '" + portPath + "' && echo OWNED:$p; done";
        String out = runCapture(new String[]{ "su", "-c", script }, PROBE_TIMEOUT_MS);
        Boolean verdict = parseOwnerProbe(out);
        if (verdict == null) _probeUnavailableUntil = System.currentTimeMillis() + NO_EVIDENCE_COOLDOWN_MS;
        return verdict;
    }

    /** Root probu ölçülemediyse bu ana kadar tekrar denenmez (epoch ms). */
    private static volatile Long _probeUnavailableUntil = null;

    /** SAF: probe çıktısını yoruma çevirir (test edilebilir). */
    static Boolean parseOwnerProbe(String out) {
        if (out == null || !out.contains("CAROS_ENUM_OK")) return null;   // ölçülemedi
        return out.contains("OWNED:");
    }

    /** Komutu çalıştırır, stdout'u döner; süre aşımı/hata → null. */
    private static String runCapture(String[] cmd, long timeoutMs) {
        Process p = null;
        try {
            p = Runtime.getRuntime().exec(cmd);
            final Process proc = p;
            final StringBuilder sb = new StringBuilder();
            Thread reader = new Thread(() -> {
                try (java.io.BufferedReader r = new java.io.BufferedReader(
                        new java.io.InputStreamReader(proc.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        if (sb.length() < 16_384) sb.append(line).append('\n');
                    }
                } catch (IOException ignored) { }
            }, "SerialOwnerProbe");
            reader.setDaemon(true);
            reader.start();
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < deadline) {
                try { p.exitValue(); break; } catch (IllegalThreadStateException still) {
                    Thread.sleep(50);
                }
            }
            try { p.exitValue(); } catch (IllegalThreadStateException still) {
                p.destroy();
                return null;   // süre aşımı → ölçülemedi
            }
            reader.join(500);
            return sb.toString();
        } catch (Exception e) {
            if (p != null) p.destroy();
            return null;
        }
    }


    // ── Sistem sahipli port koruması (saha 2026-08-05) ──────────────────────

    /**
     * Port başka bir sistem bileşenine mi ait — açmadan ÖNCE sorulur.
     *
     * İki kanıt kullanılır, ikisi de cihazdan okunur (sabit liste DEĞİL, çünkü
     * port haritası her head unit'te farklıdır):
     *
     *  1. Kernel komut satırı: `console=ttyS0,115200` → o port seri konsoldur.
     *  2. Açık dosya tanıtıcıları: başka bir süreç portu zaten tutuyorsa
     *     (OEM Bluetooth daemon'ı, GNSS servisi, CAN servisi) o port bize ait
     *     değildir. UART tek sahiplidir; ikinci okuyucu veriyi böler.
     *
     * Fail-soft: /proc okunamazsa false döner (eski davranış korunur).
     */
    static boolean isPortOwnedBySystem(String portPath) {
        Boolean cached = _ownedCache.get(portPath);
        if (cached != null) return cached;

        boolean owned = false;
        final String name = portPath.substring(portPath.lastIndexOf('/') + 1);

        // ── Kanıt 1: kernel konsolu ────────────────────────────────────────
        // `console=ttyS0,115200` → o port çekirdek log hattıdır; açmak hem
        // anlamsız veri verir hem konsolu bozar.
        try {
            String cmdline = readSmallFile("/proc/cmdline");
            if (cmdline != null && cmdline.contains("console=" + name)) owned = true;
        } catch (Throwable ignored) {}

        // ── Kanıt 3: sahada ölçülmüş platform haritası ─────────────────────
        // init.rc okunamazsa (SELinux enforcing, farklı ROM yolu) devreye girer.
        if (!owned) {
            try {
                String hw  = systemProp("ro.hardware");
                String dev = systemProp("ro.product.device");
                for (String[] row : KNOWN_OWNED_PORTS) {
                    String plat = row[0];
                    if ((hw != null && hw.contains(plat)) || (dev != null && dev.contains(plat))) {
                        for (int i = 1; i < row.length; i++) {
                            if (row[i].equals(portPath)) { owned = true; break; }
                        }
                    }
                    if (owned) break;
                }
            } catch (Throwable ignored) {}
        }

        // ── Kanıt 2: init servis tanımları ─────────────────────────────────
        // Head unit ROM'ları UART'ı argüman olarak servise verir, ör.:
        //   service gocsdk_8800 /system/bin/gocsdk_8800 /dev/ttyS1 1500000
        // Bu satır o portun OEM Bluetooth yığınına ait olduğunu SÖYLER.
        // Sahada (K24 / Allwinner sun50iw10p1) tam olarak bu port taranıp
        // açılıyordu; iki okuyucu HCI çerçevelerini bölünce OEM daemon'ı
        // "Cur BT Init Failed" verip `svc bluetooth disable` çağırıyor ve
        // head unit'in Bluetooth'u tamamen ölüyordu (hiçbir OBD adaptörü
        // bulunamıyor). Aynı desen GNSS/MCU servisleri için de korur.
        if (!owned) {
            for (String rc : INIT_RC_FILES) {
                String body = readSmallFile(rc);
                if (body == null) continue;
                if (initRcClaimsPort(body, portPath)) { owned = true; break; }
            }
        }

        _ownedCache.put(portPath, owned);
        return owned;
    }

    /** init.rc gövdesinde `service <ad> <binary> <port>` deseni portu sahipleniyor mu. */
    private static boolean initRcClaimsPort(String rcBody, String portPath) {
        int from = 0;
        while (true) {
            int i = rcBody.indexOf("service ", from);
            if (i < 0) return false;
            int end = rcBody.indexOf(0x0A, i);
            if (end < 0) end = rcBody.length();
            String line = rcBody.substring(i, end);
            // Tam eşleşme: "/dev/ttyS1" ile "/dev/ttyS10" karışmasın.
            int j = line.indexOf(portPath);
            if (j >= 0) {
                int after = j + portPath.length();
                char c = after < line.length() ? line.charAt(after) : ' ';
                if (!Character.isLetterOrDigit(c)) return true;
            }
            from = end;
        }
    }

    /** `ro.*` sistem özelliği — reflection ile (SystemProperties gizli API, fail-soft). */
    private static String systemProp(String key) {
        try {
            Class<?> sp = Class.forName("android.os.SystemProperties");
            java.lang.reflect.Method get = sp.getMethod("get", String.class);
            Object v = get.invoke(null, key);
            return v == null ? null : v.toString();
        } catch (Throwable t) {
            return null;
        }
    }

    /** Fail-soft okuma: yoksa/izin yoksa null (koruma devreye girmez, eski davranış). */
    private static String readSmallFile(String path) {
        java.io.FileInputStream in = null;
        try {
            in = new java.io.FileInputStream(path);
            byte[] buf = new byte[4096];
            int n = in.read(buf);
            return n > 0 ? new String(buf, 0, n) : null;
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) {}
        }
    }

    // ── İzin bypass ─────────────────────────────────────────────────────────

    /**
     * Portu okuma-yazma için erişilebilir yapar.
     *
     * 1. su ile chmod (rooted cihaz — çoğu aftermarket head unit)
     * 2. chmod'u doğrudan (sistem app veya zaten izinli)
     *
     * Her iki yöntem de sessizce başarısız olabilir — tryOpen() zaten test eder.
     */
    private static void tryGrantAccess(String portPath) {
        // Yöntem 1: root ile chmod
        runSilent(new String[]{ "su", "-c", "chmod 666 " + portPath });
        // Yöntem 2: root olmadan chmod (sistem uygulaması veya önceden izinli)
        runSilent(new String[]{ "chmod", "666", portPath });
    }

    private static void runSilent(String[] cmd) {
        try {
            Process p = Runtime.getRuntime().exec(cmd);
            p.waitFor();
        } catch (Exception ignored) {
            // Sessizce geç — başarısız olursa tryOpen() zaten reddeder
        }
    }

    // ── Fill Thread: kernel → Circular Buffer ───────────────────────────────

    private void startFillThread() {
        _fillRunning = true;
        _fillThread  = new Thread(() -> {
            byte[] tmp = new byte[512];
            while (_fillRunning && !Thread.currentThread().isInterrupted()) {
                BufferedInputStream bis = _bis;
                if (bis == null) {
                    try { Thread.sleep(50); } catch (InterruptedException e) { break; }
                    continue;
                }
                try {
                    int n = bis.read(tmp, 0, tmp.length);
                    if (n > 0) cbWrite(tmp, n);
                    else if (n == -1) break;
                } catch (IOException e) {
                    Log.w(TAG, "Fill hatası: " + e.getMessage());
                    break;
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }, "SerialFillThread");
        _fillThread.setDaemon(true);
        _fillThread.start();
    }

    private void stopFillThread() {
        _fillRunning = false;
        if (_fillThread != null) { _fillThread.interrupt(); _fillThread = null; }
    }

    // ── Circular Buffer ──────────────────────────────────────────────────────

    private void cbWrite(byte[] data, int len) throws InterruptedException {
        synchronized (_cbLock) {
            for (int i = 0; i < len; i++) {
                int nextHead = (_cbHead + 1) % CB_CAPACITY;
                if (nextHead == _cbTail) {
                    _cbTail = (_cbTail + 1) % CB_CAPACITY;
                }
                _cb[_cbHead] = data[i];
                _cbHead = nextHead;
            }
            _cbLock.notifyAll();
        }
    }

    private int cbRead(long timeoutMs) throws InterruptedException {
        synchronized (_cbLock) {
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (_cbHead == _cbTail) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) return -1;
                _cbLock.wait(remaining);
            }
            int b = _cb[_cbTail] & 0xFF;
            _cbTail = (_cbTail + 1) % CB_CAPACITY;
            return b;
        }
    }

    // ── Frame okuma ──────────────────────────────────────────────────────────

    public byte[] readNextFrame() throws InterruptedException {
        if (!isOpen() && _fillThread == null) {
            Thread.sleep(500);
            return null;
        }

        try {
            int b;
            do {
                b = cbRead(3_000);
                if (b == -1) return null;
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            } while ((byte) b != FRAME_START);

            int idHigh = cbRead(200); if (idHigh < 0) return null;
            int idLow  = cbRead(200); if (idLow  < 0) return null;
            int dlc    = cbRead(200); if (dlc    < 0 || dlc > MAX_DLC) return null;

            byte[] data = new byte[dlc];
            for (int i = 0; i < dlc; i++) {
                int d = cbRead(200);
                if (d < 0) return null;
                data[i] = (byte) d;
            }

            int crc = cbRead(200); if (crc < 0) return null;
            int end = cbRead(200); if ((byte) end != FRAME_END) return null;

            byte expected = (byte) ((idHigh ^ idLow ^ dlc) & 0xFF);
            for (byte db : data) expected ^= db;
            if ((byte) crc != expected) { Log.v(TAG, "CRC mismatch"); return null; }

            byte[] frame = new byte[2 + dlc];
            frame[0] = (byte) idHigh;
            frame[1] = (byte) idLow;
            System.arraycopy(data, 0, frame, 2, dlc);
            noteValidFrame();   // MRI F-01: CRC-geçerli frame = pasif protokol kanıtı
            return frame;

        } catch (Exception e) {
            Log.w(TAG, "Frame okuma hatası: " + e.getMessage());
            close();
            return null;
        }
    }

    // ── Komut yazma ──────────────────────────────────────────────────────────

    public boolean writeCommand(byte[] data) {
        if (data == null || data.length == 0) return false;
        if (data[0] != McuCommandFactory.FRAME_START || data[data.length - 1] != McuCommandFactory.FRAME_END) {
            Log.e(TAG, "writeCommand: geçersiz frame"); return false;
        }
        if (data.length >= 2 && !McuCommandFactory.isAllowed(data[1])) {
            Log.e(TAG, "writeCommand: whitelist dışı komut"); return false;
        }
        /* MRI F-01 YAZMA KAPISI: sahiplik/protokol kanıtı olmayan porta whitelist'teki
           komut bile (heartbeat dâhil) YAZILMAZ. Bu, K24'ü resetleyen ilk baytın
           tam olarak gittiği yerdir. */
        if (!isWriteAuthorized()) {
            if (!_writeRefusedLogged) {
                _writeRefusedLogged = true;
                SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.WRITE_REFUSED, _openPort,
                    "evidence=" + evidenceLabel());
            }
            return false;
        }
        OutputStream out = _outStream;
        if (out == null) return false;
        try { out.write(data); out.flush(); return true; }
        catch (IOException e) { Log.e(TAG, "writeCommand hatası: " + e.getMessage()); return false; }
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private boolean tryOpen(String portPath, int baudRate) {
        try {
            configureBaud(portPath, baudRate);
            InputStream raw = new FileInputStream(portPath);
            _bis = new BufferedInputStream(raw, BUF_SIZE);
            try { _outStream = new FileOutputStream(portPath, false); }
            catch (Exception e) { _outStream = null; }
            return true;
        } catch (SecurityException e) { Log.d(TAG, portPath + " erişim reddedildi"); }
          catch (IOException e)        { Log.d(TAG, portPath + " açılamadı"); }
        return false;
    }

    private void configureBaud(String portPath, int baudRate) {
        // stty önce su ile dene (rooted), sonra doğrudan
        String sttyCmd = "stty -F " + portPath + " " + baudRate + " raw -echo cs8 -cstopb";
        runSilent(new String[]{"su", "-c", sttyCmd});
        runSilent(new String[]{"sh", "-c", sttyCmd});
    }
}
