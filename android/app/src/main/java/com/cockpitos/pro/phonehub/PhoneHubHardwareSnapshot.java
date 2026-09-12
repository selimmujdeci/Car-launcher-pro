package com.cockpitos.pro.phonehub;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * PhoneHubHardwareSnapshot — PHONE-HUB P0.5 salt-okunur donanım kanıtı (değişmez değer nesnesi).
 *
 * ── NEDEN ANDROID'DEN BAĞIMSIZ ──────────────────────────────────────────────
 * Bu sınıf BİLEREK hiçbir {@code android.*} tipi import ETMEZ. Sebep: depoda
 * Robolectric/Mockito YOKTUR (yalnız {@code junit:junit}); Android tiplerine dokunan
 * her satır düz JUnit'te "not mocked" ile patlar. Tüm SINIFLANDIRMA ve TÜRETME
 * mantığı burada saf statik fonksiyonlar olarak yaşar → gerçek birim testi mümkün.
 * Android'e dokunan okuma {@link PhoneHubHardwareProbe} içindedir.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · IMMUTABLE: tüm alanlar {@code final}, listeler {@code unmodifiableList}.
 *  · VERSİYONLU: {@link #SCHEMA_VERSION} — JS tarafı şema kaymasını görebilsin.
 *  · FAIL-SOFT: hiçbir kurucu istisna fırlatmaz; bilinmeyen değer UNKNOWN'dır.
 *  · PII YOK: cihaz adı · MAC · kişi adı · telefon modeli · pairing key BULUNMAZ.
 *    Yalnız SAYIM ve ENUM taşınır.
 *
 * ── "BAĞLI GÖRÜNMEK" YETENEK KANITI DEĞİLDİR ────────────────────────────────
 * A2DP/HFP profilinin CONNECTED görünmesi, CAROS uygulamasının o ses yolunu
 * KONTROL ETTİĞİNİ göstermez (vendor/MCU yığını da bağlamış olabilir). Bu yüzden
 * bağlantı DURUMU ile kontrol OTORİTESİ ayrı alanlardır ve otorite varsayılan
 * olarak {@link #AUTHORITY_UNKNOWN}'dır.
 */
public final class PhoneHubHardwareSnapshot {

    /** Şema sürümü — alan eklendiğinde/anlamı değiştiğinde ARTIRILIR. */
    public static final int SCHEMA_VERSION = 1;

    /* ── Kanıt sınıfları (kaynak güveni) ─────────────────────────────────── */
    public static final String EV_CODE_OBSERVED   = "CODE_OBSERVED";
    public static final String EV_DEVICE_OBSERVED = "DEVICE_OBSERVED";
    public static final String EV_VENDOR_DECLARED = "VENDOR_DECLARED";
    public static final String EV_INFERRED        = "INFERRED";
    public static final String EV_UNKNOWN         = "UNKNOWN";

    /* ── Bağlantı durumu (Android sabitlerinden BAĞIMSIZ kendi sözleşmemiz) ── */
    public static final String CONN_DISCONNECTED  = "DISCONNECTED";
    public static final String CONN_CONNECTING    = "CONNECTING";
    public static final String CONN_CONNECTED     = "CONNECTED";
    public static final String CONN_DISCONNECTING = "DISCONNECTING";
    /** Okunamadı / izin yok / adapter kapalı — "bağlı değil" ile KARIŞTIRILMAZ. */
    public static final String CONN_UNKNOWN       = "UNKNOWN";
    public static final String CONN_UNAVAILABLE   = "UNAVAILABLE";

    /* ── Kontrol otoritesi ───────────────────────────────────────────────── */
    public static final String AUTHORITY_UNKNOWN      = "UNKNOWN";
    public static final String AUTHORITY_VENDOR_STACK = "VENDOR_STACK";
    public static final String AUTHORITY_MCU_STACK    = "MCU_STACK";
    public static final String AUTHORITY_ANDROID_APP  = "ANDROID_APP";
    public static final String AUTHORITY_UNAVAILABLE  = "UNAVAILABLE";

    /* ── İzin durumu ─────────────────────────────────────────────────────── */
    public static final String PERM_GRANTED     = "GRANTED";
    public static final String PERM_DENIED      = "DENIED";
    /** Bu API seviyesinde böyle bir izin YOK (denied ile KARIŞTIRILMAZ). */
    public static final String PERM_NOT_APPLICABLE = "NOT_APPLICABLE";
    public static final String PERM_UNKNOWN     = "UNKNOWN";

    /* ── Keşif durumu (üç durumlu — boolean DEĞİL) ───────────────────────── */
    public static final String DISCOVERY_ACTIVE   = "ACTIVE";
    public static final String DISCOVERY_INACTIVE = "INACTIVE";
    public static final String DISCOVERY_UNKNOWN  = "UNKNOWN";

    /* ── Çakışma riski ───────────────────────────────────────────────────── */
    public static final String RISK_NONE_OBSERVED = "NONE_OBSERVED";
    public static final String RISK_POSSIBLE      = "POSSIBLE";
    public static final String RISK_HIGH          = "HIGH";
    public static final String RISK_UNKNOWN       = "UNKNOWN";

    /* ── Çakışma gerekçe kodları (SERBEST METİN YOK — sabit enum) ─────────── */
    public static final String REASON_OBD_CONNECTED_WITH_DISCOVERY = "OBD_CONNECTED_WITH_DISCOVERY";
    public static final String REASON_OBD_POLLING_WITH_PHONE_PROFILE = "OBD_POLLING_WITH_PHONE_PROFILE";
    public static final String REASON_ADAPTER_RESET_IN_PROGRESS    = "ADAPTER_RESET_IN_PROGRESS";
    public static final String REASON_SIMULTANEOUS_STATE_UNKNOWN   = "SIMULTANEOUS_PROFILE_STATE_UNKNOWN";
    public static final String REASON_BT_STATE_UNREADABLE          = "BT_STATE_UNREADABLE";

    /* ── Cihaz sınıfı sayımları (ANONİM — ad/MAC YOK) ────────────────────── */
    public static final String CLASS_PHONE_LIKE = "phoneLike";
    public static final String CLASS_AUDIO_LIKE = "audioLike";
    public static final String CLASS_OBD_LIKE   = "obdLikeCandidate";
    public static final String CLASS_UNKNOWN    = "unknown";

    /* ══════════════════════════════════════════════════════════════════════
     * Alanlar
     * ════════════════════════════════════════════════════════════════════ */

    public final int     schemaVersion;
    /** Duvar-saati damgası (ms). 0 = damga YOK. */
    public final long    capturedAt;
    public final int     platformApiLevel;

    // Bluetooth
    public final boolean adapterAvailable;
    public final boolean adapterEnabled;
    /** Adapter adı GÖNDERİLMEZ — yalnız "adı var mı" (redacted). */
    public final boolean adapterNamePresent;
    public final String  permConnect;
    public final String  permScan;
    public final String  permLegacy;
    /**
     * Adapter keşif (discovery) durumu — YALNIZ OKUNUR ({@code isDiscovering()}).
     * "ACTIVE" | "INACTIVE" | "UNKNOWN". Boolean DEĞİL: izin yok/okunamadı durumu
     * "keşif yok" ile KARIŞTIRILMASIN diye üç durumlu.
     */
    public final String  discoveryActive;
    /** -1 = okunamadı (0 ile KARIŞTIRILMAZ). */
    public final int     bondedDeviceCount;
    public final int     phoneLikeCount;
    public final int     audioLikeCount;
    public final int     obdLikeCandidateCount;
    public final int     unknownClassCount;
    public final String  bluetoothEvidence;

    // Profiller
    public final String  a2dpConnectionState;
    public final String  headsetConnectionState;
    public final String  gattConnectionState;
    public final String  a2dpControlAuthority;
    public final String  hfpControlAuthority;
    public final String  profilesEvidence;

    // Vendor / MCU
    public final boolean knownVendorPackageDetected;
    public final boolean knownVendorBroadcastObserved;
    public final String  vendorFamily;
    /** -1 = hiç gözlem YOK (0 ms ile KARIŞTIRILMAZ). */
    public final long    vendorLastEvidenceAgeMs;
    public final String  vendorEvidence;

    // Audio
    public final int     audioMode;
    public final boolean musicActive;
    public final String  communicationDeviceType;
    public final String  routeAuthority;
    public final String  audioEvidence;

    // Hatalar (sınıflandırılmış — yığın izi/dosya yolu YOK)
    public final List<String> errors;

    private PhoneHubHardwareSnapshot(Builder b) {
        this.schemaVersion    = SCHEMA_VERSION;
        this.capturedAt       = b.capturedAt;
        this.platformApiLevel = b.platformApiLevel;

        this.adapterAvailable      = b.adapterAvailable;
        this.adapterEnabled        = b.adapterEnabled;
        this.adapterNamePresent    = b.adapterNamePresent;
        this.permConnect           = safeEnum(b.permConnect, PERM_UNKNOWN);
        this.permScan              = safeEnum(b.permScan, PERM_UNKNOWN);
        this.permLegacy            = safeEnum(b.permLegacy, PERM_UNKNOWN);
        this.discoveryActive       = safeEnum(b.discoveryActive, DISCOVERY_UNKNOWN);
        this.bondedDeviceCount     = b.bondedDeviceCount;
        this.phoneLikeCount        = b.phoneLikeCount;
        this.audioLikeCount        = b.audioLikeCount;
        this.obdLikeCandidateCount = b.obdLikeCandidateCount;
        this.unknownClassCount     = b.unknownClassCount;
        this.bluetoothEvidence     = safeEnum(b.bluetoothEvidence, EV_UNKNOWN);

        this.a2dpConnectionState    = safeEnum(b.a2dpConnectionState, CONN_UNKNOWN);
        this.headsetConnectionState = safeEnum(b.headsetConnectionState, CONN_UNKNOWN);
        this.gattConnectionState    = safeEnum(b.gattConnectionState, CONN_UNKNOWN);
        this.a2dpControlAuthority   = safeEnum(b.a2dpControlAuthority, AUTHORITY_UNKNOWN);
        this.hfpControlAuthority    = safeEnum(b.hfpControlAuthority, AUTHORITY_UNKNOWN);
        this.profilesEvidence       = safeEnum(b.profilesEvidence, EV_UNKNOWN);

        this.knownVendorPackageDetected   = b.knownVendorPackageDetected;
        this.knownVendorBroadcastObserved = b.knownVendorBroadcastObserved;
        this.vendorFamily                 = safeEnum(b.vendorFamily, "UNKNOWN");
        this.vendorLastEvidenceAgeMs      = b.vendorLastEvidenceAgeMs;
        this.vendorEvidence               = safeEnum(b.vendorEvidence, EV_UNKNOWN);

        this.audioMode               = b.audioMode;
        this.musicActive             = b.musicActive;
        this.communicationDeviceType = safeEnum(b.communicationDeviceType, "UNKNOWN");
        this.routeAuthority          = safeEnum(b.routeAuthority, AUTHORITY_UNKNOWN);
        this.audioEvidence           = safeEnum(b.audioEvidence, EV_UNKNOWN);

        List<String> e = new ArrayList<>();
        if (b.errors != null) {
            for (String s : b.errors) if (s != null && s.length() > 0) e.add(s);
        }
        this.errors = Collections.unmodifiableList(e);
    }

    private static String safeEnum(String v, String fallback) {
        return (v == null || v.length() == 0) ? fallback : v;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * SAF SINIFLANDIRMA — düz JUnit ile test edilir
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Android {@code BluetoothProfile.STATE_*} tamsayısını kendi sözleşmemize çevirir.
     * Bilinmeyen değer UYDURULMAZ → {@link #CONN_UNKNOWN}.
     *
     * @param state Android sabiti (0=DISCONNECTED 1=CONNECTING 2=CONNECTED 3=DISCONNECTING)
     */
    public static String mapConnectionState(int state) {
        switch (state) {
            case 0:  return CONN_DISCONNECTED;
            case 1:  return CONN_CONNECTING;
            case 2:  return CONN_CONNECTED;
            case 3:  return CONN_DISCONNECTING;
            default: return CONN_UNKNOWN;
        }
    }

    /**
     * {@code BluetoothClass.getMajorDeviceClass()} → anonim sınıf etiketi.
     * Ad/MAC KULLANILMAZ; yalnız sınıf baytı.
     *
     * Android major sınıfları: PHONE=0x0200 · AUDIO_VIDEO=0x0400 · COMPUTER=0x0100 ·
     * UNCATEGORIZED=0x1F00 · MISC=0x0000.
     *
     * OBD adaptörleri standart bir sınıf İLAN ETMEZ (çoğu MISC/UNCATEGORIZED) →
     * bu yüzden "OBD" değil "OBD ADAYI" denir ve kanıt sınıfı INFERRED'dır.
     */
    public static String classifyMajorDeviceClass(int majorClass) {
        switch (majorClass) {
            case 0x0200: return CLASS_PHONE_LIKE;
            case 0x0400: return CLASS_AUDIO_LIKE;
            case 0x0000:
            case 0x1F00: return CLASS_OBD_LIKE;
            default:     return CLASS_UNKNOWN;
        }
    }

    /**
     * Kontrol otoritesi — POZİTİF KANIT ŞARTI.
     *
     * KURAL: bağlantı CONNECTED olsa bile, uygulamanın o profili yönettiğine dair
     * DOĞRUDAN kanıt yoksa otorite {@link #AUTHORITY_UNKNOWN}'dır. Bugün CAROS'ta
     * A2DP Sink / HFP yığınını yöneten HİÇBİR kod YOKTUR (kod taraması: profil
     * yalnız {@code getProfileConnectionState} ile OKUNUYOR) → ANDROID_APP ASLA
     * verilmez. Adapter yoksa UNAVAILABLE.
     *
     * @param connectionState  bu sınıfın CONN_* sözleşmesi
     * @param appControlsProfile uygulamanın profili gerçekten yönettiğine dair KOD kanıtı
     */
    public static String deriveControlAuthority(boolean adapterAvailable,
                                                String connectionState,
                                                boolean appControlsProfile) {
        if (!adapterAvailable) return AUTHORITY_UNAVAILABLE;
        if (appControlsProfile) return AUTHORITY_ANDROID_APP;
        return AUTHORITY_UNKNOWN;   // vendor/MCU olabilir — KANITSIZ ATAMA YOK
    }

    /**
     * Çakışma riski — YALNIZ TÜRETİLMİŞ (DERIVED). Gerekçeler sabit enum listesidir.
     *
     * KURAL SIRASI (ilk eşleşen kazanır):
     *  1. adapter reseti sürüyor VEYA (OBD bağlı VE BT keşfi aktif)        → HIGH
     *  2. OBD polling aktif VE telefon profili bağlı                        → POSSIBLE
     *  3. BT durumu okunamıyor (state UNKNOWN/UNAVAILABLE)                  → UNKNOWN
     *  4. aksi hâlde                                                        → NONE_OBSERVED
     */
    public static CollisionAssessment assessCollision(boolean obdConnected,
                                                      boolean obdPolling,
                                                      boolean btDiscoveryActive,
                                                      boolean adapterResetInProgress,
                                                      String a2dpState,
                                                      String hfpState) {
        List<String> reasons = new ArrayList<>();

        boolean stateUnreadable =
            CONN_UNKNOWN.equals(a2dpState) || CONN_UNAVAILABLE.equals(a2dpState)
         || CONN_UNKNOWN.equals(hfpState)  || CONN_UNAVAILABLE.equals(hfpState);

        if (adapterResetInProgress) reasons.add(REASON_ADAPTER_RESET_IN_PROGRESS);
        if (obdConnected && btDiscoveryActive) reasons.add(REASON_OBD_CONNECTED_WITH_DISCOVERY);

        if (!reasons.isEmpty()) return new CollisionAssessment(RISK_HIGH, reasons);

        boolean phoneProfileConnected =
            CONN_CONNECTED.equals(a2dpState) || CONN_CONNECTED.equals(hfpState);
        if (obdPolling && phoneProfileConnected) {
            reasons.add(REASON_OBD_POLLING_WITH_PHONE_PROFILE);
            if (stateUnreadable) reasons.add(REASON_SIMULTANEOUS_STATE_UNKNOWN);
            return new CollisionAssessment(RISK_POSSIBLE, reasons);
        }

        if (stateUnreadable) {
            reasons.add(REASON_BT_STATE_UNREADABLE);
            reasons.add(REASON_SIMULTANEOUS_STATE_UNKNOWN);
            return new CollisionAssessment(RISK_UNKNOWN, reasons);
        }

        return new CollisionAssessment(RISK_NONE_OBSERVED, reasons);
    }

    /** Çakışma değerlendirmesi — değişmez. */
    public static final class CollisionAssessment {
        public final String level;
        public final List<String> reasons;
        CollisionAssessment(String level, List<String> reasons) {
            this.level = level;
            this.reasons = Collections.unmodifiableList(new ArrayList<>(reasons));
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Builder — fail-soft varsayılanlar
     * ════════════════════════════════════════════════════════════════════ */

    public static final class Builder {
        long    capturedAt = 0L;
        int     platformApiLevel = -1;

        boolean adapterAvailable = false;
        boolean adapterEnabled = false;
        boolean adapterNamePresent = false;
        String  permConnect = PERM_UNKNOWN;
        String  permScan = PERM_UNKNOWN;
        String  permLegacy = PERM_UNKNOWN;
        String  discoveryActive = DISCOVERY_UNKNOWN;
        int     bondedDeviceCount = -1;
        int     phoneLikeCount = -1;
        int     audioLikeCount = -1;
        int     obdLikeCandidateCount = -1;
        int     unknownClassCount = -1;
        String  bluetoothEvidence = EV_UNKNOWN;

        String  a2dpConnectionState = CONN_UNKNOWN;
        String  headsetConnectionState = CONN_UNKNOWN;
        String  gattConnectionState = CONN_UNAVAILABLE;
        String  a2dpControlAuthority = AUTHORITY_UNKNOWN;
        String  hfpControlAuthority = AUTHORITY_UNKNOWN;
        String  profilesEvidence = EV_UNKNOWN;

        boolean knownVendorPackageDetected = false;
        boolean knownVendorBroadcastObserved = false;
        String  vendorFamily = "UNKNOWN";
        long    vendorLastEvidenceAgeMs = -1L;
        String  vendorEvidence = EV_UNKNOWN;

        int     audioMode = -1;
        boolean musicActive = false;
        String  communicationDeviceType = "UNKNOWN";
        String  routeAuthority = AUTHORITY_UNKNOWN;
        String  audioEvidence = EV_UNKNOWN;

        final List<String> errors = new ArrayList<>();

        public Builder capturedAt(long v) { this.capturedAt = v; return this; }
        public Builder platformApiLevel(int v) { this.platformApiLevel = v; return this; }

        public Builder adapterAvailable(boolean v) { this.adapterAvailable = v; return this; }
        public Builder adapterEnabled(boolean v) { this.adapterEnabled = v; return this; }
        public Builder adapterNamePresent(boolean v) { this.adapterNamePresent = v; return this; }
        public Builder permConnect(String v) { this.permConnect = v; return this; }
        public Builder permScan(String v) { this.permScan = v; return this; }
        public Builder permLegacy(String v) { this.permLegacy = v; return this; }
        public Builder discoveryActive(String v) { this.discoveryActive = v; return this; }
        public Builder bondedDeviceCount(int v) { this.bondedDeviceCount = v; return this; }
        public Builder classCounts(int phone, int audio, int obd, int unknown) {
            this.phoneLikeCount = phone; this.audioLikeCount = audio;
            this.obdLikeCandidateCount = obd; this.unknownClassCount = unknown;
            return this;
        }
        public Builder bluetoothEvidence(String v) { this.bluetoothEvidence = v; return this; }

        public Builder a2dpConnectionState(String v) { this.a2dpConnectionState = v; return this; }
        public Builder headsetConnectionState(String v) { this.headsetConnectionState = v; return this; }
        public Builder gattConnectionState(String v) { this.gattConnectionState = v; return this; }
        public Builder a2dpControlAuthority(String v) { this.a2dpControlAuthority = v; return this; }
        public Builder hfpControlAuthority(String v) { this.hfpControlAuthority = v; return this; }
        public Builder profilesEvidence(String v) { this.profilesEvidence = v; return this; }

        public Builder knownVendorPackageDetected(boolean v) { this.knownVendorPackageDetected = v; return this; }
        public Builder knownVendorBroadcastObserved(boolean v) { this.knownVendorBroadcastObserved = v; return this; }
        public Builder vendorFamily(String v) { this.vendorFamily = v; return this; }
        public Builder vendorLastEvidenceAgeMs(long v) { this.vendorLastEvidenceAgeMs = v; return this; }
        public Builder vendorEvidence(String v) { this.vendorEvidence = v; return this; }

        public Builder audioMode(int v) { this.audioMode = v; return this; }
        public Builder musicActive(boolean v) { this.musicActive = v; return this; }
        public Builder communicationDeviceType(String v) { this.communicationDeviceType = v; return this; }
        public Builder routeAuthority(String v) { this.routeAuthority = v; return this; }
        public Builder audioEvidence(String v) { this.audioEvidence = v; return this; }

        /** Sınıflandırılmış hata kodu — serbest metin/yığın izi/dosya yolu YASAK. */
        public Builder error(String code) {
            if (code != null && code.length() > 0 && errors.size() < 16) errors.add(code);
            return this;
        }

        public PhoneHubHardwareSnapshot build() { return new PhoneHubHardwareSnapshot(this); }
    }
}
