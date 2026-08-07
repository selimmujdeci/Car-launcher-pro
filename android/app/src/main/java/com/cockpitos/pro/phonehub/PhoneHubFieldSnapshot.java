package com.cockpitos.pro.phonehub;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * PhoneHubFieldSnapshot — PHONE-HUB P0.8 saha doğrulama kanıtı (değişmez değer nesnesi).
 *
 * ── NEDEN ANDROID'DEN BAĞIMSIZ ──────────────────────────────────────────────
 * {@link PhoneHubHardwareSnapshot} ile AYNI gerekçe: depoda Robolectric/Mockito
 * YOKTUR (yalnız {@code junit:junit}), bu yüzden {@code android.*} tipine dokunan
 * her satır düz JUnit'te patlar. TÜM sınıflandırma burada saf statik fonksiyon
 * olarak yaşar → gerçek birim testi mümkün. Android'e dokunan okuma
 * {@link PhoneHubFieldProbe} içindedir.
 *
 * ── P0.5'İ EZMEZ, GENİŞLETİR ────────────────────────────────────────────────
 * {@link PhoneHubHardwareSnapshot} AYNEN korunur (şema sürümü ARTMAZ, alan
 * eklenmez). Bu sınıf AYRI ve YENİ bir snapshot'tır; eski APK'da yeni plugin
 * metodu bulunmadığında JS tarafı {@code present:false} görür → fail-soft.
 *
 * ── P0.7 DERSİ: SUBSTRING EŞLEŞMESİ KANIT DEĞİLDİR ──────────────────────────
 * Saha turunda {@code "android.car"} desen taraması {@code com.android.carrierconfig}
 * yüzünden YANLIŞ POZİTİF verdi ve cihaz bir an için "CarService var" göründü.
 * Bu yüzden paket kontrolü YALNIZ TAM EŞLEŞMEDİR ({@code equals}) — asla
 * {@code contains}/{@code startsWith} değil. Kilit: {@code packageMarker_*} testleri.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * PII TAŞIYAN ALAN YOKTUR: MAC · telefon numarası · kişi adı · mesaj/bildirim
 * içeriği · parça/sanatçı/albüm adı · Bluetooth cihaz adı · cihaz sahibinin adı ·
 * Android ID · pairing key BULUNMAZ. Build fingerprint HAM haliyle taşınmaz —
 * yalnız iki segmentlik ÖZET + geri çevrilemez karma.
 *
 * Üretici/model alanları (manufacturer/model/device/product) DONANIM KİMLİĞİDİR
 * ve bu fazın ASIL sorusudur ("bu cihaz gerçekten head unit mi") — kişiye değil
 * donanıma aittir, bu yüzden taşınır.
 */
public final class PhoneHubFieldSnapshot {

    /** Şema sürümü — alan eklendiğinde/anlamı değiştiğinde ARTIRILIR. */
    public static final int SCHEMA_VERSION = 1;

    /* ── Cihaz rolü ──────────────────────────────────────────────────────── */
    public static final String ROLE_HEAD_UNIT_CONFIRMED    = "HEAD_UNIT_CONFIRMED";
    public static final String ROLE_PHONE_CONFIRMED        = "PHONE_CONFIRMED";
    public static final String ROLE_ANDROID_DEVICE_UNKNOWN = "ANDROID_DEVICE_UNKNOWN";
    public static final String ROLE_UNAVAILABLE            = "UNAVAILABLE";

    /* ── Güven ───────────────────────────────────────────────────────────── */
    public static final String CONF_NONE   = "NONE";
    public static final String CONF_LOW    = "LOW";
    public static final String CONF_MEDIUM = "MEDIUM";
    public static final String CONF_HIGH   = "HIGH";

    /**
     * Üç durumlu bayrak. Boolean YETMEZ: "özellik yok" ile "okuyamadım" AYRI
     * şeylerdir (P0.7'nin ana dersi — okunamayan alan "yok" sayılamaz).
     */
    public static final String TRI_YES     = "YES";
    public static final String TRI_NO      = "NO";
    public static final String TRI_UNKNOWN = "UNKNOWN";

    /* ── Dialer sınıfı (PAKET ADI TAŞINMAZ, yalnız sınıf) ────────────────── */
    public static final String DIALER_AOSP           = "AOSP_TELECOM";
    public static final String DIALER_VENDOR_OR_OEM  = "VENDOR_OR_OEM";
    public static final String DIALER_NONE           = "NONE";
    public static final String DIALER_UNAVAILABLE    = "UNAVAILABLE";

