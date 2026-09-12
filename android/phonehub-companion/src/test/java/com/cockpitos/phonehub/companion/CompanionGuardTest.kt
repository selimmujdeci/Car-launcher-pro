package com.cockpitos.phonehub.companion

import com.cockpitos.phonehub.protocol.LinkErrorCode
import com.cockpitos.phonehub.protocol.PhoneHubUuid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * CompanionGuardTest — telefon uygulamasının yasak yüzey kilitleri
 * (GÖREV 3 + 19 + 21).
 *
 * ── NEDEN KAYNAK TARAMASI ───────────────────────────────────────────────────
 * Bu depoda Robolectric yoktur; Android'e bağlı davranışı çalıştırarak test
 * edemeyiz. Ama "bu çağrı KODDA GEÇMİYOR" iddiası kaynak taramasıyla kesin
 * biçimde kanıtlanabilir ve bir gün biri onu eklerse test DÜŞER. Bu, izin ve
 * gizlilik invaryantları için çalıştırma testinden daha güçlü bir güvencedir.
 */
class CompanionGuardTest {

    private fun sourceRoot(): File {
        val relatives = listOf(
            "src/main/java/com/cockpitos/phonehub/companion",
            "phonehub-companion/src/main/java/com/cockpitos/phonehub/companion",
            "android/phonehub-companion/src/main/java/com/cockpitos/phonehub/companion",
        )
        var dir: File? = File(".").absoluteFile
        repeat(8) {
            val current = dir ?: return@repeat
            relatives.forEach { rel ->
                val f = File(current, rel)
                if (f.isDirectory) return f
            }
            dir = current.parentFile
        }
        throw AssertionError("companion kaynak kökü bulunamadı")
    }

    private fun sources(): List<File> =
        sourceRoot().walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private fun stripComments(src: String): String =
        src.replace(Regex("(?s)/\\*.*?\\*/"), "").replace(Regex("(?m)//.*$"), "")

    private fun assertAbsent(vararg needles: String) {
        sources().forEach { file ->
            val code = stripComments(file.readText())
            needles.forEach { needle ->
                assertFalse("YASAK: $needle → ${file.name}", code.contains(needle))
            }
        }
    }

    /**
     * Manifest metni — XML YORUMLARI ÇIKARILMIŞ.
     *
     * Gerekçe (P0.7'nin dersi): substring taraması KANIT DEĞİLDİR. Manifest'in
     * açıklama bloğunda "BLUETOOTH_SCAN istenmez" yazması, izin isteniyormuş
     * gibi eşleşir. Yorumlar atılmadan yapılan bir kontrol hem yanlış-pozitif
     * üretir hem de bir gün gerçek bir izni gözden kaçırabilir.
     */
    private fun manifest(): String {
        val root = sourceRoot()
        var dir: File? = root
        repeat(8) {
            val current = dir ?: return@repeat
            val f = File(current, "AndroidManifest.xml")
            if (f.isFile) return f.readText().replace(Regex("(?s)<!--.*?-->"), "")
            dir = current.parentFile
        }
        throw AssertionError("AndroidManifest bulunamadı")
    }

    /** İzin TAM ADIYLA beyan edilmiş mi — substring değil, tam eşleşme. */
    private fun declaresPermission(xml: String, permission: String): Boolean =
        xml.contains("android:name=\"android.permission.$permission\"")

    /* ══════════════════════════════════════════════════════════════════════
     * A · Bluetooth yüzeyi
     * ════════════════════════════════════════════════════════════════════ */

    /** Uygulama Bluetooth'u programatik olarak AÇIP KAPATAMAZ. */
    @Test
    fun neverEnablesOrDisablesBluetooth() {
        assertAbsent("adapter.enable(", "adapter.disable(",
            ".enable()", ".disable()", "ACTION_REQUEST_ENABLE")
    }

    /** Tarama (discovery) BAŞLATILMAZ ve iptal EDİLMEZ — adapter geneli. */
    @Test
    fun neverStartsOrCancelsDiscovery() {
        assertAbsent("startDiscovery(", "cancelDiscovery(", "startScan(", "stopScan(")
    }

