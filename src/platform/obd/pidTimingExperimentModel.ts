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

export type ExperimentPhase = 'A' | 'B' | 'A2';

export interface PidTimingSample {
  readonly phase:     string;
  readonly pid:       string;
  readonly outcome:   string;   // OK · NO_DATA · NEG_7F · BUSY · ERROR · TIMEOUT_PARTIAL · OTHER
  /** SAF komut süresi — kuyruk beklemesi HARİÇ (B4). */
  readonly elapsedMs: number;
  /** Komutun kuyrukta beklediği süre (B4). -1/eksik = ölçülemedi. */
  readonly queueWaitMs?: number;
  readonly respLen:   number;
}

export interface PidTimingPhaseMeta {
  readonly phase:       string;   // 'A' | 'B' | 'A2'
  readonly stApplied:   string;   // 'default' | 'FF' | '32'
  readonly stCommandOk: boolean;
  readonly startedAt:   number;
  readonly finishedAt:  number;
  /** Baglantidan kac ms sonra basladi — hukmun PARCASI. -1/eksik = bilinmiyor. */
  readonly sinceConnectMs?: number;
  /** Bu aşamada kullanılan okuma deadline'ı (B2). */
  readonly readDeadlineMs?: number;
}

export interface PidTimingRaw {
  readonly status:     string;    // idle · running · done · failed · aborted
  readonly running?:   boolean;
  readonly failReason?: string | null;
  readonly phases:     readonly PidTimingPhaseMeta[];
  readonly samples:    readonly PidTimingSample[];
  /** ATST geri alma sonucu (B7): 'true' | 'false' | 'UNKNOWN'. Sessiz yutma YOK. */
  readonly stRestored?: string;
  /** Deney penceresi (B5) — sonraki saha okumaları bu trafiği ayırabilsin. */
  readonly experimentStartMs?: number;
  readonly experimentEndMs?:   number;
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
  readonly successRate:  number | null;
  readonly successMs:    DurationStats;
  readonly noDataMs:     DurationStats;
}

export interface PidComparison {
  readonly pid:            string;
  readonly a:              PidPhaseStats | null;
  readonly b:              PidPhaseStats | null;
  /** Kontrol aşaması (ATST geri alınmış) — üç aşamalı tasarımın ayırt edici ayağı. */
  readonly a2:             PidPhaseStats | null;
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
  /** ATST komutu 'OK' döndü mü. Klon adaptör bilinmeyen komuta da OK der → TEK BAŞINA KANIT DEĞİL. */
  readonly stCommandOk: boolean | null;
  readonly attempts:   number;
  readonly success:    number;
  readonly noData:     number;
  /** B2 — OK ve NO_DATA DIŞINDA kalanlar (7F/BUSY/ERROR/TIMEOUT). Sınıf kayması burada görünür. */
  readonly other:      number;
  readonly noDataRate: number | null;
  /** B2 — NO_DATA düşüşü OK ARTIŞIYLA karşılanmalı; başka sınıfa kaymayla değil. */
  readonly successRate: number | null;
  readonly successMs:  DurationStats;
  readonly noDataMs:   DurationStats;
  /** B2 — 'other' sınıfının süre dağılımı. */
  readonly otherMs:    DurationStats;
  /** B4 — kuyrukta bekleme dağılımı (rotasyon tasarımının girdisi). */
  readonly queueWaitMs: DurationStats;
  /** B2 — bu aşamada kullanılan okuma deadline'ı. */
  readonly readDeadlineMs: number | null;
  /** Aşamanın toplam süresi (ms) — meta yoksa `null`. */
  readonly wallMs:     number | null;
  /** Bağlantıdan kaç ms sonra başladı — zaman ekseni. Bilinmiyorsa `null`. */
  readonly sinceConnectMs: number | null;
}

