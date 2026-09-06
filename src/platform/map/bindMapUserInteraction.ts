import type { Map as MapLibreMap } from 'maplibre-gl';

/** MapLibre kamera komutları da aynı olayları üretir; yalnız giriş kanıtını ilet. */
export function bindMapUserInteraction(
  map: Pick<MapLibreMap, 'on' | 'off'>,
  onStart: () => void,
  onEnd: () => void,
): () => void {
  const start = (event: { originalEvent?: unknown }) => { if (event.originalEvent) onStart(); };
  const end = (event: { originalEvent?: unknown }) => { if (event.originalEvent) onEnd(); };
  const starts = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const;
  const ends = ['dragend', 'zoomend', 'rotateend', 'pitchend'] as const;
  for (const event of starts) map.on(event, start);
  for (const event of ends) map.on(event, end);
  return () => {
    for (const event of starts) map.off(event, start);
    for (const event of ends) map.off(event, end);
  };
}
