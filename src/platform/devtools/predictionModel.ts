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
