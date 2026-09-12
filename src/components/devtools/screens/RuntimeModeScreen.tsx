/**
 * RuntimeModeScreen — CAROS LAB · Çalışma Zamanı · Mod Kapıları (V-17).
 *
 * SALT-OKUNUR. Mod DEĞİŞTİRMEZ, override YAZMAZ, kapı ÇEVİRMEZ, timer KURMAZ.
 * Açılışta tek okuma + elle YENİLE (repodaki CAROS LAB deseni).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Cihazda mod her zaman `BASIC_JS` görünüyordu ama NEDENİ hiçbir yerde
 * görünmüyordu. Vizyon planı nedeni tahmin etti ve YANLIŞ tahmin etti — SAB/COEP
 * kapısını suçladı; oysa kapılar SIRALIDIR ve SAB SONUNCUDUR. Yanlış kapıyı
 * suçlamak, pahalı ve yanlış bir mimari kararı doğururdu.
 *
 * Bu yüzden ekran TÜM kapıları gösterir ve "yazılımla açılır mı" sorusunu ancak
 * donanım engeli KALMADIYSA "EVET" diye yanıtlar.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Gauge, Lock, Unlock } from 'lucide-react';
import {
  readRuntimeModeSnapshot, type RuntimeModeSnapshot,
} from '../../../platform/devtools/runtimeModeSources';
import {
  buildGateRows, buildModeFields, deriveModeVerdict, modeVerdictTone,
  MODE_VERDICT_LABEL, type ModeTone, type GateId,
} from '../../../platform/devtools/runtimeModeModel';
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

const TONE_STYLE: Record<ModeTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`rm-field-${field.id}`}
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

export const RuntimeModeScreen = memo(function RuntimeModeScreen() {
  const [snap, setSnap] = useState<{ s: RuntimeModeSnapshot | null; at: number }>(() => {
    const at = Date.now();
    try { return { s: readRuntimeModeSnapshot(), at }; } catch { return { s: null, at }; }
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    const at = Date.now();
    try { setSnap({ s: readRuntimeModeSnapshot(), at }); }
    catch { setSnap({ s: null, at }); }
  }, []);

  const nowMs = snap.at;
  const s = snap.s;

  const rows = useMemo(
    () => (s?.decision == null
      ? null
      : buildGateRows(
          s.decision.gates.map((g) => ({ id: g.id as GateId, blocking: g.blocking, observed: g.observed })),
          s.decision.decidedBy as GateId | null,
        )),
    [s],
  );

  const verdict = useMemo(() => deriveModeVerdict(rows), [rows]);

  const fields = useMemo(() => buildModeFields({
    activeMode:       s?.activeMode ?? null,
    detectedMode:     s?.decision?.detected ?? null,
    rows,
    powerCeiling:     s?.powerCeiling ?? null,
    recoveryTarget:   s?.recoveryTarget ?? null,
    failedComponents: s?.failedComponents ?? null,
    lastChange:       s?.lastChange ?? null,
    partial:          s?.partial ?? true,
  }), [s, rows]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="runtime-mode">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Gauge size={12} /> ÇALIŞMA ZAMANI MOD KAPILARI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — mod değiştirmez
          </span>
          <button
            type="button"
            data-testid="rm-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="rm-verdict"
            data-verdict={verdict}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[modeVerdictTone(verdict)]}`}
          >
            {MODE_VERDICT_LABEL[verdict]}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Üretim yolu ilk engelleyen kapıda DURUR; bu ekran TÜMÜNÜ değerlendirir.
          Tek kapıyı gösterip “onu düzeltirsek açılır” demek yanılsamadır — birden çok
          kapı engelliyorsa yalnız birini çözmek modu DEĞİŞTİRMEZ.
        </p>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {fields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
      </div>

      {rows !== null && (
        <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
          <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
            KAPILAR (üretim sırasıyla)
          </div>
          {rows.map((r) => (
            <div
              key={r.id}
              data-testid={`rm-gate-${r.id}`}
              data-blocking={r.blocking ? '1' : '0'}
              data-decisive={r.decisive ? '1' : '0'}
              className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-[var(--oem-ink)]">{r.label}</span>
                <span
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                    r.blocking ? TONE_STYLE.warn : TONE_STYLE.ok
                  }`}
                >
                  {r.blocking ? <Lock size={10} /> : <Unlock size={10} />}
                  {r.blocking ? 'ENGELLİYOR' : 'geçti'}
                </span>
                {r.decisive && (
                  <span className="rounded border border-[var(--oem-warn)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                    KARARI VEREN
                  </span>
                )}
                <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
                  {r.fixable ? 'yazılımla açılabilir' : 'DONANIM — açılamaz'}
                </span>
              </div>
              <div className="mt-0.5 break-all font-mono text-[9px] text-[var(--oem-ink-3)]">{r.observed}</div>
              <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{r.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
