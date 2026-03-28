/**
 * Rear View Camera — Geri Görüş Kamerası Overlay.
 *
 * Kamera seçimi:
 *   - "environment" facingMode: arka kamera (mobil varsayılan)
 *   - USB/yardımcı kameralar: cihaz listesinden seçim
 *   - Native Android: ek kamera ID'leri desteklenir
 *
 * Overlay: tam ekran, üstüne kılavuz çizgileri + mesafe yardımcıları.
 */

import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { X, CameraOff, RotateCcw, Settings2, ChevronDown } from 'lucide-react';

/* ── Yardımcı çizgiler ───────────────────────────────────── */

const GuideLines = memo(function GuideLines({ width, height }: { width: number; height: number }) {
  const cx = width / 2;

  // Park yardımcı çizgileri: kırmızı (yakın) + sarı (orta) + yeşil (uzak)
  const lines = [
    { y: height * 0.75, color: 'rgba(239,68,68,0.8)',  label: '~50 cm' },
    { y: height * 0.58, color: 'rgba(245,158,11,0.7)', label: '~1 m'   },
    { y: height * 0.42, color: 'rgba(34,197,94,0.6)',  label: '~2 m'   },
  ];

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Merkez çizgi */}
      <line
        x1={cx} y1={height * 0.3}
        x2={cx} y2={height}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="1"
        strokeDasharray="8 6"
      />

      {/* Genişleyen perspektif çizgileri */}
      <line
        x1={cx - 10} y1={height * 0.85}
        x2={cx - width * 0.35} y2={height * 0.35}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
      />
      <line
        x1={cx + 10} y1={height * 0.85}
        x2={cx + width * 0.35} y2={height * 0.35}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
      />

      {/* Mesafe çizgileri */}
      {lines.map(({ y, color, label }) => (
        <g key={label}>
          <line
            x1={cx - width * 0.28} y1={y}
            x2={cx + width * 0.28} y2={y}
            stroke={color} strokeWidth="2"
          />
          <rect x={cx - width * 0.28 - 38} y={y - 9} width={36} height={18} rx={4} fill="rgba(0,0,0,0.5)" />
          <text
            x={cx - width * 0.28 - 20} y={y + 5}
            textAnchor="middle" fill={color}
            fontSize="11" fontWeight="bold"
          >{label}</text>
        </g>
      ))}
    </svg>
  );
});

/* ── Kamera cihazı seçici ────────────────────────────────── */

const DevicePicker = memo(function DevicePicker({
  devices,
  currentId,
  onSelect,
  onClose,
}: {
  devices:   MediaDeviceInfo[];
  currentId: string;
  onSelect:  (id: string) => void;
  onClose:   () => void;
}) {
  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 min-w-[240px] z-10">
      {devices.map((d) => (
        <button
          key={d.deviceId}
          onClick={() => { onSelect(d.deviceId); onClose(); }}
          className={`
            w-full text-left px-4 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2
            ${d.deviceId === currentId
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-slate-300 hover:bg-white/10'}
          `}
        >
          <span className="text-base">📷</span>
          <span className="truncate">{d.label || `Kamera ${d.deviceId.slice(0, 6)}`}</span>
        </button>
      ))}
    </div>
  );
});

/* ── Ana Overlay ─────────────────────────────────────────── */

interface RearViewCameraProps {
  onClose: () => void;
}

export const RearViewCamera = memo(function RearViewCamera({ onClose }: RearViewCameraProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);

  const [error,       setError]       = useState<string | null>(null);
  const [dimensions,  setDimensions]  = useState({ w: 0, h: 0 });
  const [devices,     setDevices]     = useState<MediaDeviceInfo[]>([]);
  const [activeId,    setActiveId]    = useState<string>('');
  const [showPicker,  setShowPicker]  = useState(false);
  const [mirrored,    setMirrored]    = useState(true);

  /* Mevcut video cihazlarını listele */
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then((all) => {
        const vids = all.filter((d) => d.kind === 'videoinput');
        setDevices(vids);
      })
      .catch(() => {});
  }, []);

  /* Kamera başlat */
  const startCamera = useCallback(async (deviceId?: string) => {
    // Önceki akışı durdur
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setError(null);

    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});

        // Aktif cihaz ID'sini kaydet
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        setActiveId(settings.deviceId ?? deviceId ?? '');
      }
    } catch (err) {
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          setError('Kamera izni verilmedi. Lütfen tarayıcı ayarlarından izin verin.');
        } else if (err.name === 'NotFoundError') {
          setError('Kamera bulunamadı. USB kameranın bağlı olduğundan emin olun.');
        } else {
          setError(`Kamera hatası: ${err.message}`);
        }
      } else {
        setError('Kamera başlatılamadı.');
      }
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  /* Container boyutunu takip et */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setDimensions({ w: el.offsetWidth, h: el.offsetHeight });
    });
    obs.observe(el);
    setDimensions({ w: el.offsetWidth, h: el.offsetHeight });
    return () => obs.disconnect();
  }, []);

  /* Kamera değiştir */
  const handleDeviceSelect = useCallback((id: string) => {
    startCamera(id);
  }, [startCamera]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center"
    >
      {/* Video */}
      {!error && (
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
          playsInline
          muted
          autoPlay
        />
      )}

      {/* Hata ekranı */}
      {error && (
        <div className="flex flex-col items-center gap-4 text-center px-8">
          <CameraOff className="w-16 h-16 text-slate-600" />
          <div className="text-white text-base font-bold">{error}</div>
          <button
            onClick={() => startCamera()}
            className="px-6 py-3 rounded-2xl bg-blue-500/20 border border-blue-500/30 text-blue-400 font-bold text-sm active:scale-95 transition-all"
          >
            Tekrar Dene
          </button>
        </div>
      )}

      {/* Kılavuz çizgileri */}
      {!error && dimensions.w > 0 && (
        <GuideLines width={dimensions.w} height={dimensions.h} />
      )}

      {/* Cihaz seçici popup */}
      {showPicker && (
        <DevicePicker
          devices={devices}
          currentId={activeId}
          onSelect={handleDeviceSelect}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Üst bar */}
      <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-black/70 to-transparent flex items-center justify-between px-6 pointer-events-auto">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white text-sm font-bold tracking-wider">GERİ GÖRÜŞ</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Ayna modu */}
          <button
            onClick={() => setMirrored((m) => !m)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
              mirrored ? 'bg-blue-500/30 border border-blue-400/30 text-blue-400' : 'bg-white/10 text-slate-400'
            }`}
            title="Yansıt"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Kamera seçici */}
          {devices.length > 1 && (
            <button
              onClick={() => setShowPicker((s) => !s)}
              className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-90"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}

          {/* Kapat */}
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Alt bar — kamera sayısı */}
      {devices.length > 0 && (
        <div className="absolute bottom-6 inset-x-0 flex justify-center pointer-events-auto">
          <button
            onClick={() => setShowPicker((s) => !s)}
            className="flex items-center gap-2 bg-black/60 backdrop-blur border border-white/10 rounded-2xl px-4 py-2 text-slate-400 text-xs"
          >
            <span>📷 {devices.length} kamera mevcut</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

export default RearViewCamera;
