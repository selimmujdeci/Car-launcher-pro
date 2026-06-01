package com.cockpitos.pro.can;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Log;

/**
 * SystemCanBroadcastAdapter — Android sistem servisinden CAN broadcast'i alır.
 *
 * Çin aftermarket head unit'lerin büyük çoğunluğu CAN verisini Android
 * sistem broadcast'i olarak yayar. Bu adapter yaygın tüm action'ları dinler:
 *
 *   K24 / K6 (Hiworld CarSetting servis):
 *     com.canbox.action.CAN_DATA
 *     com.hiworld.can.DATA
 *     com.android.car.action.VEHICLE_DATA
 *
 *   Jmance / VCAN platformu:
 *     com.jmance.canbox.DATA
 *     com.vcan.action.CAN_SIGNAL
 *
 *   Kanuo / 4GHIFI / Generic:
 *     com.canbox.signal
 *     android.intent.action.CANBOX_DATA
 *     com.carmark.canbox.DATA_CHANGED
 *
 * Broadcast extras'ında sinyal adı olarak çeşitli key varyantları denenir.
 * İlk geçerli değer kabul edilir (fault-tolerant çoklu anahtar okuma).
 *
 * READ-ONLY: Araç sistemlerine hiçbir broadcast veya sinyal gönderilmez.
 */
public final class SystemCanBroadcastAdapter {

    public interface DecodedListener {
        void onData(VehicleCanData data);
    }

    private static final String TAG = "SystemCanBroadcast";

    // Tüm bilinen CAN broadcast action'ları
    private static final String[] ACTIONS = {
        "com.canbox.action.CAN_DATA",
        "com.canbox.signal",
        "com.hiworld.can.DATA",
        "com.hiworld.canbox.DATA_CHANGED",
        "com.android.car.action.VEHICLE_DATA",
        "com.carmark.canbox.DATA_CHANGED",
        "com.jmance.canbox.DATA",
        "com.vcan.action.CAN_SIGNAL",
        "android.intent.action.CANBOX_DATA",
        "com.canbox.speed",
        "com.mediatek.canbox.DATA",
        "com.allwinner.canbox.DATA",
        "com.rockchip.canbox.DATA",
        "com.carsetting.can.DATA",
        "com.autolink.canbox.DATA",
        // NWD (K2401-NWD) platform'a özgü action'lar
        "com.nwd.can.DATA",
        "com.nwd.canbox.DATA",
        "com.nwd.vehicle.DATA",
        "com.nwd.factory.can.DATA",
        "com.nwd.carsetting.DATA",
        "com.nwd.can.SIGNAL",
        "com.nwd.audio.CAN",
        "com.nwd.factory.setting.CAN_DATA",
    };

    // Hız için olası extra key isimleri (farklı üreticiler farklı isim kullanır)
    private static final String[] KEY_SPEED    = { "speed","vehicle_speed","vehicleSpeed","car_speed","Speed","SPEED","spd" };
    private static final String[] KEY_RPM      = { "rpm","engine_rpm","engineRpm","RPM","revs","rpm_value" };
    private static final String[] KEY_FUEL     = { "fuel","fuel_level","fuelLevel","FuelLevel","FUEL","fuel_pct" };
    private static final String[] KEY_COOLANT  = { "coolant","coolant_temp","coolantTemp","water_temp","waterTemp","engine_temp" };
    private static final String[] KEY_OIL_TEMP = { "oil_temp","oilTemp","OilTemp","engine_oil_temp" };
    private static final String[] KEY_THROTTLE = { "throttle","throttle_pos","throttlePos","accel","pedal" };
    private static final String[] KEY_REVERSE  = { "reverse","is_reverse","isReverse","gear_reverse","reverseGear" };
    private static final String[] KEY_GEAR     = { "gear","gear_pos","gearPos","gear_position","current_gear" };
    private static final String[] KEY_DOOR     = { "door","door_open","doorOpen","door_status","doorStatus" };
    private static final String[] KEY_LIGHTS   = { "headlight","headlights","light","lights","light_on","headlightOn" };
    private static final String[] KEY_BATT     = { "battery_volt","battVolt","batt_volt","battery_voltage","volt_12v" };
    private static final String[] KEY_PARKBRAKE= { "parking_brake","parkBrake","handbrake","park_brake" };
    private static final String[] KEY_SEATBELT = { "seatbelt","seat_belt","belt","driver_belt" };

    // Sanity
    private static final float SPEED_MAX = 300f;
    private static final float RPM_MAX   = 12_000f;
    private static final float TEMP_MIN  = -40f;
    private static final float TEMP_MAX  = 150f;

    private BroadcastReceiver _receiver = null;
    private DecodedListener   _listener = null;
    private boolean           _started  = false;

