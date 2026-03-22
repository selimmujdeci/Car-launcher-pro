package com.carlauncher.pro;

import android.bluetooth.BluetoothAdapter;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.BatteryManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CarLauncherPlugin — native Android bridge for Car Launcher Pro.
 *
 * Registered in MainActivity via: registerPlugin(CarLauncherPlugin.class)
 *
 * Methods:
 *   launchApp(packageName?, action?, data?)  — launch with full fallback chain
 *   getDeviceStatus()                        — BT / Wi-Fi / battery snapshot
 */
@CapacitorPlugin(name = "CarLauncher")
public class CarLauncherPlugin extends Plugin {

    /**
     * Launch an app using the best available strategy.
     *
     * Fallback chain (in order):
     *   1. packageName  → getLaunchIntentForPackage
     *   2. action       → Intent(action) [with optional data URI]
     *   3. data (URL)   → ACTION_VIEW
     *   4. packageName  → Play Store (if package provided but not installed)
     *
     * JS examples:
     *   CarLauncher.launchApp({ packageName: 'com.waze' })
     *   CarLauncher.launchApp({ packageName: 'com.android.dialer', action: 'android.intent.action.DIAL' })
     *   CarLauncher.launchApp({ action: 'android.settings.BLUETOOTH_SETTINGS' })
     */
    @PluginMethod
    public void launchApp(PluginCall call) {
        String packageName = call.getString("packageName");
        String action      = call.getString("action");
        String data        = call.getString("data");

        try {
            Intent intent = resolveIntent(packageName, action, data);
            if (intent == null) {
                call.reject("INVALID_ARGS", "No launchable target: provide packageName, action, or data");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("LAUNCH_FAILED", e.getMessage());
        }
    }

    /**
     * Resolve the best Intent for the given options.
     * Returns null if nothing is launchable.
     */
    private Intent resolveIntent(String packageName, String action, String data) {
        PackageManager pm = getContext().getPackageManager();

        // 1. Try package launch
        if (isPresent(packageName)) {
            Intent intent = pm.getLaunchIntentForPackage(packageName);
            if (intent != null) return intent;

            // Package provided but not installed:
            // 2. Try action fallback (e.g. DIAL even if com.android.dialer missing)
            if (isPresent(action)) {
                Intent fallback = buildActionIntent(action, data);
                if (fallback != null && fallback.resolveActivity(pm) != null) return fallback;
            }

            // 3. Play Store fallback
            return new Intent(Intent.ACTION_VIEW,
                Uri.parse("market://details?id=" + packageName));
        }

        // 4. Action-only launch
        if (isPresent(action)) {
            return buildActionIntent(action, data);
        }

        // 5. URL-only launch
        if (isPresent(data)) {
            return new Intent(Intent.ACTION_VIEW, Uri.parse(data));
        }

        return null;
    }

    private Intent buildActionIntent(String action, String data) {
        Intent intent = new Intent(action);
        if (isPresent(data)) intent.setData(Uri.parse(data));
        return intent;
    }

    private static boolean isPresent(String s) {
        return s != null && !s.isEmpty();
    }

    // ── Device status ──────────────────────────────────────

    /**
     * Returns a device status snapshot: BT enabled, Wi-Fi connected, battery %.
     *
     * Notes:
     *   - Wi-Fi SSID requires ACCESS_FINE_LOCATION on API 26+ — returns "" for now.
     *   - BT connected device name requires profile enumeration — returns generic label.
     *   - On API 31+, replace BluetoothAdapter.getDefaultAdapter() with BluetoothManager.
     */
    @PluginMethod
    public void getDeviceStatus(PluginCall call) {
        JSObject result = new JSObject();

        // Bluetooth
        BluetoothAdapter btAdapter = BluetoothAdapter.getDefaultAdapter();
        boolean btEnabled = btAdapter != null && btAdapter.isEnabled();
        result.put("btConnected", btEnabled);
        result.put("btDevice", btEnabled ? "Bağlı Cihaz" : "");

        // Wi-Fi
        ConnectivityManager cm =
            (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo wifiInfo = cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI);
        boolean wifiConnected = wifiInfo != null && wifiInfo.isConnected();
        result.put("wifiConnected", wifiConnected);
        result.put("wifiName", ""); // SSID requires ACCESS_FINE_LOCATION

        // Battery + charging state
        IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent batteryIntent = getContext().registerReceiver(null, ifilter);
        int level = batteryIntent != null
            ? batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, 0) : 0;
        int scale = batteryIntent != null
            ? batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, 100) : 100;
        result.put("battery", scale > 0 ? (int) ((level / (float) scale) * 100) : 0);

        int status = batteryIntent != null
            ? batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1) : -1;
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                        || status == BatteryManager.BATTERY_STATUS_FULL;
        result.put("charging", charging);

        call.resolve(result);
    }
}
