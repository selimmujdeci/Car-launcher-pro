/**
 * NavigationHUD — Resimle birebir eşleşen premium araç navigasyon overlay'i.
 *
 * Aktif navigasyon sırasında gösterilen bileşenler:
 *   TurnPanel        — üst sol: dönüş talimatı (ok + mesafe + sokak)
 *   NextStepChip     — üst sol (alt): sonraki manevra
 *   RoadSignsPanel   — üst orta: yol tabelaları
 *   LeftButtons      — sol dikey: navigasyon / ses / uyarı / menü
 *   SpeedPanel       — sağ: hız limiti + mevcut hız
 *   LaneGuidance     — alt orta: şerit rehberi
 *   NavInfoBar       — alt bilgi çubuğu: süre / mesafe / varış + ilerleme
 *   BottomNavBar     — en alt: Navigasyon / Medya / Telefon / Uygulamalar / Ayarlar
 *
 * Navigasyon yokken:
 *   PreviewCard      — rota önizlemesi + başlat/iptal
 *   QuickDestinations — hızlı hedef kartları
 */
import {
  memo, useState, useCallback, useEffect, type ReactNode,
} from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, RotateCcw, RefreshCw,
  MapPin, Navigation2, Home, Briefcase, Fuel,
  Play, X, Loader2, AlertCircle,
  Volume2, VolumeX, AlertTriangle, MoreHorizontal,
  ChevronDown, Menu as MenuIcon,
} from 'lucide-react';
import {
  useNavigation,
  startNavigation,
  stopNavigation,
  formatDistance,
  formatEta,
} from '../../platform/navigationService';
import {
  useRouteState,
  clearRoute,
} from '../../platform/routingService';
import type { RouteStep } from '../../platform/routingService';
import { useStore } from '../../store/useStore';
import { useGPSLocation } from '../../platform/gpsService';
import type { Address } from '../../platform/addressBookService';

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

/* ── Dönüş ok ikonu ───────────────────────────────────────── */

function TurnArrow({ mod, type, size = 'lg' }: { mod: string; type: string; size?: 'lg' | 'sm' | 'xs' }) {
  const cls = size === 'lg' ? 'w-14 h-14' : size === 'sm' ? 'w-5 h-5' : 'w-4 h-4';
  if (type === 'arrive')                           return <MapPin      className={cls} />;
  if (type === 'depart')                           return <Navigation2 className={`${cls} fill-current`} />;
  if (type === 'roundabout' || type === 'rotary')  return <RefreshCw   className={cls} />;
  if (mod === 'uturn')                             return <RotateCcw   className={cls} />;
  if (mod.includes('right'))                       return <ArrowRight  className={cls} />;
  if (mod.includes('left'))                        return <ArrowLeft   className={cls} />;
  return <ArrowUp className={cls} />;
}

/* ── Mesafe formatlayıcı ─────────────────────────────────── */

function fmtTurn(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m <  20)   return 'ŞİMDİ';
  if (m < 100)   return `${Math.round(m / 10) * 10} m`;
  if (m < 1000)  return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/* ── Şerit türetici ─────────────────────────────────────────
 * OSRM adım modifier'ından 4 şeritlik rehber üretir.
 * Aktif indeksler mavi, pasifler şeffaf görünür.
 */
type Lane = { dir: 'left' | 'straight' | 'right'; active: boolean };

function buildLanes(mod: string): Lane[] {
  const L: Lane['dir'] = 'left';
  const S: Lane['dir'] = 'straight';
  const R: Lane['dir'] = 'right';
  if (mod.includes('sharp left') || mod === 'uturn')
    return [{ dir: L, active: true }, { dir: L, active: true }, { dir: S, active: false }, { dir: R, active: false }];
  if (mod.includes('left'))
    return [{ dir: L, active: true }, { dir: S, active: false }, { dir: S, active: false }, { dir: R, active: false }];
  if (mod.includes('sharp right'))
    return [{ dir: L, active: false }, { dir: S, active: false }, { dir: R, active: true }, { dir: R, active: true }];
  if (mod.includes('right'))
    return [{ dir: L, active: false }, { dir: S, active: false }, { dir: S, active: false }, { dir: R, active: true }];
  return [{ dir: L, active: false }, { dir: S, active: true }, { dir: S, active: true }, { dir: R, active: false }];
}

