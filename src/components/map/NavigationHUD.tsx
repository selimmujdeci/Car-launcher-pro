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
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import {
  memo, useState, useCallback, useEffect, useRef, type ReactNode,
} from 'react';
import {
  MapPin, Home, Briefcase, Fuel, ChevronDown, Star, Plus, Trash2,
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
import { useSafetyStore } from '../../store/useSafetyStore';
import { startSafetyObserver, stopSafetyObserver } from '../../platform/safetyService';
import { useHazardStore, type HazardType } from '../../store/useHazardStore';
import { useCognitiveStore } from '../../store/useCognitiveStore';

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

/* ── Tehlike banner etiketi ──────────────────────────────── */

const HAZARD_LABELS_HUD: Record<HazardType, string> = {
  CONSTRUCTION: 'YOL ÇALIŞMASI',
  ACCIDENT:     'KAZA',
  WEATHER:      'HAVA KOŞULLARI',
  SPEED_CAM:    'HIZLI GEÇİŞ',
  ROAD_DAMAGE:  'YOL HASARI',
  TUNNEL:       'TÜNEL',
};

/* ── HazardBanner — üst merkez, sadece PREPARE/ATTENTION ────── */

const HazardBanner = memo(function HazardBanner() {
  const hazardStatus    = useHazardStore((s) => s.hazardStatus);
  const activeHazards   = useHazardStore((s) => s.activeHazards);
  const hazardIntensity = useHazardStore((s) => s.hazardIntensity);
  // Sadece location — object yerine tek field subscribe
  const vehicleLoc      = useUnifiedVehicleStore((s) => s.location);
  const cogMode         = useCognitiveStore((s) => s.currentMode);
  const hideCrmBadge    = cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME';

  if (hazardStatus !== 'PREPARE' && hazardStatus !== 'ATTENTION') return null;
  if (activeHazards.length === 0) return null;

  // En yüksek yoğunluklu tehlikeyi seç
  const topEntry = Object.entries(hazardIntensity).sort((a, b) => b[1] - a[1])[0];
  const topHazard = topEntry
    ? activeHazards.find((h) => h.id === topEntry[0])
    : activeHazards[0];
  if (!topHazard) return null;

  const label = HAZARD_LABELS_HUD[topHazard.type] ?? 'TEHLİKE';

  // Araç–tehlike düz-mesafe tahmini
  let distLabel = '';
  if (vehicleLoc) {
    const dLat = (vehicleLoc.latitude  - topHazard.lat) * 111_320;
    const cosL = Math.cos(topHazard.lat * Math.PI / 180);
    const dLng = (vehicleLoc.longitude - topHazard.lng) * 111_320 * cosL;
    const distM = Math.sqrt(dLat * dLat + dLng * dLng);
    distLabel = distM < 1000
      ? `${Math.round(distM / 50) * 50} m`
      : `${(distM / 1000).toFixed(1)} km`;
  }

  const isAttention = hazardStatus === 'ATTENTION';

  return (
    <div
      className="absolute z-30 pointer-events-none flex flex-col items-center"
      style={{ top: 'calc(var(--sat, 0px) + 72px)', left: '50%', transform: 'translateX(-50%)' }}
    >
      {/* Amber pulse + topluluk mavi-pulse keyframe'leri */}
      <style>{`
        @keyframes _hzPulse {
          0%,100% { box-shadow:0 0 16px rgba(245,158,11,.30); }
          50%      { box-shadow:0 0 32px rgba(245,158,11,.60); }
        }
        @keyframes _crmPulse {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
      `}</style>

      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            10,
          padding:        '7px 18px',
          borderRadius:   14,
          background:     'rgba(8,9,14,0.84)',
          border:         `1.5px solid ${isAttention ? 'rgba(245,158,11,0.75)' : 'rgba(245,158,11,0.35)'}`,
          backdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px))',
          animation:      isAttention ? '_hzPulse 1.6s ease-in-out infinite' : 'none',
        }}
      >
        <span style={{ fontSize: 14, color: '#f59e0b', lineHeight: 1 }}>⚠</span>
        <span style={{
          fontSize:      11,
          fontWeight:    900,
          letterSpacing: '0.18em',
          color:         '#fbbf24',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
        {topHazard.isCommunity && !hideCrmBadge && (
          <span style={{
            display:       'flex',
            alignItems:    'center',
            gap:           4,
            fontSize:      9,
            fontWeight:    700,
            letterSpacing: '0.12em',
            color:         'rgba(96,165,250,0.85)',
            textTransform: 'uppercase',
          }}>
            {/* Düşük GPU maliyetli opacity animasyonu — MALI-400 güvenli */}
            <span style={{
              width:        6,
              height:       6,
              borderRadius: '50%',
              background:   '#60a5fa',
              display:      'inline-block',
              animation:    '_crmPulse 2s ease-in-out infinite',
            }} />
            Topluluk
          </span>
        )}
        {distLabel && (
          <span style={{
            fontSize:      11,
            fontWeight:    700,
            letterSpacing: '0.08em',
            color:         'rgba(255,255,255,0.50)',
          }}>
            {distLabel}
          </span>
        )}
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── LimpHomeHUD — Hayatta Kalma Modu, GPU ~%0 ────────────── */
/* ══════════════════════════════════════════════════════════ */
// MALI-400 safe: saf div/span, animasyon yok, SVG filtre yok, box-shadow yok.
// Sadece hız (devasa) + dönüş oku + kritik mesafe. OBD ve navigasyon akışı kesilmez.

const LimpHomeHUD = memo(function LimpHomeHUD({
  speedKmh, currentStep, distToTurn, onStop,
}: {
  speedKmh:    number;
  currentStep: RouteStep | undefined;
  distToTurn:  number;
  onStop:      () => void;
}) {
  return (
    <div style={{
      position:       'absolute',
      inset:          0,
      zIndex:         50,
      display:        'flex',
      flexDirection:  'column',
      background:     '#000000',
      color:          '#ffffff',
      paddingTop:     'var(--sat, 0px)',
    }}>
      {/* Dönüş bilgisi — yüksek kontrast sarı */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        gap:           16,
        padding:       '16px 20px',
        borderBottom:  '1px solid #222222',
      }}>
        <div style={{
          background:    '#facc15',
          borderRadius:  6,
          padding:       '10px 14px',
          flexShrink:    0,
          color:         '#000000',
          lineHeight:    0,
        }}>
          <FuturistArrow
            mod={currentStep?.maneuverModifier ?? 'straight'}
            type={currentStep?.maneuverType   ?? 'straight'}
            size="md"
          />
        </div>
        <div>
          <div style={{
            fontSize:      40,
            fontWeight:    900,
            color:         '#facc15',
            fontFamily:    'monospace',
            lineHeight:    1,
            letterSpacing: '-0.02em',
          }}>
            {currentStep ? fmtTurn(distToTurn) : '—'}
          </div>
          <div style={{
            fontSize:      13,
            fontWeight:    700,
            color:         '#d1d5db',
            marginTop:     4,
            textTransform: 'uppercase',
            letterSpacing: '0.10em',
          }}>
            {currentStep
              ? toTurkish(currentStep.maneuverModifier, currentStep.maneuverType)
              : 'Navigasyon devam ediyor'}
          </div>
        </div>
      </div>

      {/* Hız — ekranın merkezinde devasa */}
      <div style={{
        flex:           1,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
      }}>
        <span style={{
          fontSize:      120,
          fontWeight:    900,
          fontFamily:    'monospace',
          color:         '#ffffff',
          lineHeight:    1,
          letterSpacing: '-0.04em',
        }}>
          {Math.round(speedKmh)}
        </span>
        <span style={{
          fontSize:      16,
          fontWeight:    700,
          color:         '#4b5563',
          marginTop:     8,
          letterSpacing: '0.25em',
        }}>
          KM/H
        </span>
      </div>

      {/* Alt çubuk — koruma modu etiketi + sonlandır */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '14px 20px',
        borderTop:      '1px solid #222222',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width:        8,
            height:       8,
            borderRadius: '50%',
            background:   '#facc15',
            flexShrink:   0,
          }} />
          <span style={{
            fontSize:      11,
            fontWeight:    700,
            color:         '#facc15',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
          }}>
            KORUMA MODU AKTİF
          </span>
        </div>
        <button
          onClick={onStop}
          style={{
            padding:       '8px 16px',
            borderRadius:  6,
            background:    'transparent',
            border:        '1px solid #ef4444',
            color:         '#ef4444',
            fontWeight:    700,
            fontSize:      11,
            textTransform: 'uppercase',
            letterSpacing: '0.10em',
            cursor:        'pointer',
          }}
        >
          SONLANDIR
        </button>
      </div>
    </div>
  );
});

