/**
 * Layout Preview
 * Seçili temanın layout yapısını mini diagram olarak gösterir.
 * Tema değişince anlık güncellenir.
 */
import { memo } from 'react';
import { getLayoutConfig, type LayoutVariant } from '../../platform/themeLayoutEngine';
import type { ThemePack } from '../../store/useStore';

/* ── Layout variant metadata ──────────────────────────────── */

const VARIANT_LABELS: Record<LayoutVariant, string> = {
  'map-first': 'Harita Dominant',
  'cockpit':   'Cockpit (Speedo Büyük)',
  'glass':     'Dengeli Cam',
  'sport':     'Spor (Eşit)',
  'content':   'İçerik Odaklı',
  'minimal':   'Minimal',
  'balanced':  'Dengeli',
};

/* ── Mini Layout Diagram ──────────────────────────────────── */

interface DiagramProps {
  variant:   LayoutVariant;
  mapBasis:  string;  // e.g. "42%"
  accentHex: string;
  bgHex:     string;
}

function parsePct(basis: string): number {
  const n = parseFloat(basis);
  return isNaN(n) ? 42 : Math.max(20, Math.min(55, n));
}

function MiniDiagram({ variant, mapBasis, accentHex, bgHex }: DiagramProps) {
  const mapPct     = parsePct(mapBasis);

  // Speedo width hint from variant
  const speedoPctMap: Record<LayoutVariant, number> = {
    'map-first': 15,
    'cockpit':   28,
    'glass':     20,
    'sport':     24,
    'content':   18,
    'minimal':   17,
    'balanced':  20,
  };
  const speedoPct  = speedoPctMap[variant] ?? 20;

  const accentAlpha = `${accentHex}44`;
  const accentMid   = `${accentHex}88`;

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-white/10"
      style={{ background: bgHex, height: '72px', width: '100%' }}
    >
      {/* Header bar */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: '8px', background: `${accentHex}22`, borderBottom: `1px solid ${accentAlpha}` }}
      />

      {/* Main row */}
      <div className="absolute flex gap-0.5" style={{ top: '9px', bottom: '9px', left: '4px', right: '4px' }}>
        {/* Speedo */}
        <div
          className="rounded flex-shrink-0 flex items-center justify-center"
          style={{
            width:      `${speedoPct}%`,
            background: `${accentHex}18`,
            border:     `1px solid ${accentMid}`,
          }}
        >
          <span className="text-[6px] font-black" style={{ color: accentHex }}>SPD</span>
        </div>

        {/* Content */}
        <div
          className="rounded flex-1 flex items-center justify-center"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border:     '1px solid rgba(255,255,255,0.08)',
            minWidth:   0,
          }}
        >
          <div className="flex flex-col gap-0.5 items-center">
            <div className="w-8 h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
            <div className="w-6 h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
          </div>
        </div>

        {/* Map */}
        <div
          className="rounded flex-shrink-0 flex items-center justify-center"
          style={{
            width:      `${mapPct}%`,
            background: `${accentHex}0f`,
            border:     `1px solid ${accentAlpha}`,
          }}
        >
          <span className="text-[6px] font-black" style={{ color: `${accentHex}99` }}>MAP</span>
        </div>
      </div>

      {/* Dock bar */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: '8px', background: `${accentHex}18`, borderTop: `1px solid ${accentAlpha}` }}
      />
    </div>
  );
}

/* ── Public component ─────────────────────────────────────── */

interface Props {
  pack: ThemePack;
}

export const LayoutPreview = memo(function LayoutPreview({ pack }: Props) {
  const config = getLayoutConfig(pack);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest">
          Layout Önizleme
        </span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: `${config.accentHex}20`,
            color:      config.accentHex,
            border:     `1px solid ${config.accentHex}40`,
          }}
        >
          {VARIANT_LABELS[config.variant]}
        </span>
      </div>

      <MiniDiagram
        variant={config.variant}
        mapBasis={config.mapBasis}
        accentHex={config.accentHex}
        bgHex={config.bgHex}
      />

      <p className="text-slate-600 text-[10px] leading-relaxed">
        {config.description}
      </p>
    </div>
  );
});
