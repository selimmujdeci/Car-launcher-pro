package com.cockpitos.pro;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Map;

/**
 * NativeCryptoManager — cross-channel nonce (replay) otoritesi.
 *
 * MRI F-02 (2026-09-20): bu sınıfın E2E ŞİFRE ÇÖZME yüzü kaldırıldı.
 *
 * Eskiden `decryptCommandPayload` (ECDH-P256 + HKDF-SHA256 + AES-GCM) vardı ve
 * yalnız tek bir çağıranı bulunuyordu: `CommandService.handleEncryptedCommand`
 * — yani FCM üzerinden gelen `e2e_payload` zarfını native tarafta çözüp CAN'e
 * fiziksel komut yazan İKİNCİ yürütücü. O yürütücü F-02'de kaldırıldı
 * (kanonik sunucu wake üreticisi `fcmDelivery.buildWakeMessage` bu anahtarı
 * zaten ÜRETEMİYORDU → dal dormant'tı). Çağıran kalmadığı için decrypt yüzü de
 * kaldırıldı; E2E çözme artık TEK yerde, kanonik JS yolundadır
 * (`commandCrypto.decryptE2EPayload` → `commandListener`).
 *
 * BURADA KALAN tek sorumluluk CANLIDIR ve kaldırılamaz:
 *   `CarLauncherPlugin.checkCommandNonce` → `checkAndMarkNonce`
 *   → `nativeCommandBridge.checkCrossChannelNonceReplay`
 *   → `commandListener` / `remoteCommandService`
 *
 * Yani JS yolu nonce'ları BU store'da (native_e2e_nonces) işaretler; tek
 * paylaşılan hafıza olduğu için bir nonce hangi kanaldan gelirse gelsin ikinci
 * kez kabul edilmez.
 */
public final class NativeCryptoManager {

    // C10: Replay koruması — kullanılmış _nonce'lar persist edilir; restart sonrası
    // da replay engellenir. JS `commandCrypto.NONCE_WINDOW_MS` ile BİREBİR aynı:
    // 5 dk geçerlilik + 2x60 s saat toleransı = 7 dk (MRI N-7).
    private static final String NONCE_PREFS     = "native_e2e_nonces";
    private static final long   NONCE_WINDOW_MS = 7 * 60_000L;

    // ── Nonce Replay Koruması (C10) ────────────────────────────────────────

    /**
     * Cross-channel replay fix: JS yolu (commandCrypto) bu metodu CarLauncherPlugin
     * köprüsü üzerinden çağırır → JS ve Native AYNI nonce store'unu (native_e2e_nonces)
     * paylaşır. Atomik check-and-mark (synchronized).
     *
     * @return true → nonce daha önce kullanılmış (replay, REDDET); false → taze (işaretlendi).
     */
    public static boolean checkAndMarkNonce(Context ctx, String nonce) {
        if (nonce == null || nonce.isEmpty()) return true; // eksik nonce = güvensiz, reddet
        return isReplayNonce(ctx, nonce);
    }

    /**
     * Kullanılmış nonce'ları EncryptedSharedPreferences yerine düz prefs'te
     * (nonce → expiry ms) tutar — değer hassas değildir, yalnız tekrar tespiti.
     *
     * @return true → nonce daha önce kullanılmış (replay, reddet); false → yeni (kaydedildi).
     */
    private static synchronized boolean isReplayNonce(Context ctx, String nonce) {
        SharedPreferences prefs = ctx.getSharedPreferences(NONCE_PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();

        long exp = prefs.getLong(nonce, 0L);
        if (exp > now) {
            return true; // hâlâ geçerli pencerede → replay
        }

        // GC: süresi dolmuş nonce'ları temizle + yeni nonce'u kaydet
        SharedPreferences.Editor editor = prefs.edit();
        for (Map.Entry<String, ?> e : prefs.getAll().entrySet()) {
            Object v = e.getValue();
            if (v instanceof Long && (Long) v < now) {
                editor.remove(e.getKey());
            }
        }
        editor.putLong(nonce, now + NONCE_WINDOW_MS);
        editor.apply();
        return false;
    }

    private NativeCryptoManager() {} // instantiation yok
}
