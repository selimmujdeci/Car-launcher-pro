/**
 * NavigationHUD — Mercedes MBUX Futurist Design Language
 *
 * Bileşenler:
 *   TurnPanel        — üst sol: futurist-glass + SVG ok + mesafe + sokak
 *   RoadSignsPanel   — üst orta: yol tabelası (futurist-gradient-blue)
 *   LaneGuidance     — alt orta: manevra tipine göre dinamik şerit rehberi
 *   SpeedPanel       — sağ: futurist-glass, limit aşımında glow-red + pulse
 *   NavInfoBar       — alt: futurist-gradient-dark, glowing progress bar
 *   PreviewCard      — rota önizlemesi
 *   QuickDestinations — hızlı hedef kartları
 */
import '../../styles/ultra-premium-global.css';
import {
  memo, useState, useCallback, useEffect, useRef, type ReactNode,
} from 'react';
import {
  MapPin, Home, Briefcase, Fuel, ChevronDown,
  Play, X, Loader2, AlertCircle, CheckCircle2, GitBranch,
} from 'lucide-react';
import {
  useNavigation,
  startNavigation,
  stopNavigation,
  formatDistance,
  formatEta,
  NavStatus,
} from '../../platform/navigationService';
import {
  useRouteState,
  clearRoute,
  selectAltRoute,
  computeFuelEstimate,
} from '../../platform/routingService';
import type { RouteStep } from '../../platform/routingService';
import { useStore } from '../../store/useStore';
import { useGPSLocation } from '../../platform/gpsService';
import { speakNavigation } from '../../platform/ttsService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { Address } from '../../platform/addressBookService';
import { useSpeedLimitByLocation } from '../../platform/speedLimitService';

/* ── Türkçe talimat ────────────────────────────────────────── */

function toTurkish(mod: string, type: string): string {
  if (type === 'arrive')                           return 'Hedefe vardınız';
  if (type === 'depart')                           return 'Yola çıkın';
  if (type === 'roundabout' || type === 'rotary')  return 'Dönel kavşağa girin';
  if (mod === 'uturn')                             return 'U dönüşü yapın';
  if (mod === 'sharp right')                       return 'Sert sağa dönün';
  if (mod === 'sharp left')                        return 'Sert sola dönün';
  if (mod.includes('right'))                       return 'Sağa dönün';
  if (mod.includes('left'))                        return 'Sola dönün';
  return 'Düz devam edin';
}

/* ── Mercedes MBUX Futurist SVG Okları ───────────────────── */

function FuturistArrow({ mod, type, size = 'lg' }: {
  mod: string; type: string; size?: 'lg' | 'md' | 'sm' | 'xs';
}) {
  const dim = size === 'lg' ? 48 : size === 'md' ? 34 : size === 'sm' ? 22 : 16;
  const sw  = size === 'lg' ? 3.5 : size === 'md' ? 3.0 : 2.5;
  const swB = sw + 0.6; // arrowhead stroke

  const base = {
    width: dim, height: dim,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (type === 'arrive') return (
    <svg {...base}>
      <circle cx="12" cy="12" r="7" strokeWidth={sw} />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" strokeWidth={0} />
    </svg>
  );

  if (type === 'depart') return (
    <svg {...base} fill="currentColor" stroke="none">
      <path d="M12 2.5L21 19.5H3L12 2.5Z" />
    </svg>
  );

  if (type === 'roundabout' || type === 'rotary') return (
    <svg {...base}>
      <path d="M12 5.5A6.5 6.5 0 1 1 5.5 12" strokeWidth={sw} />
      <path d="M5.5 8.5V5.5h3" strokeWidth={swB} />
    </svg>
  );

  if (mod === 'uturn') return (
    <svg {...base}>
      <path d="M7 20l-3-4 3-4" strokeWidth={swB} />
      <path d="M4 16h9a4.5 4.5 0 0 0 0-9h-1" strokeWidth={sw} />
    </svg>
  );

  if (mod.includes('right')) return (
    <svg {...base}>
      <path d="M5 20V13a6 6 0 0 1 6-6h8" strokeWidth={sw} />
      <path d="M14.5 3.5l5 4-5 4" strokeWidth={swB} />
    </svg>
  );

  if (mod.includes('left')) return (
    <svg {...base}>
      <path d="M19 20V13a6 6 0 0 0-6-6H5" strokeWidth={sw} />
      <path d="M9.5 3.5L4.5 7.5l5 4" strokeWidth={swB} />
    </svg>
  );

  // straight
  return (
    <svg {...base}>
      <path d="M12 21V5" strokeWidth={sw} />
      <path d="M6 10.5L12 4.5 18 10.5" strokeWidth={swB} />
    </svg>
  );
}

/* ── Dönüş mesafe formatlayıcı ──────────────────────────── */

function fmtTurn(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m <  20)   return 'ŞİMDİ';
  if (m < 100)   return `${Math.round(m / 10) * 10} m`;
  if (m < 1000)  return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}


/* ══════════════════════════════════════════════════════════ */
/* ── TurnPanel — Mercedes MBUX Futurist ─────────────────── */
/* ══════════════════════════════════════════════════════════ */

