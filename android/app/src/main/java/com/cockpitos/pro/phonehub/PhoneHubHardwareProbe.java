package com.cockpitos.pro.phonehub;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import java.util.Set;

/**
 * PhoneHubHardwareProbe — PHONE-HUB P0.5 · SALT-OKUNUR donanım gözlemi.
 *
 * ── BU SINIF NE YAPMAZ (pazarlıksız) ────────────────────────────────────────
 * Bluetooth keşfi BAŞLATMAZ/DURDURMAZ · eşleştirme YAPMAZ · soket/GATT AÇMAZ ·
 * BLE taraması BAŞLATMAZ · adapter'ı açıp KAPATMAZ · SCO BAŞLATMAZ · ses yolunu
 * DEĞİŞTİRMEZ · medya tuşu GÖNDERMEZ · çağrı BAŞLATMAZ · izin İSTEMEZ · vendor
 * servisine BIND OLMAZ · vendor intent YAYINLAMAZ · OBD'ye komut GÖNDERMEZ ve
 * OBD yaşam döngüsüne DOKUNMAZ.
 *
 * Yalnız GETTER çağırır. Statik güvenlik testi bu dosyada yasaklı çağrı
 * dizelerinin sıfır kez geçtiğini doğrular.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Her okuma kendi try/catch'inde. `SecurityException` (izin yok), `NoSuchMethodError`
 * (eski API), `NullPointerException` (adapter yok) uygulamayı ÇÖKERTMEZ; ilgili alan
 * UNKNOWN/UNAVAILABLE kalır ve sınıflandırılmış bir hata kodu eklenir. SAHTE
 * VARSAYILAN ÜRETİLMEZ ("bağlı değil" ile "okunamadı" ayrıdır).
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Cihaz adı · MAC · kişi adı · telefon modeli · pairing key bu sınıftan DIŞARI
 * ÇIKMAZ. Yalnız sayım ve enum üretilir; adapter adı için bile sadece "var mı".
 */
public final class PhoneHubHardwareProbe {

    /** Hata kodları — serbest metin/yığın izi YOK. */
    public static final String ERR_NO_ADAPTER            = "BT_ADAPTER_NULL";
    public static final String ERR_BT_SECURITY           = "BT_SECURITY_EXCEPTION";
    public static final String ERR_BT_READ_FAILED        = "BT_READ_FAILED";
    public static final String ERR_BONDED_SECURITY       = "BONDED_SECURITY_EXCEPTION";
    public static final String ERR_BONDED_READ_FAILED    = "BONDED_READ_FAILED";
    public static final String ERR_PROFILE_READ_FAILED   = "PROFILE_READ_FAILED";
    public static final String ERR_AUDIO_READ_FAILED     = "AUDIO_READ_FAILED";
    public static final String ERR_VENDOR_READ_FAILED    = "VENDOR_READ_FAILED";
    /** Vendor broadcast için depoda GÖZLEM ALTYAPISI YOK — uydurulmaz, beyan edilir. */
    public static final String ERR_VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE =
        "VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE";
    /** GATT için güvenilir salt-okunur API yok. */
    public static final String ERR_GATT_STATE_UNAVAILABLE = "GATT_STATE_UNAVAILABLE";

    /**
     * Depoda GERÇEKTEN kullanılan vendor paketi.
     * Kaynak: {@code can/NwdCanClient.java} → {@code SVC_PKG = "com.nwd.can.setting"}.
     * Hiworld tarafında depoda YALNIZ broadcast action'ları vardır (paket sabiti YOK),
     * bu yüzden Hiworld için paket kontrolü YAPILMAZ — uydurma paket adı eklenmez.
     */
    private static final String VENDOR_PKG_NWD = "com.nwd.can.setting";

    private PhoneHubHardwareProbe() { }

