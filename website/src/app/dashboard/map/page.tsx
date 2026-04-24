'use client';

import { useState, useCallback, useEffect } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import LiveMap from '@/components/map/LiveMap';
import { SpeedGauge, RpmGauge, FuelGauge, TempGauge } from '@/components/dashboard/Gauges';

export default function MapPage() {
  const vehicles         = useVehicleStore((s) => s.getList());
  const connectionStatus = useVehicleStore((s) => s.connectionStatus);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');

  useEffect(() => {
    const updateOrientation = () => {
      setOrientation(window.innerHeight > window.innerWidth ? 'portrait' : 'landscape');
    };
    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    return () => window.removeEventListener('resize', updateOrientation);
  }, []);

  const online   = vehicles.filter((v) => v.status !== 'offline');
  const selected = selectedId ? vehicles.find((v) => v.id === selectedId) ?? null : null;

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!id) setFollowMode(false);
  }, []);

  return (
    <div className={`flex bg-black text-white overflow-hidden h-screen w-screen ${
      orientation === 'portrait' ? 'flex-col' : 'flex-row'
    }`}>
      
      {/* ── Sidebar (Landscape / Car Mode) ─────────────────────────── */}
      {orientation === 'landscape' && (
        <aside className="w-20 lg:w-24 bg-black/40 backdrop-blur-xl border-r border-white/5 flex flex-col items-center py-6 gap-8 z-30">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </div>
          
          <nav className="flex flex-col gap-6">
            {[
              { icon: 'M9 20l-5-5 5-5M20 20l-5-5 5-5', active: true },
              { icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', active: false },
              { icon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z', active: false },
              { icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z', active: false }
            ].map((item, i) => (
              <button
                key={i}
                className={`w-14 h-14 lg:w-16 lg:h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                  item.active 
                    ? 'bg-white/10 text-white shadow-inner border border-white/10' 
                    : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                }`}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
              </button>
            ))}
          </nav>
        </aside>
      )}

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main className="flex-1 relative flex flex-col min-w-0">
        {/* Full map */}
        <div className="flex-1 relative min-h-0">
          <LiveMap
            vehicles={vehicles}
            selectedId={selectedId}
            onSelect={handleSelect}
            followMode={followMode}
            className="absolute inset-0 w-full h-full"
          />

          {/* Top Status Bar (Glassmorphism) */}
          <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none">
            <div className="flex items-center gap-3 bg-black/40 backdrop-blur-xl rounded-2xl px-4 py-2.5 border border-white/10 shadow-2xl pointer-events-auto min-h-[44px] lg:min-h-[54px]">
              <div className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'
              }`} />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Sistem Durumu</span>
                <span className="text-xs text-white/90 font-mono">
                  {connectionStatus === 'connected' ? `AKTİF · ${online.length} ARAÇ` : connectionStatus.toUpperCase()}
                </span>
              </div>
            </div>

            {selected && (
              <button
                onClick={() => setFollowMode((f) => !f)}
                className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-xs font-bold tracking-wider border backdrop-blur-xl transition-all shadow-2xl pointer-events-auto min-h-[44px] lg:min-h-[54px] ${
                  followMode
                    ? 'bg-blue-500/20 border-blue-400/40 text-blue-400'
                    : 'bg-black/40 border-white/10 text-white/60 hover:text-white'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
                {followMode ? 'TAKİP MODU: AÇIK' : 'ARACI TAKİP ET'}
              </button>
            )}
          </div>

          {/* Gauge overlay for selected vehicle (Premium Dark UI) */}
          {selected && (
            <div className={`absolute z-20 bg-black/60 backdrop-blur-2xl rounded-3xl border border-white/10 p-5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] transition-all duration-500 ${
              orientation === 'portrait' ? 'bottom-24 right-4 left-4' : 'bottom-6 right-6 w-[420px]'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-white/95">{selected.plate}</h3>
                  <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{selected.driver}</p>
                </div>
                <div className="px-3 py-1 bg-white/5 rounded-lg border border-white/5 text-[10px] font-mono text-white/60">
                  {selected.status.toUpperCase()}
                </div>
              </div>
              
              <div className="grid grid-cols-4 gap-2">
                <div className="h-24"><SpeedGauge value={selected.speed} /></div>
                <div className="h-24"><RpmGauge   value={selected.rpm} /></div>
                <div className="h-24"><FuelGauge  value={selected.fuel} /></div>
                <div className="h-24"><TempGauge  value={selected.engineTemp} /></div>
              </div>
            </div>
          )}

          {/* Legend */}
          {!selected && (
            <div className="absolute bottom-6 left-6 z-20 bg-black/40 backdrop-blur-xl rounded-2xl px-5 py-4 border border-white/10 flex flex-col gap-2.5">
              {[
                { color: 'bg-emerald-400', label: 'Çevrimiçi' },
                { color: 'bg-red-500',     label: 'Alarm Durumu'  },
                { color: 'bg-white/20',    label: 'Çevrimdışı' },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] ${color}`} />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Bottom Navigation / Vehicle Strip ─────────────────────── */}
        <div className={`flex-shrink-0 z-30 transition-all ${
          orientation === 'portrait' 
            ? 'h-20 bg-black/80 backdrop-blur-2xl border-t border-white/5 px-6' 
            : 'h-24 bg-gradient-to-t from-black to-transparent px-6 pb-6'
        }`}>
          <div className="h-full flex items-center gap-4 overflow-x-auto no-scrollbar">
            {online.map((v) => (
              <button
                key={v.id}
                onClick={() => handleSelect(selectedId === v.id ? null : v.id)}
                className={`flex items-center gap-4 px-5 rounded-2xl flex-shrink-0 border transition-all duration-300 min-h-[48px] lg:min-h-[64px] ${
                  selectedId === v.id
                    ? 'bg-blue-600 text-white border-blue-400 shadow-[0_8px_20px_-4px_rgba(37,99,235,0.4)]'
                    : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10 text-white/70'
                }`}
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 shadow-lg ${
                  v.status === 'alarm' ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'
                }`} />
                <div className="text-left">
                  <p className="text-xs font-bold tracking-tight">{v.plate}</p>
                  <p className={`text-[10px] font-mono ${selectedId === v.id ? 'text-white/70' : 'text-white/30'}`}>
                    {Math.round(v.speed)} KM/H
                  </p>
                </div>
              </button>
            ))}

            {online.length === 0 && (
              <div className="flex-1 flex justify-center italic text-white/20 text-xs tracking-widest">
                AKTİF ARAÇ BULUNAMADI
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Mobile Bottom Bar (Portrait Only) ─────────────────────── */}
      {orientation === 'portrait' && (
        <nav className="h-20 bg-black border-t border-white/5 flex items-center justify-around px-6 z-40 pb-safe">
          {[
            { icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', active: true },
            { icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2', active: false },
            { icon: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z', active: false }
          ].map((item, i) => (
            <button
              key={i}
              className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${
                item.active ? 'text-blue-500 bg-blue-500/10' : 'text-white/20'
              }`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
