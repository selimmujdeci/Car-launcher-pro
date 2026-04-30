'use client';

import { memo, useState, useCallback, useId } from 'react';
import type { LiveVehicle } from '@/types/realtime';

interface Props { vehicle: LiveVehicle | null }

/* ── Fuel Log ─────────────────────────────────────────────────────────────── */

interface FuelEntry {
  id:        string;
  date:      string;   // ISO date string
  km:        number;
  liters:    number;
  pricePerL: number;   // ₺/L
}

const FUEL_KEY = 'caros_fuel_log';

function loadFuelLog(): FuelEntry[] {
  try {
    const raw = localStorage.getItem(FUEL_KEY);
    return raw ? (JSON.parse(raw) as FuelEntry[]) : [];
  } catch { return []; }
}

function saveFuelLog(entries: FuelEntry[]): void {
  try { localStorage.setItem(FUEL_KEY, JSON.stringify(entries.slice(0, 50))); } catch {}
}

/* ── Service Tracker ──────────────────────────────────────────────────────── */

interface ServiceItem {
  id:       string;
  label:    string;
  icon:     string;
  intervalKm: number;
  intervalDays: number;
  lastKm?:  number;
  lastDate?: string;
}

const SERVICE_KEY = 'caros_service_log';

const DEFAULT_SERVICES: ServiceItem[] = [
  { id: 'oil',    label: 'Yağ Değişimi',       icon: '🛢',  intervalKm: 10_000, intervalDays: 365 },
  { id: 'tires',  label: 'Lastik Rotasyonu',   icon: '🔄',  intervalKm: 15_000, intervalDays: 365 },
  { id: 'brakes', label: 'Fren Balata',         icon: '🛑',  intervalKm: 30_000, intervalDays: 730 },
  { id: 'filter', label: 'Hava Filtresi',       icon: '💨',  intervalKm: 20_000, intervalDays: 365 },
  { id: 'ac',     label: 'Klima Bakımı',        icon: '❄️',  intervalKm: 40_000, intervalDays: 730 },
  { id: 'timing', label: 'Triger Kayışı',       icon: '⚙️',  intervalKm: 60_000, intervalDays: 1825 },
];

function loadServices(): ServiceItem[] {
  try {
    const raw = localStorage.getItem(SERVICE_KEY);
    if (!raw) return DEFAULT_SERVICES;
    const saved = JSON.parse(raw) as Record<string, { lastKm?: number; lastDate?: string }>;
    return DEFAULT_SERVICES.map((s) => ({ ...s, ...saved[s.id] }));
  } catch { return DEFAULT_SERVICES; }
}

function saveServices(items: ServiceItem[]): void {
  try {
    const record: Record<string, { lastKm?: number; lastDate?: string }> = {};
    items.forEach((s) => { record[s.id] = { lastKm: s.lastKm, lastDate: s.lastDate }; });
    localStorage.setItem(SERVICE_KEY, JSON.stringify(record));
  } catch {}
}

/* ── Fuel tab ─────────────────────────────────────────────────────────────── */

