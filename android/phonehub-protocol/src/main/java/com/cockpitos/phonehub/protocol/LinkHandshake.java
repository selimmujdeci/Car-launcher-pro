package com.cockpitos.phonehub.protocol;

import java.io.ByteArrayOutputStream;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * LinkHandshake — el sıkışma, anlaşma ve ilk güven akışı (GÖREV 7 + GÖREV 9).
 *
 * ── AKIŞ ────────────────────────────────────────────────────────────────────
 * <pre>
 *  telefon (istemci)                       CAROS (sunucu)
 *  ── CLIENT_HELLO ──────────────────────▶  protokol + yetenek + ephemeral + kimlik
 *  ◀───────────────────── SERVER_HELLO ──   seçilen sürüm + ephemeral + kimlik + İMZA
 *  ── CLIENT_AUTH ───────────────────────▶  İMZA
 *      · iki uç ECDH + HKDF ile oturum anahtarını türetir
 *      · iki uç AYNI 6 haneli kodu TÜRETİR (kod tel üzerinde GEÇMEZ)
 *      · kullanıcı İKİ EKRANDA da onaylar
 *  ── CONFIRM (ŞİFRELİ) ─────────────────▶  anahtarın gerçekten aynı olduğunun kanıtı
 *  ◀──────────────── CONFIRM_ACK (ŞİFRELİ)
 *      · ESTABLISHED
 * </pre>
 *
 * ── NEDEN ONAYDAN SONRA DA ŞİFRELİ BİR TUR VAR ──────────────────────────────
 * Kullanıcının kodu onaylaması "kullanıcı aynı sayıyı gördü" demektir. Şifreli
 * CONFIRM turu ise anahtarın MATEMATİKSEL olarak aynı olduğunu kanıtlar. İkisi
 * ayrı şeylerdir; yalnız birine güvenmek eksik olurdu.
 *
 * ── GÜVENİLEN CİHAZDA KISA YOL ──────────────────────────────────────────────
 * Karşı tarafın kimlik parmak izi daha önce güvenilmişse kullanıcı onayı
 * ATLANIR — ama İMZA DOĞRULAMASI ATLANMAZ. Parmak izi tutuyor fakat imza
 * tutmuyorsa bu bir taklit girişimidir → {@code TRUSTED_PEER_MISMATCH}.
 *
 * ── SAF VE ZAMANSIZ ─────────────────────────────────────────────────────────
 * Bu sınıf timer kurmaz, {@code System.currentTimeMillis()} çağırmaz (zaman
 * DAİMA parametredir), I/O yapmaz ve Android'e dokunmaz → JUnit'te uçtan uca
 * sürülebilir.
 */
public final class LinkHandshake {

    /* ══════════════════════════════════════════════════════════════════════
     * Sürümler ve yük türleri
     * ════════════════════════════════════════════════════════════════════ */

    public static final int PROTOCOL_VERSION = 1;
    public static final int MIN_PROTOCOL_VERSION = 1;
    public static final int ENVELOPE_VERSION = 1;

    public static final String TYPE_CLIENT_HELLO = "hs.client.hello";
    public static final String TYPE_SERVER_HELLO = "hs.server.hello";
    public static final String TYPE_CLIENT_AUTH = "hs.client.auth";
    public static final String TYPE_CONFIRM = "hs.confirm";
    public static final String TYPE_CONFIRM_ACK = "hs.confirm.ack";

    private static final String CONFIRM_MAGIC = "PHONEHUB-CONFIRM-V1";

    /**
     * BU FAZDA verilebilecek yeteneklerin TAM listesi.
     *
     * İki uç da MEDIA/CALLS/CONTACTS/SMS/... beyan etse bile bunlar granted
     * OLMAZ: karşılık gelen yürütme (execution) katmanı YOKTUR ve bağlantının
     * kurulmuş olması yetki verilmiş olması DEMEK DEĞİLDİR. `VOICE` ve
     * `BACKGROUND_SYNC` de bilinçli olarak DIŞARIDADIR — companion tarafında
     * uygulanmış bir kanalları henüz yok; listeye yalnız gerçekten çalışan bir
     * yetenek girer.
     */
    public static final List<String> GRANTABLE_CAPABILITIES =
        Collections.unmodifiableList(Arrays.asList("HEALTH"));

    /* ══════════════════════════════════════════════════════════════════════
     * Durum
     * ════════════════════════════════════════════════════════════════════ */

