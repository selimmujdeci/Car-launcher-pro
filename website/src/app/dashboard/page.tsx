'use client';

import React, { useState, useMemo } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import StatCard from '@/components/dashboard/StatCard';
import VehicleList from '@/components/dashboard/VehicleList';
import VehicleModal from '@/components/dashboard/VehicleModal';
import LiveMap from '@/components/map/LiveMap';
import { GeofenceAlertsPanel } from '@/components/dashboard/GeofenceAlertsPanel';
import { RemoteCommandPanel } from '@/components/dashboard/RemoteCommandPanel';
import type { LiveVehicle } from '@/types/realtime';

/* ── Status Pulse ─────────────────────────────────────────── */

function StatusPulse({ status }: { status: LiveVehicle['status'] }) {
  if (status === 'online') {
    return (
      <span className="relative flex h-3 w-3">
        <span className="animate-glow-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400/50" />
        <span className="relative inline-flex h-3 w-3 rounded-full neon-online bg-emerald-400" />
      </span>
    );
  }
  if (status === 'alarm') {
    return (
      <span className="relative flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400/60" />
        <span className="relative inline-flex h-3 w-3 rounded-full neon-alarm bg-red-400" />
      </span>
    );
  }
  return <span className="inline-flex h-3 w-3 rounded-full bg-white/15" />;
}

/* ── Neon bar — animated fill ─────────────────────────────── */

function NeonBar({
  value,
  max = 100,
  color = '#34d399',
  danger,
  warn,
}: {
  value: number;
  max?: number;
  color?: string;
  danger?: boolean;
  warn?: boolean;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const barColor = danger ? '#ef4444' : warn ? '#fbbf24' : color;
  return (
    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width: `${pct}%`,
          background: barColor,
          boxShadow: `0 0 6px ${barColor}80`,
          animation: 'barFill 0.8s ease-out',
        }}
      />
    </div>
  );
}

/* ── Metric tile ─────────────────────────────────────────── */

function MetricTile({
  label,
  value,
  unit,
  color,
  barValue,
  barDanger,
  barWarn,
}: {
  label:      string;
  value:      string | number;
  unit:       string;
  color:      string;
  barValue:   number;
  barDanger?: boolean;
  barWarn?:   boolean;
}) {
  return (
    <div
      className="flex flex-col gap-2.5 px-4 py-3.5 rounded-xl"
      style={{
        background: `${color}09`,
        border:     `1px solid ${color}20`,
      }}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">{label}</span>
        <span className="text-[10px] font-mono text-white/20">{unit}</span>
      </div>
      <div
        className="text-xl font-black tabular-nums leading-none"
        style={{ color, textShadow: `0 0 12px ${color}60` }}
      >
        {value}
      </div>
      <NeonBar value={barValue} color={color} danger={barDanger} warn={barWarn} />
    </div>
  );
}

/* ── Telemetry strip ─────────────────────────────────────── */

function TelemetryStrip({ vehicle: v }: { vehicle: LiveVehicle }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <MetricTile
        label="Hız"
        value={Math.round(v.speed)}
        unit="km/h"
        color={v.speed > 90 ? '#ef4444' : v.speed > 60 ? '#fbbf24' : '#34d399'}
        barValue={v.speed}
        barDanger={v.speed > 90}
        barWarn={v.speed > 60}
      />
      <MetricTile
        label="Yakıt"
        value={Math.round(v.fuel)}
        unit="%"
        color={v.fuel < 15 ? '#ef4444' : v.fuel < 30 ? '#fbbf24' : '#60a5fa'}
        barValue={v.fuel}
        barDanger={v.fuel < 15}
        barWarn={v.fuel < 30}
      />
      <MetricTile
        label="Motor °C"
        value={Math.round(v.engineTemp)}
        unit="°C"
        color={v.engineTemp > 100 ? '#ef4444' : v.engineTemp > 85 ? '#fbbf24' : '#34d399'}
        barValue={Math.min(100, ((v.engineTemp - 18) / 112) * 100)}
        barDanger={v.engineTemp > 100}
        barWarn={v.engineTemp > 85}
      />
      <MetricTile
        label="RPM"
        value={(v.rpm / 1000).toFixed(1) + 'k'}
        unit="rpm"
        color="#a78bfa"
        barValue={(v.rpm / 6000) * 100}
      />
    </div>
  );
}

/* ── Panel header ────────────────────────────────────────── */

