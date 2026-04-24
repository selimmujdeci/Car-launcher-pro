import { memo } from 'react';
import { useDebugStore } from '../../platform/debug';

function msAgo(ts: number) {
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < 1000) return `${d}ms`;
  return `${(d / 1000).toFixed(1)}s ago`;
}

function HzBar({ hz, max = 10 }: { hz: number; max?: number }) {
  const pct = Math.min(100, (hz / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 text-right text-green-400 font-mono text-xs">{hz} Hz</span>
    </div>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-gray-400 text-xs font-mono">{label}</span>
      <div className="text-right">
        <span className="text-gray-100 text-xs font-mono">{value}</span>
        {sub && <span className="ml-2 text-gray-600 text-xs font-mono">{sub}</span>}
      </div>
    </div>
  );
}

export const PerformanceView = memo(function PerformanceView() {
  const perf     = useDebugStore((s) => s.perf);
  const fallback = useDebugStore((s) => s.fallback);
  const errorLog = useDebugStore((s) => s.errorLog);

  return (
    <div className="flex flex-col gap-4 px-1">
      {/* Event rates */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">Event Rates</p>
        <div className="flex flex-col gap-2">
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-green-400 text-xs font-mono">CAN</span>
              <span className="text-gray-500 text-xs font-mono">{msAgo(perf.canLastTs)}</span>
            </div>
            <HzBar hz={perf.canHz} max={20} />
          </div>
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-blue-400 text-xs font-mono">OBD</span>
              <span className="text-gray-500 text-xs font-mono">{msAgo(perf.obdLastTs)}</span>
            </div>
            <HzBar hz={perf.obdHz} max={5} />
          </div>
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-yellow-400 text-xs font-mono">GPS</span>
              <span className="text-gray-500 text-xs font-mono">{msAgo(perf.gpsLastTs)}</span>
            </div>
            <HzBar hz={perf.gpsHz} max={2} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="border border-gray-700 rounded px-3">
        <StatRow label="Listeners" value={String(perf.listenerCount)} />
        <StatRow label="CAN dropped" value={String(perf.canDropped)} sub="invalid frames" />
        <StatRow label="OBD dropped" value={String(perf.obdDropped)} sub="invalid frames" />
        <StatRow label="GPS dropped" value={String(perf.gpsDropped)} sub="invalid frames" />
      </div>

      {/* Fallback status */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">Source Status</p>
        <div className="border border-gray-700 rounded px-3">
          <StatRow
            label="CAN"
            value={fallback.canAlive ? 'alive' : 'stale'}
            sub={fallback.canLastSeen ? msAgo(fallback.canLastSeen) : 'never seen'}
          />
          <StatRow
            label="OBD fallback"
            value={fallback.obdFallbackActive ? 'ACTIVE' : 'inactive'}
            sub={fallback.obdLastSeen ? msAgo(fallback.obdLastSeen) : 'never seen'}
          />
          <StatRow
            label="GPS fallback"
            value={fallback.gpsFallbackActive ? 'ACTIVE' : 'inactive'}
            sub={fallback.gpsLastSeen ? msAgo(fallback.gpsLastSeen) : 'never seen'}
          />
          <StatRow
            label="All dead"
            value={fallback.allDead ? 'YES' : 'no'}
          />
        </div>
      </div>

      {/* Error log */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-gray-500 text-xs font-mono uppercase">Error Log</p>
          <button
            onClick={() => useDebugStore.getState().clearErrorLog()}
            className="px-2 py-0.5 rounded text-xs font-mono border border-gray-700 text-gray-500 hover:bg-gray-800"
          >
            CLEAR
          </button>
        </div>
        <div className="border border-gray-700 rounded max-h-40 overflow-y-auto">
          {errorLog.length === 0 ? (
            <p className="text-gray-700 text-xs font-mono px-3 py-3">No errors</p>
          ) : (
            errorLog.slice().reverse().map((e, i) => (
              <div key={i} className="flex gap-2 px-3 py-1 text-xs font-mono border-b border-gray-800 last:border-0">
                <span className={
                  e.level === 'error' ? 'text-red-400' :
                  e.level === 'warn'  ? 'text-yellow-400' :
                  'text-gray-500'
                }>
                  {e.level.toUpperCase()}
                </span>
                <span className="text-gray-500">[{e.source}]</span>
                <span className="text-gray-300">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