    /**
     * Tek atışlık salt-okunur gözlem.
     *
     * @param ctx uygulama context'i (null olabilir → fail-soft)
     * @param nowMs duvar-saati damgası (çağıran verir; bu sınıf saat OKUMAZ ki test edilebilsin)
     */
    public static PhoneHubHardwareSnapshot capture(Context ctx, long nowMs) {
        PhoneHubHardwareSnapshot.Builder b = new PhoneHubHardwareSnapshot.Builder()
            .capturedAt(nowMs)
            .platformApiLevel(Build.VERSION.SDK_INT);

        if (ctx == null) {
            return b.error(ERR_BT_READ_FAILED).build();
        }

        readPermissions(ctx, b);
        BluetoothAdapter adapter = readAdapter(b);
        readBonded(adapter, b);
        readProfiles(adapter, b);
        readAudio(ctx, b);
        readVendor(ctx, b);

        return b.build();
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İzinler — YALNIZ durum okunur; izin İSTENMEZ
     * ════════════════════════════════════════════════════════════════════ */

    private static void readPermissions(Context ctx, PhoneHubHardwareSnapshot.Builder b) {
        // API 31 (S) öncesinde BLUETOOTH_CONNECT/SCAN YOKTUR → "reddedildi" DEĞİL,
        // "bu sürümde uygulanmaz". İkisi KARIŞTIRILMAZ.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.permConnect(permState(ctx, Manifest.permission.BLUETOOTH_CONNECT));
            b.permScan(permState(ctx, Manifest.permission.BLUETOOTH_SCAN));
            b.permLegacy(PhoneHubHardwareSnapshot.PERM_NOT_APPLICABLE);
        } else {
            b.permConnect(PhoneHubHardwareSnapshot.PERM_NOT_APPLICABLE);
            b.permScan(PhoneHubHardwareSnapshot.PERM_NOT_APPLICABLE);
            b.permLegacy(permState(ctx, Manifest.permission.BLUETOOTH));
        }
    }

