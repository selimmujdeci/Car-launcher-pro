/**
 * navEvidence.ts — NAV v3 · KANONİK KANIT SÖZLEŞMESİ (SAF · F0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/2 · v2 ADR-N08
 * ("`Evidenced<T>` ürün tipidir, gözlem süsü değildir").
 *
 * SAF: I/O YOK · timer YOK · `Date.now`/`performance.now` YOK · React YOK ·
 * modül durumu YOK. Zaman DIŞARIDAN (`MonotonicMs`) gelir.
 *
 * ── NE İŞE YARAR ──────────────────────────────────────────────────────────
 * L2'nin (Ego) ÜSTÜNDE yayınlanan her navigasyon sayısı bir `Evidenced<T>`
 * taşır: değer + kanıt sınıfı + kaynak + gerekçe + güven + (monotonik) gözlem
 * anı + tazelik bütçesi. LAB alanı (`InspectorField`) bundan TÜRETİLİR; ters
 * yön YASAK (v2 ADR-N08 kilidi).
 *
 * ── PARALEL TİP DEĞİLDİR ──────────────────────────────────────────────────
 * Kanıt sınıfı sözlüğü (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) depoda
 * ZATEN var: `platform/devtools/sessionInspectorModel.ts` → `Observability`.
 * `EvidenceGrade` AYNI sözlüktür; ikinci bir anlam kümesi kurulmaz. F0'da
 * kilit testi (`navV3ContractsF0.test.ts`) iki tanımın birebir eşit kaldığını
 * denetler. İleride migrasyon YÖNÜ: `sessionInspectorModel` bu dosyadan
 * re-export eder — tersi değil.
 *
 * ── NEDEN (ölçülmüş) ──────────────────────────────────────────────────────
 * Bugün dürüstlük etiketleri her katmanın kendi icadı (`distanceSource`,
 * `SpeedLimitSource`, `MapMatchReason`, `EtaState`...). Ölçülmüş sonuç: aynı
 * ETA dört yüzeyde FARKLI güven kuralıyla gösteriliyordu (kütük P0-NAV-14).
 * Tek tip hem tekrarı öldürür hem "kanıtsız değer yayınlanmaz" kuralını
 * DERLEYİCİDE zorlanabilir kılar.
 */

import type { MonotonicMs } from './navMonotonicTime';
import { isMonoStale, monoAgeMs } from './navMonotonicTime';

/* ══════════════════════════════════════════════════════════════════════════
   1) KANIT SINIFI — `sessionInspectorModel.Observability` ile AYNI SÖZLÜK
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kanıt sınıfı:
 *  OBSERVED    : değer doğrudan canlı bir navigasyon kaynağından geldi.
 *  DERIVED     : mevcut GERÇEK alanlardan deterministik, açıkça yazılmış kuralla türetildi.
 *  UNAVAILABLE : güvenilir kaynak YOK — yokluk beyanı (uydurma yerine).
 *  STALE       : monotonik damga var ve TANIMLI tazelik bütçesini aştı.
 */
export type EvidenceGrade = 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE';

export const EVIDENCE_GRADES: readonly EvidenceGrade[] = [
  'OBSERVED', 'DERIVED', 'UNAVAILABLE', 'STALE',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   2) SİNYAL KAYNAĞI — navigasyona özgü (araç veri katmanından AYRI)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Navigasyon sinyal kaynağı. `platform/vehicleDataLayer/valTypes.ts`
 * `SignalSource`'undan (araç sinyal bus'ı: HAL/CAN/OBD/GPS/FUSED) BİLİNÇLİ
 * OLARAK AYRIDIR — navigasyon kaynakları (harita paketi, rota sağlayıcı,
 * eşleme, ufuk) araç bus sinyalleriyle aynı kümede değildir. `VEHICLE_BUS`
 * girişi, araç bus'ından GELEN kanıtı navigasyon sözleşmesine köprüler
 * (`vehicleEvidenceBus.ts`) — orada güven YENİDEN HESAPLANMAZ, olduğu gibi
 * taşınır.
 */
