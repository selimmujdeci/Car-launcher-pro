/**
 * predictionModel — CAROS LAB · Öngörü Motoru SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── BU EKRANIN CEVAPLADIĞI SORU ─────────────────────────────────────────────
 * *"5 dk sonra ne olacak?"* kapısı GERÇEKTEN açık mı — yoksa yalnız kod mu var?
 * Ekran üç şeyi ayırır ve bunları birleştirmek yasaktır:
 *   · TAHMİN VAR            — kanıt yeterli, motor konuştu
 *   · KANIT YETERSİZ        — örnek birikiyor, henüz hüküm YOK  (sahte tahmin YOK)
 *   · SİNYAL KAYNAĞI YOK    — bu kural ÜRÜNDE hiç çalışamaz
 * Üçüncüsü en önemlisidir: sessizce boş bırakmak, "kural çalışıyor ama arıza
 * yok" izlenimi verirdi — oysa gerçek "hiç bakılmıyor"dur.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';

const SRC_RT = 'obd/predictionRuntime.getPredictionSnapshot()';
const SRC_RULES = 'obd/predictionEngine.DEFAULT_PREDICTION_RULES';

/* ── Kural durumu ────────────────────────────────────────────────────────── */

export type RuleState =
  /** Motor tahmin üretti. */
  | 'PREDICTED'
  /** Kaynak var, örnek birikiyor ama eşik/uyum yetmiyor → hüküm YOK. */
  | 'INSUFFICIENT'
  /** Üründe bu sinyalin kaynağı YOK — kural hiç çalışamaz. */
  | 'NO_SOURCE'
  /** Koşucu okunamadı. */
  | 'UNAVAILABLE';

export const RULE_STATE_LABEL: Readonly<Record<RuleState, string>> = {
  PREDICTED:    'TAHMİN VAR',
  INSUFFICIENT: 'KANIT YETERSİZ',
  NO_SOURCE:    'SİNYAL KAYNAĞI YOK',
  UNAVAILABLE:  'OKUNAMADI',
} as const;

export type PredictionTone = 'ok' | 'muted' | 'warn' | 'bad';

export function ruleStateTone(s: RuleState, severity?: string): PredictionTone {
  if (s === 'PREDICTED') return severity === 'critical' ? 'bad' : 'warn';
  if (s === 'NO_SOURCE') return 'warn';
  return 'muted';
}

export interface RuleRow {
  readonly kind: string;
  readonly title: string;
  readonly state: RuleState;
  /** Eşik künyesi — "neye göre" sorusunun cevabı. */
  readonly criteria: string;
  /** Biriken örnek / gereken en az örnek. */
  readonly progress: string | null;
  /** Tahmin varsa gerekçe (motorun ürettiği metin) — UYDURULMAZ. */
  readonly reason: string | null;
  readonly minutesToThreshold: number | null;
  readonly confidence: number | null;
}

export interface PredictionFieldsInput {
  readonly runtime: {
    readonly running: boolean;
    readonly taskId: string;
    readonly periodMs: number;
    readonly criticality: string;
    readonly minSamples: number;
    readonly maxSamples: number;
    readonly tickCount: number;
    readonly lastTickAtMs: number | null;
    readonly sampleCounts: Readonly<Record<string, number>>;
    readonly predictions: Readonly<Record<string, {
      readonly severity: string;
      readonly minutesToThreshold: number;
      readonly title: string;
      readonly reason: string;
      readonly confidence: number;
    }>>;
    readonly skippedStale: number;
    readonly skippedMissing: number;
    readonly clearCount: number;
    readonly rulesWithoutSource: readonly string[];
  } | null;
  readonly rules: ReadonlyArray<{
    readonly kind: string;
    readonly severity: string;
    readonly threshold: number;
    readonly horizonMin: number;
    readonly direction: string;
    readonly unit: string;
    readonly title: string;
  }>;
  readonly minSamples: number;
  readonly minFitQuality: number;
  readonly nowMs: number;
}

/* ── Genel hüküm ─────────────────────────────────────────────────────────── */

export type PredictionVerdict =
  | 'UNAVAILABLE'
  /** Koşucu HİÇ çalışmıyor — kapı gerçekten kapalı. */
  | 'NOT_RUNNING'
  /** Çalışıyor ama hiç örnek toplayamadı (veri bayat / sensör yok). */
  | 'NO_SAMPLES'
  /** Örnek birikiyor, henüz tahmin yok — BEKLENEN durum. */
  | 'WATCHING'
  /** En az bir tahmin var. */
  | 'PREDICTING';

export const PREDICTION_VERDICT_LABEL: Readonly<Record<PredictionVerdict, string>> = {
  UNAVAILABLE: 'OKUNAMADI',
  NOT_RUNNING: 'ÇALIŞMIYOR — öngörü kapısı KAPALI',
  NO_SAMPLES:  'ÖRNEK YOK — veri bayat veya sensör yok',
  WATCHING:    'İZLİYOR — kanıt birikiyor',
  PREDICTING:  'TAHMİN ÜRETİYOR',
} as const;

