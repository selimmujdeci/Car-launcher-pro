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
 * FAZ NOTU:
 *   - Bu sınıf HENÜZ WIRE EDİLMEDİ (CarLauncherPlugin.connectOBD'den çağrılmıyor).
 *     Derlenir ve kullanılmaya hazırdır; Faz 3'te plugin dallanması eklenecek.
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
        /** Her poll döngüsünde çözümlenmiş PID değerleri (desteklenmeyen = -1). */
        void onObdData(int speed, int rpm, int engineTemp, int fuelLevel);
        /** Asenkron durum değişimi (ör. poll sırasında bağlantı koptu). message null olabilir. */
        void onStatusChanged(String state, String message);
        /** Beklenmedik motor hatası. */
        void onError(String error);
    }

    /** connect() için tek-seferlik sonuç callback'i — PluginCall resolve/reject Plugin'de kalır. */
    public interface ConnectCallback {
        void onConnected();
        void onFailed(String error);
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
                elm.initELM327(obdProtocol);

                obdRunning = true;
                cb.onConnected();

                pollLoop();

            } catch (Exception e) {
                disconnect();
                cb.onFailed(e.getMessage());
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
    }

    /** Tam kapanış — bağlantı + executor (Plugin.handleOnDestroy'dan çağrılır). */
    public void shutdown() {
        disconnect();
        obdExecutor.shutdownNow();
    }

    // ── Polling ──────────────────────────────────────────────────────────────────

    private void pollLoop() {
        while (obdRunning && gatt != null) {
            try {
                Set<String> pidSet = obdPidSet;
                int speed      = shouldQuery(pidSet, "0D") ? elm.readPID_speed() : -1;
                int rpm        = shouldQuery(pidSet, "0C") ? elm.readPID_rpm()   : -1;
                int engineTemp = shouldQuery(pidSet, "05") ? elm.readPID_temp()  : -1;
                int fuelLevel  = shouldQuery(pidSet, "2F") ? elm.readPID_fuel()  : -1;

                listener.onObdData(speed, rpm, engineTemp, fuelLevel);

                Thread.sleep(POLL_INTERVAL_MS);

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

    /** PID seti null/boş ise (geriye dönük uyumluluk) tüm PID'ler sorgulanır. */
    private static boolean shouldQuery(Set<String> set, String pid) {
        return set == null || set.contains(pid);
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
