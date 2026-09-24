/**
 * CurveAdvisoryBadge — öndeki virajın önerilen hızı (sarı uyarı levhası).
 *
 * Veri `curveAdvisoryRuntime`den gelir (rota geometrisinden hesaplanır). Öneri
 * yoksa HİÇBİR ŞEY çizilmez — yol düz ya da rota yok demektir, "—" basılmaz.
 * Araç önerinin üstündeyse levha kırmızı çerçeveyle vurgulanır.
 */
import { memo } from 'react';
import type { CurveAdvisory } from '../../platform/navigation/core/curveAdvisoryModel';

export interface CurveAdvisoryBadgeProps {
  readonly advisory: CurveAdvisory | null;
  readonly speedKmh: number | null;
  readonly size?: 'mini' | 'full';
}

export const CurveAdvisoryBadge = memo(function CurveAdvisoryBadge({ advisory, speedKmh, size = 'full' }: CurveAdvisoryBadgeProps) {
  if (!advisory) return null;
  const px = size === 'mini' ? 44 : 58;
  const tooFast = speedKmh !== null && speedKmh > advisory.advisoryKmh + 5;
  const flip = advisory.direction === 'left' ? 'scale(-1,1) translate(-24,0)' : undefined;
  const dist = advisory.distanceM >= 50 ? `${Math.round(advisory.distanceM / 50) * 50} m` : 'şimdi';
  return (
    <div data-testid="curve-advisory" data-curve-direction={advisory.direction}
      data-curve-too-fast={tooFast ? 'true' : undefined}
      className="flex flex-col items-center" style={{ width: px }}
      aria-label={`${advisory.direction === 'right' ? 'Sağa' : 'Sola'} viraj, önerilen hız ${advisory.advisoryKmh} km/sa, ${dist}`}>
      <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="2.2" transform="rotate(45 12 12)"
          fill="#FFC107" stroke={tooFast ? '#dc2626' : '#1f2937'} strokeWidth={tooFast ? 2 : 1.2} />
        <g transform={flip}>
          <path d="M9 17V12Q9 8.5 12.5 8.5H15M13.3 6.6L15.3 8.5L13.3 10.4" fill="none" stroke="#111"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      <span className="-mt-1 rounded-md px-1.5 text-center font-bold leading-tight"
        style={{ background: '#FFC107', color: '#111', fontSize: size === 'mini' ? 12 : 15,
          outline: tooFast ? '2px solid #dc2626' : undefined }}>
        {advisory.advisoryKmh}
      </span>
      <span className="mt-0.5 text-[10px] font-semibold" style={{ color: 'var(--oem-ink-2, #cbd5e1)' }}>{dist}</span>
    </div>
  );
});
