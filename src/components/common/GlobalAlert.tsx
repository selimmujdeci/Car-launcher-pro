/**
 * GlobalAlert — "dumb" bileşen.
 * İş mantığı yoktur; yalnızca useSystemStore.activeAlerts okur.
 * Alert ekleme / zamanlayıcı / TTS → SystemOrchestrator'ın sorumluluğu.
 */

import { memo } from 'react';
import { AlertTriangle, Fuel, ShieldAlert, Wrench, X } from 'lucide-react';
import { useSystemStore, type SystemAlert } from '../../store/useSystemStore';

export const GlobalAlert = memo(function GlobalAlert() {
  const alerts  = useSystemStore((s) => s.activeAlerts);
  const dismiss = useSystemStore((s) => s.dismissAlert);
  const visible = alerts.filter((a) => !a.suppressed);

  if (visible.length === 0) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9990] flex flex-col gap-2 pointer-events-none"
      style={{ minWidth: '18rem', maxWidth: '22rem' }}
      aria-live="assertive"
      role="alert"
    >
      {visible.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onDismiss={dismiss} />
      ))}
    </div>
  );
});

/* ── Alert kartı ─────────────────────────────────────────── */

function AlertCard({
  alert,
  onDismiss,
}: {
  alert:     SystemAlert;
  onDismiss: (id: number) => void;
}) {
  const isCritical = alert.severity === 'CRITICAL';

  return (
    <div className="relative pointer-events-auto">
      {/* CRITICAL: radar-ping arka plan efekti */}
      {isCritical && (
        <div className="absolute inset-0 rounded-2xl bg-red-500/25 animate-ping" />
      )}

      <div
        className={[
          'relative flex items-start gap-3 rounded-2xl px-4 py-3',
          'backdrop-blur-md border shadow-2xl',
          isCritical
            ? 'bg-red-950/90 border-red-500/70 shadow-red-900/50'
            : 'bg-amber-950/90 border-amber-500/50 shadow-amber-900/40',
        ].join(' ')}
      >
        {/* İkon */}
        <div
          className={[
            'flex-shrink-0 mt-0.5 rounded-full p-1.5',
            isCritical
              ? 'bg-red-500/20 text-red-400 animate-pulse'
              : 'bg-amber-500/20 text-amber-400',
          ].join(' ')}
        >
          {alert.type === 'LOW_FUEL' || alert.type === 'CRITICAL_FUEL'
            ? <Fuel size={16} />
            : alert.type === 'MAINTENANCE_REQUIRED'
            ? <Wrench size={16} />
            : alert.type === 'CRASH_DETECTED'
            ? <ShieldAlert size={16} />
            : <AlertTriangle size={16} />
          }
        </div>

        {/* Metin */}
        <div className="flex-1 min-w-0">
          <p className={[
            'text-sm font-bold leading-tight',
            isCritical ? 'text-red-300' : 'text-amber-300',
          ].join(' ')}>
            {alert.label}
          </p>
          <p className="text-xs text-white/50 mt-0.5 leading-snug">
            {alert.sublabel}
          </p>
        </div>

        {/* Kapat */}
        <button
          onClick={() => onDismiss(alert.id)}
          className="flex-shrink-0 p-1 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
          aria-label="Uyarıyı kapat"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
