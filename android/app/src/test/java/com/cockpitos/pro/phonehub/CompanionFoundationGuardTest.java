package com.cockpitos.pro.phonehub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * CompanionFoundationGuardTest — PHONE-HUB P1-PREP native kilitleri.
 *
 * ── DÜRÜST BEYAN: BU FAZDA NATIVE ÜRETİM KODU EKLENMEDİ ─────────────────────
 * Companion Foundation TAMAMEN TypeScript tarafındadır ve taşıma SOYUTTUR.
 * Bu bilinçli bir karardır: gerçek bir taşıma (BLE/RFCOMM/USB/Wi-Fi Direct)
 * native kod gerektirir ve o kod ancak GERÇEK HEAD UNIT kanıtı toplandıktan
 * sonra (P1-A) yazılabilir. Bu yüzden burada test edilecek yeni bir native
 * sınıf YOKTUR.
 *
 * Bu test sınıfı boşluğu "test yok" diye SESSİZ bırakmaz; onun yerine iddiayı
 * KİLİTLER:
 *   (A) Native tarafta companion paketi/taşıma kodu YOKTUR — biri sessizce
 *       eklerse bu test DÜŞER ve karar bilinçli olarak gözden geçirilir.
 *   (B) Mevcut phonehub native paketinde hiçbir bağlantı/eşleştirme/tarama/
 *       komut çağrısı YOKTUR (P0.5/P0.8 invaryantı P1-PREP'te de korunur).
 *   (C) P0.5 ve P0.8 snapshot şema sürümleri DEĞİŞMEMİŞTİR (geriye uyumluluk).
 */
public class CompanionFoundationGuardTest {

    /* ══════════════════════════════════════════════════════════════════════
     * Kaynak bulma (gradle çalışma dizini ortama göre değişir)
     * ════════════════════════════════════════════════════════════════════ */

    /** `com/cockpitos/pro` kök dizinini bulur; bulunamazsa test DÜŞER. */
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

    /* ══════════════════════════════════════════════════════════════════════
     * A · Native companion/taşıma kodu YOK
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * ⚠️ P1-A'DA BİLİNÇLİ OLARAK DEĞİŞTİRİLDİ.
     *
     * P1-PREP'te bu kilit "native taşıma kodu YOK" diyordu ve amacı, birinin
     * saha kanıtı toplanmadan sessizce gerçek bağlantı eklemesini yakalamaktı.
     * P1-A bu kararı AÇIKÇA verdi: RFCOMM control-plane uygulandı. Kilit bu
     * yüzden KALDIRILMADI, yeni invaryanta taşındı:
     *
     *   · Taşıma kodu YALNIZ `phonehub/link` altında olabilir.
     *   · Genel amaçlı bir `companion` native paketi hâlâ YASAKTIR — bağlantı
     *     yüzeyinin ikinci bir yerde çoğalmasını engeller.
     *
     * Ayrıntılı P1-A kilitleri {@code PhoneHubLinkGuardTest} içindedir.
     */
    @Test
    public void nativeTransportCodeStaysInsidePhoneHubLinkPackage() {
        File root = javaRoot();

        assertFalse(
            "genel amaçlı native `companion` paketi YASAK — taşıma yalnız "
            + "phonehub/link altında yaşar",
            new File(root, "companion").exists());

        File link = new File(root, "phonehub/link");
        assertTrue("P1-A'da phonehub/link paketi bulunmalı", link.isDirectory());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * B · phonehub paketinde bağlantı/komut çağrısı YOK
     * ════════════════════════════════════════════════════════════════════ */

    /** P1-PREP boyunca da korunması gereken yasaklı çağrılar. */
    private static final String[] FORBIDDEN = {
        "startDiscovery(", "cancelDiscovery(", "createBond(", "removeBond(",
        ".connect(", "startScan(", "stopScan(",
        "createRfcommSocket", "createInsecureRfcomm", "BluetoothServerSocket",
        "startBluetoothSco(", "stopBluetoothSco(",
        "setMode(", "setSpeakerphoneOn(", "setCommunicationDevice(",
        "placeCall(", "ACTION_CALL", "dispatchMediaKeyEvent",
        "bindService(", "sendBroadcast(", "requestPermissions(",
        "adapter.enable(", "adapter.disable(",
        "getTransportControls(", "getProfileProxy(",
        "sendTextMessage(", "setActive(",
        "WifiP2pManager", "UsbDeviceConnection",
    };

    /**
     * P0.5/P0.8 PROBE dosyaları (donanım ve saha doğrulama) SALT-OKUNUR
     * kalmalıdır: bunlar "ne var" diye bakan araçlardır, bağlanan araçlar
     * değil. P1-A'da eklenen `phonehub/link` alt paketi bilinçli olarak
     * bağlantı kurar ve bu taramanın DIŞINDADIR — onun kendi, daha dar
     * kilit kümesi {@code PhoneHubLinkGuardTest} içindedir.
     */
    @Test
    public void phonehubProbePackageHasNoConnectionOrCommandCall() {
        File root = javaRoot();
        File phonehub = new File(root, "phonehub");
        assertTrue("phonehub paketi bulunmalı", phonehub.isDirectory());
        String linkPrefix = new File(phonehub, "link").getAbsolutePath();

        List<File> files = new ArrayList<>();
        for (File f : javaFilesIn(phonehub)) {
            if (!f.getAbsolutePath().startsWith(linkPrefix)) files.add(f);
        }
        assertTrue("phonehub probe paketinde kaynak dosya olmalı", files.size() >= 4);

        for (File f : files) {
            String code = stripComments(read(f));
            for (String bad : FORBIDDEN) {
                assertFalse(
                    "YASAK ÇAĞRI " + bad + " → " + f.getName(),
                    code.contains(bad));
            }
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * C · Şema sürümleri geriye uyumlu kaldı
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * P1-PREP hiçbir native snapshot sözleşmesini DEĞİŞTİRMEDİ. Sürüm artışı,
     * eski APK ile yeni JS (veya tersi) arasında sessiz alan kayması demektir.
     */
    @Test
    public void nativeSnapshotSchemaVersionsAreUnchanged() {
        assertEquals("P0.5 şema sürümü P1-PREP'te ARTIRILMAMALI",
            1, PhoneHubHardwareSnapshot.SCHEMA_VERSION);
        assertEquals("P0.8 şema sürümü P1-PREP'te ARTIRILMAMALI",
            1, PhoneHubFieldSnapshot.SCHEMA_VERSION);
    }
}
