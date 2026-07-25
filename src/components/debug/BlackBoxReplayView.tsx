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

/* Görünen etiketler Türkçe; ham veri (ThermalLevel 0–3 · mem 'OK'|'MOD'|'CRIT')
   DEĞİŞMEZ — yalnız sunum çevrilir. */
const THERM = ['NORMAL', 'ILIK', 'SICAK', '🔴KRİTİK'];
const MEM_LABEL: Readonly<Record<'OK' | 'MOD' | 'CRIT', string>> = {
  OK: 'NORMAL', MOD: 'ORTA', CRIT: 'KRİTİK',
};

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
      <div className="flex items-center justify-center h-full text-[var(--oem-ink-3)] text-xs font-mono">
        Veri bekleniyor… BlackBox 1 Hz örnekleme aktif değil.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="text-[var(--oem-ink-3)] text-[10px] font-mono px-1 py-1 shrink-0">
        ■ BlackBox Replay — son {rows.length} kayıt · 1 Hz · en yeni üstte · 2s yenileme
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[var(--oem-ink-3)] border-b border-[var(--oem-line)] sticky top-0 bg-[var(--oem-surface-0)] z-10">
              <th className="text-left   px-2 py-1 font-normal">ZAMAN</th>
              <th className="text-right  px-2 py-1 font-normal">HIZ</th>
              <th className="text-right  px-2 py-1 font-normal">RPM</th>
              <th className="text-right  px-2 py-1 font-normal">YAKIT</th>
              <th className="text-right  px-2 py-1 font-normal">VİTES</th>
              <th className="text-right  px-2 py-1 font-normal">TERM</th>
              <th className="text-right  px-2 py-1 font-normal">MEM</th>
              <th className="text-left   px-2 py-1 font-normal">WORKER</th>
              <th className="text-left   px-2 py-1 font-normal">SON-CMD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const spdKmh  = s.signals.spd !== null ? s.signals.spd * 3.6 : null;
              const hasDead = Object.values(s.workers).some((w) => w === 'dead');
              const rowCls  = hasDead
                ? 'text-[var(--oem-danger)]'
                : s.env.mem === 'CRIT'
                  ? 'text-[var(--oem-warn)]'
                  : 'text-[var(--oem-ink-2)]';
              return (
                <tr key={i} className={`border-b border-[var(--oem-line)] hover:bg-[var(--oem-surface-2)] ${rowCls}`}>
                  <td className="px-2 py-0.5 text-[var(--oem-ink-3)]">{fmtTs(s.ts)}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(spdKmh, 1, ' km/h')}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(s.signals.rpm)}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(s.signals.fuel, 1, '%')}</td>
                  <td className="px-2 py-0.5 text-right">{s.signals.gear ?? '—'}</td>
                  <td className={`px-2 py-0.5 text-right ${s.env.therm >= 2 ? 'text-[var(--oem-danger)]' : ''}`}>
                    {THERM[s.env.therm] ?? String(s.env.therm)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${s.env.mem !== 'OK' ? 'text-[var(--oem-warn)]' : 'text-[var(--oem-ink-3)]'}`}>
                    {MEM_LABEL[s.env.mem] ?? s.env.mem}
                  </td>
                  <td className="px-2 py-0.5">
                    {Object.entries(s.workers).map(([k, v]) => (
                      <span key={k} className={`mr-1.5 ${v === 'dead' ? 'text-[var(--oem-danger)]' : 'text-[var(--oem-ink-3)]'}`}>
                        {k.replace('Compute', '')}:{v === 'dead' ? '✗' : '✓'}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-0.5 text-[var(--oem-ink-3)] max-w-[80px] truncate">
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
