/**
 * fixAgeLedger.ts — KONUM FIX YAŞININ DAĞILIM DEFTERİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK.
 * Zaman ve girdiler dışarıdan verilir → cihazsız test edilebilir.
 * (`etaJumpLedger`in ikizi — aynı desen, aynı dürüstlük kuralları.)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN (GÖREV B · kütük #537 · kabul ölçütü #508) ──────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * #508'in kabul ölçütü bir DAĞILIM ister: `p50 < 3 s ∧ p95 < 10 s`. Sahada
 * (2026-08-11) kopyaya YALNIZ TEK ANLIK örnek düştü:
 *
 *     fixAgeMs: 5237          ← tek örnek
 *
 * Eski taban p50 **19,5 s**; 5,2 s daha iyi GÖRÜNÜYOR ama **tek örnekten p50
 * çıkmaz**. Yani #508 ölçülemedi ve iki saha koşumu bu yüzden kapanış
 * üretemedi. Defter tam bu boşluğu kapatır: bounded halka + saf yüzdelik
 * hesabı + kopyaya giden bölüm.
 *
 * ── ÖRNEKLEME MODELİ DÜRÜSTÇE BEYAN EDİLİR ────────────────────────────────
 * Örnekler `gpsService.getLocationEvidence()` **tüketici okumalarında** alınır;
 * yeni bir timer KURULMAZ (Zero-Leak). Bu, zaman ekseninde DÜZGÜN dağılmış bir
 * örnekleme DEĞİLDİR: okuma sıklığı yüksekken o dönem daha ağır tartılır.
 * Bu yüzden özet, okuma aralığının kendi p50/p95'ini de verir → yanlılık
 * GÖRÜNÜR olur. Gizlenen bir varsayım yoktur.
 *
 * ── BU DEFTERİN SINIRI ────────────────────────────────────────────────────
 * #508'in ÜÇÜNCÜ ölçütü (`iz/gerçek yol > 0,9`) burada ÖLÇÜLMEZ: gerçek yol
 * uzunluğu bu defterin girdisinde yoktur. `trackRatioMeasured: false` ile
 * açıkça beyan edilir — "ölçtük" izlenimi ÜRETİLMEZ, hüküm de bu ölçüte dair
 * bir şey İDDİA ETMEZ.
 */

/** Halka tavanı — sınırsız örnek cihazda bellek sorunudur (~240 örnek ≈ 4-20 dk). */
export const FIX_AGE_RING = 240;

/**
 * Hüküm için gereken en az örnek sayısı.
 *
 * "Tek örnekten p50 çıkmaz" dersi (#535) burada SABİTLENİR: bu sayının altında
 * defter `INSUFFICIENT_SAMPLES` döner ve p50/p95 hesaplansa bile HÜKÜM VERMEZ.
 */
export const FIX_AGE_MIN_SAMPLES = 30;

/** #508 kabul ölçütü — ortanca fix yaşı hedefi (ms). */
export const FIX_AGE_P50_TARGET_MS = 3_000;
/** #508 kabul ölçütü — p95 fix yaşı hedefi (ms). */
export const FIX_AGE_P95_TARGET_MS = 10_000;

/** Tek ölçüm: fix yaşı + ölçümün MONOTONİK anı (okuma kadansı bundan türer). */
export interface FixAgeSample {
  /** Fix yaşı (ms) — tek otoriteden (`getLocationEvidence().fixAgeMs`). */
  readonly ageMs: number;
  /** Okuma anı — MONOTONİK (`performance.now()`). Duvar saati KULLANILMAZ. */
  readonly atPerfMs: number;
}

export type FixAgeVerdict =
  /** p50 ve p95 hedeflerin altında — #508'in ilk iki ölçütü SAĞLANDI. */
  | 'PASS'
  /** En az bir hedef aşıldı. */
  | 'FAIL'
  /** Örnek sayısı hüküm için yetersiz — "geçti" de "düştü" de DENMEZ. */
  | 'INSUFFICIENT_SAMPLES';

export const FIX_AGE_VERDICT_LABEL: Readonly<Record<FixAgeVerdict, string>> = {
  PASS:                 'GEÇTİ (p50 ve p95 hedefin altında)',
  FAIL:                 'DÜŞTÜ (hedef aşıldı)',
  INSUFFICIENT_SAMPLES: 'ÖLÇÜM YETERSİZ (hüküm verilmez)',
} as const;

export interface FixAgeSummary {
  readonly count: number;
  /** Yüzdelikler (ms) — örnek yoksa `null` (sahte 0 YASAK). */
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly minMs: number | null;
  readonly maxMs: number | null;
  /** Eşiği aşan örneklerin payı (0-1) — bayat okuma oranı. `null` = örnek yok. */
  readonly staleShare: number | null;
  /** İlk ve son örnek arasındaki süre (ms) — ölçüm penceresi. */
  readonly spanMs: number | null;
  /**
   * OKUMA ARALIĞININ kendi yüzdelikleri (ms). Örnekleme zaman ekseninde düzgün
   * DEĞİLDİR; bu iki sayı yanlılığın büyüklüğünü okuyucuya gösterir.
   */
  readonly readGapP50Ms: number | null;
  readonly readGapP95Ms: number | null;
  /** Örneklerin nereden alındığı — varsayım gizlenmez. */
  readonly samplingModel: 'CONSUMER_READ';
  readonly verdict: FixAgeVerdict;
  readonly verdictNote: string;
  /**
   * #508'in üçüncü ölçütü (iz/gerçek yol > 0,9) bu defterde ÖLÇÜLMEZ.
   * Sabit `false` — "ölçtük" izlenimi üretmemek için alan BİLİNÇLİ olarak var.
   */
  readonly trackRatioMeasured: false;
}

