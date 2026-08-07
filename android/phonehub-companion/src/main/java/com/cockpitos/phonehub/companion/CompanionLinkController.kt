package com.cockpitos.phonehub.companion

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import com.cockpitos.phonehub.protocol.LinkDiagnosticBuffer
import com.cockpitos.phonehub.protocol.LinkDiagnosticEvent
import com.cockpitos.phonehub.protocol.LinkErrorCode
import com.cockpitos.phonehub.protocol.LinkSession
import com.cockpitos.phonehub.protocol.LinkSessionSnapshot
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * CompanionLinkController — telefon tarafının TEK sahibi (GÖREV 5 + 13).
 *
 * ── SAHİPLİK ────────────────────────────────────────────────────────────────
 * Bağlanma iş parçacığı, aktif oturum, yeniden bağlanma politikası, güven
 * kaydı ve kimlik anahtarı BURADAN yönetilir. Activity yalnız GÖRÜNTÜLER;
 * Service yalnız süreci ayakta TUTAR. İkisi de bağlantı sahibi değildir —
 * ekran döndüğünde ya da Activity öldüğünde bağlantı etkilenmez.
 *
 * ── TEK VE SINIRLI İŞ PARÇACIĞI ─────────────────────────────────────────────
 * Bağlanma denemeleri TEK bir single-thread executor üzerinde sıraya girer.
 * Havuz sınırsız değildir; art arda basılan "Bağlan" düğmesi paralel soket
 * açmaz, sıraya girer.
 *
 * ── SÜREÇ ÖLÜP DİRİLİRSE ────────────────────────────────────────────────────
 * Geri yüklenen hiçbir durum "bağlı" SAYILMAZ. Süreç yeniden başladığında
 * oturum yoktur; kontrollü bir yeniden bağlanma DENENEBİLİR ama bu, bağlı
 * olduğumuz anlamına gelmez (P1-PREP'in `demoteRestoredSession` dersi).
 */
class CompanionLinkController private constructor(
    private val appContext: Context,
    private val appVersion: String,
) : LinkSession.Listener {

    companion object {
        /** Telefonun beyan ettiği yetenekler. Verilecek olan yalnız HEALTH'tir. */
        private val LOCAL_CAPABILITIES = listOf("HEALTH")

        @Volatile private var instance: CompanionLinkController? = null

        fun get(context: Context, appVersion: String): CompanionLinkController =
            instance ?: synchronized(this) {
                instance ?: CompanionLinkController(
                    context.applicationContext, appVersion).also { instance = it }
            }
    }

    /** Görünüm değişince Activity'yi uyandıran geri çağrı. */
    fun interface ViewListener {
        fun onViewChanged(view: CompanionView)
    }

    val diagnostics = LinkDiagnosticBuffer()
    private val signer = CompanionIdentitySigner()
    private val trustStore = CompanionTrustStore(appContext)
    private val transport = RfcommClientTransport(diagnostics)
    private val reconnectPolicy = ReconnectPolicy()
    private val bondedRepository = BondedDeviceRepository(appContext)

    private val connectExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "phonehub-companion-connect").apply { isDaemon = true }
    }

    private val session = AtomicReference<LinkSession?>(null)
    private val generationSource = AtomicLong(0L)
    private val disposed = AtomicBoolean(false)

    @Volatile private var selectedDevice: BluetoothDevice? = null
    @Volatile private var selectedDeviceName: String? = null
    @Volatile private var viewListener: ViewListener? = null
    @Volatile private var foregroundServiceRunning = false

    @Volatile private var view: CompanionView =
        CompanionView(state = CompanionUiState.DISCONNECTED)

    /* ══════════════════════════════════════════════════════════════════════
     * Görünüm
     * ════════════════════════════════════════════════════════════════════ */

    fun currentView(): CompanionView = view

    fun setViewListener(listener: ViewListener?) {
        viewListener = listener
        listener?.onViewChanged(view)
    }

    fun setForegroundServiceRunning(running: Boolean) {
        foregroundServiceRunning = running
        publish(view.copy(foregroundServiceRunning = running))
    }

    /**
     * Bağlantı öncesi ortam durumu. HER çağrıda yeniden ölçülür — kullanıcı
     * Bluetooth'u kapatıp açabilir, izni ayarlardan değiştirebilir.
     */
    fun refreshEnvironment() {
        val adapter = BluetoothAdapter.getDefaultAdapter()
        val next = when {
            adapter == null -> CompanionUiState.ERROR
            !bondedRepository.hasConnectPermission() -> CompanionUiState.PERMISSION_REQUIRED
            !adapter.isEnabled -> CompanionUiState.BLUETOOTH_OFF
            else -> {
                when (val result = bondedRepository.listBondedDevices()) {
                    is BondedDeviceRepository.Result.Success ->
                        if (result.devices.isEmpty()) CompanionUiState.NO_PAIRED_CAROS
                        else CompanionUiState.SELECTING_DEVICE
                    is BondedDeviceRepository.Result.Failure -> CompanionUiState.ERROR
                }
            }
        }
        /* Aktif bir oturum varken ortam yenilemesi durumu EZMEZ. */
        if (session.get() != null) return
        publish(view.copy(
            state = next,
            errorCode = if (next == CompanionUiState.ERROR)
                LinkErrorCode.BLUETOOTH_UNAVAILABLE else null,
            trustedPeerKnown = trustStore.hasTrustedPeer(),
        ))
    }

    fun listDevices(): BondedDeviceRepository.Result = bondedRepository.listBondedDevices()

    /* ══════════════════════════════════════════════════════════════════════
     * Bağlanma
     * ════════════════════════════════════════════════════════════════════ */

    /** Kullanıcı cihazı seçti — yalnız BELLEKTE tutulur, MAC saklanmaz. */
    fun selectDevice(option: BondedDeviceRepository.DeviceOption) {
        selectedDevice = option.device
        selectedDeviceName = option.displayName
        trustStore.rememberSelectedDevice(option.localFingerprint)
        publish(view.copy(state = CompanionUiState.SELECTING_DEVICE, errorCode = null))
    }

    /** Kullanıcı "Bağlan" dedi. */
    fun connect() {
        if (disposed.get()) return
        val device = selectedDevice
        if (device == null) {
            publish(view.copy(
                state = CompanionUiState.SELECTING_DEVICE,
                errorCode = LinkErrorCode.DEVICE_NOT_SELECTED))
            return
        }
        reconnectPolicy.resetForUserRequest()
        submitConnect(device)
    }

    /** Kullanıcı "Bağlantıyı Kes" dedi — yeniden bağlanma YOK. */
    fun disconnectByUser() {
        reconnectPolicy.stopByUser()
        transport.cancel()
        session.getAndSet(null)?.close(LinkErrorCode.SOCKET_CLOSED)
        publish(view.copy(
            state = CompanionUiState.DISCONNECTED,
            pairingCode = null,
            errorCode = null,
            reconnectAttempt = 0))
    }

    /** Kullanıcı kodu onayladı/reddetti. */
    fun confirmPairing(accepted: Boolean): Boolean {
        val s = session.get() ?: return false
        val ok = s.confirmPairing(accepted)
        if (!accepted) {
            /* Kullanıcı reddi KALICI karardır — yeniden denenmez. */
            reconnectPolicy.stopByUser()
            publish(view.copy(
                state = CompanionUiState.DISCONNECTED,
                pairingCode = null,
                errorCode = LinkErrorCode.PAIRING_REJECTED))
        }
        return ok
    }

    /** "Güvenilen CAROS'u unut" — kayıt ve kimlik sıfırlanır. */
    fun forgetTrustedCarOs() {
        disconnectByUser()
        trustStore.forget()
        signer.deleteIdentity()
        publish(view.copy(trustedPeerKnown = false))
    }

    private fun submitConnect(device: BluetoothDevice) {
        publish(view.copy(
            state = CompanionUiState.CONNECTING,
            errorCode = null,
            reconnectAttempt = reconnectPolicy.attemptCount()))

        connectExecutor.execute {
            if (disposed.get()) return@execute
            reconnectPolicy.recordAttempt()

            when (val result = transport.connect(device)) {
                is RfcommClientTransport.Result.Failure -> handleFailure(result.code)
                is RfcommClientTransport.Result.Success -> {
                    val generation = generationSource.incrementAndGet()
                    val cfg = LinkSession.Config().apply {
                        serverSide = false
                        signer = this@CompanionLinkController.signer
                        capabilities = LOCAL_CAPABILITIES
                        appVersion = this@CompanionLinkController.appVersion
                        trustedPeerFingerprint = trustStore.trustedPeerFingerprint()
                        diagnostics = this@CompanionLinkController.diagnostics
                        side = LinkDiagnosticEvent.Side.PHONE
                        listener = this@CompanionLinkController
                    }
                    val newSession = LinkSession(cfg, generation)
                    session.getAndSet(newSession)?.close(LinkErrorCode.SOCKET_CLOSED)

                    try {
                        val socket = result.socket
                        if (!newSession.start(socket.inputStream, socket.outputStream)) {
                            handleFailure(LinkErrorCode.SOCKET_CLOSED)
                        }
                    } catch (e: java.io.IOException) {
                        handleFailure(LinkErrorCode.SOCKET_CLOSED)
                    }
                }
            }
        }
    }

    /**
     * Arıza sonrası karar. Politika "hayır" derse yeniden BAĞLANILMAZ ve
     * kullanıcıya nedeni gösterilir — sessizce durup "Bağlantı kesildi" demek
     * kullanıcıyı bilgisiz bırakırdı.
     */
    private fun handleFailure(code: LinkErrorCode) {
        if (disposed.get()) return

        if (reconnectPolicy.isWaitingForBluetooth(code)) {
            publish(view.copy(state = CompanionUiState.BLUETOOTH_OFF, errorCode = code))
            return
        }
        if (!reconnectPolicy.shouldReconnect(code)) {
            val terminal = reconnectPolicy.terminalReason() ?: code
            publish(view.copy(
                state = if (reconnectPolicy.isStoppedByUser())
                    CompanionUiState.DISCONNECTED else CompanionUiState.ERROR,
                errorCode = terminal,
                pairingCode = null))
            return
        }

        val delay = reconnectPolicy.nextDelayMs()
        publish(view.copy(
            state = CompanionUiState.RECONNECTING,
            errorCode = code,
            reconnectAttempt = reconnectPolicy.attemptCount()))

        val device = selectedDevice ?: return
        connectExecutor.execute {
            try {
                Thread.sleep(delay)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return@execute
            }
            if (!disposed.get() && !reconnectPolicy.isStoppedByUser()) {
                submitConnect(device)
            }
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * LinkSession.Listener
     * ════════════════════════════════════════════════════════════════════ */

    override fun onStateChanged(state: LinkSession.State, generation: Long) {
        if (generation != generationSource.get()) return   // bayat nesil
        val ui = when (state) {
            LinkSession.State.HANDSHAKING -> CompanionUiState.AUTHENTICATING
            LinkSession.State.AWAITING_USER_CONFIRM -> CompanionUiState.AWAITING_CONFIRMATION
            LinkSession.State.CONNECTED -> CompanionUiState.CONNECTED
            LinkSession.State.DEGRADED -> CompanionUiState.WEAK_CONNECTION
            LinkSession.State.CLOSING, LinkSession.State.CLOSED -> CompanionUiState.DISCONNECTED
            LinkSession.State.FAILED -> CompanionUiState.ERROR
            LinkSession.State.IDLE -> view.state
        }
        publish(view.copy(state = ui))

        if (state == LinkSession.State.CLOSED || state == LinkSession.State.FAILED) {
            val closed = session.getAndSet(null)
            val reason = closed?.disconnectReason()
            if (reason != null && !reconnectPolicy.isStoppedByUser()) handleFailure(reason)
        }
    }

    override fun onApplicationMessage(payload: ByteArray?, generation: Long) {
        /* P1-A'da uygulama mesajı YÜRÜTÜLMEZ; yetenek otoritesi belirlenmedi. */
    }

    override fun onPairingCodeReady(code: String?, expiresAtMs: Long, generation: Long) {
        if (generation != generationSource.get()) return
        publish(view.copy(
            state = CompanionUiState.AWAITING_CONFIRMATION,
            pairingCode = code,
            pairingExpiresAtMs = expiresAtMs))
    }

    override fun onEstablished(grantedCapabilities: MutableList<String>?, generation: Long) {
        if (generation != generationSource.get()) return
        reconnectPolicy.recordSuccess()

        val s = session.get()
        val handshake = s?.handshake()
        val fingerprint = handshake?.peerFingerprint()
        val protocol = handshake?.negotiatedProtocolVersion() ?: -1

        /* Güven kaydı YALNIZ burada — şifreli oturum gerçekten kurulduğunda. */
        if (fingerprint != null) {
            trustStore.trustPeer(fingerprint, protocol, System.currentTimeMillis())
        }

        publish(view.copy(
            state = CompanionUiState.CONNECTED,
            pairingCode = null,
            errorCode = null,
            grantedCapabilityCount = grantedCapabilities?.size ?: 0,
            protocolVersion = protocol,
            peerFingerprintShort = fingerprint?.take(8),
            trustedPeerKnown = true,
            reconnectAttempt = 0))
    }

    override fun onError(code: LinkErrorCode?, safeDetails: String?, generation: Long) {
        if (code == null) return
        publish(view.copy(errorCode = code))
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Tanı
     * ════════════════════════════════════════════════════════════════════ */

    fun sessionSnapshot(): LinkSessionSnapshot? = session.get()?.snapshot()

    /**
     * Paylaşılabilir tanı özeti — PII'SİZ. Doğrulama kodu, MAC, cihaz adı ve
     * anahtar BURADA YOKTUR. Ham log dışa aktarımı VARSAYILAN OLARAK KAPALIDIR
     * (GÖREV 13): yalnız sayaç ve kod özeti verilir.
     */
    fun diagnosticSummary(): String {
        val s = sessionSnapshot()
        val sb = StringBuilder()
        sb.append("CarOS Phone Hub — tanı özeti\n")
        sb.append("uygulama sürümü: ").append(appVersion).append('\n')
        sb.append("durum: ").append(view.state.name).append('\n')
        sb.append("hata kodu: ").append(view.errorCode?.name ?: "-").append('\n')
        sb.append("güvenilen CAROS: ").append(if (trustStore.hasTrustedPeer()) "var" else "yok")
            .append('\n')
        sb.append("protokol: ").append(if (s == null) "-" else s.protocolVersion).append('\n')
        sb.append("yetenek sayısı: ").append(view.grantedCapabilityCount).append('\n')
        sb.append("yeniden bağlanma denemesi: ").append(reconnectPolicy.attemptCount()).append('\n')
        sb.append("ön plan servisi: ").append(if (foregroundServiceRunning) "açık" else "kapalı")
            .append('\n')
        sb.append("kimlik donanım destekli: ").append(signer.isHardwareBacked).append('\n')
        if (s != null) {
            sb.append("çerçeve gönderilen/alınan: ").append(s.framesSent).append('/')
                .append(s.framesReceived).append('\n')
            sb.append("kalp atışı gönderilen/alınan: ").append(s.heartbeatsSent).append('/')
                .append(s.heartbeatsReceived).append('\n')
            sb.append("sağlama hatası: ").append(s.checksumFailures).append('\n')
            sb.append("şifre çözme hatası: ").append(s.decryptFailures).append('\n')
            sb.append("tekrar reddi: ").append(s.replayRejections).append('\n')
            sb.append("şifreleme etkin: ").append(s.encryptionActive).append('\n')
        }
        sb.append("tanı olayı: ").append(diagnostics.size())
            .append(" (düşen ").append(diagnostics.droppedCount()).append(")\n")
        return sb.toString()
    }

    fun reconnectAttemptCount(): Int = reconnectPolicy.attemptCount()
    fun isTrustedPeerKnown(): Boolean = trustStore.hasTrustedPeer()
    fun selectedDeviceName(): String? = selectedDeviceName

    /** Süreç kapanırken tüm kaynağı bırakır. */
    fun dispose() {
        if (!disposed.compareAndSet(false, true)) return
        transport.cancel()
        session.getAndSet(null)?.close(LinkErrorCode.TRANSPORT_DISPOSED)
        connectExecutor.shutdownNow()
    }

    private fun publish(next: CompanionView) {
        val withService = next.copy(foregroundServiceRunning = foregroundServiceRunning)
        view = withService
        viewListener?.onViewChanged(withService)
    }
}
