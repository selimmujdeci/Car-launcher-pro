/**
 * pidTimingExperimentModel — H-A deneyinin SAF analiz katmanı (kütük #518-HA).
 *
 * ── DENEYİN SORUSU ──────────────────────────────────────────────────────────
 * Sahada extended PID denemelerinin **%50'si NO_DATA** dönüyor. Kök neden adayı:
 * CAN'de `ATST` hiç ayarlanmadığı için ELM327 varsayılan ~200 ms tavanıyla
 * bekliyor ve **ECU cevap vermeye hazırlanırken adaptör pes ediyor**. Deney aynı
 * bağlantıda iki aşama koşar (A: mevcut ayar · B: `ATST` uzatılmış) ve PID başına
 * süre dağılımını ölçer.
 *
 * ── BU DOSYA NİYE SAF ───────────────────────────────────────────────────────
 * Native yalnız HAM örnek taşır (`phase · pid · outcome · elapsedMs`). Yüzdelik,
 * oran ve hüküm burada hesaplanır: böylece analiz **cihaz olmadan** birim testle
 * doğrulanabilir ve bir daha APK derlemeden değiştirilebilir.
 *
 * ── DÜRÜSTLÜK KURALLARI ─────────────────────────────────────────────────────
 *  · Örnek yoksa yüzdelik `null` — sahte 0 ÜRETİLMEZ.
 *  · Aşamalardan biri eksikse karşılaştırma hükmü VERİLMEZ.
 *  · Yüzdelik yöntemi AÇIKÇA yazılır (en yakın sıra, interpolasyon YOK) — küçük
 *    örneklemde interpolasyon sahte hassasiyettir.
 *  · Hüküm eşiği tek sayı değil; iyileşme hem ORAN hem ANLAMLILIK ister.
 */

/* ── Ham girdi (native'den) ───────────────────────────────────────────────── */

export type ExperimentPhase = 'A' | 'B';

export interface PidTimingSample {
  readonly phase:     string;
  readonly pid:       string;
  readonly outcome:   string;   // OK · NO_DATA · NEG_7F · BUSY · ERROR · TIMEOUT_PARTIAL · OTHER
  readonly elapsedMs: number;
  readonly respLen:   number;
}

export interface PidTimingPhaseMeta {
  readonly phase:       string;
  readonly stApplied:   string;   // 'default' | 'FF' …
  readonly stCommandOk: boolean;
  readonly startedAt:   number;
  readonly finishedAt:  number;
}

export interface PidTimingRaw {
  readonly status:     string;    // idle · running · done · failed · aborted
  readonly running?:   boolean;
  readonly failReason?: string | null;
  readonly phases:     readonly PidTimingPhaseMeta[];
  readonly samples:    readonly PidTimingSample[];
}

/* ── Çıktı ────────────────────────────────────────────────────────────────── */

