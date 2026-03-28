/**
 * NavigationHUD — araç navigasyon UI katmanı.
 *
 * Dört alt bileşenden oluşur:
 *   TurnCard          — sürüş sırasında bir sonraki dönüş talimatı (üst)
 *   NavInfoBar        — kalan süre / mesafe / varış saati (alt)
 *   PreviewCard       — rota önizlemesi, "Başlat" / "İptal" (alt)
 *   QuickDestinations — navigasyon yokken hızlı hedef kartları (alt)
 */
import { memo, useState, useCallback, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, RotateCcw, RefreshCw,
  MapPin, Navigation2, Home, Briefcase, Clock,
  Fuel, Play, X, Loader2, AlertCircle,
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

/* ── Dönüş ok ikonu ───────────────────────────────────────── */

function TurnArrow({
  mod, type, size = 'lg',
}: {
  mod: string; type: string; size?: 'lg' | 'sm';
}) {
  const cls = size === 'lg' ? 'w-12 h-12' : 'w-4 h-4';
  if (type === 'arrive')                            return <MapPin        className={cls} />;
  if (type === 'depart')                            return <Navigation2   className={`${cls} fill-current`} />;
  if (type === 'roundabout' || type === 'rotary')   return <RefreshCw     className={cls} />;
  if (mod === 'uturn')                              return <RotateCcw     className={cls} />;
  if (mod.includes('right'))                        return <ArrowRight    className={cls} />;
  if (mod.includes('left'))                         return <ArrowLeft     className={cls} />;
  return <ArrowUp className={cls} />;
}

/* ── Mesafe formatlayıcı (turn card için) ─────────────────── */

function fmtTurn(m: number): string {
  if (m <  20)   return 'ŞİMDİ';
  if (m < 100)   return `${Math.round(m / 10) * 10}m`;
  if (m < 1000)  return `${Math.round(m / 50) * 50}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/* ── Yakın benzinlik araması (Overpass) ───────────────────── */

async function findNearbyFuel(
  lat: number,
  lon: number,
): Promise<{ name: string; lat: number; lon: number } | null> {
  try {
    const q   = `[out:json][timeout:5];node[amenity=fuel](around:5000,${lat},${lon});out 1;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const data = await res.json();
    if (!data.elements?.length) return null;
    const el = data.elements[0];
    return { name: el.tags?.name || 'Benzin İstasyonu', lat: el.lat, lon: el.lon };
  } catch {
    return null;
  }
}

/* ── TurnCard ─────────────────────────────────────────────── */

const TurnCard = memo(function TurnCard({
  step,
  distToTurn,
  nextStep,
  speedKmh = 0,
}: {
  step:       RouteStep;
  distToTurn: number;
  nextStep?:  RouteStep;
  speedKmh?:  number;
}) {
  const isArrive    = step.maneuverType === 'arrive';
  const isHighSpeed = speedKmh > 80;

  return (
    <div className="absolute top-0 inset-x-0 z-30 px-6 pt-4 pointer-events-none animate-in slide-in-from-top duration-700 cubic-bezier(0.16, 1, 0.3, 1)">
      <div className="bg-[#0f172a]/80 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 shadow-[0_40px_80px_rgba(0,0,0,0.6)] px-6 py-5 flex items-center gap-6">

        {/* Dönüş ikonu */}
        <div
          className="w-20 h-20 rounded-[1.75rem] flex items-center justify-center flex-shrink-0 shadow-2xl relative overflow-hidden group"
          style={{
            background: isArrive
              ? 'linear-gradient(135deg, #10b981, #059669)'
              : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          }}
        >
          <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          <TurnArrow mod={step.maneuverModifier} type={step.maneuverType} size="lg" />
        </div>

        {/* Talimat */}
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-xl leading-tight tracking-tight">
            {step.instruction}
          </div>
          {!isHighSpeed && step.streetName && (
            <div className="text-blue-400/80 text-sm font-bold uppercase tracking-widest mt-1">
              {step.streetName}
            </div>
          )}
          {/* Sonraki adım önizleme — yüksek hızda gizle */}
          {!isHighSpeed && nextStep && !isArrive && (
            <div className="flex items-center gap-2 mt-3 bg-white/5 rounded-full px-3 py-1 w-fit border border-white/5">
              <span className="text-slate-500 text-[10px] font-black uppercase tracking-tighter">SONRAKİ:</span>
              <TurnArrow mod={nextStep.maneuverModifier} type={nextStep.maneuverType} size="sm" />
              <span className="text-slate-300 text-[10px] font-bold truncate max-w-[150px]">{nextStep.instruction}</span>
            </div>
          )}
        </div>

        {/* Dönüşe mesafe */}
        {!isArrive && (
          <div className="flex-shrink-0 text-right min-w-[80px] pl-4 border-l border-white/10">
            <div className="text-white font-black text-4xl leading-none tabular-nums tracking-tighter">
              {fmtTurn(distToTurn)}
            </div>
            <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-2">KALAN</div>
          </div>
        )}
      </div>
    </div>
  );
});

