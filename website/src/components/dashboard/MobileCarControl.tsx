'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { useCommandTracker } from '@/hooks/useCommandTracker';
import type { CmdPhase, CommandResult } from '@/hooks/useCommandTracker';
import type { CommandType, RoutePayload } from '@/lib/commandService';

interface Props { vehicle: LiveVehicle | null }

type NavProvider = RoutePayload['provider_intent'];

interface GeoResult {
  lat:          number;
  lng:          number;
  display_name: string;
  short_name:   string;
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */

const SpinIcon = () => (
  <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"
      strokeDasharray="42" strokeDashoffset="14" opacity="0.35"/>
    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const QueueIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 2"/>
    <path d="M11 7v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

/* ── Phase label helper ─────────────────────────────────────────────────────── */

function phaseLabel(phase: CmdPhase, defaultLabel: string, defaultSub: string) {
  if (phase === 'pending')   return { label: 'Gönderiliyor',   sub: 'Bekle...' };
  if (phase === 'queued')    return { label: defaultLabel,      sub: 'Sıraya alındı' };
  if (phase === 'accepted')  return { label: 'Kabul Edildi',   sub: 'Araç hazır' };
  if (phase === 'executing') return { label: 'Yürütülüyor',    sub: 'Lütfen bekle' };
  if (phase === 'ok')        return { label: defaultLabel,      sub: 'Onaylandı ✓' };
  if (phase === 'err')       return { label: 'Hata',           sub: 'Tekrar dene' };
  return { label: defaultLabel, sub: defaultSub };
}

/* ── Offline banner ─────────────────────────────────────────────────────────── */

function OfflineBanner({ plate }: { plate: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
      style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-red-300/90 leading-tight">Araç bağlantısı kesildi</p>
        <p className="text-[10px] text-red-400/50 mt-0.5 truncate">
          {plate} · Komutlar sıraya alınır (5dk TTL)
        </p>
      </div>
    </div>
  );
}

/* ── Large round button ─────────────────────────────────────────────────────── */

const BigBtn = memo(function BigBtn({
  label, sublabel, color, bgColor, borderColor,
  phase, onClick, onRetry, children,
}: {
  label: string; sublabel: string; color: string;
  bgColor: string; borderColor: string;
  phase: CmdPhase; onClick: () => void; onRetry?: () => void;
  children: React.ReactNode;
}) {
  const busy   = ['pending', 'accepted', 'executing'].includes(phase);
  const queued = phase === 'queued';
  const isErr  = phase === 'err';
  const { label: l, sub } = phaseLabel(phase, label, sublabel);

  const glow =
    phase === 'ok'  ? `0 0 32px ${color}55, 0 0 12px ${color}30 inset` :
    isErr           ? `0 0 20px rgba(239,68,68,0.3)` :
                      `0 0 16px ${color}18`;

  return (
    <div className="relative flex flex-col gap-1 w-full">
      <button
        onClick={onClick}
        disabled={busy || queued}
        className="flex flex-col items-center justify-center gap-2 w-full aspect-square rounded-3xl transition-all duration-200 select-none active:scale-90 disabled:opacity-70"
        style={{
          background:  isErr ? 'rgba(239,68,68,0.08)' : queued ? 'rgba(251,191,36,0.07)' : bgColor,
          border:      `2px solid ${isErr ? 'rgba(239,68,68,0.35)' : queued ? 'rgba(251,191,36,0.3)' : phase === 'ok' ? color : borderColor}`,
          boxShadow:   glow,
        }}
      >
        <span style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}
          className="transition-transform duration-150">
          {busy ? <SpinIcon /> : queued ? <QueueIcon /> : children}
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.3em]"
          style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}>{l}</span>
        <span className="text-[9px] font-medium"
          style={{ color: `${isErr ? '#ef4444' : queued ? '#fbbf24' : color}70` }}>{sub}</span>
      </button>

      {isErr && onRetry && (
        <button onClick={onRetry}
          className="w-full py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          ↺ Tekrar Dene
        </button>
      )}
    </div>
  );
});

/* ── Small button ───────────────────────────────────────────────────────────── */

