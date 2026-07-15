package com.cockpitos.pro.obd;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.content.Context;
import android.util.Log;

import java.io.IOException;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * BleObdManager — ELM327 / BLE GATT OBD-II bağlantı + polling motoru (Phase 2).
 *
 * Classic {@link OBDManager} ile İKİZ sorumluluk taşır, ama taşıma katmanı BLE GATT'tir:
 * RFCOMM stream yerine GATT notify/write characteristic'leri kullanılır. Protokol
 * mantığı (init + PID parse) tamamen {@link ElmProtocol} + {@link ElmCommandChannel}
 * üzerinden paylaşılır; bu sınıf yalnızca bir GATT tabanlı {@code ElmCommandChannel}
 * implementasyonu (iç sınıf {@link GattChannel}) sağlar.
 *
 * KÖPRÜ AYRIMI (Bridge Separation):
 *   - Bu sınıf Capacitor'a (JSObject/PluginCall), notifyListeners'a veya
 *     SharedArrayBuffer köprüsüne ASLA dokunmaz.
 *   - Veriyi {@link OnOBDDataListener} üzerinden Plugin'e bildirir (Classic ile aynı imza).
 *
 * WIRE DURUMU:
 *   - WIRE EDİLDİ: CarLauncherPlugin.connectOBD(transport='ble') → bleObd().connect(...)
 *     ile çağrılır (CarLauncherPlugin ~1098-1110). Eski "henüz wire edilmedi" notu geçersiz.
 *
 * GATT SERİLİĞİ:
 *   - Android BluetoothGatt aynı anda TEK operasyon yürütür (write / descriptor-write /
 *     discoverServices). {@link GattChannel.send} her komutu tek bir mutex (ops kilidi)
 *     altında yapar: write isteğini gönderir, notify reassembly buffer'ı '>' prompt'una
 *     kadar dolana dek yanıtı bekler. Üst üste write OLMAZ — send() senkron/bloklayıcıdır
 *     ve çağrıldığı tek thread (obdExecutor) sıralıdır.
 */
@SuppressLint("MissingPermission")
public final class BleObdManager {

    private static final String TAG = "BleObdManager";

    // ── Listener / callback sözleşmeleri (Classic OBDManager ile aynı imza) ──────

    /** OBD motoru → Plugin (köprü katmanı) bildirim arayüzü. */
    public interface OnOBDDataListener {
        /** Patch 6: her poll döngüsünde çözümlenmiş TÜM PID değerleri (bkz. {@link ObdPollSample}). */
        void onObdData(ObdPollSample sample);
        /** Patch 8: EXTENDED grup ham PID sonucu — bkz. OBDManager.OnOBDDataListener.onExtendedPid. */
        void onExtendedPid(String pid, String rawHex);
        /** Asenkron durum değişimi (ör. poll sırasında bağlantı koptu). message null olabilir. */
        void onStatusChanged(String state, String message);
        /** Beklenmedik motor hatası. */
        void onError(String error);
    }

    /** connect() için tek-seferlik sonuç callback'i — PluginCall resolve/reject Plugin'de kalır. */
    public interface ConnectCallback {
        /** Patch 3: ATDPN ile okunan aktif protokol numarası (tek karakter) — yoksa null. */
        void onConnected(String detectedProtocol);
        /**
         * @param code "OBD_UNABLE_TO_CONNECT" (ELM327 protokol/araç yanıtı alınamadı) veya
         *             "CONNECT_FAILED" (diğer tüm GATT/bağlantı hataları) — bkz. OBDManager.ConnectCallback.
         */
        void onFailed(String error, String code);
    }

    // ── Bilinen BLE ELM327 servis/karakteristik UUID setleri ─────────────────────
    // 16-bit UUID'ler Bluetooth Base UUID'ye genişletilir: 0000XXXX-0000-1000-8000-00805F9B34FB

    // HM-10 / Vgate iCar / vLinker — tek char hem notify hem write (FFE1).
    private static final UUID UUID_SERVICE_FFE0 = uuid16("FFE0");
    private static final UUID UUID_CHAR_FFE1    = uuid16("FFE1");

    // Veepeak vb. — ayrı notify (FFF1) ve write (FFF2) char.
    private static final UUID UUID_SERVICE_FFF0 = uuid16("FFF0");
    private static final UUID UUID_CHAR_FFF1    = uuid16("FFF1"); // notify
    private static final UUID UUID_CHAR_FFF2    = uuid16("FFF2"); // write