    public enum Stage {
        INIT, HELLO_SENT, HELLO_RECEIVED, AUTH_EXCHANGED,
        AWAITING_USER_CONFIRM, CONFIRM_EXCHANGED, ESTABLISHED, FAILED
    }

    /** Bir adımın çıktısı: gönderilecek yük ve/veya SABİT hata kodu. */
    public static final class Step {
        public final String payloadType;
        public final byte[] payload;
        public final LinkErrorCode error;
        public final Stage stage;

        private Step(String payloadType, byte[] payload, LinkErrorCode error, Stage stage) {
            this.payloadType = payloadType;
            this.payload = payload;
            this.error = error;
            this.stage = stage;
        }
        public boolean ok() { return error == null; }
        public boolean hasOutgoing() { return payload != null && payloadType != null; }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Alanlar
     * ════════════════════════════════════════════════════════════════════ */

    private final boolean serverSide;
    private final LinkIdentitySigner signer;
    private final List<String> localCapabilities;
    private final String appVersion;
    private final String trustedPeerFingerprint;   // null ise güven kaydı yok

    private KeyPair ephemeral;
    private Stage stage = Stage.INIT;
    private LinkErrorCode lastError;

    private byte[] clientHelloBytes;
    private byte[] serverHelloCoreBytes;
    private byte[] peerEphemeralSpki;
    private byte[] peerIdentitySpki;
    private String peerFingerprint;
    private String peerAppVersion;
    private List<String> peerCapabilities = new ArrayList<>();
    private List<String> grantedCapabilities = new ArrayList<>();
    private int negotiatedProtocolVersion;

    private byte[] sharedSecret;
    private PairingCode pairingCode;
    private SessionCrypto crypto;
    private boolean userConfirmationRequired = true;
    private boolean peerConfirmVerified;

    private LinkHandshake(boolean serverSide, LinkIdentitySigner signer,
                          List<String> localCapabilities, String appVersion,
                          String trustedPeerFingerprint) {
        this.serverSide = serverSide;
        this.signer = signer;
        this.localCapabilities = localCapabilities == null
            ? new ArrayList<String>() : new ArrayList<>(localCapabilities);
        this.appVersion = appVersion == null ? "?" : appVersion;
        this.trustedPeerFingerprint = trustedPeerFingerprint;
    }

    public static LinkHandshake client(LinkIdentitySigner signer, List<String> capabilities,
                                       String appVersion, String trustedPeerFingerprint) {
        return new LinkHandshake(false, signer, capabilities, appVersion, trustedPeerFingerprint);
    }