    private static String permState(Context ctx, String permission) {
        try {
            int r = ctx.checkSelfPermission(permission);
            return r == PackageManager.PERMISSION_GRANTED
                ? PhoneHubHardwareSnapshot.PERM_GRANTED
                : PhoneHubHardwareSnapshot.PERM_DENIED;
        } catch (Throwable t) {
            return PhoneHubHardwareSnapshot.PERM_UNKNOWN;
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Adapter
     * ════════════════════════════════════════════════════════════════════ */

    private static BluetoothAdapter readAdapter(PhoneHubHardwareSnapshot.Builder b) {
        BluetoothAdapter adapter = null;
        try {
            adapter = BluetoothAdapter.getDefaultAdapter();
        } catch (Throwable t) {
            b.error(ERR_BT_READ_FAILED);
        }

        if (adapter == null) {
            b.adapterAvailable(false)
             .adapterEnabled(false)
             .bluetoothEvidence(PhoneHubHardwareSnapshot.EV_DEVICE_OBSERVED)
             .error(ERR_NO_ADAPTER);
            return null;
        }

        b.adapterAvailable(true)
         .bluetoothEvidence(PhoneHubHardwareSnapshot.EV_DEVICE_OBSERVED);

        try {
            b.adapterEnabled(adapter.isEnabled());
        } catch (SecurityException se) {
            b.error(ERR_BT_SECURITY);
        } catch (Throwable t) {
            b.error(ERR_BT_READ_FAILED);
        }

        // GİZLİLİK: adapter adının KENDİSİ taşınmaz — yalnız varlığı.
        try {
            String name = adapter.getName();
            b.adapterNamePresent(name != null && name.length() > 0);
        } catch (SecurityException se) {
            b.error(ERR_BT_SECURITY);
        } catch (Throwable t) {
            b.error(ERR_BT_READ_FAILED);
        }

        /* Keşif DURUMU salt-okunur bir getter'dır (isDiscovering) — keşfi
           BAŞLATMAZ/DURDURMAZ. Okunamazsa "keşif yok" DEĞİL, UNKNOWN. */
        try {
            b.discoveryActive(adapter.isDiscovering()
                ? PhoneHubHardwareSnapshot.DISCOVERY_ACTIVE
                : PhoneHubHardwareSnapshot.DISCOVERY_INACTIVE);
        } catch (SecurityException se) {
            b.discoveryActive(PhoneHubHardwareSnapshot.DISCOVERY_UNKNOWN);
            b.error(ERR_BT_SECURITY);
        } catch (Throwable t) {
            b.discoveryActive(PhoneHubHardwareSnapshot.DISCOVERY_UNKNOWN);
            b.error(ERR_BT_READ_FAILED);
        }

        return adapter;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Eşleşmiş cihazlar — ANONİM SAYIM (ad/MAC OKUNMAZ)
     * ════════════════════════════════════════════════════════════════════ */

    private static void readBonded(BluetoothAdapter adapter, PhoneHubHardwareSnapshot.Builder b) {
        if (adapter == null) return;
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded == null) {
                b.error(ERR_BONDED_READ_FAILED);
                return;
            }
            int phone = 0, audio = 0, obd = 0, unknown = 0;
            for (BluetoothDevice dev : bonded) {
                int major = -1;
                try {
                    BluetoothClass cls = dev.getBluetoothClass();
                    if (cls != null) major = cls.getMajorDeviceClass();
                } catch (Throwable ignored) { /* sınıf okunamadı → unknown */ }

                String label = PhoneHubHardwareSnapshot.classifyMajorDeviceClass(major);
                if (PhoneHubHardwareSnapshot.CLASS_PHONE_LIKE.equals(label))      phone++;
                else if (PhoneHubHardwareSnapshot.CLASS_AUDIO_LIKE.equals(label)) audio++;
                else if (PhoneHubHardwareSnapshot.CLASS_OBD_LIKE.equals(label))   obd++;
                else                                                              unknown++;
            }
            b.bondedDeviceCount(bonded.size())
             .classCounts(phone, audio, obd, unknown);
        } catch (SecurityException se) {
            b.error(ERR_BONDED_SECURITY);
        } catch (Throwable t) {
            b.error(ERR_BONDED_READ_FAILED);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Profiller — YALNIZ DURUM; otorite KANITSIZ atanmaz
     * ════════════════════════════════════════════════════════════════════ */

    private static void readProfiles(BluetoothAdapter adapter, PhoneHubHardwareSnapshot.Builder b) {
        if (adapter == null) {
            b.a2dpConnectionState(PhoneHubHardwareSnapshot.CONN_UNAVAILABLE)
             .headsetConnectionState(PhoneHubHardwareSnapshot.CONN_UNAVAILABLE)
             .gattConnectionState(PhoneHubHardwareSnapshot.CONN_UNAVAILABLE)
             .a2dpControlAuthority(PhoneHubHardwareSnapshot.AUTHORITY_UNAVAILABLE)
             .hfpControlAuthority(PhoneHubHardwareSnapshot.AUTHORITY_UNAVAILABLE)
             .profilesEvidence(PhoneHubHardwareSnapshot.EV_UNKNOWN);
            return;
        }

        boolean enabled;
        try {
            enabled = adapter.isEnabled();
        } catch (Throwable t) {
            enabled = false;
            b.error(ERR_PROFILE_READ_FAILED);
        }

        if (!enabled) {
            /* KRİTİK DÜRÜSTLÜK: adapter kapalıyken profil "DISCONNECTED" DEĞİLDİR —
               OKUNAMAZ. Kapalı adapteri "bağlı değil" diye raporlamak sahte bilgidir. */
            b.a2dpConnectionState(PhoneHubHardwareSnapshot.CONN_UNAVAILABLE)
             .headsetConnectionState(PhoneHubHardwareSnapshot.CONN_UNAVAILABLE)
             .gattConnectionState(PhoneHubHardwareSnapshot.CONN_UNAVAILABLE)
             .a2dpControlAuthority(PhoneHubHardwareSnapshot.AUTHORITY_UNKNOWN)
             .hfpControlAuthority(PhoneHubHardwareSnapshot.AUTHORITY_UNKNOWN)
             .profilesEvidence(PhoneHubHardwareSnapshot.EV_DEVICE_OBSERVED);
            return;
        }

        String a2dp = PhoneHubHardwareSnapshot.CONN_UNKNOWN;
        String hfp  = PhoneHubHardwareSnapshot.CONN_UNKNOWN;
        try {
            a2dp = PhoneHubHardwareSnapshot.mapConnectionState(
                adapter.getProfileConnectionState(BluetoothProfile.A2DP));
            hfp = PhoneHubHardwareSnapshot.mapConnectionState(
                adapter.getProfileConnectionState(BluetoothProfile.HEADSET));
            b.profilesEvidence(PhoneHubHardwareSnapshot.EV_DEVICE_OBSERVED);
        } catch (SecurityException se) {
            b.error(ERR_BT_SECURITY);
            b.profilesEvidence(PhoneHubHardwareSnapshot.EV_UNKNOWN);
        } catch (Throwable t) {
            b.error(ERR_PROFILE_READ_FAILED);
            b.profilesEvidence(PhoneHubHardwareSnapshot.EV_UNKNOWN);
        }

        /* GATT: adapter seviyesinde GÜVENİLİR salt-okunur durum API'si YOKTUR
           (getProfileConnectionState(GATT) birçok cihazda anlamsız sabit döner).
           Tahmin etmek yerine UNAVAILABLE beyan edilir. */
        b.gattConnectionState(PhoneHubHardwareSnapshot.CONN_UNAVAILABLE)
         .error(ERR_GATT_STATE_UNAVAILABLE);

        /* OTORİTE: depoda A2DP Sink / HFP yığınını YÖNETEN kod YOKTUR — profil
           yalnız OKUNUYOR. Bu yüzden `appControlsProfile=false` sabittir ve
           ANDROID_APP otoritesi ASLA verilmez (pozitif kanıt şartı). */
        b.a2dpConnectionState(a2dp)
         .headsetConnectionState(hfp)
         .a2dpControlAuthority(
             PhoneHubHardwareSnapshot.deriveControlAuthority(true, a2dp, false))
         .hfpControlAuthority(
             PhoneHubHardwareSnapshot.deriveControlAuthority(true, hfp, false));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Audio — SALT OKUNUR (mod/route DEĞİŞTİRİLMEZ)
     * ════════════════════════════════════════════════════════════════════ */

    private static void readAudio(Context ctx, PhoneHubHardwareSnapshot.Builder b) {
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) {
                b.error(ERR_AUDIO_READ_FAILED);
                return;
            }
            b.audioMode(am.getMode())
             .musicActive(am.isMusicActive())
             .audioEvidence(PhoneHubHardwareSnapshot.EV_DEVICE_OBSERVED);

            // API 31+ : aktif iletişim cihazı TÜRÜ okunabilir (adres/ad OKUNMAZ).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    AudioDeviceInfo info = am.getCommunicationDevice();
                    b.communicationDeviceType(info == null ? "NONE" : audioTypeLabel(info.getType()));
                } catch (Throwable t) {
                    b.communicationDeviceType("UNKNOWN");
                }
            } else {
                b.communicationDeviceType("UNAVAILABLE");
            }

            /* Ses yolu otoritesi: uygulamamız route DEĞİŞTİRMEZ; head unit'te yolu
               vendor/MCU yığını da sürüyor olabilir → KANITSIZ atama YOK. */
            b.routeAuthority(PhoneHubHardwareSnapshot.AUTHORITY_UNKNOWN);
        } catch (Throwable t) {
            b.error(ERR_AUDIO_READ_FAILED);
        }
    }

