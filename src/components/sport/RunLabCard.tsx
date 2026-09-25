/**
 * RunLabCard — Performans 2.0 (Sport Mod): 0-100 · 60-100 · 100-0 fren.
 * Ölçüm `performanceRuns`te; bu kart yalnız gösterir. Geçersiz koşu nedeniyle
 * birlikte gösterilir, rekor sayılmaz.
 */
import { memo, useMemo } from 'react';
import { Timer, X, AlertTriangle, Trophy } from 'lucide-react';
import { useStore } from '../../store/useStore';
import {
  useRunState, startRun, cancelRun, loadRunHistory, bestRun,
  type RunKind, type RunInvalidReason,
} from '../../platform/perf/performanceRuns';

const KINDS: ReadonlyArray<{ kind: RunKind; label: string; hint: string }> = [
  { kind: '0-100',  label: '0 → 100',  hint: 'Kalkış' },
  { kind: '60-100', label: '60 → 100', hint: 'Sollama gücü' },
  { kind: '100-0',  label: '100 → 0',  hint: 'Fren' },
];

const INVALID_LABEL: Record<RunInvalidReason, string> = {
  SPARSE_DATA: 'hız verisi seyrek geldi',
  SIMULATED:   'OBD simüle — gerçek değil',
  LIFTED:      'gaz/fren arada bırakıldı',
};

const sec = (ms: number) => (ms / 1000).toFixed(2);

function RunLabCardInner() {
  const s = useRunState();
  const driverId = useStore((st) => st.settings.activeDriverProfileId ?? null);
  // Yeni sonuç geldiğinde geçmiş yeniden okunur.
  const history = useMemo(() => { void s.result; return loadRunHistory(); }, [s.result]);
  const bests = useMemo(() => KINDS.map((k) => ({ ...k, best: bestRun(history, k.kind, driverId) })), [history, driverId]);
  const active = s.phase !== 'idle' && s.phase !== 'done';
  const r = s.result;

  return (
    <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-4"
      data-editable="sport.run-lab" data-editable-type="card">
      <div className="flex items-center gap-2 mb-3">
        <Timer className="w-4 h-4 text-[color:var(--oem-accent)]" />
        <span className="text-[color:var(--oem-ink)] font-black text-xs uppercase tracking-widest">Performans ölçümü</span>
        {active && (
          <button onClick={cancelRun} aria-label="Ölçümü iptal et"
            className="ml-auto w-7 h-7 rounded-lg grid place-items-center bg-[var(--oem-surface-3)] text-[color:var(--oem-ink-2)]">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {bests.map(({ kind, label, hint, best }) => {
          const on = s.kind === kind && s.phase !== 'idle';
          return (
            <button key={kind} onClick={() => startRun(kind)} disabled={active && !on}
              className={`rounded-xl border p-2.5 text-left transition-all active:scale-95 disabled:opacity-40 ${
                on ? 'border-[var(--oem-accent)] bg-[var(--oem-accent-soft)]' : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface)]'}`}>
              <div className="text-[color:var(--oem-ink)] font-black text-sm tabular-nums">{label}</div>
              <div className="text-[color:var(--oem-ink-3)] text-[10px]">{hint}</div>
              <div className="text-[color:var(--oem-ink-2)] text-[11px] mt-1 tabular-nums flex items-center gap-1">
                {best ? <><Trophy className="w-3 h-3" />{sec(best.timeMs)} sn</> : 'rekor yok'}
              </div>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[color:var(--oem-ink-3)] text-[10px] uppercase tracking-widest">{s.kind}</div>
            <div className="text-[color:var(--oem-ink)] text-3xl font-black tabular-nums">
              {s.phase === 'recording' ? sec(s.liveMs) : '—'}<span className="text-sm text-[color:var(--oem-ink-3)] ml-1">sn</span>
            </div>
            {s.note && <div className="text-[color:var(--oem-ink-2)] text-[12px]">{s.note}</div>}
          </div>
          <div className="text-right">
            <div className="text-[color:var(--oem-ink)] text-xl font-black tabular-nums">{s.liveKmh ?? '—'}</div>
            <div className="text-[color:var(--oem-ink-3)] text-[10px]">{s.liveKmh === null ? 'OBD hız verisi bekleniyor' : 'km/s'}</div>
          </div>
        </div>
      )}

      {s.phase === 'done' && r && (
        <div className="mt-3 pt-3 border-t border-[var(--oem-line)]">
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-black tabular-nums ${r.valid ? 'text-[color:var(--oem-ink)]' : 'text-[color:var(--oem-ink-3)] line-through'}`}>{sec(r.timeMs)}</span>
            <span className="text-[color:var(--oem-ink-3)] text-xs">sn ±{sec(r.precisionMs)}</span>
            {s.deltaVsBestMs !== null && (
              <span className={`ml-auto text-sm font-black tabular-nums ${s.deltaVsBestMs < 0 ? 'text-[color:var(--oem-good)]' : 'text-[color:var(--oem-ink-2)]'}`}>
                {s.deltaVsBestMs < 0 ? 'Yeni rekor ' : ''}{s.deltaVsBestMs > 0 ? '+' : ''}{sec(s.deltaVsBestMs)} sn
              </span>
            )}
          </div>
          <div className="text-[color:var(--oem-ink-2)] text-[12px] mt-1 tabular-nums">
            {r.distanceM} m{r.avgDecelG !== null ? ` · ortalama ${r.avgDecelG} g yavaşlama` : ''}
          </div>
          {!r.valid && (
            <div className="flex items-start gap-1.5 mt-1.5 text-[12px] text-[color:var(--oem-warn)]">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Geçersiz, rekor sayılmadı: {r.invalidReasons.map((x) => INVALID_LABEL[x]).join(', ')}</span>
            </div>
          )}
          {r.warnings.includes('SLOPE') && (
            <div className="text-[12px] text-[color:var(--oem-ink-3)] mt-1">Yol eğimli görünüyor — sonuç eğimden etkilenmiş olabilir.</div>
          )}
        </div>
      )}
      {s.phase === 'done' && !r && s.note && <div className="mt-3 text-[12px] text-[color:var(--oem-ink-3)]">{s.note}</div>}

      <div className="text-[color:var(--oem-ink-3)] text-[10px] mt-3 leading-relaxed">
        Süre OBD hız ölçüm anlarından hesaplanır. Yalnız kapalı, güvenli bir alanda deneyin.
      </div>
    </div>
  );
}

export const RunLabCard = memo(RunLabCardInner);
