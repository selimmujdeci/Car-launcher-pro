import { useState, useEffect, useRef, memo } from 'react';
import { Volume2, VolumeX, Volume1 } from 'lucide-react';
import { useStore } from '../../store/useStore';

export const VolumeOverlay = memo(function VolumeOverlay() {
  const { settings } = useStore();
  const { volume, volumeStyle } = settings;
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, 2000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [volume]);

  if (!visible && !firstRender.current) return null;

  const getIcon = (size = "w-5 h-5") => {
    if (volume === 0) return <VolumeX className={size} />;
    if (volume < 50) return <Volume1 className={size} />;
    return <Volume2 className={size} />;
  };

  return (
    <div className={`volume-overlay-root style-${volumeStyle} ${visible ? 'visible' : 'hidden'}`}>
      {volumeStyle === 'minimal_pro' && (
        <div className="minimal-pro-fill" style={{ width: `${volume}%` }} />
      )}

      {volumeStyle === 'tesla_ultra' && (
        <div className="tesla-ultra-card">
          <div className="tesla-ultra-icon">{getIcon("w-6 h-6")}</div>
          <div className="tesla-ultra-track">
            <div className="tesla-ultra-fill" style={{ height: `${volume}%` }} />
          </div>
          <div className="tesla-ultra-value">{volume}</div>
        </div>
      )}

      {volumeStyle === 'bmw_polished' && (
        <div className="bmw-polished-container">
          <svg viewBox="0 0 100 100" className="bmw-svg">
            <defs>
              <linearGradient id="bmw-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#818cf8" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="45" className="bmw-bg" />
            <circle
              cx="50"
              cy="50"
              r="45"
              className="bmw-fill"
              style={{
                strokeDasharray: '283',
                strokeDashoffset: `${283 - (283 * volume) / 100}`,
              }}
            />
          </svg>
          <div className="bmw-inner">
            <div className="bmw-value">{volume}</div>
            <div className="bmw-label">Volume</div>
          </div>
        </div>
      )}

      {volumeStyle === 'glass_orb' && (
        <div className="glass-orb-wrapper">
          <div className="orb-liquid" style={{ height: `${volume}%` }} />
          <div className="orb-content">
            {getIcon("w-8 h-8 mb-1 opacity-80")}
            <span className="text-xl font-black">{volume}</span>
          </div>
        </div>
      )}

      {volumeStyle === 'ambient_line' && (
        <>
          <div className="ambient-glow" style={{ width: `${60 + volume / 2}%`, opacity: 0.1 + volume / 200 }} />
          <div className="ambient-text">Entertainment Audio • {volume}%</div>
          <div className="ambient-bar-container">
            <div className="ambient-bar-fill" style={{ width: `${volume}%` }} />
          </div>
        </>
      )}
    </div>
  );
});
