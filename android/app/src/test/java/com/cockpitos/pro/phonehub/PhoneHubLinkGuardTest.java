package com.cockpitos.pro.phonehub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.cockpitos.phonehub.protocol.PhoneHubUuid;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * PhoneHubLinkGuardTest — P1-A native kilitleri (GÖREV 17 + GÖREV 21).
 *
 * ── NE DEĞİŞTİ, NEDEN ───────────────────────────────────────────────────────
 * P1-PREP'te "native bağlantı kodu YOK" kilitliydi. P1-A bu kararı BİLİNÇLİ
 * olarak değiştirir: RFCOMM artık uygulanmıştır. Kilit KALDIRILMADI, yeniden
 * yazıldı — yasak artık "RFCOMM kullanmak" değil, "RFCOMM'u Phone Hub link
 * paketinin DIŞINDA kullanmak" ve "OBD'ye dokunmak"tır.
 *
 * ── OBD İZOLASYONU: ASIL RİSK ───────────────────────────────────────────────
 * Head unit'te OBD ve Phone Hub AYNI Bluetooth adapter'ını paylaşır.
 * {@code OBDBluetoothManager} adapter geneli {@code startDiscovery()} çağırır.
 * Phone Hub'ın aynı şeyi yapması ya da OBD'nin soketine/durum makinesine
 * dokunması, iki sistemi birbirine bağlar. Bu testler o teması KODDA
 * imkânsızlaştırır. Ancak eşzamanlılığın GERÇEK etkisi (discovery sırasında
 * accept yavaşlaması) kod okumasıyla kapatılamaz → saha ölçümü şarttır.
 */
public class PhoneHubLinkGuardTest {

    /* ══════════════════════════════════════════════════════════════════════
     * Kaynak bulma
     * ════════════════════════════════════════════════════════════════════ */

    private static File javaRoot() {
        String[] relatives = {
            "app/src/main/java/com/cockpitos/pro",
            "android/app/src/main/java/com/cockpitos/pro",
            "src/main/java/com/cockpitos/pro",
        };
        File dir = new File(".").getAbsoluteFile();
        for (int depth = 0; depth < 8 && dir != null; depth++, dir = dir.getParentFile()) {
            for (String rel : relatives) {
                File f = new File(dir, rel);
                if (f.isDirectory()) return f;
            }
        }
        fail("java kaynak kökü bulunamadı (güvenlik kontrolü atlanamaz)");
        return null;
    }

    private static List<File> javaFilesIn(File dir) {
        List<File> out = new ArrayList<>();
        File[] entries = dir.listFiles();
        if (entries == null) return out;
        for (File f : entries) {
            if (f.isDirectory()) out.addAll(javaFilesIn(f));
            else if (f.getName().endsWith(".java")) out.add(f);
        }
        return out;
    }

    private static String read(File f) {
        try {
            return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (Exception e) {
            fail("kaynak okunamadı: " + f.getAbsolutePath());
            return "";
        }
    }

    private static String stripComments(String src) {
        String noBlock = src.replaceAll("(?s)/\\*.*?\\*/", "");
        return noBlock.replaceAll("(?m)//.*$", "");
    }

    private static File linkPackage() {
        File pkg = new File(javaRoot(), "phonehub/link");
        assertTrue("phonehub/link paketi bulunmalı", pkg.isDirectory());
        return pkg;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * A · OBD izolasyonu
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Phone Hub, Bluetooth adapter'ının GENELİNİ etkileyen hiçbir çağrıyı
     * yapamaz. Bunlar OBD bağlantısını doğrudan bozabilecek çağrılardır.
     */
    @Test
    public void linkPackageNeverTouchesAdapterWideOperations() {
        String[] forbidden = {
            "startDiscovery(", "cancelDiscovery(",
            "createBond(", "removeBond(",
            ".enable(", ".disable(",
            "startScan(", "stopScan(",
            "ACTION_REQUEST_ENABLE",
        };
        for (File f : javaFilesIn(linkPackage())) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("Phone Hub adapter geneline dokunamaz: " + bad
                    + " → " + f.getName(), code.contains(bad));
            }
        }
    }

