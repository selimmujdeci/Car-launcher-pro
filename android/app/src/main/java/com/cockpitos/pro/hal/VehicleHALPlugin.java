package com.cockpitos.pro.hal;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * VehicleHALPlugin — Capacitor ↔ VehicleHALManager köprüsü.
 *
 * JS tarafı:
 *   Capacitor.Plugins.VehicleHAL.startHAL()
 *   Capacitor.Plugins.VehicleHAL.stopHAL()
 *   Capacitor.Plugins.VehicleHAL.getSignal()
 *
 * Tüm araç erişimi READ-ONLY; VehicleHALManager'dan geçer.
 */
@CapacitorPlugin(name = "VehicleHAL")
public class VehicleHALPlugin extends Plugin {

    private final VehicleHALManager manager = new VehicleHALManager();

    /**
     * AAOS Car servisine bağlan.
     * Cihaz AAOS değilse manager sessizce loglar; call.resolve() yine döner.
     */
    @PluginMethod
    public void startHAL(PluginCall call) {
        try {
            manager.connect(getContext());
            JSObject result = new JSObject();
            result.put("connected", manager.isConnected());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("VehicleHAL start failed: " + e.getMessage(), e);
        }
    }

    /**
     * AAOS bağlantısını kapat. Bağlı değilse sessizce başarı döner.
     */
    @PluginMethod
    public void stopHAL(PluginCall call) {
        try {
            manager.disconnect();
            call.resolve();
        } catch (Exception e) {
            call.reject("VehicleHAL stop failed: " + e.getMessage(), e);
        }
    }

    /**
     * Anlık sinyal paketini döner.
     * Bağlantı yoksa { connected: false } döner (reject değil) —
     * JS tarafı null-safe okuma yapabilir.
     */
    @PluginMethod
    public void getSignal(PluginCall call) {
        try {
            JSObject data = new JSObject();
            data.put("connected", manager.isConnected());

            if (!manager.isConnected()) {
                call.resolve(data);
                return;
            }

            // Birimler AAOS standardı; JS/SignalNormalizer dönüşüm yapar:
            //   speedMs  → km/h (× 3.6)
            //   fuelL    → % (÷ tankCapacity × 100)
            data.put("speedMs",      manager.getSpeed());
            data.put("rpm",          manager.getRpm());
            data.put("fuelL",        manager.getFuelLevel());
            data.put("coolantTempC", manager.getCoolantTemp());
            data.put("gear",         manager.getGear());
            data.put("ts",           System.currentTimeMillis());
            call.resolve(data);
        } catch (Exception e) {
            call.reject("getSignal failed: " + e.getMessage(), e);
        }
    }
}
