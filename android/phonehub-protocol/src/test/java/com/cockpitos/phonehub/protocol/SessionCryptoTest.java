package com.cockpitos.phonehub.protocol;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;

/**
 * SessionCryptoTest — şifreli oturumun kilitleri (GÖREV 8 / GÖREV 20).
 *
 * Gerçek JCA kullanır (P-256 ECDH + AES-GCM); Android çalışma zamanı GEREKMEZ.
 */
public class SessionCryptoTest {

    private static final byte[] SALT = "el-sikisma-dokumu".getBytes(StandardCharsets.UTF_8);

    /** İki ucu gerçek ECDH ile kurar — sabit sır kopyalamak yerine. */
    private static SessionCrypto[] establishedPair() throws Exception {
        KeyPair server = LinkKeyExchange.generateEphemeralKeyPair();
        KeyPair client = LinkKeyExchange.generateEphemeralKeyPair();

        byte[] serverSecret = LinkKeyExchange.sharedSecret(
            server.getPrivate(),
            LinkKeyExchange.decodePublicKey(client.getPublic().getEncoded()));
        byte[] clientSecret = LinkKeyExchange.sharedSecret(
            client.getPrivate(),
            LinkKeyExchange.decodePublicKey(server.getPublic().getEncoded()));

        assertArrayEquals("ECDH iki uçta AYNI sırrı vermeli", serverSecret, clientSecret);

        return new SessionCrypto[] {
            SessionCrypto.derive(serverSecret, SALT, true),   // head unit
            SessionCrypto.derive(clientSecret, SALT, false),  // telefon
        };
    }

