import { useTrafficState, TRAFFIC_COLORS, type TrafficSource } from '../../platform/trafficService';
import { Signal, Clock } from 'lucide-react';

const LEVEL_LABELS: Record<string, string> = {
  free: 'Akıcı', moderate: 'Orta', heavy: 'Yoğun', standstill: 'Tıkalı',
};

const SOURCE_META: Record<TrafficSource, { label: string; color: string }> = {
  here:      { label: 'HERE Canlı',   color: '#34d399' },
  tomtom:    { label: 'TomTom Canlı', color: '#34d399' },
  estimated: { label: 'Tahmini',      color: '#f59e0b' },
};

export function TrafficPanel() {
  const traffic = useTrafficState();
  const s       = traffic.summary;

  const meta = s ? SOURCE_META[s.source] : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-primary text-xl font-bold">Trafik Durumu</h2>
        {meta && (
          <span
            className="flex items-center gap-1 text-[10px] border rounded px-2 py-0.5 uppercase tracking-widest font-bold"
            style={{ color: meta.color, borderColor: `${meta.color}40` }}
          >
            {s!.source === 'estimated'
              ? <Clock size={10} />
              : <Signal size={10} />
            }
            {meta.label}
          </span>
        )}
      </div>

      {traffic.loading && !s && (
        <p className="text-secondary text-sm">Trafik verisi alınıyor…</p>
      )}

      {!traffic.loading && !s && (
        <p className="text-secondary text-sm">Veri yok — GPS bekleniyor</p>
      )}

      {s && (
        <>
          <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: TRAFFIC_COLORS[s.level] }} />
            <div>
              <p className="text-primary font-semibold text-lg">{LEVEL_LABELS[s.level] ?? s.level}</p>
              {s.delayMin > 0 && (
                <p className="text-secondary text-sm">Tahmini gecikme: ~{s.delayMin} dk</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {s.segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: TRAFFIC_COLORS[seg.level] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-secondary text-sm font-medium truncate">{seg.label}</p>
                  {seg.direction && (
                    <p className="text-secondary text-xs truncate">{seg.direction}</p>
                  )}
                </div>
                {seg.delayMin > 0 && (
                  <span className="text-secondary text-xs flex-shrink-0">+{seg.delayMin} dk</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-secondary text-xs text-center pt-2 opacity-50">
            {new Date(s.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} güncellendi
          </p>
        </>
      )}
    </div>
  );
}
