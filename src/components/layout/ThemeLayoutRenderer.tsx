/**
 * ThemeLayoutRenderer
 *
 * Her tema ayrı bir launcher deneyimidir.
 * Tema → layout eşlemesi:
 *
 *   tesla, tesla-x-night        → MapFocusLayout   (harita tam ekran, hız overlay)
 *   mercedes                    → LuxuryLayout     (MBUX panoramik gösterge paneli)
 *   bmw, audi                   → CockpitLayout    (gösterge baskın sol, harita+medya sağ)
 *   porsche, redline             → RacingLayout    (devasa merkez hızometre, dikey RPM bar)
 *   galaxy, midnight, night-city,
 *     ambient                   → ImmersiveLayout  (atmosferik tam ekran, yüzen paneller)
 *   cyberpunk, electric, carbon → SportLayout     (merkez megagauge, minimal kenarlar)
 *   diğerleri                   → BalancedLayout   (3 sütun: nav | hız | medya)
 */
import { memo, lazy, Suspense } from 'react';
import type { LayoutProps } from './layouts/LayoutProps';
import type { ThemePack } from '../../store/useStore';

const MapFocusLayout = lazy(() =>
  import('./layouts/MapFocusLayout').then((m) => ({ default: m.MapFocusLayout }))
);
const CockpitLayout = lazy(() =>
  import('./layouts/CockpitLayout').then((m) => ({ default: m.CockpitLayout }))
);
const BalancedLayout = lazy(() =>
  import('./layouts/BalancedLayout').then((m) => ({ default: m.BalancedLayout }))
);
const SportLayout = lazy(() =>
  import('./layouts/SportLayout').then((m) => ({ default: m.SportLayout }))
);
const LuxuryLayout = lazy(() =>
  import('./layouts/LuxuryLayout').then((m) => ({ default: m.LuxuryLayout }))
);
const RacingLayout = lazy(() =>
  import('./layouts/RacingLayout').then((m) => ({ default: m.RacingLayout }))
);
const ImmersiveLayout = lazy(() =>
  import('./layouts/ImmersiveLayout').then((m) => ({ default: m.ImmersiveLayout }))
);

const MAP_FOCUS_PACKS: ThemePack[]  = ['tesla', 'tesla-x-night'];
const LUXURY_PACKS: ThemePack[]     = ['mercedes'];
const COCKPIT_PACKS: ThemePack[]    = ['bmw', 'audi'];
const RACING_PACKS: ThemePack[]     = ['porsche', 'redline'];
const IMMERSIVE_PACKS: ThemePack[]  = ['galaxy', 'midnight', 'night-city', 'ambient'];
const SPORT_PACKS: ThemePack[]      = ['cyberpunk', 'electric', 'carbon'];

type LayoutType = 'map-focus' | 'luxury' | 'cockpit' | 'racing' | 'immersive' | 'sport' | 'balanced';

function resolveLayout(pack: ThemePack): LayoutType {
  if (MAP_FOCUS_PACKS.includes(pack))  return 'map-focus';
  if (LUXURY_PACKS.includes(pack))     return 'luxury';
  if (COCKPIT_PACKS.includes(pack))    return 'cockpit';
  if (RACING_PACKS.includes(pack))     return 'racing';
  if (IMMERSIVE_PACKS.includes(pack))  return 'immersive';
  if (SPORT_PACKS.includes(pack))      return 'sport';
  return 'balanced';
}

const LayoutFallback = <div className="w-full h-full bg-transparent" />;

export const ThemeLayoutRenderer = memo(function ThemeLayoutRenderer(props: LayoutProps) {
  const layout = resolveLayout(props.settings.themePack);

  const inner = (() => {
    switch (layout) {
      case 'map-focus':  return <MapFocusLayout  {...props} />;
      case 'luxury':     return <LuxuryLayout    {...props} />;
      case 'cockpit':    return <CockpitLayout   {...props} />;
      case 'racing':     return <RacingLayout    {...props} />;
      case 'immersive':  return <ImmersiveLayout {...props} />;
      case 'sport':      return <SportLayout     {...props} />;
      default:           return <BalancedLayout  {...props} />;
    }
  })();

  return (
    <Suspense fallback={LayoutFallback}>
      <div
        key={layout}
        className="w-full h-full"
        style={{ animation: 'layout-fadein 0.35s cubic-bezier(0.22,1,0.36,1)' }}
      >
        {inner}
      </div>
    </Suspense>
  );
});