const SmallBtn = memo(function SmallBtn({
  label, color, bgColor, borderColor, phase, onClick, onRetry, children,
}: {
  label: string; color: string; bgColor: string; borderColor: string;
  phase: CmdPhase; onClick: () => void; onRetry?: () => void;
  children: React.ReactNode;
}) {
  const busy   = ['pending', 'accepted', 'executing'].includes(phase);
  const queued = phase === 'queued';
  const isErr  = phase === 'err';
  const { label: l } = phaseLabel(phase, label, '');

  return (
    <div className="flex-1 flex flex-col gap-1">
      <button
        onClick={onClick}
        disabled={busy || queued}
        className="flex flex-col items-center justify-center gap-2 w-full py-4 rounded-2xl transition-all duration-200 select-none active:scale-90 disabled:opacity-70 min-h-[72px]"
        style={{
          background:  isErr ? 'rgba(239,68,68,0.07)' : queued ? 'rgba(251,191,36,0.07)' : bgColor,
          border:      `1.5px solid ${isErr ? 'rgba(239,68,68,0.3)' : queued ? 'rgba(251,191,36,0.3)' : phase === 'ok' ? color : borderColor}`,
          boxShadow:   phase === 'ok' ? `0 0 18px ${color}40` : 'none',
        }}
      >
        <span style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}
          className={busy ? 'animate-pulse' : ''}>
          {busy ? <SpinIcon /> : queued ? <QueueIcon /> : children}
        </span>
        <span className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: isErr ? '#ef4444' : queued ? '#fbbf24' : color }}>{l}</span>
      </button>

      {isErr && onRetry && (
        <button onClick={onRetry}
          className="w-full py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all active:scale-95"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
          ↺ Tekrar
        </button>
      )}
    </div>
  );
});

/* ── Command Toast ──────────────────────────────────────────────────────────── */

function CommandToast({ result }: { result: CommandResult }) {
  if (result.queued) {
    return (
      <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(251,191,36,0.1), rgba(245,158,11,0.06))',
          border: '1px solid rgba(251,191,36,0.3)',
          animation: 'slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)' }}>
          <QueueIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-yellow-300 leading-tight truncate">Sıraya Alındı</p>
          <p className="text-[10px] mt-0.5 text-yellow-400/55">Araç çevrimiçi olduğunda otomatik çalışacak</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
      style={{
        background: result.ok
          ? 'linear-gradient(135deg, rgba(52,211,153,0.1), rgba(16,185,129,0.06))'
          : 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(220,38,38,0.06))',
        border: `1px solid ${result.ok ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
        animation: 'slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
      {result.ok ? (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8l3.5 3.5L13 5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      ) : (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.5"/>
            <path d="M6 6l4 4M10 6l-4 4" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight truncate"
          style={{ color: result.ok ? '#34d399' : '#f87171' }}>{result.label}</p>
        <p className="text-[10px] mt-0.5"
          style={{ color: result.ok ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.5)' }}>
          {result.ok ? 'Araçta onaylandı' : 'Araç yanıt vermedi'}
        </p>
      </div>
      {result.ok && result.durationMs > 0 && (
        <div className="flex-shrink-0 px-2 py-1 rounded-lg text-[9px] font-mono font-bold"
          style={{ background: 'rgba(52,211,153,0.12)', color: 'rgba(52,211,153,0.7)', border: '1px solid rgba(52,211,153,0.2)' }}>
          {result.durationMs < 1000 ? `${result.durationMs}ms` : `${(result.durationMs / 1000).toFixed(1)}s`}
        </div>
      )}
    </div>
  );
}

/* ── Provider pill ──────────────────────────────────────────────────────────── */

const PROVIDERS: { id: NavProvider; label: string; color: string }[] = [
  { id: 'google_maps', label: 'Google Maps', color: '#4285F4' },
  { id: 'waze',        label: 'Waze',        color: '#33CCFF' },
  { id: 'yandex',      label: 'Yandex',      color: '#FC3F1D' },
];

function ProviderRow({
  selected, onSelect,
}: {
  selected: NavProvider;
  onSelect: (p: NavProvider) => void;
}) {
  return (
    <div className="flex gap-2">
      {PROVIDERS.map(({ id, label, color }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className="flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
          style={{
            background:  selected === id ? `${color}18` : 'rgba(255,255,255,0.03)',
            border:      `1.5px solid ${selected === id ? `${color}60` : 'rgba(255,255,255,0.08)'}`,
            color:       selected === id ? color : 'rgba(255,255,255,0.3)',
            boxShadow:   selected === id ? `0 0 12px ${color}25` : 'none',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ── Nominatim geocoding ────────────────────────────────────────────────────── */

async function searchNominatim(query: string): Promise<GeoResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=0`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'tr,en' } });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    lat: string; lon: string; display_name: string;
  }>;
  return data.map((r) => ({
    lat:          parseFloat(r.lat),
    lng:          parseFloat(r.lon),
    display_name: r.display_name,
    short_name:   r.display_name.split(',').slice(0, 2).join(',').trim(),
  }));
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'tr,en' } });
    if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name?.split(',').slice(0, 3).join(',').trim()
      ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

