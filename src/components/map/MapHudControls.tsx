import { memo, useState, useCallback } from 'react';
import {
  X, ZoomIn, ZoomOut, Crosshair, Map, Layers, Globe, Navigation2, Camera, CameraOff,
  AlertTriangle, Construction, Car, CircleAlert,
} from 'lucide-react';
import type { MapMode } from '../../platform/mapSourceManager';
import { addEvent } from '../../platform/communityService';
import type { CommunityEventType } from '../../store/useCommunityStore';

/* ── Manuel rapor seçenekleri ────────────────────────────────────────────── */

interface ReportOption {
  type:  CommunityEventType;
  label: string;
  Icon:  React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}

const REPORT_OPTIONS: ReportOption[] = [
  { type: 'ACCIDENT',      label: 'Kaza',          Icon: Car,            color: '#ef4444' },
  { type: 'ROAD_WORK',     label: 'Yol Çalışması', Icon: Construction,   color: '#f59e0b' },
  { type: 'POTHOLE',       label: 'Çukur',         Icon: AlertTriangle,  color: '#fb923c' },
  { type: 'GENERAL_ALERT', label: 'Genel Uyarı',   Icon: CircleAlert,    color: '#60a5fa' },
];

const MODE_LABELS: Record<MapMode, string> = {
  road: 'Yol',
  hybrid: 'Hibrit',
  satellite: 'Uydu',
};

export interface MapHudControlsProps {
  // State
  isNavigating: boolean;
  isPreview: boolean;
  isFollowing: boolean;
  ctrlVisible: boolean;
  drivingMode: boolean;
  cameraOn: boolean;
  mode: MapMode;
  heading: number | null;
  location: { latitude: number; longitude: number } | null;

  // Actions
  onClose: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  onToggleDrivingMode: () => void;
  onCameraToggle: () => void;
  onSetMapMode: (mode: MapMode) => void;
  showControls: () => void;
}

