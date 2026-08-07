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
import java.util.List;

/**
 * PhoneHubHardwareProbeTest — PHONE-HUB P0.5 native kilitleri.
 *
 * ── KAPSAM SINIRI (DÜRÜST BEYAN) ────────────────────────────────────────────
 * Depoda Robolectric/Mockito YOKTUR (yalnız {@code junit:junit}). Bu yüzden
 * {@code android.bluetooth.*} / {@code AudioManager} dokunan yollar düz JUnit'te
 * ÇALIŞTIRILAMAZ ("not mocked" hatası). Bu test iki şeyi kanıtlar:
 *   (A) TÜM sınıflandırma/türetme mantığı (saf) doğru — gerçek birim testi,
 *   (B) probe kaynak kodunda YASAK yazma/bağlanma çağrısı YOK — statik güvenlik.
 * Android'e dokunan okuma yollarının davranışı ancak GERÇEK CİHAZDA doğrulanır
 * (kütük maddesi). Bu sınır gizlenmez.
 */
public class PhoneHubHardwareProbeTest {

    /* ══════════════════════════════════════════════════════════════════════
     * A · Saf sınıflandırma
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void connectionStateMapping_isExact_andUnknownIsNotInvented() {
        assertEquals(PhoneHubHardwareSnapshot.CONN_DISCONNECTED,
            PhoneHubHardwareSnapshot.mapConnectionState(0));
        assertEquals(PhoneHubHardwareSnapshot.CONN_CONNECTING,
            PhoneHubHardwareSnapshot.mapConnectionState(1));
        assertEquals(PhoneHubHardwareSnapshot.CONN_CONNECTED,
            PhoneHubHardwareSnapshot.mapConnectionState(2));
        assertEquals(PhoneHubHardwareSnapshot.CONN_DISCONNECTING,
            PhoneHubHardwareSnapshot.mapConnectionState(3));
        // Bilinmeyen tamsayı UYDURULMAZ
        assertEquals(PhoneHubHardwareSnapshot.CONN_UNKNOWN,
            PhoneHubHardwareSnapshot.mapConnectionState(99));
        assertEquals(PhoneHubHardwareSnapshot.CONN_UNKNOWN,
            PhoneHubHardwareSnapshot.mapConnectionState(-1));
    }

    @Test
    public void deviceClassification_isAnonymous_andObdIsOnlyACandidate() {
        assertEquals(PhoneHubHardwareSnapshot.CLASS_PHONE_LIKE,
            PhoneHubHardwareSnapshot.classifyMajorDeviceClass(0x0200));
        assertEquals(PhoneHubHardwareSnapshot.CLASS_AUDIO_LIKE,
            PhoneHubHardwareSnapshot.classifyMajorDeviceClass(0x0400));
        // OBD adaptörleri standart sınıf ilan etmez → yalnız ADAY
        assertEquals(PhoneHubHardwareSnapshot.CLASS_OBD_LIKE,
            PhoneHubHardwareSnapshot.classifyMajorDeviceClass(0x0000));
        assertEquals(PhoneHubHardwareSnapshot.CLASS_OBD_LIKE,
            PhoneHubHardwareSnapshot.classifyMajorDeviceClass(0x1F00));
        assertEquals(PhoneHubHardwareSnapshot.CLASS_UNKNOWN,
            PhoneHubHardwareSnapshot.classifyMajorDeviceClass(0x0100));
        assertEquals(PhoneHubHardwareSnapshot.CLASS_UNKNOWN,
            PhoneHubHardwareSnapshot.classifyMajorDeviceClass(-1));
    }

    @Test
    public void controlAuthority_neverClaimsAndroidAppWithoutProof() {
        // CONNECTED olsa BİLE otorite bilinmiyor — vendor/MCU bağlamış olabilir
        assertEquals(PhoneHubHardwareSnapshot.AUTHORITY_UNKNOWN,
            PhoneHubHardwareSnapshot.deriveControlAuthority(
                true, PhoneHubHardwareSnapshot.CONN_CONNECTED, false));
        // Adapter yoksa UNAVAILABLE
        assertEquals(PhoneHubHardwareSnapshot.AUTHORITY_UNAVAILABLE,
            PhoneHubHardwareSnapshot.deriveControlAuthority(
                false, PhoneHubHardwareSnapshot.CONN_CONNECTED, true));
        // ANDROID_APP yalnız POZİTİF kod kanıtıyla
        assertEquals(PhoneHubHardwareSnapshot.AUTHORITY_ANDROID_APP,
            PhoneHubHardwareSnapshot.deriveControlAuthority(
                true, PhoneHubHardwareSnapshot.CONN_CONNECTED, true));
    }

    @Test
    public void collision_obdConnectedWithDiscovery_isHigh() {
        PhoneHubHardwareSnapshot.CollisionAssessment a =
            PhoneHubHardwareSnapshot.assessCollision(
                true, false, true, false,
                PhoneHubHardwareSnapshot.CONN_DISCONNECTED,
                PhoneHubHardwareSnapshot.CONN_DISCONNECTED);
        assertEquals(PhoneHubHardwareSnapshot.RISK_HIGH, a.level);
        assertTrue(a.reasons.contains(
            PhoneHubHardwareSnapshot.REASON_OBD_CONNECTED_WITH_DISCOVERY));
    }

    @Test
    public void collision_adapterReset_isHigh() {
        PhoneHubHardwareSnapshot.CollisionAssessment a =
            PhoneHubHardwareSnapshot.assessCollision(
                false, false, false, true,
                PhoneHubHardwareSnapshot.CONN_DISCONNECTED,
                PhoneHubHardwareSnapshot.CONN_DISCONNECTED);
        assertEquals(PhoneHubHardwareSnapshot.RISK_HIGH, a.level);
        assertTrue(a.reasons.contains(
            PhoneHubHardwareSnapshot.REASON_ADAPTER_RESET_IN_PROGRESS));
    }

    @Test
    public void collision_obdPollingWithPhoneProfile_isPossible() {
        PhoneHubHardwareSnapshot.CollisionAssessment a =
            PhoneHubHardwareSnapshot.assessCollision(
                true, true, false, false,
                PhoneHubHardwareSnapshot.CONN_CONNECTED,
                PhoneHubHardwareSnapshot.CONN_DISCONNECTED);
        assertEquals(PhoneHubHardwareSnapshot.RISK_POSSIBLE, a.level);
        assertTrue(a.reasons.contains(
            PhoneHubHardwareSnapshot.REASON_OBD_POLLING_WITH_PHONE_PROFILE));
    }

    @Test
    public void collision_unreadableBluetoothState_isUnknown_notNone() {
        PhoneHubHardwareSnapshot.CollisionAssessment a =
            PhoneHubHardwareSnapshot.assessCollision(
                false, false, false, false,
                PhoneHubHardwareSnapshot.CONN_UNKNOWN,
                PhoneHubHardwareSnapshot.CONN_UNAVAILABLE);
        assertEquals(PhoneHubHardwareSnapshot.RISK_UNKNOWN, a.level);
        assertTrue(a.reasons.contains(PhoneHubHardwareSnapshot.REASON_BT_STATE_UNREADABLE));
    }

    @Test
    public void collision_quietSystem_isNoneObserved() {
        PhoneHubHardwareSnapshot.CollisionAssessment a =
            PhoneHubHardwareSnapshot.assessCollision(
                false, false, false, false,
                PhoneHubHardwareSnapshot.CONN_DISCONNECTED,
                PhoneHubHardwareSnapshot.CONN_DISCONNECTED);
        assertEquals(PhoneHubHardwareSnapshot.RISK_NONE_OBSERVED, a.level);
        assertTrue(a.reasons.isEmpty());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * B · Snapshot sözleşmesi
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void snapshot_isVersioned_immutable_andFailSoftByDefault() {
        PhoneHubHardwareSnapshot s = new PhoneHubHardwareSnapshot.Builder().build();
        assertEquals(1, s.schemaVersion);
        // Varsayılanlar SAHTE DEĞER üretmez
        assertEquals(PhoneHubHardwareSnapshot.CONN_UNKNOWN, s.a2dpConnectionState);
        assertEquals(PhoneHubHardwareSnapshot.AUTHORITY_UNKNOWN, s.a2dpControlAuthority);
        assertEquals(PhoneHubHardwareSnapshot.PERM_UNKNOWN, s.permConnect);
        assertEquals(PhoneHubHardwareSnapshot.DISCOVERY_UNKNOWN, s.discoveryActive);
        assertEquals(-1, s.bondedDeviceCount);          // 0 DEĞİL
        assertEquals(-1L, s.vendorLastEvidenceAgeMs);   // 0 DEĞİL
        assertFalse(s.adapterAvailable);

        // errors listesi DEĞİŞTİRİLEMEZ
        try {
            s.errors.add("hack");
            fail("errors listesi değiştirilebilir olmamalı");
        } catch (UnsupportedOperationException expected) { /* beklenen */ }
    }

    @Test
    public void snapshot_nullEnumsFallBackToUnknown_notNull() {
        PhoneHubHardwareSnapshot s = new PhoneHubHardwareSnapshot.Builder()
            .a2dpConnectionState(null)
            .permConnect("")
            .vendorFamily(null)
            .build();
        assertEquals(PhoneHubHardwareSnapshot.CONN_UNKNOWN, s.a2dpConnectionState);
        assertEquals(PhoneHubHardwareSnapshot.PERM_UNKNOWN, s.permConnect);
        assertEquals("UNKNOWN", s.vendorFamily);
    }

    @Test
    public void snapshot_errorListIsBounded_andRejectsEmpty() {
        PhoneHubHardwareSnapshot.Builder b = new PhoneHubHardwareSnapshot.Builder();
        for (int i = 0; i < 50; i++) b.error("ERR_" + i);
        b.error(null).error("");
        PhoneHubHardwareSnapshot s = b.build();
        assertTrue("hata listesi bounded olmalı", s.errors.size() <= 16);
        for (String e : s.errors) assertTrue(e.length() > 0);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * C · STATİK GÜVENLİK — yasak yazma/bağlanma çağrıları
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Yasak çağrı dizeleri. NOT: {@code .connect(} ve {@code enable(} gibi parçalar
     * yorum metninde de geçebileceği için kaynak ÖNCE yorumlardan arındırılır —
     * kontrol GEVŞETİLMEZ, yalnız yanlış-pozitif kaldırılır.
     */
    private static final String[] FORBIDDEN = {
        "startDiscovery(", "cancelDiscovery(", "createBond(", "removeBond(",
        ".connect(", "startScan(", "stopScan(",
        "startBluetoothSco(", "stopBluetoothSco(",
        "setMode(", "setSpeakerphoneOn(", "setCommunicationDevice(",
        "placeCall(", "ACTION_CALL", "dispatchMediaKeyEvent",
        "bindService(", "sendBroadcast(", "requestPermissions(",
        "adapter.enable(", "adapter.disable(",
    };

    private static String stripComments(String src) {
        // Blok yorumları ve satır yorumlarını at (yalnız YÜRÜTÜLEN kod kalsın).
        String noBlock = src.replaceAll("(?s)/\\*.*?\\*/", "");
        return noBlock.replaceAll("(?m)//.*$", "");
    }

    /**
     * Kaynak dosyayı bulur. Gradle'ın çalışma dizini modüle/ortama göre değişir
     * (bu depoda gradle kökü ayrı bir yola taşınmış olabilir), bu yüzden çalışma
     * dizininden YUKARI doğru yürünür. Bulunamazsa test BAŞARISIZ olur —
     * "dosyayı bulamadım" sessizce geçerli sayılmaz (güvenlik kontrolü gevşetilmez).
     */
    private static String readProbeSource(String fileName) {
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
                        fail("Kaynak okunamadı: " + f.getPath());
                    }
                }
            }
        }
        fail("Probe kaynağı bulunamadı: " + fileName
            + " (arama kökü: " + new File(".").getAbsolutePath() + ")");
        return "";
    }

    @Test
    public void probeSource_containsNoForbiddenWriteOrConnectCalls() {
        for (String file : new String[] {
            "PhoneHubHardwareProbe.java", "PhoneHubHardwareSnapshot.java",
        }) {
            String code = stripComments(readProbeSource(file));
            for (String banned : FORBIDDEN) {
                assertFalse(file + " içinde YASAK çağrı bulundu: " + banned,
                    code.contains(banned));
            }
        }
    }

    @Test
    public void probeSource_readsOnlyThroughGetters() {
        String code = stripComments(readProbeSource("PhoneHubHardwareProbe.java"));
        // Beklenen SALT-OKUNUR getter'lar gerçekten kullanılıyor
        assertTrue(code.contains("getDefaultAdapter()"));
        assertTrue(code.contains("getBondedDevices()"));
        assertTrue(code.contains("getProfileConnectionState("));
        assertTrue(code.contains("isDiscovering()"));
        assertTrue(code.contains("getPackageInfo("));
        // Fail-soft zorunlu
        assertTrue(code.contains("catch (SecurityException"));
        assertTrue(code.contains("catch (Throwable"));
    }

    @Test
    public void snapshotSource_carriesNoPiiFields() {
        String code = readProbeSource("PhoneHubHardwareSnapshot.java");
        // PII taşıyacak alan adları snapshot sözleşmesinde BULUNMAMALI
        for (String banned : new String[] {
            "deviceName", "macAddress", "getAddress", "phoneNumber",
            "contactName", "pairingKey", "adapterName;",
        }) {
            assertFalse("Snapshot PII alanı içeriyor: " + banned, code.contains(banned));
        }
        // Adapter adı yalnız VARLIK olarak taşınır
        assertTrue(code.contains("adapterNamePresent"));
    }

    @Test
    public void probeSource_doesNotTouchObdLifecycle() {
        String code = stripComments(readProbeSource("PhoneHubHardwareProbe.java"));
        for (String banned : new String[] {
            "OBDManager", "OBDBluetoothManager", "ElmCommandChannel",
            "reconnect", "disconnect(", "sendCommand",
        }) {
            assertFalse("Probe OBD yaşam döngüsüne dokunuyor: " + banned, code.contains(banned));
        }
    }

    @Test
    public void collisionReasons_areEnumCodes_notFreeText() {
        PhoneHubHardwareSnapshot.CollisionAssessment a =
            PhoneHubHardwareSnapshot.assessCollision(
                true, true, true, true,
                PhoneHubHardwareSnapshot.CONN_UNKNOWN,
                PhoneHubHardwareSnapshot.CONN_UNKNOWN);
        assertNotNull(a.reasons);
        List<String> allowed = java.util.Arrays.asList(
            PhoneHubHardwareSnapshot.REASON_OBD_CONNECTED_WITH_DISCOVERY,
            PhoneHubHardwareSnapshot.REASON_OBD_POLLING_WITH_PHONE_PROFILE,
            PhoneHubHardwareSnapshot.REASON_ADAPTER_RESET_IN_PROGRESS,
            PhoneHubHardwareSnapshot.REASON_SIMULTANEOUS_STATE_UNKNOWN,
            PhoneHubHardwareSnapshot.REASON_BT_STATE_UNREADABLE);
        for (String r : a.reasons) {
            assertTrue("Gerekçe sabit enum olmalı: " + r, allowed.contains(r));
            assertFalse("Gerekçe boşluk içermemeli (serbest metin riski): " + r,
                r.contains(" "));
        }
        // reasons listesi de değiştirilemez
        try {
            a.reasons.add("x");
            fail("reasons listesi değiştirilebilir olmamalı");
        } catch (UnsupportedOperationException expected) { /* beklenen */ }
    }
}
