package com.cockpitos.phonehub.protocol;

import java.security.GeneralSecurityException;
import java.util.Arrays;

/**
 * PairingCode — ilk eşleşmedeki kısa doğrulama kodu (GÖREV 7, adım 5–7).
 *
 * ── NEDEN VAR: BLUETOOTH EŞLEŞMESİ TEK BAŞINA GÜVEN DEĞİLDİR ────────────────
 * Sistem Bluetooth eşleştirmesi "bu iki radyo birbirini tanıyor" der; "bu
 * telefondaki CAROS uygulaması ile bu head unit'teki CAROS uygulaması aynı
 * kullanıcıya ait" DEMEZ. Arada duran bir uç (MITM) her iki tarafla ayrı ayrı
 * anahtar anlaşabilir. Kısa doğrulama kodu bunu kapatır.
 *
 * ── KOD NASIL ÜRETİLİR: GÖNDERİLMEZ, TÜRETİLİR ──────────────────────────────
 * Kod tel üzerinde HİÇ GEÇMEZ. İki uç da el sıkışma dökümünden (transcript) ve
 * ECDH paylaşılan sırrından AYNI kodu bağımsızca hesaplar. Araya giren bir uç
 * her iki tarafla FARKLI sır anlaşmak zorundadır → kodlar TUTMAZ → kullanıcı
 * farkı görür ve reddeder. Bu, Bluetooth SSP "numeric comparison" ile aynı
 * fikirdir.
 *
 * ── KOD HAKKINDA KESİN KURALLAR ─────────────────────────────────────────────
 * Loglanmaz · diske yazılmaz · tanı dökümüne girmez · JSON dışa aktarımına
 * girmez · her denemede YENİDEN üretilir · süresi dolar. {@link #toString()}
 * kodu MASKELER — kaza ile loglanması yapısal olarak engellenir.
 */
public final class PairingCode {

    private static final String INFO = "caros-phonehub-v1|sas";

    /** Altı hane: kullanıcı için okunabilir, MITM için 1/1.000.000 şans. */
    public static final int CODE_DIGITS = 6;

    /** Varsayılan geçerlilik — sürücü koltuğunda makul, saldırgan için kısa. */
    public static final long DEFAULT_TTL_MS = 120_000L;

    private final String code;
    private final long createdAtMs;
    private final long expiresAtMs;

    private PairingCode(String code, long createdAtMs, long expiresAtMs) {
        this.code = code;
        this.createdAtMs = createdAtMs;
        this.expiresAtMs = expiresAtMs;
    }

    /**
     * Paylaşılan sır + el sıkışma dökümünden kodu türetir.
     *
     * @param transcript iki ucun da AYNI biçimde ürettiği döküm (sıra önemli:
     *                   istemci verileri önce). Farklı döküm → farklı kod.
     * @param nowMs      enjekte edilen zaman ({@code System.currentTimeMillis}
     *                   burada ÇAĞRILMAZ — test deterministik kalsın).
     */
    public static PairingCode derive(byte[] sharedSecret, byte[] transcript,
                                     long nowMs, long ttlMs)
            throws GeneralSecurityException {
        if (sharedSecret == null || sharedSecret.length == 0) {
            throw new GeneralSecurityException("paylaşılan sır boş");
        }
        byte[] out = HkdfSha256.derive(transcript, sharedSecret, INFO, 8);
        try {
            long v = 0L;
            for (int i = 0; i < out.length; i++) {
                v = (v << 8) | (out[i] & 0xFFL);
            }
            /* İşaret bitini at, sonra ondalığa indir — negatif mod tuzağı yok. */
            v &= 0x7FFFFFFFFFFFFFFFL;
            long modulus = 1L;
            for (int i = 0; i < CODE_DIGITS; i++) modulus *= 10L;
            long digits = v % modulus;

            StringBuilder sb = new StringBuilder(Long.toString(digits));
            while (sb.length() < CODE_DIGITS) sb.insert(0, '0');

            long ttl = ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
            return new PairingCode(sb.toString(), nowMs, nowMs + ttl);
        } finally {
            Arrays.fill(out, (byte) 0);
        }
    }

    /**
     * Kodu OKUR. Yalnız ekranda göstermek için çağrılmalıdır; log, döküm veya
     * kalıcı kayıt yollarına verilmesi YASAKTIR (testle kilitli).
     */
    public String visibleCode() { return code; }

    public long createdAtMs() { return createdAtMs; }
    public long expiresAtMs() { return expiresAtMs; }

    public boolean isExpired(long nowMs) { return nowMs >= expiresAtMs; }

    public long remainingMs(long nowMs) {
        long r = expiresAtMs - nowMs;
        return r > 0 ? r : 0L;
    }

    /**
     * Kullanıcının girdiği/onayladığı kodu sabit-zamanlı karşılaştırır.
     * Süre dolmuşsa DAİMA false — geç onay kabul edilmez.
     */
    public boolean matches(String candidate, long nowMs) {
        if (candidate == null || isExpired(nowMs)) return false;
        if (candidate.length() != code.length()) return false;
        int diff = 0;
        for (int i = 0; i < code.length(); i++) {
            diff |= code.charAt(i) ^ candidate.charAt(i);
        }
        return diff == 0;
    }

    /** Kod MASKELENİR — kaza ile loglanması yapısal olarak engellenir. */
    @Override
    public String toString() {
        return "PairingCode{******,createdAt=" + createdAtMs
            + ",expiresAt=" + expiresAtMs + "}";
    }
}
