package com.cockpitos.pro.can;

import android.content.Context;
import android.util.Log;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Hibrit CAN bus orkestratörü.
 *
 * Üç transport katmanını sırayla dener, bağlananı kullanır:
 *
 *   1. FileSerial  — Dahili UART (/dev/ttyS*, ttyMT*, ttyHS*), su ile chmod bypass
 *   2. UsbSerial   — USB-to-serial adaptörler (CH340, CP2102, FTDI, CDC ACM)
 *   3. BtSerial    — Bluetooth RFCOMM (HC-05/HC-06, BT-CAN köprüler)
 *
 * Transport başarısız olursa 5s sonra sıfırdan tekrar dener.
 * Disconnect anında onTransportLost callback'i çağrılır — mapper reset için kullanılır.
 *
 * YAZMA: Yalnız sendCommand(byte[]) ile yapılır (MCU komut yolu — CommandService →
 * executeMcuCommandNative). Ham byte[] kabul eder; komut whitelist'i bu sınıfta DEĞİL,
 * McuCommandFactory'de uygulanır (bkz. C5 — bu sınıf frame içeriğini doğrulamaz).
 *
 * MRI F-01 (2026-09-19): "bağlanan transport" ≠ "yazılabilir transport". Bir transport
 * bağlandıktan sonra SALT-GÖZLEM durumundadır; RX verisi akar ama `sendCommand`
 * (heartbeat dâhil) ancak `ICanTransport.writeAuthorized()` doğruysa yazar. Gözlem
 * penceresinde kanıt gelmezse transport bırakılır ve keşif diğer adaylarla sürer.
 * Karar sahibi transport'un kendisidir (UART: SerialPortHandler sahiplik+protokol
 * kanıtı · USB: kullanıcı izni · BT: protokol kanıtı); bu sınıf ikinci bir karar
 * üretmez, yalnız kapıyı uygular.
 */
public final class CanBusManager {

    public interface FrameListener {
        void onFrame(byte[] frame);
    }

    private static final String TAG = "CanBusManager";

    private static final int[] BAUD_PRIORITIES = {
        SerialPortHandler.BAUD_115200,
        SerialPortHandler.BAUD_38400,
    };

    private static final long RECONNECT_DELAY_MS = 5_000L;
    // Donanım yokken (telefon/garaj) her 5s'de tüm transportları taramak CPU/IO
    // yakar ve okuma thread'ini bloke eder. Başarısız denemelerde aralık katlanır
    // (5s→10→20…→cap), bağlanınca sıfırlanır. Araç bağlanınca cap içinde yakalar.
    private static final long RECONNECT_MAX_MS   = 120_000L; // 2 dk tavan
    private volatile long _backoffMs = RECONNECT_DELAY_MS;

    public enum ConnectionMode { UART, USB, BLUETOOTH, NONE }

    private volatile boolean       _running    = false;
    private          Thread        _readThread = null;
    private          FrameListener _listener   = null;
    private          Context       _context    = null;
    private          Runnable      _onTransportLost = null;

    private volatile ICanTransport  _active = null;
    private volatile ConnectionMode _mode   = ConnectionMode.NONE;

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * @param listener        Frame callback (her geçerli frame için)
     * @param context         USB transport için gerekli (null → USB atlanır)
     * @param onTransportLost Transport koptuğunda çağrılır — VehicleSignalMapper.reset() gibi
     *                        temizlik işlemleri için. Read thread'inden çağrılır.
     */
    public synchronized void start(FrameListener listener, Context context, Runnable onTransportLost) {
        if (_running) return;
        _context         = context;
        _listener        = listener;
        _onTransportLost = onTransportLost;
        _running         = true;
        _backoffMs       = RECONNECT_DELAY_MS;   // taze başlangıçta tabandan başla
        _readThread      = new Thread(this::readLoop, "CanBusReader");
        _readThread.setDaemon(true);
        _readThread.start();
        Log.i(TAG, "CanBusManager (hibrit) başlatıldı");
    }

