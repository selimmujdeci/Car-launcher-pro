package com.cockpitos.pro;

import android.app.ActivityManager;
import android.util.DisplayMetrics;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CameraCaptureSession;
import android.media.AudioManager;
import android.media.Image;
import android.media.ImageReader;
import android.util.Base64;
import android.view.Surface;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.KeyEvent;
import android.view.WindowManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.cockpitos.pro.can.CanBusManager;
import com.cockpitos.pro.can.CanFrameDecoder;
import com.cockpitos.pro.can.VehicleSignalMapper;
import com.cockpitos.pro.can.ReverseSignalGuard;
import com.cockpitos.pro.can.NativeToJsBridge;
import com.cockpitos.pro.can.VehicleCanData;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * CarLauncherPlugin — native Android bridge for CockpitOS.
 *
 * Methods:
 *   launchApp(packageName?, action?, data?, category?)
 *   getApps()
 *   getDeviceStatus()
 *   sendMediaAction(action)        — play/pause/next/previous via KeyEvent
 *   getMediaInfo()                 — active MediaSession metadata
 *   getContacts()                  — Android contacts (READ_CONTACTS)
 *   scanOBD()                      — paired Bluetooth devices
 *   connectOBD(address)            — ELM327 Bluetooth connection
 *   disconnectOBD()
 *   setBrightness(value)           — 0–255
 *   setVolume(value)               — 0–15
 *   startSpeechRecognition(...)
 *
 * Events (notifyListeners):
 *   obdStatus      { state, message? }
 *   obdData        { speed, rpm, engineTemp, fuelLevel }
 *   mediaChanged   { packageName, appName, title, artist, albumArt?, playing,
 *                    durationMs, positionMs }
 */
@CapacitorPlugin(name = "CarLauncher")
public class CarLauncherPlugin extends Plugin {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ── App exit (launcher'ı arka plana al) ────────────────────────────────

    /**
     * Launcher'ı arka plana alır — kapatmaz.
     * Çift geri basış sonrasında JS tarafından çağrılır.
     * finishAffinity() yerine moveTaskToBack kullanılır — launcher kapanmasın,
     * HOME tuşuyla veya son uygulamalardan tekrar açılabilsin.
     */
    @PluginMethod
    public void exitApp(PluginCall call) {
        call.resolve();
        new Handler(Looper.getMainLooper()).post(() -> {
            getActivity().moveTaskToBack(true);
        });
    }

    // ── App launch ──────────────────────────────────────────────────────────

    /**
     * Launch an app using the best available strategy.
     * Fallback chain: packageName → action → category → Play Store → raw URL
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
                call.reject("INVALID_ARGS", "Başlatılabilir hedef bulunamadı");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                          | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("LAUNCH_FAILED", e.getMessage());
        }
    }

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
                boolean isSystem = (info.activityInfo.applicationInfo.flags
                                    & ApplicationInfo.FLAG_SYSTEM) != 0;
                app.put("isSystemApp", isSystem);

                // Native icon — 96×96 PNG, bellek tasarrufu için küçültülmüş
                try {
                    android.graphics.drawable.Drawable drawable = info.loadIcon(pm);
                    Bitmap bmp = drawableToBitmap(drawable, 96);
                    if (bmp != null) {
                        ByteArrayOutputStream stream = new ByteArrayOutputStream();
                        bmp.compress(Bitmap.CompressFormat.PNG, 100, stream);
                        String b64 = android.util.Base64.encodeToString(
                            stream.toByteArray(), android.util.Base64.NO_WRAP);
                        app.put("icon", "data:image/png;base64," + b64);
                        bmp.recycle();
                    }
                } catch (Exception ignored) { /* icon yüklenemezse emoji fallback'e düş */ }

