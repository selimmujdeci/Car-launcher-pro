/**
 * DriveHUD — AGAMA Z-Focus Ergonomi Şeridi
 *
 * Sürücü Tarama Hiyerarşisi (Z-Odağı Prensibi):
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  [HIZ] ← Z-sol  |  [NAV YÖNÜ] ← Z-merkez  |  [MÜZİK] │
 *   └─────────────────────────────────────────────────────────┘
 *        ↑ Birincil         ↑ İkincil              ↑ Üçüncül
 *
 * Mimari kararlar:
 *   - Hız: useFusedSpeed() → RAF-interpole edilmiş görsel değer
 *     (OBD'den 3 Hz gelse bile 60 fps'de akıcı hareket)
 *   - Navigasyon: aktif rota varsa tur talimatı gösterilir
 *   - Medya: sağda compact — dikkat dağıtmaz, bilgi sunar
 *   - data-z-focus attribute'ları → sunlight-mode CSS hedefleme
 *   - useOBDState() kaldırıldı → useOBDHeadlights() + useFusedSpeed()
 *     ile surgical re-render (tüm OBD nesnesi gereksiz)
 */

import { memo } from 'react';
import { SkipBack, SkipForward, Play, Pause, Navigation } from 'lucide-react';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useAutoBrightnessState } from '../../platform/autoBrightnessService';
import { useFusedSpeed } from '../../platform/speedFusion';
import { useOBDHeadlights } from '../../platform/obdService';

export const DriveHUD = memo(function DriveHUD() {
  const { data } = useFusedSpeed();
  const hudMedia      = useMediaState();
  const autoBrightness = useAutoBrightnessState();
  const headlights    = useOBDHeadlights();

  const isNightPhase = autoBrightness.phase === 'night'
    || autoBrightness.phase === 'evening'
    || autoBrightness.phase === 'dawn';

  // Navigasyon bilgisi — mediaService üzerinden veya placeholder
  const hasTrack    = !!(hudMedia.track.title);
  const isPlaying   = hudMedia.playing;

  return (
    <div data-drive-hud="main" className="flex-shrink-0 relative z-25 px-3">
      <div className="mb-1.5 px-4 py-2.5 rounded-2xl border border-white/[0.08] flex items-center gap-3 bg-[rgba(5,8,18,0.96)] backdrop-blur-[12px]">

        {/* ── Z-Odak 1: HIZ — Birincil Odak Noktası ────── */}
        {/* Sayı: data.speed (anlık raw) — lerp KULLANILMAZ */}
        <div
          data-z-focus="speed"
          className="flex items-baseline gap-1 flex-shrink-0 min-w-[80px]"
          aria-label={`Hız: ${data.speed} km/h`}
        >
          <span
            data-z-focus="speed"
            className="font-black text-white tabular-nums leading-none text-[clamp(2rem,4vw,2.5rem)] tracking-[-1px]"
          >
            {data.speed}
          </span>
          <span
            data-z-focus="unit"
            className="text-blue-400 font-bold uppercase tracking-wide self-end mb-0.5 text-[0.6rem]"
          >
            km/h
          </span>
        </div>

        {/* Kaynak göstergesi — GPS/OBD/Fused */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: data.plausibilityWarning
                ? '#f59e0b'
                : data.source === 'fused' ? '#34d399'
                : data.source === 'obd'   ? '#60a5fa'
                : data.source === 'gps'   ? '#a78bfa'
                : 'rgba(255,255,255,0.2)',
            }}
            title={data.source}
          />
          {headlights && (
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Farlar açık" />
          )}
        </div>

        <div className="w-px h-8 bg-white/10 flex-shrink-0" />

        {/* ── Z-Odak 2: NAVİGASYON / PARÇA — İkincil Odak ─ */}
        {/* Merkez: aktif parça bilgisi veya navigasyon talimatı */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {hasTrack ? (
            <div className="flex-1 min-w-0">
              <div
                data-z-focus="track-title"
                className="text-white font-bold truncate leading-tight text-[clamp(0.75rem,1.8vw,0.875rem)]"
              >
                {hudMedia.track.title}
              </div>
              <div
                data-z-focus="track-artist"
                className="text-white/60 text-xs truncate mt-0.5 font-semibold"
              >
                {hudMedia.track.artist || '\u00a0'}
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
              <span className="text-white/50 text-xs font-semibold truncate">Navigasyon Bekleniyor</span>
            </div>
          )}
        </div>

        {/* ── Z-Odak 3: MEDYA KONTROLLERI — Üçüncül ─────── */}
        {/* Sağda kompakt; dokunmatik için yeterli boyut */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={previous}
            className="w-8 h-8 rounded-xl flex items-center justify-center active:scale-95 transition-transform bg-white/[0.07] border border-white/10"
            aria-label="Önceki parça"
          >
            <SkipBack className="w-3.5 h-3.5 text-slate-300" />
          </button>

          <button
            onClick={togglePlayPause}
            className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
            style={{
              background: isPlaying
                ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
                : 'rgba(59,130,246,0.20)',
              border: '1px solid rgba(59,130,246,0.35)',
              boxShadow: isPlaying ? '0 2px 12px rgba(59,130,246,0.40)' : 'none',
            }}
            aria-label={isPlaying ? 'Durdur' : 'Oynat'}
          >
            {isPlaying
              ? <Pause className="w-4 h-4 text-white fill-current" />
              : <Play  className="w-4 h-4 text-white fill-current" />
            }
          </button>

          <button
            onClick={next}
            className="w-8 h-8 rounded-xl flex items-center justify-center active:scale-95 transition-transform bg-white/[0.07] border border-white/10"
            aria-label="Sonraki parça"
          >
            <SkipForward className="w-3.5 h-3.5 text-slate-300" />
          </button>
        </div>

        {/* Gece fazı göstergesi */}
        {isNightPhase && (
          <span
            className="flex-shrink-0 text-sm leading-none select-none opacity-60"
            aria-label="Gece modu aktif"
          >
            🌙
          </span>
        )}
      </div>
    </div>
  );
});
