import { useEffect, useRef, useState } from 'react';
import { Bug } from 'lucide-react';
import { installNetworkInterceptor } from './NetworkInterceptor';
import { InspectorPanel }            from './InspectorPanel';

/* Dev-only component — returns null in production builds.
   Vite dead-code-eliminates everything inside when import.meta.env.DEV is false. */

function DevInspectorInner() {
  const [open, setOpen] = useState(false);

  /* Install fetch interceptor for the lifetime of the dev session */
  useEffect(() => {
    return installNetworkInterceptor();
  }, []);

  /* Long-press (600 ms) on the toggle button to avoid accidental opens */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onPointerDown() {
    pressTimer.current = setTimeout(() => setOpen(true), 600);
  }
  function onPointerUp() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  return (
    <>
      {/* Floating toggle — bottom-right, below DebugPanel (z-9999) */}
      <button
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        title="DevInspector (hold 600ms)"
        className="fixed bottom-4 right-4 flex items-center justify-center rounded-full"
        style={{
          width: 40, height: 40, zIndex: 9989,
          background: open ? '#1d4ed8' : '#172554',
          border: '2px solid #3b82f6',
          color: '#93c5fd',
          boxShadow: '0 0 12px rgba(59,130,246,0.5)',
        }}
      >
        <Bug size={18} />
      </button>

      {open && <InspectorPanel onClose={() => setOpen(false)} />}
    </>
  );
}

export function DevInspector() {
  if (!import.meta.env.DEV) return null;
  return <DevInspectorInner />;
}
