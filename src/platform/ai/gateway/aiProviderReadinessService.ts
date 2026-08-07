/**
 * aiProviderReadinessService.ts — SAĞLAYICI HAZIRLIĞINI GERÇEKTEN ÖLÇER.
 *
 * ── NEDEN ──────────────────────────────────────────────────────────────
 * `setProviderReadiness()` yazılmıştı ama **boot'ta çağıranı yoktu** →
 * LAB daima `ÖLÇÜLMEDİ` gösteriyordu. Bu servis o halkayı kapatır.
 *
 * ── "ANAHTAR VAR" ≠ "HAZIR" (bağlayıcı) ────────────────────────────────
 * Anahtarın varlığı sağlayıcının erişilebilir olduğunu KANITLAMAZ:
 *   · yapılandırma yok            → `NOT_CONFIGURED`
 *   · anahtar var, sonda yok      → `CONFIGURED` (erişim doğrulanmadı)
 *   · sonda başarılı              → `READY`
 *   · sonda kısıtlı (kota/limit)  → `DEGRADED`
 *   · sonda ulaşılamadı/zaman aşımı → `FAILED`
 * YALNIZ `READY` sistemi hazır sayar.
 *
 * ── SINIRLAR ───────────────────────────────────────────────────────────
 *  · Boot'ta BİR KEZ + sağlayıcı değişiminde. **Poll YOK** (sonsuz hızlı
 *    probe pil/kota yakar).
 *  · Sonda için bounded timeout; aşılırsa `FAILED` (fail-closed).
 *  · **Secret · token · endpoint · ham hata metni LOGLANMAZ ve TAŞINMAZ** —
 *    yalnız bounded durum ve bounded hata sınıfı.
 *  · Sonda enjekte edilir → testte ağa çıkılmaz, build sırasında da çıkılmaz.
 */

import { setProviderReadiness } from './aiGatewayAccessRuntime';
import type { AiProviderReadiness, AiProviderReadinessInfo } from './aiGatewayAccess';

/** Yapılandırma okuması — anahtar VAR/YOK (değer ASLA taşınmaz). */
export type ConfigProbe = () => Promise<{ configured: boolean }>;

/** Erişilebilirlik sondası — bounded sonuç döndürür (ham hata YOK). */
export type ReachabilityProbe = () => Promise<'OK' | 'LIMITED' | 'REJECTED' | 'UNREACHABLE'>;

/** İki aşamalı ölçümün sonucu. */
export interface ReadinessMeasurement {
  readonly state: AiProviderReadiness;
  readonly source: AiProviderReadinessInfo['source'];
  readonly lastFailure: AiProviderReadinessInfo['lastFailure'];
}

/** Sonda için azami süre — aşılırsa FAILED (asla süresiz beklenmez). */
export const PROVIDER_PROBE_TIMEOUT_MS = 6_000;

/** `p`yi `ms` içinde bitmezse `null`a çeviren bounded sarmalayıcı. */
async function _withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * SAF karar tablosu — ölçüm girdilerinden hazırlık durumu.
 *
 * Test edilebilir olması için ağdan tamamen ayrıktır.
 */
export function deriveReadiness(input: {
  readonly configured: boolean | null;   // null = yapılandırma OKUNAMADI
  readonly probe: 'OK' | 'LIMITED' | 'REJECTED' | 'UNREACHABLE' | 'TIMEOUT' | 'SKIPPED' | null;
}): ReadinessMeasurement {
  // Yapılandırma okunamadıysa hiçbir iddia kurulmaz.
  if (input.configured === null) {
    return { state: 'UNKNOWN', source: 'NOT_MEASURED', lastFailure: 'UNKNOWN_ERROR' };
  }
  if (!input.configured) {
    return { state: 'NOT_CONFIGURED', source: 'CONFIG_ONLY', lastFailure: 'NO_KEY' };
  }
  // Anahtar var ama sonda çalıştırılmadı → erişim DOĞRULANMADI.
  if (input.probe === null || input.probe === 'SKIPPED') {
    return { state: 'CONFIGURED', source: 'CONFIG_ONLY', lastFailure: 'NONE' };
  }
  switch (input.probe) {
    case 'OK':          return { state: 'READY',    source: 'PROBE', lastFailure: 'NONE' };
    case 'LIMITED':     return { state: 'DEGRADED', source: 'PROBE', lastFailure: 'NONE' };
    case 'REJECTED':    return { state: 'FAILED',   source: 'PROBE', lastFailure: 'REJECTED' };
    case 'UNREACHABLE': return { state: 'FAILED',   source: 'PROBE', lastFailure: 'UNREACHABLE' };
    case 'TIMEOUT':     return { state: 'FAILED',   source: 'PROBE', lastFailure: 'TIMEOUT' };
  }
}

/**
 * Hazırlığı ölçer ve runtime'a yazar.
 *
 * @param cfg    anahtar VAR/YOK okuması
 * @param reach  erişilebilirlik sondası — verilmezse `CONFIGURED`de kalınır
 *               (sahte `READY` ÜRETİLMEZ)
 */
export async function measureProviderReadiness(
  cfg: ConfigProbe,
  reach: ReachabilityProbe | null,
  nowMs: number,
): Promise<ReadinessMeasurement> {
  let configured: boolean | null = null;
  try {
    const r = await _withTimeout(cfg(), PROVIDER_PROBE_TIMEOUT_MS);
    configured = r === null ? null : r.configured === true;
  } catch {
    configured = null;                       // okunamadı — uydurma yok
  }

  let probe: Parameters<typeof deriveReadiness>[0]['probe'] = 'SKIPPED';
  if (configured === true && reach !== null) {
    try {
      const r = await _withTimeout(reach(), PROVIDER_PROBE_TIMEOUT_MS);
      probe = r === null ? 'TIMEOUT' : r;
    } catch {
      probe = 'UNREACHABLE';                 // ham hata YUTULMAZ, SINIFLANDIRILIR
    }
  }

  const m = deriveReadiness({ configured, probe });
  setProviderReadiness(m.state, {
    source: m.source,
    measuredAt: nowMs,
    lastFailure: m.lastFailure,
  });
  return m;
}

/* ── Boot bağlantısı ───────────────────────────────────────────────────── */

let _started = false;

/**
 * Boot'ta BİR KEZ ölçer. Timer KURMAZ.
 *
 * Sağlayıcı değiştiğinde (anahtar kaydedildi/silindi) çağıran taraf
 * `remeasureProviderReadiness()` çağırır — poll yerine OLAY tabanlı.
 */
export function startProviderReadiness(
  cfg: ConfigProbe,
  reach: ReachabilityProbe | null = null,
): () => void {
  if (_started) return () => { /* idempotent */ };
  _started = true;
  void measureProviderReadiness(cfg, reach, Date.now());
  return () => { _started = false; };
}

/** Sağlayıcı değişiminde yeniden ölçüm (olay tabanlı — poll değil). */
export async function remeasureProviderReadiness(
  cfg: ConfigProbe,
  reach: ReachabilityProbe | null = null,
): Promise<ReadinessMeasurement> {
  return measureProviderReadiness(cfg, reach, Date.now());
}

/** @internal testler arası izolasyon. */
export function _resetProviderReadinessServiceForTest(): void {
  _started = false;
}
