package com.cockpitos.pro.phonehub;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import androidx.test.core.app.ApplicationProvider;

import com.cockpitos.pro.phonehub.link.PhoneHubLinkController;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * PhoneHubApplicationMessageTest — PHONE LINK F2 · native uygulama-mesajı
 * köprüsü kilitleri.
 *
 * ── KAPSAM SINIRI (DÜRÜST BEYAN) ────────────────────────────────────────────
 * `PhoneHubLinkController` gerçek bir ESTABLISHED oturumu yalnız gerçek bir
 * {@code BluetoothSocket} + Android Keystore üzerinden (`onClientAccepted`)
 * kurabilir; Robolectric'in Keystore/Bluetooth shadow'ları bunu güvenilir
 * biçimde SÜRMEZ. Bu dosya bu yüzden ikiye ayrılır:
 *  (A) saf boyut kontrolü — TAM birim testi, Android'e dokunmaz;
 *  (B) oturumsuz (session=null) fail-closed yollar — Robolectric Context ile,
 *      gerçek Keystore/Bluetooth GEREKTİRMEZ;
 *  (C) kaynak taraması — köprünün kendisi bir yetki/karar üretmediğini ve
 *      OBD/CAN/Arabam Cebimde'ye dokunmadığını statik olarak kilitler.
 * Fingerprint/nesil eşleşen GERÇEK bir ESTABLISHED oturumdan mesaj akışı
 * ancak gerçek cihazda/entegrasyon ortamında ölçülebilir — bu sınır
 * `PHONE_LINK_F2_AUTHORITY_AUDIT`de ayrıca kayıtlıdır.
 */
public class PhoneHubApplicationMessageTest {

    /* ══════════════════════════════════════════════════════════════════════
     * A · Saf boyut kontrolü (Android YOK)
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void payloadSize_null_rejected() {
        assertFalse(PhoneHubLinkController.isAcceptableApplicationPayloadSize(null));
    }

    @Test
    public void payloadSize_empty_rejected() {
        assertFalse(PhoneHubLinkController.isAcceptableApplicationPayloadSize(new byte[0]));
    }

    @Test
    public void payloadSize_oneByte_accepted() {
        assertTrue(PhoneHubLinkController.isAcceptableApplicationPayloadSize(new byte[1]));
    }

    @Test
    public void payloadSize_atMax_accepted() {
        byte[] p = new byte[PhoneHubLinkController.MAX_APPLICATION_MESSAGE_BYTES];
        assertTrue(PhoneHubLinkController.isAcceptableApplicationPayloadSize(p));
    }

    @Test
    public void payloadSize_overMax_rejected() {
        byte[] p = new byte[PhoneHubLinkController.MAX_APPLICATION_MESSAGE_BYTES + 1];
        assertFalse(PhoneHubLinkController.isAcceptableApplicationPayloadSize(p));
    }

    @Test
    public void payloadSize_wayOverMax_rejected() {
        /* 64 KB çerçeve tavanı kadar büyük bir yük bile UYGULAMA katmanında
         * reddedilir — F2.1 "message size limiti" genel çerçeve sınırından
         * KASITLI OLARAK dar. */
        byte[] p = new byte[64 * 1024];
        assertFalse(PhoneHubLinkController.isAcceptableApplicationPayloadSize(p));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * B · Oturumsuz fail-closed yollar (Robolectric Context, Keystore YOK)
     * ════════════════════════════════════════════════════════════════════ */

    @RunWith(RobolectricTestRunner.class)
    @Config(sdk = 34)
    public static class SessionlessGuards {

        private PhoneHubLinkController controller() {
            return PhoneHubLinkController.get(
                ApplicationProvider.getApplicationContext(), "test-1.0");
        }

        @Test
        public void sendApplicationMessage_noSession_returnsFalse() {
            /* Gate 5 analog (native seviyesi): DETACHED (aktif oturum yok)
             * iken hiçbir uygulama mesajı gönderilemez. */
            assertFalse(controller().sendApplicationMessage("{\"type\":\"MUSIC_COMMAND\"}"));
        }

        @Test
        public void sendApplicationMessage_nullPayload_returnsFalse() {
            assertFalse(controller().sendApplicationMessage(null));
        }

        @Test
        public void onApplicationMessage_noSession_neverReachesListener() {
            /* Gate 5/6 analog: session yokken (ya da bayat/eşleşmeyen nesille)
             * gelen bir olay dinleyiciye ASLA ulaşmaz — köprü kendiliğinden
             * yetki/karar üretmez, yalnız var olan CANLI oturumu taşır. */
            PhoneHubLinkController c = controller();
            final boolean[] called = { false };
            c.setApplicationMessageListener((fp, epoch, payload) -> called[0] = true);
            try {
                c.onApplicationMessage("{\"type\":\"MUSIC_COMMAND\",\"command\":\"PLAY\"}"
                    .getBytes(StandardCharsets.UTF_8), 1L);
                assertFalse("session yokken dinleyici tetiklenmemeli", called[0]);
            } finally {
                c.setApplicationMessageListener(null);
            }
        }

