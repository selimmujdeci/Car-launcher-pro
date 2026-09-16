package com.cockpitos.phonehub.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.cockpitos.phonehub.protocol.LinkErrorCode

/**
 * CompanionActivity — telefon uygulamasının TEK ekranı (GÖREV 2 + 13).
 *
 * ── NEDEN TEK ACTIVITY, DURUM SÜRÜCÜLÜ GÖRÜNÜM ──────────────────────────────
 * İstenen yedi "ekran" aslında tek bir akışın aşamalarıdır: hoş geldiniz →
 * izin → cihaz seç → eşleştirme → bağlantı → tanı. Bunları ayrı Activity'lere
 * bölmek, bağlantı durumu değiştiğinde hangi ekranın açık olduğunu yönetmeyi
 * gerektirir ve "izin ekranındayken bağlantı koptu" gibi tutarsızlıklar doğar.
 * Tek Activity + {@link CompanionUiState} sürücülü render, durumu TEK doğru
 * kaynaktan çizer.
 *
 * ── ACTIVITY BAĞLANTININ SAHİBİ DEĞİLDİR ────────────────────────────────────
 * Bağlantı {@link CompanionLinkController} ve ön plan servisine aittir.
 * Ekran döndüğünde ya da Activity yok edildiğinde bağlantı ETKİLENMEZ.
 *
 * ── GİZLİ İŞLEM YOK ─────────────────────────────────────────────────────────
 * Bu ekran tarama BAŞLATMAZ ve eşleştirme İSTEMEZ. Eşleştirme için kullanıcı
 * sistem Bluetooth ayarlarına yönlendirilir — kullanıcı onayı atlanmaz.
 */
class CompanionActivity : AppCompatActivity() {

    companion object {
        private const val REQUEST_CONNECT_PERMISSION = 101
        private const val REQUEST_NOTIFICATION_PERMISSION = 102
    }

    private lateinit var root: LinearLayout
    private lateinit var controller: CompanionLinkController

    private var permissionAskedOnce = false
    private var showDiagnostics = false

    /* F8.1 — hedef gönderme ekranının KENDİ giriş durumu. Controller/CompanionView
       BUNU TUTMAZ (yalnız gönderim/sonuç durumu tutar) — girdi salt bu ekrana aittir. */
    private var destLatText = ""
    private var destLngText = ""
    private var destLabelText = ""

