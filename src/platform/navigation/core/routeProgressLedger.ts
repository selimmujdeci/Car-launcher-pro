/**
 * routeProgressLedger — ROTA İLERLEMESİNİN DÜRÜSTLÜĞÜ (SAF · P0-NAV-12).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK (zaman DIŞARIDAN) · React YOK ·
 * ağ YOK. Modül düzeyinde yalnız bounded sayaç/halka tutar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-12 ölçümü · 2026-08-24, koddan) ─────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * NAV-12'nin sorduğu her şey — yanlış segment seçimi · paralel yol · U dönüşü ·
 * kavşak · GPS sıçraması · düşük hız · duran araç · bayat fix · kötü doğruluk ·
 * rota gerisine düşme — `mapMatchModel` içinde ZATEN ölçülüyor ve kilitli:
 * `AMBIGUITY_SEPARATION_M` · `JUMP_FACTOR` · `REVERSE_DELTA_DEG` ·
 * `BACKWARD_SLACK_M` · `MATCH_STALE_MS` · `ACCURACY_UNCERTAIN_M` ·
 * `MIN_MATCH_CONFIDENCE`. Bu tur o katmanı YENİDEN KURMAZ.
 *
 * Ölçülen TEK boşluk şuydu: **ilerlemenin KENDİSİ hiç yargılanmıyordu.**
 * `routingService` her fix'te `progressM`i (iki fix arası yol-boyu fark) HESAPLIYOR
 * ama onu yalnız adım ilerletmede kullanıp ATIYORDU. ETA sıçramalarının defteri
 * VAR (`etaJumpLedger`); ETA'yı BESLEYEN ilerlemenin defteri YOKTU. Yani
 * "ETA 12 dakika zıpladı" görülüyor, "çünkü kalan mesafe 3 km geri gitti"
 * görülmüyordu.
 *
 * ── KÖR CLAMP YASAK (NAV-12'nin açık kuralı) ──────────────────────────────
 * İlerleme monotonik olmak ZORUNDA DEĞİLDİR: gerçek U dönüşü, kaçırılan çıkış
 * ve geri manevra rotada GERİYE gitmektir ve bu MEŞRUDUR. Bu yüzden bu modül
 * **hiçbir değeri kırpmaz, düzeltmez, bastırmaz** — yalnız SINIFLANDIRIR.
 * Kırpmak, gerçek geri dönüşü görünmez kılıp sürücüyü yanlış yönlendirirdi.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · KARAR ÜRETMEZ: reroute tetiklemez, ETA değiştirmez, konum düzeltmez.
 *  · Eşleşme güvenilir DEĞİLSE hüküm `UNKNOWN` — düşük güvenli bir fix'ten
 *    "ilerleme saçmaladı" sonucu çıkarmak, GPS gürültüsünü ürün kusuru
 *    sanmaktır.
 *  · Ölçülemeyen alan `null` — sahte 0 ilerleme YASAK.
 *  · PII TAŞIMAZ: koordinat girmez, yalnız metre/saniye/sınıf.
 */

import type { MapMatchState } from './mapMatchModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) SINIFLAR
   ══════════════════════════════════════════════════════════════════════════ */

export type ProgressVerdict =
  /** İlerleme hızla ölçülen bütçenin içinde — normal. */
  | 'PLAUSIBLE'
  /** Araç durmuş; ilerleme yok ve olması da beklenmiyor. */
  | 'STATIONARY'
  /** İleriye, hızın izin verdiğinden ÇOK fazla atladı. */
  | 'IMPLAUSIBLE_FORWARD'
  /** Geriye gitti ve yön kanıtı bunu DOĞRULUYOR — GERÇEK geri dönüş. */
  | 'REAL_BACKTRACK'
  /** Geriye gitti ama yön kanıtı YOK — eşleştirme kaymış olabilir. */
  | 'IMPLAUSIBLE_BACKWARD'
  /** Rota değişti — iki ölçüm KIYASLANAMAZ (sıçrama DEĞİLDİR). */
  | 'ROUTE_CHANGED'
  /** Kanıt yetersiz — hüküm iddia EDİLMEZ. */
  | 'UNKNOWN';

