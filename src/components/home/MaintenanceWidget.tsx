import { useState, useEffect, memo } from 'react';
import { Wrench, Calendar, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getMaintenanceAssessment, type MaintenanceAssessment } from '../../platform/vehicleMaintenanceService';

/**
 * MaintenanceWidget — OLED/Glassmorphism tarzında araç bakım özeti.
 * 
 * Özellikler:
 *   - Glassmorphism: Backdrop blur ve yarı saydam katmanlar.
 *   - OLED Optimize: Gerçek siyah arka planlarda parlayan aksanlar.
 *   - Durumsal Renkler: ok (emerald), warning (amber), critical (red).
 */
export const MaintenanceWidget = memo(function MaintenanceWidget() {
  const [assessments, setAssessments] = useState<MaintenanceAssessment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getMaintenanceAssessment().then(res => {
      if (alive) {
        setAssessments(res);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, []);

  if (loading) return (
    <div className="w-full h-32 bg-white/5 animate-pulse rounded-3xl border border-white/10" />
  );

  return (
    <div className="w-full bg-black/40 backdrop-blur-xl rounded-3xl border border-white/10 p-4 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white/90 text-sm font-bold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          Servis Durumu
        </h3>
        <div className="flex gap-1">
          {assessments.map(a => (
            <div 
              key={a.id} 
              className={`w-1.5 h-1.5 rounded-full ${
                a.status === 'critical' ? 'bg-red-500 animate-pulse' : 
                a.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500/50'
              }`} 
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {assessments.map((item) => (
          <div 
            key={item.id}
            className="flex items-center gap-3 bg-white/5 rounded-2xl p-2.5 border border-white/5"
          >
            <div className={`p-2 rounded-xl ${
              item.status === 'critical' ? 'bg-red-500/10 text-red-400' :
              item.status === 'warning' ? 'bg-amber-500/10 text-amber-400' :
              'bg-emerald-500/10 text-emerald-400'
            }`}>
              {item.id === 'inspection' && <Calendar className="w-4 h-4" />}
              {item.id === 'oil_change' && <Wrench className="w-4 h-4" />}
              {item.id === 'insurance' && <ShieldCheck className="w-4 h-4" />}
            </div>

            <div className="flex-1">
              <div className="text-[10px] text-white/40 uppercase font-black tracking-wider leading-none">
                {item.label}
              </div>
              <div className="text-xs text-white/90 font-medium">
                {item.message}
              </div>
            </div>

            <div>
              {item.status === 'critical' ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : item.status === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-500/40" />
              )}
            </div>
          </div>
        ))}

        {assessments.length === 0 && (
          <div className="text-center py-4 text-white/30 text-xs italic">
            Bakım verisi girilmemiş
          </div>
        )}
      </div>
    </div>
  );
});