const TurnPanel = memo(function TurnPanel({
  step, distToTurn, nextStep,
}: {
  step: RouteStep; distToTurn: number; nextStep?: RouteStep;
}) {
  const isArrive = step.maneuverType === 'arrive';

  return (
    <div
      className="absolute left-4 z-30 pointer-events-none flex flex-col gap-2"
      style={{ top: 'calc(var(--sat) + 16px)', maxWidth: 320 }}
    >
      {/* Ana dönüş kartı — Mercedes MBUX Style */}
      <div className="futurist-glass futurist-glow-blue flex items-stretch rounded-[2rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-white/20">
        {/* Ok alanı — daha geniş ve ikonik */}
        <div
          className="flex items-center justify-center px-6 flex-shrink-0"
          style={{
            background: isArrive
              ? 'linear-gradient(160deg,#10b981,#059669)'
              : 'linear-gradient(160deg,#2563eb,#1e40af)',
            minWidth: 85,
          }}
        >
          <FuturistArrow mod={step.maneuverModifier} type={step.maneuverType} size="md" />
        </div>

        {/* Metin alanı — zengin tipografi */}
        <div className="px-5 py-4 flex flex-col justify-center min-w-0">
          <div className="futurist-text-glow text-white font-black leading-none mb-1 tabular-nums text-[32px] tracking-tight">
            {isArrive ? '—' : fmtTurn(distToTurn)}
          </div>
          <div className="text-white font-extrabold text-[12px] leading-tight truncate uppercase tracking-[0.15em] opacity-90">
            {toTurkish(step.maneuverModifier, step.maneuverType)}
          </div>
          {step.streetName && (
            <div className="text-blue-300/90 font-bold text-[11px] truncate mt-1 uppercase tracking-wider">
              {step.streetName}
            </div>
          )}
        </div>
      </div>

      {/* Sonraki adım — Floating Mini Card */}
      {nextStep && !isArrive && (
        <div className="futurist-glass flex items-center gap-3 px-4 py-2.5 rounded-2xl border-white/10 ml-2 scale-95 origin-left">
          <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 border border-white/5">
            <FuturistArrow mod={nextStep.maneuverModifier} type={nextStep.maneuverType} size="xs" />
          </div>
          <div className="min-w-0">
            <div className="text-white font-black text-[10px] truncate leading-none uppercase tracking-widest opacity-60">
              SONRAKİ
            </div>
            <div className="text-white font-bold text-xs truncate mt-1 uppercase tracking-wide">
              {nextStep.streetName || toTurkish(nextStep.maneuverModifier, nextStep.maneuverType)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});


/* ══════════════════════════════════════════════════════════ */
/* ── RoadSignsPanel — üst orta yol tabelası ─────────────── */
/* ══════════════════════════════════════════════════════════ */

const RoadSignsPanel = memo(function RoadSignsPanel({
  streetName, destName,
}: { streetName?: string; destName?: string; }) {
  const label = streetName || destName;
  if (!label) return null;

  return (
    <div
      className="absolute z-30 pointer-events-none"
      style={{ top: 'calc(var(--sat, 0px) + 14px)', left: '50%', transform: 'translateX(-50%)' }}
    >
      <div
        className="flex flex-col items-center rounded-[14px] overflow-hidden"
        style={{
          background: 'linear-gradient(155deg,#1e3a8a,#1e40af)',
          minWidth: 140,
          padding: '8px 20px 6px',
          boxShadow: '0 6px 24px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.18), inset 0 1px 0 rgba(255,255,255,0.15)',
        }}
      >
        <span
          className="text-white font-black uppercase tracking-widest leading-tight text-center truncate"
          style={{ fontSize: 13, maxWidth: 180 }}
        >
          {label}
        </span>
        <ChevronDown className="w-4 h-4 text-white mt-1" style={{ opacity: 0.85 }} />
      </div>
    </div>
  );
});


/* ══════════════════════════════════════════════════════════ */
/* ── LaneGuidance — dinamik şerit rehberi ────────────────── */
/* ══════════════════════════════════════════════════════════ */

function getLaneActive(mod: string): [boolean, boolean, boolean] {
  if (mod.includes('left'))  return [true,  false, false];
  if (mod.includes('right')) return [false, false, true];
  return [false, true, false]; // straight / default
}

const LANE_ARROWS = ['←', '↑', '→'] as const;

const LaneGuidance = memo(function LaneGuidance({
  maneuverModifier, distToTurn,
}: { maneuverModifier: string; distToTurn: number; }) {
  // 400 m'ye yaklaşınca göster
  if (!Number.isFinite(distToTurn) || distToTurn > 400 || distToTurn <= 0) return null;

  const active = getLaneActive(maneuverModifier);

  return (
    <div
      className="absolute inset-x-0 z-30 pointer-events-none flex justify-center"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 115px)' }}
    >
      <div className="futurist-glass rounded-[2rem] px-8 py-4 flex items-end gap-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)] border-white/20">
        {active.map((on, i) => (
          <div
            key={i}
            className={`flex flex-col items-center gap-2 transition-all duration-500 ${on ? 'scale-110 opacity-100' : 'opacity-20 blur-[1px]'}`}
          >
            <div
              className="w-7 rounded-t-md transition-all duration-500"
              style={{
                height: 52,
                background: on ? 'linear-gradient(to top, #2563eb, #60a5fa)' : 'rgba(255,255,255,0.1)',
                boxShadow: on ? '0 0 25px rgba(96,165,250,0.8)' : 'none',
              }}
            />
            <span className={`text-lg font-black leading-none ${on ? 'text-blue-400 futurist-text-glow' : 'text-white/20'}`}>
              {LANE_ARROWS[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});


/* ══════════════════════════════════════════════════════════ */
/* ── SpeedPanel — futurist-glass, dynamic glow ───────────── */
/* ══════════════════════════════════════════════════════════ */

const SpeedPanel = memo(function SpeedPanel({
  speedKmh, speedLimitKmh = 50,
}: {
  speedKmh: number; speedLimitKmh?: number;
}) {
  const overSpeed    = speedKmh > speedLimitKmh + 5;
  const roundedSpeed = Math.round(speedKmh);

  return (
    <div
      className="absolute right-4 z-30 pointer-events-none flex flex-col items-center gap-3"
      style={{ top: 'calc(var(--sat, 0px) + 85px)' }}
    >
      {/* Hız göstergesi — futurist-glass + dinamik glow */}
      <div
        className={`futurist-glass flex flex-col items-center px-5 py-3 rounded-[1.5rem] ${
          overSpeed ? 'futurist-glow-red animate-futurist-pulse' : 'futurist-glow-blue'
        }`}
        style={{ minWidth: 90 }}
      >
        <span
          className="font-black tabular-nums leading-none futurist-text-glow"
          style={{
            fontSize: 48,
            color: overSpeed ? '#f87171' : '#ffffff',
            letterSpacing: '-0.05em',
          }}
        >
          {roundedSpeed}
        </span>
        <span className="text-slate-400 font-black uppercase tracking-[0.2em] text-[10px] mt-1 opacity-60">
          KM/H
        </span>
      </div>

      {/* Hız limiti tabelası */}
      <div className="w-16 h-16 rounded-full flex items-center justify-center bg-white border-[6px] border-red-600 shadow-[0_8px_32px_rgba(0,0,0,0.6)] border-glow-red">
        <span className="text-black font-black text-[22px] tracking-[-0.02em]">
          {speedLimitKmh}
        </span>
      </div>
    </div>
  );
});


/* ══════════════════════════════════════════════════════════ */
/* ── NavInfoBar — futurist-gradient-dark, glowing progress ─ */
/* ══════════════════════════════════════════════════════════ */

const NavInfoBar = memo(function NavInfoBar({
  etaSeconds, remainingMeters, totalMeters, onStop, isOffline,
}: {
  etaSeconds: number; remainingMeters: number; totalMeters: number; onStop: () => void; isOffline?: boolean;
}) {
  const arrival    = new Date(Date.now() + etaSeconds * 1_000);
  const arrivalStr = `${arrival.getHours().toString().padStart(2, '0')}:${arrival.getMinutes().toString().padStart(2, '0')}`;
  const progress   = totalMeters > 0 ? Math.max(0, Math.min(1, 1 - remainingMeters / totalMeters)) : 0;
  const fuelPct    = useUnifiedVehicleStore(s => s.fuel);

  const fuelColor = fuelPct == null ? null
    : fuelPct > 25 ? '#22c55e'
    : fuelPct > 10 ? '#f59e0b'
    : '#ef4444';

  return (
    <div
      className="absolute inset-x-4 z-30 pointer-events-auto rounded-[2rem] overflow-hidden futurist-glass border border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.4)]"
      style={{ bottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Glowing progress bar */}
      <div className="h-[4px] bg-white/[0.04] relative overflow-hidden">
        <div
          className="h-full transition-all duration-1000 relative z-10"
          style={{
            width: `${progress * 100}%`,
            background: 'linear-gradient(90deg,#2563eb,#60a5fa)',
            boxShadow: '0 0 15px rgba(59,130,246,0.6)',
          }}
        />
        {/* Progress bar background glow */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent)' }}
        />
      </div>

      {/* Offline rozeti */}
      {isOffline && (
        <div className="flex justify-center pt-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 backdrop-blur-md border border-amber-400/30">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            <span className="text-[9px] text-amber-400 font-black uppercase tracking-[0.1em]">Çevrimdışı Mod</span>
          </div>
        </div>
      )}

      {/* İçerik satırı */}
      <div className="flex items-center gap-4 px-6 py-4">
        {/* Süre | Mesafe | Varış */}
        <div className="flex-1 flex items-center justify-around">
          <NavStat label="SÜRE"   value={formatEta(etaSeconds)} />
          <div className="w-px h-8 bg-white/10" />
          <NavStat label="MESAFE" value={formatDistance(remainingMeters)} />
          <div className="w-px h-8 bg-white/10" />
          <NavStat label="VARIŞ"  value={arrivalStr} accent />
          
          {fuelPct != null && (
            <>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex items-center gap-3">
                <div
                  className="relative flex flex-col-reverse rounded-full overflow-hidden"
                  style={{ width: 8, height: 32, background: 'rgba(255,255,255,0.05)', border: `1px solid ${fuelColor ?? '#22c55e'}22` }}
                >
                  <div style={{ height: `${fuelPct}%`, background: fuelColor ?? '#22c55e', boxShadow: `0 0 10px ${fuelColor ?? '#22c55e'}66`, transition: 'height 1.2s ease' }} />
                </div>
                <div className="flex flex-col">
                   <span className="font-black tabular-nums text-sm leading-none" style={{ color: fuelColor ?? '#22c55e' }}>
                    {Math.round(fuelPct)}%
                  </span>
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1">YAKIT</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="w-px h-10 bg-white/10 mx-2" />

        {/* Navigasyonu sonlandır */}
        <button
          onClick={onStop}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl flex-shrink-0 active:scale-90 transition-all bg-red-500/10 border border-red-500/20 hover:bg-red-500/20"
        >
          <X className="w-4 h-4 text-red-400" />
          <span className="text-red-400 font-black text-[10px] uppercase tracking-widest leading-none">
            SONLANDIR
          </span>
        </button>
      </div>
    </div>
  );
});

function NavStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`font-black tabular-nums text-[17px] tracking-[-0.02em] leading-none ${accent ? 'text-blue-400' : 'text-white'}`}>
        {value}
      </span>
      <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider mt-0.5">
        {label}
      </span>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════ */
/* ── ReroutingBanner ─────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

function ReroutingBanner() {
  useEffect(() => {
    speakNavigation('Rota yeniden hesaplanıyor');
  }, []);
  return (
    <div
      className="absolute left-4 z-30 pointer-events-none"
      style={{ top: 'calc(var(--sat, 0px) + 14px)' }}
    >
      <div className="futurist-glass futurist-glow-blue flex items-center gap-4 px-5 py-4 rounded-[1.75rem]">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(160deg,#3b82f6,#1d4ed8)' }}
        >
          <Loader2 className="w-8 h-8 text-white animate-spin" />
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-white font-black text-[22px] leading-tight tracking-[-0.02em] uppercase tracking-widest">
            Yeniden Rotalanıyor…
          </span>
          <span className="text-blue-400 font-bold text-sm mt-0.5">Yeni rota hesaplanıyor</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── ArrivalOverlay ──────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

function ArrivalOverlay({ destName }: { destName: string }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div
        className="flex flex-col items-center gap-5 px-10 py-8 rounded-[2.5rem] shadow-[0_40px_80px_rgba(0,0,0,0.85)] bg-[rgba(8,12,22,0.96)] backdrop-blur-[28px] border border-emerald-500/20 animate-in zoom-in-95 fade-in duration-500"
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(16,185,129,0.12)', border: '1.5px solid rgba(16,185,129,0.3)', boxShadow: '0 0 40px rgba(16,185,129,0.2)' }}
        >
          <CheckCircle2 className="w-11 h-11 text-emerald-400" />
        </div>
        <div className="text-center">
          <div className="text-white font-black text-[28px] tracking-[-0.02em] leading-tight uppercase tracking-widest">
            Hedefe Vardınız
          </div>
          <div className="text-emerald-400 font-bold text-base mt-2 max-w-[260px] truncate">
            {destName}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── ErrorOverlay ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

function ErrorOverlay({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      className="absolute left-4 z-30 pointer-events-auto"
      style={{ top: 'calc(var(--sat, 0px) + 14px)' }}
    >
      <div className="futurist-glass flex items-center gap-4 px-5 py-4 rounded-[1.75rem] max-w-sm"
        style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(160deg,rgba(239,68,68,0.25),rgba(185,28,28,0.18))' }}
        >
          <AlertCircle className="w-7 h-7 text-red-400" />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-white font-black text-base leading-tight uppercase tracking-widest">Navigasyon Hatası</span>
          <span className="text-red-300 text-sm mt-0.5 line-clamp-2">{message}</span>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all flex-shrink-0 bg-red-500/[0.15] border border-red-500/25"
        >
          <X className="w-5 h-5 text-red-400" />
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── PreviewCard ─────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const PreviewCard = memo(function PreviewCard({
  destName, distMeters, durSeconds, loading, error, onStart, onCancel, routeReady, gpsValid,
}: {
  destName: string; distMeters: number; durSeconds: number;
  loading: boolean; error: string | null;
  onStart: () => void; onCancel: () => void;
  routeReady: boolean; gpsValid: boolean;
}) {
  const { altDistances, altDurations, altRealIndices, altHasToll, hasToll, totalDurationSeconds: mainDurS } = useRouteState();
  const hasAlts = altDistances.length > 0;

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const altsRef  = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToastMsg(null), 2500);
  }, []);

  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);

  const chipLabels = ['En Hızlı', 'Alternatif 1', 'Alternatif 2'];

  return (
    <div
      className="absolute inset-x-4 z-30 pointer-events-auto animate-in zoom-in-95 fade-in duration-500"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 20px)' }}
    >
      {toastMsg && (
        <div className="mb-3 mx-auto w-fit px-4 py-2 rounded-2xl bg-[rgba(20,28,48,0.97)] border border-white/10 shadow-lg backdrop-blur-[20px] animate-in fade-in zoom-in-95 duration-200">
          <span className="text-white font-bold text-sm">{toastMsg}</span>
        </div>
      )}

      <div className="rounded-[2.5rem] p-6 overflow-hidden relative shadow-[0_40px_80px_rgba(0,0,0,0.7)] bg-[rgba(8,12,22,0.95)] backdrop-blur-[28px] border border-white/10">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500 rounded-t-[2.5rem]" />

        <div className="flex items-start gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-blue-500/10 border border-blue-500/25">
            <MapPin className="w-7 h-7 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="text-white font-black text-2xl truncate leading-tight tracking-tight">{destName}</div>
            {loading && (
              <div className="flex items-center gap-2 text-blue-400/60 text-sm mt-2 font-bold uppercase tracking-widest">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Rota planlanıyor…</span>
              </div>
            )}
            {!loading && !error && distMeters > 0 && (
              <div className="text-slate-400 text-sm mt-2 font-bold uppercase tracking-widest flex items-center gap-3">
                <span className="text-white">{formatDistance(distMeters)}</span>
                <span className="w-1 h-1 rounded-full bg-slate-700" />
                <span className="text-blue-400">{formatEta(durSeconds)}</span>
              </div>
            )}
            {!loading && error && (
              <div className="flex items-center gap-2 text-amber-500 text-sm mt-2 font-black uppercase tracking-widest">
                <AlertCircle className="w-4 h-4" />
                <span>Çevrimdışı Mod</span>
              </div>
            )}
          </div>
          <button
            onClick={onCancel}
            aria-label="Navigasyonu iptal et"
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-white/[0.06] border border-white/10 mt-0.5"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {!loading && (
          <div className="mb-4">
            {hasToll ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-black uppercase tracking-widest">
                <AlertCircle className="w-3.5 h-3.5" />
                Olası ücretli geçiş (OGS/HGS)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-500/10 border border-slate-500/20 text-slate-500 text-xs font-black uppercase tracking-widest">
                <AlertCircle className="w-3.5 h-3.5" />
                Ücret bilgisi yok (OSRM)
              </span>
            )}
          </div>
        )}

        {hasAlts && !loading && (
          <div ref={altsRef} className="mb-4">
            <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-2">Rota Seçenekleri</div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {/* Ana rota kartı */}
              <div className="flex-shrink-0 flex flex-col gap-0.5 px-3 py-2.5 rounded-2xl border min-w-[110px] bg-blue-600 border-blue-500 shadow-[0_4px_16px_rgba(37,99,235,0.5)]">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-100/80">{chipLabels[0]}</span>
                  {hasToll && <AlertCircle className="w-3 h-3 text-amber-300 flex-shrink-0" />}
                </div>
                <span className="text-sm font-black text-white leading-tight">{formatDistance(distMeters)}</span>
                <span className="text-[11px] font-bold text-blue-200">{formatEta(durSeconds)}</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <Fuel className="w-3 h-3 text-blue-300 flex-shrink-0" />
                  <span className="text-[10px] font-bold text-blue-200">{computeFuelEstimate(distMeters)} L</span>
                </div>
              </div>
              {/* Alternatif rota kartları */}
              {altDistances.map((dist, j) => {
                const altDur   = altDurations[j] ?? 0;
                const diffSec  = altDur - (mainDurS || durSeconds);
                const diffMins = Math.round(Math.abs(diffSec) / 60);
                const diffLabel = diffMins === 0 ? null : diffSec > 0 ? `+${diffMins} dk` : `-${diffMins} dk`;
                const toll     = altHasToll[j] ?? false;
                return (
                  <button
                    key={altRealIndices[j] ?? j}
                    onClick={() => selectAltRoute(altRealIndices[j] ?? (j + 1))}
                    className="flex-shrink-0 flex flex-col gap-0.5 px-3 py-2.5 rounded-2xl border min-w-[110px] transition-all active:scale-95 bg-white/[0.06] border-white/10"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {chipLabels[j + 1] ?? `Alternatif ${j + 1}`}
                      </span>
                      {toll && <AlertCircle className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                    </div>
                    <span className="text-sm font-black text-slate-200 leading-tight">{formatDistance(dist)}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-400">{formatEta(altDur)}</span>
                      {diffLabel && (
                        <span className={`text-[10px] font-black ${diffSec > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                          {diffLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Fuel className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      <span className="text-[10px] font-bold text-slate-500">{computeFuelEstimate(dist)} L</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-3">
          {hasAlts ? (
            <button
              onClick={() => altsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
              className="flex-1 py-3.5 rounded-2xl text-slate-300 font-black text-sm uppercase tracking-widest active:scale-95 transition-all bg-white/[0.06] border border-white/10"
            >
              Rota Seç
            </button>
          ) : (
            <button
              onClick={onCancel}
              className="flex-1 py-3.5 rounded-2xl text-slate-400 font-black text-sm uppercase tracking-widest active:scale-95 transition-all bg-white/[0.06] border border-white/10"
            >
              Vazgeç
            </button>
          )}
          <button
            onClick={() => showToast('Durak ekleme yakında')}
            className="flex-1 py-3.5 rounded-2xl text-slate-300 font-black text-sm uppercase tracking-widest active:scale-95 transition-all bg-white/[0.06] border border-white/10"
          >
            Durak Ekle
          </button>
        </div>

        <button
          onClick={onStart}
          disabled={!routeReady || !gpsValid}
          className="w-full py-4 rounded-2xl text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all shadow-[0_10px_30px_rgba(37,99,235,0.4)] bg-gradient-to-br from-blue-600 to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {!gpsValid ? (
            <><AlertCircle className="w-4 h-4" />GPS Sinyali Yok</>
          ) : routeReady ? (
            <><Play className="w-5 h-5 fill-current" />NAVİGASYONU BAŞLAT</>
          ) : (
            <><Loader2 className="w-4 h-4 animate-spin" />Rota hazırlanıyor...</>
          )}
        </button>
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── QuickCard & QuickDestinations ───────────────────────── */
/* ══════════════════════════════════════════════════════════ */

function QuickCard({ icon, label, color, onTap, disabled = false }: {
  icon: ReactNode; label: string; color: string; onTap: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className="flex items-center gap-2 h-8 px-3 rounded-xl active:scale-95 transition-all disabled:opacity-35 shadow-md bg-[rgba(10,14,26,0.80)] backdrop-blur-[20px] border border-white/[0.09]"
      style={{ color }}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 truncate max-w-[80px]">{label}</span>
    </button>
  );
}

/* ── Benzinlik önbellek ──────────────────────────────────────── */

const _FUEL_KEY    = 'caros-fuel-cache';
const _FUEL_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

interface _FuelItem { name: string; lat: number; lon: number; }
interface _FuelCache { items: _FuelItem[]; cachedAt: number; }

function _fuelHav(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6_371_000;
  const dLa = (la2 - la1) * Math.PI / 180;
  const dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _saveFuelCache(items: _FuelItem[]): void {
  try { localStorage.setItem(_FUEL_KEY, JSON.stringify({ items, cachedAt: Date.now() } satisfies _FuelCache)); } catch { /* quota */ }
}

function _nearestCached(lat: number, lon: number): (_FuelItem & { fromCache: true }) | null {
  try {
    const raw = localStorage.getItem(_FUEL_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as _FuelCache;
    if (!c.items?.length || Date.now() - c.cachedAt > _FUEL_MAX_MS) return null;
    const best = c.items.reduce((a, b) =>
      _fuelHav(lat, lon, a.lat, a.lon) <= _fuelHav(lat, lon, b.lat, b.lon) ? a : b,
    );
    return { ...best, fromCache: true as const };
  } catch { return null; }
}

async function findNearbyFuel(
  lat: number, lon: number,
): Promise<{ name: string; lat: number; lon: number; fromCache?: boolean } | null> {
  try {
    const q    = `[out:json][timeout:5];node[amenity=fuel](around:5000,${lat},${lon});out 5;`;
    const url  = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json() as { elements?: Array<{ tags?: { name?: string }; lat: number; lon: number }> };
    if (!data.elements?.length) return _nearestCached(lat, lon);
    const items: _FuelItem[] = data.elements.slice(0, 5).map(el => ({
      name: el.tags?.name || 'Benzin İstasyonu', lat: el.lat, lon: el.lon,
    }));
    _saveFuelCache(items);
    return items.reduce((a, b) => _fuelHav(lat, lon, a.lat, a.lon) <= _fuelHav(lat, lon, b.lat, b.lon) ? a : b);
  } catch {
    return _nearestCached(lat, lon);
  }
}

const QuickDestinationsDelayed = memo(function QuickDestinationsDelayed({
  gpsLat, gpsLon,
}: { gpsLat: number | null; gpsLon: number | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return <QuickDestinations gpsLat={gpsLat} gpsLon={gpsLon} />;
});

const QuickDestinations = memo(function QuickDestinations({
  gpsLat, gpsLon,
}: { gpsLat: number | null; gpsLon: number | null }) {
  const { settings, updateSettings } = useStore();
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelError, setFuelError]     = useState('');

  const navigate = useCallback((dest: Address) => {
    startNavigation(dest);
    const entry = { lat: dest.latitude, lng: dest.longitude, name: dest.name, timestamp: Date.now() };
    updateSettings({
      recentDestinations: [
        entry,
        ...(settings.recentDestinations ?? []).filter(d => d.name !== dest.name),
      ].slice(0, 5),
    });
  }, [settings, updateSettings]);

  const setHome = useCallback(() => {
    if (!gpsLat || !gpsLon) return;
    updateSettings({ homeLocation: { lat: gpsLat, lng: gpsLon, name: 'Ev' } });
  }, [gpsLat, gpsLon, updateSettings]);

  const setWork = useCallback(() => {
    if (!gpsLat || !gpsLon) return;
    updateSettings({ workLocation: { lat: gpsLat, lng: gpsLon, name: 'İş' } });
  }, [gpsLat, gpsLon, updateSettings]);

  const handleFuel = useCallback(async () => {
    if (!gpsLat || !gpsLon || fuelLoading) return;
    setFuelLoading(true);
    setFuelError('');
    const result = await findNearbyFuel(gpsLat, gpsLon);
    setFuelLoading(false);
    if (result) {
      navigate({ id: `fuel-${Date.now()}`, name: result.name, latitude: result.lat, longitude: result.lon, type: 'history' });
      if (result.fromCache) {
        setFuelError('Önbellek kullanıldı');
        setTimeout(() => setFuelError(''), 2500);
      }
    } else {
      setFuelError('Önbellek yok — internet gerekli');
      setTimeout(() => setFuelError(''), 3000);
    }
  }, [gpsLat, gpsLon, fuelLoading, navigate]);

  return (
    <div
      className="absolute left-3 z-20 pointer-events-auto animate-in fade-in slide-in-from-left-2 duration-400"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 10px)' }}
    >
      <div className="flex flex-col gap-1">
        {settings.homeLocation ? (
          <QuickCard icon={<Home className="w-3.5 h-3.5" />} label="Ev" color="#3b82f6"
            onTap={() => navigate({ id: 'home', name: 'Ev', latitude: settings.homeLocation!.lat, longitude: settings.homeLocation!.lng, type: 'history', category: 'home' })} />
        ) : (
          <QuickCard icon={<Home className="w-3.5 h-3.5" />} label="Ev Ayarla" color="#475569" onTap={setHome} disabled={!gpsLat} />
        )}
        {settings.workLocation ? (
          <QuickCard icon={<Briefcase className="w-3.5 h-3.5" />} label="İş" color="#8b5cf6"
            onTap={() => navigate({ id: 'work', name: 'İş', latitude: settings.workLocation!.lat, longitude: settings.workLocation!.lng, type: 'history', category: 'work' })} />
        ) : (
          <QuickCard icon={<Briefcase className="w-3.5 h-3.5" />} label="İş Ayarla" color="#475569" onTap={setWork} disabled={!gpsLat} />
        )}
        <QuickCard
          icon={fuelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fuel className="w-3.5 h-3.5" />}
          label="Benzinlik" color="#f59e0b" onTap={handleFuel} disabled={!gpsLat || fuelLoading} />
        {fuelError && (
          <div className={`px-2 py-1 rounded-lg text-[10px] font-mono text-center ${
            fuelError.startsWith('Önbellek kullanıldı')
              ? 'bg-amber-900/80 border border-amber-700/60 text-amber-300'
              : 'bg-red-900/80 border border-red-700/60 text-red-300'
          }`}>
            {fuelError}
          </div>
        )}
      </div>
    </div>
  );
});


/* ══════════════════════════════════════════════════════════ */
/* ── NavigationHUD (ana export) ──────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

export interface NavigationHUDProps {
  onStart:    () => void;
  onCancel:   () => void;
  routeReady: boolean;
  /** GPS fix geçerli mi — false ise Start butonu disabled */
  gpsValid?:  boolean;
  speedKmh?:  number;
  onNavTab?:  (id: string) => void;
}

export const NavigationHUD = memo(function NavigationHUD({
  onStart,
  onCancel,
  routeReady,
  gpsValid = true,
  speedKmh = 0,
}: NavigationHUDProps) {
  const location = useGPSLocation();
  const dynamicLimit = useSpeedLimitByLocation(
    location?.latitude  ?? null,
    location?.longitude ?? null,
  );
  const {
    status, destination, distanceMeters, etaSeconds,
    isOfflineResult, isRerouting, errorMessage,
  } = useNavigation();
  const route = useRouteState();

  const handleStop = useCallback(() => {
    stopNavigation();
    clearRoute();
    onCancel();
  }, [onCancel]);

  const [showAlts, setShowAlts] = useState(false);

  // Sesli yönlendirme — adım değiştiğinde konuş
  useEffect(() => {
    if (isActiveNav && currentStep && !isRerouting) {
      const distance = Math.round(route.distanceToNextTurnMeters);
      if (distance > 0) {
        speakNavigation(`${distance} metre sonra ${currentStep.instruction}`);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.currentStepIndex, isRerouting]);

  // Durum türetmeleri
  const isActiveNav   = status === NavStatus.ACTIVE || status === NavStatus.REROUTING;
  const isShowPreview = status === NavStatus.PREVIEW || status === NavStatus.ROUTING;
  const isShowArrived = status === NavStatus.ARRIVED;
  const isShowError   = status === NavStatus.ERROR;

  const currentStep = route.steps[route.currentStepIndex];
  const nextStep    = route.steps[route.currentStepIndex + 1];

  // İlk GPS tick'inde distanceMeters=0 olabilir — toplam mesafeye fallback
  const effectiveDist = (distanceMeters && distanceMeters > 10)
    ? distanceMeters
    : route.totalDistanceMeters;

  const displayEta = route.totalDurationSeconds > 0
    ? Math.round(route.totalDurationSeconds * Math.min(1, effectiveDist / Math.max(1, route.totalDistanceMeters)))
    : (etaSeconds ?? 0);

  return (
    <>
      {/* ═══ ACTIVE / REROUTING ═══ */}
      {isActiveNav && (
        <>
          {isRerouting && <ReroutingBanner />}

          {!isRerouting && currentStep && (
            <>
              <TurnPanel
                step={currentStep}
                distToTurn={route.distanceToNextTurnMeters}
                nextStep={nextStep}
              />
              <RoadSignsPanel
                streetName={currentStep.streetName}
                destName={destination?.name}
              />
              <LaneGuidance
                maneuverModifier={currentStep.maneuverModifier}
                distToTurn={route.distanceToNextTurnMeters}
              />
              <SpeedPanel speedKmh={speedKmh} speedLimitKmh={dynamicLimit} />
            </>
          )}

          {/* Steps boş (local daemon / düz çizgi) → yedek TurnPanel */}
          {!isRerouting && !currentStep && destination && (
            <>
              <TurnPanel
                step={{
                  instruction:      'Devam Edin',
                  streetName:       destination.name,
                  distance:         effectiveDist,
                  duration:         displayEta,
                  maneuverType:     'straight',
                  maneuverModifier: 'straight',
                  coordinate:       [destination.longitude, destination.latitude],
                }}
                distToTurn={effectiveDist}
              />
              <RoadSignsPanel destName={destination.name} />
              <SpeedPanel speedKmh={speedKmh} speedLimitKmh={dynamicLimit} />
            </>
          )}

          {/* Alternatif rotalar butonu + paneli */}
          {!isRerouting && route.alternatives.length > 0 && (
            <div
              className="absolute z-30 pointer-events-auto"
              style={{ left: 16, bottom: 'calc(var(--lp-dock-h, 68px) + 96px)' }}
            >
              {showAlts && (
                <div className="mb-2 flex flex-col gap-1.5 animate-in slide-in-from-bottom-2 fade-in duration-200">
                  {route.alternatives.map((_, i) => {
                    const realIdx = route.altRealIndices[i];
                    return (
                      <button
                        key={realIdx ?? i}
                        onClick={() => { selectAltRoute(realIdx ?? (i + 1)); setShowAlts(false); }}
                        className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left futurist-glass active:scale-95 transition-all"
                      >
                        <div className="w-8 h-8 rounded-xl bg-slate-700/60 flex items-center justify-center flex-shrink-0">
                          <GitBranch className="w-4 h-4 text-blue-400" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-white font-black text-sm">Alternatif {i + 1}</span>
                          <span className="text-slate-400 text-xs font-bold">
                            {formatDistance(route.altDistances[i])} · {formatEta(route.altDurations[i])}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                onClick={() => setShowAlts(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl futurist-glass active:scale-95 transition-all"
              >
                <GitBranch className="w-4 h-4 text-blue-400" />
                <span className="text-white font-bold text-xs uppercase tracking-wide">
                  Alternatifler ({route.alternatives.length})
                </span>
              </button>
            </div>
          )}

          <NavInfoBar
            etaSeconds={displayEta}
            remainingMeters={effectiveDist}
            totalMeters={route.totalDistanceMeters}
            onStop={handleStop}
            isOffline={isOfflineResult}
          />
        </>
      )}

      {/* ═══ PREVIEW / ROUTING ═══ */}
      {isShowPreview && destination && (
        <PreviewCard
          destName={destination.name}
          distMeters={route.steps.length ? route.totalDistanceMeters : (distanceMeters ?? 0)}
          durSeconds={route.steps.length ? route.totalDurationSeconds : (etaSeconds ?? 0)}
          loading={route.loading || status === NavStatus.ROUTING}
          error={route.error}
          onStart={onStart}
          onCancel={onCancel}
          routeReady={routeReady}
          gpsValid={gpsValid}
        />
      )}

      {/* ═══ ARRIVED ═══ */}
      {isShowArrived && destination && (
        <ArrivalOverlay destName={destination.name} />
      )}

      {/* ═══ ERROR ═══ */}
      {isShowError && (
        <ErrorOverlay
          message={errorMessage ?? 'Navigasyon başarısız oldu.'}
          onClose={() => { stopNavigation(); onCancel(); }}
        />
      )}

      {/* ═══ IDLE — hızlı hedefler ═══ */}
      {status === NavStatus.IDLE && (
        <QuickDestinationsDelayed
          gpsLat={location?.latitude  ?? null}
          gpsLon={location?.longitude ?? null}
        />
      )}

      {/* ═══ ACTIVE NAV — sol kompakt kısayollar ═══ */}
      {isActiveNav && (
        <QuickDestinations
          gpsLat={location?.latitude  ?? null}
          gpsLon={location?.longitude ?? null}
        />
      )}
    </>
  );
});
