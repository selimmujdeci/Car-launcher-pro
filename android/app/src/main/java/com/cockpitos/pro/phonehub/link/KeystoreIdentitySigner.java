package com.cockpitos.pro.phonehub.link;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Log;

import com.cockpitos.phonehub.protocol.LinkIdentitySigner;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

/**
 * KeystoreIdentitySigner — cihaz kimliği Android Keystore'da (GÖREV 7).
 *
 * ── ÖZEL ANAHTAR HİÇ DIŞARI ÇIKMAZ ──────────────────────────────────────────
 * Anahtar çifti {@code AndroidKeyStore} sağlayıcısında üretilir; özel kısmın
 * baytlarına ne bu sınıf ne de protokol modülü erişebilir. Yalnız "şu baytları
 * imzala" denebilir. Bu yüzden {@link LinkIdentitySigner} bir ARAYÜZDÜR:
 * saf Java protokol modülü Keystore'u görmez, yalnız sözleşmeyi bilir.
 *
 * ── NEDEN YALNIZ İMZALAMA, ANAHTAR ANLAŞMASI DEĞİL ──────────────────────────
 * Keystore ECDH (PURPOSE_AGREE_KEY) desteğini API 31'de kazandı; bu projenin
 * minSdk'sı 24. Bu yüzden Keystore anahtarı KİMLİK için (ECDSA imzalama)
 * kullanılır; oturum anahtarı ephemeral ECDH ile bellekte üretilir ve bu
 * kimlikle İMZALANARAK bağlanır. Ne eksik bir şey gizleniyor ne de olmayan
 * bir donanım koruması iddia ediliyor.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Anahtar üretilemez veya imzalanamazsa {@code null} döner. Çağıran bunu
 * {@code SECURITY_NOT_IMPLEMENTED} olarak ele alır ve bağlantı KURULMAZ —
 * imzasız/şifresiz bir yola SESSİZCE düşülmez.
 */
public final class KeystoreIdentitySigner implements LinkIdentitySigner {

    private static final String TAG = "PhoneHubIdentity";
    private static final String KEYSTORE = "AndroidKeyStore";

    /** Head unit ve companion AYRI alias kullanır — aynı APK değiller. */
    private final String alias;

    private volatile byte[] cachedPublicSpki;
    private volatile Boolean cachedHardwareBacked;

    public KeystoreIdentitySigner(String alias) {
        this.alias = alias;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sözleşme
     * ════════════════════════════════════════════════════════════════════ */

    @Override
    public byte[] identityPublicKeySpki() {
        byte[] cached = cachedPublicSpki;
        if (cached != null) return cached;
        try {
            PublicKey pub = ensureKeyPair();
            if (pub == null) return null;
            byte[] spki = pub.getEncoded();
            cachedPublicSpki = spki;
            return spki;
        } catch (Exception e) {
            Log.w(TAG, "kimlik açık anahtarı okunamadı: " + e.getClass().getSimpleName());
            return null;
        }
    }

    @Override
    public byte[] sign(byte[] data) {
        if (data == null) return null;
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            PrivateKey priv = (PrivateKey) ks.getKey(alias, null);
            if (priv == null) {
                /* Anahtar yoksa üret ve TEKRAR DENE — ilk kurulumda normaldir. */
                if (ensureKeyPair() == null) return null;
                priv = (PrivateKey) ks.getKey(alias, null);
                if (priv == null) return null;
            }
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initSign(priv);
            s.update(data);
            return s.sign();
        } catch (Exception e) {
            Log.w(TAG, "imzalama başarısız: " + e.getClass().getSimpleName());
            return null;
        }
    }

    /**
     * Donanım desteği. BİLİNMİYORSA {@code false} döner — "muhtemelen TEE'dedir"
     * diye yükseltilmez. Bu değer yalnız tanı içindir, güvenlik kararı vermez.
     */
    @Override
    public boolean isHardwareBacked() {
        Boolean cached = cachedHardwareBacked;
        if (cached != null) return cached;
        boolean result = false;
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            PrivateKey priv = (PrivateKey) ks.getKey(alias, null);
            if (priv != null) {
                KeyFactory factory = KeyFactory.getInstance(priv.getAlgorithm(), KEYSTORE);
                KeyInfo info = factory.getKeySpec(priv, KeyInfo.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    result = info.getSecurityLevel()
                        != KeyProperties.SECURITY_LEVEL_SOFTWARE;
                } else {
                    result = info.isInsideSecureHardware();
                }
            }
        } catch (Exception e) {
            result = false;   // ölçemedik → İDDİA ETMİYORUZ
        }
        cachedHardwareBacked = result;
        return result;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Güven kaydı yönetimi
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Kimlik anahtarını SİLER — "Güvenilen telefonu unut" akışının kimlik
     * ayağı. Yeni anahtar bir sonraki kullanımda üretilir, dolayısıyla eski
     * güven kayıtları karşı tarafta doğal olarak geçersizleşir.
     */
    public boolean deleteIdentity() {
        cachedPublicSpki = null;
        cachedHardwareBacked = null;
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "kimlik silinemedi: " + e.getClass().getSimpleName());
            return false;
        }
    }

    /** Kimlik anahtarı var mı — tanı ekranı için (üretmez, yalnız bakar). */
    public boolean hasIdentity() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            return ks.containsAlias(alias);
        } catch (Exception e) {
            return false;
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç
     * ════════════════════════════════════════════════════════════════════ */

    private PublicKey ensureKeyPair() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);

        KeyStore.Entry entry = ks.getEntry(alias, null);
        if (entry instanceof KeyStore.PrivateKeyEntry) {
            return ((KeyStore.PrivateKeyEntry) entry).getCertificate().getPublicKey();
        }

        KeyPairGenerator gen = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC, KEYSTORE);
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
            alias, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            /* Ekran kilidi ŞARTI KOYULMAZ: head unit'lerde çoğu zaman kilit
             * yoktur ve şart koşmak bağlantıyı imkânsız kılardı. Anahtar yine
             * de Keystore'da ve dışa aktarılamaz. */
            .setUserAuthenticationRequired(false);

        gen.initialize(builder.build());
        KeyPair pair = gen.generateKeyPair();
        return pair == null ? null : pair.getPublic();
    }
}
