/**
 * hotPathLogAudit — ARCH-06/F1 · SICAK YOL LOG RİSK ENVANTERİ (SAF · BİLDİRİM).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `installConsoleGate()` (main.tsx) düşük modda çıktıyı BASTIRIR — ama
 * argüman yine de DEĞERLENDİRİLİR:
 *
 *     console.warn(`[CAN] ${JSON.stringify(frame)}`)   // gate bastırsa bile
 *                                                      // stringify KOŞAR
 *
 * Yani gate, çıktıyı susturur; MALİYETİ susturmaz. Sıcak yolda (CAN yayını ·
 * GPS fix · OBD verisi · medya pozisyonu · Mavi partial) bu fark ölçülebilir
 * bir yüktür.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **LOG DEĞİŞTİRMEZ.** F1 ÖLÇÜM fazıdır; tek bir `console` çağrısı bile
 *     bu turda düzenlenmedi. Buradaki liste F2 için BACKLOG'dur.
 * (2) **TARAYICI DEĞİLDİR.** Çalışma zamanında kaynak kodu okumaz. Statik
 *     kilit testi (`arch06PerformanceMeasurement`) gerçek taramayı yapar;
 *     burası yalnız SICAK YOL TANIMINI ve risk sınıflarını taşır.
 * (3) **HÜKÜM VERMEZ.** "Bu log yavaş" demez — "bu dosya sıcak yoldur ve
 *     orada pahalı argüman deseni RİSKTİR" der.
 */

/** Riskin ürün üzerindeki ağırlığı — F0 borç sınıflandırmasıyla aynı sözlük. */
export type HotPathLogRisk = 'P0' | 'P1' | 'P2' | 'P3';

export interface HotPathSurface {
  /** Sıcak yol dosyası. */
  readonly file: string;
  /**
   * SICAK BÖLGENİN başlangıç imzası.
   *
   * ⚠️ DOSYA SICAK DEĞİLDİR, BÖLGE SICAKTIR. `obdService.ts` içindeki ECU
   * kurtarma ve durum geçişi log'ları olay-tetiklidir (saniyede defalarca
   * KOŞMAZ) ve pahalı argüman kullanmaları meşrudur. Sıcak olan, native
   * verinin geldiği geri çağrıdır. Bu yüzden tarama dosyanın tamamında
   * değil, bu imzadan başlayan bölgede yapılır — aksi hâlde denetim yanlış
   * yerde alarm üretir ve gerçek riski gizlerdi.
   */
  readonly hotRegionMarker: string;
  /** Bölgenin satır bütçesi — geri çağrı gövdesini kapsayacak kadar. */
  readonly hotRegionLines: number;
  /** Bu yolun neden sıcak sayıldığı — frekans kaynağı. */
  readonly cadenceSource: string;
  readonly risk: HotPathLogRisk;
  /** F2'de yapılacak iş — bu turda UYGULANMADI. */
  readonly f2Action: string;
}

/**
 * SICAK YOL TANIMI (kapalı liste).
 *
 * Bir yol "sıcak"tır ancak ve ancak saniyede birden çok kez, kullanıcı
 * etkileşimi olmadan çalışıyorsa. Boot, ayar yazımı ve LAB yolları sıcak
 * DEĞİLDİR — orada `logGate` yeterlidir ve mevcut davranış korunur.
 */