export interface DurationStats {
  readonly count: number;
  /** Örnek yoksa `null` — sahte 0 YOK. */
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

export interface PidPhaseStats {
  readonly pid:          string;
  readonly phase:        ExperimentPhase;
  readonly attempts:     number;
  readonly success:      number;
  readonly noData:       number;
  readonly other:        number;
  /** Örnek yoksa `null`. */
  readonly noDataRate:   number | null;
  readonly successMs:    DurationStats;
  readonly noDataMs:     DurationStats;
}

export interface PidComparison {
  readonly pid:            string;
  readonly a:              PidPhaseStats | null;
  readonly b:              PidPhaseStats | null;
  /** B − A (negatif = iyileşme). İki aşama da yoksa `null`. */
  readonly noDataRateDelta: number | null;
  /** Bu PID bekleme süresi uzayınca kurtuldu mu? */
  readonly verdict:        PidVerdict;
}

export type PidVerdict =
  | 'ELCILMEDI'          // iki aşamada da ölçüm yok
  | 'ZATEN_SAGLAM'       // A'da da NO_DATA yok
  | 'SURE_ILE_KURTULDU'  // A'da kayıp vardı, B'de belirgin azaldı
  | 'DEGISMEDI'          // uzatma fark etmedi
  | 'KOTULESTI';         // B'de kayıp arttı (gürültü/başka sebep)

export interface PhaseTotals {
  readonly phase:      ExperimentPhase;
  readonly stApplied:  string;
  readonly attempts:   number;
  readonly success:    number;
  readonly noData:     number;
  readonly noDataRate: number | null;
  readonly successMs:  DurationStats;
  readonly noDataMs:   DurationStats;
  /** Aşamanın toplam süresi (ms) — meta yoksa `null`. */
  readonly wallMs:     number | null;
}

export type ExperimentVerdict =
  | 'OLCUM_YOK'
  | 'EKSIK_ASAMA'
  | 'ATST_KOKTU'        // H-A doğrulandı: süre uzayınca kayıp belirgin azaldı
  | 'ATST_KOK_DEGIL'    // uzatma fark etmedi → başka kök
  | 'BELIRSIZ';

export interface PidTimingReport {
  readonly status:      string;
  readonly failReason:  string | null;
  readonly totals:      readonly PhaseTotals[];
  readonly perPid:      readonly PidComparison[];
  /** 0x23 ayrı raporlanır — deneyin en somut hedefi (Car Scanner okuyor, biz okumuyoruz). */
  readonly target23:    PidComparison | null;
  readonly verdict:     ExperimentVerdict;
  readonly verdictNote: string;
}

/* ── Eşikler (açıkça isimli — koda gömülü sihirli sayı yok) ───────────────── */

/** Bir PID'in "kurtuldu" sayılması için NO_DATA oranındaki en az mutlak düşüş. */
export const RESCUE_MIN_DROP = 0.30;
/** Deney hükmü için en az örnek (aşama başına). */
export const MIN_SAMPLES_PER_PHASE = 20;
/** Genel hüküm "ATST kök" için toplam NO_DATA oranındaki en az düşüş. */
export const VERDICT_MIN_DROP = 0.20;

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/**
 * En yakın-sıra yüzdeliği. İNTERPOLASYON YOK: 20 örneklik bir kümede
 * interpolasyon, olmayan bir hassasiyet iddia eder.
 */
function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

function statsOf(values: readonly number[]): DurationStats {
  const s = values.filter((v) => Number.isFinite(v) && v >= 0).slice().sort((a, b) => a - b);
  return {
    count: s.length,
    p50: percentile(s, 0.50),
    p95: percentile(s, 0.95),
    max: s.length > 0 ? s[s.length - 1] : null,
  };
}

function isPhase(v: string): v is ExperimentPhase {
  return v === 'A' || v === 'B';
}

/* ── PID × aşama istatistiği ──────────────────────────────────────────────── */

function pidPhaseStats(
  pid: string, phase: ExperimentPhase, samples: readonly PidTimingSample[],
): PidPhaseStats {
  const mine = samples.filter((s) => s.pid === pid && s.phase === phase);
  const success = mine.filter((s) => s.outcome === 'OK');
  const noData  = mine.filter((s) => s.outcome === 'NO_DATA');
  const other   = mine.length - success.length - noData.length;
  return {
    pid, phase,
    attempts: mine.length,
    success:  success.length,
    noData:   noData.length,
    other,
    noDataRate: mine.length > 0 ? noData.length / mine.length : null,
    successMs: statsOf(success.map((s) => s.elapsedMs)),
    noDataMs:  statsOf(noData.map((s) => s.elapsedMs)),
  };
}

function pidVerdict(a: PidPhaseStats | null, b: PidPhaseStats | null): PidVerdict {
  if (!a || !b || a.attempts === 0 || b.attempts === 0) return 'ELCILMEDI';
  const ra = a.noDataRate;
  const rb = b.noDataRate;
  if (ra === null || rb === null) return 'ELCILMEDI';
  if (ra === 0) return 'ZATEN_SAGLAM';
  const drop = ra - rb;
  if (drop >= RESCUE_MIN_DROP) return 'SURE_ILE_KURTULDU';
  if (rb - ra >= RESCUE_MIN_DROP) return 'KOTULESTI';
  return 'DEGISMEDI';
}

/* ── Ana giriş ────────────────────────────────────────────────────────────── */

export function buildPidTimingReport(raw: PidTimingRaw | null | undefined): PidTimingReport {
  const samples = (raw?.samples ?? []).filter((s) => s && isPhase(s.phase));
  const phasesMeta = raw?.phases ?? [];
  const status = raw?.status ?? 'idle';
  const failReason = raw?.failReason ?? null;

  const pids = Array.from(new Set(samples.map((s) => s.pid))).sort();

  const totals: PhaseTotals[] = (['A', 'B'] as ExperimentPhase[]).map((ph) => {
    const mine = samples.filter((s) => s.phase === ph);
    const success = mine.filter((s) => s.outcome === 'OK');
    const noData  = mine.filter((s) => s.outcome === 'NO_DATA');
    const meta = phasesMeta.find((m) => m.phase === ph) ?? null;
    const wall = meta && meta.finishedAt > 0 && meta.startedAt > 0
      ? meta.finishedAt - meta.startedAt : null;
    return {
      phase: ph,
      stApplied: meta?.stApplied ?? 'UNKNOWN',
      attempts: mine.length,
      success: success.length,
      noData: noData.length,
      noDataRate: mine.length > 0 ? noData.length / mine.length : null,
      successMs: statsOf(success.map((s) => s.elapsedMs)),
      noDataMs:  statsOf(noData.map((s) => s.elapsedMs)),
      wallMs: wall,
    };
  });

  const perPid: PidComparison[] = pids.map((pid) => {
    const a = pidPhaseStats(pid, 'A', samples);
    const b = pidPhaseStats(pid, 'B', samples);
    const delta = (a.noDataRate !== null && b.noDataRate !== null)
      ? b.noDataRate - a.noDataRate : null;
    return {
      pid,
      a: a.attempts > 0 ? a : null,
      b: b.attempts > 0 ? b : null,
      noDataRateDelta: delta,
      verdict: pidVerdict(a.attempts > 0 ? a : null, b.attempts > 0 ? b : null),
    };
  });

  const tA = totals[0];
  const tB = totals[1];
  let verdict: ExperimentVerdict = 'BELIRSIZ';
  let note = '';
  if (samples.length === 0) {
    verdict = 'OLCUM_YOK';
    note = 'Hiç örnek yok — deney koşmadı ya da sonuç okunamadı.';
  } else if (tA.attempts < MIN_SAMPLES_PER_PHASE || tB.attempts < MIN_SAMPLES_PER_PHASE) {
    verdict = 'EKSIK_ASAMA';
    note = `Aşama başına en az ${MIN_SAMPLES_PER_PHASE} örnek gerekir (A=${tA.attempts}, B=${tB.attempts}).`;
  } else if (tA.noDataRate === null || tB.noDataRate === null) {
    verdict = 'BELIRSIZ';
    note = 'Oran hesaplanamadı.';
  } else {
    const drop = tA.noDataRate - tB.noDataRate;
    if (drop >= VERDICT_MIN_DROP) {
      verdict = 'ATST_KOKTU';
      note = `NO_DATA oranı %${(tA.noDataRate * 100).toFixed(0)} → %${(tB.noDataRate * 100).toFixed(0)} `
           + `(${(drop * 100).toFixed(0)} puan düştü) — bekleme süresi kökün kendisiydi.`;
    } else if (Math.abs(drop) < VERDICT_MIN_DROP) {
      verdict = 'ATST_KOK_DEGIL';
      note = `NO_DATA oranı anlamlı değişmedi (%${(tA.noDataRate * 100).toFixed(0)} → `
           + `%${(tB.noDataRate * 100).toFixed(0)}) — kök BAŞKA yerde; eşik tartışması yeniden açılır.`;
    } else {
      verdict = 'BELIRSIZ';
      note = 'Oran KÖTÜLEŞTİ — gürültü ya da başka bir etken; deney tekrarlanmalı.';
    }
  }

  return {
    status,
    failReason,
    totals,
    perPid,
    target23: perPid.find((p) => p.pid === '23') ?? null,
    verdict,
    verdictNote: note,
  };
}

export const EXPERIMENT_VERDICT_LABEL: Readonly<Record<ExperimentVerdict, string>> = {
  OLCUM_YOK:      'ÖLÇÜM YOK — deney koşmadı',
  EKSIK_ASAMA:    'EKSİK AŞAMA — hüküm verilmez',
  ATST_KOKTU:     'ATST KÖKTÜ — bekleme süresi uzayınca kayıp belirgin azaldı',
  ATST_KOK_DEGIL: 'ATST KÖK DEĞİL — uzatma fark etmedi, kök başka yerde',
  BELIRSIZ:       'BELİRSİZ — tekrar gerekiyor',
};

export const PID_VERDICT_LABEL: Readonly<Record<PidVerdict, string>> = {
  ELCILMEDI:         'ölçülmedi',
  ZATEN_SAGLAM:      'zaten sağlam (A\'da kayıp yok)',
  SURE_ILE_KURTULDU: 'SÜRE İLE KURTULDU',
  DEGISMEDI:         'değişmedi',
  KOTULESTI:         'kötüleşti',
};
