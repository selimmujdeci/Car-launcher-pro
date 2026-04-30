/**
 * ReversePriorityOverlay — Sıfır Gecikmeli Geri Vites Ekranı (R-7)
 *
 * Zustand, i18n veya Context'e bağımlı DEĞİLDİR.
 * Yalnızca cameraService (modül-düzey state) ve React primitif'lerini kullanır.
 * Bu sayede React hydration tamamlanmadan önce dahi anında render olabilir.
 *
 * Durum makinesi:
 *   1. Mount: window.__INITIAL_REVERSE__ flag'i kontrol → pre-React sinyal ise anında aç
 *   2. Runtime: onReverseSignal() aboneliği → signalReverse() çağrısına tepki ver
 *   3. Frame: useCameraState() → ilk frame gelene kadar "Initializing..." placeholder
 *   4. Kapatma: hysteresis cameraService'de yönetilir; onReverseSignal(false) → unmount
 *
 * z-index: 9999 — MainLayout (z-auto), ReverseOverlay (z-90), RadarHUD, GlobalAlert
 * hepsini örter; onların mount/render durumundan bağımsız çalışır.
 *
 * Native mod: cameraService native frames (Camera2 API)
 * Web mod:    ReversePriorityOverlay kullanılmaz (ReverseOverlay/getUserMedia devralır)
 */

import { useState, useEffect, memo } from 'react';
import { isNative } from '../../platform/bridge';
import { useCameraState, onReverseSignal } from '../../platform/cameraService';

/* ── window.__INITIAL_REVERSE__ tip uzantısı ─────────────── */

declare global {
  interface Window {
    __INITIAL_REVERSE__?: boolean;
  }
}

/* ── Fallback (kamera hatası / kullanılamaz) ─────────────── */

function CameraFallback() {
  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      zIndex:         9999,
      background:     '#000',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            8,
    }}>
      <span style={{
        color:         'rgba(255,255,255,0.75)',
        fontSize:      18,
        fontFamily:    'system-ui, sans-serif',
        fontWeight:    700,
        letterSpacing: 2,
      }}>
        REVERSE MODE
      </span>
      <span style={{
        color:      'rgba(255,255,255,0.35)',
        fontSize:   12,
        fontFamily: 'system-ui, sans-serif',
      }}>
        Camera unavailable
      </span>
    </div>
  );
}

/* ── Placeholder (frame gelmeden önce) ───────────────────── */

function RearViewPlaceholder() {
  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      zIndex:         9999,
      background:     '#000',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            12,
    }}>
      {/* Animasyonlu kamera ikonu */}
      <svg
        width="48" height="48" viewBox="0 0 24 24"
        fill="none" stroke="rgba(255,255,255,0.35)"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
      >
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
      <span style={{
        color:       'rgba(255,255,255,0.45)',
        fontSize:    13,
        fontFamily:  'system-ui, sans-serif',
        letterSpacing: 1,
      }}>
        REAR VIEW INITIALIZING
      </span>
      {/* Inline pulse keyframe — Tailwind yüklü olmasa da çalışır */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.35; }
          50%       { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}

/* ── Ana overlay ─────────────────────────────────────────── */

export const ReversePriorityOverlay = memo(function ReversePriorityOverlay() {
  // Web modunda bu bileşen hiç render edilmez — ReverseOverlay/getUserMedia devralır
  if (!isNative) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return <_NativeReverseOverlay />;
});

function _NativeReverseOverlay() {
  // window.__INITIAL_REVERSE__ → React öncesi geri vites tespit edildi; anında aç
  const [active, setActive] = useState<boolean>(
    () => window.__INITIAL_REVERSE__ === true,
  );
  const camera = useCameraState();

  useEffect(() => {
    return onReverseSignal(setActive);
  }, []);

  if (!active) return null;

  // cameraReady: kamera aktif ve çalışıyor; false → hata veya henüz başlamadı
  const cameraReady = camera.status !== 'error';

  // Kamera açılamadı / kullanılamaz → boş ekran yerine fallback göster
  if (!cameraReady) return <CameraFallback />;

  // Kamera açılıyor ama frame henüz gelmedi → "Initializing" placeholder
  if (!camera.currentFrame) {
    return <RearViewPlaceholder />;
  }

  // Native Camera2 frame'i — tam ekran, kılavuz çizgisiz hızlı görünüm
  return (
    <div style={{
      position:   'fixed',
      inset:      0,
      zIndex:     9999,
      background: '#000',
    }}>
      <img
        src={camera.currentFrame}
        alt="rear view"
        style={{
          width:      '100%',
          height:     '100%',
          objectFit:  'cover',
          display:    'block',
        }}
      />
      {/* Minimal durum göstergesi */}
      <div style={{
        position:    'absolute',
        top:         16,
        left:        16,
        display:     'flex',
        alignItems:  'center',
        gap:         6,
        pointerEvents: 'none',
      }}>
        <span style={{
          width:        8,
          height:       8,
          borderRadius: '50%',
          background:   '#ef4444',
          animation:    'pulse 1.5s ease-in-out infinite',
          display:      'inline-block',
        }} />
        <span style={{
          color:        'rgba(255,255,255,0.85)',
          fontSize:     11,
          fontFamily:   'system-ui, sans-serif',
          fontWeight:   700,
          letterSpacing: 1.5,
        }}>
          GERİ GÖRÜŞ
        </span>
      </div>
    </div>
  );
}