    /* ── MediaSession erişimi ────────────────────────────────────────────── */
    public static final String ACCESS_GRANTED     = "GRANTED";
    public static final String ACCESS_DENIED      = "DENIED";
    public static final String ACCESS_UNAVAILABLE = "UNAVAILABLE";

    /* ── MediaSession sahibi sınıfı (paket adı TAŞINMAZ) ─────────────────── */
    public static final String OWNER_LOCAL  = "LOCAL";
    public static final String OWNER_SYSTEM = "SYSTEM";
    public static final String OWNER_VENDOR = "VENDOR";
    public static final String OWNER_OTHER  = "OTHER";

    /* ── Paket işaret türü ───────────────────────────────────────────────── */
    public static final String MARKER_HEAD_UNIT = "HEAD_UNIT";
    public static final String MARKER_PHONE_OEM = "PHONE_OEM";
    public static final String MARKER_NONE      = "NONE";

    /* ── Hata kodları ────────────────────────────────────────────────────── */
    public static final String ERR_IDENTITY_READ_FAILED   = "IDENTITY_READ_FAILED";
    public static final String ERR_FEATURE_READ_FAILED    = "FEATURE_READ_FAILED";
    public static final String ERR_PACKAGE_READ_FAILED    = "PACKAGE_READ_FAILED";
    public static final String ERR_TELECOM_READ_FAILED    = "TELECOM_READ_FAILED";
    public static final String ERR_DIALER_SECURITY        = "DIALER_SECURITY_EXCEPTION";
    /**
     * {@code MediaSessionManager.getActiveSessions()} etkin bir
     * NotificationListenerService (veya sistem imzası) İSTER. CAROS'ta böyle bir
     * bileşen YOKTUR ve bu fazda EKLENMEZ (izin isteme yasağı) → erişim
     * beklendiği gibi reddedilir ve alanlar UNAVAILABLE kalır. UYDURULMAZ.
     */
    public static final String ERR_MEDIA_SESSION_ACCESS_DENIED = "MEDIA_SESSION_ACCESS_DENIED";
    public static final String ERR_MEDIA_SESSION_UNAVAILABLE   = "MEDIA_SESSION_UNAVAILABLE";
    /** Profil proxy'si BİLİNÇLİ olarak kullanılmadı (bind/unbind sızıntısı riski). */
    public static final String ERR_PROFILE_PROXY_NOT_USED = "PROFILE_PROXY_NOT_USED";

    /* ══════════════════════════════════════════════════════════════════════
     * KANIT LİSTELERİ — hepsi DEPODA GERÇEKTEN KANITLI paketlerdir
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Head unit işaret paketleri. Kaynak: {@code can/K24CanBridge.java#PACKAGES} ve
     * {@code can/McuEventSniffer.java#NWD_PKG_CAN} — gerçek cihazlarda GÖZLENMİŞ
     * paketlerdir. UYDURMA paket adı EKLENMEZ; liste büyümesi ancak yeni bir
     * cihazda gözlemle olur.
     */
    private static final String[] HEAD_UNIT_MARKERS = {
        "com.android.car", "com.android.carservice", "com.android.carsetting",
        "com.hiworld.carsetting", "com.hiworld.canbox",
        "com.carsetting.provider", "com.k24.carsetting",
        "com.mediatek.carsetting", "com.nwd.carsetting", "com.autolink.carsetting",
        "com.nwd.can.setting", "com.nwd.factory.setting", "com.nwd.audio",
    };

    /**
     * Telefon OEM işaret paketleri — cihazın TELEFON olduğunu gösteren yüzeyler.
     * Kaynak: P0.7 saha turunda Xiaomi/Redmi cihazında TAM EŞLEŞME ile gözlenen
     * {@code com.miui.home} ve akrabaları + yaygın OEM launcher paketleri.
     * Bu liste head unit'i DIŞLAMAK için değil, telefonu TEŞHİS etmek içindir.
     */
    private static final String[] PHONE_OEM_MARKERS = {
        "com.miui.home", "com.miui.securitycenter",
        "com.sec.android.app.launcher", "com.samsung.android.dialer",
        "com.huawei.android.launcher", "com.oppo.launcher", "com.oplus.launcher",
        "com.vivo.launcher", "com.bbk.launcher2", "net.oneplus.launcher",
        "com.google.android.apps.nexuslauncher",
    };

