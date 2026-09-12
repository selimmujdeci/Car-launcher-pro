/**
 * obdCadenceGate — OBD tazelik eşiğini GÖZLENEN kadanstan öğrenir.
 *
 * PROBLEM (saha snapshot 2026-07-25, KWP/protokol 5 araç, 15 destekli PID):
 * OBD olay kadansı 102 olay / 438 s ≈ 4.3 s ortalama ve jitter'lı. Worker'ın SABİT
 * 5 s tazelik eşiğine marj yalnız %14 kalıyordu → her jitter tepesinde `obdAlive=false`.
 * Aynı anlık görüntüde OBD `connected`, rpm 758 (rölanti), son paket 7.8 s önceydi; buna
 * rağmen HAL `activeSource=GPS` + `canPhase=FALLBACK_ACTIVE` idi. Zincir: hız füzyonu
 * GPS'e düştü → park hâlindeki GPS gürültüsü 10.6 km/h üretti → sürüş/park modu 5 sn'de
 * bir flip-flop yaptı → odometreye 48 m SAHTE mesafe yazıldı.
 *
 * ÇÖZÜM (bu modül): eşik sabit değil, ölçülen ardışık-olay boşluğundan türetilir.
 *   - Ölçüm YALNIZ veri geldiğinde yapılır → ölü kaynak kendi eşiğini büyütemez (fail-closed).
 *   - Sönümlü tepe: yavaşlamayı ANINDA öğrenir, hızlanmayı yavaşça unutur (histerezis).
 *   - Kopma sonrası dönüş boşluğu (`> GAP_SANE_MAX_MS`) kadans sayılmaz — öğrenmeye girmez.
 *   - Taban 5 s: hızlı araçlarda kopma tespiti GECİKMEZ.
 *   - Tavan 20 s: gerçek kopma sonsuza dek "canlı" görünemez.
 *
 * SAF: timer/DOM/store/IO YOK — tüm zaman dışarıdan verilir → deterministik test.
 * Zero-allocation: yalnız iki sayı, her `observe` O(1) aritmetik.
 */

/** TABAN — eşik buranın altına İNMEZ (hızlı araçlarda kopma tespiti gecikmesin). */
export const OBD_TIMEOUT_FLOOR_MS = 5_000;
/** TAVAN — gerçek kopma en geç bu sürede görülür. */
export const OBD_TIMEOUT_CEIL_MS = 20_000;
/** Bunun üstü kadans değil KOPMA'dır — öğrenmeye katılmaz. */
export const OBD_GAP_SANE_MAX_MS = 30_000;
/** Olay başına sönüm (~23 olayda yarı ömür). */
export const OBD_GAP_DECAY = 0.97;
/** Eşik = gözlenen tepe boşluk × bu katsayı. */
export const OBD_TIMEOUT_GAP_FACTOR = 2;

export interface ObdCadenceGate {
  /** İki ardışık OBD olayı arasında ÖLÇÜLEN boşluk (ms). Geçersiz/anormal değer yok sayılır. */
  observe(gapMs: number): void;
  /** Öğrenilmiş tazelik eşiği — daima [TABAN, TAVAN] aralığında. */
  timeoutMs(): number;
  /** Öğrenilen kadansı sıfırla (oturum/adaptör değişimi → baştan öğren). */
  reset(): void;
  /** Gözlem/tanı amaçlı sönümlü tepe (kararı ETKİLEMEZ). */
  peakGapMs(): number;
}

export function createObdCadenceGate(): ObdCadenceGate {
  let _peakGapMs = 0;

  return {
    observe(gapMs: number): void {
      // gap <= 0 (saat anomalisi), NaN, ve kopma sonrası dönüş boşluğu ELENİR
      if (!Number.isFinite(gapMs) || gapMs <= 0 || gapMs >= OBD_GAP_SANE_MAX_MS) return;
      _peakGapMs = gapMs > _peakGapMs ? gapMs : _peakGapMs * OBD_GAP_DECAY;
    },

    timeoutMs(): number {
      const adaptive = _peakGapMs * OBD_TIMEOUT_GAP_FACTOR;
      if (adaptive <= OBD_TIMEOUT_FLOOR_MS) return OBD_TIMEOUT_FLOOR_MS;
      if (adaptive >= OBD_TIMEOUT_CEIL_MS)  return OBD_TIMEOUT_CEIL_MS;
      return adaptive;
    },

    reset(): void {
      _peakGapMs = 0;
    },

    peakGapMs(): number {
      return _peakGapMs;
    },
  };
}