/* ── FadeMount — kognitif mod bastırma için smooth unmount ───────────────── */
// visible false olduğunda 150ms opacity geçişi → sonra tamamen unmount (MALI-400).
// Absolute-positioned children'ların layout'unu etkilemez (wrapper position:static).

function FadeMount({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(visible);
  const [opacity, setOpacity] = useState(visible ? 1 : 0);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setOpacity(1));
      return () => cancelAnimationFrame(raf);
    }
    setOpacity(0);
    const t = setTimeout(() => setMounted(false), 150);
    return () => clearTimeout(t);
  }, [visible]);
  if (!mounted) return null;
  return <div style={{ opacity, transition: 'opacity 150ms ease' }}>{children}</div>;
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
/* ── LaneArrow — OEM cinematic lane hint ───────────────── */
/* ══════════════════════════════════════════════════════════ */
// Per screens.jsx 428-447 — 56×56 rounded tile, amber gradient + line-warm border
// when active, surface-2 + line when inactive.

function LaneArrow({ dir, active }: { dir: 'left' | 'right' | 'straight'; active?: boolean }) {
  const rot = dir === 'left' ? -90 : dir === 'right' ? 90 : 0;
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 10,
      background: active
        ? 'linear-gradient(135deg, oklch(82% 0.10 65 / 0.32), oklch(60% 0.10 50 / 0.10))'
        : 'var(--oem-surface-2, rgba(48,55,73,0.55))',
      border: '1px solid ' + (active
        ? 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))'
        : 'var(--oem-line, rgba(255,240,210,0.08))'),
      color: active ? 'var(--oem-amber, oklch(80% 0.13 60))' : 'var(--oem-ink-3, rgba(240,235,224,0.52))',
      display: 'grid', placeItems: 'center',
      boxShadow: active
        ? '0 0 20px oklch(70% 0.10 60 / 0.30), 0 1px 0 rgba(255,240,210,0.10) inset'
        : '0 1px 0 rgba(255,240,210,0.04) inset',
    }}>
      <svg viewBox="0 0 24 24" style={{ width: 17, height: 17, transform: `rotate(${rot}deg)`, color: 'currentColor' }}>
        <path d="M12 4v16M6 10l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* ── LaneGuidance — derive arrows from current step ────── */
