/**
 * ProfileCandidateScreen — CAROS LAB · Geliştirici · Üretici Profil Adayları (V-04/6).
 *
 * NEDEN VAR: `manufacturerProfileBuilder` "manuel onaya HAZIR adaylar üretir" diye
 * yazılmıştı ama onaya bakacak kimse yoktu — üretilen aday hiçbir yerde görünmüyordu.
 * Builder'ın var oluş sebebi bir İNCELEME yüzeyidir; bu ekran o yüzeydir.
 *
 * SALT-OKUNUR. YAPMADIKLARI: profil/registry yazma · aday onaylama · çakışma çözme ·
 * VKB değiştirme · Supabase yazma · yeni timer / abonelik / polling.
 *
 * ÇAKIŞMALAR OTOMATİK ÇÖZÜLMEZ — insan karar verir. Ekran çakışmayı gizlemez,
 * öne çıkarır.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Layers, AlertTriangle, Scissors } from 'lucide-react';
import {
  readProfileCandidateSnapshot, CANDIDATE_ROW_CAP,
  type ProfileCandidateSnapshot,
} from '../../../platform/devtools/profileCandidateSources';
import {
  buildCandidateGroups, countCandidates, deriveCandidateVerdict,
  CANDIDATE_STATUS_LABEL, CANDIDATE_VERDICT_LABEL,
  type CandidateVerdict,
} from '../../../platform/devtools/profileCandidateModel';
import { formatAge, OBSERVABILITY_LABEL } from '../../../platform/devtools/sessionInspectorModel';

const VERDICT_STYLE: Record<CandidateVerdict, string> = {
  READY_FOR_REVIEW: 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  REVIEW_REQUIRED:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NO_CANDIDATES:    'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  NO_KNOWLEDGE:     'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  READ_FAILED:      'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

export const ProfileCandidateScreen = memo(function ProfileCandidateScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<ProfileCandidateSnapshot>(() => readProfileCandidateSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readProfileCandidateSnapshot());
  }, []);

  const groups  = useMemo(() => buildCandidateGroups(snap), [snap]);
  const counts  = useMemo(() => countCandidates(groups), [groups]);
  const verdict = useMemo(() => deriveCandidateVerdict(snap, counts), [snap, counts]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="profile-candidates">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Layers size={12} /> ÜRETİCİ PROFİL ADAYLARI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — profil/registry YAZMAZ
          </span>
          <button
            type="button"
            data-testid="pc-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            GRUP {counts.groups} · VARYANT {counts.variants} · İNCELEME {counts.needsReview}
          </span>
          {snap.trimmed > 0 && (
            <span
              data-testid="pc-trim"
              className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 text-[var(--oem-warn)]"
            >
              <Scissors size={10} /> {snap.trimmed} ADAY KIRPILDI (tavan {CANDIDATE_ROW_CAP})
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Adaylar gerçek araç gözlemlerinden TÜRETİLİR — araçtan okunan bir alan değildir,
          bu yüzden {OBSERVABILITY_LABEL.DERIVED} olarak işaretlenir. Hiçbir aday burada
          onaylanmaz; çakışmalar OTOMATİK ÇÖZÜLMEZ, insan karar verir.
        </p>
      </div>

      <div
        data-testid="pc-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        DURUM: {CANDIDATE_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      <div
        data-testid="pc-groups"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          SİNYAL GRUPLARI ({groups.length})
        </div>
        {groups.length === 0 ? (
          <div className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Güçlü aday yok. Bu "bu markada üretici PID'i yok" DEMEK DEĞİLDİR: aynı sinyalin
            yeterli sayıda araçta tekrar etmesi gerekir — tek araçta bir kez görülen sinyal
            KANIT sayılmaz.
          </div>
        ) : groups.map((g) => (
          <div
            key={g.key}
            data-testid={`pc-group-${g.key}`}
            data-review={g.needsReview ? 'required' : 'none'}
            className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] font-bold text-[var(--oem-ink)]">
                {g.manufacturer} · {g.pidOrDid}
              </span>
              <span className="rounded border border-[var(--oem-line-strong)] px-1 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
                mode {g.mode || '—'}
              </span>
              <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                {g.variants.length} ECU varyantı
              </span>
              {g.needsReview && (
                <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                  <AlertTriangle size={10} /> İNSAN KARARI GEREKLİ
                </span>
              )}
            </div>

            {g.conflicts.length > 0 && (
              <ul className="mt-0.5 list-inside list-disc font-mono text-[9px] leading-relaxed text-[var(--oem-warn)]">
                {g.conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}

            {g.variants.map((v, i) => (
              <div key={`${v.ecuAddress}-${i}`} className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
                ECU {v.ecuAddress || '—'} · {CANDIDATE_STATUS_LABEL[v.candidateStatus] ?? v.candidateStatus}
                {' '}· güven %{Math.round(v.confidence * 100)} · {v.vehicleCount} araç · {v.seenCount} gözlem
                {' '}· {formatAge(v.lastSeen > 0 ? v.lastSeen : null, snap.readAt) ?? 'zaman damgası yok'}
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Bu ekran hiçbir profil dosyasını, registry'yi veya bilgi tabanını DEĞİŞTİRMEZ.
        Aday üretimi salt-okunur bir türetmedir: aynı sinyalin farklı ECU'lardaki
        varyantları tek grupta toplanır ama GİZLENMEZ; çakışan güven değerleri
        birleştirilmez, çakışma olarak listelenir. Onay yolu bilinçli olarak
        uygulanmamıştır — bir aday ürüne girecekse bunu insan yapar.
      </p>
    </div>
  );
});
