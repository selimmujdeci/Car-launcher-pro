import { memo } from 'react';
import type { LayoutVariant } from '../../platform/themeLayoutEngine';

const VARIANT_LABELS: Record<LayoutVariant, string> = {
  'map-first': 'Harita Odaklı',
  'cockpit':   'Sürücü Kokpiti',
  'glass':     'Modern Cam',
  'sport':     'Agresif Spor',
};

const VARIANT_ICONS: Record<LayoutVariant, number> = {
  'map-first': 12,
  'cockpit':   24,
  'glass':     16,
  'sport':     20,
};

export const LayoutPreview = memo(function LayoutPreview({ variant }: { variant: LayoutVariant }) {
  const label = VARIANT_LABELS[variant] || 'Varsayılan';
  const iconSize = VARIANT_ICONS[variant] || 16;

  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10">
      <div className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-500/20 text-blue-400" style={{ fontSize: iconSize }}>
        ◈
      </div>
      <div className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</div>
    </div>
  );
});