function PanelHeader({
  icon,
  title,
  color = '#60a5fa',
  badge,
}: {
  icon:   React.ReactNode;
  title:  string;
  color?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}12`, border: `1px solid ${color}25` }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <span className="text-[11px] font-black uppercase tracking-[0.32em] text-white/70">{title}</span>
      </div>
      {badge}
    </div>
  );
}

/* ── Focused vehicle header ──────────────────────────────── */

function FocusedVehicleHeader({ vehicle: v }: { vehicle: LiveVehicle }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4"
      style={{
        background: 'rgba(0,0,0,0.5)',
        border:     '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <StatusPulse status={v.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-bold text-white/90">{v.plate}</span>
          <span className="text-[10px] text-white/35 truncate">{v.name}</span>
        </div>
        <div className="text-[10px] text-white/25 mt-0.5">
          {v.status === 'online' ? `${v.driver} · ${v.location}` : 'Son görülme: ' + v.lastSeen}
        </div>
      </div>
      <div
        className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
        style={{
          color:      v.status === 'online' ? '#34d399' : v.status === 'alarm' ? '#ef4444' : '#ffffff40',
          background: v.status === 'online' ? 'rgba(52,211,153,0.1)' : v.status === 'alarm' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)',
          border:     `1px solid ${v.status === 'online' ? 'rgba(52,211,153,0.25)' : v.status === 'alarm' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.07)'}`,
        }}
      >
        {v.status === 'online' ? 'Online' : v.status === 'alarm' ? 'Alarm' : 'Offline'}
      </div>
    </div>
  );
}

/* ── SVG icon helpers ────────────────────────────────────── */

const GaugeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 9a5 5 0 1110 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M7 9L9.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <circle cx="7" cy="9" r="1" fill="currentColor"/>
  </svg>
);
const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M4 5.5l2 1.5-2 1.5M7.5 8.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const ShieldIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5L2 3.5V7c0 2.5 2.2 4.5 5 5 2.8-.5 5-2.5 5-5V3.5L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M7 5v2M7 8.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const CarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M2.5 11V8.5L5 4h8l2.5 4.5V11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M1.5 11h15v2.5a1 1 0 01-1 1h-13a1 1 0 01-1-1V11z" stroke="currentColor" strokeWidth="1.4"/>
    <circle cx="5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.4"/>
    <circle cx="13" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.4"/>
  </svg>
);

/* ── Dashboard page ──────────────────────────────────────── */