    public void start(DecodedListener listener, Context context) {
        if (_started) return;
        _listener = listener;
        _started  = true;

        _receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                VehicleCanData data = parseIntent(intent);
                if (data != null && _listener != null) _listener.onData(data);
            }
        };

        IntentFilter filter = new IntentFilter();
        for (String action : ACTIONS) filter.addAction(action);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(_receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                context.registerReceiver(_receiver, filter);
            }
            Log.i(TAG, "SystemCanBroadcastAdapter kayıtlı — " + ACTIONS.length + " action dinleniyor");
        } catch (Exception e) {
            Log.e(TAG, "BroadcastReceiver kayıt hatası: " + e.getMessage());
        }
    }

    public void stop(Context context) {
        if (!_started) return;
        _started = false;
        if (_receiver != null) {
            try { context.unregisterReceiver(_receiver); }
            catch (Exception ignored) {}
            _receiver = null;
        }
        Log.i(TAG, "SystemCanBroadcastAdapter durduruldu");
    }

    // ── Intent → VehicleCanData ───────────────────────────────────────────────

    private VehicleCanData parseIntent(Intent intent) {
        if (intent == null || intent.getExtras() == null) return null;

        VehicleCanData.Builder b = new VehicleCanData.Builder();
        boolean any = false;

        // Hız
        Float speed = getFloat(intent, KEY_SPEED);
        if (speed != null && speed >= 0 && speed <= SPEED_MAX) { b.speed(speed); any = true; }

        // RPM
        Float rpm = getFloat(intent, KEY_RPM);
        if (rpm != null && rpm >= 0 && rpm <= RPM_MAX) { b.rpm(rpm); any = true; }

        // Yakıt
        Float fuel = getFloat(intent, KEY_FUEL);
        if (fuel != null && fuel >= 0 && fuel <= 100) { b.fuel(fuel); any = true; }

        // Soğutma suyu
        Float coolant = getFloat(intent, KEY_COOLANT);
        if (coolant != null && coolant >= TEMP_MIN && coolant <= TEMP_MAX) { b.coolantTemp(coolant); any = true; }

        // Yağ ısısı
        Float oilT = getFloat(intent, KEY_OIL_TEMP);
        if (oilT != null && oilT >= TEMP_MIN && oilT <= TEMP_MAX) { b.oilTemp(oilT); any = true; }

        // Gaz kelebeği
        Float throttle = getFloat(intent, KEY_THROTTLE);
        if (throttle != null && throttle >= 0 && throttle <= 100) { b.throttle(throttle); any = true; }

        // Geri vites
        Boolean reverse = getBool(intent, KEY_REVERSE);
        if (reverse != null) { b.reverse(reverse); any = true; }

        // Vites pozisyonu (int: -1=R, 0=P/N, 1-8=ileri)
        Integer gear = getInt(intent, KEY_GEAR);
        if (gear != null) { b.gearPos(gear); any = true; }

        // Kapı
        Boolean door = getBool(intent, KEY_DOOR);
        if (door != null) { b.doorOpen(door); any = true; }

        // Far
        Boolean lights = getBool(intent, KEY_LIGHTS);
        if (lights != null) { b.headlights(lights); any = true; }

        // Akü voltajı
        Float batt = getFloat(intent, KEY_BATT);
        if (batt != null && batt >= 8f && batt <= 20f) { b.batteryVolt(batt); any = true; }

        // El freni
        Boolean park = getBool(intent, KEY_PARKBRAKE);
        if (park != null) { b.parkingBrake(park); any = true; }

        // Emniyet kemeri
        Boolean belt = getBool(intent, KEY_SEATBELT);
        if (belt != null) { b.seatbelt(belt); any = true; }

        if (!any) {
            Log.v(TAG, "Broadcast alındı ama tanınan extra yok: " + intent.getAction());
            return null;
        }

        Log.d(TAG, "Broadcast çözüldü: " + intent.getAction());
        return b.build();
    }

    // ── Extra okuyucular (çoklu key adı desteği) ─────────────────────────────

    private static Float getFloat(Intent i, String[] keys) {
        for (String k : keys) {
            if (i.hasExtra(k)) {
                Object v = i.getExtras().get(k);
                if (v instanceof Number) return ((Number) v).floatValue();
                if (v instanceof String)  { try { return Float.parseFloat((String) v); } catch (Exception ignored) {} }
            }
        }
        return null;
    }

    private static Integer getInt(Intent i, String[] keys) {
        for (String k : keys) {
            if (i.hasExtra(k)) {
                Object v = i.getExtras().get(k);
                if (v instanceof Number) return ((Number) v).intValue();
                if (v instanceof String)  { try { return Integer.parseInt((String) v); } catch (Exception ignored) {} }
            }
        }
        return null;
    }

    private static Boolean getBool(Intent i, String[] keys) {
        for (String k : keys) {
            if (i.hasExtra(k)) {
                Object v = i.getExtras().get(k);
                if (v instanceof Boolean) return (Boolean) v;
                if (v instanceof Number)  return ((Number) v).intValue() != 0;
                if (v instanceof String)  return "1".equals(v) || "true".equalsIgnoreCase((String) v);
            }
        }
        return null;
    }
}
