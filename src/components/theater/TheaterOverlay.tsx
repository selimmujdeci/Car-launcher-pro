/**
 * TheaterOverlay — Araç park modunda medya odaklı tam ekran katman.
 *
 * Özellikler:
 *   · Ambient Light: albüm kapağından dominant renk çekip ekran kenarlarına inset glow.
 *   · Progress bar: positionSec / durationSec ile gerçek zamanlı ilerleme.
 *   · Fade-in 400ms (OLED dostu) / Fade-out 100ms (güvenlik çıkışı).
 *   · Zero-Leak: extractDominantRgb cleanup ref + useEffect unmount guard.
 *
 * State kaynağı: useSystemStore.isTheaterModeActive (tek kaynak of truth).
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, X, Tv2, ExternalLink,
} from 'lucide-react';
import { useSystemStore }                                      from '../../store/useSystemStore';
import { useMediaState, togglePlayPause, next, previous }     from '../../platform/mediaService';
import { useStore }                                            from '../../store/useStore';
import { openApp }                                             from '../../platform/appLauncher';
import { APP_MAP }                                             from '../../data/apps';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const FADE_IN_MS  = 400;
const FADE_OUT_MS = 100;
// Renk çıkarma mantığı mediaService._extractAndApplyAccent'e taşındı (Music Hub 2.0).
// TheaterOverlay artık media.albumAccentRgb'yi doğrudan okur.

// ── Zaman biçimlendirme ───────────────────────────────────────────────────────

function _fmtTime(s: number): string {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Bileşen ───────────────────────────────────────────────────────────────────

export function TheaterOverlay() {
  const isActive     = useSystemStore((s) => s.isTheaterModeActive);
  const deactivate   = useSystemStore((s) => s.setTheaterMode);
  const defaultMusic = useStore((s) => s.settings.defaultMusic);
  const media        = useMediaState();

  const [isVisible,   setIsVisible]   = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // Ambient renk: mediaService.albumAccentRgb üzerinden — merkezi kaynak (Music Hub 2.0)
  const ambientRgb = media.albumAccentRgb;

  // ── Visibility: fade-in / safety fade-out ─────────────────────────────────
  useEffect(() => {
    if (isActive) {
      setIsFadingOut(false);
      setIsVisible(true);
      document.documentElement.style.setProperty('--theater-brightness', '0.2');
    } else {
      setIsFadingOut(true);
      const t = setTimeout(() => {
        setIsVisible(false);
        setIsFadingOut(false);
      }, FADE_OUT_MS + 20);
      document.documentElement.style.removeProperty('--theater-brightness');
      return () => clearTimeout(t);
    }
  }, [isActive]);

  const handleExit       = useCallback(() => deactivate(false), [deactivate]);
  const handleLaunchApp  = useCallback(() => {
    const app = APP_MAP[defaultMusic];
    if (app) openApp(app);
  }, [defaultMusic]);

  if (!isVisible) return null;

  const { track }  = media;
  const progress   = track.durationSec > 0 ? track.positionSec / track.durationSec : 0;
  const opacity    = isFadingOut ? 0 : 1;
  const transition = `opacity ${isFadingOut ? FADE_OUT_MS : FADE_IN_MS}ms ease`;

  return (
    <div
      role="dialog"
      aria-label="Sinema Modu"
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         999,
        background:     'rgba(0, 0, 0, 0.93)',
        opacity,
        transition,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        userSelect:     'none',
        // Ambient edge glow — inset box-shadow simüle ekran kenarlarından sızan ışık
        boxShadow: `inset 0 0 180px 60px rgba(${ambientRgb}, 0.28)`,
      }}
    >
      {/* Orta radyal parıltı */}
      <div
        aria-hidden
        style={{
          position:   'absolute',
          inset:      0,
          pointerEvents: 'none',
          background: `radial-gradient(ellipse 70% 55% at 50% 50%, rgba(${ambientRgb}, 0.07) 0%, transparent 70%)`,
          transition: 'background 800ms ease',
        }}
      />

      {/* Çıkış butonu — sağ üst */}
      <button
        onClick={handleExit}
        aria-label="Sinema modundan çık"
        style={{
          position:       'absolute',
          top:            20,
          right:          20,
          width:          44,
          height:         44,
          borderRadius:   22,
          background:     'rgba(255,255,255,0.08)',
          border:         '1px solid rgba(255,255,255,0.15)',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          cursor:         'pointer',
          color:          '#ffffff',
          zIndex:         1,
        }}
      >
        <X size={20} />
      </button>

      {/* Rozet — sol üst */}
      <div
        style={{
          position:   'absolute',
          top:        20,
          left:       20,
          display:    'flex',
          alignItems: 'center',
          gap:        8,
          padding:    '6px 14px',
          borderRadius: 20,
          background: 'rgba(0,0,0,0.30)',
          border:     '1px solid rgba(255,255,255,0.12)',
          zIndex:     1,
        }}
      >
        <Tv2 size={14} color={`rgb(${ambientRgb})`} />
        <span style={{
          color:          `rgb(${ambientRgb})`,
          fontSize:       11,
          fontWeight:     700,
          letterSpacing:  '0.1em',
          textTransform:  'uppercase',
        }}>
          Sinema Modu
        </span>
      </div>

      {/* ── Merkez içerik ── */}
      <div style={{
        position:       'relative',
        zIndex:         1,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        gap:            28,
        padding:        '0 40px',
        width:          '100%',
        maxWidth:       580,
      }}>

        {/* Albüm kapağı */}
        <div style={{
          width:        200,
          height:       200,
          borderRadius: 20,
          overflow:     'hidden',
          border:       `1px solid rgba(${ambientRgb}, 0.25)`,
          background:   track.albumArt
            ? undefined
            : `linear-gradient(135deg, rgba(${ambientRgb},0.35) 0%, rgba(${ambientRgb},0.08) 100%)`,
          boxShadow:  `0 0 80px rgba(${ambientRgb}, 0.35), 0 24px 64px rgba(0,0,0,0.85)`,
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          transition:   'box-shadow 600ms ease',
        }}>
          {track.albumArt
            ? <img
                src={track.albumArt}
                alt="Albüm kapağı"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            : <Tv2 size={72} color={`rgba(${ambientRgb}, 0.8)`} />
          }
        </div>

        {/* Parça bilgisi */}
        <div style={{ textAlign: 'center', width: '100%' }}>
          <div style={{
            color:        '#ffffff',
            fontSize:     22,
            fontWeight:   800,
            letterSpacing:'-0.5px',
            marginBottom: 4,
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            maxWidth:     '100%',
          }}>
            {media.playing ? (track.title || 'Çalıyor...') : 'Medya Oynatıcı'}
          </div>
          <div style={{ color: '#6b7280', fontSize: 14 }}>
            {media.playing ? (track.artist || '') : 'Müzik veya video başlat'}
          </div>
        </div>

        {/* İlerleme çubuğu — yalnızca süre biliniyorsa */}
        {track.durationSec > 0 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              width:        '100%',
              height:       4,
              background:   'rgba(255,255,255,0.10)',
              borderRadius: 2,
              overflow:     'hidden',
            }}>
              <div style={{
                height:       '100%',
                width:        `${Math.round(progress * 100)}%`,
                background:   `rgb(${ambientRgb})`,
                borderRadius: 2,
                transition:   'width 500ms linear',
              }} />
            </div>
            <div style={{
              display:         'flex',
              justifyContent:  'space-between',
              color:           '#6b7280',
              fontSize:        11,
            }}>
              <span>{_fmtTime(track.positionSec)}</span>
              <span>{_fmtTime(track.durationSec)}</span>
            </div>
          </div>
        )}

        {/* Oynatma kontrolleri */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <button onClick={previous} style={_btnStyle} aria-label="Önceki parça">
            <SkipBack size={26} color="#ffffff" />
          </button>

          <button
            onClick={togglePlayPause}
            style={{
              ..._btnStyle,
              width:      72,
              height:     72,
              background: `linear-gradient(135deg, rgba(${ambientRgb},0.90), rgba(${ambientRgb},0.55))`,
              border:     `1px solid rgba(${ambientRgb},0.50)`,
              boxShadow:  `0 0 32px rgba(${ambientRgb},0.40)`,
            }}
            aria-label={media.playing ? 'Duraklat' : 'Oynat'}
          >
            {media.playing
              ? <Pause size={30} color="#ffffff" />
              : <Play  size={30} color="#ffffff" style={{ marginLeft: 3 }} />
            }
          </button>

          <button onClick={next} style={_btnStyle} aria-label="Sonraki parça">
            <SkipForward size={26} color="#ffffff" />
          </button>
        </div>

        {/* Uygulamayı aç */}
        <button onClick={handleLaunchApp} style={_launchBtnStyle}>
          <ExternalLink size={14} />
          Uygulamayı Aç
        </button>
      </div>

      {/* Alt bilgi */}
      <div style={{
        position:      'absolute',
        bottom:        24,
        color:         '#374151',
        fontSize:      11,
        letterSpacing: '0.05em',
      }}>
        Çıkmak için butona dokunun veya araca girin
      </div>
    </div>
  );
}

// ── Statik stil sabitleri ─────────────────────────────────────────────────────

const _btnStyle: React.CSSProperties = {
  width:          56,
  height:         56,
  borderRadius:   28,
  background:     'rgba(255,255,255,0.07)',
  border:         '1px solid rgba(255,255,255,0.12)',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  cursor:         'pointer',
  transition:     'transform 80ms ease',
};

const _launchBtnStyle: React.CSSProperties = {
  display:     'flex',
  alignItems:  'center',
  gap:         8,
  padding:     '10px 24px',
  borderRadius: 14,
  background:  'rgba(255,255,255,0.06)',
  border:      '1px solid rgba(255,255,255,0.12)',
  color:       '#9ca3af',
  fontSize:    13,
  fontWeight:  600,
  cursor:      'pointer',
};