/* ══════════════════════════════════════════════════════════ */
/* ── TurnPanel (üst sol) ──────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const TurnPanel = memo(function TurnPanel({
  step, distToTurn, nextStep,
}: {
  step: RouteStep; distToTurn: number; nextStep?: RouteStep;
}) {
  const isArrive = step.maneuverType === 'arrive';

  return (
    <div className="absolute left-4 z-30 pointer-events-none flex flex-col gap-2"
      style={{ top: 'calc(var(--sat, 0px) + 14px)', maxWidth: 340 }}>
      {/* Ana dönüş kartı */}
      <div
        className="flex items-stretch rounded-[1.75rem] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.7)] bg-[rgba(10,14,26,0.88)] backdrop-blur-[24px] border border-white/10"
      >
        {/* Ok alanı */}
        <div
          className="flex items-center justify-center px-5 flex-shrink-0"
          style={{
            background: isArrive
              ? 'linear-gradient(160deg,#10b981,#059669)'
              : 'linear-gradient(160deg,#3b82f6,#1d4ed8)',
            minWidth: 90,
          }}
        >
          <TurnArrow mod={step.maneuverModifier} type={step.maneuverType} size="lg" />
        </div>

        {/* Metin alanı */}
        <div className="px-5 py-4 flex flex-col justify-center min-w-0">
          <div
            className="text-white font-black leading-none mb-1 tabular-nums text-[36px] tracking-[-0.02em]"
          >
            {isArrive ? '—' : fmtTurn(distToTurn)}
          </div>
          <div className="text-white font-bold text-lg leading-tight truncate opacity-[0.95]">
            {toTurkish(step.maneuverModifier, step.maneuverType)}
          </div>
          {step.streetName && (
            <div className="text-blue-400 font-black text-sm truncate mt-0.5 uppercase tracking-wide">
              {step.streetName}
            </div>
          )}
        </div>
      </div>

      {/* Sonraki adım kartı */}
      {nextStep && !isArrive && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.5)] bg-[rgba(10,14,26,0.80)] backdrop-blur-[20px] border border-white/[0.08]"
        >
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <TurnArrow mod={nextStep.maneuverModifier} type={nextStep.maneuverType} size="sm" />
          </div>
          <div className="min-w-0">
            <div className="text-white font-black text-sm truncate leading-tight">
              {nextStep.streetName || toTurkish(nextStep.maneuverModifier, nextStep.maneuverType)}
            </div>
            {nextStep.distance > 0 && (
              <div className="text-slate-400 text-[11px] font-bold mt-0.5">
                {formatDistance(nextStep.distance)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── RoadSignsPanel (üst orta) ───────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const RoadSignsPanel = memo(function RoadSignsPanel({
  currentStreet, nextStreet,
}: {
  currentStreet?: string; nextStreet?: string;
}) {
  if (!currentStreet && !nextStreet) return null;

  return (
    <div className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none flex gap-2.5"
      style={{ top: 'calc(var(--sat, 0px) + 14px)' }}>
      {currentStreet && (
        <div
          className="flex flex-col items-center px-5 py-2.5 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] bg-gradient-to-bl from-blue-900 to-blue-700 border-2 border-white/[0.18] min-w-[130px]"
        >
          <span className="text-white font-black text-sm uppercase tracking-wider leading-tight text-center">
            {currentStreet}
          </span>
          <ChevronDown className="w-4 h-4 text-white mt-1 opacity-80" />
        </div>
      )}
      {nextStreet && (
        <div
          className="flex flex-col items-center px-5 py-2.5 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] bg-gradient-to-bl from-blue-900 to-blue-700 border-2 border-white/[0.18] min-w-[130px]"
        >
          <span className="text-white font-black text-sm uppercase tracking-wider leading-tight text-center">
            {nextStreet}
          </span>
          <ChevronDown className="w-4 h-4 text-white mt-1 opacity-80" />
        </div>
      )}
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── LeftButtons (sol dikey şerit) ───────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const LeftButtons = memo(function LeftButtons({
  muted, onToggleMute,
}: {
  muted: boolean; onToggleMute: () => void;
}) {
  return (
    <div className="absolute left-5 top-1/2 -translate-y-1/2 z-30 pointer-events-auto flex flex-col gap-3">
      {/* Navigasyon - aktif (kırmızı/dolu) */}
      <button
        className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-[0_4px_20px_rgba(239,68,68,0.45)] active:scale-90 transition-all bg-gradient-to-br from-red-500 to-red-600 border border-white/[0.15]"
      >
        <Navigation2 className="w-5 h-5 text-white fill-white" />
      </button>

      {/* Ses */}
      <button
        onClick={onToggleMute}
        className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-all bg-[rgba(10,14,26,0.80)] backdrop-blur-[20px] border border-white/[0.12]"
      >
        {muted
          ? <VolumeX className="w-5 h-5 text-slate-300" />
          : <Volume2  className="w-5 h-5 text-white"   />
        }
      </button>

      {/* Uyarı */}
      <button
        className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-all bg-[rgba(10,14,26,0.80)] backdrop-blur-[20px] border border-white/[0.12]"
      >
        <AlertTriangle className="w-5 h-5 text-amber-400" />
      </button>

      {/* Menü */}
      <button
        className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-all bg-[rgba(10,14,26,0.80)] backdrop-blur-[20px] border border-white/[0.12]"
      >
        <MoreHorizontal className="w-5 h-5 text-white" />
      </button>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── SpeedPanel (sağ) ────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const SpeedPanel = memo(function SpeedPanel({
  speedKmh, speedLimitKmh = 50,
}: {
  speedKmh: number; speedLimitKmh?: number;
}) {
  const overSpeed = speedKmh > speedLimitKmh + 5;
  const roundedSpeed = Math.round(speedKmh);

  return (
    <div className="absolute right-5 top-1/2 -translate-y-1/2 z-30 pointer-events-none flex flex-col items-center gap-3">
      {/* Hız limiti tabelası — trafik işareti görünümü */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center bg-white border-[5px] border-red-600 shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_0_0_2px_rgba(220,38,38,0.15)]"
      >
        <span className="text-black font-black text-[22px] tracking-[-0.03em]">
          {speedLimitKmh}
        </span>
      </div>

      {/* Mevcut hız kartı */}
      <div
        className="flex flex-col items-center px-4 py-3 rounded-[1.5rem] shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        style={{
          background: 'rgba(10,14,26,0.88)',
          backdropFilter: 'blur(24px)',
          border: `1px solid ${overSpeed ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.10)'}`,
          minWidth: 88,
        }}
      >
        {/* Küçük limit rozeti */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center mb-1 bg-white border-[3px] border-red-600"
        >
          <span className="text-black font-black text-[11px]">{speedLimitKmh}</span>
        </div>
        {/* Hız */}
        <span
          className="font-black tabular-nums leading-none"
          style={{
            fontSize: 44,
            color: overSpeed ? '#f87171' : '#ffffff',
            letterSpacing: '-0.04em',
          }}
        >
          {roundedSpeed}
        </span>
        <span className="text-slate-400 font-bold uppercase tracking-widest mt-0.5 text-[11px]">
          km/h
        </span>
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── LaneGuidance (alt orta) ─────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

function LaneIcon({ dir }: { dir: Lane['dir'] }) {
  if (dir === 'left')  return <ArrowLeft  className="w-5 h-5" />;
  if (dir === 'right') return <ArrowRight className="w-5 h-5" />;
  return <ArrowUp className="w-5 h-5" />;
}

const LaneGuidance = memo(function LaneGuidance({ lanes }: { lanes: Lane[] }) {
  return (
    <div className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 88px)' }}>
      <div
        className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.7)] bg-[rgba(10,14,26,0.88)] backdrop-blur-[24px] border border-white/10"
      >
        {lanes.map((lane, i) => (
          <div
            key={i}
            className="w-14 h-12 rounded-xl flex items-center justify-center transition-all"
            style={{
              background: lane.active
                ? 'linear-gradient(160deg,#3b82f6,#1d4ed8)'
                : 'rgba(255,255,255,0.07)',
              border: lane.active
                ? '1px solid rgba(96,165,250,0.5)'
                : '1px solid rgba(255,255,255,0.08)',
              color: lane.active ? '#ffffff' : 'rgba(255,255,255,0.35)',
              boxShadow: lane.active ? '0 4px 16px rgba(59,130,246,0.4)' : 'none',
            }}
          >
            <LaneIcon dir={lane.dir} />
          </div>
        ))}
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── NavInfoBar (alt bilgi çubuğu) ───────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const NavInfoBar = memo(function NavInfoBar({
  etaSeconds, remainingMeters, totalMeters, onStop,
}: {
  etaSeconds: number; remainingMeters: number; totalMeters: number; onStop: () => void;
}) {
  const arrival    = new Date(Date.now() + etaSeconds * 1_000);
  const arrivalStr = `${arrival.getHours().toString().padStart(2, '0')}:${arrival.getMinutes().toString().padStart(2, '0')}`;
  const progress   = totalMeters > 0 ? Math.max(0, Math.min(1, 1 - remainingMeters / totalMeters)) : 0;

  return (
    <div
      className="absolute inset-x-0 z-30 pointer-events-auto bg-[rgba(8,12,22,0.94)] backdrop-blur-[24px] border-t border-white/[0.08] shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
      style={{ bottom: 'var(--lp-dock-h, 68px)' }}
    >
      <div className="flex items-stretch px-3 py-1">
        {/* X butonu */}
        <button
          onClick={onStop}
          className="flex items-center justify-center w-14 h-14 rounded-2xl my-1.5 active:scale-90 transition-all flex-shrink-0 bg-red-500/[0.15] border border-red-500/25"
        >
          <X className="w-6 h-6 text-red-400" />
        </button>

        {/* Süre */}
        <InfoCell label="Süre" value={formatEta(etaSeconds)} />
        <InfoDivider />

        {/* Mesafe */}
        <InfoCell label="Mesafe" value={formatDistance(remainingMeters)} />
        <InfoDivider />

        {/* Varış */}
        <InfoCell label="Varış zamanı" value={arrivalStr} />

        {/* Menü */}
        <button
          className="flex items-center justify-center w-14 h-14 rounded-2xl my-1.5 active:scale-90 transition-all flex-shrink-0 ml-1 bg-white/[0.06] border border-white/10"
        >
          <MenuIcon className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* İlerleme çubuğu */}
      <div className="relative h-1.5 mx-4 mb-2 rounded-full overflow-visible bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${progress * 100}%`,
            background: 'linear-gradient(90deg,#3b82f6,#60a5fa)',
            boxShadow: '0 0 8px rgba(96,165,250,0.6)',
          }}
        />
        {/* Araç işaretçisi */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center"
          style={{
            left: `${Math.max(2, Math.min(98, progress * 100))}%`,
            background: '#3b82f6',
            boxShadow: '0 0 8px rgba(59,130,246,0.8)',
          }}
        >
          <Navigation2 className="w-2 h-2 text-white fill-white" />
        </div>
      </div>
    </div>
  );
});

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-3">
      <span className="text-white font-black tabular-nums leading-none text-[28px] tracking-[-0.03em]">
        {value}
      </span>
      <span className="text-slate-500 font-bold uppercase tracking-wider mt-1.5 text-[10px]">
        {label}
      </span>
    </div>
  );
}

function InfoDivider() {
  return (
    <div className="w-px my-4 flex-shrink-0 bg-white/10" />
  );
}


/* ══════════════════════════════════════════════════════════ */
/* ── PreviewCard ─────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const PreviewCard = memo(function PreviewCard({
  destName, distMeters, durSeconds, loading, error, onStart, onCancel,
}: {
  destName: string; distMeters: number; durSeconds: number;
  loading: boolean; error: string | null;
  onStart: () => void; onCancel: () => void;
}) {
  return (
    <div className="absolute bottom-6 inset-x-6 z-30 pointer-events-auto animate-in zoom-in-95 fade-in duration-500">
      <div
        className="rounded-[2.5rem] p-6 overflow-hidden relative shadow-[0_40px_80px_rgba(0,0,0,0.7)] bg-[rgba(8,12,22,0.95)] backdrop-blur-[28px] border border-white/10"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500 rounded-t-[2.5rem]" />
        <div className="flex items-start gap-4 mb-6">
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
        </div>
        <div className="flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 py-4 rounded-2xl text-slate-400 font-black text-sm uppercase tracking-widest active:scale-95 transition-all bg-white/[0.06] border border-white/10"
          >
            Vazgeç
          </button>
          <button
            onClick={onStart}
            className="flex-[2] py-4 rounded-2xl text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all shadow-[0_10px_30px_rgba(37,99,235,0.4)] bg-gradient-to-br from-blue-600 to-blue-700"
          >
            <Play className="w-5 h-5 fill-current" />
            Navigasyonu Başlat
          </button>
        </div>
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

async function findNearbyFuel(lat: number, lon: number): Promise<{ name: string; lat: number; lon: number } | null> {
  try {
    const q   = `[out:json][timeout:5];node[amenity=fuel](around:5000,${lat},${lon});out 1;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.elements?.length) return null;
    const el = data.elements[0];
    return { name: el.tags?.name || 'Benzin İstasyonu', lat: el.lat, lon: el.lon };
  } catch { return null; }
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
    const result = await findNearbyFuel(gpsLat, gpsLon);
    setFuelLoading(false);
    if (result) navigate({ id: `fuel-${Date.now()}`, name: result.name, latitude: result.lat, longitude: result.lon, type: 'history' });
  }, [gpsLat, gpsLon, fuelLoading, navigate]);

  return (
    <div className="absolute left-3 z-20 pointer-events-auto animate-in fade-in slide-in-from-left-2 duration-400"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 10px)' }}>
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
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── NavigationHUD (ana export) ──────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

export interface NavigationHUDProps {
  isPreview:    boolean;
  onStart:      () => void;
  onCancel:     () => void;
  speedKmh?:    number;
  speedLimitKmh?: number;
  /** Harita sekme geçişleri için callback — ileride kullanılabilir */
  onNavTab?: (id: string) => void;
}

export const NavigationHUD = memo(function NavigationHUD({
  isPreview,
  onStart,
  onCancel,
  speedKmh = 0,
  speedLimitKmh = 50,
}: NavigationHUDProps) {
  const location = useGPSLocation();
  const { isNavigating, destination, distanceMeters, etaSeconds } = useNavigation();
  const route = useRouteState();
  const [muted, setMuted] = useState(false);

  const handleStop = useCallback(() => {
    stopNavigation();
    clearRoute();
    onCancel(); // kamera reset + FullMapView cleanup
  }, [onCancel]);


  const isActiveNav   = isNavigating && !isPreview;
  const currentStep   = route.steps[route.currentStepIndex];
  const nextStep      = route.steps[route.currentStepIndex + 1];

  const displayEta = route.steps.length > 0
    ? Math.round(
        route.totalDurationSeconds *
        Math.min(1, (distanceMeters ?? 0) / Math.max(1, route.totalDistanceMeters)),
      )
    : (etaSeconds ?? 0);

  const lanes = currentStep ? buildLanes(currentStep.maneuverModifier) : null;

  return (
    <>
      {/* ═══ AKTİF NAVİGASYON overlay'leri ═══ */}
      {isActiveNav && currentStep && (
        <>
          {/* Üst sol: dönüş talimatı */}
          <TurnPanel
            step={currentStep}
            distToTurn={route.distanceToNextTurnMeters}
            nextStep={nextStep}
          />

          {/* Üst orta: yol tabelaları */}
          <RoadSignsPanel
            currentStreet={currentStep.streetName}
            nextStreet={nextStep?.streetName}
          />

          {/* Sol dikey butonlar */}
          <LeftButtons muted={muted} onToggleMute={() => setMuted(m => !m)} />

          {/* Sağ: hız paneli */}
          <SpeedPanel speedKmh={speedKmh} speedLimitKmh={speedLimitKmh} />

          {/* Alt orta: şerit rehberi */}
          {lanes && <LaneGuidance lanes={lanes} />}

          {/* Alt bilgi çubuğu — DockBar'ın hemen üstünde */}
          <NavInfoBar
            etaSeconds={displayEta}
            remainingMeters={distanceMeters ?? 0}
            totalMeters={route.totalDistanceMeters}
            onStop={handleStop}
          />
        </>
      )}

      {/* ═══ ROTA ÖNİZLEMESİ ═══ */}
      {isPreview && destination && (
        <PreviewCard
          destName={destination.name}
          distMeters={route.steps.length ? route.totalDistanceMeters : (distanceMeters ?? 0)}
          durSeconds={route.steps.length ? route.totalDurationSeconds : (etaSeconds ?? 0)}
          loading={route.loading}
          error={route.error}
          onStart={onStart}
          onCancel={onCancel}
        />
      )}

      {/* ═══ NAVİGASYON YOKKEN: hızlı hedefler ═══ */}
      {!isNavigating && !isPreview && (
        <QuickDestinationsDelayed
          gpsLat={location?.latitude  ?? null}
          gpsLon={location?.longitude ?? null}
        />
      )}
    </>
  );
});