/* ── NavInfoBar ────────────────────────────────────────────── */

const NavInfoBar = memo(function NavInfoBar({
  etaSeconds,
  remainingMeters,
  onStop,
  speedKmh = 0,
}: {
  etaSeconds:      number;
  remainingMeters: number;
  onStop:          () => void;
  speedKmh?:       number;
}) {
  const arrival    = new Date(Date.now() + etaSeconds * 1_000);
  const arrivalStr = `${arrival.getHours().toString().padStart(2, '0')}:${arrival.getMinutes().toString().padStart(2, '0')}`;
  const isHighSpeed = speedKmh > 80;

  // Yüksek hız: sadece büyük ETA + hızlı durdur butonu
  if (isHighSpeed) {
    return (
      <div className="absolute bottom-0 inset-x-0 z-30 pointer-events-auto">
        <div className="bg-[#0f172a]/90 backdrop-blur-3xl border-t border-white/10 shadow-[0_-20px_60px_rgba(0,0,0,0.5)] flex items-center gap-4 px-6 py-3">
          <div className="flex-1 flex items-baseline gap-3">
            <span className="text-white font-black text-4xl tabular-nums tracking-tighter leading-none">{formatEta(etaSeconds)}</span>
            <span className="text-slate-500 text-sm font-bold">{formatDistance(remainingMeters)}</span>
          </div>
          <button
            onClick={onStop}
            className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center active:scale-90 transition-transform"
          >
            <X className="w-5 h-5 text-red-400" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-0 inset-x-0 z-30 pointer-events-auto animate-in slide-in-from-bottom duration-700">
      <div className="bg-[#0f172a]/90 backdrop-blur-3xl border-t border-white/10 shadow-[0_-20px_60px_rgba(0,0,0,0.5)] flex items-stretch px-4">

        {/* Kalan süre */}
        <Cell label="Süre"    value={formatEta(etaSeconds)} />
        <Divider />

        {/* Kalan mesafe */}
        <Cell label="Mesafe"  value={formatDistance(remainingMeters)} />
        <Divider />

        {/* Varış saati */}
        <Cell label="Varış"   value={arrivalStr} />

        {/* Navigasyonu bitir */}
        <div className="flex items-center pl-4">
          <button
            onClick={onStop}
            className="group flex flex-col items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all active:scale-90"
          >
            <X className="w-6 h-6 text-red-500 group-hover:scale-110 transition-transform" />
            <span className="text-red-500 text-[9px] font-black uppercase tracking-widest mt-1">BİTİR</span>
          </button>
        </div>
      </div>
    </div>
  );
});

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-5 group cursor-default">
      <span className="text-white font-black text-3xl leading-none tabular-nums group-hover:text-blue-400 transition-colors">{value}</span>
      <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-2">{label}</span>
    </div>
  );
}

function Divider() {
  return <div className="w-px bg-gradient-to-b from-transparent via-white/10 to-transparent my-4 flex-shrink-0" />;
}

/* ── PreviewCard ───────────────────────────────────────────── */

