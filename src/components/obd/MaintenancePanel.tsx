import { memo, useEffect, useState } from 'react';
import { PenTool as Tool, Droplets, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useVehicleStore } from '../../platform/vehicleDataLayer/VehicleStateStore';
import { getMaintenanceAssessment, type MaintenanceAssessment } from '../../platform/vehicleMaintenanceService';

export const MaintenancePanel = memo(() => {
  const { settings, updateMaintenance } = useStore();
  const odometer = useVehicleStore(state => state.odometer);
  const [assessments, setAssessments] = useState<MaintenanceAssessment[]>([]);
  
  useEffect(() => {
    const fetchAssessments = async () => {
      const data = await getMaintenanceAssessment();
      setAssessments(data);
    };
    fetchAssessments();
  }, [odometer, settings.maintenance]);

  const oilAssessment = assessments.find(a => a.id === 'oil_change');
  const inspectionAssessment = assessments.find(a => a.id === 'inspection');
  const insuranceAssessment = assessments.find(a => a.id === 'insurance');

  // Oil Life percentage calculation based on remaining km
  const nextOilKm = settings.maintenance.nextOilChangeKm || 10000;
  const lastOilKm = settings.maintenance.lastOilChangeKm || 0;
  const totalInterval = nextOilKm - lastOilKm || 10000;
  const currentKm = odometer ?? 0;
  const kmsLeft = Math.max(0, nextOilKm - currentKm);
  const oilLifePct = Math.max(0, Math.min(100, (kmsLeft / totalInterval) * 100));

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'critical': return 'text-red-500';
      case 'warning': return 'text-amber-500';
      case 'ok': return 'text-emerald-500';
      default: return 'text-slate-400';
    }
  };

  const getStatusBg = (status?: string) => {
    switch (status) {
      case 'critical': return 'bg-red-500';
      case 'warning': return 'bg-amber-500';
      case 'ok': return 'bg-emerald-500';
      default: return 'bg-blue-500';
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 bg-[rgba(255,255,255,0.05)] rounded-3xl border border-white/5 shadow-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tool className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-primary uppercase tracking-tight">Araç Bakım & Durum</h2>
        </div>
        <div className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase">
          Aktif
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Oil Life */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
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
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${getStatusBg(oilAssessment?.status)}`}
              style={{ width: `${oilLifePct}%` }}
            />
          </div>
          <div className="mt-3 text-[10px] text-slate-600 font-medium uppercase tracking-wider">
            {oilAssessment?.message || `Son Değişim: ${lastOilKm} KM`}
          </div>
        </div>

        {/* Other Assessments Summary */}
        <div className="flex flex-col gap-2">
          {inspectionAssessment && (
            <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className={`w-4 h-4 ${getStatusColor(inspectionAssessment.status)}`} />
                <span className="text-xs font-medium text-slate-300">Muayene</span>
              </div>
              <span className={`text-xs font-bold ${getStatusColor(inspectionAssessment.status)}`}>
                {inspectionAssessment.message}
              </span>
            </div>
          )}
          {insuranceAssessment && (
            <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className={`w-4 h-4 ${getStatusColor(insuranceAssessment.status)}`} />
                <span className="text-xs font-medium text-slate-300">Sigorta</span>
              </div>
              <span className={`text-xs font-bold ${getStatusColor(insuranceAssessment.status)}`}>
                {insuranceAssessment.message}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        <button 
          onClick={() => updateMaintenance({ lastOilChangeKm: currentKm, lastServiceDate: new Date().toISOString().split('T')[0] })}
          className="flex-1 py-3 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-widest hover:bg-blue-600/20 transition-all active:scale-95"
        >
          Yağ Değişimi Yapıldı
        </button>
        <button 
          className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
        >
          Kayıtlar
        </button>
      </div>
    </div>
  );
});

MaintenancePanel.displayName = 'MaintenancePanel';


