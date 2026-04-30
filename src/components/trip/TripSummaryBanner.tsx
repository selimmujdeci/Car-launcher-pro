/**
 * TripSummaryBanner — Yolculuk tamamlandığında ekranın alt kısmından
 * kayan özet kartı.
 *
 * Özellikler:
 *  - Mesafe, süre, ortalama hız, sürüş skoru, yakıt maliyeti
 *  - "Detayları Gör" → triplog drawer'ını açar
 *  - Kapat düğmesi veya 12s sonra otomatik kapanır
 */

import { useEffect, useRef } from 'react';
import { MapPin, Clock, Gauge, Star, Fuel, ChevronRight, X } from 'lucide-react';
import type { TripRecord } from '../../platform/tripLogService';

interface Props {
  trip:          TripRecord;
  onClose:       () => void;
  onViewDetails: () => void;
}

const AUTO_CLOSE_MS = 12_000;

/* ── Sürüş skoru rengi ───────────────────────────────────── */
function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

/* ── Bileşen ─────────────────────────────────────────────── */

export function TripSummaryBanner({ trip, onClose, onViewDetails }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onClose]);

  return (
    <div
      className={[
        'fixed bottom-[calc(var(--lp-dock-h,68px)+16px)] left-1/2 -translate-x-1/2',
        'z-[9980] w-[min(92vw,26rem)] pointer-events-auto',
        'animate-slide-up',
      ].join(' ')}
      role="status"
      aria-label="Yolculuk özeti"
    >
      <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-md bg-gray-900/92">

        {/* Üst başlık şeridi */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-white/8">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
              Yolculuk Tamamlandı
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
            aria-label="Kapat"
          >
            <X size={14} />
          </button>
        </div>

        {/* İstatistik grid */}
        <div className="grid grid-cols-3 gap-px bg-white/5 border-b border-white/8">
          <StatCell icon={<MapPin size={13} />} value={`${trip.distanceKm} km`} label="Mesafe" />
          <StatCell icon={<Clock size={13} />} value={`${trip.durationMin} dk`} label="Süre" />
          <StatCell icon={<Gauge size={13} />} value={`${trip.avgSpeedKmh} km/s`} label="Ort. Hız" />
        </div>

        {/* Alt bilgiler + butonlar */}
        <div className="flex items-center justify-between px-4 py-3 gap-3">
          <div className="flex items-center gap-3 text-xs text-white/50">
            {/* Sürüş skoru */}
            <span className="flex items-center gap-1">
              <Star size={12} className={scoreColor(trip.drivingScore)} />
              <span className={`font-semibold ${scoreColor(trip.drivingScore)}`}>
                {trip.drivingScore}
              </span>
              <span>/100</span>
            </span>
            {/* Yakıt maliyeti */}
            {trip.fuelCostTL > 0 && (
              <span className="flex items-center gap-1">
                <Fuel size={12} />
                <span>₺{trip.fuelCostTL}</span>
              </span>
            )}
          </div>

          <button
            onClick={() => { onClose(); onViewDetails(); }}
            className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors shrink-0"
          >
            Detaylar
            <ChevronRight size={13} />
          </button>
        </div>

      </div>
    </div>
  );
}

/* ── Küçük stat hücresi ──────────────────────────────────── */

function StatCell({
  icon, value, label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-3 px-2 bg-gray-900/80">
      <div className="flex items-center gap-1 text-white/40">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-sm font-bold text-white">{value}</span>
    </div>
  );
}