    // Nordic UART Service (NUS) — bazı klon adaptörler.
    private static final UUID UUID_SERVICE_NUS  = UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    private static final UUID UUID_CHAR_NUS_TX   = UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E"); // notify (peripheral→central)
    private static final UUID UUID_CHAR_NUS_RX   = UUID.fromString("6E400002-B5A3-F393-E0A9-E50E24DCCA9E"); // write (central→peripheral)

    // Client Characteristic Configuration Descriptor (CCCD) — notify/indicate aç/kapat.
    private static final UUID UUID_CCCD = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");

    // GATT operasyonları için makul timeout'lar (ms).
    private static final long OP_TIMEOUT_MS       = 5_000L;  // discover / mtu / descriptor write
    private static final long CONNECT_TIMEOUT_MS  = 12_000L; // connect → CONNECTED
    private static final int  POLL_INTERVAL_MS    = 3_000;   // Classic ile aynı poll periyodu

    // ── Bağlı durum alanları ─────────────────────────────────────────────────────

    private final Context mContext;
    private final OnOBDDataListener listener;

    private final ExecutorService obdExecutor = Executors.newSingleThreadExecutor();

    private volatile BluetoothGatt gatt = null;
    private volatile BluetoothGattCharacteristic notifyChar = null;
    private volatile BluetoothGattCharacteristic writeChar  = null;
    private volatile boolean obdRunning = false;

    private volatile ElmProtocol elm = null;

    // JS → Native OBD contract: connect ile gelen protokol + PID listesi.
    private volatile String      obdProtocol = null;
    private volatile Set<String> obdPidSet   = null;

    /** Patch 5: bkz. OBDManager.cmdQueue — aynı öncelik-sıralı komut kuyruğu deseni. */
    private final ElmCommandQueue cmdQueue = new ElmCommandQueue();

    /** Patch 6 (AdaptivePollingController): bkz. OBDManager.fastPollMs — aynı desen. */
    private volatile int fastPollMs = POLL_INTERVAL_MS;
    private static final int SLOW_GROUP_EVERY_N_CYCLES = 5;
    private static final int VOLTAGE_EVERY_N_CYCLES = 10;
    private long pollCycle = 0;
    private volatile double lastVoltage = -1.0;

    /** Patch 8: bkz. OBDManager.extendedPids — aynı talep-güdümlü/sıfır-maliyet deseni. */
    private volatile java.util.List<String> extendedPids = java.util.Collections.emptyList();
    private int extendedIdx = 0;

    /**
     * PR-OBD-BLE-1: Teşhis BURST modu — bkz. OBDManager.diagnosticBurst (aynı sözleşme).
     * Açıkken pollLoop EXTENDED grubunun TÜM izlenen PID'lerini HER turda okur (round-robin
     * "turda 1" yerine) ve tur arası bekleme kısaltılır → tüm sensörler ~saniyeler içinde
     * tazelenir. Yalnız Canlı Test ekranı görünürken açılır (Malı-400 sıfır-maliyet korunur).
     * Eskiden BLE'de YOKTU → BLE transport'ta "Tüm PID Canlı Test" yalnız round-robin çalışıyor,
     * extended hattı fiilen boş kalıyordu (saha: Trafic/Doblo aynı 6-7 PID sınırı).
     */
    private volatile boolean diagnosticBurst = false;
    /** BURST modunda tur arası minimum bekleme (ms) — bkz. OBDManager.BURST_POLL_MS. */
    private static final int BURST_POLL_MS = 400;

    // ── GATT operasyon senkronizasyonu ───────────────────────────────────────────
    // Android GATT seri olduğundan tek bir "op sonucu" kanalı yeterli. Her bloklayıcı
    // operasyon (connect / discover / mtu / descriptor-write) bu kuyruktan sonuç bekler.
    // Bu kuyruğa YALNIZCA GATT callback thread'i yazar; YALNIZCA obdExecutor thread'i okur.
    private final LinkedBlockingQueue<Boolean> opResult = new LinkedBlockingQueue<>(1);

    // Notify reassembly: chunk'lar '>' (0x3E) prompt'una kadar burada birikir.
    // YALNIZCA GATT callback thread'i append eder; bekleyen send() thread'i poll'ler.
    private final StringBuilder rxBuffer = new StringBuilder();
    private final Object rxLock = new Object();
    private volatile boolean promptSeen = false;