    /** Phone Hub, OBD/CAN sınıflarını import EDEMEZ veya adlarını anamaz. */
    @Test
    public void linkPackageNeverReferencesObdOrCanClasses() {
        String[] forbidden = {
            "com.cockpitos.pro.obd", "com.cockpitos.pro.can",
            "OBDManager", "OBDBluetoothManager", "BleObdManager", "BleObdScanner",
            "ElmProtocol", "ElmCommandQueue", "ElmInitSequencer",
            "CanBusManager", "K24CanBridge", "BtSerialTransport",
        };
        for (File f : javaFilesIn(linkPackage())) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("Phone Hub OBD/CAN'e dokunamaz: " + bad
                    + " → " + f.getName(), code.contains(bad));
            }
        }
    }

    /** OBD tarafı da Phone Hub'ı tanımamalı — bağımlılık TEK YÖNLÜ bile olmamalı. */
    @Test
    public void obdPackageNeverReferencesPhoneHub() {
        File obd = new File(javaRoot(), "obd");
        assertTrue("obd paketi bulunmalı", obd.isDirectory());
        for (File f : javaFilesIn(obd)) {
            String code = stripComments(read(f));
            assertFalse("OBD, Phone Hub'a bağlanmamalı → " + f.getName(),
                code.contains("phonehub") || code.contains("PhoneHub"));
        }
    }

    /**
     * Phone Hub UUID'si OBD'nin SPP UUID'sinden FARKLI olmalı.
     * Aynı olsaydı telefon yanlışlıkla OBD servisine bağlanabilirdi.
     */
    @Test
    public void phoneHubUuidIsNotObdSpp() {
        assertTrue(PhoneHubUuid.isDistinctFromObdSpp());
        assertFalse(PhoneHubUuid.SERVICE_UUID_STRING.toLowerCase()
            .startsWith("00001101"));
    }

    /**
     * UUID sabiti TEK YERDE tanımlı olmalı: link paketinde çıplak bir UUID
     * dizesi bulunmamalı, {@link PhoneHubUuid} üzerinden okunmalı.
     */
    @Test
    public void uuidLiteralIsNotDuplicatedInLinkPackage() {
        for (File f : javaFilesIn(linkPackage())) {
            String code = stripComments(read(f));
            assertFalse("UUID dizesi kopyalanmış → " + f.getName(),
                code.contains(PhoneHubUuid.SERVICE_UUID_STRING));
            assertFalse("SPP UUID'si link paketinde geçmemeli → " + f.getName(),
                code.toLowerCase().contains("00001101-0000-1000-8000"));
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * B · RFCOMM YALNIZ link paketinde
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * RFCOMM sunucu soketi YALNIZ Phone Hub link paketinde kullanılabilir.
     * (OBD istemci tarafı {@code createRfcommSocketToServiceRecord} kullanır;
     * o AYRI bir çağrıdır ve burada yasaklanmaz — yasak olan, Phone Hub'ın
     * sunucu yüzeyinin başka yerlere dağılmasıdır.)
     */
    @Test
    public void rfcommServerSocketOnlyInLinkPackage() {
        File root = javaRoot();
        File link = linkPackage();
        for (File f : javaFilesIn(root)) {
            if (f.getAbsolutePath().startsWith(link.getAbsolutePath())) continue;
            String code = stripComments(read(f));
            assertFalse("BluetoothServerSocket link paketi DIŞINDA → " + f.getName(),
                code.contains("BluetoothServerSocket"));
            assertFalse("listenUsingRfcomm link paketi DIŞINDA → " + f.getName(),
                code.contains("listenUsingRfcomm"));
        }
    }

    /** Eşleştirmesiz (insecure) RFCOMM kullanılamaz — kullanıcı onayı atlanamaz. */
    @Test
    public void insecureRfcommIsNeverUsed() {
        for (File f : javaFilesIn(javaRoot())) {
            String code = stripComments(read(f));
            assertFalse("insecure RFCOMM sistem eşleştirmesini atlar → " + f.getName(),
                code.contains("listenUsingInsecureRfcomm"));
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * C · Gizlilik
     * ════════════════════════════════════════════════════════════════════ */

    /** Link paketi MAC adresi OKUMAMALI ve SAKLAMAMALI. */
    @Test
    public void linkPackageNeverReadsOrStoresMacAddress() {
        String[] forbidden = {
            "getAddress(", "getBluetoothAddress", "BluetoothAdapter.getAddress",
            "putString(\"mac", "KEY_MAC", "saved_mac",
        };
        for (File f : javaFilesIn(linkPackage())) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("MAC yüzeyi yasak: " + bad + " → " + f.getName(),
                    code.contains(bad));
            }
        }
    }

    /** Link paketi kişi/SMS/çağrı/bildirim/medya yüzeyine dokunmamalı. */
    @Test
    public void linkPackageNeverTouchesPersonalDataSurfaces() {
        String[] forbidden = {
            "ACTION_CALL", "placeCall(", "sendTextMessage(",
            "ContactsContract", "NotificationListenerService",
            "dispatchMediaKeyEvent", "getActiveSessions(",
            "getProfileProxy(", "startBluetoothSco(", "setSpeakerphoneOn(",
        };
        for (File f : javaFilesIn(linkPackage())) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("kişisel veri yüzeyi yasak: " + bad + " → " + f.getName(),
                    code.contains(bad));
            }
        }
    }

    /** Link paketinde ağ çağrısı OLMAMALI — bağlantı tamamen yereldir. */
    @Test
    public void linkPackageHasNoNetworkAccess() {
        String[] forbidden = {
            "HttpURLConnection", "OkHttp", "java.net.Socket", "URLConnection",
            "firebase", "Firebase", "supabase", "WebSocket", "Retrofit",
        };
        for (File f : javaFilesIn(linkPackage())) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("Phone Hub ağa çıkamaz: " + bad + " → " + f.getName(),
                    code.contains(bad));
            }
        }
    }

    /** Güven kaydında SAKLANAN anahtarlar beyaz listede olmalı. */
    @Test
    public void trustStorePersistsOnlyAllowedKeys() {
        File f = new File(linkPackage(), "PhoneHubTrustStore.java");
        assertTrue("PhoneHubTrustStore bulunmalı", f.isFile());
        String code = stripComments(read(f));

        String[] forbiddenKeys = {
            "\"mac\"", "\"address\"", "\"bdaddr\"", "\"phone\"",
            "\"pairing_code\"", "\"session_key\"", "\"nonce\"",
            "\"device_name\"", "\"private", "\"passkey\"",
        };
        for (String bad : forbiddenKeys) {
            assertFalse("güven kaydında yasak alan: " + bad, code.contains(bad));
        }
        assertTrue("parmak izi saklanmalı", code.contains("peer_fp"));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * D · Kaynak yaşam döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    /** Sınırsız iş parçacığı havuzu YASAK (bounded kaynak kuralı). */
    @Test
    public void noUnboundedExecutorInLinkPackage() {
        String[] forbidden = {
            "newCachedThreadPool", "newWorkStealingPool",
            "LinkedBlockingQueue<>()", "new LinkedBlockingQueue<",
        };
        for (File f : javaFilesIn(linkPackage())) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("sınırsız kaynak: " + bad + " → " + f.getName(),
                    code.contains(bad));
            }
        }
    }

    /** Sunucu taşıması dispose edilebilir olmalı ve iki soketi AYRI tutmalı. */
    @Test
    public void serverTransportSeparatesListenAndActiveSockets() {
        File f = new File(linkPackage(), "RfcommServerTransport.java");
        assertTrue(f.isFile());
        String code = stripComments(read(f));
        assertTrue("dinleme soketi ayrı alanda olmalı", code.contains("listenSocket"));
        assertTrue("aktif soket ayrı alanda olmalı", code.contains("activeSocket"));
        assertTrue("kalıcı kapatma olmalı", code.contains("dispose()"));
        assertTrue("ikinci istemci reddedilmeli",
            code.contains("rejectedSecondClientCount"));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * E · Şema uyumu
     * ════════════════════════════════════════════════════════════════════ */

    /** P0.5 ve P0.8 snapshot sözleşmeleri P1-A'da da DEĞİŞMEMELİ. */
    @Test
    public void existingProbeSchemasAreUnchanged() {
        assertEquals("P0.5 şeması P1-A'da artırılmamalı",
            1, PhoneHubHardwareSnapshot.SCHEMA_VERSION);
        assertEquals("P0.8 şeması P1-A'da artırılmamalı",
            1, PhoneHubFieldSnapshot.SCHEMA_VERSION);
    }
}