        @Test
        public void onApplicationMessage_oversizedPayload_neverThrowsNeverReachesListener() {
            PhoneHubLinkController c = controller();
            final boolean[] called = { false };
            c.setApplicationMessageListener((fp, epoch, payload) -> called[0] = true);
            try {
                byte[] huge = new byte[PhoneHubLinkController.MAX_APPLICATION_MESSAGE_BYTES + 100];
                c.onApplicationMessage(huge, 1L); // throw ETMEMELİ
                assertFalse(called[0]);
            } finally {
                c.setApplicationMessageListener(null);
            }
        }

        @Test
        public void listenerCleared_afterUnregister_neverInvoked() {
            /* Gate 20: dinleyici sökülünce (handleOnDestroy eşdeğeri) hiçbir
             * olay bu örneğe ulaşmaz. */
            PhoneHubLinkController c = controller();
            final boolean[] called = { false };
            c.setApplicationMessageListener((fp, epoch, payload) -> called[0] = true);
            c.setApplicationMessageListener(null);
            c.onApplicationMessage("{}".getBytes(StandardCharsets.UTF_8), 1L);
            assertFalse(called[0]);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * C · Kaynak taraması — köprü yetki/karar üretmez (Gate 19), OBD/CAN'e ve
     * Arabam Cebimde/remoteCommandService'e dokunmaz (Gate 11/16 analog)
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

    @Test
    public void linkPackageStillNeverReferencesObdOrCanClasses() {
        /* F2, onApplicationMessage'ı AÇTIKTAN sonra da PhoneHubLinkGuardTest'in
         * kilidini tekrar eder — yeni köprü kodu da bu sınırı ihlal etmemeli. */
        File pkg = new File(javaRoot(), "phonehub/link");
        assertTrue("phonehub/link paketi bulunmalı", pkg.isDirectory());
        String[] forbidden = {
            "com.cockpitos.pro.obd", "com.cockpitos.pro.can",
            "OBDManager", "OBDBluetoothManager", "BleObdManager",
            "ElmProtocol", "CanBusManager", "K24CanBridge",
        };
        for (File f : javaFilesIn(pkg)) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("Phone Hub OBD/CAN'e dokunamaz: " + bad + " → " + f.getName(),
                    code.contains(bad));
            }
        }
    }

    @Test
    public void applicationMessageBridgeNeverReferencesRemoteCommandOrArabamCebimde() {
        /* Gate 11/16: Phone Link, Arabam Cebimde / remoteCommandService'e
         * bağımlılık kurmaz — bu bridge de istisna değildir. */
        File pkg = new File(javaRoot(), "phonehub/link");
        String[] forbidden = {
            "remoteCommandService", "RemoteCommandService", "ArabamCebimde", "arabam_cebimde",
        };
        for (File f : javaFilesIn(pkg)) {
            String code = stripComments(read(f));
            for (String bad : forbidden) {
                assertFalse("Phone Hub link bridge " + bad + "'a dokunamaz → " + f.getName(),
                    code.contains(bad));
            }
        }
    }

    @Test
    public void controllerDoesNotHardcodeAGrantOrAllowDecisionForApplicationMessages() {
        /* Gate 19: native bridge authorization authority HALİNE GELMEZ.
         * `onApplicationMessage`/`sendApplicationMessage` içinde MEDIA_CONTROL
         * gibi bir capability adı veya sabit bir "ALLOW"/"GRANTED" sonucu
         * ÜRETİLMEMELİ — karar tamamen TS'e (canonical authorization) aittir.
         * Bu dosyanın kendisi tür/alan adı olarak "ApplicationMessageListener"
         * geçtiği için paket-geneli değil, TEK dosya taranır. */
        File controllerFile = new File(javaRoot(),
            "phonehub/link/PhoneHubLinkController.java");
        assertTrue(controllerFile.isFile());
        String code = stripComments(read(controllerFile));
        String[] forbiddenDecisionTokens = {
            "MEDIA_CONTROL", "\"ALLOW\"", "\"GRANTED\"", "authorize(", "canExecute(",
        };
        for (String bad : forbiddenDecisionTokens) {
            assertFalse("Native köprü yetki kararı ÜRETMEMELİ: " + bad,
                code.contains(bad));
        }
    }
}
