import { memo, useState, useEffect } from 'react';
import { getReplayData } from '../../platform/security/blackBoxService';
import type { BlackBoxSample } from '../../platform/security/blackBoxService';

function fmtTs(epochMs: number): string {
  const d = new Date(epochMs);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => n.toString().padStart(2, '0'))
    .join(':');
}

function fmtNum(v: number | null, mul = 1, unit = ''): string {
  if (v === null || v < 0) return '—';
  return `${Math.round(v * mul)}${unit}`;
}

const THERM = ['OK', 'WARM', 'HOT', '🔴CRIT'];

export const BlackBoxReplayView = memo(function BlackBoxReplayView() {
  const [rows, setRows] = useState<BlackBoxSample[]>([]);

  useEffect(() => {
    const refresh = () => setRows(getReplayData().slice().reverse()); // en yeni üstte
    refresh();
    const t = setInterval(refresh, 2_000);
    return () => clearInterval(t);
  }, []);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs font-mono">
        Veri bekleniyor… BlackBox 1 Hz örnekleme aktif değil.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="text-gray-500 text-[10px] font-mono px-1 py-1 shrink-0">
        ■ BlackBox Replay — son {rows.length} kayıt · 1 Hz · en yeni üstte · 2s yenileme
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-gray-600 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
              <th className="text-left   px-2 py-1 font-normal">ZAMAN</th>
              <th className="text-right  px-2 py-1 font-normal">HIZ</th>
              <th className="text-right  px-2 py-1 font-normal">RPM</th>
              <th className="text-right  px-2 py-1 font-normal">YAKIT</th>
              <th className="text-right  px-2 py-1 font-normal">VİTES</th>
              <th className="text-right  px-2 py-1 font-normal">TERM</th>
              <th className="text-right  px-2 py-1 font-normal">MEM</th>
              <th className="text-left   px-2 py-1 font-normal">WORKERS</th>
              <th className="text-left   px-2 py-1 font-normal">SON-CMD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const spdKmh  = s.signals.spd !== null ? s.signals.spd * 3.6 : null;
              const hasDead = Object.values(s.workers).some((w) => w === 'dead');
              const rowCls  = hasDead
                ? 'text-red-400'
                : s.env.mem === 'CRIT'
                  ? 'text-orange-400'
                  : 'text-gray-400';
              return (
                <tr key={i} className={`border-b border-gray-900 hover:bg-gray-900/40 ${rowCls}`}>
                  <td className="px-2 py-0.5 text-gray-500">{fmtTs(s.ts)}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(spdKmh, 1, ' km/h')}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(s.signals.rpm)}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(s.signals.fuel, 1, '%')}</td>
                  <td className="px-2 py-0.5 text-right">{s.signals.gear ?? '—'}</td>
                  <td className={`px-2 py-0.5 text-right ${s.env.therm >= 2 ? 'text-red-400' : ''}`}>
                    {THERM[s.env.therm] ?? String(s.env.therm)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${s.env.mem !== 'OK' ? 'text-orange-400' : 'text-gray-600'}`}>
                    {s.env.mem}
                  </td>
                  <td className="px-2 py-0.5">
                    {Object.entries(s.workers).map(([k, v]) => (
                      <span key={k} className={`mr-1.5 ${v === 'dead' ? 'text-red-400' : 'text-gray-600'}`}>
                        {k.replace('Compute', '')}:{v === 'dead' ? '✗' : '✓'}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-0.5 text-gray-500 max-w-[80px] truncate">
                    {s.lastCmd ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
