package com.cockpitos.pro.phonelink;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Set;

/**
 * PhoneBtInternet — eşleşmiş telefonun internetini Bluetooth (PAN) üzerinden kullan.
 *
 * Telefon tarafında "Bluetooth ile internet paylaşımı" AÇIK olmalıdır; bu sınıf onu
 * açamaz. Ünite (PANU istemcisi) tarafında bağlantıyı başlatmak için Android'in gizli
 * {@code BluetoothPan.connect} çağrısı kullanılır: Android 10'da BLUETOOTH_ADMIN yeter,
 * 11+'da sistem izni ister → {@code UNSUPPORTED} döner (sahte "bağlandı" YOK).
 *
 * Veri düzlemi Android'in kendi ağ yığınıdır; bu sınıf yalnız bağlantıyı İSTER.
 * Tercih: kullanıcı bir kez açar, telefon her bağlandığında (ACL) yeniden denenir.
 */
public final class PhoneBtInternet {
    private static final int PROFILE_PAN = 5; // BluetoothProfile.PAN (gizli sabit)
    private static final String PREFS = "caros_phone_internet";
    private static final String KEY_ENABLED = "enabled";

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile BluetoothProfile pan;

    public PhoneBtInternet(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null) return;
        try {
            a.getProfileProxy(this.ctx, new BluetoothProfile.ServiceListener() {
                @Override public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    pan = proxy;
                    if (isEnabled()) connectPairedPhones();
                }
                @Override public void onServiceDisconnected(int profile) { pan = null; }
            }, PROFILE_PAN);
        } catch (Exception ignored) { /* PAN yok → UNSUPPORTED */ }
    }

    public boolean isEnabled() {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false);
    }

    public void setEnabled(boolean on) {
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putBoolean(KEY_ENABLED, on).apply();
    }

    /** ACL bağlandı → telefon ise (tercih açıksa) PAN iste. Telefonun hazır olması için kısa gecikme. */
    public void onDeviceConnected(BluetoothDevice dev) {
        if (dev == null || !isEnabled() || !isPhone(dev)) return;
        main.postDelayed(() -> connect(dev), 3000);
    }

    /**
     * Eşleşmiş tüm telefonlara PAN iste. Dönüş: STARTED · NO_PHONE · NO_PERMISSION ·
     * OFF · UNSUPPORTED · NOT_READY (proxy henüz gelmedi).
     */
    public String connectPairedPhones() {
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null) return "UNSUPPORTED";
        try {
            if (!a.isEnabled()) return "OFF";
            Set<BluetoothDevice> bonded = a.getBondedDevices();
            boolean anyPhone = false;
            String last = "NO_PHONE";
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    if (!isPhone(d)) continue;
                    anyPhone = true;
                    last = connect(d);
                    if ("STARTED".equals(last)) return last;
                }
            }
            return anyPhone ? last : "NO_PHONE";
        } catch (SecurityException e) {
            return "NO_PERMISSION";
        }
    }

    /** CONNECTED · CONNECTING · DISCONNECTED · UNSUPPORTED — ölçülür. */
    public String state() {
        BluetoothProfile p = pan;
        if (p == null) return "UNSUPPORTED";
        try {
            List<BluetoothDevice> devs = p.getDevicesMatchingConnectionStates(
                new int[] { BluetoothProfile.STATE_CONNECTED });
            if (devs != null && !devs.isEmpty()) return "CONNECTED";
            devs = p.getDevicesMatchingConnectionStates(new int[] { BluetoothProfile.STATE_CONNECTING });
            return devs != null && !devs.isEmpty() ? "CONNECTING" : "DISCONNECTED";
        } catch (SecurityException e) {
            return "NO_PERMISSION";
        } catch (Exception e) {
            return "UNSUPPORTED";
        }
    }

    private String connect(BluetoothDevice dev) {
        BluetoothProfile p = pan;
        if (p == null) return "NOT_READY";
        try {
            if (p.getConnectionState(dev) == BluetoothProfile.STATE_CONNECTED) return "STARTED";
            Method m = p.getClass().getMethod("connect", BluetoothDevice.class);
            Object ok = m.invoke(p, dev);
            return Boolean.TRUE.equals(ok) ? "STARTED" : "UNSUPPORTED";
        } catch (java.lang.reflect.InvocationTargetException e) {
            return e.getCause() instanceof SecurityException
                ? (Build.VERSION.SDK_INT >= 31 ? "NO_PERMISSION" : "UNSUPPORTED")
                : "UNSUPPORTED";
        } catch (SecurityException e) {
            return "NO_PERMISSION";
        } catch (Exception e) {
            return "UNSUPPORTED";
        }
    }

    private static boolean isPhone(BluetoothDevice d) {
        try {
            BluetoothClass c = d.getBluetoothClass();
            return c != null && c.getMajorDeviceClass() == BluetoothClass.Device.Major.PHONE;
        } catch (SecurityException e) {
            return false;
        }
    }
}
