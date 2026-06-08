// ══════════════════════════════════════════════════════════════════
// CarOS Pro — Native-Core (Phase N2)
// native-core.cpp — JNI köprüsü + global sinyal hattı.
//
// İçerik:
//   • getNativeHeartbeat → JNI hattının canlı olduğunu JS'e doğrulatır.
//   • pushSignal → producer (CAN/OBD) ham sinyali lock-free SPSC buffer'a
//     yazar VE kanonik 4 sinyali Seqlock-korumalı VehicleState'e yansıtır.
//
// Henüz OBD/GPS logic'i native'e taşınmadı (yalnızca altyapı + köprü).
// VehicleCompute.worker.ts'e dokunulmadı.
//
// JNI sembolleri Kotlin sınıfıyla birebir eşleşmeli:
//   paket : com.cockpitos.pro.core | sınıf : VehicleNativeBridge
// ══════════════════════════════════════════════════════════════════
#include <jni.h>
#include <chrono>
#include <android/log.h>

#include "VehicleState.hpp"

#define LOG_TAG "VehicleCore"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {

// ── Global sinyal hattı (module-level, zero runtime allocation) ────
// Tek üretici (CAN/OBD thread) → tek tüketici (JNI drain) varsayımı.
caros::VehicleState        g_state;            // Seqlock son durum

// Producer-side mirror: seqlock tüm 4 alanı birlikte yazdığı için, tek bir
// sinyal güncellenince diğerlerinin son değeri burada tutulur (scratch, allocate yok).
struct ProducerMirror {
    double  speed        = 0.0;
    double  rpm          = 0.0;
    double  fuel         = 0.0;
    double  odometer     = 0.0;
    int32_t nativeSource = caros::SRC_NONE; // Phase N5.2: aktif füzyon kaynağı
};
ProducerMirror g_mirror;

// Kümülatif odometre entegratörü (Phase N5.1). Füzyon hızıyla beslenir.
caros::OdometerAccumulator g_odo;

// Kaynak başına son hız örneği (Phase N5.2 — Speed Fusion).
caros::SpeedSourceState g_speedSources[caros::SRC_COUNT];

// Kanonik sinyal kimlikleri (Kotlin tarafıyla eş).
enum SignalId : int32_t {
    SIG_SPEED    = 1,   // genel/legacy hız (CAN kaynağı varsayılır)
    SIG_RPM      = 2,
    SIG_FUEL     = 3,
    SIG_ODOMETER = 4,
    // Phase N5.2 — kaynağa özel hız sinyalleri (Speed Fusion).
    SIG_SPEED_HAL = 10,
    SIG_SPEED_CAN = 11,
    SIG_SPEED_OBD = 12,
    SIG_SPEED_GPS = 13,
};

// Sinyal ID → füzyon kaynağı eşlemesi. Hız değilse SRC_NONE.
inline int32_t speedSourceOf(int32_t id) noexcept {
    switch (id) {
        case SIG_SPEED:     return caros::SRC_CAN; // legacy alias → CAN
        case SIG_SPEED_HAL: return caros::SRC_HAL;
        case SIG_SPEED_CAN: return caros::SRC_CAN;
        case SIG_SPEED_OBD: return caros::SRC_OBD;
        case SIG_SPEED_GPS: return caros::SRC_GPS;
        default:            return caros::SRC_NONE;
    }
}

// ── Zero-copy snapshot belleği (Phase N3) ──────────────────────────
// Native'in sahip olduğu sabit bellek; DirectByteBuffer ile Java'ya AÇILIR
// (kopyalanmaz). Yalnızca tek tüketici (stream thread) yazar/okur.
// Düzen (double): [0]=speed [1]=rpm [2]=fuel [3]=odometer [4]=seq [5]=nativeSource
constexpr int kSnapDoubles = 6;
alignas(caros::kCacheLine) double g_snapshotMem[kSnapDoubles] = {0.0, 0.0, 0.0, 0.0, 0.0, -1.0};

