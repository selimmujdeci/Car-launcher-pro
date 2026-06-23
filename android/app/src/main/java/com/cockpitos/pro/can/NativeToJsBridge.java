package com.cockpitos.pro.can;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

/**
 * VehicleCanData'yı Capacitor "canData" event'ine dönüştürür ve JS'e iletir.
 *
 * Event adı: "canData"
 * JS tarafı yalnızca bu event'i dinler — native'e geri veri göndermez.
 */
public final class NativeToJsBridge {

    public interface EventEmitter {
        void notifyListeners(String event, JSObject payload);
    }

    private static final String EVENT_NAME = "canData";

    private final EventEmitter _emitter;

    public NativeToJsBridge(EventEmitter emitter) {
        _emitter = emitter;
    }

    /** VehicleCanData'yı "canData" event olarak JS'e gönderir. */
    public void emit(VehicleCanData data) {
        if (data == null) return;

        JSObject p = new JSObject();

        // ── Temel sürüş ──────────────────────────────────────────────────────
        if (data.speed        != null) p.put("speed",           data.speed);
        if (data.reverse      != null) p.put("reverse",         data.reverse);
        if (data.fuel         != null) p.put("fuel",            data.fuel);

        // ── Motor ────────────────────────────────────────────────────────────
        if (data.rpm          != null) p.put("rpm",             data.rpm);
        if (data.coolantTemp  != null) p.put("coolantTemp",     data.coolantTemp);
        if (data.oilTemp      != null) p.put("oilTemp",         data.oilTemp);
        if (data.throttle     != null) p.put("throttle",        data.throttle);

        // ── Elektrik ─────────────────────────────────────────────────────────
        if (data.batteryVolt  != null) p.put("batteryVolt",     data.batteryVolt);

        // ── Vites ────────────────────────────────────────────────────────────
        if (data.gearPos      != null) p.put("gearPos",         data.gearPos);

        // ── Çevre ────────────────────────────────────────────────────────────
        if (data.ambientTemp  != null) p.put("ambientTemp",     data.ambientTemp);

        // ── Kapı / aydınlatma ────────────────────────────────────────────────
        if (data.doorOpen     != null) p.put("doorOpen",        data.doorOpen);
        if (data.headlightsOn != null) p.put("headlightsOn",    data.headlightsOn);
        if (data.highBeam     != null) p.put("highBeam",        data.highBeam);
        if (data.turnLeft     != null) p.put("turnLeft",        data.turnLeft);
        if (data.turnRight    != null) p.put("turnRight",       data.turnRight);
        if (data.hazard       != null) p.put("hazard",          data.hazard);

        // ── Şasi bayrakları ──────────────────────────────────────────────────
        if (data.abs              != null) p.put("abs",              data.abs);
        if (data.tractionControl  != null) p.put("tractionControl",  data.tractionControl);
        if (data.stabilityControl != null) p.put("stabilityControl", data.stabilityControl);

        // ── Gövde bayrakları ─────────────────────────────────────────────────
        if (data.parkingBrake  != null) p.put("parkingBrake",   data.parkingBrake);
        if (data.seatbelt      != null) p.put("seatbelt",       data.seatbelt);
        if (data.wipers        != null) p.put("wipers",         data.wipers);
        if (data.airCondition  != null) p.put("airCondition",   data.airCondition);
        if (data.cruiseControl != null) p.put("cruiseControl",  data.cruiseControl);

        // ── TPMS ─────────────────────────────────────────────────────────────
        if (data.tpms != null && data.tpms.length == 4) {
            JSArray arr = new JSArray();
            try { for (float v : data.tpms) arr.put(v); }
            catch (org.json.JSONException ignored) {}
            p.put("tpms", arr);
        }

        _emitter.notifyListeners(EVENT_NAME, p);
    }
}
