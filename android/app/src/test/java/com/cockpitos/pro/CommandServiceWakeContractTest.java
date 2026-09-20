package com.cockpitos.pro;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

/**
 * CommandServiceWakeContractTest — FCM bir KOMUT YÜRÜTÜCÜSÜ DEĞİLDİR
 * (MRI F-02, F-08 sözleşmesinin native ucu).
 *
 * Kanıtlanan değişmezler:
 *   1. Sunucunun ürettiği wake verisi (`fcmDelivery.buildWakeMessage`) → WAKE_ONLY.
 *   2. Sınıflandırıcının ÜÇÜNCÜ bir değeri yoktur: fiziksel icra dalı
 *      yapısal olarak MEVCUT DEĞİLDİR (enum arity + declared-method kanıtı).
 *   3. `cmd_id` / `cmd_type` / `e2e_payload` taşıyan legacy/malicious payload
 *      fazladan hiçbir yetki kazandırmaz — en fazla zararsız bir wake'tir.
 *   4. İnsan bildirimi olayları araçta HİÇ işlenmez.
 *   5. Native E2E decrypt yüzü kaldırıldı; cross-channel nonce otoritesi DURUYOR.
 *
 * Bu testler kaynak metni değil, DERLENMİŞ sınıfın gerçek API'sini ve saf
 * karar fonksiyonunun çıktısını yoklar (Android çağrısı yok → JVM'de koşar).
 */
public class CommandServiceWakeContractTest {

    /** Sunucu wake üreticisinin BİREBİR çıktısı (fcmDelivery.buildWakeMessage). */
    private static Map<String, String> serverWakeData(String event) {
        Map<String, String> d = new HashMap<>();
        d.put("event",      event);
        d.put("vehicle_id", "veh-1");
        d.put("ts",         "1700000000000");
        return d;
    }

    private static Set<String> declaredMethodNames(Class<?> type) {
        Set<String> names = new HashSet<>();
        for (Method m : type.getDeclaredMethods()) names.add(m.getName());
        return names;
    }

    // ── 1 · Kanonik wake sözleşmesi ────────────────────────────────────────

    @Test
    public void serverWakeContractIsWakeOnly() {
        for (String ev : new String[] { "new_command", "command_pending" }) {
            assertEquals("wake sözleşmesi WAKE_ONLY olmalı: " + ev,
                CommandService.FcmDataKind.WAKE_ONLY,
                CommandService.classifyFcmData(serverWakeData(ev)));
        }
    }

    @Test
    public void nullOrEmptyDataIsIgnored() {
        assertEquals(CommandService.FcmDataKind.IGNORE, CommandService.classifyFcmData(null));
        assertEquals(CommandService.FcmDataKind.IGNORE,
            CommandService.classifyFcmData(new HashMap<String, String>()));
    }

    @Test
    public void humanNotificationEventsAreIgnoredByVehicle() {
        for (String ev : new String[] { "vehicle_offline", "command_completed", "command_failed",
                                        "health_alert", "speed_alert", "", "unlock" }) {
            Map<String, String> d = serverWakeData(ev);
            assertEquals("insan bildirimi araçta işlenmemeli: " + ev,
                CommandService.FcmDataKind.IGNORE, CommandService.classifyFcmData(d));
            /* Komut anahtarları eklense de olay wake ailesinden değilse yok sayılır. */
            d.put("e2e_payload", "{\"x\":1}");
            d.put("cmd_type",    "unlock");
            assertEquals(CommandService.FcmDataKind.IGNORE, CommandService.classifyFcmData(d));
        }
    }

    // ── 2 · Fiziksel icra dalı YAPISAL OLARAK YOK ──────────────────────────

    @Test
    public void classifierHasNoPhysicalExecutionBranch() {
        List<CommandService.FcmDataKind> kinds =
            Arrays.asList(CommandService.FcmDataKind.values());
        assertEquals("sınıflandırıcıda yalnız IGNORE ve WAKE_ONLY olmalı — "
            + "üçüncü bir değer ikinci yürütücü demektir: " + kinds, 2, kinds.size());
        for (CommandService.FcmDataKind k : kinds) {
            if (k.name().contains("COMMAND") && !k.name().equals("WAKE_ONLY")) {
                fail("dormant fiziksel dal geri gelmiş: " + k.name());
            }
        }
    }

