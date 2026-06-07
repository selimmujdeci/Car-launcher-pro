// ══════════════════════════════════════════════════════════════════
// CarOS Pro — Native-Core (Phase N2)
// VehicleState.hpp — Seqlock korumalı, cache-line hizalı araç durumu.
//
// Mimari sözleşme (CLAUDE.md — SAB & Hardware Safety):
//   • Seqlock: GEN sayacı tek=yazım sürüyor, çift=tutarlı.
//   • Tüm yazımlar fetch_add (acq_rel) ile mühürlenir → çekirdekler arası
//     tam bellek bariyeri (ARM zayıf bellek modeli güvenliği).
//   • Her bağımsız 64-bit sinyal ayrı cache-line'da (alignas 64) → False Sharing yok.
//   • Zero-allocation: tüm tipler POD, dinamik bellek yok.
// ══════════════════════════════════════════════════════════════════
#pragma once

#include <atomic>
#include <cstdint>
#include <cstddef>

namespace caros {

// ARM Cortex-A ve modern x86 için L1 cache-line: 64 byte.
inline constexpr std::size_t kCacheLine = 64;

// ── Speed Fusion kaynakları (Phase N5.2) ───────────────────────────
// Hız kaynakları, güven (confidence) skoru azalan hiyerarşide.
enum SpeedSource : int32_t {
    SRC_NONE  = -1,
    SRC_HAL   = 0,   // donanım soyutlama katmanı (en güvenilir)
    SRC_CAN   = 1,   // araç CAN bus
    SRC_OBD   = 2,   // ELM327 OBD-II
    SRC_GPS   = 3,   // GPS türevi hız (en az güvenilir)
    SRC_COUNT = 4,
};

// Başlangıç (taze) güven skorları — kaynak hiyerarşisi.
inline constexpr double kSourceConfidence[SRC_COUNT] = {
    0.98, // HAL
    0.92, // CAN
    0.85, // OBD
    0.70, // GPS
};

// Tazelik zaman aşımı: bir kaynak 1000 ms güncellenmezse güven skoru 0 sayılır.
inline constexpr int64_t kFreshnessTimeoutNanos = 1000LL * 1000000LL;

// Zero-jitter: kaynak değişiminde hız sıçramasını yumuşatan lerp katsayısı (0..1).
// 1.0 = anında geçiş (smoothing yok); küçülttükçe geçiş yumuşar. Tunable iskelet.
inline constexpr double kFusionLerpAlpha = 0.5;

// Kaynak başına son hız örneği (tek üretici tarafından yazılır).
struct SpeedSourceState {
    double  value       = 0.0;   // son hız (km/h)
    int64_t lastTsNanos = 0;     // son güncelleme (monotonik ns)
    bool    seen        = false; // hiç veri geldi mi?
};

// Linear interpolation (zero-jitter geçiş iskeleti).
inline double lerp(double a, double b, double t) noexcept {
    return a + (b - a) * t;
}

// Tutarlı okuma için tüketiciye dönen anlık görüntü (POD, allocate etmez).
struct VehicleSnapshot {
    double  speed;     // km/h (füzyon sonucu)
    double  rpm;       // rev/min
    double  fuel;      // %
    double  odometer;  // km
    uint32_t seq;      // okunduğu andaki tutarlı (çift) sequence
    int32_t source;    // aktif füzyon kaynağı (SpeedSource); taze kaynak yoksa SRC_NONE
};

// Seqlock-korumalı son araç durumu. Tek yazıcı (CAN/OBD producer thread),
// çok okuyucu (JNI drain / JS). alignas(64) ile her sinyal kendi cache-line'ında.
struct alignas(kCacheLine) VehicleState {
    // Seqlock sequence sayacı. fetch_add ile tam fence.
    std::atomic<uint32_t> seq{0};

