import { memo } from 'react';
import { PenTool as Tool, Droplets, Fuel } from 'lucide-react';
import { useStore } from '../../store/useStore';

export const MaintenancePanel = memo(() => {
  const { settings, updateMaintenance } = useStore();
  
  // Güvenli veri okuma: settings veya maintenance yoksa varsayılanları kullan
  const maintenance = settings?.maintenance || {
    lastOilChangeKm: 0,
    nextOilChangeKm: 10000,
    lastServiceDate: new Date().toISOString().split('T')[0],
    fuelConsumptionAvg: 8.5
  };

  // Bölme hatasını (Division by zero) önlemek için kontrol
  const nextKm = maintenance.nextOilChangeKm || 10000;
  const oilLifePct = Math.max(0, Math.min(100, (1 - (maintenance.lastOilChangeKm || 0) / nextKm) * 100));

  return (
    <div className="flex flex-col gap-6 p-6 bg-[#0d1628] rounded-3xl border border-white/5 shadow-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tool className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white uppercase tracking-tight">Araç Bakım & Durum</h2>
        </div>
        <div className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase">
          Aktif
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Oil Life */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
          <div className="flex items-center gap-3 mb-3">
            <Droplets className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-medium text-slate-400">Yağ Ömrü</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold text-white">{Math.round(oilLifePct)}%</span>
            <span className="text-xs text-slate-500">Kalan</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${oilLifePct < 15 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${oilLifePct}%` }}
            />
          </div>
          <div className="mt-3 text-[10px] text-slate-600 font-medium uppercase tracking-wider">
            Son Değişim: {maintenance.lastOilChangeKm || 0} KM
          </div>
        </div>

        {/* Fuel Consumption */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
          <div className="flex items-center gap-3 mb-3">
            <Fuel className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-medium text-slate-400">Ort. Yakıt</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold text-white">{maintenance.fuelConsumptionAvg || 0}</span>
            <span className="text-xs text-slate-500">L / 100km</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-emerald-500"
              style={{ width: '65%' }}
            />
          </div>
          <div className="mt-3 text-[10px] text-slate-600 font-medium uppercase tracking-wider">
            Sürüş Verilerinden Analiz Edildi
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        <button 
          onClick={() => updateMaintenance({ lastOilChangeKm: 0, lastServiceDate: new Date().toISOString().split('T')[0] })}
          className="flex-1 py-3 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-widest hover:bg-blue-600/20 transition-all active:scale-95"
        >
          Servisi Sıfırla
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