    public static LinkHandshake server(LinkIdentitySigner signer, List<String> capabilities,
                                       String appVersion, String trustedPeerFingerprint) {
        return new LinkHandshake(true, signer, capabilities, appVersion, trustedPeerFingerprint);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İstemci adımları
     * ════════════════════════════════════════════════════════════════════ */

    /** 1 · CLIENT_HELLO üretir. */
    public Step createClientHello() {
        if (serverSide) return fail(LinkErrorCode.UNKNOWN_ERROR);
        if (stage != Stage.INIT) return fail(LinkErrorCode.UNKNOWN_ERROR);
        try {
            ephemeral = LinkKeyExchange.generateEphemeralKeyPair();
        } catch (GeneralSecurityException e) {
            return fail(LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }
        byte[] identity = signer == null ? null : signer.identityPublicKeySpki();
        if (identity == null || identity.length == 0) {
            return fail(LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }

        LinkKeyValue kv = new LinkKeyValue()
            .putInt("pv.min", MIN_PROTOCOL_VERSION)
            .putInt("pv.max", PROTOCOL_VERSION)
            .putInt("fv", LinkFrame.FRAMING_VERSION)
            .putInt("ev", ENVELOPE_VERSION)
            .put("role", "PHONE")
            .put("appv", appVersion)
            .putBytes("eph", ephemeral.getPublic().getEncoded())
            .putBytes("idk", identity)
            .putList("caps", localCapabilities);

        byte[] encoded = kv.encode();
        if (encoded == null) return fail(LinkErrorCode.FRAME_MALFORMED);

        clientHelloBytes = encoded;
        stage = Stage.HELLO_SENT;
        return new Step(TYPE_CLIENT_HELLO, encoded, null, stage);
    }

    /** 3 · SERVER_HELLO'yu doğrular, CLIENT_AUTH üretir ve anahtarı türetir. */
    public Step onServerHello(byte[] payload, long nowMs) {
        if (serverSide || stage != Stage.HELLO_SENT) return fail(LinkErrorCode.UNKNOWN_ERROR);

        LinkKeyValue kv = LinkKeyValue.decode(payload);
        if (kv == null) return fail(LinkErrorCode.FRAME_MALFORMED);

        int chosen = kv.getInt("pv", -1);
        if (chosen < MIN_PROTOCOL_VERSION || chosen > PROTOCOL_VERSION) {
            return fail(LinkErrorCode.PROTOCOL_VERSION_MISMATCH);
        }
        if (kv.getInt("fv", -1) != LinkFrame.FRAMING_VERSION
            || kv.getInt("ev", -1) != ENVELOPE_VERSION) {
            return fail(LinkErrorCode.PROTOCOL_VERSION_MISMATCH);
        }

        peerEphemeralSpki = kv.getBytes("eph");
        peerIdentitySpki = kv.getBytes("idk");
        byte[] signature = kv.getBytes("sig");
        if (peerEphemeralSpki == null || peerIdentitySpki == null || signature == null) {
            return fail(LinkErrorCode.FRAME_MALFORMED);
        }

        /* İmza, `sig` alanı HARİÇ döküm üzerinden doğrulanır — bu yüzden
         * sunucunun imzaladığı çekirdek yeniden kurulur (alan sırası sabit). */
        LinkKeyValue core = new LinkKeyValue()
            .putInt("pv", chosen)
            .putInt("fv", kv.getInt("fv", -1))
            .putInt("ev", kv.getInt("ev", -1))
            .put("role", kv.get("role", "?"))
            .put("appv", kv.get("appv", "?"))
            .putBytes("eph", peerEphemeralSpki)
            .putBytes("idk", peerIdentitySpki)
            .putList("caps", kv.getList("caps"));
        byte[] coreBytes = core.encode();
        if (coreBytes == null) return fail(LinkErrorCode.FRAME_MALFORMED);
        serverHelloCoreBytes = coreBytes;

        byte[] transcript = transcript();
        if (!LinkKeyExchange.verify(peerIdentitySpki, transcript, signature)) {
            return fail(LinkErrorCode.PAIRING_REJECTED);
        }

        LinkErrorCode setup = adoptPeer(chosen, kv, nowMs);
        if (setup != null) return fail(setup);

        byte[] ownSignature = signer.sign(transcript);
        if (ownSignature == null || ownSignature.length == 0) {
            return fail(LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }
        byte[] authPayload = new LinkKeyValue().putBytes("sig", ownSignature).encode();
        if (authPayload == null) return fail(LinkErrorCode.FRAME_MALFORMED);

        stage = userConfirmationRequired ? Stage.AWAITING_USER_CONFIRM : Stage.AUTH_EXCHANGED;
        return new Step(TYPE_CLIENT_AUTH, authPayload, null, stage);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sunucu adımları
     * ════════════════════════════════════════════════════════════════════ */

    /** 2 · CLIENT_HELLO'yu işler, SERVER_HELLO üretir. */
    public Step onClientHello(byte[] payload) {
        if (!serverSide || stage != Stage.INIT) return fail(LinkErrorCode.UNKNOWN_ERROR);

        LinkKeyValue kv = LinkKeyValue.decode(payload);
        if (kv == null) return fail(LinkErrorCode.FRAME_MALFORMED);

        int peerMin = kv.getInt("pv.min", -1);
        int peerMax = kv.getInt("pv.max", -1);
        if (peerMin < 0 || peerMax < peerMin) return fail(LinkErrorCode.FRAME_MALFORMED);

        /* Ortak sürüm: iki aralığın kesişimindeki EN YÜKSEK değer. */
        int chosen = Math.min(peerMax, PROTOCOL_VERSION);
        if (chosen < Math.max(peerMin, MIN_PROTOCOL_VERSION)) {
            return fail(LinkErrorCode.PROTOCOL_VERSION_MISMATCH);
        }
        if (kv.getInt("fv", -1) != LinkFrame.FRAMING_VERSION
            || kv.getInt("ev", -1) != ENVELOPE_VERSION) {
            return fail(LinkErrorCode.PROTOCOL_VERSION_MISMATCH);
        }

        peerEphemeralSpki = kv.getBytes("eph");
        peerIdentitySpki = kv.getBytes("idk");
        if (peerEphemeralSpki == null || peerIdentitySpki == null) {
            return fail(LinkErrorCode.FRAME_MALFORMED);
        }
        /* İstemcinin gönderdiği BAYTLAR dökümün parçasıdır — yeniden kurmak
         * yerine olduğu gibi saklanır (bit-bit aynılık imzanın koşuludur). */
        clientHelloBytes = payload.clone();

        try {
            ephemeral = LinkKeyExchange.generateEphemeralKeyPair();
        } catch (GeneralSecurityException e) {
            return fail(LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }
        byte[] identity = signer == null ? null : signer.identityPublicKeySpki();
        if (identity == null || identity.length == 0) {
            return fail(LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }

        List<String> granted = intersectGrantable(kv.getList("caps"));

        LinkKeyValue core = new LinkKeyValue()
            .putInt("pv", chosen)
            .putInt("fv", LinkFrame.FRAMING_VERSION)
            .putInt("ev", ENVELOPE_VERSION)
            .put("role", "HEAD_UNIT")
            .put("appv", appVersion)
            .putBytes("eph", ephemeral.getPublic().getEncoded())
            .putBytes("idk", identity)
            .putList("caps", granted);
        byte[] coreBytes = core.encode();
        if (coreBytes == null) return fail(LinkErrorCode.FRAME_MALFORMED);
        serverHelloCoreBytes = coreBytes;

        byte[] signature = signer.sign(transcript());
        if (signature == null || signature.length == 0) {
            return fail(LinkErrorCode.SECURITY_NOT_IMPLEMENTED);
        }

        LinkKeyValue full = LinkKeyValue.decode(coreBytes);
        if (full == null) return fail(LinkErrorCode.FRAME_MALFORMED);
        byte[] outgoing = full.putBytes("sig", signature).encode();
        if (outgoing == null) return fail(LinkErrorCode.FRAME_MALFORMED);

        peerCapabilities = kv.getList("caps");
        peerAppVersion = kv.get("appv", "?");
        negotiatedProtocolVersion = chosen;
        grantedCapabilities = granted;

        stage = Stage.HELLO_RECEIVED;
        return new Step(TYPE_SERVER_HELLO, outgoing, null, stage);
    }

    /** 4 · CLIENT_AUTH imzasını doğrular ve anahtarı türetir. */
    public Step onClientAuth(byte[] payload, long nowMs) {
        if (!serverSide || stage != Stage.HELLO_RECEIVED) return fail(LinkErrorCode.UNKNOWN_ERROR);

        LinkKeyValue kv = LinkKeyValue.decode(payload);
        if (kv == null) return fail(LinkErrorCode.FRAME_MALFORMED);
        byte[] signature = kv.getBytes("sig");
        if (signature == null) return fail(LinkErrorCode.FRAME_MALFORMED);

        if (!LinkKeyExchange.verify(peerIdentitySpki, transcript(), signature)) {
            return fail(LinkErrorCode.PAIRING_REJECTED);
        }

        LinkErrorCode setup = deriveSharedState(nowMs);
        if (setup != null) return fail(setup);

        stage = userConfirmationRequired ? Stage.AWAITING_USER_CONFIRM : Stage.AUTH_EXCHANGED;
        return new Step(null, null, null, stage);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kullanıcı onayı ve şifreli doğrulama turu
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Kullanıcının ekrandaki kodu onaylaması (ya da reddetmesi).
     *
     * Reddedilirse oturum KURULMAZ ve durum FAILED olur — "yine de bağlan"
     * yolu YOKTUR. Süre dolmuşsa onay geçersizdir.
     */
    public Step confirmByUser(boolean accepted, long nowMs) {
        if (stage != Stage.AWAITING_USER_CONFIRM) return fail(LinkErrorCode.UNKNOWN_ERROR);
        if (!accepted) return fail(LinkErrorCode.PAIRING_REJECTED);
        if (pairingCode == null) return fail(LinkErrorCode.PAIRING_REQUIRED);
        if (pairingCode.isExpired(nowMs)) return fail(LinkErrorCode.PAIRING_CODE_EXPIRED);
        stage = Stage.AUTH_EXCHANGED;
        return new Step(null, null, null, stage);
    }

    /**
     * 6 · Şifreli CONFIRM yükünü üretir (düz metin — çağıran ŞİFRELEYEREK yollar).
     * İçerik sabittir; amacı anahtarın aynı olduğunu KANITLAMAKTIR.
     */
    public Step createConfirm() {
        if (stage != Stage.AUTH_EXCHANGED) return fail(LinkErrorCode.UNKNOWN_ERROR);
        byte[] body = new LinkKeyValue()
            .put("magic", CONFIRM_MAGIC)
            .put("fp", localFingerprintOrEmpty())
            .encode();
        if (body == null) return fail(LinkErrorCode.FRAME_MALFORMED);
        /* İki yön de tamamlandıysa oturum burada kurulur; sıra fark etmez
         * (sunucu önce alır sonra yollar, istemci tersi). */
        stage = peerConfirmVerified ? Stage.ESTABLISHED : Stage.CONFIRM_EXCHANGED;
        return new Step(serverSide ? TYPE_CONFIRM_ACK : TYPE_CONFIRM, body, null, stage);
    }

    /**
     * 7 · Karşı tarafın CONFIRM'ünü doğrular. Bu yük ŞİFRE ÇÖZÜLMÜŞ hâlde gelir;
     * çözülebilmiş olması zaten anahtarın aynı olduğunun kanıtıdır, buradaki
     * kontrol içeriğin de beklenen olduğunu teyit eder.
     */
    public Step onConfirm(byte[] decryptedPayload) {
        /* AWAITING_USER_CONFIRM DA GEÇERLİDİR — bu kapı eskiden onu reddediyordu ve
         * bu GERÇEK bir kusurdu, yalnız test gürültüsü değil:
         *
         * İki uçta da kullanıcı onayı gerektiğinde onaylar ASLA aynı anda olmaz —
         * biri önce basar. Önce basanın CONFIRM'ü, henüz onaylamamış olan uca
         * AWAITING_USER_CONFIRM aşamasındayken ulaşır. Eski kapı bunu protokol
         * ihlali sayıp UNKNOWN_ERROR döndürüyordu → LinkSession.failAndClose() →
         * oturum KAPANIYORDU. Yani ikinci kullanıcı kodu onaylamaya fırsat bulmadan
         * eşleştirme ölüyordu; hız farkı büyükse HER SEFERİNDE.
         * (CI'da flaky olarak yüzeye çıktı: kütük #678 · run 32474253133/32477333286,
         *  düşen assertion her seferinde `client.confirmPairing(true)` idi.)
         *
         * ONAY ATLANMAZ: burada YALNIZ `peerConfirmVerified` işaretlenir, stage
         * DEĞİŞMEZ. Oturum ancak yerel kullanıcı da onaylayıp `confirmByUser` →
         * `createConfirm` çalıştığında ESTABLISHED olur (createConfirm zaten
         * `peerConfirmVerified ? ESTABLISHED : CONFIRM_EXCHANGED` diyor — sıra
         * bağımsızlığı tasarımda VARDI, bu aşama kapıda unutulmuştu).
         * Kullanıcı REDDEDERSE confirmByUser PAIRING_REJECTED ile kapatır. */
        if (stage != Stage.AUTH_EXCHANGED
            && stage != Stage.CONFIRM_EXCHANGED
            && stage != Stage.AWAITING_USER_CONFIRM) {
            return fail(LinkErrorCode.UNKNOWN_ERROR);
        }
        LinkKeyValue kv = LinkKeyValue.decode(decryptedPayload);
        if (kv == null || !CONFIRM_MAGIC.equals(kv.get("magic", ""))) {
            return fail(LinkErrorCode.PAIRING_REJECTED);
        }
        String claimed = kv.get("fp", "");
        if (peerFingerprint != null && !peerFingerprint.equals(claimed)) {
            return fail(LinkErrorCode.TRUSTED_PEER_MISMATCH);
        }
        peerConfirmVerified = true;
        if (stage == Stage.CONFIRM_EXCHANGED) stage = Stage.ESTABLISHED;
        return new Step(null, null, null, stage);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sorgular
     * ════════════════════════════════════════════════════════════════════ */

    public Stage stage() { return stage; }
    public LinkErrorCode lastError() { return lastError; }
    public boolean isEstablished() { return stage == Stage.ESTABLISHED && peerConfirmVerified; }
    public SessionCrypto crypto() { return crypto; }
    public PairingCode pairingCode() { return pairingCode; }
    public boolean userConfirmationRequired() { return userConfirmationRequired; }
    public String peerFingerprint() { return peerFingerprint; }
    public String peerAppVersion() { return peerAppVersion; }
    public int negotiatedProtocolVersion() { return negotiatedProtocolVersion; }

    public List<String> grantedCapabilities() {
        return Collections.unmodifiableList(grantedCapabilities);
    }
    public List<String> peerDeclaredCapabilities() {
        return Collections.unmodifiableList(peerCapabilities);
    }

    /** Anahtar malzemesini siler. Bağlantı kapanırken ÇAĞRILMALIDIR. */
    public void destroy() {
        if (sharedSecret != null) Arrays.fill(sharedSecret, (byte) 0);
        if (crypto != null) crypto.destroy();
        ephemeral = null;
        pairingCode = null;
    }

    /** Sır SIZDIRMAZ — yalnız aşama ve sayılar. */
    @Override
    public String toString() {
        return "LinkHandshake{" + (serverSide ? "server" : "client")
            + ",stage=" + stage
            + ",pv=" + negotiatedProtocolVersion
            + ",granted=" + grantedCapabilities.size()
            + ",needsConfirm=" + userConfirmationRequired + "}";
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç yardımcılar
     * ════════════════════════════════════════════════════════════════════ */

    private Step fail(LinkErrorCode code) {
        lastError = code;
        stage = Stage.FAILED;
        return new Step(null, null, code, stage);
    }

    /** Döküm = CLIENT_HELLO baytları ‖ SERVER_HELLO çekirdeği (imzasız). */
    private byte[] transcript() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (clientHelloBytes != null) out.write(clientHelloBytes, 0, clientHelloBytes.length);
        if (serverHelloCoreBytes != null) {
            out.write(serverHelloCoreBytes, 0, serverHelloCoreBytes.length);
        }
        return out.toByteArray();
    }

    private LinkErrorCode adoptPeer(int chosen, LinkKeyValue kv, long nowMs) {
        negotiatedProtocolVersion = chosen;
        peerAppVersion = kv.get("appv", "?");
        peerCapabilities = kv.getList("caps");
        /* Sunucunun verdiği liste yine de YEREL süzgeçten geçer: karşı taraf
         * "MEDIA da verdim" derse bu kabul edilmez. */
        grantedCapabilities = intersectGrantable(peerCapabilities);
        return deriveSharedState(nowMs);
    }

    private LinkErrorCode deriveSharedState(long nowMs) {
        try {
            peerFingerprint = LinkKeyExchange.fingerprint(peerIdentitySpki);
        } catch (GeneralSecurityException e) {
            return LinkErrorCode.FRAME_MALFORMED;
        }

        /* Güvenilen cihazsa kullanıcı onayı atlanır — imza zaten doğrulandı. */
        userConfirmationRequired = trustedPeerFingerprint == null
            || !trustedPeerFingerprint.equals(peerFingerprint);

        try {
            sharedSecret = LinkKeyExchange.sharedSecret(
                ephemeral.getPrivate(), LinkKeyExchange.decodePublicKey(peerEphemeralSpki));
            byte[] salt = transcript();
            pairingCode = PairingCode.derive(sharedSecret, salt, nowMs,
                PairingCode.DEFAULT_TTL_MS);
            crypto = SessionCrypto.derive(sharedSecret, salt, serverSide);
            return null;
        } catch (GeneralSecurityException e) {
            return LinkErrorCode.SECURITY_NOT_IMPLEMENTED;
        }
    }

    /**
     * Yetenek kesişimi: (yerel ∩ karşı taraf) ∩ BU FAZDA VERİLEBİLİR.
     * Üçüncü kesişim en önemlisidir — iki uç anlaşsa bile uygulanmamış bir
     * yetenek granted OLMAZ.
     */
    private List<String> intersectGrantable(List<String> peer) {
        List<String> out = new ArrayList<>();
        if (peer == null) return out;
        for (String cap : GRANTABLE_CAPABILITIES) {
            if (peer.contains(cap) && localCapabilities.contains(cap)) out.add(cap);
        }
        return out;
    }

    private String localFingerprintOrEmpty() {
        try {
            byte[] identity = signer == null ? null : signer.identityPublicKeySpki();
            return identity == null ? "" : LinkKeyExchange.fingerprint(identity);
        } catch (GeneralSecurityException e) {
            return "";
        }
    }
}