    public BleObdManager(Context context, OnOBDDataListener listener) {
        this.mContext = context.getApplicationContext();
        this.listener = listener;
    }

    // ── Genel API ────────────────────────────────────────────────────────────────

    /**
     * BLE ELM327 adaptörüne bağlanır ve polling döngüsünü başlatır (kendi executor'unda).
     * PluginCall resolve/reject sorumluluğu {@link ConnectCallback} ile Plugin'e bırakılır.
     */
    public void connect(final String address, final String protocol,
                        final Set<String> pidSet, final ConnectCallback cb) {
        obdProtocol = present(protocol) ? protocol : null;
        obdPidSet   = pidSet;

        disconnect();

        obdExecutor.submit(() -> {
            try {
                BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
                if (bt == null) throw new IOException("Bluetooth desteklenmiyor");

                BluetoothDevice device = bt.getRemoteDevice(address);

                // 1) GATT bağlan — autoConnect=false, TRANSPORT_LE açıkça.
                //    GATT 133 (BLE'de en yaygın geçici hata) için 2 deneme: ilk
                //    connectGatt başarısız olursa kapat, kısa bekle, tekrar dene.
                //    Car Scanner dahil sağlam BLE istemcileri bu retry'ı uygular.
                BluetoothGatt g = null;
                boolean gattConnected = false;
                for (int attempt = 0; attempt < 2 && !gattConnected; attempt++) {
                    resetOpResult();
                    g = device.connectGatt(mContext, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
                    if (g == null) {
                        if (attempt == 0) { Thread.sleep(600); continue; }
                        throw new IOException("connectGatt null döndü");
                    }
                    gatt = g;
                    if (awaitOp(CONNECT_TIMEOUT_MS)) {
                        gattConnected = true;
                    } else {
                        // Bağlanamadı (timeout / GATT 133) — slot'u temizle ve tekrar dene.
                        try { g.close(); } catch (Exception ignored) {}
                        gatt = null;
                        if (attempt == 0) Thread.sleep(600);
                    }
                }
                if (!gattConnected || g == null)
                    throw new IOException("GATT bağlantı zaman aşımı / başarısız (133?)");

                // 2) (Opsiyonel) MTU yükselt — ELM327 yanıtları kısa, başarısızlık kritik değil.
                resetOpResult();
                boolean mtuReq = false;
                try { mtuReq = g.requestMtu(517); } catch (Exception ignored) {}
                if (mtuReq) awaitOp(OP_TIMEOUT_MS); // sonuç önemsiz; timeout'ta devam.

                // 3) Servis keşfi.
                resetOpResult();
                if (!g.discoverServices())
                    throw new IOException("discoverServices başlatılamadı");
                if (!awaitOp(OP_TIMEOUT_MS))
                    throw new IOException("Servis keşfi zaman aşımı / başarısız");

                // 4) Notify + write characteristic seçimi (hibrit: bilinen UUID → heuristik).
                selectCharacteristics(g);
                if (notifyChar == null || writeChar == null)
                    throw new IOException("Uygun notify/write characteristic bulunamadı");

                // 5) Notify'i aç + CCCD descriptor yaz; descriptor-write başarısı GELMEDEN init YOK.
                enableNotifications(g, notifyChar);

                // 6) Protokol katmanını GATT kanalıyla kur ve ELM327 init dizisini çalıştır.
                elm = new ElmProtocol(new GattChannel());
                String detectedProtocol = elm.initELM327(obdProtocol);

                obdRunning = true;
                cb.onConnected(detectedProtocol);

                pollLoop();

            } catch (Exception e) {
                disconnect();
                // Patch 3: yapılandırılmış hata kodu — bkz. OBDManager.connect() aynı desen.
                String code = (e instanceof ElmInitSequencer.UnableToConnectException)
                    ? "OBD_UNABLE_TO_CONNECT" : "CONNECT_FAILED";
                cb.onFailed(e.getMessage(), code);
            }
        });
    }

    /** Bağlantıyı kapatır, GATT kaynaklarını serbest bırakır (idempotent). */
    public synchronized void disconnect() {
        obdRunning = false;
        BluetoothGatt g = gatt;
        gatt = null;
        notifyChar = null;
        writeChar  = null;
        elm = null;
        if (g != null) {
            try { g.disconnect(); } catch (Exception ignored) {}
            // gatt.close() MUTLAKA — yoksa GATT client slot sızar.
            try { g.close(); } catch (Exception ignored) {}
        }
        // Bekleyen op'u serbest bırak (başarısız sonuç) — bloklu thread takılmasın.
        opResult.offer(Boolean.FALSE);
        synchronized (rxLock) {
            rxBuffer.setLength(0);
            promptSeen = false;
            rxLock.notifyAll();
        }
        // Patch 5: bu bağlantıya ait BEKLEYEN kuyruk görevleri artık anlamsız (elm=null) —
        // proaktif temizle (bkz. OBDManager.disconnect() aynı desen).
        cmdQueue.clearPending();
        // Patch 6: yeni bağlantı staggered poll döngüsünü sıfırdan başlatır.
        pollCycle = 0;
        lastVoltage = -1.0;
        // Patch 8: EXTENDED rotasyon imleci de sıfırlanır (liste TS yönetiminde, korunur).
        extendedIdx = 0;
    }

    /** Tam kapanış — bağlantı + executor (Plugin.handleOnDestroy'dan çağrılır). */
    public void shutdown() {
        disconnect();
        obdExecutor.shutdownNow();
        cmdQueue.shutdown();
    }

    // ── Polling ──────────────────────────────────────────────────────────────────

    private void pollLoop() {
        // PR-OBD-DIAG-3: yeni poll oturumu — extended kanıt sayaçlarını sıfırla (niyet korunur).
        ExtendedPollEvidence.INSTANCE.reset("ble");
        while (obdRunning && gatt != null) {
            try {
                Set<String> pidSet = obdPidSet;
                final ElmProtocol p = elm;
                if (p == null) throw new IOException("ELM protokol katmanı yok");

                // Patch 6: FAST grup — HER turda. Patch 5: her PID okuması ayrı bir kuyruk
                // görevi (elmLock kalktı) — DTC (USER önceliği) aralarına girebilir.
                int speed = shouldQuery(pidSet, "0D") ? queuedPidRead(ElmCommandQueue.Priority.POLL_FAST, p::readPID_speed) : -1;
                int rpm   = shouldQuery(pidSet, "0C") ? queuedPidRead(ElmCommandQueue.Priority.POLL_FAST, p::readPID_rpm)   : -1;

                // Patch 6: SLOW grup — bkz. OBDManager.pollLoop() aynı desen/gerekçe.
                int engineTemp = -1, fuelLevel = -1, throttle = -1, intakeTemp = -1, boostPressure = -1;
                if (pollCycle % SLOW_GROUP_EVERY_N_CYCLES == 0) {
                    engineTemp    = shouldQuery(pidSet, "05") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, p::readPID_temp)       : -1;
                    fuelLevel     = shouldQuery(pidSet, "2F") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, p::readPID_fuel)        : -1;
                    throttle      = shouldQuery(pidSet, "11") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, p::readPID_throttle)    : -1;
                    intakeTemp    = shouldQuery(pidSet, "0F") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, p::readPID_intakeTemp)  : -1;
                    boostPressure = shouldQuery(pidSet, "0B") ? queuedPidRead(ElmCommandQueue.Priority.POLL_SLOW, p::readPID_map)         : -1;
                }
                if (pollCycle % VOLTAGE_EVERY_N_CYCLES == 0) {
                    lastVoltage = queuedVoltageRead(p);
                }