export const MapHudControls = memo(function MapHudControls({
  isNavigating,
  isPreview,
  isFollowing,
  ctrlVisible,
  drivingMode,
  cameraOn,
  mode,
  heading,
  location,
  onClose,
  onZoomIn,
  onZoomOut,
  onRecenter,
  onToggleDrivingMode,
  onCameraToggle,
  onSetMapMode,
  showControls,
}: MapHudControlsProps) {
  const [reportOpen, setReportOpen] = useState(false);

  const handleReport = useCallback((type: CommunityEventType) => {
    setReportOpen(false);
    if (!location) return;
    addEvent(type, location.latitude, location.longitude, 0.9, { source: 'manual' });
  }, [location]);

  return (
    <>
      {/* ── KAPAT — yalnızca navigasyon kapalıyken görünür.
       *   Active nav: NavInfoBar'daki SONLANDIR rotanın doğru bitirme yolu.
       *   Bu sayede SpeedPanel ile çakışmaz. */}
      {!isNavigating && (
        <button
          onClick={onClose}
          aria-label="Haritayı kapat"
          className="flex items-center gap-2 rounded-2xl active:scale-90 transition-all hover:brightness-110"
          style={{
            position: 'fixed',
            top: 'calc(var(--sat) + 16px)', right: 'calc(var(--sar) + 16px)',
            zIndex: 9999,
            padding: '12px 20px',
            background: 'rgba(239,68,68,0.18)',
            backdropFilter: 'blur(20px)',
            border: '1.5px solid rgba(239,68,68,0.4)',
            color: '#f87171', fontWeight: 900, fontSize: 13,
            letterSpacing: '0.1em', cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(239,68,68,0.25)',
          }}
        >
          <X className="w-4 h-4 text-red-400 stroke-[3px]" />
          <span className="uppercase tracking-widest">KAPAT</span>
        </button>
      )}

      {/* ── GOOGLE MAPS TARZ RE-CENTER: Navigasyonda gizli, nav dışında sürüklenince çıkar ── */}
      {!isFollowing && !isNavigating && (
        <button
          onClick={() => { onRecenter(); showControls(); }}
          aria-label="Konuma dön"
          style={{
            position: 'absolute',
            bottom: isNavigating
              ? 'calc(var(--lp-dock-h,68px) + 92px)'
              : 'calc(var(--lp-dock-h,68px) + 80px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            background: 'rgba(10,14,26,0.92)',
            backdropFilter: 'blur(16px)',
            border: '1.5px solid rgba(224,162,60,0.55)',
            borderRadius: '999px',
            color: '#E8B86A',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(224,162,60,0.35), 0 2px 8px rgba(0,0,0,0.6)',
            animation: 'fadeSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards',
          }}
        >
          <Crosshair className="w-4 h-4" style={{ color: '#E8B86A' }} />
          <span>Konuma Dön</span>
        </button>
      )}

      {/* ── SAĞ: Nav dışı kontroller — sürüş modunda gizle ── */}
      <div
        className="absolute right-4 z-20 flex flex-col items-center gap-2.5"
        style={{
          bottom: 'calc(var(--lp-dock-h,68px) + 18px)',
          opacity: isNavigating ? 0 : ctrlVisible ? 1 : 0.32,
          transform: isNavigating ? 'translateX(56px)' : 'translateX(0)',
          pointerEvents: isNavigating ? 'none' : 'auto',
          transition: 'opacity 500ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Sürüş modu toggle */}
        <button
          onClick={() => { onToggleDrivingMode(); showControls(); }}
          className={`w-12 h-12 rounded-2xl border flex items-center justify-center active:scale-95 transition-colors duration-300 backdrop-blur-xl ${
            drivingMode
              ? 'bg-amber-500 border-amber-400/50 text-black'
              : 'bg-black/60 border-white/15 text-slate-400 hover:text-white hover:border-white/25'
          }`}
          style={{ boxShadow: drivingMode ? '0 0 20px rgba(224,162,60,0.5), 0 4px 16px rgba(0,0,0,0.5)' : '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <Navigation2 className={`w-5 h-5 ${drivingMode ? 'fill-black' : ''}`} />
        </button>

        {/* Konuma dön */}
        <button
          onClick={() => { onRecenter(); showControls(); }}
          className="w-12 h-12 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 flex items-center justify-center text-slate-400 hover:text-amber-300 hover:border-amber-400/35 active:scale-90 transition-colors"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <Crosshair className="w-5 h-5" />
        </button>

        {/* Kamera aç/kapat */}
        <button
          onClick={onCameraToggle}
          className={`w-12 h-12 rounded-2xl backdrop-blur-xl border flex items-center justify-center active:scale-90 transition-all ${
            cameraOn
              ? 'bg-amber-500 border-amber-400 text-black shadow-[0_0_16px_rgba(224,162,60,0.6)]'
              : 'bg-black/60 border-white/15 text-slate-400 hover:text-amber-300 hover:border-amber-400/35'
          }`}
          style={{ boxShadow: cameraOn ? '0 0 16px rgba(224,162,60,0.5)' : '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          {cameraOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
        </button>

        {/* Zoom pill */}
        <div
          className="flex flex-col bg-black/60 backdrop-blur-xl rounded-2xl border border-white/15 overflow-hidden"
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.55)' }}
        >
          <button
            onClick={() => { onZoomIn(); showControls(); }}
            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <div className="h-px bg-white/12 mx-2.5" />
          <button
            onClick={() => { onZoomOut(); showControls(); }}
            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── SAĞ: Navigasyon zoom + pusula — nav modunda görünür ── */}
      {isNavigating && (
        <div
          className="absolute right-4 z-20 flex flex-col items-center gap-2"
          style={{ bottom: 'calc(var(--lp-dock-h,68px) + 96px)' }}
        >
          {/* Pusula — bearing'e göre döner */}
          <button
            onClick={() => { onRecenter(); showControls(); }}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-black/70 backdrop-blur-xl border border-white/15 active:scale-90 transition-all"
            style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.55)' }}
          >
            <Navigation2
              className="w-5 h-5 text-white"
              style={{ transform: `rotate(${-(heading ?? 0)}deg)`, transition: 'transform 0.3s ease' }}
            />
          </button>
          {/* Zoom pill */}
          <div
            className="flex flex-col bg-black/70 backdrop-blur-xl rounded-2xl border border-white/15 overflow-hidden"
            style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.55)' }}
          >
            <button
              onClick={() => { onZoomIn(); showControls(); }}
              className="w-11 h-11 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
            >
              <ZoomIn className="w-4.5 h-4.5" />
            </button>
            <div className="h-px bg-white/12 mx-2" />
            <button
              onClick={() => { onZoomOut(); showControls(); }}
              className="w-11 h-11 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
            >
              <ZoomOut className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── SOL: Yol durumu rapor butonu — sürüş modunda gizli ── */}
      {!drivingMode && (
        <button
          onClick={() => setReportOpen(true)}
          aria-label="Yol durumu bildir"
          style={{
            position: 'fixed',
            bottom: 'calc(var(--lp-dock-h,68px) + 18px)',
            left:   'calc(var(--sal,0px) + 16px)',
            zIndex: 9998,
            width: 48, height: 48,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background:     'rgba(251,191,36,0.15)',
            backdropFilter: 'blur(16px)',
            border:         '1.5px solid rgba(251,191,36,0.38)',
            borderRadius:   '16px',
            color:          '#fbbf24',
            cursor:         'pointer',
            boxShadow:      '0 4px 20px rgba(251,191,36,0.18)',
            transition:     'opacity 300ms',
            opacity:        ctrlVisible ? 1 : 0.32,
          }}
        >
          <AlertTriangle className="w-5 h-5" />
        </button>
      )}

      {/* ── RAPOR OVERLAY — büyük dokunmatik hedefler, otomotiv UX ── */}
      {reportOpen && (
        <div
          onClick={() => setReportOpen(false)}
          style={{
            position:   'fixed',
            inset:      0,
            zIndex:     99999,
            background: 'rgba(0,0,0,0.72)',
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background:    'rgba(10,14,26,0.96)',
              border:        '1.5px solid rgba(255,255,255,0.1)',
              borderRadius:  '24px',
              padding:       '28px 24px',
              width:         'min(360px, 90vw)',
              boxShadow:     '0 16px 48px rgba(0,0,0,0.7)',
            }}
          >
            {/* Başlık */}
            <p style={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: 11, fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              textAlign: 'center', marginBottom: 20,
            }}>
              Yol Durumu Bildir
            </p>

            {/* Seçenek butonları */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {REPORT_OPTIONS.map(({ type, label, Icon, color }) => (
                <button
                  key={type}
                  onClick={() => handleReport(type)}
                  style={{
                    display:        'flex',
                    flexDirection:  'column',
                    alignItems:     'center',
                    justifyContent: 'center',
                    gap:            10,
                    height:         88,
                    background:     `${color}18`,
                    border:         `1.5px solid ${color}40`,
                    borderRadius:   '16px',
                    color,
                    cursor:         'pointer',
                    fontSize:       13, fontWeight: 700,
                    letterSpacing:  '0.02em',
                    transition:     'background 150ms',
                  }}
                >
                  <Icon className="w-6 h-6" style={{ color }} />
                  {label}
                </button>
              ))}
            </div>

            {/* İptal */}
            <button
              onClick={() => setReportOpen(false)}
              style={{
                marginTop:     16,
                width:         '100%',
                padding:       '14px 0',
                background:    'rgba(255,255,255,0.05)',
                border:        '1px solid rgba(255,255,255,0.1)',
                borderRadius:  '14px',
                color:         'rgba(255,255,255,0.45)',
                fontSize:      13, fontWeight: 600,
                cursor:        'pointer',
                letterSpacing: '0.04em',
              }}
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {/* ── ALT MERKEZ: Harita katman seçici — nav/preview'da kaybolur, idle'da soluklaşır ── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2"
        style={{
          bottom: 'calc(var(--lp-dock-h,68px) + 14px)',
          opacity: (isNavigating || isPreview) ? 0 : ctrlVisible ? 1 : 0.28,
          transform: (isNavigating || isPreview) ? 'translateY(16px)' : 'translateY(0)',
          pointerEvents: (isNavigating || isPreview) ? 'none' : 'auto',
          transition: 'opacity 500ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div
          className="flex items-center gap-0.5 bg-black/60 backdrop-blur-xl rounded-2xl p-1 border border-white/15"
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.55)' }}
        >
          {(['road', 'hybrid', 'satellite'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { onSetMapMode(m); showControls(); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-bold tracking-[0.12em] uppercase transition-all duration-200 active:scale-95 ${
                mode === m
                  ? 'bg-white/18 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/8'
              }`}
            >
              {m === 'road' && <Map className="w-3.5 h-3.5" />}
              {m === 'hybrid' && <Layers className="w-3.5 h-3.5" />}
              {m === 'satellite' && <Globe className="w-3.5 h-3.5" />}
              <span>{MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>
        {location && (
          <span className="text-[9px] text-white/25 font-mono tracking-tight">
            {location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°
          </span>
        )}
      </div>
    </>
  );
});
