/**
 * NavigationHUD — Mercedes MBUX Futurist Design Language
 *
 * Bileşenler:
 *   TurnPanel        — üst sol: futurist-glass + SVG ok + mesafe + sokak
 *   LaneGuidance     — alt orta: manevra tipine göre dinamik şerit rehberi
 *   SpeedPanel       — sağ: futurist-glass, limit aşımında glow-red + pulse
 *   NavInfoBar       — alt: futurist-gradient-dark, glowing progress bar
 *   PreviewCard      — rota önizlemesi
 *   QuickDestinations — hızlı hedef kartları
 */
import '../../styles/ultra-premium-global.css';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import {
  memo, useState, useCallback, useEffect, useRef, useMemo, type ReactNode,
} from 'react';
import {
  MapPin, Home, Briefcase, Fuel, Star, Plus, Trash2,
  Play, X, Loader2, AlertCircle, CheckCircle2, GitBranch,
} from 'lucide-react';
import {
  useNavigation,
  startNavigation,
  endNavigation,
  formatDistance,
  formatEta,
  NavStatus,
} from '../../platform/navigationService';
import {
  useRouteState,
  selectAltRoute,
  computeFuelEstimate,
} from '../../platform/routingService';
import type { RouteStep } from '../../platform/routingService';
import { useStore } from '../../store/useStore';
import { useGPSLocation } from '../../platform/gpsService';
// TEK MESAFE KAYNAĞI: tüm km gösterimleri (Benzinlik/İş/Ev/Özel) bu kanonik
// haversine'den beslenir — GPS alt sistemiyle (fusionCore/speedCore) AYNI fonksiyon.
import { _haversineMeters } from '../../platform/gps/gpsMath';
import { speakNavigation } from '../../platform/ttsService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { Address } from '../../platform/addressBookService';
import { useEffectiveSpeedLimit } from '../../platform/navigation/useEffectiveSpeedLimit';
import { useNavigationHonesty } from '../../hooks/useNavigationHonesty';
import { formatManeuverDistance as fmtTurn } from './hud/formatManeuverDistance';
import { resolveLaneRow, type LanePresentation } from '../../platform/navigation/core/laneGuidanceModel';
import {
  resolveHudPresentation, type HudPresentation,
} from '../../platform/navigation/core/hudPresentationModel';
import { ManeuverPanel } from './hud/ManeuverPanel';
import { DrivingSpeed } from './hud/DrivingSpeed';
import { TripSummary } from './hud/TripSummary';
import { NavigationStatus } from './hud/NavigationStatus';
import { DrivingControls } from './hud/DrivingControls';
import {
  HONEST_SILENT, type NavigationHonestyVerdict,
} from '../../platform/navigation/core/navigationHonestyModel';
import { useSafetyStore } from '../../store/useSafetyStore';
import { startSafetyObserver, stopSafetyObserver } from '../../platform/safetyService';
import { useHazardStore, type HazardType } from '../../store/useHazardStore';
import { useCognitiveStore } from '../../store/useCognitiveStore';
import { useHudLayout } from '../../hooks/useDenseHud';
import { useDisplaySpeed } from '../../hooks/useDisplaySpeed';

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
  const activeHazards   = useHazardStore((s) => s.activeHazards);
  const hazardIntensity = useHazardStore((s) => s.hazardIntensity);
  // Sadece location — object yerine tek field subscribe
  const vehicleLoc      = useUnifiedVehicleStore((s) => s.location);
  const cogMode         = useCognitiveStore((s) => s.currentMode);
  const hideCrmBadge    = cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME';
  const hazardStatus    = useHazardStore((s) => s.hazardStatus);

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
      data-editable="nav.hazard" data-editable-type="card"
      className="absolute z-[var(--z-map-hud)] pointer-events-none flex flex-col items-center"
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
      zIndex:         'var(--z-map-limp)',
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

/* ══════════════════════════════════════════════════════════ */
/* ── LaneArrow — OEM cinematic lane hint ───────────────── */
/* ══════════════════════════════════════════════════════════ */
// Per screens.jsx 428-447 — 56×56 rounded tile, amber gradient + line-warm border
// when active, surface-2 + line when inactive.

/* ── Şerit oku — GÖRSEL DİL: automotive, düz dolgu ────────────────────────
 * Eski hâlde `linear-gradient` + `0 0 20px` GLOW vardı. Canonical hedef
 * (`field-runs/carto-2026-09-06/f-Maneuver.png`) düz dolgu · ince kenar ·
 * gölgesiz kutular kullanır; parlama sürüş ekranında dikkat çalar ve güneş
 * altında kontrastı DÜŞÜRÜR. Vurgu artık YALNIZ dolgu/kenar/mürekkep
 * tonuyla taşınır. */
const LANE_BOX = 34;

