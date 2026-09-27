'use client';

/**
 * Arabam Cebimde · Material 3 ortak parçaları (yalnız görünüm).
 *
 * Bu dosya veri OKUMAZ, karar VERMEZ: her parça çağıranın verdiği metni ve
 * durumu çizer. Renkler yalnız `--md-*` rollerinden gelir (globals.css).
 */

import { useEffect, useId, useRef } from 'react';
import { Icon, type IconName } from './Icon';

/* ── Durum tonu → M3 rol çifti ─────────────────────────────────────────── */

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

export const TONE_ROLES: Record<Tone, { fg: string; container: string; onContainer: string }> = {
  neutral: { fg: 'var(--md-on-surface-variant)', container: 'var(--md-surface-container-highest)', onContainer: 'var(--md-on-surface)' },
  primary: { fg: 'var(--md-primary)', container: 'var(--md-primary-container)', onContainer: 'var(--md-on-primary-container)' },
  success: { fg: 'var(--md-success)', container: 'var(--md-success-container)', onContainer: 'var(--md-on-success-container)' },
  warning: { fg: 'var(--md-warning)', container: 'var(--md-warning-container)', onContainer: 'var(--md-on-warning-container)' },
  error:   { fg: 'var(--md-error)',   container: 'var(--md-error-container)',   onContainer: 'var(--md-on-error-container)' },
};

/** Küçük durum hapı — renk tek başına anlam taşımaz, metin her zaman yazılır. */
export function StatusPill({ tone = 'neutral', icon, children }: {
  tone?: Tone; icon?: IconName; children: React.ReactNode;
}) {
  const r = TONE_ROLES[tone];
  return (
    <span className="md-label-m inline-flex items-center gap-1 px-2 flex-shrink-0"
      style={{ minHeight: 24, borderRadius: 'var(--md-shape-sm)', background: r.container, color: r.onContainer }}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </span>
  );
}

/** 40dp tonal ikon kabı. */
export function IconBadge({ name, tone = 'neutral', size = 40 }: { name: IconName; tone?: Tone; size?: number }) {
  const r = TONE_ROLES[tone];
  return (
    <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: 'var(--md-shape-full)',
        background: tone === 'neutral' ? 'var(--md-secondary-container)' : r.container,
        color: tone === 'neutral' ? 'var(--md-on-secondary-container)' : r.onContainer }}>
      <Icon name={name} size={Math.round(size * 0.55)} />
    </span>
  );
}

/* ── Bölüm başlığı ─────────────────────────────────────────────────────── */

export function SectionHeader({ title, trailing, id }: {
  title: string; trailing?: React.ReactNode; id?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-1 pt-4 pb-2">
      <h2 id={id} className="md-title-m md-on-surface">{title}</h2>
      {trailing && <span className="md-body-m md-on-surface-variant">{trailing}</span>}
    </div>
  );
}

/* ── Segment düğmesi (M3 segmented button) ─────────────────────────────── */

export function SegmentedButton<T extends string>({
  options, value, onChange, label,
}: {
  options: ReadonlyArray<{ id: T; label: string; icon?: IconName }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex w-full"
      style={{ border: '1px solid var(--md-outline)', borderRadius: 'var(--md-shape-full)', overflow: 'hidden' }}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button key={o.id} role="tab" aria-selected={on} onClick={() => onChange(o.id)}
            className="md-state flex-1 min-w-0 flex items-center justify-center gap-2 md-label-l"
            style={{
              minHeight: 48,
              borderLeft: i > 0 ? '1px solid var(--md-outline)' : undefined,
              background: on ? 'var(--md-secondary-container)' : 'transparent',
              color: on ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface)',
            }}>
            {on ? <Icon name="check_circle" size={18} /> : o.icon ? <Icon name={o.icon} size={18} /> : null}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Boş durum ─────────────────────────────────────────────────────────── */

/** Illüstrasyon (büyük tonal ikon) + tek cümle + en fazla bir eylem. */
export function EmptyState({ icon, title, body, action }: {
  icon: IconName; title: string; body?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-10 gap-3">
      <span aria-hidden="true" className="flex items-center justify-center"
        style={{ width: 88, height: 88, borderRadius: 'var(--md-shape-xl)',
          background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface-variant)' }}>
        <Icon name={icon} size={44} />
      </span>
      <p className="md-title-m md-on-surface mt-2">{title}</p>
      {body && <p className="md-body-m md-on-surface-variant max-w-xs">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ── Alt sayfa (M3 modal bottom sheet) ─────────────────────────────────── */

/**
 * Kapalıyken DOM'da `hidden` durur (içindeki düğmeler kaybolmaz; ekran
 * okuyucu ve odak için gizlidir). Esc ve sürükleme tutamacı/zemin kapatır.
 */
export function BottomSheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);

  return (
    <div hidden={!open} className="fixed inset-0 z-50">
      <button aria-label="Kapat" onClick={onClose} className="absolute inset-0 w-full h-full md-sheet-scrim"
        style={{ background: 'color-mix(in srgb, var(--md-scrim) 32%, transparent)' }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="md-sheet absolute left-0 right-0 bottom-0 mx-auto w-full max-w-lg pb-safe outline-none"
        style={{ background: 'var(--md-surface-container-low)', color: 'var(--md-on-surface)',
          borderRadius: 'var(--md-shape-xl) var(--md-shape-xl) 0 0', maxHeight: '85dvh', overflowY: 'auto' }}>
        <div className="flex justify-center pt-4 pb-2" aria-hidden="true">
          <span style={{ width: 32, height: 4, borderRadius: 2, background: 'var(--md-on-surface-variant)', opacity: 0.4 }} />
        </div>
        <h2 id={titleId} className="md-title-l px-6 pt-2 pb-3">{title}</h2>
        <div className="pb-4">{children}</div>
      </div>
    </div>
  );
}

/** Alt sayfa / liste satırı — 56dp, öncü ikon + metin + isteğe bağlı sondaki öğe. */
export function ListRow({ icon, label, supporting, trailing, onClick, tone, testId, disabled, as = 'button' }: {
  icon?: IconName; label: React.ReactNode; supporting?: React.ReactNode; trailing?: React.ReactNode;
  onClick?: () => void; tone?: Tone; testId?: string; disabled?: boolean; as?: 'button' | 'div';
}) {
  const color = tone ? TONE_ROLES[tone].fg : 'var(--md-on-surface)';
  const inner = (
    <>
      {icon && <span className="flex-shrink-0" style={{ color: tone ? color : 'var(--md-on-surface-variant)' }}><Icon name={icon} /></span>}
      <span className="flex-1 min-w-0">
        <span className="block md-body-l" style={{ color }}>{label}</span>
        {supporting && <span className="block md-body-m md-on-surface-variant">{supporting}</span>}
      </span>
      {trailing}
    </>
  );
  if (as === 'div') return <div className="md-list-item px-6">{inner}</div>;
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId}
      className="md-list-item md-state px-6 disabled:opacity-50">
      {inner}
    </button>
  );
}