/* ── Navigation Panel ───────────────────────────────────────────────────────── */

type NavStep = 'closed' | 'menu' | 'locating' | 'address' | 'confirm';

function NavPanel({
  onSendRoute,
  busy,
}: {
  onSendRoute: (loc: GeoResult, provider: NavProvider) => void;
  busy: boolean;
}) {
  const [step,     setStep]     = useState<NavStep>('closed');
  const [provider, setProvider] = useState<NavProvider>('google_maps');
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<GeoResult[]>([]);
  const [selected, setSelected] = useState<GeoResult | null>(null);
  const [locErr,   setLocErr]   = useState('');
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef    = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (step !== 'address' || query.trim().length < 3) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const found = await searchNominatim(query);
      setResults(found);
      setSearching(false);
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [query, step]);

  useEffect(() => {
    if (step === 'address') setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  const handleLocate = useCallback(async () => {
    setStep('locating');
    setLocErr('');
    if (!navigator.geolocation) {
      setLocErr('Tarayıcınız konum özelliğini desteklemiyor.');
      setStep('menu');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat  = pos.coords.latitude;
        const lng  = pos.coords.longitude;
        const name = await reverseGeocode(lat, lng);
        setSelected({ lat, lng, display_name: name, short_name: name.split(',').slice(0, 2).join(',').trim() });
        setStep('confirm');
      },
      (err) => {
        setLocErr(err.code === 1 ? 'Konum izni reddedildi.' : 'Konum alınamadı.');
        setStep('menu');
      },
      { timeout: 10_000, maximumAge: 30_000 },
    );
  }, []);

  const handleSelectResult = useCallback((r: GeoResult) => {
    setSelected(r);
    setQuery('');
    setResults([]);
    setStep('confirm');
  }, []);

  const handleSend = useCallback(() => {
    if (!selected) return;
    onSendRoute(selected, provider);
    setStep('closed');
    setSelected(null);
  }, [selected, provider, onSendRoute]);

  // ── Closed state — nav trigger button ──────────────────────────────────────
  if (step === 'closed') {
    return (
      <button
        onClick={() => setStep('menu')}
        className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98]"
        style={{
          background: 'rgba(59,130,246,0.06)',
          border: '1.5px solid rgba(59,130,246,0.18)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z"
                stroke="#3b82f6" strokeWidth="1.4"/>
              <circle cx="8" cy="6" r="1.8" stroke="#3b82f6" strokeWidth="1.4"/>
            </svg>
          </div>
          <div className="text-left">
            <p className="text-xs font-bold text-white/80 leading-tight">Navigasyon Gönder</p>
            <p className="text-[10px] text-white/30 mt-0.5">Konum veya adres araca ilet</p>
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 3l4 4-4 4" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    );
  }

  // ── Locating ────────────────────────────────────────────────────────────────
  if (step === 'locating') {
    return (
      <div className="flex items-center justify-center gap-3 py-5 rounded-2xl"
        style={{ background: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.18)' }}>
        <svg className="animate-spin w-5 h-5 text-blue-400" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
            strokeDasharray="32" strokeDashoffset="10" opacity="0.4"/>
          <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="text-sm text-blue-300/80 font-medium">GPS konumu alınıyor…</span>
      </div>
    );
  }

  // ── Menu — choose mode ──────────────────────────────────────────────────────
  if (step === 'menu') {
    return (
      <div className="flex flex-col gap-2 p-3 rounded-2xl"
        style={{ background: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.18)' }}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400/70">Navigasyon</p>
          <button onClick={() => setStep('closed')}
            className="w-6 h-6 flex items-center justify-center rounded-lg"
            style={{ background: 'rgba(255,255,255,0.05)' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {locErr && (
          <p className="text-[10px] text-red-400/80 bg-red-500/10 rounded-lg px-3 py-2">{locErr}</p>
        )}

        {/* Konumumu Gönder */}
        <button
          onClick={() => void handleLocate()}
          className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-left transition-all active:scale-[0.98]"
          style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)' }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.2)' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="3" stroke="#34d399" strokeWidth="1.5"/>
              <path d="M9 1v3M9 14v3M1 9h3M14 9h3" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-emerald-300 leading-tight">Konumumu Gönder</p>
            <p className="text-[10px] text-emerald-400/50 mt-0.5">Telefon GPS konumunu araca ilet</p>
          </div>
        </button>

        {/* Adres Ara */}
        <button
          onClick={() => setStep('address')}
          className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-left transition-all active:scale-[0.98]"
          style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)' }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="8" cy="8" r="5" stroke="#3b82f6" strokeWidth="1.5"/>
              <path d="M12 12l3.5 3.5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-blue-300 leading-tight">Adres Ara</p>
            <p className="text-[10px] text-blue-400/50 mt-0.5">İsim veya adres yazarak seç</p>
          </div>
        </button>
      </div>
    );
  }

  // ── Address search ──────────────────────────────────────────────────────────
  if (step === 'address') {
    return (
      <div className="flex flex-col gap-2 p-3 rounded-2xl"
        style={{ background: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.18)' }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setStep('menu')}
            className="w-7 h-7 flex items-center justify-center rounded-xl flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 2L4 6l4 4" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              placeholder="Adres, şehir veya yer adı girin…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-3 py-2.5 pr-8 rounded-xl text-sm text-white placeholder-white/20 outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            {searching && (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <svg className="animate-spin w-3.5 h-3.5 text-blue-400" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"
                    strokeDasharray="22" strokeDashoffset="7" opacity="0.4"/>
                  <path d="M7 2a5 5 0 015 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            )}
          </div>
        </div>

        {results.length > 0 && (
          <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => handleSelectResult(r)}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all active:scale-[0.98]"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-0.5 flex-shrink-0">
                  <path d="M7 1C4.79 1 3 2.79 3 5c0 2.94 4 8 4 8s4-5.06 4-8c0-2.21-1.79-4-4-4z"
                    stroke="#3b82f6" strokeWidth="1.2"/>
                  <circle cx="7" cy="5" r="1.2" stroke="#3b82f6" strokeWidth="1.2"/>
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white/80 leading-tight truncate">{r.short_name}</p>
                  <p className="text-[9px] text-white/30 mt-0.5 truncate">{r.display_name}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {query.trim().length >= 3 && !searching && results.length === 0 && (
          <p className="text-center text-[11px] text-white/25 py-3">Sonuç bulunamadı</p>
        )}
      </div>
    );
  }

  // ── Confirm & send ──────────────────────────────────────────────────────────
  if (step === 'confirm' && selected) {
    return (
      <div className="flex flex-col gap-3 p-3 rounded-2xl"
        style={{ background: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.18)' }}>
        <div className="flex items-start gap-2.5">
          <button onClick={() => setStep('menu')}
            className="w-7 h-7 flex items-center justify-center rounded-xl flex-shrink-0 mt-0.5"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 2L4 6l4 4" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-blue-400/60 mb-1">Hedef Konum</p>
            <p className="text-sm font-semibold text-white/90 leading-snug line-clamp-2">{selected.short_name}</p>
            <p className="text-[9px] text-white/30 mt-0.5 font-mono">
              {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
            </p>
          </div>
        </div>

        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-white/30 mb-1.5 px-1">Navigasyon Uygulaması</p>
          <ProviderRow selected={provider} onSelect={setProvider} />
        </div>

        <button
          onClick={handleSend}
          disabled={busy}
          className="w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-widest text-white transition-all active:scale-[0.97] disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
            boxShadow:  '0 6px 20px rgba(59,130,246,0.3)',
          }}
        >
          {busy ? 'Gönderiliyor…' : 'Araca Gönder →'}
        </button>
      </div>
    );
  }

  return null;
}

/* ── Speed Alert Panel ──────────────────────────────────────────────────────── */

const SPEED_PRESETS = [80, 100, 120, 140] as const;
type SpeedPreset = typeof SPEED_PRESETS[number];

const ALERT_KEY = 'caros_speed_alert';

interface SpeedAlertConfig { enabled: boolean; threshold: SpeedPreset }

function loadAlert(): SpeedAlertConfig {
  try {
    const raw = localStorage.getItem(ALERT_KEY);
    return raw ? (JSON.parse(raw) as SpeedAlertConfig) : { enabled: false, threshold: 120 };
  } catch { return { enabled: false, threshold: 120 }; }
}

function SpeedAlertPanel({ vehicleId }: { vehicleId: string | null }) {
  const [cfg,      setCfg]      = useState<SpeedAlertConfig>(loadAlert);
  const [open,     setOpen]     = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  const handleSave = useCallback(async (next: SpeedAlertConfig) => {
    if (!vehicleId) return;
    setSaving(true);
    try {
      localStorage.setItem(ALERT_KEY, JSON.stringify(next));
      const { sendCommand } = await import('@/lib/commandService');
      await sendCommand(vehicleId, 'set_speed_alert', {
        speed_alert: { enabled: next.enabled, threshold_kmh: next.threshold },
      });
    } catch { /* non-critical */ }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2_000);
  }, [vehicleId]);

  const update = useCallback((patch: Partial<SpeedAlertConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    void handleSave(next);
  }, [cfg, handleSave]);

  return (
    <div className="flex flex-col gap-0">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all active:scale-[0.98]"
        style={{
          background: cfg.enabled ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
          border:     `1.5px solid ${cfg.enabled ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)'}`,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: cfg.enabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)',
              border:     `1px solid ${cfg.enabled ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)'}`,
            }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1L12 11H1L6.5 1Z" stroke={cfg.enabled ? '#ef4444' : 'rgba(255,255,255,0.3)'} strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M6.5 5v2.5M6.5 9v.5" stroke={cfg.enabled ? '#ef4444' : 'rgba(255,255,255,0.3)'} strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="text-left">
            <p className="text-xs font-bold leading-tight" style={{ color: cfg.enabled ? '#f87171' : 'rgba(255,255,255,0.6)' }}>
              Hız Uyarısı
            </p>
            <p className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {cfg.enabled ? `${cfg.threshold} km/h üzerinde uyar` : 'Devre dışı'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-[9px] font-black text-emerald-400">Kaydedildi ✓</span>
          )}
          {saving && (
            <svg className="animate-spin w-3 h-3 text-white/30" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"
                strokeDasharray="18" strokeDashoffset="6" opacity="0.4"/>
              <path d="M6 1.5a4.5 4.5 0 014.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          )}
          {/* On/Off toggle */}
          <div
            onClick={(e) => { e.stopPropagation(); update({ enabled: !cfg.enabled }); }}
            className="w-9 h-5 rounded-full relative cursor-pointer transition-all"
            style={{ background: cfg.enabled ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)' }}
          >
            <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
              style={{
                background: cfg.enabled ? '#ef4444' : 'rgba(255,255,255,0.3)',
                left:       cfg.enabled ? '18px' : '2px',
                boxShadow:  cfg.enabled ? '0 0 6px rgba(239,68,68,0.6)' : 'none',
              }} />
          </div>
          <svg
            className="transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            width="12" height="12" viewBox="0 0 12 12" fill="none"
          >
            <path d="M3 4.5l3 3 3-3" stroke="rgba(255,255,255,0.3)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {/* Expanded threshold selector */}
      {open && (
        <div className="mt-1.5 flex gap-2 px-1">
          {SPEED_PRESETS.map((spd) => (
            <button
              key={spd}
              onClick={() => update({ threshold: spd, enabled: true })}
              className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95"
              style={{
                background:  cfg.threshold === spd ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.03)',
                border:      `1.5px solid ${cfg.threshold === spd ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.07)'}`,
                color:       cfg.threshold === spd ? '#f87171' : 'rgba(255,255,255,0.3)',
                boxShadow:   cfg.threshold === spd ? '0 0 10px rgba(239,68,68,0.2)' : 'none',
              }}
            >
              {spd}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */

export default function MobileCarControl({ vehicle }: Props) {
  const { phases, result, dispatch, retry } = useCommandTracker(vehicle?.id ?? null);

  const handleSendRoute = useCallback(
    (loc: GeoResult, provider: NavProvider) => {
      void dispatch('route_send', {
        route: {
          lat:             loc.lat,
          lng:             loc.lng,
          address_name:    loc.short_name,
          provider_intent: provider,
        },
      });
    },
    [dispatch],
  );

  const navBusy = ['pending', 'accepted', 'executing'].includes(phases.route_send ?? 'idle');

  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M4 18L8 10Q9.5 7 12 7H16Q18.5 7 20 10L24 18V22Q24 24 22 24H6Q4 24 4 22Z"
              stroke="rgba(255,255,255,0.2)" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-sm text-white/30">Araç seçilmedi</p>
      </div>
    );
  }

  const isOnline = vehicle.status !== 'offline';

  return (
    <div className="flex flex-col gap-4 px-1">

      {/* Vehicle identity */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          vehicle.status === 'online' ? 'bg-emerald-400 neon-online' :
          vehicle.status === 'alarm'  ? 'bg-red-400 neon-alarm animate-pulse' : 'bg-white/20'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="font-mono font-bold text-white text-sm">{vehicle.plate}</p>
          <p className="text-[10px] text-white/35 truncate">{vehicle.name} · {vehicle.driver}</p>
        </div>
        <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
          style={{
            color:      isOnline ? '#34d399' : '#ffffff40',
            background: isOnline ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
            border:     `1px solid ${isOnline ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}>
          {vehicle.status === 'online' ? 'Online' : vehicle.status === 'alarm' ? 'Alarm' : 'Offline'}
        </span>
      </div>

      {/* Offline banner */}
      {!isOnline && <OfflineBanner plate={vehicle.plate} />}

      {/* Lock / Unlock */}
      <div className="grid grid-cols-2 gap-4">
        <BigBtn
          label="Kilitle" sublabel="Kapat"
          color="#ef4444" bgColor="rgba(239,68,68,0.07)" borderColor="rgba(239,68,68,0.25)"
          phase={phases.lock ?? 'idle'}
          onClick={() => void dispatch('lock')}
          onRetry={() => void retry('lock')}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="18" cy="25" r="2.5" fill="currentColor"/>
          </svg>
        </BigBtn>

        <BigBtn
          label="Aç" sublabel="Kilidi Kaldır"
          color="#34d399" bgColor="rgba(52,211,153,0.07)" borderColor="rgba(52,211,153,0.25)"
          phase={phases.unlock ?? 'idle'}
          onClick={() => void dispatch('unlock')}
          onRetry={() => void retry('unlock')}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 2"/>
          </svg>
        </BigBtn>
      </div>

      {/* Horn + Alarm + Lights */}
      <div className="flex gap-3">
        <SmallBtn
          label="Korna" color="#fbbf24"
          bgColor="rgba(251,191,36,0.07)" borderColor="rgba(251,191,36,0.22)"
          phase={phases.horn ?? 'idle'}
          onClick={() => void dispatch('horn')}
          onRetry={() => void retry('horn')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 9H4a1 1 0 000 2h2m0-2v2m0-2l6-4.5v12L6 13"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 7.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M17.5 5a9.5 9.5 0 010 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
          </svg>
        </SmallBtn>

        <SmallBtn
          label="Alarm" color="#a78bfa"
          bgColor="rgba(167,139,250,0.07)" borderColor="rgba(167,139,250,0.22)"
          phase={phases.alarm_on ?? 'idle'}
          onClick={() => void dispatch('alarm_on')}
          onRetry={() => void retry('alarm_on')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L21 19H3L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M12 10v4M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </SmallBtn>

        <SmallBtn
          label="Farlar" color="#fde68a"
          bgColor="rgba(253,230,138,0.07)" borderColor="rgba(253,230,138,0.22)"
          phase={phases.lights_on ?? 'idle'}
          onClick={() => void dispatch('lights_on')}
          onRetry={() => void retry('lights_on')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="12" rx="4" ry="4" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
          </svg>
        </SmallBtn>
      </div>

      {/* Navigation panel */}
      <NavPanel onSendRoute={handleSendRoute} busy={navBusy} />

      {/* Speed alert panel */}
      <SpeedAlertPanel vehicleId={vehicle.id} />

      {/* Command toast */}
      {result && <CommandToast result={result} />}

      {/* Telemetry strip */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Hız',   value: Math.round(vehicle.speed),      unit: 'km/h', color: vehicle.speed > 90 ? '#ef4444' : vehicle.speed > 60 ? '#fbbf24' : '#34d399' },
          { label: 'Yakıt', value: Math.round(vehicle.fuel),       unit: '%',    color: vehicle.fuel < 15 ? '#ef4444' : vehicle.fuel < 30 ? '#fbbf24' : '#60a5fa' },
          { label: 'Motor', value: Math.round(vehicle.engineTemp), unit: '°C',   color: vehicle.engineTemp > 100 ? '#ef4444' : vehicle.engineTemp > 85 ? '#fbbf24' : '#34d399' },
        ].map(({ label, value, unit, color }) => (
          <div key={label} className="flex flex-col items-center py-3 rounded-xl"
            style={{ background: `${color}09`, border: `1px solid ${color}20` }}>
            <span className="text-[8px] font-black uppercase tracking-widest text-white/30 mb-1">{label}</span>
            <span className="text-lg font-black tabular-nums leading-none" style={{ color }}>{value}</span>
            <span className="text-[9px] font-mono mt-0.5" style={{ color: `${color}60` }}>{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
