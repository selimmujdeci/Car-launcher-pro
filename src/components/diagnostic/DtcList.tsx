import { memo } from 'react';
import type { DTCCode } from '../../platform/diagnostic/diagnosticStore';

type Severity = DTCCode['severity'];

const SEV_CONFIG: Record<Severity, { dot: string; badge: string; label: string }> = {
  critical: {
    dot:   'bg-red-500',
    badge: 'bg-red-950 border-red-700 text-red-400',
    label: 'KRİTİK',
  },
  warning: {
    dot:   'bg-orange-500',
    badge: 'bg-orange-950 border-orange-700 text-orange-400',
    label: 'ORTA',
  },
  info: {
    dot:   'bg-green-500',
    badge: 'bg-green-950 border-green-700 text-green-400',
    label: 'DÜŞÜK',
  },
};

function msAgo(ts: number | null): string {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.round(d / 1000)}s önce`;
  return `${Math.round(d / 60_000)}dk önce`;
}

interface Props {
  codes:        DTCCode[];
  selectedCode: string | null;
  isReading:    boolean;
  lastReadAt:   number | null;
  obdConnected: boolean;
  onSelect:     (code: string | null) => void;
  onRead:       () => void;
}

export const DtcList = memo(function DtcList({
  codes, selectedCode, isReading, lastReadAt, obdConnected, onSelect, onRead,
}: Props) {
  return (
    <div className="flex flex-col h-full gap-2">
      {/* Header bar */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onRead}
          disabled={isReading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono transition-colors disabled:opacity-50 border-blue-700 text-blue-400 hover:bg-blue-900/30"
        >
          {isReading ? (
            <>
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"/>
              OKUNUYOR…
            </>
          ) : (
            <>⟳ DTC OKU</>
          )}
        </button>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className={`w-1.5 h-1.5 rounded-full ${obdConnected ? 'bg-green-400' : 'bg-gray-600'}`}/>
          <span className="text-xs font-mono text-gray-500">
            {obdConnected ? 'OBD bağlı' : 'OBD yok'}
          </span>
          {lastReadAt && (
            <span className="text-xs font-mono text-gray-600 ml-1">
              · {msAgo(lastReadAt)}
            </span>
          )}
        </div>
      </div>

      {/* Code count summary */}
      {codes.length > 0 && (
        <div className="flex gap-2 shrink-0">
          {(['critical', 'warning', 'info'] as Severity[]).map((sev) => {
            const n = codes.filter((c) => c.severity === sev).length;
            if (!n) return null;
            return (
              <span
                key={sev}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-mono ${SEV_CONFIG[sev].badge}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${SEV_CONFIG[sev].dot}`}/>
                {n} {SEV_CONFIG[sev].label}
              </span>
            );
          })}
        </div>
      )}

      {/* Code list */}
      <div className="flex-1 overflow-y-auto border border-gray-700 rounded">
        {codes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <span className="text-green-400 text-2xl">✓</span>
            <p className="text-gray-500 text-xs font-mono">Aktif hata kodu yok</p>
            {!lastReadAt && (
              <p className="text-gray-600 text-xs font-mono">Okumak için "DTC OKU" butonuna bas</p>
            )}
          </div>
        ) : (
          codes.map((dtc) => {
            const cfg = SEV_CONFIG[dtc.severity];
            const isSelected = selectedCode === dtc.code;
            return (
              <button
                key={dtc.code}
                onClick={() => onSelect(isSelected ? null : dtc.code)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 border-b border-gray-800 last:border-0 text-left transition-colors ${
                  isSelected ? 'bg-gray-700/60' : 'hover:bg-gray-800/50'
                }`}
              >
                {/* Severity dot */}
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${cfg.dot} ${dtc.severity === 'critical' ? 'animate-pulse' : ''}`}/>

                {/* Code + desc */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-mono text-xs font-bold">{dtc.code}</span>
                    <span className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    <span className="text-gray-500 text-[9px] font-mono ml-auto">{dtc.system}</span>
                  </div>
                  <p className="text-gray-300 text-xs mt-0.5 truncate">{dtc.description}</p>
                </div>

                <span className="text-gray-600 text-xs shrink-0">{isSelected ? '▲' : '▼'}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});
