package com.cockpitos.phonehub.companion

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import com.cockpitos.phonehub.protocol.LinkDiagnosticBuffer
import com.cockpitos.phonehub.protocol.LinkDiagnosticEvent
import com.cockpitos.phonehub.protocol.LinkErrorCode
import com.cockpitos.phonehub.protocol.LinkSession
import com.cockpitos.phonehub.protocol.PhoneHubUuid
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * RfcommClientTransport — telefon tarafı RFCOMM bağlantısı (GÖREV 5).
 *
 * ── ZAMAN AŞIMI NEDEN ELLE UYGULANIYOR ──────────────────────────────────────
 * {@code BluetoothSocket.connect()} zaman aşımı parametresi ALMAZ ve bazı
 * cihazlarda dakikalarca bloklanabilir. Tek yol, ayrı bir iş parçacığından
 * soketi KAPATARAK çağrıyı serbest bırakmaktır. Aksi hâlde kullanıcı
 * "Bağlanıyor" ekranında sonsuza kadar bekler ve iptal düğmesi işe yaramaz.
 *
 * ── DISCOVERY'YE DOKUNULMUYOR ───────────────────────────────────────────────
 * Android belgeleri bağlanmadan önce {@code cancelDiscovery()} önerir; biz
 * BİLİNÇLİ olarak çağırmıyoruz. Gerekçe: bu çağrı adapter GENELİNDEDİR ve
 * kullanıcının o an tarama yapan BAŞKA bir uygulamasını sessizce bozar. Biz
 * tarama başlatmadığımız için kendi taramamızı iptal etmemiz de gerekmez.
 *
 * ── KENDİLİĞİNDEN BAĞLANMA YOK ──────────────────────────────────────────────
 * Bu sınıf yalnız {@link connect} çağrıldığında bağlanır. Yeniden bağlanma
 * kararı {@link ReconnectPolicy}'nin, çağırma kararı kullanıcınındır.
 */
class RfcommClientTransport(
    private val diagnostics: LinkDiagnosticBuffer,
    private val clock: LinkSession.MonotonicClock = LinkSession.SYSTEM_CLOCK,
) {

    companion object {
        /** Bağlanma tavanı — aşılırsa soket kapatılarak çağrı serbest bırakılır. */
        const val CONNECT_TIMEOUT_MS = 15_000L
    }

    sealed class Result {
        data class Success(val socket: BluetoothSocket) : Result()
        data class Failure(val code: LinkErrorCode) : Result()
    }

    private val socketRef = AtomicReference<BluetoothSocket?>(null)
    private val cancelled = AtomicBoolean(false)
    private val connecting = AtomicBoolean(false)

    @Volatile
    private var connectStartedAtMs: Long = -1L

    fun connectStartedAtMs(): Long = connectStartedAtMs
    fun isConnecting(): Boolean = connecting.get()

    /**
     * Seçilmiş, EŞLEŞTİRİLMİŞ cihaza bağlanır.
     *
     * Bloklayıcıdır — çağıran bir worker iş parçacığından çağırmalıdır.
     * ASLA throw etmez; her sonuç kodlanmış hata olarak döner.
     */
    fun connect(device: BluetoothDevice?, timeoutMs: Long = CONNECT_TIMEOUT_MS): Result {
        if (device == null) return fail(LinkErrorCode.DEVICE_NOT_SELECTED, "cihaz secilmedi")
        if (!connecting.compareAndSet(false, true)) {
            return fail(LinkErrorCode.CLIENT_CONNECT_FAILED, "zaten baglaniyor")
        }
        cancelled.set(false)
        connectStartedAtMs = clock.nowMs()

        val socket: BluetoothSocket = try {
            /* GÜVENLİ varyant: sistem eşleştirmesi (bond) ŞARTTIR.
             * Insecure varyant kullanıcı onayını atlardı — yasak. */
            device.createRfcommSocketToServiceRecord(PhoneHubUuid.serviceUuid())
        } catch (e: IOException) {
            connecting.set(false)
            return fail(LinkErrorCode.CLIENT_CONNECT_FAILED, "soket olusturulamadi")
        } catch (e: SecurityException) {
            connecting.set(false)
            return fail(LinkErrorCode.BLUETOOTH_PERMISSION_DENIED, "izin yok")
        }

        socketRef.set(socket)

        /* Zaman aşımı bekçisi: süre dolarsa soketi kapatır ve bloklanan
         * connect() çağrısı IOException ile döner. */
        val watchdog = Thread({
            try {
                Thread.sleep(timeoutMs)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return@Thread
            }
            if (connecting.get()) {
                record(LinkDiagnosticEvent.Category.SOCKET, "connect-timeout",
                    LinkErrorCode.CLIENT_CONNECT_TIMEOUT,
                    LinkDiagnosticEvent.Severity.WARN, "baglanti zaman asimi")
                closeQuietly(socketRef.get())
            }
        }, "phonehub-connect-watchdog")
        watchdog.isDaemon = true
        watchdog.start()

        return try {
            socket.connect()
            watchdog.interrupt()
            connecting.set(false)
            if (cancelled.get()) {
                closeQuietly(socket)
                socketRef.set(null)
                fail(LinkErrorCode.SOCKET_CLOSED, "kullanici iptal etti")
            } else {
                record(LinkDiagnosticEvent.Category.SOCKET, "connect", null,
                    LinkDiagnosticEvent.Severity.INFO, "baglanti kuruldu")
                Result.Success(socket)
            }
        } catch (e: IOException) {
            watchdog.interrupt()
            connecting.set(false)
            closeQuietly(socket)
            socketRef.set(null)
            /* Zaman aşımı bekçisi kapattıysa neden TIMEOUT'tur; kullanıcı
             * iptal ettiyse SOCKET_CLOSED. İkisini karıştırmak, sahada
             * "neden bağlanamıyor" sorusunu cevapsız bırakırdı. */
            when {
                cancelled.get() -> fail(LinkErrorCode.SOCKET_CLOSED, "kullanici iptal etti")
                clock.nowMs() - connectStartedAtMs >= timeoutMs ->
                    fail(LinkErrorCode.CLIENT_CONNECT_TIMEOUT, "zaman asimi")
                else -> fail(LinkErrorCode.CLIENT_CONNECT_FAILED, "baglanti kurulamadi")
            }
        } catch (e: SecurityException) {
            watchdog.interrupt()
            connecting.set(false)
            closeQuietly(socket)
            socketRef.set(null)
            fail(LinkErrorCode.BLUETOOTH_PERMISSION_DENIED, "izin reddedildi")
        }
    }

    /** Devam eden bağlanmayı iptal eder ve soketi bırakır. İdempotenttir. */
    fun cancel() {
        cancelled.set(true)
        closeQuietly(socketRef.getAndSet(null))
        connecting.set(false)
    }

    private fun fail(code: LinkErrorCode, details: String): Result.Failure {
        record(LinkDiagnosticEvent.Category.SOCKET, "connect", code,
            LinkDiagnosticEvent.Severity.ERROR, details)
        return Result.Failure(code)
    }

    private fun record(
        category: LinkDiagnosticEvent.Category,
        stage: String,
        code: LinkErrorCode?,
        severity: LinkDiagnosticEvent.Severity,
        details: String,
    ) {
        diagnostics.record(clock.nowMs(), LinkDiagnosticEvent.Side.PHONE,
            category, stage, code, severity, 0L, details)
    }

    private fun closeQuietly(socket: BluetoothSocket?) {
        try {
            socket?.close()
        } catch (e: IOException) {
            /* Kapanış sessizdir — kapanırken oluşan hata bilgi taşımaz. */
        }
    }
}
