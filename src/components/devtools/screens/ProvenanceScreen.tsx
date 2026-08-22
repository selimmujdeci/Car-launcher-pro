/**
 * ProvenanceScreen — CAROS LAB · Araç · Sinyal Kaynak İzi (V-12).
 *
 * SALT-OKUNUR. Sinyal yazmaz, damga basmaz, defteri temizlemez, araca komut
 * göndermez. Yalnız `vehicleProvenance` defterini okur.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Digital Twin'in ilk gerçek katmanı: *"Bu değer NEREDEN geldi, NE ZAMAN
 * ölçüldü?"* `UnifiedVehicleStore` çıplak skalerler taşıyordu ve `gpsSource`
 * dışında hiçbir sinyalde kaynak izi YOKTU. Kaynağı bilinmeyen bir değerle
 * karar vermek, zero-trust telemetri ilkesinin ihlalidir.
 *
 * ÜÇ DURUM BİRLEŞTİRİLMEZ: AKIYOR · BAYAT · HİÇ YAZILMADI. Sonuncusunu "bayat"
 * saymak, hiç gelmemiş bir sinyali "gelmiş ama eskimiş" göstermek olurdu.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, GitBranch } from 'lucide-react';
import {
  getProvenanceSnapshot, type ProvenanceRow,
} from '../../../platform/vehicleDataLayer/vehicleProvenance';
import {
  buildProvenanceRows, buildProvenanceFields, deriveProvenanceVerdict,
  provenanceVerdictTone, provenanceStateTone,
  PROVENANCE_VERDICT_LABEL, PROVENANCE_STATE_LABEL,
  type ProvenanceTone,
} from '../../../platform/devtools/provenanceModel';
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

const TONE_STYLE: Record<ProvenanceTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`pv-field-${field.id}`}
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

export const ProvenanceScreen = memo(function ProvenanceScreen() {
  const [snap, setSnap] = useState<{ rows: readonly ProvenanceRow[] | null; at: number }>(() => {
    const at = Date.now();
    try { return { rows: getProvenanceSnapshot(at), at }; } catch { return { rows: null, at }; }
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    const at = Date.now();
    try { setSnap({ rows: getProvenanceSnapshot(at), at }); }
    catch { setSnap({ rows: null, at }); }
  }, []);

  const nowMs = snap.at;

  const rows = useMemo(
    () => (snap.rows === null ? null : buildProvenanceRows(snap.rows)),
    [snap.rows],
  );
  const verdict = useMemo(() => deriveProvenanceVerdict(rows), [rows]);
  const fields = useMemo(() => buildProvenanceFields({ rows, nowMs }), [rows, nowMs]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="provenance">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <GitBranch size={12} /> SİNYAL KAYNAK İZİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — sinyal yazmaz
          </span>
          <button
            type="button"
            data-testid="pv-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="pv-verdict"
            data-verdict={verdict}
            className={`rounded border px-1.5 py-0.5 ${TONE_STYLE[provenanceVerdictTone(verdict)]}`}
          >
            {PROVENANCE_VERDICT_LABEL[verdict]}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Digital Twin'in ilk gerçek katmanı: “bu değer NEREDEN geldi, NE ZAMAN ölçüldü?”.
          Kaynağı bilinmeyen bir değerle karar vermek zero-trust telemetrinin ihlalidir.
          “HİÇ YAZILMADI” ile “BAYAT” AYRI şeylerdir.
        </p>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {fields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
      </div>

      {rows !== null && (
        <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
          <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
            SİNYAL BAŞINA KAYNAK
          </div>
          {rows.map((r) => (
            <div
              key={r.key}
              data-testid={`pv-signal-${r.key}`}
              data-state={r.state}
              className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-[var(--oem-ink)]">{r.key}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                    TONE_STYLE[provenanceStateTone(r.state)]
                  }`}
                >
                  {PROVENANCE_STATE_LABEL[r.state]}
                </span>
                <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
                  {r.source}
                </span>
                <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                  {r.writes} yazım
                  {r.ageMs !== null ? ` · ${Math.round(r.ageMs / 1000)} sn önce` : ' · yaş yok'}
                </span>
              </div>
              <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{r.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