                // Patch 8 / PR-OBD-BLE-1: EXTENDED grup — bkz. OBDManager.pollLoop() aynı desen.
                // PR-OBD-DIAG-3: her deneme outcome'u ExtendedPollEvidence'a işlenir (davranış aynı).
                java.util.List<String> ext = extendedPids;
                if (!ext.isEmpty()) {
                    final boolean burst = diagnosticBurst;
                    ExtendedPollEvidence.INSTANCE.recordCycle(burst, ext.size());
                    if (burst) {
                        // Teşhis burst: tüm izlenen PID'ler bu turda okunur → hızlı tazeleme.
                        // İptal kontrolü: kopma/kapanışta yarım turda çık (obdRunning=false).
                        for (String extPid : ext) {
                            if (!obdRunning || gatt == null) {
                                ExtendedPollEvidence.INSTANCE.recordAttempt(
                                    extPid, ExtendedPollEvidence.Outcome.CANCELLED, 0, 0, false);
                                break;
                            }
                            recordAndEmitExtended(p, extPid);
                        }
                    } else {
                        final String extPid = ext.get(extendedIdx % ext.size());
                        extendedIdx++;
                        recordAndEmitExtended(p, extPid);
                    }
                }
                pollCycle++;

                listener.onObdData(new ObdPollSample(speed, rpm, engineTemp, fuelLevel,
                    throttle, intakeTemp, boostPressure, lastVoltage));