    /** Mühürlenen yükü karşı tarafa taşıyacak çerçeveyi kurar. */
    private static LinkFrame sealIntoFrame(SessionCrypto tx, String text, long messageId) {
        SessionCrypto.SealResult sealed = tx.seal(
            text.getBytes(StandardCharsets.UTF_8), 0, messageId);
        assertTrue("mühürleme başarılı olmalı", sealed.ok());
        return new LinkFrame(LinkFrame.FRAMING_VERSION, LinkFrame.FLAG_ENCRYPTED,
            messageId, sealed.nonce, sealed.ciphertext);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Temel gidiş-dönüş
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void encryptedRoundTripBothDirections() throws Exception {
        SessionCrypto[] pair = establishedPair();
        SessionCrypto headUnit = pair[0];
        SessionCrypto phone = pair[1];

        LinkFrame toHeadUnit = sealIntoFrame(phone, "telefondan CAROS'a", 1L);
        SessionCrypto.OpenResult a = headUnit.open(toHeadUnit);
        assertTrue("head unit çözebilmeli: " + a.error, a.ok());
        assertEquals("telefondan CAROS'a", new String(a.plaintext, StandardCharsets.UTF_8));

        LinkFrame toPhone = sealIntoFrame(headUnit, "CAROS'tan telefona", 2L);
        SessionCrypto.OpenResult b = phone.open(toPhone);
        assertTrue("telefon çözebilmeli: " + b.error, b.ok());
        assertEquals("CAROS'tan telefona", new String(b.plaintext, StandardCharsets.UTF_8));
    }

    /** Şifreli metin düz metni İÇERMEMELİ (gerçekten şifreleniyor mu). */
    @Test
    public void ciphertextDoesNotContainPlaintext() throws Exception {
        SessionCrypto phone = establishedPair()[1];
        String secret = "PLAKA-34ABC123";
        SessionCrypto.SealResult sealed = phone.seal(
            secret.getBytes(StandardCharsets.UTF_8), 0, 1L);
        assertTrue(sealed.ok());
        String asText = new String(sealed.ciphertext, StandardCharsets.ISO_8859_1);
        assertFalse("şifreli metinde düz metin görünmemeli", asText.contains("PLAKA"));
        assertFalse(asText.contains("34ABC123"));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Tekrar (replay) koruması
     * ════════════════════════════════════════════════════════════════════ */

    /** Aynı çerçeve ikinci kez gelirse REDDEDİLİR. */
    @Test
    public void replayedFrameIsRejected() throws Exception {
        SessionCrypto[] pair = establishedPair();
        LinkFrame frame = sealIntoFrame(pair[1], "bir kez", 1L);

        assertTrue(pair[0].open(frame).ok());

        SessionCrypto.OpenResult second = pair[0].open(frame);
        assertFalse("tekrar kabul edilmemeli", second.ok());
        assertEquals(LinkErrorCode.REPLAY_REJECTED, second.error);
        assertEquals(1L, pair[0].replayRejections());
    }

    /** Sayaç gerilemesi reddedilir — eski mesaj yeniden oynatılamaz. */
    @Test
    public void counterRegressionIsRejected() throws Exception {
        SessionCrypto[] pair = establishedPair();
        SessionCrypto headUnit = pair[0];
        SessionCrypto phone = pair[1];

        LinkFrame first = sealIntoFrame(phone, "birinci", 1L);
        LinkFrame second = sealIntoFrame(phone, "ikinci", 2L);

        assertTrue(headUnit.open(second).ok());          // sayaç 2 görüldü
        SessionCrypto.OpenResult old = headUnit.open(first);  // sayaç 1 geriye
        assertFalse(old.ok());
        assertEquals(LinkErrorCode.REPLAY_REJECTED, old.error);
    }

    /** Kendi gönderdiğimiz mesaj bize geri oynatılamaz (yön öneki koruması). */
    @Test
    public void ownDirectionFrameCannotBeReflectedBack() throws Exception {
        SessionCrypto[] pair = establishedPair();
        SessionCrypto headUnit = pair[0];

        LinkFrame outgoing = sealIntoFrame(headUnit, "kendi mesajım", 1L);
        SessionCrypto.OpenResult reflected = headUnit.open(outgoing);

        assertFalse("yansıtılan kendi çerçevemiz kabul edilmemeli", reflected.ok());
        assertEquals(LinkErrorCode.REPLAY_REJECTED, reflected.error);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Bütünlük
     * ════════════════════════════════════════════════════════════════════ */

    /** Şifreli yükün tek biti bozulursa GCM etiketi yakalar. */
    @Test
    public void tamperedCiphertextFailsAuthentication() throws Exception {
        SessionCrypto[] pair = establishedPair();
        LinkFrame good = sealIntoFrame(pair[1], "dokunulmamış", 1L);

        byte[] ct = good.payload();
        ct[0] ^= 0x01;
        LinkFrame tampered = new LinkFrame(good.framingVersion(), good.flags(),
            good.messageId(), good.extendedHeader(), ct);

        SessionCrypto.OpenResult r = pair[0].open(tampered);
        assertFalse(r.ok());
        assertEquals(LinkErrorCode.DECRYPTION_FAILED, r.error);
        assertEquals(1L, pair[0].decryptFailures());
    }

    /** Başlık (messageId) kurcalanırsa AAD tutmaz → çözülemez. */
    @Test
    public void tamperedHeaderBreaksAad() throws Exception {
        SessionCrypto[] pair = establishedPair();
        LinkFrame good = sealIntoFrame(pair[1], "başlık korunmalı", 7L);

        LinkFrame tampered = new LinkFrame(good.framingVersion(), good.flags(),
            999L, good.extendedHeader(), good.payload());

        SessionCrypto.OpenResult r = pair[0].open(tampered);
        assertFalse("messageId kurcalanmışsa kabul edilmemeli", r.ok());
        assertEquals(LinkErrorCode.DECRYPTION_FAILED, r.error);
    }

    /** Farklı oturumun anahtarı çalışmamalı (anahtar gerçekten oturuma özel). */
    @Test
    public void frameFromDifferentSessionCannotBeOpened() throws Exception {
        SessionCrypto[] sessionA = establishedPair();
        SessionCrypto[] sessionB = establishedPair();

        LinkFrame fromA = sealIntoFrame(sessionA[1], "A oturumu", 1L);
        SessionCrypto.OpenResult r = sessionB[0].open(fromA);

        assertFalse("başka oturumun çerçevesi açılmamalı", r.ok());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Güvenlik olayı eşiği ve yaşam döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void consecutiveSecurityFailuresTriggerTermination() throws Exception {
        SessionCrypto[] pair = establishedPair();
        LinkFrame good = sealIntoFrame(pair[1], "kurcalanacak", 1L);
        byte[] ct = good.payload();
        ct[0] ^= 0x55;
        LinkFrame bad = new LinkFrame(good.framingVersion(), good.flags(),
            good.messageId(), good.extendedHeader(), ct);

        assertFalse(pair[0].shouldTerminateForSecurity());
        for (int i = 0; i < SessionCrypto.MAX_CONSECUTIVE_SECURITY_FAILURES; i++) {
            pair[0].open(bad);
        }
        assertTrue("eşik aşılınca oturum kapatılmalı", pair[0].shouldTerminateForSecurity());
    }

    /** Başarılı çözme art arda sayacı SIFIRLAR (tek gürültü oturumu öldürmez). */
    @Test
    public void successfulDecryptResetsConsecutiveFailures() throws Exception {
        SessionCrypto[] pair = establishedPair();
        SessionCrypto headUnit = pair[0];
        SessionCrypto phone = pair[1];

        LinkFrame okFrame = sealIntoFrame(phone, "sağlam", 1L);
        byte[] ct = okFrame.payload().clone();
        ct[0] ^= 0x7F;
        LinkFrame badFrame = new LinkFrame(okFrame.framingVersion(), okFrame.flags(),
            okFrame.messageId(), okFrame.extendedHeader(), ct);

        headUnit.open(badFrame);
        assertEquals(1, headUnit.consecutiveSecurityFailures());

        assertTrue(headUnit.open(okFrame).ok());
        assertEquals("başarı sonrası sayaç sıfırlanmalı",
            0, headUnit.consecutiveSecurityFailures());
    }

    @Test
    public void destroyIsIdempotentAndBlocksFurtherUse() throws Exception {
        SessionCrypto[] pair = establishedPair();
        SessionCrypto phone = pair[1];

        phone.destroy();
        phone.destroy();   // idempotent

        SessionCrypto.SealResult r = phone.seal(new byte[] { 1 }, 0, 1L);
        assertFalse(r.ok());
        assertEquals(LinkErrorCode.TRANSPORT_DISPOSED, r.error);
        assertTrue(phone.isDestroyed());
    }

    /** toString anahtar SIZDIRMAMALI. */
    @Test
    public void toStringDoesNotLeakKeys() throws Exception {
        SessionCrypto phone = establishedPair()[1];
        phone.seal("x".getBytes(StandardCharsets.UTF_8), 0, 1L);
        String s = phone.toString();
        assertFalse(s.toLowerCase().contains("key"));
        assertTrue(s.contains("sent="));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Doğrulama kodu (SAS)
     * ════════════════════════════════════════════════════════════════════ */

    /** İki uç AYNI kodu türetmeli — kod tel üzerinde HİÇ geçmez. */
    @Test
    public void bothEndsDeriveIdenticalPairingCode() throws Exception {
        KeyPair a = LinkKeyExchange.generateEphemeralKeyPair();
        KeyPair b = LinkKeyExchange.generateEphemeralKeyPair();
        byte[] secretA = LinkKeyExchange.sharedSecret(a.getPrivate(),
            LinkKeyExchange.decodePublicKey(b.getPublic().getEncoded()));
        byte[] secretB = LinkKeyExchange.sharedSecret(b.getPrivate(),
            LinkKeyExchange.decodePublicKey(a.getPublic().getEncoded()));

        PairingCode codeA = PairingCode.derive(secretA, SALT, 1_000L, 60_000L);
        PairingCode codeB = PairingCode.derive(secretB, SALT, 1_000L, 60_000L);

        assertEquals(codeA.visibleCode(), codeB.visibleCode());
        assertEquals(PairingCode.CODE_DIGITS, codeA.visibleCode().length());
    }

    /**
     * MITM senaryosu: araya giren uç iki tarafla FARKLI sır anlaşır →
     * kodlar TUTMAZ → kullanıcı reddeder. Kodun varlık sebebi budur.
     */
    @Test
    public void mitmProducesDifferentCodesOnEachEnd() throws Exception {
        KeyPair phone = LinkKeyExchange.generateEphemeralKeyPair();
        KeyPair headUnit = LinkKeyExchange.generateEphemeralKeyPair();
        KeyPair attacker = LinkKeyExchange.generateEphemeralKeyPair();

        // Telefon saldırganla anlaşıyor (CAROS sandığı uç)
        byte[] phoneSide = LinkKeyExchange.sharedSecret(phone.getPrivate(),
            LinkKeyExchange.decodePublicKey(attacker.getPublic().getEncoded()));
        // CAROS da saldırganla anlaşıyor
        byte[] headUnitSide = LinkKeyExchange.sharedSecret(headUnit.getPrivate(),
            LinkKeyExchange.decodePublicKey(attacker.getPublic().getEncoded()));

        String phoneCode = PairingCode.derive(phoneSide, SALT, 0L, 60_000L).visibleCode();
        String headUnitCode = PairingCode.derive(headUnitSide, SALT, 0L, 60_000L).visibleCode();

        assertNotEquals("MITM'de kodlar AYNI OLMAMALI", phoneCode, headUnitCode);
    }

    /** Farklı döküm → farklı kod (oturum bağlama). */
    @Test
    public void differentTranscriptYieldsDifferentCode() throws Exception {
        byte[] secret = LinkKeyExchange.sharedSecret(
            LinkKeyExchange.generateEphemeralKeyPair().getPrivate(),
            LinkKeyExchange.decodePublicKey(
                LinkKeyExchange.generateEphemeralKeyPair().getPublic().getEncoded()));

        String c1 = PairingCode.derive(secret, "döküm-1".getBytes(StandardCharsets.UTF_8),
            0L, 60_000L).visibleCode();
        String c2 = PairingCode.derive(secret, "döküm-2".getBytes(StandardCharsets.UTF_8),
            0L, 60_000L).visibleCode();
        assertNotEquals(c1, c2);
    }

    @Test
    public void expiredCodeNeverMatches() throws Exception {
        byte[] secret = LinkKeyExchange.sharedSecret(
            LinkKeyExchange.generateEphemeralKeyPair().getPrivate(),
            LinkKeyExchange.decodePublicKey(
                LinkKeyExchange.generateEphemeralKeyPair().getPublic().getEncoded()));

        PairingCode code = PairingCode.derive(secret, SALT, 1_000L, 5_000L);
        String value = code.visibleCode();

        assertTrue("süre içinde eşleşmeli", code.matches(value, 2_000L));
        assertTrue(code.isExpired(6_000L));
        assertFalse("süresi dolan kod ASLA eşleşmemeli", code.matches(value, 6_000L));
        assertEquals(0L, code.remainingMs(9_999L));
    }

    @Test
    public void wrongCodeDoesNotMatch() throws Exception {
        byte[] secret = LinkKeyExchange.sharedSecret(
            LinkKeyExchange.generateEphemeralKeyPair().getPrivate(),
            LinkKeyExchange.decodePublicKey(
                LinkKeyExchange.generateEphemeralKeyPair().getPublic().getEncoded()));
        PairingCode code = PairingCode.derive(secret, SALT, 0L, 60_000L);

        assertFalse(code.matches("000000", 1L) && !code.visibleCode().equals("000000"));
        assertFalse(code.matches(null, 1L));
        assertFalse(code.matches("12345", 1L));   // yanlış uzunluk
    }

    /** Kod toString'e SIZMAMALI — kaza ile loglanamaz. */
    @Test
    public void pairingCodeToStringIsMasked() throws Exception {
        byte[] secret = LinkKeyExchange.sharedSecret(
            LinkKeyExchange.generateEphemeralKeyPair().getPrivate(),
            LinkKeyExchange.decodePublicKey(
                LinkKeyExchange.generateEphemeralKeyPair().getPublic().getEncoded()));
        PairingCode code = PairingCode.derive(secret, SALT, 0L, 60_000L);

        String s = code.toString();
        assertFalse("kod toString'de görünmemeli", s.contains(code.visibleCode()));
        assertTrue(s.contains("******"));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kimlik imzası
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void identitySignatureVerifiesAndRejectsTampering() throws Exception {
        KeyPair identity = LinkKeyExchange.generateEphemeralKeyPair();
        byte[] spki = identity.getPublic().getEncoded();
        byte[] data = "el-sikisma-dokumu".getBytes(StandardCharsets.UTF_8);

        java.security.Signature signer =
            java.security.Signature.getInstance(LinkKeyExchange.SIGNATURE_ALGORITHM);
        signer.initSign(identity.getPrivate());
        signer.update(data);
        byte[] signature = signer.sign();

        assertTrue(LinkKeyExchange.verify(spki, data, signature));

        byte[] otherData = "baska-dokum".getBytes(StandardCharsets.UTF_8);
        assertFalse(LinkKeyExchange.verify(spki, otherData, signature));

        KeyPair impostor = LinkKeyExchange.generateEphemeralKeyPair();
        assertFalse("başka anahtarla doğrulanmamalı",
            LinkKeyExchange.verify(impostor.getPublic().getEncoded(), data, signature));
    }

    /** verify ASLA throw etmez — bozuk girdi false döner (fail-closed). */
    @Test
    public void verifyNeverThrowsOnGarbage() {
        assertFalse(LinkKeyExchange.verify(null, new byte[] { 1 }, new byte[] { 1 }));
        assertFalse(LinkKeyExchange.verify(new byte[] { 9, 9 }, new byte[] { 1 }, new byte[] { 1 }));
        assertFalse(LinkKeyExchange.verify(new byte[0], new byte[0], new byte[0]));
    }

    @Test
    public void fingerprintIsStableAndDistinct() throws Exception {
        KeyPair a = LinkKeyExchange.generateEphemeralKeyPair();
        KeyPair b = LinkKeyExchange.generateEphemeralKeyPair();

        String fa1 = LinkKeyExchange.fingerprint(a.getPublic().getEncoded());
        String fa2 = LinkKeyExchange.fingerprint(a.getPublic().getEncoded());
        String fb = LinkKeyExchange.fingerprint(b.getPublic().getEncoded());

        assertEquals("aynı anahtar aynı parmak izi", fa1, fa2);
        assertNotEquals("farklı anahtar farklı parmak izi", fa1, fb);
        assertEquals(32, fa1.length());
    }

    /** Boş paylaşılan sır ile oturum kurulamaz (fail-closed). */
    @Test
    public void emptySharedSecretIsRefused() {
        try {
            SessionCrypto.derive(new byte[0], SALT, true);
            org.junit.Assert.fail("boş sır kabul edilmemeliydi");
        } catch (Exception expected) {
            assertNull(null);
        }
    }
}