/** Bounded halka — en YENİ örnekler korunur. */
export function appendFixAge(
  ring: readonly FixAgeSample[], sample: FixAgeSample,
): FixAgeSample[] {
  /* Geçersiz ölçüm defteri KİRLETMEZ: negatif/NaN yaş bir ölçüm değildir. */
  if (!Number.isFinite(sample.ageMs) || sample.ageMs < 0) return ring.slice();
  if (!Number.isFinite(sample.atPerfMs)) return ring.slice();
  const out = [...ring, sample];
  return out.length > FIX_AGE_RING ? out.slice(out.length - FIX_AGE_RING) : out;
}

/**
 * En yakın-sıra (nearest-rank) yüzdelik. Küçük örneklemde enterpolasyon
 * uydurma bir hassasiyet izlenimi verir → bilinçli olarak KULLANILMAZ.
 */
function _percentile(sortedAsc: readonly number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/**
 * Dağılım özeti + #508 hükmü.
 *
 * @param staleThresholdMs Bayatlık eşiği — çağıran TEK OTORİTEDEN verir
 *   (`gpsService.LOCATION_STALE_MS`). Bu modül kendi eşiğini TAŞIMAZ; ikinci
 *   bir eşik otoritesi doğmasın (kasa KİLİT 28 ile aynı ilke).
 */
export function summarizeFixAge(
  ring: readonly FixAgeSample[], staleThresholdMs: number,
): FixAgeSummary {
  const count = ring.length;
  if (count === 0) {
    return {
      count: 0, p50Ms: null, p95Ms: null, minMs: null, maxMs: null,
      staleShare: null, spanMs: null, readGapP50Ms: null, readGapP95Ms: null,
      samplingModel: 'CONSUMER_READ',
      verdict: 'INSUFFICIENT_SAMPLES',
      verdictNote: 'hiç örnek yok — #508 hakkında hüküm verilemez',
      trackRatioMeasured: false,
    };
  }

  const ages = ring.map((s) => s.ageMs).sort((a, b) => a - b);
  const p50Ms = _percentile(ages, 50);
  const p95Ms = _percentile(ages, 95);

  const gaps: number[] = [];
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i].atPerfMs - ring[i - 1].atPerfMs;
    if (Number.isFinite(d) && d >= 0) gaps.push(Math.round(d));
  }
  gaps.sort((a, b) => a - b);

  const staleCount = Number.isFinite(staleThresholdMs) && staleThresholdMs > 0
    ? ages.filter((a) => a > staleThresholdMs).length
    : 0;

  const rawSpan = ring[ring.length - 1].atPerfMs - ring[0].atPerfMs;
  const spanMs = Number.isFinite(rawSpan) && rawSpan >= 0 ? Math.round(rawSpan) : null;

  let verdict: FixAgeVerdict;
  let verdictNote: string;
  if (count < FIX_AGE_MIN_SAMPLES) {
    verdict = 'INSUFFICIENT_SAMPLES';
    verdictNote = `${count}/${FIX_AGE_MIN_SAMPLES} örnek — dağılım hükmü için YETERSİZ `
                + '(tek/az örnekten p50 çıkmaz: #535 dersi)';
  } else if (p50Ms !== null && p95Ms !== null
             && p50Ms < FIX_AGE_P50_TARGET_MS && p95Ms < FIX_AGE_P95_TARGET_MS) {
    verdict = 'PASS';
    verdictNote = `p50 ${p50Ms} ms < ${FIX_AGE_P50_TARGET_MS} ∧ p95 ${p95Ms} ms < ${FIX_AGE_P95_TARGET_MS}`
                + ' · ⚠️ #508\'in üçüncü ölçütü (iz/gerçek yol) BU DEFTERDE ÖLÇÜLMEZ';
  } else {
    verdict = 'FAIL';
    verdictNote = `p50 ${p50Ms} ms (hedef <${FIX_AGE_P50_TARGET_MS}) · `
                + `p95 ${p95Ms} ms (hedef <${FIX_AGE_P95_TARGET_MS})`;
  }

  return {
    count,
    p50Ms, p95Ms,
    minMs: ages[0],
    maxMs: ages[ages.length - 1],
    staleShare: Math.round((staleCount / count) * 1000) / 1000,
    spanMs,
    readGapP50Ms: _percentile(gaps, 50),
    readGapP95Ms: _percentile(gaps, 95),
    samplingModel: 'CONSUMER_READ',
    verdict,
    verdictNote,
    trackRatioMeasured: false,
  };
}