                // PR-OBD-BLE-1: BURST modunda tur arası bekleme kısaltılır (tüm PID'ler zaten
                // bu turda okundu → tur uzun; ek uzun bekleme "sabit" hissi verirdi).
                Thread.sleep(diagnosticBurst ? BURST_POLL_MS : fastPollMs);

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
    private double queuedVoltageRead(ElmProtocol p) throws Exception {
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.POLL_SLOW, null, p::readVoltage).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            return -1.0;
        }
    }

    /**
     * Patch 6 (AdaptivePollingController): FAST grup poll periyodunu günceller.
     * @param ms yeni periyot (ms) — 100ms altı reddedilir.
     */
    public void setFastPollMs(int ms) {
        this.fastPollMs = Math.max(100, ms);
    }

    /** Patch 8: bkz. OBDManager.setExtendedPids — aynı sözleşme (boş=devre dışı, tavan 32). */
    public void setExtendedPids(java.util.List<String> pids) {
        if (pids == null || pids.isEmpty()) {
            this.extendedPids = java.util.Collections.emptyList();
            return;
        }
        java.util.List<String> copy = new java.util.ArrayList<>(
            pids.subList(0, Math.min(pids.size(), 32)));
        this.extendedPids = java.util.Collections.unmodifiableList(copy);
    }

    /**
     * PR-OBD-BLE-1: Teşhis BURST modunu aç/kapat — bkz. OBDManager.setDiagnosticBurst.
     * Açıkken pollLoop EXTENDED grubunun tüm izlenen PID'lerini her turda okur (hızlı
     * tazeleme). Kapanınca eski düşük-yük round-robin davranışına döner (Malı-400).
     * volatile alan → plugin thread'inden güvenli yazım, pollLoop thread'inden okuma.
     */
    public void setDiagnosticBurst(boolean on) {
        this.diagnosticBurst = on;
    }

    /**
     * PR-OBD-DIAG-3: bir EXTENDED PID'i okur, outcome kanıtını biriktirir ve (yalnız OK+veri
     * durumunda — eski davranışla birebir aynı) JS'e yayar. elapsedMs kuyruk beklemesini de
     * kapsar (deneme süresi olarak yeterli). Ek OBD komutu YOK.
     */
    private void recordAndEmitExtended(ElmProtocol p, String extPid) {
        long t0 = System.currentTimeMillis();
        ElmResponseParser.Result r = queuedExtendedClassified(p, extPid);
        long dt = System.currentTimeMillis() - t0;
        ExtendedPollEvidence.Outcome outcome = (r == null)
            ? ExtendedPollEvidence.Outcome.CANCELLED
            : ExtendedPollEvidence.fromResult(r);
        boolean emit = r != null && r.kind == ElmResponseParser.Kind.OK
            && r.dataHex != null && !r.dataHex.isEmpty();
        int respLen = (r != null && r.raw != null) ? r.raw.length() : 0;
        ExtendedPollEvidence.INSTANCE.recordAttempt(extPid, outcome, dt, respLen, emit);
        if (emit) listener.onExtendedPid(extPid, r.dataHex);
    }

    /** EXTENDED PID okumasını POLL_SLOW öncelikli kuyruğa gönderir — outcome sınıflandırmalı (Patch 8 / DIAG-3). */
    private ElmResponseParser.Result queuedExtendedClassified(ElmProtocol p, String pid) {
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.POLL_SLOW, null,
                () -> p.readPidClassified(pid)).get();
        } catch (Exception e) {
            return null; // kuyruk kapandı / iptal — çağıran CANCELLED sayar (fail-soft)
        }
    }

    /** PID seti null/boş ise (geriye dönük uyumluluk) tüm PID'ler sorgulanır. */
    private static boolean shouldQuery(Set<String> set, String pid) {
        return set == null || set.contains(pid);
    }

    // ── DTC API (plugin thread'inden çağrılır) ───────────────────────────────
    // Patch 5: elmLock (synchronized) kaldırıldı — cmdQueue TEK yürütücü thread'i
    // ile serileştirme zaten garanti; DTC istekleri USER önceliğiyle kuyruğa girer.

    /** Aktif BLE ELM bağlantısı var mı (plugin'in transport seçimi için). */
    public boolean isConnected() { return obdRunning; }

    /**
     * Kayıtlı arıza kodlarını okur (Mode 03). USER önceliğiyle kuyruğa girer — en kötü
     * ihtimalle ÇALIŞMAKTA olan TEK bir poll komutunun bitmesini bekler.
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
     * W5-OBD-PR1: OBD el sıkışması (VIN + desteklenen-PID bitmap keşfi) — BLE GATT yolu.
     * OBD-OS-F0-3: OBDManager.performHandshake ile aynı desen — adım adım DISCOVERY
     * görevleri (POLL_FAST'i preempt etmez, hot-path aç kalmaz).
     */
    public ElmProtocol.HandshakeRaw performHandshake() throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        return p.performHandshakeRaw(step -> {
            try {
                return cmdQueue.submit(ElmCommandQueue.Priority.DISCOVERY, null, step).get();
            } catch (java.util.concurrent.ExecutionException ee) {
                Throwable cause = ee.getCause();
                if (cause instanceof Exception) throw (Exception) cause;
                throw ee;
            }
        });
    }

    /**
     * OBD-OS-F3-1: UDS 0x19-02 (üretici-özel DTC) — BLE GATT yolu, aynı desen.
     */
    public String readUdsDtcs(String tx, String rx, String statusMask) throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null,
                () -> p.withEcuHeader(tx, rx, () -> p.readUdsDtcsRaw(statusMask))).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /**
     * OBD-OS-F2-3: ECU-başına DTC — BLE GATT yolu (OBDManager.readDtcsFromEcu ile aynı desen).
     * USER önceliği + atomik header set/restore.
     */
    public java.util.List<String> readDtcsFromEcu(String tx, String rx, String mode) throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.USER, null,
                () -> p.readDtcsFromEcu(tx, rx, mode)).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /**
     * OBD-OS-F2-1: fonksiyonel ECU probu — BLE GATT yolu (OBDManager.probeEcus ile aynı desen).
     * DISCOVERY önceliği: hot-path'i preempt etmez (F0-3).
     */
    public String probeEcus() throws Exception {
        final ElmProtocol p = elm;
        if (!obdRunning || p == null) throw new IOException("OBD bağlantısı yok");
        try {
            return cmdQueue.submit(ElmCommandQueue.Priority.DISCOVERY, null, p::probeEcusRaw).get();
        } catch (java.util.concurrent.ExecutionException ee) {
            Throwable cause = ee.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw ee;
        }
    }

    /**
     * Patch 12A: UDS Mode 22 (ReadDataByIdentifier) — bkz. OBDManager.readObdDid aynı desen
     * (ECU header ayarlama + oku + restore TEK kuyruk görevinde ATOMİK, USER önceliği).
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

    // ── Characteristic seçimi (hibrit: bilinen UUID önce, sonra heuristik) ──────────

    private void selectCharacteristics(BluetoothGatt g) {
        // Öncelik sırası: FFE1 (tek char) > FFF1/FFF2 (ayrı) > NUS.
        BluetoothGattService svc;

        svc = g.getService(UUID_SERVICE_FFE0);
        if (svc != null) {
            BluetoothGattCharacteristic c = svc.getCharacteristic(UUID_CHAR_FFE1);
            if (c != null) { notifyChar = c; writeChar = c; return; }
        }

        svc = g.getService(UUID_SERVICE_FFF0);
        if (svc != null) {
            BluetoothGattCharacteristic n = svc.getCharacteristic(UUID_CHAR_FFF1);
            BluetoothGattCharacteristic w = svc.getCharacteristic(UUID_CHAR_FFF2);
            if (n != null && w != null) { notifyChar = n; writeChar = w; return; }
            // Tek char fallback (bazı Veepeak klonları FFF1'i hem notify hem write yapar).
            if (n != null && hasWrite(n)) { notifyChar = n; writeChar = n; return; }
        }

        svc = g.getService(UUID_SERVICE_NUS);
        if (svc != null) {
            BluetoothGattCharacteristic n = svc.getCharacteristic(UUID_CHAR_NUS_TX);
            BluetoothGattCharacteristic w = svc.getCharacteristic(UUID_CHAR_NUS_RX);
            if (n != null && w != null) { notifyChar = n; writeChar = w; return; }
        }

        // Heuristik fallback — tüm servis/char'ları tara:
        //   notify = ilk NOTIFY|INDICATE'li char; write = ilk WRITE|WRITE_NO_RESPONSE'li char.
        BluetoothGattCharacteristic foundNotify = null;
        BluetoothGattCharacteristic foundWrite  = null;
        List<BluetoothGattService> services = g.getServices();
        if (services != null) {
            for (BluetoothGattService s : services) {
                List<BluetoothGattCharacteristic> chars = s.getCharacteristics();
                if (chars == null) continue;
                for (BluetoothGattCharacteristic c : chars) {
                    if (foundNotify == null && hasNotifyOrIndicate(c)) foundNotify = c;
                    if (foundWrite == null && hasWrite(c))             foundWrite  = c;
                }
            }
        }
        // write bulunamadıysa ve notify char yazılabiliyorsa onu kullan (tek char senaryosu).
        if (foundWrite == null && foundNotify != null && hasWrite(foundNotify)) {
            foundWrite = foundNotify;
        }
        if (foundNotify != null && foundWrite != null) {
            notifyChar = foundNotify;
            writeChar  = foundWrite;
        }
    }

    private static boolean hasNotifyOrIndicate(BluetoothGattCharacteristic c) {
        int p = c.getProperties();
        return (p & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
            || (p & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0;
    }

    private static boolean hasWrite(BluetoothGattCharacteristic c) {
        int p = c.getProperties();
        return (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
            || (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
    }

    // ── Notify aktivasyonu + CCCD yazımı ───────────────────────────────────────────

    private void enableNotifications(BluetoothGatt g, BluetoothGattCharacteristic c)
            throws IOException, InterruptedException {
        if (!g.setCharacteristicNotification(c, true))
            throw new IOException("setCharacteristicNotification başarısız");

        BluetoothGattDescriptor cccd = c.getDescriptor(UUID_CCCD);
        if (cccd == null)
            throw new IOException("CCCD (0x2902) descriptor yok — notify aktive edilemez");

        // Indicate ise ENABLE_INDICATION, değilse ENABLE_NOTIFICATION.
        boolean indicate = (c.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
                        && (c.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY)   == 0;
        byte[] value = indicate
                ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;

        resetOpResult();
        cccd.setValue(value);
        if (!g.writeDescriptor(cccd))
            throw new IOException("CCCD writeDescriptor başlatılamadı");

        // Descriptor-write callback başarısı GELMEDEN init'e GEÇME.
        if (!awaitOp(OP_TIMEOUT_MS))
            throw new IOException("CCCD yazım onayı alınamadı (notify aktive olmadı)");
    }

    // ── GATT callback ──────────────────────────────────────────────────────────────

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {

        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                // GATT 133 vb. — temiz hata + close.
                Log.w(TAG, "onConnectionStateChange hata status=" + status);
                signalOp(false);
                disconnect();
                return;
            }
            if (newState == BluetoothGatt.STATE_CONNECTED) {
                signalOp(true);
            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                Log.w(TAG, "GATT bağlantısı koptu");
                // Bekleyen op'u serbest bırak ve kaynakları temizle.
                signalOp(false);
                if (obdRunning) {
                    obdRunning = false;
                    try { listener.onStatusChanged("disconnected", "GATT bağlantısı koptu"); }
                    catch (Exception ignored) {}
                }
                disconnect();
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            signalOp(status == BluetoothGatt.GATT_SUCCESS);
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            signalOp(status == BluetoothGatt.GATT_SUCCESS);
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            signalOp(status == BluetoothGatt.GATT_SUCCESS);
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic characteristic, int status) {
            // WRITE_TYPE_DEFAULT yolunda send() bu onayı bekler.
            signalOp(status == BluetoothGatt.GATT_SUCCESS);
        }

        @Override
        @SuppressWarnings("deprecation") // backward-compat: getValue() (API 33'te deprecated)
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic) {
            byte[] data = characteristic.getValue();
            if (data == null || data.length == 0) return;
            appendRx(data);
        }
    };

    /** Notify chunk'ını reassembly buffer'a ekle; '>' prompt görülünce bekleyeni uyandır. */
    private void appendRx(byte[] data) {
        synchronized (rxLock) {
            for (byte b : data) {
                char ch = (char) (b & 0xFF);
                if (ch == '>') {
                    promptSeen = true;
                    continue;       // prompt yanıta dahil değil
                }
                if (ch == '\r') continue;   // CR atlanır (Classic ile tutarlı)
                rxBuffer.append(ch);
            }
            if (promptSeen) rxLock.notifyAll();
        }
    }

    // ── GATT op sonuç senkronizasyonu (callback thread → executor thread) ──────────

    private void resetOpResult() {
        opResult.clear();
    }

    /** GATT callback thread'inden çağrılır — bekleyen awaitOp'a sonuç verir. */
    private void signalOp(boolean success) {
        opResult.offer(Boolean.valueOf(success));
    }

    /** Executor thread'inden çağrılır — bir GATT op sonucunu bekler. */
    private boolean awaitOp(long timeoutMs) throws InterruptedException {
        Boolean r = opResult.poll(timeoutMs, TimeUnit.MILLISECONDS);
        return r != null && r.booleanValue();
    }

    // ── GATT tabanlı ElmCommandChannel ─────────────────────────────────────────────

    /**
     * BLE GATT taşıma kanalı — {@link ElmCommandChannel} implementasyonu.
     *
     * {@link ElmProtocol} bu kanalı RFCOMM'dan ayırt etmeden kullanır: send() komutu
     * write characteristic'e yazar, notify reassembly buffer'ı '>' prompt'una kadar
     * dolana dek bekler ve trim edilmiş yanıtı döner.
     *
     * SERİLİK: send() YALNIZCA tek thread'den (obdExecutor) çağrılır; ElmProtocol PID
     * okumalarını sıralı yapar. Bu yüzden ek bir komut-mutex'ine gerek yoktur — üst üste
     * write doğal olarak engellenir.
     */
    private final class GattChannel implements ElmCommandChannel {

        @Override
        @SuppressWarnings("deprecation") // backward-compat: setValue()/writeCharacteristic (API 33)
        public String send(String cmd, int timeoutMs) throws Exception {
            BluetoothGatt g = gatt;
            BluetoothGattCharacteristic w = writeChar;
            if (g == null || w == null) throw new IOException("BLE OBD bağlantısı yok");

            // Önceki yanıt artıklarını temizle (Classic'teki stale-skip karşılığı).
            synchronized (rxLock) {
                rxBuffer.setLength(0);
                promptSeen = false;
            }

            byte[] payload = (cmd + "\r").getBytes("ASCII");

            // WRITE_NO_RESPONSE varsa onu kullan (ELM327 için yaygın/hızlı); yoksa DEFAULT + onWrite bekle.
            boolean noResponse =
                (w.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
            w.setWriteType(noResponse
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            w.setValue(payload);

            if (!noResponse) resetOpResult();
            if (!g.writeCharacteristic(w))
                throw new IOException("writeCharacteristic başlatılamadı");

            if (!noResponse) {
                // DEFAULT write: onCharacteristicWrite onayını bekle (yine de seri kalır).
                if (!awaitOp(OP_TIMEOUT_MS))
                    throw new IOException("writeCharacteristic onayı alınamadı");
            }

            // '>' prompt'una kadar notify reassembly buffer'ını bekle.
            long dead = System.currentTimeMillis() + timeoutMs;
            synchronized (rxLock) {
                while (!promptSeen) {
                    long remaining = dead - System.currentTimeMillis();
                    if (remaining <= 0) break; // timeout — eldeki kısmi yanıtı dön (Classic davranışı)
                    rxLock.wait(remaining);
                }
                return rxBuffer.toString().trim();
            }
        }

        /** GATT sahipliği BleObdManager.disconnect()'tedir; kanal kendi başına kapatmaz. */
        @Override
        public void close() { /* no-op — disconnect() GATT'ı yönetir */ }
    }

    // ── Yardımcılar ────────────────────────────────────────────────────────────────

    private static UUID uuid16(String hex16) {
        return UUID.fromString("0000" + hex16 + "-0000-1000-8000-00805F9B34FB");
    }

    private static boolean present(String s) { return s != null && !s.isEmpty(); }
}
