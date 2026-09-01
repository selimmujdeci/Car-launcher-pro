/**
 * perfBaselineExport — ARCH-06/F1 · GİZLİLİK-GÜVENLİ TABAN DIŞA AKTARIMI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **ANALİTİK BACKEND DEĞİLDİR.** Hiçbir ağ çağrısı YAPMAZ. Üretilen
 *     nesne çağırana verilir; nereye gideceği ÇAĞIRANIN kararıdır (LAB'da
 *     panoya kopyalama / dosyaya yazma).
 * (2) **BENCHMARK KOŞTURMAZ.** Senaryo başlatmaz, ölçüm tetiklemez. Yalnız
 *     O AN ölçülmüş olanı paketler.
 * (3) **HÜKÜM VERMEZ.** "PASS/FAIL" · "regresyon" · "hedef" yazmaz —
 *     F1'de hedef değeri YOKTUR (baseline ölçülüyor).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GİZLİLİK SÖZLEŞMESİ ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Dışa aktarılan pakette **yalnız sayılar, birimler ve kapalı sözlükten
 * gelen sınıf adları** bulunur. Koordinat · VIN · telefon kimliği · ham PDU ·
 * ham CAN yükü · transkript · medya başlığı · API anahtarı · anahtar DEĞERİ
 * yapısal olarak GİREMEZ: paket `PerfMetric` sözleşmesinden türer ve o
 * sözleşme yalnız `name/owner/value/unit/...` taşır.
 *
 * `environment` alanı cihaz SINIFI taşır (tier · native mi · çekirdek sayısı
 * gibi), cihaz KİMLİĞİ değil — iki farklı head unit aynı satırı üretebilir.
 */

import { getPerformanceDiagnosticsSnapshot } from './performanceAggregator';
import { readCanBridgeMetrics } from './canBridgeMetrics';
import type { PerfSection } from './perfContract';

/** Taban dosyasının şema sürümü — alan eklenirse ARTIRILIR. */
export const PERF_BASELINE_SCHEMA_VERSION = 1;

/**
 * F0 §D.1'de tanımlı senaryolar. Serbest metin YOK: bir taban dosyası hangi
 * senaryoya ait olduğunu KAPALI sözlükten söyler, yoksa karşılaştırılamaz.
 */
export type PerfBaselineScenario =
  | 'COLD_START' | 'WARM_START' | 'IDLE'
  | 'NAVIGATION_ONLY' | 'MEDIA_ONLY' | 'NAV_MEDIA' | 'MAVI_NAV_MEDIA'
  | 'OBD_LIVE' | 'CAN_SYNTHETIC_LOAD' | 'FULL_SCAN'
  | 'MEMORY_SOAK' | 'THERMAL_SOAK'
  /** Senaryo dışı elle alınmış anlık görüntü — karşılaştırmaya GİRMEZ. */
  | 'AD_HOC';

/**
 * Ölçümün nerede alındığı. **BENCH ≠ FIELD** ayrımı pakette TAŞINIR:
 * sentetik bir CAN yükü sonucu ASLA saha kanıtı sayılamaz (F0 §D.2).
 */
export type PerfBaselineEnvironmentKind = 'BENCH_BROWSER' | 'BENCH_EMULATOR' | 'FIELD_HEAD_UNIT' | 'UNKNOWN';

export interface PerfBaselineEnvironment {
  readonly kind: PerfBaselineEnvironmentKind;
  /** Cihaz SINIFI (low/mid/high) — cihaz kimliği DEĞİL. */
  readonly deviceTier: string | null;
  readonly nativePlatform: boolean | null;
  readonly hardwareConcurrency: number | null;
  /** Chromium `deviceMemory` (GB) — kaba sınıf. */
  readonly deviceMemoryGb: number | null;
  readonly userAgentFamily: string | null;
}

