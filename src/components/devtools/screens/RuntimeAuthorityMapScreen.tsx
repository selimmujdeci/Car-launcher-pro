/** ARCH-01/F0 CAROS LAB view — static, salt-okunur authority map. */
import { memo } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  RUNTIME_AUTHORITY_INVARIANTS, RUNTIME_AUTHORITY_MAP,
  type AuthorityEvidence,
} from '../../../platform/devtools/runtimeAuthorityModel';

const EVIDENCE_LABEL: Readonly<Record<AuthorityEvidence, string>> = {
  CODE_CONFIRMED: 'KOD KANITI', KNOWN_OVERLAP: 'BİLİNEN ÇAKIŞMA', UNKNOWN: 'BİLİNMİYOR',
};

export const RuntimeAuthorityMapScreen = memo(function RuntimeAuthorityMapScreen() {
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="runtime-authority-map">
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold text-[var(--oem-info)]">
          <ShieldCheck size={13} /> RUNTIME AUTHORITY MAP — ARCH-01/F0
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          SALT OKUNUR statik envanterdir: servis başlatmaz, durdurmaz, restart etmez, timer kurmaz.
          KAYNAK YOK ve BİLİNMEYOR sıfır ya da sağlıklı anlamına gelmez.
        </p>
      </div>
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {RUNTIME_AUTHORITY_MAP.map((row) => (
          <section key={row.id} data-testid={`ram-row-${row.id}`} className="border-b border-[var(--oem-line)] px-3 py-2 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              <span className="font-bold text-[var(--oem-ink)]">{row.authority}</span>
              <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 text-[9px] text-[var(--oem-ink-2)]">{row.kind}</span>
              <span data-evidence={row.evidence} className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 text-[9px] text-[var(--oem-ink-3)]">{EVIDENCE_LABEL[row.evidence]}</span>
            </div>
            <div className="mt-1 grid gap-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
              <span>canonical: {row.canonicalOwner}</span>
              {row.competingOwner && <span>çakışan: {row.competingOwner}</span>}
              <span>domain: {row.lifecycleDomain}</span>
              <span>timer: {row.timerOwner ?? 'KAYNAK YOK'}</span>
              <span>recovery: {row.recoveryOwner ?? 'KAYNAK YOK'}</span>
              <span>kanıt: {row.codeEvidence}</span>
              {row.knownDebt && <span className="text-[var(--oem-warn)]">KNOWN_DEBT: {row.knownDebt}</span>}
            </div>
          </section>
        ))}
      </div>
      <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="font-mono text-[10px] font-bold text-[var(--oem-ink-2)]">F0 İNVARİANTLARI</div>
        {RUNTIME_AUTHORITY_INVARIANTS.map((item) => <div key={item} className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">{item}</div>)}
      </div>
    </div>
  );
});