export const PROGRESS_VERDICT_LABEL: Readonly<Record<ProgressVerdict, string>> = {
  PLAUSIBLE:           'ilerleme makul',
  STATIONARY:          'araç duruyor — ilerleme beklenmiyor',
  IMPLAUSIBLE_FORWARD: 'ileriye aşırı sıçrama',
  REAL_BACKTRACK:      'gerçek geri dönüş (yön kanıtlı)',
  IMPLAUSIBLE_BACKWARD: 'geriye kayma — yön kanıtı YOK',
  ROUTE_CHANGED:       'rota değişti — kıyaslanamaz',
  UNKNOWN:             'kanıt yetersiz — hüküm iddia edilmiyor',
} as const;

/* ── Eşikler (hepsi gerekçeli) ───────────────────────────────────────────── */

/**
 * Hız bütçesinin üzerine eklenen tolerans çarpanı.
 *
 * NEDEN 2,5: GPS hızı 1 Hz'de ±%20 sapar, harita eşleştirme snap'i segment
 * geometrisine göre birkaç metre oynatır ve tick aralığı düzensizdir. 2,5 kat,
 * gerçek sürüşte YANLIŞ ALARM üretmeyecek kadar geniş; 3 km'lik bir sıçramayı
 * kaçırmayacak kadar dardır.
 */
export const PROGRESS_BUDGET_FACTOR = 2.5;

/**
 * Bütçeye eklenen sabit pay (m) — durakta ve düşük hızda snap gürültüsü.
 * Bu olmadan 0 km/h'te HER küçük oynama "aşırı sıçrama" sayılırdı.
 */
export const PROGRESS_BUDGET_SLACK_M = 60;

/**
 * Bu miktardan küçük geri gidiş GÜRÜLTÜDÜR, geri dönüş DEĞİL.
 * `mapMatchModel.BACKWARD_SLACK_M` (20 m) ile aynı ilke, biraz daha geniş:
 * orası "bu fix'i kabul edeyim mi", burası "ilerleme anormal mi" sorar.
 */
export const PROGRESS_BACKWARD_SLACK_M = 40;

/** Bu hızın altında araç DURUYOR sayılır (km/h) — snap gürültüsü ilerleme değildir. */
export const PROGRESS_STATIONARY_KMH = 3;

/**
 * Yön farkı bu dereceyi aşarsa geri gidiş YÖN KANITIYLA doğrulanmış sayılır.
 * `mapMatchModel.REVERSE_DELTA_DEG` (120°) ile AYNI sayı — iki katmanın aynı
 * "ters yön" kavramını farklı eşiklerle tanımlaması kafa karışıklığı olurdu.
 */
export const PROGRESS_REVERSE_DEG = 120;

/* ══════════════════════════════════════════════════════════════════════════
   2) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export interface ProgressSample {
  /** Önceki ölçümde rotanın SONUNA kalan mesafe (m). Yoksa `null`. */
  readonly prevRemainingM: number | null;
  /** Şimdiki kalan mesafe (m). Yoksa `null`. */
  readonly remainingM: number | null;
  /** İki ölçüm arası geçen süre (ms). Ölçülemezse `null`. */
  readonly elapsedMs: number | null;
  /** Ölçülen hız (km/h). Bilinmiyorsa `null` — sahte 0 YASAK. */
  readonly speedKmh: number | null;
  /** Araç yönü ile segment yönü farkı (0–180). Bilinmiyorsa `null`. */
  readonly headingDeltaDeg: number | null;
  readonly matchState: MapMatchState;
  /** Eşleşme güveni (0–1). */
  readonly confidence: number;
  /** Önceki ve şimdiki ölçümün rota sürümü. Farklıysa KIYASLANAMAZ. */
  readonly prevRouteRevision: number | null;
  readonly routeRevision: number | null;
}

export interface ProgressJudgement {
  readonly verdict: ProgressVerdict;
  /** İleri ilerleme (m). Negatif = geriye gitti. Ölçülemezse `null`. */
  readonly deltaM: number | null;
  /** Hızın izin verdiği en büyük ilerleme (m). Ölçülemezse `null`. */
  readonly budgetM: number | null;
  /** Bütçenin kaç katı ilerlendi. Ölçülemezse `null`. */
  readonly budgetRatio: number | null;
  readonly why: string;
}

/**
 * İki ardışık ilerleme ölçümünü yargılar. **SAF · DEĞER KIRPMAZ.**
 */
