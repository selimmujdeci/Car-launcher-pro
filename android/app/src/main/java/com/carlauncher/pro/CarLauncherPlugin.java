package com.carlauncher.pro;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * CarLauncherPlugin — native Android bridge for Car Launcher Pro.
 *
 * Methods:
 *   launchApp(packageName?, action?, data?)  — launch with full fallback chain
 *   getDeviceStatus()                        — BT / Wi-Fi / battery snapshot
 *   scanOBD()                                — list paired Bluetooth devices
 *   connectOBD(address)                      — connect to ELM327 OBD adapter
 *   disconnectOBD()                          — close OBD connection
 *
 * Events (via notifyListeners):
 *   obdStatus  { state: 'disconnected'|'error', message? }
 *   obdData    { speed, rpm, engineTemp, fuelLevel }  (every ~3 s)
 */
@CapacitorPlugin(name = "CarLauncher")
public class CarLauncherPlugin extends Plugin {

    // ── App launch ──────────────────────────────────────────

    /**
     * Launch an app using the best available strategy.
     *
     * Fallback chain (in order):
     *   1. packageName  → getLaunchIntentForPackage
     *   2. action       → Intent(action) [with optional data URI]
     *   3. data (URL)   → ACTION_VIEW
     *   4. packageName  → Play Store (if package provided but not installed)
     */
    @PluginMethod
    public void launchApp(PluginCall call) {
        String packageName = call.getString("packageName");
        String action      = call.getString("action");
        String data        = call.getString("data");
        String category    = call.getString("category");

        try {
            Intent intent = resolveIntent(packageName, action, data, category);
            if (intent == null) {
                call.reject("INVALID_ARGS", "No launchable target found");
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
     * Scan all apps with CATEGORY_LAUNCHER.
     */
    @PluginMethod
    public void getApps(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            Intent intent = new Intent(Intent.ACTION_MAIN, null);
            intent.addCategory(Intent.CATEGORY_LAUNCHER);

            List<ResolveInfo> list = pm.queryIntentActivities(intent, 0);
            JSArray apps = new JSArray();

            for (ResolveInfo info : list) {
                JSObject app = new JSObject();
                app.put("name",        info.loadLabel(pm).toString());
                app.put("packageName", info.activityInfo.packageName);
                app.put("className",   info.activityInfo.name);

                boolean isSystem = (info.activityInfo.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
                app.put("isSystemApp", isSystem);

                apps.put(app);
            }

            JSObject result = new JSObject();
            result.put("apps", apps);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("SCAN_FAILED", e.getMessage());
        }
    }

    private Intent resolveIntent(String packageName, String action, String data, String category) {
        PackageManager pm = getContext().getPackageManager();

        // 1. Try package directly
        if (isPresent(packageName)) {
            Intent intent = pm.getLaunchIntentForPackage(packageName);
            if (intent != null) return intent;
        }

        // 2. Try action (even if package was provided but not found/launcher)
        if (isPresent(action)) {
            Intent intent = buildActionIntent(action, data);
            if (intent != null && intent.resolveActivity(pm) != null) return intent;
        }

        // 3. Try standard Category (e.g. CATEGORY_APP_MESSAGING)
        if (isPresent(category) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.ICE_CREAM_SANDWICH) {
            Intent intent = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, category);
            if (intent != null && intent.resolveActivity(pm) != null) return intent;
        }

        // 4. Fallback to Market (only as last resort for a specific package)
        if (isPresent(packageName)) {
            return new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + packageName));
        }

        // 5. Raw data view
        if (isPresent(data)) return new Intent(Intent.ACTION_VIEW, Uri.parse(data));

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

    // ── Device status ───────────────────────────────────────

    @PluginMethod
    public void getDeviceStatus(PluginCall call) {
        JSObject result = new JSObject();

        BluetoothAdapter btAdapter = BluetoothAdapter.getDefaultAdapter();
        boolean btEnabled = btAdapter != null && btAdapter.isEnabled();
        result.put("btConnected", btEnabled);
        result.put("btDevice", btEnabled ? "Bağlı Cihaz" : "");

        ConnectivityManager cm =
            (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo wifiInfo = cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI);
        boolean wifiConnected = wifiInfo != null && wifiInfo.isConnected();
        result.put("wifiConnected", wifiConnected);
        result.put("wifiName", "");

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

    // ── OBD-II Bluetooth ────────────────────────────────────

    private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final ExecutorService obdExecutor  = Executors.newSingleThreadExecutor();
    private final Handler         mainHandler  = new Handler(Looper.getMainLooper());

    private volatile BluetoothSocket obdSocket    = null;
    private volatile InputStream     obdInput     = null;
    private volatile OutputStream    obdOutput    = null;
    private volatile boolean         obdRunning   = false;

    /**
     * Return paired Bluetooth devices.
     * The JS side filters for OBD-looking names.
     */
    @PluginMethod
    public void scanOBD(PluginCall call) {
        try {
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            if (bt == null || !bt.isEnabled()) {
                call.reject("BT_DISABLED", "Bluetooth kapalı veya desteklenmiyor");
                return;
            }

            Set<BluetoothDevice> paired = bt.getBondedDevices();
            JSArray devices = new JSArray();
            for (BluetoothDevice dev : paired) {
                JSObject d = new JSObject();
                String name;
                try   { name = dev.getName(); }
                catch (SecurityException ignored) { name = null; }
                d.put("name",    name != null ? name : dev.getAddress());
                d.put("address", dev.getAddress());
                devices.put(d);
            }

            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("SCAN_FAILED", e.getMessage());
        }
    }

    /**
     * Open a Bluetooth Serial (SPP) connection to the ELM327 adapter,
     * run the initialization sequence, then resolve.
     * Data polling starts automatically and pushes "obdData" events every ~3 s.
     */
    @PluginMethod
    public void connectOBD(PluginCall call) {
        String address = call.getString("address");
        if (!isPresent(address)) {
            call.reject("INVALID_ARGS", "address gerekli");
            return;
        }

        // Tear down any existing connection first
        disconnectOBDInternal();

        obdExecutor.submit(() -> {
            try {
                BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
                if (bt == null) throw new IOException("Bluetooth desteklenmiyor");

                BluetoothDevice device = bt.getRemoteDevice(address);
                BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                obdSocket = socket;

                // Stop discovery to speed up connection
                try { bt.cancelDiscovery(); } catch (SecurityException ignored) {}

                socket.connect(); // blocks until connected or throws

                obdInput  = socket.getInputStream();
                obdOutput = socket.getOutputStream();

                // ELM327 initialization sequence
                initELM327();

                // Notify JS: connected
                obdRunning = true;
                mainHandler.post(call::resolve);

                // Start polling — runs until disconnected
                pollOBDLoop();

            } catch (Exception e) {
                disconnectOBDInternal();

                JSObject event = new JSObject();
                event.put("state",   "error");
                event.put("message", e.getMessage());
                notifyListeners("obdStatus", event);

                mainHandler.post(() -> call.reject("CONNECT_FAILED", e.getMessage()));
            }
        });
    }

    /**
     * Close the OBD connection and stop polling.
     */
    @PluginMethod
    public void disconnectOBD(PluginCall call) {
        disconnectOBDInternal();

        JSObject event = new JSObject();
        event.put("state", "disconnected");
        notifyListeners("obdStatus", event);

        call.resolve();
    }

    // ── OBD internals ───────────────────────────────────────

    private void initELM327() throws IOException {
        sendOBDCommand("ATZ",   2500); // Reset (adapter startup takes up to 2 s)
        sendOBDCommand("ATE0",  1000); // Echo off
        sendOBDCommand("ATL0",   500); // Line feeds off
        sendOBDCommand("ATH0",   500); // Headers off
        sendOBDCommand("ATSP0", 1000); // Auto-detect OBD protocol
    }

    /**
     * Continuously read all four PIDs and emit "obdData" events.
     * Exits when obdRunning is false or the socket is closed.
     */
    private void pollOBDLoop() {
        while (obdRunning && obdSocket != null && obdSocket.isConnected()) {
            try {
                JSObject data = new JSObject();
                data.put("speed",      readSpeed());
                data.put("rpm",        readRPM());
                data.put("engineTemp", readEngineTemp());
                data.put("fuelLevel",  readFuelLevel());
                notifyListeners("obdData", data);

                Thread.sleep(3000); // 3-second polling cadence

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                // Lost connection — notify JS
                disconnectOBDInternal();
                JSObject event = new JSObject();
                event.put("state",   "disconnected");
                event.put("message", e.getMessage());
                notifyListeners("obdStatus", event);
                break;
            }
        }
    }

    private void disconnectOBDInternal() {
        obdRunning = false;
        try { if (obdInput  != null) { obdInput.close();  obdInput  = null; } } catch (IOException ignored) {}
        try { if (obdOutput != null) { obdOutput.close(); obdOutput = null; } } catch (IOException ignored) {}
        try { if (obdSocket != null) { obdSocket.close(); obdSocket = null; } } catch (IOException ignored) {}
    }

    /**
     * Send an AT/OBD command and return the raw response string.
     * Uses available()-based polling to avoid blocking indefinitely.
     */
    private String sendOBDCommand(String cmd, int timeoutMs) throws IOException {
        InputStream  in  = obdInput;
        OutputStream out = obdOutput;
        if (in == null || out == null) throw new IOException("OBD bağlantısı yok");

        // Flush any stale input
        int stale = in.available();
        if (stale > 0) in.skip(stale);

        out.write((cmd + "\r").getBytes("ASCII"));
        out.flush();

        StringBuilder sb   = new StringBuilder();
        long          dead = System.currentTimeMillis() + timeoutMs;

        while (System.currentTimeMillis() < dead) {
            if (in.available() > 0) {
                int c = in.read();
                if (c < 0) throw new IOException("Stream kapandı");
                if (c == '>') break; // ELM327 ready prompt
                if (c != '\r') sb.append((char) c);
            } else {
                try { Thread.sleep(20); }
                catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Kesintiye uğradı");
                }
            }
        }

        return sb.toString().trim();
    }

    // ── PID readers ─────────────────────────────────────────

    /** 010D — Vehicle Speed (km/h) */
    private int readSpeed() {
        try {
            String r = sendOBDCommand("010D", 1500).replaceAll("\\s+", "").toUpperCase();
            if (r.contains("410D") && r.length() >= r.indexOf("410D") + 6) {
                int idx = r.indexOf("410D");
                return Integer.parseInt(r.substring(idx + 4, idx + 6), 16);
            }
        } catch (Exception ignored) {}
        return -1;
    }

    /** 010C — Engine RPM */
    private int readRPM() {
        try {
            String r = sendOBDCommand("010C", 1500).replaceAll("\\s+", "").toUpperCase();
            if (r.contains("410C") && r.length() >= r.indexOf("410C") + 8) {
                int idx = r.indexOf("410C");
                int a   = Integer.parseInt(r.substring(idx + 4, idx + 6), 16);
                int b   = Integer.parseInt(r.substring(idx + 6, idx + 8), 16);
                return ((a * 256) + b) / 4;
            }
        } catch (Exception ignored) {}
        return -1;
    }

    /** 0105 — Engine Coolant Temperature (°C) */
    private int readEngineTemp() {
        try {
            String r = sendOBDCommand("0105", 1500).replaceAll("\\s+", "").toUpperCase();
            if (r.contains("4105") && r.length() >= r.indexOf("4105") + 6) {
                int idx = r.indexOf("4105");
                return Integer.parseInt(r.substring(idx + 4, idx + 6), 16) - 40;
            }
        } catch (Exception ignored) {}
        return -1;
    }

    /** 012F — Fuel Tank Level Input (0–100 %) */
    private int readFuelLevel() {
        try {
            String r = sendOBDCommand("012F", 1500).replaceAll("\\s+", "").toUpperCase();
            if (r.contains("412F") && r.length() >= r.indexOf("412F") + 6) {
                int idx = r.indexOf("412F");
                int hex = Integer.parseInt(r.substring(idx + 4, idx + 6), 16);
                return (int) ((hex * 100.0) / 255.0);
            }
        } catch (Exception ignored) {}
        return -1;
    }

    // ── Lifecycle ───────────────────────────────────────────

    @Override
    protected void handleOnDestroy() {
        disconnectOBDInternal();
        obdExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
