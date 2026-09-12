package com.cockpitos.pro.phonehub;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.telecom.TelecomManager;

import java.util.List;

/**
 * PhoneHubFieldProbe — PHONE-HUB P0.8 · SALT-OKUNUR saha doğrulama gözlemi.
 *
 * ── BU SINIF NE YAPMAZ (pazarlıksız) ────────────────────────────────────────
 * Bluetooth keşfi BAŞLATMAZ · eşleştirme YAPMAZ · soket/GATT AÇMAZ · BLE taraması
 * BAŞLATMAZ · adapter aç-kapat YAPMAZ · SCO BAŞLATMAZ · ses modunu/yolunu
 * DEĞİŞTİRMEZ · medya tuşu veya transport komutu GÖNDERMEZ · çağrı BAŞLATMAZ ·
 * SMS GÖNDERMEZ · izin İSTEMEZ · vendor servisine BIND OLMAZ · vendor intent
 * YAYINLAMAZ · profil proxy'si AÇMAZ · OBD'ye DOKUNMAZ.
 *
 * Statik güvenlik testi bu dosyada yasaklı çağrı dizelerinin sıfır kez geçtiğini
 * doğrular ({@code PhoneHubFieldProbeTest}).
 *
 * ── PROFİL PROXY'Sİ BİLİNÇLİ OLARAK KULLANILMADI ────────────────────────────
 * {@code getProfileProxy} asenkron bir dinleyici kaydeder ve {@code closeProfileProxy}
 * çağrılmazsa servis bağlantısı SIZAR (zero-leak ihlali). Bu fazın kazancı
 * ({@code getProfileConnectionState} ile zaten okunan durumun tekrarı) riski
 * karşılamıyor → P0.5'in BLOCKER-8'i AÇIK bırakılır ve
 * {@link PhoneHubFieldSnapshot#ERR_PROFILE_PROXY_NOT_USED} ile DÜRÜSTÇE beyan edilir.
 *
 * ── MEDIASESSION ERİŞİMİ BEKLENEN ŞEKİLDE KISITLI ───────────────────────────
 * {@code getActiveSessions()} etkin bir NotificationListenerService veya sistem
 * imzası ister. CAROS'ta böyle bir bileşen YOKTUR ve bu fazda EKLENMEZ. Bu yüzden
 * alan çoğu cihazda DENIED/UNAVAILABLE kalır — bu bir HATA DEĞİL, ölçülmüş bir
 * mimari gerçektir ve saha aracında blocker olarak görünür.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Her okuma kendi try/catch'inde; {@code SecurityException} · {@code NoSuchMethodError} ·
 * {@code NullPointerException} uygulamayı ÇÖKERTMEZ. Okunamayan alan UNKNOWN /
 * UNAVAILABLE kalır — "NO" veya 0 UYDURULMAZ.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Paket ADI dışarı ÇIKMAZ (yalnız sınıf ve sayım) · parça/sanatçı/albüm adı
 * OKUNMAZ (yalnız "alan var mı") · albüm kapağı VERİSİ okunmaz (yalnız varlığı) ·
 * telefon numarası · kişi adı · çağrı geçmişi HİÇ okunmaz · ham build fingerprint
 * özetlenir.
 */
public final class PhoneHubFieldProbe {

    private PhoneHubFieldProbe() { }