                apps.put(app);
            }

            JSObject result = new JSObject();
            result.put("apps", apps);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("SCAN_FAILED", e.getMessage());
        }
    }

    /**
     * Drawable'ı size×size Bitmap'e ölçeklendirir.
     *
     * BitmapDrawable → createScaledBitmap (GPU destekli ölçekleme, en düşük RAM).
     * Diğer tipler (VectorDrawable, AdaptiveIconDrawable) → Canvas rendering.
     */
    private Bitmap drawableToBitmap(android.graphics.drawable.Drawable drawable, int size) {
        if (drawable == null) return null;

        if (drawable instanceof android.graphics.drawable.BitmapDrawable) {
            Bitmap src = ((android.graphics.drawable.BitmapDrawable) drawable).getBitmap();
            if (src != null && !src.isRecycled()) {
                return Bitmap.createScaledBitmap(src, size, size, true);
            }
        }

        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        android.graphics.Canvas canvas = new android.graphics.Canvas(bmp);
        drawable.setBounds(0, 0, size, size);
        drawable.draw(canvas);
        return bmp;
    }

    private Intent resolveIntent(String pkg, String action, String data, String category) {
        PackageManager pm = getContext().getPackageManager();
        boolean pkgInstalled = false;

        if (present(pkg)) {
            try { pm.getPackageInfo(pkg, 0); pkgInstalled = true; }
            catch (PackageManager.NameNotFoundException ignored) {}

            if (pkgInstalled) {
                Intent i = pm.getLaunchIntentForPackage(pkg);
                if (i != null) return i;

                Intent qi = new Intent(Intent.ACTION_MAIN);
                qi.addCategory(Intent.CATEGORY_LAUNCHER);
                qi.setPackage(pkg);
                List<ResolveInfo> acts = pm.queryIntentActivities(qi, 0);
                if (!acts.isEmpty()) {
                    Intent manual = new Intent(Intent.ACTION_MAIN);
                    manual.addCategory(Intent.CATEGORY_LAUNCHER);
                    manual.setClassName(acts.get(0).activityInfo.packageName,
                                        acts.get(0).activityInfo.name);
                    return manual;
                }
            }
        }

        if (present(action)) {
            Intent i = new Intent(action);
            if (present(data)) i.setData(Uri.parse(data));
            if (i.resolveActivity(pm) != null) return i;
        }

        if (present(category)) {
            Intent i = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, category);
            if (i != null && i.resolveActivity(pm) != null) return i;
        }

        if (present(pkg) && !pkgInstalled) {
            return new Intent(Intent.ACTION_VIEW,
                Uri.parse("market://details?id=" + pkg));
        }

        if (present(data)) return new Intent(Intent.ACTION_VIEW, Uri.parse(data));

        return null;
    }

    // ── Device status ───────────────────────────────────────────────────────

    @PluginMethod
    public void getDeviceStatus(PluginCall call) {
        JSObject result = new JSObject();

        BluetoothAdapter btAdapter = BluetoothAdapter.getDefaultAdapter();
        boolean btOn = btAdapter != null && btAdapter.isEnabled();
        boolean btConnected = false;
        String  btDevice    = "";

        if (btOn) {
            try {
                int a2dp = btAdapter.getProfileConnectionState(BluetoothProfile.A2DP);
                int hfp  = btAdapter.getProfileConnectionState(BluetoothProfile.HEADSET);
                btConnected = (a2dp == BluetoothProfile.STATE_CONNECTED)
                           || (hfp  == BluetoothProfile.STATE_CONNECTED);

                Set<BluetoothDevice> bonded = btAdapter.getBondedDevices();
                if (bonded != null) {
                    for (BluetoothDevice dev : bonded) {
                        try {
                            Method m = dev.getClass().getMethod("isConnected");
                            if (Boolean.TRUE.equals(m.invoke(dev))) {
                                btDevice = dev.getName();
                                btConnected = true;
                                break;
                            }
                        } catch (Exception ignored) {}
                    }
                }
            } catch (SecurityException ignored) {
                btConnected = btOn;
            }
        }
        result.put("btConnected", btConnected);
        result.put("btDevice",    btDevice);

        ConnectivityManager cm =
            (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo wifiInfo = cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI);
        boolean wifiOn = wifiInfo != null && wifiInfo.isConnected();
        result.put("wifiConnected", wifiOn);
        result.put("wifiName", getWifiSSID(wifiOn));

        IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent bat = getContext().registerReceiver(null, ifilter);
        int level = bat != null ? bat.getIntExtra(BatteryManager.EXTRA_LEVEL, 0)  : 0;
        int scale = bat != null ? bat.getIntExtra(BatteryManager.EXTRA_SCALE, 100): 100;
        int pct   = scale > 0 ? (int) ((level / (float) scale) * 100) : 0;
        result.put("battery", pct);

        int status = bat != null ? bat.getIntExtra(BatteryManager.EXTRA_STATUS, -1) : -1;
        result.put("charging",
            status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL);

        call.resolve(result);
    }

    private String getWifiSSID(boolean wifiConnected) {
        if (!wifiConnected || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return "";
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            if (wm == null) return "";
            WifiInfo wi = wm.getConnectionInfo();
            if (wi == null) return "";
            String ssid = wi.getSSID();
            if (ssid == null || ssid.equals("<unknown ssid>")) return "";
            return ssid.startsWith("\"") ? ssid.substring(1, ssid.length() - 1) : ssid;
        } catch (Exception ignored) {
            return "";
        }
    }

    // ── Media control ───────────────────────────────────────────────────────

    @PluginMethod
    public void sendMediaAction(PluginCall call) {
        String action = call.getString("action", "");

        MediaController ctrl = activeMediaController;
        if (ctrl == null) {
            MediaListenerService svc = MediaListenerService.instance;
            if (svc != null) {
                try {
                    MediaSessionManager msm = (MediaSessionManager)
                        getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
                    ComponentName cn = new ComponentName(getContext(), MediaListenerService.class);
                    List<MediaController> controllers = msm.getActiveSessions(cn);
                    if (!controllers.isEmpty()) {
                        ctrl = controllers.get(0);
                        ensureMediaCallback(ctrl);
                    }
                } catch (Exception ignored) {}
            }
        }

        if (ctrl != null) {
            try {
                MediaController.TransportControls tc = ctrl.getTransportControls();
                switch (action) {
                    case "play":     tc.play();     break;
                    case "pause":    tc.pause();    break;
                    case "next":     tc.skipToNext(); break;
                    case "previous": tc.skipToPrevious(); break;
                    default:
                        call.reject("INVALID_ACTION", "Geçersiz aksiyon: " + action);
                        return;
                }
                call.resolve();
                return;
            } catch (Exception e) {
                // TransportControls başarısız — AudioManager fallback'e düş
            }
        }

        int keyCode;
        switch (action) {
            case "play":
            case "pause":    keyCode = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE; break;
            case "next":     keyCode = KeyEvent.KEYCODE_MEDIA_NEXT;       break;
            case "previous": keyCode = KeyEvent.KEYCODE_MEDIA_PREVIOUS;   break;
            default:
                call.reject("INVALID_ACTION", "Geçersiz aksiyon: " + action);
                return;
        }
        try {
            AudioManager am =
                (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            long now = SystemClock.uptimeMillis();
            am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0));
            am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP,   keyCode, 0));
            call.resolve();
        } catch (Exception e) {
            call.reject("MEDIA_ACTION_FAILED", e.getMessage());
        }
    }

    // ── Media session info ──────────────────────────────────────────────────

    private volatile MediaController activeMediaController = null;
    private volatile MediaController.Callback mediaCallback = null;

    @PluginMethod
    public void getMediaInfo(PluginCall call) {
        MediaListenerService svc = MediaListenerService.instance;
        if (svc == null) {
            call.reject("NO_LISTENER",
                "Bildirim erişim izni gerekli: Ayarlar → Uygulama Bildirimleri");
            return;
        }

        try {
            MediaSessionManager msm = (MediaSessionManager)
                getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
            ComponentName cn =
                new ComponentName(getContext(), MediaListenerService.class);
            List<MediaController> controllers = msm.getActiveSessions(cn);

            if (controllers.isEmpty()) {
                call.reject("NO_SESSION", "Aktif medya oturumu yok");
                return;
            }

            String preferred = call.getString("preferredPackage", "");
            MediaController ctrl = controllers.get(0);
            if (preferred != null && !preferred.isEmpty()) {
                for (MediaController c : controllers) {
                    if (preferred.equals(c.getPackageName())) {
                        ctrl = c;
                        break;
                    }
                }
            }
            ensureMediaCallback(ctrl);

            JSObject result = buildMediaInfo(ctrl);
            result.put("sessionCount", controllers.size());
            call.resolve(result);

        } catch (SecurityException e) {
            call.reject("PERMISSION_DENIED", "Bildirim erişim izni gerekli");
        } catch (Exception e) {
            call.reject("MEDIA_INFO_FAILED", e.getMessage());
        }
    }

    private void ensureMediaCallback(MediaController ctrl) {
        if (ctrl.equals(activeMediaController)) return;

        if (activeMediaController != null && mediaCallback != null) {
            activeMediaController.unregisterCallback(mediaCallback);
        }

        activeMediaController = ctrl;

        mediaCallback = new MediaController.Callback() {
            @Override
            public void onMetadataChanged(MediaMetadata metadata) {
                JSObject info = buildMediaInfo(ctrl);
                notifyListeners("mediaChanged", info);
            }

            @Override
            public void onPlaybackStateChanged(PlaybackState state) {
                JSObject info = buildMediaInfo(ctrl);
                notifyListeners("mediaChanged", info);
            }

            @Override
            public void onSessionDestroyed() {
                if (ctrl.equals(activeMediaController)) {
                    activeMediaController = null;
                    mediaCallback         = null;
                }
            }
        };

        ctrl.registerCallback(mediaCallback, mainHandler);
    }

    private JSObject buildMediaInfo(MediaController ctrl) {
        JSObject out = new JSObject();
        out.put("packageName", ctrl.getPackageName());

        String appName = ctrl.getPackageName();
        try {
            appName = (String) getContext().getPackageManager()
                .getApplicationLabel(getContext().getPackageManager()
                    .getApplicationInfo(ctrl.getPackageName(), 0));
        } catch (Exception ignored) {}
        out.put("appName", appName);

        MediaMetadata meta  = ctrl.getMetadata();
        PlaybackState state = ctrl.getPlaybackState();

        if (meta != null) {
            out.put("title",      safe(meta.getString(MediaMetadata.METADATA_KEY_TITLE)));
            out.put("artist",     safe(meta.getString(MediaMetadata.METADATA_KEY_ARTIST)));
            out.put("durationMs", meta.getLong(MediaMetadata.METADATA_KEY_DURATION));

            Bitmap art = meta.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (art == null) art = meta.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (art != null) out.put("albumArt", bitmapToDataUri(art));
        } else {
            out.put("title",      "");
            out.put("artist",     "");
            out.put("durationMs", 0L);
        }

        boolean playing = state != null
            && state.getState() == PlaybackState.STATE_PLAYING;
        out.put("playing",    playing);
        out.put("positionMs", state != null ? state.getPosition() : 0L);

        return out;
    }

    private String bitmapToDataUri(Bitmap src) {
        try {
            Bitmap scaled = Bitmap.createScaledBitmap(src, 200, 200, true);
            ByteArrayOutputStream stream = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 75, stream);
            String b64 = android.util.Base64.encodeToString(
                stream.toByteArray(), android.util.Base64.NO_WRAP);
            return "data:image/jpeg;base64," + b64;
        } catch (Exception ignored) {
            return "";
        }
    }

    // ── Contacts ────────────────────────────────────────────────────────────

    @PluginMethod
    public void getContacts(PluginCall call) {
        try {
            ContentResolver cr = getContext().getContentResolver();

            Cursor contactCursor = cr.query(
                ContactsContract.Contacts.CONTENT_URI,
                new String[]{
                    ContactsContract.Contacts._ID,
                    ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
                    ContactsContract.Contacts.HAS_PHONE_NUMBER
                },
                ContactsContract.Contacts.HAS_PHONE_NUMBER + " > 0",
                null,
                ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " COLLATE LOCALIZED ASC"
            );

            JSArray contacts = new JSArray();

            if (contactCursor != null) {
                int idCol   = contactCursor.getColumnIndexOrThrow(ContactsContract.Contacts._ID);
                int nameCol = contactCursor.getColumnIndexOrThrow(
                    ContactsContract.Contacts.DISPLAY_NAME_PRIMARY);

                while (contactCursor.moveToNext()) {
                    String id   = contactCursor.getString(idCol);
                    String name = safe(contactCursor.getString(nameCol));

                    Cursor phoneCursor = cr.query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[]{
                            ContactsContract.CommonDataKinds.Phone.NUMBER,
                            ContactsContract.CommonDataKinds.Phone.TYPE
                        },
                        ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " = ?",
                        new String[]{id},
                        null
                    );

                    JSArray phones = new JSArray();
                    if (phoneCursor != null) {
                        while (phoneCursor.moveToNext()) {
                            String number = safe(phoneCursor.getString(0));
                            int    type   = phoneCursor.getInt(1);
                            if (!number.isEmpty()) {
                                JSObject ph = new JSObject();
                                ph.put("number", number);
                                ph.put("type",   phoneTypeLabel(type));
                                phones.put(ph);
                            }
                        }
                        phoneCursor.close();
                    }

                    if (phones.length() > 0) {
                        JSObject contact = new JSObject();
                        contact.put("id",     id);
                        contact.put("name",   name);
                        contact.put("phones", phones);
                        contacts.put(contact);
                    }
                }
                contactCursor.close();
            }

            JSObject result = new JSObject();
            result.put("contacts", contacts);
            call.resolve(result);

        } catch (SecurityException e) {
            call.reject("PERMISSION_DENIED", "READ_CONTACTS izni gerekli");
        } catch (Exception e) {
            call.reject("CONTACTS_FAILED", e.getMessage());
        }
    }

    private static String phoneTypeLabel(int type) {
        switch (type) {
            case ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE: return "MOBILE";
            case ContactsContract.CommonDataKinds.Phone.TYPE_HOME:   return "HOME";
            case ContactsContract.CommonDataKinds.Phone.TYPE_WORK:   return "WORK";
            default:                                                  return "OTHER";
        }
    }

    // ── OBD-II Bluetooth (ELM327) ───────────────────────────────────────────

    private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final ExecutorService obdExecutor = Executors.newSingleThreadExecutor();

    private volatile BluetoothSocket obdSocket  = null;
    private volatile InputStream     obdInput   = null;
    private volatile OutputStream    obdOutput  = null;
    private volatile boolean         obdRunning = false;

    // ── Aktif BT Tarama (uygulama içi OBD eşleştirme) ──────────────────────

    private android.content.BroadcastReceiver _discoveryReceiver = null;

    @PluginMethod
    public void startOBDDiscovery(PluginCall call) {
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt == null || !bt.isEnabled()) {
            call.reject("BT_DISABLED", "Bluetooth kapalı");
            return;
        }

        // Önceki receiver varsa kaldır
        stopOBDDiscoveryInternal();

        _discoveryReceiver = new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context ctx, android.content.Intent intent) {
                String action = intent.getAction();
                if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                    BluetoothDevice dev = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (dev == null) return;
                    String name = null;
                    try { name = dev.getName(); } catch (SecurityException ignored) {}
                    if (name == null || name.isEmpty()) name = dev.getAddress();

                    JSObject event = new JSObject();
                    event.put("name",    name);
                    event.put("address", dev.getAddress());
                    event.put("bonded",  dev.getBondState() == BluetoothDevice.BOND_BONDED);
                    notifyListeners("obdDeviceFound", event);

                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                    JSObject event = new JSObject();
                    event.put("finished", true);
                    notifyListeners("obdDiscoveryFinished", event);
                }
            }
        };

        android.content.IntentFilter filter = new android.content.IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        getContext().registerReceiver(_discoveryReceiver, filter);

        try { bt.cancelDiscovery(); } catch (SecurityException ignored) {}
        try {
            bt.startDiscovery();
        } catch (SecurityException e) {
            call.reject("PERM_DENIED", "Bluetooth tarama izni yok");
            return;
        }

        // Bonded cihazları da hemen gönder (zaten pair edilmiş OBD'ler)
        try {
            java.util.Set<BluetoothDevice> bonded = bt.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice dev : bonded) {
                    String name = null;
                    try { name = dev.getName(); } catch (SecurityException ignored) {}
                    if (name == null || name.isEmpty()) name = dev.getAddress();
                    JSObject event = new JSObject();
                    event.put("name",    name);
                    event.put("address", dev.getAddress());
                    event.put("bonded",  true);
                    notifyListeners("obdDeviceFound", event);
                }
            }
        } catch (SecurityException ignored) {}

        call.resolve();
    }

    @PluginMethod
    public void stopOBDDiscovery(PluginCall call) {
        stopOBDDiscoveryInternal();
        call.resolve();
    }

    private void stopOBDDiscoveryInternal() {
        if (_discoveryReceiver != null) {
            try { getContext().unregisterReceiver(_discoveryReceiver); } catch (Exception ignored) {}
            _discoveryReceiver = null;
        }
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt != null) {
            try { bt.cancelDiscovery(); } catch (SecurityException ignored) {}
        }
    }

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
                try { name = dev.getName(); }
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

    @PluginMethod
    public void connectOBD(PluginCall call) {
        String address = call.getString("address");
        if (!present(address)) {
            call.reject("INVALID_ARGS", "address gerekli");
            return;
        }

        disconnectOBDInternal();

        obdExecutor.submit(() -> {
            try {
                BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
                if (bt == null) throw new IOException("Bluetooth desteklenmiyor");

                BluetoothDevice device = bt.getRemoteDevice(address);

                try { bt.cancelDiscovery(); } catch (SecurityException ignored) {}

                // Önce secure RFCOMM dene; bazı head unit'lerde çalışmaz
                // → insecure RFCOMM fallback (iCar 3 / ELM327 klonlar için gerekli)
                BluetoothSocket socket = null;
                Exception lastErr = null;

                try {
                    socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                } catch (Exception secureEx) {
                    lastErr = secureEx;
                    try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                    socket = null;
                    // Insecure fallback — pairing PIN gerektirmez, head unit uyumsuzluğunu aşar
                    try {
                        socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                        socket.connect();
                        lastErr = null; // başarılı
                    } catch (Exception insecureEx) {
                        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                        socket = null;
                        // Her iki yol da başarısız — orijinal hatayı fırlat
                        throw secureEx;
                    }
                }

                obdSocket = socket;
                obdInput  = socket.getInputStream();
                obdOutput = socket.getOutputStream();

                initELM327();

                obdRunning = true;
                mainHandler.post(call::resolve);

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

    @PluginMethod
    public void disconnectOBD(PluginCall call) {
        disconnectOBDInternal();

        JSObject event = new JSObject();
        event.put("state", "disconnected");
        notifyListeners("obdStatus", event);

        call.resolve();
    }

    // ── OBD internals ───────────────────────────────────────────────────────

    private void initELM327() throws IOException {
        sendOBDCommand("ATZ",   2500);
        sendOBDCommand("ATE0",  1000);
        sendOBDCommand("ATL0",   500);
        sendOBDCommand("ATH0",   500);
        sendOBDCommand("ATSP0", 1000);
    }

    private void pollOBDLoop() {
        while (obdRunning && obdSocket != null && obdSocket.isConnected()) {
            try {
                JSObject data = new JSObject();
                data.put("speed",      readPID_speed());
                data.put("rpm",        readPID_rpm());
                data.put("engineTemp", readPID_temp());
                data.put("fuelLevel",  readPID_fuel());
                data.put("headlights", false);
                notifyListeners("obdData", data);

                Thread.sleep(3000);

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
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

    private String sendOBDCommand(String cmd, int timeoutMs) throws IOException {
        InputStream  in  = obdInput;
        OutputStream out = obdOutput;
        if (in == null || out == null) throw new IOException("OBD bağlantısı yok");

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
                if (c == '>') break;
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

    // ── PID readers ─────────────────────────────────────────────────────────

    private int readPID_speed() {
        try {
            String r = sendOBDCommand("010D", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("410D");
            if (idx >= 0 && r.length() >= idx + 6)
                return Integer.parseInt(r.substring(idx + 4, idx + 6), 16);
        } catch (Exception ignored) {}
        return -1;
    }

    private int readPID_rpm() {
        try {
            String r = sendOBDCommand("010C", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("410C");
            if (idx >= 0 && r.length() >= idx + 8) {
                int a = Integer.parseInt(r.substring(idx + 4, idx + 6), 16);
                int b = Integer.parseInt(r.substring(idx + 6, idx + 8), 16);
                return ((a * 256) + b) / 4;
            }
        } catch (Exception ignored) {}
        return -1;
    }

    private int readPID_temp() {
        try {
            String r = sendOBDCommand("0105", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("4105");
            if (idx >= 0 && r.length() >= idx + 6)
                return Integer.parseInt(r.substring(idx + 4, idx + 6), 16) - 40;
        } catch (Exception ignored) {}
        return -1;
    }

    private int readPID_fuel() {
        try {
            String r = sendOBDCommand("012F", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("412F");
            if (idx >= 0 && r.length() >= idx + 6)
                return (int) (Integer.parseInt(r.substring(idx + 4, idx + 6), 16) * 100.0 / 255.0);
        } catch (Exception ignored) {}
        return -1;
    }

    // ── System settings ──────────────────────────────────────────────────────

    @PluginMethod
    public void setBrightness(PluginCall call) {
        Integer value = call.getInt("value");
        if (value == null) { call.reject("INVALID_ARGS", "value gerekli"); return; }
        int clamped = Math.max(0, Math.min(255, value));
        try {
            mainHandler.post(() -> {
                WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                lp.screenBrightness = clamped / 255.0f;
                getActivity().getWindow().setAttributes(lp);
            });

            if (Settings.System.canWrite(getContext())) {
                Settings.System.putInt(getContext().getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, clamped);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("BRIGHTNESS_FAILED", e.getMessage());
        }
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Integer value = call.getInt("value");
        if (value == null) { call.reject("INVALID_ARGS", "value gerekli"); return; }
        try {
            AudioManager am =
                (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            int max     = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int clamped = Math.max(0, Math.min(max, value));
            am.setStreamVolume(AudioManager.STREAM_MUSIC, clamped, 0);
            call.resolve();
        } catch (Exception e) {
            call.reject("VOLUME_FAILED", e.getMessage());
        }
    }

    // ── Speech recognition ───────────────────────────────────────────────────

    private PluginCall savedSpeechCall = null;
    private SpeechRecognizer speechRecognizer = null;

    @PluginMethod
    public void startSpeechRecognition(PluginCall call) {
        savedSpeechCall = call;
        String language = call.getString("language", "tr-TR");
        int    maxResults = call.getInt("maxResults", 1);

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (speechRecognizer != null) {
                    try { speechRecognizer.destroy(); } catch (Exception ignored) {}
                    speechRecognizer = null;
                }

                if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                    if (savedSpeechCall != null) {
                        savedSpeechCall.reject("NO_RECOGNIZER", "Cihazda ses tanıma mevcut değil");
                        savedSpeechCall = null;
                    }
                    return;
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());

                final int finalMaxResults = maxResults;
                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(android.os.Bundle params) {}
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {}
                    @Override public void onPartialResults(android.os.Bundle partialResults) {}
                    @Override public void onEvent(int eventType, android.os.Bundle params) {}

                    @Override
                    public void onResults(android.os.Bundle results) {
                        PluginCall c = savedSpeechCall;
                        savedSpeechCall = null;
                        if (c == null) return;
                        ArrayList<String> matches = results.getStringArrayList(
                            SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches != null && !matches.isEmpty()) {
                            JSObject r = new JSObject();
                            r.put("transcript", matches.get(0));
                            c.resolve(r);
                        } else {
                            c.reject("NO_RESULT", "Sonuç alınamadı");
                        }
                        destroySpeechRecognizer();
                    }

                    @Override
                    public void onError(int error) {
                        PluginCall c = savedSpeechCall;
                        savedSpeechCall = null;
                        if (c == null) return;
                        String msg = error == SpeechRecognizer.ERROR_NO_MATCH ? "İptal edildi"
                            : error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "Zaman aşımı"
                            : "Ses tanıma hatası: " + error;
                        c.reject("NO_RESULT", msg);
                        destroySpeechRecognizer();
                    }
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, finalMaxResults);
                intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE,
                    getContext().getPackageName());

                speechRecognizer.startListening(intent);

            } catch (Exception e) {
                if (savedSpeechCall != null) {
                    savedSpeechCall.reject("NO_RECOGNIZER", "Ses tanıma başlatılamadı: " + e.getMessage());
                    savedSpeechCall = null;
                }
                destroySpeechRecognizer();
            }
        });
    }

    private void destroySpeechRecognizer() {
        if (speechRecognizer != null) {
            try { speechRecognizer.destroy(); } catch (Exception ignored) {}
            speechRecognizer = null;
        }
    }

    // ── Background service ───────────────────────────────────────────────────

    @PluginMethod
    public void startBackgroundService(PluginCall call) {
        CarLauncherForegroundService.setCallbacks(
            (lat, lng, speedKmh, bearing, accuracy) -> {
                JSObject d = new JSObject();
                d.put("lat",      lat);
                d.put("lng",      lng);
                d.put("speed",    speedKmh);
                d.put("bearing",  bearing);
                d.put("accuracy", accuracy);
                notifyListeners("backgroundLocation", d);
            },
            (drivingMinutes) -> {
                JSObject d = new JSObject();
                d.put("drivingMinutes", drivingMinutes);
                notifyListeners("breakReminder", d);
            }
        );

        Intent intent = new Intent(getContext(), CarLauncherForegroundService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("START_FAILED", e.getMessage());
        }
    }

    @PluginMethod
    public void stopBackgroundService(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CarLauncherForegroundService.class));
        call.resolve();
    }

    // ── Android 13+ Runtime İzinleri ─────────────────────────────────────────

    @PluginMethod
    public void requestAndroid13Permissions(PluginCall call) {
        java.util.List<String> needed = new java.util.ArrayList<>();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(getContext(),
                    android.Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (ContextCompat.checkSelfPermission(getContext(),
                    android.Manifest.permission.BLUETOOTH_SCAN)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.BLUETOOTH_SCAN);
            }
        }

        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(),
                    android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                getActivity(),
                needed.toArray(new String[0]),
                9001
            );
        }

        JSObject r = new JSObject();
        r.put("requested", needed.size());
        call.resolve(r);
    }

    // ── System permissions ────────────────────────────────────────────────────

    @PluginMethod
    public void checkWriteSettings(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", Settings.System.canWrite(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void requestWriteSettings(PluginCall call) {
        if (!Settings.System.canWrite(getContext())) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (Exception e) {
                call.reject("OPEN_SETTINGS_FAILED", e.getMessage());
                return;
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationAccess(PluginCall call) {
        String step = call.getString("step", "auto");

        if ("auto".equals(step) && Build.VERSION.SDK_INT >= 33 && isRestrictedSettingsBlocked()) {
            step = "appDetails";
        }

        Intent intent;
        if ("appDetails".equals(step)) {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        } else {
            intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(intent);
            JSObject r = new JSObject();
            r.put("step", step);
            r.put("restricted", isRestrictedSettingsBlocked());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("OPEN_SETTINGS_FAILED", e.getMessage());
        }
    }

    private boolean isRestrictedSettingsBlocked() {
        if (Build.VERSION.SDK_INT < 33) return false;
        try {
            android.app.AppOpsManager aom = (android.app.AppOpsManager)
                getContext().getSystemService(Context.APP_OPS_SERVICE);
            int mode = aom.unsafeCheckOpNoThrow(
                "android:request_install_packages",
                getContext().getApplicationInfo().uid,
                getContext().getPackageName()
            );
            return mode == android.app.AppOpsManager.MODE_DEFAULT;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void checkNotificationAccess(PluginCall call) {
        boolean granted = MediaListenerService.instance != null;
        JSObject r = new JSObject();
        r.put("granted", granted);
        r.put("restricted", !granted && isRestrictedSettingsBlocked());
        call.resolve(r);
    }

    // ── Camera2 ───────────────────────────────────────────────────────────────

    private CameraDevice          activeCameraDevice = null;
    private CameraCaptureSession  captureSession     = null;
    private ImageReader           cameraImageReader  = null;
    private volatile byte[]       lastFrame          = null;
    private volatile PluginCall   pendingFrameCall   = null;

    @PluginMethod
    public void openCamera(PluginCall call) {
        String facing = call.getString("facing", "back");
        CameraManager mgr = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        if (mgr == null) { call.reject("NO_CAMERA_SERVICE", "CameraManager yok"); return; }

        try {
            String targetId = null;
            int wantFacing  = "back".equals(facing)
                ? CameraCharacteristics.LENS_FACING_BACK
                : CameraCharacteristics.LENS_FACING_FRONT;

            for (String id : mgr.getCameraIdList()) {
                CameraCharacteristics c = mgr.getCameraCharacteristics(id);
                Integer lf = c.get(CameraCharacteristics.LENS_FACING);
                if (lf != null && lf == wantFacing) { targetId = id; break; }
            }
            if (targetId == null) {
                call.reject("NO_CAMERA", "Kamera bulunamadı: " + facing);
                return;
            }

            closeCameraInternal();
            final String cameraId = targetId;

            cameraImageReader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 2);
            cameraImageReader.setOnImageAvailableListener(reader -> {
                Image img = reader.acquireLatestImage();
                if (img == null) return;
                try {
                    ByteBuffer buf   = img.getPlanes()[0].getBuffer();
                    byte[]     bytes = new byte[buf.remaining()];
                    buf.get(bytes);
                    lastFrame = bytes;

                    PluginCall pending = pendingFrameCall;
                    if (pending != null) {
                        pendingFrameCall = null;
                        JSObject r = new JSObject();
                        r.put("imageData", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        pending.resolve(r);
                    }
                } finally {
                    img.close();
                }
            }, mainHandler);

            mgr.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    activeCameraDevice = camera;
                    try {
                        List<Surface> targets = Collections.singletonList(cameraImageReader.getSurface());
                        camera.createCaptureSession(targets, new CameraCaptureSession.StateCallback() {
                            @Override
                            public void onConfigured(CameraCaptureSession session) {
                                captureSession = session;
                                try {
                                    CaptureRequest.Builder b =
                                        camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                                    b.addTarget(cameraImageReader.getSurface());
                                    b.set(CaptureRequest.CONTROL_MODE,
                                          CaptureRequest.CONTROL_MODE_AUTO);
                                    session.setRepeatingRequest(b.build(), null, mainHandler);
                                    JSObject r = new JSObject();
                                    r.put("cameraId", cameraId);
                                    call.resolve(r);
                                } catch (Exception e) {
                                    call.reject("CAPTURE_SETUP_FAILED", e.getMessage());
                                }
                            }
                            @Override
                            public void onConfigureFailed(CameraCaptureSession session) {
                                call.reject("SESSION_CONFIG_FAILED",
                                    "Kamera oturumu yapılandırılamadı");
                            }
                        }, mainHandler);
                    } catch (Exception e) {
                        call.reject("SESSION_FAILED", e.getMessage());
                    }
                }
                @Override public void onDisconnected(CameraDevice camera) {
                    camera.close(); activeCameraDevice = null;
                }
                @Override public void onError(CameraDevice camera, int error) {
                    camera.close(); activeCameraDevice = null;
                }
            }, mainHandler);

        } catch (SecurityException e) {
            call.reject("PERMISSION_DENIED", "Kamera izni gerekli");
        } catch (Exception e) {
            call.reject("CAMERA_ERROR", e.getMessage());
        }
    }

    @PluginMethod
    public void closeCamera(PluginCall call) {
        closeCameraInternal();
        call.resolve();
    }

    @PluginMethod
    public void captureFrame(PluginCall call) {
        byte[] frame = lastFrame;
        if (frame != null) {
            JSObject r = new JSObject();
            r.put("imageData", Base64.encodeToString(frame, Base64.NO_WRAP));
            call.resolve(r);
        } else if (activeCameraDevice != null) {
            pendingFrameCall = call;
        } else {
            call.reject("CAMERA_NOT_OPEN", "Kamera açık değil — önce openCamera() çağırın");
        }
    }

    @PluginMethod
    public void setDashcamActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        CarLauncherForegroundService svc = CarLauncherForegroundService.instance;
        if (svc != null) {
            CarLauncherForegroundService.setDashcamRecording(active);
            svc.updateNotification(active ? "GPS takibi + Dashcam kaydı" : "GPS takibi aktif");
        }
        call.resolve();
    }

    private void closeCameraInternal() {
        pendingFrameCall = null;
        lastFrame        = null;
        if (captureSession != null) {
            try { captureSession.close(); } catch (Exception ignored) {}
            captureSession = null;
        }
        if (activeCameraDevice != null) {
            try { activeCameraDevice.close(); } catch (Exception ignored) {}
            activeCameraDevice = null;
        }
        if (cameraImageReader != null) {
            cameraImageReader.close();
            cameraImageReader = null;
        }
    }

    // ── Passenger HTTP Server ─────────────────────────────────────────────────

    private volatile ServerSocket psSocket  = null;
    private volatile String       psToken   = null;
    private volatile boolean      psLocked  = false;
    private volatile String       psTitle   = "";
    private volatile String       psArtist  = "";
    private volatile String       psAppName = "";
    private volatile boolean      psPlaying = false;

    @PluginMethod
    public void startPassengerServer(PluginCall call) {
        stopPassengerServerInternal();
        try {
            String ip = getLocalIPv4();
            if (ip == null) {
                call.reject("NO_WIFI", "WiFi IP adresi bulunamadı");
                return;
            }

            psToken  = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
            psLocked = false;
            psSocket = new ServerSocket(0);
            int port = psSocket.getLocalPort();

            Thread srv = new Thread(this::runPassengerServer, "PassengerHTTP");
            srv.setDaemon(true);
            srv.start();

            JSObject r = new JSObject();
            r.put("ip",    ip);
            r.put("port",  port);
            r.put("token", psToken);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("SERVER_ERROR", e.getMessage());
        }
    }

    @PluginMethod
    public void stopPassengerServer(PluginCall call) {
        stopPassengerServerInternal();
        call.resolve();
    }

    @PluginMethod
    public void updatePassengerState(PluginCall call) {
        psTitle   = safe(call.getString("title"));
        psArtist  = safe(call.getString("artist"));
        psAppName = safe(call.getString("appName"));
        psPlaying = Boolean.TRUE.equals(call.getBoolean("playing", false));
        call.resolve();
    }

    private void stopPassengerServerInternal() {
        ServerSocket s = psSocket;
        psSocket = null;
        if (s != null) { try { s.close(); } catch (IOException ignored) {} }
    }

    private void runPassengerServer() {
        ServerSocket srv = psSocket;
        while (srv != null && !srv.isClosed()) {
            try {
                Socket client = srv.accept();
                client.setSoTimeout(8000);
                new Thread(() -> handlePassengerClient(client), "PassengerReq").start();
            } catch (IOException ignored) {}
        }
    }

    private void handlePassengerClient(Socket client) {
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
            OutputStream out = client.getOutputStream()
        ) {
            String requestLine = reader.readLine();
            if (requestLine == null) return;

            String[] parts = requestLine.split(" ", 3);
            if (parts.length < 2) return;
            String method   = parts[0];
            String fullPath = parts[1];

            int contentLength = 0;
            String hdr;
            while ((hdr = reader.readLine()) != null && !hdr.isEmpty()) {
                if (hdr.toLowerCase().startsWith("content-length:")) {
                    try { contentLength = Integer.parseInt(hdr.substring(15).trim()); }
                    catch (NumberFormatException ignored) {}
                }
            }

            String body = "";
            if ("POST".equals(method) && contentLength > 0) {
                char[] buf = new char[Math.min(contentLength, 4096)];
                int n = reader.read(buf, 0, buf.length);
                if (n > 0) body = new String(buf, 0, n);
            }

            int qi     = fullPath.indexOf('?');
            String path  = (qi >= 0) ? fullPath.substring(0, qi)  : fullPath;
            String query = (qi >= 0) ? fullPath.substring(qi + 1) : "";

            String tok = "";
            for (String kv : query.split("&")) {
                if (kv.startsWith("t=")) { tok = kv.substring(2); break; }
            }

            if (psToken == null || !psToken.equals(tok)) {
                sendHttpResponse(out, 403, "text/plain", "Forbidden");
                return;
            }

            if ("/panel".equals(path)) {
                if (psLocked) {
                    sendHttpResponse(out, 403, "text/html; charset=utf-8",
                        "<html><body style='background:#060d1a;color:#f87171;text-align:center;padding:48px 24px;font-size:18px;font-family:sans-serif'>"
                        + "Bu oturum başka bir cihazda açık.</body></html>");
                } else {
                    psLocked = true;
                    sendHttpResponse(out, 200, "text/html; charset=utf-8", buildPassengerHtml());
                }

            } else if ("/state".equals(path)) {
                String json = "{\"title\":\""   + escJson(psTitle)   + "\","
                            + "\"artist\":\""   + escJson(psArtist)  + "\","
                            + "\"appName\":\"" + escJson(psAppName)  + "\","
                            + "\"playing\":"   + psPlaying           + "}";
                sendHttpResponse(out, 200, "application/json", json);

            } else if ("/cmd".equals(path) && "POST".equals(method)) {
                String action = "";
                int idx = body.indexOf("\"action\":\"");
                if (idx >= 0) {
                    int s2 = idx + 10, e2 = body.indexOf('"', s2);
                    if (e2 > s2) action = body.substring(s2, e2);
                }
                if (!action.isEmpty()) {
                    JSObject ev = new JSObject();
                    ev.put("action", action);
                    notifyListeners("passengerCommand", ev);
                }
                sendHttpResponse(out, 200, "application/json", "{\"ok\":true}");

            } else {
                sendHttpResponse(out, 404, "text/plain", "Not Found");
            }

        } catch (Exception ignored) {
        } finally {
            try { client.close(); } catch (IOException ignored) {}
        }
    }

    private void sendHttpResponse(OutputStream out, int status, String ct, String body)
        throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String h = "HTTP/1.1 " + status + " OK\r\n"
            + "Content-Type: " + ct + "\r\n"
            + "Content-Length: " + b.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n";
        out.write(h.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    private static String getLocalIPv4() {
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics.hasMoreElements()) {
                NetworkInterface nic = nics.nextElement();
                if (!nic.isUp() || nic.isLoopback() || nic.isVirtual()) continue;
                Enumeration<InetAddress> addrs = nic.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String escJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }

    private static String buildPassengerHtml() {
        return "<!DOCTYPE html><html lang='tr'><head>"
            + "<meta charset='UTF-8'>"
            + "<meta name='viewport' content='width=device-width,initial-scale=1.0,maximum-scale=1.0'>"
            + "<meta name='mobile-web-app-capable' content='yes'>"
            + "<meta name='apple-mobile-web-app-capable' content='yes'>"
            + "<title>Yolcu Kontrolü</title>"
            + "<style>"
            + "*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation}"
            + "body{background:#060d1a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;"
            + "min-height:100vh;display:flex;flex-direction:column;align-items:center;"
            + "padding:36px 24px;user-select:none;-webkit-user-select:none}"
            + ".hdr{text-align:center;margin-bottom:32px;font-size:11px;letter-spacing:.3em;"
            + "text-transform:uppercase;color:rgba(255,255,255,.3);display:flex;align-items:center;gap:8px}"
            + ".d{width:7px;height:7px;border-radius:50%;background:#3b82f6;animation:bl 2s infinite;flex-shrink:0}"
            + "@keyframes bl{0%,100%{opacity:1}50%{opacity:.3}}"
            + ".card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);"
            + "border-radius:20px;padding:28px 20px;text-align:center;margin-bottom:28px;width:100%;max-width:380px}"
            + ".t1{font-size:20px;font-weight:700;line-height:1.3;margin-bottom:8px;min-height:26px}"
            + ".t2{font-size:14px;color:rgba(255,255,255,.5);min-height:20px}"
            + ".t3{font-size:11px;color:#60a5fa;margin-top:8px;letter-spacing:.2em;text-transform:uppercase;min-height:16px}"
            + ".ctrl{display:flex;justify-content:center;align-items:center;gap:24px;margin-bottom:24px}"
            + ".btn{display:flex;align-items:center;justify-content:center;border:none;"
            + "cursor:pointer;transition:transform .1s,opacity .1s;outline:none;background:none}"
            + ".btn:active{transform:scale(.86);opacity:.6}"
            + ".sk{width:68px;height:68px;border-radius:50%;background:rgba(255,255,255,.07);"
            + "border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.8);font-size:24px}"
            + ".pl{width:88px;height:88px;border-radius:50%;background:#2563eb;color:#fff;font-size:30px;"
            + "box-shadow:0 0 32px rgba(59,130,246,.4)}"
            + ".pl.pp{background:rgba(37,99,235,.12);border:2px solid rgba(59,130,246,.3);box-shadow:none}"
            + ".st{text-align:center;font-size:11px;color:rgba(255,255,255,.2);letter-spacing:.12em}"
            + ".st.e{color:#fca5a5}"
            + "</style></head><body>"
            + "<div class='hdr'><span class='d'></span>Caros Pro &#183; Yolcu Kontrolü</div>"
            + "<div class='card'>"
            + "<div class='t1' id='ti'>Bağlanıyor…</div>"
            + "<div class='t2' id='ar'></div>"
            + "<div class='t3' id='ap'></div>"
            + "</div>"
            + "<div class='ctrl'>"
            + "<button class='btn sk' id='bprev'>&#9198;</button>"
            + "<button class='btn pl pp' id='pb'>&#9654;</button>"
            + "<button class='btn sk' id='bnext'>&#9197;</button>"
            + "</div>"
            + "<div class='st' id='st'>Bağlanıyor…</div>"
            + "<script>"
            + "var T=new URLSearchParams(location.search).get('t')||'',pl=false,ec=0;"
            + "function cmd(a){"
            + "fetch('/cmd?t='+T,{method:'POST',headers:{'Content-Type':'application/json'},"
            + "body:JSON.stringify({action:a})})"
            + ".then(function(){setTimeout(poll,350)})"
            + ".catch(function(){sst('Hata',1)});}"
            + "function tog(){cmd(pl?'pause':'play');}"
            + "function sst(m,e){var el=document.getElementById('st');"
            + "el.textContent=m;el.className='st'+(e?' e':'');}"
            + "document.getElementById('bprev').onclick=function(){cmd('previous');};"
            + "document.getElementById('pb').onclick=function(){tog();};"
            + "document.getElementById('bnext').onclick=function(){cmd('next');};"
            + "function poll(){"
            + "fetch('/state?t='+T)"
            + ".then(function(r){"
            + "if(r.status===403){"
            + "document.getElementById('ti').textContent='Oturum başka cihazda açık';"
            + "document.getElementById('ar').textContent='';"
            + "document.getElementById('ap').textContent='';"
            + "sst('',0);return null;}"
            + "return r.ok?r.json():null;})"
            + ".then(function(s){"
            + "if(!s)return;"
            + "document.getElementById('ti').textContent=s.title||'—';"
            + "document.getElementById('ar').textContent=s.artist||'';"
            + "document.getElementById('ap').textContent=s.appName||'';"
            + "pl=s.playing;"
            + "var pb=document.getElementById('pb');"
            + "pb.innerHTML=pl?'&#9646;&#9646;':'&#9654;';"
            + "pb.className='btn pl'+(pl?'':' pp');"
            + "ec=0;sst(pl?'Çalıyor':'Duraklatıldı');})"
            + ".catch(function(){ec++;if(ec>3)sst('Bağlantı kesildi',1);});}"
            + "poll();setInterval(poll,2500);"
            + "</script></body></html>";
    }

    // ── Native Core: Device Profile ──────────────────────────────────────────

    @PluginMethod
    public void getDeviceProfile(PluginCall call) {
        try {
            JSObject r = new JSObject();

            r.put("androidVersion", Build.VERSION.RELEASE);
            r.put("sdkInt",         Build.VERSION.SDK_INT);

            ActivityManager am = (ActivityManager)
                getContext().getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            long totalRamMb = mi.totalMem / (1024L * 1024L);
            r.put("totalRamMb",      totalRamMb);
            r.put("isLowRamDevice",  am.isLowRamDevice());

            DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
            r.put("screenWidth",  dm.widthPixels);
            r.put("screenHeight", dm.heightPixels);
            r.put("densityDpi",   dm.densityDpi);
            r.put("density",      dm.density);

            String wvVersion = "";
            String[] wvPackages = {
                "com.google.android.webview",
                "com.android.webview",
                "com.samsung.android.webview"
            };
            for (String pkg : wvPackages) {
                try {
                    wvVersion = getContext().getPackageManager()
                        .getPackageInfo(pkg, 0).versionName;
                    if (wvVersion != null && !wvVersion.isEmpty()) break;
                } catch (Exception ignored) {}
            }
            r.put("webViewVersion", safe(wvVersion));

            String deviceClass;
            if (totalRamMb < 1536 || Build.VERSION.SDK_INT < 21) {
                deviceClass = "low";
            } else if (totalRamMb < 3072 || Build.VERSION.SDK_INT < 26) {
                deviceClass = "mid";
            } else {
                deviceClass = "high";
            }
            r.put("deviceClass", deviceClass);

            call.resolve(r);
        } catch (Exception e) {
            call.reject("PROFILE_FAILED", e.getMessage());
        }
    }

    // ── Native Core: Screen Metrics ──────────────────────────────────────────

    @PluginMethod
    public void getScreenMetrics(PluginCall call) {
        try {
            DisplayMetrics dm = new DisplayMetrics();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.view.Display display = getActivity().getDisplay();
                if (display != null) {
                    display.getRealMetrics(dm);
                } else {
                    dm = getContext().getResources().getDisplayMetrics();
                }
            } else {
                WindowManager wm = (WindowManager)
                    getContext().getSystemService(Context.WINDOW_SERVICE);
                wm.getDefaultDisplay().getRealMetrics(dm);
            }
            JSObject r = new JSObject();
            r.put("widthPx",    dm.widthPixels);
            r.put("heightPx",   dm.heightPixels);
            r.put("densityDpi", dm.densityDpi);
            r.put("density",    dm.density);
            r.put("widthDp",    Math.round(dm.widthPixels  / dm.density));
            r.put("heightDp",   Math.round(dm.heightPixels / dm.density));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("METRICS_FAILED", e.getMessage());
        }
    }

    // ── Native Core: Phone / Dialer Bridge ───────────────────────────────────

    @PluginMethod
    public void callNumber(PluginCall call) {
        String number = call.getString("number", "");
        if (!present(number)) {
            call.reject("INVALID_NUMBER", "Telefon numarası boş");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_DIAL,
                Uri.parse("tel:" + Uri.encode(number)));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("DIAL_FAILED", e.getMessage());
        }
    }

    // ── CAN Bus ───────────────────────────────────────────────────────────────

    private final CanBusManager     canBusManager     = new CanBusManager();
    private final CanFrameDecoder   canFrameDecoder   = new CanFrameDecoder();
    private final VehicleSignalMapper canSignalMapper = new VehicleSignalMapper();
    private final ReverseSignalGuard reverseGuard     = new ReverseSignalGuard();
    private       NativeToJsBridge  canJsBridge;

    // ── Industrial-Grade Secure Storage ──────────────────────────────────────
    // Android Keystore + EncryptedSharedPreferences.
    // APP_SECRET JS tarafında YOK — şifreleme anahtarı donanımda.
    private volatile SharedPreferences _securePrefs = null;
    private static final String SECURE_PREFS_FILE = "caros_secure_v1";

    private SharedPreferences getSecurePrefs() {
        if (_securePrefs != null) return _securePrefs;
        try {
            // AES256_GCM: Android Keystore backed (hardware-backed on API 23+)
            MasterKey masterKey = new MasterKey.Builder(getContext())
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
            _securePrefs = EncryptedSharedPreferences.create(
                getContext(),
                SECURE_PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            android.util.Log.e("CarLauncherPlugin", "EncryptedSharedPreferences açılamadı: " + e.getMessage());
            // Fallback: normal SharedPreferences (degraded mode, logged)
            _securePrefs = getContext().getSharedPreferences(SECURE_PREFS_FILE + "_fallback",
                android.content.Context.MODE_PRIVATE);
        }
        return _securePrefs;
    }

    @Override
    public void load() {
        // CanBusManager'ı ForegroundService watchdog'a inject et
        CarLauncherForegroundService.setCanBusManager(canBusManager);
    }

    @PluginMethod
    public void startCanBus(PluginCall call) {
        if (canJsBridge == null) canJsBridge = new NativeToJsBridge(this::notifyListeners);

        canBusManager.start((frame) -> {
            java.util.List<CanFrameDecoder.CanSignal> signals = canFrameDecoder.decode(frame);
            VehicleCanData data = canSignalMapper.process(signals);
            if (data == null) return;

            if (data.speed != null) reverseGuard.updateSpeed(data.speed);

            VehicleCanData filtered = data;
            if (Boolean.TRUE.equals(data.reverse) && !reverseGuard.isValid(true)) {
                filtered = new VehicleCanData.Builder()
                    .speed(data.speed != null ? data.speed : 0f)
                    .reverse(false)
                    .build();
            }

            canJsBridge.emit(filtered);
        });

        call.resolve();
    }

    @PluginMethod
    public void stopCanBus(PluginCall call) {
        canBusManager.stop();
        call.resolve();
    }

    // T-7: JS'e sürekli CAN veri akışı ──────────────────────────────────────

    /** JS tarafının CAN veri akışına abone olması için. */
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void startCanBusUpdates(PluginCall call) {
        call.setKeepAlive(true);

        if (canJsBridge == null) canJsBridge = new NativeToJsBridge(this::notifyListeners);

        // Seri port bilgisini döndür
        JSObject info = new JSObject();
        info.put("port",    canBusManager.openPortPath() != null
                            ? canBusManager.openPortPath() : "none");
        info.put("running", true);
        call.resolve(info);

        canBusManager.start((frame) -> {
            java.util.List<CanFrameDecoder.CanSignal> signals = canFrameDecoder.decode(frame);
            VehicleCanData data = canSignalMapper.process(signals);
            if (data == null) return;

            if (data.speed != null) reverseGuard.updateSpeed(data.speed);

            VehicleCanData filtered = data;
            if (Boolean.TRUE.equals(data.reverse) && !reverseGuard.isValid(true)) {
                filtered = new VehicleCanData.Builder()
                    .speed(data.speed != null ? data.speed : 0f)
                    .reverse(false)
                    .build();
            }

            // JS'e event olarak ilet
            canJsBridge.emit(filtered);
        });
    }

    /** CAN veri akışını durdurur. */
    @PluginMethod
    public void stopCanBusUpdates(PluginCall call) {
        canBusManager.stop();
        call.resolve();
    }

    // ── T-5: Background Service Hardening ─────────────────────────────────────

    /**
     * JS → Native: Servisi 30 saniye IMPORTANCE_HIGH moda çeker.
     * FCM push geldiğinde veya kritik komut işlenirken çağrılır.
     */
    @PluginMethod
    public void wakeUpService(PluginCall call) {
        CarLauncherForegroundService svc = CarLauncherForegroundService.instance;
        if (svc != null) {
            svc.wakeUp();
            call.resolve();
        } else {
            // Servis ölmüşse yeniden başlat
            try {
                Context ctx = getContext();
                android.content.Intent intent =
                    new android.content.Intent(ctx, CarLauncherForegroundService.class);
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent);
                } else {
                    ctx.startService(intent);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Servis başlatılamadı: " + e.getMessage());
            }
        }
    }

    /**
     * JS → Native: Çevrimdışı JSON veriyi native tampona gönder.
     */
    @PluginMethod
    public void enqueueOfflineData(PluginCall call) {
        String payload = call.getString("payload", "");
        CarLauncherForegroundService svc = CarLauncherForegroundService.instance;
        if (svc != null && payload != null && !payload.isEmpty()) {
            svc.enqueueData(payload);
        }
        call.resolve();
    }

    /**
     * JS → Native: Native tamponu boşalt, verileri JS'e geri ver.
     */
    @PluginMethod
    public void drainOfflineBuffer(PluginCall call) {
        CarLauncherForegroundService svc = CarLauncherForegroundService.instance;
        JSObject result = new JSObject();
        if (svc != null) {
            String[] items = svc.drainDataBuffer();
            JSArray  arr   = new JSArray();
            for (String item : items) arr.put(item);
            result.put("items", arr);
            result.put("count", items.length);
        } else {
            result.put("items", new JSArray());
            result.put("count", 0);
        }
        call.resolve(result);
    }

    // ── T-8: Hardware Bridge — MCU Komutları ──────────────────────────────────

    /**
     * MCU'ya komut gönderir. SerialPortHandler açıksa gerçek donanıma,
     * kapalıysa log mesajı bırakır (graceful degradation).
     */
    private boolean sendMcuCommand(byte[] packet, String label) {
        if (packet == null) {
            android.util.Log.e("CarLauncherPlugin", label + ": geçersiz paket (whitelist reddi)");
            return false;
        }
        boolean ok = canBusManager.sendCommand(packet);
        if (ok) android.util.Log.i("CarLauncherPlugin", label + ": MCU'ya gönderildi");
        else    android.util.Log.w("CarLauncherPlugin", label + ": MCU bağlı değil");
        return ok;
    }

    @PluginMethod
    public void lockDoors(PluginCall call) {
        boolean ok = sendMcuCommand(
            com.cockpitos.pro.can.McuCommandFactory.lockDoors(), "lockDoors");
        JSObject res = new JSObject();
        res.put("sent", ok);
        call.resolve(res);
    }

    @PluginMethod
    public void unlockDoors(PluginCall call) {
        boolean ok = sendMcuCommand(
            com.cockpitos.pro.can.McuCommandFactory.unlockDoors(), "unlockDoors");
        JSObject res = new JSObject();
        res.put("sent", ok);
        call.resolve(res);
    }

    @PluginMethod
    public void honkHorn(PluginCall call) {
        boolean ok = sendMcuCommand(
            com.cockpitos.pro.can.McuCommandFactory.honkHorn(), "honkHorn");
        JSObject res = new JSObject();
        res.put("sent", ok);
        call.resolve(res);
    }

    @PluginMethod
    public void flashLights(PluginCall call) {
        boolean ok = sendMcuCommand(
            com.cockpitos.pro.can.McuCommandFactory.flashLights(), "flashLights");
        JSObject res = new JSObject();
        res.put("sent", ok);
        call.resolve(res);
    }

    @PluginMethod
    public void triggerAlarm(PluginCall call) {
        boolean ok = sendMcuCommand(
            com.cockpitos.pro.can.McuCommandFactory.alarmOn(), "triggerAlarm");
        JSObject res = new JSObject();
        res.put("sent", ok);
        call.resolve(res);
    }

    @PluginMethod
    public void stopAlarm(PluginCall call) {
        boolean ok = sendMcuCommand(
            com.cockpitos.pro.can.McuCommandFactory.alarmOff(), "stopAlarm");
        JSObject res = new JSObject();
        res.put("sent", ok);
        call.resolve(res);
    }

    // ── H-4 Native Command Queue API ─────────────────────────────────────

    /**
     * CommandService.java'nın WebView yokken biriktirdiği bekleyen komut
     * ID'lerini döner. JS tarafı açılınca bu ID'lerle Supabase'den komut detayını
     * çeker ve commandListener üzerinden işler.
     * returns: { commands: JSON string of QueuedNativeCommand[] }
     */
    @PluginMethod
    public void getQueuedNativeCommands(PluginCall call) {
        String json = CommandService.getQueuedCommands(getContext());
        JSObject res = new JSObject();
        res.put("commands", json);
        call.resolve(res);
    }

    /**
     * CommandService.java'nın offline çalıştırdığı MCU komutlarının
     * sonuç listesini döner. JS tarafı bu sonuçları Supabase'e PATCH eder.
     * returns: { results: JSON string of NativeCommandResult[] }
     */
    @PluginMethod
    public void getNativeCommandResults(PluginCall call) {
        String json = CommandService.getCommandResults(getContext());
        JSObject res = new JSObject();
        res.put("results", json);
        call.resolve(res);
    }

    /**
     * Komut kuyruğunu ve sonuç listesini temizler.
     * JS tarafı drainNativeCommandQueue() tamamladıktan sonra çağırır.
     */
    @PluginMethod
    public void clearNativeCommandQueue(PluginCall call) {
        CommandService.clearAll(getContext());
        call.resolve();
    }

    // ── Command Service Durum API ─────────────────────────────────────────

    /**
     * JS → Native: CommandService (FCM) ve CarLauncherForegroundService
     * çalışma durumunu döner.
     *
     * returns: { running: boolean, fgServiceRunning: boolean }
     *
     * Not: CommandService bir FirebaseMessagingService'dir — sistem tarafından
     * yönetilir, doğrudan "çalışıyor" kontrolü yapılamaz. FCM token'ının
     * kayıtlı olup olmadığı ve ForegroundService durumu birlikte raporlanır.
     */
    @PluginMethod
    public void getCommandServiceStatus(PluginCall call) {
        boolean fgRunning = CarLauncherForegroundService.getInstance() != null;

        // FCM kaydı: token mevcutsa servis kayıtlı demektir
        android.content.SharedPreferences prefs =
            getContext().getSharedPreferences("fcm_token_cache", android.content.Context.MODE_PRIVATE);
        boolean fcmRegistered = prefs.contains("fcm_token");

        JSObject res = new JSObject();
        res.put("running",         fcmRegistered); // FCM servisi OS tarafından yönetilir
        res.put("fgServiceRunning", fgRunning);
        call.resolve(res);
    }

    // ── Secure Storage API ────────────────────────────────────────────────

    /**
     * JS → Native: Hassas veriyi Android Keystore şifreli deposuna yazar.
     * JS tarafında APP_SECRET veya şifreleme anahtarı YOKTUR.
     * params: { key: string, value: string }
     */
    @PluginMethod
    public void secureStoreSet(PluginCall call) {
        String key   = call.getString("key",   "");
        String value = call.getString("value", "");
        if (key == null || key.isEmpty()) { call.reject("key gerekli"); return; }
        try {
            SharedPreferences prefs = getSecurePrefs();
            SharedPreferences.Editor editor = prefs.edit();
            if (value == null || value.isEmpty()) {
                editor.remove(key);
            } else {
                editor.putString(key, value);
            }
            editor.apply();
            call.resolve();
        } catch (Exception e) {
            android.util.Log.e("CarLauncherPlugin", "secureStoreSet hatası: " + e.getMessage());
            call.reject("Güvenli depolama yazma hatası: " + e.getMessage());
        }
    }

    /**
     * JS → Native: Android Keystore şifreli deposundan veri okur.
     * params: { key: string }
     * returns: { value: string | null }
     */
    @PluginMethod
    public void secureStoreGet(PluginCall call) {
        String key = call.getString("key", "");
        if (key == null || key.isEmpty()) { call.reject("key gerekli"); return; }
        try {
            SharedPreferences prefs = getSecurePrefs();
            String value = prefs.getString(key, null);
            JSObject result = new JSObject();
            result.put("value", value);
            call.resolve(result);
        } catch (Exception e) {
            android.util.Log.e("CarLauncherPlugin", "secureStoreGet hatası: " + e.getMessage());
            call.reject("Güvenli depolama okuma hatası: " + e.getMessage());
        }
    }

    /**
     * JS → Native: Anahtarı siler.
     * params: { key: string }
     */
    @PluginMethod
    public void secureStoreRemove(PluginCall call) {
        String key = call.getString("key", "");
        if (key == null || key.isEmpty()) { call.reject("key gerekli"); return; }
        try {
            getSecurePrefs().edit().remove(key).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Silme hatası: " + e.getMessage());
        }
    }

    /**
     * JS → Native: Supabase yapılandırmasını native heartbeat için sakla.
     * Uygulama açılışında bir kez çağrılır.
     */
    @PluginMethod
    public void setSupabaseConfig(PluginCall call) {
        String url       = call.getString("url", "");
        String anonKey   = call.getString("anonKey", "");
        String vehicleId = call.getString("vehicleId", "");
        CarLauncherForegroundService.setSupabaseConfig(url, anonKey, vehicleId);
        call.resolve();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static boolean present(String s) { return s != null && !s.isEmpty(); }
    private static String  safe(String s)    { return s != null ? s : ""; }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @Override
    protected void handleOnDestroy() {
        canBusManager.stop();
        disconnectOBDInternal();
        obdExecutor.shutdownNow();

        if (activeMediaController != null && mediaCallback != null) {
            activeMediaController.unregisterCallback(mediaCallback);
            activeMediaController = null;
            mediaCallback         = null;
        }

        closeCameraInternal();
        stopPassengerServerInternal();

        super.handleOnDestroy();
    }
}
