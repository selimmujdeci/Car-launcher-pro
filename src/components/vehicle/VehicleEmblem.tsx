/**
 * VehicleEmblem — aracın amblemini çizer (logo paketi / kendi görselin / monogram).
 *
 * Yalnız görünüm: kimliği aktif `VehicleProfile`'dan OKUR, hiçbir şey yazmaz.
 * Stil: C · Cam/Neon (yarı saydam gövde + mavi→turuncu neon kenar) veya
 * orijinal renk. `scene` açılış sahnesi (kenar çizilir → dolar → ışık geçer),
 * `badge` ana ekran rozeti (ara sıra ince ışık kayması).
 */
import { memo, useId, useMemo } from 'react';
import { useStore, type VehicleProfile } from '../../store/useStore';
import { getPerformanceMode } from '../../platform/performanceMode';
import { brandLogoPath, getBrand, monogramOf } from '../../platform/vehicle/brandCatalog';
import './vehicleEmblem.css';

export type ResolvedEmblem =
  | { kind: 'logo'; path: string; hex: string; name: string }
  | { kind: 'image'; src: string; hex: string; name: string }
  | { kind: 'mono'; letter: string; hex: string; name: string };

const NEUTRAL = '#A4AAAE';

/** Profilden amblem çözümü. Hiçbir kimlik yoksa `null` (uydurma yok). */
export function resolveEmblem(p: Pick<VehicleProfile, 'brandId' | 'customEmblem' | 'model'> | null): ResolvedEmblem | null {
  if (!p) return null;
  const brand = getBrand(p.brandId);
  const hex = brand?.hex ?? NEUTRAL;
  const name = brand?.name ?? p.model ?? '';
  if (p.customEmblem?.startsWith('data:image/')) return { kind: 'image', src: p.customEmblem, hex, name };
  const path = brandLogoPath(brand);
  if (path) return { kind: 'logo', path, hex, name };
  const letter = monogramOf(brand?.name ?? p.model);
  return letter ? { kind: 'mono', letter, hex, name } : null;
}

/** Koyu marka tonları (#000 vb.) siyah zeminde kaybolur → açık nötr. */
export function readableOnDark(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return NEUTRAL;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 90 ? '#E6E8EC' : hex;
}

export const VehicleEmblem = memo(function VehicleEmblem({
  emblem, treatment = 'neon', variant = 'badge', size,
}: {
  emblem: ResolvedEmblem;
  treatment?: 'neon' | 'original';
  variant?: 'scene' | 'badge' | 'static';
  size?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const neon = treatment === 'neon';
  const orig = readableOnDark(emblem.hex);
  const edge = neon ? `url(#ve-edge-${uid})` : orig;
  const face = neon ? `url(#ve-face-${uid})` : orig;

  const shape = emblem.kind === 'logo'
    ? <path d={emblem.path} />
    : emblem.kind === 'mono'
      ? <text x="12" y="12" textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="700"
          fontFamily="system-ui, sans-serif">{emblem.letter}</text>
      : null;

  return (
    <span className={variant === 'scene' ? 've-scene' : variant === 'badge' ? 've-badge' : undefined}
      style={{ display: 'inline-block', width: size ?? '100%', height: size ?? '100%' }}
      role="img" aria-label={emblem.name ? `${emblem.name} amblemi` : 'Araç amblemi'}>
      <svg viewBox="-2 -2 28 28" className={`ve-svg ${neon ? 've-glow-neon' : 've-glow-orig'}`} aria-hidden="true">
        <defs>
          <linearGradient id={`ve-edge-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#58a0ff" /><stop offset=".5" stopColor="#b58cff" /><stop offset="1" stopColor="#ff8a33" />
          </linearGradient>
          <linearGradient id={`ve-face-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2f7bff" stopOpacity=".22" /><stop offset="1" stopColor="#ff7a1a" stopOpacity=".22" />
          </linearGradient>
          <linearGradient id={`ve-sweep-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".7" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {shape && <clipPath id={`ve-clip-${uid}`}>{shape}</clipPath>}
        </defs>

        {emblem.kind === 'image' ? (
          <image href={emblem.src} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"
            className="ve-face" style={neon ? { filter: 'grayscale(1) brightness(1.35) contrast(1.1)' } : undefined} />
        ) : (
          <>
            <g className="ve-face" fill={face}>{shape}</g>
            <g className={emblem.kind === 'logo' ? 've-edge' : 've-face'} fill="none" stroke={edge} strokeWidth={neon ? 0.32 : 0.2} strokeLinejoin="round">
              {emblem.kind === 'logo' ? <path d={emblem.path} pathLength={1} /> : shape}
            </g>
          </>
        )}
        {shape && (
          <g clipPath={`url(#ve-clip-${uid})`}>
            <rect className="ve-sweep" x="-6" y="-4" width="6" height="32" fill={`url(#ve-sweep-${uid})`} transform="skewX(-18)" />
          </g>
        )}
      </svg>
    </span>
  );
});

/** Ana ekran araç kartı rozeti — kimlik yoksa hiçbir şey çizmez. Düşük
 *  performans kademesinde ışık kayması kapalı (statik). */
export const ActiveVehicleBadge = memo(function ActiveVehicleBadge({ size = 40 }: { size?: number }) {
  const profile = useStore((s) => s.settings.vehicleProfiles.find((p) => p.id === s.settings.activeVehicleProfileId) ?? null);
  const emblem = useMemo(() => resolveEmblem(profile), [profile]);
  if (!emblem) return null;
  return (
    <span className="grid place-items-center flex-shrink-0 rounded-full"
      style={{ width: size, height: size, background: '#05070b', border: '1px solid rgba(255,255,255,.08)' }}>
      <VehicleEmblem emblem={emblem} treatment={profile?.emblemTreatment ?? 'neon'}
        variant={getPerformanceMode() === 'lite' ? 'static' : 'badge'} size={Math.round(size * 0.66)} />
    </span>
  );
});