    /**
     * Tek atışlık salt-okunur saha gözlemi.
     *
     * @param ctx   uygulama context'i (null olabilir → fail-soft)
     * @param nowMs duvar-saati damgası (çağıran verir; bu sınıf saat OKUMAZ ki test edilebilsin)
     */
    public static PhoneHubFieldSnapshot capture(Context ctx, long nowMs) {
        PhoneHubFieldSnapshot.Builder b = new PhoneHubFieldSnapshot.Builder()
            .capturedAt(nowMs);

        readIdentity(b);

        if (ctx == null) {
            return b.error(PhoneHubFieldSnapshot.ERR_IDENTITY_READ_FAILED)
                    .error(PhoneHubFieldSnapshot.ERR_PROFILE_PROXY_NOT_USED)
                    .build();
        }

        readFeatures(ctx, b);
        readPackageMarkers(ctx, b);
        readCallSurface(ctx, b);
        readMediaSurface(ctx, b);

        // Profil proxy'si BİLİNÇLİ olarak kullanılmadı — sessizce atlanmaz, beyan edilir.
        b.error(PhoneHubFieldSnapshot.ERR_PROFILE_PROXY_NOT_USED);

        return b.build();
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Cihaz kimliği — Build sabitleri (salt-okunur, izin gerektirmez)
     * ════════════════════════════════════════════════════════════════════ */

    private static void readIdentity(PhoneHubFieldSnapshot.Builder b) {
        try {
            b.manufacturer(Build.MANUFACTURER)
             .model(Build.MODEL)
             .device(Build.DEVICE)
             .product(Build.PRODUCT)
             .androidRelease(Build.VERSION.RELEASE)
             .sdkInt(Build.VERSION.SDK_INT);

            String fp = Build.FINGERPRINT;
            // HAM fingerprint TAŞINMAZ: yalnız iki segment + geri çevrilemez karma.
            b.fingerprintSummary(PhoneHubFieldSnapshot.summarizeFingerprint(fp))
             .fingerprintHash(PhoneHubFieldSnapshot.hashToken(fp));
        } catch (Throwable t) {
            b.error(PhoneHubFieldSnapshot.ERR_IDENTITY_READ_FAILED);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sistem özellikleri — hasSystemFeature (salt-okunur)
     * ════════════════════════════════════════════════════════════════════ */

    private static void readFeatures(Context ctx, PhoneHubFieldSnapshot.Builder b) {
        try {
            PackageManager pm = ctx.getPackageManager();
            if (pm == null) {
                b.error(PhoneHubFieldSnapshot.ERR_FEATURE_READ_FAILED);
                return;
            }
            b.automotiveFeature(tri(pm.hasSystemFeature("android.hardware.type.automotive")))
             .telephonyFeature(tri(pm.hasSystemFeature("android.hardware.telephony")));
        } catch (Throwable t) {
            b.error(PhoneHubFieldSnapshot.ERR_FEATURE_READ_FAILED);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Paket işaretleri — TAM EŞLEŞME (substring YOK) · yalnız SAYIM
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Yüklü paketleri TEK KEZ listeler ve TAM EŞLEŞME ile sınıflandırır.
     *
     * Paket ADI hiçbir alana yazılmaz — yalnız sayım ve (ilk eşleşen head unit
     * işaretinden) vendor AİLESİ etiketi çıkar.
     */
    private static void readPackageMarkers(Context ctx, PhoneHubFieldSnapshot.Builder b) {
        try {
            PackageManager pm = ctx.getPackageManager();
            if (pm == null) {
                b.error(PhoneHubFieldSnapshot.ERR_PACKAGE_READ_FAILED);
                return;
            }

            List<android.content.pm.PackageInfo> installed = pm.getInstalledPackages(0);
            if (installed == null) {
                b.error(PhoneHubFieldSnapshot.ERR_PACKAGE_READ_FAILED);
                return;
            }

            int headUnit = 0, phoneOem = 0, callVendor = 0;
            String family = "UNKNOWN";
            boolean carService = false;

            for (android.content.pm.PackageInfo pi : installed) {
                if (pi == null || pi.packageName == null) continue;
                String pkg = pi.packageName;

                String marker = PhoneHubFieldSnapshot.classifyPackageMarker(pkg);
                if (PhoneHubFieldSnapshot.MARKER_HEAD_UNIT.equals(marker)) {
                    headUnit++;
                    if ("UNKNOWN".equals(family)) family = vendorFamilyOf(pkg);
                } else if (PhoneHubFieldSnapshot.MARKER_PHONE_OEM.equals(marker)) {
                    phoneOem++;
                }

                // CarService AYRI bir sinyaldir — TAM EŞLEŞME (P0.7 yanlış-pozitif dersi).
                if ("com.android.car".equals(pkg) || "com.android.carservice".equals(pkg)) {
                    carService = true;
                }

                if (PhoneHubFieldSnapshot.isVendorMediaPackage(pkg)) callVendor++;
            }

            b.headUnitMarkerCount(headUnit)
             .phoneOemMarkerCount(phoneOem)
             .callVendorMarkerCount(callVendor)
             .carServicePresent(tri(carService))
             .vendorFamily(family);
        } catch (Throwable t) {
            // Android 11+ paket görünürlüğü kısıtları burada devreye girebilir →
            // sayımlar -1 (okunamadı) KALIR, 0 (yok) DENMEZ.
            b.error(PhoneHubFieldSnapshot.ERR_PACKAGE_READ_FAILED);
        }
    }

    /** İlk eşleşen head unit paketinden vendor ailesi — uydurma YOK, sabit eşleme. */
    private static String vendorFamilyOf(String pkg) {
        if (pkg.startsWith("com.nwd.")) return "NWD";
        if (pkg.startsWith("com.hiworld.")) return "HIWORLD";
        if (pkg.startsWith("com.autolink.")) return "AUTOLINK";
        if (pkg.startsWith("com.mediatek.")) return "MEDIATEK";
        if (pkg.startsWith("com.k24.")) return "K24";
        if (pkg.startsWith("com.android.")) return "AOSP_CAR";
        return "UNKNOWN";
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Çağrı yüzeyi — SALT OKUNUR (çağrı BAŞLATILMAZ, numara/geçmiş OKUNMAZ)
     * ════════════════════════════════════════════════════════════════════ */

    private static void readCallSurface(Context ctx, PhoneHubFieldSnapshot.Builder b) {
        try {
            TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
            if (tm == null) {
                b.telecomManagerAvailable(PhoneHubFieldSnapshot.TRI_NO)
                 .dialerClass(PhoneHubFieldSnapshot.DIALER_UNAVAILABLE);
                return;
            }
            b.telecomManagerAvailable(PhoneHubFieldSnapshot.TRI_YES);

            /* Varsayılan dialer PAKET ADI yalnız yerel değişkende yaşar ve SINIFA
               çevrilir; snapshot'a paket adı YAZILMAZ. Çağrı geçmişi, numara ve
               kişi verisi HİÇ okunmaz (izin de istenmez). */
            String dialer = null;
            try {
                dialer = tm.getDefaultDialerPackage();
            } catch (SecurityException se) {
                b.error(PhoneHubFieldSnapshot.ERR_DIALER_SECURITY);
            } catch (Throwable t) {
                b.error(PhoneHubFieldSnapshot.ERR_TELECOM_READ_FAILED);
            }
            b.dialerClass(PhoneHubFieldSnapshot.classifyDialer(dialer));
        } catch (Throwable t) {
            b.error(PhoneHubFieldSnapshot.ERR_TELECOM_READ_FAILED);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * MediaSession yüzeyi — YALNIZ VARLIK/SAYIM (başlık/sanatçı/kapak OKUNMAZ)
     * ════════════════════════════════════════════════════════════════════ */

    private static void readMediaSurface(Context ctx, PhoneHubFieldSnapshot.Builder b) {
        MediaSessionManager msm;
        try {
            msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
        } catch (Throwable t) {
            b.mediaSessionAccess(PhoneHubFieldSnapshot.ACCESS_UNAVAILABLE)
             .error(PhoneHubFieldSnapshot.ERR_MEDIA_SESSION_UNAVAILABLE);
            return;
        }
        if (msm == null) {
            b.mediaSessionAccess(PhoneHubFieldSnapshot.ACCESS_UNAVAILABLE)
             .error(PhoneHubFieldSnapshot.ERR_MEDIA_SESSION_UNAVAILABLE);
            return;
        }

        List<MediaController> sessions;
        try {
            /* Etkin NotificationListenerService YOKSA burası SecurityException atar.
               Bu BEKLENEN durumdur: izin İSTENMEZ, dinleyici EKLENMEZ → alanlar
               UNAVAILABLE kalır ve saha aracında blocker olarak görünür. */
            sessions = msm.getActiveSessions((ComponentName) null);
        } catch (SecurityException se) {
            b.mediaSessionAccess(PhoneHubFieldSnapshot.ACCESS_DENIED)
             .error(PhoneHubFieldSnapshot.ERR_MEDIA_SESSION_ACCESS_DENIED);
            return;
        } catch (Throwable t) {
            b.mediaSessionAccess(PhoneHubFieldSnapshot.ACCESS_UNAVAILABLE)
             .error(PhoneHubFieldSnapshot.ERR_MEDIA_SESSION_UNAVAILABLE);
            return;
        }

        if (sessions == null) {
            b.mediaSessionAccess(PhoneHubFieldSnapshot.ACCESS_UNAVAILABLE)
             .error(PhoneHubFieldSnapshot.ERR_MEDIA_SESSION_UNAVAILABLE);
            return;
        }

        String selfPkg = null;
        try { selfPkg = ctx.getPackageName(); } catch (Throwable ignored) { /* fail-soft */ }

        int local = 0, system = 0, vendor = 0, other = 0;
        boolean anyPlayback = false, anyMetadata = false, anyArtwork = false, anyTransport = false;

        for (MediaController c : sessions) {
            if (c == null) continue;

            String owner;
            try {
                owner = PhoneHubFieldSnapshot.classifySessionOwner(c.getPackageName(), selfPkg);
            } catch (Throwable t) {
                owner = PhoneHubFieldSnapshot.OWNER_OTHER;
            }
            if (PhoneHubFieldSnapshot.OWNER_LOCAL.equals(owner)) local++;
            else if (PhoneHubFieldSnapshot.OWNER_SYSTEM.equals(owner)) system++;
            else if (PhoneHubFieldSnapshot.OWNER_VENDOR.equals(owner)) vendor++;
            else other++;

            try {
                PlaybackState ps = c.getPlaybackState();
                if (ps != null) anyPlayback = true;
            } catch (Throwable ignored) { /* fail-soft */ }

            try {
                /* GİZLİLİK: metadata DEĞERLERİ okunmaz. Yalnız anahtarın VAR olup
                   olmadığına bakılır — parça/sanatçı/albüm adı ve kapak baytları
                   hiçbir yere kopyalanmaz. */
                MediaMetadata md = c.getMetadata();
                if (md != null) {
                    anyMetadata = true;
                    if (md.containsKey(MediaMetadata.METADATA_KEY_ALBUM_ART)
                        || md.containsKey(MediaMetadata.METADATA_KEY_ALBUM_ART_URI)
                        || md.containsKey(MediaMetadata.METADATA_KEY_ART)) {
                        anyArtwork = true;
                    }
                }
            } catch (Throwable ignored) { /* fail-soft */ }

            try {
                /* Transport YETENEĞİ yalnız BAYRAKTAN okunur. getTransportControls()
                   BİLEREK çağrılmaz — komut yüzeyine hiç dokunmayız. */
                if ((c.getFlags() & MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS) != 0L) {
                    anyTransport = true;
                }
            } catch (Throwable ignored) { /* fail-soft */ }
        }

        b.mediaSessionAccess(PhoneHubFieldSnapshot.ACCESS_GRANTED)
         .activeSessionCount(sessions.size())
         .ownerCounts(local, system, vendor, other)
         .playbackStatePresent(tri(anyPlayback))
         .metadataPresent(tri(anyMetadata))
         .artworkPresent(tri(anyArtwork))
         .transportControlsPresent(sessions.isEmpty()
             ? PhoneHubFieldSnapshot.TRI_UNKNOWN
             : tri(anyTransport));
    }

    /** boolean → üç durumlu bayrak (okunamayan alan için TRI_UNKNOWN ayrı yazılır). */
    private static String tri(boolean v) {
        return v ? PhoneHubFieldSnapshot.TRI_YES : PhoneHubFieldSnapshot.TRI_NO;
    }
}
