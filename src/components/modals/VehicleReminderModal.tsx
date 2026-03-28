import { memo, useState, useCallback } from 'react';
import { X, Wrench, Calendar, Shield, Droplets, Save, Car } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { computeReminders, type ReminderUrgency } from '../../platform/vehicleReminderService';
import type { MaintenanceInfo } from '../../store/useStore';

/* ── Urgency badge ───────────────────────────────────────── */

const URGENCY_STYLE: Record<ReminderUrgency, string> = {
  ok:      'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  soon:    'text-amber-400   bg-amber-500/10   border-amber-500/20',
  urgent:  'text-red-400     bg-red-500/10     border-red-500/20',
  overdue: 'text-red-300     bg-red-600/15     border-red-500/30',
};

const URGENCY_LABEL: Record<ReminderUrgency, string> = {
  ok: 'Güncel', soon: 'Yakında', urgent: 'Acil', overdue: 'Gecikti',
};

/* ── Alt bileşenler ──────────────────────────────────────── */

function FieldLabel({ children }: { children: string }) {
  return (
    <span className="text-slate-500 text-[10px] uppercase tracking-widest">{children}</span>
  );
}

function NumberField({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-blue-500/50 transition-colors">
        <input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(Number(e.target.value))}
          className="bg-transparent border-none outline-none text-white text-sm flex-1 min-w-0"
          min={0}
        />
        <span className="text-slate-500 text-xs flex-shrink-0">{unit}</span>
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-blue-500/50 transition-colors [color-scheme:dark] w-full"
      />
    </div>
  );
}

/* ── Formun lokal tipi ───────────────────────────────────── */

type FormState = Pick<
  MaintenanceInfo,
  'lastOilChangeKm' | 'nextOilChangeKm' | 'inspectionDate' | 'insuranceExpiry' | 'kaskoExpiry' | 'currentKm'
>;

/* ── Modal ───────────────────────────────────────────────── */

export const VehicleReminderModal = memo(function VehicleReminderModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { settings, updateMaintenance } = useStore();
  const m = settings.maintenance;

  const [form, setForm] = useState<FormState>({
    currentKm:       m.currentKm       ?? 0,
    lastOilChangeKm: m.lastOilChangeKm ?? 0,
    nextOilChangeKm: m.nextOilChangeKm ?? 10000,
    inspectionDate:  m.inspectionDate  ?? '',
    insuranceExpiry: m.insuranceExpiry ?? '',
    kaskoExpiry:     m.kaskoExpiry     ?? '',
  });

  // Canlı durum hesabı (kaydetmeden önce önizleme)
  const reminders = computeReminders({ ...m, ...form });

  const setField = useCallback(
    <K extends keyof FormState>(key: K, val: FormState[K]) => {
      setForm((f) => ({ ...f, [key]: val }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    updateMaintenance(form);
    onClose();
  }, [form, updateMaintenance, onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-[#0a1020] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Başlık */}
        <div className="flex items-center justify-between p-5 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <Wrench className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-white font-bold text-sm">Araç Hatırlatıcıları</div>
              <div className="text-slate-500 text-[10px]">Bakım ve belgeler</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-500 hover:text-white transition-colors active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Durum özeti */}
        <div className="flex gap-2 px-5 py-3 border-b border-white/5 overflow-x-auto flex-shrink-0">
          {reminders.map((r) => (
            <div
              key={r.id}
              className={`flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl border ${URGENCY_STYLE[r.urgency]}`}
            >
              <span className="text-[9px] font-bold uppercase tracking-wider">{r.label}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">{URGENCY_LABEL[r.urgency]}</span>
              <span className="text-[10px] font-medium">{r.detail}</span>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">

          {/* Yağ değişimi */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Droplets className="w-4 h-4 text-blue-400" />
              <span className="text-white text-xs font-bold">Yağ Değişimi</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Değişim aralığı"
                value={form.nextOilChangeKm}
                unit="km"
                onChange={(v) => setField('nextOilChangeKm', v)}
              />
              <NumberField
                label="Son değişimden (km)"
                value={form.lastOilChangeKm}
                unit="km"
                onChange={(v) => setField('lastOilChangeKm', v)}
              />
            </div>
          </div>

          {/* Muayene */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-emerald-400" />
              <span className="text-white text-xs font-bold">Araç Muayenesi</span>
            </div>
            <DateField
              label="Sonraki muayene tarihi"
              value={form.inspectionDate}
              onChange={(v) => setField('inspectionDate', v)}
            />
          </div>

          {/* Sigorta & Kasko */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-400" />
              <span className="text-white text-xs font-bold">Sigorta & Kasko</span>
            </div>
            <DateField
              label="Sigorta bitiş tarihi"
              value={form.insuranceExpiry}
              onChange={(v) => setField('insuranceExpiry', v)}
            />
            <DateField
              label="Kasko bitiş tarihi"
              value={form.kaskoExpiry}
              onChange={(v) => setField('kaskoExpiry', v)}
            />
          </div>

          {/* Güncel kilometre (bilgi amaçlı) */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-white text-xs font-bold">Araç Kilometresi</span>
            </div>
            <NumberField
              label="Güncel kilometre"
              value={form.currentKm}
              unit="km"
              onChange={(v) => setField('currentKm', v)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t border-white/5 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-sm font-bold hover:bg-white/10 transition-all active:scale-95"
          >
            İptal
          </button>
          <button
            onClick={handleSave}
            className="flex-[2] py-3 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-500 transition-all active:scale-95"
          >
            <Save className="w-4 h-4" />
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
});