export function predictionVerdictTone(v: PredictionVerdict): PredictionTone {
  switch (v) {
    case 'PREDICTING':  return 'warn';   // tahmin bir UYARIDIR, iyi haber değil
    case 'WATCHING':    return 'ok';
    case 'NO_SAMPLES':  return 'muted';
    case 'NOT_RUNNING': return 'bad';
    case 'UNAVAILABLE': return 'muted';
  }
}

export function derivePredictionVerdict(i: PredictionFieldsInput): PredictionVerdict {
  const r = i.runtime;
  if (r === null) return 'UNAVAILABLE';
  if (!r.running) return 'NOT_RUNNING';
  if (Object.keys(r.predictions).length > 0) return 'PREDICTING';
  const total = Object.values(r.sampleCounts).reduce((a, b) => a + b, 0);
  return total > 0 ? 'WATCHING' : 'NO_SAMPLES';
}

/* ── Kural satırları ─────────────────────────────────────────────────────── */

export function buildRuleRows(i: PredictionFieldsInput): readonly RuleRow[] {
  const r = i.runtime;
  return i.rules.map((rule) => {
    const criteria =
      `${rule.direction === 'up' ? '≥' : '≤'} ${rule.threshold} ${rule.unit} · ufuk ${rule.horizonMin} dk`;

    if (r === null) {
      return {
        kind: rule.kind, title: rule.title, state: 'UNAVAILABLE' as RuleState,
        criteria, progress: null, reason: null,
        minutesToThreshold: null, confidence: null,
      };
    }

    /* SİNYAL KAYNAĞI YOK — en önemli ayrım. Bu kural ÜRÜNDE hiç çalışamaz;
       "kanıt yetersiz" demek yanlış olurdu (kanıt birikmiyor değil, hiç
       toplanmıyor). */
    if (r.rulesWithoutSource.includes(rule.kind)) {
      return {
        kind: rule.kind, title: rule.title, state: 'NO_SOURCE' as RuleState,
        criteria, progress: null, reason: null,
        minutesToThreshold: null, confidence: null,
      };
    }

    const p = r.predictions[rule.kind];
    if (p) {
      return {
        kind: rule.kind, title: rule.title, state: 'PREDICTED' as RuleState,
        criteria,
        progress: `${r.sampleCounts[rule.kind] ?? 0}/${r.minSamples}`,
        reason: p.reason,
        minutesToThreshold: p.minutesToThreshold,
        confidence: p.confidence,
      };
    }

    return {
      kind: rule.kind, title: rule.title, state: 'INSUFFICIENT' as RuleState,
      criteria,
      progress: `${r.sampleCounts[rule.kind] ?? 0}/${r.minSamples}`,
      reason: null,
      minutesToThreshold: null, confidence: null,
    };
  });
}

/* ── Koşucu alanları ─────────────────────────────────────────────────────── */

