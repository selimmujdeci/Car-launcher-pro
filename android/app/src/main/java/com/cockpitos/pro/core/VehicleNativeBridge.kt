package com.cockpitos.pro.core

import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.DoubleBuffer

/**
 * CarOS Pro — Native-Core (Phase N1)
 *
 * Kotlin ↔ C++ (NDK) JNI köprüsünün giriş noktası.
 * `vehicle_core` paylaşılan kütüphanesini yükler ve native fonksiyonları açar.
 *
 * Bu fazda yalnızca [getNativeHeartbeat] iskeleti var — amaç JNI hattının
 * uçtan uca çalıştığını kanıtlamak. OBD/GPS/telemetri logic'i Phase N2+'da
 * native tarafa taşınacak (UnifiedVehicleStore Ring Buffer ile).
 *
 * Fail-soft: kütüphane yüklenemezse uygulama ÇÖKMEZ; [isAvailable] false döner
 * ve çağıranlar JS/JVM fallback'ine düşer (Automotive Grade — graceful fallback).
 */
object VehicleNativeBridge {

    private const val TAG = "VehicleNativeBridge"
    private const val LIB_NAME = "vehicle_core"

    /** Native kütüphane başarıyla yüklendi mi? Yüklenemezse fail-soft. */
    @Volatile
    var isAvailable: Boolean = false
        private set

    init {
        isAvailable = try {
            System.loadLibrary(LIB_NAME)
            Log.i(TAG, "Native-core '$LIB_NAME' yüklendi.")
            true
        } catch (t: UnsatisfiedLinkError) {
            Log.e(TAG, "Native-core '$LIB_NAME' YÜKLENEMEDİ — JVM fallback aktif.", t)
            false
        } catch (t: Throwable) {
            Log.e(TAG, "Native-core yüklenirken beklenmeyen hata — fallback aktif.", t)
            false
        }
    }

    /**
     * C++ tarafından dönen epoch milisaniye (heartbeat).
     * JNI hattının canlı olduğunu doğrular.
     *
     * @return native epoch-ms, kütüphane yoksa fallback olarak -1L.
     */
    fun heartbeat(): Long =
        if (isAvailable) {
            try {
                getNativeHeartbeat()
            } catch (t: UnsatisfiedLinkError) {
                Log.e(TAG, "getNativeHeartbeat çözülemedi.", t)
                -1L
            }
        } else {
            -1L
        }

    // ── Phase N2: Sinyal hattı (producer) ──────────────────────────

    /** Kanonik sinyal kimlikleri — native [SignalId] ile eş tutulmalı. */
    object Signal {
        const val SPEED = 1
        const val RPM = 2
        const val FUEL = 3
        const val ODOMETER = 4
    }

    /**
     * Üretici (CAN/OBD thread) → native lock-free SPSC buffer + Seqlock state.
     * Hot-path: bloklamaz, allocate etmez. Native yoksa fail-soft (no-op).
     *
     * @param id      [Signal] kimliği (kanonik değilse yalnızca kuyruğa eklenir)
     * @param value   ham sinyal değeri
     * @param tsNanos monotonik zaman damgası (varsayılan: System.nanoTime)
     * @return native buffer'a yazıldıysa true; dolu/drop ya da lib yoksa false
     */
    fun pushSignal(id: Int, value: Double, tsNanos: Long = System.nanoTime()): Boolean =
        if (isAvailable) {
            try {
                nativePushSignal(id, value, tsNanos)
            } catch (t: UnsatisfiedLinkError) {
                Log.e(TAG, "nativePushSignal çözülemedi.", t)
                false
            }
        } else {
            false
        }

    // ── Phase N3: Zero-copy snapshot (consumer) ────────────────────

    /** Snapshot double düzeni — native g_snapshotMem ile eş. */
    object Snapshot {
        const val SPEED = 0
        const val RPM = 1
        const val FUEL = 2
        const val ODOMETER = 3
        const val SEQ = 4
        const val SOURCE = 5   // Phase N5.2: aktif füzyon kaynağı (-1=none,0=HAL,1=CAN,2=OBD,3=GPS)
        const val SIZE = 6
    }

    // Native belleği saran DirectByteBuffer (bir kez map'lenir, cache'lenir).
    // Kopyalama yok: native ve JVM aynı belleğe bakar.
    @Volatile private var snapDoubles: DoubleBuffer? = null

    /**
     * Native snapshot buffer'ını bir kez map'ler (zero-copy). Tekrar çağrı no-op.
     * @return map başarılıysa true; native yoksa/başarısızsa false.
     */
    @Synchronized
    fun ensureSnapshotBuffer(): Boolean {
        if (!isAvailable) return false
        if (snapDoubles != null) return true
        return try {
            val bb: ByteBuffer = nativeCreateSnapshotBuffer() ?: return false
            // ARM little-endian; JVM ile aynı byte sırası şart.
            bb.order(ByteOrder.nativeOrder())
            snapDoubles = bb.asDoubleBuffer()
            Log.i(TAG, "Snapshot buffer map'lendi (zero-copy, ${Snapshot.SIZE} double).")
            true
        } catch (t: Throwable) {
            Log.e(TAG, "Snapshot buffer map edilemedi.", t)
            false
        }
    }

    /**
     * TUTARLI snapshot'ı tazeler (native seqlockLoad) ve [out]'a doldurur.
     * Hot-path: allocate etmez — [out] çağıran tarafından yeniden kullanılır.
     *
     * @param out boyutu >= [Snapshot.SIZE] olan, yeniden kullanılabilir dizi
     * @return başarılıysa true; native/buffer yoksa false (out'a dokunulmaz)
     */
    fun readSnapshotInto(out: DoubleArray): Boolean {
        if (out.size < Snapshot.SIZE) return false
        val db = snapDoubles ?: return false
        return try {
            nativeRefreshSnapshot()        // C++: seqlockLoad → paylaşılan belleğe yaz
            db.position(0)
            db.get(out, 0, Snapshot.SIZE)  // paylaşılan bellekten toplu okuma (kopya yok-allocate yok)
            true
        } catch (t: UnsatisfiedLinkError) {
            Log.e(TAG, "nativeRefreshSnapshot çözülemedi.", t)
            false
        }
    }

    // ── Phase N5.1: Odometre seed ──────────────────────────────────

    /**
     * Kayıtlı toplam km değerini native odometre birikticisine yükler (seed).
     * Hesaplama native'de yapılır; burada yalnızca değer iletilir.
     *
     * SÖZLEŞME: tek-yazıcı seqlock güvenliği için producer (CAN/OBD) akışı
     * BAŞLAMADAN, init sırasında çağrılmalı. Fail-soft: native yoksa no-op.
     *
     * @param km kalıcı depodan gelen toplam mesafe (km)
     * @return seed iletildiyse true; native yoksa/başarısızsa false
     */
    fun setOdometer(km: Double): Boolean =
        if (isAvailable) {
            try {
                nativeSetOdometer(km)
                true
            } catch (t: UnsatisfiedLinkError) {
                Log.e(TAG, "nativeSetOdometer çözülemedi.", t)
                false
            }
        } else {
            false
        }

    /** native-core.cpp içindeki JNI fonksiyonları. */
    private external fun getNativeHeartbeat(): Long
    private external fun nativePushSignal(id: Int, value: Double, tsNanos: Long): Boolean
    private external fun nativeCreateSnapshotBuffer(): ByteBuffer?
    private external fun nativeRefreshSnapshot()
    private external fun nativeSetOdometer(km: Double)
}
