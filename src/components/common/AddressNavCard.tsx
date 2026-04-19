/**
 * AddressNavCard — serbest adres navigasyon durumu kartı.
 *
 * Faz                UI
 * ─────────────────────────────────────────────────────
 * searching       Dönen ikon + "X için aranıyor..."
 * selecting       Sonuç listesi (maks 4) — dokunarak seç
 * confirmed       Yeşil onay + "X için rota başlatıldı"
 * error           Kırmızı + hata mesajı + öneri chipleri
 */
import { memo } from 'react';
import { Navigation2, MapPin, X, Loader2, CheckCircle2, AlertCircle, Fuel, ParkingSquare } from 'lucide-react';
import {
  useAddressNavState,
  selectAddressResult,
  dismissAddressNav,
  resolveAndNavigate,
  type AddressNavPhase,
} from '../../platform/addressNavigationEngine';
import type { GeoResult } from '../../platform/geocodingService';

/* ── Phase colour helpers ────────────────────────────────── */

function phaseStyle(phase: AddressNavPhase): string {
  switch (phase) {
    case 'searching': return 'border-blue-500/30  bg-blue-500/10';
    case 'selecting': return 'border-white/20      bg-white/[0.07]';
    case 'confirmed': return 'border-emerald-500/30 bg-emerald-500/10';
    case 'error':     return 'border-red-500/30    bg-red-500/10';
    default:          return '';
  }
}

/* ── Searching ───────────────────────────────────────────── */

const Searching = memo(function Searching({ query }: { query: string }) {
  return (
    <div className="flex items-center gap-3">
      <Loader2 className="w-5 h-5 text-blue-400 animate-spin flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-primary text-sm font-semibold truncate">{query}</p>
        <p className="text-slate-400 text-xs">Rota aranıyor…</p>
      </div>
    </div>
  );
});

/* ── Selecting ───────────────────────────────────────────── */

const ResultRow = memo(function ResultRow({ result, index }: { result: GeoResult; index: number }) {
  const isGas     = result.type === 'fuel';
  const isParking = result.type === 'parking';
  const Icon      = isGas ? Fuel : isParking ? ParkingSquare : MapPin;

  return (
    <button
      type="button"
      className="flex items-start gap-3 w-full px-3 py-2.5 rounded-xl hover:var(--panel-bg-secondary) active:bg-white/15 text-left transition-colors"
      onClick={() => selectAddressResult(index)}
    >
      <Icon className="w-4 h-4 mt-0.5 text-blue-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-primary text-sm font-semibold truncate">{result.name}</p>
        {result.distanceKm != null && (
          <p className="text-slate-400 text-xs">{result.distanceKm} km uzakta</p>
        )}
        {result.distanceKm == null && result.fullName !== result.name && (
          <p className="text-slate-400 text-xs truncate">
            {result.fullName.split(',').slice(1, 3).join(',').trim()}
          </p>
        )}
      </div>
    </button>
  );
});

const Selecting = memo(function Selecting({ query, results }: { query: string; results: GeoResult[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-1 pb-1.5 mb-1 border-b border-white/10">
        <Navigation2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <p className="text-slate-300 text-xs font-medium truncate">
          "{query}" için {results.length} sonuç — seçin
        </p>
      </div>
      <div className="space-y-0.5">
        {results.slice(0, 4).map((r, i) => (
          <ResultRow key={r.id} result={r} index={i} />
        ))}
      </div>
    </div>
  );
});

/* ── Confirmed ───────────────────────────────────────────── */

const Confirmed = memo(function Confirmed({ query }: { query: string }) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-primary text-sm font-semibold truncate">{query}</p>
        <p className="text-emerald-400 text-xs">Rota başlatıldı</p>
      </div>
    </div>
  );
});

/* ── Error ───────────────────────────────────────────────── */

const ErrorState = memo(function ErrorState({
  message,
  suggestions,
}: {
  message: string;
  suggestions: string[];
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        <p className="text-red-300 text-sm font-medium">{message}</p>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="text-xs px-2.5 py-1 rounded-full var(--panel-bg-secondary) border border-white/15 text-slate-300 hover:bg-white/15"
              onClick={() => resolveAndNavigate(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/* ── Root ────────────────────────────────────────────────── */

export const AddressNavCard = memo(function AddressNavCard() {
  const { phase, query, results, selected, errorMessage, suggestions } = useAddressNavState();

  if (phase === 'idle') return null;

  const displayQuery = selected?.name ?? query;

  return (
    <div
      className={`mx-4 mb-2 rounded-2xl border backdrop-blur-md px-4 py-3 relative transition-all duration-300 z-40 ${phaseStyle(phase)}`}
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}
    >
      {/* Kapat butonu */}
      <button
        type="button"
        className="absolute top-2 right-2 p-1 rounded-full hover:var(--panel-bg-secondary) text-slate-500 hover:text-primary transition-colors"
        onClick={dismissAddressNav}
        aria-label="Kapat"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {phase === 'searching' && <Searching query={query} />}
      {phase === 'selecting' && <Selecting query={query} results={results} />}
      {phase === 'confirmed' && <Confirmed query={displayQuery} />}
      {phase === 'error'     && (
        <ErrorState message={errorMessage ?? 'Sonuç bulunamadı'} suggestions={suggestions} />
      )}
    </div>
  );
});