// ── Speed Fusion çekirdeği (Phase N5.2) ────────────────────────────
// Bir hız kaynağı güncellendiğinde çağrılır. Tüm kaynakların tazelik+güven
// skorunu değerlendirir, en yüksek güvenli taze kaynağı seçer, füzyon hızını
// ve aktif kaynağı g_mirror'a yazar; odometreyi füzyon hızıyla integre eder.
//
// NOT (tek-yazıcı sözleşmesi): g_speedSources ve g_mirror, üretici thread(ler)i
// tarafından yazılır. Mevcut tasarım tek üretici varsayar (CLAUDE.md SAB/Seqlock).
inline void fuseSpeed(int32_t src, double speedKmh, int64_t nowNanos) noexcept {
    // 1) İlgili kaynağın son örneğini güncelle.
    g_speedSources[src].value       = speedKmh;
    g_speedSources[src].lastTsNanos = nowNanos;
    g_speedSources[src].seen        = true;

    // 2) En yüksek güvenli TAZE kaynağı seç (freshness timeout filtresi).
    double  bestConf = 0.0;
    int32_t bestSrc  = caros::SRC_NONE;
    double  bestVal  = g_mirror.speed;
    for (int i = 0; i < caros::SRC_COUNT; ++i) {
        if (!g_speedSources[i].seen) continue;
        const int64_t age = nowNanos - g_speedSources[i].lastTsNanos;
        if (age < 0 || age > caros::kFreshnessTimeoutNanos) continue; // bayat → güven 0
        const double conf = caros::kSourceConfidence[i];
        if (conf > bestConf) {
            bestConf = conf;
            bestSrc  = i;
            bestVal  = g_speedSources[i].value;
        }
    }

    // 3) Füzyon hızını belirle (zero-jitter geçiş iskeleti).
    double fusedSpeed;
    if (bestSrc == caros::SRC_NONE) {
        fusedSpeed = g_mirror.speed;            // taze kaynak yok → mevcut hızı koru (fail-soft)
    } else if (g_mirror.nativeSource != caros::SRC_NONE && bestSrc != g_mirror.nativeSource) {
        // Kaynak değişti → ani sıçramayı yumuşat (lerp iskeleti).
        fusedSpeed = caros::lerp(g_mirror.speed, bestVal, caros::kFusionLerpAlpha);
    } else {
        fusedSpeed = bestVal;                   // aynı kaynak → doğrudan değer
    }

    g_mirror.nativeSource = bestSrc;
    g_mirror.speed        = fusedSpeed;

    // 4) Odometre füzyon hızıyla integre edilir (Δs = v·Δt).
    g_odo.integrate(fusedSpeed, nowNanos);
    g_mirror.odometer = g_odo.km;
}

} // namespace

