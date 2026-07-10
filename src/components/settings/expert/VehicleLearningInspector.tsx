/**
 * VehicleLearningInspector — Expert Mode "Araç Öğrenme" bölümü (P2-5, SALT-OKUNUR).
 *
 * Öğrenilmiş evidence/pattern özetini yalnız GÖRÜNÜRLÜK amacıyla gösterir:
 * toplam/weak/candidate/strong, manual-review, stale/prune, en güçlü PID/DID adayları,
 * marka cluster özeti, son öğrenme zamanı.
 *
 * KESİN: Onayla / registry'ye yaz / otomatik promote butonu YOK. Hiçbir güvenlik-kritik
 * kararı değiştirmez. Yalnız vehicleLearningIntegrationService (salt-okunur) okur. Zero-leak:
 * abonelik yok (on-demand); yalnız mount'ta bir kez hesaplar, panel açıkken (idle) çalışır.
 */

import { memo, useMemo } from 'react';
import { Brain, AlertTriangle, Layers, Clock } from 'lucide-react';
import {
  vehicleLearningIntegrationService,
  type ExpertLearningSummary,
} from '../../../platform/vehicleLearningIntegrationService';

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('tr-TR'); } catch { return '—'; }
}

const StatCell = memo(function StatCell({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${tone ?? 'text-white'}`}>{value}</div>
    </div>
  );
});

export const VehicleLearningInspector = memo(function VehicleLearningInspector() {
  // On-demand: panel render'ında bir kez hesaplanır (service içi memoize).
  const s: ExpertLearningSummary = useMemo(() => vehicleLearningIntegrationService.getExpertSummary(), []);

  const hasData = s.totalEvidence > 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
          <Brain className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <div className="text-sm font-black uppercase tracking-widest text-white">Araç Öğrenme</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/30">
            Evidence &amp; Pattern özeti — salt-okunur
          </div>
        </div>
        {!s.patternDetailEnabled && (
          <span className="ml-auto rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">
            Basit Mod
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 p-6 text-center">
          <Brain className="h-7 w-7 text-white/25" />
          <p className="text-sm font-medium text-white/60">Henüz öğrenilmiş kanıt yok.</p>
          <p className="text-xs text-white/35">Farklı araçlarda PID/DID keşfi biriktikçe burada görünecek.</p>
        </div>
      ) : (
        <>
          {/* Sayımlar */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <StatCell label="Toplam" value={s.totalEvidence} />
            <StatCell label="Weak" value={s.weakCount} tone="text-white/60" />
            <StatCell label="Candidate" value={s.candidateCount} tone="text-indigo-300" />
            <StatCell label="Strong" value={s.strongCount} tone="text-emerald-300" />
            <StatCell label="Manuel İnceleme" value={s.manualReviewCount} tone="text-amber-300" />
            <StatCell label="Conflict" value={s.conflictCount} tone="text-rose-300" />
            <StatCell label="Stale" value={s.staleCount} tone="text-zinc-300" />
            <StatCell label="Prune Adayı" value={s.pruneCandidateCount} tone="text-zinc-300" />
          </div>

          {/* En güçlü adaylar */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-300/80">
                <Layers className="h-3.5 w-3.5" /> Güçlü PID Adayları
              </div>
              <div className="font-mono text-xs text-white/70">
                {s.strongPidCandidates.length ? s.strongPidCandidates.join(', ') : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-300/80">
                <Layers className="h-3.5 w-3.5" /> Güçlü DID Adayları
              </div>
              <div className="font-mono text-xs text-white/70">
                {s.strongDidCandidates.length ? s.strongDidCandidates.join(', ') : '—'}
              </div>
            </div>
          </div>

          {/* Marka cluster özeti */}
          {s.manufacturerClusters.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-white/40">Marka Kümeleri</div>
              <div className="flex flex-wrap gap-1.5">
                {s.manufacturerClusters.map((c) => (
                  <span key={c.manufacturer} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-[11px] text-white/70">
                    {c.manufacturer} · {c.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2 text-[11px] text-white/45">
            <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> {s.patternCount} pattern</span>
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Son öğrenme: {formatTime(s.lastLearnedAt)}</span>
          </div>

          {(s.manualReviewCount > 0 || s.conflictCount > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-100/80">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>
                {s.manualReviewCount} pattern manuel inceleme, {s.conflictCount} çelişki içeriyor. Bu adaylar
                otomatik olarak profile/registry'ye <span className="font-semibold">yazılmaz</span> — yalnız bilgi amaçlıdır.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
});