export interface PerfBaselineExport {
  readonly schemaVersion: number;
  readonly scenario: PerfBaselineScenario;
  /** ISO duvar saati — YALNIZ dosya sıralaması için (süre hesabına GİRMEZ). */
  readonly capturedAtIso: string;
  readonly buildRef: string | null;
  readonly environment: PerfBaselineEnvironment;
  readonly sections: readonly PerfSection[];
  readonly canBridgeState: string;
  readonly measuredMetricCount: number;
  readonly totalMetricCount: number;
  readonly notes: readonly string[];
  readonly provenance: readonly string[];
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/**
 * Tarayıcı ailesini KABA sınıfa indirir — tam UA dizesi parmak izidir ve
 * pakete GİRMEZ.
 */
function uaFamily(): string | null {
  return safe(() => {
    if (typeof navigator === 'undefined') return null;
    const ua = navigator.userAgent ?? '';
    if (ua.includes('Chrome')) return 'Chromium';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'WebKit';
    return 'Other';
  }, null);
}

function readEnvironment(kind: PerfBaselineEnvironmentKind, deviceTier: string | null): PerfBaselineEnvironment {
  return Object.freeze({
    kind,
    deviceTier,
    nativePlatform: safe(
      () => (typeof navigator !== 'undefined' && 'userAgent' in navigator
        ? /Android|iPhone|iPad/i.test(navigator.userAgent) : null),
      null,
    ),
    hardwareConcurrency: safe(
      () => (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency : null),
      null,
    ),
    deviceMemoryGb: safe(() => {
      const m = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
      return typeof m === 'number' && Number.isFinite(m) ? m : null;
    }, null),
    userAgentFamily: uaFamily(),
  });
}

/**
 * O ANKİ ölçümleri gizlilik-güvenli bir taban paketine dönüştürür.
 *
 * Yan etkisizdir: sayaç sıfırlamaz, ölçüm tetiklemez, ağa çıkmaz, dosya
 * yazmaz. Paketi nereye koyacağı ÇAĞIRANIN kararıdır.
 *
 * @param scenario     hangi F0 senaryosu (kapalı sözlük)
 * @param environment  BENCH mi FIELD mi — sentetik sonuç saha kanıtı SAYILMAZ
 * @param deviceTier   `getDeviceTier()` çıktısı; çağıran verir (bu modül
 *                     cihaz sınıflandırmasını YENİDEN HESAPLAMAZ)
 * @param buildRef     paket/commit referansı; bilinmiyorsa `null`
 */
export function buildPerfBaselineExport(input: {
  readonly scenario: PerfBaselineScenario;
  readonly environment: PerfBaselineEnvironmentKind;
  readonly deviceTier?: string | null;
  readonly buildRef?: string | null;
}): PerfBaselineExport {
  const snap = safe(() => getPerformanceDiagnosticsSnapshot(), null);
  const can = safe(() => readCanBridgeMetrics(), null);

  return Object.freeze({
    schemaVersion: PERF_BASELINE_SCHEMA_VERSION,
    scenario: input.scenario,
    capturedAtIso: safe(() => new Date().toISOString(), ''),
    buildRef: input.buildRef ?? null,
    environment: readEnvironment(input.environment, input.deviceTier ?? null),
    sections: snap?.sections ?? Object.freeze([]),
    canBridgeState: can?.state ?? 'NOT_READ',
    measuredMetricCount: snap?.measuredMetricCount ?? 0,
    totalMetricCount: snap?.totalMetricCount ?? 0,
    notes: Object.freeze([
      'BENCH ≠ FIELD: sentetik/emülatör ölçümü gerçek head-unit kanıtı SAYILMAZ.',
      'Bu paket HEDEF veya PASS/FAIL İÇERMEZ — F1 taban ölçümüdür.',
      'Ölçülmemiş metrikler pakette UNMEASURED olarak DURUR; listeden düşürülmez.',
      'capturedAtIso yalnız dosya sıralaması içindir; süreler monotonik saatten gelir.',
    ]),
    provenance: Object.freeze([
      'perfBaselineExport.buildPerfBaselineExport()',
      'performanceAggregator.getPerformanceDiagnosticsSnapshot()',
      'ağ çağrısı YOK · dosya yazımı YOK · ölçüm tetiklenmedi',
    ]),
  });
}

/**
 * Paketi taşınabilir JSON'a çevirir. Hata hâlinde `null` — yarım/bozuk bir
 * taban dosyası, yanlış bir karşılaştırmanın kaynağı olurdu.
 */
export function serializePerfBaseline(exportData: PerfBaselineExport): string | null {
  try { return JSON.stringify(exportData, null, 2); } catch { return null; }
}