const HOT_PATH_SURFACES: readonly HotPathSurface[] = Object.freeze([
  Object.freeze({
    file: 'src/platform/vehicleDataLayer/CanAdapter.ts',
    hotRegionMarker: "CarLauncher.addListener('canData'",
    hotRegionLines: 140,
    cadenceSource: 'native CAN köprüsü — 80 ms coalescing penceresi (~12,5 Hz TAVAN)',
    risk: 'P3' as const,
    f2Action: 'Şu an temiz. Yeni log eklenirse `if (VERBOSE)` koşuluna alınmalı; gate’e bırakılmamalı.',
  }),
  Object.freeze({
    file: 'src/platform/gpsService.ts',
    hotRegionMarker: 'function handlePosition(',
    hotRegionLines: 120,
    cadenceSource: 'GPS fix — 200 ms taban throttle (termal L2+’da 500 ms)',
    risk: 'P3' as const,
    f2Action: 'Şu an temiz. Reddedilen fix yollarındaki log’lar ileride sayaçla değiştirilebilir.',
  }),
  Object.freeze({
    file: 'src/platform/obdService.ts',
    hotRegionMarker: "'obdData',",
    hotRegionLines: 80,
    cadenceSource: 'native poll planı — 3–5 Hz publish debounce',
    risk: 'P3' as const,
    f2Action: 'Sıcak bölge temiz. Dosyadaki JSON.stringify log’ları OLAY-TETİKLİ yollardadır (ECU kurtarma · durum geçişi · foreground resume) ve sıcak yol DEĞİLDİR.',
  }),
  Object.freeze({
    file: 'src/platform/mediaService.ts',
    hotRegionMarker: 'function _startInterpolation(',
    hotRegionLines: 40,
    cadenceSource: 'pozisyon interpolasyonu 2 Hz + 5 s native poll',
    risk: 'P3' as const,
    f2Action: 'Düşük frekans — koşullandırma isteğe bağlı.',
  }),
]);

/**
 * SICAK YOLDA PAHALI SAYILAN ARGÜMAN DESENLERİ.
 *
 * Bunlar `console` çağrısının ARGÜMANINDA geçtiğinde, gate çıktıyı bastırsa
 * bile iş yapılır. Kilit testi bu desenleri sıcak yol dosyalarında arar.
 */
export const EXPENSIVE_LOG_ARG_PATTERNS: readonly string[] = Object.freeze([
  'JSON.stringify',
  'Object.keys',
  'Object.entries',
  '.map(',
  '.join(',
]);

export interface HotPathLogAuditSnapshot {
  readonly surfaces: readonly HotPathSurface[];
  readonly expensivePatterns: readonly string[];
  readonly byRisk: Readonly<Record<HotPathLogRisk, number>>;
  readonly notes: readonly string[];
  readonly provenance: readonly string[];
}

/** Salt-okunur bildirim. Hiçbir dosyayı okumaz, hiçbir log’u değiştirmez. */
export function getHotPathLogAudit(): HotPathLogAuditSnapshot {
  const byRisk = { P0: 0, P1: 0, P2: 0, P3: 0 } as Record<HotPathLogRisk, number>;
  for (const s of HOT_PATH_SURFACES) byRisk[s.risk] += 1;
  return Object.freeze({
    surfaces: HOT_PATH_SURFACES,
    expensivePatterns: EXPENSIVE_LOG_ARG_PATTERNS,
    byRisk: Object.freeze(byRisk),
    notes: Object.freeze([
      'logGate ÇIKTIYI bastırır, ARGÜMAN DEĞERLENDİRMESİNİ bastırmaz.',
      'F1 hiçbir log’u DEĞİŞTİRMEDİ — bu liste F2 backlog’udur.',
      'ÖLÇÜLDÜ: dört sıcak BÖLGENİN hiçbirinde pahalı argüman deseni YOK → P0/P1 sıcak log borcu 0.',
      'DOSYA ≠ BÖLGE: obdService içindeki JSON.stringify log’ları olay-tetikli yollardadır (ECU kurtarma · durum geçişi); sıcak yol sayılmaz.',
      'Sıcak yol tanımı: kullanıcı etkileşimi olmadan saniyede birden çok kez koşan yol.',
    ]),
    provenance: Object.freeze(['perf/hotPathLogAudit.ts (statik bildirim)']),
  });
}

/** Kilit testleri için kapalı liste. */
export function hotPathSurfaces(): readonly HotPathSurface[] { return HOT_PATH_SURFACES; }
