import type { CSSProperties } from 'react';

export type FeatureTone = 'blue' | 'emerald' | 'violet' | 'orange';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  tone?: FeatureTone;
}

/** Ton başına renk seti — kartlar tek dil içinde birbirinden ayrışsın diye.
 *  CSS değişkeni ile veriyoruz → Tailwind purge sorunundan bağımsız, iki temada da çalışır. */
const TONES: Record<FeatureTone, { ring: string; tint: string; ink: string; glow: string }> = {
  blue:    { ring: 'rgba(59,130,246,0.22)',  tint: 'rgba(59,130,246,0.10)',  ink: 'var(--tone-blue)',    glow: 'rgba(59,130,246,0.14)' },
  emerald: { ring: 'rgba(16,185,129,0.22)',  tint: 'rgba(16,185,129,0.10)',  ink: 'var(--tone-emerald)', glow: 'rgba(16,185,129,0.14)' },
  violet:  { ring: 'rgba(139,92,246,0.22)',  tint: 'rgba(139,92,246,0.10)',  ink: 'var(--tone-violet)',  glow: 'rgba(139,92,246,0.14)' },
  orange:  { ring: 'rgba(249,115,22,0.22)',  tint: 'rgba(249,115,22,0.10)',  ink: 'var(--tone-orange)',  glow: 'rgba(249,115,22,0.14)' },
};

export default function FeatureCard({ icon, title, description, badge, tone = 'blue' }: FeatureCardProps) {
  const t = TONES[tone];
  const vars = {
    '--fc-ring': t.ring,
    '--fc-tint': t.tint,
    '--fc-ink': t.ink,
    '--fc-glow': t.glow,
  } as CSSProperties;

  return (
    <div
      style={vars}
      className="group relative p-6 rounded-2xl bg-card border border-line shadow-soft transition-all duration-300 overflow-hidden hover:-translate-y-0.5 hover:shadow-soft-lg hover:border-[color:var(--fc-ring)]"
    >
      {/* Tona göre hover parıltısı */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at top left, var(--fc-glow) 0%, transparent 62%)' }}
      />

      <div className="relative">
        {/* İkon — ton renginde çerçeve/dolgu */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 transition-colors"
          style={{ background: 'var(--fc-tint)', border: '1px solid var(--fc-ring)' }}
        >
          {icon}
        </div>

        {/* Rozet */}
        {badge && (
          <span
            className="absolute top-0 right-0 text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded-full"
            style={{ background: 'var(--fc-tint)', border: '1px solid var(--fc-ring)', color: 'var(--fc-ink)' }}
          >
            {badge}
          </span>
        )}

        <h3 className="font-semibold text-ink mb-2.5">{title}</h3>
        <p className="text-sm text-ink-3 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
