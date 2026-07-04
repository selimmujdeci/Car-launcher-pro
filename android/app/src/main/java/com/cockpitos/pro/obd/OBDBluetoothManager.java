package com.cockpitos.pro.obd;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * OBD Bluetooth Auto-Pair + Reconnect State Machine.
 *
 * Durum geçişleri:
 *   IDLE → SCANNING / TRY_KNOWN_DEVICE
 *   SCANNING → CANDIDATE_FOUND | FALLBACK_USER_ACTION_REQUIRED
 *   CANDIDATE_FOUND → OPEN_SPP_SOCKET (bonded) | TRY_SILENT_PAIR_PIN_0000 (not bonded)
 *   TRY_SILENT_PAIR_PIN_* → WAIT_BOND_RESULT
 *   WAIT_BOND_RESULT → OPEN_SPP_SOCKET | TRY_SILENT_PAIR_PIN_* | FALLBACK_USER_ACTION_REQUIRED
 *   OPEN_SPP_SOCKET → ELM_DETECT | OPEN_SPP_SOCKET (backoff retry) | FALLBACK_USER_ACTION_REQUIRED
 *   ELM_DETECT → CONNECTED
 *   CONNECTED → OPEN_SPP_SOCKET (disconnect detect, backoff) | FALLBACK_USER_ACTION_REQUIRED
 *   FALLBACK_USER_ACTION_REQUIRED → SCANNING (user confirms)
 *
 * Güvenlik:
 *   - Yalnızca OBD anahtar kelime filtresi eşleşen cihazlar hedeflenir.
 *   - Otomatik eşleştirme yalnızca userConfirmed=true ile başlar.
 *   - MAC/PIN yalnızca yerel SharedPreferences'ta saklanır; asla upload edilmez.
 *   - Maksimum PIN denemesi: 4 (0000, 1234, 1111, 6789).
 *   - Maksimum socket yeniden bağlanma: 3 (1s, 3s, 8s backoff).
 *
 * Thread modeli:
 *   _handler (main thread)  → durum geçişleri, BroadcastReceiver callback'leri
 *   _exec   (single thread) → bloke olan socket.connect() ve ELM327 AT komutları
 */
@SuppressLint("MissingPermission")
public final class OBDBluetoothManager {

    private static final String TAG = "OBDBTManager";

    // SPP (Serial Port Profile) UUID
    private static final UUID SPP_UUID =
            UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    // OBD cihaz adı anahtar kelimeleri — yalnızca bunlarla eşleşen cihazlar hedeflenir
    private static final String[] OBD_KEYWORDS = {
            "ELM327", "OBD", "OBDII", "ICAR", "VLINKER",
            "V-LINK", "KONNWEI", "VEEPEAK", "OBDLINK"
    };

    // Silent pairing PIN sırası
    private static final String[] PINS = { "0000", "1234", "1111", "6789" };

    // Reconnect backoff (maks 3 deneme)
    private static final int    MAX_RECONNECT    = 3;
    private static final long[] BACKOFF_MS       = { 1_000L, 3_000L, 8_000L };

    // Timeout'lar
    private static final long BOND_TIMEOUT_MS       = 15_000L;
    private static final long SCAN_TIMEOUT_MS        = 20_000L;
    private static final long SOCKET_TIMEOUT_MS      =  8_000L;
    private static final long ELM_DETECT_TIMEOUT_MS  =  3_000L;

    // SharedPreferences
    private static final String PREFS_OBD    = "obd_bt_prefs";
    private static final String KEY_MAC      = "saved_mac";
    private static final String KEY_NAME     = "saved_name";
    private static final String KEY_PIN      = "saved_pin";
    private static final String KEY_LAST_AT  = "last_connected_at";

    // ── State enum ────────────────────────────────────────────────────────────

