package com.cockpitos.phonehub.protocol;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * LinkSession — kurulu bir bayt akışı üzerindeki TAM oturum sürücüsü
 * (GÖREV 4, 5, 9, 10, 16'nın ortak çekirdeği).
 *
 * ── NEDEN BURADA, ANDROID TARAFINDA DEĞİL ───────────────────────────────────
 * Sunucu (head unit) ile istemci (telefon) arasındaki TEK fark, akışın nasıl
 * elde edildiğidir: biri {@code accept()} eder, diğeri {@code connect()}.
 * Akış kurulduktan sonra okuma döngüsü, yazma kuyruğu, el sıkışma, kalp atışı,
 * sayaçlar ve kapanış MANTIĞI birebir aynıdır. Bu mantık burada, saf Java'da
 * durur → tek kopya, ve gerçek Bluetooth olmadan {@code PipedStream} ile
 * uçtan uca test edilebilir. Android sınıfları yalnızca soket kabuğudur.
 *
 * ── İŞ PARÇACIĞI SAHİPLİĞİ (SINIRLI VE AÇIK) ────────────────────────────────
 * Oturum başına TAM İKİ iş parçacığı: bir okuyucu, bir yazıcı. Üçüncü bir
 * zamanlayıcı YOKTUR — kalp atışı, yazıcının kuyruk beklemesinin zaman aşımı
 * uyanışında gönderilir. Böylece "kalp atışı zamanlayıcısı kapatılmayı unuttu"
 * arıza sınıfı yapısal olarak imkânsızdır.
 *
 * ── KAPATILDIKTAN SONRA DİRİLME YOK ─────────────────────────────────────────
 * {@link #close} çağrıldıktan sonra {@code disposed} bayrağı KALICIDIR:
 * yeni iş parçacığı başlatılamaz, kuyruğa yazılamaz, gelen bayt işlenmez.
 * Bu depoda sahipsiz timer'ın oturumu diriltmesi gerçekten yaşanmış bir
 * arızadır; bayrak o dersin kodudur.
 *
 * ── NESİL (GENERATION) KAPISI ───────────────────────────────────────────────
 * Her oturumun bir nesli vardır. Geciken bir iş parçacığı kapanmış oturuma ait
 * olay üretirse, nesil tutmadığı için YOK SAYILIR ve yeni oturumu kirletmez.
 */
public final class LinkSession {

    /* ══════════════════════════════════════════════════════════════════════
     * Sözleşmeler
     * ════════════════════════════════════════════════════════════════════ */

    public enum State {
        IDLE, HANDSHAKING, AWAITING_USER_CONFIRM, CONNECTED,
        DEGRADED, CLOSING, CLOSED, FAILED
    }

    /** Monoton saat — duvar saati DEĞİL (saat geri alınırsa süreler bozulmasın). */
    public interface MonotonicClock {
        long nowMs();
    }

    public static final MonotonicClock SYSTEM_CLOCK = new MonotonicClock() {
        @Override public long nowMs() { return System.nanoTime() / 1_000_000L; }
    };

    /**
     * Oturum olayları. TÜM geri çağrılar oturumun iş parçacıklarından gelir;
     * uygulayan taraf UI'ya geçişi KENDİ yapar (bu modül Android bilmez).
     */
    public interface Listener {
        void onStateChanged(State state, long generation);
        /** Şifresi çözülmüş uygulama mesajı — bu katman için OPAK. */
        void onApplicationMessage(byte[] payload, long generation);
        /** Kullanıcıya gösterilecek doğrulama kodu (loglanmaz, saklanmaz). */
        void onPairingCodeReady(String code, long expiresAtMs, long generation);
        void onEstablished(List<String> grantedCapabilities, long generation);
        void onError(LinkErrorCode code, String safeDetails, long generation);
    }

    /** Hiçbir şey yapmayan varsayılan — null kontrolü her çağrıya dağılmasın. */
    private static final Listener NULL_LISTENER = new Listener() {
        @Override public void onStateChanged(State s, long g) { }
        @Override public void onApplicationMessage(byte[] p, long g) { }
        @Override public void onPairingCodeReady(String c, long e, long g) { }
        @Override public void onEstablished(List<String> caps, long g) { }
        @Override public void onError(LinkErrorCode c, String d, long g) { }
    };

    public static final class Config {
        public boolean serverSide;
        public LinkIdentitySigner signer;
        public List<String> capabilities;
        public String appVersion = "?";
        public String trustedPeerFingerprint;
        public long heartbeatIntervalMs = 10_000L;
        public long heartbeatTimeoutMs = 30_000L;
        public long handshakeTimeoutMs = 45_000L;
        public int writeQueueCapacity = 64;
        public MonotonicClock clock = SYSTEM_CLOCK;
        public LinkDiagnosticBuffer diagnostics;
        public LinkDiagnosticEvent.Side side = LinkDiagnosticEvent.Side.HEAD_UNIT;
        public Listener listener;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Alanlar
     * ════════════════════════════════════════════════════════════════════ */

    private final Config cfg;
    private final Listener listener;
    private final LinkDiagnosticBuffer diag;
    private final MonotonicClock clock;
    private final long generation;

    private final FrameDecoder decoder = new FrameDecoder();
    private final BlockingQueue<byte[]> writeQueue;
    private final AtomicBoolean disposed = new AtomicBoolean(false);
    private final AtomicBoolean started = new AtomicBoolean(false);

    private final AtomicLong outboundMessageId = new AtomicLong(0L);
    private final AtomicLong lastInboundAtMs = new AtomicLong(0L);
    private final AtomicLong heartbeatsSent = new AtomicLong(0L);
    private final AtomicLong heartbeatsReceived = new AtomicLong(0L);
    private final AtomicLong bytesSent = new AtomicLong(0L);
    private final AtomicLong bytesReceived = new AtomicLong(0L);
    private final AtomicLong framesSent = new AtomicLong(0L);
    private final AtomicLong appMessagesReceived = new AtomicLong(0L);
    private final AtomicLong malformedRunLength = new AtomicLong(0L);
    private final AtomicLong writeQueueRejections = new AtomicLong(0L);
    private final AtomicLong unknownTypeDropped = new AtomicLong(0L);

    private volatile State state = State.IDLE;
    private volatile LinkErrorCode lastError;
    private volatile LinkErrorCode disconnectReason;
    private volatile long startedAtMs;
    private volatile long establishedAtMs;
    private volatile long negotiationStartedAtMs;

    private volatile InputStream in;
    private volatile OutputStream out;
    private volatile Thread readerThread;
    private volatile Thread writerThread;

    private final LinkHandshake handshake;
    private volatile SessionCrypto crypto;
    private volatile boolean awaitingUserConfirm;

    /** Art arda bozuk çerçeve tavanı — tek gürültü değil, ISRAR oturumu kapatır. */
    public static final int MAX_CONSECUTIVE_MALFORMED = 5;

    public LinkSession(Config config, long generation) {
        this.cfg = config;
        this.generation = generation;
        this.listener = config.listener == null ? NULL_LISTENER : config.listener;
        this.diag = config.diagnostics == null ? new LinkDiagnosticBuffer() : config.diagnostics;
        this.clock = config.clock == null ? SYSTEM_CLOCK : config.clock;
        this.writeQueue = new ArrayBlockingQueue<>(
            config.writeQueueCapacity > 0 ? config.writeQueueCapacity : 64);
        this.handshake = config.serverSide
            ? LinkHandshake.server(config.signer, config.capabilities,
                config.appVersion, config.trustedPeerFingerprint)
            : LinkHandshake.client(config.signer, config.capabilities,
                config.appVersion, config.trustedPeerFingerprint);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yaşam döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Akışı devralır ve iş parçacıklarını başlatır.
     *
     * Bir kez başlatılabilir; kapatıldıktan sonra YENİDEN başlatılamaz
     * (yeni oturum = yeni nesne + yeni nesil).
     */
    public boolean start(InputStream input, OutputStream output) {
        if (disposed.get()) return false;
        if (!started.compareAndSet(false, true)) return false;
        if (input == null || output == null) {
            failWith(LinkErrorCode.SOCKET_CLOSED, "akış yok");
            return false;
        }

        this.in = input;
        this.out = output;
        this.startedAtMs = clock.nowMs();
        this.negotiationStartedAtMs = startedAtMs;
        this.lastInboundAtMs.set(startedAtMs);

        setState(State.HANDSHAKING);
        record(LinkDiagnosticEvent.Category.LIFECYCLE, "start", null,
            LinkDiagnosticEvent.Severity.INFO, "oturum basladi");

        readerThread = new Thread(new Runnable() {
            @Override public void run() { readLoop(); }
        }, "phonehub-read-" + generation);
        readerThread.setDaemon(true);

        writerThread = new Thread(new Runnable() {
            @Override public void run() { writeLoop(); }
        }, "phonehub-write-" + generation);
        writerThread.setDaemon(true);

        readerThread.start();
        writerThread.start();

        /* İstemci el sıkışmayı BAŞLATIR; sunucu bekler. */
        if (!cfg.serverSide) {
            LinkHandshake.Step hello = handshake.createClientHello();
            if (!hello.ok()) {
                failWith(hello.error, "client hello uretilemedi");
                return false;
            }
            enqueuePlain(LinkMessageType.CLIENT_HELLO, hello.payload);
        }
        return true;
    }

    /**
     * Oturumu kapatır ve TÜM kaynağı bırakır. İdempotenttir.
     *
     * @param reason kopma nedeni — kullanıcı kapattıysa {@code null} geçilmez,
     *               {@link LinkErrorCode#SOCKET_CLOSED} kullanılır ve bu
     *               "kasıtlı" olarak işaretlenir (yeniden bağlanma kararı
     *               ÇAĞIRANA aittir; bu sınıf kendiliğinden bağlanmaz).
     */
    public void close(LinkErrorCode reason) {
        if (!disposed.compareAndSet(false, true)) return;

        disconnectReason = reason;
        setState(State.CLOSING);
        record(LinkDiagnosticEvent.Category.LIFECYCLE, "close", reason,
            LinkDiagnosticEvent.Severity.INFO, "oturum kapaniyor");

        Thread r = readerThread;
        Thread w = writerThread;
        readerThread = null;
        writerThread = null;
        if (r != null) r.interrupt();
        if (w != null) w.interrupt();

        closeQuietly(in);
        closeQuietly(out);
        in = null;
        out = null;

        writeQueue.clear();
        handshake.destroy();
        SessionCrypto c = crypto;
        if (c != null) c.destroy();
        crypto = null;

        setState(State.CLOSED);
    }

    public boolean isDisposed() { return disposed.get(); }

    /* ══════════════════════════════════════════════════════════════════════
     * Kullanıcı onayı
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Kullanıcının doğrulama kodunu onaylaması/reddetmesi.
     *
     * Reddedilirse oturum KAPANIR — "yine de devam et" yolu yoktur.
     */
    public boolean confirmPairing(boolean accepted) {
        if (disposed.get() || !awaitingUserConfirm) return false;

        LinkHandshake.Step step = handshake.confirmByUser(accepted, clock.nowMs());
        if (!step.ok()) {
            record(LinkDiagnosticEvent.Category.PAIRING, "user-confirm", step.error,
                LinkDiagnosticEvent.Severity.WARN, "onay reddedildi veya gecersiz");
            failWith(step.error, "eslestirme onaylanmadi");
            close(step.error);
            return false;
        }
        awaitingUserConfirm = false;
        crypto = handshake.crypto();
        sendConfirm();
        return true;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Gönderim
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Uygulama mesajı gönderir. YALNIZ kurulmuş (ve şifreli) oturumda kabul
     * edilir — el sıkışma sürerken uygulama trafiği YOKTUR.
     */
    public boolean sendApplicationMessage(byte[] payload) {
        if (disposed.get()) return false;
        if (state != State.CONNECTED && state != State.DEGRADED) return false;
        if (crypto == null) return false;
        return enqueueEncrypted(LinkMessageType.APPLICATION, payload);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Okuma döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    private void readLoop() {
        byte[] chunk = new byte[2048];
        try {
            while (!disposed.get()) {
                InputStream stream = in;
                if (stream == null) break;

                int n = stream.read(chunk);
                if (n < 0) {
                    /* EOF = TEMİZ kapanma. Hata olarak raporlanmaz. */
                    record(LinkDiagnosticEvent.Category.SOCKET, "read-eof",
                        LinkErrorCode.SOCKET_CLOSED, LinkDiagnosticEvent.Severity.INFO,
                        "karsi taraf akisi kapatti");
                    closeFromWorker(LinkErrorCode.SOCKET_CLOSED);
                    return;
                }
                if (n == 0) continue;

                bytesReceived.addAndGet(n);
                lastInboundAtMs.set(clock.nowMs());

                LinkErrorCode appendError = decoder.append(chunk, 0, n);
                if (appendError != null) {
                    handleFrameError(appendError);
                    continue;
                }
                drainDecoder();
            }
        } catch (IOException e) {
            if (!disposed.get()) {
                record(LinkDiagnosticEvent.Category.SOCKET, "read", LinkErrorCode.READ_FAILED,
                    LinkDiagnosticEvent.Severity.ERROR, "okuma hatasi");
                closeFromWorker(LinkErrorCode.READ_FAILED);
            }
        } catch (RuntimeException e) {
            if (!disposed.get()) {
                record(LinkDiagnosticEvent.Category.SOCKET, "read", LinkErrorCode.UNKNOWN_ERROR,
                    LinkDiagnosticEvent.Severity.ERROR, "beklenmeyen okuma hatasi");
                closeFromWorker(LinkErrorCode.UNKNOWN_ERROR);
            }
        }
    }

    private void drainDecoder() {
        for (;;) {
            if (disposed.get()) return;
            FrameDecoder.Result r = decoder.next();
            if (r.status == FrameDecoder.Status.NEED_MORE) return;
            if (r.status == FrameDecoder.Status.ERROR) {
                handleFrameError(r.error);
                continue;
            }
            malformedRunLength.set(0L);
            handleFrame(r.frame);
        }
    }

    /**
     * Bozuk çerçeve tek başına bağlantıyı ÇÖKERTMEZ; ısrar ederse kapatır.
     * Gerekçe: RFCOMM hattında tek bir gürültü olayı gerçektir ve oturumu
     * öldürmesi kullanıcıya "durduk yere koptu" olarak yansırdı.
     */
    private void handleFrameError(LinkErrorCode code) {
        long run = malformedRunLength.incrementAndGet();
        record(LinkDiagnosticEvent.Category.FRAME, "decode", code,
            LinkDiagnosticEvent.Severity.WARN, "bozuk cerceve, ardisik=" + run);
        listener.onError(code, "cerceve reddedildi", generation);
        if (run >= MAX_CONSECUTIVE_MALFORMED) {
            closeFromWorker(code);
        }
    }

    private void handleFrame(LinkFrame frame) {
        byte[] framed;

        if (frame.isEncrypted()) {
            SessionCrypto c = crypto;
            if (c == null) {
                /* Anahtar yokken şifreli çerçeve → güvenlik olayı. */
                record(LinkDiagnosticEvent.Category.SECURITY, "decrypt",
                    LinkErrorCode.DECRYPTION_FAILED, LinkDiagnosticEvent.Severity.ERROR,
                    "anahtar yokken sifreli cerceve");
                closeFromWorker(LinkErrorCode.DECRYPTION_FAILED);
                return;
            }
            SessionCrypto.OpenResult opened = c.open(frame);
            if (!opened.ok()) {
                record(LinkDiagnosticEvent.Category.SECURITY, "decrypt", opened.error,
                    LinkDiagnosticEvent.Severity.ERROR, "cozulemedi");
                listener.onError(opened.error, "guvenlik ihlali", generation);
                if (c.shouldTerminateForSecurity()) closeFromWorker(opened.error);
                return;
            }
            framed = opened.plaintext;
        } else {
            /* Oturum kurulduktan SONRA düz metin kabul edilmez — aksi hâlde
             * saldırgan şifrelemeyi "düşürerek" atlatabilirdi. */
            if (state == State.CONNECTED || state == State.DEGRADED) {
                record(LinkDiagnosticEvent.Category.SECURITY, "downgrade",
                    LinkErrorCode.DECRYPTION_FAILED, LinkDiagnosticEvent.Severity.ERROR,
                    "kurulu oturumda duz metin reddedildi");
                closeFromWorker(LinkErrorCode.DECRYPTION_FAILED);
                return;
            }
            framed = frame.payload();
        }

        byte type = LinkMessageType.typeOf(framed);
        byte[] body = LinkMessageType.body(framed);

        switch (type) {
            case LinkMessageType.CLIENT_HELLO:  onClientHello(body); return;
            case LinkMessageType.SERVER_HELLO:  onServerHello(body); return;
            case LinkMessageType.CLIENT_AUTH:   onClientAuth(body); return;
            case LinkMessageType.CONFIRM:
            case LinkMessageType.CONFIRM_ACK:   onConfirm(body); return;
            case LinkMessageType.HEARTBEAT:
                heartbeatsReceived.incrementAndGet();
                enqueueEncrypted(LinkMessageType.HEARTBEAT_ACK, new byte[0]);
                return;
            case LinkMessageType.HEARTBEAT_ACK:
                heartbeatsReceived.incrementAndGet();
                return;
            case LinkMessageType.APPLICATION:
                appMessagesReceived.incrementAndGet();
                listener.onApplicationMessage(body, generation);
                return;
            default:
                /* Bilinmeyen tür: TAŞINIR ama ÇALIŞTIRILMAZ, kopma sebebi değil. */
                unknownTypeDropped.incrementAndGet();
                record(LinkDiagnosticEvent.Category.FRAME, "unknown-type", null,
                    LinkDiagnosticEvent.Severity.DEBUG, "bilinmeyen tur dusuruldu");
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * El sıkışma adımları
     * ════════════════════════════════════════════════════════════════════ */

    private void onClientHello(byte[] body) {
        LinkHandshake.Step step = handshake.onClientHello(body);
        if (!step.ok()) { failAndClose(step.error, "server hello"); return; }
        enqueuePlain(LinkMessageType.SERVER_HELLO, step.payload);
    }

    private void onServerHello(byte[] body) {
        LinkHandshake.Step step = handshake.onServerHello(body, clock.nowMs());
        if (!step.ok()) { failAndClose(step.error, "client auth"); return; }
        enqueuePlain(LinkMessageType.CLIENT_AUTH, step.payload);
        afterKeysDerived();
    }

    private void onClientAuth(byte[] body) {
        LinkHandshake.Step step = handshake.onClientAuth(body, clock.nowMs());
        if (!step.ok()) { failAndClose(step.error, "auth dogrulama"); return; }
        afterKeysDerived();
    }

    /** Anahtarlar hazır: ya kullanıcı onayı beklenir ya doğrudan confirm turu. */
    private void afterKeysDerived() {
        crypto = handshake.crypto();
        if (handshake.userConfirmationRequired()) {
            awaitingUserConfirm = true;
            setState(State.AWAITING_USER_CONFIRM);
            PairingCode code = handshake.pairingCode();
            record(LinkDiagnosticEvent.Category.PAIRING, "code-ready", null,
                LinkDiagnosticEvent.Severity.INFO, "dogrulama kodu uretildi");
            if (code != null) {
                /* Kod YALNIZ dinleyiciye (ekrana) verilir — deftere GİRMEZ. */
                listener.onPairingCodeReady(code.visibleCode(), code.expiresAtMs(), generation);
            }
        } else {
            record(LinkDiagnosticEvent.Category.PAIRING, "trusted-skip", null,
                LinkDiagnosticEvent.Severity.INFO, "guvenilen cihaz, onay atlandi");
            sendConfirm();
        }
    }

    private void sendConfirm() {
        LinkHandshake.Step step = handshake.createConfirm();
        if (!step.ok()) { failAndClose(step.error, "confirm uretilemedi"); return; }
        byte type = cfg.serverSide ? LinkMessageType.CONFIRM_ACK : LinkMessageType.CONFIRM;
        enqueueEncrypted(type, step.payload);
        if (handshake.isEstablished()) markEstablished();
    }

    private void onConfirm(byte[] body) {
        LinkHandshake.Step step = handshake.onConfirm(body);
        if (!step.ok()) { failAndClose(step.error, "confirm dogrulanamadi"); return; }

        /* Sunucu confirm'ü ÖNCE alır, ack'i SONRA yollar. */
        if (handshake.stage() == LinkHandshake.Stage.AUTH_EXCHANGED) {
            sendConfirm();
            return;
        }
        if (handshake.isEstablished()) markEstablished();
    }

    private void markEstablished() {
        if (state == State.CONNECTED) return;
        establishedAtMs = clock.nowMs();
        setState(State.CONNECTED);
        record(LinkDiagnosticEvent.Category.NEGOTIATION, "established", null,
            LinkDiagnosticEvent.Severity.INFO,
            "yetenek sayisi=" + handshake.grantedCapabilities().size());
        listener.onEstablished(handshake.grantedCapabilities(), generation);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yazma döngüsü + kalp atışı
     * ════════════════════════════════════════════════════════════════════ */

    private void writeLoop() {
        try {
            while (!disposed.get()) {
                byte[] pending = writeQueue.poll(cfg.heartbeatIntervalMs, TimeUnit.MILLISECONDS);
                if (disposed.get()) return;

                if (pending != null) {
                    OutputStream stream = out;
                    if (stream == null) return;
                    stream.write(pending);
                    stream.flush();
                    bytesSent.addAndGet(pending.length);
                    framesSent.incrementAndGet();
                    continue;
                }

                /* Kuyruk zaman aşımı = kalp atışı penceresi. Ayrı zamanlayıcı YOK. */
                checkLiveness();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            if (!disposed.get()) {
                record(LinkDiagnosticEvent.Category.SOCKET, "write", LinkErrorCode.WRITE_FAILED,
                    LinkDiagnosticEvent.Severity.ERROR, "yazma hatasi");
                closeFromWorker(LinkErrorCode.WRITE_FAILED);
            }
        } catch (RuntimeException e) {
            if (!disposed.get()) closeFromWorker(LinkErrorCode.UNKNOWN_ERROR);
        }
    }

    /**
     * Canlılık kontrolü — üç kademeli:
     *  · el sıkışma penceresinde takılı kalma  → HANDSHAKE zaman aşımı
     *  · kurulu oturumda sessizlik > eşik/2    → DEGRADED
     *  · sessizlik > eşik                       → HEARTBEAT_TIMEOUT ve kapanış
     */
    private void checkLiveness() {
        long now = clock.nowMs();
        long silence = now - lastInboundAtMs.get();

        if (state == State.HANDSHAKING || state == State.AWAITING_USER_CONFIRM) {
            if (now - negotiationStartedAtMs > cfg.handshakeTimeoutMs) {
                record(LinkDiagnosticEvent.Category.NEGOTIATION, "handshake-timeout",
                    LinkErrorCode.CLIENT_CONNECT_TIMEOUT, LinkDiagnosticEvent.Severity.ERROR,
                    "el sikisma tamamlanmadi");
                closeFromWorker(LinkErrorCode.CLIENT_CONNECT_TIMEOUT);
            }
            return;
        }
        if (state != State.CONNECTED && state != State.DEGRADED) return;

        if (silence > cfg.heartbeatTimeoutMs) {
            record(LinkDiagnosticEvent.Category.HEARTBEAT, "timeout",
                LinkErrorCode.HEARTBEAT_TIMEOUT, LinkDiagnosticEvent.Severity.ERROR,
                "kalp atisi alinamadi");
            closeFromWorker(LinkErrorCode.HEARTBEAT_TIMEOUT);
            return;
        }
        if (silence > cfg.heartbeatTimeoutMs / 2) {
            if (state != State.DEGRADED) {
                setState(State.DEGRADED);
                record(LinkDiagnosticEvent.Category.HEARTBEAT, "degraded", null,
                    LinkDiagnosticEvent.Severity.WARN, "baglanti zayif");
            }
        } else if (state == State.DEGRADED) {
            setState(State.CONNECTED);
        }

        heartbeatsSent.incrementAndGet();
        enqueueEncrypted(LinkMessageType.HEARTBEAT, new byte[0]);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kuyruk
     * ════════════════════════════════════════════════════════════════════ */

    private boolean enqueuePlain(byte type, byte[] body) {
        byte[] framed = LinkMessageType.prefix(type, body);
        LinkFrame frame = new LinkFrame(LinkFrame.FRAMING_VERSION, 0,
            outboundMessageId.incrementAndGet(), new byte[0], framed);
        return encodeAndEnqueue(frame);
    }

    private boolean enqueueEncrypted(byte type, byte[] body) {
        SessionCrypto c = crypto;
        if (c == null) {
            /* Şifreleme yoksa düz metne DÜŞÜLMEZ — fail-closed. */
            listener.onError(LinkErrorCode.SECURITY_NOT_IMPLEMENTED,
                "anahtar yok", generation);
            return false;
        }
        byte[] framed = LinkMessageType.prefix(type, body);
        long id = outboundMessageId.incrementAndGet();
        SessionCrypto.SealResult sealed = c.seal(framed, 0, id);
        if (!sealed.ok()) {
            listener.onError(sealed.error, "muhurlenemedi", generation);
            return false;
        }
        LinkFrame frame = new LinkFrame(LinkFrame.FRAMING_VERSION,
            LinkFrame.FLAG_ENCRYPTED, id, sealed.nonce, sealed.ciphertext);
        return encodeAndEnqueue(frame);
    }

    private boolean encodeAndEnqueue(LinkFrame frame) {
        if (disposed.get()) return false;
        FrameCodec.EncodeResult enc = FrameCodec.encode(frame);
        if (!enc.ok()) {
            listener.onError(enc.error, "cerceve kodlanamadi", generation);
            return false;
        }
        /* Kuyruk SINIRLI: dolduysa mesaj DÜŞER ve bu RAPORLANIR — sessizce
         * biriktirip belleği tüketmek daha kötü bir arızadır. */
        if (!writeQueue.offer(enc.bytes)) {
            writeQueueRejections.incrementAndGet();
            record(LinkDiagnosticEvent.Category.SOCKET, "write-queue",
                LinkErrorCode.WRITE_FAILED, LinkDiagnosticEvent.Severity.WARN,
                "kuyruk dolu, mesaj dusuruldu");
            listener.onError(LinkErrorCode.WRITE_FAILED, "kuyruk dolu", generation);
            return false;
        }
        return true;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Durum ve anlık görüntü
     * ════════════════════════════════════════════════════════════════════ */

    public State state() { return state; }
    public long generation() { return generation; }
    public LinkErrorCode lastError() { return lastError; }
    public LinkErrorCode disconnectReason() { return disconnectReason; }
    public LinkDiagnosticBuffer diagnostics() { return diag; }
    public LinkHandshake handshake() { return handshake; }

    /** Tanı ekranının okuduğu anlık görüntü — PII YOK, sahte değer YOK. */
    public LinkSessionSnapshot snapshot() {
        LinkSessionSnapshot s = new LinkSessionSnapshot();
        s.generation = generation;
        s.state = state.name();
        s.serverSide = cfg.serverSide;
        s.startedAtMs = startedAtMs;
        s.establishedAtMs = establishedAtMs;
        s.negotiationDurationMs = establishedAtMs > 0
            ? establishedAtMs - negotiationStartedAtMs : -1L;
        s.handshakeStage = handshake.stage().name();
        s.protocolVersion = handshake.negotiatedProtocolVersion();
        s.peerFingerprint = handshake.peerFingerprint();
        s.peerAppVersion = handshake.peerAppVersion();
        s.grantedCapabilities = handshake.grantedCapabilities();
        s.awaitingUserConfirm = awaitingUserConfirm;
        s.trustSkipped = !handshake.userConfirmationRequired();
        s.heartbeatsSent = heartbeatsSent.get();
        s.heartbeatsReceived = heartbeatsReceived.get();
        s.lastInboundAgeMs = lastInboundAtMs.get() > 0
            ? clock.nowMs() - lastInboundAtMs.get() : -1L;
        s.framesSent = framesSent.get();
        s.framesReceived = decoder.framesDecoded();
        s.bytesSent = bytesSent.get();
        s.bytesReceived = bytesReceived.get();
        s.appMessagesReceived = appMessagesReceived.get();
        s.writeQueueDepth = writeQueue.size();
        s.writeQueueCapacity = cfg.writeQueueCapacity;
        s.writeQueueRejections = writeQueueRejections.get();
        s.checksumFailures = decoder.checksumFailures();
        s.malformedFrames = decoder.malformedFrames();
        s.oversizeRejections = decoder.oversizeRejections();
        s.resyncEvents = decoder.resyncEvents();
        s.unknownTypeDropped = unknownTypeDropped.get();
        SessionCrypto c = crypto;
        s.decryptFailures = c == null ? 0L : c.decryptFailures();
        s.replayRejections = c == null ? 0L : c.replayRejections();
        s.encryptionActive = c != null && !c.isDestroyed();
        s.readerAlive = isAlive(readerThread);
        s.writerAlive = isAlive(writerThread);
        s.disposed = disposed.get();
        s.lastErrorCode = lastError == null ? null : lastError.name();
        s.disconnectReasonCode = disconnectReason == null ? null : disconnectReason.name();
        s.diagnosticEventCount = diag.size();
        s.diagnosticDropped = diag.droppedCount();
        return s;
    }

    /** Sayaçları sıfırlar — AKTİF BAĞLANTIYI KESMEZ (GÖREV 14 kuralı). */
    public void resetCounters() {
        decoder.resetCounters();
        heartbeatsSent.set(0L);
        heartbeatsReceived.set(0L);
        bytesSent.set(0L);
        bytesReceived.set(0L);
        framesSent.set(0L);
        appMessagesReceived.set(0L);
        writeQueueRejections.set(0L);
        unknownTypeDropped.set(0L);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç yardımcılar
     * ════════════════════════════════════════════════════════════════════ */

    private static boolean isAlive(Thread t) { return t != null && t.isAlive(); }

    private void setState(State next) {
        if (state == next) return;
        state = next;
        listener.onStateChanged(next, generation);
    }

    private void failWith(LinkErrorCode code, String safeDetails) {
        lastError = code;
        setState(State.FAILED);
        listener.onError(code, safeDetails, generation);
    }

    private void failAndClose(LinkErrorCode code, String stage) {
        record(LinkDiagnosticEvent.Category.NEGOTIATION, stage, code,
            LinkDiagnosticEvent.Severity.ERROR, "el sikisma basarisiz");
        lastError = code;
        listener.onError(code, "el sikisma basarisiz", generation);
        closeFromWorker(code);
    }

    /** Worker'dan kapanış — durum FAILED/CLOSED ayrımını korur. */
    private void closeFromWorker(LinkErrorCode reason) {
        lastError = reason;
        close(reason);
    }

    private void record(LinkDiagnosticEvent.Category category, String stage,
                        LinkErrorCode code, LinkDiagnosticEvent.Severity severity,
                        String safeDetails) {
        diag.record(clock.nowMs(), cfg.side, category, stage, code, severity,
            generation, safeDetails);
    }

    private static void closeQuietly(java.io.Closeable c) {
        if (c == null) return;
        try { c.close(); } catch (IOException ignored) { /* kapanış sessizdir */ }
    }
}