function FuelTab({ vehicle }: { vehicle: LiveVehicle | null }) {
  const [log,     setLog]     = useState<FuelEntry[]>(loadFuelLog);
  const [adding,  setAdding]  = useState(false);
  const formId = useId();

  const [form, setForm] = useState({
    date:      new Date().toISOString().split('T')[0],
    km:        String(vehicle?.odometer ?? ''),
    liters:    '',
    pricePerL: '',
  });

  const handleAdd = useCallback(() => {
    const km        = parseFloat(form.km);
    const liters    = parseFloat(form.liters);
    const pricePerL = parseFloat(form.pricePerL);
    if (!form.date || isNaN(km) || isNaN(liters) || isNaN(pricePerL)) return;

    const entry: FuelEntry = {
      id:        `fuel-${Date.now()}`,
      date:      form.date,
      km:        Math.round(km),
      liters:    Math.round(liters * 100) / 100,
      pricePerL: Math.round(pricePerL * 100) / 100,
    };
    const next = [entry, ...log];
    setLog(next);
    saveFuelLog(next);
    setAdding(false);
    setForm((f) => ({ ...f, liters: '', pricePerL: '' }));
  }, [form, log]);

  // Consumption stats
  const totalCost   = log.reduce((a, e) => a + e.liters * e.pricePerL, 0);
  const totalLiters = log.reduce((a, e) => a + e.liters, 0);
  const kmRange     = log.length >= 2 ? log[0].km - log[log.length - 1].km : 0;
  const avgL100     = kmRange > 0 ? (totalLiters / kmRange) * 100 : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Stats */}
      {log.length >= 2 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Ort. Tüketim', value: avgL100 != null ? `${avgL100.toFixed(1)} L` : '–', unit: '/100km', color: '#60a5fa' },
            { label: 'Toplam Litre', value: totalLiters.toFixed(1),                             unit: 'L',      color: '#34d399' },
            { label: 'Toplam Harcama', value: `${Math.round(totalCost)}`,                       unit: '₺',      color: '#fbbf24' },
          ].map(({ label, value, unit, color }) => (
            <div key={label} className="flex flex-col items-center py-3 rounded-xl"
              style={{ background: `${color}09`, border: `1px solid ${color}20` }}>
              <span className="text-[7px] font-black uppercase tracking-widest text-white/25 mb-1 text-center leading-tight">{label}</span>
              <span className="text-base font-black tabular-nums" style={{ color }}>{value}</span>
              <span className="text-[8px] font-mono mt-0.5" style={{ color: `${color}60` }}>{unit}</span>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {adding ? (
        <div className="flex flex-col gap-3 p-4 rounded-2xl"
          style={{ background: 'rgba(96,165,250,0.05)', border: '1.5px solid rgba(96,165,250,0.18)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400/60">Yakıt Ekle</p>

          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'date',      label: 'Tarih',       type: 'date',   placeholder: '' },
              { key: 'km',        label: 'Kilometre',   type: 'number', placeholder: '85000' },
              { key: 'liters',    label: 'Litre',       type: 'number', placeholder: '40.5' },
              { key: 'pricePerL', label: '₺/Litre',     type: 'number', placeholder: '45.50' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="flex flex-col gap-1">
                <label htmlFor={`${formId}-${key}`}
                  className="text-[9px] font-black uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {label}
                </label>
                <input
                  id={`${formId}-${key}`}
                  type={type}
                  placeholder={placeholder}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-white/15 outline-none tabular-nums"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)', boxShadow: '0 4px 16px rgba(59,130,246,0.25)' }}
            >
              Kaydet
            </button>
            <button
              onClick={() => setAdding(false)}
              className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-95"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}
            >
              İptal
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98]"
          style={{ background: 'rgba(96,165,250,0.06)', border: '1.5px solid rgba(96,165,250,0.18)' }}
        >
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.22)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-blue-300">Yakıt Doldurma Ekle</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(96,165,250,0.4)' }}>
              Tarih, km, litre ve fiyat kaydet
            </p>
          </div>
        </button>
      )}

      {/* Log entries */}
      {log.length > 0 ? (
        <div className="flex flex-col gap-2">
          {log.slice(0, 10).map((entry, idx) => {
            const cost = entry.liters * entry.pricePerL;
            const prevKm = idx < log.length - 1 ? log[idx + 1].km : null;
            const range  = prevKm != null ? entry.km - prevKm : null;
            const cons   = range && range > 0 ? (entry.liters / range) * 100 : null;
            return (
              <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex flex-col items-center gap-0.5 flex-shrink-0 w-10">
                  <span className="text-[8px] font-mono text-white/25">
                    {new Date(entry.date).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
                  </span>
                  <span className="text-[7px] font-mono text-white/15">{entry.km.toLocaleString('tr')}</span>
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] font-black text-blue-300 leading-none">{entry.liters}L</p>
                    <p className="text-[7px] text-white/20 mt-0.5">Litre</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-emerald-300 leading-none">{Math.round(cost)}₺</p>
                    <p className="text-[7px] text-white/20 mt-0.5">Tutar</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black leading-none" style={{ color: cons ? (cons > 12 ? '#f87171' : '#fbbf24') : '#ffffff30' }}>
                      {cons ? `${cons.toFixed(1)}L` : '–'}
                    </p>
                    <p className="text-[7px] text-white/20 mt-0.5">/100km</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = log.filter((e) => e.id !== entry.id);
                    setLog(next);
                    saveFuelLog(next);
                  }}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-white/15 hover:text-red-400/60 transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !adding && (
          <div className="text-center py-6 text-sm" style={{ color: 'rgba(255,255,255,0.18)' }}>
            Henüz yakıt kaydı yok
          </div>
        )
      )}
    </div>
  );
}

/* ── Service tab ──────────────────────────────────────────────────────────── */

function ServiceTab({ vehicle }: { vehicle: LiveVehicle | null }) {
  const [services, setServices] = useState<ServiceItem[]>(loadServices);

  const markDone = useCallback((id: string) => {
    setServices((prev) => {
      const next = prev.map((s) =>
        s.id === id
          ? { ...s, lastKm: vehicle?.odometer ?? 0, lastDate: new Date().toISOString().split('T')[0] }
          : s,
      );
      saveServices(next);
      return next;
    });
  }, [vehicle]);

  function statusOf(s: ServiceItem): 'ok' | 'soon' | 'overdue' | 'unknown' {
    if (!s.lastKm && !s.lastDate) return 'unknown';
    const currentKm = vehicle?.odometer ?? 0;
    const kmSince   = currentKm - (s.lastKm ?? 0);
    const kmLeft    = s.intervalKm - kmSince;
    if (kmLeft < 0)            return 'overdue';
    if (kmLeft < s.intervalKm * 0.15) return 'soon';
    return 'ok';
  }

  const STATUS_CFG = {
    ok:      { color: '#34d399', label: 'İyi',     bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)' },
    soon:    { color: '#fbbf24', label: 'Yakında',  bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)' },
    overdue: { color: '#ef4444', label: 'Geçmiş',  bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)' },
    unknown: { color: '#6b7280', label: 'Bilinmiyor', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.07)' },
  };

  return (
    <div className="flex flex-col gap-2">
      {services.map((s) => {
        const st   = statusOf(s);
        const cfg  = STATUS_CFG[st];
        const currentKm = vehicle?.odometer ?? 0;
        const kmSince   = s.lastKm != null ? currentKm - s.lastKm : null;
        const kmLeft    = kmSince != null ? s.intervalKm - kmSince : null;

        return (
          <div key={s.id} className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
            <span className="text-xl flex-shrink-0" role="img" aria-label={s.label}>{s.icon}</span>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold text-white/80 leading-tight">{s.label}</p>
                <span className="text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0"
                  style={{ background: `${cfg.color}15`, color: cfg.color }}>
                  {cfg.label}
                </span>
              </div>
              <p className="text-[9px] mt-0.5 font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {s.lastDate
                  ? `Son: ${new Date(s.lastDate).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' })} · ${s.lastKm?.toLocaleString('tr')} km`
                  : 'Kayıt yok'}
                {kmLeft != null && kmLeft > 0 && ` · ${kmLeft.toLocaleString('tr')} km kaldı`}
                {kmLeft != null && kmLeft <= 0 && ` · ${Math.abs(kmLeft).toLocaleString('tr')} km geçmiş!`}
              </p>
            </div>

            <button
              onClick={() => markDone(s.id)}
              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
              style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}30`, color: cfg.color }}
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                <path d="M1.5 4.5l2.5 2.5 3.5-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Yapıldı
            </button>
          </div>
        );
      })}

      <p className="text-[9px] text-center font-mono mt-1" style={{ color: 'rgba(255,255,255,0.15)' }}>
        {vehicle?.odometer ? `Mevcut km: ${vehicle.odometer.toLocaleString('tr')}` : 'Kilometre bilgisi yok'}
      </p>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

type RecordsTab = 'fuel' | 'service';

const RecordsPanel = memo(function RecordsPanel({ vehicle }: Props) {
  const [tab, setTab] = useState<RecordsTab>('fuel');

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab switcher */}
      <div className="flex gap-1.5 p-1 rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {([
          { id: 'fuel' as const,    icon: '⛽', label: 'Yakıt Takibi' },
          { id: 'service' as const, icon: '🔧', label: 'Servis Takibi' },
        ] as const).map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all"
            style={{
              background: tab === id ? 'rgba(59,130,246,0.15)' : 'transparent',
              color:      tab === id ? '#60a5fa' : 'rgba(255,255,255,0.3)',
              border:     tab === id ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
            }}
          >
            <span role="img" aria-label={label}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {tab === 'fuel'    && <FuelTab    vehicle={vehicle} />}
      {tab === 'service' && <ServiceTab vehicle={vehicle} />}
    </div>
  );
});

export default RecordsPanel;