export type ExperimentVerdict =
  | 'OLCUM_YOK'
  | 'EKSIK_ASAMA'
  /** A kötü · B iyi · A' YİNE KÖTÜ → düzelme ATST'den geldi, geri alınınca kayboldu. */
  | 'ATST_KOKTU'
  /** Üç aşama benzer → uzatma fark etmedi, kök başka yerde. */
  | 'ATST_KOK_DEGIL'
  /** A kötü · B iyi · A' DE İYİ → düzelme ZAMANDAN; ATST'nin katkısı BELİRSİZ. */
  | 'ZAMAN_ETKISI'
  /**
   * B1 — ATST'nin GERÇEKTEN uygulandığı gösterilemedi → hüküm VERİLMEZ.
   * Klon adaptör bilinmeyen komuta da "OK" der; "OK" ayarın uygulandığını KANITLAMAZ.
   * Bağımsız kanıt: B aşamasında NO_DATA süresi (p50) A'ya göre en az İKİ KATINA
   * çıkmalıdır — çünkü uzayan bekleme, cevapsız sorguda DOĞRUDAN süreye yansır.
   */
  | 'ATST_UYGULANMADI'
  | 'BELIRSIZ';

export interface PidTimingReport {
  readonly status:      string;
  readonly failReason:  string | null;
  /** B7 — ATST geri alma sonucu: 'true' | 'false' | 'UNKNOWN'. */
  readonly stRestored:  string;
  /** B1 — ATST'nin uygulandığına dair BAĞIMSIZ kanıt (süre oranı). Ölçülemezse null. */
  readonly atstEvidenceRatio: number | null;
  /** B5 — deney penceresi; sonraki saha okumaları bu trafiği ayırabilsin. */
  readonly windowStartMs: number | null;
  readonly windowEndMs:   number | null;
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
/** Deney hükmü için en az örnek (aşama başına) — PID listesi bilinmiyorsa taban. */
export const MIN_SAMPLES_PER_PHASE = 20;
/** B7 — aşama başına gereken TAM tur sayısı (kısmi aşamayla hüküm verilmez). */
export const MIN_ROUNDS_PER_PHASE = 20;
/** Genel hüküm "ATST kök" için toplam NO_DATA oranındaki en az düşüş. */
export const VERDICT_MIN_DROP = 0.20;
/**
 * B1 — ATST'nin uygulandığının BAĞIMSIZ kanıtı: B aşamasında NO_DATA süresi (p50)
 * A'ya göre en az bu KAT kadar artmalı. Cevapsız sorguda adaptör tavana kadar bekler,
 * yani uzayan ST doğrudan süreye yansır. Yansımıyorsa ayar geçmemiştir.
 */
export const ATST_APPLIED_MIN_RATIO = 2.0;

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
  return v === 'A' || v === 'B' || v === 'A2';
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
    noDataRate:  mine.length > 0 ? noData.length / mine.length : null,
    successRate: mine.length > 0 ? success.length / mine.length : null,
    successMs: statsOf(success.map((s) => s.elapsedMs)),
    noDataMs:  statsOf(noData.map((s) => s.elapsedMs)),
  };
}

/**
 * B6 — PID hükmü artık A' (kontrol) aşamasını da alır: bir PID'in "süre ile
 * kurtulduğu" ancak ATST GERİ ALININCA kaybın GERİ DÖNMESİYLE söylenebilir.
 * Geri dönmüyorsa iyileşme zamandan gelmiştir; o PID için hüküm 'DEGISMEDI'dir.
 *
 * ⚠️ PID başına satırlar YÖN GÖSTERİR, HÜKÜM DEĞİLDİR: PID başına örnek sayısı
 * (tur sayısı) küçüktür; istatistiksel hüküm YALNIZ toplamda verilir.
 */
