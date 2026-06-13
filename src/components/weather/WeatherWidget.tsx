import { memo, useCallback } from 'react';
import {
  CloudSun, RefreshCw, MapPin, Wind, Droplets,
  Thermometer, Fuel, Star, X,
} from 'lucide-react';
import {
  useWeatherState,
  refreshWeather, refreshFuelPrices,
  type FuelStation,
} from '../../platform/weatherService';

/* ── Wind direction ──────────────────────────────────────── */

function windDir(deg: number): string {
  const dirs = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  return dirs[Math.round(deg / 45) % 8];
}

/* ── Fuel station card ───────────────────────────────────── */

const StationCard = memo(function StationCard({ s }: { s: FuelStation }) {
  return (
    <div className={`flex-shrink-0 w-52 rounded-2xl border p-4 flex flex-col gap-3 ${
      s.isCheapest
        ? 'bg-[var(--oem-good-soft)] border-[var(--oem-good)]'
        : 'bg-[var(--oem-surface-2)] border-[var(--oem-line)]'
    } ${!s.isOpen ? 'opacity-50' : ''}`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-base leading-none">{s.emoji}</span>
            {s.isCheapest && (
              <Star className="w-3 h-3 text-[color:var(--oem-good)] fill-[var(--oem-good)]" />
            )}
          </div>
          <div className="text-[color:var(--oem-ink)] text-xs font-bold leading-snug">{s.name}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[color:var(--oem-ink-3)] text-[10px]">{s.distanceKm} km</div>
          <div className={`text-[10px] font-bold mt-0.5 ${s.isOpen ? 'text-[color:var(--oem-good)]' : 'text-[color:var(--oem-danger)]'}`}>
            {s.isOpen ? 'Açık' : 'Kapalı'}
          </div>
        </div>
      </div>

      {/* Prices */}
      <div className="flex flex-col gap-1.5">
        <PriceLine label="Benzin 95" price={s.gasolinePrice} highlight={s.isCheapest} />
        <PriceLine label="Motorin"   price={s.dieselPrice}   />
        {s.lpgPrice != null && <PriceLine label="LPG" price={s.lpgPrice} color="amber" />}
      </div>
    </div>
  );
});

function PriceLine({
  label, price, highlight = false, color = 'blue',
}: {
  label: string; price: number; highlight?: boolean; color?: 'blue' | 'amber';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[color:var(--oem-ink-3)] text-[10px]">{label}</span>
      <span className={`text-sm font-black tabular-nums ${
        highlight ? 'text-[color:var(--oem-good)]' : color === 'amber' ? 'text-[color:var(--oem-warn)]' : 'text-[color:var(--oem-ink)]'
      }`}>
        {price.toFixed(2)}₺
      </span>
    </div>
  );
}

/* ── Main widget ─────────────────────────────────────────── */

function WeatherWidgetInner() {
  const ws = useWeatherState();
  const w  = ws.weather;

  const handleRefresh = useCallback(() => {
    refreshWeather().catch(() => undefined);
  }, []);

  const handleRefreshFuel = useCallback(() => {
    refreshFuelPrices().catch(() => undefined);
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4 pb-6" data-editable="weather-card" data-editable-type="card">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CloudSun className="w-5 h-5 text-[color:var(--oem-warn)]" />
          <span className="text-[color:var(--oem-ink)] font-black text-base uppercase tracking-widest">
            Hava &amp; Yakıt
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={ws.isLoadingWeather}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--oem-surface-2)] text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)] transition-colors active:scale-90"
        >
          <RefreshCw className={`w-4 h-4 ${ws.isLoadingWeather ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Weather card ────────────────────────────────────── */}
      {ws.isLoadingWeather && !w ? (
        <WeatherSkeleton />
      ) : w ? (
        <div
          className="rounded-2xl border border-[var(--oem-line)] p-5 overflow-hidden relative"
          style={{ background: 'linear-gradient(135deg, var(--oem-surface-2) 0%, var(--oem-info-soft) 100%)' }}
        >
          <div className="relative z-10">
            {/* City + location source */}
            <div className="flex items-center gap-1.5 mb-3">
              <MapPin className="w-3.5 h-3.5 text-[color:var(--oem-info)]" />
              <span className="text-[color:var(--oem-info)] text-xs font-bold">{w.city}</span>
              {ws.locationSource === 'gps' && (
                <span className="text-[color:var(--oem-good)] text-[9px] border border-[var(--oem-good)] rounded px-1 py-0.5 uppercase tracking-wider font-bold opacity-80">GPS</span>
              )}
              {ws.locationSource === 'user_city' && (
                <span className="text-[color:var(--oem-warn)] text-[9px] border border-[var(--oem-warn)] rounded px-1 py-0.5 uppercase tracking-wider font-bold opacity-80">Şehir</span>
              )}
              {ws.lastUpdated && (
                <span className="text-[color:var(--oem-ink-3)] text-[10px] ml-auto">
                  {new Date(ws.lastUpdated).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>

            {/* Temp + emoji */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[color:var(--oem-ink)] font-black text-5xl tabular-nums leading-none">
                  {w.temperature}°
                </div>
                <div className="text-[color:var(--oem-ink-2)] text-sm mt-1">{w.description}</div>
                <div className="text-[color:var(--oem-ink-3)] text-xs mt-0.5">
                  Hissedilen {w.feelsLike}°C
                </div>
              </div>
              <div className="text-6xl leading-none select-none">{w.emoji}</div>
            </div>

            {/* Details row */}
            <div className="flex gap-4 mt-4 pt-3 border-t border-[var(--oem-line)]">
              <Detail icon={Droplets}    label="Nem"     value={`${w.humidity}%`}       color="text-[color:var(--oem-info)]" />
              <Detail icon={Wind}        label="Rüzgar"  value={`${w.windSpeed} km/s ${windDir(w.windDirection)}`} color="text-[color:var(--oem-ink-2)]" />
              <Detail icon={Thermometer} label="Hissedilen" value={`${w.feelsLike}°C`} color="text-[color:var(--oem-warn)]" />
            </div>
          </div>
        </div>
      ) : (
        <WeatherEmpty onRetry={handleRefresh} error={ws.error} />
      )}

      {/* ── Fuel prices ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Fuel className="w-4 h-4 text-[color:var(--oem-warn)]" />
            <span className="text-[color:var(--oem-ink-2)] text-xs font-bold uppercase tracking-widest">
              Yakın İstasyonlar
            </span>
          </div>
          <button
            onClick={handleRefreshFuel}
            disabled={ws.isLoadingFuel}
            className="text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)] text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${ws.isLoadingFuel ? 'animate-spin' : ''}`} />
            Güncelle
          </button>
        </div>

        {ws.isLoadingFuel ? (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex-shrink-0 w-52 h-36 rounded-2xl bg-[var(--oem-surface-3)] animate-pulse" />
            ))}
          </div>
        ) : ws.stations.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {ws.stations.map((s) => (
              <StationCard key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <div className="text-[color:var(--oem-ink-3)] text-sm text-center py-8">
            Yakın istasyon bulunamadı
          </div>
        )}

        <p className="text-[color:var(--oem-ink-3)] text-[10px] text-center mt-3 leading-relaxed">
          Fiyatlar Türkiye EPDK ortalaması baz alınarak hesaplanmaktadır.
          Gerçek fiyatlar farklılık gösterebilir.
        </p>
      </div>

      {/* Error */}
      {ws.error && (
        <div className="bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] rounded-xl p-3 text-[color:var(--oem-danger)] text-sm flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {ws.error}
        </div>
      )}
    </div>
  );
}