extern "C" {

// ── Heartbeat (Phase N1) ───────────────────────────────────────────
JNIEXPORT jlong JNICALL
Java_com_cockpitos_pro_core_VehicleNativeBridge_getNativeHeartbeat(
        JNIEnv* /* env */, jobject /* thiz */) {
    using namespace std::chrono;
    const jlong now = static_cast<jlong>(
            duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
    return now;
}

// ── pushSignal (Phase N2) ───────────────────────────────────────────
// Producer girişi: ham sinyali işler + kanonik state'i Seqlock ile mühürler.
// Hot-path: kilit yok, allocate yok.
// (#9: ham sinyali tutan SPSC ring buffer KALDIRILDI — push ediliyor ama hiçbir
//  tüketici pop etmiyordu; tek veri yolu aşağıdaki Seqlock state.)
JNIEXPORT jboolean JNICALL
Java_com_cockpitos_pro_core_VehicleNativeBridge_nativePushSignal(
        JNIEnv* /* env */, jobject /* thiz */,
        jint id, jdouble value, jlong tsNanos) {

    const double dv = static_cast<double>(value);

    // 2) Sinyali işle ve Seqlock state'i yaz.
    //    Hız kaynağıysa → Speed Fusion (füzyon + odometre entegrasyonu burada).
    const int32_t spdSrc = speedSourceOf(id);
    if (spdSrc != caros::SRC_NONE) {
        fuseSpeed(spdSrc, dv, static_cast<int64_t>(tsNanos));
    } else {
        switch (id) {
            case SIG_RPM:      g_mirror.rpm      = dv; break;
            case SIG_FUEL:     g_mirror.fuel     = dv; break;
            case SIG_ODOMETER: g_mirror.odometer = dv; break;
            default: break; // kanonik olmayan sinyaller sadece kuyrukta kalır
        }
    }
    caros::seqlockStore(g_state,
                        g_mirror.speed, g_mirror.rpm,
                        g_mirror.fuel,  g_mirror.odometer,
                        g_mirror.nativeSource);

    // ── Düşük-maliyetli doğrulama logu (Phase N4 closure) ──────────────
    // Spam'i önlemek için yalnızca hız DEĞİŞTİĞİNDE ya da her 100 sinyalde bir yaz.
    // Tek üretici varsayımı → function-local static yeterli (kilit yok).
    static uint64_t s_pushCount = 0;
    static double   s_lastSpeed = -1.0;
    ++s_pushCount;
    const bool isSpeed      = (spdSrc != caros::SRC_NONE);
    const bool speedChanged = (isSpeed && dv != s_lastSpeed);
    if (isSpeed) s_lastSpeed = dv;
    if (speedChanged || (s_pushCount % 100u == 0u)) {
        LOGI("[NativeCore] Push: ID=%d, Val=%.2f, Count=%llu",
             static_cast<int>(id), dv, static_cast<unsigned long long>(s_pushCount));
    }

    // Buffer kaldırıldı (#9 — ölü SPSC kuyruğu); Boolean imza/sözleşme korunsun
    // diye sabit TRUE (çağıranlar dönüş değerini zaten kullanmıyor).
    return JNI_TRUE;
}

// ── Odometre seed (Phase N5.1) ──────────────────────────────────────
// JS/başlangıç tarafından kayıtlı odometre değerini native birikticiye yükler.
// SÖZLEŞME: tek-yazıcı seqlock güvenliği için, producer (CAN/OBD) akışı
// BAŞLAMADAN, init sırasında çağrılmalıdır (eşzamanlı seqlock yazımı olmasın).
JNIEXPORT void JNICALL
Java_com_cockpitos_pro_core_VehicleNativeBridge_nativeSetOdometer(
        JNIEnv* /* env */, jobject /* thiz */, jdouble value) {
    const double v = static_cast<double>(value);
    g_odo.seed(v);             // birikticiyi seed et; sonraki ilk örnek delta üretmez
    g_mirror.odometer = v;
    caros::seqlockStore(g_state,
                        g_mirror.speed, g_mirror.rpm,
                        g_mirror.fuel,  g_mirror.odometer,
                        g_mirror.nativeSource);
    LOGI("[NativeCore] Odometer seeded: %.3f km", v);
}

// ── Zero-copy snapshot köprüsü (Phase N3) ───────────────────────────
// Native belleği saran DirectByteBuffer döner. Bir kez çağrılır, Kotlin'de
// cache'lenir. Bellek module-level (g_snapshotMem) → uygulama ömrü boyunca geçerli.
JNIEXPORT jobject JNICALL
Java_com_cockpitos_pro_core_VehicleNativeBridge_nativeCreateSnapshotBuffer(
        JNIEnv* env, jobject /* thiz */) {
    return env->NewDirectByteBuffer(
            static_cast<void*>(g_snapshotMem),
            static_cast<jlong>(sizeof(g_snapshotMem)));
}

// Seqlock ile TUTARLI snapshot alır ve paylaşılan belleğe yazar.
// Kopyalama yok: Java aynı belleği DirectByteBuffer üzerinden okur.
// Tek tüketici (stream thread) çağırır → veri yarışı yok.
JNIEXPORT void JNICALL
Java_com_cockpitos_pro_core_VehicleNativeBridge_nativeRefreshSnapshot(
        JNIEnv* /* env */, jobject /* thiz */) {
    const caros::VehicleSnapshot snap = caros::seqlockLoad(g_state);
    g_snapshotMem[0] = snap.speed;
    g_snapshotMem[1] = snap.rpm;
    g_snapshotMem[2] = snap.fuel;
    g_snapshotMem[3] = snap.odometer;
    g_snapshotMem[4] = static_cast<double>(snap.seq);
    g_snapshotMem[5] = static_cast<double>(snap.source); // Phase N5.2: aktif füzyon kaynağı
}

} // extern "C"
