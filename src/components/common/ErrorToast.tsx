/**
 * ErrorToast — uygulama genelinde toast bildirim katmanı.
 *
 * MainLayout'a bir kez mount edilir. Tüm bileşenler errorBus.showToast()
 * çağırarak bildirim gösterebilir.
 *
 * Konumlanma: sağ-üst köşe, araç HMI stilinde.
 */
import { memo, useCallback } from 'react';
import { X, AlertCircle, AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { useToasts, dismissToast, type AppToast, type ToastType } from '../../platform/errorBus';

/* ── Toast tipi meta ─────────────────────────────────────── */

interface ToastMeta {
  icon:        React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  bg:          string;
  border:      string;
  iconColor:   string;
  titleColor:  string;
}

/* Theme-aware: bg = --oem-surface-0 (gündüz beyaz / gece koyu), renkli border+ikon
 * aksan olarak her iki modda çalışır, başlık okunabilir MİD-TON (beyaz+koyu zeminde). */
const TYPE_META: Record<ToastType, ToastMeta> = {
  error: {
    icon:       AlertCircle,
    bg:         'var(--oem-surface-0)',
    border:     '#ef444455',
    iconColor:  '#ef4444',
    titleColor: '#dc2626',
  },
  warning: {
    icon:       AlertTriangle,
    bg:         'var(--oem-surface-0)',
    border:     '#f59e0b55',
    iconColor:  '#f59e0b',
    titleColor: '#d97706',
  },
  info: {
    icon:       Info,
    bg:         'var(--oem-surface-0)',
    border:     '#3b82f655',
    iconColor:  '#3b82f6',
    titleColor: '#2563eb',
  },
  success: {
    icon:       CheckCircle,
    bg:         'var(--oem-surface-0)',
    border:     '#22c55e55',
    iconColor:  '#22c55e',
    titleColor: '#16a34a',
  },
};

/* ── Tek toast ───────────────────────────────────────────── */

const ToastItem = memo(function ToastItem({ toast }: { toast: AppToast }) {
  const meta = TYPE_META[toast.type];
  const onClose = useCallback(() => dismissToast(toast.id), [toast.id]);

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-2xl shadow-2xl max-w-xs animate-slide-up select-none"
      style={{
        backgroundColor: meta.bg,
        border:          `1px solid ${meta.border}`,
        backdropFilter:  'blur(12px)',
      }}
    >
      <meta.icon
        className="w-5 h-5 flex-shrink-0 mt-0.5"
        style={{ color: meta.iconColor }}
      />
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-bold leading-tight truncate"
          style={{ color: meta.titleColor }}
        >
          {toast.title}
        </div>
        {toast.message && (
          <div className="text-xs mt-1 leading-snug line-clamp-2"
            style={{ color: 'var(--oem-ink-3)' }}>
            {toast.message}
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 active:scale-90 transition-all"
        style={{ color: 'var(--oem-ink-3)' }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
});

/* ── Konteyner ───────────────────────────────────────────── */

export const ErrorToast = memo(function ErrorToast() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
});


