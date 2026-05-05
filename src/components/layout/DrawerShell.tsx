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
    <div className={`fixed inset-0 z-[1000] transition-all duration-500 ${
      open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
    }`}>
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: 'rgba(4,8,18,0.65)' }}
        onClick={onClose}
      />
      <div
        style={{ position: 'absolute', inset: '12px 24px 24px 24px' }}
        className={`rounded-[40px] overflow-hidden flex flex-col border-none !shadow-none transition-all duration-700 ${
          open ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        }`}
      >
        {/* Sürükle tutacağı */}
        <div
          className="flex justify-center pt-5 pb-2 flex-shrink-0 cursor-pointer"
          style={{
            background: 'rgba(7,12,24,0.98)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
          }}
          onClick={onClose}
        >
          <div className="w-20 h-2 rounded-full opacity-25 transition-all hover:opacity-45" style={{ background: '#94a3b8' }} />
        </div>
        <div
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
          style={{
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
// Android WebView'larda overflow:hidden veya backdrop-filter olan
// ata elementler position:fixed'ı kısıtlayabilir; portal bunu önler.
function FullscreenDrawer({ open, children }: Omit<Props, 'fullscreen'>) {
  const content = (
    <div
      className={`transition-all duration-500 ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(7,12,24,0.98)',
        overflow: 'hidden',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
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
