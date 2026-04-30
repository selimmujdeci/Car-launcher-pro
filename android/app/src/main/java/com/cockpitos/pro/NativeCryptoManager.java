package com.cockpitos.pro;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.ECFieldFp;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.EllipticCurve;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import java.math.BigInteger;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;

/**
 * NativeCryptoManager — H-4 E2E Native Şifre Çözme
 *
 * Protokol: ECDH-P256 + HKDF-SHA256 + AES-256-GCM
 * TS karşılığı: commandCrypto.ts (encryptE2EPayload / decryptE2EPayload)
 *
 * E2EEncryptedPayload (JSON) yapısı:
 *   type:    "ecdh_v1"
 *   eph_pub: base64 SPKI ephemeral public key (P-256)
 *   iv:      base64 12B AES-GCM nonce
 *   data:    base64 AES-GCM ciphertext
 *   ts:      Unix ms — erken reddetme için (otoriter ts şifreli içinde)
 *
 * Anahtar Kaynağı:
 *   Android EncryptedSharedPreferences'ta "car-e2e-private-key" anahtarı
 *   altında JWK formatında saklanır (commandCrypto.ts: safeSetRawImmediate).
 *
 * Güvenlik Notları:
 *   - ECDH türetmesi her komutta tekrar yapılır (her mesajda farklı ephemeral key)
 *   - HKDF zero-salt (deterministik) + "caros-cmd-v1" info: TS ile birebir uyumlu
 *   - AES-GCM 128-bit tag: AEAD bütünlük koruması
 *   - timestamp penceresi: 30s (TS ile uyumlu)
 */
public final class NativeCryptoManager {

    private static final String TAG           = "NativeCrypto";
    private static final String HKDF_INFO     = "caros-cmd-v1";
    private static final long   TS_WINDOW_MS  = 30_000L;

    /** CarLauncherPlugin secureStoreGet'te kullandığı EncryptedSharedPreferences alias */
    private static final String PRIV_KEY_STORE_KEY = "car-e2e-private-key";

    public static final class DecryptResult {
        public final String type;      // komut tipi (lock, unlock, ...)
        public final JSONObject payload; // tam şifre çözülmüş payload

        DecryptResult(String type, JSONObject payload) {
            this.type    = type;
            this.payload = payload;
        }
    }

    // ── Ana Giriş Noktası ───────────────────────────────────────────────────