    /** AOSP/Google Telecom dialer paketleri — "vendor dialer" ile karıştırılmaz. */
    private static final String[] AOSP_DIALER_PACKAGES = {
        "com.android.dialer", "com.google.android.dialer", "com.android.contacts",
        "com.android.server.telecom",
    };

    /** Vendor/MCU MediaSession sahibi olabilecek paket önekleri — TAM EŞLEŞME listesi. */
    private static final String[] VENDOR_MEDIA_PACKAGES = {
        "com.nwd.audio", "com.hiworld.canbox", "com.nwd.carsetting",
        "com.autolink.carsetting", "com.mediatek.carsetting",
    };

    /* ══════════════════════════════════════════════════════════════════════
     * Alanlar
     * ════════════════════════════════════════════════════════════════════ */

    public final int    schemaVersion;
    /** Duvar-saati damgası (ms). 0 = damga YOK. */
    public final long   capturedAt;

    // Cihaz kimliği (DONANIM kimliği — kişisel veri değil)
    public final String manufacturer;
    public final String model;
    public final String device;
    public final String product;
    public final String androidRelease;
    public final int    sdkInt;
    /** Ham fingerprint TAŞINMAZ — yalnız iki segmentlik özet. */
    public final String fingerprintSummary;
    /** Geri çevrilemez karma (FNV-1a hex) — cihaz kaydını eşleştirmek için. */
    public final String fingerprintHash;

    // Head unit / telefon işaretleri
    public final String automotiveFeature;
    public final String carServicePresent;
    public final String telephonyFeature;
    public final int    headUnitMarkerCount;
    public final int    phoneOemMarkerCount;
    public final String vendorFamily;
    /** Bu sınıfın SAF kuralıyla hesaplanmış rol — kullanıcı onayı KATILMAMIŞTIR. */
    public final String deviceRoleTechnical;
    public final String deviceRoleConfidence;

    // Çağrı / HFP yüzeyi
    public final String dialerClass;
    public final String telecomManagerAvailable;
    public final int    callVendorMarkerCount;

    // MediaSession yüzeyi
    public final String mediaSessionAccess;
    /** -1 = okunamadı (0 oturum DEĞİL). */
    public final int    activeSessionCount;
    public final int    ownerLocalCount;
    public final int    ownerSystemCount;
    public final int    ownerVendorCount;
    public final int    ownerOtherCount;
    public final String playbackStatePresent;
    public final String metadataPresent;
    public final String artworkPresent;
    public final String transportControlsPresent;

    public final List<String> errors;

    private PhoneHubFieldSnapshot(Builder b) {
        this.schemaVersion = SCHEMA_VERSION;
        this.capturedAt    = b.capturedAt;

        this.manufacturer       = safe(b.manufacturer);
        this.model              = safe(b.model);
        this.device             = safe(b.device);
        this.product            = safe(b.product);
        this.androidRelease     = safe(b.androidRelease);
        this.sdkInt             = b.sdkInt;
        this.fingerprintSummary = safe(b.fingerprintSummary);
        this.fingerprintHash    = safe(b.fingerprintHash);

        this.automotiveFeature   = tri(b.automotiveFeature);
        this.carServicePresent   = tri(b.carServicePresent);
        this.telephonyFeature    = tri(b.telephonyFeature);
        this.headUnitMarkerCount = b.headUnitMarkerCount;
        this.phoneOemMarkerCount = b.phoneOemMarkerCount;
        this.vendorFamily        = safe(b.vendorFamily);

        int signals = countHeadUnitSignals(
            b.automotiveFeature, b.carServicePresent, b.headUnitMarkerCount);
        boolean readable = isIdentityReadable(b.manufacturer, b.sdkInt);
        this.deviceRoleTechnical = classifyDeviceRole(
            signals, b.phoneOemMarkerCount, b.telephonyFeature, false, readable);
        this.deviceRoleConfidence = roleConfidence(
            this.deviceRoleTechnical, signals, b.phoneOemMarkerCount, false);

        this.dialerClass             = safeEnum(b.dialerClass, DIALER_UNAVAILABLE);
        this.telecomManagerAvailable = tri(b.telecomManagerAvailable);
        this.callVendorMarkerCount   = b.callVendorMarkerCount;

        this.mediaSessionAccess       = safeEnum(b.mediaSessionAccess, ACCESS_UNAVAILABLE);
        this.activeSessionCount       = b.activeSessionCount;
        this.ownerLocalCount          = b.ownerLocalCount;
        this.ownerSystemCount         = b.ownerSystemCount;
        this.ownerVendorCount         = b.ownerVendorCount;
        this.ownerOtherCount          = b.ownerOtherCount;
        this.playbackStatePresent     = tri(b.playbackStatePresent);
        this.metadataPresent          = tri(b.metadataPresent);
        this.artworkPresent           = tri(b.artworkPresent);
        this.transportControlsPresent = tri(b.transportControlsPresent);

        List<String> e = new ArrayList<>();
        if (b.errors != null) {
            for (String s : b.errors) if (s != null && s.length() > 0) e.add(s);
        }
        this.errors = Collections.unmodifiableList(e);
    }

