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
  MapPin, Home, Briefcase, Fuel,
  Navigation, Play, X, Loader2, AlertCircle, CheckCircle2,
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

function TurnArrow({ mod, type, size = 'lg' }: { mod: string; type: string; size?: 'lg' | 'md' | 'sm' | 'xs' }) {
  const cls = size === 'lg' ? 'w-14 h-14' : size === 'md' ? 'w-9 h-9' : size === 'sm' ? 'w-5 h-5' : 'w-4 h-4';
  if (type === 'arrive')                           return <MapPin      className={cls} />;
  if (type === 'depart')                           return <Navigation  className={`${cls} fill-current`} />;
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
    <div className="absolute left-4 z-30 pointer-events-none flex flex-col gap-1.5"
      style={{ top: 'calc(var(--sat) + 14px)', maxWidth: 300 }}>
      {/* Ana dönüş kartı — minimalist */}
      <div
        className="flex items-stretch rounded-2xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.65)] bg-[rgba(10,14,26,0.82)] backdrop-blur-[32px] border border-white/[0.07]"
      >
        {/* Ok alanı */}
        <div
          className="flex items-center justify-center px-4 flex-shrink-0"
          style={{
            background: isArrive
              ? 'linear-gradient(160deg,#10b981,#059669)'
              : 'linear-gradient(160deg,#3b82f6,#1d4ed8)',
            minWidth: 72,
          }}
        >
          <TurnArrow mod={step.maneuverModifier} type={step.maneuverType} size="md" />
        </div>

        {/* Metin alanı */}
        <div className="px-4 py-3 flex flex-col justify-center min-w-0">
          <div className="text-white font-black leading-none mb-0.5 tabular-nums text-[26px] tracking-[-0.02em]">
            {isArrive ? '—' : fmtTurn(distToTurn)}
          </div>
          <div className="text-white font-semibold text-sm leading-tight truncate opacity-90">
            {toTurkish(step.maneuverModifier, step.maneuverType)}
          </div>
          {step.streetName && (
            <div className="text-blue-400 font-bold text-xs truncate mt-0.5 uppercase tracking-wide">
              {step.streetName}
            </div>
          )}
        </div>
      </div>

      {/* Sonraki adım — ince ikincil kart */}
      {nextStep && !isArrive && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.4)] bg-[rgba(10,14,26,0.72)] backdrop-blur-[24px] border border-white/[0.06]"
        >
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <TurnArrow mod={nextStep.maneuverModifier} type={nextStep.maneuverType} size="xs" />
          </div>
          <div className="min-w-0">
            <div className="text-white font-bold text-xs truncate leading-tight">
              {nextStep.streetName || toTurkish(nextStep.maneuverModifier, nextStep.maneuverType)}
            </div>
            {nextStep.distance > 0 && (
              <div className="text-slate-500 text-[10px] font-bold mt-0.5">
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
/* ── NavInfoBar (alt bilgi çubuğu — kompakt tek satır) ───── */
/* ══════════════════════════════════════════════════════════ */

const NavInfoBar = memo(function NavInfoBar({
  etaSeconds, remainingMeters, totalMeters, onStop, isOffline,
}: {
  etaSeconds: number; remainingMeters: number; totalMeters: number; onStop: () => void; isOffline?: boolean;
}) {
  const arrival    = new Date(Date.now() + etaSeconds * 1_000);
  const arrivalStr = `${arrival.getHours().toString().padStart(2, '0')}:${arrival.getMinutes().toString().padStart(2, '0')}`;
  const progress   = totalMeters > 0 ? Math.max(0, Math.min(1, 1 - remainingMeters / totalMeters)) : 0;

  return (
    <div
      className="absolute inset-x-0 z-30 pointer-events-auto"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + env(safe-area-inset-bottom, 0px))' }}
    >
      {isOffline && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-amber-500/90 backdrop-blur-md px-3 py-0.5 rounded-t-lg border-t border-x border-white/20 flex items-center gap-1.5 shadow-lg">
          <AlertCircle className="w-3 h-3 text-white" />
          <span className="text-[9px] text-white font-black uppercase tracking-[0.1em]">Çevrimdışı</span>
        </div>
      )}

      {/* Tek satır bilgi çubuğu */}
      <div className="flex items-center px-3 py-2.5 bg-[rgba(8,12,22,0.92)] backdrop-blur-[28px] border-t border-white/[0.06] shadow-[0_-10px_32px_rgba(0,0,0,0.5)]">
        {/* Durdur */}
        <button
          onClick={onStop}
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-red-500/[0.12] border border-red-500/20"
        >
          <X className="w-5 h-5 text-red-400" />
        </button>

        {/* Süre · Mesafe · Varış — tek yatay satır */}
        <div className="flex-1 flex items-center justify-center gap-4 px-2">
          <NavStat label="Süre"    value={formatEta(etaSeconds)} />
          <span className="text-white/[0.18] text-base select-none">·</span>
          <NavStat label="Mesafe"  value={formatDistance(remainingMeters)} />
          <span className="text-white/[0.18] text-base select-none">·</span>
          <NavStat label="Varış"   value={arrivalStr} accent />
        </div>
      </div>

      {/* İlerleme çubuğu — ince */}
      <div className="h-[3px] bg-white/[0.07]">
        <div
          className="h-full transition-all duration-1000"
          style={{
            width: `${progress * 100}%`,
            background: 'linear-gradient(90deg,#2563eb,#60a5fa)',
          }}
        />
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
  return (
    <div
      className="absolute left-4 z-30 pointer-events-none"
      style={{ top: 'calc(var(--sat, 0px) + 14px)' }}
    >
      <div className="flex items-center gap-4 px-5 py-4 rounded-[1.75rem] shadow-[0_20px_60px_rgba(0,0,0,0.7)] bg-[rgba(10,14,26,0.88)] backdrop-blur-[24px] border border-white/10">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(160deg,#3b82f6,#1d4ed8)' }}
        >
          <Loader2 className="w-8 h-8 text-white animate-spin" />
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-white font-black text-[22px] leading-tight tracking-[-0.02em]">
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
        {/* Yeşil onay ikonu */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(16,185,129,0.12)', border: '1.5px solid rgba(16,185,129,0.3)', boxShadow: '0 0 40px rgba(16,185,129,0.2)' }}
        >
          <CheckCircle2 className="w-11 h-11 text-emerald-400" />
        </div>
        <div className="text-center">
          <div className="text-white font-black text-[28px] tracking-[-0.02em] leading-tight">
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
      <div className="flex items-center gap-4 px-5 py-4 rounded-[1.75rem] shadow-[0_20px_60px_rgba(0,0,0,0.7)] bg-[rgba(10,14,26,0.88)] backdrop-blur-[24px] border border-red-500/25 max-w-sm">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(160deg,rgba(239,68,68,0.25),rgba(185,28,28,0.18))' }}
        >
          <AlertCircle className="w-7 h-7 text-red-400" />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-white font-black text-base leading-tight">Navigasyon Hatası</span>
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
  const { altDistances, altDurations, selectedAltIndex } = useRouteState();
  const hasAlts = altDistances.length > 0;

  const chipLabels = ['En Hızlı', 'Alternatif 1', 'Alternatif 2'];

  return (
    <div
      className="absolute inset-x-4 z-30 pointer-events-auto animate-in zoom-in-95 fade-in duration-500"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + var(--sab, 0px) + 12px)' }}
    >
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
        {/* Yandex tarzı rota seçici — sadece alternatif varsa */}
        {hasAlts && !loading && (
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
            {[distMeters, ...altDistances].map((dist, i) => {
              const dur = i === 0 ? durSeconds : altDurations[i - 1];
              const selected = selectedAltIndex === i;
              return (
                <button
                  key={i}
                  onClick={() => selectAltRoute(i)}
                  className={`flex-shrink-0 flex flex-col items-start px-3 py-2 rounded-2xl border transition-all active:scale-95 ${
                    selected
                      ? 'bg-blue-600 border-blue-500 text-white shadow-[0_4px_16px_rgba(37,99,235,0.5)]'
                      : 'bg-white/[0.06] border-white/10 text-slate-400'
                  }`}
                >
                  <span className="text-[11px] font-black uppercase tracking-widest opacity-70">
                    {chipLabels[i] ?? `Alternatif ${i}`}
                  </span>
                  <span className={`text-sm font-black mt-0.5 ${selected ? 'text-white' : 'text-slate-200'}`}>
                    {formatDistance(dist)}
                  </span>
                  <span className={`text-[11px] font-bold ${selected ? 'text-blue-200' : 'text-slate-500'}`}>
                    {formatEta(dur)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-4 rounded-2xl text-slate-400 font-black text-sm uppercase tracking-widest active:scale-95 transition-all bg-white/[0.06] border border-white/10"
          >
            Vazgeç
          </button>
          <button
            onClick={onStart}
            disabled={!routeReady || !gpsValid}
            className="flex-[2] py-4 rounded-2xl text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all shadow-[0_10px_30px_rgba(37,99,235,0.4)] bg-gradient-to-br from-blue-600 to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {!gpsValid ? (
              <><AlertCircle className="w-4 h-4" />GPS Sinyali Yok</>
            ) : routeReady ? (
              <><Play className="w-5 h-5 fill-current" />Navigasyonu Başlat</>
            ) : (
              <><Loader2 className="w-4 h-4 animate-spin" />Rota hazırlanıyor...</>
            )}
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
  onStart:      () => void;
  onCancel:     () => void;
  routeReady:   boolean;
  /** GPS fix geçerli mi — false ise Start butonu disabled + "GPS Sinyali Yok" */
  gpsValid?:    boolean;
  speedKmh?:    number;
  speedLimitKmh?: number;
  onNavTab?: (id: string) => void;
}

export const NavigationHUD = memo(function NavigationHUD({
  onStart,
  onCancel,
  routeReady,
  gpsValid = true,
  speedKmh = 0,
  speedLimitKmh = 50,
}: NavigationHUDProps) {
  const location = useGPSLocation();
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

  // ── Durum türetmeleri ─────────────────────────────────────────
  const isActiveNav   = status === NavStatus.ACTIVE || status === NavStatus.REROUTING;
  const isShowPreview = status === NavStatus.PREVIEW || status === NavStatus.ROUTING;
  const isShowArrived = status === NavStatus.ARRIVED;
  const isShowError   = status === NavStatus.ERROR;

  const currentStep   = route.steps[route.currentStepIndex];
  const nextStep      = route.steps[route.currentStepIndex + 1];

  // distanceMeters=0 on first GPS tick — fall back to total route distance so NavInfoBar
  // never shows "0 m / 0 dk" right after navigation starts.
  const effectiveDist = (distanceMeters && distanceMeters > 10)
    ? distanceMeters
    : route.totalDistanceMeters;

  const displayEta = route.totalDurationSeconds > 0
    ? Math.round(route.totalDurationSeconds * Math.min(1, effectiveDist / Math.max(1, route.totalDistanceMeters)))
    : (etaSeconds ?? 0);

  const lanes = currentStep ? buildLanes(currentStep.maneuverModifier) : null;

  return (
    <>
      {/* ═══ ACTIVE / REROUTING — navigasyon overlay'leri ═══ */}
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
              <SpeedPanel speedKmh={speedKmh} speedLimitKmh={speedLimitKmh} />
              {lanes &&
               route.distanceToNextTurnMeters > 0 &&
               route.distanceToNextTurnMeters < 250 && (
                <LaneGuidance lanes={lanes} />
              )}
            </>
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

      {/* ═══ PREVIEW / ROUTING — rota önizlemesi ═══ */}
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

      {/* ═══ ARRIVED — hedefe varış overlay'i (5 s) ═══ */}
      {isShowArrived && destination && (
        <ArrivalOverlay destName={destination.name} />
      )}

      {/* ═══ ERROR — hata overlay'i ═══ */}
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
    </>
  );
});
