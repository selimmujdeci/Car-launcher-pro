// ══════════════════════════════════════════════════════════════════
// CarOS Pro — Native-Core (Phase N2)
// SignalBuffer.hpp — Lock-free SPSC (Single-Producer Single-Consumer) ring buffer.
//
// Mimari sözleşme:
//   • Kilit YOK (std::mutex/lock_guard kullanılmaz). Sadece std::atomic.
//   • ARM (Mali-400 / ARMv7) zayıf bellek sıralaması için acquire/release.
//   • head ve tail ayrı cache-line'larda → producer/consumer false sharing yok.
//   • Zero-allocation: kapasite derleme-zamanı sabit, slotlar yerinde (in-place).
//   • Dolu/boş tespiti maskeleme ile (kapasite 2'nin kuvveti olmalı).
// ══════════════════════════════════════════════════════════════════
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>

#include "VehicleState.hpp"   // caros::kCacheLine

namespace caros {

// Tek ham sinyal örneği. POD, sabit boyut → kopyası ucuz, allocate etmez.
struct Signal {
    uint32_t id;       // sinyal kimliği (PID / CAN ID)
    uint32_t flags;    // kaynak / biçim bayrakları
    double   value;    // ham değer
    int64_t  tsNanos;  // monotonik zaman damgası
};

// Lock-free SPSC ring buffer.
//   Producer: push()  — CAN/OBD thread (tek üretici).
//   Consumer: pop()   — JNI drain   (tek tüketici).
// CapacityPow2 mutlaka 2'nin kuvveti olmalı (index maskeleme için).
template <std::size_t CapacityPow2>
class SignalBuffer {
    static_assert(CapacityPow2 >= 2, "Capacity en az 2 olmali");
    static_assert((CapacityPow2 & (CapacityPow2 - 1)) == 0,
                  "Capacity 2'nin kuvveti olmali");

public:
    SignalBuffer() noexcept : head_(0), tail_(0) {}

    SignalBuffer(const SignalBuffer&)            = delete;
    SignalBuffer& operator=(const SignalBuffer&) = delete;

    // ── Producer ───────────────────────────────────────────────────
    // Buffer doluysa false döner (drop). Bloklamaz, allocate etmez.
    bool push(const Signal& in) noexcept {
        const std::size_t head = head_.load(std::memory_order_relaxed);
        const std::size_t next = (head + 1) & kMask;
        // Consumer'ın tail'ini acquire ile gör: dolu mu?
        if (next == tail_.load(std::memory_order_acquire)) {
            return false; // dolu
        }
        slots_[head] = in;                              // veri yazımı
        head_.store(next, std::memory_order_release);   // tüketiciye yayınla
        return true;
    }

    // ── Consumer ───────────────────────────────────────────────────
    // Boşsa false döner.
    bool pop(Signal& out) noexcept {
        const std::size_t tail = tail_.load(std::memory_order_relaxed);
        // Producer'ın head'ini acquire ile gör: boş mu?
        if (tail == head_.load(std::memory_order_acquire)) {
            return false; // boş
        }
        out = slots_[tail];                                       // veri okuması
        tail_.store((tail + 1) & kMask, std::memory_order_release); // slotu serbest bırak
        return true;
    }

    // Yaklaşık dolu eleman sayısı (gözlem amaçlı, tam senkron değil).
    std::size_t size() const noexcept {
        const std::size_t h = head_.load(std::memory_order_acquire);
        const std::size_t t = tail_.load(std::memory_order_acquire);
        return (h - t) & kMask;
    }

    static constexpr std::size_t capacity() noexcept { return CapacityPow2 - 1; }

private:
    static constexpr std::size_t kMask = CapacityPow2 - 1;

    // head ve tail ayrı cache-line'larda → false sharing yok.
    alignas(kCacheLine) std::atomic<std::size_t> head_;
    alignas(kCacheLine) std::atomic<std::size_t> tail_;
    alignas(kCacheLine) Signal slots_[CapacityPow2];
};

} // namespace caros
