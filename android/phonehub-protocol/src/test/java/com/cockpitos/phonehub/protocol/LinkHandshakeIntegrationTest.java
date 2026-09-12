package com.cockpitos.phonehub.protocol;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * LinkHandshakeIntegrationTest — el sıkışmanın UÇTAN UCA sürülmesi (GÖREV 20).
 *
 * ── NEDEN GERÇEK BLUETOOTH GEREKMİYOR ───────────────────────────────────────
 * İki uç arasındaki tek şey bir BAYT AKIŞIDIR. Test bu akışı bellekte kurar
 * (in-memory duplex kanal) ve GERÇEK çerçeveleme + GERÇEK kripto + GERÇEK el
 * sıkışma kodunu sürer. Yani "mock'lanmış bir protokol" test edilmiyor;
 * sahada koşacak kodun ta kendisi koşuyor — eksik olan yalnız radyodur.
 */
public class LinkHandshakeIntegrationTest {

    /** Tek yönlü bayt borusu — yazan uç ile okuyan ucu ayırır. */
    private static final class Pipe {
        private final FrameDecoder decoder = new FrameDecoder();
        private long nextMessageId = 1L;

        void write(byte[] plaintextPayload, SessionCrypto crypto) {
            long id = nextMessageId++;
            LinkFrame frame;
            if (crypto == null) {
                frame = new LinkFrame(LinkFrame.FRAMING_VERSION, 0, id,
                    new byte[0], plaintextPayload);
            } else {
                SessionCrypto.SealResult sealed = crypto.seal(plaintextPayload, 0, id);
                assertTrue("mühürleme başarısız: " + sealed.error, sealed.ok());
                frame = new LinkFrame(LinkFrame.FRAMING_VERSION, LinkFrame.FLAG_ENCRYPTED,
                    id, sealed.nonce, sealed.ciphertext);
            }
            FrameCodec.EncodeResult enc = FrameCodec.encode(frame);
            assertTrue("kodlama başarısız: " + enc.error, enc.ok());
            assertNull(decoder.append(enc.bytes, 0, enc.bytes.length));
        }

        /** Ham baytı doğrudan yazar — bozuk çerçeve senaryoları için. */
        void writeRaw(byte[] raw) {
            assertNull(decoder.append(raw, 0, raw.length));
        }

        /** Sıradaki çerçeveyi okur; yoksa null. */
        LinkFrame read() {
            FrameDecoder.Result r = decoder.next();
            return r.status == FrameDecoder.Status.FRAME ? r.frame : null;
        }

        FrameDecoder.Result readResult() {
            return decoder.next();
        }
    }

    /** İki yönlü kanal: telefon→CAROS ve CAROS→telefon. */
    private static final class Duplex {
        final Pipe toServer = new Pipe();
        final Pipe toClient = new Pipe();
    }

    private static final List<String> PHONE_CAPS =
        Arrays.asList("HEALTH", "MEDIA", "CALLS", "NOTIFICATIONS");
    private static final List<String> HEAD_UNIT_CAPS =
        Arrays.asList("HEALTH", "MEDIA", "CALLS", "VOICE");

    /** Kurulmuş bir oturumun iki ucu. */
    private static final class Established {
        LinkHandshake client;
        LinkHandshake server;
        Duplex duplex;
    }

