'use client';

import { useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import MobileCarControl from '@/components/dashboard/MobileCarControl';
import PairingScreen from '@/components/pwa/PairingScreen';
import { useVehicleStore } from '@/store/vehicleStore';
import { useRealtime } from '@/hooks/useRealtime';

export default function KumandaPage() {
  useRealtime();
  const loading  = useVehicleStore((s) => s.loading);
  const error    = useVehicleStore((s) => s.error);
  const vehicles = useVehicleStore((s) => s.getList());

  const vehicle = useMemo(
    () => vehicles.find((v) => v.status === 'online') ?? vehicles[0] ?? null,
    [vehicles],
  );

  const reload = useCallback(() => {
    void useVehicleStore.getState().initializeFromSupabase();
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const noPairedVehicle = !loading && !error && vehicles.length === 0;

  return (
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{ background: '#060d1a' }}
    >
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 rounded-full bg-blue-500/[0.06] blur-[80px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-80 h-48 rounded-full bg-blue-600/[0.04] blur-[60px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-safe pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 11L4.5 6Q5.5 4 7 4H11Q12.5 4 13.5 6L16 11V13.5Q16 15 14.5 15H3.5Q2 15 2 13.5Z"
                stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="5.5" cy="15" r="1.8" stroke="#3b82f6" strokeWidth="1.5"/>
              <circle cx="12.5" cy="15" r="1.8" stroke="#3b82f6" strokeWidth="1.5"/>
              <rect x="6.5" y="7.5" width="5" height="3.5" rx="1.2" stroke="#3b82f6" strokeWidth="1.2"/>
            </svg>
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none">Arabam Cebimde</p>
            <p className="text-white/30 text-[10px] mt-0.5">
              {noPairedVehicle ? 'Araç Eşleştir' : 'Canlı Bağlantı'}
            </p>
          </div>
        </div>

        <Link
          href="/dashboard"
          className="text-[11px] font-semibold text-blue-400/70 hover:text-blue-400 transition-colors px-3 py-1.5 rounded-lg border border-blue-500/20 bg-blue-500/[0.06]"
        >
          Panele Git →
        </Link>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1 px-4 py-4 overflow-y-auto">
        <div
          className="rounded-3xl p-5 mb-4"
          style={{
            background: 'linear-gradient(145deg, #0c1a2e 0%, #070f1d 100%)',
            border: '1px solid rgba(59,130,246,0.12)',
            boxShadow: '0 0 40px rgba(59,130,246,0.06), 0 20px 60px rgba(0,0,0,0.5)',
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-10 text-sm text-white/50">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="32" strokeDashoffset="10" opacity="0.4"/>
                <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Araç verileri yükleniyor…
            </div>
          ) : error ? (
            <div className="py-6 text-center">
              <p className="text-sm text-red-300/80">Bağlantı hatası: {error}</p>
              <button
                onClick={reload}
                className="mt-3 text-xs text-blue-400/70 hover:text-blue-400 transition-colors px-3 py-1.5 rounded-lg border border-blue-500/20 bg-blue-500/[0.06]"
              >
                Tekrar Dene
              </button>
            </div>
          ) : noPairedVehicle ? (
            <PairingScreen onPaired={reload} />
          ) : (
            <MobileCarControl vehicle={vehicle} />
          )}
        </div>
      </main>

      {/* Bottom nav */}
      <nav
        className="relative z-10 pb-safe"
        style={{ background: 'rgba(6,13,26,0.9)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center justify-around py-2">
          {[
            {
              label: 'Kumanda', active: !noPairedVehicle,
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="4" y="9" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M6 9V7a4 4 0 018 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="10" cy="13" r="1.5" fill="currentColor"/>
                </svg>
              ),
            },
            {
              label: 'Eşleştir', active: noPairedVehicle,
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2C7.24 2 5 4.24 5 7c0 3.75 5 11 5 11s5-7.25 5-11c0-2.76-2.24-5-5-5z" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="10" cy="7" r="2" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              ),
            },
            {
              label: 'Panel', active: false,
              href: '/login',
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M2 8h16" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              ),
            },
          ].map(({ label, active, href, icon }) =>
            href ? (
              <Link key={label} href={href} className="flex flex-col items-center gap-1 py-1 px-4 text-white/30">
                {icon}
                <span className="text-[9px] font-semibold">{label}</span>
              </Link>
            ) : (
              <button
                key={label}
                className="flex flex-col items-center gap-1 py-1 px-4 transition-colors"
                style={{ color: active ? '#3b82f6' : 'rgba(255,255,255,0.3)' }}
              >
                {icon}
                <span className="text-[9px] font-semibold">{label}</span>
              </button>
            )
          )}
        </div>
      </nav>
    </div>
  );
}
