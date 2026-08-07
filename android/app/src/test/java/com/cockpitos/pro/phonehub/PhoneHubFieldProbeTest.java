package com.cockpitos.pro.phonehub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * PhoneHubFieldProbeTest — PHONE-HUB P0.8 native kilitleri.
 *
 * ── KAPSAM SINIRI (DÜRÜST BEYAN) ────────────────────────────────────────────
 * Depoda Robolectric/Mockito YOKTUR (yalnız {@code junit:junit}). Bu yüzden
 * {@code PackageManager} · {@code TelecomManager} · {@code MediaSessionManager}
 * dokunan yollar düz JUnit'te ÇALIŞTIRILAMAZ. Bu test iki şeyi kanıtlar:
 *   (A) TÜM sınıflandırma/türetme mantığı (saf) doğru — gerçek birim testi,
 *   (B) saha sondası kaynağında YASAK yazma/bağlanma/komut çağrısı YOK — statik güvenlik.
 * Android'e dokunan okuma yollarının davranışı ancak GERÇEK CİHAZDA doğrulanır
 * (kütük maddesi). Bu sınır gizlenmez.
 */
public class PhoneHubFieldProbeTest {

    /* ══════════════════════════════════════════════════════════════════════
     * A · CİHAZ ROLÜ SINIFLANDIRMASI
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void role_isUnavailable_whenIdentityCannotBeRead() {
        assertFalse(PhoneHubFieldSnapshot.isIdentityReadable(null, 33));
        assertFalse(PhoneHubFieldSnapshot.isIdentityReadable("", 33));
        assertFalse(PhoneHubFieldSnapshot.isIdentityReadable("Xiaomi", 0));
        assertEquals(PhoneHubFieldSnapshot.ROLE_UNAVAILABLE,
            PhoneHubFieldSnapshot.classifyDeviceRole(
                2, 0, PhoneHubFieldSnapshot.TRI_NO, true, false));
    }

    /**
     * GÖREV §2'NİN ASIL SORUSU: aftermarket head unit'te
     * {@code android.hardware.type.automotive} YOKTUR. Bu YOKLUK cihazın head unit
     * OLMADIĞINI KANITLAMAZ — CarService + vendor paketi ile rol yine DOĞRULANIR.
     */
    @Test
    public void aftermarketHeadUnit_withoutAutomotiveFeature_isStillConfirmed() {
        int signals = PhoneHubFieldSnapshot.countHeadUnitSignals(
            PhoneHubFieldSnapshot.TRI_NO,      // automotive özelliği YOK
            PhoneHubFieldSnapshot.TRI_YES,     // ama CarService VAR
            3);                                 // ve 3 vendor paketi VAR
        assertEquals(2, signals);
        assertEquals(PhoneHubFieldSnapshot.ROLE_HEAD_UNIT_CONFIRMED,
            PhoneHubFieldSnapshot.classifyDeviceRole(
                signals, 0, PhoneHubFieldSnapshot.TRI_NO, false, true));
        assertEquals(PhoneHubFieldSnapshot.CONF_HIGH,
            PhoneHubFieldSnapshot.roleConfidence(
                PhoneHubFieldSnapshot.ROLE_HEAD_UNIT_CONFIRMED, signals, 0, false));
    }

    /** Tek teknik sinyal TEK BAŞINA yetmez — onaysız rol DOĞRULANMAZ. */
    @Test
    public void singleSignalWithoutAffirmation_doesNotConfirmHeadUnit() {
        assertEquals(PhoneHubFieldSnapshot.ROLE_ANDROID_DEVICE_UNKNOWN,
            PhoneHubFieldSnapshot.classifyDeviceRole(
                1, 0, PhoneHubFieldSnapshot.TRI_NO, false, true));
    }

    /** Tek teknik sinyal + kullanıcı onayı → DOĞRULANIR ama güven yalnız ORTA. */
    @Test
    public void singleSignalPlusAffirmation_confirmsWithMediumConfidenceOnly() {
        String role = PhoneHubFieldSnapshot.classifyDeviceRole(
            1, 0, PhoneHubFieldSnapshot.TRI_NO, true, true);
        assertEquals(PhoneHubFieldSnapshot.ROLE_HEAD_UNIT_CONFIRMED, role);
        assertEquals("onayla yükseltilen rol HIGH OLMAMALI",
            PhoneHubFieldSnapshot.CONF_MEDIUM,
            PhoneHubFieldSnapshot.roleConfidence(role, 1, 0, true));
    }

