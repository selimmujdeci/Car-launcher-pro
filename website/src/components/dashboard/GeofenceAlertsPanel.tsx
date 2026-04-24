'use client';

/**
 * GeofenceAlertsPanel — Gerçek zamanlı geofence & valet ihlal bildirimleri.
 *
 * Supabase Realtime üzerinden `events` tablosunu dinler (type = geofence_alert | valet_alert).
 * Zero-Leak: useEffect cleanup ile kanal aboneliği kesilir.
 * Mock mod: Supabase yoksa demo olayları simüle eder.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldAlert, Navigation, Clock, X } from 'lucide-react';

// Lucide icons resolve from root node_modules (React 19 types) but website uses
// React 18 — cast to a compatible FC type to avoid ReactNode/ReactPortal mismatch.
type SvgFC = React.FC<{ className?: string; style?: React.CSSProperties }>;
const _AlertTriangle = AlertTriangle as unknown as SvgFC;
const _ShieldAlert   = ShieldAlert   as unknown as SvgFC;
const _Navigation    = Navigation    as unknown as SvgFC;
const _Clock         = Clock         as unknown as SvgFC;
const _X             = X             as unknown as SvgFC;
import { supabaseBrowser } from '@/lib/supabase';

/* ── Tipler ─────────────────────────────────────────────── */

export interface GeofenceAlertEvent {
  id:         string;
  type:       'geofence_alert' | 'valet_alert';
  payload:    {
    violation?:   string;
    speedKmh?:    number;
    limitKmh?:    number;
    distanceKm?:  number;
    lat?:         number;
    lng?:         number;
    timestamp?:   number;
  };
  created_at: string;
}

interface Props {
  vehicleId?: string; // filter by vehicle; undefined = tüm linked araçlar
  maxItems?:  number;
}

/* ── Mock ───────────────────────────────────────────────── */

const MOCK_ALERTS: GeofenceAlertEvent[] = [
  {
    id:         'mock-1',
    type:       'geofence_alert',
    payload:    { violation: 'exit', distanceKm: 2.4, lat: 41.0082, lng: 28.9784, timestamp: Date.now() - 180_000 },
    created_at: new Date(Date.now() - 180_000).toISOString(),
  },
  {
    id:         'mock-2',
    type:       'valet_alert',
    payload:    { violation: 'speed_limit', speedKmh: 73, limitKmh: 50, lat: 41.0102, lng: 28.9814, timestamp: Date.now() - 60_000 },
    created_at: new Date(Date.now() - 60_000).toISOString(),
  },
];

/* ── Yardımcılar ────────────────────────────────────────── */

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'Az önce';
  if (m < 60) return `${m} dk önce`;
  return `${Math.floor(m / 60)} sa önce`;
}

/* ── Bileşen ────────────────────────────────────────────── */

export function GeofenceAlertsPanel({ vehicleId, maxItems = 10 }: Props) {
  const [alerts, setAlerts]     = useState<GeofenceAlertEvent[]>([]);
  const [dismissed, setDismiss] = useState<Set<string>>(new Set());
  const mountedRef               = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!supabaseBrowser) {
      // Demo mod — mock veriler
      setAlerts(MOCK_ALERTS);
      return () => { mountedRef.current = false; };
    }

    /* ── İlk yükleme: son 24 saatteki olaylar ── */
    const since = new Date(Date.now() - 86_400_000).toISOString();
    let query = supabaseBrowser
      .from('events')
      .select('id, type, payload, created_at')
      .in('type', ['geofence_alert', 'valet_alert'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(maxItems);

    if (vehicleId) query = query.eq('vehicle_id', vehicleId);

    query.then(({ data }) => {
      if (!mountedRef.current || !data) return;
      setAlerts(data as GeofenceAlertEvent[]);
    });

    /* ── Realtime subscription ── */
    const filter = vehicleId
      ? `type=in.(geofence_alert,valet_alert),vehicle_id=eq.${vehicleId}`
      : 'type=in.(geofence_alert,valet_alert)';

    const channel = supabaseBrowser
      .channel('geofence-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter }, (payload) => {
        if (!mountedRef.current) return;
        const ev = payload.new as GeofenceAlertEvent;
        if (!['geofence_alert', 'valet_alert'].includes(ev.type)) return;
        setAlerts((prev) => [ev, ...prev].slice(0, maxItems));
      })
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabaseBrowser!.removeChannel(channel);
    };
  }, [vehicleId, maxItems]);

  const visible = alerts.filter((a) => !dismissed.has(a.id));

  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <_ShieldAlert className="w-4 h-4 text-emerald-400/60 flex-shrink-0" />
        <span className="text-xs text-white/30">Son 24 saatte ihlal yok</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((alert) => {
        const isValet = alert.type === 'valet_alert';
        const accent  = '#ef4444';
        const Icon: SvgFC = isValet ? _AlertTriangle : _Navigation;

        const title = isValet
          ? `Vale İhlali — ${Math.round(alert.payload.speedKmh ?? 0)} km/h`
          : `Geofence Çıkışı — ${alert.payload.distanceKm?.toFixed(1)} km`;

        const sub = isValet
          ? `Limit: ${alert.payload.limitKmh} km/h`
          : alert.payload.lat ? `${alert.payload.lat.toFixed(4)}, ${alert.payload.lng?.toFixed(4)}` : '';

        return (
          <div key={alert.id}
            className="relative flex items-start gap-3 px-4 py-3 rounded-2xl transition-all"
            style={{
              background:  'rgba(239,68,68,0.07)',
              border:      '1px solid rgba(239,68,68,0.25)',
              boxShadow:   '0 0 20px rgba(239,68,68,0.08)',
            }}>

            {/* Neon puls ikonası */}
            <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-black text-red-400 uppercase tracking-wide">{title}</span>
                <span className="text-[9px] font-mono text-red-400/50 uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                  style={{ background: 'rgba(239,68,68,0.1)' }}>
                  {isValet ? 'VALE' : 'BÖLGE'}
                </span>
              </div>
              {sub && <p className="text-[10px] text-white/35 mt-0.5 font-mono">{sub}</p>}
              <div className="flex items-center gap-1 mt-1">
                <_Clock className="w-2.5 h-2.5 text-white/20" />
                <span className="text-[9px] text-white/25">{relativeTime(alert.created_at)}</span>
              </div>
            </div>

            {/* Kapat */}
            <button
              onClick={() => setDismiss((prev) => { const s = new Set(prev); s.add(alert.id); return s; })}
              className="flex-shrink-0 w-5 h-5 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <_X className="w-3 h-3 text-white/25 hover:text-white/60" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