/* ── Helper sub-components ───────────────────────────────── */

function Detail({
  icon: Icon, label, value, color,
}: {
  icon: typeof Wind; label: string; value: string; color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <div>
        <div className="text-[color:var(--oem-ink-3)] text-[9px] uppercase tracking-wide">{label}</div>
        <div className="text-[color:var(--oem-ink)] text-xs font-bold">{value}</div>
      </div>
    </div>
  );
}

function WeatherSkeleton() {
  return (
    <div className="rounded-2xl border border-[var(--oem-line)] p-5 bg-[var(--oem-surface-2)] animate-pulse">
      <div className="h-3 w-24 rounded bg-[var(--oem-surface-3)] mb-4" />
      <div className="h-12 w-28 rounded bg-[var(--oem-surface-3)] mb-2" />
      <div className="h-3 w-36 rounded bg-[var(--oem-surface-3)] mb-1" />
      <div className="h-3 w-28 rounded bg-[var(--oem-surface-3)]" />
    </div>
  );
}

function WeatherEmpty({ onRetry, error }: { onRetry: () => void; error: string | null }) {
  return (
    <div className="rounded-2xl border border-[var(--oem-line)] p-8 flex flex-col items-center gap-3 text-center bg-[var(--oem-surface-2)]">
      <span className="text-5xl">🌡️</span>
      <div className="text-[color:var(--oem-ink-3)] text-sm">{error ?? 'Hava durumu yüklenemedi'}</div>
      <button
        onClick={onRetry}
        className="text-[color:var(--oem-info)] text-xs font-bold uppercase tracking-widest hover:opacity-80 transition-colors"
      >
        Tekrar Dene
      </button>
    </div>
  );
}

export const WeatherWidget = memo(WeatherWidgetInner);


