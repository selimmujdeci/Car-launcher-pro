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
        /** Asenkron durum değişimi (ör. poll sırasında bağlantı koptu). message null olabilir. */
        void onStatusChanged(String state, String message);
        /** Beklenmedik motor hatası. */
        void onError(String error);
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

    /** ELM327 init dizisi — ElmProtocol'e delege edilir (davranış birebir korunur). */
    private void initELM327() throws IOException {
        detectedProtocol = elm.initELM327(obdProtocol);
    }

    /** PID seti null/boş ise (geriye dönük uyumluluk) tüm PID'ler sorgulanır. */
    private static boolean shouldQuery(Set<String> set, String pid) {
        return set == null || set.contains(pid);
    }

    private void pollLoop() {
        while (obdRunning && obdSocket != null && obdSocket.isConnected()) {
            try {
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
                pollCycle++;

                // Veriyi köprü katmanına bildir — JSObject/notifyListeners/SAB Plugin'de.
                listener.onObdData(new ObdPollSample(speed, rpm, engineTemp, fuelLevel,
                    throttle, intakeTemp, boostPressure, lastVoltage));

                Thread.sleep(fastPollMs);

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
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
        try { if (obdInput  != null) { obdInput.close();  obdInput  = null; } } catch (IOException ignored) {}
        try { if (obdOutput != null) { obdOutput.close(); obdOutput = null; } } catch (IOException ignored) {}
        try { if (obdSocket != null) { obdSocket.close(); obdSocket = null; } } catch (IOException ignored) {}
        elm = null;
        detectedProtocol = null;
        // Patch 6: yeni bağlantı staggered poll döngüsünü sıfırdan başlatır.
        pollCycle = 0;
        lastVoltage = -1.0;
        // Patch 5: bu bağlantıya ait BEKLEYEN (henüz çalışmamış) kuyruk görevleri artık
        // anlamsız (elm=null → NPE ile başarısız olurlardı) — proaktif temizle.
        cmdQueue.clearPending();
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
            InputStream  in  = obdInput;
            OutputStream out = obdOutput;
            if (in == null || out == null) throw new IOException("OBD bağlantısı yok");

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
            return sb.toString().trim();
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
