/**
 * PredictionEngineScreen — CAROS LAB · Araç · Öngörü Motoru (V-09).
 *
 * SALT-OKUNUR. Koşucuyu BAŞLATMAZ/DURDURMAZ, tik TETİKLEMEZ, örnek EKLEMEZ,
 * tampon TEMİZLEMEZ, kural/eşik DEĞİŞTİRMEZ, araca komut GÖNDERMEZ.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 * (Öngörü koşucusunun kendi kadansını gözleyen bir ekranda periyodik okuma,
 * ölçtüğü şeyin bütçesini kirletirdi.)
 *
 * ── NEDEN ZORUNLU ───────────────────────────────────────────────────────────
 * V-09 açıkça diyor: *"CAROS LAB'a salt-okunur gözlem ekranı ZORUNLU."*
 * Anayasanın 6. kapısının ("5 dk sonra ne olacak?") gerçekten açık olup
 * olmadığı ancak burada görülebilir.
 *
 * ÜÇ DURUM BİRLEŞTİRİLMEZ: TAHMİN VAR · KANIT YETERSİZ · SİNYAL KAYNAĞI YOK.
 * Sonuncusu sessizce boş bırakılsaydı "kural çalışıyor ama arıza yok"
 * izlenimi doğardı — oysa gerçek "hiç bakılmıyor"dur.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, TrendingUp, AlertTriangle } from 'lucide-react';
import {
  readPredictionSnapshot, type PredictionRawSnapshot,
} from '../../../platform/devtools/predictionSources';
import {
  buildRuleRows, buildRuntimeFields, derivePredictionVerdict,
  buildEarlyWarningRows, summarizeEarlyWarnings,
  predictionVerdictTone, ruleStateTone,
  PREDICTION_VERDICT_LABEL, RULE_STATE_LABEL,
  type PredictionTone, type PredictionFieldsInput,
} from '../../../platform/devtools/predictionModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const TONE_STYLE: Record<PredictionTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`pr-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
        )}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {OBSERVABILITY_LABEL[field.klass]}
      </span>
    </div>
  );
});

export const PredictionEngineScreen = memo(function PredictionEngineScreen() {
  const [snap, setSnap] = useState<PredictionRawSnapshot>(
    () => readPredictionSnapshot(Date.now()),
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readPredictionSnapshot(Date.now()));
  }, []);

  const nowMs = snap.readAt;

  const input = useMemo<PredictionFieldsInput>(() => ({
    runtime: snap.runtime,
    rules: snap.rules,
    minSamples: snap.minSamples,
    minFitQuality: snap.minFitQuality,
    nowMs,
  }), [snap, nowMs]);

  const verdict = useMemo(() => derivePredictionVerdict(input), [input]);
  const rows = useMemo(() => buildRuleRows(input), [input]);
  const fields = useMemo(() => buildRuntimeFields(input), [input]);
  const ewRows = useMemo(
    () => buildEarlyWarningRows(snap.runtime?.earlyWarnings ?? null), [snap]);
  const ewSummary = useMemo(() => summarizeEarlyWarnings(ewRows), [ewRows]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="prediction-engine">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <TrendingUp size={12} /> ÖNGÖRÜ MOTORU
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — tahmin tetiklemez
          </span>
          <button
            type="button"
            data-testid="pr-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="pr-verdict"
            data-verdict={verdict}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[predictionVerdictTone(verdict)]}`}
          >
            {PREDICTION_VERDICT_LABEL[verdict]}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Anayasanın 6. kapısı: “5 dk sonra ne olacak?”. Motor FAIL-CLOSED'dır — yetersiz
          örneklem, zayıf uyum, yanlış yön veya ufuk dışı varışta SUSAR. Sahte tahmin
          ÜRETİLMEZ; “kanıt yetersiz” dürüst bir cevaptır.
        </p>
      </div>

      {/* Kural satırları — üç durum AYRI */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
          KURALLAR
        </div>
        {rows.map((r) => (
          <div
            key={r.kind}
            data-testid={`pr-rule-${r.kind}`}
            data-state={r.state}
            className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-[var(--oem-ink)]">{r.title}</span>
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                  TONE_STYLE[ruleStateTone(r.state)]
                }`}
              >
                {RULE_STATE_LABEL[r.state]}
              </span>
              {r.progress && (
                <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                  örnek {r.progress}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
              eşik: {r.criteria}
            </div>
            {r.state === 'NO_SOURCE' && (
              <div className="mt-1 flex items-start gap-1.5 text-[9px] leading-relaxed text-[var(--oem-warn)]">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                Bu kural ÜRÜNDE HİÇ ÇALIŞAMAZ: ilgili sinyalin kaynağı yok. “Arıza yok”
                DEĞİL, “hiç bakılmıyor” demektir.
              </div>
            )}
            {r.reason && (
              <div className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-2)]">
                {r.reason}
                {r.minutesToThreshold !== null && (
                  <> · eşiğe ~{r.minutesToThreshold} dk</>
                )}
                {r.confidence !== null && (
                  <> · güven %{Math.round(r.confidence * 100)}</>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── P0-OBD-04 · ERKEN UYARI ──────────────────────────────────────
          AYNI koşucunun ikinci çıktısı. Ayrı ekran açılmadı: iki ayrı yerde
          göstermek iki ayrı gerçeklik izlenimi verirdi. */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
          ERKEN UYARI — {ewSummary.attention} DİKKAT · {ewSummary.watch} İZLE ·
          {' '}{ewSummary.normal} NORMAL · {ewSummary.unmeasurable} ÖLÇÜLEMEDİ
        </div>
        <p className="px-2 py-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          DTC/arıza lambası beklenmez; ölçülebilir sapma aranır. Hüküm tek ölçümle
          DEĞİL, pencere MEDYANI + süre + kaplama oranı + ilişkili sinyallerle verilir.
          “ÖLÇÜLEMEDİ” (sinyal yok / örneklem yetersiz) ile “NORMAL” AYRI şeylerdir —
          desteklenmeyen bir PID sağlıklı SAYILMAZ. Güven asla %100 olmaz: bu bir
          teşhis değil, erken belirtidir.
        </p>
        {ewRows.map((r) => (
          <div key={r.id} data-testid={`ew-${r.id}`} data-verdict={r.verdict}
            className="border-t border-[var(--oem-line)] px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              <span className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[r.tone]}`}>
                {r.verdict}
              </span>
              <span className="text-[var(--oem-ink-1)]">{r.title}</span>
              <span className="text-[var(--oem-ink-3)]">güven {r.confidence}</span>
              <span className="text-[var(--oem-ink-3)]">gözlem {r.observed}</span>
              <span className="text-[var(--oem-ink-3)]">kaplama {r.dwell}</span>
            </div>
            <div className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-2)]">{r.reason}</div>
            {r.evidence.length > 0 && (
              <ul className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                {r.evidence.map((e) => <li key={e}>· {e}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
          KOŞUCU
        </div>
        {fields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
      </div>
    </div>
  );
});
