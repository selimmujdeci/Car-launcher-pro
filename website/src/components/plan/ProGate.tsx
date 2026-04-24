'use client';

import { usePlan } from '@/hooks/usePlan';
import type { ProFeatureKey } from '@/types/plan';
import { PRO_FEATURE_LABELS } from '@/types/plan';

interface Props {
  feature:  ProFeatureKey;
  children: React.ReactNode;
  /** Kilit ekranı yerine null render et (daha minimal davranış) */
  silent?:  boolean;
}

export function ProGate({ feature, children, silent = false }: Props) {
  const { canUse, loaded, isTrial } = usePlan();

  // Yüklenmediyse içeriği render et (FOUC yok)
  if (!loaded) return <>{children}</>;

  // PRO veya aktif trial → normal render
  if (canUse(feature)) return <>{children}</>;

  // Free / trial bitti → kilitli
  if (silent) return null;

  const label = PRO_FEATURE_LABELS[feature];

  return (
    <div
      className="relative w-full h-full min-h-[120px] rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-3 p-6 text-center select-none"
      style={{
        background: 'rgba(6,13,26,0.85)',
        border: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Lock icon */}
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)' }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="3" y="10" width="16" height="10" rx="2.5" stroke="#60a5fa" strokeWidth="1.6"/>
          <path d="M7 10V7a4 4 0 018 0v3" stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round"/>
          <circle cx="11" cy="15" r="1.5" fill="#60a5fa"/>
        </svg>
      </div>

      {/* Labels */}
      <div>
        <p className="text-white font-bold text-sm">{label}</p>
        <p className="text-white/40 text-xs mt-1">
          {isTrial
            ? 'Deneme süreniz doldu'
            : 'Bu özellik PRO plana özel'}
        </p>
      </div>

      {/* CTA */}
      <a
        href="/contact"
        className="px-4 py-2 rounded-xl text-xs font-bold tracking-wide transition-all active:scale-95"
        style={{
          background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
          color: '#fff',
          boxShadow: '0 4px 16px rgba(59,130,246,0.3)',
        }}
      >
        PRO'ya Geç
      </a>
    </div>
  );
}

/** Sadece isPro kontrolü döndüren hafif hook */
export function useCanUse(feature: ProFeatureKey): boolean {
  const { canUse, loaded } = usePlan();
  if (!loaded) return true; // yüklenene kadar aç
  return canUse(feature);
}
