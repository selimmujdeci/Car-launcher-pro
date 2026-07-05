package com.cockpitos.pro.obd;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * OBDManager — ELM327 / Bluetooth OBD-II bağlantı + polling motoru (Phase 5).
 *
 * CarLauncherPlugin God Object'inden çıkarıldı. Bu sınıf YALNIZCA Bluetooth
 * soketi, ELM327 protokol diyaloğu, PID okuma ve polling döngüsünden sorumludur.
 *
 * KÖPRÜ AYRIMI (Bridge Separation):
 *   - Bu sınıf Capacitor'a (JSObject/PluginCall), notifyListeners'a veya
 *     SharedArrayBuffer köprüsüne ASLA dokunmaz.
 *   - Ham/çözümlenmiş veriyi {@link OnOBDDataListener} üzerinden Plugin'e bildirir;
 *     JS'e iletim (notifyListeners + SAB) sorumluluğu Plugin'de kalır.
 *
 * DAVRANIŞ KORUMASI (Zero-Change):
 *   - Protokol komutları, Thread.sleep değerleri ve PID parse mantığı CarLauncherPlugin'deki
 *     orijinaliyle BİREBİR aynıdır. JS'e giden veri formatı Plugin tarafında üretilir.
 */
public final class OBDManager {

    /**
     * OBD motoru → Plugin (köprü katmanı) bildirim arayüzü.
     *
     * Not: Veri kanalı bilinçli olarak String yerine TİPLİ (kayıpsız) tutuldu —
     * String'e serileştirmek Plugin'de JSObject/SAB veri yolunu yeniden parse
     * etmeyi gerektirir ve "JSON formatını/SAB'ı değiştirme" yasağını ihlal ederdi.
     */
    public interface OnOBDDataListener {
        /** Patch 6: her poll döngüsünde çözümlenmiş TÜM PID değerleri (bkz. {@link ObdPollSample}). */
        void onObdData(ObdPollSample sample);
        /**
         * Patch 8: EXTENDED grup ham PID sonucu — çözümleme TS'te (StandardPidRegistry,
         * tek doğruluk kaynağı). Yalnız BAŞARILI okumada çağrılır (NO_DATA iletilmez).
         * @param pid    2 hane hex PID (ör. "5C")
         * @param rawHex mode/pid başlığı soyulmuş ham data hex (ör. "8C")
         */
        void onExtendedPid(String pid, String rawHex);
        /** Asenkron durum değişimi (ör. poll sırasında bağlantı koptu). message null olabilir. */
        void onStatusChanged(String state, String message);
        /** Beklenmedik motor hatası. */
        void onError(String error);
        /**
         * Teşhis (ekrandan-okunur ham trafik): her ELM327 komut/yanıt çifti.
         * YALNIZ {@link #setTrafficCapture(boolean)} açıkken çağrılır (varsayılan KAPALI —
         * normal sürüşte sıfır ek yük). adb/logcat erişimi olmayan head unit'lerde
         * (T507 Dacia) OBD el sıkışması + ham DTC yanıtını ekranda görmek için tek yol.
         * default: geriye uyumlu — eski implementasyonlar kırılmaz.
         *
         * @param cmd  gönderilen komut (ör. "ATZ", "03")
         * @param resp ham yanıt (ör. "ELM327 v1.5", "43 01 71") — hata ise "⚠ ..." öneki
         * @param ms   komut→yanıt süresi (ms)
         */
        default void onObdTraffic(String cmd, String resp, long ms) {}
    }

    /** connect() için tek-seferlik (per-call) sonuç callback'i — PluginCall resolve/reject Plugin'de kalır. */
    public interface ConnectCallback {
        /** Patch 3: ATDPN ile okunan aktif protokol numarası (tek karakter) — yoksa null. */
        void onConnected(String detectedProtocol);
        /**
         * @param code Yapılandırılmış hata kodu — JS tarafı mesaj string'i parse ETMEDEN
         *             PROTOCOL_CYCLE ilerletme kararını buna göre verir.
         *             "OBD_UNABLE_TO_CONNECT" → ELM327 protokol/araç yanıtı alınamadı (0100 warm-up).
         *             "CONNECT_FAILED"        → diğer tüm bağlantı hataları (BT/soket/timeout).
         */
        void onFailed(String error, String code);
    }

    // SPP (Serial Port Profile) UUID — RFCOMM ELM327 adaptörleri için standart.
    private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    // Bluetooth/Intent işlemleri için saklanan uygulama context'i (constructor'dan).
    private final Context mContext;
    private final OnOBDDataListener listener;

    /**
     * Teşhis ham-trafik yakalama bayrağı — varsayılan KAPALI. JS teşhis paneli açılınca
     * {@link #setTrafficCapture(boolean)} ile açılır, kapanınca kapatılır. Static: tek
     * doğruluk kaynağı, RfcommChannel (Classic + WiFi TCP aynı kanal) buradan okur.
     */
    private static volatile boolean sTrafficCapture = false;

    /** Teşhis paneli köprüsü — ham trafik yakalamayı aç/kapat (bkz. {@link #sTrafficCapture}). */
    public static void setTrafficCapture(boolean on) { sTrafficCapture = on; }

    /**
     * Teşhis ham-trafik halka tamponu — son N komut/yanıt çifti. PC'nin ağdan (teşhis
     * HTTP sunucusu) çekebilmesi için native'de tutulur; JS köprüsünden (onObdTraffic)
     * BAĞIMSIZ. adb/logcat olmayan head unit'te PC'den ham OBD trafiğini okumanın yolu.
     */
    private static final int TRAFFIC_MAX = 300;
    private static final java.util.ArrayDeque<String[]> sTrafficRing = new java.util.ArrayDeque<>();

    /** Ham trafik çiftini halka tampona yazar (thread-safe). */
    private static void recordTraffic(long ts, String cmd, String resp, long ms) {
        synchronized (sTrafficRing) {
            if (sTrafficRing.size() >= TRAFFIC_MAX) sTrafficRing.pollFirst();
            sTrafficRing.addLast(new String[] { Long.toString(ts), cmd, resp, Long.toString(ms) });
        }
    }

