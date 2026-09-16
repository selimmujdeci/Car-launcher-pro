package com.cockpitos.pro.phonehub.link;

import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.util.Log;

import com.cockpitos.phonehub.protocol.LinkDiagnosticBuffer;
import com.cockpitos.phonehub.protocol.LinkDiagnosticEvent;
import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.cockpitos.phonehub.protocol.LinkHandshake;
import com.cockpitos.phonehub.protocol.LinkSession;
import com.cockpitos.phonehub.protocol.LinkSessionSnapshot;
import com.cockpitos.phonehub.protocol.PhoneHubUuid;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * PhoneHubLinkController — head unit tarafında Phone Hub bağlantısının
 * TEK sahibi (GÖREV 4 + 12 + 14 + 19).
 *
 * ── TEK SAHİPLİK ────────────────────────────────────────────────────────────
 * Sunucu soketi, aktif oturum, güven kaydı, kimlik anahtarı ve tanı defteri
 * TEK bir yerden yönetilir. Bu depoda "iki yerden yönetilen kaynak" sınıfı
 * arızalar (çift abonelik, sahipsiz timer) gerçekten yaşandı; burada sahiplik
 * bilinçli olarak tekilleştirilmiştir.
 *
 * ── OTOMATİK YENİDEN BAĞLANMA YOK ───────────────────────────────────────────
 * Head unit tarafı SUNUCUDUR: bağlanma girişimini telefon yapar. Bu sınıf
 * hiçbir koşulda kendiliğinden bağlantı KURMAZ, tarama BAŞLATMAZ ve
 * eşleştirme İSTEMEZ. Yalnız dinler.
 *
 * ── DOĞRULAMA KODU BELLEKTE, GEÇİCİ ─────────────────────────────────────────
 * Kod yalnız {@code pendingPairingCode} içinde ve yalnız onay penceresi
 * boyunca durur. Diske yazılmaz, deftere girmez, anlık görüntüye çıkmaz;
 * oturum kapanınca temizlenir.
 */