    /** Eşleştirme uygulamadan başlatılamaz — sistem ekranı kullanılır. */
    @Test
    fun neverCreatesOrRemovesBond() {
        assertAbsent("createBond(", "removeBond(")
    }

    /** Eşleştirmesiz (insecure) RFCOMM kullanıcı onayını atlar — yasak. */
    @Test
    fun neverUsesInsecureRfcomm() {
        assertAbsent("createInsecureRfcomm", "listenUsingInsecureRfcomm")
    }

    /** Gizli Android API'sine reflection ile erişilemez. */
    @Test
    fun neverUsesHiddenApiReflection() {
        assertAbsent("getDeclaredMethod", "getMethod(\"createRfcomm",
            "setAccessible(", "Class.forName(\"android.bluetooth")
    }

    /* ══════════════════════════════════════════════════════════════════════
     * B · Kişisel veri yüzeyleri
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    fun neverTouchesCallsSmsContactsOrNotifications() {
        assertAbsent(
            "ACTION_CALL", "placeCall(", "TelecomManager",
            "sendTextMessage(", "SmsManager",
            "ContactsContract", "NotificationListenerService",
            "dispatchMediaKeyEvent", "getActiveSessions(",
            "MediaSessionManager", "getProfileProxy(",
            "startBluetoothSco(", "setSpeakerphoneOn(", "setCommunicationDevice(")
    }

    /** A2DP/HFP profillerine dokunulmaz — medya ve çağrı sesi bizim işimiz değil. */
    @Test
    fun neverControlsA2dpOrHfp() {
        assertAbsent("BluetoothA2dp", "BluetoothHeadset", "BluetoothProfile.A2DP",
            "BluetoothProfile.HEADSET")
    }

    /* ══════════════════════════════════════════════════════════════════════
     * C · Ağ ve bulut
     * ════════════════════════════════════════════════════════════════════ */

    /** Bağlantı tamamen YERELDİR — relay, bulut, backend YOK. */
    @Test
    fun hasNoNetworkOrCloudAccess() {
        assertAbsent("HttpURLConnection", "OkHttp", "Retrofit", "WebSocket",
            "java.net.Socket", "firebase", "Firebase", "supabase", "Supabase",
            "URLConnection", "InetAddress")
    }

    /** Manifest'te INTERNET izni BULUNMAMALI — yapısal kanıt. */
    @Test
    fun manifestDeclaresNoInternetPermission() {
        val xml = manifest()
        assertFalse("companion internete çıkmamalı", declaresPermission(xml, "INTERNET"))
        assertFalse(declaresPermission(xml, "ACCESS_NETWORK_STATE"))
    }

    /* ══════════════════════════════════════════════════════════════════════
     * D · İzin beyanları
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Bu fazda tarama yapılmadığı için BLUETOOTH_SCAN ve konum izni
     * İSTENMEZ. Gereksiz izin istemek, kullanıcıdan bedelsiz mahremiyet
     * talep etmektir.
     */
    @Test
    fun manifestDoesNotRequestScanOrLocation() {
        val xml = manifest()
        listOf("BLUETOOTH_SCAN", "BLUETOOTH_ADVERTISE",
            "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION",
            "READ_CONTACTS", "READ_SMS", "SEND_SMS", "CALL_PHONE",
            "READ_PHONE_STATE", "RECORD_AUDIO").forEach {
            assertFalse("gereksiz izin istenmemeli: $it", declaresPermission(xml, it))
        }
    }

    @Test
    fun manifestDeclaresRequiredConnectAndForegroundPermissions() {
        val xml = manifest()
        assertTrue(declaresPermission(xml, "BLUETOOTH_CONNECT"))
        assertTrue(declaresPermission(xml, "FOREGROUND_SERVICE"))
        assertTrue(declaresPermission(xml, "FOREGROUND_SERVICE_CONNECTED_DEVICE"))
        assertTrue("Android 14+ servis tipi ZORUNLU",
            xml.contains("android:foregroundServiceType=\"connectedDevice\""))
    }