    public enum State {
        IDLE,
        SCANNING,
        CANDIDATE_FOUND,
        TRY_KNOWN_DEVICE,
        TRY_SILENT_PAIR_PIN_0000,
        TRY_SILENT_PAIR_PIN_1234,
        TRY_SILENT_PAIR_PIN_1111,
        TRY_SILENT_PAIR_PIN_6789,
        WAIT_BOND_RESULT,
        OPEN_SPP_SOCKET,
        ELM_DETECT,
        CONNECTED,
        FALLBACK_USER_ACTION_REQUIRED,
        FAILED
    }

    public interface Listener {
        /** State değiştiğinde main thread'den çağrılır. */
        void onState(State state, String deviceName, String mac, String info);
    }

    // ── Fields ────────────────────────────────────────────────────────────────

    private final Context         _ctx;
    private final Handler         _handler = new Handler(Looper.getMainLooper());
    private final ExecutorService _exec    = Executors.newSingleThreadExecutor();

    private volatile State   _state   = State.IDLE;
    private volatile boolean _running = false;

    private Listener        _listener;
    private BluetoothDevice _targetDevice;
    private BluetoothSocket _socket;
    private Future<?>       _activeFuture;

    /**
     * Patch 2 (iptal edilebilir native connect): deneme soketi — connect() ÇAĞRISINDAN ÖNCE
     * atanır. `_socket` yalnız BAŞARILI bağlantıda dolar; `Future.cancel(true)` (aşağıda
     * cancelActiveFuture()) Android'in BluetoothSocket.connect()'inde Thread.interrupt()'a
     * GÜVENİLİR biçimde yanıt VERMEDİĞİ için tek başına yeterli değildir — gerçek iptal
     * ancak socket.close() başka bir thread'den çağrılınca (bloklu connect() IOException
     * ile uyanır) gerçekleşir. closeSocket() artık bunu da kapatır.
     */
    private volatile BluetoothSocket _pendingSocket;

    private int     _pinIndex          = 0;
    private int     _reconnectAttempts = 0;
    private boolean _userConfirmed     = false;
    private boolean _receiverRegistered= false;

    // Saved device (SharedPreferences'tan yüklenir)
    private String _savedMac;
    private String _savedName;
    private String _savedPin;

    private BroadcastReceiver _receiver;

    // ── Constructor ───────────────────────────────────────────────────────────

    public OBDBluetoothManager(Context ctx) {
        _ctx = ctx.getApplicationContext();
        loadPrefs();
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Bağlantı sürecini başlatır.
     *
     * @param listener      Durum değişikliği callback'i (main thread'den çağrılır)
     * @param userConfirmed true → otomatik PIN pairing etkin (kullanıcı onayladı)
     *                      false → yalnızca bilinen + bonded cihaz denenir
     */
    public synchronized void start(Listener listener, boolean userConfirmed) {
        if (_running) return;
        _running       = true;
        _listener      = listener;
        _userConfirmed = userConfirmed;
        _pinIndex      = 0;
        _reconnectAttempts = 0;

        registerReceiver();

        if (_savedMac != null) {
            transitionTo(State.TRY_KNOWN_DEVICE, "Kayıtlı cihaz deneniyor: " + _savedName);
            _handler.post(this::tryKnownDevice);
        } else {
            transitionTo(State.SCANNING, "OBD cihazı aranıyor");
            _handler.post(this::startScan);
        }
    }

    public synchronized void stop() {
        if (!_running) return;
        _running = false;
        _handler.removeCallbacksAndMessages(null);
        cancelActiveFuture();
        unregisterReceiver();
        closeSocket();
        stopDiscovery();
        transitionTo(State.IDLE, "Durduruldu");
    }

    /**
     * Kullanıcı FALLBACK ekranında "Bağlan" butonuna bastı.
     * Kullanıcı onayı vermiş sayılır, tarama yeniden başlar.
     */
    public synchronized void userRequestConnect() {
        if (_state != State.FALLBACK_USER_ACTION_REQUIRED || !_running) return;
        _userConfirmed     = true;
        _pinIndex          = 0;
        _reconnectAttempts = 0;
        transitionTo(State.SCANNING, "Kullanıcı tetikledi");
        _handler.post(this::startScan);
    }