    @Test
    public void commandServiceDeclaresNoExecutionOrResultApi() {
        Set<String> declared = declaredMethodNames(CommandService.class);
        for (String forbidden : new String[] {
                "handleEncryptedCommand",   // native E2E decrypt girişi
                "executeMcuCommandNative",  // CAN'e fiziksel yazma
                "buildMcuPacket",
                "queuePendingCommand",      // ikinci komut kuyruğu
                "writeCommandResult",       // ikinci status otoritesi
                "getQueuedCommands",
                "getCommandResults",
                "clearAll",
                "wakeApplicationBrief" }) {
            assertFalse("CommandService yürütücü/kuyruk API'si taşımamalı: " + forbidden,
                declared.contains(forbidden));
        }
        /* Kalması GEREKEN wake yüzü: */
        assertTrue(declared.contains("onMessageReceived"));
        assertTrue(declared.contains("classifyFcmData"));
        assertTrue(declared.contains("wakeApplication"));
    }

    // ── 3 · Legacy / malicious payload yetki kazandırmaz ───────────────────

    @Test
    public void legacyCommandPayloadGrantsNoExecutionAuthority() {
        /* MRI raporundaki eski saldırı zarfı — ESKİDEN native decrypt + CAN icrası
           tetikliyordu. Artık en fazla zararsız bir WAKE'tir. */
        Map<String, String> malicious = serverWakeData("new_command");
        malicious.put("cmd_id",      "cmd-1");
        malicious.put("cmd_type",    "unlock");
        malicious.put("e2e_payload", "{\"type\":\"ecdh_v1\",\"eph_pub\":\"...\"}");

        assertEquals("legacy payload wake'ten fazlasını ÜRETEMEZ",
            CommandService.FcmDataKind.WAKE_ONLY, CommandService.classifyFcmData(malicious));

        /* Her alan tek tek eklendiğinde de sonuç değişmez — hiçbiri dal açmaz. */
        for (String key : new String[] { "cmd_id", "cmd_type", "e2e_payload" }) {
            Map<String, String> d = serverWakeData("new_command");
            d.put(key, "x");
            assertEquals(key + " tek başına icra yetkisi vermemeli",
                CommandService.FcmDataKind.WAKE_ONLY, CommandService.classifyFcmData(d));
        }
    }

    @Test
    public void legacyKeyDetectionIsObservationOnly() {
        Map<String, String> clean = serverWakeData("new_command");
        assertFalse(CommandService.carriesLegacyCommandKeys(clean));
        assertFalse(CommandService.carriesLegacyCommandKeys(null));

        /* Boş değer sözleşme ihlali sayılmaz (gürültü üretmesin). */
        Map<String, String> emptyValue = serverWakeData("new_command");
        emptyValue.put("cmd_type", "");
        assertFalse(CommandService.carriesLegacyCommandKeys(emptyValue));

        Map<String, String> dirty = serverWakeData("new_command");
        dirty.put("e2e_payload", "{}");
        assertTrue(CommandService.carriesLegacyCommandKeys(dirty));
        /* …ama GÖZLEM sınıflandırmayı DEĞİŞTİRMEZ (otorite değil). */
        assertEquals(CommandService.FcmDataKind.WAKE_ONLY, CommandService.classifyFcmData(dirty));
    }

    // ── 4 · Native crypto: decrypt gitti, nonce otoritesi kaldı ────────────

    @Test
    public void nativeCryptoKeepsNonceAuthorityAndDropsCommandDecrypt() {
        Set<String> declared = declaredMethodNames(NativeCryptoManager.class);

        for (String forbidden : new String[] {
                "decryptCommandPayload",     // FCM fiziksel yürütücünün tek girişiydi
                "loadCarPrivateKey",
                "parseEcPrivateKeyFromJwk",
                "hkdfSha256" }) {
            assertFalse("native komut decrypt yolu geri gelmiş: " + forbidden,
                declared.contains(forbidden));
        }

        /* CANLI yol: CarLauncherPlugin.checkCommandNonce → JS commandCrypto
           cross-channel replay kontrolü. Kaldırılamaz. */
        assertTrue("cross-channel nonce otoritesi kaybolmuş",
            declared.contains("checkAndMarkNonce"));
    }
}
