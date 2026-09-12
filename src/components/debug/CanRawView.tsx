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
              ? 'border-[var(--oem-good)] text-[var(--oem-good)] hover:bg-[var(--oem-good-soft)]'
              : 'border-[var(--oem-warn)] text-[var(--oem-warn)] hover:bg-[var(--oem-warn-soft)]'
          }`}
        >
          {paused ? '▶ DEVAM' : '⏸ DURAKLAT'}
        </button>
        <button
          onClick={clearLog}
          className="px-3 py-1 rounded text-xs font-mono border border-[var(--oem-line-strong)] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
        >
          TEMİZLE
        </button>
        <span className="ml-auto text-xs font-mono text-[var(--oem-ink-3)]">
          {log.length} / 500
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[9rem_5rem_1fr] gap-x-3 px-2 pb-1 border-b border-[var(--oem-line)] text-[var(--oem-ink-3)] text-xs font-mono uppercase">
        <span>Zaman</span>
        <span>Frame</span>
        <span>Yük</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-[var(--oem-ink-3)] text-xs font-mono px-2 py-4">
            CAN verisi yok — toplama yalnız bu ekran açıkken yapılır.
          </p>
        ) : (
          log.map((entry, i) => (
            <div
              key={i}
              className="grid grid-cols-[9rem_5rem_1fr] gap-x-3 px-2 py-0.5 text-xs font-mono hover:bg-[var(--oem-surface-2)] even:bg-[var(--oem-surface-2)]"
            >
              <span className="text-[var(--oem-ink-2)]">{fmtTs(entry.ts)}</span>
              <span className="text-[var(--oem-good)]">{entry.frameId}</span>
              <span className="text-[var(--oem-ink)] truncate">{entry.payload}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