    /** Kayıtlı OBD cihazını sil (SharedPreferences). */
    public void clearSavedDevice() {
        _savedMac = null; _savedName = null; _savedPin = null;
        _ctx.getSharedPreferences(PREFS_OBD, Context.MODE_PRIVATE).edit().clear().apply();
        Log.i(TAG, "Kayıtlı OBD cihazı silindi");
    }

    public String  getSavedMac()  { return _savedMac;  }
    public String  getSavedName() { return _savedName; }
    public State   getState()     { return _state;     }

    // ── TRY_KNOWN_DEVICE ──────────────────────────────────────────────────────

    private void tryKnownDevice() {
        if (!_running) return;
        BluetoothAdapter adapter = getAdapter();
        if (adapter == null) { fallback("Bluetooth kullanılamıyor"); return; }

        Set<BluetoothDevice> bonded;
        try { bonded = adapter.getBondedDevices(); }
        catch (SecurityException e) { fallback("Bluetooth izni yok"); return; }

        if (bonded != null) {
            for (BluetoothDevice dev : bonded) {
                if (_savedMac != null && _savedMac.equals(dev.getAddress())) {
                    _targetDevice = dev;
                    transitionTo(State.OPEN_SPP_SOCKET, "Bilinen cihaz (eşleştirilmiş): " + safeGetName(dev));
                    _handler.post(this::openSocket);
                    return;
                }
            }
        }
        // Bonded listesinde yok — tara
        transitionTo(State.SCANNING, "Bilinen MAC bulunamadı, taranıyor: " + _savedMac);
        startScan();
    }

    // ── SCANNING ──────────────────────────────────────────────────────────────

