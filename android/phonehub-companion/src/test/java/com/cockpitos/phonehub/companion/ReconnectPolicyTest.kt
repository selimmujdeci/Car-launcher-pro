package com.cockpitos.phonehub.companion

import com.cockpitos.phonehub.protocol.LinkErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ReconnectPolicyTest — yeniden bağlanma kararlarının kilitleri (GÖREV 5/20).
 *
 * Bu sınıf saf Kotlin'dir; Android çalışma zamanı ve gerçek Bluetooth
 * GEREKMEZ → kararlar deterministik olarak doğrulanır.
 */
class ReconnectPolicyTest {

    /* ── Geçici arızalar ──────────────────────────────────────────────── */

    @Test
    fun transientFailuresAllowReconnect() {
        val policy = ReconnectPolicy()
        assertTrue(policy.shouldReconnect(LinkErrorCode.SOCKET_CLOSED))
        assertTrue(policy.shouldReconnect(LinkErrorCode.CLIENT_CONNECT_TIMEOUT))
        assertTrue(policy.shouldReconnect(LinkErrorCode.HEARTBEAT_TIMEOUT))
        assertTrue(policy.shouldReconnect(LinkErrorCode.READ_FAILED))
    }

    /* ── Kalıcı kararlar ──────────────────────────────────────────────── */

    @Test
    fun permissionDenialNeverRetries() {
        val policy = ReconnectPolicy()
        assertFalse(policy.shouldReconnect(LinkErrorCode.BLUETOOTH_PERMISSION_DENIED))
        assertEquals(LinkErrorCode.BLUETOOTH_PERMISSION_DENIED, policy.terminalReason())
        /* Kalıcı karar SONRAKİ geçici hatayı da bloklamalı — aksi hâlde bir
         * sonraki kopmada sessizce yeniden denemeye başlardık. */
        assertFalse(policy.shouldReconnect(LinkErrorCode.SOCKET_CLOSED))
    }

    @Test
    fun protocolMismatchNeverRetries() {
        val policy = ReconnectPolicy()
        assertFalse(policy.shouldReconnect(LinkErrorCode.PROTOCOL_VERSION_MISMATCH))
        assertEquals(LinkErrorCode.PROTOCOL_VERSION_MISMATCH, policy.terminalReason())
    }

    @Test
    fun pairingRejectionNeverRetries() {
        val policy = ReconnectPolicy()
        assertFalse(policy.shouldReconnect(LinkErrorCode.PAIRING_REJECTED))
    }

    @Test
    fun trustMismatchNeverRetries() {
        val policy = ReconnectPolicy()
        assertFalse(policy.shouldReconnect(LinkErrorCode.TRUSTED_PEER_MISMATCH))
    }

    @Test
    fun nullReasonNeverRetries() {
        assertFalse(ReconnectPolicy().shouldReconnect(null))
    }

    /* ── Kullanıcı kararı ─────────────────────────────────────────────── */

    @Test
    fun userStopBlocksAllReconnects() {
        val policy = ReconnectPolicy()
        policy.stopByUser()
        assertTrue(policy.isStoppedByUser())
        assertFalse("kullanıcı kestiyse asla yeniden bağlanma",
            policy.shouldReconnect(LinkErrorCode.SOCKET_CLOSED))
    }

    @Test
    fun userRequestResetsPolicy() {
        val policy = ReconnectPolicy()
        policy.stopByUser()
        policy.resetForUserRequest()
        assertFalse(policy.isStoppedByUser())
        assertNull(policy.terminalReason())
        assertTrue(policy.shouldReconnect(LinkErrorCode.SOCKET_CLOSED))
    }

    /* ── Sınırlılık ───────────────────────────────────────────────────── */

    @Test
    fun attemptsAreBoundedAndThenExhausted() {
        val policy = ReconnectPolicy()
        repeat(ReconnectPolicy.DEFAULT_MAX_ATTEMPTS) {
            assertTrue(policy.shouldReconnect(LinkErrorCode.SOCKET_CLOSED))
            policy.recordAttempt()
        }
        assertTrue(policy.isExhausted())
        assertFalse("sonsuz deneme yasak",
            policy.shouldReconnect(LinkErrorCode.SOCKET_CLOSED))
        assertEquals(LinkErrorCode.RECONNECT_EXHAUSTED, policy.terminalReason())
    }

    @Test
    fun backoffLadderIsExponentialAndSaturates() {
        val policy = ReconnectPolicy()
        assertEquals(1_000L, policy.nextDelayMs())
        policy.recordAttempt()
        assertEquals(2_000L, policy.nextDelayMs())
        policy.recordAttempt()
        assertEquals(4_000L, policy.nextDelayMs())
        policy.recordAttempt()
        assertEquals(8_000L, policy.nextDelayMs())
        policy.recordAttempt()
        assertEquals("merdiven sonunda SON değer tekrarlanır, büyümez",
            8_000L, policy.nextDelayMs())
    }

    @Test
    fun successResetsAttemptCounter() {
        val policy = ReconnectPolicy()
        policy.recordAttempt()
        policy.recordAttempt()
        assertEquals(2, policy.attemptCount())
        policy.recordSuccess()
        assertEquals(0, policy.attemptCount())
        assertNull(policy.terminalReason())
    }

    /* ── Bluetooth kapalı: arıza DEĞİL ────────────────────────────────── */

    @Test
    fun bluetoothOffIsWaitingNotFailure() {
        val policy = ReconnectPolicy()
        assertTrue(policy.isWaitingForBluetooth(LinkErrorCode.BLUETOOTH_DISABLED))
        assertTrue(policy.isWaitingForBluetooth(LinkErrorCode.BLUETOOTH_UNAVAILABLE))
        assertFalse(policy.isWaitingForBluetooth(LinkErrorCode.SOCKET_CLOSED))
        assertEquals("bekleme deneme sayacını tüketmemeli", 0, policy.attemptCount())
    }
}