    /**
     * KULLANICI ONAYI TEKNİK KANITIN YERİNE GEÇMEZ: sıfır teknik sinyalle onay
     * VERİLSE BİLE rol head unit'e YÜKSELMEZ.
     */
    @Test
    public void userAffirmation_cannotSubstituteTechnicalEvidence() {
        assertEquals(PhoneHubFieldSnapshot.ROLE_ANDROID_DEVICE_UNKNOWN,
            PhoneHubFieldSnapshot.classifyDeviceRole(
                0, 0, PhoneHubFieldSnapshot.TRI_UNKNOWN, true, true));
    }

    /** Telefon teşhisi: OEM işareti + telephony + sıfır head unit sinyali. */
    @Test
    public void phoneIsConfirmed_andAffirmationCannotOverrideIt() {
        assertEquals(PhoneHubFieldSnapshot.ROLE_PHONE_CONFIRMED,
            PhoneHubFieldSnapshot.classifyDeviceRole(
                0, 2, PhoneHubFieldSnapshot.TRI_YES, false, true));
        // Onay telefon teşhisini EZMEZ
        assertEquals(PhoneHubFieldSnapshot.ROLE_PHONE_CONFIRMED,
            PhoneHubFieldSnapshot.classifyDeviceRole(
                0, 2, PhoneHubFieldSnapshot.TRI_YES, true, true));
    }

    /** Telefon işareti VAR ama head unit sinyali de VAR → telefon hükmü VERİLMEZ. */
    @Test
    public void phoneMarkersDoNotWin_whenHeadUnitSignalsExist() {
        String role = PhoneHubFieldSnapshot.classifyDeviceRole(
            2, 3, PhoneHubFieldSnapshot.TRI_YES, false, true);
        assertEquals(PhoneHubFieldSnapshot.ROLE_HEAD_UNIT_CONFIRMED, role);
    }