    // Payload — non-atomic; tutarlılığı seqlock mühürlüyor.
    // Her biri 64-byte sınırında başlar → producer/consumer false sharing yok.
    alignas(kCacheLine) double speed    = 0.0;
    alignas(kCacheLine) double rpm      = 0.0;
    alignas(kCacheLine) double fuel     = 0.0;
    alignas(kCacheLine) double odometer = 0.0;
    // Aktif füzyon kaynağı (Phase N5.2). SRC_NONE = -1.
    alignas(kCacheLine) int32_t nativeSource = SRC_NONE;
};

// ── Yazıcı (Producer / Seqlock store) ──────────────────────────────
// Tek üretici varsayımı. Dört kanonik sinyali atomik-tutarlı yazar.
inline void seqlockStore(VehicleState& s,
                         double speed, double rpm,
                         double fuel,  double odometer,
                         int32_t source) noexcept {
    // 1) Sayaç tek'e: "yazım başladı". acq_rel → tam fence.
    s.seq.fetch_add(1, std::memory_order_acq_rel);
    // 2) Veri yazımları, sayaç artışından sonra görünür olsun.
    std::atomic_thread_fence(std::memory_order_release);
    s.speed        = speed;
    s.rpm          = rpm;
    s.fuel         = fuel;
    s.odometer     = odometer;
    s.nativeSource = source;
    // 3) Veri yazımları, sayaç çift'e dönmeden tamamlansın.
    std::atomic_thread_fence(std::memory_order_release);
    // 4) Sayaç çift'e: "tutarlı".
    s.seq.fetch_add(1, std::memory_order_acq_rel);
}

// ── Okuyucu (Consumer / Seqlock load, double-check guard) ──────────
// Yırtık okuma (torn read) tespit edilirse döngü tekrar dener.
inline VehicleSnapshot seqlockLoad(const VehicleState& s) noexcept {
    VehicleSnapshot out{};
    uint32_t s1, s2;
    do {
        s1 = s.seq.load(std::memory_order_acquire);
        if (s1 & 1u) {            // yazım sürüyor → yeniden dene
            continue;
        }
        out.speed    = s.speed;
        out.rpm      = s.rpm;
        out.fuel     = s.fuel;
        out.odometer = s.odometer;
        out.source   = s.nativeSource;
        // Veri okumaları, ikinci sayaç okumasından önce bitsin.
        std::atomic_thread_fence(std::memory_order_acquire);
        s2 = s.seq.load(std::memory_order_acquire);
    } while (s1 != s2);           // GEN1 == GEN2 → tutarlı
    out.seq = s2;
    return out;
}

// ── Odometre entegratörü (Phase N5.1) ──────────────────────────────
// Hız (km/h) örneklerini monotonik zaman damgasıyla (ns) integre ederek
// kümülatif mesafe (km) üretir. Tüm birikim double (64-bit) — float
// hassasiyet kaybı otomotivde kabul edilemez.
//
// Veri Bütünlüğü (CLAUDE.md — Clock Jump Protection): mutlak sistem saatine
// güvenilmez; yalnızca monotonik delta (dt = ts_now - ts_prev) kullanılır.
// Tek üretici (producer thread) erişimi varsayılır.
struct OdometerAccumulator {
    double  km          = 0.0;   // kümülatif mesafe (km), yüksek hassasiyet
    int64_t lastTsNanos = 0;     // son hız örneğinin monotonik zaman damgası
    bool    primed      = false; // ilk örnek alındı mı?

    // Park/uyku sonrası sahte birikimi engellemek için maksimum boşluk: 5 sn.
    static constexpr int64_t kMaxGapNanos = 5LL * 1000000000LL;
    static constexpr double  kNanosToSec  = 1e-9;
    static constexpr double  kKmhToKmPerS = 1.0 / 3600.0;

    // Hız (km/h) + monotonik ns zaman damgası → mesafe entegrasyonu.
    // İlk örnekte yalnızca zaman damgasını referans alır (delta yok).
    void integrate(double speedKmh, int64_t tsNanos) noexcept {
        if (!primed) {                       // ilk örnek: referans zamanı kur
            lastTsNanos = tsNanos;
            primed = true;
            return;
        }
        const int64_t dtNanos = tsNanos - lastTsNanos;
        lastTsNanos = tsNanos;
        if (dtNanos <= 0) return;            // saat geri/sabit → atla (clock-jump koruması)
        if (dtNanos > kMaxGapNanos) return;  // büyük boşluk (uyku) → birikim yok
        const double dtSeconds     = static_cast<double>(dtNanos) * kNanosToSec; // ns → s
        const double speedKmPerSec = speedKmh * kKmhToKmPerS;                    // km/h → km/s
        km += speedKmPerSec * dtSeconds;     // double birikim (Δs = v·Δt)
    }

    // Kayıtlı odometreyi yükler (seed). Sonraki ilk örnek delta üretmesin diye
    // referans zamanı sıfırlanır (primed=false).
    void seed(double valueKm) noexcept {
        km = valueKm;
        primed = false;
    }
};

} // namespace caros
