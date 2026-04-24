import { memo } from 'react';
import type { DTCCode } from '../../platform/diagnostic/diagnosticStore';

type Severity = DTCCode['severity'];

const SEV_STYLE: Record<Severity, { header: string; text: string; label: string }> = {
  critical: { header: 'border-red-700 bg-red-950/50',    text: 'text-red-400',    label: 'KRİTİK' },
  warning:  { header: 'border-orange-700 bg-orange-950/50', text: 'text-orange-400', label: 'ORTA' },
  info:     { header: 'border-green-700 bg-green-950/50', text: 'text-green-400',  label: 'DÜŞÜK' },
};

const SUGGESTIONS: Record<Severity, string> = {
  critical: 'Aracı durdurun ve yetkili servise başvurun.',
  warning:  'En kısa sürede yetkili serviste kontrol ettirin.',
  info:     'Bir sonraki bakımda servise bildirin.',
};

interface Props {
  code:    string;
  codes:   DTCCode[];
  onClose: () => void;
}

export const ErrorDetail = memo(function ErrorDetail({ code, codes, onClose }: Props) {
  const dtc = codes.find((c) => c.code === code);
  if (!dtc) return null;

  const sev = SEV_STYLE[dtc.severity];

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 border-t border-gray-700 bg-gray-950 rounded-t-xl shadow-2xl"
      style={{ maxHeight: '55%' }}
    >
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b rounded-t-xl ${sev.header}`}>
        <div>
          <span className={`text-sm font-bold font-mono ${sev.text}`}>{dtc.code}</span>
          <span className={`ml-2 text-xs font-mono ${sev.text} opacity-70`}>{sev.label}</span>
        </div>
        <p className="text-gray-200 text-xs flex-1 truncate">{dtc.description}</p>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-200 text-lg leading-none shrink-0"
          aria-label="Kapat"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto p-4 flex flex-col gap-3" style={{ maxHeight: 'calc(55vh - 50px)' }}>
        {/* System */}
        <div className="flex gap-2 items-center">
          <span className="text-gray-500 text-xs font-mono w-20 shrink-0">Sistem:</span>
          <span className="text-gray-200 text-xs font-mono">{dtc.system}</span>
        </div>

        {/* Possible causes */}
        <div>
          <p className="text-gray-500 text-xs font-mono mb-1.5">Olası Nedenler:</p>
          <ul className="flex flex-col gap-1">
            {dtc.possibleCauses.map((cause, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-300 font-mono">
                <span className={`mt-0.5 shrink-0 ${sev.text}`}>▸</span>
                {cause}
              </li>
            ))}
          </ul>
        </div>

        {/* Suggestion */}
        <div className={`flex gap-2 items-start px-3 py-2 rounded border ${sev.header}`}>
          <span className={`text-sm shrink-0 ${sev.text}`}>⚑</span>
          <p className={`text-xs font-mono ${sev.text}`}>{SUGGESTIONS[dtc.severity]}</p>
        </div>
      </div>
    </div>
  );
});