    /** Geriye dönük uyumluluk — onTransportLost yok. */
    public synchronized void start(FrameListener listener, Context context) {
        start(listener, context, null);
    }

    /** Geriye dönük uyumluluk. */
    public synchronized void start(FrameListener listener) {
        start(listener, null, null);
    }

    public synchronized void stop() {
        _running = false;
        ICanTransport t = _active;
        if (t != null) { t.disconnect(); _active = null; }
        _mode = ConnectionMode.NONE;
        if (_readThread != null) { _readThread.interrupt(); _readThread = null; }
        Log.i(TAG, "CanBusManager durduruldu");
    }

    public ConnectionMode getConnectionMode() { return _mode; }

    public String openPortPath() {
        ICanTransport t = _active;
        return t != null ? t.name() : null;
    }

    /**
     * MCU'ya paket yazar — YALNIZ yazma yetkisi kanıtlanmış transporta (MRI F-01).
     *
     * Eski gövde `t != null && t.write(packet)` idi: açılan ilk porta (K24'te OEM
     * MCU hattı /dev/ttyS2) heartbeat ve komut gidiyordu. Artık transport kendi
     * pozitif kanıtını (`writeAuthorized`) taşımadan tek bayt bile yazılmaz;
     * heartbeat de bu kapıdan geçer. Red bir kez defterlenir (spam yok).
     */
    public boolean sendCommand(byte[] packet) {
        ICanTransport t = _active;
        if (t == null) return false;
        if (!t.writeAuthorized()) {
            if (!_writeRefusedLogged) {
                _writeRefusedLogged = true;
                SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.WRITE_REFUSED, t.name(),
                    "evidence=" + t.evidenceLabel());
            }
            return false;
        }
        return t.write(packet);
    }

    /** Aktif transport yazma yetkisi taşıyor mu (heartbeat kapısı — ForegroundService). */
    public boolean isWriteAuthorized() {
        ICanTransport t = _active;
        return t != null && t.isConnected() && t.writeAuthorized();
    }

    /** Aktif transportun kanıt etiketi (teşhis; yoksa "NONE"). */
    public String activeEvidenceLabel() {
        ICanTransport t = _active;
        return t != null ? t.evidenceLabel() : "NONE";
    }

    /** Yazma reddi transport başına bir kez loglanır. */
    private volatile boolean _writeRefusedLogged = false;
    /** VERIFIED_TRANSPORT defter kaydı transport başına bir kez. */
    private volatile boolean _verifiedLogged     = false;

    public List<android.hardware.usb.UsbDevice> getDevicesNeedingUsbPermission() {
        return new ArrayList<>();
    }

    // ── Okuma döngüsü ─────────────────────────────────────────────────────────

    private void readLoop() {
        if (!tryConnect()) {
            Log.w(TAG, "İlk bağlantı başarısız — 5s'de tekrar denenecek");
        }

        while (_running && !Thread.currentThread().isInterrupted()) {
            try {
                ICanTransport transport = _active;

                if (transport == null || !transport.isConnected()) {
                    Thread.sleep(_backoffMs);
                    if (_running) {
                        if (tryConnect()) {
                            _backoffMs = RECONNECT_DELAY_MS;            // bağlandı → sıfırla
                        } else {
                            _backoffMs = Math.min(_backoffMs * 2, RECONNECT_MAX_MS); // katla
                        }
                    }
                    continue;
                }

                // readFrames() — bir OS chunk'ındaki tüm frame'leri döner
                List<byte[]> frames = transport.readFrames();
                if (!frames.isEmpty()) {
                    FrameListener cb = _listener;
                    if (cb != null) {
                        for (byte[] frame : frames) {
                            cb.onFrame(frame);
                        }
                    }
                    if (!_verifiedLogged && transport.writeAuthorized()) {
                        _verifiedLogged = true;
                        SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.VERIFIED_TRANSPORT,
                            transport.name(), "evidence=" + transport.evidenceLabel());
                    }
                } else if (transport.observationExpired()) {
                    /* MRI F-01: salt-gözlem penceresi doldu, TEK geçerli frame yok.
                       Bu port bizim MCU'muz değil (ya da sessiz). Yazmadan bırakılır;
                       transport soğumaya alındı, keşif diğer adaylarla sürer. */
                    Log.w(TAG, "Gözlem penceresi doldu, kanıt yok — bırakılıyor: " + transport.name());
                    notifyTransportLost();
                    transport.disconnect();
                    _active = null;
                    _mode   = ConnectionMode.NONE;
                    _writeRefusedLogged = false;
                    _verifiedLogged     = false;
                    continue;
                }
                // boş liste = timeout/no data — döngü devam

            } catch (IOException e) {
                Log.w(TAG, "Transport hatası: " + e.getMessage() + " — yeniden bağlanılıyor");
                notifyTransportLost();
                ICanTransport t = _active;
                if (t != null) { t.disconnect(); }
                _active = null;
                _mode   = ConnectionMode.NONE;

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;

            } catch (Exception e) {
                Log.w(TAG, "Beklenmeyen hata: " + e.getMessage());
                try { Thread.sleep(500); }
                catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
            }
        }

        ICanTransport t = _active;
        if (t != null) { t.disconnect(); _active = null; }
        _mode = ConnectionMode.NONE;
        // Normal döngü bitişinde de mapper'ı sıfırla (stop() → interrupt → burası)
        notifyTransportLost();
        Log.d(TAG, "readLoop sonlandı");
    }

    /** onTransportLost'u güvenle çağırır — null check + tek satır log. */
    private void notifyTransportLost() {
        Runnable onLost = _onTransportLost;
        if (onLost != null) {
            try { onLost.run(); }
            catch (Exception e) { Log.w(TAG, "onTransportLost hatası: " + e.getMessage()); }
        }
    }

    private boolean tryConnect() {
        List<ICanTransport> candidates = buildCandidates();

        for (int baud : BAUD_PRIORITIES) {
            for (ICanTransport transport : candidates) {
                if (!_running) return false;
                try {
                    if (transport.connect(baud)) {
                        _active = transport;
                        _mode   = modeOf(transport);
                        _writeRefusedLogged = false;
                        _verifiedLogged     = false;
                        Log.i(TAG, "Bağlandı → " + transport.name() + " @ " + baud);
                        SerialDiscoveryLedger.record(SerialDiscoveryLedger.Kind.SELECTED_TRANSPORT, transport.name(),
                            "baud=" + baud + " evidence=" + transport.evidenceLabel());
                        return true;
                    }
                } catch (Exception e) {
                    Log.d(TAG, transport.name() + " bağlantı hatası: " + e.getMessage());
                }
            }
        }

        _mode = ConnectionMode.NONE;
        return false;
    }

    /** YALNIZ TEST: donanımsız aday transport listesi (null → gerçek adaylar). */
    private volatile List<ICanTransport> _candidatesForTest = null;

    void setCandidatesForTest(List<ICanTransport> candidates) { _candidatesForTest = candidates; }

    private List<ICanTransport> buildCandidates() {
        List<ICanTransport> override = _candidatesForTest;
        if (override != null) return new ArrayList<>(override);
        List<ICanTransport> list = new ArrayList<>();
        list.add(new FileSerialTransport());
        if (_context != null) list.add(new UsbSerialTransport(_context));
        list.add(new BtSerialTransport());
        return list;
    }

    private static ConnectionMode modeOf(ICanTransport t) {
        if (t instanceof FileSerialTransport) return ConnectionMode.UART;
        if (t instanceof UsbSerialTransport)  return ConnectionMode.USB;
        if (t instanceof BtSerialTransport)   return ConnectionMode.BLUETOOTH;
        return ConnectionMode.NONE;
    }
}
