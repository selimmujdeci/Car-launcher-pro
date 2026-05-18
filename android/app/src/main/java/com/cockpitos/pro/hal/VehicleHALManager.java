package com.cockpitos.pro.hal;

import android.content.Context;
import android.util.Log;

import java.lang.reflect.Method;

/**
 * VehicleHALManager — AAOS VHAL okuma yöneticisi (STRICT READ-ONLY).
 *
 * android.car paketi build.gradle'da opsiyoneldir; tüm Car API erişimi
 * java.lang.reflect üzerinden yapılır. Sınıf AAOS olmayan cihazlarda
 * sessizce log atar ve sıfır değer döner — uygulama asla çökmez.
 *
 * Güvenli yığın: reflection → try/catch → volatile snapshot.
 * setProperty dahil hiçbir araç yazma komutu içermez.
 */
public class VehicleHALManager {

    private static final String TAG = "VehicleHALManager";

    // ── AAOS çalışma zamanı kontrolü (sınıf yükleme sırasında bir kez) ──────
    private static final boolean AAOS_AVAILABLE;
    static {
        boolean ok = false;
        try {
            Class.forName("android.car.Car");
            ok = true;
        } catch (ClassNotFoundException ignored) {}
        AAOS_AVAILABLE = ok;
    }

    // Reflection ile tutulan Car / CarPropertyManager nesneleri
    private Object _car         = null;
    private Object _propManager = null;

    // Son bilinen sinyal anlık görüntüsü (volatile → thread-safe okuma)
    private volatile float   _speed     = 0f;   // m/s
    private volatile float   _rpm       = 0f;
    private volatile float   _fuelLevel = 0f;   // litre
    private volatile float   _coolant   = 0f;   // °C
    private volatile int     _gear      = 0;
    private volatile boolean _connected = false;

    // ── AAOS VehiclePropertyIds (reflection ile alınır; fallback literal) ───
    // Alan adı → doğrudan android.car.VehiclePropertyIds sınıfından okunur.
    // AAOS olmayan cihazlarda fallback literal kullanılır; değer önemsizdir.
    private static final int PROP_SPEED        = resolvePropertyId("PERF_VEHICLE_SPEED",  0x11600207);
    private static final int PROP_RPM          = resolvePropertyId("ENGINE_RPM",           0x11600304);
    private static final int PROP_FUEL_LEVEL   = resolvePropertyId("FUEL_LEVEL",           0x11600307);
    private static final int PROP_COOLANT_TEMP = resolvePropertyId("ENGINE_COOLANT_TEMP",  0x11600301);
    private static final int PROP_GEAR_SEL     = resolvePropertyId("GEAR_SELECTION",       0x11400600);
    private static final int AREA_GLOBAL       = 0; // VehicleAreaType.VEHICLE_AREA_TYPE_GLOBAL

    private static int resolvePropertyId(String fieldName, int fallback) {
        try {
            Class<?> cls = Class.forName("android.car.VehiclePropertyIds");
            return (int) cls.getField(fieldName).get(null);
        } catch (Exception e) {
            return fallback;
        }
    }

    // ── Bağlantı yönetimi ────────────────────────────────────────────────────

    /**
     * AAOS Car servisine bağlan.
     * Cihaz AAOS değilse "not supported" logu atılır, işlem yapılmaz.
     */
    public void connect(Context context) {
        if (!AAOS_AVAILABLE) {
            Log.i(TAG, "VehicleHAL not supported on this device");
            return;
        }
        try {
            Class<?> carClass = Class.forName("android.car.Car");

            // Car.createCar(Context) — static factory
            Method createCar = carClass.getMethod("createCar", Context.class);
            _car = createCar.invoke(null, context.getApplicationContext());

            if (_car == null) {
                Log.w(TAG, "Car.createCar() returned null — VHAL kullanılamıyor");
                return;
            }

            // Car.connect() — API 28 ve altında gerekli; üstünde sessizce geçer
            try {
                Method connectMethod = carClass.getMethod("connect");
                connectMethod.invoke(_car);
            } catch (NoSuchMethodException ignored) {
                // API 29+'da connect() kaldırıldı; createCar() zaten bağlantı kurar
            }

            // CarPropertyManager'ı al
            Method getCarManager = carClass.getMethod("getCarManager", String.class);
            _propManager = getCarManager.invoke(_car, "android.car.property");
            _connected   = (_propManager != null);

            Log.i(TAG, "VehicleHAL connected — propManager=" + (_connected ? "OK" : "NULL"));
        } catch (Exception e) {
            Log.e(TAG, "VehicleHAL connect failed: " + e.getMessage());
            _connected = false;
        }
    }

    /**
     * Bağlantıyı güvenli kapat. İkinci çağrıda sessizce döner.
     */
    public void disconnect() {
        if (_car == null) return;
        try {
            Class<?> carClass = Class.forName("android.car.Car");
            Method   disc     = carClass.getMethod("disconnect");
            disc.invoke(_car);
        } catch (Exception e) {
            Log.w(TAG, "VehicleHAL disconnect: " + e.getMessage());
        } finally {
            _car         = null;
            _propManager = null;
            _connected   = false;
        }
    }

    public boolean isConnected() { return _connected; }

    // ── Sinyal okuyucular (READ-ONLY) ────────────────────────────────────────

    /** Araç hızı (m/s) — AAOS standart birimi; caller km/h'e çevirir */
    public float getSpeed() {
        _speed = readFloat(PROP_SPEED, _speed);
        return _speed;
    }

    /** Motor devri (RPM) */
    public float getRpm() {
        _rpm = readFloat(PROP_RPM, _rpm);
        return _rpm;
    }

    /** Yakıt seviyesi (litre) */
    public float getFuelLevel() {
        _fuelLevel = readFloat(PROP_FUEL_LEVEL, _fuelLevel);
        return _fuelLevel;
    }

    /** Motor soğutma suyu sıcaklığı (°C) */
    public float getCoolantTemp() {
        _coolant = readFloat(PROP_COOLANT_TEMP, _coolant);
        return _coolant;
    }

    /** Seçili vites pozisyonu */
    public int getGear() {
        _gear = readInt(PROP_GEAR_SEL, _gear);
        return _gear;
    }

    // ── Dahili reflection yardımcıları ───────────────────────────────────────

    private float readFloat(int propId, float fallback) {
        if (!_connected || _propManager == null) return fallback;
        try {
            Class<?> pm     = Class.forName("android.car.hardware.property.CarPropertyManager");
            Method   getter = pm.getMethod("getFloatProperty", int.class, int.class);
            Object   result = getter.invoke(_propManager, propId, AREA_GLOBAL);
            if (result instanceof Float) return (Float) result;
        } catch (Exception e) {
            Log.w(TAG, "readFloat propId=0x" + Integer.toHexString(propId)
                    + ": " + e.getMessage());
        }
        return fallback;
    }

    private int readInt(int propId, int fallback) {
        if (!_connected || _propManager == null) return fallback;
        try {
            Class<?> pm     = Class.forName("android.car.hardware.property.CarPropertyManager");
            Method   getter = pm.getMethod("getIntProperty", int.class, int.class);
            Object   result = getter.invoke(_propManager, propId, AREA_GLOBAL);
            if (result instanceof Integer) return (Integer) result;
        } catch (Exception e) {
            Log.w(TAG, "readInt propId=0x" + Integer.toHexString(propId)
                    + ": " + e.getMessage());
        }
        return fallback;
    }
}
