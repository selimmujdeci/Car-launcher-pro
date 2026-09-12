package com.cockpitos.phonehub.companion

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import com.cockpitos.phonehub.protocol.LinkIdentitySigner
import com.cockpitos.phonehub.protocol.LinkKeyExchange
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * CompanionIdentitySigner — telefonun kimlik anahtarı (GÖREV 7).
 *
 * ── HEAD UNIT'TEKİ İKİZİYLE İLİŞKİSİ (BİLİNÇLİ TEKRAR) ──────────────────────
 * `:app` içinde `KeystoreIdentitySigner` adında Java bir eşdeğeri vardır.
 * Bu tekrar bilinçlidir ve BEYAN EDİLMİŞTİR: iki uygulama ayrı APK'lardır ve
 * aralarında Android kodu paylaşan bir kütüphane modülü kurmak, bu turda
 * `:app`'in yapısını değiştirmeyi gerektirirdi (mevcut kilit testleri `:app`
 * kaynak ağacını tarıyor). Ayrışma riskine karşı KRİTİK olan sabitler
 * (`SIGNATURE_ALGORITHM`, eğri adı) tek yerden — {@link LinkKeyExchange} —
 * okunur; burada kopyalanan yalnız Keystore kabuğudur.
 *
 * ── ANAHTAR DIŞARI ÇIKMAZ ───────────────────────────────────────────────────
 * Özel anahtar AndroidKeyStore içinde üretilir ve baytları hiçbir zaman
 * okunamaz. İmza başarısız olursa {@code null} döner; çağıran bunu fail-closed
 * olarak ele alır ve bağlantı KURULMAZ.
 */
class CompanionIdentitySigner(
    private val alias: String = DEFAULT_ALIAS,
) : LinkIdentitySigner {

    companion object {
        const val DEFAULT_ALIAS = "caros-phonehub-companion-identity"
        private const val KEYSTORE = "AndroidKeyStore"
    }

    @Volatile private var cachedPublicSpki: ByteArray? = null
    @Volatile private var cachedHardwareBacked: Boolean? = null

    override fun identityPublicKeySpki(): ByteArray? {
        cachedPublicSpki?.let { return it }
        return try {
            val spki = ensureKeyPair() ?: return null
            cachedPublicSpki = spki
            spki
        } catch (e: Exception) {
            null
        }
    }

    override fun sign(data: ByteArray?): ByteArray? {
        if (data == null) return null
        return try {
            val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            var priv = ks.getKey(alias, null) as? PrivateKey
            if (priv == null) {
                /* İlk kullanımda anahtar henüz yoktur — üret ve tekrar dene. */
                if (ensureKeyPair() == null) return null
                priv = ks.getKey(alias, null) as? PrivateKey ?: return null
            }
            Signature.getInstance(LinkKeyExchange.SIGNATURE_ALGORITHM).run {
                initSign(priv)
                update(data)
                sign()
            }
        } catch (e: Exception) {
            null
        }
    }

    /** Ölçülemezse {@code false} — "muhtemelen donanımda" diye YÜKSELTİLMEZ. */
    override fun isHardwareBacked(): Boolean {
        cachedHardwareBacked?.let { return it }
        val result = try {
            val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            val priv = ks.getKey(alias, null) as? PrivateKey
            if (priv == null) false else {
                val info = KeyFactory.getInstance(priv.algorithm, KEYSTORE)
                    .getKeySpec(priv, KeyInfo::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE
                } else {
                    @Suppress("DEPRECATION")
                    info.isInsideSecureHardware
                }
            }
        } catch (e: Exception) {
            false
        }
        cachedHardwareBacked = result
        return result
    }

    /** Kimlik parmak izi — karşı tarafın bizi tanıdığı değer. */
    fun fingerprintOrNull(): String? = try {
        identityPublicKeySpki()?.let { LinkKeyExchange.fingerprint(it) }
    } catch (e: Exception) {
        null
    }

    fun hasIdentity(): Boolean = try {
        KeyStore.getInstance(KEYSTORE).apply { load(null) }.containsAlias(alias)
    } catch (e: Exception) {
        false
    }

    /** Kimliği siler — "Güvenilen CAROS'u unut" akışının bizim tarafımız. */
    fun deleteIdentity(): Boolean {
        cachedPublicSpki = null
        cachedHardwareBacked = null
        return try {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.run {
                if (containsAlias(alias)) deleteEntry(alias)
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun ensureKeyPair(): ByteArray? {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.PrivateKeyEntry)?.let {
            return it.certificate.publicKey.encoded
        }
        val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
        gen.initialize(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec(LinkKeyExchange.CURVE))
                .setDigests(KeyProperties.DIGEST_SHA256)
                /* Ekran kilidi ŞART KOŞULMAZ: kilitsiz telefonlarda bağlantıyı
                 * tamamen imkânsız kılardı. Anahtar yine dışa aktarılamaz. */
                .setUserAuthenticationRequired(false)
                .build()
        )
        return gen.generateKeyPair()?.public?.encoded
    }
}
