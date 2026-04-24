import { memo, useEffect, useRef } from 'react';
import { useDebugStore } from '../../platform/debug';

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':') + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export const CanRawView = memo(function CanRawView() {
  const log     = useDebugStore((s) => s.canRawLog);
  const paused  = useDebugStore((s) => s.collecting === false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom unless paused
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log, paused]);

  function togglePause() {
    useDebugStore.getState().setCollecting(paused);
  }
  function clearLog() {
    useDebugStore.getState().clearCanRaw();
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={togglePause}
          className={`px-3 py-1 rounded text-xs font-mono border ${
            paused
              ? 'border-green-500 text-green-400 hover:bg-green-900/30'
              : 'border-yellow-500 text-yellow-400 hover:bg-yellow-900/30'
          }`}
        >
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
        <button
          onClick={clearLog}
          className="px-3 py-1 rounded text-xs font-mono border border-gray-600 text-gray-400 hover:bg-gray-800"
        >
          CLEAR
        </button>
        <span className="ml-auto text-xs font-mono text-gray-500">
          {log.length} / 500
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[9rem_5rem_1fr] gap-x-3 px-2 pb-1 border-b border-gray-700 text-gray-500 text-xs font-mono uppercase">
        <span>Timestamp</span>
        <span>Frame</span>
        <span>Payload</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-gray-600 text-xs font-mono px-2 py-4">
            No CAN data — panel must be open to collect
          </p>
        ) : (
          log.map((entry, i) => (
            <div
              key={i}
              className="grid grid-cols-[9rem_5rem_1fr] gap-x-3 px-2 py-0.5 text-xs font-mono hover:bg-gray-800/50 even:bg-gray-900/30"
            >
              <span className="text-gray-400">{fmtTs(entry.ts)}</span>
              <span className="text-green-400">{entry.frameId}</span>
              <span className="text-gray-200 truncate">{entry.payload}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
