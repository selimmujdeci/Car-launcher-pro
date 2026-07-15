import { memo, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Freeze } from './Freeze';

interface Props {
  open:        boolean;
  onClose:     () => void;
  children:    ReactNode;
  fullscreen?: boolean;
}

// Normal drawer (yarı saydam arka plan + içerik paneli)
function NormalDrawer({ open, onClose, children }: Omit<Props, 'fullscreen'>) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        width: '100%', height: '100%',
        zIndex: 1000,
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 0.5s',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(4,8,18,0.65)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onClick={onClose}
      />
      {/* Panel — token-driven premium yüzey (pano ile tutarlı) + kenar + elevation */}
      <div
        style={{
          position: 'absolute',
          top: '12px', right: '24px', bottom: '24px', left: '24px',
          borderRadius: '32px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--oem-line)',
          boxShadow: '0 -1px 0 rgba(255,255,255,0.05) inset, 0 32px 80px -28px rgba(0,0,0,0.72)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          opacity: open ? 1 : 0,
          transition: 'transform 0.7s cubic-bezier(0.4,0,0.2,1), opacity 0.5s ease',
          willChange: 'transform, opacity',
        }}
      >
        {/* Üst aksan hairline */}
        <div aria-hidden style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '38%', height: 1, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, var(--oem-accent), transparent)',
          opacity: 0.6, zIndex: 2,
        }} />
        {/* Sürükle tutacağı */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: '16px',
            paddingBottom: '10px',
            flexShrink: 0,
            cursor: 'pointer',
            background: 'var(--oem-surface-0)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
          }}
          onClick={onClose}
        >
          <div style={{ width: '48px', height: '5px', borderRadius: '9999px', background: 'var(--oem-line)' }} />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--oem-surface-0)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// Fullscreen drawer — createPortal ile body'e mount edilir.
// Android WebView'larda position:fixed + inset:0 bazen viewport'u tam kaplamaz;
// explicit top/left/right/bottom + width/height ile garantiye alınır.
function FullscreenDrawer({ open, children }: Omit<Props, 'fullscreen'>) {
  const content = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary, #0f1320)',
        overflow: 'hidden',
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
        willChange: 'transform, opacity',
      }}
    >
      {children}
    </div>
  );
  return createPortal(content, document.body);
}

export const DrawerShell = memo(function DrawerShell({ open, onClose, children, fullscreen }: Props) {
  // Kapalı drawer'ın alt ağacını DONDUR (render+effect+paint durur, state kalır).
  // Kapanışta 700ms bekle → kapanış animasyonu içerik doluyken tamamlansın
  // (anında donunca Suspense içeriği gizler, panel boş kayarak inerdi).
  const [frozen, setFrozen] = useState(!open);
  useEffect(() => {
    if (open) { setFrozen(false); return; }
    const t = setTimeout(() => setFrozen(true), 700);
    return () => clearTimeout(t);
  }, [open]);

  const frozenChildren = <Freeze freeze={frozen && !open}>{children}</Freeze>;

  if (fullscreen) {
    return <FullscreenDrawer open={open} onClose={onClose}>{frozenChildren}</FullscreenDrawer>;
  }
  return <NormalDrawer open={open} onClose={onClose}>{frozenChildren}</NormalDrawer>;
});