    /** Halka tamponu JSON dizisi olarak döker (teşhis HTTP sunucusu tüketir). */
    public static String dumpTrafficJson() {
        StringBuilder sb = new StringBuilder(4096).append('[');
        synchronized (sTrafficRing) {
            boolean first = true;
            for (String[] e : sTrafficRing) {
                if (!first) sb.append(',');
                sb.append("{\"ts\":").append(e[0])
                  .append(",\"cmd\":\"").append(jsonEsc(e[1]))
                  .append("\",\"resp\":\"").append(jsonEsc(e[2]))
                  .append("\",\"ms\":").append(e[3]).append('}');
                first = false;
            }
        }
        return sb.append(']').toString();
    }

    /** Teşhis tamponunu temizler. */
    public static void clearTraffic() { synchronized (sTrafficRing) { sTrafficRing.clear(); } }

    /** Minimal JSON string kaçışı (tırnak, ters bölü, kontrol karakterleri). */
    private static String jsonEsc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n");  break;
                case '\r': b.append("\\r");  break;
                case '\t': b.append("\\t");  break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.toString();
    }

    private final ExecutorService obdExecutor = Executors.newSingleThreadExecutor();

    private volatile BluetoothSocket obdSocket  = null;
    private volatile InputStream     obdInput   = null;
    private volatile OutputStream    obdOutput  = null;
    private volatile boolean         obdRunning = false;

    /**
     * Patch 2 (iptal edilebilir native connect): deneme soketi — connect() ÇAĞRISINDAN
     * ÖNCE atanır (obdSocket'ten AYRI; obdSocket yalnız BAŞARILI bağlantıda dolar).
     * disconnect() bunu da kapatır → JS Promise.race timeout'u artık native tarafta
     * bloklu socket.connect()'i GERÇEKTEN iptal edebilir (close() başka thread'den
     * çağrıldığında bloklu connect() IOException ile uyanır — Android BluetoothSocket
     * sözleşmesi). Eskiden obdSocket yalnız dönüşte atandığından disconnect() burada
     * null görüyordu ve tek-thread executor'daki (obdExecutor) tıkalı deneme sonsuza
     * kadar arkasında kuyruklanan sonraki connect() çağrısını bloke ediyordu.
     */
    private volatile BluetoothSocket pendingSocket = null;

    // TCP (WiFi ELM327) bağlantısı — Classic BT alanlarından AYRI tutulur.
    // disconnect() her ikisini de kapatır (idempotent).
    private volatile Socket tcpSocket = null;

    /**
     * Patch 10 (WiFi ELM327 TCP transport): deneme soketi — connect() ÇAĞRISINDAN ÖNCE
     * atanır. pendingSocket'teki Patch 2 sözleşmesiyle BİREBİR aynı: disconnect() başka
     * thread'den close() çağırırsa bloklu Socket.connect() IOException ile uyanır —
     * java.net.Socket de BluetoothSocket gibi bu sözleşmeyi sağlar.
     */
    private volatile Socket pendingTcpSocket = null;

    /** WiFi ELM327 adaptörüne (AP modu, ör. 192.168.0.10:35000) bağlantı timeout'u. */
    private static final int TCP_CONNECT_TIMEOUT_MS = 8_000;

    /**
     * Savunmacı okuma-kilidi backstop'u — RfcommChannel.send() zaten kendi deadline'ını
     * (timeoutMs parametresi) available()/poll döngüsüyle yönetir; read() yalnız
     * available()>0 iken çağrılır, bu yüzden normal koşulda hiç bloklamaz. Bu soTimeout
     * yalnız soket/ağ seviyesinde donmuş bir bağlantıya karşı son çare korumasıdır —
     * ELM yanıt bekleme disiplinini DEĞİŞTİRMEZ.
     */
    private static final int TCP_SO_TIMEOUT_MS = 15_000;

    // ── Auto-reconnect (kendini iyileştiren transport) ─────────────────────────
    // Broken pipe / "stream kapandı" olduğunda poll döngüsü ölü sokete SONSUZA
    // kadar yazmak yerine SON başarılı bağlantıyı (BT MAC ya da ip:port) sınırlı
    // backoff'la yeniden kurar. Java Socket.isConnected() kopan sokette true kaldığı
    // için (close() çağrılana dek) transport canlılığına güvenilemez — bu yüzden
    // ardışık send hatası sayacı (commFailStreak) kopmayı tespit eder.
    // disconnect() bu defteri temizler → bilinçli kapanış sonrası reconnect DENENMEZ.
    private volatile String lastTransport = null;   // "bt" | "tcp" | null
    private volatile String lastAddress   = null;   // BT MAC ya da "ip:port"
    private volatile String lastPin       = null;   // BT PIN (yalnız ilk bağlantı; reconnect pairing yapmaz)
    /** Ardışık iletişim (send) hatası sayısı — send() thread'i yazar, pollLoop okur. */
    private volatile int    commFailStreak = 0;
    /** Kaç ardışık send hatasından sonra yeniden bağlanma tetiklenir. */
    private static final int RECONNECT_AFTER_FAILS  = 2;
    /** Bir kopma başına en fazla yeniden bağlanma denemesi. */
    private static final int MAX_RECONNECT_ATTEMPTS = 3;
    /** Denemeler arası backoff (adaptörün AP'yi/soketi toparlaması için). */
    private static final int RECONNECT_BACKOFF_MS   = 1500;

    // Transport-agnostik ELM327 protokol katmanı (init + PID parse).
    // RFCOMM stream'leri üzerinde RfcommChannel ile çalışır; davranış birebir korunur.
    private volatile ElmProtocol     elm        = null;

    /** Patch 3: initELM327()'den ATDPN ile okunan aktif protokol numarası (yoksa null). */
    private volatile String detectedProtocol = null;

    // JS → Native OBD contract (P2): connect ile gelen protokol + PID listesi.
    private volatile String                 obdProtocol = null;
    private volatile Set<String>            obdPidSet   = null;

    /**
     * Patch 5: tüm ELM327 komutları (poll PID okumaları + DTC oku/sil) bu ÖNCELİK SIRALI
     * kuyruktan geçer — eski elmLock (synchronized) serileştirmesinin yerini alır. USER
     * (DTC isteği) önceliği POLL_FAST/POLL_SLOW'un önüne geçer; en kötü ihtimalle TEK bir
     * komut kadar (~1.5s) bekler, eskiden olduğu gibi bir poll turu (4 komut, ~6s) kadar DEĞİL.
     */
    private final ElmCommandQueue cmdQueue = new ElmCommandQueue();

    /**
     * Patch 6 (AdaptivePollingController): FAST grup (hız/RPM) poll periyodu — eski sabit
     * Thread.sleep(3000) yerine geçer. setFastPollMs() ile TS tarafından (deviceTier + aktif
     * RuntimeMode) güncellenir; varsayılan 3000ms ESKİ davranışla birebir aynıdır.
     */
    private volatile int fastPollMs = 3000;

    /** SLOW grup (temp/fuel/throttle/intakeTemp/boostPressure) kaç FAST turda bir sorgulanır. */
    private static final int SLOW_GROUP_EVERY_N_CYCLES = 5;
    /** ATRV (12V akü voltajı) kaç FAST turda bir sorgulanır. */
    private static final int VOLTAGE_EVERY_N_CYCLES = 10;

    /** pollLoop() içindeki tur sayacı — yalnız o thread'den erişilir (volatile gerekmez). */
    private long pollCycle = 0;
    /** ATRV'nin son okunan değeri — aradaki turlarda bu değer JS'e tekrar gönderilir. */
    private volatile double lastVoltage = -1.0;

    /**
     * Patch 8: EXTENDED grup — TS'in setObdExtendedPids ile ilettiği (talep-güdümlü)
     * PID listesi. BOŞKEN TAM SIFIR maliyet: poll turu tek komut bile eklemez —
     * Mali-400/zayıf head unit kuralının native yarısı budur; kimse izlemiyorsa
     * adaptöre fazladan trafik gitmez. Doluyken turda EN FAZLA BİR PID round-robin
     * sorgulanır (FAST kadansı ne olursa olsun ek yük sabit ve düşük öncelikli).
     */
    private volatile java.util.List<String> extendedPids = java.util.Collections.emptyList();
    /** Round-robin imleci — yalnız pollLoop thread'inden erişilir. */
    private int extendedIdx = 0;

    public OBDManager(Context context, OnOBDDataListener listener) {
        this.mContext = context.getApplicationContext();
        this.listener = listener;
    }

    /**
     * ELM327 adaptörüne bağlanır ve polling döngüsünü başlatır (kendi executor'unda).
     * PluginCall resolve/reject sorumluluğu {@link ConnectCallback} ile Plugin'e bırakılır.
     */
    public void connect(final String address, final String pin, final String protocol,
                        final Set<String> pidSet, final ConnectCallback cb) {
        // submit'ten ÖNCE set edilir; initELM327/pollLoop güncel değeri görür.
        obdProtocol = present(protocol) ? protocol : null;
        obdPidSet   = pidSet;

        disconnect();

        // Auto-reconnect defteri: disconnect() az önce temizledi — reconnect'in aynı
        // cihaza dönebilmesi için SON başarılı bağlantı parametrelerini burada kaydet.
        lastTransport = "bt";
        lastAddress   = address;
        lastPin       = pin;

        obdExecutor.submit(() -> {
            try {
                BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
                if (bt == null) throw new IOException("Bluetooth desteklenmiyor");

                BluetoothDevice device = bt.getRemoteDevice(address);

                try { bt.cancelDiscovery(); } catch (SecurityException ignored) {}

                // ── Silent PIN Pairing ────────────────────────────────────
                // Cihaz eşleştirilmemiş (BOND_NONE) ve PIN sağlanmışsa
                // Android'in sistem diyaloğu göstermeden sessizce eşleştir.
                if (present(pin) && device.getBondState() != BluetoothDevice.BOND_BONDED) {
                    try {
                        device.setPin(pin.getBytes());
                        device.createBond();
                        // Eşleştirme tamamlanana kadar bekle — max 15 s
                        int waited = 0;
                        while (device.getBondState() != BluetoothDevice.BOND_BONDED && waited < 15_000) {
                            Thread.sleep(300);
                            waited += 300;
                        }
                        if (device.getBondState() != BluetoothDevice.BOND_BONDED) {
                            android.util.Log.w("OBD", "Silent pairing timeout — bağlantı yine de deneniyor");
                        }
                    } catch (Exception pairEx) {
                        // Eşleştirme başarısız olsa da RFCOMM insecure fallback denenecek
                        android.util.Log.w("OBD", "Silent pairing hatası: " + pairEx.getMessage());
                    }
                }

                // ── 3 katmanlı RFCOMM bağlantı (Car Scanner / Torque yöntemi) ──────────
                // ELM327 klonları SDP servis kaydını çoğu kez düzgün yayınlamaz; bu yüzden
                // standart ...ToServiceRecord çağrıları "read failed, socket might closed"
                // ile patlar. Sıra:
                //   1) secure   RFCOMM ToServiceRecord (SPP UUID)
                //   2) insecure RFCOMM ToServiceRecord (PIN/pairing gerektirmez)
                //   3) reflection createRfcommSocket(channel 1) — SON ÇARE, SDP'yi atlar
                //      (ELM327 klonları her zaman RFCOMM kanal 1'dedir). Car Scanner'ın da
                //      bağlandığı yol budur.
                BluetoothSocket socket = null;
                Exception firstErr = null;

                try {
                    socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    pendingSocket = socket; // Patch 2: connect() ÇAĞRISINDAN ÖNCE ata — iptal edilebilir
                    socket.connect();
                } catch (Exception secureEx) {
                    firstErr = secureEx;
                    try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                    socket = null;
                    pendingSocket = null;

                    // 2) Insecure ToServiceRecord
                    try {
                        socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                        pendingSocket = socket; // Patch 2
                        socket.connect();
                    } catch (Exception insecureEx) {
                        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                        socket = null;
                        pendingSocket = null;

                        // 3) Reflection createRfcommSocket(1) — SDP'yi tamamen atlar.
                        try { bt.cancelDiscovery(); } catch (Exception ignored) {}
                        try {
                            socket = createReflectionRfcommSocket(device);
                            pendingSocket = socket; // Patch 2
                            socket.connect();
                        } catch (Exception reflectEx) {
                            try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                            socket = null;
                            pendingSocket = null;
                            android.util.Log.w("OBD", "RFCOMM 3 yol da başarısız: secure="
                                + secureEx.getMessage() + " | insecure=" + insecureEx.getMessage()
                                + " | reflection=" + reflectEx.getMessage());
                            // İlk (en açıklayıcı) hatayı fırlat.
                            throw firstErr;
                        }
                    }
                }

                obdSocket = socket;
                pendingSocket = null; // Patch 2: bağlantı başarılı — sahiplik obdSocket'e geçti
                obdInput  = socket.getInputStream();
                obdOutput = socket.getOutputStream();

                // RFCOMM stream'lerini transport-agnostik kanala sarmala; protokol
                // mantığı (init + PID parse) ElmProtocol'e delege edilir. Davranış birebir.
                elm = new ElmProtocol(new RfcommChannel());

                initELM327();

                obdRunning = true;
                cb.onConnected(detectedProtocol);

                pollLoop();

            } catch (Exception e) {
                disconnect();
                // Patch 3: yapılandırılmış hata kodu — JS mesaj string'i parse ETMEDEN
                // PROTOCOL_CYCLE ilerletme kararını verebilsin.
                String code = (e instanceof ElmInitSequencer.UnableToConnectException)
                    ? "OBD_UNABLE_TO_CONNECT" : "CONNECT_FAILED";
                cb.onFailed(e.getMessage(), code);
            }
        });
    }

    /**
     * Patch 10 — WiFi ELM327 (TCP) bağlantı yolu. Adres "ip:port" biçiminde (ör.
     * 192.168.0.10:35000, tipik ELM327 WiFi adaptör AP modu varsayılanı).
     *
     * Classic RFCOMM yolundaki SDP/pairing/silent-PIN 3 katmanlı dansı BURADA YOK —
     * WiFi ELM327 adaptörleri TCP soketini doğrudan kabul eder; eşleşme/izin kavramı
     * yoktur (BLUETOOTH_CONNECT/BLUETOOTH_SCAN izinleri de gerekmez — çağıran taraf
     * (CarLauncherPlugin) bu yolu BT izin/adapter kontrollerinden muaf tutar).
     *
     * Bağlantı sonrası akış (initELM327 → pollLoop → cmdQueue) Classic ile AYNI —
     * RfcommChannel yalnız obdInput/obdOutput alanlarını kullanır, transport'a kör.
     */
    public void connectTcp(final String ipPort, final String protocol,
                           final Set<String> pidSet, final ConnectCallback cb) {
        obdProtocol = present(protocol) ? protocol : null;
        obdPidSet   = pidSet;

        disconnect();

        // Auto-reconnect defteri (WiFi/TCP yolu) — bkz. connect().
        lastTransport = "tcp";
        lastAddress   = ipPort;
        lastPin       = null;

        obdExecutor.submit(() -> {
            Thread.currentThread().setName("obd-tcp-connect");
            try {
                String[] hostPort = splitIpPort(ipPort);
                if (hostPort == null) {
                    throw new IOException("Geçersiz WiFi adaptör adresi (ip:port bekleniyor): " + ipPort);
                }
                String host = hostPort[0];
                int    port = Integer.parseInt(hostPort[1]);

                Socket socket = new Socket();
                pendingTcpSocket = socket; // Patch 10: connect() ÇAĞRISINDAN ÖNCE — iptal edilebilir (Patch 2 sözleşmesi)
                try {
                    socket.connect(new InetSocketAddress(host, port), TCP_CONNECT_TIMEOUT_MS);
                } catch (Exception connectEx) {
                    try { socket.close(); } catch (Exception ignored) {}
                    pendingTcpSocket = null;
                    throw connectEx;
                }
                socket.setSoTimeout(TCP_SO_TIMEOUT_MS);

                tcpSocket = socket;
                pendingTcpSocket = null; // Patch 10: bağlantı başarılı — sahiplik tcpSocket'e geçti
                obdInput  = socket.getInputStream();
                obdOutput = socket.getOutputStream();

                // Transport-agnostik ELM327 protokol katmanı — Classic ile BİREBİR aynı kanal.
                elm = new ElmProtocol(new RfcommChannel());

                initELM327();

                obdRunning = true;
                cb.onConnected(detectedProtocol);

                pollLoop();

            } catch (Exception e) {
                disconnect();
                String code = (e instanceof ElmInitSequencer.UnableToConnectException)
                    ? "OBD_UNABLE_TO_CONNECT" : "CONNECT_FAILED";
                cb.onFailed(e.getMessage(), code);
            }
        });
    }

    /**
     * "ip:port" adresini ayrıştırır (ör. "192.168.0.10:35000" → {"192.168.0.10","35000"}).
     * Host boş olamaz, port 1-65535 aralığında sayısal olmalı. Geçersizse null.
     */
    private static String[] splitIpPort(String s) {
        if (s == null) return null;
        int idx = s.lastIndexOf(':');
        if (idx <= 0 || idx == s.length() - 1) return null;
        String host    = s.substring(0, idx);
        String portStr = s.substring(idx + 1);
        try {
            int port = Integer.parseInt(portStr);
            if (port < 1 || port > 65535) return null;
        } catch (NumberFormatException e) {
            return null;
        }
        return new String[] { host, portStr };
    }

    /** ELM327 init dizisi — ElmProtocol'e delege edilir (davranış birebir korunur). */
    private void initELM327() throws IOException {
        detectedProtocol = elm.initELM327(obdProtocol);
    }

    /** PID seti null/boş ise (geriye dönük uyumluluk) tüm PID'ler sorgulanır. */
    private static boolean shouldQuery(Set<String> set, String pid) {
        return set == null || set.contains(pid);
    }

    /**
     * Patch 10: pollLoop artık transport-agnostik — obdSocket (Classic) VEYA tcpSocket
     * (WiFi) hangisi aktifse onun canlılığını kontrol eder. Aynı anda yalnız biri dolu
     * olur (disconnect() her ikisini de temizler, connect()/connectTcp() başında disconnect()
     * çağrılır) → çakışma riski yok.
     */
    private boolean isTransportAlive() {
        BluetoothSocket bs = obdSocket;
        if (bs != null) return bs.isConnected();
        Socket ts = tcpSocket;
        return ts != null && ts.isConnected();
    }

    private void pollLoop() {
        while (obdRunning && isTransportAlive()) {
            try {
                // Kendini iyileştirme: PID okumaları hataları fail-soft yutar (ERROR→-1),
                // bu yüzden kopma catch'e DÜŞMEZ — ardışık send hatası eşiği aşılırsa
                // burada, tur başında yakala ve transport'u yeniden kur.
                if (commFailStreak >= RECONNECT_AFTER_FAILS && lastTransport != null) {
                    if (attemptReconnect()) {
                        continue; // taze bağlantı — turu baştan başlat
                    }
                    disconnect();
                    listener.onStatusChanged("disconnected", "OBD bağlantısı koptu (yeniden bağlanılamadı)");
                    break;
                }

                // P2/P3: yalnızca JS'ten gelen PID listesindekiler sorgulanır.
                // Listede olmayan PID gönderilmez → gereksiz NO-DATA timeout'u oluşmaz
                // (ör. 012F yakıt desteklenmeyen araçta cycle başına 1500ms kazandırır).
                Set<String> pidSet = obdPidSet;

                // Patch 6: FAST grup — HER turda (hız/RPM en yüksek öncelik). Patch 5: her
                // PID okuması ayrı bir kuyruk görevi — DTC (USER önceliği) aralarına girebilir.
                int speed = shouldQuery(pidSet, "0D") ? queuedPidRead(ElmCommandQueue.Priority.POLL_FAST, this::readPID_speed) : -1;
                int rpm   = shouldQuery(pidSet, "0C") ? queuedPidRead(ElmCommandQueue.Priority.POLL_FAST, this::readPID_rpm)   : -1;

                // Patch 6: SLOW grup — düşük frekanslı sinyaller SLOW_GROUP_EVERY_N_CYCLES
                // turda bir sorgulanır. Aradaki turlarda -1 gönderilir → obdSanitizer/
                // obdService bu alanları ATLAR (önceki değer korunur, "kademeli polling").
                int engineTemp = -1, fuelLevel = -1, throttle = -1, intakeTemp = -1, boostPressure = -1;
                if (pollCycle % SLOW_GROUP_EVERY_N_CYCLES == 0) {
                    engineTemp    = shouldQuery(pidSet, "05") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, this::readPID_temp)       : -1;
                    fuelLevel     = shouldQuery(pidSet, "2F") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, this::readPID_fuel)        : -1;
                    // obdPidConfig.ts ICE/DIESEL setinde iletiliyordu ama eskiden HİÇ sorgulanmıyordu.
                    throttle      = shouldQuery(pidSet, "11") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, this::readPID_throttle)    : -1;
                    intakeTemp    = shouldQuery(pidSet, "0F") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, this::readPID_intakeTemp)  : -1;
                    boostPressure = shouldQuery(pidSet, "0B") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, this::readPID_map)         : -1;
                }

                // Patch 6: ATRV (12V akü voltajı) — VOLTAGE_EVERY_N_CYCLES turda bir. Aradaki
                // turlarda SON bilinen değer JS'e tekrar gönderilir (aniden "yok" görünmesin).
                if (pollCycle % VOLTAGE_EVERY_N_CYCLES == 0) {
                    lastVoltage = queuedVoltageRead();
                }

                // Patch 8: EXTENDED grup — turda EN FAZLA BİR PID, round-robin, POLL_SLOW
                // önceliğinde (DTC/USER her zaman öne geçer). Liste boşken sıfır maliyet.
                java.util.List<String> ext = extendedPids;
                if (!ext.isEmpty()) {
                    final String extPid = ext.get(extendedIdx % ext.size());
                    extendedIdx++;
                    String extRaw = queuedExtendedRead(extPid);
                    if (extRaw != null) listener.onExtendedPid(extPid, extRaw);
                }
                pollCycle++;

                // Veriyi köprü katmanına bildir — JSObject/notifyListeners/SAB Plugin'de.
                listener.onObdData(new ObdPollSample(speed, rpm, engineTemp, fuelLevel,
                    throttle, intakeTemp, boostPressure, lastVoltage));

                Thread.sleep(fastPollMs);

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                // Bir okuma gerçekten fırlattıysa (fail-soft yakalamadıysa) yine de
                // önce yeniden bağlanmayı dene — ancak sonra "disconnected" ver.
                if (lastTransport != null && attemptReconnect()) {
                    continue;
                }
                disconnect();
                listener.onStatusChanged("disconnected", e.getMessage());
                break;
            }
        }
    }

    /** Bir PID okumasını verilen öncelikle kuyruğa gönderir ve sonucu bekler (Patch 5/6). */
    private int queuedPidRead(ElmCommandQueue.Priority priority, java.util.concurrent.Callable<Integer> action) throws Exception {
        try {
            return cmdQueue.submit(priority, null, action).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /** ATRV okumasını POLL_SLOW öncelikli kuyruğa gönderir (Patch 6). */
    private double queuedVoltageRead() throws Exception {
        final ElmProtocol p = elm;
        if (p == null) return -1.0;
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.POLL_SLOW, null, p::readVoltage).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            return -1.0; // ATRV opsiyonel/kritik değil — hata durumunda sessizce -1
        }
    }

    /**
     * Patch 6 (AdaptivePollingController): FAST grup poll periyodunu günceller.
     * @param ms yeni periyot (ms) — 100ms altı reddedilir (adaptörü/ECU'yu boğmamak için taban).
     */
    public void setFastPollMs(int ms) {
        this.fastPollMs = Math.max(100, ms);
    }

    /**
     * Patch 8: EXTENDED grup PID listesini değiştirir (TS talep-güdümlü — izleyici yoksa
     * TS boş liste gönderir, poll turu ek komut çalıştırmaz). Savunmacı üst sınır 32:
     * daha uzun liste zaten rotasyonda anlamsız gecikme üretir (32 PID × 1 tur ≈ tam tur
     * süresi dakikalar) — TS tarafı da kendi tavanını uygular.
     */
    public void setExtendedPids(java.util.List<String> pids) {
        if (pids == null || pids.isEmpty()) {
            this.extendedPids = java.util.Collections.emptyList();
            return;
        }
        java.util.List<String> copy = new java.util.ArrayList<>(
            pids.subList(0, Math.min(pids.size(), 32)));
        this.extendedPids = java.util.Collections.unmodifiableList(copy);
    }

    /** EXTENDED PID okumasını POLL_SLOW öncelikli kuyruğa gönderir (Patch 8). */
    private String queuedExtendedRead(String pid) {
        final ElmProtocol p = elm;
        if (p == null) return null;
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.POLL_SLOW, null,
                () -> p.readPidRaw(pid)).get();
        } catch (Exception e) {
            return null; // EXTENDED opsiyonel — hata sessizce atlanır (fail-soft)
        }
    }

    /** Bağlantıyı kapatır, akışları serbest bırakır (idempotent). */
    public void disconnect() {
        obdRunning = false;
        // Patch 2: bekleyen (henüz obdSocket'e taşınmamış) bir bağlantı DENEMESİ varsa
        // onu da kapat — bloklu socket.connect() IOException ile uyanır, executor
        // kuyruğunda tıkalı kalmaz. NOT (bilinen sınır): 3 katmanlı yolun bir sonraki
        // adımı bu kapanıştan HEMEN sonra kendi pendingSocket'ini kurup denemeye devam
        // edebilir; bu Patch 2 kapsamı dışında (ayrı bir connect-generation iptal
        // mekanizması gerektirir) — mevcut davranışla aynı risk sınıfında, yeni bir
        // regresyon değil.
        try { BluetoothSocket p = pendingSocket; if (p != null) p.close(); } catch (IOException ignored) {}
        pendingSocket = null;
        // Patch 10: bekleyen TCP bağlantı denemesi de aynı iptal sözleşmesiyle kapatılır.
        try { Socket pt = pendingTcpSocket; if (pt != null) pt.close(); } catch (IOException ignored) {}
        pendingTcpSocket = null;
        try { if (obdInput  != null) { obdInput.close();  obdInput  = null; } } catch (IOException ignored) {}
        try { if (obdOutput != null) { obdOutput.close(); obdOutput = null; } } catch (IOException ignored) {}
        try { if (obdSocket != null) { obdSocket.close(); obdSocket = null; } } catch (IOException ignored) {}
        // Patch 10: aktif WiFi (TCP) bağlantısı da kapatılır — idempotent, Classic ile
        // aynı anda yalnız biri dolu olacağından çift kapanış riski yok.
        try { if (tcpSocket != null) { tcpSocket.close(); tcpSocket = null; } } catch (IOException ignored) {}
        elm = null;
        detectedProtocol = null;
        // Patch 6: yeni bağlantı staggered poll döngüsünü sıfırdan başlatır.
        pollCycle = 0;
        lastVoltage = -1.0;
        // Patch 8: EXTENDED rotasyon imleci de sıfırlanır (liste TS yönetiminde, korunur).
        extendedIdx = 0;
        // Patch 5: bu bağlantıya ait BEKLEYEN (henüz çalışmamış) kuyruk görevleri artık
        // anlamsız (elm=null → NPE ile başarısız olurlardı) — proaktif temizle.
        cmdQueue.clearPending();
        // Auto-reconnect defteri temizlenir → BİLİNÇLİ kapanış sonrası yeniden bağlanma
        // DENENMEZ. connect()/connectTcp() disconnect()'ten SONRA last* set eder, bu
        // yüzden sıralama doğru (temizle → yeni bağlantı defterini yaz).
        lastTransport  = null;
        lastAddress    = null;
        lastPin        = null;
        commFailStreak = 0;
    }

    /**
     * Kopan transport'u (Broken pipe / stream kapandı) SON başarılı bağlantı
     * parametreleriyle yeniden kurar — pollLoop thread'inden SENKRON çağrılır.
     * Poll döngüsünü ÖLDÜRMEDEN kendini iyileştirir: ölü soketi kapatır, backoff
     * bekler, aynı transport'la (TCP/BT) yeniden bağlanıp ELM327'yi yeniden init eder.
     * Başarısızsa false → çağıran mevcut "disconnected" davranışına döner.
     *
     * NOT: obdRunning, last-defteri ve cmdQueue'ya DOKUNMAZ (disconnect() değil) —
     * yalnız ölü stream'leri kapatıp yeni soketi kurar; kuyruk ve poll durumu korunur.
     */
    private boolean attemptReconnect() {
        final String transport = lastTransport;
        final String address   = lastAddress;
        if (transport == null || address == null) return false;

        listener.onStatusChanged("reconnecting", null);

        for (int attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS && obdRunning; attempt++) {
            closeStreamsOnly(); // ölü soket/stream'leri bırak (obdRunning'e dokunmadan)
            try {
                Thread.sleep(RECONNECT_BACKOFF_MS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return false;
            }
            try {
                if ("tcp".equals(transport)) reopenTcp(address);
                else                          reopenBt(address);

                // Transport yeniden kuruldu — protokol katmanını ve ELM init'i tazele.
                elm = new ElmProtocol(new RfcommChannel());
                initELM327();

                commFailStreak = 0;
                listener.onStatusChanged("connected", detectedProtocol);
                return true;
            } catch (Exception e) {
                closeStreamsOnly(); // bu deneme battı — sıradaki tur temiz başlasın
                // son denemede döngü biter → false döner
            }
        }
        return false;
    }

    /**
     * Auto-reconnect yardımcısı: yalnız ölü stream/soketleri kapatır. disconnect()'ten
     * FARKI: obdRunning, last* defteri, cmdQueue ve poll sayaçlarına DOKUNMAZ — poll
     * döngüsü ve kuyruk durumu korunur, sadece transport tazelenir.
     */
    private void closeStreamsOnly() {
        try { if (obdInput  != null) obdInput.close();  } catch (IOException ignored) {}
        try { if (obdOutput != null) obdOutput.close(); } catch (IOException ignored) {}
        try { if (obdSocket != null) obdSocket.close(); } catch (IOException ignored) {}
        try { if (tcpSocket != null) tcpSocket.close(); } catch (IOException ignored) {}
        obdInput = null; obdOutput = null; obdSocket = null; tcpSocket = null;
    }

    /**
     * Auto-reconnect: WiFi (TCP) soketini yeniden açar — connectTcp()'nin soket kurulum
     * bloğuyla davranışça AYNI (pendingTcpSocket iptal sözleşmesi dahil). Başarıda
     * tcpSocket/obdInput/obdOutput doldurulur.
     */
    private void reopenTcp(String ipPort) throws IOException {
        String[] hostPort = splitIpPort(ipPort);
        if (hostPort == null) throw new IOException("Geçersiz WiFi adaptör adresi: " + ipPort);
        Socket socket = new Socket();
        pendingTcpSocket = socket;
        try {
            socket.connect(new InetSocketAddress(hostPort[0], Integer.parseInt(hostPort[1])),
                TCP_CONNECT_TIMEOUT_MS);
        } catch (Exception e) {
            try { socket.close(); } catch (Exception ignored) {}
            pendingTcpSocket = null;
            throw (e instanceof IOException) ? (IOException) e : new IOException(e.getMessage());
        }
        socket.setSoTimeout(TCP_SO_TIMEOUT_MS);
        tcpSocket = socket;
        pendingTcpSocket = null;
        obdInput  = socket.getInputStream();
        obdOutput = socket.getOutputStream();
    }

    /**
     * Auto-reconnect: RFCOMM soketini yeniden açar (3 katman: secure → insecure →
     * reflection). connect()'in soket kurulum yolunu davranışça yansıtır AMA
     * PAIRING YAPMAZ — reconnect anında cihaz zaten bonded'dır; yalnız soket tazelenir.
     */
    private void reopenBt(String address) throws Exception {
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt == null) throw new IOException("Bluetooth desteklenmiyor");
        BluetoothDevice device = bt.getRemoteDevice(address);
        try { bt.cancelDiscovery(); } catch (SecurityException ignored) {}

        BluetoothSocket socket = null;
        Exception firstErr = null;
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            pendingSocket = socket;
            socket.connect();
        } catch (Exception secureEx) {
            firstErr = secureEx;
            try { if (socket != null) socket.close(); } catch (Exception ignored) {}
            socket = null; pendingSocket = null;
            try {
                socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                pendingSocket = socket;
                socket.connect();
            } catch (Exception insecureEx) {
                try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                socket = null; pendingSocket = null;
                try { bt.cancelDiscovery(); } catch (Exception ignored) {}
                try {
                    socket = createReflectionRfcommSocket(device);
                    pendingSocket = socket;
                    socket.connect();
                } catch (Exception reflectEx) {
                    try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                    pendingSocket = null;
                    throw firstErr; // ilk (en açıklayıcı) hatayı yükselt
                }
            }
        }
        obdSocket = socket;
        pendingSocket = null;
        obdInput  = socket.getInputStream();
        obdOutput = socket.getOutputStream();
    }

    /** Tam kapanış — bağlantı + executor (Plugin.handleOnDestroy'dan çağrılır). */
    public void shutdown() {
        disconnect();
        obdExecutor.shutdownNow();
        cmdQueue.shutdown();
    }

    // ── DTC API (plugin thread'inden çağrılır) ───────────────────────────────
    // Patch 5: elmLock (synchronized) kaldırıldı — cmdQueue TEK yürütücü thread'i
    // ile serileştirme zaten garanti; DTC istekleri USER önceliğiyle kuyruğa girer.

    /** Aktif ELM bağlantısı var mı (plugin'in transport seçimi için). */
    public boolean isConnected() { return obdRunning; }

    /**
     * Kayıtlı arıza kodlarını okur (Mode 03). USER önceliğiyle kuyruğa girer — en kötü
     * ihtimalle ÇALIŞMAKTA olan TEK bir poll komutunun (~1.5s) bitmesini bekler (eskiden
     * elmLock ile bir TÜM poll turunun, ~6s, bitmesini bekliyordu).
     */
    public java.util.List<String> readDTCs() throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null, p::readDTCs).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /** Arıza kodlarını siler (Mode 04). false → ECU onay vermedi. USER önceliğiyle kuyruğa girer. */
    public boolean clearDTCs() throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null, p::clearDTCs).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /** Patch 11A: BEKLEYEN arıza kodlarını okur (Mode 07). USER önceliğiyle kuyruğa girer. */
    public java.util.List<String> readPendingDTCs() throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null, p::readPendingDTCs).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /**
     * Patch 11A: KALICI arıza kodlarını okur (Mode 0A). null = mod desteklenmiyor
     * (bkz. {@link ElmProtocol#readPermanentDTCs()}). USER önceliğiyle kuyruğa girer.
     */
    public java.util.List<String> readPermanentDTCs() throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null, p::readPermanentDTCs).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /** Patch 11B: freeze frame'i tetikleyen DTC'yi okur (Mode 02 PID 02). USER önceliğiyle kuyruğa girer. */
    public String readFreezeFrameDtc() throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null, p::readFreezeFrameDtcRaw).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /** Patch 11B: freeze frame'den jenerik PID okur (Mode 02, frame 0). USER önceliğiyle kuyruğa girer. */
    public String readFreezeFramePid(String pid) throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null, () -> p.readFreezeFramePidRaw(pid)).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /**
     * Patch 11C: tek-seferlik jenerik Mode 01 PID okuma (USER önceliği) — readiness/enum
     * PID'leri (01/03/1C) için; watchPid rotasyonuna/EXTENDED sürekli poll grubuna DAHİL
     * DEĞİL (Mali-400 boşta-sıfır-maliyet sözleşmesi bozulmaz — yalnız talep anında çalışır).
     */
    public String readPidOnce(String pid) throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null, () -> p.readPidRaw(pid)).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /**
     * Patch 12A: UDS Mode 22 (ReadDataByIdentifier) — üretici-özel tek DID okuma.
     * ECU header (tx/rx) ayarlama + oku + varsayılana restore TEK kuyruk görevinde (USER
     * önceliği) ATOMİK çalışır — {@link ElmProtocol#withEcuHeader} finally'de restore'u
     * garanti eder, cmdQueue'nun tek worker thread'i araya başka komut girmesini engeller.
     *
     * @return ham data hex (62&lt;DID&gt; soyulmuş); null = DID desteklenmiyor (7F22 31/33 / NO DATA).
     * @throws Exception iletişim hatası / diğer negatif yanıt / pending zaman aşımı / header restore hatası.
     */
    public String readObdDid(String tx, String rx, String did) throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null,
                () -> p.withEcuHeader(tx, rx, () -> p.readDid(did))).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    // ── PID readers (ElmProtocol'e delege — davranış birebir korunur) ────────

    private int readPID_speed() { return elm.readPID_speed(); }
    private int readPID_rpm()   { return elm.readPID_rpm();   }
    private int readPID_temp()  { return elm.readPID_temp();  }
    private int readPID_fuel()  { return elm.readPID_fuel();  }
    // Patch 6 — SLOW grup ek PID'ler
    private int readPID_throttle()   { return elm.readPID_throttle();   }
    private int readPID_intakeTemp() { return elm.readPID_intakeTemp(); }
    private int readPID_map()        { return elm.readPID_map();        }

    /**
     * RFCOMM (Classic Bluetooth SPP) taşıma kanalı — {@link ElmCommandChannel} implementasyonu.
     *
     * Mevcut InputStream/OutputStream + '>' prompt bekleme mantığını BİREBİR korur.
     * Sadece eski {@code sendOBDCommand} gövdesi buraya taşındı; davranış byte-identik.
     */
    private final class RfcommChannel implements ElmCommandChannel {
        @Override
        public String send(String cmd, int timeoutMs) throws IOException {
            // Teşhis: komut→yanıt süresini ölç (yalnız capture açıkken listener'a iletilir).
            final long started = sTrafficCapture ? System.currentTimeMillis() : 0L;
            InputStream  in  = obdInput;
            OutputStream out = obdOutput;
            if (in == null || out == null) throw new IOException("OBD bağlantısı yok");

            try {
                int stale = in.available();
                if (stale > 0) in.skip(stale);

                out.write((cmd + "\r").getBytes("ASCII"));
                out.flush();

                StringBuilder sb   = new StringBuilder();
                long          dead = System.currentTimeMillis() + timeoutMs;

                while (System.currentTimeMillis() < dead) {
                    if (in.available() > 0) {
                        int c = in.read();
                        if (c < 0) throw new IOException("Stream kapandı");
                        if (c == '>') break;
                        if (c != '\r') sb.append((char) c);
                    } else {
                        try { Thread.sleep(20); }
                        catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            throw new IOException("Kesintiye uğradı");
                        }
                    }
                }
                String resp = sb.toString().trim();
                emitTraffic(cmd, resp, started);
                commFailStreak = 0; // başarılı I/O → kopma serisini sıfırla
                return resp;
            } catch (IOException e) {
                // Teşhis: hatayı da yakala — "araç yanıt vermiyor mu, kanal mı öldü" ekrandan görülür.
                emitTraffic(cmd, "⚠ " + e.getMessage(), started);
                // Auto-reconnect tetiği: Broken pipe / stream kapandı gibi yazma/okuma
                // hataları burada sayılır; pollLoop eşiği görünce transport'u yeniden kurar.
                commFailStreak++;
                throw e;
            }
        }

        /** Ham trafik çiftini teşhis listener'ına + halka tampona iletir — yalnız capture açıkken. */
        private void emitTraffic(String cmd, String resp, long started) {
            if (!sTrafficCapture || started == 0L) return;
            long ms = System.currentTimeMillis() - started;
            recordTraffic(System.currentTimeMillis(), cmd, resp, ms); // PC'nin HTTP ile çekeceği tampon
            try {
                listener.onObdTraffic(cmd, resp, ms);
            } catch (Exception ignored) {
                // Teşhis köprüsü asla OBD akışını bozmaz — listener hatası yutulur.
            }
        }

        /** Stream sahipliği OBDManager.disconnect()'tedir; kanal kendi başına kapatmaz. */
        @Override
        public void close() { /* no-op — disconnect() stream'leri yönetir */ }
    }

    private static boolean present(String s) { return s != null && !s.isEmpty(); }

    /**
     * Reflection ile RFCOMM kanal 1 soketi oluşturur — SDP servis keşfini ATLAR.
     *
     * ELM327 klonlarının çoğu SPP servis kaydını düzgün yayınlamaz; bu durumda
     * createRfcommSocketToServiceRecord SDP araması başarısız olur ("read failed,
     * socket might closed"). Gizli {@code createRfcommSocket(int channel)} API'si
     * doğrudan kanal 1'e bağlanır (ELM327 klonları daima kanal 1'dedir). Torque ve
     * Car Scanner gibi uygulamaların kullandığı bilinen son-çare yöntemidir.
     */
    private static BluetoothSocket createReflectionRfcommSocket(BluetoothDevice device) throws Exception {
        java.lang.reflect.Method m =
            device.getClass().getMethod("createRfcommSocket", new Class[] { int.class });
        return (BluetoothSocket) m.invoke(device, Integer.valueOf(1));
    }
}