export type NavSignalSource =
  | 'GNSS'            // ham uydu fix'i
  | 'DEAD_RECKONING'  // OBD hız + IMU projeksiyonu (fix yokken)
  | 'MAP_MATCH'       // ego'nun yol grafiğine oturtulmuş hâli
  | 'MAP_PACKAGE'     // cihazdaki sürümlü harita paketi (graph/adas karoları)
  | 'ADAS_TILE'       // adas katmanı (hız limiti · viraj · eğim · şerit sayısı)
  | 'ROUTE_PROVIDER'  // onboard router veya çevrimiçi rota sağlayıcı
  | 'TRAFFIC_PROVIDER'// BYOK trafik sağlayıcı (HERE/TomTom)
  | 'VEHICLE_BUS'     // CAN/OBD acquisition authority'den köprülenmiş kanıt
  | 'DERIVED'         // yalnız türetme (kendi ham kaynağı yok)
  | 'NONE';           // kaynak yok

export const NAV_SIGNAL_SOURCES: readonly NavSignalSource[] = [
  'GNSS', 'DEAD_RECKONING', 'MAP_MATCH', 'MAP_PACKAGE', 'ADAS_TILE',
  'ROUTE_PROVIDER', 'TRAFFIC_PROVIDER', 'VEHICLE_BUS', 'DERIVED', 'NONE',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   3) KANIT GEREKÇESİ — sınıfın NEDEN bu olduğu (makine sözleşmesi)
   ══════════════════════════════════════════════════════════════════════════ */

export type EvidenceReason =
  | 'LIVE_SOURCE'              // canlı kaynak değer verdi
  | 'DETERMINISTIC_DERIVATION' // gerçek alanlardan yazılı kuralla türetildi
  | 'NO_SOURCE'               // bu alan için güvenilir kaynak yok
  | 'STALE_TIMESTAMP'         // damga tazelik bütçesini aştı
  | 'BELOW_QUALITY_GATE'      // kaynak var ama karar kalitesinin altında
  | 'VERSION_MISMATCH'        // paket/protokol sürümü uyumsuz → kaynak kullanılamaz
  | 'COVERAGE_NONE'           // bu konum/koridor için kapsam yok
  | 'PROVIDER_ERROR';         // sağlayıcı hata döndü

export const EVIDENCE_REASONS: readonly EvidenceReason[] = [
  'LIVE_SOURCE', 'DETERMINISTIC_DERIVATION', 'NO_SOURCE', 'STALE_TIMESTAMP',
  'BELOW_QUALITY_GATE', 'VERSION_MISMATCH', 'COVERAGE_NONE', 'PROVIDER_ERROR',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   4) `Evidenced<T>` — kanonik ürün tipi
   ══════════════════════════════════════════════════════════════════════════ */

export interface Evidenced<T> {
  /** Değer. `grade === 'UNAVAILABLE'` iken DAİMA `null` (kurucular zorlar). */
  readonly value: T | null;
  readonly grade: EvidenceGrade;
  readonly source: NavSignalSource;
  readonly reason: EvidenceReason;
  /** [0,1]. `UNAVAILABLE` → ≤ 0.3 · `STALE` → ≤ 0.5 (kurucular kırpar). */
  readonly confidence: number;
  /** Destekleyen son gözlemin monotonik anı; yoksa `null` (bayatlık hesaplanmaz). */
  readonly observedAtMonoMs: MonotonicMs | null;
  /** Tazelik bütçesi (ms). `null` → bu alan için bayatlık HESAPLANMAZ. */
  readonly freshnessBudgetMs: number | null;
}

/** `UNAVAILABLE` kanıtta güven bu değeri AŞAMAZ (v2 F1 kilidi). */
export const UNAVAILABLE_CONFIDENCE_CEIL = 0.3;
/** `STALE` kanıtta güven bu değeri aşamaz. */
export const STALE_CONFIDENCE_CEIL = 0.5;