    @Test
    public void roleConfidence_isNoneWhenNothingIsKnown() {
        assertEquals(PhoneHubFieldSnapshot.CONF_NONE,
            PhoneHubFieldSnapshot.roleConfidence(
                PhoneHubFieldSnapshot.ROLE_UNAVAILABLE, 0, 0, false));
        assertEquals(PhoneHubFieldSnapshot.CONF_NONE,
            PhoneHubFieldSnapshot.roleConfidence(
                PhoneHubFieldSnapshot.ROLE_ANDROID_DEVICE_UNKNOWN, 0, 0, false));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * B · P0.7 DERSİ — SUBSTRING YANLIŞ POZİTİFİ
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Saha turunda {@code contains("android.car")} taraması
     * {@code com.android.carrierconfig} ile eşleşip cihazı yanlışlıkla otomotiv
     * gösterdi. Bu kilit tam eşleşmeyi ZORUNLU kılar.
     */
    @Test
    public void packageMarker_usesExactMatchOnly_carrierPackagesAreNotAutomotive() {
        assertEquals(PhoneHubFieldSnapshot.MARKER_HEAD_UNIT,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.android.car"));

        // YANLIŞ POZİTİF ADAYLARI — hiçbiri head unit işareti OLMAMALI
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.android.carrierconfig"));
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.android.carrierdefaultapp"));
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.android.carrierconfig.overlay.miui"));
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.miui.systemui.carriers.overlay"));
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.carriez.flutter_hbb"));
    }

    @Test
    public void packageMarker_recognizesPhoneOemSurfaces() {
        assertEquals(PhoneHubFieldSnapshot.MARKER_PHONE_OEM,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.miui.home"));
        assertEquals(PhoneHubFieldSnapshot.MARKER_PHONE_OEM,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.sec.android.app.launcher"));
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker("com.miui.homeX"));
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker(null));
        assertEquals(PhoneHubFieldSnapshot.MARKER_NONE,
            PhoneHubFieldSnapshot.classifyPackageMarker(""));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * C · GİZLİLİK — PAKET ADI VE FINGERPRINT DIŞARI ÇIKMAZ
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void dialerIsClassified_packageNameNeverLeaves() {
        assertEquals(PhoneHubFieldSnapshot.DIALER_AOSP,
            PhoneHubFieldSnapshot.classifyDialer("com.google.android.dialer"));
        assertEquals(PhoneHubFieldSnapshot.DIALER_VENDOR_OR_OEM,
            PhoneHubFieldSnapshot.classifyDialer("com.hiworld.phone"));
        // BOŞ = dialer yok · NULL = OKUNAMADI (ikisi KARIŞTIRILMAZ)
        assertEquals(PhoneHubFieldSnapshot.DIALER_NONE,
            PhoneHubFieldSnapshot.classifyDialer(""));
        assertEquals(PhoneHubFieldSnapshot.DIALER_UNAVAILABLE,
            PhoneHubFieldSnapshot.classifyDialer(null));

        // Sınıf değerleri paket adı PARÇASI dahi TAŞIMAZ
        assertFalse(PhoneHubFieldSnapshot.classifyDialer("com.hiworld.phone").contains("hiworld"));
    }

    @Test
    public void sessionOwnerIsClassified_withoutCarryingPackageName() {
        assertEquals(PhoneHubFieldSnapshot.OWNER_LOCAL,
            PhoneHubFieldSnapshot.classifySessionOwner("com.cockpitos.pro", "com.cockpitos.pro"));
        assertEquals(PhoneHubFieldSnapshot.OWNER_VENDOR,
            PhoneHubFieldSnapshot.classifySessionOwner("com.nwd.audio", "com.cockpitos.pro"));
        assertEquals(PhoneHubFieldSnapshot.OWNER_SYSTEM,
            PhoneHubFieldSnapshot.classifySessionOwner("com.android.bluetooth", "com.cockpitos.pro"));
        assertEquals(PhoneHubFieldSnapshot.OWNER_OTHER,
            PhoneHubFieldSnapshot.classifySessionOwner("com.spotify.music", "com.cockpitos.pro"));
        assertEquals(PhoneHubFieldSnapshot.OWNER_OTHER,
            PhoneHubFieldSnapshot.classifySessionOwner(null, "com.cockpitos.pro"));
    }

    /** Ham fingerprint ASLA taşınmaz — yalnız iki segment. */
    @Test
    public void fingerprintIsSummarized_neverCarriedRaw() {
        String raw = "Redmi/zircon_in/zircon:13/TP1A.220624.014/V14.0.2.0.TNOINXM:user/release-keys";
        String summary = PhoneHubFieldSnapshot.summarizeFingerprint(raw);
        assertEquals("Redmi/zircon_in/…", summary);
        assertFalse("derleme kimliği sızmamalı", summary.contains("TNOINXM"));
        assertFalse(summary.contains("release-keys"));

        assertEquals("UNKNOWN", PhoneHubFieldSnapshot.summarizeFingerprint(null));
        assertEquals("UNKNOWN", PhoneHubFieldSnapshot.summarizeFingerprint(""));
        assertEquals("OPAQUE", PhoneHubFieldSnapshot.summarizeFingerprint("no-slash-here"));
        assertEquals("Redmi/…", PhoneHubFieldSnapshot.summarizeFingerprint("Redmi/only-one"));
    }

    /** Karma DETERMİNİSTİK ve ham değeri GERİ VERMEZ. */
    @Test
    public void hashTokenIsDeterministic_andNotReversible() {
        String a = PhoneHubFieldSnapshot.hashToken("Redmi/zircon_in/zircon:13");
        String b = PhoneHubFieldSnapshot.hashToken("Redmi/zircon_in/zircon:13");
        assertEquals(a, b);
        assertEquals(8, a.length());
        assertFalse(a.contains("Redmi"));
        assertFalse(a.equals(PhoneHubFieldSnapshot.hashToken("Redmi/zircon_in/zircon:14")));
        assertEquals("UNKNOWN", PhoneHubFieldSnapshot.hashToken(null));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * D · SNAPSHOT SÖZLEŞMESİ — fail-soft, değişmez, SAHTE DEĞER YOK
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void snapshot_isVersioned_immutable_andFailSoftByDefault() {
        PhoneHubFieldSnapshot s = new PhoneHubFieldSnapshot.Builder().build();
        assertEquals(1, s.schemaVersion);

        // Varsayılanlar SAHTE DEĞER üretmez
        assertEquals("UNKNOWN", s.manufacturer);
        assertEquals(-1, s.sdkInt);
        assertEquals(PhoneHubFieldSnapshot.TRI_UNKNOWN, s.automotiveFeature);
        assertEquals(PhoneHubFieldSnapshot.TRI_UNKNOWN, s.carServicePresent);
        assertEquals(PhoneHubFieldSnapshot.DIALER_UNAVAILABLE, s.dialerClass);
        assertEquals(PhoneHubFieldSnapshot.ACCESS_UNAVAILABLE, s.mediaSessionAccess);
        // -1 SENTINEL: "okunamadı" 0 GİBİ GÖSTERİLMEZ
        assertEquals(-1, s.headUnitMarkerCount);
        assertEquals(-1, s.phoneOemMarkerCount);
        assertEquals(-1, s.activeSessionCount);
        assertEquals(-1, s.ownerLocalCount);
        assertEquals(-1, s.callVendorMarkerCount);
        // Kimlik okunamadığında rol UNAVAILABLE olur — "telefon değil" DENMEZ
        assertEquals(PhoneHubFieldSnapshot.ROLE_UNAVAILABLE, s.deviceRoleTechnical);
        assertEquals(PhoneHubFieldSnapshot.CONF_NONE, s.deviceRoleConfidence);

        // errors listesi DEĞİŞTİRİLEMEZ
        try {
            s.errors.add("hack");
            fail("errors listesi değiştirilebilir olmamalı");
        } catch (UnsupportedOperationException expected) { /* beklenen */ }
    }

    @Test
    public void snapshot_unknownTriValuesFallBackToUnknown_notNo() {
        PhoneHubFieldSnapshot s = new PhoneHubFieldSnapshot.Builder()
            .automotiveFeature("MAYBE")
            .carServicePresent(null)
            .telephonyFeature("")
            .metadataPresent("garbage")
            .build();
        assertEquals(PhoneHubFieldSnapshot.TRI_UNKNOWN, s.automotiveFeature);
        assertEquals(PhoneHubFieldSnapshot.TRI_UNKNOWN, s.carServicePresent);
        assertEquals(PhoneHubFieldSnapshot.TRI_UNKNOWN, s.telephonyFeature);
        assertEquals(PhoneHubFieldSnapshot.TRI_UNKNOWN, s.metadataPresent);
    }

    /** Snapshot rolü kendi SAF kuralıyla hesaplar (onay KATILMAZ). */
    @Test
    public void snapshot_computesTechnicalRoleWithoutUserAffirmation() {
        PhoneHubFieldSnapshot s = new PhoneHubFieldSnapshot.Builder()
            .manufacturer("Xiaomi").sdkInt(33)
            .automotiveFeature(PhoneHubFieldSnapshot.TRI_NO)
            .carServicePresent(PhoneHubFieldSnapshot.TRI_NO)
            .telephonyFeature(PhoneHubFieldSnapshot.TRI_YES)
            .headUnitMarkerCount(0)
            .phoneOemMarkerCount(2)
            .build();
        assertEquals(PhoneHubFieldSnapshot.ROLE_PHONE_CONFIRMED, s.deviceRoleTechnical);
        assertEquals(PhoneHubFieldSnapshot.CONF_HIGH, s.deviceRoleConfidence);
    }

    @Test
    public void snapshot_errorListIsBounded_andRejectsEmpty() {
        PhoneHubFieldSnapshot.Builder b = new PhoneHubFieldSnapshot.Builder();
        for (int i = 0; i < 50; i++) b.error("ERR_" + i);
        b.error(null).error("");
        PhoneHubFieldSnapshot s = b.build();
        assertTrue("hata listesi bounded olmalı", s.errors.size() <= 16);
        for (String e : s.errors) assertTrue(e.length() > 0);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * E · STATİK GÜVENLİK — yasak yazma/bağlanma/komut çağrıları
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Yasak çağrı dizeleri. Kaynak ÖNCE yorumlardan arındırılır (yorum metninde
     * geçen "startDiscovery" yanlış-pozitif vermesin) — kontrol GEVŞETİLMEZ.
     */
    private static final String[] FORBIDDEN = {
        "startDiscovery(", "cancelDiscovery(", "createBond(", "removeBond(",
        ".connect(", "startScan(", "stopScan(",
        "startBluetoothSco(", "stopBluetoothSco(",
        "setMode(", "setSpeakerphoneOn(", "setCommunicationDevice(",
        "placeCall(", "ACTION_CALL", "dispatchMediaKeyEvent",
        "bindService(", "sendBroadcast(", "requestPermissions(",
        "adapter.enable(", "adapter.disable(",
        // P0.8'e ÖZGÜ ek yasaklar:
        "getTransportControls(",   // medya komut yüzeyine HİÇ dokunulmaz
        "getProfileProxy(",        // bind sızıntısı riski — bilinçli KULLANILMADI
        "sendSms", "sendTextMessage(",
        "setActive(",              // MediaSession sahipliği alınmaz
        "adjustStreamVolume(", "setStreamVolume(",
    };

    private static String stripComments(String src) {
        String noBlock = src.replaceAll("(?s)/\\*.*?\\*/", "");
        return noBlock.replaceAll("(?m)//.*$", "");
    }

    /**
     * Kaynak dosyayı bulur. Gradle'ın çalışma dizini modüle/ortama göre değişir,
     * bu yüzden çalışma dizininden YUKARI doğru yürünür. Bulunamazsa test
     * BAŞARISIZ olur — "dosyayı bulamadım" sessizce geçerli SAYILMAZ.
     */
    private static String readSource(String fileName) {
        String[] relatives = {
            "app/src/main/java/com/cockpitos/pro/phonehub/" + fileName,
            "android/app/src/main/java/com/cockpitos/pro/phonehub/" + fileName,
            "src/main/java/com/cockpitos/pro/phonehub/" + fileName,
        };
        File dir = new File(".").getAbsoluteFile();
        for (int depth = 0; depth < 8 && dir != null; depth++, dir = dir.getParentFile()) {
            for (String rel : relatives) {
                File f = new File(dir, rel);
                if (f.isFile()) {
                    try {
                        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
                    } catch (Exception e) {
                        fail("kaynak okunamadı: " + f.getAbsolutePath());
                    }
                }
            }
        }
        fail("kaynak dosya bulunamadı: " + fileName + " (güvenlik kontrolü atlanamaz)");
        return "";
    }

    @Test
    public void fieldProbeSource_containsNoForbiddenWriteOrCommandCall() {
        String code = stripComments(readSource("PhoneHubFieldProbe.java"));
        assertNotNull(code);
        assertTrue(code.length() > 0);
        for (String bad : FORBIDDEN) {
            assertFalse("YASAK ÇAĞRI bulundu: " + bad, code.contains(bad));
        }
    }

    @Test
    public void fieldSnapshotSource_containsNoForbiddenWriteOrCommandCall() {
        String code = stripComments(readSource("PhoneHubFieldSnapshot.java"));
        for (String bad : FORBIDDEN) {
            assertFalse("YASAK ÇAĞRI bulundu: " + bad, code.contains(bad));
        }
    }

    /**
     * P0.5 sondası P0.8 ile DEĞİŞTİRİLMEDİ (geriye uyumluluk kilidi): eski şema
     * sürümü ARTMAMIŞ olmalı, yoksa eski JS önbelleği sessizce bozulur.
     */
    @Test
    public void p05SnapshotContractIsUntouched() {
        assertEquals("P0.5 şema sürümü P0.8'de ARTIRILMAMALI",
            1, PhoneHubHardwareSnapshot.SCHEMA_VERSION);
    }

    /**
     * Profil proxy'sinin KULLANILMADIĞI sessizce geçilmez — snapshot bunu bir
     * hata kodu olarak BEYAN eder (blocker olarak görünsün).
     */
    @Test
    public void profileProxyOmissionIsDeclared_notSilentlySkipped() {
        assertEquals("PROFILE_PROXY_NOT_USED",
            PhoneHubFieldSnapshot.ERR_PROFILE_PROXY_NOT_USED);
        assertEquals("MEDIA_SESSION_ACCESS_DENIED",
            PhoneHubFieldSnapshot.ERR_MEDIA_SESSION_ACCESS_DENIED);
    }
}