    /**
     * Tam akışı sürer: hello → imza → kod → kullanıcı onayı → şifreli confirm.
     * Her adım GERÇEK çerçevelerden geçer.
     */
    private static Established runFullHandshake(String trustedByClient,
                                                String trustedByServer,
                                                boolean userAccepts,
                                                long nowMs) {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        InMemoryIdentitySigner headUnitId = new InMemoryIdentitySigner();

        LinkHandshake client = LinkHandshake.client(phoneId, PHONE_CAPS, "1.0.0", trustedByClient);
        LinkHandshake server = LinkHandshake.server(headUnitId, HEAD_UNIT_CAPS, "1.0.2", trustedByServer);
        Duplex duplex = new Duplex();

        /* 1 · CLIENT_HELLO */
        LinkHandshake.Step hello = client.createClientHello();
        assertTrue("client hello: " + hello.error, hello.ok());
        duplex.toServer.write(hello.payload, null);

        LinkFrame helloFrame = duplex.toServer.read();
        assertNotNull(helloFrame);
        assertFalse("el sıkışma başlangıcı şifreli OLAMAZ", helloFrame.isEncrypted());

        /* 2 · SERVER_HELLO */
        LinkHandshake.Step serverHello = server.onClientHello(helloFrame.payload());
        assertTrue("server hello: " + serverHello.error, serverHello.ok());
        duplex.toClient.write(serverHello.payload, null);

        /* 3 · CLIENT_AUTH */
        LinkFrame serverHelloFrame = duplex.toClient.read();
        assertNotNull(serverHelloFrame);
        LinkHandshake.Step auth = client.onServerHello(serverHelloFrame.payload(), nowMs);
        assertTrue("client auth: " + auth.error, auth.ok());
        duplex.toServer.write(auth.payload, null);

        LinkFrame authFrame = duplex.toServer.read();
        assertNotNull(authFrame);
        LinkHandshake.Step serverAuth = server.onClientAuth(authFrame.payload(), nowMs);
        assertTrue("server auth: " + serverAuth.error, serverAuth.ok());

        Established out = new Established();
        out.client = client;
        out.server = server;
        out.duplex = duplex;

        /* 4 · Kullanıcı onayı (gerekiyorsa) */
        if (client.userConfirmationRequired()) {
            LinkHandshake.Step c = client.confirmByUser(userAccepts, nowMs);
            if (!c.ok()) return out;
        }
        if (server.userConfirmationRequired()) {
            LinkHandshake.Step s = server.confirmByUser(userAccepts, nowMs);
            if (!s.ok()) return out;
        }

        /* 5 · Şifreli CONFIRM turu — anahtarın aynı olduğunun KANITI */
        LinkHandshake.Step clientConfirm = client.createConfirm();
        assertTrue("client confirm: " + clientConfirm.error, clientConfirm.ok());
        duplex.toServer.write(clientConfirm.payload, client.crypto());

        LinkFrame confirmFrame = duplex.toServer.read();
        assertNotNull(confirmFrame);
        assertTrue("confirm ŞİFRELİ olmalı", confirmFrame.isEncrypted());
        SessionCrypto.OpenResult opened = server.crypto().open(confirmFrame);
        assertTrue("sunucu confirm'ü çözebilmeli: " + opened.error, opened.ok());
        assertTrue(server.onConfirm(opened.plaintext).ok());

        LinkHandshake.Step serverAck = server.createConfirm();
        assertTrue("server ack: " + serverAck.error, serverAck.ok());
        duplex.toClient.write(serverAck.payload, server.crypto());

        LinkFrame ackFrame = duplex.toClient.read();
        assertNotNull(ackFrame);
        SessionCrypto.OpenResult ackOpened = client.crypto().open(ackFrame);
        assertTrue("istemci ack'i çözebilmeli: " + ackOpened.error, ackOpened.ok());
        assertTrue(client.onConfirm(ackOpened.plaintext).ok());

        return out;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Mutlu yol
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void fullHandshakeEstablishesEncryptedSession() {
        Established e = runFullHandshake(null, null, true, 10_000L);

        assertTrue("istemci oturumu kurulmalı", e.client.isEstablished());
        assertTrue("sunucu oturumu kurulmalı", e.server.isEstablished());
        assertEquals(LinkHandshake.Stage.ESTABLISHED, e.client.stage());
        assertEquals(LinkHandshake.Stage.ESTABLISHED, e.server.stage());
        assertEquals(1, e.client.negotiatedProtocolVersion());
        assertEquals(1, e.server.negotiatedProtocolVersion());
    }

    /** İki uç AYNI doğrulama kodunu göstermeli. */
    @Test
    public void bothEndsShowSameVerificationCode() {
        Established e = runFullHandshake(null, null, true, 10_000L);
        assertNotNull(e.client.pairingCode());
        assertNotNull(e.server.pairingCode());
        assertEquals(e.client.pairingCode().visibleCode(),
                     e.server.pairingCode().visibleCode());
        assertEquals(6, e.client.pairingCode().visibleCode().length());
    }

    /** Oturum kurulduktan sonra uygulama mesajı iki yönde de akmalı. */
    @Test
    public void applicationMessageFlowsAfterEstablishment() {
        Established e = runFullHandshake(null, null, true, 10_000L);
        assertTrue(e.client.isEstablished());

        byte[] payload = "{\"type\":\"health\",\"battery\":\"HIGH\"}"
            .getBytes(StandardCharsets.UTF_8);
        e.duplex.toServer.write(payload, e.client.crypto());

        LinkFrame f = e.duplex.toServer.read();
        assertNotNull(f);
        SessionCrypto.OpenResult r = e.server.crypto().open(f);
        assertTrue("uygulama mesajı çözülmeli: " + r.error, r.ok());
        assertEquals(new String(payload, StandardCharsets.UTF_8),
            new String(r.plaintext, StandardCharsets.UTF_8));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yetenek kapısı — GÖREV 9 / GÖREV 18
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * İKİ UÇ DA MEDIA ve CALLS beyan ediyor — yine de granted OLMAMALI.
     * "Bağlantı kuruldu" ≠ "özellik yetkisi verildi".
     */
    @Test
    public void mediaAndCallCapabilitiesAreNeverGranted() {
        Established e = runFullHandshake(null, null, true, 10_000L);

        List<String> granted = new ArrayList<>(e.server.grantedCapabilities());
        assertFalse("MEDIA granted OLMAMALI", granted.contains("MEDIA"));
        assertFalse("CALLS granted OLMAMALI", granted.contains("CALLS"));
        assertFalse("NOTIFICATIONS granted OLMAMALI", granted.contains("NOTIFICATIONS"));
        assertFalse("CONTACTS granted OLMAMALI", granted.contains("CONTACTS"));
        assertFalse("SMS granted OLMAMALI", granted.contains("SMS"));

        assertTrue("HEALTH granted olmalı", granted.contains("HEALTH"));
        assertEquals("bu fazda YALNIZ HEALTH", 1, granted.size());

        /* İstemci tarafı da aynı sonuca varmalı — tek taraflı liste kabul edilmez. */
        assertEquals(granted, new ArrayList<>(e.client.grantedCapabilities()));
    }

    /** Karşı taraf beyan etmediği bir yetenek granted olamaz. */
    @Test
    public void capabilityNotDeclaredByPeerIsNotGranted() {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        InMemoryIdentitySigner headUnitId = new InMemoryIdentitySigner();

        LinkHandshake client = LinkHandshake.client(phoneId, Arrays.asList("MEDIA"), "1.0.0", null);
        LinkHandshake server = LinkHandshake.server(headUnitId, HEAD_UNIT_CAPS, "1.0.2", null);

        LinkHandshake.Step hello = client.createClientHello();
        assertTrue(hello.ok());
        LinkHandshake.Step serverHello = server.onClientHello(hello.payload);
        assertTrue(serverHello.ok());

        assertTrue("HEALTH beyan edilmediği için granted olmamalı",
            server.grantedCapabilities().isEmpty());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Güven ve reddetme
     * ════════════════════════════════════════════════════════════════════ */

    /** Kullanıcı reddederse oturum KURULMAZ — "yine de bağlan" yolu yok. */
    @Test
    public void userRejectionPreventsSession() {
        Established e = runFullHandshake(null, null, false, 10_000L);

        assertFalse(e.client.isEstablished());
        assertEquals(LinkHandshake.Stage.FAILED, e.client.stage());
        assertEquals(LinkErrorCode.PAIRING_REJECTED, e.client.lastError());
    }

    /** Kod süresi dolmuşsa geç onay kabul edilmez. */
    @Test
    public void expiredCodeCannotBeConfirmed() {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        InMemoryIdentitySigner headUnitId = new InMemoryIdentitySigner();
        LinkHandshake client = LinkHandshake.client(phoneId, PHONE_CAPS, "1.0.0", null);
        LinkHandshake server = LinkHandshake.server(headUnitId, HEAD_UNIT_CAPS, "1.0.2", null);

        LinkHandshake.Step hello = client.createClientHello();
        LinkHandshake.Step serverHello = server.onClientHello(hello.payload);
        LinkHandshake.Step auth = client.onServerHello(serverHello.payload, 1_000L);
        assertTrue(auth.ok());

        long tooLate = 1_000L + PairingCode.DEFAULT_TTL_MS + 1L;
        LinkHandshake.Step confirm = client.confirmByUser(true, tooLate);

        assertFalse(confirm.ok());
        assertEquals(LinkErrorCode.PAIRING_CODE_EXPIRED, confirm.error);
        assertFalse(client.isEstablished());
    }

    /** Güvenilen cihazda kullanıcı onayı ATLANIR (imza yine doğrulanır). */
    @Test
    public void trustedPeerSkipsUserConfirmation() {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        InMemoryIdentitySigner headUnitId = new InMemoryIdentitySigner();

        LinkHandshake client = LinkHandshake.client(
            phoneId, PHONE_CAPS, "1.0.0", headUnitId.fingerprint());
        LinkHandshake server = LinkHandshake.server(
            headUnitId, HEAD_UNIT_CAPS, "1.0.2", phoneId.fingerprint());

        LinkHandshake.Step hello = client.createClientHello();
        LinkHandshake.Step serverHello = server.onClientHello(hello.payload);
        LinkHandshake.Step auth = client.onServerHello(serverHello.payload, 1_000L);
        assertTrue(auth.ok());
        assertTrue(server.onClientAuth(auth.payload, 1_000L).ok());

        assertFalse("güvenilen cihazda onay istenmemeli", client.userConfirmationRequired());
        assertFalse(server.userConfirmationRequired());
        assertEquals(LinkHandshake.Stage.AUTH_EXCHANGED, client.stage());
    }

    /** Parmak izi güvenilen ama imza sahte → taklit yakalanmalı. */
    @Test
    public void forgedSignatureFromTrustedFingerprintIsRejected() {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        InMemoryIdentitySigner realHeadUnit = new InMemoryIdentitySigner();
        InMemoryIdentitySigner impostor = new InMemoryIdentitySigner();

        LinkHandshake client = LinkHandshake.client(
            phoneId, PHONE_CAPS, "1.0.0", realHeadUnit.fingerprint());
        LinkHandshake fakeServer = LinkHandshake.server(
            impostor, HEAD_UNIT_CAPS, "1.0.2", null);

        LinkHandshake.Step hello = client.createClientHello();
        LinkHandshake.Step serverHello = fakeServer.onClientHello(hello.payload);
        assertTrue(serverHello.ok());

        /* Taklitçinin imzası kendi anahtarıyla geçerli, ama parmak izi
         * güvenilenle TUTMAZ → kullanıcı onayı yeniden İSTENİR. */
        LinkHandshake.Step auth = client.onServerHello(serverHello.payload, 1_000L);
        assertTrue(auth.ok());
        assertTrue("bilinmeyen kimlikte kullanıcı onayı ZORUNLU",
            client.userConfirmationRequired());
    }

    /** İmza bozulmuşsa el sıkışma reddedilir. */
    @Test
    public void tamperedServerSignatureIsRejected() {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        InMemoryIdentitySigner headUnitId = new InMemoryIdentitySigner();
        LinkHandshake client = LinkHandshake.client(phoneId, PHONE_CAPS, "1.0.0", null);
        LinkHandshake server = LinkHandshake.server(headUnitId, HEAD_UNIT_CAPS, "1.0.2", null);

        LinkHandshake.Step hello = client.createClientHello();
        LinkHandshake.Step serverHello = server.onClientHello(hello.payload);

        LinkKeyValue kv = LinkKeyValue.decode(serverHello.payload);
        assertNotNull(kv);
        byte[] sig = kv.getBytes("sig");
        assertNotNull(sig);
        sig[4] ^= 0x40;
        byte[] tampered = kv.putBytes("sig", sig).encode();
        assertNotNull(tampered);

        LinkHandshake.Step step = client.onServerHello(tampered, 1_000L);
        assertFalse(step.ok());
        assertEquals(LinkErrorCode.PAIRING_REJECTED, step.error);
        assertEquals(LinkHandshake.Stage.FAILED, client.stage());
    }

    /** İmzalayıcı çalışmıyorsa oturum SESSİZCE düz metne düşmez. */
    @Test
    public void brokenSignerFailsClosed() {
        LinkHandshake client = LinkHandshake.client(
            new InMemoryIdentitySigner(true), PHONE_CAPS, "1.0.0", null);
        LinkHandshake server = LinkHandshake.server(
            new InMemoryIdentitySigner(), HEAD_UNIT_CAPS, "1.0.2", null);

        LinkHandshake.Step hello = client.createClientHello();
        assertTrue(hello.ok());
        LinkHandshake.Step serverHello = server.onClientHello(hello.payload);
        assertTrue(serverHello.ok());

        LinkHandshake.Step auth = client.onServerHello(serverHello.payload, 1_000L);
        assertFalse("imzalayamayan istemci ilerleyememeli", auth.ok());
        assertEquals(LinkErrorCode.SECURITY_NOT_IMPLEMENTED, auth.error);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Protokol uyuşmazlığı
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void protocolVersionMismatchIsRejectedByServer() {
        LinkHandshake server = LinkHandshake.server(
            new InMemoryIdentitySigner(), HEAD_UNIT_CAPS, "1.0.2", null);

        byte[] futureHello = new LinkKeyValue()
            .putInt("pv.min", 7)
            .putInt("pv.max", 9)
            .putInt("fv", LinkFrame.FRAMING_VERSION)
            .putInt("ev", LinkHandshake.ENVELOPE_VERSION)
            .put("role", "PHONE")
            .put("appv", "9.9.9")
            .putBytes("eph", new byte[] { 1, 2, 3 })
            .putBytes("idk", new byte[] { 4, 5, 6 })
            .putList("caps", Arrays.asList("HEALTH"))
            .encode();
        assertNotNull(futureHello);

        LinkHandshake.Step step = server.onClientHello(futureHello);
        assertFalse(step.ok());
        assertEquals(LinkErrorCode.PROTOCOL_VERSION_MISMATCH, step.error);
        assertEquals(LinkHandshake.Stage.FAILED, server.stage());
    }

    @Test
    public void framingVersionMismatchIsRejected() {
        LinkHandshake server = LinkHandshake.server(
            new InMemoryIdentitySigner(), HEAD_UNIT_CAPS, "1.0.2", null);

        byte[] hello = new LinkKeyValue()
            .putInt("pv.min", 1).putInt("pv.max", 1)
            .putInt("fv", 99)
            .putInt("ev", LinkHandshake.ENVELOPE_VERSION)
            .put("role", "PHONE").put("appv", "1.0.0")
            .putBytes("eph", new byte[] { 1 }).putBytes("idk", new byte[] { 2 })
            .putList("caps", Arrays.asList("HEALTH"))
            .encode();

        LinkHandshake.Step step = server.onClientHello(hello);
        assertFalse(step.ok());
        assertEquals(LinkErrorCode.PROTOCOL_VERSION_MISMATCH, step.error);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Bozuk çerçeve ve tekrar — akış katmanıyla birlikte
     * ════════════════════════════════════════════════════════════════════ */

    /** Bozuk çerçeve akışı öldürmemeli; sonraki mesaj yine çözülmeli. */
    @Test
    public void corruptFrameDoesNotKillEstablishedSession() {
        Established e = runFullHandshake(null, null, true, 10_000L);

        byte[] good = "{\"ok\":1}".getBytes(StandardCharsets.UTF_8);
        SessionCrypto.SealResult sealed = e.client.crypto().seal(good, 0, 500L);
        assertTrue(sealed.ok());
        LinkFrame frame = new LinkFrame(LinkFrame.FRAMING_VERSION,
            LinkFrame.FLAG_ENCRYPTED, 500L, sealed.nonce, sealed.ciphertext);
        FrameCodec.EncodeResult enc = FrameCodec.encode(frame);
        assertTrue(enc.ok());

        byte[] corrupted = enc.bytes.clone();
        corrupted[LinkFrame.FIXED_HEADER_BYTES + 4] ^= 0x33;   // sağlamayı boz
        e.duplex.toServer.writeRaw(corrupted);

        FrameDecoder.Result bad = e.duplex.toServer.readResult();
        assertEquals(FrameDecoder.Status.ERROR, bad.status);
        assertEquals(LinkErrorCode.CHECKSUM_FAILED, bad.error);

        /* Aynı akıştan sağlam bir mesaj hâlâ geçmeli. */
        e.duplex.toServer.write("{\"ok\":2}".getBytes(StandardCharsets.UTF_8), e.client.crypto());
        LinkFrame next = e.duplex.toServer.read();
        assertNotNull("bozuk çerçeve sonrası akış çalışmalı", next);
        assertTrue(e.server.crypto().open(next).ok());
    }

    /** Kurulmuş oturumda tekrar oynatma reddedilmeli. */
    @Test
    public void replayOnEstablishedSessionIsRejected() {
        Established e = runFullHandshake(null, null, true, 10_000L);

        byte[] payload = "{\"cmd\":\"status\"}".getBytes(StandardCharsets.UTF_8);
        e.duplex.toServer.write(payload, e.client.crypto());
        LinkFrame frame = e.duplex.toServer.read();
        assertNotNull(frame);

        assertTrue(e.server.crypto().open(frame).ok());

        SessionCrypto.OpenResult replayed = e.server.crypto().open(frame);
        assertFalse("tekrar kabul edilmemeli", replayed.ok());
        assertEquals(LinkErrorCode.REPLAY_REJECTED, replayed.error);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Gizlilik
     * ════════════════════════════════════════════════════════════════════ */

    /** El sıkışma yükünde telefon numarası/MAC/cihaz adı OLMAMALI. */
    @Test
    public void handshakePayloadCarriesNoPii() {
        InMemoryIdentitySigner phoneId = new InMemoryIdentitySigner();
        LinkHandshake client = LinkHandshake.client(phoneId, PHONE_CAPS, "1.0.0", null);
        LinkHandshake.Step hello = client.createClientHello();
        assertTrue(hello.ok());

        LinkKeyValue kv = LinkKeyValue.decode(hello.payload);
        assertNotNull(kv);

        String[] forbiddenKeys = { "mac", "address", "bdaddr", "phone", "msisdn",
            "name", "device_name", "imei", "serial", "ssid", "ip" };
        for (String k : forbiddenKeys) {
            assertFalse("el sıkışmada yasak alan: " + k, kv.has(k));
        }
        assertTrue(kv.has("eph"));
        assertTrue(kv.has("idk"));
    }

    /** toString sır sızdırmamalı. */
    @Test
    public void toStringDoesNotLeakSecrets() {
        Established e = runFullHandshake(null, null, true, 10_000L);
        String s = e.client.toString();
        assertFalse(s.contains(e.client.pairingCode().visibleCode()));
        assertTrue(s.contains("stage="));
    }
}
