import { memo, useState, useCallback } from 'react';
import { useDebugStore } from '../../platform/debug';
import { CanRawView }      from './CanRawView';
import { SignalView }      from './SignalView';
import { ReverseLogView }  from './ReverseLogView';
import { PerformanceView } from './PerformanceView';
type Tab = 'can' | 'signals' | 'reverse' | 'perf';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'can',     label: 'CAN LOG'      },
  { id: 'signals', label: 'SIGNALS'      },
  { id: 'reverse', label: 'REVERSE'      },
  { id: 'perf',    label: 'PERF / HATA'  },
];

function downloadJson(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const DebugPanel = memo(function DebugPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('signals');
  const [copied, setCopied] = useState(false);

  const handleExport = useCallback(() => {
    const snap = useDebugStore.getState().exportSnapshot();
    downloadJson(snap, `debug-${Date.now()}.json`);
  }, []);

  const handleCopy = useCallback(async () => {
    const snap = useDebugStore.getState().exportSnapshot();
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // Start/stop canRawLog collection with panel lifecycle
  useState(() => {
    useDebugStore.getState().setCollecting(true);
    return () => useDebugStore.getState().setCollecting(false);
  });

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-gray-950 text-gray-100"
      style={{ fontFamily: 'monospace' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-gray-900 shrink-0">
        <span className="text-green-400 text-sm font-bold tracking-widest">
          ◈ CAR LAUNCHER DEBUG
        </span>
        <span className="text-gray-600 text-xs">read-only · technician</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1 rounded border border-gray-600 text-gray-300 text-xs hover:bg-gray-800"
          >
            EXPORT JSON
          </button>
          <button
            onClick={handleCopy}
            className={`px-3 py-1 rounded border text-xs transition-colors ${
              copied
                ? 'border-green-600 text-green-400'
                : 'border-gray-600 text-gray-300 hover:bg-gray-800'
            }`}
          >
            {copied ? '✓ COPIED' : 'COPY'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded border border-gray-600 text-gray-300 text-xs hover:bg-red-900/30 hover:border-red-700"
          >
            ✕ CLOSE
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-700 shrink-0 bg-gray-900">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs font-mono tracking-wider border-r border-gray-800 transition-colors ${
              tab === id
                ? 'bg-gray-800 text-green-400 border-b-2 border-b-green-500'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden p-3">
        {tab === 'can'     && <CanRawView />}
        {tab === 'signals' && <SignalView />}
        {tab === 'reverse' && <ReverseLogView />}
        {tab === 'perf'    && <PerformanceView />}
      </div>
    </div>
  );
});