export default function DashboardPage() {
  const vehicles         = useVehicleStore((s) => s.getList());
  const connectionStatus = useVehicleStore((s) => s.connectionStatus);
  const loading          = useVehicleStore((s) => s.loading);
  const error            = useVehicleStore((s) => s.error);
  const [selected, setSelected] = useState<LiveVehicle | null>(null);

  if (loading) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/60">Araç verileri yükleniyor...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-6 text-sm text-red-300/90">Supabase bağlantı hatası: {error}</div>;
  }

  const stats = useMemo(() => {
    const online = vehicles.filter((v) => v.status === 'online');
    const alarm  = vehicles.filter((v) => v.status === 'alarm');
    const active = [...online, ...alarm];
    return { active, online, alarm };
  }, [vehicles]);

  const mapVehicles    = vehicles.filter((v) => v.status !== 'offline' && v.lat !== 0);
  const focusedVehicle = selected ?? vehicles.find((v) => v.status === 'online') ?? null;

  return (
    <div className="space-y-5">

      {/* ── Stat kartları ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="card-enter card-enter-1">
          <StatCard
            label="Toplam Araç"
            value={vehicles.length}
            sub={`${stats.active.length} aktif`}
            accent="blue"
            trend={{ value: '+1', up: true }}
            icon={<CarIcon />}
          />
        </div>
        <div className="card-enter card-enter-2">
          <StatCard
            label="Online"
            value={stats.online.length}
            sub="Şu an hareket ediyor"
            accent="emerald"
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M4.5 13.5A7 7 0 0113.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M13.5 13.5A7 7 0 014.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 2"/>
              </svg>
            }
          />
        </div>
        <div className="card-enter card-enter-3">
          <StatCard
            label="Alarm"
            value={stats.alarm.length}
            sub={stats.alarm.length > 0 ? 'Müdahale gerekiyor' : 'Sorun yok'}
            accent={stats.alarm.length > 0 ? 'red' : 'emerald'}
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2l7 13H2L9 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                <path d="M9 7.5v3M9 12.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            }
          />
        </div>
        <div className="card-enter card-enter-4">
          <StatCard
            label="Bağlantı"
            value={connectionStatus === 'connected' ? 'Aktif' : connectionStatus === 'connecting' ? 'Bağlanıyor' : 'Kopuk'}
            sub="Realtime data"
            accent={connectionStatus === 'connected' ? 'emerald' : connectionStatus === 'connecting' ? 'amber' : 'red'}
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M9 5v4l2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            }
          />
        </div>
      </div>

      {/* ── Canlı harita ── */}
      <div className="relative rounded-2xl overflow-hidden h-52 card-enter" style={{ animationDelay: '0.18s' }}>
        <LiveMap
          vehicles={mapVehicles}
          onSelect={(id) => setSelected(vehicles.find((v) => v.id === id) ?? null)}
          className="absolute inset-0 w-full h-full"
        />
        {/* Status glow badge */}
        <div className="absolute top-3 left-4 flex items-center gap-2 z-10 pointer-events-none"
          style={{
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0.625rem',
            padding: '6px 12px',
          }}
        >
          {connectionStatus === 'connected' ? (
            <StatusPulse status="online" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-white/20" />
          )}
          <span className="text-[10px] font-mono text-white/50">
            {connectionStatus === 'connected'
              ? `CANLI · ${mapVehicles.length} araç`
              : connectionStatus.toUpperCase()}
          </span>
        </div>
        {/* Scan line — subtle OLED effect */}
        <div
          className="absolute inset-x-0 h-px opacity-[0.04] pointer-events-none z-20"
          style={{
            background: 'linear-gradient(90deg, transparent, #60a5fa, transparent)',
            animation: 'scanLine 6s linear infinite',
          }}
        />
      </div>

      {/* ── İki kolonlu panel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Sol: Telemetri + Remote Control */}
        <div className="flex flex-col gap-4">
          {focusedVehicle ? (
            <>
              {/* Telemetri paneli */}
              <div
                className="card-enter glass-panel p-5"
                style={{
                  animationDelay: '0.2s',
                  boxShadow: focusedVehicle.status === 'online'
                    ? '0 0 0 1px rgba(52,211,153,0.12) inset, 0 8px 32px rgba(0,0,0,0.5)'
                    : '0 8px 32px rgba(0,0,0,0.5)',
                }}
              >
                <PanelHeader
                  icon={<GaugeIcon />}
                  title="Canlı Telemetri"
                  color="#60a5fa"
                  badge={<FocusedVehicleHeader vehicle={focusedVehicle} />}
                />
                {/* badge is rendered in header, no duplicate needed */}
                <div className="mt-1">
                  <TelemetryStrip vehicle={focusedVehicle} />
                </div>
              </div>

              {/* Remote kontrol paneli */}
              <div
                className="card-enter glass-panel p-5"
                style={{ animationDelay: '0.25s' }}
              >
                <PanelHeader icon={<TerminalIcon />} title="Uzaktan Kontrol" color="#a78bfa" />
                <RemoteCommandPanel vehicleId={focusedVehicle.id} />
              </div>
            </>
          ) : (
            <div className="glass-panel p-8 flex flex-col items-center justify-center text-center gap-3" style={{ minHeight: '260px' }}>
              <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-white/20">
                <CarIcon />
              </div>
              <p className="text-sm text-white/30">Araç seçin veya araç bağlanmasını bekleyin</p>
            </div>
          )}
        </div>

        {/* Sağ: Geofence / Hırsız Savar */}
        <div
          className="card-enter glass-panel p-5"
          style={{ animationDelay: '0.28s' }}
        >
          <PanelHeader icon={<ShieldIcon />} title="Hırsız Savar — İhlal Geçmişi" color="#ef4444" />
          <GeofenceAlertsPanel vehicleId={focusedVehicle?.id} />
        </div>
      </div>

      {/* ── Araç listesi ── */}
      <div className="card-enter" style={{ animationDelay: '0.32s' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white/70">Araç Listesi</h2>
          <a
            href="/dashboard/vehicles"
            className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors"
          >
            Tümünü gör →
          </a>
        </div>
        <VehicleList vehicles={vehicles} onSelect={(v) => setSelected(v as LiveVehicle)} />
      </div>

      {selected && <VehicleModal vehicle={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
