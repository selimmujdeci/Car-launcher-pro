import { useEffect, useRef, useState } from 'react';
import { X, Copy, CheckCheck } from 'lucide-react';
import { runtimeManager }  from '../../../core/runtime/AdaptiveRuntimeManager';
import { getReplayData, type BlackBoxSample } from '../../../platform/security/blackBoxService';
import { getNetworkEntries, clearNetworkEntries, type NetEntry } from './NetworkInterceptor';
import { useFpsCounter } from './useFpsCounter';

/* ── Local types (mirror private WorkerEntry without importing internals) ── */
type WorkerCrit = 'CRITICAL' | 'OPTIONAL';
type WEntry     = readonly [string, { readonly worker: Worker | null; readonly criticality: WorkerCrit }];

type Tab = 'workers' | 'timeline' | 'network' | 'fps';

const THERM_LABEL = ['Normal', 'Warm', 'Hot', 'Critical'] as const;
const THERM_HEX   = ['#22c55e', '#eab308', '#f97316', '#ef4444'] as const;
const MEM_HEX: Record<string, string> = { OK: '#22c55e', MOD: '#eab308', CRIT: '#ef4444' };

function statusColor(s: number | null): string {
  if (s == null)        return 'rgba(255,255,255,0.3)';
  if (s >= 200 && s < 300) return '#22c55e';
  if (s >= 400)          return '#ef4444';
  return '#eab308';
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function InspectorPanel({ onClose }: { onClose: () => void }) {
  const [tab,      setTab]      = useState<Tab>('workers');
  const [copied,   setCopied]   = useState(false);
  const [mode,     setMode]     = useState('');
  const [workers,  setWorkers]  = useState<WEntry[]>([]);
  const [timeline, setTimeline] = useState<BlackBoxSample[]>([]);
  const [network,  setNetwork]  = useState<readonly NetEntry[]>([]);

  const fps        = useFpsCounter(tab === 'fps');
  const fpsHistory = useRef<number[]>([]);

  /* Accumulate FPS history only while FPS tab is open */
  useEffect(() => {
    if (tab === 'fps' && fps > 0) {
      fpsHistory.current = [...fpsHistory.current.slice(-29), fps];
    }
  }, [fps, tab]);

  /* Poll runtime data at 2 Hz */
  useEffect(() => {
    function refresh(): void {
      setMode(String(runtimeManager.getMode()));
      setWorkers(Array.from(runtimeManager.getWorkers()) as WEntry[]);
      try { setTimeline(getReplayData().slice(-15).reverse()); } catch { /* not started yet */ }
      setNetwork([...getNetworkEntries()].slice(-20).reverse());
    }
    refresh();
    const id = setInterval(refresh, 500);
    return () => clearInterval(id);
  }, []);

  /* Build sanitised export — no lastCmd (navigation commands), no PII */
  function handleCopy(): void {
    try {
      const payload = {
        _meta:    { sanitized: true, noPII: true, exportedAt: new Date().toISOString() },
        runtime:  {
          mode,
          fps,
          workers: workers.map(([key, { criticality, worker }]) => ({
            key, criticality, status: worker != null ? 'alive' : 'dead',
          })),
        },
        timeline: timeline.slice(0, 10).map(({ ts, signals, env }) => ({ ts, signals, env })),
        network:  network.slice(0, 10).map(({ method, url, status, durationMs }) => ({
          method, url, status, durationMs,
        })),
      };
      void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div
      className="fixed bottom-16 right-4 flex flex-col select-none"
      style={{
        width: 360, height: 480, zIndex: 9990,
        background: '#050a14',
        border: '1px solid rgba(59,130,246,0.22)',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <span className="text-[11px] font-mono font-bold tracking-widest" style={{ color: '#3b82f6' }}>
          DEV INSPECTOR
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}>
            {mode}
          </span>
          <button onClick={onClose}
            className="flex items-center justify-center rounded"
            style={{ color: 'rgba(255,255,255,0.35)', width: 20, height: 20 }}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['workers', 'timeline', 'network', 'fps'] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-1.5 text-[9px] font-mono uppercase tracking-wider transition-colors"
              style={{
                color: active ? '#3b82f6' : 'rgba(255,255,255,0.22)',
                borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
              }}>
              {t}
              {t === 'fps' && fps > 0 && (
                <span style={{ marginLeft: 3, color: fps < 30 ? '#ef4444' : fps < 50 ? '#eab308' : '#22c55e' }}>
                  {fps}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px]"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>

        {/* Workers */}
        {tab === 'workers' && (
          <div className="space-y-1">
            {workers.length === 0
              ? <p className="text-center py-8" style={{ color: 'rgba(255,255,255,0.2)' }}>No workers registered</p>
              : workers.map(([key, { criticality, worker }]) => {
                  const alive = worker != null;
                  return (
                    <div key={key} className="flex items-center justify-between px-2 py-1.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <span className="truncate flex-1" style={{ color: 'rgba(255,255,255,0.75)' }}>{key}</span>
                      <span className="text-[9px] mx-2"
                        style={{ color: criticality === 'CRITICAL' ? '#f87171' : '#fbbf24' }}>
                        {criticality}
                      </span>
                      <span style={{ color: alive ? '#22c55e' : '#ef4444' }}>
                        {alive ? '● ALIVE' : '○ DEAD'}
                      </span>
                    </div>
                  );
                })}
          </div>
        )}

        {/* Timeline */}
        {tab === 'timeline' && (
          <div className="space-y-1">
            {timeline.length === 0
              ? <p className="text-center py-8" style={{ color: 'rgba(255,255,255,0.2)' }}>
                  BlackBox not started yet
                </p>
              : timeline.map((s, i) => {
                  const age   = Math.round((Date.now() - s.ts) / 1000);
                  const ti    = Math.min(3, Math.max(0, Math.floor(s.env.therm)));
                  return (
                    <div key={`${s.ts}-${i}`} className="px-2 py-1.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div className="flex items-center gap-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        <span className="text-[9px] w-7 text-right shrink-0"
                          style={{ color: 'rgba(255,255,255,0.2)' }}>-{age}s</span>
                        <span>spd:<span style={{ color: 'rgba(255,255,255,0.75)' }}>{s.signals.spd ?? '-'}</span></span>
                        <span>rpm:<span style={{ color: 'rgba(255,255,255,0.75)' }}>{s.signals.rpm ?? '-'}</span></span>
                        <span>fuel:<span style={{ color: 'rgba(255,255,255,0.75)' }}>{s.signals.fuel != null ? `${s.signals.fuel}%` : '-'}</span></span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 pl-10 text-[9px]">
                        <span style={{ color: THERM_HEX[ti] }}>{THERM_LABEL[ti]}</span>
                        <span style={{ color: MEM_HEX[s.env.mem] ?? 'rgba(255,255,255,0.4)' }}>{s.env.mem}</span>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}

        {/* Network */}
        {tab === 'network' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between mb-2 px-1">
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>{network.length} entries</span>
              <button onClick={clearNetworkEntries}
                className="text-[9px]"
                style={{ color: 'rgba(255,255,255,0.3)' }}>
                Clear
              </button>
            </div>
            {network.length === 0
              ? <p className="text-center py-8" style={{ color: 'rgba(255,255,255,0.2)' }}>No requests captured</p>
              : network.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <span className="w-10 text-center text-[9px] shrink-0"
                      style={{ color: e.failed ? '#ef4444' : '#a78bfa' }}>
                      {e.method}
                    </span>
                    <span className="flex-1 truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>{e.url}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: statusColor(e.status) }}>
                      {e.status ?? '…'}
                    </span>
                    {e.durationMs != null && (
                      <span className="shrink-0 text-[9px] w-12 text-right"
                        style={{ color: 'rgba(255,255,255,0.25)' }}>
                        {e.durationMs}ms
                      </span>
                    )}
                  </div>
                ))}
          </div>
        )}

        {/* FPS */}
        {tab === 'fps' && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-7xl font-mono font-bold leading-none"
              style={{ color: fps < 30 ? '#ef4444' : fps < 50 ? '#eab308' : '#22c55e' }}>
              {fps}
            </div>
            <p className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>
              frames per second
            </p>
            {fpsHistory.current.length > 1 && (
              <div className="flex items-end gap-px w-full px-6" style={{ height: 48 }}>
                {fpsHistory.current.map((f, i) => (
                  <div key={i} className="flex-1 rounded-sm"
                    style={{
                      height: `${Math.min(100, (f / 60) * 100)}%`,
                      background: f < 30 ? '#ef4444' : f < 50 ? '#eab308' : '#22c55e',
                      opacity:    0.4 + (i / fpsHistory.current.length) * 0.6,
                    }} />
                ))}
              </div>
            )}
            <p className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.15)' }}>
              60fps target — last {fpsHistory.current.length}s
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.12)' }}>
          dev only — tree-shaked in prod
        </span>
        <button onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] font-mono transition-colors"
          style={{ color: copied ? '#22c55e' : 'rgba(255,255,255,0.4)' }}>
          {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
          {copied ? 'Kopyalandı!' : 'Copy for Claude'}
        </button>
      </div>
    </div>
  );
}
