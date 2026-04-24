package com.cockpitos.pro.can;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

/**
 * VehicleCanData'yı Capacitor "canData" event'ine dönüştürür ve JS'e iletir.
 *
 * Event adı: "canData"
 * Payload:   { speed?, reverse?, fuel?, doorOpen?, headlightsOn?, tpms? }
 *
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

        JSObject payload = new JSObject();

        if (data.speed        != null) payload.put("speed",        data.speed);
        if (data.reverse      != null) payload.put("reverse",      data.reverse);
        if (data.fuel         != null) payload.put("fuel",         data.fuel);
        if (data.doorOpen     != null) payload.put("doorOpen",     data.doorOpen);
        if (data.headlightsOn != null) payload.put("headlightsOn", data.headlightsOn);

        if (data.tpms != null && data.tpms.length == 4) {
            JSArray tpmsArr = new JSArray();
            try {
                for (float v : data.tpms) tpmsArr.put(v);
            } catch (org.json.JSONException ignored) {}
            payload.put("tpms", tpmsArr);
        }

        _emitter.notifyListeners(EVENT_NAME, payload);
    }
}
