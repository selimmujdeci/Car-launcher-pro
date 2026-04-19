import { memo } from 'react';
import { Wrench, AlertCircle, ChevronRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { computeReminders, hasUrgentReminders } from '../../platform/vehicleReminderService';

export const VehicleReminderWidget = memo(function VehicleReminderWidget({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const { settings } = useStore();
  const reminders = computeReminders(settings.maintenance);
  const urgent = hasUrgentReminders(reminders);
  const soonCount = reminders.filter((r) => r.urgency === 'soon').length;
  const urgentCount = reminders.filter(
    (r) => r.urgency === 'urgent' || r.urgency === 'overdue',
  ).length;
  const allOk = reminders.every((r) => r.urgency === 'ok');

  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 bg-[rgba(255,255,255,0.05)] rounded-2xl border border-white/5 px-4 py-3 hover:bg-white/[0.03] active:scale-[0.98] transition-all"
    >
      {/* İkon */}
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
          urgent ? 'bg-red-500/15' : allOk ? 'bg-emerald-500/10' : 'bg-amber-500/10'
        }`}
      >
        {urgent ? (
          <AlertCircle className="w-4 h-4 text-red-400" />
        ) : (
          <Wrench
            className={`w-4 h-4 ${allOk ? 'text-emerald-400' : 'text-amber-400'}`}
          />
        )}
      </div>

      {/* Metin */}
      <div className="flex-1 min-w-0 text-left">
        <div className="text-primary text-xs font-bold leading-tight">Araç Bakım</div>
        <div
          className={`text-[10px] leading-tight ${
            urgent
              ? 'text-red-400'
              : allOk
              ? 'text-emerald-400'
              : 'text-amber-400'
          }`}
        >
          {urgentCount > 0
            ? `${urgentCount} acil uyarı`
            : soonCount > 0
            ? `${soonCount} yaklaşan hatırlatıcı`
            : 'Tümü güncel'}
        </div>
      </div>

      {/* Durum noktaları */}
      <div className="flex gap-1 items-center flex-shrink-0">
        {reminders.map((r) => (
          <div
            key={r.id}
            className={`w-2 h-2 rounded-full ${
              r.urgency === 'ok'
                ? 'bg-emerald-400/40'
                : r.urgency === 'soon'
                ? 'bg-amber-400'
                : r.urgency === 'urgent'
                ? 'bg-red-400'
                : 'bg-red-500 animate-pulse'
            }`}
          />
        ))}
        <ChevronRight className="w-3.5 h-3.5 text-slate-600 ml-0.5" />
      </div>
    </button>
  );
});