function pidVerdict(
  a: PidPhaseStats | null, b: PidPhaseStats | null, a2: PidPhaseStats | null,
): PidVerdict {
  if (!a || !b || a.attempts === 0 || b.attempts === 0) return 'ELCILMEDI';
  const ra = a.noDataRate;
  const rb = b.noDataRate;
  if (ra === null || rb === null) return 'ELCILMEDI';
  if (ra === 0) return 'ZATEN_SAGLAM';
  const drop = ra - rb;
  if (rb - ra >= RESCUE_MIN_DROP) return 'KOTULESTI';
  if (drop >= RESCUE_MIN_DROP) {
    /* Kurtuluş iddiası A' ile SINANIR — kontrol yoksa iddia edilmez. */
    const r2 = a2?.noDataRate ?? null;
    if (r2 === null) return 'DEGISMEDI';
    return (r2 - rb >= RESCUE_MIN_DROP) ? 'SURE_ILE_KURTULDU' : 'DEGISMEDI';
  }
  return 'DEGISMEDI';
}

/* ── Ana giriş ────────────────────────────────────────────────────────────── */

export function buildPidTimingReport(raw: PidTimingRaw | null | undefined): PidTimingReport {
  const samples = (raw?.samples ?? []).filter((s) => s && isPhase(s.phase));
  const phasesMeta = raw?.phases ?? [];
  const status = raw?.status ?? 'idle';
  const failReason = raw?.failReason ?? null;
  const stRestored = typeof raw?.stRestored === 'string' ? raw.stRestored : 'UNKNOWN';
  const windowStartMs = typeof raw?.experimentStartMs === 'number' && raw.experimentStartMs > 0
    ? raw.experimentStartMs : null;
  const windowEndMs = typeof raw?.experimentEndMs === 'number' && raw.experimentEndMs > 0
    ? raw.experimentEndMs : null;

  const pids = Array.from(new Set(samples.map((s) => s.pid))).sort();

  const totals: PhaseTotals[] = (['A', 'B', 'A2'] as ExperimentPhase[]).map((ph) => {
    const mine = samples.filter((s) => s.phase === ph);
    const success = mine.filter((s) => s.outcome === 'OK');
    const noData  = mine.filter((s) => s.outcome === 'NO_DATA');
    const meta = phasesMeta.find((m) => m.phase === ph) ?? null;
    const wall = meta && meta.finishedAt > 0 && meta.startedAt > 0
      ? meta.finishedAt - meta.startedAt : null;
    const other = mine.filter((s) => s.outcome !== 'OK' && s.outcome !== 'NO_DATA');
    return {
      phase: ph,
      stApplied: meta?.stApplied ?? 'UNKNOWN',
      stCommandOk: meta ? meta.stCommandOk === true : null,
      attempts: mine.length,
      success: success.length,
      noData: noData.length,
      other: other.length,
      noDataRate:  mine.length > 0 ? noData.length / mine.length : null,
      successRate: mine.length > 0 ? success.length / mine.length : null,
      successMs: statsOf(success.map((s) => s.elapsedMs)),
      noDataMs:  statsOf(noData.map((s) => s.elapsedMs)),
      otherMs:   statsOf(other.map((s) => s.elapsedMs)),
      queueWaitMs: statsOf(mine.map((s) => (typeof s.queueWaitMs === 'number' ? s.queueWaitMs : -1))),
      readDeadlineMs: (meta && typeof meta.readDeadlineMs === 'number' && meta.readDeadlineMs > 0)
        ? meta.readDeadlineMs : null,
      wallMs: wall,
      sinceConnectMs: (meta && typeof meta.sinceConnectMs === 'number' && meta.sinceConnectMs >= 0)
        ? meta.sinceConnectMs : null,
    };
  });

  const perPid: PidComparison[] = pids.map((pid) => {
    const a  = pidPhaseStats(pid, 'A',  samples);
    const b  = pidPhaseStats(pid, 'B',  samples);
    const a2 = pidPhaseStats(pid, 'A2', samples);
    const delta = (a.noDataRate !== null && b.noDataRate !== null)
      ? b.noDataRate - a.noDataRate : null;
    return {
      pid,
      a:  a.attempts  > 0 ? a  : null,
      b:  b.attempts  > 0 ? b  : null,
      a2: a2.attempts > 0 ? a2 : null,
      noDataRateDelta: delta,
      verdict: pidVerdict(a.attempts > 0 ? a : null, b.attempts > 0 ? b : null,
                          a2.attempts > 0 ? a2 : null),
    };
  });

  const tA  = totals[0];
  const tB  = totals[1];
  const tA2 = totals[2];

  /* B7 — TAM TUR eşiği: kısmi aşamayla hüküm verilmez. Beklenen deneme sayısı
     PID sayısı × MIN_ROUNDS'tur; yarıda kesilmiş bir aşama "yeterli örnek" SAYILMAZ. */
  const pidCount = pids.length;
  const requiredPerPhase = pidCount > 0
    ? pidCount * MIN_ROUNDS_PER_PHASE
    : MIN_SAMPLES_PER_PHASE;

  /* B1 — ATST uygulandı mı? BAĞIMSIZ kanıt: cevapsız sorguda adaptör tavana kadar
     bekler → uzayan ST doğrudan NO_DATA süresine yansır. "OK" yanıtı KANIT DEĞİL. */
  const ndA = tA.noDataMs.p50;
  const ndB = tB.noDataMs.p50;
  const atstEvidenceRatio = (ndA !== null && ndA > 0 && ndB !== null) ? ndB / ndA : null;

  let verdict: ExperimentVerdict = 'BELIRSIZ';
  let note = '';
  if (samples.length === 0) {
    verdict = 'OLCUM_YOK';
    note = 'Hiç örnek yok — deney koşmadı ya da sonuç okunamadı.';
  } else if (tA.attempts < requiredPerPhase || tB.attempts < requiredPerPhase) {
    verdict = 'EKSIK_ASAMA';
    note = `Aşama başına TAM tur gerekir (${pidCount} PID × ${MIN_ROUNDS_PER_PHASE} tur = `
         + `${requiredPerPhase} deneme). Gelen: A=${tA.attempts}, B=${tB.attempts}. `
         + 'Kısmi aşamayla hüküm VERİLMEZ.';
  } else if (tA2.attempts < requiredPerPhase) {
    /* UCUNCU ASAMA SART: A -> B sirasi ZAMANIN etkisini ATST'ninkinden AYIRAMAZ.
       Hat kendiliginden oturduysa B zaten iyi cikar — ATST hicbir sey yapmasa bile. */
    verdict = 'EKSIK_ASAMA';
    note = `Kontrol aşaması (A') eksik (${tA2.attempts}/${requiredPerPhase} deneme) — ATST etkisi `
         + 'ZAMAN etkisinden AYRILAMAZ, hüküm VERİLMEZ.';
  } else if (tA.noDataRate === null || tB.noDataRate === null || tA2.noDataRate === null) {
    verdict = 'BELIRSIZ';
    note = 'Oran hesaplanamadı.';
  } else {
    const rA = tA.noDataRate;
    const rB = tB.noDataRate;
    const rA2 = tA2.noDataRate;
    const pc = (x: number) => `%${(x * 100).toFixed(0)}`;
    const seq = `${pc(rA)} → ${pc(rB)} → ${pc(rA2)}`;
    /* B1 KAPISI — ATST'nin uygulandığı BAĞIMSIZ olarak gösterilemediyse hüküm YOK.
       Klon adaptör bilinmeyen komuta da "OK" der; `stCommandOk` tek başına yetmez. */
    const applied = atstEvidenceRatio !== null && atstEvidenceRatio >= ATST_APPLIED_MIN_RATIO;
    if (!applied) {
      return {
        status, failReason, stRestored, atstEvidenceRatio,
        windowStartMs, windowEndMs, totals, perPid,
        target23: perPid.find((x) => x.pid === '23') ?? null,
        verdict: 'ATST_UYGULANMADI',
        verdictNote:
          `NO_DATA süresi (p50) A=${ndA ?? 'ölçülemedi'} ms → B=${ndB ?? 'ölçülemedi'} ms `
          + `(oran ${atstEvidenceRatio === null ? 'ölçülemedi' : atstEvidenceRatio.toFixed(2)}×, `
          + `gereken ≥${ATST_APPLIED_MIN_RATIO}×). Uzayan bekleme cevapsız sorguya YANSIMADI → `
          + `ayar GEÇMEMİŞ. ATST komutu "OK" dönmüş olabilir (stCommandOk=`
          + `${tB.stCommandOk === null ? 'bilinmiyor' : String(tB.stCommandOk)}) ama klon adaptör `
          + 'bilinmeyen komuta da OK der — "OK" KANIT DEĞİLDİR. Deney GEÇERSİZ.',
      };
    }

    /* B2 — SINIF KAYMASINA KÖRLÜK: NO_DATA düşüşü, OK ARTIŞIYLA karşılanmalı.
       Kayıp 7F/BUSY/ERROR/TIMEOUT'a kaydıysa "iyileşme" YOKTUR, sınıf değişmiştir. */
    const sA = tA.successRate ?? 0;
    const sB = tB.successRate ?? 0;
    const successRose = sB - sA >= VERDICT_MIN_DROP;
    const improvedAB = (rA - rB >= VERDICT_MIN_DROP) && successRose;
    const classShift = (rA - rB >= VERDICT_MIN_DROP) && !successRose;
    const revertedA2 = rA2 - rB >= VERDICT_MIN_DROP;

    if (classShift) {
      verdict = 'BELIRSIZ';
      note = `NO_DATA ${seq} düştü AMA başarı oranı artmadı `
           + `(%${(sA * 100).toFixed(0)} → %${(sB * 100).toFixed(0)}; 'diğer' sınıf `
           + `${tA.other} → ${tB.other}). Kayıp iyileşmedi, SINIF DEĞİŞTİRDİ — `
           + '7F/BUSY/ERROR/TIMEOUT tarafına kaymış olabilir. İyileşme İDDİA EDİLMEZ.';
    } else if (improvedAB && revertedA2) {
      verdict = 'ATST_KOKTU';
      note = `NO_DATA ${seq} — ATST uzatılınca düştü, GERİ ALININCA yeniden yükseldi. `
           + 'Düzelme zamandan değil, bekleme süresinden geldi: KÖK BUDUR.';
    } else if (improvedAB && !revertedA2) {
      verdict = 'ZAMAN_ETKISI';
      note = `NO_DATA ${seq} — B aşamasında düzeldi ama ATST GERİ ALINDIĞINDA da düzelmiş kaldı. `
           + 'İyileşme hattın kendiliğinden oturmasından geliyor; ATST katkısı BELİRSİZ.';
    } else if (Math.abs(rA - rB) < VERDICT_MIN_DROP && Math.abs(rA - rA2) < VERDICT_MIN_DROP) {
      verdict = 'ATST_KOK_DEGIL';
      note = `NO_DATA ${seq} — üç aşama benzer, uzatma fark etmedi. Kök BAŞKA yerde; `
           + 'eşik tartışması yeniden açılır.';
    } else {
      verdict = 'BELIRSIZ';
      note = `NO_DATA ${seq} — desen tutarsız (gürültü ya da başka etken); deney tekrarlanmalı.`;
    }
  }

  return {
    status,
    failReason,
    stRestored,
    atstEvidenceRatio,
    windowStartMs,
    windowEndMs,
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
  ZAMAN_ETKISI:   'ZAMAN ETKİSİ — düzelme hattın oturmasından; ATST katkısı BELİRSİZ',
  ATST_UYGULANMADI: 'ATST UYGULANMADI — ayar geçmemiş, deney GEÇERSİZ (hüküm verilmez)',
  BELIRSIZ:       'BELİRSİZ — tekrar gerekiyor',
};

export const PID_VERDICT_LABEL: Readonly<Record<PidVerdict, string>> = {
  ELCILMEDI:         'ölçülmedi',
  ZATEN_SAGLAM:      'zaten sağlam (A\'da kayıp yok)',
  SURE_ILE_KURTULDU: 'SÜRE İLE KURTULDU',
  DEGISMEDI:         'değişmedi',
  KOTULESTI:         'kötüleşti',
};