export function buildRuntimeFields(i: PredictionFieldsInput): readonly InspectorField[] {
  const r = i.runtime;
  if (r === null) {
    return [unavailable({
      id: 'pr-runtime', label: 'Öngörü koşucusu', source: SRC_RT, note: '',
    }, 'Okuma hata verdi — "çalışmıyor" ile KARIŞTIRILMAZ.')];
  }

  const out: InspectorField[] = [
    observed({
      id: 'pr-running', label: 'Koşucu', source: SRC_RT,
      note: r.running
        ? 'Görev zamanlayıcı tekerine kayıtlı.'
        : 'KAYITLI DEĞİL — anayasanın 6. kapısı bu cihazda KAPALI.',
    }, r.running ? 'ÇALIŞIYOR' : 'DURDU'),

    observed({
      id: 'pr-budget', label: 'Bütçe', source: SRC_RT,
      note: 'SAFETY → düşük-uç cihazda mod çarpanıyla YAVAŞLATILMAZ (anayasa: güvenlik katmanı her tier\'da açık). Hot-path (3 Hz) DEĞİL — soğuk yol.',
    }, `${r.criticality} · ${Math.round(r.periodMs / 1000)} sn`),

    observed({
      id: 'pr-ticks', label: 'Tik', source: SRC_RT,
      note: 'Koşucunun gerçekten çalıştığının kanıtı.',
    }, r.tickCount),
  ];

  out.push(r.lastTickAtMs === null
    ? unavailable({ id: 'pr-last', label: 'Son tik yaşı', source: SRC_RT, note: '' },
        'Hiç tik olmadı — damga YOK.')
    : derived({
        id: 'pr-last', label: 'Son tik yaşı', source: SRC_RT,
        note: 'Damgadan türetildi.', updatedAt: r.lastTickAtMs,
      }, formatAge(r.lastTickAtMs, i.nowMs)));

  out.push(observed({
    id: 'pr-skipped', label: 'Atlanan örnek', source: SRC_RT,
    note: 'BAYAT veri örneklenmez (duran sayı sahte "trend yok" üretir); sensör okunamazsa da örnek alınmaz. Sessiz atlama YOK — sayılır.',
  }, `${r.skippedStale} bayat · ${r.skippedMissing} sensör yok`));

  out.push(observed({
    id: 'pr-clear', label: 'Tampon temizliği', source: SRC_RT,
    note: 'Araç/bağlantı değişince tampon SIFIRLANIR — iki farklı aracın değerlerini aynı doğruya uydurmak uydurma trend üretir.',
  }, r.clearCount));

  out.push(observed({
    id: 'pr-thresholds', label: 'Kanıt eşiği', source: SRC_RULES,
    note: 'Bu eşiklerin ALTINDA tahmin ÜRETİLMEZ — "emin değilsek susarız". Yanlış-pozitif aşırı ısınma uyarısı güveni sıfırlar.',
  }, `en az ${i.minSamples} örnek · uyum ≥ ${i.minFitQuality}`));

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-04 · ERKEN UYARI SATIRLARI (aynı ekranın ikinci bölümü)

   AYRI EKRAN AÇILMADI: erken uyarı, öngörü koşucusunun AYNI tikinde ve aynı
   örnekleme disipliniyle üretilir; onu ayrı bir yere koymak iki ayrı gerçeklik
   izlenimi verirdi. Bu model yalnız BİÇİMLENDİRİR — hüküm üretmez.
   ══════════════════════════════════════════════════════════════════════════ */

export interface EarlyWarningRow {
  readonly id: string;
  readonly title: string;
  /** `NORMAL` · `WATCH` · `ATTENTION` · `INSUFFICIENT_DATA` · `SIGNAL_MISSING`. */
  readonly verdict: string;
  readonly tone: PredictionTone;
  /** `0.62` → `%62`; hüküm yoksa `—` (sahte güven basılmaz). */
  readonly confidence: string;
  readonly reason: string;
  /** `Uzun dönem yakıt trim (B1): %14.2 (12 örnek)` biçiminde kanıt satırları. */
  readonly evidence: readonly string[];
  /** Gözlem süresi (`4 dk`) — kanıtın YAŞI değil SÜRESİ. */
  readonly observed: string;
  /** Koşulun pencerede kapladığı oran (`%92`); hüküm yoksa `—`. */
  readonly dwell: string;
}

/** Hüküm → ton. `SIGNAL_MISSING` UYARI DEĞİLDİR: ölçemedik demektir. */
export function earlyWarningTone(verdict: string): PredictionTone {
  switch (verdict) {
    case 'ATTENTION':         return 'bad';
    case 'WATCH':             return 'warn';
    case 'NORMAL':            return 'ok';
    case 'INSUFFICIENT_DATA': return 'muted';
    case 'SIGNAL_MISSING':    return 'muted';
    default:                  return 'muted';
  }
}

function _dur(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const min = ms / 60_000;
  return min < 1 ? `${Math.round(ms / 1000)} sn` : `${min.toFixed(1)} dk`;
}

export function buildEarlyWarningRows(
  results: readonly {
    readonly id: string; readonly title: string; readonly verdict: string;
    readonly confidence: number; readonly reason: string;
    readonly evidence: readonly { readonly label: string; readonly median: number;
      readonly unit: string; readonly samples: number }[];
    readonly missing: readonly string[];
    readonly dwellFraction: number; readonly observedMs: number;
  }[] | null,
): readonly EarlyWarningRow[] {
  if (results === null) return [];
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    verdict: r.verdict,
    tone: earlyWarningTone(r.verdict),
    /* Güven YALNIZ gerçek bir hüküm varken gösterilir; `NORMAL` için "%0"
       basmak "hiç güvenmiyoruz" gibi okunurdu — oysa ölçtük ve iyi. */
    confidence: r.verdict === 'WATCH' || r.verdict === 'ATTENTION'
      ? `%${Math.round(r.confidence * 100)}`
      : '—',
    reason: r.reason,
    evidence: r.evidence.map(
      (e) => `${e.label}: ${e.median}${e.unit ? ' ' + e.unit : ''} (${e.samples} örnek)`),
    observed: _dur(r.observedMs),
    dwell: r.verdict === 'WATCH' || r.verdict === 'ATTENTION'
      ? `%${Math.round(r.dwellFraction * 100)}`
      : '—',
  }));
}

/** Kaç kural gerçekten hüküm verdi / kaçı ölçülemedi — tek bakışta özet. */
export function summarizeEarlyWarnings(rows: readonly EarlyWarningRow[]): {
  readonly total: number; readonly attention: number; readonly watch: number;
  readonly normal: number; readonly unmeasurable: number;
} {
  let attention = 0, watch = 0, normal = 0, unmeasurable = 0;
  for (const r of rows) {
    if (r.verdict === 'ATTENTION') attention++;
    else if (r.verdict === 'WATCH') watch++;
    else if (r.verdict === 'NORMAL') normal++;
    else unmeasurable++;
  }
  return { total: rows.length, attention, watch, normal, unmeasurable };
}
