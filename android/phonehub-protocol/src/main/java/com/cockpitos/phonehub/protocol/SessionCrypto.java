package com.cockpitos.phonehub.protocol;

import java.security.GeneralSecurityException;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * SessionCrypto — kurulmuş oturumun AES-256-GCM katmanı (GÖREV 8).
 *
 * ── NE KORUR, NE KORUMAZ (DÜRÜST BEYAN) ─────────────────────────────────────
 * KORUR: yük gizliliği · yük ve başlık bütünlüğü (AAD) · tekrar (replay) ·
 * yön karıştırma. KORUMAZ: trafik analizi (mesaj boyutu ve zamanlaması
 * görünürdür) · uç nokta ele geçirilmesi. Bu sınırlar gizlenmez.
 *
 * ── NONCE ASLA TEKRAR ETMEZ (GCM'DE HAYATİ) ─────────────────────────────────
 * AES-GCM'de aynı anahtarla aynı nonce'un iki kez kullanılması yalnız gizliliği
 * değil KİMLİK DOĞRULAMAYI da çökertir. Bu yüzden üç kat koruma vardır:
 *  1. Her YÖN ayrı anahtar türetir (HKDF `info` farklı) — iki uç birbirinin
 *     sayaç uzayına hiç girmez.
 *  2. Nonce = 4 baytlık yön öneki ‖ 8 baytlık monoton sayaç.
 *  3. Sayaç taşarsa (teorik) şifreleme DURUR; sarmalama YOKTUR.
 *
 * ── SAYAÇ GERİLEMESİ = TEKRAR SALDIRISI ─────────────────────────────────────
 * Alıcı, gördüğü en yüksek sayacı saklar; eşit veya küçük sayaç REDDEDİLİR.
 * Ayrıca yakın geçmişteki mesaj kimlikleri sınırlı bir pencerede tutulur —
 * aynı kimlikle gelen ikinci mesaj kabul edilmez.
 *
 * ── ANAHTARLAR NEREYE GİTMEZ ────────────────────────────────────────────────
 * Anahtar baytları: loglanmaz · toString'e girmez · durum dökümüne girmez ·
 * diske YAZILMAZ · JSON dışa aktarımına dahil edilmez. {@link #destroy()}
 * baytları sıfırlar.
 */
public final class SessionCrypto {

    /** HKDF bağlam etiketi — sürüm değişirse anahtarlar da değişir. */
    public static final String INFO_CLIENT_TO_SERVER = "caros-phonehub-v1|c2s";
    public static final String INFO_SERVER_TO_CLIENT = "caros-phonehub-v1|s2c";

    private static final int KEY_BYTES = 32;          // AES-256
    private static final int NONCE_PREFIX_BYTES = 4;
    private static final int COUNTER_BYTES = 8;
    private static final int GCM_TAG_BITS = 128;

    /** Yakın geçmiş mesaj kimliği penceresi — sınırsız bellek YOK. */
    private static final int REPLAY_WINDOW = 256;

    /** Art arda güvenlik ihlali eşiği — aşılırsa oturum KAPATILIR. */
    public static final int MAX_CONSECUTIVE_SECURITY_FAILURES = 3;

    private final byte[] sendKey;
    private final byte[] recvKey;
    private final byte[] sendNoncePrefix;
    private final byte[] recvNoncePrefix;

    private long sendCounter;
    private long highestRecvCounter;

    private final Set<Long> recentMessageIds = new HashSet<>();
    private final ArrayDeque<Long> recentOrder = new ArrayDeque<>();

    private long decryptFailures;
    private long replayRejections;
    private int consecutiveSecurityFailures;
    private boolean destroyed;

    private SessionCrypto(byte[] sendKey, byte[] recvKey,
                          byte[] sendNoncePrefix, byte[] recvNoncePrefix) {
        this.sendKey = sendKey;
        this.recvKey = recvKey;
        this.sendNoncePrefix = sendNoncePrefix;
        this.recvNoncePrefix = recvNoncePrefix;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kurulum
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Paylaşılan sırdan yön anahtarlarını türetir.
     *
     * @param sharedSecret ECDH çıktısı (HAM — doğrudan anahtar olarak KULLANILMAZ)
     * @param salt         el sıkışma dökümünden gelen tuz (iki uçta AYNI)
     * @param serverSide   true ise bu uç sunucudur (head unit)
     */
    public static SessionCrypto derive(byte[] sharedSecret, byte[] salt, boolean serverSide)
            throws GeneralSecurityException {
        if (sharedSecret == null || sharedSecret.length == 0) {
            throw new GeneralSecurityException("paylaşılan sır boş");
        }
        int material = KEY_BYTES + NONCE_PREFIX_BYTES;
        byte[] c2s = HkdfSha256.derive(salt, sharedSecret, INFO_CLIENT_TO_SERVER, material);
        byte[] s2c = HkdfSha256.derive(salt, sharedSecret, INFO_SERVER_TO_CLIENT, material);

        byte[] c2sKey = Arrays.copyOfRange(c2s, 0, KEY_BYTES);
        byte[] c2sPrefix = Arrays.copyOfRange(c2s, KEY_BYTES, material);
        byte[] s2cKey = Arrays.copyOfRange(s2c, 0, KEY_BYTES);
        byte[] s2cPrefix = Arrays.copyOfRange(s2c, KEY_BYTES, material);

        Arrays.fill(c2s, (byte) 0);
        Arrays.fill(s2c, (byte) 0);

        /* Sunucu c2s ile ALIR, s2c ile GÖNDERİR; istemci tersi. */
        return serverSide
            ? new SessionCrypto(s2cKey, c2sKey, s2cPrefix, c2sPrefix)
            : new SessionCrypto(c2sKey, s2cKey, c2sPrefix, s2cPrefix);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sonuç tipleri
     * ════════════════════════════════════════════════════════════════════ */

    public static final class SealResult {
        public final byte[] nonce;
        public final byte[] ciphertext;
        public final LinkErrorCode error;

        private SealResult(byte[] nonce, byte[] ciphertext, LinkErrorCode error) {
            this.nonce = nonce; this.ciphertext = ciphertext; this.error = error;
        }
        public boolean ok() { return error == null; }
    }

    public static final class OpenResult {
        public final byte[] plaintext;
        public final LinkErrorCode error;

        private OpenResult(byte[] plaintext, LinkErrorCode error) {
            this.plaintext = plaintext; this.error = error;
        }
        public boolean ok() { return error == null; }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Şifreleme
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Yükü mühürler. AAD, çerçevenin başlığından üretilir — böylece başlık
     * kurcalanırsa şifre ÇÖZÜLEMEZ (bayrak/uzunluk/messageId sahtelenemez).
     *
     * ASLA throw etmez; kripto sağlayıcı yoksa SECURITY_NOT_IMPLEMENTED döner
     * ve bu durumda düz metin gönderme YOLU YOKTUR (fail-closed).
     */
    public SealResult seal(byte[] plaintext, int flags, long messageId) {
        if (destroyed) return new SealResult(null, null, LinkErrorCode.TRANSPORT_DISPOSED);
        if (sendCounter == Long.MAX_VALUE) {
            /* Sarmalama nonce tekrarı demektir → şifreleme DURUR. */
            return new SealResult(null, null, LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }
        byte[] pt = plaintext == null ? new byte[0] : plaintext;
        long counter = ++sendCounter;
        byte[] nonce = buildNonce(sendNoncePrefix, counter);

        /* AAD, gönderilecek ÇERÇEVENİN başlığıdır. Ciphertext uzunluğu
         * deterministiktir (düz metin + GCM etiketi) → döngüsel bağımlılık yok. */
        int cipherLen = pt.length + (GCM_TAG_BITS / 8);
        byte[] aad = aadFor(flags | LinkFrame.FLAG_ENCRYPTED, messageId, nonce, cipherLen);

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(sendKey, "AES"),
                new GCMParameterSpec(GCM_TAG_BITS, nonce));
            cipher.updateAAD(aad);
            byte[] ct = cipher.doFinal(pt);
            return new SealResult(nonce, ct, null);
        } catch (GeneralSecurityException e) {
            return new SealResult(null, null, LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        } catch (RuntimeException e) {
            return new SealResult(null, null, LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }
    }

    /**
     * Gelen şifreli çerçeveyi açar.
     *
     * Sıra ÖNEMLİ: önce ucuz ve kesin kontroller (yön öneki, sayaç gerilemesi,
     * yinelenen kimlik), sonra pahalı kripto. Böylece tekrar saldırısı CPU
     * harcatamaz.
     */
    public OpenResult open(LinkFrame frame) {
        if (destroyed) return new OpenResult(null, LinkErrorCode.TRANSPORT_DISPOSED);
        if (frame == null || !frame.isEncrypted()) {
            return fail(LinkErrorCode.DECRYPTION_FAILED);
        }
        byte[] nonce = frame.nonceOrNull();
        if (nonce == null) return fail(LinkErrorCode.DECRYPTION_FAILED);

        /* 1 · Yön öneki: kendi gönderdiğimiz mesaj bize geri oynatılamaz. */
        for (int i = 0; i < NONCE_PREFIX_BYTES; i++) {
            if (nonce[i] != recvNoncePrefix[i]) return failReplay();
        }

        /* 2 · Sayaç KESİN artmalı — eşitlik de tekrardır. */
        long counter = 0L;
        for (int i = 0; i < COUNTER_BYTES; i++) {
            counter = (counter << 8) | (nonce[NONCE_PREFIX_BYTES + i] & 0xFFL);
        }
        if (counter <= highestRecvCounter) return failReplay();

        /* 3 · Aynı mesaj kimliği iki kez kabul edilmez. */
        if (recentMessageIds.contains(frame.messageId())) return failReplay();

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(recvKey, "AES"),
                new GCMParameterSpec(GCM_TAG_BITS, nonce));
            cipher.updateAAD(frame.additionalAuthenticatedData());
            byte[] pt = cipher.doFinal(frame.payload());

            /* Yalnız DOĞRULANMIŞ mesajdan sonra durum ilerletilir — aksi hâlde
             * sahte bir çerçeve sayacı zıplatıp geçerli mesajları düşürebilirdi. */
            highestRecvCounter = counter;
            rememberMessageId(frame.messageId());
            consecutiveSecurityFailures = 0;
            return new OpenResult(pt, null);
        } catch (GeneralSecurityException e) {
            return fail(LinkErrorCode.DECRYPTION_FAILED);
        } catch (RuntimeException e) {
            return fail(LinkErrorCode.DECRYPTION_FAILED);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Durum
     * ════════════════════════════════════════════════════════════════════ */

    public long decryptFailures() { return decryptFailures; }
    public long replayRejections() { return replayRejections; }
    public int consecutiveSecurityFailures() { return consecutiveSecurityFailures; }
    public long sentMessageCount() { return sendCounter; }
    public boolean isDestroyed() { return destroyed; }

    /** Eşik aşıldı mı — çağıran bunu görünce oturumu KAPATIR. */
    public boolean shouldTerminateForSecurity() {
        return consecutiveSecurityFailures >= MAX_CONSECUTIVE_SECURITY_FAILURES;
    }

    /** Anahtar baytlarını sıfırlar. İdempotenttir. */
    public void destroy() {
        Arrays.fill(sendKey, (byte) 0);
        Arrays.fill(recvKey, (byte) 0);
        Arrays.fill(sendNoncePrefix, (byte) 0);
        Arrays.fill(recvNoncePrefix, (byte) 0);
        recentMessageIds.clear();
        recentOrder.clear();
        destroyed = true;
    }

    /** Anahtar sızıntısına karşı: nesne yazdırılırsa SIR ÇIKMAZ. */
    @Override
    public String toString() {
        return "SessionCrypto{sent=" + sendCounter
            + ",recvHigh=" + highestRecvCounter
            + ",decryptFail=" + decryptFailures
            + ",replay=" + replayRejections
            + ",destroyed=" + destroyed + "}";
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç yardımcılar
     * ════════════════════════════════════════════════════════════════════ */

    private OpenResult fail(LinkErrorCode code) {
        decryptFailures++;
        consecutiveSecurityFailures++;
        return new OpenResult(null, code);
    }

    private OpenResult failReplay() {
        replayRejections++;
        consecutiveSecurityFailures++;
        return new OpenResult(null, LinkErrorCode.REPLAY_REJECTED);
    }

    private void rememberMessageId(long id) {
        if (recentMessageIds.add(id)) {
            recentOrder.addLast(id);
            while (recentOrder.size() > REPLAY_WINDOW) {
                Long evicted = recentOrder.pollFirst();
                if (evicted != null) recentMessageIds.remove(evicted);
            }
        }
    }

    private static byte[] buildNonce(byte[] prefix, long counter) {
        byte[] nonce = new byte[LinkFrame.NONCE_BYTES];
        System.arraycopy(prefix, 0, nonce, 0, NONCE_PREFIX_BYTES);
        for (int i = 0; i < COUNTER_BYTES; i++) {
            nonce[NONCE_PREFIX_BYTES + i] = (byte) ((counter >>> (56 - 8 * i)) & 0xFF);
        }
        return nonce;
    }

    /** Mühürleme sırasında çerçeve henüz yoktur → AAD uzunluktan kurulur. */
    private static byte[] aadFor(int flags, long messageId, byte[] nonce, int payloadLen) {
        return LinkFrame.additionalAuthenticatedData(
            LinkFrame.FRAMING_VERSION, flags, messageId, nonce, payloadLen);
    }
}
