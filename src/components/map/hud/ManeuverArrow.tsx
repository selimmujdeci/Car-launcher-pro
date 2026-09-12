/**
 * ManeuverArrow — P0-NAV-04 · manevra ok grafiği (SAF ÇİZİM).
 *
 * `NavigationHUD` içindeki `FuturistArrow`ın **taşınmış** hâlidir; ikinci bir
 * kopya bırakılmadı. Yalnız `xl` boyu eklendi: OEM+ hedefi *"0,5 saniyelik
 * bakışta nereye döneceğim"* — bunun tek en güçlü aracı büyük, net oktur.
 *
 * Grafik SAFTIR: durum okumaz, karar vermez, yalnız verilen manevrayı çizer.
 */

export type ManeuverArrowSize = 'xl' | 'lg' | 'md' | 'sm' | 'xs';

const DIM: Readonly<Record<ManeuverArrowSize, number>> = {
  xl: 68, lg: 48, md: 34, sm: 22, xs: 16,
};
const STROKE: Readonly<Record<ManeuverArrowSize, number>> = {
  xl: 3.6, lg: 3.5, md: 3.0, sm: 2.5, xs: 2.5,
};

export function ManeuverArrow({ mod, type, size = 'lg' }: {
  mod: string; type: string; size?: ManeuverArrowSize;
}) {
  const dim = DIM[size];
  const sw  = STROKE[size];
  const swB = sw + 0.6;   // ok ucu biraz daha kalın — uzaktan ilk o okunur

  const base = {
    width: dim, height: dim,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (type === 'arrive') return (
    <svg {...base}>
      <circle cx="12" cy="12" r="7" strokeWidth={sw} />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" strokeWidth={0} />
    </svg>
  );

  if (type === 'depart') return (
    <svg {...base} fill="currentColor" stroke="none">
      <path d="M12 2.5L21 19.5H3L12 2.5Z" />
    </svg>
  );

  if (type === 'roundabout' || type === 'rotary') return (
    <svg {...base}>
      <path d="M12 5.5A6.5 6.5 0 1 1 5.5 12" strokeWidth={sw} />
      <path d="M5.5 8.5V5.5h3" strokeWidth={swB} />
    </svg>
  );

  if (mod === 'uturn') return (
    <svg {...base}>
      <path d="M7 20l-3-4 3-4" strokeWidth={swB} />
      <path d="M4 16h9a4.5 4.5 0 0 0 0-9h-1" strokeWidth={sw} />
    </svg>
  );

  if (mod.includes('right')) return (
    <svg {...base}>
      <path d="M5 20V13a6 6 0 0 1 6-6h8" strokeWidth={sw} />
      <path d="M14.5 3.5l5 4-5 4" strokeWidth={swB} />
    </svg>
  );

  if (mod.includes('left')) return (
    <svg {...base}>
      <path d="M19 20V13a6 6 0 0 0-6-6H5" strokeWidth={sw} />
      <path d="M9.5 3.5L4.5 7.5l5 4" strokeWidth={swB} />
    </svg>
  );

  return (
    <svg {...base}>
      <path d="M12 21V5" strokeWidth={sw} />
      <path d="M6 10.5L12 4.5 18 10.5" strokeWidth={swB} />
    </svg>
  );
}