// 3 arrows (left, straight, right) with the matching direction(s) active.
function LaneGuidance({ step }: { step: RouteStep }) {
  const mod = step.maneuverModifier ?? '';
  const t   = step.maneuverType ?? '';
  if (t === 'arrive') return null;
  const goesLeft  = mod.includes('left');
  const goesRight = mod.includes('right');
  const goesStr   = !goesLeft && !goesRight;
  return (
    <div
      className="oem-glass rounded-[1.5rem]"
      style={{
        padding: '10px 14px',
        background: 'var(--oem-surface-1, rgba(38,44,60,0.78))',
        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
        boxShadow: 'var(--oem-shadow-card, 0 24px 48px -22px rgba(0,0,0,0.55))',
      }}>
      <div className="text-[10px] font-black uppercase tracking-[0.20em] mb-2"
        style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
        Şerit Yönlendirme
      </div>
      <div className="flex gap-2 justify-center">
        <LaneArrow dir="left"     active={goesLeft} />
        <LaneArrow dir="straight" active={goesStr} />
        <LaneArrow dir="right"    active={goesRight} />
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════ */
/* ── TurnPanel — OEM Cinematic Glass ─────────────────────── */
/* ══════════════════════════════════════════════════════════ */
// Per screens.jsx lines 340-358 — amber gradient icon box, 34px distance,
// 19px street name (font-medium), "Sonra X km düz devam" subtitle.

const TurnPanel = memo(function TurnPanel({
  step, distToTurn, nextStep, hazardActive = false,
}: {
  step: RouteStep; distToTurn: number; nextStep?: RouteStep; hazardActive?: boolean;
}) {
  const isArrive = step.maneuverType === 'arrive';
  const turnLabel = isArrive ? '—' : fmtTurn(distToTurn);

  // "Sonra X km düz devam" — next-step continuation hint
  const continuation = nextStep && !isArrive && nextStep.distance > 0
    ? fmtTurn(nextStep.distance)
    : null;

  return (
    <div
      className="absolute z-30 pointer-events-none flex flex-col gap-3"
      style={{
        left: 'max(16px, var(--sal, 0px))',
        top: 'calc(var(--sat, 0px) + 14px)',
        width: 288,
        maxWidth: 'calc(100vw - 2 * 16px)',
      }}
    >
      {/* Ana dönüş kartı — OEM glass + amber icon tile */}
      <div
        className="oem-glass rounded-[1.5rem] overflow-hidden"
        style={{
          padding: '14px 18px',
          background: 'var(--oem-surface-1, rgba(38,44,60,0.78))',
          border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
          boxShadow: 'var(--oem-shadow-raised, 0 32px 64px -26px rgba(0,0,0,0.65))',
          backdropFilter: 'blur(calc(var(--rt-blur, 1) * 20px)) saturate(120%)',
          WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 20px)) saturate(120%)',
        }}
      >
        <div className="flex items-center gap-3 mb-2.5">
          {/* Icon tile — amber gradient (hazard → warmer deep) */}
          <div
            style={{
              width: 46, height: 46, borderRadius: 14,
              background: isArrive
                ? 'linear-gradient(135deg, oklch(78% 0.13 158 / 0.32), oklch(48% 0.13 158 / 0.10))'
                : hazardActive
                  ? 'linear-gradient(135deg, oklch(72% 0.14 35 / 0.34), oklch(50% 0.13 30 / 0.12))'
                  : 'linear-gradient(135deg, oklch(82% 0.10 65 / 0.30), oklch(60% 0.10 50 / 0.10))',
              border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
              display: 'grid', placeItems: 'center',
              color: isArrive
                ? 'oklch(78% 0.13 158)'
                : hazardActive
                  ? 'oklch(80% 0.14 50)'
                  : 'var(--oem-amber, oklch(80% 0.13 60))',
              boxShadow: '0 0 24px oklch(70% 0.10 60 / 0.18), 0 1px 0 rgba(255,240,210,0.10) inset',
              flexShrink: 0,
              transition: 'background 0.8s ease, color 0.8s ease',
            }}
          >
            <FuturistArrow mod={step.maneuverModifier} type={step.maneuverType} size="sm" />
          </div>
          {/* Distance + maneuver label */}
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.20em] leading-none"
              style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
              {isArrive ? 'HEDEF' : `${turnLabel} sonra`}
            </div>
            <h3 className="text-white tabular-nums mt-1"
              style={{
                fontSize: 21,
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
              }}>
              {toTurkish(step.maneuverModifier, step.maneuverType)}
            </h3>
          </div>
        </div>

        {/* Street name — 19px font-medium */}
        {step.streetName && (
          <div className="truncate"
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: 'var(--oem-ink, #F0EBE0)',
              letterSpacing: '-0.005em',
            }}>
            {step.streetName}
          </div>
        )}

        {/* "Sonra X km düz devam" hint */}
        {continuation && nextStep && (
          <div className="flex items-center gap-3 mt-3 pt-3"
            style={{ borderTop: '1px solid var(--oem-line, rgba(255,240,210,0.08))' }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
                color: 'var(--oem-ink-3, rgba(240,235,224,0.52))',
              }}>
              <FuturistArrow mod={nextStep.maneuverModifier} type={nextStep.maneuverType} size="xs" />
            </div>
            <span className="text-[14px] truncate" style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
              Sonra <span className="font-bold" style={{ color: 'var(--oem-ink, #F0EBE0)' }}>{continuation}</span>{' '}
              {nextStep.streetName
                ? <>üzerinde <span className="font-bold" style={{ color: 'var(--oem-ink, #F0EBE0)' }}>{nextStep.streetName}</span></>
                : 'düz devam'}
            </span>
          </div>
        )}
      </div>

      {/* Şerit yönlendirme — derive from current step direction */}
      <LaneGuidance step={step} />
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


/* LaneGuidance bileşeni kaldırıldı — ekranı dağıtıyordu, TurnPanel yeterli rehberlik sağlıyor */


/* ══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════ */
/* ── SafetyTensionBar — fren + reaksiyon mesafesi göstergesi */
/* ══════════════════════════════════════════════════════════ */

/**
 * Sürücüye "görünmez durma mesafesini" ve eğri uyarısını sezgisel olarak gösterir.
 * Mavi → reaksiyon  |  Amber/Kırmızı → fren yolu
 * CAUTION / INTERVENTION → önerilen güvenli hız etiketi gösterilir.
 */
