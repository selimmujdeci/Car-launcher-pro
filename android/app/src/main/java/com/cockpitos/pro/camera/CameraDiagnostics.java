package com.cockpitos.pro.camera;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

/**
 * Yol kamerası (ADAS / AR) donanım tanısı — SALT OKUR, kamerayı AÇMAZ.
 *
 * NEDEN: WebView (getUserMedia) yalnız Android kamera yığınının (Camera2) gördüğü
 * kameraları listeler. USB/UVC kamera takılı olduğu halde listede yoksa, sorun
 * uygulamada değil cihaz yazılımındadır (harici kamera HAL'i yok). Sürücüye
 * "kamera bulunamadı" demek yerine NEDENİNİ söyleyebilmek için iki kaynak
 * yan yana raporlanır:
 *   · Camera2 kimlikleri + yön (arka/ön/HARİCİ) + donanım seviyesi
 *   · USB veri yolundaki video sınıfı (UVC, 0x0E) cihazlar
 * Ayrıca USB video cihazı takılıp çıkarıldığında dinleyiciye haber verir.
 *
 * GİZLİLİK: seri numarası OKUNMAZ (Android 10+ izin ister, kimlik bilgisidir).
 */
public final class CameraDiagnostics {

    private CameraDiagnostics() {}

    public interface UsbVideoListener {
        void onUsbVideoChanged(JSObject event);
    }

    /** Anlık tanı raporu. */
    public static JSObject collect(Context ctx) {
        JSObject r = new JSObject();
        PackageManager pm = ctx.getPackageManager();
        r.put("featureCameraAny", pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY));
        r.put("featureExternalCamera", pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_EXTERNAL));
        r.put("featureUsbHost", pm.hasSystemFeature(PackageManager.FEATURE_USB_HOST));
        r.put("sdkInt", Build.VERSION.SDK_INT);

        JSArray cams = new JSArray();
        try {
            CameraManager mgr = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            if (mgr != null) {
                for (String id : mgr.getCameraIdList()) {
                    JSObject c = new JSObject();
                    c.put("id", id);
                    try {
                        CameraCharacteristics ch = mgr.getCameraCharacteristics(id);
                        c.put("facing", facingName(ch.get(CameraCharacteristics.LENS_FACING)));
                        c.put("hardwareLevel", levelName(ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)));
                    } catch (Exception e) {
                        c.put("facing", "unknown");
                        c.put("hardwareLevel", "unknown");
                    }
                    cams.put(c);
                }
            }
        } catch (Exception ignored) {
            // CameraManager yok / servis hatası → boş liste (sahte kamera üretilmez)
        }
        r.put("cameras", cams);

        JSArray usb = new JSArray();
        try {
            UsbManager um = (UsbManager) ctx.getSystemService(Context.USB_SERVICE);
            if (um != null) {
                for (UsbDevice d : um.getDeviceList().values()) {
                    if (!isVideoDevice(d)) continue;
                    usb.put(describe(um, d));
                }
            }
        } catch (Exception ignored) {
            // USB host yok → boş liste
        }
        r.put("usbVideoDevices", usb);
        return r;
    }

    /** USB video sınıfı: cihaz sınıfı 0x0E ya da (bileşik/misc cihazda) herhangi bir arayüz 0x0E. */
    public static boolean isVideoDevice(UsbDevice d) {
        if (d == null) return false;
        if (d.getDeviceClass() == UsbConstants.USB_CLASS_VIDEO) return true;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_VIDEO) return true;
        }
        return false;
    }

    private static JSObject describe(UsbManager um, UsbDevice d) {
        JSObject o = new JSObject();
        o.put("vendorId", d.getVendorId());
        o.put("productId", d.getProductId());
        String name = null;
        try { name = d.getProductName(); } catch (Exception ignored) {}
        String maker = null;
        try { maker = d.getManufacturerName(); } catch (Exception ignored) {}
        o.put("name", name != null ? name : "");
        o.put("manufacturer", maker != null ? maker : "");
        boolean perm = false;
        try { perm = um != null && um.hasPermission(d); } catch (Exception ignored) {}
        o.put("hasPermission", perm);
        return o;
    }

    private static String facingName(Integer f) {
        if (f == null) return "unknown";
        switch (f) {
            case CameraCharacteristics.LENS_FACING_BACK: return "back";
            case CameraCharacteristics.LENS_FACING_FRONT: return "front";
            case CameraCharacteristics.LENS_FACING_EXTERNAL: return "external";
            default: return "unknown";
        }
    }

    private static String levelName(Integer l) {
        if (l == null) return "unknown";
        switch (l) {
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY: return "legacy";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED: return "limited";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL: return "full";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3: return "level3";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL: return "external";
            default: return "unknown";
        }
    }

    /**
     * USB video cihazı takma/çıkarma izleyicisi. Yalnız video sınıfı cihazlar bildirilir
     * (CAN/OBD seri adaptörleri kendi yollarından yönetilir, burada sessiz kalır).
     * @return kayıtlı alıcı — `unregister` ile bırakılmalıdır.
     */
    public static BroadcastReceiver registerUsbVideoWatcher(Context ctx, UsbVideoListener listener) {
        BroadcastReceiver rx = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
                UsbDevice dev;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    dev = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
                } else {
                    //noinspection deprecation
                    dev = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                }
                if (!isVideoDevice(dev)) return;
                UsbManager um = (UsbManager) c.getSystemService(Context.USB_SERVICE);
                JSObject e = describe(um, dev);
                e.put("attached", UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action));
                listener.onUsbVideoChanged(e);
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        // Sistem yayını: dışa açık olmayan alıcı yeterlidir (API 34+ bayrak zorunlu).
        ContextCompat.registerReceiver(ctx, rx, f, ContextCompat.RECEIVER_NOT_EXPORTED);
        return rx;
    }

    public static void unregister(Context ctx, BroadcastReceiver rx) {
        if (rx == null) return;
        try { ctx.unregisterReceiver(rx); } catch (Exception ignored) {}
    }
}
