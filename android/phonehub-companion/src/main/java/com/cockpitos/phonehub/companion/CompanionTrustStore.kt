package com.cockpitos.phonehub.companion

import android.content.Context

/**
 * CompanionTrustStore — telefonun güvendiği CAROS kaydı (GÖREV 19).
 *
 * ── SAKLANAN ────────────────────────────────────────────────────────────────
 * CAROS'un kimlik parmak izi · kullanıcının seçtiği cihazın YEREL parmak izi
 * (MAC'ten türetilmiş, geri çevrilemez) · son başarılı bağlantı · protokol
 * sürümü · bağlantı sayısı · şema sürümü.
 *
 * ── SAKLANMAYAN (PAZARLIKSIZ) ───────────────────────────────────────────────
 * MAC adresi · cihazın Bluetooth adı · telefon numarası · eşleştirme kodu ·
 * oturum anahtarı · nonce · ham açık anahtar · mesaj yükü.
 *
 * ── NEDEN CİHAZ ADI DA SAKLANMIYOR ──────────────────────────────────────────
 * Cihaz adı kullanıcı tarafından değiştirilebilen ve çoğu zaman kişisel bilgi
 * içeren bir alandır ("Ahmet'in arabası"). Seçim ekranında GÖSTERİLİR çünkü
 * kullanıcının ayırt etmesi gerekir; ama kalıcı kayda girmesi için hiçbir
 * teknik sebep yoktur — yerel parmak izi aynı işi görür.
 */
class CompanionTrustStore(context: Context) {

    companion object {
        private const val PREFS = "caros.phonehub.companion.trust"
        private const val SCHEMA_VERSION = 1

        private const val KEY_SCHEMA = "schema"
        private const val KEY_PEER_FINGERPRINT = "peer_fp"
        private const val KEY_DEVICE_LOCAL_FP = "device_local_fp"
        private const val KEY_LAST_CONNECTED = "last_connected_at"
        private const val KEY_PROTOCOL = "protocol_version"
        private const val KEY_CONNECT_COUNT = "connect_count"

        private const val PEER_FINGERPRINT_CHARS = 32
        private const val DEVICE_FINGERPRINT_CHARS = 16

        fun isHex(value: String?, length: Int): Boolean {
            if (value == null || value.length != length) return false
            return value.all { it in '0'..'9' || it in 'a'..'f' }
        }
    }

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    init {
        /* Şema uyuşmazlığı → güven SIFIRLANIR. Yarı okunmuş bir kayda
         * dayanarak kullanıcı onayını atlamak en kötü fail-open olurdu. */
        if (prefs.getInt(KEY_SCHEMA, 0) != SCHEMA_VERSION) {
            prefs.edit().clear().putInt(KEY_SCHEMA, SCHEMA_VERSION).apply()
        }
    }

    /** Güvenilen CAROS'un kimlik parmak izi; yoksa null. */
    fun trustedPeerFingerprint(): String? =
        prefs.getString(KEY_PEER_FINGERPRINT, null)
            ?.takeIf { isHex(it, PEER_FINGERPRINT_CHARS) }

    /** Kullanıcının seçtiği cihazın yerel parmak izi; yoksa null. */
    fun selectedDeviceFingerprint(): String? =
        prefs.getString(KEY_DEVICE_LOCAL_FP, null)
            ?.takeIf { isHex(it, DEVICE_FINGERPRINT_CHARS) }

    fun hasTrustedPeer(): Boolean = trustedPeerFingerprint() != null

    /** Bilinmiyorsa -1 — sahte 0 (1970) YAZILMAZ. */
    fun lastConnectedAtMs(): Long = prefs.getLong(KEY_LAST_CONNECTED, -1L)

    fun protocolVersion(): Int = prefs.getInt(KEY_PROTOCOL, -1)

    fun connectCount(): Int = prefs.getInt(KEY_CONNECT_COUNT, 0)

    /** Kullanıcının seçtiği cihazı hatırlar — MAC DEĞİL, yerel özet. */
    fun rememberSelectedDevice(localFingerprint: String): Boolean {
        if (!isHex(localFingerprint, DEVICE_FINGERPRINT_CHARS)) return false
        prefs.edit().putString(KEY_DEVICE_LOCAL_FP, localFingerprint).apply()
        return true
    }

    /**
     * Güven kaydı YALNIZ şifreli oturum gerçekten kurulduktan sonra yazılır.
     * "El sıkışma başladı" veya "kullanıcı kodu onayladı" tek başına yetmez.
     */
    fun trustPeer(peerFingerprint: String, protocolVersion: Int, nowMs: Long): Boolean {
        if (!isHex(peerFingerprint, PEER_FINGERPRINT_CHARS)) return false
        val previous = trustedPeerFingerprint()
        val count = if (peerFingerprint == previous) connectCount() + 1 else 1
        prefs.edit()
            .putInt(KEY_SCHEMA, SCHEMA_VERSION)
            .putString(KEY_PEER_FINGERPRINT, peerFingerprint)
            .putLong(KEY_LAST_CONNECTED, nowMs)
            .putInt(KEY_PROTOCOL, protocolVersion)
            .putInt(KEY_CONNECT_COUNT, count)
            .apply()
        return true
    }

    /** "Güvenilen CAROS'u unut" — kayıt tamamen silinir. */
    fun forget() {
        prefs.edit().clear().putInt(KEY_SCHEMA, SCHEMA_VERSION).apply()
    }
}