public final class PhoneHubLinkController implements RfcommServerTransport.Callback,
        LinkSession.Listener {

    private static final String TAG = "PhoneHubLink";

    /** Keystore alias — head unit kimliği (companion AYRI alias kullanır). */
    private static final String IDENTITY_ALIAS = "caros-phonehub-headunit-identity";

    /** Head unit'in beyan ettiği yetenekler. Verilecek olan HEALTH'tir. */
    private static final List<String> LOCAL_CAPABILITIES = Arrays.asList("HEALTH");

    private static PhoneHubLinkController instance;

    private final Context appContext;
    private final LinkDiagnosticBuffer diagnostics = new LinkDiagnosticBuffer();
    private final KeystoreIdentitySigner signer;
    private final PhoneHubTrustStore trustStore;
    private final RfcommServerTransport server;
    private final String appVersion;

    private final AtomicReference<LinkSession> session = new AtomicReference<>(null);
    private final AtomicReference<PendingPairing> pendingPairing = new AtomicReference<>(null);

    /**
     * F2 — uygulama mesajı köprüsü. TEK dinleyici (Capacitor plugin) kayıt
     * olabilir; bu sınıf hiçbir yetki/karar VERMEZ, yalnız "doğrulanmış/taze
     * PhoneHub session'ından gelen opak bir mesaj var" der. Mesajın içeriğini
     * yorumlamak, izin vermek/vermemek TS tarafının (canonical authorization)
     * işidir — native köprü authorization authority HALİNE GELMEZ.
     */
    public interface ApplicationMessageListener {
        /**
         * @param peerFingerprintRef native ESTABLISHED oturumun kimlik parmak
         *                           izi — TELEFONUN İDDİASI DEĞİL, handshake'in
         *                           imza-doğrulanmış sonucu.
         * @param sessionEpoch       native oturum nesli ({@code LinkSession.generation}).
         * @param payloadUtf8        opak UTF-8 metin (TS'in JSON zarfı — bu
         *                           katman içeriğini ayrıştırmaz).
         */
        void onApplicationMessage(String peerFingerprintRef, long sessionEpoch, String payloadUtf8);
    }

    /**
     * Uygulama mesajı için native-taraf kaba tavan. {@code LinkKeyValue}
     * dokümantasyonunun kendi kuralı: uygulama mesajları bu katman için
     * OPAKTIR, tam şema/komut doğrulaması TS ingress'inde yapılır. Burada
     * yalnız köprüyü aşırı büyük/bozuk baytla boğmayı önleyen kaba bir bayt
     * sınırı var — 64 KB'lık genel çerçeve tavanından KASITLI OLARAK çok
     * daha dar (küçük, versiyonlu bir JSON komutu bunu asla aşmaz).
     */
    public static final int MAX_APPLICATION_MESSAGE_BYTES = 4096;

    private volatile ApplicationMessageListener applicationMessageListener;

    /** Plugin kendi yaşam döngüsünde (load/handleOnDestroy) kayıt olur/çıkar. */
    public void setApplicationMessageListener(ApplicationMessageListener listener) {
        applicationMessageListener = listener;
    }

    /**
     * TS ingress'inin, gelen bir mesaja verdiği ACK/REJECTED yanıtını mevcut
     * şifreli oturumdan gönderir. Bu metot yetki KARARI VERMEZ — çağıranın
     * (TS) zaten verdiği kararı, var olan {@link LinkSession#sendApplicationMessage}
     * yoluyla taşır. Oturum yoksa/kapandıysa sessizce {@code false} döner.
     */
    public boolean sendApplicationMessage(String payloadUtf8) {
        LinkSession s = session.get();
        if (s == null || payloadUtf8 == null) return false;
        return s.sendApplicationMessage(payloadUtf8.getBytes(StandardCharsets.UTF_8));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * F4.1 — KANONİK LIFECYCLE OLAYI (native → TS, event-driven)
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Yaşam döngüsü geçişi dinleyicisi. F2'nin uygulama-mesajı köprüsüyle
     * AYNI desen: TEK dinleyici (Capacitor plugin), hiçbir karar BURADA yok.
     *
     * Bu köprü YENİ bir lifecycle authority KURMAZ — {@code LinkSession}'ın
     * zaten ürettiği geçişi dışarı YANSITIR. Amaç F3'te kalan tek riski
     * kapatmaktır: oturum düştüğünde TS'in bunu bir sonraki HTTP isteğini ya
     * da Music olayını BEKLEMEDEN öğrenmesi.
     */
    public interface LinkStateListener {
        /**
         * @param state       kanonik durum adı ({@link PhoneHubLinkStateMapping.LinkState})
         * @param sessionEpoch native oturum nesli; oturum yoksa {@code -1}
         * @param fingerprint  imza-doğrulanmış eş parmak izi; yoksa {@code null}
         * @param reason       sınırlı gerekçe kategorisi (serbest metin DEĞİL)
         */
        void onLinkStateChanged(String state, long sessionEpoch, String fingerprint, String reason);
    }

    private volatile LinkStateListener linkStateListener;

    /** Plugin kendi yaşam döngüsünde kayıt olur/çıkar (zero-leak). */
    public void setLinkStateListener(LinkStateListener listener) {
        linkStateListener = listener;
    }

    /**
     * Son hata kodu — YALNIZ gerekçe KATEGORİSİNE çevrilmek için tutulur.
     * Kodun kendisi TS'e TAŞINMAZ (saldırgana güvenlik katmanının iç
     * davranışını anlatırdı).
     */
    private final AtomicReference<LinkErrorCode> pendingReason = new AtomicReference<>(null);

    /** Son yayılan geçiş — aynı (durum, nesil) ikinci kez YAYILMAZ (dedupe). */
    private volatile String lastEmittedKey = null;

    /**
     * Geçişi yayar. Deterministik ve tekrarsızdır: aynı {@code (state, epoch)}
     * çifti art arda gelirse İKİNCİSİ DÜŞÜRÜLÜR — böylece TS tarafındaki
     * iptal dizisi de idempotent kalır.
     *
     * Hiçbir kripto materyali, eşleşme kodu, ham anahtar, exception mesajı
     * veya stack trace TAŞINMAZ.
     */
    private void emitLinkState(LinkSession.State nativeState, long generation) {
        PhoneHubLinkStateMapping.LinkState canonical =
            PhoneHubLinkStateMapping.toLinkState(nativeState);

        String key = canonical.name() + "#" + generation;
        if (key.equals(lastEmittedKey)) return;   // duplicate transition → tek olay
        lastEmittedKey = key;

        /* Parmak izi YALNIZ nesli eşleşen, kimliği doğrulanmış oturumdan
         * okunur — bayat bir oturumun kimliği YENİ olaya SIZDIRILMAZ. */
        String fingerprint = null;
        LinkSession s = session.get();
        if (s != null && s.generation() == generation) {
            fingerprint = s.handshake().peerFingerprint();
        }

        PhoneHubLinkStateMapping.LinkStateReason reason =
            PhoneHubLinkStateMapping.toReason(pendingReason.getAndSet(null));

        LinkStateListener l = linkStateListener;
        if (l == null) return;
        try {
            l.onLinkStateChanged(canonical.name(), generation, fingerprint, reason.name());
        } catch (RuntimeException ignored) {
            /* Köprü hatası oturum durum makinesini BOZMAZ (fail-soft). */
        }
    }

    private volatile String lastSessionState = "IDLE";
    private volatile String lastErrorCode;
    private volatile long lastErrorAtMs = -1L;
    private volatile long connectStartedAtMs = -1L;

    /** Onay bekleyen doğrulama kodu — BELLEKTE, geçici. */
    private static final class PendingPairing {
        final String code;
        final long expiresAtMs;
        final long generation;
        PendingPairing(String code, long expiresAtMs, long generation) {
            this.code = code; this.expiresAtMs = expiresAtMs; this.generation = generation;
        }
    }

    private PhoneHubLinkController(Context context, String appVersion) {
        this.appContext = context.getApplicationContext();
        this.appVersion = appVersion == null ? "?" : appVersion;
        this.signer = new KeystoreIdentitySigner(IDENTITY_ALIAS);
        this.trustStore = new PhoneHubTrustStore(appContext);
        this.server = new RfcommServerTransport(appContext, diagnostics,
            LinkSession.SYSTEM_CLOCK, this);
    }

    public static synchronized PhoneHubLinkController get(Context context, String appVersion) {
        if (instance == null) instance = new PhoneHubLinkController(context, appVersion);
        return instance;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Komutlar
     * ════════════════════════════════════════════════════════════════════ */

    public boolean startServer() {
        return server.start();
    }

    /**
     * Sunucunun başlamasını engelleyen ön koşul (varsa). HER çağrıda yeniden
     * ölçülür — önbelleğe alınmış bir "izin vardı" bilgisi yanlış güven üretir.
     */
    public LinkErrorCode snapshotBlocker() {
        return server.checkPreconditions();
    }

    /** Sunucuyu durdurur; tüm worker/soket/timer kaynaklarını bırakır. */
    public void stopServer() {
        closeSession(LinkErrorCode.SOCKET_CLOSED);
        server.stop(true);
    }

    /** Yalnız aktif oturumu keser — sunucu dinlemeye devam eder. */
    public void disconnectSession() {
        closeSession(LinkErrorCode.SOCKET_CLOSED);
        server.onActiveSessionClosed();
    }

    /** Kullanıcı ekrandaki kodu onayladı/reddetti. */
    public boolean confirmPairing(boolean accepted) {
        LinkSession s = session.get();
        if (s == null) return false;

        boolean ok = s.confirmPairing(accepted);
        if (!accepted) {
            pendingPairing.set(null);
        }
        return ok;
    }

    /** "Güvenilen telefonu unut" — kayıt silinir, aktif oturum kapanır. */
    public void forgetTrustedPhone() {
        trustStore.forget();
        closeSession(LinkErrorCode.SOCKET_CLOSED);
        diagnostics.record(LinkSession.SYSTEM_CLOCK.nowMs(),
            LinkDiagnosticEvent.Side.HEAD_UNIT, LinkDiagnosticEvent.Category.PAIRING,
            "forget", null, LinkDiagnosticEvent.Severity.INFO, 0L, "guven kaydi silindi");
    }

    /** Sayaçları sıfırlar — AKTİF BAĞLANTIYI KESMEZ (GÖREV 14). */
    public void resetCounters() {
        server.resetCounters();
        LinkSession s = session.get();
        if (s != null) s.resetCounters();
        diagnostics.clear();
    }

    /* ══════════════════════════════════════════════════════════════════════
     * RfcommServerTransport.Callback
     * ════════════════════════════════════════════════════════════════════ */

    @Override
    public void onClientAccepted(BluetoothSocket socket, long generation) {
        connectStartedAtMs = LinkSession.SYSTEM_CLOCK.nowMs();

        LinkSession.Config cfg = new LinkSession.Config();
        cfg.serverSide = true;
        cfg.signer = signer;
        cfg.capabilities = LOCAL_CAPABILITIES;
        cfg.appVersion = appVersion;
        cfg.trustedPeerFingerprint = trustStore.trustedFingerprint();
        cfg.diagnostics = diagnostics;
        cfg.side = LinkDiagnosticEvent.Side.HEAD_UNIT;
        cfg.listener = this;

        LinkSession newSession = new LinkSession(cfg, generation);
        LinkSession previous = session.getAndSet(newSession);
        if (previous != null) {
            /* F4.1 — bu kopuşun gerekçesi "uzak taraf kapattı" DEĞİL,
             * "oturum yenisiyle değiştirildi"dir; kategori doğru taşınır. */
            pendingReason.set(LinkErrorCode.SOCKET_CLOSED);
            emitLinkState(LinkSession.State.CLOSED, previous.generation());
            previous.close(LinkErrorCode.SOCKET_CLOSED);
        }

        try {
            if (!newSession.start(socket.getInputStream(), socket.getOutputStream())) {
                closeSocketQuietly(socket);
                session.compareAndSet(newSession, null);
            }
        } catch (IOException e) {
            Log.w(TAG, "soket akışı alınamadı");
            closeSocketQuietly(socket);
            session.compareAndSet(newSession, null);
            server.onActiveSessionClosed();
        }
    }

    @Override
    public void onServerError(LinkErrorCode code, String safeDetails) {
        lastErrorCode = code.name();
        lastErrorAtMs = LinkSession.SYSTEM_CLOCK.nowMs();
    }

    @Override
    public void onServerStateChanged(String state) {
        /* Sunucu durumu anlık görüntüde okunur; ayrı bir kopya tutulmaz. */
    }

    /* ══════════════════════════════════════════════════════════════════════
     * LinkSession.Listener
     * ════════════════════════════════════════════════════════════════════ */

    @Override
    public void onStateChanged(LinkSession.State state, long generation) {
        lastSessionState = state.name();
        /* F4.5 SIRA: önce OTORİTE düşer (TS kanonik olayı burada alır), sonra
         * native kaynak temizliği. Tersi, yetkinin hâlâ ayakta olduğu bir
         * temizlik penceresi bırakırdı. */
        emitLinkState(state, generation);
        if (state == LinkSession.State.CLOSED || state == LinkSession.State.FAILED) {
            pendingPairing.set(null);
            server.onActiveSessionClosed();
        }
    }

    @Override
    public void onApplicationMessage(byte[] payload, long generation) {
        /* F2 — GÖREV 18 artık AÇIK: mesaj TS'e taşınır. Yürütme/yetki KARARI
         * hâlâ burada YOK — yalnız native'in kanıtladığı (fingerprint + nesil)
         * bir zarf, opak yükle birlikte köprüye verilir. Ret/ALLOW kararı
         * canonical authorization'a (TS) aittir. */
        if (!isAcceptableApplicationPayloadSize(payload)) {
            return; // boş/aşırı büyük yük sessizce düşürülür — köprü boğulmaz
        }
        LinkSession s = session.get();
        /* Nesil eşleşmiyorsa (bayat oturum geç geldi) TAŞINMAZ. */
        if (s == null || s.generation() != generation) return;
        LinkHandshake hs = s.handshake();
        String fingerprint = hs.peerFingerprint();
        if (fingerprint == null) return; // kimliği doğrulanmamış oturumdan mesaj taşınmaz

        ApplicationMessageListener l = applicationMessageListener;
        if (l == null) return;
        String text;
        try {
            text = new String(payload, StandardCharsets.UTF_8);
        } catch (RuntimeException e) {
            return; // kodlama bozuksa sessizce düşür
        }
        l.onApplicationMessage(fingerprint, generation, text);
    }

    /**
     * Saf, Android'e bağlı olmayan kaba boyut kontrolü — doğrudan JUnit'te
     * sürülebilir (bkz. {@code PhoneHubApplicationMessageTest}). Boş/aşırı
     * büyük yük kabul edilmez; içerik hiç YORUMLANMAZ (opak).
     */
    public static boolean isAcceptableApplicationPayloadSize(byte[] payload) {
        return payload != null && payload.length > 0
            && payload.length <= MAX_APPLICATION_MESSAGE_BYTES;
    }

    @Override
    public void onPairingCodeReady(String code, long expiresAtMs, long generation) {
        pendingPairing.set(new PendingPairing(code, expiresAtMs, generation));
    }

    @Override
    public void onEstablished(List<String> grantedCapabilities, long generation) {
        pendingPairing.set(null);
        LinkSession s = session.get();
        if (s == null) return;

        LinkHandshake hs = s.handshake();
        String fingerprint = hs.peerFingerprint();
        long now = LinkSession.SYSTEM_CLOCK.nowMs();

        /* Güven kaydı YALNIZ oturum gerçekten kurulduktan sonra yazılır —
         * "el sıkışma başladı" yeterli değildir. */
        if (fingerprint != null) {
            trustStore.trustPeer(fingerprint, "Telefon",
                hs.negotiatedProtocolVersion(), now);
        }
    }

    @Override
    public void onError(LinkErrorCode code, String safeDetails, long generation) {
        lastErrorCode = code.name();
        lastErrorAtMs = LinkSession.SYSTEM_CLOCK.nowMs();
        /* F4.1 — yalnız GEREKÇE KATEGORİSİ için saklanır; kod TS'e gitmez. */
        pendingReason.set(code);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Anlık görüntü — CAROS LAB ve kullanıcı ekranı bunu okur
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Tanı anlık görüntüsü. TÜM alanlar GERÇEK kaynaklardan gelir; ölçülmemiş
     * süreler {@code -1}, bilinmeyen metinler {@code null}'dır. Doğrulama kodu,
     * MAC, cihaz adı, anahtar ve ham yük BURADA YOKTUR.
     */
    public JSONObject snapshotJson() {
        JSONObject root = new JSONObject();
        try {
            root.put("schemaVersion", 1);
            root.put("uuid", PhoneHubUuid.SERVICE_UUID_STRING);
            root.put("uuidDistinctFromObdSpp", PhoneHubUuid.isDistinctFromObdSpp());

            /* Sunucu */
            JSONObject srv = new JSONObject();
            srv.put("state", server.state().name());
            srv.put("running", server.isRunning());
            srv.put("disposed", server.isDisposed());
            srv.put("listenStartedAtMs", server.listenStartedAtMs());
            srv.put("acceptedCount", server.acceptedCount());
            srv.put("rejectedSecondClient", server.rejectedSecondClientCount());
            srv.put("hasActiveSocket", server.hasActiveSocket());
            LinkErrorCode serverError = server.lastError();
            srv.put("lastErrorCode", serverError == null ? JSONObject.NULL : serverError.name());
            root.put("server", srv);

            /* Ön koşullar — HER çağrıda yeniden ölçülür */
            JSONObject pre = new JSONObject();
            LinkErrorCode blocker = server.checkPreconditions();
            pre.put("ready", blocker == null);
            pre.put("blockerCode", blocker == null ? JSONObject.NULL : blocker.name());
            pre.put("connectPermission", server.hasConnectPermission());
            root.put("preconditions", pre);

            /* Kimlik */
            JSONObject identity = new JSONObject();
            identity.put("hasIdentity", signer.hasIdentity());
            identity.put("hardwareBacked", signer.isHardwareBacked());
            /* Ham açık anahtar DEĞİL, yalnız var/yok. */
            root.put("identity", identity);

            /* Güven kaydı */
            JSONObject trust = new JSONObject();
            trust.put("hasTrustedPeer", trustStore.hasTrustedPeer());
            String fp = trustStore.trustedFingerprint();
            trust.put("peerFingerprint", fp == null ? JSONObject.NULL : fp);
            trust.put("lastConnectedAtMs", trustStore.lastConnectedAtMs());
            trust.put("protocolVersion", trustStore.protocolVersion());
            trust.put("connectCount", trustStore.connectCount());
            root.put("trust", trust);

            /* Oturum */
            LinkSession s = session.get();
            if (s == null) {
                root.put("session", JSONObject.NULL);
            } else {
                root.put("session", sessionJson(s.snapshot()));
            }
            root.put("connectStartedAtMs", connectStartedAtMs);
            root.put("lastSessionState", lastSessionState);
            root.put("lastErrorCode", lastErrorCode == null ? JSONObject.NULL : lastErrorCode);
            root.put("lastErrorAtMs", lastErrorAtMs);

            /* Onay bekleyen kod — YALNIZ var/yok ve süre, KODUN KENDİSİ DEĞİL */
            PendingPairing pending = pendingPairing.get();
            JSONObject pairing = new JSONObject();
            pairing.put("awaitingConfirmation", pending != null);
            pairing.put("expiresAtMs", pending == null ? -1L : pending.expiresAtMs);
            root.put("pairing", pairing);

            /* Tanı defteri */
            JSONObject diag = new JSONObject();
            diag.put("size", diagnostics.size());
            diag.put("capacity", diagnostics.capacity());
            diag.put("dropped", diagnostics.droppedCount());
            diag.put("redacted", diagnostics.redactedCount());
            JSONArray events = new JSONArray();
            for (LinkDiagnosticEvent e : diagnostics.recent(50)) {
                JSONObject je = new JSONObject();
                je.put("t", e.timestampMs());
                je.put("side", e.side().name());
                je.put("category", e.category().name());
                je.put("stage", e.stage());
                je.put("code", e.code() == null ? JSONObject.NULL : e.code().name());
                je.put("severity", e.severity().name());
                je.put("generation", e.sessionGeneration());
                je.put("details", e.safeDetails());
                events.put(je);
            }
            diag.put("events", events);
            root.put("diagnostics", diag);

        } catch (JSONException e) {
            /* JSON kurulamazsa sahte bir "sağlıklı" nesne dönmek YASAK. */
            try {
                root.put("error", "SNAPSHOT_BUILD_FAILED");
            } catch (JSONException ignored) { /* umutsuz durum */ }
        }
        return root;
    }

    /**
     * Kullanıcı ekranı için doğrulama kodu. YALNIZ onay penceresi boyunca ve
     * YALNIZ bu çağrı ile okunur; anlık görüntüye veya deftere GİRMEZ.
     */
    public String pendingPairingCodeForDisplay() {
        PendingPairing p = pendingPairing.get();
        if (p == null) return null;
        if (LinkSession.SYSTEM_CLOCK.nowMs() >= p.expiresAtMs) return null;
        return p.code;
    }

    private static JSONObject sessionJson(LinkSessionSnapshot s) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("generation", s.generation);
        o.put("state", s.state);
        o.put("serverSide", s.serverSide);
        o.put("handshakeStage", s.handshakeStage);
        o.put("awaitingUserConfirm", s.awaitingUserConfirm);
        o.put("trustSkipped", s.trustSkipped);
        o.put("disposed", s.disposed);
        o.put("startedAtMs", s.startedAtMs);
        o.put("establishedAtMs", s.establishedAtMs);
        o.put("negotiationDurationMs", s.negotiationDurationMs);
        o.put("lastInboundAgeMs", s.lastInboundAgeMs);
        o.put("protocolVersion", s.protocolVersion);
        o.put("peerFingerprint", s.peerFingerprint == null
            ? JSONObject.NULL : s.peerFingerprint);
        o.put("peerAppVersion", s.peerAppVersion == null
            ? JSONObject.NULL : s.peerAppVersion);
        o.put("grantedCapabilities", new JSONArray(s.grantedCapabilities));
        o.put("heartbeatsSent", s.heartbeatsSent);
        o.put("heartbeatsReceived", s.heartbeatsReceived);
        o.put("framesSent", s.framesSent);
        o.put("framesReceived", s.framesReceived);
        o.put("bytesSent", s.bytesSent);
        o.put("bytesReceived", s.bytesReceived);
        o.put("appMessagesReceived", s.appMessagesReceived);
        o.put("writeQueueDepth", s.writeQueueDepth);
        o.put("writeQueueCapacity", s.writeQueueCapacity);
        o.put("writeQueueRejections", s.writeQueueRejections);
        o.put("checksumFailures", s.checksumFailures);
        o.put("malformedFrames", s.malformedFrames);
        o.put("oversizeRejections", s.oversizeRejections);
        o.put("resyncEvents", s.resyncEvents);
        o.put("unknownTypeDropped", s.unknownTypeDropped);
        o.put("decryptFailures", s.decryptFailures);
        o.put("replayRejections", s.replayRejections);
        o.put("encryptionActive", s.encryptionActive);
        o.put("readerAlive", s.readerAlive);
        o.put("writerAlive", s.writerAlive);
        o.put("lastErrorCode", s.lastErrorCode == null ? JSONObject.NULL : s.lastErrorCode);
        o.put("disconnectReasonCode", s.disconnectReasonCode == null
            ? JSONObject.NULL : s.disconnectReasonCode);
        o.put("trulyEstablished", s.isTrulyEstablished());
        return o;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç
     * ════════════════════════════════════════════════════════════════════ */

    private void closeSession(LinkErrorCode reason) {
        LinkSession s = session.getAndSet(null);
        if (s != null) s.close(reason);
        pendingPairing.set(null);
    }

    private static void closeSocketQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try { socket.close(); } catch (IOException ignored) { /* kapanış sessiz */ }
    }
}