export function judgeProgress(s: ProgressSample): ProgressJudgement {
  const none = (verdict: ProgressVerdict, why: string): ProgressJudgement =>
    ({ verdict, deltaM: null, budgetM: null, budgetRatio: null, why });

  /* Rota değiştiyse iki ölçüm FARKLI polilinelerin uzunluklarıdır; farkları
     bir "sıçrama" DEĞİLDİR. Bu ayrım olmadan her reroute sahte alarm üretirdi. */
  if (s.prevRouteRevision !== null && s.routeRevision !== null
      && s.prevRouteRevision !== s.routeRevision) {
    return none('ROUTE_CHANGED', 'rota sürümü değişti — iki ölçüm kıyaslanamaz');
  }

  if (s.prevRemainingM === null || s.remainingM === null
      || !Number.isFinite(s.prevRemainingM) || !Number.isFinite(s.remainingM)) {
    return none('UNKNOWN', 'kalan mesafe ölçülmedi');
  }

  /* Eşleşme güvenilir değilse ilerleme de güvenilir değildir. Düşük güvenli bir
     fix'ten "ilerleme saçmaladı" sonucu çıkarmak, GPS gürültüsünü ürün kusuru
     sanmaktır — tam olarak kaçındığımız yanlış teşhis. */
  if (s.matchState !== 'MATCHED') {
    return none('UNKNOWN', `eşleşme durumu ${s.matchState} — ilerleme yargılanamaz`);
  }

  const deltaM = Math.round(s.prevRemainingM - s.remainingM);

  if (s.elapsedMs === null || !Number.isFinite(s.elapsedMs) || s.elapsedMs <= 0) {
    return { verdict: 'UNKNOWN', deltaM, budgetM: null, budgetRatio: null,
             why: 'geçen süre ölçülmedi — bütçe hesaplanamaz' };
  }

  /* ── GERİYE GİDİŞ ────────────────────────────────────────────────────────
     KÖR CLAMP YOK: gerçek U dönüşü rotada geriye gitmektir ve MEŞRUDUR.
     Ayırt eden tek dürüst kanıt YÖNDÜR. */
  if (deltaM < -PROGRESS_BACKWARD_SLACK_M) {
    const reversed = s.headingDeltaDeg !== null
      && Number.isFinite(s.headingDeltaDeg)
      && s.headingDeltaDeg >= PROGRESS_REVERSE_DEG;
    return {
      verdict: reversed ? 'REAL_BACKTRACK' : 'IMPLAUSIBLE_BACKWARD',
      deltaM, budgetM: null, budgetRatio: null,
      why: reversed
        ? `${-deltaM} m geriye gidildi ve yön ${Math.round(s.headingDeltaDeg as number)}° ters — GERÇEK geri dönüş`
        : `${-deltaM} m geriye gidildi ama yön kanıtı YOK — eşleştirme kaymış olabilir`,
    };
  }

  /* ── DURAN ARAÇ ──────────────────────────────────────────────────────────
     Hız BİLİNMİYORSA "duruyor" DENMEZ (sahte 0 yasağı) — hüküm bütçeye kalır. */
  const stationary = s.speedKmh !== null && Number.isFinite(s.speedKmh)
    && s.speedKmh < PROGRESS_STATIONARY_KMH;
  if (stationary && Math.abs(deltaM) <= PROGRESS_BUDGET_SLACK_M) {
    return { verdict: 'STATIONARY', deltaM, budgetM: PROGRESS_BUDGET_SLACK_M,
             budgetRatio: null,
             why: `araç ${s.speedKmh?.toFixed(1)} km/h — ${deltaM} m oynama snap gürültüsüdür` };
  }

  /* ── İLERİ BÜTÇESİ ───────────────────────────────────────────────────────
     Hız bilinmiyorsa bütçe YALNIZ sabit paydır: bilinmeyen hızdan büyük bir
     bütçe TÜRETMEK, sıçramayı meşrulaştırmak olurdu. */
  const kmh = (s.speedKmh !== null && Number.isFinite(s.speedKmh) && s.speedKmh > 0)
    ? s.speedKmh : 0;
  const budgetM = Math.round(
    (kmh / 3.6) * (s.elapsedMs / 1000) * PROGRESS_BUDGET_FACTOR + PROGRESS_BUDGET_SLACK_M,
  );
  const budgetRatio = budgetM > 0 ? Math.round((deltaM / budgetM) * 100) / 100 : null;

  if (deltaM > budgetM) {
    return {
      verdict: 'IMPLAUSIBLE_FORWARD', deltaM, budgetM, budgetRatio,
      why: `${deltaM} m ilerledi ama ${Math.round(s.elapsedMs)} ms'de `
         + `${kmh.toFixed(1)} km/h ile en fazla ${budgetM} m mümkündü`,
    };
  }

  return {
    verdict: 'PLAUSIBLE', deltaM, budgetM, budgetRatio,
    why: `${deltaM} m / ${budgetM} m bütçe`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DEFTER (bounded · fail-soft)
   ══════════════════════════════════════════════════════════════════════════ */

export interface ProgressAnomaly {
  readonly verdict: ProgressVerdict;
  readonly deltaM: number | null;
  readonly budgetM: number | null;
  readonly speedKmh: number | null;
  readonly headingDeltaDeg: number | null;
  readonly atMs: number;
}

export const PROGRESS_ANOMALY_RING = 16;

function _emptyCounts(): Record<ProgressVerdict, number> {
  return {
    PLAUSIBLE: 0, STATIONARY: 0, IMPLAUSIBLE_FORWARD: 0, REAL_BACKTRACK: 0,
    IMPLAUSIBLE_BACKWARD: 0, ROUTE_CHANGED: 0, UNKNOWN: 0,
  };
}

let _counts = _emptyCounts();
let _anomalies: ProgressAnomaly[] = [];
let _lastVerdict: ProgressVerdict | null = null;
let _maxForwardJumpM: number | null = null;
let _maxBackwardJumpM: number | null = null;

/**
 * Bir ilerleme hükmünü deftere yazar. **THROW ETMEZ.**
 * Yalnız ANORMAL hükümler halkaya girer; normal ilerleme SAYILIR ama
 * saklanmaz (halka anlamlı olayları taşısın diye).
 */
export function recordProgressJudgement(
  j: ProgressJudgement, s: ProgressSample, atMs: number,
): void {
  try {
    _counts[j.verdict] = (_counts[j.verdict] ?? 0) + 1;
    _lastVerdict = j.verdict;

    if (j.deltaM !== null) {
      if (j.deltaM > 0 && (_maxForwardJumpM === null || j.deltaM > _maxForwardJumpM)) {
        _maxForwardJumpM = j.deltaM;
      }
      if (j.deltaM < 0 && (_maxBackwardJumpM === null || -j.deltaM > _maxBackwardJumpM)) {
        _maxBackwardJumpM = -j.deltaM;
      }
    }

    const anomalous = j.verdict === 'IMPLAUSIBLE_FORWARD'
      || j.verdict === 'IMPLAUSIBLE_BACKWARD' || j.verdict === 'REAL_BACKTRACK';
    if (!anomalous) return;

    _anomalies.push({
      verdict: j.verdict, deltaM: j.deltaM, budgetM: j.budgetM,
      speedKmh: s.speedKmh, headingDeltaDeg: s.headingDeltaDeg, atMs,
    });
    if (_anomalies.length > PROGRESS_ANOMALY_RING) {
      _anomalies = _anomalies.slice(_anomalies.length - PROGRESS_ANOMALY_RING);
    }
  } catch { /* fail-soft: teşhis kaydı navigasyonu ASLA düşüremez */ }
}

export interface ProgressLedgerSnapshot {
  readonly counts: Readonly<Record<ProgressVerdict, number>>;
  readonly anomalies: readonly ProgressAnomaly[];
  readonly lastVerdict: ProgressVerdict | null;
  /** Ölçülen EN BÜYÜK ileri sıçrama (m). Ölçüm yoksa `null` — sahte 0 YASAK. */
  readonly maxForwardJumpM: number | null;
  /** Ölçülen EN BÜYÜK geri gidiş (m). Ölçüm yoksa `null`. */
  readonly maxBackwardJumpM: number | null;
  /** Yargılanan toplam örnek (`UNKNOWN` dâhil). */
  readonly totalSamples: number;
}

export function getProgressLedger(): ProgressLedgerSnapshot {
  let total = 0;
  for (const k of Object.keys(_counts) as ProgressVerdict[]) total += _counts[k];
  return {
    counts: { ..._counts },
    anomalies: _anomalies.slice(),
    lastVerdict: _lastVerdict,
    maxForwardJumpM: _maxForwardJumpM,
    maxBackwardJumpM: _maxBackwardJumpM,
    totalSamples: total,
  };
}

/** Yeni rota/oturum — ilerleme geçmişi TAŞINMAZ (eski rotanın sıçraması yenisine yazılmaz). */
export function resetProgressLedger(): void {
  _counts = _emptyCounts();
  _anomalies = [];
  _lastVerdict = null;
  _maxForwardJumpM = null;
  _maxBackwardJumpM = null;
}

export const _resetProgressLedgerForTest = resetProgressLedger;