const PreviewCard = memo(function PreviewCard({
  destName,
  distMeters,
  durSeconds,
  loading,
  error,
  onStart,
  onCancel,
}: {
  destName:   string;
  distMeters: number;
  durSeconds: number;
  loading:    boolean;
  error:      string | null;
  onStart:    () => void;
  onCancel:   () => void;
}) {
  return (
    <div className="absolute bottom-6 inset-x-6 z-30 pointer-events-auto animate-in zoom-in-95 fade-in duration-500">
      <div className="bg-[#0f172a]/95 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 shadow-[0_40px_80px_rgba(0,0,0,0.7)] p-6 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500" />

        {/* Hedef bilgisi */}
        <div className="flex items-start gap-4 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
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

        {/* Aksiyon butonları */}
        <div className="flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/10 text-slate-400 font-black text-sm uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
          >
            Vazgeç
          </button>
          <button
            onClick={onStart}
            className="flex-[2] py-4 rounded-2xl bg-blue-600 text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all shadow-[0_10px_30px_rgba(37,99,235,0.4)] hover:bg-blue-500"
          >
            <Play className="w-5 h-5 fill-current" />
            Navigasyonu Başlat
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── QuickCard yardımcı ────────────────────────────────────── */

function QuickCard({
  icon, label, color, onTap, disabled = false,
}: {
  icon:     ReactNode;
  label:    string;
  color:    string;
  onTap:    () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className="flex items-center gap-3 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-[#0f172a]/80 backdrop-blur-2xl border border-white/10 hover:border-white/20 active:scale-95 transition-all disabled:opacity-40 shadow-xl group"
      style={{ color }}
    >
      <div className="transition-transform group-hover:scale-125 duration-300">{icon}</div>
      <span className="truncate max-w-[120px] text-white/90">{label}</span>
    </button>
  );
}

/* ── QuickDestinations ─────────────────────────────────────── */

const QuickDestinations = memo(function QuickDestinations({
  gpsLat, gpsLon,
}: {
  gpsLat: number | null;
  gpsLon: number | null;
}) {
  const { settings, updateSettings } = useStore();
  const [fuelLoading, setFuelLoading] = useState(false);

  /* Navigasyon başlat + son hedefler listesine ekle */
  const navigate = useCallback((dest: Address) => {
    startNavigation(dest);
    const entry = {
      lat: dest.latitude, lng: dest.longitude,
      name: dest.name, timestamp: Date.now(),
    };
    updateSettings({
      recentDestinations: [
        entry,
        ...(settings.recentDestinations ?? []).filter(d => d.name !== dest.name),
      ].slice(0, 5),
    });
  }, [settings, updateSettings]);

  /* GPS konumunu ev olarak kaydet */
  const setHome = useCallback(() => {
    if (!gpsLat || !gpsLon) return;
    updateSettings({ homeLocation: { lat: gpsLat, lng: gpsLon, name: 'Ev' } });
  }, [gpsLat, gpsLon, updateSettings]);

  /* GPS konumunu iş olarak kaydet */
  const setWork = useCallback(() => {
    if (!gpsLat || !gpsLon) return;
    updateSettings({ workLocation: { lat: gpsLat, lng: gpsLon, name: 'İş' } });
  }, [gpsLat, gpsLon, updateSettings]);

  /* Yakın benzinlik ara ve navigasyonu başlat */
  const handleFuel = useCallback(async () => {
    if (!gpsLat || !gpsLon || fuelLoading) return;
    setFuelLoading(true);
    const result = await findNearbyFuel(gpsLat, gpsLon);
    setFuelLoading(false);
    if (result) {
      navigate({
        id:        `fuel-${Date.now()}`,
        name:      result.name,
        latitude:  result.lat,
        longitude: result.lon,
        type:      'history',
      });
    }
  }, [gpsLat, gpsLon, fuelLoading, navigate]);

  return (
    <div className="absolute bottom-28 inset-x-6 z-30 pointer-events-auto animate-in slide-in-from-bottom-4 duration-1000">
      <div className="flex gap-3 flex-wrap">

        {/* Ev */}
        {settings.homeLocation ? (
          <QuickCard
            icon={<Home className="w-5 h-5" />}
            label="EV"
            color="#3b82f6"
            onTap={() => navigate({
              id: 'home', name: 'Ev',
              latitude:  settings.homeLocation!.lat,
              longitude: settings.homeLocation!.lng,
              type: 'history', category: 'home',
            })}
          />
        ) : (
          <QuickCard
            icon={<Home className="w-5 h-5" />}
            label="EV AYARLA"
            color="#475569"
            onTap={setHome}
            disabled={!gpsLat}
          />
        )}

        {/* İş */}
        {settings.workLocation ? (
          <QuickCard
            icon={<Briefcase className="w-5 h-5" />}
            label="İŞ"
            color="#8b5cf6"
            onTap={() => navigate({
              id: 'work', name: 'İş',
              latitude:  settings.workLocation!.lat,
              longitude: settings.workLocation!.lng,
              type: 'history', category: 'work',
            })}
          />
        ) : (
          <QuickCard
            icon={<Briefcase className="w-5 h-5" />}
            label="İŞ AYARLA"
            color="#475569"
            onTap={setWork}
            disabled={!gpsLat}
          />
        )}

        {/* Son hedefler (maks 3) */}
        {(settings.recentDestinations ?? []).slice(0, 3).map((d, i) => (
          <QuickCard
            key={i}
            icon={<Clock className="w-5 h-5" />}
            label={d.name}
            color="#94a3b8"
            onTap={() => navigate({
              id: `recent-${i}`, name: d.name,
              latitude: d.lat, longitude: d.lng,
              type: 'history',
            })}
          />
        ))}

        {/* Yakın benzinlik */}
        <QuickCard
          icon={fuelLoading
            ? <Loader2 className="w-5 h-5 animate-spin" />
            : <Fuel className="w-5 h-5" />
          }
          label="BENZİNLİK"
          color="#f59e0b"
          onTap={handleFuel}
          disabled={!gpsLat || fuelLoading}
        />
      </div>
    </div>
  );
});

/* ── NavigationHUD (ana export) ────────────────────────────── */

interface Props {
  isPreview: boolean;
  onStart:   () => void;
  onCancel:  () => void;
  speedKmh?: number;
}

export const NavigationHUD = memo(function NavigationHUD({
  isPreview,
  onStart,
  onCancel,
  speedKmh = 0,
}: Props) {
  const location = useGPSLocation();
  const { isNavigating, destination, distanceMeters, etaSeconds } = useNavigation();
  const route = useRouteState();

  const handleStop = useCallback(() => {
    stopNavigation();
    clearRoute();
  }, []);

  const isActiveNav   = isNavigating && !isPreview;
  const currentStep   = route.steps[route.currentStepIndex];
  const nextStep      = route.steps[route.currentStepIndex + 1];

  // ETA: OSRM varsa rotaya göre ölçekle, yoksa navigation service hesabı
  const displayEta = route.steps.length > 0
    ? Math.round(
        route.totalDurationSeconds *
        Math.min(1, (distanceMeters ?? 0) / Math.max(1, route.totalDistanceMeters))
      )
    : (etaSeconds ?? 0);

  return (
    <>
      {/* Dönüş kartı — aktif sürüş + rota adımları varken */}
      {isActiveNav && currentStep && (
        <TurnCard
          step={currentStep}
          distToTurn={route.distanceToNextTurnMeters}
          nextStep={nextStep}
          speedKmh={speedKmh}
        />
      )}

      {/* Navigasyon bilgi çubuğu — aktif sürüş */}
      {isActiveNav && (
        <NavInfoBar
          etaSeconds={displayEta}
          remainingMeters={distanceMeters ?? 0}
          onStop={handleStop}
          speedKmh={speedKmh}
        />
      )}

      {/* Rota önizlemesi — navigasyon başlatıldı ama henüz sürüş değil */}
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

      {/* Hızlı hedefler — navigasyon yokken */}
      {!isNavigating && !isPreview && (
        <QuickDestinations
          gpsLat={location?.latitude  ?? null}
          gpsLon={location?.longitude ?? null}
        />
      )}
    </>
  );
});
