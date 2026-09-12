package com.cockpitos.pro.obd;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.util.List;

/**
 * BLE (Bluetooth Low Energy) OBD cihaz keşfi — SADECE discovery/listing.
 *
 * BU AŞAMADA YALNIZCA TARAMA YAPILIR:
 *   - GATT connect YOKTUR.
 *   - Bağlantı (connection) YOKTUR.
 *   - Eşleştirme (pairing) YOKTUR.
 *
 * Classic Bluetooth tarama yolundan tamamen bağımsızdır; ona dokunmaz.
 * Bulunan her BLE cihazı {@link Listener#onBleDeviceFound} ile ana thread'den bildirilir.
 *
 * BLE OBD adaptörleri (ör. Vgate iCar Pro BLE, Veepeak BLE, OBDLink CX/MX+ BLE)
 * Classic discovery'de (ACTION_FOUND) hiç görünmez; yalnızca LE tarama ile listelenir.
 *
 * İzinler (AndroidManifest'te mevcut olmalı):
 *   - API 31+ : BLUETOOTH_SCAN (neverForLocation flag'i OLMADAN)
 *   - API <31 : ACCESS_FINE_LOCATION + BLUETOOTH_ADMIN
 *
 * Thread modeli: tüm callback'ler ana thread'e (_handler) post edilir.
 */
@SuppressLint("MissingPermission")
public final class BleObdScanner {

    private static final String TAG = "BleObdScanner";

    /** BLE taraması için varsayılan süre (ms). Süre dolunca otomatik durur. */
    public static final long DEFAULT_SCAN_DURATION_MS = 20_000L;

    public interface Listener {
        /**
         * Bir BLE cihazı bulunduğunda ana thread'den çağrılır.
         *
         * @param name         Cihaz adı (yoksa adres döner — JS tarafı bunu "isim yok" sayar)
         * @param address      MAC adresi
         * @param serviceUuids Reklam paketinde duyurulan GATT servis UUID'leri (boş olabilir).
         *                     İsimsiz adaptörler için TEK pozitif kanıttır → JS sınıflandırması
         *                     bilinen OBD köprü servislerini (FFF0/FFE0/18F0…) burada arar.
         */
        void onBleDeviceFound(String name, String address, java.util.List<String> serviceUuids);

        /** BLE taraması durduğunda (süre dolumu veya manuel stop) ana thread'den çağrılır. */
        void onBleScanFinished();
    }

    private final Handler _handler = new Handler(Looper.getMainLooper());

    private BluetoothLeScanner _scanner;
    private ScanCallback       _scanCallback;
    private Listener           _listener;
    private boolean            _scanning = false;
    private Runnable           _autoStop;

    /**
     * BLE taramasını başlatır.
     *
     * @param listener        cihaz/durum callback'i (ana thread)
     * @param scanDurationMs  tarama süresi (ms); süre dolunca otomatik {@link #stop()} çağrılır
     * @return true → tarama başladı; false → BLE desteklenmiyor / BT kapalı / izin yok
     */
    public synchronized boolean start(Listener listener, long scanDurationMs) {
        if (_scanning) return true;

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            Log.w(TAG, "BLE tarama başlatılamadı: BT yok veya kapalı");
            return false;
        }

        BluetoothLeScanner scanner;
        try {
            scanner = adapter.getBluetoothLeScanner();
        } catch (SecurityException e) {
            Log.w(TAG, "BLE scanner izni yok: " + e.getMessage());
            return false;
        }
        if (scanner == null) {
            Log.w(TAG, "Cihaz BLE taramasını desteklemiyor (LE scanner null)");
            return false;
        }

        _listener = listener;
        _scanner  = scanner;
        _scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                handleResult(result);
            }

            @Override
            public void onBatchScanResults(List<ScanResult> results) {
                if (results == null) return;
                for (ScanResult r : results) handleResult(r);
            }

            @Override
            public void onScanFailed(int errorCode) {
                Log.w(TAG, "BLE tarama başarısız: errorCode=" + errorCode);
                _handler.post(() -> finish());
            }
        };

        // Low-latency: kısa keşif penceresi için en hızlı tarama modu.
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();

        try {
            // Filtre listesi null → tüm BLE reklamlarını yakala.
            // OBD adaptörlerinin servis UUID'leri standart olmadığından isim/ad
            // bazlı filtre JS tarafında (OBD_REGEX) yapılır.
            _scanner.startScan(null, settings, _scanCallback);
        } catch (SecurityException e) {
            Log.w(TAG, "startScan izni yok: " + e.getMessage());
            _scanner = null;
            _scanCallback = null;
            _listener = null;
            return false;
        }

        _scanning = true;
        Log.i(TAG, "BLE taraması başladı (" + scanDurationMs + "ms)");

        long duration = scanDurationMs > 0 ? scanDurationMs : DEFAULT_SCAN_DURATION_MS;
        _autoStop = this::stop;
        _handler.postDelayed(_autoStop, duration);
        return true;
    }

    /** BLE taramasını durdurur. İdempotent — birden çok kez çağrılabilir. */
    public synchronized void stop() {
        if (!_scanning) return;
        _scanning = false;

        if (_autoStop != null) {
            _handler.removeCallbacks(_autoStop);
            _autoStop = null;
        }

        BluetoothLeScanner scanner = _scanner;
        ScanCallback cb = _scanCallback;
        if (scanner != null && cb != null) {
            try { scanner.stopScan(cb); }
            catch (SecurityException | IllegalStateException ignored) {}
        }
        _scanner = null;
        _scanCallback = null;

        Log.i(TAG, "BLE taraması durdu");
        finish();
    }

    public synchronized boolean isScanning() {
        return _scanning;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private void handleResult(ScanResult result) {
        if (result == null) return;
        BluetoothDevice dev = result.getDevice();
        if (dev == null) return;

        final String address = dev.getAddress();
        if (address == null) return;

        String resolvedName = null;
        // API 33+: ScanRecord.getDeviceName() izin/güvenlik açısından daha güvenli.
        try {
            if (result.getScanRecord() != null) {
                resolvedName = result.getScanRecord().getDeviceName();
            }
        } catch (Exception ignored) {}
        if (resolvedName == null || resolvedName.isEmpty()) {
            try { resolvedName = dev.getName(); }
            catch (SecurityException ignored) {}
        }
        if (resolvedName == null || resolvedName.isEmpty()) {
            resolvedName = address;
        }

        // Reklam edilen GATT servis UUID'leri — isimsiz cihazlar için tek pozitif kanıt.
        final java.util.List<String> uuids = new java.util.ArrayList<>(2);
        try {
            if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null) {
                for (android.os.ParcelUuid pu : result.getScanRecord().getServiceUuids()) {
                    if (pu != null) uuids.add(pu.getUuid().toString());
                }
            }
        } catch (Exception ignored) { /* reklam çözümlenemedi → kanıt yok, akış bozulmaz */ }

        final String name = resolvedName;
        _handler.post(() -> {
            Listener l = _listener;
            if (l != null) l.onBleDeviceFound(name, address, uuids);
        });
    }

    private void finish() {
        Listener l = _listener;
        _listener = null;
        if (l != null) l.onBleScanFinished();
    }
}
