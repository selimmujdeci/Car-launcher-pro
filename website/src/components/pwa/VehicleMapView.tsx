'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { LiveVehicle } from '@/types/realtime';

/* ── Parking spot storage ─────────────────────────────────────────────────── */

interface ParkingSpot {
  lat:     number;
  lng:     number;
  savedAt: number;
  address: string;
}

const PARKING_KEY = 'caros_parking_spot';

function loadParking(): ParkingSpot | null {
  try {
    const raw = localStorage.getItem(PARKING_KEY);
    return raw ? (JSON.parse(raw) as ParkingSpot) : null;
  } catch { return null; }
}

function saveParking(s: ParkingSpot): void {
  try { localStorage.setItem(PARKING_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

function clearParking(): void {
  try { localStorage.removeItem(PARKING_KEY); } catch { /* non-critical */ }
}

/* ── Geo helpers ──────────────────────────────────────────────────────────── */

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R   = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a   = Math.sin(dLat / 2) ** 2
            + Math.cos((lat1 * Math.PI) / 180)
            * Math.cos((lat2 * Math.PI) / 180)
            * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'tr,en' } },
    );
    if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const d = (await res.json()) as { display_name?: string };
    return d.display_name?.split(',').slice(0, 3).join(',').trim()
      ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

/* ── Custom marker HTML factories ─────────────────────────────────────────── */

function vehicleMarkerEl(status: string): HTMLElement {
  const el  = document.createElement('div');
  const color = status === 'online' ? '#34d399' : status === 'alarm' ? '#ef4444' : '#6b7280';
  el.innerHTML = `
    <div style="position:relative;width:40px;height:40px">
      ${status === 'online' ? `
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:.2;animation:ping 1.5s cubic-bezier(0,0,.2,1) infinite"></div>
        <div style="position:absolute;inset:4px;border-radius:50%;background:${color};opacity:.15;animation:ping 2s cubic-bezier(0,0,.2,1) infinite 0.5s"></div>
      ` : ''}
      <div style="position:absolute;inset:8px;border-radius:50%;background:${color};box-shadow:0 0 12px ${color}80;display:flex;align-items:center;justify-content:center">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M2 10L4.5 5.5Q5.5 4 7 4H9Q10.5 4 11.5 5.5L14 10V12.5Q14 14 12.5 14H3.5Q2 14 2 12.5Z"
            stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="5" cy="14" r="1.2" stroke="white" stroke-width="1.2"/>
          <circle cx="11" cy="14" r="1.2" stroke="white" stroke-width="1.2"/>
        </svg>
      </div>
    </div>`;
  return el;
}

function phoneMarkerEl(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 0 8px rgba(59,130,246,.6)"></div>`;
  return el;
}