    /**
     * FCM data'sındaki JSON e2e_payload'u çözer.
     *
     * @param ctx             Android context — SecureStorage erişimi için
     * @param e2ePayloadJson  E2EEncryptedPayload JSON string
     * @return DecryptResult ya da null (başarısız / stale)
     */
    public static DecryptResult decryptCommandPayload(Context ctx, String e2ePayloadJson) {
        try {
            JSONObject enc = new JSONObject(e2ePayloadJson);

            // Tip kontrolü
            if (!"ecdh_v1".equals(enc.optString("type"))) {
                Log.w(TAG, "Bilinmeyen payload tipi");
                return null;
            }

            // Erken timestamp kontrolü (ECDH yapılmadan)
            long outerTs  = enc.optLong("ts", 0L);
            long outerAge = System.currentTimeMillis() - outerTs;
            if (outerAge < 0 || outerAge > TS_WINDOW_MS) {
                Log.w(TAG, "Stale komut: " + outerAge + "ms");
                return null;
            }

            // Araç private key'ini yükle
            PrivateKey privKey = loadCarPrivateKey(ctx);
            if (privKey == null) {
                Log.e(TAG, "Private key yüklenemedi — E2E çözülemiyor");
                return null;
            }

            // Ephemeral public key (SPKI base64)
            byte[] ephPubBytes = Base64.decode(enc.getString("eph_pub"), Base64.DEFAULT);
            PublicKey ephPub   = KeyFactory.getInstance("EC")
                                           .generatePublic(new X509EncodedKeySpec(ephPubBytes));

            // ECDH shared secret → HKDF → AES-256 key
            KeyAgreement ka = KeyAgreement.getInstance("ECDH");
            ka.init(privKey);
            ka.doPhase(ephPub, true);
            byte[] sharedBits = ka.generateSecret();

            byte[] aesKeyBytes = hkdfSha256(sharedBits, new byte[32],
                                            HKDF_INFO.getBytes(StandardCharsets.UTF_8));

            // AES-GCM decrypt
            byte[] iv         = Base64.decode(enc.getString("iv"),   Base64.DEFAULT);
            byte[] ciphertext = Base64.decode(enc.getString("data"), Base64.DEFAULT);

            SecretKeySpec aesKey = new SecretKeySpec(aesKeyBytes, "AES");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, aesKey, new GCMParameterSpec(128, iv));
            byte[] plainBytes = cipher.doFinal(ciphertext);

            // JSON parse
            JSONObject inner = new JSONObject(new String(plainBytes, StandardCharsets.UTF_8));

            // İç timestamp kontrolü (şifreli içinde, manipüle edilemez)
            long innerTs  = inner.optLong("_ts", 0L);
            long innerAge = System.currentTimeMillis() - innerTs;
            if (innerAge < 0 || innerAge > TS_WINDOW_MS) {
                Log.w(TAG, "Stale inner timestamp: " + innerAge + "ms");
                return null;
            }

            // Komut tipini al
            String cmdType = inner.optString("type", "");
            if (cmdType.isEmpty()) {
                Log.w(TAG, "Payload'da type alanı yok");
                return null;
            }

            Log.i(TAG, "E2E başarılı: " + cmdType);
            return new DecryptResult(cmdType, inner);

        } catch (Exception e) {
            Log.e(TAG, "E2E deşifreleme hatası: " + e.getMessage(), e);
            return null;
        }
    }

    // ── HKDF-SHA256 ────────────────────────────────────────────────────────

    /**
     * HKDF-SHA256 (RFC 5869) — tek çıkış bloğu (32 byte).
     * commandCrypto.ts HKDF implementasyonu ile birebir uyumludur:
     *   extract: PRK = HMAC-SHA256(salt, ikm)
     *   expand:  OKM = HMAC-SHA256(PRK, info || 0x01)
     */
    private static byte[] hkdfSha256(byte[] ikm, byte[] salt, byte[] info) throws Exception {
        // Extract
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);

        // Expand — tek blok (L=32 <= HashLen=32)
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(info);
        mac.update((byte) 0x01);
        return mac.doFinal();
    }

    // ── Private Key Yükleme ─────────────────────────────────────────────────

    /**
     * EncryptedSharedPreferences'tan JWK private key'i yükler.
     *
     * commandCrypto.ts şu şekilde kaydeder:
     *   safeSetRawImmediate("car-e2e-private-key", JSON.stringify(privJwk))
     *
     * JWK formatı (P-256 EC private key):
     *   { kty:"EC", crv:"P-256", d:"<base64url>", x:"<base64url>", y:"<base64url>" }
     */
    private static PrivateKey loadCarPrivateKey(Context ctx) {
        try {
            // CarLauncherPlugin ile aynı EncryptedSharedPreferences alias'ı kullanılır
            // Alias: "CarLauncherSecureStore" (CarLauncherPlugin.getSecurePrefs ile uyumlu)
            androidx.security.crypto.MasterKey masterKey =
                new androidx.security.crypto.MasterKey.Builder(ctx)
                    .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                    .build();

            android.content.SharedPreferences encryptedPrefs =
                androidx.security.crypto.EncryptedSharedPreferences.create(
                    ctx,
                    "CarLauncherSecureStore",
                    masterKey,
                    androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                );

            String jwkJson = encryptedPrefs.getString(PRIV_KEY_STORE_KEY, null);
            if (jwkJson == null) {
                Log.w(TAG, "JWK bulunamadı: " + PRIV_KEY_STORE_KEY);
                return null;
            }

            return parseEcPrivateKeyFromJwk(jwkJson);

        } catch (Exception e) {
            Log.e(TAG, "Private key yüklenemedi: " + e.getMessage(), e);
            return null;
        }
    }

    /**
     * JWK EC private key JSON → Java PrivateKey.
     *
     * JWK `d` alanı: private scalar, base64url kodlanmış (padding yok).
     * P-256 parametreleri: NIST SP 800-186 Section 4.1.
     */
    private static ECPrivateKey parseEcPrivateKeyFromJwk(String jwkJson) throws Exception {
        JSONObject jwk = new JSONObject(jwkJson);

        if (!"EC".equals(jwk.optString("kty")) || !"P-256".equals(jwk.optString("crv"))) {
            throw new IllegalArgumentException("JWK tipi P-256 EC olmalı");
        }

        // base64url → BigInteger (d = private scalar)
        byte[] dBytes = base64UrlDecode(jwk.getString("d"));
        BigInteger d  = new BigInteger(1, dBytes);

        ECParameterSpec p256 = buildP256Params();
        ECPrivateKeySpec spec = new ECPrivateKeySpec(d, p256);

        return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(spec);
    }

    /** NIST P-256 (secp256r1) ECParameterSpec — Android SDK'da yerleşik yoktur. */
    private static ECParameterSpec buildP256Params() {
        // Curve: y² = x³ + ax + b mod p
        BigInteger p = new BigInteger(
            "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF", 16);
        BigInteger a = new BigInteger(
            "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC", 16);
        BigInteger b = new BigInteger(
            "5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B", 16);
        BigInteger n = new BigInteger(
            "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16);
        BigInteger gx = new BigInteger(
            "6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296", 16);
        BigInteger gy = new BigInteger(
            "4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5", 16);

        EllipticCurve curve = new EllipticCurve(new ECFieldFp(p), a, b);
        ECPoint       g     = new ECPoint(gx, gy);
        return new ECParameterSpec(curve, g, n, 1);
    }

    /** Base64url (no padding) → byte[] */
    private static byte[] base64UrlDecode(String b64url) {
        String b64 = b64url
            .replace('-', '+')
            .replace('_', '/')
            .replaceAll("\\s", "");
        // Add padding
        switch (b64.length() % 4) {
            case 2: b64 += "=="; break;
            case 3: b64 += "=";  break;
            default: break;
        }
        return Base64.decode(b64, Base64.DEFAULT);
    }

    private NativeCryptoManager() {} // instantiation yok
}
