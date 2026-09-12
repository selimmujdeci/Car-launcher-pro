package com.cockpitos.phonehub.protocol;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.KeyAgreement;

/**
 * LinkKeyExchange — P-256 anahtar anlaşması ve imza doğrulama (GÖREV 7).
 *
 * ── MİMARİ AYRIM: KİMLİK ANAHTARI ≠ OTURUM ANAHTARI ─────────────────────────
 * KİMLİK anahtarı uzun ömürlüdür, cihazı temsil eder ve Android Keystore
 * içinde durur; özel kısmı ASLA dışarı çıkmaz ({@link LinkIdentitySigner}
 * arayüzü bu yüzden var — imzalama Keystore'da olur, burada değil).
 * OTURUM anahtarı her bağlantıda YENİDEN üretilir, yalnız bellektedir ve
 * bağlantı bitince ölür → ileri gizlilik (forward secrecy).
 *
 * ── NEDEN ECDH KEYSTORE'DA DEĞİL: ÖLÇÜLMÜŞ PLATFORM SINIRI ──────────────────
 * Android Keystore anahtar anlaşmasını (PURPOSE_AGREE_KEY) yalnız API 31+
 * destekler; bu projenin minSdk'sı 24'tür. Bu yüzden ephemeral ECDH çifti
 * BELLEKTE üretilir ve Keystore'daki kimlik anahtarıyla İMZALANIR. Böylece:
 * kimlik özel anahtarı hiç dışarı çıkmaz, oturum anahtarı ileri gizlilik
 * kazanır ve hiçbir yerde "Keystore koruyor" diye YANLIŞ bir iddia kurulmaz.
 *
 * Bu sınıf saf JCA kullanır → JUnit'te gerçek anahtarlarla test edilir.
 */
public final class LinkKeyExchange {

    public static final String CURVE = "secp256r1";     // NIST P-256
    public static final String SIGNATURE_ALGORITHM = "SHA256withECDSA";

    private LinkKeyExchange() { }

    /** Bu bağlantıya özel, YALNIZ BELLEKTE yaşayan ECDH çifti üretir. */
    public static KeyPair generateEphemeralKeyPair() throws GeneralSecurityException {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec(CURVE));
        return g.generateKeyPair();
    }

    /** SPKI (X.509) kodlu açık anahtarı çözer. Bozuk girdi → GeneralSecurityException. */
    public static PublicKey decodePublicKey(byte[] spki) throws GeneralSecurityException {
        if (spki == null || spki.length == 0) {
            throw new GeneralSecurityException("açık anahtar boş");
        }
        KeyFactory kf = KeyFactory.getInstance("EC");
        return kf.generatePublic(new X509EncodedKeySpec(spki));
    }

    /**
     * ECDH paylaşılan sırrı. HAM çıktıdır — doğrudan AES anahtarı OLARAK
     * KULLANILMAZ; {@link SessionCrypto#derive} HKDF'den geçirir.
     */
    public static byte[] sharedSecret(java.security.PrivateKey ownEphemeralPrivate,
                                      PublicKey peerEphemeralPublic)
            throws GeneralSecurityException {
        KeyAgreement ka = KeyAgreement.getInstance("ECDH");
        ka.init(ownEphemeralPrivate);
        ka.doPhase(peerEphemeralPublic, true);
        return ka.generateSecret();
    }

    /**
     * Kimlik parmak izi — açık anahtarın SHA-256 özetinin ilk 16 baytı, onaltılık.
     *
     * Neden ham açık anahtar değil: parmak izi kısa, karşılaştırılabilir ve
     * kalıcı kayıtta saklanabilir; ham anahtar ise gereksiz yere büyüktür ve
     * ekranda gösterilmesi yasaktır (GÖREV 12).
     */
    public static String fingerprint(byte[] publicKeySpki) throws GeneralSecurityException {
        if (publicKeySpki == null || publicKeySpki.length == 0) {
            throw new GeneralSecurityException("açık anahtar boş");
        }
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] digest = md.digest(publicKeySpki);
        StringBuilder sb = new StringBuilder(32);
        for (int i = 0; i < 16; i++) {
            sb.append(Character.forDigit((digest[i] >> 4) & 0xF, 16));
            sb.append(Character.forDigit(digest[i] & 0xF, 16));
        }
        return sb.toString();
    }

    /**
     * İmza doğrulama. Doğrulama HER ZAMAN bu sınıfta yapılabilir (açık anahtar
     * işi); İMZALAMA ise {@link LinkIdentitySigner} üzerinden Keystore'a gider.
     *
     * ASLA throw etmez — bozuk imza, bozuk anahtar ve desteklenmeyen algoritma
     * hepsi {@code false} döner (fail-closed).
     */
    public static boolean verify(byte[] publicKeySpki, byte[] data, byte[] signature) {
        if (publicKeySpki == null || data == null || signature == null
            || signature.length == 0) {
            return false;
        }
        try {
            Signature s = Signature.getInstance(SIGNATURE_ALGORITHM);
            s.initVerify(decodePublicKey(publicKeySpki));
            s.update(data);
            return s.verify(signature);
        } catch (GeneralSecurityException e) {
            return false;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