const SafetyTensionBar = memo(function SafetyTensionBar() {
  const brakingDistanceM  = useSafetyStore((s) => s.brakingDistanceM);
  const reactionDistanceM = useSafetyStore((s) => s.reactionDistanceM);
  const isCritical        = useSafetyStore((s) => s.isBrakingCritical);
  const safetyState       = useSafetyStore((s) => s.safetyState);
  const recommendedSpeed  = useSafetyStore((s) => s.recommendedSpeedKmh);

  const totalM    = brakingDistanceM + reactionDistanceM;
  if (totalM < 1) return null;

  const MAX_REF    = 150;
  const totalFrac  = Math.min(1, totalM / MAX_REF);
  const rxFrac     = reactionDistanceM / totalM;
  const isCaution  = safetyState === 'CAUTION';
  const isIntv     = safetyState === 'INTERVENTION';

  // Eğri uyarısı: CAUTION/INTERVENTION → önerilen hız etiketi
  const showCurveWarn = (isCaution || isIntv) && recommendedSpeed > 0;
  const warnColor     = isIntv ? '#ef4444' : '#f59e0b';

  return (
    <div style={{ width: 82, paddingTop: 6 }}>
      {/* Eğri uyarısı etiketi — CAUTION/INTERVENTION */}
      {showCurveWarn ? (
        <div style={{
          fontSize:      8,
          fontWeight:    900,
          textAlign:     'center',
          letterSpacing: '0.10em',
          color:         warnColor,
          marginBottom:  3,
          fontFamily:    'monospace',
        }}>
          MAX {Math.round(recommendedSpeed)} km/h
        </div>
      ) : (
        <div style={{
          fontSize:      8,
          fontWeight:    700,
          textAlign:     'center',
          letterSpacing: '0.12em',
          color:         isCritical ? '#fca5a5' : 'rgba(255,255,255,0.30)',
          marginBottom:  3,
          fontFamily:    'monospace',
        }}>
          {Math.round(totalM)}m DUR
        </div>
      )}

      {/* Tension bar */}
      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          height:     '100%',
          width:      `${totalFrac * 100}%`,
          display:    'flex',
          transition: 'width 0.35s ease',
        }}>
          <div style={{
            flex:       rxFrac,
            background: '#3b82f6',
            transition: 'flex 0.35s ease',
          }} />
          <div style={{
            flex:       1 - rxFrac,
            background: isCritical ? '#ef4444' : '#f59e0b',
            transition: 'flex 0.35s ease, background 0.35s ease',
          }} />
        </div>
      </div>

      {/* Segment etiketleri / eğri durumunda tek etiket */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {showCurveWarn ? (
          <span style={{
            fontSize:      7,
            color:         warnColor,
            fontWeight:    900,
            letterSpacing: '0.08em',
            fontFamily:    'monospace',
            width:         '100%',
            textAlign:     'center',
          }}>
            {isIntv ? '⚠ YAVAŞLA' : '↓ EĞRİ'}
          </span>
        ) : (
          <>
            <span style={{ fontSize: 7, color: '#3b82f6', fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'monospace' }}>
              REA
            </span>
            <span style={{ fontSize: 7, color: isCritical ? '#ef4444' : '#f59e0b', fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'monospace' }}>
              FRN
            </span>
          </>
        )}
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════ */
/* ── RiskOverlay — INTERVENTION tam-ekran kırmızı çerçeve ── */
/* ══════════════════════════════════════════════════════════ */

/**
 * INTERVENTION durumunda ekran kenarlarına nabız atan kırmızı çerçeve.
 * GPU hızlandırmalı opacity animasyonu — box-shadow yok, render maliyeti sıfır.
 */
const RiskOverlay = memo(function RiskOverlay() {
  const safetyState = useSafetyStore((s) => s.safetyState);
  if (safetyState !== 'INTERVENTION') return null;

  return (
    <>
      <style>{`
        @keyframes _riskHeartbeat {
          0%, 100% { opacity: 0.08; }
          30%       { opacity: 0.38; }
          60%       { opacity: 0.15; }
        }
      `}</style>
      <div
        className="pointer-events-none"
        style={{
          position:        'fixed',
          inset:           0,
          zIndex:          9999,
          border:          '4px solid rgba(239,68,68,0.90)',
          animation:       '_riskHeartbeat 1.5s ease-in-out infinite',
          borderRadius:    0,
        }}
      />
    </>
  );
});

/* ── SpeedPanel — futurist-glass, dynamic glow ───────────── */
/* ══════════════════════════════════════════════════════════ */

const SpeedPanel = memo(function SpeedPanel({
  speedKmh, speedLimitKmh,
}: {
  speedKmh: number; speedLimitKmh?: number | null;
}) {
  const hasLimit     = typeof speedLimitKmh === 'number' && speedLimitKmh > 0;
  const overSpeed    = hasLimit && speedKmh > (speedLimitKmh as number) + 5;
  const roundedSpeed = Math.round(speedKmh);
  const safetyState  = useSafetyStore((s) => s.safetyState);

  const isCaution = safetyState === 'CAUTION';
  const isIntv    = safetyState === 'INTERVENTION';

  // Glow önceliği: aşım > intervention > caution > normal
  // Normal durum: sakin cam (renkli glow YOK) — OEM dili. Uyarı durumları semantik kalır.
  const glowClass = overSpeed
    ? 'futurist-glow-red animate-futurist-pulse'
    : isIntv
      ? 'futurist-glow-red'
      : isCaution
        ? 'futurist-glow-amber'
        : '';

  // Hız rakamı rengi: intervention/aşım → kırmızı, caution → amber, normal → beyaz
  const digitColor = (overSpeed || isIntv) ? '#f87171'
    : isCaution ? '#fbbf24'
    : '#ffffff';

  return (
    <div
      className="absolute right-4 z-30 pointer-events-none flex flex-col items-center gap-2.5"
      style={{ top: 'calc(var(--sat, 0px) + 80px)' }}
    >
      {/* Hız göstergesi — futurist-glass + dinamik glow */}
      <div
        className={`futurist-glass flex flex-col items-center px-4 py-2.5 rounded-[1.25rem] ${glowClass}`}
        style={{ minWidth: 76 }}
      >
        <span
          className="font-black tabular-nums leading-none futurist-text-glow"
          style={{
            fontSize:      38,
            color:         digitColor,
            letterSpacing: '-0.05em',
            transition:    'color 0.4s ease',
          }}
        >
          {roundedSpeed}
        </span>
        <span className="text-slate-400 font-black uppercase tracking-[0.2em] text-[10px] mt-1 opacity-60">
          KM/H
        </span>

        {/* Safety Tension Bar — fren + reaksiyon mesafesi */}
        <SafetyTensionBar />
      </div>

      {/* Hız limiti tabelası — sadece geçerli bir limit varsa göster (boş tabela hiç çizilmesin) */}
      {hasLimit && (
        <div className="w-[52px] h-[52px] rounded-full flex items-center justify-center bg-white border-[5px] border-red-600 shadow-[0_8px_32px_rgba(0,0,0,0.6)] border-glow-red">
          <span className="text-black font-black text-[19px] tracking-[-0.02em]">
            {speedLimitKmh}
          </span>
        </div>
      )}
    </div>
  );
});


/* ══════════════════════════════════════════════════════════ */
/* ── NavInfoBar — futurist-gradient-dark, glowing progress ─ */
/* ══════════════════════════════════════════════════════════ */

const NavInfoBar = memo(function NavInfoBar({
  etaSeconds, remainingMeters, totalMeters, onStop, isOffline, compact = false, limp = false,
}: {
  etaSeconds: number; remainingMeters: number; totalMeters: number; onStop: () => void;
  isOffline?: boolean;
  /** CRITICAL modda: yalnızca MESAFE + VARIŞ + SONLANDIR kalır */
  compact?: boolean;
  /** LIMP_HOME modda: sadece MESAFE + SONLANDIR */
  limp?: boolean;
}) {
  const arrival    = new Date(Date.now() + etaSeconds * 1_000);
  const arrivalStr = `${arrival.getHours().toString().padStart(2, '0')}:${arrival.getMinutes().toString().padStart(2, '0')}`;
  const progress   = totalMeters > 0 ? Math.max(0, Math.min(1, 1 - remainingMeters / totalMeters)) : 0;
  const fuelPct    = useUnifiedVehicleStore(s => s.fuel);

  const fuelColor = fuelPct == null ? 'var(--oem-ink-3, rgba(240,235,224,0.52))'
    : fuelPct > 25 ? 'var(--oem-good, oklch(80% 0.10 158))'
    : fuelPct > 10 ? '#f59e0b'
    : '#ef4444';

  // Format distance into number + unit for the cinematic two-tone style
  const distFmt = formatDistance(remainingMeters);
  const distMatch = distFmt.match(/^([\d.,]+)\s*(\S+)$/);
  const distNum  = distMatch ? distMatch[1] : distFmt;
  const distUnit = distMatch ? distMatch[2] : '';

  return (
    <div
      className="absolute z-30 pointer-events-auto rounded-[1.75rem] overflow-hidden"
      style={{
        bottom: 'env(safe-area-inset-bottom, 0px)',
        left:   '50%',
        transform: 'translateX(-50%)',
        maxWidth: 720,
        width:    'calc(100% - 32px)',
        background: 'var(--oem-surface-1, rgba(38,44,60,0.78))',
        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
        backdropFilter: 'blur(calc(var(--rt-blur, 1) * 22px)) saturate(120%)',
        WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 22px)) saturate(120%)',
        boxShadow: '0 -20px 50px rgba(0,0,0,0.55), 0 1px 0 rgba(255,240,210,0.10) inset',
      }}
    >
      {/* Glowing progress bar — top edge */}
      <div className="h-[4px] bg-white/[0.04] relative overflow-hidden">
        <div
          className="h-full transition-all duration-1000 relative z-10"
          style={{
            width: `${progress * 100}%`,
            background: 'linear-gradient(90deg, oklch(72% 0.11 55), oklch(86% 0.10 70))',
            boxShadow: '0 0 15px var(--oem-amber-glow, rgba(224,162,60,0.4))',
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: 'linear-gradient(90deg, transparent, var(--oem-amber-soft, rgba(224,162,60,0.3)), transparent)' }}
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

      {/* 3-column ETA strip — Varış | Mesafe | Varışta yakıt + stop button */}
      <div className="flex items-center gap-4 px-5 py-3">
        {/* Column 1: Varış (Arrival time) */}
        {!limp && (
          <>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] leading-none"
                style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                Varış
              </span>
              <span className="tabular-nums mt-2"
                style={{
                  fontSize: 'clamp(22px, 3.0vw, 31px)',
                  fontWeight: 300,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  color: 'var(--oem-ink, #F0EBE0)',
                }}>
                {arrivalStr}
              </span>
            </div>
            <div className="h-[38px] w-px" style={{ background: 'var(--oem-line-strong, rgba(255,240,210,0.18))' }} />
          </>
        )}

        {/* Column 2: Mesafe (Distance) */}
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-black uppercase tracking-[0.22em] leading-none"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
            Mesafe
          </span>
          <span className="tabular-nums mt-2"
            style={{
              fontSize: 'clamp(28px, 4.2vw, 42px)',
              fontWeight: 300,
              lineHeight: 1,
              letterSpacing: '-0.02em',
              color: 'var(--oem-ink, #F0EBE0)',
            }}>
            {distNum}
            {distUnit && (
              <span style={{ fontSize: 16, color: 'var(--oem-ink-3, rgba(240,235,224,0.52))', marginLeft: 4 }}>
                {distUnit}
              </span>
            )}
          </span>
        </div>

        {/* Column 3: Varışta yakıt (Battery/Fuel at arrival) — hidden in compact/limp */}
        {!compact && !limp && (
          <>
            <div className="h-[38px] w-px" style={{ background: 'var(--oem-line-strong, rgba(255,240,210,0.18))' }} />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] leading-none"
                style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                Varışta yakıt
              </span>
              <span className="tabular-nums mt-2"
                style={{
                  fontSize: 'clamp(22px, 3.0vw, 31px)',
                  fontWeight: 300,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  color: fuelColor,
                }}>
                {fuelPct != null ? `%${Math.round(fuelPct)}` : '—'}
              </span>
            </div>
          </>
        )}

        {/* SÜRE (etaSeconds) — kompakt/limp dışı, alanı doldur */}
        {!compact && !limp && (
          <span className="hidden lg:inline text-[11px] font-bold ml-2"
            style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
            ≈ {formatEta(etaSeconds)}
          </span>
        )}

        <div className="flex-1" />

        {/* Stop button — keep functionality intact */}
        <button
          onClick={onStop}
          aria-label="Navigasyonu sonlandır"
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.28)',
            color: '#fca5a5',
          }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});


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
      <div className="futurist-glass futurist-glow-amber flex items-center gap-4 px-5 py-4 rounded-[1.75rem]">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(160deg,#E0A23C,#C9831A)' }}
        >
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#1A140A' }} />
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-white font-black text-[22px] leading-tight tracking-[-0.02em] uppercase tracking-widest">
            Yeniden Rotalanıyor…
          </span>
          <span className="font-bold text-sm mt-0.5" style={{ color: '#E0A23C' }}>Yeni rota hesaplanıyor</span>
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

  const altsRef  = useRef<HTMLDivElement | null>(null);

  const chipLabels = ['En Hızlı', 'Alternatif 1', 'Alternatif 2'];

  return (
    <div
      className="absolute inset-x-4 z-30 pointer-events-auto animate-in zoom-in-95 fade-in duration-500"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 20px)' }}
    >
      <div className="rounded-[2.5rem] p-6 overflow-hidden relative shadow-[0_40px_80px_rgba(0,0,0,0.7)] bg-[rgba(8,12,22,0.95)] backdrop-blur-[28px] border border-white/10">
        <div className="absolute top-0 left-0 w-full h-1 rounded-t-[2.5rem]"
          style={{ background: 'linear-gradient(90deg, #C9831A, #E0A23C, #C9831A)' }} />

        <div className="flex items-start gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(224,162,60,0.12)', border: '1px solid rgba(224,162,60,0.28)' }}>
            <MapPin className="w-7 h-7" style={{ color: '#E0A23C' }} />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="text-white font-black text-2xl truncate leading-tight tracking-tight">{destName}</div>
            {loading && (
              <div className="flex items-center gap-2 text-sm mt-2 font-bold uppercase tracking-widest"
                style={{ color: 'rgba(224,162,60,0.75)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Rota planlanıyor…</span>
              </div>
            )}
            {!loading && !error && distMeters > 0 && (
              <div className="text-slate-400 text-sm mt-2 font-bold uppercase tracking-widest flex items-center gap-3">
                <span className="text-white">{formatDistance(distMeters)}</span>
                <span className="w-1 h-1 rounded-full bg-slate-700" />
                <span style={{ color: '#E0A23C' }}>{formatEta(durSeconds)}</span>
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
              <div className="flex-shrink-0 flex flex-col gap-0.5 px-3 py-2.5 rounded-2xl border min-w-[110px]"
                style={{ background: 'rgba(224,162,60,0.10)', borderColor: 'rgba(224,162,60,0.45)', boxShadow: '0 4px 16px rgba(224,162,60,0.22)' }}>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#E0A23C' }}>{chipLabels[0]}</span>
                  {hasToll && <AlertCircle className="w-3 h-3 text-amber-300 flex-shrink-0" />}
                </div>
                <span className="text-sm font-black text-white leading-tight">{formatDistance(distMeters)}</span>
                <span className="text-[11px] font-bold" style={{ color: 'rgba(224,162,60,0.85)' }}>{formatEta(durSeconds)}</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <Fuel className="w-3 h-3 flex-shrink-0" style={{ color: 'rgba(224,162,60,0.75)' }} />
                  <span className="text-[10px] font-bold" style={{ color: 'rgba(224,162,60,0.85)' }}>{computeFuelEstimate(distMeters)} L</span>
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
            disabled
            title="Durak ekleme henüz mevcut değil"
            className="flex-1 py-3.5 rounded-2xl text-slate-500 font-black text-sm uppercase tracking-widest bg-white/[0.03] border border-white/5 opacity-50 cursor-not-allowed"
          >
            Durak Ekle
          </button>
        </div>

        <button
          onClick={onStart}
          disabled={!routeReady || !gpsValid}
          className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          style={{
            color: '#1A140A',
            background: 'linear-gradient(135deg, #E0A23C, #C9831A)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset, 0 12px 30px -12px rgba(224,162,60,0.6)',
          }}
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

function QuickCard({ icon, label, color, onTap, disabled = false, active = false }: {
  icon: ReactNode; label: string; color: string; onTap: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className="flex items-center gap-2 h-8 px-3 rounded-xl active:scale-95 transition-all disabled:opacity-35 backdrop-blur-[18px]"
      style={{
        color,
        background: active ? 'rgba(224,162,60,0.18)' : 'rgba(10,14,26,0.28)',
        border:     `1px solid ${active ? 'rgba(224,162,60,0.45)' : 'rgba(255,255,255,0.10)'}`,
      }}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-[10px] font-black uppercase tracking-wider text-slate-200 truncate max-w-[90px]">{label}</span>
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
  // safeStorage: eMMC throttle + kota/LRU koruması (5s debounce — DEĞİŞTİRİLMEDİ).
  try { safeSetRaw(_FUEL_KEY, JSON.stringify({ items, cachedAt: Date.now() } satisfies _FuelCache)); } catch { /* quota */ }
}

function _nearestCached(lat: number, lon: number): (_FuelItem & { fromCache: true }) | null {
  try {
    const raw = safeGetRaw(_FUEL_KEY);
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
  const recentDestinations = useStore(s => s.settings.recentDestinations);
  const homeLocation       = useStore(s => s.settings.homeLocation);
  const workLocation       = useStore(s => s.settings.workLocation);
  const customLocations    = useStore(s => s.settings.customLocations ?? []);
  const updateSettings     = useStore(s => s.updateSettings);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelError, setFuelError]     = useState('');
  const [customOpen, setCustomOpen]   = useState(false);
  const [addError, setAddError]       = useState('');

  const navigate = useCallback((dest: Address) => {
    startNavigation(dest);
    const entry = { lat: dest.latitude, lng: dest.longitude, name: dest.name, timestamp: Date.now() };
    updateSettings({
      recentDestinations: [
        entry,
        ...(recentDestinations ?? []).filter(d => d.name !== dest.name),
      ].slice(0, 5),
    });
  }, [recentDestinations, updateSettings]);

  const setHome = useCallback(() => {
    if (!gpsLat || !gpsLon) return;
    updateSettings({ homeLocation: { lat: gpsLat, lng: gpsLon, name: 'Ev' } });
  }, [gpsLat, gpsLon, updateSettings]);

  const setWork = useCallback(() => {
    if (!gpsLat || !gpsLon) return;
    updateSettings({ workLocation: { lat: gpsLat, lng: gpsLon, name: 'İş' } });
  }, [gpsLat, gpsLon, updateSettings]);

  const addCurrentLocation = useCallback(() => {
    if (!gpsLat || !gpsLon) {
      setAddError('GPS sinyali yok');
      setTimeout(() => setAddError(''), 2500);
      return;
    }
    const ts   = Date.now();
    const name = `Konum ${customLocations.length + 1}`;
    const next = [
      { id: `loc-${ts}`, lat: gpsLat, lng: gpsLon, name, timestamp: ts },
      ...customLocations,
    ].slice(0, 20);
    updateSettings({ customLocations: next });
  }, [gpsLat, gpsLon, customLocations, updateSettings]);

  const removeCustomLocation = useCallback((id: string) => {
    updateSettings({ customLocations: customLocations.filter(l => l.id !== id) });
  }, [customLocations, updateSettings]);

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
        <QuickCard
          icon={fuelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fuel className="w-3.5 h-3.5" />}
          label="Benzinlik" color="#E0A23C" onTap={handleFuel} disabled={!gpsLat || fuelLoading} />
        {workLocation ? (
          <QuickCard icon={<Briefcase className="w-3.5 h-3.5" />} label="İş" color="#E0A23C"
            onTap={() => navigate({ id: 'work', name: 'İş', latitude: workLocation.lat, longitude: workLocation.lng, type: 'history', category: 'work' })} />
        ) : (
          <QuickCard icon={<Briefcase className="w-3.5 h-3.5" />} label="İş Ayarla" color="#475569" onTap={setWork} disabled={!gpsLat} />
        )}
        {homeLocation ? (
          <QuickCard icon={<Home className="w-3.5 h-3.5" />} label="Ev" color="#E0A23C"
            onTap={() => navigate({ id: 'home', name: 'Ev', latitude: homeLocation.lat, longitude: homeLocation.lng, type: 'history', category: 'home' })} />
        ) : (
          <QuickCard icon={<Home className="w-3.5 h-3.5" />} label="Ev Ayarla" color="#475569" onTap={setHome} disabled={!gpsLat} />
        )}
        <QuickCard
          icon={<Star className="w-3.5 h-3.5" />}
          label="Özel Konumlar"
          color="#E0A23C"
          active={customOpen}
          onTap={() => setCustomOpen(v => !v)}
        />

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

      {/* Özel Konumlar paneli */}
      {customOpen && (
        <div
          className="absolute left-full ml-2 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-left-2 duration-200"
          style={{
            bottom:        0,
            width:         260,
            maxHeight:     320,
            background:    'rgba(10,14,26,0.45)',
            backdropFilter:'blur(22px)',
            border:        '1px solid rgba(255,255,255,0.10)',
            boxShadow:     '0 20px 50px rgba(0,0,0,0.5)',
          }}
        >
          {/* Başlık */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <Star className="w-3.5 h-3.5" style={{ color: '#E0A23C' }} />
              <span className="text-[11px] font-black uppercase tracking-widest text-white">
                Özel Konumlar
              </span>
            </div>
            <button
              onClick={() => setCustomOpen(false)}
              aria-label="Kapat"
              className="w-6 h-6 rounded-lg flex items-center justify-center active:scale-90 transition-all bg-white/[0.04] border border-white/[0.06]"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>

          {/* Konum Ekle butonu */}
          <button
            onClick={addCurrentLocation}
            disabled={!gpsLat || !gpsLon}
            className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(224,162,60,0.08)' }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(224,162,60,0.18)', border: '1px solid rgba(224,162,60,0.35)' }}>
              <Plus className="w-4 h-4" style={{ color: '#E0A23C' }} />
            </div>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[12px] font-black uppercase tracking-wider leading-none" style={{ color: '#E8B86A' }}>
                Konum Ekle
              </span>
              <span className="text-[9px] font-bold text-slate-400 mt-1">
                Bulunduğun yeri kaydet
              </span>
            </div>
          </button>

          {addError && (
            <div className="mx-2 mt-2 px-2 py-1 rounded-lg text-[10px] font-mono text-center bg-red-900/60 border border-red-700/50 text-red-300">
              {addError}
            </div>
          )}

          {/* Liste */}
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {customLocations.length === 0 ? (
              <div className="px-3 py-5 text-center">
                <MapPin className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Henüz kayıtlı konum yok
                </span>
              </div>
            ) : (
              customLocations.map((loc) => (
                <div
                  key={loc.id}
                  className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]"
                >
                  <button
                    onClick={() => {
                      navigate({
                        id:        loc.id,
                        name:      loc.name,
                        latitude:  loc.lat,
                        longitude: loc.lng,
                        type:      'history',
                      });
                      setCustomOpen(false);
                    }}
                    className="flex-1 flex items-center gap-2 min-w-0 active:scale-[0.98] transition-all text-left"
                  >
                    <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(224,162,60,0.10)', border: '1px solid rgba(224,162,60,0.20)' }}>
                      <MapPin className="w-3 h-3" style={{ color: '#E0A23C' }} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] font-black text-white truncate leading-none">
                        {loc.name}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500 mt-1 truncate">
                        {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => removeCustomLocation(loc.id)}
                    aria-label="Sil"
                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-red-500/10 border border-red-500/15"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
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
  onNavTab?:  (id: string) => void;
}

export const NavigationHUD = memo(function NavigationHUD({
  onStart,
  onCancel,
  routeReady,
  gpsValid = true,
}: NavigationHUDProps) {
  // Hız kaynağı: UnifiedVehicleStore.speed — worker SAB-polling (EMA + zero-hold +
  // anti-jitter) ile beslenir, worker stale olunca GPS location.speed'den devralınır.
  // Ham, filtresiz location.speed * 3.6 KULLANILMAZ (anlık 0 / spike sorunu).
  const speedKmh = useUnifiedVehicleStore((s) => s.speed) ?? 0;
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

  // Safety observer lifecycle — bileşen mount'ta başlar, unmount'ta durur
  useEffect(() => {
    startSafetyObserver();
    return () => stopSafetyObserver();
  }, []);

  // Phase H4 — Hazard state (selective subscription, minimal re-render)
  const hazardStatus    = useHazardStore((s) => s.hazardStatus);
  const isHazardAttn    = hazardStatus === 'ATTENTION';

  // CL2 — Kognitif bastırma bayrakları
  const cogMode     = useCognitiveStore((s) => s.currentMode);
  const suppFocused = cogMode !== 'IMMERSIVE' && cogMode !== 'AWARE'; // FOCUSED|CRITICAL|LIMP_HOME
  const suppCrit    = cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME';
  const isLimp      = cogMode === 'LIMP_HOME';

  // LIMP_HOME — tek seferlik otoriter TTS bildirimi
  useEffect(() => {
    if (isLimp) {
      speakNavigation('Sistem koruma modu aktif. Navigasyon sürdürülüyor.');
    }
  }, [isLimp]);

  // ── Sesli yönlendirme — kademeli yaklaşım anonsları (saha fix 2026-06-12) ──
  // ESKİDEN yalnız adım DEĞİŞİNCE konuşuyordu = anons dönüşün üzerinden geçerken
  // geliyordu; sürücü "sağa dön / sola dön" uyarısını hiç duymuyordu.
  // Şimdi Google tarzı üç kademe (her adım için en fazla 1'er kez):
  //   ~500 m → "500 metre sonra sağa dönün"
  //   ~200 m → "200 metre sonra sağa dönün"
  //   ~60 m  → "Şimdi sağa dönün"
  // Kademeler bitmask ile adım başına kilitlenir; adım değişince sıfırlanır.
  // Mesafe useRouteState'ten her GPS tick'inde gelir (TurnPanel ile aynı kaynak).
  const _spokenRef = useRef<{ step: number; tiers: number }>({ step: -1, tiers: 0 });
  useEffect(() => {
    if (!isActiveNav || isRerouting || !currentStep) return;
    const d = route.distanceToNextTurnMeters;
    if (!Number.isFinite(d) || d <= 0) return;

    if (_spokenRef.current.step !== route.currentStepIndex) {
      _spokenRef.current = { step: route.currentStepIndex, tiers: 0 };
    }
    const s = _spokenRef.current;
    // Talimatı cümle ortasına uydur: "Sağa dönün" → "sağa dönün"
    const inst = currentStep.instruction.charAt(0).toLowerCase() + currentStep.instruction.slice(1);

    if (d <= 80 && !(s.tiers & 4)) {
      s.tiers |= 4 | 2 | 1; // yakın kademede uzaktakiler de kapanır (üst üste konuşmaz)
      speakNavigation(`Şimdi ${inst}`);
    } else if (d <= 250 && !(s.tiers & 2)) {
      s.tiers |= 2 | 1;
      speakNavigation(`${Math.round(d / 50) * 50} metre sonra ${inst}`);
    } else if (d <= 600 && !(s.tiers & 1)) {
      s.tiers |= 1;
      speakNavigation(`${Math.round(d / 50) * 50} metre sonra ${inst}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.distanceToNextTurnMeters, route.currentStepIndex, isRerouting]);

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
      {/* ═══ S4: INTERVENTION tam-ekran risk çerçevesi ═══ */}
      <RiskOverlay />

      {/* ═══ ACTIVE / REROUTING ═══ */}
      {isActiveNav && (
        <>
          {/* LIMP_HOME: standart HUD'un üzerine gelen minimal hayatta kalma overlay */}
          {isLimp && (
            <LimpHomeHUD
              speedKmh={speedKmh}
              currentStep={currentStep}
              distToTurn={route.distanceToNextTurnMeters}
              onStop={handleStop}
            />
          )}

          {isRerouting && <ReroutingBanner />}

          {/* Tehlike Banner — PREPARE / ATTENTION durumunda görünür */}
          <HazardBanner />

          {!isRerouting && currentStep && (
            <>
              <TurnPanel
                step={currentStep}
                distToTurn={route.distanceToNextTurnMeters}
                nextStep={isLimp ? undefined : nextStep}
                hazardActive={isHazardAttn}
              />
              <FadeMount visible={!suppCrit}>
                <RoadSignsPanel
                  streetName={currentStep.streetName}
                  destName={destination?.name}
                />
              </FadeMount>
              {/* LaneGuidance kaldırıldı — ekranı dağıtıyordu, TurnPanel zaten dönüş yönünü gösteriyor */}
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

          {/* Alternatif rotalar butonu + paneli — FOCUSED+ modda gizlenir */}
          {!isRerouting && !suppFocused && route.alternatives.length > 0 && (
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
                          <GitBranch className="w-4 h-4" style={{ color: '#E0A23C' }} />
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
                <GitBranch className="w-4 h-4" style={{ color: '#E0A23C' }} />
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
            compact={suppCrit}
            limp={isLimp}
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

      {/* Aktif nav sırasında sol kısayollar gösterilmez — ekran sürüş bilgisine odaklanmalı.
       * EV/İŞ/BENZİNLİK kartları yalnızca IDLE durumunda anlamlı (rota başlatma için). */}
    </>
  );
});