    private static String safe(String v) {
        return (v == null || v.length() == 0) ? "UNKNOWN" : v;
    }

    private static String safeEnum(String v, String fallback) {
        return (v == null || v.length() == 0) ? fallback : v;
    }

    /** Bilinmeyen/boş üç-durumlu değer UNKNOWN'a düşer — "NO" UYDURULMAZ. */
    private static String tri(String v) {
        if (TRI_YES.equals(v) || TRI_NO.equals(v)) return v;
        return TRI_UNKNOWN;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * SAF SINIFLANDIRMA — düz JUnit ile test edilir
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Paket işaret sınıflandırması — YALNIZ TAM EŞLEŞME.
     *
     * P0.7 dersi: {@code contains("android.car")} → {@code com.android.carrierconfig}
     * eşleşiyor ve cihaz yanlışlıkla otomotiv görünüyor. Bu fonksiyon ASLA
     * kısmi eşleşme yapmaz.
     */
    public static String classifyPackageMarker(String pkg) {
        if (pkg == null || pkg.length() == 0) return MARKER_NONE;
        for (String m : HEAD_UNIT_MARKERS) if (m.equals(pkg)) return MARKER_HEAD_UNIT;
        for (String m : PHONE_OEM_MARKERS) if (m.equals(pkg)) return MARKER_PHONE_OEM;
        return MARKER_NONE;
    }

    /** Vendor MediaSession sahibi mi (TAM EŞLEŞME). */
    public static boolean isVendorMediaPackage(String pkg) {
        if (pkg == null) return false;
        for (String m : VENDOR_MEDIA_PACKAGES) if (m.equals(pkg)) return true;
        return false;
    }

    /**
     * Varsayılan dialer paketini SINIFA çevirir — paket adının KENDİSİ dışarı
     * çıkmaz. {@code null} = okunamadı → UNAVAILABLE ("dialer yok" DEĞİL).
     */
    public static String classifyDialer(String pkg) {
        if (pkg == null) return DIALER_UNAVAILABLE;
        if (pkg.length() == 0) return DIALER_NONE;
        for (String m : AOSP_DIALER_PACKAGES) if (m.equals(pkg)) return DIALER_AOSP;
        return DIALER_VENDOR_OR_OEM;
    }

    /**
     * MediaSession sahibi paketini SINIFA çevirir (paket adı taşınmaz).
     *
     * @param pkg     oturum sahibi paket
     * @param selfPkg uygulamamızın paketi (LOCAL kararı için)
     */
    public static String classifySessionOwner(String pkg, String selfPkg) {
        if (pkg == null || pkg.length() == 0) return OWNER_OTHER;
        if (selfPkg != null && selfPkg.length() > 0 && selfPkg.equals(pkg)) return OWNER_LOCAL;
        if (isVendorMediaPackage(pkg)) return OWNER_VENDOR;
        if ("com.android.server.telecom".equals(pkg)
            || "com.android.bluetooth".equals(pkg)
            || "com.android.systemui".equals(pkg)) return OWNER_SYSTEM;
        return OWNER_OTHER;
    }

    /**
     * Ham build fingerprint'ten İKİ SEGMENTLİK özet üretir.
     * Ham fingerprint bazı ROM'larda derleme kullanıcısı/host adı taşıyabildiği için
     * TAMAMI ASLA dışarı çıkmaz.
     *
     * Örnek: {@code Redmi/zircon_in/zircon:13/TP1A…} → {@code Redmi/zircon_in/…}
     */
    public static String summarizeFingerprint(String fp) {
        if (fp == null || fp.length() == 0) return "UNKNOWN";
        int first = fp.indexOf('/');
        if (first < 0) return "OPAQUE";
        int second = fp.indexOf('/', first + 1);
        if (second < 0) return fp.substring(0, first) + "/…";
        return fp.substring(0, second) + "/…";
    }

    /**
     * Geri çevrilemez kısa karma (FNV-1a 32-bit hex). Amaç: aynı cihazın iki
     * oturumunu EŞLEŞTİRMEK. Kriptografik değildir ve öyle sunulmaz; ham değeri
     * geri vermez.
     */
    public static String hashToken(String v) {
        if (v == null || v.length() == 0) return "UNKNOWN";
        int h = 0x811C9DC5;
        for (int i = 0; i < v.length(); i++) {
            h ^= v.charAt(i);
            h *= 0x01000193;
        }
        return String.format("%08x", h);
    }

    /** Kimlik okunabildi mi (üretici VAR ve SDK pozitif). */
    public static boolean isIdentityReadable(String manufacturer, int sdkInt) {
        return manufacturer != null && manufacturer.length() > 0 && sdkInt > 0;
    }

    /**
     * BAĞIMSIZ head unit sinyali sayısı.
     *
     * KRİTİK (görev §2): {@code android.hardware.type.automotive} YOKLUĞU tek başına
     * cihazın head unit OLMADIĞINI KANITLAMAZ — pek çok aftermarket ünite sıradan
     * Android tablet yapısındadır. Bu yüzden sinyaller TOPLANIR, biri veto ETMEZ.
     */
    public static int countHeadUnitSignals(String automotiveFeature,
                                           String carServicePresent,
                                           int headUnitMarkerCount) {
        int n = 0;
        if (TRI_YES.equals(automotiveFeature)) n++;
        if (TRI_YES.equals(carServicePresent)) n++;
        if (headUnitMarkerCount > 0) n++;
        return n;
    }

    /**
     * Cihaz rolü — BİRLEŞİK KANIT MODELİ.
     *
     * KURAL SIRASI:
     *  0. kimlik okunamadı                                   → UNAVAILABLE
     *  1. telefon OEM işareti VAR + telefon özelliği VAR +
     *     head unit sinyali SIFIR                            → PHONE_CONFIRMED
     *  2. ≥2 bağımsız teknik head unit sinyali               → HEAD_UNIT_CONFIRMED
     *  3. 1 teknik sinyal + kullanıcı onayı                  → HEAD_UNIT_CONFIRMED
     *  4. aksi hâlde                                         → ANDROID_DEVICE_UNKNOWN
     *
     * KULLANICI ONAYI TEKNİK KANITIN YERİNE GEÇMEZ (görev §2): sıfır teknik
     * sinyalle onay VERİLSE BİLE rol HEAD_UNIT_CONFIRMED OLMAZ — yalnız bir
     * evidence kaydı olarak taşınır. Telefon teşhis edilmişse onay rolü EZMEZ.
     */
    public static String classifyDeviceRole(int headUnitSignals,
                                            int phoneOemMarkerCount,
                                            String telephonyFeature,
                                            boolean userAffirmedHeadUnit,
                                            boolean identityReadable) {
        if (!identityReadable) return ROLE_UNAVAILABLE;

        boolean phoneDominant = phoneOemMarkerCount > 0
            && TRI_YES.equals(telephonyFeature)
            && headUnitSignals == 0;
        if (phoneDominant) return ROLE_PHONE_CONFIRMED;

        if (headUnitSignals >= 2) return ROLE_HEAD_UNIT_CONFIRMED;
        if (headUnitSignals == 1 && userAffirmedHeadUnit) return ROLE_HEAD_UNIT_CONFIRMED;

        return ROLE_ANDROID_DEVICE_UNKNOWN;
    }

    /**
     * Rol güveni. Onayla yükseltilen rol ASLA HIGH olmaz (tek teknik sinyal +
     * beyan = orta güven).
     */
    public static String roleConfidence(String role,
                                        int headUnitSignals,
                                        int phoneOemMarkerCount,
                                        boolean userAffirmedHeadUnit) {
        if (ROLE_UNAVAILABLE.equals(role)) return CONF_NONE;
        if (ROLE_HEAD_UNIT_CONFIRMED.equals(role)) {
            if (headUnitSignals >= 3) return CONF_HIGH;
            if (headUnitSignals >= 2) return CONF_HIGH;
            return userAffirmedHeadUnit ? CONF_MEDIUM : CONF_LOW;
        }
        if (ROLE_PHONE_CONFIRMED.equals(role)) {
            return phoneOemMarkerCount >= 2 ? CONF_HIGH : CONF_MEDIUM;
        }
        return headUnitSignals > 0 ? CONF_LOW : CONF_NONE;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Builder — fail-soft varsayılanlar (SAHTE DEĞER YOK)
     * ════════════════════════════════════════════════════════════════════ */

    public static final class Builder {
        long   capturedAt = 0L;

        String manufacturer = null;
        String model = null;
        String device = null;
        String product = null;
        String androidRelease = null;
        int    sdkInt = -1;
        String fingerprintSummary = null;
        String fingerprintHash = null;

        String automotiveFeature = TRI_UNKNOWN;
        String carServicePresent = TRI_UNKNOWN;
        String telephonyFeature  = TRI_UNKNOWN;
        int    headUnitMarkerCount = -1;
        int    phoneOemMarkerCount = -1;
        String vendorFamily = "UNKNOWN";

        String dialerClass = DIALER_UNAVAILABLE;
        String telecomManagerAvailable = TRI_UNKNOWN;
        int    callVendorMarkerCount = -1;

        String mediaSessionAccess = ACCESS_UNAVAILABLE;
        int    activeSessionCount = -1;
        int    ownerLocalCount = -1;
        int    ownerSystemCount = -1;
        int    ownerVendorCount = -1;
        int    ownerOtherCount = -1;
        String playbackStatePresent = TRI_UNKNOWN;
        String metadataPresent = TRI_UNKNOWN;
        String artworkPresent = TRI_UNKNOWN;
        String transportControlsPresent = TRI_UNKNOWN;

        final List<String> errors = new ArrayList<>();

        public Builder capturedAt(long v) { this.capturedAt = v; return this; }
        public Builder manufacturer(String v) { this.manufacturer = v; return this; }
        public Builder model(String v) { this.model = v; return this; }
        public Builder device(String v) { this.device = v; return this; }
        public Builder product(String v) { this.product = v; return this; }
        public Builder androidRelease(String v) { this.androidRelease = v; return this; }
        public Builder sdkInt(int v) { this.sdkInt = v; return this; }
        public Builder fingerprintSummary(String v) { this.fingerprintSummary = v; return this; }
        public Builder fingerprintHash(String v) { this.fingerprintHash = v; return this; }

        public Builder automotiveFeature(String v) { this.automotiveFeature = v; return this; }
        public Builder carServicePresent(String v) { this.carServicePresent = v; return this; }
        public Builder telephonyFeature(String v) { this.telephonyFeature = v; return this; }
        public Builder headUnitMarkerCount(int v) { this.headUnitMarkerCount = v; return this; }
        public Builder phoneOemMarkerCount(int v) { this.phoneOemMarkerCount = v; return this; }
        public Builder vendorFamily(String v) { this.vendorFamily = v; return this; }

        public Builder dialerClass(String v) { this.dialerClass = v; return this; }
        public Builder telecomManagerAvailable(String v) { this.telecomManagerAvailable = v; return this; }
        public Builder callVendorMarkerCount(int v) { this.callVendorMarkerCount = v; return this; }

        public Builder mediaSessionAccess(String v) { this.mediaSessionAccess = v; return this; }
        public Builder activeSessionCount(int v) { this.activeSessionCount = v; return this; }
        public Builder ownerCounts(int local, int system, int vendor, int other) {
            this.ownerLocalCount = local; this.ownerSystemCount = system;
            this.ownerVendorCount = vendor; this.ownerOtherCount = other;
            return this;
        }
        public Builder playbackStatePresent(String v) { this.playbackStatePresent = v; return this; }
        public Builder metadataPresent(String v) { this.metadataPresent = v; return this; }
        public Builder artworkPresent(String v) { this.artworkPresent = v; return this; }
        public Builder transportControlsPresent(String v) { this.transportControlsPresent = v; return this; }

        /** Sınıflandırılmış hata kodu — serbest metin/yığın izi/dosya yolu YASAK. */
        public Builder error(String code) {
            if (code != null && code.length() > 0 && errors.size() < 16) errors.add(code);
            return this;
        }

        public PhoneHubFieldSnapshot build() { return new PhoneHubFieldSnapshot(this); }
    }
}