function LaneArrowGlyph({ lane }: { lane: LanePresentation }) {
  const common = {
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (lane.dir === 'unknown') {
    /* Gösterge tanınmadı → düz ok UYDURULMAZ, nötr işaret çizilir. */
    return (
      <svg viewBox="0 0 24 24" style={{ width: 17, height: 17 }} aria-hidden>
        <path d="M8 12h8" {...common} />
      </svg>
    );
  }
  if (lane.dir === 'uturn') {
    /* U dönüşü kendi şeklini alır. Eski kod bunu DÜZ ok çiziyordu. */
    return (
      <svg viewBox="0 0 24 24" style={{ width: 17, height: 17 }} aria-hidden>
        <path d="M9 20V10a4 4 0 0 1 8 0v6m0 0l-3-3m3 3l3-3" {...common} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24"
      style={{ width: 17, height: 17, transform: `rotate(${lane.angleDeg}deg)` }} aria-hidden>
      <path d="M12 4v16M6 10l6-6 6 6" {...common} />
    </svg>
  );
}

function LaneArrow({ lane }: { lane: LanePresentation }) {
  const selected = lane.emphasis === 'ROUTE_SELECTED';
  const blocked  = lane.emphasis === 'NOT_ALLOWED';
  return (
    <div
      data-testid="lane-arrow"
      data-lane-emphasis={lane.emphasis}
      data-lane-dir={lane.dir}
      style={{
        width: LANE_BOX, height: LANE_BOX, borderRadius: 10,
        /* DÜZ dolgu — gradient yok. */
        background: selected
          ? 'var(--oem-amber-weak, rgba(224,162,60,0.20))'
          : 'var(--oem-surface-2, rgba(48,55,73,0.55))',
        border: '1px solid ' + (selected
          ? 'var(--oem-line-warm, rgba(224,162,60,0.42))'
          : 'var(--oem-line, rgba(255,240,210,0.08))'),
        color: selected
          ? 'var(--oem-amber, #E0A23C)'
          : blocked
            ? 'var(--oem-ink-3, rgba(240,235,224,0.52))'
            : 'var(--oem-ink-2, rgba(240,235,224,0.74))',
        /* Kullanılamayan şerit GERİ ÇEKİLİR ama gizlenmez: sürücü kavşakta
           kaç şerit olduğunu görmelidir. */
        opacity: blocked ? 0.45 : 1,
        display: 'grid', placeItems: 'center',
        /* GLOW YOK. */
      }}>
      <LaneArrowGlyph lane={lane} />
    </div>
  );
}

/* ── LaneGuidance — YALNIZ GERÇEK şerit verisinden ────────────────────────────
 *
 * Bileşen şerit oklarını bir zamanlar MANEVRA TİPİNDEN türetiyordu ("sağa dön"
 * → sağ ok yanar); bu, sürücüye kavşakta gerçek şerit bilgisi varmış izlenimi
 * verir ve ürünün "kanıtsız bilgi üretme YASAĞI"nın doğrudan ihlaliydi.
 * Kural değişmedi: gerçek `lanes` verisi varsa GÖSTERİLİR, yoksa panel HİÇ
 * ÇIKMAZ. Yanlış şerit bilgisi vermek, hiç vermemekten KÖTÜDÜR.
 *
 * 2026-09-07: vurgu semantiği `laneGuidanceModel`e taşındı. Eski hâl OSRM'in
 * İKİ ayrı gerçeğini (`valid` · `active`) tek boolean'a çöküyordu; artık
 * ROUTE_SELECTED / ALLOWED / NOT_ALLOWED ayrı ayrı görünüyor.
 */
function LaneGuidance({ step }: { step: RouteStep }) {
  const row = resolveLaneRow(step.lanes);
  // KANIT YOK → PANEL YOK.
  if (!row) return null;
  if (step.maneuverType === 'arrive') return null;

  return (
    <div
      className="rounded-[1.5rem]"
      data-testid="lane-guidance"
      data-lane-count={row.length}
      style={{
        padding: '10px 14px',
        background: 'var(--oem-surface-1, rgba(38,44,60,0.78))',
        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
      }}>
      <div className="text-[10px] font-black uppercase tracking-[0.20em] mb-2"
        style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
        Şerit Yönlendirme
      </div>
      {/* Çok şeritli kavşakta 800×480'de taşma olmaz: satır sarar, ortalanır. */}
      <div className="flex gap-2 justify-center flex-wrap">
        {row.map((ln, i) => <LaneArrow key={i} lane={ln} />)}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════ */


/* LaneGuidance bileşeni kaldırıldı — ekranı dağıtıyordu, TurnPanel yeterli rehberlik sağlıyor */


/* ══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════ */
/* ── SafetyTensionBar — fren + reaksiyon mesafesi göstergesi */

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
          zIndex:          'var(--z-map-alert)',
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
/* ── NavInfoBar — futurist-gradient-dark, glowing progress ─ */


/* ══════════════════════════════════════════════════════════ */
/* ── ReroutingBanner ─────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════ */
/* ── ArrivalOverlay ──────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

function ArrivalOverlay({ destName }: { destName: string }) {
  return (
    <div className="absolute inset-0 z-[var(--z-map-prompt)] flex items-center justify-center pointer-events-none">
      <div
        className="flex flex-col items-center gap-5 px-10 py-8 rounded-[2.5rem] shadow-[var(--oem-shadow-pop)] bg-[var(--oem-surface-0)] backdrop-blur-[28px] border border-[var(--oem-good)] animate-in zoom-in-95 fade-in duration-500"
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: 'var(--oem-good-soft)', border: '1.5px solid var(--oem-good)', boxShadow: '0 0 40px var(--oem-good-soft)' }}
        >
          <CheckCircle2 className="w-11 h-11 text-[color:var(--oem-good)]" />
        </div>
        <div className="text-center">
          <div className="text-[color:var(--oem-ink)] font-black text-[28px] tracking-[-0.02em] leading-tight uppercase tracking-widest">
            Hedefe Vardınız
          </div>
          <div className="text-[color:var(--oem-good)] font-bold text-base mt-2 max-w-[260px] truncate">
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
      className="absolute left-4 z-[var(--z-map-hud)] pointer-events-auto"
      style={{ top: 'calc(var(--sat, 0px) + 14px)' }}
    >
      <div className="oem-glass flex items-center gap-4 px-5 py-4 rounded-[1.75rem] max-w-sm"
        style={{
          background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
          border: '1px solid rgba(239,68,68,0.35)',
          boxShadow: 'var(--oem-shadow-raised, 0 28px 56px -26px rgba(0,0,0,0.62))',
        }}>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(160deg,rgba(239,68,68,0.25),rgba(185,28,28,0.18))' }}
        >
          <AlertCircle className="w-7 h-7 text-[color:var(--oem-danger)]" />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-white font-black text-base leading-tight uppercase tracking-widest">Navigasyon Hatası</span>
          <span className="text-[color:var(--oem-danger)] text-sm mt-0.5 line-clamp-2">{message}</span>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all flex-shrink-0 bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)]"
        >
          <X className="w-5 h-5 text-[color:var(--oem-danger)]" />
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
  honesty = HONEST_SILENT,
}: {
  destName: string; distMeters: number; durSeconds: number;
  loading: boolean; error: string | null;
  onStart: () => void; onCancel: () => void;
  routeReady: boolean; gpsValid: boolean;
  /**
   * P0-NAV-02 — BAŞLAMADAN ÖNCE görülmesi gereken tek hüküm: rota doğrulama.
   * Mesafe/ETA cipleri burada KASTEN gösterilmez; kartta yazan sayı
   * sağlayıcının rota TOPLAMIDIR, ilerlemeden türetilmiş kalan mesafe değil —
   * onlara ait uyarıyı buraya koymak yanlış sayıyı işaretlemek olurdu.
   */
  honesty?: NavigationHonestyVerdict;
}) {
  const routeChip = honesty.chips.find((c) => c.id === 'route') ?? null;
  const { altDistances, altDurations, altRealIndices, altHasToll, hasToll, totalDurationSeconds: mainDurS } = useRouteState();
  const hasAlts = altDistances.length > 0;

  const altsRef  = useRef<HTMLDivElement | null>(null);

  const chipLabels = ['En Hızlı', 'Alternatif 1', 'Alternatif 2'];

  return (
    <div
      data-editable="nav.summary" data-editable-type="card"
      className="absolute inset-x-4 z-[var(--z-map-hud)] pointer-events-auto animate-in zoom-in-95 fade-in duration-500"
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 20px)' }}
    >
      <div className="rounded-[2.5rem] p-6 overflow-hidden relative shadow-[var(--oem-shadow-pop)] bg-[var(--oem-surface-0)] backdrop-blur-[28px] border border-[var(--oem-line)]">
        <div className="absolute top-0 left-0 w-full h-1 rounded-t-[2.5rem]"
          style={{ background: 'linear-gradient(90deg, var(--oem-accent-strong), var(--oem-accent), var(--oem-accent-strong))' }} />

        <div className="flex items-start gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--oem-accent-soft)', border: '1px solid var(--oem-accent-glow)' }}>
            <MapPin className="w-7 h-7" style={{ color: 'var(--oem-accent)' }} />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="text-[color:var(--oem-ink)] font-black text-2xl truncate leading-tight tracking-tight">{destName}</div>
            {routeChip !== null && (
              <div
                data-testid="preview-honesty-route"
                title={routeChip.detail}
                aria-label={routeChip.detail}
                className="mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] border"
                style={routeChip.level === 'DEGRADED'
                  ? { color: 'var(--oem-warn)', background: 'var(--oem-warn-soft)', borderColor: 'var(--oem-warn)' }
                  : { color: 'var(--oem-ink-3, rgba(240,235,224,0.52))', background: 'var(--oem-surface-2)', borderColor: 'var(--oem-line-strong)' }}
              >
                {routeChip.label}
              </div>
            )}
            {loading && (
              <div className="flex items-center gap-2 text-sm mt-2 font-bold uppercase tracking-widest"
                style={{ color: 'rgba(224,162,60,0.75)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Rota planlanıyor…</span>
              </div>
            )}
            {!loading && !error && distMeters > 0 && (
              <div className="text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] text-sm mt-2 font-bold uppercase tracking-widest flex items-center gap-3">
                <span className="text-[color:var(--oem-ink)]">{formatDistance(distMeters)}</span>
                <span className="w-1 h-1 rounded-full bg-[var(--oem-ink-4)]" />
                <span style={{ color: 'var(--oem-accent)' }}>{formatEta(durSeconds)}</span>
              </div>
            )}
            {!loading && error && (
              <div className="flex items-center gap-2 text-[color:var(--oem-warn)] text-sm mt-2 font-black uppercase tracking-widest">
                <AlertCircle className="w-4 h-4" />
                <span>Çevrimdışı Mod</span>
              </div>
            )}
          </div>
          <button
            onClick={onCancel}
            aria-label="Navigasyonu iptal et"
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-[var(--oem-surface-2)] border border-[var(--oem-line)] mt-0.5"
          >
            <X className="w-4 h-4 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]" />
          </button>
        </div>

        {!loading && (
          <div className="mb-4">
            {hasToll ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--oem-warn-soft)] border border-[var(--oem-warn)] text-[color:var(--oem-warn)] text-xs font-black uppercase tracking-widest">
                <AlertCircle className="w-3.5 h-3.5" />
                Olası ücretli geçiş (OGS/HGS)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[color:var(--oem-ink-3)] text-xs font-black uppercase tracking-widest">
                <AlertCircle className="w-3.5 h-3.5" />
                Ücret bilgisi yok (OSRM)
              </span>
            )}
          </div>
        )}

        {hasAlts && !loading && (
          <div ref={altsRef} className="mb-4">
            <div className="text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] text-[10px] font-black uppercase tracking-widest mb-2">Rota Seçenekleri</div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {/* Ana rota kartı */}
              <div className="flex-shrink-0 flex flex-col gap-0.5 px-3 py-2.5 rounded-2xl border min-w-[110px]"
                style={{ background: 'rgba(224,162,60,0.10)', borderColor: 'rgba(224,162,60,0.45)', boxShadow: '0 4px 16px rgba(224,162,60,0.22)' }}>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#E0A23C' }}>{chipLabels[0]}</span>
                  {hasToll && <AlertCircle className="w-3 h-3 text-[color:var(--oem-warn)] flex-shrink-0" />}
                </div>
                <span className="text-sm font-black text-[color:var(--oem-ink)] leading-tight">{formatDistance(distMeters)}</span>
                <span className="text-[11px] font-bold" style={{ color: 'var(--oem-accent)' }}>{formatEta(durSeconds)}</span>
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
                    className="flex-shrink-0 flex flex-col gap-0.5 px-3 py-2.5 rounded-2xl border min-w-[110px] transition-all active:scale-95 bg-[var(--oem-surface-2)] border-[var(--oem-line)]"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]">
                        {chipLabels[j + 1] ?? `Alternatif ${j + 1}`}
                      </span>
                      {toll && <AlertCircle className="w-3 h-3 text-[color:var(--oem-warn)] flex-shrink-0" />}
                    </div>
                    <span className="text-sm font-black text-[color:var(--oem-ink,#F0EBE0)] leading-tight">{formatDistance(dist)}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-[color:var(--oem-ink-2,rgba(240,235,224,0.74))]">{formatEta(altDur)}</span>
                      {diffLabel && (
                        <span className={`text-[10px] font-black ${diffSec > 0 ? 'text-[color:var(--oem-danger)]' : 'text-[color:var(--oem-good)]'}`}>
                          {diffLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Fuel className="w-3 h-3 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] flex-shrink-0" />
                      <span className="text-[10px] font-bold text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]">{computeFuelEstimate(dist)} L</span>
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
              onClick={onStart}
              disabled={!routeReady || !gpsValid}
              className="flex-1 py-3.5 rounded-2xl text-[color:var(--oem-ink,#F0EBE0)] font-black text-sm uppercase tracking-widest active:scale-95 transition-all bg-[var(--oem-surface-2)] border border-[var(--oem-line)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Rota Seç
            </button>
          ) : (
            <button
              onClick={onCancel}
              className="flex-1 py-3.5 rounded-2xl text-[color:var(--oem-ink-2,rgba(240,235,224,0.74))] font-black text-sm uppercase tracking-widest active:scale-95 transition-all bg-[var(--oem-surface-2)] border border-[var(--oem-line)]"
            >
              Vazgeç
            </button>
          )}
          <button
            disabled
            title="Durak ekleme henüz mevcut değil"
            className="flex-1 py-3.5 rounded-2xl text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] font-black text-sm uppercase tracking-widest bg-[var(--oem-surface-2)] border border-[var(--oem-line)] opacity-50 cursor-not-allowed"
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

function QuickCard({ icon, label, color, onTap, disabled = false, active = false, distanceM = null }: {
  icon: ReactNode; label: string; color: string; onTap: () => void;
  disabled?: boolean; active?: boolean;
  /** Bulunduğun yere kuş-uçuşu mesafe (metre) — formatDistance ile gösterilir. null = gizle. */
  distanceM?: number | null;
}) {
  // Tek format kaynağı (formatDistance) — PreviewCard/rota ETA ile AYNI gösterim.
  const km = (distanceM != null && Number.isFinite(distanceM) && distanceM >= 0)
    ? formatDistance(distanceM) : null;
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      /* ── CHROME TURU 2026-09-06 (saha: "sol quick destinations çok büyük") ──
       * ÖNCE dolgu SABİT KOYUYDU (`rgba(10,14,26,0.28)`) — gece haritada doğru,
       * ama GÜNDÜZ açık zeminde kart koyu bir blok olarak okunuyordu ve
       * kartografiyle yarışıyordu. Dolgu artık OEM yüzey token'ından gelir →
       * tema neyse kart da o (gündüz açık · gece koyu). Kenar da token'a
       * bağlandı; sabit beyaz kenar açık zeminde görünmüyordu zaten.
       * Boyut ve dokunma hedefi DEĞİŞMEDİ (`h-8` + güneş modu 52 px tabanı). */
      className="flex items-center gap-2 h-8 px-3 rounded-xl active:scale-95 transition-all disabled:opacity-35 backdrop-blur-[18px]"
      style={{
        color,
        background: active
          ? 'rgba(224,162,60,0.16)'
          : 'var(--oem-surface-1, rgba(10,14,26,0.28))',
        border: `1px solid ${active
          ? 'rgba(224,162,60,0.42)'
          : 'var(--oem-line, rgba(255,255,255,0.10))'}`,
      }}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-[10px] font-black uppercase tracking-wider text-[color:var(--oem-ink,#F0EBE0)] truncate max-w-[90px]">{label}</span>
      {km && (
        <span
          className="ml-auto text-[13px] font-black tabular-nums whitespace-nowrap px-1.5 py-0.5 rounded-md leading-none"
          /* Rozet dolgusu da temaya bağlandı: sabit `rgba(0,0,0,0.45)` gündüz
             haritada kartın içinde ikinci bir koyu blok üretiyordu. */
          style={{ color, background: 'var(--oem-surface-2, rgba(0,0,0,0.45))' }}
        >
          {km}
        </span>
      )}
    </button>
  );
}

/* ── Benzinlik önbellek ──────────────────────────────────────── */

const _FUEL_KEY    = 'caros-fuel-cache';
const _FUEL_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

interface _FuelItem { name: string; lat: number; lon: number; }
interface _FuelCache { items: _FuelItem[]; cachedAt: number; }

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
      _haversineMeters(lat, lon, a.lat, a.lon) <= _haversineMeters(lat, lon, b.lat, b.lon) ? a : b,
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
    return items.reduce((a, b) => _haversineMeters(lat, lon, a.lat, a.lon) <= _haversineMeters(lat, lon, b.lat, b.lon) ? a : b);
  } catch {
    return _nearestCached(lat, lon);
  }
}

const QuickDestinationsDelayed = memo(function QuickDestinationsDelayed({
  gpsLat, gpsLon,
}: { gpsLat: number | null; gpsLon: number | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // SAHA FİX 2026-06-12: 2000 → 300 ms. Kullanıcı "harita açıldığında km görünmüyor"
    // diyordu — panel (km'leriyle) ilk açılışta 2 sn boyunca hiç gelmiyordu. Kısa
    // gecikme haritanın ilk boyamasını bozmaz ama km neredeyse anında belirir.
    const t = setTimeout(() => setVisible(true), 300);
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

  // ── Hızlı hedef km'leri — TEK kaynak (_haversineMeters) + TEK format (formatDistance) ──
  // Kuş-uçuşu (düz çizgi) mesafe; rota mesafesi değil. GPS yoksa null → km gizlenir.
  const homeDistM = useMemo(
    () => (gpsLat != null && gpsLon != null && homeLocation)
      ? _haversineMeters(gpsLat, gpsLon, homeLocation.lat, homeLocation.lng) : null,
    [gpsLat, gpsLon, homeLocation],
  );
  const workDistM = useMemo(
    () => (gpsLat != null && gpsLon != null && workLocation)
      ? _haversineMeters(gpsLat, gpsLon, workLocation.lat, workLocation.lng) : null,
    [gpsLat, gpsLon, workLocation],
  );
  // Benzinlik: en yakın ÖNBELLEKTEKİ istasyona mesafe (ağ çağrısı yok). Önbellek yoksa
  // (ilk kullanım) null → kullanıcı bir kez Benzinlik'e basınca cache dolar, km belirir.
  // `fuelLoading` kurala göre "gereksiz" görünür ama BİLİNÇLİDİR: `_nearestCached`
  // React dışındaki bir MODÜL ÖNBELLEĞİNİ okur, o yüzden memo'nun yeniden hesaplanması
  // için gözlenebilir bir sinyal gerekir. Yükleme bitince (`fuelLoading` false'a döner)
  // önbellek dolmuştur ve mesafe belirir — dep'i kaldırmak "km hiç görünmüyor"
  // regresyonunu geri getirir.
  const fuelDistM = useMemo(() => {
    if (gpsLat == null || gpsLon == null) return null;
    const f = _nearestCached(gpsLat, gpsLon);
    return f ? _haversineMeters(gpsLat, gpsLon, f.lat, f.lon) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsLat, gpsLon, fuelLoading]);

  const navigate = useCallback((dest: Address) => {
    startNavigation(dest, false, 'USER_QUICK');   // kütük #429: ev/iş/hızlı hedef
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
      className="absolute left-3 z-[var(--z-map-label)] pointer-events-auto animate-in fade-in slide-in-from-left-2 duration-400"
      /* ── SOL ALT KÖŞENİN İKİ SAHİBİ VARDI (kütük #605) ────────────────────
       *
       * ÖLÇÜLEN KUSUR: bu sütun `--lp-dock-h + 10` ile alta çapalıydı;
       * `MapHudControls`in "Yol durumu bildir" düğmesi (48×48, amber, blur)
       * ise `--lp-dock-h + 18` ile AYNI köşeye çapalıydı. İkisi de görünür,
       * ikisinin de sahibi ayrı → düğme en alttaki kartın (ÖZEL KONUMLAR)
       * üstüne biniyordu. Kullanıcı bunu "sahipsiz yarı saydam kare" diye
       * bildirdi — etiketi olmadığı için düğme olarak okunmuyordu bile.
       *
       * Gerçek tarayıcı ölçümü (2026-08-16, kırpma+görünürlük farkındalıklı):
       *   904×406  → ÖZEL KONUMLAR %30 / düğme %15 örtüşme
       *   1024×600 → %28 / %14
       *   1280×480 → %22 / %11
       * Üç çözünürlükte de var → telefona özel DEĞİL, düzeltme genel.
       *
       * ÇÖZÜM: sütun, düğmenin kapladığı şeridin ÜSTÜNDEN başlar.
       * 18 (düğmenin alt boşluğu) + 48 (düğme) + 10 (görsel oluk) = 76.
       * Değerler `MapHudControls`in KENDİ stil sabitlerinden türetilmiştir;
       * kilit testi ikisinin sessizce ayrışmadığını denetler. Düğme yerinde
       * BIRAKILDI: sürüşte en kolay erişilen köşe odur ve navigasyonda bu
       * sütun zaten çizilmez. */
      style={{ bottom: 'calc(var(--lp-dock-h, 68px) + 76px)' }}
    >
      <div className="flex flex-col gap-1">
        <QuickCard
          icon={fuelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fuel className="w-3.5 h-3.5" />}
          label="Benzinlik" color="#E0A23C" onTap={handleFuel} disabled={!gpsLat || fuelLoading}
          distanceM={fuelDistM} />
        {workLocation ? (
          <QuickCard icon={<Briefcase className="w-3.5 h-3.5" />} label="İş" color="#E0A23C"
            distanceM={workDistM}
            onTap={() => navigate({ id: 'work', name: 'İş', latitude: workLocation.lat, longitude: workLocation.lng, type: 'history', category: 'work' })} />
        ) : (
          <QuickCard icon={<Briefcase className="w-3.5 h-3.5" />} label="İş Ayarla" color="#475569" onTap={setWork} disabled={!gpsLat} />
        )}
        {homeLocation ? (
          <QuickCard icon={<Home className="w-3.5 h-3.5" />} label="Ev" color="#E0A23C"
            distanceM={homeDistM}
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
              <X className="w-3.5 h-3.5 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]" />
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
              <span className="text-[9px] font-bold text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] mt-1">
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
                <MapPin className="w-5 h-5 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] mx-auto mb-2" />
                <span className="text-[10px] font-bold text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] uppercase tracking-wider">
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
                      <span className="text-[9px] font-mono text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] mt-1 truncate">
                        {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </span>
                    </div>
                  </button>
                  {/* Km — aynı kanonik kaynak (_haversineMeters) + format (formatDistance) */}
                  {gpsLat != null && gpsLon != null && (
                    <span className="text-[10px] font-black tabular-nums whitespace-nowrap flex-shrink-0" style={{ color: '#E0A23C' }}>
                      {formatDistance(_haversineMeters(gpsLat, gpsLon, loc.lat, loc.lng))}
                    </span>
                  )}
                  <button
                    onClick={() => removeCustomLocation(loc.id)}
                    aria-label="Sil"
                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)]"
                  >
                    <Trash2 className="w-3 h-3 text-[color:var(--oem-danger)]" />
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
  /**
   * Haritayı araca ortalama yolu — `cameraFollowAuthority` bu çağrının
   * İÇİNDE çalışır; HUD otoriteyi bypass etmez, yalnız tetikler.
   */
  onRecenter: () => void;
  /** GPS fix geçerli mi — false ise Start butonu disabled */
  gpsValid?:  boolean;
  onNavTab?:  (id: string) => void;
}

export const NavigationHUD = memo(function NavigationHUD({
  onStart,
  onCancel,
  routeReady,
  gpsValid = true,
  onRecenter,
}: NavigationHUDProps) {
  // Hız kaynağı: UnifiedVehicleStore.speed — worker SAB-polling (EMA + zero-hold +
  // anti-jitter) ile beslenir, worker stale olunca GPS location.speed'den devralınır.
  // Ham, filtresiz location.speed * 3.6 KULLANILMAZ (anlık 0 / spike sorunu).
  const speedKmh = useDisplaySpeed() ?? 0;   // kütük #417: tek gösterim otoritesi
  const location = useGPSLocation();
  /* Hız limiti: mini haritayla AYNI otorite. Eskiden burada
     `useSpeedLimitByLocation`in DÖNÜŞ değeri kullanılıyordu; o değer yalnız
     sorgu SAHİBİ örnekte dolduğu için mini harita mount olduğunda tam ekran
     levhası hiç çıkmıyordu (bkz. useEffectiveSpeedLimit başlık notu). */
  const dynamicLimit = useEffectiveSpeedLimit();
  /* P0-NAV-02 — motorun dürüstlük hükmü. İkinci otorite DEĞİL: yalnız
     `distanceSource` + `EtaVerdict` + rota doğrulama hükmünü okur. */
  const honesty = useNavigationHonesty();
  /* Güvenlik durumu — `safetyStateMapper` otoritesinden; hız rakamının
     SEMANTİK rengi için (yeni hesap yok). */
  const safetyStateNow = useSafetyStore((s) => s.safetyState);

  const {
    status, destination, distanceMeters, etaSeconds,
    isOfflineResult, isRerouting, errorMessage,
  } = useNavigation();
  const route = useRouteState();

  /* Açık kullanıcı eylemi — oturumu sonlandıran TEK giriş noktası.
   * (Görünüm kapatmak bu yolu çağırmaz; bkz. FullMapView `onClose`.) */
  const handleStop = useCallback(() => {
    endNavigation();
    onCancel();
  }, [onCancel]);

  const [showAlts, setShowAlts] = useState(false);

  // Safety observer lifecycle — bileşen mount'ta başlar, unmount'ta durur
  useEffect(() => {
    startSafetyObserver();
    return () => stopSafetyObserver();
  }, []);

  // CL2 — Kognitif bastırma bayrakları
  const cogMode     = useCognitiveStore((s) => s.currentMode);
  const suppFocused = cogMode !== 'IMMERSIVE' && cogMode !== 'AWARE'; // FOCUSED|CRITICAL|LIMP_HOME
  const suppCrit    = cogMode === 'CRITICAL' || cogMode === 'LIMP_HOME';
  const isLimp      = cogMode === 'LIMP_HOME';
  // Telefon yatayı: HUD ölçüleri küçültülür (head unit'te DEĞİŞMEZ).
  /* Üst bant şerit bütçesi + genişlik ekseni — AYNI hook, ikinci dinleyici YOK.
     `short` bilerek kullanılmaz: yükseklik ekseninin tek tüketicisi yukarıdaki
     `denseHud` kalır (kilit: "yoğunluk kapısı YÜKSEKLİĞE bakar"). */
  const { narrow: narrowHud } = useHudLayout();

  // LIMP_HOME — tek seferlik otoriter TTS bildirimi
  useEffect(() => {
    if (isLimp) {
      speakNavigation('Sistem koruma modu aktif. Navigasyon sürdürülüyor.');
    }
  }, [isLimp]);

  // Durum türetmeleri
  const isActiveNav   = status === NavStatus.ACTIVE || status === NavStatus.REROUTING;
  const isShowPreview = status === NavStatus.PREVIEW || status === NavStatus.ROUTING;
  const isShowArrived = status === NavStatus.ARRIVED;
  const isShowError   = status === NavStatus.ERROR;

  // ── Adım semantiği (off-by-one fix, 2026-07-05 nav denetimi) ──────────────
  // OSRM: steps[i].instruction = adımın BAŞINDAKİ manevra. currentStepIndex
  // manevra GEÇİLİNCE ilerler (routingService.updateRouteProgress) ve
  // distanceToNextTurnMeters steps[i+1]'in manevra noktasına sayar.
  // → Panelde gösterilecek/seste okunacak talimat steps[i+1] (YAKLAŞAN manevra)
  //   olmalıdır; steps[i] az önce GEÇİLMİŞ manevradır. Tek adım kalmışsa
  //   (sentinel / arrive) kendisi gösterilir. currentStep yalnız "üzerinde
  //   gidilen yol" bilgisi ve steps-boş kapısı için kullanılır. (Ayrı üst-orta
//   sokak tabelası P0-NAV-04'te KALDIRILDI — girilecek yolla yarışıyordu.)
  const currentStep  = route.steps[route.currentStepIndex];
  const upcomingStep = route.steps[route.currentStepIndex + 1] ?? currentStep;
  const followStep   = route.steps[route.currentStepIndex + 2];

  /* ── P0-NAV-04 · SUNUM HÜKMÜ ─────────────────────────────────────────────
   * Yeni otorite DEĞİL: mevcut hükümleri (rehberlik durumu · manevra mesafesi
   * ve KAYNAĞI · GPS doğruluğu · dürüstlük seviyesi · yerleşim) tek bir SAF
   * modele verir ve "ekranda ne öne çıkacak" cevabını alır. Eşikler
   * `cameraPolicyModel` (manevra bandı) ve `offRouteModel` (kullanılabilir
   * doğruluk) otoritelerinden GELİR — burada icat edilmez. */
  const hud: HudPresentation = resolveHudPresentation({
    guidanceActive: status === NavStatus.ACTIVE || status === NavStatus.REROUTING,
    rerouting: isRerouting,
    distToTurnM: route.distanceToNextTurnMeters,
    maneuverDistanceSource: route.distanceToNextTurnSource,
    arriveManeuver: (route.steps[route.currentStepIndex + 1] ?? route.steps[route.currentStepIndex])
      ?.maneuverType === 'arrive',
    gpsUsable: gpsValid,
    accuracyM: location?.accuracy ?? null,
    honestyLevel: honesty.level,
    layout: narrowHud ? 'PORTRAIT' : 'LANDSCAPE',
    hasLaneData: ((route.steps[route.currentStepIndex + 1] ?? route.steps[route.currentStepIndex])
      ?.lanes?.length ?? 0) > 0,
    hasNextManeuver: route.steps[route.currentStepIndex + 2] !== undefined,
    /* P0-NAV-17: ŞU AN gösterilecek GERÇEK bir manevra var mı. Boş adım
       listesinde (düz hat sentinel'i yazılmadan önce · 0 adımlı rota) içeriksiz
       bir dönüş kartı kalıyordu — model artık bunu kapatıyor. */
    hasManeuver: ((route.steps[route.currentStepIndex + 1] ?? route.steps[route.currentStepIndex])
      ?.instruction ?? '').trim().length > 0,
    /* Varıştan sonra eski yönlendirme EKRANDA KALMAZ. */
    arrived: status === NavStatus.ARRIVED,
  });

  /* ── SESLİ YÖNLENDİRME BURADA DEĞİLDİR (NAVIGATION_DELIVERY_CORE_P0) ───────
   * Kademeli anons mantığı ve "hangi kademe söylendi" durumu bu bileşendeydi.
   * `NavigationHUD` yalnız `FullMapView` içinde mount edildiği için tam ekran
   * kapatılınca **hazırlık · yaklaşma · dönüş anonslarının hepsi susuyordu**;
   * ayrıca durum bir bileşen ref'i olduğundan görünüm yeniden açılınca aynı
   * manevra **ikinci kez** seslendiriliyordu.
   *
   * Sahiplik `voiceGuidanceRuntime`e taşındı ve `navigationSessionRuntime`
   * tick'inden beslenir (gerçek GPS + ölü hesaplama). Eşikler ve anons
   * metinleri BİREBİR korundu — bu bileşen artık YALNIZ ÇİZER.
   *
   * ⚠️ Buraya bir daha `speakNavigation` EKLENMEYECEK: ekranla ilişkili her
   * ses üretimi, ekran kapalıyken sessizlik demektir. */

  // İlk GPS tick'inde distanceMeters=0 olabilir — toplam mesafeye fallback
  const effectiveDist = (distanceMeters && distanceMeters > 10)
    ? distanceMeters
    : route.totalDistanceMeters;

  /* ── TEK ETA OTORİTESİ (saha 2026-08-05 · kütük #403) ──────────────────────
   * ÖLÇÜLEN ÇELİŞKİ: aynı anda ekran kartı "289,2 km · 3 sa 18 dk" derken
   * motor `nav.etaSeconds` **4 sa 42 dk** diyordu — 1 saat 24 dakika fark.
   * KÖK: burada İKİNCİ bir ETA türetiliyordu —
   *   `route.totalDurationSeconds × (kalan mesafe / toplam mesafe)`
   * Bu formül yolun her yerinde aynı ortalama hızı varsayar: şehir içi + otoyol
   * karışık bir rotada sistematik olarak yanlıştır ve motorun gerçek hız
   * geçmişi + duruş süresi + rota süre modeliyle hesapladığı ETA'yı EZİYORDU.
   *
   * ETA artık YALNIZ motordan gelir. Motor henüz ilk değerini üretmediyse
   * (konum tick'i gelmeden) rotanın kendi toplam süresi gösterilir — bu bir
   * ikinci otorite değil, aynı zincirin ilk halkasıdır ve ilk tick'te
   * motorun değeriyle değişir. */
  const displayEta = (etaSeconds != null && etaSeconds > 0)
    ? etaSeconds
    : route.totalDurationSeconds;

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
              currentStep={upcomingStep}
              distToTurn={route.distanceToNextTurnMeters}
              onStop={handleStop}
            />
          )}

          {/* ── DURUM ŞERİDİ — TEK ve SAKİN (P0-NAV-04) ────────────────────
           * Eskiden üç ayrı yer bağırıyordu: `ReroutingBanner` (tam kart),
           * `GPS ±2m` çipi (manevra kartına biniyordu) ve dürüstlük cipleri.
           * Artık baskın durum TEKTİR ve tek satırda görünür. */}
          <NavigationStatus hud={hud} />

          {/* Tehlike Banner — PREPARE / ATTENTION durumunda görünür */}
          <HazardBanner />

          {/* ── BİRİNCİL: MANEVRA ──────────────────────────────────────────
           * `hud.showManeuver` yeniden rota sırasında FALSE olur: geçersiz bir
           * dönüşü göstermek, hiç göstermemekten tehlikelidir. */}
          {hud.showManeuver && currentStep && (
            <ManeuverPanel
              step={upcomingStep}
              distToTurnM={route.distanceToNextTurnMeters}
              nextStep={isLimp ? undefined : followStep}
              hud={hud}
              lanes={hud.showLaneGuidance ? <LaneGuidance step={upcomingStep} /> : undefined}
            />
          )}

          {/* Steps boş (local daemon / düz çizgi) → yedek manevra kartı */}
          {hud.showManeuver && !currentStep && destination && (
            <ManeuverPanel
              step={{
                instruction:      'Devam Edin',
                streetName:       destination.name,
                distance:         effectiveDist,
                duration:         displayEta,
                maneuverType:     'straight',
                maneuverModifier: 'straight',
                coordinate:       [destination.longitude, destination.latitude],
                roundaboutExit:   null,
                lanes:            null,  // yedek panelde GERÇEK şerit verisi YOKTUR
                geometryPointCount: 0,
              }}
              distToTurnM={effectiveDist}
              hud={hud}
            />
          )}

          {/* ── HIZ + KANITLI LİMİT ────────────────────────────────────────
           * Otoriteler dokunulmadı: hız `useDisplaySpeed`, limit
           * `useEffectiveSpeedLimit`. Burada yeniden hesap YOK. */}
          {hud.showSpeed && !suppCrit && (
            <DrivingSpeed
              speedKmh={speedKmh}
              speedLimit={dynamicLimit}
              hud={hud}
              caution={safetyStateNow === 'CAUTION'}
              intervention={safetyStateNow === 'INTERVENTION'}
            />
          )}

          {/* ── SÜRÜŞ KONTROLÜ — talep üzerine ─────────────────────────────
           * Zoom kolonu aktif rehberlikte YOK; ortala yalnız kullanıcı
           * kamerayı bıraktığında gelir (`cameraFollowAuthority` OKUNUR). */}
          <DrivingControls hud={hud} onRecenter={onRecenter} />

          {/* Alternatif rotalar butonu + paneli — FOCUSED+ modda gizlenir */}
          {!isRerouting && !suppFocused && route.alternatives.length > 0 && (
            <div
              className="absolute z-[var(--z-map-hud)] pointer-events-auto"
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
                        className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left oem-glass active:scale-95 transition-all"
                        style={{
                          background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
                          border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                          boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
                        }}
                      >
                        <div className="w-8 h-8 rounded-xl bg-[var(--oem-surface-2,rgba(48,55,73,0.60))] flex items-center justify-center flex-shrink-0">
                          <GitBranch className="w-4 h-4" style={{ color: '#E0A23C' }} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-white font-black text-sm">Alternatif {i + 1}</span>
                          <span className="text-[color:var(--oem-ink-2,rgba(240,235,224,0.74))] text-xs font-bold">
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
                className="flex items-center gap-2 px-3 py-2 rounded-2xl oem-glass active:scale-95 transition-all"
                style={{
                  background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
                }}
              >
                <GitBranch className="w-4 h-4" style={{ color: '#E0A23C' }} />
                <span className="text-white font-bold text-xs uppercase tracking-wide">
                  Alternatifler ({route.alternatives.length})
                </span>
              </button>
            </div>
          )}

          {/* ── YOLCULUK ÖZETİ (P0-NAV-04) ─────────────────────────────
           * Eski dev alt bar dört sütunluydu ve dördüncüsü (`YAKIT —`) veri
           * yokken DEKORATİF BİR TİRE idi. Artık üç sütun: varış · kalan süre
           * · kalan mesafe. Dürüstlük şeridi bu kartın İÇİNDE, tek satır ve
           * sakin — haritayı işgal etmez. */}
          <TripSummary
            etaSeconds={displayEta}
            remainingMeters={effectiveDist}
            totalMeters={route.totalDistanceMeters}
            honesty={honesty}
            hud={hud}
            onStop={handleStop}
            offline={isOfflineResult}
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
          honesty={honesty}
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
          onClose={() => { endNavigation(); onCancel(); }}
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
