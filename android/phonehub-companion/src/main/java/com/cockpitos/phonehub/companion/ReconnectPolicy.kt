package com.cockpitos.phonehub.companion

import com.cockpitos.phonehub.protocol.LinkErrorCode

/**
 * ReconnectPolicy — yeniden bağlanma kararının TEK yeri (GÖREV 5).
 *
 * ── NEDEN AYRI VE SAF BİR SINIF ─────────────────────────────────────────────
 * Yeniden bağlanma mantığı, bağlantı kodunun içine serpiştirildiğinde test
 * edilemez hâle gelir ve sahada "neden hâlâ deniyor?" sorusuna kimse cevap
 * veremez. Burada saf, zamansız (zaman ENJEKTE edilir) ve tamamen test
 * edilebilir bir karar makinesi vardır.
 *
 * ── SONSUZ DENEME YASAK ─────────────────────────────────────────────────────
 * Deneme sayısı SINIRLIDIR ve gecikme katlanarak artar. Sonsuz döngü telefonun
 * pilini bitirir, Bluetooth yığınını yorar ve kullanıcıya hiçbir şey anlatmaz.
 * Tükendiğinde {@link LinkErrorCode#RECONNECT_EXHAUSTED} ile durulur ve karar
 * KULLANICIYA bırakılır.
 *
 * ── KULLANICI KARARI GERİ ALINMAZ ───────────────────────────────────────────
 * Kullanıcı bilinçli olarak "Bağlantıyı Kes" dediyse yeniden bağlanma YOKTUR.
 * Aynı şekilde izin reddi, protokol uyuşmazlığı, eşleştirme reddi ve güven
 * uyuşmazlığı KALICI kararlardır — bunları tekrar denemek, kullanıcının
 * verdiği cevabı yok saymaktır.
 */
class ReconnectPolicy(
    private val maxAttempts: Int = DEFAULT_MAX_ATTEMPTS,
    private val backoffLadderMs: LongArray = DEFAULT_BACKOFF_MS,
) {

    companion object {
        const val DEFAULT_MAX_ATTEMPTS = 4
        val DEFAULT_BACKOFF_MS = longArrayOf(1_000L, 2_000L, 4_000L, 8_000L)
    }

    private var attempt = 0
    private var userInitiatedStop = false
    private var terminalReason: LinkErrorCode? = null

    /** Kaçıncı denemedeyiz (0 = hiç denenmedi). */
    fun attemptCount(): Int = attempt

    fun isExhausted(): Boolean = attempt >= maxAttempts

    fun terminalReason(): LinkErrorCode? = terminalReason

    /** Kullanıcı bilinçli olarak durdurdu mu. */
    fun isStoppedByUser(): Boolean = userInitiatedStop

    /**
     * Sıradaki denemeye kadar beklenecek süre.
     * Merdivenin sonuna gelinirse SON değer tekrarlanır (sınırsız büyümez).
     */
    fun nextDelayMs(): Long {
        if (backoffLadderMs.isEmpty()) return 1_000L
        val index = if (attempt < backoffLadderMs.size) attempt else backoffLadderMs.size - 1
        return backoffLadderMs[index]
    }

    /**
     * Bu hatadan sonra yeniden bağlanılmalı mı.
     *
     * Fail-closed: karar veremediğimiz her durumda CEVAP HAYIR'dır.
     */
    fun shouldReconnect(reason: LinkErrorCode?): Boolean {
        if (userInitiatedStop) return false
        if (terminalReason != null) return false
        if (reason == null) return false

        if (!reason.isReconnectable) {
            /* Kalıcı karar: bir daha denenmez ve nedeni SAKLANIR ki kullanıcıya
             * "neden durdu" sorusunun cevabı verilebilsin. */
            terminalReason = reason
            return false
        }
        if (isExhausted()) {
            terminalReason = LinkErrorCode.RECONNECT_EXHAUSTED
            return false
        }
        return true
    }

    /** Bir deneme başlatıldığını kaydeder. */
    fun recordAttempt() {
        attempt++
    }

    /** Bağlantı KURULDU — sayaç sıfırlanır, sonraki kopma sıfırdan başlar. */
    fun recordSuccess() {
        attempt = 0
        terminalReason = null
    }

    /** Kullanıcı "Bağlantıyı Kes" dedi — kalıcı olarak durulur. */
    fun stopByUser() {
        userInitiatedStop = true
        terminalReason = null
    }

    /** Kullanıcı yeniden "Bağlan" dedi — politika sıfırlanır. */
    fun resetForUserRequest() {
        attempt = 0
        userInitiatedStop = false
        terminalReason = null
    }

    /**
     * Bluetooth kapalıysa BEKLEME durumuna geçilir: bu bir arıza değildir ve
     * deneme sayacını TÜKETMEZ. Kullanıcı Bluetooth'u açtığında sıfırdan
     * başlanabilmelidir.
     */
    fun isWaitingForBluetooth(reason: LinkErrorCode?): Boolean =
        reason == LinkErrorCode.BLUETOOTH_DISABLED
            || reason == LinkErrorCode.BLUETOOTH_UNAVAILABLE
}
