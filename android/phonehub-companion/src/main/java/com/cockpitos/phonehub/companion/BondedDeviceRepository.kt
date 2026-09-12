package com.cockpitos.phonehub.companion

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.cockpitos.phonehub.protocol.LinkErrorCode
import java.security.MessageDigest

/**
 * BondedDeviceRepository — YALNIZ eşleştirilmiş cihazların listesi (GÖREV 2).
 *
 * ── TARAMA YOK, EŞLEŞTİRME YOK ──────────────────────────────────────────────
 * Bu sınıf {@code startDiscovery()} veya {@code createBond()} ÇAĞIRMAZ.
 * Gerekçe iki katmanlı: (1) tarama BLUETOOTH_SCAN izni ve çoğu cihazda konum
 * izni ister — bu faz için gereksiz bir mahremiyet bedeli; (2) eşleştirmeyi
 * uygulamanın içinden başlatmak, kullanıcının sistem onay ekranını atlatmaya
 * çalışmak gibi görünür. Eşleştirme SİSTEM ayarlarından yapılır, biz yalnız
 * sonucunu okuruz.
 *
 * ── MAC KURALI ──────────────────────────────────────────────────────────────
 * Cihaz ADI kullanıcıya gösterilebilir (seçim yapabilmesi için gerekli).
 * MAC ADRESİ ne gösterilir ne saklanır. Kalıcı kayıt gerektiğinde MAC'ten
 * türetilmiş, GERİ ÇEVRİLEMEZ bir yerel parmak izi kullanılır — böylece
 * "aynı cihaz mı" sorusu cevaplanabilirken adresin kendisi hiçbir yere
 * yazılmaz.
 */
class BondedDeviceRepository(private val context: Context) {

    /**
     * Kullanıcıya gösterilecek cihaz seçeneği.
     *
     * {@link device} yalnız BELLEKTE yaşar ve kalıcı kayda GİRMEZ.
     */
    data class DeviceOption(
        val displayName: String,
        /** MAC'ten türetilmiş geri çevrilemez yerel kimlik (16 hex). */
        val localFingerprint: String,
        val device: BluetoothDevice,
        /** CAROS olma ihtimali yüksek mi — yalnız SIRALAMA ipucu, KANIT DEĞİL. */
        val likelyCarOs: Boolean,
    )

    sealed class Result {
        data class Success(val devices: List<DeviceOption>) : Result()
        data class Failure(val code: LinkErrorCode) : Result()
    }

    /**
     * Eşleştirilmiş cihazları döndürür.
     *
     * Boş liste ile hata AYRI şeylerdir: izin yoksa {@code Failure} döner,
     * izin var ama eşleştirilmiş cihaz yoksa boş {@code Success} döner.
     * İkisini karıştırmak kullanıcıya yanlış yönlendirme yapardı.
     */
    fun listBondedDevices(): Result {
        val adapter = BluetoothAdapter.getDefaultAdapter()
            ?: return Result.Failure(LinkErrorCode.BLUETOOTH_UNAVAILABLE)
        if (!hasConnectPermission()) {
            return Result.Failure(LinkErrorCode.BLUETOOTH_PERMISSION_REQUIRED)
        }
        if (!adapter.isEnabled) {
            return Result.Failure(LinkErrorCode.BLUETOOTH_DISABLED)
        }

        return try {
            val bonded: Set<BluetoothDevice> = adapter.bondedDevices ?: emptySet()
            val options = bonded.mapNotNull { device ->
                val address = device.address ?: return@mapNotNull null
                val name = safeName(device)
                DeviceOption(
                    displayName = name,
                    localFingerprint = localFingerprintOf(address),
                    device = device,
                    likelyCarOs = looksLikeCarOs(name),
                )
            }.sortedWith(compareByDescending<DeviceOption> { it.likelyCarOs }
                .thenBy { it.displayName.lowercase() })
            Result.Success(options)
        } catch (e: SecurityException) {
            Result.Failure(LinkErrorCode.BLUETOOTH_PERMISSION_DENIED)
        }
    }

    fun hasConnectPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED
    }

    /** Cihaz adı okunamazsa uydurulmaz — açıkça bilinmiyor denir. */
    private fun safeName(device: BluetoothDevice): String = try {
        val n = device.name
        if (n.isNullOrBlank()) "Adsız cihaz" else n
    } catch (e: SecurityException) {
        "Adsız cihaz"
    }

    /**
     * Ad ipucu — YALNIZ listeyi sıralamak için. Bu bir KANIT DEĞİLDİR:
     * P0.7'nin dersi (substring taraması kanıt sayılamaz) burada da geçerlidir.
     * Cihazın gerçekten CAROS olup olmadığı ancak el sıkışmada, imzayla
     * anlaşılır.
     */
    private fun looksLikeCarOs(name: String): Boolean {
        val lower = name.lowercase()
        return lower.contains("caros") || lower.contains("cockpit")
    }

    companion object {
        /**
         * MAC'ten geri çevrilemez yerel parmak izi. Yalnız BU cihazda anlamlıdır
         * ve MAC'i geri vermez; amacı "kullanıcının seçtiği cihaz hâlâ aynı mı"
         * sorusunu MAC saklamadan cevaplamaktır.
         */
        fun localFingerprintOf(address: String): String {
            val md = MessageDigest.getInstance("SHA-256")
            val digest = md.digest(("caros-phonehub-local|$address").toByteArray())
            val sb = StringBuilder(16)
            for (i in 0 until 8) {
                sb.append(Character.forDigit((digest[i].toInt() shr 4) and 0xF, 16))
                sb.append(Character.forDigit(digest[i].toInt() and 0xF, 16))
            }
            return sb.toString()
        }
    }
}
