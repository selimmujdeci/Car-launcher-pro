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
          <div className="text-primary text-sm font-semibold leading-snug mb-2">
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
                    className="text-[10px] text-slate-400 var(--panel-bg-secondary) border border-white/[0.06] px-2 py-0.5 rounded-full"
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
    <div className="flex flex-col gap-5 p-6 glass-card border-none !shadow-none min-h-full">

      {/* ── Title row ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <span className="text-primary font-black text-lg uppercase tracking-widest">Arıza Teşhisi</span>
              {lastReadStr && (
                <div className="text-secondary text-[11px] font-bold uppercase tracking-wider mt-0.5 opacity-60">
                  Son tarama: {lastReadStr}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Severity counters */}
        <div className="flex items-center gap-2.5">
          {criticalCount > 0 && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-full px-3 py-1.5 text-red-500 text-[10px] font-black uppercase tracking-wider shadow-sm">
              {criticalCount} KRİTİK
            </div>
          )}
          {warningCount > 0 && (
            <div className="bg-amber-500/15 border border-amber-500/30 rounded-full px-3 py-1.5 text-amber-500 text-[10px] font-black uppercase tracking-wider shadow-sm">
              {warningCount} UYARI
            </div>
          )}
        </div>
      </div>

      {/* ── Action buttons ─────────────────────────────── */}
      <div className="flex gap-4">
        <button
          onClick={readDTCCodes}
          disabled={dtc.isReading}
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-blue-500/10 border border-blue-500/25 text-blue-600 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-md"
        >
          <RefreshCw className={`w-5 h-5 ${dtc.isReading ? 'animate-spin' : ''}`} />
          {dtc.isReading ? 'OKUNUYOR…' : 'TARAMAYI BAŞLAT'}
        </button>

        <button
          onClick={clearDTCCodes}
          disabled={dtc.isClearing || dtc.codes.length === 0}
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-red-500/10 border border-red-500/25 text-red-600 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-md"
        >
          <Trash2 className={`w-5 h-5 ${dtc.isClearing ? 'animate-spin' : ''}`} />
          {dtc.isClearing ? 'SİLİNİYOR…' : 'HAFIZAYI TEMİZLE'}
        </button>
      </div>

      {/* ── Codes / empty state ────────────────────────── */}
      <div className="flex-1">
        {dtc.codes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-5 glass-card border-none !shadow-none var(--panel-bg-secondary)">
            {dtc.lastReadAt ? (
              <>
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                </div>
                <div className="text-center">
                  <div className="text-emerald-600 font-black text-xl uppercase tracking-widest">SİSTEM TEMİZ</div>
                  <div className="text-secondary text-sm font-bold mt-2 opacity-70 uppercase tracking-wider">
                    Araç sistemleri normal çalışıyor
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full var(--panel-bg-secondary) flex items-center justify-center border border-white/10">
                  <AlertTriangle className="w-10 h-10 text-secondary opacity-40" />
                </div>
                <div className="text-center">
                  <div className="text-secondary font-black text-lg uppercase tracking-widest opacity-60">HENÜZ TARAMA YAPILMADI</div>
                  <div className="text-secondary text-[11px] font-bold mt-2 opacity-40 uppercase tracking-widest">
                    OBD TARAMASI İÇİN BUTONA BASIN
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
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
      </div>

      {/* ── Error ─────────────────────────────────────── */}
      {dtc.error && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-5 text-red-600 text-sm font-bold flex items-start gap-3 shadow-lg">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          {dtc.error}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-secondary text-[10px] font-bold text-center leading-relaxed opacity-40 uppercase tracking-[0.1em] px-8">
        Tanımlamalar genel OBD-II standartlarına dayanmaktadır.
        Kesin teşhis için yetkili servise başvurun.
      </p>
    </div>
  );
}

export const DTCPanel = memo(DTCPanelInner);


