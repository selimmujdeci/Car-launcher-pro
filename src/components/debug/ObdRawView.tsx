import { memo, useEffect, useRef } from 'react';
import { useDebugStore } from '../../platform/debug';
import type { ObdTrafficEntry } from '../../platform/debug';

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':') + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/** Komut sınıfı → renk. AT* = kurulum/handshake, DTC modları = teşhis, diğer = PID sorgu. */
function cmdColor(cmd: string): string {
  const c = cmd.toUpperCase();
  if (c.startsWith('AT')) return 'text-sky-400';           // ELM327 kurulum
  if (c === '03' || c === '07' || c === '0A') return 'text-amber-300'; // DTC okuma
  if (c === '04') return 'text-red-400';                   // DTC temizle
  return 'text-emerald-400';                               // PID sorgu (01/09/22…)
}

/** Yanıt sınıfı → renk. Hata (⚠) kırmızı, NO DATA gri, DTC pozitif yanıt (43/47/4A) vurgulu. */
function respColor(resp: string): string {
  const r = resp.toUpperCase();
  if (resp.startsWith('⚠')) return 'text-red-400';
  if (r.includes('NODATA') || r.replace(/\s+/g, '').includes('NODATA')) return 'text-gray-500';
  if (r.includes('ERROR') || r.includes('UNABLE') || r.includes('STOPPED')) return 'text-red-400';
  if (/^\s*4[37A]/.test(r)) return 'text-amber-200 font-bold'; // DTC pozitif yanıt — asıl kanıt
  return 'text-gray-200';
}

export const ObdRawView = memo(function ObdRawView() {
  const log = useDebugStore((s) => s.obdTrafficLog);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log]);

  function clearLog() {
    useDebugStore.getState().clearObdTraffic();
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={clearLog}
          className="px-3 py-1 rounded text-xs font-mono border border-gray-600 text-gray-400 hover:bg-gray-800"
        >
          TEMİZLE
        </button>
        <span className="text-[10px] font-mono text-gray-500 hidden sm:inline">
          AT=kurulum · 03/07/0A=DTC · 43/47/4A=yanıt · ⚠=hata
        </span>
        <span className="ml-auto text-xs font-mono text-gray-500">
          {log.length} / 500
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[8rem_3.5rem_5rem_1fr] gap-x-3 px-2 pb-1 border-b border-gray-700 text-gray-500 text-xs font-mono uppercase">
        <span>Timestamp</span>
        <span>ms</span>
        <span>Komut</span>
        <span>Yanıt</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-gray-600 text-xs font-mono px-2 py-4 leading-relaxed">
            OBD trafiği yok. Bu panel açıkken OBD'ye bağlan ve tarama yap.
            <br />
            Handshake (ATZ/ATE0/ATSP…) ve ham DTC yanıtı (03 → 43…) burada akar.
          </p>
        ) : (
          log.map((entry: ObdTrafficEntry, i) => (
            <div
              key={i}
              className="grid grid-cols-[8rem_3.5rem_5rem_1fr] gap-x-3 px-2 py-0.5 text-xs font-mono hover:bg-gray-800/50 even:bg-gray-900/30"
            >
              <span className="text-gray-400">{fmtTs(entry.ts)}</span>
              <span className={entry.ms > 1000 ? 'text-orange-400' : 'text-gray-500'}>{entry.ms}</span>
              <span className={cmdColor(entry.cmd)}>{entry.cmd}</span>
              <span className={`${respColor(entry.resp)} break-all whitespace-pre-wrap`}>{entry.resp || '—'}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
