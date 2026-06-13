import { memo, useEffect, useState } from 'react';
import { PenTool as Tool, Droplets, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useUnifiedVehicleStore as useVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { getMaintenanceAssessment, type MaintenanceAssessment } from '../../platform/vehicleMaintenanceService';

export const MaintenancePanel = memo(() => {
  const maintenance = useStore(s => s.settings.maintenance);
  const updateMaintenance = useStore(s => s.updateMaintenance);
  const odometer = useVehicleStore(state => state.odometer);
  const [assessments, setAssessments] = useState<MaintenanceAssessment[]>([]);
  
  useEffect(() => {
    const fetchAssessments = async () => {
      const data = await getMaintenanceAssessment();
      setAssessments(data);
    };
    fetchAssessments();
  }, [odometer, maintenance]);

  const oilAssessment = assessments.find(a => a.id === 'oil_change');
  const inspectionAssessment = assessments.find(a => a.id === 'inspection');
  const insuranceAssessment = assessments.find(a => a.id === 'insurance');

  // Oil Life percentage calculation based on remaining km
  const nextOilKm = maintenance.nextOilChangeKm || 10000;
  const lastOilKm = maintenance.lastOilChangeKm || 0;
  const totalInterval = nextOilKm - lastOilKm || 10000;
  const currentKm = odometer ?? 0;
  const kmsLeft = Math.max(0, nextOilKm - currentKm);
  const oilLifePct = Math.max(0, Math.min(100, (kmsLeft / totalInterval) * 100));

  /* Durum rengi: Tailwind arbitrary-value ile oem token → tema duyarlı */
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'critical': return 'text-[color:var(--oem-danger)]';
      case 'warning':  return 'text-[color:var(--oem-warn)]';
      case 'ok':       return 'text-[color:var(--oem-good)]';
      default:         return 'text-[color:var(--oem-info)]';
    }
  };

  /* İlerleme çubuğu arka planı: inline style ile oem token (Tailwind bg-[] ile CSS var() güvenilir) */
  const getStatusBgColor = (status?: string): string => {
    switch (status) {
      case 'critical': return 'var(--oem-danger)';
      case 'warning':  return 'var(--oem-warn)';
      case 'ok':       return 'var(--oem-good)';
      default:         return 'var(--oem-info)';
    }
  };

  /* Kart yüzeyi → oem-surface-2 (beyaz saydam overlay kaldırıldı) */
  return (
    <div className="flex flex-col gap-6 p-6 bg-[var(--oem-surface-2)] rounded-3xl border border-[var(--oem-line)] shadow-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Başlık ikonu → info token (nötr bilgi/araç) */}
          <Tool className="w-6 h-6 text-[color:var(--oem-info)]" />
          <h2 className="text-xl font-bold text-primary uppercase tracking-tight">Araç Bakım & Durum</h2>
        </div>
        {/* Aktif rozeti → info token */}
        <div className="px-3 py-1 rounded-full bg-[var(--oem-info-soft)] border border-[var(--oem-info)] text-[color:var(--oem-info)] text-[10px] font-bold uppercase">
          Aktif
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Yağ Ömrü kartı → oem-surface-2 / oem-line */}
        <div className="bg-[var(--oem-surface-2)] rounded-2xl p-4 border border-[var(--oem-line)]">
          <div className="flex items-center gap-3 mb-3">
            <Droplets className={`w-5 h-5 ${getStatusColor(oilAssessment?.status)}`} />
            <span className="text-sm font-medium text-slate-400">Yağ Ömrü</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className={`text-3xl font-bold ${getStatusColor(oilAssessment?.status)}`}>
              {Math.round(oilLifePct)}%
            </span>
            <span className="text-xs text-slate-500">Kalan</span>
          </div>
          {/* İlerleme çubuğu: oem-surface-3 zemin, renk inline style ile oem token */}
          <div className="h-1.5 bg-[var(--oem-surface-3)] rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{ width: `${oilLifePct}%`, background: getStatusBgColor(oilAssessment?.status) }}
            />
          </div>
          <div className="mt-3 text-[10px] text-slate-600 font-medium uppercase tracking-wider">
            {oilAssessment?.message || `Son Değişim: ${lastOilKm} KM`}
          </div>
        </div>

        {/* Other Assessments Summary */}
        <div className="flex flex-col gap-2">
          {inspectionAssessment && (
            /* Muayene satırı → oem yüzey/kenarlık + semantik durum rengi */
            <div className="bg-[var(--oem-surface-2)] rounded-xl p-3 border border-[var(--oem-line)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className={`w-4 h-4 ${getStatusColor(inspectionAssessment.status)}`} />
                <span className="text-xs font-medium text-primary">Muayene</span>
              </div>
              <span className={`text-xs font-bold ${getStatusColor(inspectionAssessment.status)}`}>
                {inspectionAssessment.message}
              </span>
            </div>
          )}
          {insuranceAssessment && (
            /* Sigorta satırı → oem yüzey/kenarlık + semantik durum rengi */
            <div className="bg-[var(--oem-surface-2)] rounded-xl p-3 border border-[var(--oem-line)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className={`w-4 h-4 ${getStatusColor(insuranceAssessment.status)}`} />
                <span className="text-xs font-medium text-primary">Sigorta</span>
              </div>
              <span className={`text-xs font-bold ${getStatusColor(insuranceAssessment.status)}`}>
                {insuranceAssessment.message}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        {/* Yağ değişimi aksiyonu → good token (tamamlandı/onay) */}
        <button
          onClick={() => updateMaintenance({ lastOilChangeKm: currentKm, lastServiceDate: new Date().toISOString().split('T')[0] })}
          className="flex-1 py-3 rounded-xl bg-[var(--oem-good-soft)] border border-[var(--oem-good)] text-[color:var(--oem-good)] text-xs font-bold uppercase tracking-widest hover:opacity-80 transition-all active:scale-95"
        >
          Yağ Değişimi Yapıldı
        </button>
        {/* İkincil buton → oem yüzey/kenarlık (nötr) */}
        <button
          className="flex-1 py-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line-strong)] text-secondary text-xs font-bold uppercase tracking-widest hover:opacity-80 transition-all active:scale-95"
        >
          Kayıtlar
        </button>
      </div>
    </div>
  );
});

MaintenancePanel.displayName = 'MaintenancePanel';