function parkingMarkerEl(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <div style="width:32px;height:32px;border-radius:50%;background:#f59e0b;border:2px solid white;box-shadow:0 0 10px rgba(245,158,11,.5);display:flex;align-items:center;justify-content:center">
      <span style="font-size:14px;font-weight:900;color:white;font-family:monospace">P</span>
    </div>`;
  return el;
}

/* ── Map style (CARTO dark) ───────────────────────────────────────────────── */

const DARK_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© CARTO · © OpenStreetMap',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'carto', type: 'raster' as const, source: 'carto' }],
};

/* ── Component ────────────────────────────────────────────────────────────── */

interface Props { vehicle: LiveVehicle | null }

type MapMode = 'vehicle' | 'parking';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarkerInstance = any;

export default function VehicleMapView({ vehicle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<MapInstance>(null);
  const vMarkerRef   = useRef<MarkerInstance>(null);
  const pMarkerRef   = useRef<MarkerInstance>(null);
  const pkMarkerRef  = useRef<MarkerInstance>(null);

  const [parking,    setParking]    = useState<ParkingSpot | null>(null);
  const [phonePos,   setPhonePos]   = useState<{ lat: number; lng: number } | null>(null);
  const [distVeh,    setDistVeh]    = useState<string | null>(null);
  const [distPark,   setDistPark]   = useState<string | null>(null);
  const [mode,       setMode]       = useState<MapMode>('vehicle');
  const [savingPark, setSavingPark] = useState(false);
  const [mapReady,   setMapReady]   = useState(false);
  const [initErr,    setInitErr]    = useState('');
  const [shareCopied, setShareCopied] = useState(false);

  /* ── Load parking on mount ────────────────────────────────────────────── */
  useEffect(() => {
    const saved = loadParking();
    if (saved) setParking(saved);
  }, []);

  /* ── Init MapLibre ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    import('maplibre-gl').then(({ Map, Marker }) => {
      if (cancelled || !containerRef.current) return;

      const center: [number, number] = vehicle?.lat && vehicle?.lng
        ? [vehicle.lng, vehicle.lat]
        : [28.978, 41.015]; // İstanbul default

      const map = new Map({
        container:           containerRef.current,
        style:               DARK_STYLE,
        center,
        zoom:                vehicle?.lat ? 14 : 10,
        attributionControl:  false,
        pitchWithRotate:     false,
      });

      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;
        setMapReady(true);

        // Vehicle marker
        if (vehicle?.lat && vehicle?.lng) {
          const vEl = vehicleMarkerEl(vehicle.status);
          vMarkerRef.current = new Marker({ element: vEl, anchor: 'center' })
            .setLngLat([vehicle.lng, vehicle.lat])
            .addTo(map);
        }

        // Parking marker
        const saved = loadParking();
        if (saved) {
          const pkEl = parkingMarkerEl();
          pkMarkerRef.current = new Marker({ element: pkEl, anchor: 'center' })
            .setLngLat([saved.lng, saved.lat])
            .addTo(map);
        }
      });
    }).catch(() => {
      if (!cancelled) setInitErr('Harita yüklenemedi.');
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current     = null;
      vMarkerRef.current = null;
      pMarkerRef.current = null;
      pkMarkerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Update vehicle marker when vehicle data changes ──────────────────── */
  useEffect(() => {
    if (!mapReady || !mapRef.current || !vehicle?.lat || !vehicle?.lng) return;

    import('maplibre-gl').then(({ Marker }) => {
      if (!mapRef.current) return;

      if (vMarkerRef.current) {
        vMarkerRef.current.setLngLat([vehicle.lng, vehicle.lat]);
        const el = vehicleMarkerEl(vehicle.status);
        vMarkerRef.current.getElement().replaceWith(el);
        vMarkerRef.current.remove();
        vMarkerRef.current = new Marker({ element: el, anchor: 'center' })
          .setLngLat([vehicle.lng, vehicle.lat])
          .addTo(mapRef.current);
      } else {
        const el = vehicleMarkerEl(vehicle.status);
        vMarkerRef.current = new Marker({ element: el, anchor: 'center' })
          .setLngLat([vehicle.lng, vehicle.lat])
          .addTo(mapRef.current);
      }

      if (phonePos) {
        const dm = haversineM(phonePos.lat, phonePos.lng, vehicle.lat, vehicle.lng);
        setDistVeh(formatDist(dm));
      }
    });
  }, [vehicle, mapReady, phonePos]);

  /* ── Update phone marker ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!mapReady || !mapRef.current || !phonePos) return;

    import('maplibre-gl').then(({ Marker }) => {
      if (!mapRef.current) return;
      pMarkerRef.current?.remove();
      const el = phoneMarkerEl();
      pMarkerRef.current = new Marker({ element: el, anchor: 'center' })
        .setLngLat([phonePos.lng, phonePos.lat])
        .addTo(mapRef.current);
    });
  }, [phonePos, mapReady]);

  /* ── Update parking marker ──────────────────────────────────────────────── */
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    import('maplibre-gl').then(({ Marker }) => {
      if (!mapRef.current) return;
      pkMarkerRef.current?.remove();
      pkMarkerRef.current = null;

      if (parking) {
        const el = parkingMarkerEl();
        pkMarkerRef.current = new Marker({ element: el, anchor: 'center' })
          .setLngLat([parking.lng, parking.lat])
          .addTo(mapRef.current);

        if (phonePos) {
          const dm = haversineM(phonePos.lat, phonePos.lng, parking.lat, parking.lng);
          setDistPark(formatDist(dm));
        }
      } else {
        setDistPark(null);
      }
    });
  }, [parking, mapReady, phonePos]);

  /* ── Get phone location ─────────────────────────────────────────────────── */
  const locatePhone = useCallback(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setPhonePos({ lat, lng });
        if (vehicle?.lat) {
          setDistVeh(formatDist(haversineM(lat, lng, vehicle.lat, vehicle.lng)));
        }
      },
      () => { /* silently ignore — optional feature */ },
      { timeout: 8_000, maximumAge: 30_000 },
    );
  }, [vehicle]);

  useEffect(() => { locatePhone(); }, [locatePhone]);

  /* ── Pan map to target ──────────────────────────────────────────────────── */
  const panTo = useCallback((lat: number, lng: number, zoom = 16) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 800 });
  }, []);

  /* ── Save parking spot ──────────────────────────────────────────────────── */
  const handleSaveParking = useCallback(async () => {
    if (!navigator.geolocation) return;
    setSavingPark(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat  = pos.coords.latitude;
        const lng  = pos.coords.longitude;
        const addr = await reverseGeocode(lat, lng);
        const spot: ParkingSpot = { lat, lng, savedAt: Date.now(), address: addr };
        saveParking(spot);
        setParking(spot);
        setPhonePos({ lat, lng });
        setMode('parking');
        panTo(lat, lng);
        setSavingPark(false);
      },
      () => { setSavingPark(false); },
      { timeout: 8_000 },
    );
  }, [panTo]);

  /* ── Navigate to parking ────────────────────────────────────────────────── */
  const handleNavigateToParking = useCallback(() => {
    if (!parking) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${parking.lat},${parking.lng}&travelmode=walking`;
    window.open(url, '_blank');
  }, [parking]);

  /* ── Share vehicle location ─────────────────────────────────────────────── */
  const handleShareLocation = useCallback(async () => {
    if (!vehicle?.lat) return;
    const osmUrl = `https://www.openstreetmap.org/?mlat=${vehicle.lat.toFixed(5)}&mlon=${vehicle.lng.toFixed(5)}&zoom=16`;
    const shareText = `${vehicle.name} (${vehicle.plate}) şu an burada: ${osmUrl}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Araç Konumu', text: shareText, url: osmUrl });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(osmUrl).catch(() => {});
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2_500);
    }
  }, [vehicle]);

  /* ── Mode switch pan ────────────────────────────────────────────────────── */
  const switchMode = useCallback((m: MapMode) => {
    setMode(m);
    if (m === 'vehicle' && vehicle?.lat) panTo(vehicle.lat, vehicle.lng);
    if (m === 'parking' && parking)     panTo(parking.lat, parking.lng);
  }, [vehicle, parking, panTo]);

  /* ── Render ─────────────────────────────────────────────────────────────── */

  const savedAgo = parking
    ? (() => {
        const mins = Math.round((Date.now() - parking.savedAt) / 60_000);
        if (mins < 1)    return 'Az önce';
        if (mins < 60)   return `${mins} dk önce`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24)    return `${hrs} sa önce`;
        return `${Math.round(hrs / 24)} gün önce`;
      })()
    : null;

  return (
    <div className="relative w-full h-full flex flex-col" style={{ minHeight: 0 }}>
      {/* ping animation keyframe */}
      <style>{`
        @keyframes ping {
          75%,100% { transform:scale(2); opacity:0 }
        }
      `}</style>

      {/* Map container */}
      <div ref={containerRef} className="flex-1 w-full" style={{ minHeight: 0 }} />

      {initErr && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#060d1a]">
          <p className="text-sm text-white/40">{initErr}</p>
        </div>
      )}

      {/* Mode toggle — top left */}
      <div className="absolute top-3 left-3 z-10 flex gap-1.5 p-1 rounded-xl"
        style={{ background: 'rgba(6,13,26,0.85)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {(['vehicle', 'parking'] as MapMode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
            style={{
              background: mode === m ? 'rgba(59,130,246,0.25)' : 'transparent',
              color:       mode === m ? '#60a5fa' : 'rgba(255,255,255,0.3)',
              border:      mode === m ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
            }}
          >
            {m === 'vehicle' ? 'Araç' : 'Parkım'}
          </button>
        ))}
      </div>

      {/* Top right controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
        {/* Locate me */}
        <button
          onClick={locatePhone}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
          style={{ background: 'rgba(6,13,26,0.85)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3" stroke="#3b82f6" strokeWidth="1.5"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        {/* Share location */}
        {vehicle?.lat !== 0 && (
          <button
            onClick={() => void handleShareLocation()}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
            title={shareCopied ? 'Kopyalandı!' : 'Konumu Paylaş'}
            style={{
              background:  shareCopied ? 'rgba(52,211,153,0.2)' : 'rgba(6,13,26,0.85)',
              backdropFilter: 'blur(12px)',
              border:      shareCopied ? '1px solid rgba(52,211,153,0.4)' : '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {shareCopied ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l4 4 6-6" stroke="#34d399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <circle cx="12" cy="3" r="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3"/>
                <circle cx="3"  cy="7.5" r="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3"/>
                <circle cx="12" cy="12" r="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3"/>
                <path d="M5 6.5l5.5-3M5 8.5l5.5 3" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Bottom info + controls */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-3 pt-2 flex flex-col gap-2"
        style={{ background: 'linear-gradient(to top, rgba(6,13,26,0.95) 60%, transparent)' }}>

        {/* Distance badge */}
        {mode === 'vehicle' && vehicle?.lat && distVeh && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${vehicle.status === 'online' ? 'bg-emerald-400' : 'bg-white/20'}`}/>
              <span className="text-xs font-bold text-white/80">{vehicle.name} · {vehicle.plate}</span>
            </div>
            <span className="text-xs font-black text-emerald-400">{distVeh} uzakta</span>
          </div>
        )}

        {mode === 'vehicle' && vehicle?.lat === 0 && (
          <div className="px-3 py-2 rounded-xl text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-xs text-white/30">Araç konumu henüz alınmadı</p>
          </div>
        )}

        {mode === 'parking' && parking && (
          <div className="px-3 py-2 rounded-xl"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-300 truncate">{parking.address}</p>
                <p className="text-[10px] text-amber-400/50 mt-0.5">{savedAgo} kaydedildi{distPark ? ` · ${distPark} uzakta` : ''}</p>
              </div>
              <button
                onClick={() => { clearParking(); setParking(null); }}
                className="text-[10px] text-white/25 hover:text-red-400/60 transition-colors flex-shrink-0 mt-0.5"
              >
                Sil
              </button>
            </div>
          </div>
        )}

        {mode === 'parking' && !parking && (
          <div className="px-3 py-2 rounded-xl text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-xs text-white/30">Henüz park yeri kaydedilmedi</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSaveParking}
            disabled={savingPark}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-[0.97] disabled:opacity-50"
            style={{ background: 'rgba(245,158,11,0.15)', border: '1.5px solid rgba(245,158,11,0.3)', color: '#fbbf24' }}
          >
            {savingPark ? (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"
                  strokeDasharray="22" strokeDashoffset="7" opacity="0.4"/>
                <path d="M7 2a5 5 0 015 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1C4.79 1 3 2.79 3 5c0 2.94 4 8 4 8s4-5.06 4-8c0-2.21-1.79-4-4-4z"
                  stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="7" cy="5" r="1.2" fill="currentColor"/>
              </svg>
            )}
            {savingPark ? 'Kaydediliyor…' : 'Park Ettim'}
          </button>

          {parking && (
            <button
              onClick={handleNavigateToParking}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-[0.97]"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1.5px solid rgba(59,130,246,0.3)', color: '#60a5fa' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l4-4 4 4M6 3v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                  transform="rotate(90 7 7)"/>
              </svg>
              Yol Tarifi Al
            </button>
          )}

          {vehicle?.lat !== 0 && mode === 'parking' && (
            <button
              onClick={() => vehicle?.lat && panTo(vehicle.lat, vehicle.lng)}
              className="w-11 flex items-center justify-center py-3 rounded-xl transition-all active:scale-[0.97]"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1.5px solid rgba(52,211,153,0.25)', color: '#34d399' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 10L4.5 5.5Q5.5 4 7 4H9Q10.5 4 11.5 5.5L14 10V12.5Q14 14 12.5 14H3.5Q2 14 2 12.5Z"
                  stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
