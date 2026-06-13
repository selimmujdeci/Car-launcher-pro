/**
 * GoldenHourAccent — Living Theme · sabah/akşam "golden hour" ince üst şeridi.
 *
 * Brief #5: zaman paleti (sabah/gündüz/akşam/gece). Gün/gece zaten useDayNightManager
 * ile var; bu, sabah (07–09) ve akşam (17–19) alt-vakitlerini görünür kılar.
 *
 * Neden arka plan tint'i DEĞİL: gündüz modu sunlight-readability önceliklidir
 * (--oem-ambient-* gündüzde transparent; WCAG AAA kontrast). Arka plana sıcak tint
 * okunabilirliği bozar. Bunun yerine sabah/akşam cue'su İÇERİĞE DOKUNMAYAN ekran
 * üstü 3px sıcak amber gradient ile verilir (golden hour) — yazı/kart etkilenmez.
 *
 * Mali-safe: STATİK gradient (animasyon YOK — brief yalnız ANİMASYONLU gradient'i
 * yasaklar), blur/box-shadow YOK, tek ince eleman. İzole memo + kendi tod aboneliği
 * → MainLayout (root) yeniden render edilmez.
 */
import { memo } from 'react';
import { useLivingThemeState } from '../../hooks/useLivingThemeState';

export const GoldenHourAccent = memo(function GoldenHourAccent() {
  const { tod } = useLivingThemeState();
  if (tod !== 'morning' && tod !== 'evening') return null;
  return (
    <div
      aria-hidden
      style={{
        position:      'fixed',
        top:           0,
        left:          0,
        right:         0,
        height:        3,
        zIndex:        9000,
        pointerEvents: 'none',
        background:    'linear-gradient(90deg, transparent 0%, var(--oem-accent) 50%, transparent 100%)',
        opacity:       0.75,
      }}
    />
  );
});
