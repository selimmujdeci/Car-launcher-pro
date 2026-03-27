import { memo } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Trash2, Info, ShieldAlert } from 'lucide-react';
import {
  useDTCState,
  readDTCCodes, clearDTCCodes,
  type DTCCode, type DTCSeverity,
} from '../../platform/dtcService';

/* ── Severity config ─────────────────────────────────────── */

const SEV: Record<DTCSeverity, { color: string; bg: string; border: string; label: string }> = {
  critical: {
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/25',
    label: 'Kritik',
  },
  warning: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/25',
    label: 'Uyarı',
  },
  info: {
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/25',
    label: 'Bilgi',
  },
};

/* ── DTC Code card ───────────────────────────────────────── */

const DTCCodeCard = memo(function DTCCodeCard({ code }: { code: DTCCode }) {
  const cfg = SEV[code.severity];

  return (
    <div className={`rounded-2xl border p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Code + badge */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`font-black text-lg tracking-widest tabular-nums ${cfg.color}`}>
              {code.code}
            </span>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border ${cfg.color} ${cfg.border} ${cfg.bg}`}>
              {cfg.label}
            </span>
            <span className="text-slate-600 text-[10px]">{code.system}</span>
          </div>

          {/* Description */}
          <div className="text-white text-sm font-semibold leading-snug mb-2">
            {code.description}
          </div>

          {/* Possible causes */}
          {code.possibleCauses.length > 0 && (
            <div>
              <div className="flex items-center gap-1 text-slate-600 text-[10px] uppercase tracking-widest mb-1.5">
                <Info className="w-3 h-3" />
                Olası Nedenler
              </div>
              <div className="flex flex-wrap gap-1.5">
                {code.possibleCauses.map((cause, i) => (
                  <span
                    key={i}
                    className="text-[10px] text-slate-400 bg-white/5 border border-white/[0.06] px-2 py-0.5 rounded-full"
                  >
                    {cause}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${cfg.color}`} />
      </div>
    </div>
  );
});

/* ── Main panel ──────────────────────────────────────────── */

function DTCPanelInner() {
  const dtc = useDTCState();

  const criticalCount = dtc.codes.filter((c) => c.severity === 'critical').length;
  const warningCount  = dtc.codes.filter((c) => c.severity === 'warning').length;

  const lastReadStr = dtc.lastReadAt
    ? new Date(dtc.lastReadAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* ── Title row ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <span className="text-white font-black text-base uppercase tracking-widest">Arıza Teşhisi</span>
          </div>
          {lastReadStr && (
            <div className="text-slate-600 text-[11px] mt-0.5 ml-7">
              Son tarama: {lastReadStr}
            </div>
          )}
        </div>

        {/* Severity counters */}
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-full px-2.5 py-1 text-red-400 text-xs font-black">
              {criticalCount} Kritik
            </div>
          )}
          {warningCount > 0 && (
            <div className="bg-amber-500/15 border border-amber-500/30 rounded-full px-2.5 py-1 text-amber-400 text-xs font-black">
              {warningCount} Uyarı
            </div>
          )}
        </div>
      </div>

      {/* ── Action buttons ─────────────────────────────── */}
      <div className="flex gap-3">
        <button
          onClick={readDTCCodes}
          disabled={dtc.isReading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded-2xl py-3.5 font-bold text-sm hover:bg-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          <RefreshCw className={`w-4 h-4 ${dtc.isReading ? 'animate-spin' : ''}`} />
          {dtc.isReading ? 'Okunuyor…' : 'Hataları Oku'}
        </button>

        <button
          onClick={clearDTCCodes}
          disabled={dtc.isClearing || dtc.codes.length === 0}
          className="flex-1 flex items-center justify-center gap-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-2xl py-3.5 font-bold text-sm hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          <Trash2 className={`w-4 h-4 ${dtc.isClearing ? 'animate-spin' : ''}`} />
          {dtc.isClearing ? 'Siliniyor…' : 'Hata Kodlarını Sil'}
        </button>
      </div>

      {/* ── Codes / empty state ────────────────────────── */}
      {dtc.codes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          {dtc.lastReadAt ? (
            <>
              <CheckCircle2 className="w-14 h-14 text-emerald-400" />
              <div className="text-emerald-400 font-black text-lg">Arıza Kodu Yok</div>
              <div className="text-slate-600 text-sm text-center">
                Araç sistemleri normal çalışıyor
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="w-14 h-14 text-slate-700" />
              <div className="text-slate-500 font-bold text-base">Henüz tarama yapılmadı</div>
              <div className="text-slate-700 text-sm">
                «Hataları Oku» butonuna basarak OBD taraması başlatın
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Sort: critical first */}
          {[...dtc.codes]
            .sort((a, b) => {
              const order: Record<DTCSeverity, number> = { critical: 0, warning: 1, info: 2 };
              return order[a.severity] - order[b.severity];
            })
            .map((code) => (
              <DTCCodeCard key={code.code} code={code} />
            ))}
        </div>
      )}

      {/* ── Error ─────────────────────────────────────── */}
      {dtc.error && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-4 text-red-400 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {dtc.error}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-slate-700 text-[10px] text-center leading-relaxed">
        Tanımlamalar genel OBD-II standartlarına dayanmaktadır.
        Kesin teşhis için yetkili servise başvurun.
      </p>
    </div>
  );
}

export const DTCPanel = memo(DTCPanelInner);
