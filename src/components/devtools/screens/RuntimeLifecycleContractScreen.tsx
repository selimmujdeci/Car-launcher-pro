/** ARCH-01/F1 CAROS LAB — read-only contract and pilot adapter view. */
import { memo, useCallback, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { LIFECYCLE_STATES, allowedTransitions, LIFECYCLE_PILOT_DESCRIPTORS } from '../../../platform/runtime/lifecycleContract';
import { readSystemBootLifecyclePilot } from '../../../platform/devtools/runtimeLifecycleSources';

export const RuntimeLifecycleContractScreen = memo(function RuntimeLifecycleContractScreen() {
  const [pilot, setPilot] = useState(() => readSystemBootLifecyclePilot());
  const refresh = useCallback(() => setPilot(readSystemBootLifecyclePilot()), []);
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="runtime-lifecycle-contract">
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold text-[var(--oem-info)]"><ShieldCheck size={13} /> CANONICAL LIFECYCLE CONTRACT — F1</div>
        <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">SALT OKUNUR: lifecycle, readiness, health ve domain truth AYRIDIR. Bu ekran servis çağırmaz; yalnız mevcut SystemBoot teşhisini okur.</p>
        <button type="button" data-testid="rlc-refresh" onClick={refresh} className="mt-2 flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 font-mono text-[9px] text-[var(--oem-ink-2)]"><RefreshCw size={11} /> YENİLE</button>
      </div>
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="font-mono text-[10px] font-bold text-[var(--oem-ink-2)]">PILOT · SYSTEMBOOT</div>
        {pilot === null ? <div data-testid="rlc-pilot-unavailable" className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">KAYNAK YOK — durum uydurulmadı.</div> : <div data-testid="rlc-pilot" className="mt-1 grid gap-1 font-mono text-[9px] text-[var(--oem-ink-3)]"><span>lifecycle: {pilot.state}</span><span>readiness: {pilot.readiness}</span><span>health: {pilot.health}</span><span>generation: {pilot.generation.lifecycleEpoch}/{pilot.generation.transitionToken}</span><span>invalid transition: {pilot.invalidTransitionCount}</span>{pilot.unknownSources.map((x) => <span key={x}>UNKNOWN: {x}</span>)}</div>}
      </div>
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--oem-ink-2)]">WHITELIST TRANSITIONS</div>
        {LIFECYCLE_STATES.map((state) => <div key={state} className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[9px] text-[var(--oem-ink-3)]"><b className="text-[var(--oem-ink)]">{state}</b> → {allowedTransitions(state).join(' · ') || 'terminal'}</div>)}
      </div>
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="font-mono text-[10px] font-bold text-[var(--oem-ink-2)]">PILOT DESCRIPTORS</div>
        {LIFECYCLE_PILOT_DESCRIPTORS.map((d) => <div key={d.id} className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">{d.id}: {d.owner} · {d.lifecycleDomain} · readiness={d.readinessKind}</div>)}
      </div>
    </div>
  );
});