    /* F9 — Mavi'ye Sor ekranının KENDİ giriş durumu (soru metni CompanionView'da TUTULMAZ). */
    private var assistantText = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = CompanionLinkController.get(this, appVersion())

        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0F14"))
            isFillViewport = true
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        scroll.addView(root)
        setContentView(scroll)
    }

    override fun onStart() {
        super.onStart()
        controller.setViewListener { view -> runOnUiThread { render(view) } }
        controller.refreshEnvironment()
    }

    override fun onStop() {
        /* Dinleyici bırakılır — Activity ölse bile controller yaşamaya devam
         * eder ve sızıntı olmaz (zero-leak kuralı). */
        controller.setViewListener(null)
        super.onStop()
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Render
     * ════════════════════════════════════════════════════════════════════ */

    private fun render(view: CompanionView) {
        root.removeAllViews()

        addTitle("CarOS Phone Hub")
        addStatusCard(view)

        when (view.state) {
            CompanionUiState.PERMISSION_REQUIRED -> renderPermission()
            CompanionUiState.PERMISSION_DENIED_PERMANENTLY -> renderPermissionDenied()
            CompanionUiState.BLUETOOTH_OFF -> renderBluetoothOff()
            CompanionUiState.NO_PAIRED_CAROS -> renderNoPairedDevice()
            CompanionUiState.SELECTING_DEVICE -> renderDeviceSelection()
            CompanionUiState.AWAITING_CONFIRMATION -> renderPairingConfirmation(view)
            else -> renderConnectionControls(view)
        }

        if (view.state.canDisconnect()) {
            addButton("Bağlantıyı Kes") {
                controller.disconnectByUser()
                CompanionLinkService.stop(this)
            }
        }

        addDivider()
        addButton(if (showDiagnostics) "Tanı Bilgilerini Gizle" else "Tanı Bilgileri") {
            showDiagnostics = !showDiagnostics
            render(controller.currentView())
        }
        if (showDiagnostics) renderDiagnostics(view)

        if (view.trustedPeerKnown) {
            addButton("Güvenilen CAROS'u Unut") {
                controller.forgetTrustedCarOs()
                CompanionLinkService.stop(this)
                toast("Güven kaydı silindi")
            }
        }
    }

    private fun addStatusCard(view: CompanionView) {
        addSectionLabel("DURUM")
        addText(view.state.label, size = 22f, bold = true,
            color = statusColor(view.state))
        addText(view.userMessage(), size = 14f, color = "#9AA7B4")

        if (view.state == CompanionUiState.RECONNECTING && view.reconnectAttempt > 0) {
            addText("Deneme ${view.reconnectAttempt} / ${ReconnectPolicy.DEFAULT_MAX_ATTEMPTS}",
                size = 13f, color = "#9AA7B4")
        }
        /* Teknik hata KODU kullanıcı ekranında da gösterilir çünkü bu bir
         * geliştirici/servis fazıdır (FAZ A) ve kod olmadan saha desteği
         * imkânsızdır. Ham exception metni ise ASLA gösterilmez. */
        view.errorCode?.let {
            addText("Hata kodu: ${it.name}", size = 12f, color = "#F2A0A0")
        }
        if (view.foregroundServiceRunning) {
            addText("Ön plan servisi: açık", size = 12f, color = "#7FB7A3")
        }
    }

    /* ── Aşama görünümleri ───────────────────────────────────────────── */

    private fun renderPermission() {
        addSectionLabel("İZİN")
        addText("CAROS'a bağlanmak için Bluetooth bağlantı izni gerekiyor. " +
            "Cihaz TARAMASI yapılmaz, yalnızca eşleştirilmiş cihazlara bağlanılır.",
            size = 14f, color = "#9AA7B4")
        addButton("İzin Ver") { requestConnectPermission() }
        addButton("Sistem Bluetooth Ayarlarını Aç") { openBluetoothSettings() }
    }

    private fun renderPermissionDenied() {
        addSectionLabel("İZİN REDDEDİLDİ")
        addText("İzin kalıcı olarak reddedildi. Uygulama ayarlarından " +
            "Bluetooth iznini açmanız gerekiyor.", size = 14f, color = "#9AA7B4")
        addButton("Uygulama Ayarlarını Aç") { openAppSettings() }
    }

    private fun renderBluetoothOff() {
        addSectionLabel("BLUETOOTH")
        /* Bluetooth'u PROGRAMATİK olarak açmak YASAK — kullanıcı kararı. */
        addText("Bluetooth kapalı. Uygulama Bluetooth'u kendiliğinden açmaz; " +
            "lütfen sistem ayarlarından açın.", size = 14f, color = "#9AA7B4")
        addButton("Sistem Bluetooth Ayarlarını Aç") { openBluetoothSettings() }
        addButton("Yeniden Denetle") { controller.refreshEnvironment() }
    }

    private fun renderNoPairedDevice() {
        addSectionLabel("EŞLEŞTİRME")
        addText("Eşleştirilmiş cihaz bulunamadı. CAROS ünitesini önce sistem " +
            "Bluetooth ayarlarından eşleştirin, sonra buraya dönün.",
            size = 14f, color = "#9AA7B4")
        addButton("Sistem Bluetooth Ayarlarını Aç") { openBluetoothSettings() }
        addButton("Yeniden Denetle") { controller.refreshEnvironment() }
    }

    private fun renderDeviceSelection() {
        addSectionLabel("CAROS CİHAZINI SEÇ")
        when (val result = controller.listDevices()) {
            is BondedDeviceRepository.Result.Failure -> {
                addText(result.code.userMessage(), size = 14f, color = "#F2A0A0")
                addButton("Yeniden Denetle") { controller.refreshEnvironment() }
            }
            is BondedDeviceRepository.Result.Success -> {
                if (result.devices.isEmpty()) {
                    addText("Eşleştirilmiş cihaz yok.", size = 14f, color = "#9AA7B4")
                } else {
                    /* Cihaz ADI gösterilir (kullanıcı ayırt edebilsin);
                     * MAC ADRESİ GÖSTERİLMEZ ve saklanmaz. */
                    result.devices.forEach { option ->
                        val suffix = if (option.likelyCarOs) "  ·  CAROS olabilir" else ""
                        addButton(option.displayName + suffix) {
                            controller.selectDevice(option)
                            startConnection()
                        }
                    }
                }
                addButton("Sistem Bluetooth Ayarlarını Aç") { openBluetoothSettings() }
            }
        }
    }

    private fun renderPairingConfirmation(view: CompanionView) {
        addSectionLabel("DOĞRULAMA KODU")
        addText("Aşağıdaki kodun CAROS ekranındaki kodla AYNI olduğunu " +
            "doğrulayın. Farklıysa reddedin.", size = 14f, color = "#9AA7B4")
        addText(view.pairingCode ?: "------", size = 40f, bold = true, color = "#E6EDF3")

        addButton("Kod Aynı — Onayla") {
            if (!controller.confirmPairing(true)) toast("Onay uygulanamadı")
        }
        addButton("Farklı — Reddet") { controller.confirmPairing(false) }
    }

    private fun renderConnectionControls(view: CompanionView) {
        if (view.state.canStartConnection()) {
            addSectionLabel("BAĞLANTI")
            controller.selectedDeviceName()?.let {
                addText("Seçili cihaz: $it", size = 14f, color = "#9AA7B4")
            }
            addButton("Bağlan") { startConnection() }
            addButton("Başka Cihaz Seç") { controller.refreshEnvironment() }
        }
        if (view.state == CompanionUiState.CONNECTED
            || view.state == CompanionUiState.WEAK_CONNECTION) {
            addSectionLabel("OTURUM")
            addKeyValue("Protokol sürümü",
                if (view.protocolVersion > 0) view.protocolVersion.toString() else "BİLİNMİYOR")
            addKeyValue("Verilen yetenek", view.grantedCapabilityCount.toString())
            addKeyValue("Eş kimliği", view.peerFingerprintShort ?: "BİLİNMİYOR")
            addText("Bağlantı kurulmuş olması medya, çağrı veya bildirim " +
                "yetkisi verildiği anlamına GELMEZ.", size = 12f, color = "#9AA7B4")
        }
        if (view.state == CompanionUiState.CONNECTED) {
            renderDestinationPush(view)
            renderAssistantBridge(view)
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * F8.1 — CarOS'a Hedef Gönder
     *
     * ── SAHTE BAŞARI YOK (§9) ────────────────────────────────────────────
     * "Gönderildi" YALNIZ `sendDestinationPush` gerçekten byte yazdıysa
     * gösterilir. Ardından gelen ASIL sonuç (`view.lastDestinationStatus`)
     * CarOS'un şifreli ACK'inden gelir — bu ekran "Navigasyon başladı" gibi
     * bir iddiayı KENDİSİ ÜRETMEZ, yalnız CarOS'un söylediğini YANSITIR.
     * ════════════════════════════════════════════════════════════════════ */

    private fun renderDestinationPush(view: CompanionView) {
        addDivider()
        addSectionLabel("CAROS'A HEDEF GÖNDER")

        addLabeledInput("Enlem (ör. 41.0082)", destLatText) { destLatText = it }
        addLabeledInput("Boylam (ör. 28.9784)", destLngText) { destLngText = it }
        addLabeledInput("Hedef adı (opsiyonel)", destLabelText) { destLabelText = it }

        val lat = destLatText.trim().replace(',', '.').toDoubleOrNull()
        val lng = destLngText.trim().replace(',', '.').toDoubleOrNull()
        val validCoords = lat != null && lat >= -90.0 && lat <= 90.0
            && lng != null && lng >= -180.0 && lng <= 180.0
        if (destLatText.isNotEmpty() && (lat == null || lat < -90.0 || lat > 90.0)) {
            addText("Enlem -90..90 arasında bir sayı olmalı.", size = 12f, color = "#F2A0A0")
        }
        if (destLngText.isNotEmpty() && (lng == null || lng < -180.0 || lng > 180.0)) {
            addText("Boylam -180..180 arasında bir sayı olmalı.", size = 12f, color = "#F2A0A0")
        }

        val sendButton = Button(this).apply {
            text = if (view.destinationSending) "Gönderiliyor…" else "CarOS'a Gönder"
            isAllCaps = false
            textSize = 15f
            isEnabled = validCoords && !view.destinationSending
            alpha = if (isEnabled) 1f else 0.5f
            setTextColor(Color.parseColor("#0B0F14"))
            setBackgroundColor(Color.parseColor("#5CC8FF"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
            setOnClickListener {
                val la = lat ?: return@setOnClickListener
                val lo = lng ?: return@setOnClickListener
                when (controller.sendDestinationPush(la, lo, destLabelText)) {
                    CompanionLinkController.DestinationPushResult.SENT -> { /* view zaten güncellendi */ }
                    CompanionLinkController.DestinationPushResult.NOT_CONNECTED ->
                        toast("Bağlantı yok — gönderilemedi")
                    CompanionLinkController.DestinationPushResult.INVALID_INPUT ->
                        toast("Geçersiz koordinat")
                    CompanionLinkController.DestinationPushResult.TRANSPORT_FAILURE ->
                        toast("Gönderim başarısız — bağlantı kopmuş olabilir")
                }
            }
        }
        root.addView(sendButton)

        destinationStatusLabel(view)?.let { (text, color) ->
            addText(text, size = 13f, color = color)
        }
    }

    /** CarOS'un ACK durumunu KULLANICI DİLİNE çevirir — ham kod ekrana ASLA basılmaz. */
    private fun destinationStatusLabel(view: CompanionView): Pair<String, String>? {
        if (view.destinationSending) return "Gönderildi, CarOS'un yanıtı bekleniyor…" to "#9AA7B4"
        return when (view.lastDestinationStatus) {
            null -> null
            "PENDING_USER_APPROVAL" -> "Araçta onay bekleniyor…" to "#F2C572"
            "ACCEPTED" -> "Sürücü kabul etti — hedef araca iletildi." to "#7FB7A3"
            "REJECTED_BY_USER" -> "Sürücü reddetti." to "#F2A0A0"
            "EXPIRED" -> "Onay süresi doldu." to "#F2A0A0"
            "REJECTED_STALE_SESSION" -> "Bağlantı bu arada değişti — tekrar gönderin." to "#F2A0A0"
            "REJECTED_UNAUTHORIZED" -> "Bu cihaz için hedef gönderme yetkisi yok." to "#F2A0A0"
            "INVALID_DESTINATION" -> "Hedef araç tarafından geçersiz sayıldı." to "#F2A0A0"
            "NAVIGATION_UNAVAILABLE" -> "Araçta navigasyon şu an kullanılamıyor." to "#F2A0A0"
            "DUPLICATE" -> "Bu hedef az önce zaten gönderilmiş." to "#9AA7B4"
            else -> "Durum: ${view.lastDestinationStatus}" to "#9AA7B4"
        }
    }

    /** Basit tek satır etiket + giriş alanı — yazılan değer Activity alanında KALICI tutulur. */
    private fun addLabeledInput(hint: String, current: String, onChanged: (String) -> Unit) {
        addText(hint, size = 12f, color = "#7A8A9A")
        root.addView(android.widget.EditText(this).apply {
            setText(current)
            setTextColor(Color.parseColor("#E6EDF3"))
            setHintTextColor(Color.parseColor("#4A5A6A"))
            setBackgroundColor(Color.parseColor("#131B24"))
            setPadding(dp(12), dp(8), dp(12), dp(8))
            textSize = 15f
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(2); bottomMargin = dp(8) }
            addTextChangedListener(object : android.text.TextWatcher {
                override fun afterTextChanged(s: android.text.Editable?) { onChanged(s?.toString() ?: "") }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
        })
    }

    /* ══════════════════════════════════════════════════════════════════════
     * F9 — Mavi'ye Sor
     *
     * ── METİN TABANLI, SES YOK (§16) ────────────────────────────────────
     * Bu ekran mikrofonu AÇMAZ, TTS OYNATMAZ — yalnız metin girer/okur.
     * ── SAHTE CEVAP YOK ───────────────────────────────────────────────────
     * `lastAssistantResponse` YALNIZ CarOS'un `ACCEPTED` ACK'inde gönderdiği
     * `result.text`tir — bu ekran KENDİ cevabını ÜRETMEZ/TAHMİN ETMEZ.
     * ════════════════════════════════════════════════════════════════════ */

    private fun renderAssistantBridge(view: CompanionView) {
        addDivider()
        addSectionLabel("MAVİ'YE SOR")
        addText("Yalnız bilgi/sohbet soruları — araç kontrolü veya ayar " +
            "değişikliği bu yoldan YAPILAMAZ.", size = 11f, color = "#7A8A9A")

        addLabeledInput("Sorunuz (ör. hava durumu nasıl?)", assistantText) { assistantText = it }

        val trimmed = assistantText.trim()
        val sendButton = Button(this).apply {
            text = if (view.assistantSending) "Bekleniyor…" else "Mavi'ye Gönder"
            isAllCaps = false
            textSize = 15f
            isEnabled = trimmed.isNotEmpty() && !view.assistantSending
            alpha = if (isEnabled) 1f else 0.5f
            setTextColor(Color.parseColor("#0B0F14"))
            setBackgroundColor(Color.parseColor("#5CC8FF"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
            setOnClickListener {
                when (controller.sendAssistantBridgeRequest(trimmed)) {
                    CompanionLinkController.AssistantBridgeSendResult.SENT -> { /* view zaten güncellendi */ }
                    CompanionLinkController.AssistantBridgeSendResult.NOT_CONNECTED ->
                        toast("Bağlantı yok — gönderilemedi")
                    CompanionLinkController.AssistantBridgeSendResult.INVALID_INPUT ->
                        toast("Boş soru gönderilemez")
                    CompanionLinkController.AssistantBridgeSendResult.TRANSPORT_FAILURE ->
                        toast("Gönderim başarısız — bağlantı kopmuş olabilir")
                }
            }
        }
        root.addView(sendButton)

        assistantStatusLabel(view)?.let { (text, color) ->
            addText(text, size = 13f, color = color)
        }
        view.lastAssistantResponse?.let { response ->
            root.addView(TextView(this).apply {
                text = response
                textSize = 14f
                setTextColor(Color.parseColor("#E6EDF3"))
                setPadding(dp(10), dp(10), dp(10), dp(10))
                setBackgroundColor(Color.parseColor("#131B24"))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(8) }
            })
        }
    }

    /** CarOS'un ACK durumunu KULLANICI DİLİNE çevirir — ham kod ekrana ASLA basılmaz. */
    private fun assistantStatusLabel(view: CompanionView): Pair<String, String>? {
        if (view.assistantSending) return "Mavi düşünüyor…" to "#9AA7B4"
        return when (view.lastAssistantStatus) {
            null -> null
            "ACCEPTED" -> null // cevap metni zaten ayrı kutuda gösteriliyor
            "ACTION_NOT_PERMITTED" -> "Bu bir eylem isteğiydi — telefon üzerinden yalnız bilgi/sohbet desteklenir." to "#F2A0A0"
            "NO_ANSWER" -> "Mavi bir cevap üretemedi." to "#F2A0A0"
            "TIMED_OUT" -> "Yanıt zaman aşımına uğradı." to "#F2A0A0"
            "REJECTED_STALE_SESSION" -> "Bağlantı bu arada değişti — tekrar gönderin." to "#F2A0A0"
            "REJECTED_UNAUTHORIZED" -> "Bu cihaz için Mavi'ye soru gönderme yetkisi yok." to "#F2A0A0"
            "FAILED" -> "Bir hata oluştu." to "#F2A0A0"
            else -> "Durum: ${view.lastAssistantStatus}" to "#9AA7B4"
        }
    }

    private fun renderDiagnostics(view: CompanionView) {
        addSectionLabel("TANI")
        val snapshot = controller.sessionSnapshot()
        if (snapshot == null) {
            addText("Aktif oturum yok.", size = 13f, color = "#9AA7B4")
        } else {
            addKeyValue("Oturum durumu", snapshot.state)
            addKeyValue("El sıkışma aşaması", snapshot.handshakeStage)
            addKeyValue("Şifreleme etkin", if (snapshot.encryptionActive) "EVET" else "HAYIR")
            addKeyValue("Çerçeve gön/al", "${snapshot.framesSent}/${snapshot.framesReceived}")
            addKeyValue("Kalp atışı gön/al",
                "${snapshot.heartbeatsSent}/${snapshot.heartbeatsReceived}")
            addKeyValue("Sağlama hatası", snapshot.checksumFailures.toString())
            addKeyValue("Şifre çözme hatası", snapshot.decryptFailures.toString())
            addKeyValue("Tekrar reddi", snapshot.replayRejections.toString())
            addKeyValue("Anlaşma süresi",
                if (snapshot.negotiationDurationMs >= 0)
                    "${snapshot.negotiationDurationMs} ms" else "BİLİNMİYOR")
        }
        addKeyValue("Yeniden bağlanma denemesi", controller.reconnectAttemptCount().toString())
        addKeyValue("Tanı olayı", controller.diagnostics.size().toString())

        /* Ham log dışa aktarımı VARSAYILAN OLARAK KAPALI — yalnız PII'siz özet. */
        addButton("PII'siz Özeti Paylaş") { shareSummary() }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Eylemler
     * ════════════════════════════════════════════════════════════════════ */

    private fun startConnection() {
        if (!hasConnectPermission()) {
            requestConnectPermission()
            return
        }
        requestNotificationPermissionIfNeeded()
        /* Servis YALNIZ kullanıcı bağlantı akışını başlattığında açılır. */
        CompanionLinkService.start(this)
        controller.connect()
    }

    private fun shareSummary() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, controller.diagnosticSummary())
        }
        startActivity(Intent.createChooser(intent, "Tanı özetini paylaş"))
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İzinler
     * ════════════════════════════════════════════════════════════════════ */

    private fun hasConnectPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun requestConnectPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        permissionAskedOnce = true
        requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT),
            REQUEST_CONNECT_PERMISSION)
    }

    /**
     * Bildirim izni Android 13+ içindir ve YALNIZ ön plan servisi bildirimi
     * görünsün diye istenir. Reddedilirse bağlantı yine kurulur — fail-soft.
     */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED) return
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            REQUEST_NOTIFICATION_PERMISSION)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CONNECT_PERMISSION) return

        val granted = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (granted) {
            controller.refreshEnvironment()
            return
        }
        /* Kalıcı red ile geçici redi AYIRT ET: kalıcıysa kullanıcıyı ayarlara
         * yönlendirmek gerekir, yoksa "İzin Ver" düğmesi hiçbir şey yapmaz
         * ve kullanıcı kilitlenir. */
        val permanentlyDenied = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            permissionAskedOnce &&
            !shouldShowRequestPermissionRationale(Manifest.permission.BLUETOOTH_CONNECT)
        render(controller.currentView().copy(
            state = if (permanentlyDenied)
                CompanionUiState.PERMISSION_DENIED_PERMANENTLY
            else CompanionUiState.PERMISSION_REQUIRED,
            errorCode = LinkErrorCode.BLUETOOTH_PERMISSION_DENIED))
    }

    private fun openBluetoothSettings() {
        try {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        } catch (e: Exception) {
            toast("Bluetooth ayarları açılamadı")
        }
    }

    private fun openAppSettings() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", packageName, null)))
        } catch (e: Exception) {
            toast("Ayarlar açılamadı")
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Görünüm yardımcıları
     * ════════════════════════════════════════════════════════════════════ */

    private fun statusColor(state: CompanionUiState): String = when (state) {
        CompanionUiState.CONNECTED -> "#7FD1AE"
        CompanionUiState.WEAK_CONNECTION, CompanionUiState.RECONNECTING -> "#E6C07B"
        CompanionUiState.ERROR, CompanionUiState.PERMISSION_DENIED_PERMANENTLY -> "#F2A0A0"
        else -> "#E6EDF3"
    }

    private fun addTitle(text: String) {
        addText(text, size = 16f, bold = true, color = "#5CC8FF")
        addSpace(8)
    }

    private fun addSectionLabel(text: String) {
        addSpace(18)
        addText(text, size = 11f, bold = true, color = "#5F7288")
        addSpace(4)
    }

    private fun addText(text: String, size: Float, bold: Boolean = false,
                        color: String = "#E6EDF3") {
        root.addView(TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(Color.parseColor(color))
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(2), 0, dp(2))
        })
    }

    private fun addKeyValue(key: String, value: String) {
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(3), 0, dp(3))
            addView(TextView(this@CompanionActivity).apply {
                text = key
                textSize = 13f
                setTextColor(Color.parseColor("#9AA7B4"))
                layoutParams = LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            })
            addView(TextView(this@CompanionActivity).apply {
                text = value
                textSize = 13f
                gravity = Gravity.END
                setTextColor(Color.parseColor("#E6EDF3"))
                layoutParams = LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            })
        })
    }

    private fun addButton(label: String, onClick: () -> Unit) {
        root.addView(Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 15f
            setTextColor(Color.parseColor("#0B0F14"))
            setBackgroundColor(Color.parseColor("#5CC8FF"))
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(10)
            }
        })
    }

    private fun addDivider() {
        addSpace(16)
        root.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#1E2833"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1))
        })
    }

    private fun addSpace(heightDp: Int) {
        root.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(heightDp))
        })
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun appVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }
}