    private void startScan() {
        if (!_running) return;
        BluetoothAdapter adapter = getAdapter();
        if (adapter == null) { fallback("Bluetooth kullanılamıyor"); return; }

        // Önce eşleştirilmiş listede OBD ara (tarama gerektirmez)
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice dev : bonded) {
                    if (!isObdDevice(dev)) continue;
                    if (_savedMac != null && !_savedMac.equals(dev.getAddress())) continue;
                    _targetDevice = dev;
                    _handler.removeCallbacks(this::onScanTimeout);
                    transitionTo(State.CANDIDATE_FOUND, "Eşleştirilmiş OBD bulundu: " + safeGetName(dev));
                    _handler.post(this::onCandidateFound);
                    return;
                }
            }
        } catch (SecurityException ignored) {}

        // Aktif tarama başlat
        try {
            adapter.startDiscovery();
        } catch (SecurityException e) {
            fallback("Bluetooth tarama izni yok"); return;
        }

        _handler.postDelayed(this::onScanTimeout, SCAN_TIMEOUT_MS);
    }

    private void onScanTimeout() {
        if (!_running || _state != State.SCANNING) return;
        stopDiscovery();
        fallback("OBD cihazı bulunamadı (20s timeout)");
    }

    private void stopDiscovery() {
        try {
            BluetoothAdapter a = getAdapter();
            if (a != null && a.isDiscovering()) a.cancelDiscovery();
        } catch (SecurityException ignored) {}
    }

    // ── CANDIDATE_FOUND ───────────────────────────────────────────────────────

    private void onCandidateFound() {
        if (!_running || _targetDevice == null) return;

        int bondState;
        try { bondState = _targetDevice.getBondState(); }
        catch (SecurityException e) { fallback("BT izni yok"); return; }

        if (bondState == BluetoothDevice.BOND_BONDED) {
            transitionTo(State.OPEN_SPP_SOCKET, "Cihaz zaten eşleştirilmiş");
            _handler.post(this::openSocket);
        } else {
            // Eşleştirilmemiş — kullanıcı onayı gerekiyor
            if (!_userConfirmed) {
                transitionTo(State.FALLBACK_USER_ACTION_REQUIRED,
                        "Otomatik eşleşme için dokunun: " + safeGetName(_targetDevice));
                return;
            }
            _pinIndex = 0;
            tryNextPin();
        }
    }

    // ── PIN PAIRING ───────────────────────────────────────────────────────────

    private void tryNextPin() {
        if (!_running) return;
        if (_pinIndex >= PINS.length) {
            fallback("Tüm PIN'ler başarısız — manuel eşleşme gerekiyor");
            return;
        }

        State pinState = pinIndexToState(_pinIndex);
        transitionTo(pinState, "PIN deneniyor: " + PINS[_pinIndex]);

        boolean started;
        try { started = _targetDevice.createBond(); }
        catch (SecurityException e) { fallback("BT eşleştirme izni yok"); return; }

        if (!started) {
            Log.w(TAG, "createBond() false döndü — sonraki PIN'e geç");
            _pinIndex++;
            _handler.postDelayed(this::tryNextPin, 1_000L);
            return;
        }

        transitionTo(State.WAIT_BOND_RESULT, "Bond bekleniyor (PIN: " + PINS[_pinIndex] + ")");

        // Bond timeout — cevap gelmezse sonraki PIN
        _handler.postDelayed(() -> {
            if (_running && _state == State.WAIT_BOND_RESULT) {
                Log.d(TAG, "Bond timeout (PIN: " + PINS[_pinIndex] + ")");
                cancelBondReflection();
                _pinIndex++;
                _handler.postDelayed(this::tryNextPin, 500L);
            }
        }, BOND_TIMEOUT_MS);
    }

    /** BluetoothDevice.removeBond() gizli API — timeout sonrası eski bond durumunu temizler. */
    private void cancelBondReflection() {
        if (_targetDevice == null) return;
        try {
            java.lang.reflect.Method m = _targetDevice.getClass().getMethod("removeBond");
            m.invoke(_targetDevice);
        } catch (Exception ignored) {}
    }

    private static State pinIndexToState(int index) {
        switch (index) {
            case 0:  return State.TRY_SILENT_PAIR_PIN_0000;
            case 1:  return State.TRY_SILENT_PAIR_PIN_1234;
            case 2:  return State.TRY_SILENT_PAIR_PIN_1111;
            case 3:  return State.TRY_SILENT_PAIR_PIN_6789;
            default: return State.WAIT_BOND_RESULT;
        }
    }

    // ── OPEN_SPP_SOCKET ───────────────────────────────────────────────────────

    private void openSocket() {
        if (!_running || _targetDevice == null) return;
        transitionTo(State.OPEN_SPP_SOCKET, "SPP socket açılıyor");

        // Discovery bağlantıyı yavaşlatır
        stopDiscovery();

        // Socket connect bloke eder — executor thread'ine taşı
        _activeFuture = _exec.submit(() -> {
            BluetoothSocket socket = null;
            try {
                socket = _targetDevice.createRfcommSocketToServiceRecord(SPP_UUID);
                _pendingSocket = socket; // Patch 2: connect() ÇAĞRISINDAN ÖNCE ata — iptal edilebilir
                socket.connect(); // bloke — closeSocket() ile başka thread'den kesilebilir
                final BluetoothSocket connected = socket;
                _socket = connected;
                _pendingSocket = null; // sahiplik _socket'e geçti
                _handler.post(this::onSocketConnected);
            } catch (IOException | SecurityException | IllegalArgumentException e) {
                Log.w(TAG, "Socket hatası: " + e.getMessage());
                _pendingSocket = null;
                if (socket != null) {
                    try { socket.close(); } catch (IOException ignored) {}
                }
                _handler.post(this::handleSocketFailure);
            }
        });

        // Timeout: SOCKET_TIMEOUT_MS içinde bağlanamazsa fut iptal + retry
        _handler.postDelayed(() -> {
            if (_running && _state == State.OPEN_SPP_SOCKET) {
                Log.d(TAG, "Socket timeout (" + SOCKET_TIMEOUT_MS + "ms)");
                cancelActiveFuture();
                handleSocketFailure();
            }
        }, SOCKET_TIMEOUT_MS);
    }

    private void onSocketConnected() {
        if (!_running) { closeSocket(); return; }
        _handler.removeCallbacksAndMessages(null); // timeout iptal
        _reconnectAttempts = 0;
        transitionTo(State.ELM_DETECT, "Socket bağlı — ELM327 tespit ediliyor");
        _handler.post(this::runElmDetect);
    }

    private void handleSocketFailure() {
        if (!_running) return;
        closeSocket();
        if (_reconnectAttempts < MAX_RECONNECT) {
            long delay = BACKOFF_MS[_reconnectAttempts];
            Log.i(TAG, "Reconnect " + (_reconnectAttempts + 1) + "/" + MAX_RECONNECT
                    + " (" + delay + "ms sonra)");
            _reconnectAttempts++;
            _handler.postDelayed(this::openSocket, delay);
        } else {
            fallback("Maksimum reconnect denemesi (" + MAX_RECONNECT + ") aşıldı");
        }
    }

    // ── ELM_DETECT ────────────────────────────────────────────────────────────

    private void runElmDetect() {
        if (!_running || _socket == null) { fallback("Socket yok"); return; }

        _activeFuture = _exec.submit(() -> {
            String elmVersion = null;
            try {
                OutputStream out = _socket.getOutputStream();
                InputStream  in  = _socket.getInputStream();

                // ELM327 reset komutu
                out.write("AT Z\r".getBytes(StandardCharsets.US_ASCII));
                out.flush();

                // Yanıt oku (timeout ile — '>' ELM prompt işareti)
                StringBuilder sb = new StringBuilder();
                long deadline = System.currentTimeMillis() + ELM_DETECT_TIMEOUT_MS;
                byte[] buf = new byte[128];
                while (System.currentTimeMillis() < deadline) {
                    int avail = in.available();
                    if (avail > 0) {
                        int n = in.read(buf, 0, Math.min(avail, buf.length));
                        if (n > 0) sb.append(new String(buf, 0, n, StandardCharsets.US_ASCII));
                        if (sb.indexOf(">") >= 0) break;
                    } else {
                        //noinspection BusyWait
                        Thread.sleep(50);
                    }
                }

                String resp = sb.toString().toUpperCase();
                if (resp.contains("ELM327") || resp.contains("ELM 327")) {
                    // "ELM327 v1.5" — kısa versiyon al
                    int idx = resp.indexOf("ELM");
                    elmVersion = sb.toString().substring(idx, Math.min(idx + 12, sb.length())).trim();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                Log.d(TAG, "ELM detect hatası (kritik değil): " + e.getMessage());
            }

            final String ver = elmVersion;
            _handler.post(() -> onElmDetectDone(ver));
        });
    }

    private void onElmDetectDone(String elmVersion) {
        if (!_running) return;
        String info = (elmVersion != null)
                ? "ELM327 tespit edildi: " + elmVersion
                : "ELM327 tespit edilemedi — cihaz yine de kullanılabilir";
        Log.i(TAG, info);
        saveDeviceToPrefs();
        transitionTo(State.CONNECTED, info);
    }

    // ── FALLBACK ──────────────────────────────────────────────────────────────

    private void fallback(String reason) {
        if (!_running) return;
        Log.w(TAG, "Fallback: " + reason);
        stopDiscovery();
        closeSocket();
        transitionTo(State.FALLBACK_USER_ACTION_REQUIRED,
                "Otomatik bağlantı kurulamadı. Bağlanmak için dokunun.");
    }

    // ── BroadcastReceiver ─────────────────────────────────────────────────────

    private void registerReceiver() {
        if (_receiverRegistered) return;

        _receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
                switch (action) {
                    case BluetoothDevice.ACTION_FOUND:
                        onDeviceFound(intent); break;
                    case BluetoothDevice.ACTION_BOND_STATE_CHANGED:
                        onBondStateChanged(intent); break;
                    case BluetoothDevice.ACTION_PAIRING_REQUEST:
                        if (onPairingRequest(intent)) abortBroadcast(); break;
                    case BluetoothAdapter.ACTION_DISCOVERY_FINISHED:
                        onDiscoveryFinished(); break;
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        // PAIRING_REQUEST yüksek öncelikli — sistem dialog'unu PIN inject ile iptal et
        filter.addAction(BluetoothDevice.ACTION_PAIRING_REQUEST);
        filter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                _ctx.registerReceiver(_receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                _ctx.registerReceiver(_receiver, filter);
            }
            _receiverRegistered = true;
        } catch (Exception e) {
            Log.w(TAG, "Receiver kaydı başarısız: " + e.getMessage());
        }
    }

    private void unregisterReceiver() {
        if (!_receiverRegistered || _receiver == null) return;
        try { _ctx.unregisterReceiver(_receiver); } catch (Exception ignored) {}
        _receiverRegistered = false;
        _receiver = null;
    }

    private void onDeviceFound(Intent intent) {
        if (!_running || _state != State.SCANNING) return;
        BluetoothDevice dev;
        try {
            dev = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class)
                    : intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        } catch (Exception e) { return; }
        if (dev == null || !isObdDevice(dev)) return;
        // savedMac varsa yalnızca onu hedefle
        if (_savedMac != null && !_savedMac.equals(dev.getAddress())) return;

        _handler.removeCallbacks(this::onScanTimeout);
        stopDiscovery();
        _targetDevice = dev;
        transitionTo(State.CANDIDATE_FOUND, "OBD cihazı bulundu: " + safeGetName(dev));
        _handler.post(this::onCandidateFound);
    }

    private void onDiscoveryFinished() {
        if (!_running || _state != State.SCANNING) return;
        // Scan bitti, cihaz bulunamadı
        _handler.removeCallbacks(this::onScanTimeout);
        fallback("Tarama tamamlandı — OBD cihazı bulunamadı");
    }

    private void onBondStateChanged(Intent intent) {
        if (!_running || _state != State.WAIT_BOND_RESULT) return;

        BluetoothDevice dev;
        int newState, prevState;
        try {
            dev       = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class)
                    : intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            newState  = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, -1);
            prevState = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, -1);
        } catch (Exception e) { return; }

        if (dev == null || _targetDevice == null) return;
        if (!dev.getAddress().equals(_targetDevice.getAddress())) return;

        Log.d(TAG, "Bond: " + prevState + " → " + newState);

        if (newState == BluetoothDevice.BOND_BONDED) {
            // Başarılı — bond timeout'unu iptal et, socket aç
            _handler.removeCallbacksAndMessages(null);
            _savedPin = (_pinIndex < PINS.length) ? PINS[_pinIndex] : null;
            transitionTo(State.OPEN_SPP_SOCKET, "Eşleştirme başarılı");
            _handler.post(this::openSocket);

        } else if (newState == BluetoothDevice.BOND_NONE
                && prevState == BluetoothDevice.BOND_BONDING) {
            // Eşleştirme başarısız — bond timeout'unu iptal et, sonraki PIN
            _handler.removeCallbacksAndMessages(null);
            Log.d(TAG, "Eşleştirme başarısız (PIN: " + PINS[_pinIndex] + ")");
            _pinIndex++;
            _handler.postDelayed(this::tryNextPin, 500L);
        }
    }

    /** @return true → caller should call abortBroadcast() to suppress system dialog */
    private boolean onPairingRequest(Intent intent) {
        if (!_userConfirmed) return false;
        BluetoothDevice dev;
        int variant;
        try {
            dev     = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class)
                    : intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, BluetoothDevice.ERROR);
        } catch (Exception e) { return false; }

        if (dev == null || _targetDevice == null) return false;
        if (!dev.getAddress().equals(_targetDevice.getAddress())) return false;
        if (_pinIndex >= PINS.length) return false;

        // PAIRING_VARIANT_CONSENT = 3 (hidden API — use literal to avoid compilation error)
        final int CONSENT = 3;

        if (variant == BluetoothDevice.PAIRING_VARIANT_PIN) {
            try {
                dev.setPin(PINS[_pinIndex].getBytes(StandardCharsets.US_ASCII));
                Log.d(TAG, "PIN enjekte edildi: " + PINS[_pinIndex]);
                return true;
            } catch (SecurityException e) {
                Log.w(TAG, "setPin izni yok: " + e.getMessage());
                return false;
            }
        } else if (variant == BluetoothDevice.PAIRING_VARIANT_PASSKEY_CONFIRMATION
                || variant == CONSENT) {
            try {
                dev.setPairingConfirmation(true);
                Log.d(TAG, "Pairing confirmation gönderildi");
                return true;
            } catch (SecurityException e) {
                Log.w(TAG, "setPairingConfirmation izni yok");
                return false;
            }
        }
        return false;
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private void transitionTo(State next, String info) {
        _state = next;
        Log.i(TAG, "→ " + next + (info != null ? " | " + info : ""));
        Listener l = _listener;
        if (l == null) return;
        String name = (_targetDevice != null) ? safeGetName(_targetDevice) : _savedName;
        String mac  = (_targetDevice != null) ? _targetDevice.getAddress()  : _savedMac;
        _handler.post(() -> l.onState(next, name, mac, info));
    }

    private boolean isObdDevice(BluetoothDevice dev) {
        String name = safeGetName(dev);
        if (name == null) return false;
        String upper = name.toUpperCase();
        for (String kw : OBD_KEYWORDS) {
            if (upper.contains(kw)) return true;
        }
        return false;
    }

    private static String safeGetName(BluetoothDevice dev) {
        if (dev == null) return null;
        try { return dev.getName(); } catch (SecurityException e) { return null; }
    }

    private static BluetoothAdapter getAdapter() {
        return BluetoothAdapter.getDefaultAdapter();
    }

    private void closeSocket() {
        BluetoothSocket s = _socket;
        _socket = null;
        if (s != null) {
            try { s.close(); } catch (IOException ignored) {}
        }
        // Patch 2: bekleyen (henüz _socket'e taşınmamış) bir bağlantı DENEMESİ varsa onu da
        // kapat — bloklu socket.connect() IOException ile uyanır (Future.cancel(true) tek
        // başına Android'de bunu garanti ETMEZ).
        BluetoothSocket p = _pendingSocket;
        _pendingSocket = null;
        if (p != null) {
            try { p.close(); } catch (IOException ignored) {}
        }
    }

    private void cancelActiveFuture() {
        Future<?> f = _activeFuture;
        _activeFuture = null;
        if (f != null) f.cancel(true);
    }

    private void saveDeviceToPrefs() {
        if (_targetDevice == null) return;
        _savedMac  = _targetDevice.getAddress();
        _savedName = safeGetName(_targetDevice);
        SharedPreferences.Editor ed =
                _ctx.getSharedPreferences(PREFS_OBD, Context.MODE_PRIVATE).edit();
        ed.putString(KEY_MAC,   _savedMac);
        ed.putString(KEY_NAME,  _savedName);
        ed.putLong  (KEY_LAST_AT, System.currentTimeMillis());
        if (_savedPin != null) ed.putString(KEY_PIN, _savedPin);
        ed.apply();
        Log.i(TAG, "OBD cihazı kaydedildi: " + _savedName + " [" + _savedMac + "]"
                + (_savedPin != null ? " PIN:" + _savedPin : ""));
    }

    private void loadPrefs() {
        SharedPreferences p = _ctx.getSharedPreferences(PREFS_OBD, Context.MODE_PRIVATE);
        _savedMac  = p.getString(KEY_MAC,  null);
        _savedName = p.getString(KEY_NAME, null);
        _savedPin  = p.getString(KEY_PIN,  null);
    }
}
