package com.cockpitos.pro.obd;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
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
        /** Her poll döngüsünde çözümlenmiş PID değerleri (desteklenmeyen = -1). */
        void onObdData(int speed, int rpm, int engineTemp, int fuelLevel);
        /** Asenkron durum değişimi (ör. poll sırasında bağlantı koptu). message null olabilir. */
        void onStatusChanged(String state, String message);
        /** Beklenmedik motor hatası. */
        void onError(String error);
    }

    /** connect() için tek-seferlik (per-call) sonuç callback'i — PluginCall resolve/reject Plugin'de kalır. */
    public interface ConnectCallback {
        void onConnected();
        void onFailed(String error);
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

    // Transport-agnostik ELM327 protokol katmanı (init + PID parse).
    // RFCOMM stream'leri üzerinde RfcommChannel ile çalışır; davranış birebir korunur.
    private volatile ElmProtocol     elm        = null;

    // JS → Native OBD contract (P2): connect ile gelen protokol + PID listesi.
    private volatile String                 obdProtocol = null;
    private volatile Set<String>            obdPidSet   = null;

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
                    socket.connect();
                } catch (Exception secureEx) {
                    firstErr = secureEx;
                    try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                    socket = null;

                    // 2) Insecure ToServiceRecord
                    try {
                        socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                        socket.connect();
                    } catch (Exception insecureEx) {
                        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                        socket = null;

                        // 3) Reflection createRfcommSocket(1) — SDP'yi tamamen atlar.
                        try { bt.cancelDiscovery(); } catch (Exception ignored) {}
                        try {
                            socket = createReflectionRfcommSocket(device);
                            socket.connect();
                        } catch (Exception reflectEx) {
                            try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                            socket = null;
                            android.util.Log.w("OBD", "RFCOMM 3 yol da başarısız: secure="
                                + secureEx.getMessage() + " | insecure=" + insecureEx.getMessage()
                                + " | reflection=" + reflectEx.getMessage());
                            // İlk (en açıklayıcı) hatayı fırlat.
                            throw firstErr;
                        }
                    }
                }

                obdSocket = socket;
                obdInput  = socket.getInputStream();
                obdOutput = socket.getOutputStream();

                // RFCOMM stream'lerini transport-agnostik kanala sarmala; protokol
                // mantığı (init + PID parse) ElmProtocol'e delege edilir. Davranış birebir.
                elm = new ElmProtocol(new RfcommChannel());

                initELM327();

                obdRunning = true;
                cb.onConnected();

                pollLoop();

            } catch (Exception e) {
                disconnect();
                cb.onFailed(e.getMessage());
            }
        });
    }

    /** ELM327 init dizisi — ElmProtocol'e delege edilir (davranış birebir korunur). */
    private void initELM327() throws IOException {
        elm.initELM327(obdProtocol);
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
                int speed, rpm, engineTemp, fuelLevel;
                // elmLock: DTC okuma/silme (plugin thread'i) ile PID polling aynı
                // RFCOMM stream'ini paylaşır — komutlar ASLA iç içe geçmemeli.
                synchronized (elmLock) {
                    speed      = shouldQuery(pidSet, "0D") ? readPID_speed() : -1;
                    rpm        = shouldQuery(pidSet, "0C") ? readPID_rpm()   : -1;
                    engineTemp = shouldQuery(pidSet, "05") ? readPID_temp()  : -1;
                    fuelLevel  = shouldQuery(pidSet, "2F") ? readPID_fuel()  : -1;
                }

                // Veriyi köprü katmanına bildir — JSObject/notifyListeners/SAB Plugin'de.
                listener.onObdData(speed, rpm, engineTemp, fuelLevel);

                Thread.sleep(3000);

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

    /** Bağlantıyı kapatır, akışları serbest bırakır (idempotent). */
    public void disconnect() {
        obdRunning = false;
        try { if (obdInput  != null) { obdInput.close();  obdInput  = null; } } catch (IOException ignored) {}
        try { if (obdOutput != null) { obdOutput.close(); obdOutput = null; } } catch (IOException ignored) {}
        try { if (obdSocket != null) { obdSocket.close(); obdSocket = null; } } catch (IOException ignored) {}
        elm = null;
    }

    /** Tam kapanış — bağlantı + executor (Plugin.handleOnDestroy'dan çağrılır). */
    public void shutdown() {
        disconnect();
        obdExecutor.shutdownNow();
    }

    // ── DTC API (plugin thread'inden çağrılır) ───────────────────────────────

    /** Polling ile aynı stream'i paylaşan komutların serileştirme kilidi. */
    private final Object elmLock = new Object();

    /** Aktif ELM bağlantısı var mı (plugin'in transport seçimi için). */
    public boolean isConnected() { return obdRunning; }

    /**
     * Kayıtlı arıza kodlarını okur (Mode 03). Polling döngüsüyle elmLock
     * üzerinden serileşir — en kötü ihtimal bir poll turu (~6 sn) bekler.
     */
    public java.util.List<String> readDTCs() throws Exception {
        ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        synchronized (elmLock) { return p.readDTCs(); }
    }

    /** Arıza kodlarını siler (Mode 04). false → ECU onay vermedi. */
    public boolean clearDTCs() throws Exception {
        ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        synchronized (elmLock) { return p.clearDTCs(); }
    }

    // ── PID readers (ElmProtocol'e delege — davranış birebir korunur) ────────

    private int readPID_speed() { return elm.readPID_speed(); }
    private int readPID_rpm()   { return elm.readPID_rpm();   }
    private int readPID_temp()  { return elm.readPID_temp();  }
    private int readPID_fuel()  { return elm.readPID_fuel();  }

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
