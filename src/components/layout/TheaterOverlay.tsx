/**
 * TheaterOverlay — Araç park modunda medya odaklı tam ekran katman.
 *
 * Tasarım prensipleri:
 *   • OLED dostu: Arka plan #000000 (gerçek siyah) — güç tüketimi minimize.
 *   • Fade-in: 400ms smooth (OLED yanmasını önler, gözü yormaz).
 *   • Safety exit: 100ms anlık kapanış (araç hareket = sürüş modu).
 *   • Ambient brightness: CSS var(--theater-brightness) → %20 düşürür.
 *   • Zero-Leak: tüm abonelikler unmount'ta temizlenir.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Tv2, X, ExternalLink,
} from 'lucide-react';
import { useStore }           from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { openApp }            from '../../platform/appLauncher';
import { APP_MAP }            from '../../data/apps';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const FADE_IN_MS  = 400;  // OLED-friendly giriş
const FADE_OUT_MS = 100;  // Güvenlik çıkışı: 100ms

// ── Bileşen ───────────────────────────────────────────────────────────────────

export function TheaterOverlay() {
  const isActive       = useStore((s) => s.isTheaterModeActive);
  const deactivate     = useStore((s) => s.setIsTheaterModeActive);
  const defaultMusic   = useStore((s) => s.settings.defaultMusic);
  const media          = useMediaState();

  // Çıkış animasyonu için görünürlük state'i (isActive=false → 100ms fade-out → unmount)
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (isActive) {
      setIsFadingOut(false);
      setIsVisible(true);
      // Ambient Lighting: ekran parlaklığını %20'ye düşür
      document.documentElement.style.setProperty('--theater-brightness', '0.2');
    } else {
      // Güvenlik çıkışı: hızlı fade-out
      setIsFadingOut(true);
      const t = setTimeout(() => {
        setIsVisible(false);
        setIsFadingOut(false);
      }, FADE_OUT_MS + 20);
      document.documentElement.style.removeProperty('--theater-brightness');
      return () => clearTimeout(t);
    }
  }, [isActive]);

  const handleExit = useCallback(() => {
    deactivate(false);
  }, [deactivate]);

  const handleLaunchApp = useCallback(() => {
    const app = APP_MAP[defaultMusic];
    if (app) openApp(app);
  }, [defaultMusic]);

  if (!isVisible) return null;

  const opacity  = isFadingOut ? 0 : 1;
  const duration = isFadingOut ? `${FADE_OUT_MS}ms` : `${FADE_IN_MS}ms`;

  return (
    <div
      role="dialog"
      aria-label="Sinema Modu"
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     9990,
        background: '#000000',
        opacity,
        transition: `opacity ${duration} ease`,
        display:    'flex',
        flexDirection: 'column',
        alignItems:    'center',
        justifyContent:'center',
        userSelect: 'none',
      }}
    >
      {/* Çık butonu — sağ üst */}
      <button
        onClick={handleExit}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          width: 44,
          height: 44,
          borderRadius: 22,
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#ffffff',
        }}
        aria-label="Sinema modundan çık"
      >
        <X size={20} />
      </button>

      {/* Başlık rozeti */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          borderRadius: 20,
          background: 'rgba(139,92,246,0.15)',
          border: '1px solid rgba(139,92,246,0.30)',
        }}
      >
        <Tv2 size={14} color="#8b5cf6" />
        <span style={{ color: '#8b5cf6', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Sinema Modu
        </span>
      </div>

      {/* Merkez içerik */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          padding: '0 40px',
          width: '100%',
          maxWidth: 640,
        }}
      >
        {/* Albüm sanatı / ikon */}
        <div
          style={{
            width: 200,
            height: 200,
            borderRadius: 24,
            background: media.playing
              ? 'linear-gradient(135deg,#1e1b4b,#312e81,#4c1d95)'
              : 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(139,92,246,0.20)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: media.playing
              ? '0 0 80px rgba(139,92,246,0.25), 0 20px 60px rgba(0,0,0,0.80)'
              : '0 20px 60px rgba(0,0,0,0.60)',
            transition: 'box-shadow 600ms ease',
          }}
        >
          <Tv2 size={72} color={media.playing ? '#a78bfa' : '#4b5563'} />
        </div>

        {/* Şarkı bilgisi */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              color: '#ffffff',
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.5px',
              marginBottom: 6,
              maxWidth: 480,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {media.playing ? (media.track.title || 'Çalıyor...') : 'Medya Oynatıcı'}
          </div>
          <div style={{ color: '#6b7280', fontSize: 14 }}>
            {media.playing ? (media.track.artist || '') : 'Müzik veya video başlat'}
          </div>
        </div>

        {/* Oynatma kontrolleri */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <button
            onClick={previous}
            style={_ctrlStyle}
            aria-label="Önceki parça"
          >
            <SkipBack size={26} color="#ffffff" />
          </button>

          <button
            onClick={togglePlayPause}
            style={{
              ..._ctrlStyle,
              width: 72,
              height: 72,
              background: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
              border: '1px solid rgba(139,92,246,0.50)',
              boxShadow: '0 0 32px rgba(139,92,246,0.35)',
            }}
            aria-label={media.playing ? 'Duraklat' : 'Oynat'}
          >
            {media.playing
              ? <Pause  size={30} color="#ffffff" />
              : <Play   size={30} color="#ffffff" style={{ marginLeft: 3 }} />
            }
          </button>

          <button
            onClick={next}
            style={_ctrlStyle}
            aria-label="Sonraki parça"
          >
            <SkipForward size={26} color="#ffffff" />
          </button>
        </div>

        {/* Uygulamayı aç */}
        <button
          onClick={handleLaunchApp}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 24px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#9ca3af',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <ExternalLink size={14} />
          Uygulamayı Aç
        </button>
      </div>

      {/* Alt bilgi */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          color: '#374151',
          fontSize: 11,
          letterSpacing: '0.05em',
        }}
      >
        Çıkmak için butona dokunun veya araca girin
      </div>
    </div>
  );
}

// ── Kontrol butonu ortak stili ────────────────────────────────────────────────

const _ctrlStyle: React.CSSProperties = {
  width:            56,
  height:           56,
  borderRadius:     28,
  background:       'rgba(255,255,255,0.07)',
  border:           '1px solid rgba(255,255,255,0.12)',
  display:          'flex',
  alignItems:       'center',
  justifyContent:   'center',
  cursor:           'pointer',
  transition:       'transform 80ms ease, background 150ms ease',
};
