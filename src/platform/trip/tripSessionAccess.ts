/**
 * tripSessionAccess — seyahat oturumuna SIFIR BAĞIMLILIKLI okuma noktası.
 *
 * NEDEN VAR: `companionChatProvider.buildInterpretedVehicleContext()` SENKRON
 * bir fonksiyondur (string döndürür) → `await import` kullanamaz. Oturumu
 * doğrudan statik import etmek ise `tripSessionService` → `tripLogService`
 * kenarını Mavi'nin bağlam grafiğine ekliyordu; bu graf zaten 400+ modül ve
 * `regression.guards` içindeki dinamik-import kilidi ölçülebilir biçimde
 * yavaşladı (varsayılan 5 sn timeout'ta düşmeye başladı).
 *
 * ÇÖZÜM: bağımlılık TERS çevrildi. Bu modülün ÇALIŞMA ZAMANI bağımlılığı
 * YOKTUR (yalnız `import type` — derlemede silinir). Okuyucuyu
 * `tripSessionService` başlarken KAYDEDER; tüketici yalnız bu ince kapıyı
 * import eder.
 *
 * FAIL-SOFT: kayıt yapılmadıysa `null` döner → çağıran eski davranışına düşer.
 * Sahte oturum ÜRETİLMEZ.
 */

import type { TripSessionProjection } from './core/tripSessionModel';

type Reader = () => TripSessionProjection;

let _read: Reader | null = null;

/**
 * Okuyucuyu kaydet — YALNIZ `tripSessionService.startTripSession()` çağırır.
 * İkinci bir sahip doğmasın diye dışarıdan kullanılmaz.
 */
export function _registerTripSessionReader(fn: Reader | null): void {
  _read = typeof fn === 'function' ? fn : null;
}

/**
 * Oturumu oku. Kayıt yoksa, okuma patlarsa ya da oturum HİÇ başlamadıysa
 * `null` — çağıran bunu "veri yok" olarak yorumlar.
 */
export function readTripSessionOrNull(): TripSessionProjection | null {
  if (_read === null) return null;
  try {
    const s = _read();
    return s && s.sessionId !== null ? s : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * "YOLCULUK TAMAMLANDI" KARTI — KANONİK SEÇİCİ (saf)
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── ÖLÇÜLEN KUSUR (gerçek render, 2026-09-21) ────────────────────────────
 * Ana ekranda "YOLCULUK TAMAMLANDI · 0.9 km / 4 dk / 14 km/s" kartı açıldı.
 * Kart `tripLogService`in DEPOLAMA segmenti mühürüne (active → pasif,
 * `TripRecord`) bağlıydı: rota olmayan bir sürüşte (DRIVE_LOG) IDLE_WINDOW /
 * DATA_SILENCE / servis durması her mühürde "yolculuk bitti" ilan ediyordu.
 * 4543ccf9'dan beri ürün kuralı bunu YASAKLAR: hedef yokken CarOS yolculuğun
 * bittiğini BİLEMEZ; hedef varken de yalnız navigasyon otoritesinin varış
 * mührü (DESTINATION_REACHED) bitirir.
 *
 * Bu seçici İKİNCİ bir karar otoritesi DEĞİLDİR: hükmü `tripSessionModel`
 * verir (`kind` + `journeyCompleted`), burada yalnız karta ÇEVRİLİR. Sayılar
 * da tek son segmentten değil, oturumun BAŞINDAN İTİBAREN toplamından gelir
 * (120 km + 180 km → 300 km).
 */

/** Kartın gösterdiği asgari özet — `TripRecord` DEĞİLDİR (segment değil, oturum). */
export interface JourneyCompletionCard {
  /** Oturum kimliği — kart oturum başına TEK ATIŞ yapar. */
  readonly id: string;
  readonly distanceKm: number;
  readonly durationMin: number;
  /** Hız örneği yoksa `null` — 0 UYDURULMAZ. */
  readonly avgSpeedKmh: number | null;
  /** Oturum düzeyinde sürüş skoru sahibi YOKTUR → `null` (satır çıkmaz). */
  readonly drivingScore: number | null;
  /** Litre/depo bilgisi bu katmanda yok → `null` (satır çıkmaz). */
  readonly fuelCostTL: number | null;
}

/**
 * Projeksiyonu karta çevir — YALNIZ kanonik tamamlanmada.
 *
 *  · `kind === 'DRIVE_LOG'`  → `null` (hedefsiz sürüş "tamamlanmaz")
 *  · `journeyCompleted` false → `null` (mola, mühür, restart, iptal,
 *    reroute, hedef değişikliği tamamlanma DEĞİLDİR)
 *  · `journeyCompleted` true  → kart; `completion` zaten yalnız
 *    `DESTINATION_REACHED` ile true olur (bkz. `projectTripSession`).
 */
export function selectJourneyCompletionCard(
  p: TripSessionProjection | null | undefined,
): JourneyCompletionCard | null {
  if (!p || p.sessionId === null) return null;
  if (p.kind !== 'JOURNEY') return null;
  if (!p.journeyCompleted || p.completion !== 'DESTINATION_REACHED') return null;
  return {
    id:           p.sessionId,
    distanceKm:   Math.round(p.distanceMeters / 100) / 10,
    durationMin:  Math.round(p.elapsedMs / 60_000),
    avgSpeedKmh:  p.averageSpeedKmh,
    drivingScore: null,
    fuelCostTL:   null,
  };
}
