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

const TYPE_META: Record<ToastType, ToastMeta> = {
  error: {
    icon:       AlertCircle,
    bg:         '#1a0a0a',
    border:     '#ef444430',
    iconColor:  '#ef4444',
    titleColor: '#fca5a5',
  },
  warning: {
    icon:       AlertTriangle,
    bg:         '#1a140a',
    border:     '#f59e0b30',
    iconColor:  '#f59e0b',
    titleColor: '#fcd34d',
  },
  info: {
    icon:       Info,
    bg:         '#0a0f1a',
    border:     '#3b82f630',
    iconColor:  '#3b82f6',
    titleColor: '#93c5fd',
  },
  success: {
    icon:       CheckCircle,
    bg:         '#0a1a0f',
    border:     '#22c55e30',
    iconColor:  '#22c55e',
    titleColor: '#86efac',
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
          <div className="text-xs text-slate-400 mt-1 leading-snug line-clamp-2">
            {toast.message}
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 text-slate-600 hover:text-slate-400 active:scale-90 transition-all"
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
