import { memo } from 'react';
import { useDebugStore } from '../../platform/debug';
import type { SignalSource } from '../../platform/debug';

const SOURCE_COLOR: Record<SignalSource, string> = {
  CAN:  'text-green-400',
  OBD:  'text-blue-400',
  GPS:  'text-yellow-400',
  NONE: 'text-gray-600',
};

const SOURCE_BADGE: Record<SignalSource, string> = {
  CAN:  'bg-green-900/40 border-green-700',
  OBD:  'bg-blue-900/40 border-blue-700',
  GPS:  'bg-yellow-900/40 border-yellow-700',
  NONE: 'bg-gray-900/40 border-gray-700',
};

function SourceBadge({ src }: { src: SignalSource }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-mono ${SOURCE_COLOR[src]} ${SOURCE_BADGE[src]}`}>
      {src}
    </span>
  );
}

function msAgo(ts: number) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 1000) return `${d}ms`;
  return `${(d / 1000).toFixed(1)}s`;
}

const SIGNAL_ORDER = ['speed', 'fuel', 'reverse', 'heading', 'location'];

export const SignalView = memo(function SignalView() {
  const liveSignals = useDebugStore((s) => s.liveSignals);
  const canExtras   = useDebugStore((s) => s.canExtras);
  const fallback    = useDebugStore((s) => s.fallback);

  const allSignals: Array<{ label: string; value: string; src: SignalSource; ts: number }> = [
    ...SIGNAL_ORDER.map((key) => {
      const entry = liveSignals[key];
      return {
        label: key,
        value: entry?.value ?? '—',
        src:   (entry?.source ?? 'NONE') as SignalSource,
        ts:    entry?.ts ?? 0,
      };
    }),
    {
      label: 'doorOpen',
      value: canExtras.doorOpen == null ? '—' : String(canExtras.doorOpen),
      src:   'CAN' as SignalSource,
      ts:    0,
    },
    {
      label: 'headlightsOn',
      value: canExtras.headlightsOn == null ? '—' : String(canExtras.headlightsOn),
      src:   'CAN' as SignalSource,
      ts:    0,
    },
    {
      label: 'tpms',
      value: canExtras.tpms ? canExtras.tpms.join(' / ') : '—',
      src:   'CAN' as SignalSource,
      ts:    0,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Priority legend */}
      <div className="flex items-center gap-2 px-1 text-xs font-mono text-gray-500">
        <span>Priority:</span>
        <SourceBadge src="CAN" />
        <span className="text-gray-600">›</span>
        <SourceBadge src="OBD" />
        <span className="text-gray-600">›</span>
        <SourceBadge src="GPS" />
      </div>

      {/* Source health row */}
      <div className="flex gap-3 px-1">
        {(['CAN', 'OBD', 'GPS'] as const).map((src) => {
          const alive =
            src === 'CAN' ? fallback.canAlive :
            src === 'OBD' ? !fallback.allDead && !fallback.gpsFallbackActive :
            !fallback.allDead && fallback.gpsFallbackActive;
          return (
            <div key={src} className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono ${alive ? 'border-green-700 bg-green-900/20' : 'border-gray-700 bg-gray-900/20'}`}>
              <span className={alive ? 'text-green-400' : 'text-gray-600'}>{src}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${alive ? 'bg-green-400' : 'bg-gray-600'}`} />
            </div>
          );
        })}
        {fallback.obdFallbackActive && (
          <span className="text-xs font-mono text-blue-400 self-center">OBD fallback active</span>
        )}
        {fallback.gpsFallbackActive && (
          <span className="text-xs font-mono text-yellow-400 self-center">GPS fallback active</span>
        )}
        {fallback.allDead && (
          <span className="text-xs font-mono text-red-400 self-center">ALL DEAD — last values</span>
        )}
      </div>

      {/* Signal table */}
      <div className="border border-gray-700 rounded overflow-hidden">
        <div className="grid grid-cols-[8rem_1fr_5rem_5rem] gap-x-3 px-3 py-1.5 bg-gray-800 text-gray-500 text-xs font-mono uppercase border-b border-gray-700">
          <span>Signal</span>
          <span>Value</span>
          <span>Source</span>
          <span>Age</span>
        </div>
        {allSignals.map(({ label, value, src, ts }) => (
          <div
            key={label}
            className="grid grid-cols-[8rem_1fr_5rem_5rem] gap-x-3 px-3 py-1.5 text-xs font-mono border-b border-gray-800 last:border-0 hover:bg-gray-800/40"
          >
            <span className="text-gray-400">{label}</span>
            <span className="text-gray-100">{value}</span>
            <SourceBadge src={src} />
            <span className="text-gray-600">{ts ? msAgo(ts) : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
