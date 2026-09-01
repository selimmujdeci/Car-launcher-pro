/**
 * canBridgeMetrics — ARCH-06/F1 · NATIVE CAN KÖPRÜ ÖLÇÜM OKUYUCUSU.
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * Native okuma ASENKRONDUR; `performanceAggregator` ise SENKRON ve saf bir
 * projeksiyondur (timer/abonelik/await YOK). Bu modül asenkron okumayı
 * kendi içinde tutar ve toplayıcıya SON OKUNAN değeri senkron verir.
 *
 * ── SAHTE DEĞER YOK ───────────────────────────────────────────────────────
 * Eski APK `getCanBridgeMetrics` metodunu TAŞIMAZ. O durumda sonuç
 * `NOT_SUPPORTED`tır — sayaçlar 0 GÖSTERİLMEZ. "Köprü ölçülemiyor" ile
 * "hiç olay geçmedi" AYRI şeylerdir.
 *
 * ── YAN ETKİSİZ ───────────────────────────────────────────────────────────
 * Okuma native sayaçları SIFIRLAMAZ, sniffer AÇMAZ, emit TETİKLEMEZ.
 * Sayaçlar monotoniktir; pencere hızı isteyen taraf iki okuma FARKINI alır.
 */

import { CarLauncher } from '../nativePlugin';

export interface CanBridgeMetrics {
  /** `emitVehicleData`ya ULAŞAN çağrı sayısı — TÜM kaynakların tek girişi. */
  readonly inputCount: number;
  /** JS'e GERÇEKTEN gönderilen olay sayısı. */
  readonly emitCount: number;
  /** Pencerede bekleyen değerin üzerine yazılma sayısı (ara değer JS'e GİTMEDİ). */
  readonly coalescedOverwriteCount: number;
  /** Alan seti aynı olduğu için emit ATLANDI. */
  readonly dedupSkippedCount: number;
  /** reverse/parkingBrake değişti → pencere BEKLENMEDİ. */
  readonly safetyBypassCount: number;
  /** Ham frame JS'e gitti (yalnız sniffer açıkken). */
  readonly snifferEmitCount: number;
  /** Native coalescing penceresi (ms). */
  readonly windowMs: number;
  readonly snifferActive: boolean;
}

export type CanBridgeMetricsState = 'OBSERVED' | 'NOT_SUPPORTED' | 'UNAVAILABLE' | 'NOT_READ';

export interface CanBridgeMetricsSnapshot {
  readonly state: CanBridgeMetricsState;
  readonly reason: string;
  readonly metrics: CanBridgeMetrics | null;
}

const NOT_READ: CanBridgeMetricsSnapshot = Object.freeze({
  state: 'NOT_READ',
  reason: 'henüz okunmadı — LAB açıldığında bir kez çekilir',
  metrics: null,
});

let _last: CanBridgeMetricsSnapshot = NOT_READ;
let _inFlight = false;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Native sayaçları ÇEKER (asenkron). Yeniden giriş korumalı: bir okuma
 * uçuştayken ikinci çağrı yeni bir köprü geçişi ÜRETMEZ.
 *
 * ASLA throw etmez — ölçüm hatası LAB'ı düşürmez.
 */
export async function refreshCanBridgeMetrics(): Promise<CanBridgeMetricsSnapshot> {
  if (_inFlight) return _last;
  const fn = CarLauncher.getCanBridgeMetrics;
  if (typeof fn !== 'function') {
    _last = Object.freeze({
      state: 'NOT_SUPPORTED' as const,
      reason: 'eski APK: getCanBridgeMetrics köprüde YOK — sayaçlar 0 GÖSTERİLMEZ',
      metrics: null,
    });
    return _last;
  }
  _inFlight = true;
  try {
    const r = await fn();
    const inputCount = num(r?.inputCount);
    const emitCount = num(r?.emitCount);
    const coalesced = num(r?.coalescedOverwriteCount);
    const dedup = num(r?.dedupSkippedCount);
    const bypass = num(r?.safetyBypassCount);
    const sniffer = num(r?.snifferEmitCount);
    const windowMs = num(r?.windowMs);
    if (inputCount === null || emitCount === null || coalesced === null
      || dedup === null || bypass === null || sniffer === null || windowMs === null) {
      /* Eksik alan → KISMİ değer gösterilmez. Yarım bir ölçüm, yanlış bir
         ölçümdür: eksik alanı 0 sanan okuyucu yanlış sonuç çıkarır. */
      _last = Object.freeze({
        state: 'UNAVAILABLE' as const,
        reason: 'native yanıtı eksik alan taşıyor — kısmi ölçüm gösterilmez',
        metrics: null,
      });
      return _last;
    }
    _last = Object.freeze({
      state: 'OBSERVED' as const,
      reason: 'native monotonik sayaçlar okundu (sıfırlanmadı)',
      metrics: Object.freeze({
        inputCount, emitCount,
        coalescedOverwriteCount: coalesced,
        dedupSkippedCount: dedup,
        safetyBypassCount: bypass,
        snifferEmitCount: sniffer,
        windowMs,
        snifferActive: r?.snifferActive === true,
      }),
    });
    return _last;
  } catch (e) {
    _last = Object.freeze({
      state: 'UNAVAILABLE' as const,
      reason: e instanceof Error ? `köprü okuması düştü: ${e.message}` : 'köprü okuması düştü',
      metrics: null,
    });
    return _last;
  } finally {
    _inFlight = false;
  }
}

/** SON okunan değeri senkron verir. Okuma TETİKLEMEZ. */
export function readCanBridgeMetrics(): CanBridgeMetricsSnapshot { return _last; }

/** @internal YALNIZ TEST. */
export function _resetCanBridgeMetricsForTest(): void { _last = NOT_READ; _inFlight = false; }
