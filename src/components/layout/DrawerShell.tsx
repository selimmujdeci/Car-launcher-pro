import { memo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
      {/* Panel */}
      <div
        style={{
          position: 'absolute',
          top: '12px', right: '24px', bottom: '24px', left: '24px',
          borderRadius: '40px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          opacity: open ? 1 : 0,
          transition: 'transform 0.7s cubic-bezier(0.4,0,0.2,1), opacity 0.5s ease',
          willChange: 'transform, opacity',
        }}
      >
        {/* Sürükle tutacağı */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: '20px',
            paddingBottom: '8px',
            flexShrink: 0,
            cursor: 'pointer',
            background: 'rgba(7,12,24,0.98)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
          }}
          onClick={onClose}
        >
          <div style={{ width: '80px', height: '8px', borderRadius: '9999px', opacity: 0.25, background: '#94a3b8' }} />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'rgba(7,12,24,0.98)',
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
        background: 'rgba(7,12,24,0.98)',
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
  if (fullscreen) {
    return <FullscreenDrawer open={open} onClose={onClose}>{children}</FullscreenDrawer>;
  }
  return <NormalDrawer open={open} onClose={onClose}>{children}</NormalDrawer>;
});
