package com.cockpitos.phonehub.protocol;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * HkdfSha256 — RFC 5869 HKDF (extract + expand).
 *
 * ── NEDEN HAM ECDH ÇIKTISI DOĞRUDAN ANAHTAR OLARAK KULLANILMAZ ──────────────
 * ECDH paylaşılan sırrı düzgün dağılmış BİR ANAHTAR DEĞİLDİR; eğri üzerindeki
 * bir noktanın X koordinatıdır ve istatistiksel yapısı vardır. Doğrudan AES
 * anahtarı yapmak yaygın ve ciddi bir hatadır. HKDF önce entropiyi toplar
 * (extract), sonra bağlama-özgü anahtarlar üretir (expand).
 *
 * ── YÖN AYRIMI: NONCE TEKRARINA KARŞI YAPISAL KORUMA ────────────────────────
 * Her yön (telefon→CAROS, CAROS→telefon) AYRI `info` ile AYRI anahtar türetir.
 * Tek anahtar + tek sayaç kullanılsaydı, iki uç aynı sayaç değerini bağımsız
 * kullanabilir ve AES-GCM'de nonce tekrarı oluşurdu — GCM'de nonce tekrarı
 * ANAHTARI ve kimlik doğrulamayı çökertir. Ayrı anahtarlar bu riski YAPISAL
 * olarak yok eder.
 *
 * Saf JCA kullanır (`HmacSHA256`) — Android ve düz JDK'da aynı sonucu verir,
 * bu yüzden JUnit'te deterministik olarak test edilebilir.
 */
public final class HkdfSha256 {

    private static final String HMAC = "HmacSHA256";
    private static final int HASH_LEN = 32;

    private HkdfSha256() { }

    /**
     * RFC 5869 §2.2 — extract.
     *
     * @param salt null ise sıfır tuz kullanılır (RFC'ye uygun ve iki uçta
     *             deterministik olması için bilinçli tercih).
     */
    public static byte[] extract(byte[] salt, byte[] inputKeyMaterial)
            throws GeneralSecurityException {
        byte[] s = (salt == null || salt.length == 0) ? new byte[HASH_LEN] : salt;
        Mac mac = Mac.getInstance(HMAC);
        mac.init(new SecretKeySpec(s, HMAC));
        return mac.doFinal(inputKeyMaterial == null ? new byte[0] : inputKeyMaterial);
    }

    /** RFC 5869 §2.3 — expand. */
    public static byte[] expand(byte[] pseudoRandomKey, byte[] info, int outputLength)
            throws GeneralSecurityException {
        if (outputLength <= 0 || outputLength > 255 * HASH_LEN) {
            throw new GeneralSecurityException("HKDF çıkış uzunluğu geçersiz");
        }
        Mac mac = Mac.getInstance(HMAC);
        mac.init(new SecretKeySpec(pseudoRandomKey, HMAC));

        byte[] out = new byte[outputLength];
        byte[] block = new byte[0];
        int done = 0;
        for (int counter = 1; done < outputLength; counter++) {
            mac.reset();
            mac.update(block);
            if (info != null && info.length > 0) mac.update(info);
            mac.update((byte) counter);
            block = mac.doFinal();
            int take = Math.min(block.length, outputLength - done);
            System.arraycopy(block, 0, out, done, take);
            done += take;
        }
        Arrays.fill(block, (byte) 0);
        return out;
    }

    /** extract + expand tek adımda. */
    public static byte[] derive(byte[] salt, byte[] inputKeyMaterial,
                                String info, int outputLength)
            throws GeneralSecurityException {
        byte[] prk = extract(salt, inputKeyMaterial);
        try {
            return expand(prk, info == null ? null : info.getBytes(StandardCharsets.UTF_8),
                outputLength);
        } finally {
            Arrays.fill(prk, (byte) 0);
        }
    }
}
