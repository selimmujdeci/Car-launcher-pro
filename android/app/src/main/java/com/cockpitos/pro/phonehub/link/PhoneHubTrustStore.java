package com.cockpitos.pro.phonehub.link;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * PhoneHubTrustStore — güvenilen telefonun KALICI kaydı (GÖREV 19).
 *
 * ── NE SAKLANIR ─────────────────────────────────────────────────────────────
 * Yalnız: kimlik AÇIK anahtarının parmak izi (geri çevrilemez özet) · yerel
 * takma ad · son başarılı bağlantı zamanı · anlaşılan protokol sürümü ·
 * bağlantı sayısı · şema sürümü.
 *
 * ── NE SAKLANMAZ (PAZARLIKSIZ) ──────────────────────────────────────────────
 * MAC adresi · telefon numarası · kişi adı · cihazın Bluetooth adı ·
 * eşleştirme kodu · oturum anahtarı · nonce · ham açık anahtar · mesaj yükü.
 * Bunların hiçbiri buraya YAZILAMAZ (testle kilitli).
 *
 * ── NEDEN MAC YOK ───────────────────────────────────────────────────────────
 * MAC kalıcı bir cihaz tanımlayıcısıdır; saklanması gereksiz bir izleme
 * yüzeyi yaratır ve bir veri sızıntısında doğrudan kimliğe bağlanır. Güven
 * kararı için MAC'e ihtiyaç YOKTUR: karşı taraf kimliğini her bağlantıda
 * İMZA ile kanıtlar, biz de yalnız parmak izini karşılaştırırız.
 *
 * ── BOZUK KAYIT FAIL-SOFT ───────────────────────────────────────────────────
 * Şema sürümü uyuşmazsa veya kayıt bozuksa güven SIFIRLANIR — yarı okunmuş
 * bir kayda dayanarak "bu cihaz güvenilir" demek fail-open olurdu.
 */
public final class PhoneHubTrustStore {

    private static final String PREFS = "caros.phonehub.trust";
    private static final int SCHEMA_VERSION = 1;

    private static final String KEY_SCHEMA = "schema";
    private static final String KEY_FINGERPRINT = "peer_fp";
    private static final String KEY_ALIAS = "local_alias";
    private static final String KEY_LAST_CONNECTED = "last_connected_at";
    private static final String KEY_PROTOCOL = "protocol_version";
    private static final String KEY_CONNECT_COUNT = "connect_count";

    /** Parmak izi biçimi: 32 onaltılık karakter (SHA-256'nın ilk 16 baytı). */
    private static final int FINGERPRINT_CHARS = 32;

    private final SharedPreferences prefs;

    public PhoneHubTrustStore(Context context) {
        this.prefs = context.getApplicationContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        migrateIfNeeded();
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Okuma
     * ════════════════════════════════════════════════════════════════════ */

    /** Güvenilen parmak izi; yoksa null (sahte boş dize DEĞİL). */
    public String trustedFingerprint() {
        String fp = prefs.getString(KEY_FINGERPRINT, null);
        return isValidFingerprint(fp) ? fp : null;
    }

    public boolean hasTrustedPeer() {
        return trustedFingerprint() != null;
    }

    public String localAlias() {
        return prefs.getString(KEY_ALIAS, null);
    }

    /** Bilinmiyorsa -1 — sahte 0 (1970) YAZILMAZ. */
    public long lastConnectedAtMs() {
        return prefs.getLong(KEY_LAST_CONNECTED, -1L);
    }

    public int protocolVersion() {
        return prefs.getInt(KEY_PROTOCOL, -1);
    }

    public int connectCount() {
        return prefs.getInt(KEY_CONNECT_COUNT, 0);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yazma
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Kullanıcı onayından SONRA güven kaydı kurar.
     *
     * @return geçersiz parmak izi verilirse false — kayıt YAZILMAZ.
     */
    public boolean trustPeer(String fingerprint, String localAlias,
                             int protocolVersion, long nowMs) {
        if (!isValidFingerprint(fingerprint)) return false;

        String previous = trustedFingerprint();
        int count = fingerprint.equals(previous) ? connectCount() + 1 : 1;

        prefs.edit()
            .putInt(KEY_SCHEMA, SCHEMA_VERSION)
            .putString(KEY_FINGERPRINT, fingerprint)
            .putString(KEY_ALIAS, sanitizeAlias(localAlias))
            .putLong(KEY_LAST_CONNECTED, nowMs)
            .putInt(KEY_PROTOCOL, protocolVersion)
            .putInt(KEY_CONNECT_COUNT, count)
            .apply();
        return true;
    }

    /** Başarılı bağlantı damgası — güven kaydını değiştirmez. */
    public void markConnected(long nowMs) {
        if (!hasTrustedPeer()) return;
        prefs.edit()
            .putLong(KEY_LAST_CONNECTED, nowMs)
            .putInt(KEY_CONNECT_COUNT, connectCount() + 1)
            .apply();
    }

    /** "Güvenilen telefonu unut" — kayıt TAMAMEN silinir. */
    public void forget() {
        prefs.edit().clear().putInt(KEY_SCHEMA, SCHEMA_VERSION).apply();
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Doğrulama ve göç
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Parmak izi biçimi. Geçersiz bir değer güven kaydı SAYILMAZ — bozuk
     * kayda dayanarak kullanıcı onayını atlamak en kötü fail-open olurdu.
     */
    static boolean isValidFingerprint(String fp) {
        if (fp == null || fp.length() != FINGERPRINT_CHARS) return false;
        for (int i = 0; i < fp.length(); i++) {
            char c = fp.charAt(i);
            boolean hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            if (!hex) return false;
        }
        return true;
    }

    /**
     * Takma ad: kullanıcının göreceği yerel etiket. Cihazın Bluetooth adı
     * BURAYA YAZILMAZ; çağıran zaten PII'siz bir etiket verir. Yine de tavan
     * uygulanır ve satır sonu temizlenir.
     */
    private static String sanitizeAlias(String alias) {
        if (alias == null) return null;
        String cleaned = alias.replace('\n', ' ').replace('\r', ' ').trim();
        return cleaned.length() > 24 ? cleaned.substring(0, 24) : cleaned;
    }

    /** Şema uyuşmazlığında güven SIFIRLANIR (fail-closed göç). */
    private void migrateIfNeeded() {
        int stored = prefs.getInt(KEY_SCHEMA, 0);
        if (stored == SCHEMA_VERSION) return;
        prefs.edit().clear().putInt(KEY_SCHEMA, SCHEMA_VERSION).apply();
    }
}
