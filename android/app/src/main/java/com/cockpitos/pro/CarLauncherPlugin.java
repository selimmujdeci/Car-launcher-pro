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
import android.content.BroadcastReceiver;
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
import android.content.ContentUris;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaPlayer;
import android.util.Base64;
import android.view.Surface;
import android.view.TextureView;
import android.graphics.SurfaceTexture;
import android.graphics.Matrix;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.provider.MediaStore;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
// Vosk — offline (Google'sız) cihaz-içi ses tanıma. org.vosk.android.RecognitionListener
// android.speech.RecognitionListener ile çakıştığı için aşağıda FQN ile kullanılır.
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.RelativeLayout;
import android.widget.VideoView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.cockpitos.pro.can.CanBusManager;
import com.cockpitos.pro.can.CanFrameDecoder;
import com.cockpitos.pro.can.VehicleSignalMapper;
import com.cockpitos.pro.obd.BleObdManager;
import com.cockpitos.pro.obd.BleObdScanner;
import com.cockpitos.pro.obd.OBDBluetoothManager;
import com.cockpitos.pro.obd.OBDManager;
import com.cockpitos.pro.obd.ObdPollSample;
import com.cockpitos.pro.can.ReverseSignalGuard;
import com.cockpitos.pro.can.NativeToJsBridge;
import com.cockpitos.pro.can.VehicleCanData;
import com.cockpitos.pro.can.K24CanBridge;
import com.cockpitos.pro.can.McuEventSniffer;
import com.cockpitos.pro.core.VehicleNativeBridge;
import com.cockpitos.pro.media.MediaManager;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
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
import java.util.Objects;
import java.util.Arrays;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

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
@CapacitorPlugin(
    name = "CarLauncher",
    permissions = {
        @Permission(strings = { android.Manifest.permission.READ_CONTACTS }, alias = "contacts"),
        @Permission(strings = { android.Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class CarLauncherPlugin extends Plugin {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MediaManager mediaManager;

    // ── Static instance — LMK memory pressure bridge ─────────────────────────
    // MainActivity.onTrimMemory → broadcastMemoryPressure() → notifyListeners → JS
    private static CarLauncherPlugin _instance = null;

    @Override
    public void load() {
        super.load();
        _instance = this;

        // Medya yöneticisini başlat ve listener'ı kur
        mediaManager = MediaManager.getInstance(getContext());
        mediaManager.setListener(new MediaManager.OnMediaUpdateListener() {
            @Override
            public void onMetadataChanged(JSObject metadata) {
                notifyListeners("mediaChanged", metadata);
            }

            @Override
            public void onPlaybackStateChanged(String state) {
                // Opsiyonel: playbackStateChanged event'i JS tarafında gerekiyorsa eklenebilir.
                // Mevcut yapıda her şey mediaChanged (onMetadataChanged) üzerinden akıyor.
            }
        });

        // CanBusManager'ı ForegroundService watchdog'a inject et
        CarLauncherForegroundService.setCanBusManager(canBusManager);
        // Kayıtlı CAN ID yapılandırmasını yükle
        loadCanIds();

        // Bluetooth bağlantı olaylarını dinle — bağlan/bağlantı kes push event
        btStateReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
                android.bluetooth.BluetoothDevice dev = null;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                    dev = intent.getParcelableExtra(android.bluetooth.BluetoothDevice.EXTRA_DEVICE, android.bluetooth.BluetoothDevice.class);
                } else {
                    //noinspection deprecation
                    dev = intent.getParcelableExtra(android.bluetooth.BluetoothDevice.EXTRA_DEVICE);
                }
                JSObject event = new JSObject();
                if (android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
                    String name = "";
                    try { name = dev != null ? dev.getName() : ""; } catch (SecurityException ignored) {}
                    event.put("connected", true);
                    event.put("deviceName", name != null ? name : "Araç");
                    notifyListeners("btChanged", event);
                } else if (android.bluetooth.BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                    event.put("connected", false);
                    event.put("deviceName", "");
                    notifyListeners("btChanged", event);
                }
            }
        };
        IntentFilter btFilter = new IntentFilter();
        btFilter.addAction(android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED);
        btFilter.addAction(android.bluetooth.BluetoothDevice.ACTION_ACL_DISCONNECTED);
        getContext().registerReceiver(btStateReceiver, btFilter);

        // TextToSpeech motoru başlat
        ttsEngine = new android.speech.tts.TextToSpeech(getContext(), status -> {
            if (status == android.speech.tts.TextToSpeech.SUCCESS) {
                int result = ttsEngine.setLanguage(new java.util.Locale("tr", "TR"));
                ttsReady = (result != android.speech.tts.TextToSpeech.LANG_MISSING_DATA
                         && result != android.speech.tts.TextToSpeech.LANG_NOT_SUPPORTED);
                if (!ttsReady) {
                    ttsEngine.setLanguage(java.util.Locale.getDefault());
                    ttsReady = true;
                }
                // speak() Promise'i seslendirme BİTİNCE çözülür (eskiden anında çözülüyordu →
                // JS "konuşma bitti" anını bilemiyordu: ducking TTS sürerken geri açılıyor,
                // cevap-sonrası otomatik dinleme (takip modu) kurulamıyordu).
                ttsEngine.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) {}
                    @Override public void onDone(String utteranceId)  { settleTtsCall(utteranceId); }
                    @Override public void onError(String utteranceId) { settleTtsCall(utteranceId); }
                    @Override public void onStop(String utteranceId, boolean interrupted) { settleTtsCall(utteranceId); }
                });
            }
        });

        // Bildirim erişimi daha önce verilmişse servis zaten bağlı olabilir —
        // medya oturum dinleyicisini hemen kur. Henüz bağlı değilse servisin
        // onListenerConnected callback'i bu metodu tekrar tetikleyecek.
        mainHandler.post(mediaManager::attachMediaSessionsListener);
    }

    /**
     * Android LMK seviyesini JS memoryWatchdog'a iletir.
     * MainActivity.onTrimMemory tarafından çağrılır.
     * @param level "CRITICAL" | "MODERATE"
     */
    public static void broadcastMemoryPressure(String level) {
        final CarLauncherPlugin inst = _instance;
        if (inst == null) return;
        inst.mainHandler.post(() -> {
            try {
                JSObject data = new JSObject();
                data.put("level", level);
                inst.notifyListeners("memoryPressure", data);
            } catch (Exception ignored) { /* plugin unmounted */ }
        });
    }

    // Plugin da kendi Activity'sinden onTrimMemory alabilir — çift güvence
    protected void handleOnTrimMemory(int level) {
        String pressureLevel = null;
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
            pressureLevel = "CRITICAL";
        } else if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_MODERATE) {
            pressureLevel = "MODERATE";
        }
        if (pressureLevel != null) broadcastMemoryPressure(pressureLevel);
    }

    // ── TextToSpeech ──────────────────────────────────────────────────────────
    private android.speech.tts.TextToSpeech ttsEngine = null;
    private boolean ttsReady = false;
    // Seslendirme bitiş takibi: utteranceId → bekleyen Capacitor çağrısı.
    // QUEUE_FLUSH önceki utterance'ı keser → onStop ile o da çözülür (sızıntı yok).
    private final java.util.concurrent.ConcurrentHashMap<String, PluginCall> ttsPendingCalls =
        new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.atomic.AtomicInteger ttsUtteranceSeq =
        new java.util.concurrent.atomic.AtomicInteger();

    /* Half-Duplex (Faz 5): TTS konuşurken wake word grammar thread'i mikrofonu
     * BIRAKIR — asistan kendi selamlamasını ("Buradayım") wake word sanıp
     * kendini tetiklemez. speak() kuyruklayınca true, son utterance çözülünce false. */
    private volatile boolean nativeTtsSpeaking = false;
    /* SAHA FİX 2026-06-12: bazı head unit TTS motorları onDone'u GÜVENİLİR
     * çağırmaz → nativeTtsSpeaking takılı kalır → wake word mikrofonu SONSUZA
     * DEK kapalı (boot selamlaması konuşur konuşmaz asistan sağırlaşıyordu).
     * Emniyet: bayrak set edileli TTS_YIELD_MAX_MS geçtiyse yield YOK SAYILIR. */
    private static final long TTS_YIELD_MAX_MS = 30_000;
    private volatile long nativeTtsSpeakingSinceMs = 0;

    /** TTS bitti/kesildi/hata — bekleyen speak() Promise'ini çöz. */
    private void settleTtsCall(String utteranceId) {
        if (utteranceId == null) return;
        PluginCall c = ttsPendingCalls.remove(utteranceId);
        if (ttsPendingCalls.isEmpty()) nativeTtsSpeaking = false; // half-duplex serbest
        if (c != null) c.resolve();
    }

    /** Tüm bekleyen speak() çağrılarını çöz (ttsStop / plugin destroy). */
    private void settleAllTtsCalls() {
        for (String id : ttsPendingCalls.keySet()) settleTtsCall(id);
    }

    // ── Bluetooth connect/disconnect receiver ─────────────────────────────────
    private BroadcastReceiver btStateReceiver = null;

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
                    Bitmap bmp = PluginUtils.drawableToBitmap(drawable, 96);
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
        try {
            mediaManager.sendMediaCommand(action);
            call.resolve();
        } catch (Exception e) {
            call.reject("MEDIA_ACTION_FAILED", e.getMessage());
        }
    }

    // ── Media session info ──────────────────────────────────────────────────

    @PluginMethod
    public void getMediaInfo(PluginCall call) {
        try {
            String preferred = call.getString("preferredPackage", "");
            JSObject result = mediaManager.getMediaMetadata(preferred);
            if (result == null) {
                call.reject("NO_SESSION", "Aktif medya oturumu yok");
                return;
            }
            call.resolve(result);
        } catch (Exception e) {
            call.reject("MEDIA_INFO_FAILED", e.getMessage());
        }
    }

    @PluginMethod
    public void getMediaArtDataUri(PluginCall call) {
        final String uri = call.getString("uri", "");
        mediaManager.getMediaArtDataUri(uri, dataUri -> {
            JSObject result = new JSObject();
            result.put("dataUri", dataUri);
            call.resolve(result);
        });
    }

    /**
     * MediaListenerService.onListenerConnected'tan çağrılır — bildirim izni
     * verildiği veya servis tekrar bağlandığı anda media listener'ı kur.
     * Statik bağlantı: servisin Java tarafından plugin'e direkt erişimi yok,
     * bu yüzden _instance üzerinden köprülenir.
     */
    public static void onMediaListenerConnected() {
        final CarLauncherPlugin p = _instance;
        if (p == null || p.mediaManager == null) return;
        p.mainHandler.post(p.mediaManager::attachMediaSessionsListener);
    }

    /** Servis bağlantısı kopunca listener da geçersizdir — temizle. */
    public static void onMediaListenerDisconnected() {
        final CarLauncherPlugin p = _instance;
        if (p == null || p.mediaManager == null) return;
        p.mainHandler.post(p.mediaManager::detachMediaSessionsListener);
    }

    // ── Contacts ────────────────────────────────────────────────────────────

    @PluginMethod
    public void requestContactsPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("contacts", "granted");
            call.resolve(result);
        } else {
            requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
        }
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("contacts",
            getPermissionState("contacts") == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }

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
    // Bağlantı + polling motoru OBDManager'a taşındı (Phase 5). Plugin yalnızca
    // KÖPRÜ katmanıdır: PluginCall parse + JSObject + notifyListeners + SAB push.

    private OBDManager obdManager;
    private BleObdManager bleObdManager;

    /** Lazy init — getContext() plugin load sonrası geçerlidir. */
    private OBDManager obd() {
        if (obdManager == null) obdManager = new OBDManager(getContext(), obdListener);
        return obdManager;
    }

    /**
     * Lazy init — BLE GATT OBD motoru (Faz 3 wire).
     * Classic ile AYNI köprü davranışını paylaşır: BLE'nin ayrı listener tipi
     * {@link bleObdListener} ile {@link #obdListener} mantığına delege edilir.
     */
    private BleObdManager bleObd() {
        if (bleObdManager == null) bleObdManager = new BleObdManager(getContext(), bleObdListener);
        return bleObdManager;
    }

    /**
     * BLE motoru → köprü adapteri. BleObdManager kendi {@link BleObdManager.OnOBDDataListener}
     * tipini kullanır (Classic ile imza-uyumlu ama farklı tip). Köprü mantığı tek noktada
     * kalsın diye doğrudan {@link #obdListener}'a delege eder — notifyListeners + SAB yolu
     * birebir aynı.
     */
    private final BleObdManager.OnOBDDataListener bleObdListener = new BleObdManager.OnOBDDataListener() {
        @Override
        public void onObdData(ObdPollSample sample) {
            obdListener.onObdData(sample);
        }

        @Override
        public void onExtendedPid(String pid, String rawHex) {
            obdListener.onExtendedPid(pid, rawHex);
        }

        @Override
        public void onStatusChanged(String state, String message) {
            obdListener.onStatusChanged(state, message);
        }

        @Override
        public void onError(String error) {
            obdListener.onError(error);
        }
    };

    /** OBD motoru → köprü: gelen veriyi mevcut notifyListeners + SAB yoluyla JS'e ilet. */
    private final OBDManager.OnOBDDataListener obdListener = new OBDManager.OnOBDDataListener() {
        @Override
        public void onObdData(ObdPollSample sample) {
            JSObject data = new JSObject();
            data.put("speed",      sample.speed);
            data.put("rpm",        sample.rpm);
            data.put("engineTemp", sample.engineTemp);
            data.put("fuelLevel",  sample.fuelLevel);
            data.put("headlights", false);
            // Patch 6 (AdaptivePollingController): obdPidConfig.ts ICE/DIESEL setinde iletilen
            // ama eskiden hiç okunmayan PID'ler + ATRV 12V akü voltajı.
            data.put("throttle",      sample.throttle);
            data.put("intakeTemp",    sample.intakeTemp);
            data.put("boostPressure", sample.boostPressure);
            data.put("voltage",       sample.voltage);
            notifyListeners("obdData", data);

            // ── Native-Core side-stream (Phase N4) — DEĞİŞMEDİ ─────────────
            // Geçerli (>= 0) OBD değerlerini native katmana KOPYALA. obdData
            // JS event'i değişmedi. int→double tam dönüşüm (kayıpsız).
            // NOT: voltage/throttle/intakeTemp/boostPressure BİLİNÇLİ olarak buraya
            // eklenmedi — VehicleNativeBridge.Signal SharedArrayBuffer'ı yalnızca
            // SPEED/RPM/FUEL slotlarını tanımlıyor; yeni slot eklemek SAB düzenini
            // değiştiren ayrı bir (Patch 6 kapsamı dışı) değişiklik olurdu.
            if (VehicleNativeBridge.INSTANCE.isAvailable()) {
                long ts = System.nanoTime();
                if (sample.speed     >= 0) VehicleNativeBridge.INSTANCE.pushSignal(
                        VehicleNativeBridge.Signal.SPEED, (double) sample.speed, ts);
                if (sample.rpm       >= 0) VehicleNativeBridge.INSTANCE.pushSignal(
                        VehicleNativeBridge.Signal.RPM, (double) sample.rpm, ts);
                if (sample.fuelLevel >= 0) VehicleNativeBridge.INSTANCE.pushSignal(
                        VehicleNativeBridge.Signal.FUEL, (double) sample.fuelLevel, ts);
            }
        }

        @Override
        public void onExtendedPid(String pid, String rawHex) {
            // Patch 8: EXTENDED grup ham PID sonucu — çözümleme TS'te (StandardPidRegistry).
            // obdData olayından AYRI kanal: hızlı yol paketine alan eklemez (SAB/JSON
            // sözleşmesi değişmedi), turda en fazla 1 olay → köprü trafiği ihmal edilebilir.
            JSObject event = new JSObject();
            event.put("pid",  pid);
            event.put("data", rawHex);
            notifyListeners("obdExtendedData", event);
        }

        @Override
        public void onStatusChanged(String state, String message) {
            JSObject event = new JSObject();
            event.put("state",   state);
            event.put("message", message);
            // Patch 1 (obdStatus disiplini): pollLoop sırasında RFCOMM/GATT beklenmedik koptu
            // (OBDManager/BleObdManager pollLoop catch → onStatusChanged("disconnected", ...)).
            // Bu GERÇEK bir link kaybı → obdService reconnect tetiklemeli.
            event.put("reason",  "link_lost");
            notifyListeners("obdStatus", event);
        }

        @Override
        public void onError(String error) {
            JSObject event = new JSObject();
            event.put("state",   "error");
            event.put("message", error);
            notifyListeners("obdStatus", event);
        }

        @Override
        public void onObdTraffic(String cmd, String resp, long ms) {
            // Teşhis ham trafik → JS "obdTraffic" olayı (yalnız capture açıkken gelir).
            // Ekrandan-okunur OBD el sıkışması + ham DTC yanıtı (adb'siz teşhis).
            JSObject event = new JSObject();
            event.put("cmd",  cmd);
            event.put("resp", resp);
            event.put("ms",   ms);
            event.put("ts",   System.currentTimeMillis());
            notifyListeners("obdTraffic", event);
        }
    };

    /**
     * Teşhis: ELM327 ham komut/yanıt trafiği yakalamayı aç/kapat. JS teşhis paneli
     * açılınca true, kapanınca false çağırır. Varsayılan KAPALI — normal sürüşte sıfır
     * ek yük. adb/logcat erişimi olmayan head unit'lerde (T507 Dacia) OBD el sıkışması +
     * ham DTC yanıtını ekranda görmenin tek yolu.
     */
    @PluginMethod
    public void setObdTrafficCapture(PluginCall call) {
        boolean enable = call.getBoolean("enable", false);
        OBDManager.setTrafficCapture(enable);
        JSObject ret = new JSObject();
        ret.put("enabled", enable);
        call.resolve(ret);
    }

    // ── Aktif BT Tarama (uygulama içi OBD eşleştirme) ──────────────────────

    private android.content.BroadcastReceiver _discoveryReceiver = null;
    // BLE (Bluetooth Low Energy) OBD keşfi — Classic discovery'ye EK olarak çalışır.
    // SADECE tarama/listeleme; GATT connect bu aşamada YOK.
    private BleObdScanner _bleScanner = null;

    @PluginMethod
    public void startOBDDiscovery(PluginCall call) {
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt == null || !bt.isEnabled()) {
            call.reject("BT_DISABLED", "Bluetooth kapalı");
            return;
        }

        // KONUM kontrolü: Android'de Bluetooth taraması (klasik ACTION_FOUND + BLE)
        // konum servisi KAPALIYKEN hiçbir cihaz bulamaz. Artık eşli liste dökülmediği
        // için konum kapalıysa liste tamamen boş kalır → kullanıcıya net sebep ver.
        try {
            android.location.LocationManager lm =
                (android.location.LocationManager) getContext().getSystemService(android.content.Context.LOCATION_SERVICE);
            boolean locOn = false;
            if (lm != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    locOn = lm.isLocationEnabled();
                } else {
                    locOn = lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
                         || lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER);
                }
            }
            if (!locOn) {
                call.reject("LOCATION_OFF",
                    "Konum servisi kapalı. Bluetooth cihaz taraması için Konum'u açın (Android kuralı).");
                return;
            }
        } catch (Exception ignored) { /* kontrol başarısız → taramaya yine de devam et */ }

        // Önceki receiver + BLE scanner varsa kaldır
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
                    event.put("transport", "classic");
                    // Classic inquiry sonucu = cihaz GERÇEKTEN menzilde → canlı.
                    event.put("source", "live");
                    notifyListeners("obdDeviceFound", event);

                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                    // Classic tarama bitti. BLE hâlâ tarıyorsa "finished" event'ini
                    // erken göndermeyiz — BLE tarama bittiğinde gönderilir.
                    BleObdScanner ble = _bleScanner;
                    if (ble == null || !ble.isScanning()) {
                        JSObject event = new JSObject();
                        event.put("finished", true);
                        notifyListeners("obdDiscoveryFinished", event);
                    }
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

        // NOT: Eşleştirilmiş (bonded) cihaz listesini ARTIK DÖKMÜYORUZ.
        // Eskiden getBondedDevices() ile Android'in TÜM kayıtlı eşleştirmeleri (telefon,
        // kulaklık + eski OBD'ler) anında listeye basılıyordu → kullanıcı "etrafta olmayan
        // hayalet/sahte cihazlar" görüyordu. Artık liste = YALNIZCA canlı taramada GERÇEKTEN
        // menzilde bulunan cihazlar (klasik ACTION_FOUND + BLE advertise). Menzildeki eşli
        // bir OBD zaten ACTION_FOUND ile gelir; menzilde olmayan kayıt görünmez.
        // (Bilinen adrese hızlı yeniden bağlanma obdService.startOBD direct-reconnect ile;
        //  bu modal değil.)

        // ── BLE keşfi (Classic'e EK) ──────────────────────────────────────
        // BLE OBD adaptörleri Classic discovery'de görünmez; yalnızca LE tarama
        // ile listelenir. Bağlantı/GATT bu aşamada YOK — sadece keşif/listeleme.
        _bleScanner = new BleObdScanner();
        boolean bleStarted = _bleScanner.start(new BleObdScanner.Listener() {
            @Override
            public void onBleDeviceFound(String name, String address) {
                JSObject event = new JSObject();
                event.put("name",    name);
                event.put("address", address);
                // BLE keşfinde eşleşme (bond) bilgisi anlamlı değildir; bağlantı
                // sonraki aşamada GATT ile yapılacak. Şimdilik false.
                event.put("bonded",  false);
                event.put("transport", "ble");
                // BLE advertise = cihaz GERÇEKTEN menzilde → canlı.
                event.put("source", "live");
                notifyListeners("obdDeviceFound", event);
            }

            @Override
            public void onBleScanFinished() {
                // BLE bitti. Classic tarama da bitmişse "finished" gönder.
                BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
                boolean classicScanning = false;
                try { classicScanning = a != null && a.isDiscovering(); }
                catch (SecurityException ignored) {}
                if (!classicScanning) {
                    JSObject event = new JSObject();
                    event.put("finished", true);
                    notifyListeners("obdDiscoveryFinished", event);
                }
            }
        }, BleObdScanner.DEFAULT_SCAN_DURATION_MS);

        if (!bleStarted) {
            // BLE desteklenmiyor / izin yok → Classic akışı bozulmaz, sessiz geç.
            _bleScanner = null;
        }

        // ── Eşli (bonded) OBD adaptörlerini de listeye ekle ───────────────────
        // Eşli bir BLE OBD adaptörü (V-LINK / vLinker tarzı) classic inquiry
        // taramasında (ACTION_FOUND) GÖRÜNMEZ ve bonded iken çoğu zaman BLE
        // advertise de ETMEZ → yalnızca getBondedDevices()'te yaşar. Bonded dump
        // kaldırıldığında bu tip adaptör hiç listelenmiyordu ("tarıyor ama bir şey
        // çıkmıyor"). Telefon/kulaklık "hayalet"lerini önlemek için SADECE
        // OBD-benzeri isimli eşli cihazları yayınla. Transport cihaz tipinden
        // türetilir (LE→ble, classic→classic) → eşli BLE adaptörü doğrudan GATT
        // yoluna gider, 75 sn classic timeout beklenmez. Menzilde GERÇEKTEN bulunan
        // eşli OBD zaten ACTION_FOUND/BLE ile de gelir → modal aynı adresi birleştirir.
        try {
            Set<BluetoothDevice> bonded = bt.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice dev : bonded) {
                    String baddr = dev.getAddress();
                    if (baddr == null) continue;
                    String bname = null;
                    try { bname = dev.getName(); } catch (SecurityException ignored) {}
                    if (!looksLikeObdName(bname, baddr)) continue;
                    if (bname == null || bname.isEmpty()) bname = baddr;
                    // V-LINK / vLinker gibi adaptörler DUAL-mode (BR/EDR + BLE) raporlar →
                    // eskiden yalnızca DEVICE_TYPE_LE 'ble' sayılıyor, DUAL 'classic'e düşüyordu.
                    // Android'de bu klonların OBD verisi pratikte BLE GATT üzerinden akar; classic
                    // RFCOMM SPP ya takılır ya "bağlandı ama veri yok" verir. DUAL'i de 'ble'ye yönlendir
                    // (yalnızca saf DEVICE_TYPE_CLASSIC classic kalır); classic, obdService'te tam
                    // timeout'lu fallback olarak korunur → çift güvenlik.
                    String transport = "classic";
                    try {
                        int devType = dev.getType();
                        if (devType == BluetoothDevice.DEVICE_TYPE_LE
                                || devType == BluetoothDevice.DEVICE_TYPE_DUAL) transport = "ble";
                    } catch (SecurityException ignored) {}
                    JSObject event = new JSObject();
                    event.put("name",    bname);
                    event.put("address", baddr);
                    event.put("bonded",  true);
                    event.put("transport", transport);
                    // getBondedDevices() dökümü = sadece eşleşme hafızası; cihaz
                    // menzilde OLMAYABİLİR → "canlı" DEĞİL. Aynı adres canlı taramada
                    // da gelirse modal 'live'a yükseltir.
                    event.put("source", "bonded");
                    notifyListeners("obdDeviceFound", event);
                }
            }
        } catch (SecurityException ignored) { /* tarama izni yok → sessiz geç */ }

        call.resolve();
    }

    /**
     * Eşli cihaz filtresi için minimal OBD isim sezgiseli — JS `looksLikeObd` ile hizalı.
     * Yalnızca bonded liste için kullanılır (canlı tarama JS tarafında filtrelenir).
     * Bilinen telefon/kulaklık/saat cihazlarını eler; OBD anahtar kelimeleri, isimsiz
     * veya MAC-isimli ELM klonları aday sayılır.
     */
    private boolean looksLikeObdName(String name, String address) {
        if (name == null || name.isEmpty()) return true; // isimsiz → aday (ELM klonları ad yayınlamaz)
        String n   = name.trim();
        String low = n.toLowerCase(java.util.Locale.ROOT);
        String[] nonObd = {
            "iphone", "ipad", "airpod", "buds", "watch", "band", "headset",
            "earbud", "speaker", "tv", "chromecast", "laptop", "mouse",
            "keyboard", "fitbit", "carplay", "microntek", "kswcar"
        };
        for (String k : nonObd) if (low.contains(k)) return false;
        String[] obd = {
            "obd", "elm", "vlink", "v-link", "vlinker", "veepeak", "icar", "vgate",
            "konnwei", "obdlink", "carscanner", "xtool", "viecar", "bafx", "panlong",
            "ediag", "carista", "tonwon", "topdon", "ancel", "nexas", "foseal",
            "thinkcar", "autel", "launch", "scan", "mini obd"
        };
        for (String k : obd) if (low.contains(k)) return true;
        if (n.equalsIgnoreCase(address)) return true;        // name == MAC
        if (n.matches("[0-9A-Fa-f:\\-]{8,}")) return true;   // sadece hex/MAC karakterleri
        return false;
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
        if (_bleScanner != null) {
            try { _bleScanner.stop(); } catch (Exception ignored) {}
            _bleScanner = null;
        }
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt != null) {
            try { bt.cancelDiscovery(); } catch (SecurityException ignored) {}
        }
    }

    /**
     * Eşleşmiş (bonded) bir OBD cihazının pairing'ini siler (unpair).
     * Kullanıcı, taramada artık fiziksel olarak mevcut olmayan eski "Eşli" cihazı
     * kaldırmak istediğinde çağrılır → bir sonraki taramada o cihaz listelenmez.
     * BluetoothDevice.removeBond() gizli API'si reflection ile çağrılır.
     */
    @PluginMethod
    public void forgetOBDDevice(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("NO_ADDRESS", "Cihaz adresi gerekli");
            return;
        }
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt == null) { call.reject("BT_DISABLED", "Bluetooth kullanılamıyor"); return; }
        try {
            BluetoothDevice dev = bt.getRemoteDevice(address);
            boolean removed = false;
            if (dev.getBondState() != BluetoothDevice.BOND_NONE) {
                java.lang.reflect.Method m = dev.getClass().getMethod("removeBond");
                Object r = m.invoke(dev);
                removed = Boolean.TRUE.equals(r);
            } else {
                removed = true; // zaten eşli değil → "silinmiş" say
            }
            JSObject res = new JSObject();
            res.put("success", removed);
            call.resolve(res);
        } catch (IllegalArgumentException e) {
            call.reject("BAD_ADDRESS", "Geçersiz cihaz adresi");
        } catch (Exception e) {
            call.reject("FORGET_FAILED", e.getMessage() != null ? e.getMessage() : "Cihaz kaldırılamadı");
        }
    }

    /**
     * Bir cihazın Android bonding (eşleşme) durumunu döner — PIN Resilience için.
     * Bağlantı sonrası obdService bunu çağırır: bonded ise PIN'e bir daha gerek yok
     * (bonding kalıcıdır), session PIN temizlenir.
     */
    @PluginMethod
    public void getObdBondState(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("NO_ADDRESS", "Cihaz adresi gerekli");
            return;
        }
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt == null) { call.reject("BT_DISABLED", "Bluetooth kullanılamıyor"); return; }
        try {
            BluetoothDevice dev = bt.getRemoteDevice(address);
            JSObject res = new JSObject();
            res.put("bonded", dev.getBondState() == BluetoothDevice.BOND_BONDED);
            call.resolve(res);
        } catch (IllegalArgumentException e) {
            call.reject("BAD_ADDRESS", "Geçersiz cihaz adresi");
        } catch (Exception e) {
            call.reject("BOND_STATE_FAILED", e.getMessage() != null ? e.getMessage() : "Bond durumu okunamadı");
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
        String pin     = call.getString("pin");   // opsiyonel — V-LINK / PIN gerektiren adaptörler
        if (!present(address)) {
            call.reject("INVALID_ARGS", "address gerekli");
            return;
        }

        // P2: JS'ten gelen protokol + PID listesini al (PluginCall parse köprüde kalır).
        String protocol = call.getString("protocol");
        java.util.Set<String> pidSet = parsePidSet(call.getArray("pids"));

        // Faz 3 + Patch 10: transport bilgisi frontend'den iletilir ('classic' | 'ble' | 'tcp').
        // 'ble' → BLE GATT yolu (BleObdManager), 'tcp' → WiFi ELM327 yolu (OBDManager.connectTcp),
        // aksi halde (classic/null/eksik/diğer) mevcut Classic RFCOMM yolu BİREBİR korunur.
        String transport = call.getString("transport");
        android.util.Log.i("OBD", "connectOBD transport=" + (present(transport) ? transport : "classic(default)"));

        if ("ble".equals(transport)) {
            // Tek aktif bağlantı: BLE'ye geçmeden önce varsa Classic'i temiz kapat.
            if (obdManager != null) {
                try { obdManager.disconnect(); } catch (Exception ignored) {}
            }
            // Motor BleObdManager'da; köprü (notifyListeners + SAB) bleObdListener üzerinden.
            // BLE imzasında PIN yoktur (GATT pairing ELM327 klonlarında gerekmiyor).
            bleObd().connect(address, protocol, pidSet, new BleObdManager.ConnectCallback() {
                @Override
                public void onConnected(String detectedProtocol) {
                    // Patch 3: ATDPN ile öğrenilen protokol resolve payload'ına eklenir —
                    // obdService.ts bunu persist edip sonraki bağlantıda ARAMASIZ (ATSP<n>) bağlanır.
                    JSObject result = new JSObject();
                    if (present(detectedProtocol)) result.put("protocol", detectedProtocol);
                    mainHandler.post(() -> call.resolve(result));
                }

                @Override
                public void onFailed(String error, String code) {
                    JSObject event = new JSObject();
                    event.put("state",   "error");
                    event.put("message", error);
                    // Patch 1: bu bağlantı DENEMESİNİN başarısızlığı — çağıran zaten call.reject
                    // ile aynı anda haberdar olur (tek hata, çift reaksiyon riski). obdService bu
                    // olayı YOK SAYAR (reconnect tetiklemez); asıl reconnect kararı reject/catch
                    // zincirinde (fallback transport deneme / _scheduleReconnect) verilir.
                    event.put("reason",  "connect_failed");
                    notifyListeners("obdStatus", event);

                    // Patch 3: code — "OBD_UNABLE_TO_CONNECT" | "CONNECT_FAILED" (bkz. ConnectCallback).
                    mainHandler.post(() -> call.reject(code, error));
                }
            });
            return;
        }

        if ("tcp".equals(transport)) {
            // Patch 10: WiFi ELM327 (AP modu) yolu — address "ip:port" biçiminde (ör.
            // 192.168.0.10:35000). BLUETOOTH_CONNECT/BLUETOOTH_SCAN izin/adapter kontrolleri
            // BİLİNÇLİ OLARAK YOK: WiFi'de Bluetooth adaptörü kapalı/desteksiz olabilir (K24
            // gerçeği — standart BT OEM tarafından kilitli) ve TCP soketi bunlardan bağımsızdır.
            // Tek aktif bağlantı: TCP'ye geçmeden önce varsa BLE'yi temiz kapat (Classic zaten
            // OBDManager.connectTcp() içinde kendi disconnect()'ini çağırır).
            if (bleObdManager != null) {
                try { bleObdManager.disconnect(); } catch (Exception ignored) {}
            }
            obd().connectTcp(address, protocol, pidSet, new OBDManager.ConnectCallback() {
                @Override
                public void onConnected(String detectedProtocol) {
                    JSObject result = new JSObject();
                    if (present(detectedProtocol)) result.put("protocol", detectedProtocol);
                    mainHandler.post(() -> call.resolve(result));
                }

                @Override
                public void onFailed(String error, String code) {
                    JSObject event = new JSObject();
                    event.put("state",   "error");
                    event.put("message", error);
                    // Patch 1 sözleşmesiyle aynı: bu DENEMENİN başarısızlığı, obdService
                    // reconnect kararını reject/catch zincirinden alır.
                    event.put("reason",  "connect_failed");
                    notifyListeners("obdStatus", event);
                    mainHandler.post(() -> call.reject(code, error));
                }
            });
            return;
        }

        // ── Classic RFCOMM yolu (transport classic/null/eksik/diğer) — BİREBİR korunur ──
        // Tek aktif bağlantı: Classic'e geçmeden önce varsa BLE'yi temiz kapat.
        if (bleObdManager != null) {
            try { bleObdManager.disconnect(); } catch (Exception ignored) {}
        }

        // Motor OBDManager'da; PluginCall resolve/reject + obdStatus event'i köprüde.
        obd().connect(address, pin, protocol, pidSet, new OBDManager.ConnectCallback() {
            @Override
            public void onConnected(String detectedProtocol) {
                // Patch 3: bkz. BLE onConnected yorumu — öğrenilen protokol resolve payload'ında.
                JSObject result = new JSObject();
                if (present(detectedProtocol)) result.put("protocol", detectedProtocol);
                mainHandler.post(() -> call.resolve(result));
            }

            @Override
            public void onFailed(String error, String code) {
                JSObject event = new JSObject();
                event.put("state",   "error");
                event.put("message", error);
                // Patch 1: bkz. BLE onFailed yorumu — bu bağlantı DENEMESİNİN başarısızlığı,
                // obdService reconnect kararını reject/catch zincirinden alır (çift reaksiyon yok).
                event.put("reason",  "connect_failed");
                notifyListeners("obdStatus", event);

                // Patch 3: code — "OBD_UNABLE_TO_CONNECT" | "CONNECT_FAILED" (bkz. ConnectCallback).
                mainHandler.post(() -> call.reject(code, error));
            }
        });
    }

    @PluginMethod
    public void disconnectOBD(PluginCall call) {
        // Hangi transport aktifse onu kapat. Her disconnect() idempotent; init edilmemiş
        // motoru oluşturmamak için null-guard kullanılır (gereksiz instance açma yok).
        obd().disconnect();
        if (bleObdManager != null) {
            try { bleObdManager.disconnect(); } catch (Exception ignored) {}
        }

        JSObject event = new JSObject();
        event.put("state", "disconnected");
        // Patch 1: bu bizim KENDİ disconnectOBD() çağrımızın onayı (kullanıcı eylemi VEYA
        // obdService içi transport-fallback geçişi — obdService.ts:753 önce disconnectOBD()
        // çağırıp sonra fallback transport dener). obdService bu yankıyı YOK SAYAR — aksi halde
        // aynı generation'daki obdStatus handle'ı bunu "gerçek kopma" sanıp paralel reconnect
        // başlatırdı (BC8 kararsız döngü kök nedeni).
        event.put("reason", "user_disconnect");
        notifyListeners("obdStatus", event);

        call.resolve();
    }

    /**
     * Patch 6 (AdaptivePollingController): TS tarafı deviceTier + aktif RuntimeMode'a göre
     * hesapladığı FAST grup poll periyodunu ({@code fastMs}) buradan native tarafa iletir.
     * {@code uiHz} şu an native tarafında kullanılmıyor (yalnız JS-taraflı UI bildirim tavanı
     * içindir) — burada kabul edilip yoksayılır, gelecekte native-taraflı throttling için
     * saklı tutulur. Aktif olan hangi transport ise (Classic/BLE) onun poll periyodu güncellenir;
     * her ikisi de aktif değilse sessizce no-op (henüz bağlantı yok — sonraki connect() zaten
     * başlangıç profiliyle başlar).
     */
    @PluginMethod
    public void setObdPollProfile(PluginCall call) {
        Integer fastMs = call.getInt("fastMs");
        if (fastMs != null) {
            if (obdManager != null) obdManager.setFastPollMs(fastMs);
            if (bleObdManager != null) bleObdManager.setFastPollMs(fastMs);
        }
        call.resolve();
    }

    /**
     * Patch 8: EXTENDED grup PID listesi — TS talep-güdümlü (extendedPidService). Boş/eksik
     * liste = devre dışı (poll turu ek komut çalıştırmaz, sıfır maliyet). Her iki transport'a
     * da uygulanır; aktif olmayan yöneticide sonraki bağlantıda geçerli olur.
     */
    @PluginMethod
    public void setObdExtendedPids(PluginCall call) {
        java.util.List<String> pids = new java.util.ArrayList<>();
        com.getcapacitor.JSArray arr = call.getArray("pids");
        if (arr != null) {
            try {
                for (int i = 0; i < arr.length(); i++) {
                    Object v = arr.get(i);
                    if (v instanceof String) pids.add(((String) v).toUpperCase(java.util.Locale.ROOT));
                }
            } catch (Exception ignored) { /* bozuk eleman atlanır — fail-soft */ }
        }
        if (obdManager != null) obdManager.setExtendedPids(pids);
        if (bleObdManager != null) bleObdManager.setExtendedPids(pids);
        call.resolve();
    }

    /**
     * Teşhis BURST modu (OBD Canlı Test ekranı) — açıkken EXTENDED grubunun tüm izlenen
     * PID'leri her poll turunda okunur (hızlı tazeleme). Ekran kapanınca kapatılır →
     * düşük-yük round-robin'e döner (Malı-400 sözleşmesi). Classic/TCP (OBDManager) yolu.
     */
    @PluginMethod
    public void setObdDiagnosticBurst(PluginCall call) {
        boolean enable = call.getBoolean("enable", false);
        if (obdManager != null) obdManager.setDiagnosticBurst(enable);
        JSObject ret = new JSObject();
        ret.put("enabled", enable);
        call.resolve(ret);
    }

    // ── DTC (Mode 03 / 04) ──────────────────────────────────────────────────
    // dtcService.ts bu metotları çağırır. Eskiden native implementasyon HİÇ
    // YOKTU → her tarama "method not implemented" reject → UI her zaman
    // "OBD okuyucu yanıt vermiyor" gösteriyordu (saha hatası 2026-06-11).

    /** Aktif transport üzerinden DTC okur; hiçbiri bağlı değilse IOException. */
    private java.util.List<String> dtcReadFromActive() throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.readDTCs();
        if (obdManager    != null && obdManager.isConnected())    return obdManager.readDTCs();
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    private boolean dtcClearFromActive() throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.clearDTCs();
        if (obdManager    != null && obdManager.isConnected())    return obdManager.clearDTCs();
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    @PluginMethod
    public void readDTC(PluginCall call) {
        // Ayrı thread: elmLock'ta bir poll turu beklenebilir (~6sn) + Mode 03
        // (~4sn) — Capacitor plugin handler'ı bloklanırsa TTS/diğer çağrılar takılır.
        new Thread(() -> {
            try {
                java.util.List<String> codes = dtcReadFromActive();
                JSArray arr = new JSArray();
                for (String c : codes) arr.put(c);
                JSObject ret = new JSObject();
                ret.put("codes", arr);
                mainHandler.post(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "DTC okunamadı";
                mainHandler.post(() -> call.reject("DTC_READ_FAILED", msg));
            }
        }, "obd-dtc-read").start();
    }

    @PluginMethod
    public void clearDTC(PluginCall call) {
        new Thread(() -> {
            try {
                boolean ok = dtcClearFromActive();
                if (ok) mainHandler.post(call::resolve);
                else    mainHandler.post(() -> call.reject("DTC_CLEAR_FAILED", "ECU silme onayı vermedi"));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "DTC silinemedi";
                mainHandler.post(() -> call.reject("DTC_CLEAR_FAILED", msg));
            }
        }, "obd-dtc-clear").start();
    }

    // ── Patch 11A: Mode 07 (bekleyen) / Mode 0A (kalıcı) DTC ─────────────────

    /** Aktif transport üzerinden BEKLEYEN DTC okur; hiçbiri bağlı değilse IOException. */
    private java.util.List<String> dtcReadPendingFromActive() throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.readPendingDTCs();
        if (obdManager    != null && obdManager.isConnected())    return obdManager.readPendingDTCs();
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    /** Aktif transport üzerinden KALICI DTC okur; null = mod desteklenmiyor. */
    private java.util.List<String> dtcReadPermanentFromActive() throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.readPermanentDTCs();
        if (obdManager    != null && obdManager.isConnected())    return obdManager.readPermanentDTCs();
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    @PluginMethod
    public void readPendingDTC(PluginCall call) {
        new Thread(() -> {
            try {
                java.util.List<String> codes = dtcReadPendingFromActive();
                JSArray arr = new JSArray();
                for (String c : codes) arr.put(c);
                JSObject ret = new JSObject();
                ret.put("codes", arr);
                mainHandler.post(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Bekleyen arıza kodu okunamadı";
                mainHandler.post(() -> call.reject("DTC_READ_FAILED", msg));
            }
        }, "obd-dtc-read-pending").start();
    }

    @PluginMethod
    public void readPermanentDTC(PluginCall call) {
        new Thread(() -> {
            try {
                // null = Mode 0A desteklenmiyor (2010 öncesi araç) — "kod yok"tan AYRI durum.
                java.util.List<String> codes = dtcReadPermanentFromActive();
                JSObject ret = new JSObject();
                if (codes == null) {
                    ret.put("supported", false);
                    ret.put("codes", new JSArray());
                } else {
                    JSArray arr = new JSArray();
                    for (String c : codes) arr.put(c);
                    ret.put("supported", true);
                    ret.put("codes", arr);
                }
                mainHandler.post(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Kalıcı arıza kodu okunamadı";
                mainHandler.post(() -> call.reject("DTC_READ_FAILED", msg));
            }
        }, "obd-dtc-read-permanent").start();
    }

    // ── Patch 11B: Mode 02 freeze frame ──────────────────────────────────────

    private String freezeFrameDtcFromActive() throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.readFreezeFrameDtc();
        if (obdManager    != null && obdManager.isConnected())    return obdManager.readFreezeFrameDtc();
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    private String freezeFramePidFromActive(String pid) throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.readFreezeFramePid(pid);
        if (obdManager    != null && obdManager.isConnected())    return obdManager.readFreezeFramePid(pid);
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    @PluginMethod
    public void readFreezeFrameDtc(PluginCall call) {
        new Thread(() -> {
            try {
                String dtc = freezeFrameDtcFromActive();
                JSObject ret = new JSObject();
                ret.put("dtc", dtc != null ? dtc : org.json.JSONObject.NULL);
                mainHandler.post(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Freeze frame DTC okunamadı";
                mainHandler.post(() -> call.reject("FREEZE_FRAME_FAILED", msg));
            }
        }, "obd-freeze-frame-dtc").start();
    }

    @PluginMethod
    public void readFreezeFramePid(PluginCall call) {
        String pid = call.getString("pid");
        if (pid == null || pid.isEmpty()) { call.reject("FREEZE_FRAME_FAILED", "pid parametresi eksik"); return; }
        final String p = pid.toUpperCase(java.util.Locale.ROOT);
        new Thread(() -> {
            try {
                String data = freezeFramePidFromActive(p);
                JSObject ret = new JSObject();
                ret.put("data", data != null ? data : org.json.JSONObject.NULL);
                mainHandler.post(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Freeze frame PID okunamadı";
                mainHandler.post(() -> call.reject("FREEZE_FRAME_FAILED", msg));
            }
        }, "obd-freeze-frame-pid").start();
    }

    // ── Patch 11C: tek-seferlik jenerik Mode 01 PID okuma (readiness/enum PID'ler) ──

    private String pidOnceFromActive(String pid) throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.readPidOnce(pid);
        if (obdManager    != null && obdManager.isConnected())    return obdManager.readPidOnce(pid);
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    @PluginMethod
    public void readPidOnce(PluginCall call) {
        String pid = call.getString("pid");
        if (pid == null || pid.isEmpty()) { call.reject("PID_ONCE_FAILED", "pid parametresi eksik"); return; }
        final String p = pid.toUpperCase(java.util.Locale.ROOT);
        new Thread(() -> {
            try {
                String data = pidOnceFromActive(p);
                JSObject ret = new JSObject();
                ret.put("data", data != null ? data : org.json.JSONObject.NULL);
                mainHandler.post(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "PID okunamadı";
                mainHandler.post(() -> call.reject("PID_ONCE_FAILED", msg));
            }
        }, "obd-pid-once").start();
    }

    // ── Patch 12A: UDS Mode 22 (ReadDataByIdentifier) — üretici-özel DID okuma ──────

    private String readObdDidFromActive(String tx, String rx, String did) throws Exception {
        if (bleObdManager != null && bleObdManager.isConnected()) return bleObdManager.readObdDid(tx, rx, did);
        if (obdManager    != null && obdManager.isConnected())    return obdManager.readObdDid(tx, rx, did);
        throw new java.io.IOException("OBD okuyucu bağlı değil");
    }

    @PluginMethod
    public void readObdDid(PluginCall call) {
        String tx = call.getString("tx");
        String rx = call.getString("rx");
        String did = call.getString("did");
        if (tx == null || tx.isEmpty() || rx == null || rx.isEmpty() || did == null || did.isEmpty()) {
            call.reject("OBD_DID_FAILED", "tx/rx/did parametreleri eksik");
            return;
        }
        final String t = tx.toUpperCase(java.util.Locale.ROOT);
        final String r = rx.toUpperCase(java.util.Locale.ROOT);
        final String d = did.toUpperCase(java.util.Locale.ROOT);
        new Thread(() -> {
            try {
                String data = readObdDidFromActive(t, r, d);
                JSObject ret = new JSObject();
                if (data != null) {
                    ret.put("data", data);
                    ret.put("supported", true);
                } else {
                    ret.put("data", org.json.JSONObject.NULL);
                    ret.put("supported", false);
                }
                mainHandler.post(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "DID okunamadı";
                mainHandler.post(() -> call.reject("OBD_DID_FAILED", msg));
            }
        }, "obd-read-did").start();
    }

    // ── OBD internals ───────────────────────────────────────────────────────

    /**
     * JS'ten gelen PID JSArray'ini ('0x0D' formatı) kanonik sete çevirir ('0D').
     * @return null → liste yok/boş (geriye dönük uyumluluk: tüm PID'ler sorgulanır)
     */
    private java.util.Set<String> parsePidSet(JSArray arr) {
        if (arr == null) return null;
        java.util.Set<String> set = new java.util.HashSet<>();
        try {
            for (int i = 0; i < arr.length(); i++) {
                Object o = arr.get(i);
                if (o == null) continue;
                String s = o.toString().trim().toUpperCase();
                if (s.startsWith("0X")) s = s.substring(2);
                if (!s.isEmpty()) set.add(s);
            }
        } catch (org.json.JSONException ignored) {}
        return set.isEmpty() ? null : set;
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

    // volatile (Faz 5): wake grammar thread'i half-duplex kararı için okur —
    // aktif STT isteği beklerken (model yükleniyor olsa bile) mikrofon bırakılır.
    private volatile PluginCall savedSpeechCall = null;
    private SpeechRecognizer speechRecognizer = null;

    // ── Vosk (offline STT) durumu ────────────────────────────────────────────
    private Model         voskModel           = null;   // bir kez yüklenir, tekrar kullanılır
    private volatile Thread voskCaptureThread = null;   // aktif dinleme thread'i (özel AudioRecord döngüsü)
    private volatile boolean voskCapturing    = false;  // capture döngüsü çalışıyor mu
    private volatile int   voskMaxAlternatives = 1;     // n-best: >1 ise Recognizer.setMaxAlternatives (STT belirsizliğini beyin çözer)
    private boolean       voskModelLoading    = false;
    private Handler       voskTimeoutHandler  = null;
    private Runnable      voskTimeoutRunnable = null;

    /* Model hazır/hata bekleyenleri — unpack+load zayıf head unit CPU'sunda 20-40 sn
     * sürebilir. Eskiden yükleme sırasındaki 2. çağrı REDDEDİLİYORDU ("tekrar deneyin")
     * ve ilk çağrı JS failsafe'ine (14 sn) takılıp "Dinliyorum"da asılı kalıyordu.
     * Artık: (1) boot'ta preloadVoskModel ile arka planda ısıtılır, (2) yükleme
     * sürerken gelen istekler kuyruğa alınır, model hazır olunca sırayla çalışır. */
    private interface VoskFailCb { void fail(String reason); }
    private final java.util.List<Runnable>   voskOnReady = new java.util.ArrayList<>();
    private final java.util.List<VoskFailCb> voskOnFail  = new java.util.ArrayList<>();

    /**
     * Modeli (gerekiyorsa) yükler; hazır olunca onReady, başarısızsa onFail çalışır.
     * Eşzamanlı çağrılar tek unpack paylaşır — callback'ler kuyruklanır.
     */
    private void ensureVoskModel(Runnable onReady, VoskFailCb onFail) {
        synchronized (voskOnReady) {
            if (voskModel != null) { onReady.run(); return; }
            voskOnReady.add(onReady);
            voskOnFail.add(onFail);
            if (voskModelLoading) return; // yükleme zaten uçuşta — kuyruğa eklendi
            voskModelLoading = true;
        }
        try {
            StorageService.unpack(getContext(), "vosk-model-tr", "vosk-model",
                (model) -> {
                    java.util.List<Runnable> ready;
                    synchronized (voskOnReady) {
                        voskModel = model;
                        voskModelLoading = false;
                        ready = new java.util.ArrayList<>(voskOnReady);
                        voskOnReady.clear();
                        voskOnFail.clear();
                    }
                    for (Runnable r : ready) { try { r.run(); } catch (Exception ignored) {} }
                },
                (exception) -> drainVoskFail("model açılamadı: "
                    + (exception != null ? exception.getMessage() : "bilinmeyen")));
        } catch (Throwable t) {
            drainVoskFail("model unpack istisnası: " + t.getMessage());
        }
    }

    private void drainVoskFail(String reason) {
        java.util.List<VoskFailCb> fails;
        synchronized (voskOnReady) {
            voskModelLoading = false;
            fails = new java.util.ArrayList<>(voskOnFail);
            voskOnReady.clear();
            voskOnFail.clear();
        }
        for (VoskFailCb f : fails) { try { f.fail(reason); } catch (Exception ignored) {} }
    }

    /**
     * Boot sırasında modeli arka planda ısıtır — ilk mikrofon basışı unpack+load
     * maliyetini (zayıf CPU'da 20-40 sn) ödemesin. İdempotent; model RAM'de kalır.
     */
    @PluginMethod
    public void preloadVoskModel(PluginCall call) {
        ensureVoskModel(
            () -> {
                JSObject r = new JSObject();
                r.put("ready", true);
                call.resolve(r);
            },
            (reason) -> call.reject("Vosk model yüklenemedi — " + reason, "MODEL_LOAD"));
    }

    // ── Mikrofon hassasiyeti (araç içi: yol gürültüsü + alçak sesle konuşma) ──────
    // Vosk'un kendi SpeechService'i ham, kazançsız ses verir → kullanıcı bağırmadan
    // tanımıyordu. Özel AudioRecord döngüsü: AGC + NoiseSuppressor + AEC efektleri +
    // yazılım kazancı (GAIN) ile alçak sesli konuşma yükseltilir.
    // Varsayılanlar yalnız OPSİYONSUZ çağrılar için (wake word döngüsü — mevcut
    // pil/davranış profili korunur). Sesli asistan değerleri TEK KAYNAKTAN gelir:
    // src/platform/voiceTuning.ts → startSpeechRecognition({ gain, maxListenMs }).
    // Clamp şart: aşırı kazanç yol gürültüsünü "kelimeye" çevirir (yanlış tetikleme),
    // aşırı pencere pil/UX maliyeti getirir.
    private static final float VOSK_GAIN_DEFAULT  = 2.0f;  // yazılım ses kazancı (clipping korumalı)
    private static final float VOSK_GAIN_MIN      = 1.0f;
    private static final float VOSK_GAIN_MAX      = 4.0f;  // gürültü tavanı
    // Adaptif kazanç tepe sınırı (~%88 tam ölçek): kullanıcı mikrofonun DİBİNDE
    // konuşunca yüksek giriş × kazanç naif clamp'le TEPEDEN KESİLİYORDU (kare
    // dalga distorsiyonu) → Vosk özel isimleri tanıyamıyordu ("Göktürk"→"Türk"
    // ya da isim komple düşüyor — saha 2026-06-11). Tepe bu sınırı aşacaksa
    // kazanç o pencere için otomatik düşürülür; uzak/alçak seste tam kazanç sürer.
    private static final float VOSK_CLIP_HEADROOM = 29000f;
    private static final int   VOSK_SAMPLE_RATE   = 16000;
    private static final long  VOSK_MAX_LISTEN_MS_DEFAULT = 9000; // sessizlik endpoint'i daha erken çözer
    private static final long  VOSK_MAX_LISTEN_MIN_MS     = 5000;
    private static final long  VOSK_MAX_LISTEN_MAX_MS     = 20000;
    // RMS-VAD endpoint yardımcısı — SAHA 2026-07-03: araç/yol gürültüsünde (AGC
    // gürültüyü de yükseltir) Vosk'un kendi endpointer'ı hiç tetiklenmiyor ve
    // oturum 9sn tavana takılıyordu ("Dinliyorum" askısı). Konuşma görüldükten
    // sonra RMS, gürültü tabanının altına düşüp bu süre boyunca orada kalırsa
    // beklemeden finalize edilir. Taban ilk 4 pencereden (~1sn) öğrenilir.
    private static final long  VOSK_VAD_SILENCE_MS   = 900;
    private static final float VOSK_VAD_MIN_THRESH   = 0.015f; // mutlak alt eşik (sessiz kabin)
    private static final float VOSK_VAD_FLOOR_FACTOR = 2.5f;   // taban × bu = konuşma eşiği
    private volatile float voskGain        = VOSK_GAIN_DEFAULT;
    private volatile long  voskMaxListenMs = VOSK_MAX_LISTEN_MS_DEFAULT;
    // Wake word pasif döngüsü müziği KISMAMALI (sürekli %12 duck = müzik
    // dinlenemez). JS duckWhileListening:false geçer; varsayılan true —
    // aktif dinleme (push-to-talk) davranışı değişmez.
    private volatile boolean voskDuckEnabled = true;

    // ── Dinlerken müzik kısma (audio ducking) ───────────────────────────────────
    // Mikrofona basınca müzik hoparlörden çalmaya devam ediyordu → (1) rahatsız edici,
    // (2) mikrofon müziği konuşmayla birlikte alıp tanımayı bozuyordu (kullanıcı bağırıyordu).
    // Dinleme başında STREAM_MUSIC sesini fiziksel olarak kısar, bitince geri yükleriz.
    // Fiziksel kısma şart: WebView/HTML5 oynatıcılar audio focus'a uymayabilir; setStreamVolume
    // her oynatıcı için garanti çalışır.
    private static final float VOSK_DUCK_RATIO = 0.12f; // dinlerken müzik max'ın ~%12'sine iner
    private volatile int savedMusicVolume = -1;         // -1 = kısılmadı (geri yükleme bekleyen yok)

    @PluginMethod
    public void startSpeechRecognition(PluginCall call) {
        // Mikrofon izni yoksa runtime'da iste — ama YİNE DE Vosk'u dene (engelleme).
        // Bazı head unit'lerde checkSelfPermission "denied" dönse bile AudioRecord
        // çalışır (gevşek izin / sistem benzeri erişim). Engelleyici reddetme,
        // çalışan yolu kapatıyordu; gerçekten erişilemezse Vosk onError bildirir.
        if (ContextCompat.checkSelfPermission(getContext(),
                android.Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            try {
                ActivityCompat.requestPermissions(getActivity(),
                    new String[]{ android.Manifest.permission.RECORD_AUDIO }, 9002);
            } catch (Exception ignored) {}
        }
        savedSpeechCall = call;
        String  language      = call.getString("language", "tr-TR");
        int     maxResults    = call.getInt("maxResults", 1);
        // JS preferOffline tercihini ARTIK dikkate al. Eskiden EXTRA_PREFER_OFFLINE sabit true idi →
        // offline TR dil modeli olmayan head unit'lerde tanıma anında ERROR_CLIENT/NO_MATCH ile çöküyor,
        // dinleme hiç başlamadan "Anlaşılamadı" gösteriliyordu. Telefonlarda offline model/GMS olduğu için çalışıyordu.
        boolean preferOffline  = Boolean.TRUE.equals(call.getBoolean("preferOffline", Boolean.FALSE));
        boolean onlineFallback = Boolean.TRUE.equals(call.getBoolean("onlineFallback", Boolean.TRUE));
        // Hassasiyet ayarları (opsiyonel — voiceTuning.ts tek kaynak). Clamp ile güvenli bant.
        Double gainOpt = call.getDouble("gain");
        float reqGain = gainOpt != null ? gainOpt.floatValue() : VOSK_GAIN_DEFAULT;
        voskGain = Math.max(VOSK_GAIN_MIN, Math.min(VOSK_GAIN_MAX, reqGain));
        Integer maxMsOpt = call.getInt("maxListenMs");
        long reqMaxMs = maxMsOpt != null ? maxMsOpt.longValue() : VOSK_MAX_LISTEN_MS_DEFAULT;
        voskMaxListenMs = Math.max(VOSK_MAX_LISTEN_MIN_MS, Math.min(VOSK_MAX_LISTEN_MAX_MS, reqMaxMs));
        voskDuckEnabled = !Boolean.FALSE.equals(call.getBoolean("duckWhileListening", Boolean.TRUE));
        // YÖNLENDİRME (2026-06-12 saha: "telefonda %40 anlıyor") — Vosk küçük TR modeli
        // araç-içinde yeterli ama telefonda online tanıma çok daha doğru:
        //   • preferOffline=false + Google tanıma MEVCUT (telefon, internetli) → yüksek
        //     doğruluklu ONLINE tanıma. Online ağ koparsa Vosk'a düşülür (onError → voskFallback).
        //   • aksi halde (head unit/internetsiz ya da Google yok) → KATMAN 1 cihaz-içi Vosk.
        //     Vosk modeli yüklenemezse voskFailed() eski mantıkla GMS'li cihazda online dener.
        boolean googleAvailable = false;
        try { googleAvailable = SpeechRecognizer.isRecognitionAvailable(getContext()); }
        catch (Exception ignored) {}
        if (!preferOffline && googleAvailable) {
            beginSpeechRecognition(language, maxResults, false, false, onlineFallback);
        } else {
            startVoskRecognition(language, maxResults, preferOffline, onlineFallback);
        }
    }

    /**
     * @param preferOffline    yalnızca true ise EXTRA_PREFER_OFFLINE ayarlanır (aksi halde sistem
     *                         en iyi yolu — genelde online — seçer; head unit uyumluluğu için kritik).
     * @param allowOnlineRetry offline denemesi başarısız olursa online ile bir kez daha denensin mi
     *                         (head unit'lerde offline model yok → otomatik online'a düşülür).
     */
    private void beginSpeechRecognition(String language, int maxResults,
                                        boolean preferOffline, boolean allowOnlineRetry,
                                        boolean voskFallback) {
        final int     finalMaxResults    = maxResults;
        final boolean finalPreferOffline = preferOffline;
        final boolean finalVoskFallback  = voskFallback;
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (speechRecognizer != null) {
                    try { speechRecognizer.destroy(); } catch (Exception ignored) {}
                    speechRecognizer = null;
                }

                if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                    if (savedSpeechCall != null) {
                        savedSpeechCall.reject("Cihazda ses tanıma mevcut değil", "NO_RECOGNIZER");
                        savedSpeechCall = null;
                    }
                    return;
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(android.os.Bundle params) {}
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {
                        float normalized = Math.max(0f, Math.min(1f, (rmsdB + 2.0f) / 10.0f));
                        JSObject data = new JSObject();
                        data.put("value", normalized);
                        notifyListeners("rmsData", data);
                    }
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
                            // n-best: tüm alternatifleri JS'e ver (beyin doğru olanı seçsin).
                            JSArray alts = new JSArray();
                            for (String m : matches) if (m != null && !m.trim().isEmpty()) alts.put(m.trim());
                            r.put("alternatives", alts);
                            c.resolve(r);
                        } else {
                            c.reject("Sonuç alınamadı", "NO_RESULT");
                        }
                        destroySpeechRecognizer();
                    }

                    @Override
                    public void onError(int error) {
                        // Offline denendi ve model yok / dil desteklenmiyorsa → online ile BİR KEZ daha dene.
                        // ERROR_CLIENT(5), NO_MATCH(7), LANGUAGE_UNAVAILABLE(12), LANGUAGE_NOT_SUPPORTED(13)
                        boolean offlineMissing = error == SpeechRecognizer.ERROR_CLIENT
                                              || error == SpeechRecognizer.ERROR_NO_MATCH
                                              || error == 12
                                              || error == 13;
                        if (allowOnlineRetry && finalPreferOffline && offlineMissing) {
                            destroySpeechRecognizer();
                            // savedSpeechCall KORUNUR — online denemesi aynı Promise'i çözer
                            beginSpeechRecognition(language, finalMaxResults, false, false, finalVoskFallback);
                            return;
                        }
                        // Online tanıma SEÇİLDİ ama ağ koptu/sunucu/istemci hatası → cihaz-içi Vosk'a
                        // düş (telefon: internet anlık kesilse bile cevapsız kalma). NO_MATCH/timeout
                        // (kullanıcı konuştu ama anlaşılmadı) HARİÇ — onlarda yeniden dinleme açma.
                        boolean onlineUnavailable = error == SpeechRecognizer.ERROR_NETWORK
                                                 || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                                                 || error == SpeechRecognizer.ERROR_CLIENT
                                                 || error == SpeechRecognizer.ERROR_SERVER;
                        if (finalVoskFallback && onlineUnavailable) {
                            destroySpeechRecognizer();
                            // savedSpeechCall KORUNUR — Vosk aynı Promise'i çözer
                            startVoskRecognition(language, finalMaxResults, true, false);
                            return;
                        }
                        PluginCall c = savedSpeechCall;
                        savedSpeechCall = null;
                        if (c == null) return;
                        String msg = error == SpeechRecognizer.ERROR_NO_MATCH ? "No speech detected"
                            : error == SpeechRecognizer.ERROR_NETWORK ? "Check internet connection"
                            : error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "Zaman aşımı"
                            : "Ses tanıma hatası: " + error;
                        c.reject(msg, "NO_RESULT");
                        destroySpeechRecognizer();
                    }
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, finalMaxResults);
                // Sadece açıkça istenirse offline'a zorla — aksi halde sistem online'ı kullanabilir.
                if (finalPreferOffline) {
                    intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                }
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE,
                    getContext().getPackageName());

                duckMusicForListening(); // Google yolu da dinlerken müziği kıs (Vosk ile tutarlı)
                speechRecognizer.startListening(intent);

            } catch (Exception e) {
                if (savedSpeechCall != null) {
                    savedSpeechCall.reject("Ses tanıma başlatılamadı: " + e.getMessage(), "NO_RECOGNIZER");
                    savedSpeechCall = null;
                }
                destroySpeechRecognizer();
            }
        });
    }

    private void destroySpeechRecognizer() {
        restoreMusicAfterListening(); // dinleme bitti → müziği geri aç (sonuç/hata/iptal tüm yollar buraya uğrar)
        if (speechRecognizer != null) {
            try { speechRecognizer.destroy(); } catch (Exception ignored) {}
            speechRecognizer = null;
        }
    }

    /* ── Vosk offline STT (Katman 1) ─────────────────────────────────────────
     * Google/GMS gerektirmez, internetsiz çalışır. Model assets/vosk-model-tr'den
     * ilk çağrıda filesDir'e açılır (StorageService), sonra RAM'de tutulur.
     * Başarısız olursa Google SpeechRecognizer'a (beginSpeechRecognition) düşülür. */

    private void startVoskRecognition(String language, int maxResults,
                                      boolean preferOffline, boolean onlineFallback) {
        // n-best: Recognizer.setMaxAlternatives için (runVoskListening argümansız çağrılıyor).
        voskMaxAlternatives = Math.max(1, Math.min(5, maxResults));
        // Model yüklemesi (gerekirse) ensureVoskModel'de kuyruklanır — yükleme sürerken
        // gelen istek REDDEDİLMEZ, model hazır olunca dinleme başlar. savedSpeechCall
        // korunur; runVoskListening onu çözer.
        ensureVoskModel(
            this::runVoskListening,
            (reason) -> voskFailed(reason, language, maxResults, preferOffline, onlineFallback));
    }

    /**
     * Vosk başlatılamadığında: GMS/Google tanıma VARSA ona düş (telefon),
     * YOKSA (head unit) yanıltıcı "internet/dil paketi" mesajı yerine GERÇEK
     * Vosk hatasını JS'e bildir — böylece sebep (storage, ABI, model) görünür.
     */
    private void voskFailed(String reason, String language, int maxResults,
                            boolean preferOffline, boolean onlineFallback) {
        voskModelLoading = false;
        boolean googleAvailable = false;
        try { googleAvailable = SpeechRecognizer.isRecognitionAvailable(getContext()); }
        catch (Exception ignored) {}
        // KRİTİK: Head unit'lerde internet YOKTUR. preferOffline=true iken Vosk başarısız
        // olursa Google'a düşmek yanıltıcı "internet gerekli" hatası verir ve GERÇEK Vosk
        // sebebini (model yapısı/storage/ABI) gizler. Bu yüzden offline tercih edildiğinde
        // Google'a DÜŞME — gerçek Vosk sebebini bildir ki sorun teşhis edilebilsin.
        if (!preferOffline && googleAvailable && onlineFallback) {
            beginSpeechRecognition(language, maxResults, preferOffline, onlineFallback, false);
        } else {
            rejectVosk("Vosk STT başlatılamadı — " + reason);
        }
    }

    /**
     * Özel AudioRecord dinleme döngüsü — Vosk'un kendi SpeechService'i yerine.
     * Neden: SpeechService ham, kazançsız ses verir → araç içinde alçak sesle/yol gürültüsünde
     * tanımıyordu (kullanıcı bağırmak zorunda). Bu döngü:
     *   - AGC (otomatik kazanç) + NoiseSuppressor + AcousticEchoCanceler donanım efektleri,
     *   - yazılım kazancı (voskGain — JS voiceTuning.ts'ten, clamp'li; clipping korumalı),
     *   - gerçek RMS → UI ses göstergesi (SpeechService RMS vermiyordu),
     *   - acceptWaveForm endpoint → konuşma biter bitmez sonuç (geç tepki azalır).
     */
    /** Dinleme başında müzik sesini kıs (mikrofon temizliği + UX). */
    private void duckMusicForListening() {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int ducked = Math.max(0, Math.round(max * VOSK_DUCK_RATIO));
            if (ducked < cur) {
                if (savedMusicVolume < 0) savedMusicVolume = cur; // ilk kısmada gerçek seviyeyi sakla
                am.setStreamVolume(AudioManager.STREAM_MUSIC, ducked, 0);
            }
        } catch (Exception ignored) {}
    }

    /** Dinleme bitince müzik sesini eski seviyeye geri yükle. */
    private void restoreMusicAfterListening() {
        try {
            int saved = savedMusicVolume;
            savedMusicVolume = -1;
            if (saved < 0) return; // kısılmamıştı → dokunma
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            am.setStreamVolume(AudioManager.STREAM_MUSIC, saved, 0);
        } catch (Exception ignored) {}
    }

    private void runVoskListening() {
        // Bekleyen JS çağrısı yoksa (kullanıcı vazgeçti / preload yolu) mikrofonu boşuna açma
        if (savedSpeechCall == null) return;
        stopVosk(); // önceki oturumu temizle (varsa eski thread'i durdur)
        voskCapturing = true;
        // Wake word pasif döngüsü duckWhileListening:false geçer — müzik kısılmaz.
        if (voskDuckEnabled) duckMusicForListening(); // mikrofon dinlerken müziği kıs
        final long startedAt = System.currentTimeMillis();
        // Oturum başında sabitle (thread görünürlüğü): bir sonraki çağrının opsiyonları
        // çalışan oturumu etkilemesin.
        final float sessionGain  = voskGain;
        final long  sessionMaxMs = voskMaxListenMs;
        final boolean sessionDuck = voskDuckEnabled; // false = pasif wake döngüsü (eski APK fallback yolu)
        Thread t = new Thread(() -> {
            // PERF 2026-06-12: pasif wake polling oturumu (duck:false) sürekli döner —
            // UI ile yarışmasın (grammar thread'iyle aynı gerekçe). Aktif asistan
            // oturumu (duck:true) kullanıcı tetiklidir ve kısadır → default öncelik kalır.
            // SAHA REVİZE: BACKGROUND(10) yerine nice +2 — bg cpuset açlığı riski yok.
            if (!sessionDuck) {
                try {
                    android.os.Process.setThreadPriority(2);
                } catch (Throwable ignored) {}
            }
            AudioRecord recorder = null;
            Recognizer recognizer = null;
            AutomaticGainControl agc = null;
            NoiseSuppressor      ns  = null;
            AcousticEchoCanceler aec = null;
            boolean gotResult = false;
            try {
                int minBuf = AudioRecord.getMinBufferSize(VOSK_SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minBuf <= 0) minBuf = VOSK_SAMPLE_RATE; // güvenli taban
                int bufBytes = Math.max(minBuf, VOSK_SAMPLE_RATE / 2); // ~250ms pencere

                // VOICE_RECOGNITION: ASR için tasarlı kaynak; AGC/NS'yi biz açıyoruz.
                recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                        VOSK_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT, bufBytes * 2);
                if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                    try { recorder.release(); } catch (Exception ignored) {}
                    // Bazı head unit'lerde VOICE_RECOGNITION kaynağı yok → MIC'e düş
                    recorder = new AudioRecord(MediaRecorder.AudioSource.MIC,
                            VOSK_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, bufBytes * 2);
                }
                if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                    throw new IllegalStateException("AudioRecord init başarısız (mikrofon izni/donanım)");
                }

                // Donanım ses efektleri — araç içi alçak ses + yol gürültüsü için kritik
                int sid = recorder.getAudioSessionId();
                try { if (AutomaticGainControl.isAvailable())  { agc = AutomaticGainControl.create(sid);  if (agc != null) agc.setEnabled(true); } } catch (Exception ignored) {}
                try { if (NoiseSuppressor.isAvailable())       { ns  = NoiseSuppressor.create(sid);        if (ns  != null) ns.setEnabled(true);  } } catch (Exception ignored) {}
                try { if (AcousticEchoCanceler.isAvailable())  { aec = AcousticEchoCanceler.create(sid);   if (aec != null) aec.setEnabled(true); } } catch (Exception ignored) {}

                recognizer = new Recognizer(voskModel, (float) VOSK_SAMPLE_RATE);
                // n-best: >1 istenirse Vosk alternatifleri JSON'da {"alternatives":[...]} döndürür.
                if (voskMaxAlternatives > 1) {
                    try { recognizer.setMaxAlternatives(voskMaxAlternatives); } catch (Throwable ignored) {}
                }
                recorder.startRecording();

                short[] buf = new short[bufBytes / 2];
                int rmsThrottle = 0;
                // RMS-VAD durumu (pencere ~250ms): taban öğrenimi → konuşma → sessizlik
                double vadFloorSum = 0; int vadFloorWin = 0; double vadFloor = 0;
                boolean vadSpeechSeen = false; long vadSilenceStart = 0;
                while (voskCapturing && !Thread.currentThread().isInterrupted()) {
                    int n = recorder.read(buf, 0, buf.length);
                    if (n <= 0) {
                        if (System.currentTimeMillis() - startedAt > sessionMaxMs) break;
                        continue;
                    }
                    // ADAPTİF yazılım kazancı: pencere tepesine göre kazanç sınırlanır —
                    // naif clamp dalgayı tepeden kesip distorsiyon yaratıyordu (yakın
                    // mikrofonda özel isimler tanınmıyordu). Tepe × kazanç headroom'u
                    // aşacaksa kazanç o pencere için düşer (en az 1.0 — sinyal asla kısılmaz).
                    int peak = 0;
                    for (int i = 0; i < n; i++) {
                        int a = buf[i] >= 0 ? buf[i] : -buf[i];
                        if (a > peak) peak = a;
                    }
                    float g = sessionGain;
                    if (peak > 0 && peak * g > VOSK_CLIP_HEADROOM) {
                        g = Math.max(1.0f, VOSK_CLIP_HEADROOM / peak);
                    }
                    double sumSq = 0;
                    for (int i = 0; i < n; i++) {
                        int v = Math.round(buf[i] * g);
                        if (v > 32767) v = 32767; else if (v < -32768) v = -32768; // emniyet
                        buf[i] = (short) v;
                        sumSq += (double) v * v;
                    }
                    if (++rmsThrottle >= 2) {
                        rmsThrottle = 0;
                        double rms = Math.sqrt(sumSq / n) / 32768.0;
                        JSObject d = new JSObject();
                        d.put("value", Math.max(0.0, Math.min(1.0, rms * 2.5)));
                        notifyListeners("rmsData", d);
                    }

                    if (recognizer.acceptWaveForm(buf, n)) {
                        // Endpoint (konuşma + sessizlik) → sonuç hazır
                        String json = recognizer.getResult();
                        String text = extractVoskText(json);
                        if (text != null && !text.isEmpty()) { gotResult = true; resolveVosk(text, extractVoskAlternatives(json)); break; }
                    }

                    // ── RMS-VAD endpoint yardımcısı ─────────────────────────
                    // Vosk endpointer gürültüde tetiklenmezse: konuşma sonrası
                    // ~900ms süren sessizlikte oturumu beklemeden finalize et.
                    double vadRms = Math.sqrt(sumSq / n) / 32768.0;
                    if (vadFloorWin < 4) {
                        vadFloorSum += vadRms; vadFloorWin++;
                        if (vadFloorWin == 4) vadFloor = vadFloorSum / 4.0;
                    } else {
                        double thresh = Math.max(vadFloor * VOSK_VAD_FLOOR_FACTOR, VOSK_VAD_MIN_THRESH);
                        if (vadRms >= thresh) {
                            vadSpeechSeen = true; vadSilenceStart = 0;
                        } else if (vadSpeechSeen) {
                            long nowMs = System.currentTimeMillis();
                            if (vadSilenceStart == 0) vadSilenceStart = nowMs;
                            else if (nowMs - vadSilenceStart >= VOSK_VAD_SILENCE_MS) {
                                gotResult = true; // final iki kez ÇAĞRILMAZ (aşağıdaki blok atlanır)
                                String json = recognizer.getFinalResult();
                                String text = extractVoskText(json);
                                if (text != null && !text.isEmpty()) resolveVosk(text, extractVoskAlternatives(json));
                                else rejectVosk("No speech detected");
                                break;
                            }
                        }
                    }
                    if (System.currentTimeMillis() - startedAt > sessionMaxMs) break;
                }

                if (!gotResult && voskCapturing) {
                    String json = recognizer.getFinalResult();
                    String text = extractVoskText(json);
                    if (text != null && !text.isEmpty()) resolveVosk(text, extractVoskAlternatives(json));
                    else rejectVosk("No speech detected"); // JS bunu sessizce idle eder
                }
            } catch (Throwable th) {
                if (voskCapturing) rejectVosk("Vosk başlatılamadı: " + th.getMessage());
            } finally {
                voskCapturing = false;
                restoreMusicAfterListening(); // dinleme bitti → müziği geri aç (her yol: sonuç/sessizlik/hata/timeout/iptal)
                if (recorder != null) { try { recorder.stop(); } catch (Exception ignored) {} try { recorder.release(); } catch (Exception ignored) {} }
                if (agc != null) { try { agc.release(); } catch (Exception ignored) {} }
                if (ns  != null) { try { ns.release();  } catch (Exception ignored) {} }
                if (aec != null) { try { aec.release(); } catch (Exception ignored) {} }
                if (recognizer != null) { try { recognizer.close(); } catch (Exception ignored) {} }
            }
        }, "vosk-capture");
        voskCaptureThread = t;
        t.start();
    }

    private void resolveVosk(String text) { resolveVosk(text, null); }

    private void resolveVosk(String text, java.util.List<String> alts) {
        PluginCall c = savedSpeechCall;
        savedSpeechCall = null;
        if (c != null) {
            JSObject r = new JSObject();
            r.put("transcript", text);
            // n-best: alternatifleri JS'e ver (beyin STT belirsizliğini çözer).
            JSArray arr = new JSArray();
            if (alts != null && !alts.isEmpty()) { for (String a : alts) arr.put(a); }
            else if (text != null && !text.isEmpty()) { arr.put(text); }
            r.put("alternatives", arr);
            c.resolve(r);
        }
        stopVosk();
    }

    private void rejectVosk(String msg) {
        PluginCall c = savedSpeechCall;
        savedSpeechCall = null;
        // Capacitor imzası reject(MESAJ, kod) — eskiden ("NO_RESULT", msg) ters veriliyordu →
        // JS'e err.message="NO_RESULT" gidiyor, gerçek Vosk sebebi kod alanında kayboluyor →
        // yanıltıcı "internet gerekli" mesajı. Gerçek sebebi MESAJ olarak ver.
        if (c != null) c.reject(msg, "NO_RESULT");
        stopVosk();
    }

    private void stopVosk() {
        if (voskTimeoutHandler != null && voskTimeoutRunnable != null) {
            voskTimeoutHandler.removeCallbacks(voskTimeoutRunnable);
        }
        voskTimeoutRunnable = null;
        voskCapturing = false;                 // capture döngüsüne dur sinyali
        Thread th = voskCaptureThread;
        voskCaptureThread = null;
        // KRİTİK: resolveVosk/rejectVosk capture thread'inden stopVosk çağırır → kendini
        // join ETME (deadlock). Yalnızca DIŞARIDAN (farklı thread) durdurulursa join et.
        if (th != null && th != Thread.currentThread()) {
            th.interrupt();
            try { th.join(1500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
    }

    private String extractVoskText(String json) {
        if (json == null) return "";
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            if (o.has("text"))    return o.optString("text", "").trim();
            if (o.has("partial")) return o.optString("partial", "").trim();
            // n-best modu (setMaxAlternatives): {"alternatives":[{"text":..}]} — en iyi metin.
            if (o.has("alternatives")) {
                org.json.JSONArray a = o.optJSONArray("alternatives");
                if (a != null && a.length() > 0) return a.getJSONObject(0).optString("text", "").trim();
            }
        } catch (Exception ignored) {}
        return "";
    }

    /** n-best: Vosk final JSON'ından tüm alternatif metinleri (tekrarsız, sırayla). */
    private java.util.List<String> extractVoskAlternatives(String json) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (json == null) return out;
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            org.json.JSONArray a = o.optJSONArray("alternatives");
            if (a != null) {
                for (int i = 0; i < a.length(); i++) {
                    String t = a.getJSONObject(i).optString("text", "").trim();
                    if (!t.isEmpty() && !out.contains(t)) out.add(t);
                }
            } else {
                String t = o.optString("text", "").trim();
                if (!t.isEmpty()) out.add(t);
            }
        } catch (Exception ignored) {}
        return out;
    }

    /* ── Faz 5: Grammar-kısıtlı wake word thread ("Native Refleksler") ────────
     * Mevcut runVoskListening'e DOKUNULMAZ (mimari §6) — bu AYRI, kalıcı bir
     * pasif dinleme thread'idir:
     *   - Vosk TAM SÖZLÜKLE DEĞİL, yalnız wake sözleri + "[unk]" grammar'ıyla
     *     çalışır → arama uzayı küçülür (zayıf head unit CPU'sunda hız) ve
     *     liste dışı her söz "[unk]"a düşer (yanlış pozitif yapısal olarak az).
     *   - REFLEKS: her ~100ms ses penceresinde PARTIAL sonuç kontrol edilir —
     *     endpoint (konuşma sonu sessizliği) BEKLENMEZ; "mavi" dendiği anda
     *     'wakeWord' event'i JS'e düşer (<200ms selamlama hedefi).
     *   - NO DUCKING: requestAudioFocus ÇAĞRILMAZ, duckMusicForListening
     *     ÇAĞRILMAZ — müzik arka planda TAM kalitede çalmaya devam eder.
     *   - HALF-DUPLEX: aktif STT oturumu (voskCapturing/savedSpeechCall) veya
     *     TTS (nativeTtsSpeaking) sürerken mikrofon BIRAKILIR — asistan kendi
     *     sesini duymaz, AudioRecord çakışması olmaz. */

    private volatile boolean wakeWordActive  = false;
    private volatile Thread  wakeWordThread  = null;
    private volatile String  wakeGrammarJson = null;
    private volatile String[] wakePhrases    = new String[0];
    private volatile float   wakeWordGain    = VOSK_GAIN_DEFAULT;

    @PluginMethod
    public void startWakeWordListening(PluginCall call) {
        JSArray arr = call.getArray("phrases");
        java.util.List<String> phrases = new java.util.ArrayList<>();
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                try {
                    String p = String.valueOf(arr.get(i)).trim().toLowerCase(java.util.Locale.ROOT);
                    if (!p.isEmpty() && !"null".equals(p)) phrases.add(p);
                } catch (Exception ignored) {}
            }
        }
        if (phrases.isEmpty()) { call.reject("phrases boş", "BAD_ARGS"); return; }
        wakePhrases = phrases.toArray(new String[0]);
        // Grammar JSON örn: ["mavi","hey mavi","[unk]"] — "[unk]" ŞART: liste
        // dışı konuşma tek [unk] tokenına düşer, "maviş" gibi yakın kelimeler
        // wake sözüne zorlanmaz.
        org.json.JSONArray g = new org.json.JSONArray();
        for (String p : phrases) g.put(p);
        g.put("[unk]");
        wakeGrammarJson = g.toString();
        Double gainOpt = call.getDouble("gain");
        float reqGain = gainOpt != null ? gainOpt.floatValue() : VOSK_GAIN_DEFAULT;
        wakeWordGain = Math.max(VOSK_GAIN_MIN, Math.min(VOSK_GAIN_MAX, reqGain));

        ensureVoskModel(
            () -> {
                stopWakeWordThread();        // olası eski thread → tek instance garantisi
                wakeWordActive = true;
                runVoskGrammar();
                call.resolve();
            },
            (reason) -> call.reject("Vosk model yüklenemedi — " + reason, "MODEL_LOAD"));
    }

    @PluginMethod
    public void stopWakeWordListening(PluginCall call) {
        stopWakeWordThread();
        call.resolve();
    }

    private void stopWakeWordThread() {
        wakeWordActive = false;
        Thread t = wakeWordThread;
        wakeWordThread = null;
        if (t != null && t != Thread.currentThread()) {
            t.interrupt();
            try { t.join(1500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
    }

    /** Wake grammar thread'inin mikrofonu bırakması gereken anlar (half-duplex). */
    private boolean wakeMicMustYield() {
        // TTS yield emniyeti: onDone hiç gelmezse bayrak 30 sn sonra yok sayılır —
        // wake word kalıcı sağırlaşmaz (gerçek konuşmalar 30 sn'den kısadır).
        boolean ttsYield = nativeTtsSpeaking
            && (android.os.SystemClock.elapsedRealtime() - nativeTtsSpeakingSinceMs) < TTS_YIELD_MAX_MS;
        return voskCapturing || ttsYield || savedSpeechCall != null;
    }

    private boolean matchesWakePhrase(String text) {
        if (text == null || text.isEmpty()) return false;
        for (String p : wakePhrases) {
            if (!p.isEmpty() && text.contains(p)) return true; // "[unk] mavi" de yakalanır
        }
        return false;
    }

    private void runVoskGrammar() {
        Thread t = new Thread(() -> {
            // PERF 2026-06-12: kalıcı pasif decode UI ile aynı öncelikte YARIŞMAZ.
            // SAHA REVİZE (aynı gün): BACKGROUND(10) bazı Android'lerde thread'i
            // bg cpuset'e taşır — harita render ederken decode AÇLIĞA düşüp wake
            // word tamamen sağırlaşabiliyordu. nice +2: foreground grupta kalır,
            // UI yine öncelikli ama decode asla tam aç bırakılmaz.
            try {
                android.os.Process.setThreadPriority(2);
            } catch (Throwable ignored) {}
            while (wakeWordActive && !Thread.currentThread().isInterrupted()) {
                // HALF-DUPLEX bekleme: aktif STT/TTS bitene dek mikrofon kapalı.
                if (wakeMicMustYield()) {
                    try { Thread.sleep(250); } catch (InterruptedException e) { return; }
                    continue;
                }
                AudioRecord recorder   = null;
                Recognizer  recognizer = null;
                boolean triggered = false;
                try {
                    int minBuf = AudioRecord.getMinBufferSize(VOSK_SAMPLE_RATE,
                            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    if (minBuf <= 0) minBuf = VOSK_SAMPLE_RATE;
                    // Küçük okuma penceresi (~100ms): refleks hedefi <200ms —
                    // her pencerede partial kontrolü yapılır.
                    int frameSamples = Math.max(minBuf / 2, VOSK_SAMPLE_RATE / 10);

                    recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                            VOSK_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, frameSamples * 4);
                    if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                        try { recorder.release(); } catch (Exception ignored) {}
                        recorder = new AudioRecord(MediaRecorder.AudioSource.MIC,
                                VOSK_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                                AudioFormat.ENCODING_PCM_16BIT, frameSamples * 4);
                    }
                    if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                        throw new IllegalStateException("AudioRecord init başarısız");
                    }

                    // NO DUCKING (Faz 5, bilinçli): requestAudioFocus YOK,
                    // duckMusicForListening YOK — pasif dinleme müziğe görünmezdir.

                    try {
                        // Grammar modu: yalnız wake sözleri + [unk]
                        recognizer = new Recognizer(voskModel, (float) VOSK_SAMPLE_RATE, wakeGrammarJson);
                    } catch (Throwable grammarErr) {
                        // Fail-soft: grammar desteklenmiyorsa tam sözlük (eşleşme yine contains)
                        recognizer = new Recognizer(voskModel, (float) VOSK_SAMPLE_RATE);
                    }
                    recorder.startRecording();

                    final float gain = wakeWordGain;
                    short[] buf = new short[frameSamples];
                    // ── VAD (ses-aktivite kapısı) — idle CPU tasarrufu ───────────────
                    // PERF 2026-06-17: eskiden acceptWaveForm HER frame çağrılıyordu →
                    // Vosk akustik modeli sessizlikte bile (idle'ın ~%99'u) sürekli decode
                    // edip ~%39 CPU yakıyordu (cihaz profili). Artık ucuz RMS kapısı:
                    // sessizlikte decode ATLANIR. Kelimeyi kaçırmamak için:
                    //   - pre-roll: konuşmadan ÖNCEKİ son frame de beslenir (kelime başı kırpılmaz)
                    //   - hangover: eşik altına düşse de ~1.2sn decode sürer (kelime kuyruğu)
                    // Eşik DÜŞÜK tutuldu (fail-safe: kaçırmaktansa biraz fazla decode).
                    final double VAD_RMS_ON  = 0.012; // gain sonrası normalize RMS konuşma eşiği
                    final int    VAD_HANGOVER = 12;   // ~1.2sn (100ms/frame)
                    final short[] preRoll = new short[frameSamples]; // allocation-free pre-roll
                    int  preRollLen   = 0;
                    boolean preRollValid = false;
                    int  hangover     = 0;
                    while (wakeWordActive && !wakeMicMustYield()
                            && !Thread.currentThread().isInterrupted()) {
                        int n = recorder.read(buf, 0, buf.length);
                        if (n <= 0) continue;
                        // Adaptif kazanç — runVoskListening ile aynı clipping koruması.
                        // Aynı geçişte RMS de hesaplanır (VAD için, ekstra döngü yok).
                        int peak = 0;
                        for (int i = 0; i < n; i++) {
                            int a = buf[i] >= 0 ? buf[i] : -buf[i];
                            if (a > peak) peak = a;
                        }
                        float gApplied = gain;
                        if (peak > 0 && peak * gApplied > VOSK_CLIP_HEADROOM) {
                            gApplied = Math.max(1.0f, VOSK_CLIP_HEADROOM / peak);
                        }
                        double sumSq = 0;
                        for (int i = 0; i < n; i++) {
                            int v = Math.round(buf[i] * gApplied);
                            if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
                            buf[i] = (short) v;
                            sumSq += (double) v * v;
                        }
                        double rms = Math.sqrt(sumSq / n) / 32768.0;

                        // VAD kapısı: konuşma varsa hangover'ı yenile.
                        if (rms >= VAD_RMS_ON) hangover = VAD_HANGOVER;
                        if (hangover <= 0) {
                            // Sessizlik → Vosk decode ATLANIR (CPU tasarrufu).
                            // Bu frame'i pre-roll olarak sakla (konuşma başlarsa beslenir).
                            System.arraycopy(buf, 0, preRoll, 0, n);
                            preRollLen   = n;
                            preRollValid = true;
                            continue;
                        }
                        hangover--;
                        // Konuşma başı: önce pre-roll frame'ini besle (kelime başı kırpılmaz).
                        if (preRollValid) {
                            recognizer.acceptWaveForm(preRoll, preRollLen);
                            preRollValid = false;
                        }

                        // REFLEKS: endpoint beklenmez — partial her pencerede kontrol edilir
                        String heard = recognizer.acceptWaveForm(buf, n)
                            ? extractVoskText(recognizer.getResult())
                            : extractVoskText(recognizer.getPartialResult());
                        if (matchesWakePhrase(heard)) {
                            triggered = true;
                            JSObject ev = new JSObject();
                            ev.put("transcript", heard);
                            notifyListeners("wakeWord", ev);
                            break;
                        }
                    }
                } catch (Throwable th) {
                    // Donanım/izin hatası: sıkı döngüye girmeden bekle, yeniden dene
                    try { Thread.sleep(3000); } catch (InterruptedException e) { return; }
                } finally {
                    if (recorder != null) {
                        try { recorder.stop(); } catch (Exception ignored) {}
                        try { recorder.release(); } catch (Exception ignored) {}
                    }
                    if (recognizer != null) { try { recognizer.close(); } catch (Exception ignored) {} }
                }
                if (triggered) {
                    // JS şimdi selamlama TTS'i + aktif dinlemeyi başlatır — mikrofonu
                    // hemen geri kapmadan kısa bekle; sonrasını half-duplex devralır.
                    try { Thread.sleep(600); } catch (InterruptedException e) { return; }
                }
            }
        }, "vosk-wake-grammar");
        wakeWordThread = t;
        t.start();
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

        // Classic BT discovery, eşli OLMAYAN cihazları (yeni OBD adaptörü) ancak
        // konum izni verildiğinde ACTION_FOUND ile bildirir. neverForLocation
        // flag'i kaldırıldığı için BLUETOOTH_SCAN artık FINE_LOCATION gerektirir.
        if (ContextCompat.checkSelfPermission(getContext(),
                android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(android.Manifest.permission.ACCESS_FINE_LOCATION);
        }

        // Sesli asistan (Vosk offline STT) mikrofon kaydı yapar. İzin verilmezse
        // Vosk AudioRecord açamaz → ses tanıma başarısız hatası döner.
        if (ContextCompat.checkSelfPermission(getContext(),
                android.Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(android.Manifest.permission.RECORD_AUDIO);
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

    /**
     * WiFi ayar panelini açar. Android 10+ (API 29) uygulamaların WiFi'ı programatik
     * açmasını engellediği için (setWifiEnabled kaldırıldı), satışa-uygun tek yol
     * sistem panelini açmaktır. API 29+ slide-up panel (uygulamadan çıkmaz), eski
     * sürümlerde klasik WiFi ayar ekranı. Her durumda fail-soft resolve eder.
     */
    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        JSObject r = new JSObject();
        Intent intent;
        if (Build.VERSION.SDK_INT >= 29) {
            intent = new Intent(Settings.Panel.ACTION_WIFI);
        } else {
            intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            r.put("opened", true);
        } catch (Exception e) {
            // Panel açılamadı → klasik WiFi ayar ekranına düş (fail-soft)
            try {
                Intent fb = new Intent(Settings.ACTION_WIFI_SETTINGS);
                fb.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fb);
                r.put("opened", true);
            } catch (Exception e2) {
                r.put("opened", false);
            }
        }
        call.resolve(r);
    }

    /**
     * Bluetooth ayar ekranını açar. BluetoothAdapter.enable() API 33+'ta kaldırıldığı
     * için doğrudan açma güvenilir değil; klasik Bluetooth ayar ekranı her sürümde
     * çalışır. Fail-soft resolve eder.
     */
    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        JSObject r = new JSObject();
        r.put("opened", openBtPanelInternal());
        call.resolve(r);
    }

    private boolean openWifiPanelInternal() {
        Intent intent = (Build.VERSION.SDK_INT >= 29)
            ? new Intent(Settings.Panel.ACTION_WIFI)
            : new Intent(Settings.ACTION_WIFI_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(intent); return true; }
        catch (Exception e) {
            try {
                Intent fb = new Intent(Settings.ACTION_WIFI_SETTINGS);
                fb.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fb);
                return true;
            } catch (Exception e2) { return false; }
        }
    }

    private boolean openBtPanelInternal() {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(intent); return true; }
        catch (Exception e) { return false; }
    }

    /**
     * WiFi'yi DOĞRUDAN aç/kapat. Eski Android (<API 29) ve sistem-app head unit'lerde
     * WifiManager.setWifiEnabled çalışır → ekran açılmadan uygulanır. Modern telefonda
     * (API 29+ non-system) OS engeller → setWifiEnabled false döner → panele düşülür.
     * Çağrı: { enabled:boolean } veya { toggle:true }. Sonuç: { applied, opened }.
     */
    @PluginMethod
    public void setWifi(PluginCall call) {
        JSObject r = new JSObject();
        WifiManager wm = (WifiManager) getContext().getApplicationContext()
            .getSystemService(Context.WIFI_SERVICE);
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        if (wm != null && Boolean.TRUE.equals(call.getBoolean("toggle", false))) {
            enabled = !wm.isWifiEnabled();
        }
        boolean applied = false;
        if (wm != null) {
            try { applied = wm.setWifiEnabled(enabled); } catch (Exception e) { applied = false; }
        }
        boolean opened = false;
        if (!applied) opened = openWifiPanelInternal(); // doğrudan yok → panel (fail-soft)
        r.put("applied", applied);
        r.put("opened", opened);
        call.resolve(r);
    }

    /**
     * Bluetooth'u DOĞRUDAN aç/kapat. Eski Android (<API 33) / sistem-app head unit'lerde
     * BluetoothAdapter.enable()/disable() çalışır → ekran açılmadan uygulanır. API 33+'ta
     * kaldırıldı → false/SecurityException → panele düşülür. { enabled } | { toggle:true }.
     */
    @PluginMethod
    public void setBluetooth(PluginCall call) {
        JSObject r = new JSObject();
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        boolean applied = false;
        if (bt != null) {
            if (Boolean.TRUE.equals(call.getBoolean("toggle", false))) enabled = !bt.isEnabled();
            try {
                applied = enabled ? bt.enable() : bt.disable();
            } catch (Exception e) { applied = false; }
        }
        boolean opened = false;
        if (!applied) opened = openBtPanelInternal(); // doğrudan yok → panel (fail-soft)
        r.put("applied", applied);
        r.put("opened", opened);
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

    // ── Teşhis HTTP Server (adb'siz PC erişimi) ───────────────────────────────
    // Uygulama cihazda sabit bir port dinler; PC aynı WiFi'dan http://<ip>:8899/ ile
    // ham OBD trafiğini JSON çeker. adb/logcat olmayan head unit'lerde (T507 Dacia)
    // teşhis verisini PC'ye taşımanın yolu — ekran görüntüsü döngüsünü bitirir.

    private volatile ServerSocket diagSocket = null;
    private static final int DIAG_PORT = 8899;

    @PluginMethod
    public void startDiagServer(PluginCall call) {
        stopDiagServerInternal();
        try {
            diagSocket = new ServerSocket(DIAG_PORT);
            Thread srv = new Thread(this::runDiagServer, "DiagHTTP");
            srv.setDaemon(true);
            srv.start();
            JSObject r = new JSObject();
            r.put("ip", getLocalIPv4());
            r.put("port", DIAG_PORT);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("DIAG_SERVER_ERROR", e.getMessage());
        }
    }

    @PluginMethod
    public void stopDiagServer(PluginCall call) {
        stopDiagServerInternal();
        call.resolve();
    }

    private void stopDiagServerInternal() {
        ServerSocket s = diagSocket;
        diagSocket = null;
        if (s != null) { try { s.close(); } catch (IOException ignored) {} }
    }

    private void runDiagServer() {
        ServerSocket srv = diagSocket;
        while (srv != null && !srv.isClosed()) {
            try {
                Socket client = srv.accept();
                client.setSoTimeout(8000);
                new Thread(() -> handleDiagClient(client), "DiagReq").start();
            } catch (IOException ignored) {}
        }
    }

    private void handleDiagClient(Socket client) {
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
            OutputStream out = client.getOutputStream()
        ) {
            String requestLine = reader.readLine();
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ", 3);
            if (parts.length < 2) return;
            String fullPath = parts[1];
            // Kalan header'ları tüket
            String hdr;
            while ((hdr = reader.readLine()) != null && !hdr.isEmpty()) {}

            int qi = fullPath.indexOf('?');
            String path = (qi >= 0) ? fullPath.substring(0, qi) : fullPath;

            // CORS + JSON — tarayıcıdan da açılabilir
            if ("/clear".equals(path)) {
                OBDManager.clearTraffic();
                sendHttpResponse(out, 200, "application/json; charset=utf-8", "{\"cleared\":true}");
                return;
            }
            // Root testi: su var mı? (adb açmadan önce kontrol)
            if ("/root-check".equals(path)) {
                String r = runRootShell("id");
                sendHttpResponse(out, 200, "application/json; charset=utf-8",
                    "{\"hasRoot\":" + (r.contains("uid=0") ? "true" : "false")
                    + ",\"out\":\"" + jsonEscP(r) + "\"}");
                return;
            }
            // Ağ ADB'sini aç (root gerektirir): adbd'yi 5555'te dinlet → PC 'adb connect'
            // ile TAM kontrol alır. Root yoksa 'su' bulunamaz → hata döner.
            if ("/enable-adb".equals(path)) {
                String r = runRootShell("setprop service.adb.tcp.port 5555; stop adbd; start adbd; echo DONE");
                boolean ok = r.contains("DONE");
                sendHttpResponse(out, 200, "application/json; charset=utf-8",
                    "{\"enabled\":" + ok + ",\"port\":5555,\"out\":\"" + jsonEscP(r) + "\"}");
                return;
            }
            // Varsayılan (/ veya /obd): ham OBD trafik dökümü
            String json = "{\"port\":" + DIAG_PORT
                + ",\"traffic\":" + OBDManager.dumpTrafficJson() + "}";
            sendHttpResponse(out, 200, "application/json; charset=utf-8", json);
        } catch (IOException ignored) {}
    }

    /**
     * Root kabuğunda komut çalıştırır (su -c). stdout+stderr birleşik döner. Root yoksa
     * "su" bulunamaz → exception mesajı döner (çağıran hasRoot=false yorumlar).
     */
    private static String runRootShell(String cmd) {
        StringBuilder sb = new StringBuilder();
        try {
            Process p = Runtime.getRuntime().exec(new String[] { "su", "-c", cmd });
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line).append('\n');
            }
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(p.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append("ERR:").append(line).append('\n');
            }
            p.waitFor();
        } catch (Exception e) {
            sb.append("EXC:").append(e.getMessage());
        }
        return sb.toString().trim();
    }

    /** Minimal JSON string kaçışı (plugin-yerel; OBDManager.jsonEsc'in eşi). */
    private static String jsonEscP(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
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

    // ── OBD Bluetooth Auto-Pair ───────────────────────────────────────────────

    private OBDBluetoothManager _obdBtManager;

    private OBDBluetoothManager.Listener _obdBtListener = (state, deviceName, mac, info) -> {
        JSObject evt = new JSObject();
        evt.put("state",      state.name());
        evt.put("deviceName", deviceName != null ? deviceName : JSObject.NULL);
        evt.put("mac",        mac        != null ? mac        : JSObject.NULL);
        evt.put("info",       info       != null ? info       : JSObject.NULL);
        notifyListeners("obdBtState", evt);
    };

    @PluginMethod
    public void startOBDBluetooth(PluginCall call) {
        boolean userConfirmed = Boolean.TRUE.equals(call.getBoolean("userConfirmed", false));
        if (_obdBtManager == null) _obdBtManager = new OBDBluetoothManager(getContext());
        _obdBtManager.start(_obdBtListener, userConfirmed);
        call.resolve();
    }

    @PluginMethod
    public void stopOBDBluetooth(PluginCall call) {
        if (_obdBtManager != null) _obdBtManager.stop();
        call.resolve();
    }

    /** Kullanıcı FALLBACK ekranında "Bağlan" butonuna bastı. */
    @PluginMethod
    public void userConnectOBD(PluginCall call) {
        if (_obdBtManager != null) _obdBtManager.userRequestConnect();
        call.resolve();
    }

    @PluginMethod
    public void getSavedOBDDevice(PluginCall call) {
        if (_obdBtManager == null) _obdBtManager = new OBDBluetoothManager(getContext());
        String mac  = _obdBtManager.getSavedMac();
        String name = _obdBtManager.getSavedName();
        JSObject res = new JSObject();
        if (mac != null) {
            res.put("mac",  mac);
            res.put("name", name != null ? name : "OBD Adapter");
        }
        call.resolve(res);
    }

    @PluginMethod
    public void clearSavedOBD(PluginCall call) {
        if (_obdBtManager == null) _obdBtManager = new OBDBluetoothManager(getContext());
        _obdBtManager.clearSavedDevice();
        call.resolve();
    }

    // ── CAN Bus ───────────────────────────────────────────────────────────────

    private final CanBusManager     canBusManager     = new CanBusManager();
    private final CanFrameDecoder   canFrameDecoder   = new CanFrameDecoder();
    private final VehicleSignalMapper canSignalMapper = new VehicleSignalMapper();
    private final ReverseSignalGuard reverseGuard     = new ReverseSignalGuard();
    private       NativeToJsBridge  canJsBridge;
    private volatile boolean _canSnifferActive = false;

    // ── K24 CAN-flood perf düzeltmesi: coalescing throttle + dedup (native, tek nokta) ──
    // emitVehicleData() üç kaynaktan (ham CAN frame listener, K24CanBridge, NwdCanClient,
    // NwdSettingsReader) çağrılabilir — farklı thread'lerden (CAN read thread, binder
    // callback, ContentObserver callback) eş zamanlı çağrı mümkün olduğu için TÜM paylaşılan
    // throttle state'i _emitLock ile korunur. JS'e gerçek emit ise kilit DIŞINDA yapılır
    // (notifyListeners'ı kilit altında tutup olası yeniden-giriş/gecikme riskini önlemek için).
    private static final long CAN_EMIT_MIN_INTERVAL_MS = 80L; // ~12.5Hz (CLAUDE.md 10-20Hz bandı)
    private final Object     _emitLock            = new Object();
    private final Handler    _emitHandler         = new Handler(Looper.getMainLooper());
    private final Runnable   _flushEmitRunnable   = this::flushPendingEmit;
    private VehicleCanData    _pendingEmitData     = null;  // throttle penceresinde biriken SON değer (trailing-edge)
    private VehicleCanData    _lastEmittedData     = null;  // JS'e gerçekten gönderilen son veri (dedup referansı)
    private long              _lastEmitAtMs        = 0L;    // SystemClock.elapsedRealtime bazlı
    private boolean           _emitScheduled       = false; // trailing-edge zamanlayıcısı kurulu mu

    // K24/Hiworld head unit'leri root GEREKTİRMEDEN okur (ContentProvider +
    // ServiceManager binder'ları üzerinden). Ham seri (canBusManager) root'suz
    // /dev/ttyS*'e erişemediği için bu cihazlarda tek çalışan CAN yolu budur.
    private final K24CanBridge      k24CanBridge      = new K24CanBridge();

    /** K24 köprüsünün decoded verisini ham CAN ile aynı emit yoluna sokar. */
    private final K24CanBridge.DecodedListener _k24DataListener = this::emitVehicleData;

    /** K24 köprüsünün tanı satırlarını CanDiagPanel'in dinlediği canDiag kanalına aktarır. */
    private final K24CanBridge.DiagListener _k24DiagListener = (msg) -> {
        JSObject o = new JSObject();
        o.put("msg", msg);
        notifyListeners("canDiag", o);
    };

    // NWD RESMÎ üçüncü-taraf CAN SDK istemcisi (com.nwd.can.service.CanService → CarInfo).
    // Bu ROM'da GERÇEK veri yolu budur (kör K24CanBridge bu ROM'da veri üretmez).
    private final com.cockpitos.pro.can.NwdCanClient nwdCanClient =
        new com.cockpitos.pro.can.NwdCanClient();
    // NWD gövde sinyalleri — OEM 'system' ayar tablosu (kapı/elfreni/gerivites; root yok).
    private final com.cockpitos.pro.can.NwdSettingsReader nwdSettingsReader =
        new com.cockpitos.pro.can.NwdSettingsReader();
    private final com.cockpitos.pro.can.NwdCanClient.DecodedListener _nwdDataListener =
        this::emitVehicleData;
    private final com.cockpitos.pro.can.NwdCanClient.DiagListener _nwdDiagListener = (msg) -> {
        JSObject o = new JSObject();
        o.put("msg", msg);
        notifyListeners("canDiag", o);
    };

    // MCU broadcast keşfi — non-exported provider'a erişemeyen sandboxed app için
    // tek meşru kanal: NWD/Hiworld'ün yayınladığı CAN broadcast'lerini dinler.
    // Veri ÜRETMEZ; hangi kanalın yayın yaptığını tanı günlüğüne yazar.
    private McuEventSniffer mcuEventSniffer = null;

    private void startMcuSnifferOnce() {
        if (mcuEventSniffer == null) {
            mcuEventSniffer = new McuEventSniffer(getContext(), (line) -> {
                JSObject o = new JSObject();
                o.put("msg", line);
                notifyListeners("canDiag", o);
            });
        }
        mcuEventSniffer.start(); // idempotent (_running guard)
    }
    private static final String PREFS_CAN_IDS  = "can_ids";

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

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        float  rate = call.getFloat("rate", 1.0f);
        // P1-1: pitch (setPitch). Her çağrıda set edilir → segmentli çağrıdan kalan
        // perde sonraki tek çağrıya SIZMASIN (engine setPitch küreseldir).
        float  pitch = call.getFloat("pitch", 1.0f);
        if (text == null || text.trim().isEmpty()) { call.resolve(); return; }
        if (!ttsReady || ttsEngine == null) { call.reject("TTS_NOT_READY"); return; }
        ttsEngine.setSpeechRate(rate);
        ttsEngine.setPitch(pitch);
        // Promise seslendirme BİTİNCE çözülür (UtteranceProgressListener) — JS tarafı
        // ducking restore + takip dinlemesini doğru ana bağlar. speak() kuyruğa
        // alınamazsa anında çöz (asılı Promise bırakma).
        String utteranceId = "cockpitos_tts_" + ttsUtteranceSeq.incrementAndGet();
        ttsPendingCalls.put(utteranceId, call);
        nativeTtsSpeaking = true; // half-duplex: wake grammar thread mikrofonu bırakır
        nativeTtsSpeakingSinceMs = android.os.SystemClock.elapsedRealtime(); // yield emniyet saati
        int queued = ttsEngine.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        if (queued != android.speech.tts.TextToSpeech.SUCCESS) {
            settleTtsCall(utteranceId);
        }
    }

    /**
     * Segmentli seslendirme (P0-2 + P1-1).
     *
     * JS speechSegment katmanı metni cümleciklere böler; her segmentin kendi
     * rate/pitch'i ve sonrasına eklenecek sessizliği (pauseMs) vardır. Burada:
     *   - i==0 → QUEUE_FLUSH (öncekini kes), i>0 → QUEUE_ADD (sıraya ekle),
     *   - her segment ÖNCESİ setSpeechRate/setPitch (engine param'ı o utterance'a
     *     enqueue anında bağlanır → segment-başı prozodi),
     *   - aralara playSilentUtterance(pauseMs) ile doğal duraklama,
     *   - bekleyen Capacitor çağrısı YALNIZ son gerçek segmentin utteranceId'sine
     *     bağlanır → "konuşma bitti" yalnız sonda tetiklenir (ducking/takip zinciri korunur).
     */
    @PluginMethod
    public void speakSegments(PluginCall call) {
        if (!ttsReady || ttsEngine == null) { call.reject("TTS_NOT_READY"); return; }
        JSArray segments = call.getArray("segments");
        if (segments == null || segments.length() == 0) { call.resolve(); return; }

        nativeTtsSpeaking = true; // half-duplex: tüm segment dizisi boyunca mikrofon bırakılır
        nativeTtsSpeakingSinceMs = android.os.SystemClock.elapsedRealtime();

        String lastId = null;
        int lastQueued = android.speech.tts.TextToSpeech.SUCCESS;
        try {
            int n = segments.length();
            boolean first = true;
            for (int i = 0; i < n; i++) {
                org.json.JSONObject o = segments.getJSONObject(i);
                String t = o.optString("text", "");
                if (t == null || t.trim().isEmpty()) continue;
                float rate  = (float) o.optDouble("rate", 1.0);
                float pitch = (float) o.optDouble("pitch", 1.0);
                int   pause = o.optInt("pauseMs", 0);

                ttsEngine.setSpeechRate(rate);
                ttsEngine.setPitch(pitch);
                int mode = first ? android.speech.tts.TextToSpeech.QUEUE_FLUSH
                                 : android.speech.tts.TextToSpeech.QUEUE_ADD;
                first = false;
                String id = "cockpitos_tts_" + ttsUtteranceSeq.incrementAndGet();
                lastQueued = ttsEngine.speak(t, mode, null, id);
                lastId = id;

                // Segmentler arası sessizlik (son segmentten sonra eklenmez).
                if (pause > 0 && i < n - 1) {
                    String sid = "cockpitos_sil_" + ttsUtteranceSeq.incrementAndGet();
                    ttsEngine.playSilentUtterance(pause, android.speech.tts.TextToSpeech.QUEUE_ADD, sid);
                }
            }
        } catch (org.json.JSONException e) {
            // Bozuk segment verisi — asılı kalma, hemen çöz.
            nativeTtsSpeaking = false;
            call.resolve();
            return;
        }

        if (lastId == null) {
            // Hiç geçerli segment yok → çöz.
            nativeTtsSpeaking = false;
            call.resolve();
            return;
        }
        if (lastQueued != android.speech.tts.TextToSpeech.SUCCESS) {
            // Son segment kuyruğa alınamadı → onDone gelmeyebilir, hemen çöz.
            nativeTtsSpeaking = false;
            call.resolve();
            return;
        }
        // Promise yalnız SON gerçek segmentin bitişinde çözülür.
        ttsPendingCalls.put(lastId, call);
    }

    @PluginMethod
    public void ttsStop(PluginCall call) {
        if (ttsEngine != null && ttsReady) ttsEngine.stop();
        settleAllTtsCalls(); // bekleyen speak() Promise'leri asılı kalmasın
        call.resolve();
    }

    /** CAN bağlantı durumunu JS'e gönderir. */
    private void emitCanStatus() {
        if (canJsBridge == null) return;
        CanBusManager.ConnectionMode mode = canBusManager.getConnectionMode();
        JSObject status = new JSObject();
        status.put("connected", mode != CanBusManager.ConnectionMode.NONE);
        status.put("mode",      mode.name().toLowerCase());
        status.put("port",      canBusManager.openPortPath() != null
                                ? canBusManager.openPortPath() : "none");
        notifyListeners("canStatus", status);
    }

    private final CanBusManager.FrameListener _canFrameListener = (frame) -> {
        java.util.List<CanFrameDecoder.CanSignal> signals = canFrameDecoder.decode(frame);

        // Sniffer aktifse ham frame'i JS'e gönder (teşhis/yapılandırma için)
        if (_canSnifferActive && !signals.isEmpty()) {
            CanFrameDecoder.CanSignal s = signals.get(0);
            JSObject raw = new JSObject();
            raw.put("id",  s.canId);
            raw.put("hex", String.format("0x%03X", s.canId));
            StringBuilder sb = new StringBuilder();
            for (byte b : s.data) sb.append(String.format("%02X ", b));
            raw.put("data", sb.toString().trim());
            notifyListeners("canRawFrame", raw);
        }

        emitVehicleData(canSignalMapper.process(signals));
    };

    /**
     * reverseGuard filtreleme + JS emit. Hem ham CAN (_canFrameListener), K24/Hiworld
     * köprüsü (_k24DataListener), NWD CarInfo (_nwdDataListener) hem de NWD 'system'
     * ayar okuyucusu (nwdSettingsReader) bu TEK yolu kullanır — bu yüzden JS köprü
     * throttle/dedup'ı da burada, tek noktada uygulanır (K24 CAN-flood perf düzeltmesi).
     */
    private void emitVehicleData(VehicleCanData data) {
        if (data == null) return;

        if (data.speed != null) reverseGuard.updateSpeed(data.speed);

        VehicleCanData filtered = data;
        if (Boolean.TRUE.equals(data.reverse) && !reverseGuard.isValid(true)) {
            filtered = new VehicleCanData.Builder()
                .speed(data.speed != null ? data.speed : 0f)
                .reverse(false)
                .build();
        }

        scheduleOrEmitToJs(filtered);

        // ── Native-Core side-stream (Phase N4) ──────────────────────────────
        // Ham CAN değerlerini native katmana KOPYALA. JS akışını (canJsBridge.emit)
        // etkilemez — throttle'a TABİ DEĞİL (native tüketiciler kendi örnekleme
        // hızını yönetir). Float→double lossless widening (.doubleValue()).
        if (VehicleNativeBridge.INSTANCE.isAvailable()) {
            long ts = System.nanoTime();
            if (data.speed != null)
                VehicleNativeBridge.INSTANCE.pushSignal(
                        VehicleNativeBridge.Signal.SPEED, data.speed.doubleValue(), ts);
            if (data.rpm != null)
                VehicleNativeBridge.INSTANCE.pushSignal(
                        VehicleNativeBridge.Signal.RPM, data.rpm.doubleValue(), ts);
            if (data.fuel != null)
                VehicleNativeBridge.INSTANCE.pushSignal(
                        VehicleNativeBridge.Signal.FUEL, data.fuel.doubleValue(), ts);
        }
    }

    /**
     * CAN→JS köprüsü için coalescing throttle + dedup (K24 CAN-flood perf düzeltmesi).
     *
     * - Pencere: {@link #CAN_EMIT_MIN_INTERVAL_MS} (80ms, ~12.5Hz — CLAUDE.md 10-20Hz bandı).
     * - Trailing-edge coalescing: pencere içinde gelen ardışık güncellemeler SON DEĞER olarak
     *   {@link #_pendingEmitData}'da üzerine yazılır; ara değerler JS'e HİÇ gitmez ama son
     *   durum asla kaybolmaz (sinyal/dörtlü flaşör gibi hızlı yanıp-sönen alanlar dahil).
     * - Leading-edge: pencere zaten boşsa (son emitten CAN_EMIT_MIN_INTERVAL_MS'den uzun süre
     *   geçmişse) yeni veri BEKLEMEDEN hemen gider — gecikme yalnız burst durumunda oluşur.
     * - Dedup: gidecek alan seti son gönderilenle birebir aynıysa emit atlanır (gereksiz JS
     *   köprü trafiği kesilir).
     * - Güvenlik istisnası: reverse (geri vites, geri görüş kamerası) veya parkingBrake
     *   (el/park freni — sürüşte devreye girmesi/çıkması anlık uyarı gerektirir) ÖNCEKİ
     *   emit edilen değerden farklıysa throttle'ı BEKLEMEDEN anında emit edilir.
     * - Thread-safety: bu metod CAN read thread'i, binder callback'i (NwdCanClient) ve
     *   ContentObserver callback'i (NwdSettingsReader) gibi farklı thread'lerden çağrılabilir;
     *   tüm paylaşılan state _emitLock ile korunur. JS'e gerçek emit kilit DIŞINDA yapılır.
     */
    private void scheduleOrEmitToJs(VehicleCanData filtered) {
        if (canJsBridge == null) return;

        VehicleCanData dataToEmitNow = null;
        boolean        scheduleFlush = false;
        long           delay         = 0L;

        synchronized (_emitLock) {
            if (isSafetyCriticalChange(filtered, _lastEmittedData)) {
                // Güvenlik-kritik alan değişti — bekleyen pencereyi iptal et (zaten en
                // güncel veriyi taşıyoruz) ve anında gönder.
                _emitHandler.removeCallbacks(_flushEmitRunnable);
                _emitScheduled   = false;
                _pendingEmitData = null;
                dataToEmitNow    = filtered;
                _lastEmittedData = filtered;
                _lastEmitAtMs    = SystemClock.elapsedRealtime();
            } else if (!sameEmittedData(filtered, _lastEmittedData)) {
                _pendingEmitData = filtered;
                long now     = SystemClock.elapsedRealtime();
                long elapsed = now - _lastEmitAtMs;
                if (elapsed >= CAN_EMIT_MIN_INTERVAL_MS) {
                    dataToEmitNow    = _pendingEmitData;
                    _pendingEmitData = null;
                    _lastEmittedData = dataToEmitNow;
                    _lastEmitAtMs    = now;
                } else if (!_emitScheduled) {
                    _emitScheduled = true;
                    scheduleFlush  = true;
                    delay          = CAN_EMIT_MIN_INTERVAL_MS - elapsed;
                }
                // else: zamanlayıcı zaten kurulu — _pendingEmitData güncellendi, aynı
                // runnable pencere sonunda en güncel değeri gönderecek.
            }
            // else: dedup — değer seti son emit edilenle aynı, hiçbir şey yapma.
        }

        if (dataToEmitNow != null) canJsBridge.emit(dataToEmitNow);
        if (scheduleFlush)         _emitHandler.postDelayed(_flushEmitRunnable, delay);
    }

    /** Trailing-edge zamanlayıcısı dolunca çağrılır (ana thread — Handler). */
    private void flushPendingEmit() {
        VehicleCanData dataToEmit;
        synchronized (_emitLock) {
            _emitScheduled = false;
            dataToEmit     = _pendingEmitData;
            _pendingEmitData = null;
            if (dataToEmit != null) {
                _lastEmittedData = dataToEmit;
                _lastEmitAtMs    = SystemClock.elapsedRealtime();
            }
        }
        if (dataToEmit != null && canJsBridge != null) canJsBridge.emit(dataToEmit);
    }

    /**
     * Güvenlik-kritik alan değişti mi? Yalnız kodda GERÇEKTEN var olan ve anlık geçmesi
     * gereken alanlar: reverse (geri görüş kamerası) ve parkingBrake (el freni sürüş
     * sırasında devreye girerse/çıkarsa anlık uyarı). lastEmitted null ise (ilk veri)
     * zaten leading-edge yoluyla hemen gönderilir — burada true dönmeye gerek yok.
     */
    private static boolean isSafetyCriticalChange(VehicleCanData incoming, VehicleCanData lastEmitted) {
        if (lastEmitted == null) return false;
        if (!Objects.equals(incoming.reverse, lastEmitted.reverse)) return true;
        if (!Objects.equals(incoming.parkingBrake, lastEmitted.parkingBrake)) return true;
        return false;
    }

    /** JS'e emit edilecek TÜM alan kümesinin birebir aynı olup olmadığını kontrol eder. */
    private static boolean sameEmittedData(VehicleCanData a, VehicleCanData b) {
        if (a == b) return true;
        if (a == null || b == null) return false;
        return Objects.equals(a.speed, b.speed)
            && Objects.equals(a.reverse, b.reverse)
            && Objects.equals(a.fuel, b.fuel)
            && Objects.equals(a.rpm, b.rpm)
            && Objects.equals(a.coolantTemp, b.coolantTemp)
            && Objects.equals(a.oilTemp, b.oilTemp)
            && Objects.equals(a.throttle, b.throttle)
            && Objects.equals(a.batteryVolt, b.batteryVolt)
            && Objects.equals(a.gearPos, b.gearPos)
            && Objects.equals(a.ambientTemp, b.ambientTemp)
            && Objects.equals(a.abs, b.abs)
            && Objects.equals(a.tractionControl, b.tractionControl)
            && Objects.equals(a.stabilityControl, b.stabilityControl)
            && Objects.equals(a.parkingBrake, b.parkingBrake)
            && Objects.equals(a.seatbelt, b.seatbelt)
            && Objects.equals(a.wipers, b.wipers)
            && Objects.equals(a.airCondition, b.airCondition)
            && Objects.equals(a.cruiseControl, b.cruiseControl)
            && Objects.equals(a.doorOpen, b.doorOpen)
            && Objects.equals(a.headlightsOn, b.headlightsOn)
            && Objects.equals(a.highBeam, b.highBeam)
            && Objects.equals(a.turnLeft, b.turnLeft)
            && Objects.equals(a.turnRight, b.turnRight)
            && Objects.equals(a.hazard, b.hazard)
            && Arrays.equals(a.tpms, b.tpms);
    }

    @PluginMethod
    public void startCanBus(PluginCall call) {
        if (canJsBridge == null) canJsBridge = new NativeToJsBridge(this::notifyListeners);
        canBusManager.start(_canFrameListener, getContext(), canSignalMapper::reset);
        // K24/Hiworld root'suz yol — ham seri başarısız olsa da bu çalışabilir.
        // start() içinde _started guard'ı var → tekrar çağrı güvenli (idempotent).
        k24CanBridge.start(_k24DataListener, _k24DiagListener, getContext());
        // NWD resmî CAN SDK — bu ROM'da gerçek CarInfo akışını sağlar.
        nwdCanClient.start(_nwdDataListener, _nwdDiagListener, getContext());
        // NWD gövde sinyalleri — OEM 'system' ayar tablosundan (kapı/elfreni/gerivites).
        // CarInfo akışı sporadik olduğundan bu kanal anlık+güvenilir (ContentObserver).
        nwdSettingsReader.start(_nwdDataListener, getContext());
        startMcuSnifferOnce();
        // 3s sonra bağlantı durumunu JS'e bildir (transport connect denemesi için süre)
        new Handler(Looper.getMainLooper()).postDelayed(this::emitCanStatus, 3_000);
        call.resolve();
    }

    @PluginMethod
    public void stopCanBus(PluginCall call) {
        canBusManager.stop();
        k24CanBridge.stop();
        nwdCanClient.stop();
        nwdSettingsReader.stop();
        if (mcuEventSniffer != null) {
            mcuEventSniffer.stop();
            // Ölü instance yeniden kullanılmasın → sonraki startMcuSnifferOnce taze
            // nesne yaratır. (A patch'i executor'u zaten kurtarıyor; bu ek güvenlik.)
            mcuEventSniffer = null;
        }
        // Throttle/dedup state'i sıfırla: JS tarafı stopCanBus'ta resetCanData() çağırır
        // (store'u boşaltır) — _lastEmittedData eski (dolu) kalırsa, restart sonrası AYNI
        // veri tekrar gelirse dedup onu JS'e hiç göndermez ve JS boş kalmaya devam eder.
        synchronized (_emitLock) {
            _emitHandler.removeCallbacks(_flushEmitRunnable);
            _emitScheduled    = false;
            _pendingEmitData  = null;
            _lastEmittedData  = null;
            _lastEmitAtMs     = 0L;
        }
        emitCanStatus();
        call.resolve();
    }

    // T-7: JS'e sürekli CAN veri akışı ──────────────────────────────────────

    /** JS tarafının CAN veri akışına abone olması için. */
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void startCanBusUpdates(PluginCall call) {
        call.setKeepAlive(true);

        if (canJsBridge == null) canJsBridge = new NativeToJsBridge(this::notifyListeners);

        canBusManager.start(_canFrameListener, getContext(), canSignalMapper::reset);

        JSObject info = new JSObject();
        info.put("port",    canBusManager.openPortPath() != null
                            ? canBusManager.openPortPath() : "none");
        info.put("mode",    canBusManager.getConnectionMode().name().toLowerCase());
        info.put("running", true);
        call.resolve(info);
    }

    /** CAN veri akışını durdurur. */
    @PluginMethod
    public void stopCanBusUpdates(PluginCall call) {
        canBusManager.stop();
        call.resolve();
    }

    /** Kaydedilmiş CAN ID yapılandırmasını VehicleSignalMapper'a uygular. */
    private void loadCanIds() {
        android.content.SharedPreferences p = getContext()
            .getSharedPreferences(PREFS_CAN_IDS, android.content.Context.MODE_PRIVATE);
        canSignalMapper.configure(
            p.getInt("speed",    0x0C9),
            p.getInt("gear",     0x0E8),
            p.getInt("fuel",     0x145),
            p.getInt("rpm",      0x316),
            p.getInt("coolant",  0x294),
            p.getInt("oilTemp",  0x280),
            p.getInt("throttle", 0x201),
            p.getInt("battVolt", 0x3A0),
            p.getInt("gearPos",  0x1D0),
            p.getInt("ambient",  0x350),
            p.getInt("doors",    0x3B0),
            p.getInt("lights",   0x1A0),
            p.getInt("tpms",     0x385),
            p.getInt("chassis",  0x0C0),
            p.getInt("body",     0x3D0)
        );
    }

    /** JS'ten araç CAN ID'lerini günceller ve kalıcı olarak saklar. */
    @PluginMethod
    public void setCanIds(PluginCall call) {
        android.content.SharedPreferences.Editor ed = getContext()
            .getSharedPreferences(PREFS_CAN_IDS, android.content.Context.MODE_PRIVATE).edit();
        String[] keys = { "speed","gear","fuel","rpm","coolant","oilTemp","throttle",
                          "battVolt","gearPos","ambient","doors","lights","tpms","chassis","body" };
        int[]  defs  = { 0x0C9, 0x0E8, 0x145, 0x316, 0x294, 0x280, 0x201,
                         0x3A0, 0x1D0, 0x350, 0x3B0, 0x1A0, 0x385, 0x0C0, 0x3D0 };
        for (int i = 0; i < keys.length; i++) {
            final String k = keys[i]; final int def = defs[i];
            try { if (call.getData().has(k)) ed.putInt(k, call.getInt(k, def)); }
            catch (Exception ignored) {}
        }
        ed.apply();
        loadCanIds();
        call.resolve();
    }

    /** Mevcut CAN ID yapılandırmasını döner. */
    @PluginMethod
    public void getCanIds(PluginCall call) {
        android.content.SharedPreferences p = getContext()
            .getSharedPreferences(PREFS_CAN_IDS, android.content.Context.MODE_PRIVATE);
        JSObject obj = new JSObject();
        obj.put("speed",    p.getInt("speed",    0x0C9));
        obj.put("gear",     p.getInt("gear",     0x0E8));
        obj.put("fuel",     p.getInt("fuel",     0x145));
        obj.put("rpm",      p.getInt("rpm",      0x316));
        obj.put("coolant",  p.getInt("coolant",  0x294));
        obj.put("oilTemp",  p.getInt("oilTemp",  0x280));
        obj.put("throttle", p.getInt("throttle", 0x201));
        obj.put("battVolt", p.getInt("battVolt", 0x3A0));
        obj.put("gearPos",  p.getInt("gearPos",  0x1D0));
        obj.put("ambient",  p.getInt("ambient",  0x350));
        obj.put("doors",    p.getInt("doors",    0x3B0));
        obj.put("lights",   p.getInt("lights",   0x1A0));
        obj.put("tpms",     p.getInt("tpms",     0x385));
        obj.put("chassis",  p.getInt("chassis",  0x0C0));
        obj.put("body",     p.getInt("body",     0x3D0));
        call.resolve(obj);
    }

    /** CAN sniffer'ı açar/kapatır — sniffer aktifken her frame `canRawFrame` olarak emit edilir. */
    @PluginMethod
    public void setCanSnifferEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        _canSnifferActive = enabled;
        if (enabled) {
            // Sniffer başlatılırken CAN bus çalışmıyorsa otomatik başlat
            if (canJsBridge == null) canJsBridge = new NativeToJsBridge(this::notifyListeners);
            canBusManager.start(_canFrameListener, getContext(), canSignalMapper::reset);
            // K24/Hiworld root'suz köprü — tanı çıktısı canDiag'a, decoded veri canData'ya akar.
            k24CanBridge.start(_k24DataListener, _k24DiagListener, getContext());
            nwdCanClient.start(_nwdDataListener, _nwdDiagListener, getContext());
            startMcuSnifferOnce();
        }
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

    // ── Expert Trust — Android Keystore HMAC-SHA256 (ham seed WebView'da tutulmaz) ──

    private static final String EXPERT_TRUST_HMAC_ALIAS = "CarExpertTrustHmacV1";

    private void ensureExpertTrustHmacKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(EXPERT_TRUST_HMAC_ALIAS)) return;

        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            EXPERT_TRUST_HMAC_ALIAS,
            KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build();
        KeyGenerator kg = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore");
        kg.init(spec);
        kg.generateKey();
    }

    private static String bytesToHexExpertTrust(byte[] buf) {
        StringBuilder sb = new StringBuilder(buf.length * 2);
        for (byte b : buf) {
            sb.append(String.format("%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static boolean timingSafeEqualsHexExpertTrust(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int diff = 0;
        for (int i = 0; i < a.length(); i++) {
            diff |= a.charAt(i) ^ b.charAt(i);
        }
        return diff == 0;
    }

    /**
     * Expert Trust mühürü — canonical UTF-8 gövde için HMAC-SHA256 imzası (hex).
     * Anahtar Android Keystore'da oluşturulur ve dışa çıkmaz.
     */
    @PluginMethod
    public void expertTrustHmacSign(PluginCall call) {
        String canonical = call.getString("canonical", "");
        if (canonical == null) {
            call.reject("canonical gerekli");
            return;
        }
        try {
            ensureExpertTrustHmacKey();
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            KeyStore.SecretKeyEntry entry =
                (KeyStore.SecretKeyEntry) ks.getEntry(EXPERT_TRUST_HMAC_ALIAS, null);
            if (entry == null) {
                call.reject("HMAC anahtarı yüklenemedi");
                return;
            }
            SecretKey key = entry.getSecretKey();
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            byte[] sig = mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8));
            JSObject res = new JSObject();
            res.put("sigHex", bytesToHexExpertTrust(sig));
            call.resolve(res);
        } catch (Exception e) {
            android.util.Log.e("CarLauncherPlugin", "expertTrustHmacSign: " + e.getMessage());
            call.reject("HMAC imza hatası: " + e.getMessage());
        }
    }

    /**
     * Expert Trust mühür doğrulama — aynı Keystore anahtarı ile HMAC yeniden hesaplanır.
     */
    @PluginMethod
    public void expertTrustHmacVerify(PluginCall call) {
        String canonical = call.getString("canonical", "");
        String sigHex    = call.getString("sigHex", "");
        JSObject out = new JSObject();
        if (canonical == null || sigHex == null || sigHex.isEmpty()) {
            out.put("valid", false);
            call.resolve(out);
            return;
        }
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (!ks.containsAlias(EXPERT_TRUST_HMAC_ALIAS)) {
                out.put("valid", false);
                call.resolve(out);
                return;
            }
            KeyStore.SecretKeyEntry entry =
                (KeyStore.SecretKeyEntry) ks.getEntry(EXPERT_TRUST_HMAC_ALIAS, null);
            if (entry == null) {
                out.put("valid", false);
                call.resolve(out);
                return;
            }
            SecretKey key = entry.getSecretKey();
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            byte[] expected = mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8));
            String expectedHex = bytesToHexExpertTrust(expected);
            out.put("valid", timingSafeEqualsHexExpertTrust(
                expectedHex.toLowerCase(java.util.Locale.ROOT),
                sigHex.toLowerCase(java.util.Locale.ROOT)));
            call.resolve(out);
        } catch (Exception e) {
            android.util.Log.e("CarLauncherPlugin", "expertTrustHmacVerify: " + e.getMessage());
            out.put("valid", false);
            call.resolve(out);
        }
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
     * JS → Native: Cross-channel nonce tüketimi (replay koruması fix).
     * JS komut yolu (commandCrypto.decryptE2EPayload) bu köprü ile native'in
     * AYNI nonce store'unu (native_e2e_nonces) atomik check-and-mark eder.
     * Native uyku yolu (NativeCryptoManager) zaten aynı store'u kullandığından,
     * bir nonce hangi kanaldan gelirse gelsin ikinci kez kabul edilmez.
     * Döner: { replay: true } → kullanılmış (REDDET); { replay: false } → taze.
     */
    @PluginMethod
    public void checkCommandNonce(PluginCall call) {
        String nonce = call.getString("nonce", "");
        try {
            boolean replay = NativeCryptoManager.checkAndMarkNonce(getContext(), nonce);
            JSObject result = new JSObject();
            result.put("replay", replay);
            call.resolve(result);
        } catch (Exception e) {
            android.util.Log.e("CarLauncherPlugin", "checkCommandNonce hatası: " + e.getMessage());
            call.reject("Nonce kontrol hatası: " + e.getMessage());
        }
    }

    /**
     * JS → Native: Uygulamanın GERÇEK kurulu sürümünü döner (OTA v1 / Commit 1).
     * Kaynak: PackageManager — build.gradle'ın version.properties'ten okuduğu
     * versionCode/versionName'in cihazdaki kurulu hali. Build-time env enjeksiyonundan
     * (VITE_APP_VERSION) farklı olarak APK ile web asset arasında drift yapamaz.
     * Döner: { versionCode: number, versionName: string, packageName: string }
     */
    @PluginMethod
    public void getAppVersionInfo(PluginCall call) {
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            long versionCode = android.os.Build.VERSION.SDK_INT >= 28
                ? info.getLongVersionCode()
                : info.versionCode; // minSdk 24 — API <28 fallback
            JSObject result = new JSObject();
            result.put("versionCode", versionCode);
            result.put("versionName", info.versionName != null ? info.versionName : "");
            result.put("packageName", getContext().getPackageName());
            call.resolve(result);
        } catch (Exception e) {
            android.util.Log.e("CarLauncherPlugin", "getAppVersionInfo hatası: " + e.getMessage());
            call.reject("Sürüm bilgisi okunamadı: " + e.getMessage());
        }
    }

    // ── OTA v1 / Commit 4: APK indirme + SHA-256 doğrulama ──────────────────

    /** OTA indirme tek-iş kuyruğu — UI thread'i bloklamaz, eşzamanlı indirme yok. */
    private static final ExecutorService OTA_EXECUTOR = Executors.newSingleThreadExecutor();

    /**
     * JS → Native: OTA APK'sını streaming indirir, SHA-256 + boyut doğrular,
     * files/ota/{fileName} olarak teslim eder (önce .tmp, doğrulama sonrası rename).
     * Kurulum BU METODDA YOK (Commit 5). Auth: çağıran anon-key header'larını
     * geçirir — servis-rol anahtarı cihazda ASLA. Detay: ota/OtaDownloadManager.java.
     * params: { url, expectedSha256, expectedSize, fileName, headers? }
     * event:  otaDownloadProgress { downloadedBytes, totalBytes, percent }
     * döner:  { ok, path?, sha256?, size?, errorCode?, errorMessage? }
     */
    @PluginMethod
    public void downloadOtaApk(PluginCall call) {
        String url            = call.getString("url", "");
        String expectedSha256 = call.getString("expectedSha256", "");
        long   expectedSize   = call.getLong("expectedSize", 0L);
        String fileName       = call.getString("fileName", "");
        JSObject headersObj   = call.getObject("headers", new JSObject());

        java.util.Map<String, String> headers = new java.util.HashMap<>();
        java.util.Iterator<String> keys = headersObj.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            headers.put(k, headersObj.getString(k, ""));
        }

        final android.content.Context ctx = getContext();
        OTA_EXECUTOR.execute(() -> {
            com.cockpitos.pro.ota.OtaDownloadManager.Result r =
                com.cockpitos.pro.ota.OtaDownloadManager.download(
                    ctx, url, expectedSha256, expectedSize, fileName, headers,
                    (downloadedBytes, totalBytes, percent) -> {
                        JSObject ev = new JSObject();
                        ev.put("downloadedBytes", downloadedBytes);
                        ev.put("totalBytes", totalBytes);
                        ev.put("percent", percent);
                        notifyListeners("otaDownloadProgress", ev);
                    });
            JSObject result = new JSObject();
            result.put("ok", r.ok);
            if (r.ok) {
                result.put("path", r.path);
                result.put("sha256", r.sha256);
                result.put("size", r.size);
            } else {
                result.put("errorCode", r.errorCode);
                result.put("errorMessage", r.errorMessage);
            }
            call.resolve(result);
        });
    }

    /**
     * JS → Native: Hash-doğrulanmış OTA APK'sı için sistem kurulum akışı
     * (OTA v1 / Commit 5). SESSİZ KURULUM YOK — kullanıcı onayı sistem
     * diyaloğunda. Ön-kontroller (paket/sürüm/imza/konum) ve izin
     * yönlendirmesi: ota/OtaInstallManager.java.
     * params: { fileName } (yalnız ad — yol files/ota'ya sabitlenir)
     * döner:  { ok, action?, errorCode?, errorMessage? }
     */
    @PluginMethod
    public void installOtaApk(PluginCall call) {
        String fileName = call.getString("fileName", "");
        final android.content.Context ctx = getContext();
        OTA_EXECUTOR.execute(() -> {
            com.cockpitos.pro.ota.OtaInstallManager.Result r =
                com.cockpitos.pro.ota.OtaInstallManager.install(ctx, fileName);
            JSObject result = new JSObject();
            result.put("ok", r.ok);
            if (r.action != null)       result.put("action", r.action);
            if (r.errorCode != null)    result.put("errorCode", r.errorCode);
            if (r.errorMessage != null) result.put("errorMessage", r.errorMessage);
            call.resolve(result);
        });
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

    // ── Recovery Store (Plain SharedPreferences — Android Auto Backup) ──────
    //
    // EncryptedSharedPreferences silinmeden önce (uygulama kaldırma / Android Keystore
    // yenilemesi) API anahtarlarını kalıcı kılmak için ikincil yedek depo.
    // Bu dosya backup_rules.xml ve data_extraction_rules.xml ile Google Drive'a
    // yedeklenir; reinstall veya güncelleme sonrasında otomatik geri yüklenir.
    // Sadece geminiApiKey ve claudeHaikuApiKey bu depoya yazılır.

    private static final String RECOVERY_PREFS = "cockpitos_recovery";

    @PluginMethod
    public void saveRecoveryKey(PluginCall call) {
        String key   = call.getString("key",   "");
        String value = call.getString("value", "");
        if (key == null || key.isEmpty()) { call.reject("key gerekli"); return; }
        try {
            getContext().getSharedPreferences(RECOVERY_PREFS, android.content.Context.MODE_PRIVATE)
                .edit().putString(key, value).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("saveRecoveryKey hatası: " + e.getMessage());
        }
    }

    @PluginMethod
    public void loadRecoveryKey(PluginCall call) {
        String key = call.getString("key", "");
        if (key == null || key.isEmpty()) { call.reject("key gerekli"); return; }
        try {
            String value = getContext()
                .getSharedPreferences(RECOVERY_PREFS, android.content.Context.MODE_PRIVATE)
                .getString(key, "");
            JSObject result = new JSObject();
            result.put("value", value != null ? value : "");
            call.resolve(result);
        } catch (Exception e) {
            JSObject result = new JSObject();
            result.put("value", "");
            call.resolve(result);
        }
    }

    // ── Device Key Backup (Google'sız, uninstall'a dayanıklı dosya yedeği) ──
    //
    // Yukarıdaki Recovery Store (EncryptedSharedPreferences + Android Auto Backup)
    // Google hesabı/Play Services olmayan cihazlarda (head unit'ler, ana hedef)
    // ASLA geri gelmiyor — sahada doğrulandı ("No available restore sets").
    // Bu katman paylaşımlı harici depolamaya yazar: uygulama SİLİNSE bile dosya
    // kalır, reinstall sonrası bu dosyadan geri okunur. Google'a bağımlı DEĞİL.
    //
    // DÜRÜST NOT: Bu Android Keystore seviyesinde güvenli DEĞİLDİR — şifreleme
    // anahtarı cihazın ANDROID_ID'sinden türetilir (gizli/hardware-backed değil);
    // root erişimi veya dosya sistemine doğrudan erişimi olan biri çözebilir.
    // Tehdit modeli: dosya gezgini ile rastgele bakan göz — hedefli saldırgan
    // DEĞİL. Android Keystore burada kullanılamaz çünkü uninstall'da Keystore
    // anahtarı da silinir; bu, cihaz-içi kalıcılık için bilinçli bir ödünleşim.

    private static final String DEVICE_BACKUP_DIR_NAME  = "CarOSPro";
    private static final String DEVICE_BACKUP_FILE_NAME = ".cockpitos.keys";
    private static final String DEVICE_BACKUP_KEY_SALT  = "cockpitos-keybak-v1|";

    private File getDeviceBackupFile() {
        File dir = new File(Environment.getExternalStorageDirectory(), DEVICE_BACKUP_DIR_NAME);
        return new File(dir, DEVICE_BACKUP_FILE_NAME);
    }

    /** SSAID'den sabit 256-bit AES anahtarı türetir — aynı paket+imza için reinstall'da SABİT kalır. */
    private SecretKeySpec getDeviceBackupKey() throws Exception {
        String ssaid = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
        if (ssaid == null || ssaid.isEmpty()) ssaid = "unknown-device";
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] keyBytes = digest.digest((DEVICE_BACKUP_KEY_SALT + ssaid).getBytes(StandardCharsets.UTF_8));
        return new SecretKeySpec(keyBytes, "AES");
    }

    /**
     * JS → Native: Tüm API anahtarlarını tek JSON blob olarak şifreleyip
     * paylaşımlı harici depoya yazar. params: { blob: string }
     */
    @PluginMethod
    public void deviceKeyBackupWrite(PluginCall call) {
        String blob = call.getString("blob", "");
        if (blob == null || blob.isEmpty()) { call.reject("blob gerekli"); return; }
        try {
            SecretKeySpec key = getDeviceBackupKey();
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] cipherText = cipher.doFinal(blob.getBytes(StandardCharsets.UTF_8));

            byte[] out = new byte[iv.length + cipherText.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(cipherText, 0, out, iv.length, cipherText.length);

            File file = getDeviceBackupFile();
            File dir  = file.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();

            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(Base64.encode(out, Base64.NO_WRAP));
            }
            call.resolve();
        } catch (Exception e) {
            // Yazma başarısız olsa bile anahtar EncryptedSharedPreferences +
            // Recovery Store'da kalmaya devam eder — bu yalnızca EK bir katman.
            call.reject("deviceKeyBackupWrite hatası: " + e.getMessage());
        }
    }

    /**
     * JS → Native: Cihaz-içi yedek dosyasını okur ve çözer.
     * Dosya yoksa/çözülemezse (farklı cihaz, bozuk dosya) blob alanı ATLANIR —
     * JS tarafı bunu null olarak yorumlar. ASLA reject etmez (fail-soft).
     */
    @PluginMethod
    public void deviceKeyBackupRead(PluginCall call) {
        JSObject result = new JSObject();
        try {
            File file = getDeviceBackupFile();
            if (!file.exists()) { call.resolve(result); return; }

            byte[] encoded;
            try (FileInputStream fis = new FileInputStream(file)) {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = fis.read(buf)) != -1) baos.write(buf, 0, n);
                encoded = baos.toByteArray();
            }
            byte[] raw = Base64.decode(encoded, Base64.NO_WRAP);
            if (raw.length < 13) { call.resolve(result); return; }

            byte[] iv         = Arrays.copyOfRange(raw, 0, 12);
            byte[] cipherText = Arrays.copyOfRange(raw, 12, raw.length);

            SecretKeySpec key = getDeviceBackupKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] plain = cipher.doFinal(cipherText);

            result.put("blob", new String(plain, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception e) {
            // Farklı cihaz (SSAID farklı → çözülemez) veya bozuk dosya — sessizce
            // boş dön, ASLA reject etme.
            call.resolve(result);
        }
    }

    /**
     * JS → Native: Cihaz-içi yedek dosyasının yazılabilir olup olmadığını bildirir.
     * API 30+ (Android 11+): MANAGE_EXTERNAL_STORAGE (Tüm Dosyalara Erişim) gerekir.
     */
    @PluginMethod
    public void deviceKeyBackupStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean writable;
        boolean needsAllFiles = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            writable = Environment.isExternalStorageManager();
            needsAllFiles = !writable;
        } else {
            writable = Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState());
        }
        result.put("writable", writable);
        result.put("needsAllFiles", needsAllFiles);
        call.resolve(result);
    }

    /**
     * JS → Native: "Tüm Dosyalara Erişim" izin ekranını açar (Android 11+).
     * Bu uygulama Play Store'da değil (B2B sideload) — policy riski yok.
     */
    @PluginMethod
    public void requestAllFilesAccess(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("requestAllFilesAccess hatası: " + e.getMessage());
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

    // ── Yerel müzik çalma (MediaPlayer) ──────────────────────────────────────

    private volatile MediaPlayer localMediaPlayer = null;
    private final Handler        localProgressHandler = new Handler(Looper.getMainLooper());
    private Runnable             localProgressRunnable = null;

    private void stopLocalProgressTimer() {
        if (localProgressRunnable != null) {
            localProgressHandler.removeCallbacks(localProgressRunnable);
            localProgressRunnable = null;
        }
    }

    private void startLocalProgressTimer() {
        stopLocalProgressTimer();
        localProgressRunnable = new Runnable() {
            @Override public void run() {
                MediaPlayer mp = localMediaPlayer;
                if (mp == null) return;
                try {
                    boolean playing = mp.isPlaying();
                    JSObject data = new JSObject();
                    data.put("positionMs", mp.getCurrentPosition());
                    data.put("durationMs", mp.getDuration());
                    data.put("playing", playing);
                    notifyListeners("localMusicProgress", data);
                    if (playing) localProgressHandler.postDelayed(this, 1000);
                } catch (Exception ignored) {}
            }
        };
        localProgressHandler.postDelayed(localProgressRunnable, 1000);
    }

    private void releaseLocalPlayer() {
        stopLocalProgressTimer();
        MediaPlayer mp = localMediaPlayer;
        localMediaPlayer = null;
        if (mp != null) {
            try { if (mp.isPlaying()) mp.stop(); } catch (Exception ignored) {}
            try { mp.release(); } catch (Exception ignored) {}
        }
    }

    /** MediaStore'dan cihaz müziklerini listele. */
    @PluginMethod
    public void getMusicTracks(PluginCall call) {
        new Thread(() -> {
            try {
                String[] projection = {
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM,
                    MediaStore.Audio.Media.ALBUM_ID,
                    MediaStore.Audio.Media.DURATION,
                };
                String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
                String sortOrder = MediaStore.Audio.Media.TITLE + " ASC";

                ContentResolver cr = getContext().getContentResolver();
                Cursor cursor = cr.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    projection, selection, null, sortOrder
                );

                JSArray tracks = new JSArray();
                if (cursor != null) {
                    int idCol       = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int titleCol    = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                    int artistCol   = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                    int albumCol    = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                    int albumIdCol  = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
                    int durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);

                    while (cursor.moveToNext()) {
                        long   id       = cursor.getLong(idCol);
                        String title    = cursor.getString(titleCol);
                        String artist   = cursor.getString(artistCol);
                        String album    = cursor.getString(albumCol);
                        long   albumId  = cursor.getLong(albumIdCol);
                        long   duration = cursor.getLong(durationCol);

                        Uri contentUri  = ContentUris.withAppendedId(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
                        Uri albumArtUri = Uri.parse(
                            "content://media/external/audio/albumart/" + albumId);

                        JSObject track = new JSObject();
                        track.put("id",          String.valueOf(id));
                        track.put("uri",         contentUri.toString());
                        track.put("title",       title  != null ? title  : "Bilinmiyor");
                        track.put("artist",      artist != null ? artist : "Bilinmiyor");
                        track.put("album",       album  != null ? album  : "");
                        track.put("albumArtUri", albumArtUri.toString());
                        track.put("durationMs",  duration);
                        tracks.put(track);
                    }
                    cursor.close();
                }

                JSObject result = new JSObject();
                result.put("tracks", tracks);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("MEDIA_QUERY_FAILED", e.getMessage());
            }
        }).start();
    }

    /** Belirtilen content:// URI'yi çal. */
    @PluginMethod
    public void playLocalTrack(PluginCall call) {
        String uri = call.getString("uri", "");
        if (uri == null || uri.isEmpty()) {
            call.reject("URI_REQUIRED", "uri parametresi gerekli");
            return;
        }
        releaseLocalPlayer();
        String finalUri = uri;
        localProgressHandler.post(() -> {
            try {
                MediaPlayer mp = new MediaPlayer();
                localMediaPlayer = mp;

                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .build());
                } else {
                    mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
                }

                mp.setDataSource(getContext(), Uri.parse(finalUri));

                mp.setOnPreparedListener(prepared -> {
                    prepared.start();
                    startLocalProgressTimer();
                    JSObject data = new JSObject();
                    data.put("durationMs", prepared.getDuration());
                    data.put("playing", true);
                    notifyListeners("localMusicStarted", data);
                });

                mp.setOnCompletionListener(done -> {
                    stopLocalProgressTimer();
                    notifyListeners("localMusicCompleted", new JSObject());
                });

                mp.setOnErrorListener((errMp, what, extra) -> {
                    stopLocalProgressTimer();
                    JSObject err = new JSObject();
                    err.put("error", "MediaPlayer error " + what + "/" + extra);
                    notifyListeners("localMusicError", err);
                    return true;
                });

                mp.prepareAsync();
                call.resolve();
            } catch (Exception e) {
                call.reject("PLAY_FAILED", e.getMessage());
            }
        });
    }

    @PluginMethod
    public void pauseLocalTrack(PluginCall call) {
        localProgressHandler.post(() -> {
            MediaPlayer mp = localMediaPlayer;
            if (mp != null) {
                try { if (mp.isPlaying()) mp.pause(); } catch (Exception ignored) {}
                stopLocalProgressTimer();
                try {
                    JSObject data = new JSObject();
                    data.put("positionMs", mp.getCurrentPosition());
                    data.put("durationMs", mp.getDuration());
                    data.put("playing", false);
                    notifyListeners("localMusicProgress", data);
                } catch (Exception ignored) {}
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void resumeLocalTrack(PluginCall call) {
        localProgressHandler.post(() -> {
            MediaPlayer mp = localMediaPlayer;
            if (mp != null) {
                try { if (!mp.isPlaying()) mp.start(); } catch (Exception ignored) {}
                startLocalProgressTimer();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stopLocalTrack(PluginCall call) {
        localProgressHandler.post(() -> {
            releaseLocalPlayer();
            call.resolve();
        });
    }

    @PluginMethod
    public void seekLocalTrack(PluginCall call) {
        int positionMs = call.getInt("positionMs", 0);
        localProgressHandler.post(() -> {
            MediaPlayer mp = localMediaPlayer;
            if (mp != null) {
                try { mp.seekTo(positionMs); } catch (Exception ignored) {}
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getLocalTrackPosition(PluginCall call) {
        JSObject result = new JSObject();
        MediaPlayer mp = localMediaPlayer;
        if (mp != null) {
            try {
                result.put("positionMs", mp.getCurrentPosition());
                result.put("durationMs", mp.getDuration());
                result.put("playing",    mp.isPlaying());
            } catch (Exception e) {
                result.put("positionMs", 0);
                result.put("durationMs", 0);
                result.put("playing",    false);
            }
        } else {
            result.put("positionMs", 0);
            result.put("durationMs", 0);
            result.put("playing",    false);
        }
        call.resolve(result);
    }

    // ── Video oynatma (VideoView overlay — aynı Activity içinde) ───────────────

    private RelativeLayout videoOverlay       = null;
    // VideoView (SurfaceView) WebView üstüne eklenince video yüzeyi pencerenin arkasında
    // kalıp "ses var görüntü yok" sorununa yol açıyordu. TextureView normal view
    // hiyerarşisinde render edildiği için bu sorunu çözer.
    private TextureView    nativeVideoTexture = null;
    private MediaPlayer    nativeVideoPlayer  = null;

    /** MediaStore.Video.Media'dan cihaz videolarını listele. */
    @PluginMethod
    public void getVideoTracks(PluginCall call) {
        new Thread(() -> {
            try {
                String[] projection = {
                    MediaStore.Video.Media._ID,
                    MediaStore.Video.Media.TITLE,
                    MediaStore.Video.Media.DURATION,
                    MediaStore.Video.Media.SIZE,
                    MediaStore.Video.Media.DATE_MODIFIED,
                };
                String selection = MediaStore.Video.Media.SIZE + " > 0";
                String sortOrder = MediaStore.Video.Media.DATE_MODIFIED + " DESC";

                ContentResolver cr = getContext().getContentResolver();
                Cursor cursor = cr.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    projection, selection, null, sortOrder
                );

                JSArray videos = new JSArray();
                if (cursor != null) {
                    int idCol       = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID);
                    int titleCol    = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.TITLE);
                    int durationCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION);
                    int sizeCol     = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE);

                    while (cursor.moveToNext()) {
                        long   id       = cursor.getLong(idCol);
                        String title    = cursor.getString(titleCol);
                        long   duration = cursor.getLong(durationCol);
                        long   size     = cursor.getLong(sizeCol);

                        Uri contentUri = ContentUris.withAppendedId(
                            MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);

                        JSObject video = new JSObject();
                        video.put("id",         String.valueOf(id));
                        video.put("uri",        contentUri.toString());
                        video.put("title",      title != null ? title : "Video " + id);
                        video.put("durationMs", duration);
                        video.put("sizeBytes",  size);
                        videos.put(video);
                    }
                    cursor.close();
                }

                JSObject result = new JSObject();
                result.put("videos", videos);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("VIDEO_QUERY_FAILED", e.getMessage());
            }
        }).start();
    }

    /**
     * Videoyu aynı Activity içinde tam ekran native VideoView ile oynat.
     * Ayrı uygulama açılmaz; KAPAT butonu basılınca overlay kaldırılır.
     */
    @PluginMethod
    public void playVideoNative(PluginCall call) {
        String uri   = call.getString("uri", "");
        String title = call.getString("title", "Video");

        if (uri == null || uri.isEmpty()) {
            call.reject("URI_REQUIRED", "uri parametresi gerekli");
            return;
        }
        final String finalUri   = uri;
        final String finalTitle = title;

        getActivity().runOnUiThread(() -> {
            // Önceki oynatıcıyı kapat
            closeVideoNativeInternal();

            // Tam ekran koyu overlay
            videoOverlay = new RelativeLayout(getContext());
            videoOverlay.setBackgroundColor(0xFF000000);
            videoOverlay.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ));

            // TextureView — normal view hiyerarşisinde render → WebView üstünde görüntü görünür
            nativeVideoTexture = new TextureView(getContext());
            RelativeLayout.LayoutParams vp = new RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.MATCH_PARENT,
                RelativeLayout.LayoutParams.MATCH_PARENT
            );
            vp.addRule(RelativeLayout.CENTER_IN_PARENT);
            nativeVideoTexture.setLayoutParams(vp);
            nativeVideoTexture.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                @Override
                public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
                    try {
                        nativeVideoPlayer = new MediaPlayer();
                        nativeVideoPlayer.setSurface(new Surface(surface));
                        nativeVideoPlayer.setDataSource(getContext(), Uri.parse(finalUri));
                        nativeVideoPlayer.setOnPreparedListener(mp -> {
                            mp.start();
                            JSObject data = new JSObject();
                            data.put("durationMs", mp.getDuration());
                            notifyListeners("videoStarted", data);
                        });
                        nativeVideoPlayer.setOnVideoSizeChangedListener((mp, vw, vh) ->
                            getActivity().runOnUiThread(() -> fitVideoTexture(vw, vh)));
                        nativeVideoPlayer.setOnCompletionListener(mp -> {
                            notifyListeners("videoCompleted", new JSObject());
                            getActivity().runOnUiThread(CarLauncherPlugin.this::closeVideoNativeInternal);
                        });
                        nativeVideoPlayer.setOnErrorListener((mp, what, extra) -> {
                            JSObject err = new JSObject();
                            err.put("error", "Video oynatma hatası: " + what + "/" + extra);
                            notifyListeners("videoError", err);
                            return true; // hatayı tükettik — MediaPlayer'ı serbest bırakacağız
                        });
                        nativeVideoPlayer.prepareAsync();
                    } catch (Exception e) {
                        JSObject err = new JSObject();
                        err.put("error", "Video açılamadı: " + e.getMessage());
                        notifyListeners("videoError", err);
                    }
                }
                @Override
                public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
                    if (nativeVideoPlayer != null) {
                        try { fitVideoTexture(nativeVideoPlayer.getVideoWidth(), nativeVideoPlayer.getVideoHeight()); }
                        catch (Exception ignored) {}
                    }
                }
                @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) { return true; }
                @Override public void onSurfaceTextureUpdated(SurfaceTexture surface) {}
            });

            videoOverlay.addView(nativeVideoTexture);

            // KAPAT butonu — sağ üst köşe
            Button closeBtn = new Button(getContext());
            closeBtn.setText("✕  KAPAT");
            closeBtn.setTextSize(14f);
            closeBtn.setTextColor(0xFFFFFFFF);
            closeBtn.setBackgroundColor(0xCC1a1a2e);
            closeBtn.setPadding(32, 16, 32, 16);
            RelativeLayout.LayoutParams cp = new RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.WRAP_CONTENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
            );
            cp.addRule(RelativeLayout.ALIGN_PARENT_TOP);
            cp.addRule(RelativeLayout.ALIGN_PARENT_END);
            cp.setMargins(0, 60, 40, 0);
            closeBtn.setLayoutParams(cp);
            closeBtn.setOnClickListener(v -> {
                closeVideoNativeInternal();
                notifyListeners("videoClosed", new JSObject());
            });
            videoOverlay.addView(closeBtn);

            // Activity penceresi içine ekle (WebView'ın üstünde)
            ((ViewGroup) getActivity().getWindow().getDecorView()).addView(videoOverlay);
            call.resolve();
        });
    }

    /** Aktif video overlay'ini kapat ve kaynakları serbest bırak. */
    @PluginMethod
    public void closeVideoNative(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            closeVideoNativeInternal();
            call.resolve();
        });
    }

    private void closeVideoNativeInternal() {
        if (nativeVideoPlayer != null) {
            try { nativeVideoPlayer.stop(); }    catch (Exception ignored) {}
            try { nativeVideoPlayer.release(); }  catch (Exception ignored) {}
            nativeVideoPlayer = null;
        }
        nativeVideoTexture = null;
        if (videoOverlay != null) {
            try {
                ((ViewGroup) getActivity().getWindow().getDecorView()).removeView(videoOverlay);
            } catch (Exception ignored) {}
            videoOverlay = null;
        }
    }

    /** Videoyu TextureView içine en-boy oranını koruyarak (letterbox) sığdırır. */
    private void fitVideoTexture(int videoW, int videoH) {
        TextureView tv = nativeVideoTexture;
        if (tv == null || videoW <= 0 || videoH <= 0) return;
        int viewW = tv.getWidth(), viewH = tv.getHeight();
        if (viewW <= 0 || viewH <= 0) return;
        float viewAspect  = (float) viewW / viewH;
        float videoAspect = (float) videoW / videoH;
        float scaleX = 1f, scaleY = 1f;
        if (videoAspect > viewAspect) {
            scaleY = viewAspect / videoAspect; // video daha geniş → üst/alt boşluk
        } else {
            scaleX = videoAspect / viewAspect; // video daha dar → yan boşluk
        }
        Matrix m = new Matrix();
        m.setScale(scaleX, scaleY, viewW / 2f, viewH / 2f);
        tv.setTransform(m);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static boolean present(String s) { return s != null && !s.isEmpty(); }
    private static String  safe(String s)    { return s != null ? s : ""; }

    // ── Native-Core köprüsü (Phase N2) ─────────────────────────────────────────
    // C++ (vehicle_core) JNI hattının canlı olduğunu JS'e doğrulatır.
    // Native lib yüklenemezse fail-soft: heartbeat < 0 + available=false döner.
    @PluginMethod
    public void getNativeHeartbeat(PluginCall call) {
        long hb;
        try {
            hb = com.cockpitos.pro.core.VehicleNativeBridge.INSTANCE.heartbeat();
        } catch (Throwable t) {
            hb = -1L;
        }
        JSObject result = new JSObject();
        result.put("heartbeat", hb);
        result.put("available", hb >= 0L);
        call.resolve(result);
    }

    // ── Native zero-copy veri stream'i (Phase N3) ──────────────────────────────
    // C++ VehicleState → DirectByteBuffer (zero-copy) → notifyListeners("nativeVehicleData").
    // Mevcut worker.ts akışına EK (side-stream); onu bozmaz. Adanmış HandlerThread'de
    // koşar (main thread jank yok). Hot-path: yeniden kullanılan double[] + seq-gated emit.
    private HandlerThread nativeStreamThread = null;
    private Handler       nativeStreamHandler = null;
    private Runnable      nativeStreamTask = null;
    private final double[] nativeSnap = new double[6]; // [speed,rpm,fuel,odometer,seq,nativeSource] — reusable
    private double         nativeLastSeq = -1.0;       // değişmediyse emit atla

    @PluginMethod
    public void startNativeStream(PluginCall call) {
        int hz = call.getInt("hz", 20);                  // 10–20 Hz hedefi
        if (hz < 1)  hz = 1;
        if (hz > 50) hz = 50;
        final long periodMs = Math.max(1L, 1000L / hz);

        com.cockpitos.pro.core.VehicleNativeBridge bridge =
                com.cockpitos.pro.core.VehicleNativeBridge.INSTANCE;
        if (!bridge.isAvailable() || !bridge.ensureSnapshotBuffer()) {
            call.reject("native-core kullanılamıyor (lib yüklenemedi veya buffer map edilemedi)");
            return;
        }

        stopNativeStreamInternal(); // varsa eski stream'i temizle (idempotent)

        nativeStreamThread = new HandlerThread("native-stream");
        nativeStreamThread.start();
        nativeStreamHandler = new Handler(nativeStreamThread.getLooper());
        nativeLastSeq = -1.0;

        final long fPeriod = periodMs;
        nativeStreamTask = new Runnable() {
            @Override public void run() {
                Handler h = nativeStreamHandler;
                if (h == null) return; // durduruldu
                if (bridge.readSnapshotInto(nativeSnap)) {
                    double seq = nativeSnap[4];
                    if (seq != nativeLastSeq) {        // sadece yeni veri varken emit
                        nativeLastSeq = seq;
                        JSObject data = new JSObject(); // tick başına tek (zorunlu) allokasyon
                        data.put("speed",        nativeSnap[0]);
                        data.put("rpm",          nativeSnap[1]);
                        data.put("fuel",         nativeSnap[2]);
                        data.put("odometer",     nativeSnap[3]);
                        data.put("seq",          (long) seq);
                        data.put("nativeSource", (int) nativeSnap[5]); // Phase N5.2: aktif füzyon kaynağı
                        notifyListeners("nativeVehicleData", data);
                    }
                }
                h.postDelayed(this, fPeriod);
            }
        };
        nativeStreamHandler.post(nativeStreamTask);

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("hz", hz);
        result.put("periodMs", fPeriod);
        call.resolve(result);
    }

    @PluginMethod
    public void stopNativeStream(PluginCall call) {
        stopNativeStreamInternal();
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    // ── Odometre seed (Phase N5.1) ─────────────────────────────────────────────
    // JS başlangıcında kayıtlı toplam km'yi native birikticiye yükler.
    // Hesaplama native'de; burada yalnızca değer iletilir. Hafif: sadece resolve.
    @PluginMethod
    public void setNativeOdometer(PluginCall call) {
        Double km = call.getDouble("km");
        if (km == null) {
            call.reject("km parametresi gerekli");
            return;
        }
        VehicleNativeBridge.INSTANCE.setOdometer(km);
        call.resolve();
    }

    private void stopNativeStreamInternal() {
        if (nativeStreamHandler != null && nativeStreamTask != null) {
            nativeStreamHandler.removeCallbacks(nativeStreamTask);
        }
        if (nativeStreamThread != null) {
            nativeStreamThread.quitSafely();
            nativeStreamThread = null;
        }
        nativeStreamHandler = null;
        nativeStreamTask    = null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @Override
    protected void handleOnDestroy() {
        stopWakeWordThread(); // grammar wake thread — mikrofon sızıntısı olmasın
        stopNativeStreamInternal();
        if (btStateReceiver != null) {
            try { getContext().unregisterReceiver(btStateReceiver); } catch (Exception ignored) {}
            btStateReceiver = null;
        }
        if (ttsEngine != null) { ttsEngine.stop(); ttsEngine.shutdown(); ttsEngine = null; }
        ttsReady = false;
        settleAllTtsCalls();
        releaseLocalPlayer();
        canBusManager.stop();
        if (obdManager != null) obdManager.shutdown();
        if (bleObdManager != null) bleObdManager.shutdown();

        if (mediaManager != null) {
            mediaManager.detachMediaSessionsListener();
        }

        closeCameraInternal();
        stopPassengerServerInternal();

        super.handleOnDestroy();
    }
}
