import { useTrafficState, TRAFFIC_COLORS } from '../../platform/trafficService';

const LEVEL_LABELS: Record<string, string> = {
  free: 'Akıcı', moderate: 'Orta', heavy: 'Yoğun', standstill: 'Tıkalı',
};

export function TrafficPanel() {
  const traffic = useTrafficState();
  const s = traffic.summary;
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-primary text-xl font-bold">Trafik Durumu</h2>
        <span className="text-[10px] text-amber-400/70 border border-amber-400/30 rounded px-2 py-0.5 uppercase tracking-widest font-bold">
          Simülasyon
        </span>
      </div>
      {!s ? (
        <p className="text-secondary text-sm">Trafik verisi yükleniyor…</p>
      ) : (
        <>
          <div className="flex items-center gap-3 p-4 rounded-2xl var(--panel-bg-secondary)">
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
                  <p className="text-secondary text-xs truncate">{seg.direction}</p>
                </div>
                {seg.delayMin > 0 && (
                  <span className="text-secondary text-xs flex-shrink-0">+{seg.delayMin} dk</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-secondary text-xs text-center pt-2">
            Gerçek trafik verisi değildir — saat bazlı simülasyon
          </p>
        </>
      )}
    </div>
  );
}


