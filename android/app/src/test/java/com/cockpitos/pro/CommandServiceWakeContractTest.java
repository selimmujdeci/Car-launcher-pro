package com.cockpitos.pro;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

/**
 * CommandServiceWakeContractTest — Push-to-Wake payload'ı dormant fiziksel
 * yürütücüye ULAŞAMAZ (MRI F-08 · F-02 sınırı).
 *
 * Sunucu wake üreticisi (`website/supabase/functions/push-notify/fcmDelivery.ts
 * buildWakeMessage`) FCM `data` haritasına YALNIZ {event, vehicle_id, ts} yazar.
 * Native `CommandService.onMessageReceived` dallanmasını `classifyFcmData`
 * saf kararından alır. Bu test o sözleşmenin İKİ ucunu bağlar:
 *   · sunucunun ürettiği her wake verisi → WAKE_ONLY (fiziksel dal yok);
 *   · ENCRYPTED_COMMAND dalı yalnız `e2e_payload` üst düzey anahtarıyla
 *     açılır — o anahtarı üreten sunucu yolu YOKTUR;
 *   · insan bildirimi olayları (vehicle_offline …) araçta HİÇ işlenmez.
 *
 * `classifyFcmData` Android çağrısı yapmaz → Robolectric/cihaz olmadan JVM'de
 * koşar. Fiziksel dalın kendisi (dormant) bu turda genişletilmez.
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

    @Test
    public void serverWakeContractIsWakeOnly() {
        for (String ev : new String[] { "new_command", "command_pending" }) {
            assertEquals("wake sözleşmesi fiziksel dala düşmemeli: " + ev,
                CommandService.FcmDataKind.WAKE_ONLY,
                CommandService.classifyFcmData(serverWakeData(ev)));
        }
    }

    @Test
    public void wakeContractNeverReachesEncryptedBranchEvenWithExtraNonCommandKeys() {
        /* Sunucu sözleşmesi dışı ama zararsız alanlar (ör. gelecekte eklenebilecek
           metadata) fiziksel dalı AÇAMAZ: dal yalnız `e2e_payload` ile açılır. */
        Map<String, String> d = serverWakeData("new_command");
        d.put("command_id", "cmd-1");
        d.put("payload", "{\"e2e_payload\":\"...\"}");   // string içinde geçen anahtar ÜST DÜZEY DEĞİLDİR
        assertNotEquals(CommandService.FcmDataKind.ENCRYPTED_COMMAND,
            CommandService.classifyFcmData(d));
        assertEquals(CommandService.FcmDataKind.WAKE_ONLY, CommandService.classifyFcmData(d));
    }

    @Test
    public void humanNotificationEventsAreIgnoredByVehicle() {
        for (String ev : new String[] { "vehicle_offline", "command_completed", "command_failed",
                                        "health_alert", "speed_alert", "", "unlock" }) {
            Map<String, String> d = serverWakeData(ev);
            assertEquals("insan bildirimi araçta işlenmemeli: " + ev,
                CommandService.FcmDataKind.IGNORE, CommandService.classifyFcmData(d));
            /* e2e_payload olsa bile olay wake ailesinden değilse HİÇBİR dal açılmaz. */
            d.put("e2e_payload", "{\"x\":1}");
            assertEquals(CommandService.FcmDataKind.IGNORE, CommandService.classifyFcmData(d));
        }
    }

    @Test
    public void encryptedBranchRequiresTopLevelE2ePayloadKey() {
        /* Dormant dalın giriş koşulu belgelenir: yalnız üst düzey `e2e_payload`.
           Bu anahtarı üreten sunucu yolu yoktur (fcmDelivery.test 13/13b). */
        Map<String, String> d = serverWakeData("new_command");
        d.put("e2e_payload", "{\"eph_pub\":\"...\"}");
        assertEquals(CommandService.FcmDataKind.ENCRYPTED_COMMAND, CommandService.classifyFcmData(d));
    }

    @Test
    public void nullOrEmptyDataIsIgnored() {
        assertEquals(CommandService.FcmDataKind.IGNORE, CommandService.classifyFcmData(null));
        assertEquals(CommandService.FcmDataKind.IGNORE, CommandService.classifyFcmData(new HashMap<>()));
    }
}