    /** Sabit tür etiketi — cihaz adı/adresi ASLA kullanılmaz. */
    private static String audioTypeLabel(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "BLUETOOTH_SCO";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "BLUETOOTH_A2DP";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "BUILTIN_SPEAKER";
            case AudioDeviceInfo.TYPE_BUILTIN_MIC: return "BUILTIN_MIC";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "WIRED_HEADSET";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "WIRED_HEADPHONES";
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "USB_HEADSET";
            default: return "OTHER";
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Vendor — YALNIZ VAR/YOK (bind YOK, intent YOK)
     * ════════════════════════════════════════════════════════════════════ */

    private static void readVendor(Context ctx, PhoneHubHardwareSnapshot.Builder b) {
        try {
            PackageManager pm = ctx.getPackageManager();
            boolean nwd = false;
            try {
                pm.getPackageInfo(VENDOR_PKG_NWD, 0);
                nwd = true;
            } catch (PackageManager.NameNotFoundException nf) {
                nwd = false;
            }

            b.knownVendorPackageDetected(nwd)
             .vendorFamily(nwd ? "NWD" : "UNKNOWN")
             // Paket VARLIĞI yalnız kod/paket gözlemidir — vendor API'nin
             // KULLANILABİLİR olduğunu KANITLAMAZ.
             .vendorEvidence(nwd
                 ? PhoneHubHardwareSnapshot.EV_CODE_OBSERVED
                 : PhoneHubHardwareSnapshot.EV_UNKNOWN);

            /* Vendor broadcast gözlemi: depodaki SystemCanBroadcastAdapter alınan
               yayınlar için ZAMAN DAMGASI/SAYAÇ TUTMAZ → "gözlemlendi" diyecek
               kanıt YOKTUR. Yeni izleyici eklemek bu fazın (salt-okunur) kapsamı
               DIŞINDADIR; bu yüzden dürüstçe "kanıt yok" beyan edilir. */
            b.knownVendorBroadcastObserved(false)
             .vendorLastEvidenceAgeMs(-1L)
             .error(ERR_VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE);
        } catch (Throwable t) {
            b.error(ERR_VENDOR_READ_FAILED);
        }
    }
}