function _clamp01(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

interface EvidencedInit {
  readonly source: NavSignalSource;
  readonly confidence?: number;
  readonly observedAtMonoMs?: MonotonicMs | null;
  readonly freshnessBudgetMs?: number | null;
}

/** Canlı kaynaktan gözlenen değer. `null`/`undefined` → `unavailableNav`'a düşer. */
export function observedNav<T>(value: T | null | undefined, init: EvidencedInit): Evidenced<T> {
  if (value === null || value === undefined) {
    return unavailableNav<T>(init.source, 'NO_SOURCE');
  }
  return {
    value,
    grade: 'OBSERVED',
    source: init.source,
    reason: 'LIVE_SOURCE',
    confidence: _clamp01(init.confidence ?? 0.9),
    observedAtMonoMs: init.observedAtMonoMs ?? null,
    freshnessBudgetMs: init.freshnessBudgetMs ?? null,
  };
}

/** Gerçek alanlardan yazılı kuralla türetilmiş değer. */
export function derivedNav<T>(value: T | null | undefined, init: EvidencedInit): Evidenced<T> {
  if (value === null || value === undefined) {
    return unavailableNav<T>(init.source, 'NO_SOURCE');
  }
  return {
    value,
    grade: 'DERIVED',
    source: init.source,
    reason: 'DETERMINISTIC_DERIVATION',
    confidence: _clamp01(init.confidence ?? 0.6),
    observedAtMonoMs: init.observedAtMonoMs ?? null,
    freshnessBudgetMs: init.freshnessBudgetMs ?? null,
  };
}

/** Güvenilir kaynak yok — yokluk beyanı. Güven DAİMA ≤ `UNAVAILABLE_CONFIDENCE_CEIL`. */
export function unavailableNav<T>(
  source: NavSignalSource,
  reason: EvidenceReason = 'NO_SOURCE',
): Evidenced<T> {
  return {
    value: null,
    grade: 'UNAVAILABLE',
    source,
    reason,
    confidence: 0,
    observedAtMonoMs: null,
    freshnessBudgetMs: null,
  };
}

/** Bayat kanıt — değer taşınır ama güven ≤ `STALE_CONFIDENCE_CEIL`. */
export function staleNav<T>(value: T | null | undefined, init: EvidencedInit): Evidenced<T> {
  if (value === null || value === undefined) {
    return unavailableNav<T>(init.source, 'NO_SOURCE');
  }
  return {
    value,
    grade: 'STALE',
    source: init.source,
    reason: 'STALE_TIMESTAMP',
    confidence: Math.min(_clamp01(init.confidence ?? STALE_CONFIDENCE_CEIL), STALE_CONFIDENCE_CEIL),
    observedAtMonoMs: init.observedAtMonoMs ?? null,
    freshnessBudgetMs: init.freshnessBudgetMs ?? null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) YAŞLANDIRMA — monotonik, saf
   ══════════════════════════════════════════════════════════════════════════ */

/** Kanıtın yaşı (ms). Damga yoksa `null`. */
export function evidenceAgeMs<T>(ev: Evidenced<T>, nowMonoMs: MonotonicMs | number): number | null {
  if (!ev) return null;
  return monoAgeMs(ev.observedAtMonoMs, nowMonoMs);
}

/**
 * Gerekiyorsa kanıtı `STALE`'e yükseltir. Bayatlık YALNIZ monotonik damga +
 * tanımlı pozitif bütçe varken hesaplanır. `UNAVAILABLE` dokunulmaz.
 */
export function withStaleness<T>(ev: Evidenced<T>, nowMonoMs: MonotonicMs | number): Evidenced<T> {
  if (!ev || ev.grade === 'UNAVAILABLE' || ev.grade === 'STALE') return ev;
  if (!isMonoStale(ev.observedAtMonoMs, nowMonoMs, ev.freshnessBudgetMs)) return ev;
  return {
    ...ev,
    grade: 'STALE',
    reason: 'STALE_TIMESTAMP',
    confidence: Math.min(ev.confidence, STALE_CONFIDENCE_CEIL),
  };
}

/** Değer güvenilir bir karara girebilir mi (OBSERVED/DERIVED ve değeri var). */
export function isDecisionGrade<T>(ev: Evidenced<T> | null | undefined): boolean {
  if (!ev) return false;
  return (ev.grade === 'OBSERVED' || ev.grade === 'DERIVED') && ev.value !== null;
}