    /** Eski sürüm izinleri maxSdkVersion ile sınırlanmalı. */
    @Test
    fun legacyBluetoothPermissionsAreCapped() {
        val xml = manifest()
        assertTrue(xml.contains("android:maxSdkVersion=\"30\""))
    }

    /* ══════════════════════════════════════════════════════════════════════
     * E · Kalıcı kayıt gizliliği
     * ════════════════════════════════════════════════════════════════════ */

    /** MAC adresi hiçbir yerde SAKLANMAZ. */
    @Test
    fun macAddressIsNeverPersisted() {
        val trustStore = File(sourceRoot(), "CompanionTrustStore.kt")
        assertTrue(trustStore.isFile)
        val code = stripComments(trustStore.readText())
        listOf("\"mac", "address", "bdaddr", "device_name", "\"pin", "passkey",
            "session_key", "nonce", "pairing_code").forEach {
            assertFalse("güven kaydında yasak alan: $it", code.contains(it))
        }
        assertTrue("parmak izi saklanmalı", code.contains("peer_fp"))
        assertTrue("cihaz yerel özeti saklanmalı", code.contains("device_local_fp"))
    }

    /** Yerel parmak izi geri çevrilemez olmalı ve MAC'i İÇERMEMELİ. */
    @Test
    fun localFingerprintIsIrreversibleAndStable() {
        val mac = "AA:BB:CC:DD:EE:FF"
        val fp1 = BondedDeviceRepository.localFingerprintOf(mac)
        val fp2 = BondedDeviceRepository.localFingerprintOf(mac)
        val other = BondedDeviceRepository.localFingerprintOf("11:22:33:44:55:66")

        assertEquals("aynı adres aynı özet", fp1, fp2)
        assertNotEquals("farklı adres farklı özet", fp1, other)
        assertEquals(16, fp1.length)
        assertFalse("özet MAC'i içermemeli", fp1.contains("aabb"))
        assertFalse(fp1.contains("AA"))
    }

    @Test
    fun trustStoreRejectsMalformedFingerprints() {
        assertTrue(CompanionTrustStore.isHex("0123456789abcdef", 16))
        assertFalse("büyük harf hex kabul edilmemeli",
            CompanionTrustStore.isHex("0123456789ABCDEF", 16))
        assertFalse(CompanionTrustStore.isHex("kısa", 16))
        assertFalse(CompanionTrustStore.isHex(null, 16))
        assertFalse("MAC benzeri girdi reddedilmeli",
            CompanionTrustStore.isHex("AA:BB:CC:DD:EE:FF", 16))
    }

    /* ══════════════════════════════════════════════════════════════════════
     * F · Kaynak sınırları
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    fun noUnboundedExecutorOrQueue() {
        assertAbsent("newCachedThreadPool", "newWorkStealingPool",
            "LinkedBlockingQueue()")
    }

    /* ══════════════════════════════════════════════════════════════════════
     * G · Protokol paylaşımı
     * ════════════════════════════════════════════════════════════════════ */

    /** UUID companion'da KOPYALANMAMIŞ olmalı — tek otoriteden okunmalı. */
    @Test
    fun uuidIsReadFromSingleAuthority() {
        assertAbsent(PhoneHubUuid.SERVICE_UUID_STRING, "00001101-0000-1000-8000")
        assertTrue(PhoneHubUuid.isDistinctFromObdSpp())
    }

    /** Hata kodları paylaşılan sözlükten gelmeli — yerel kopya olmamalı. */
    @Test
    fun errorCodesComeFromSharedVocabulary() {
        assertEquals("Bluetooth kapalı", LinkErrorCode.BLUETOOTH_DISABLED.userMessage())
        assertNull(ReconnectPolicy().terminalReason())
    }

    /** Companion, head unit sunucu yüzeyini İÇERMEMELİ (rol karışmasın). */
    @Test
    fun companionNeverActsAsServer() {
        assertAbsent("BluetoothServerSocket", "listenUsingRfcomm", "serverSide = true")
    }
}
