import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src', 'platform', 'map', 'MapLayerManager.ts'),
  'utf8',
);

describe('route flow scheduling', () => {
  it('does not keep a display-rate rAF chain alive for an 80ms paint tick', () => {
    const start = SRC.indexOf('function _startLightTrail');
    const stop = SRC.indexOf('function _stopLightTrail');
    const body = SRC.slice(start, stop);

    expect(start).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(start);
    expect(body).toContain('const TICK_MS = 80');
    expect(body).toContain('window.setTimeout(frame, TICK_MS)');
    expect(body).not.toContain('requestAnimationFrame');
  });

  it('cancels the same timer primitive on stop and interaction pause', () => {
    expect(SRC).toMatch(/function _stopLightTrail[\s\S]*?clearTimeout\(M\.flowRafId\)/);
    expect(SRC).toMatch(/function pauseRouteFlowAnimation[\s\S]*?clearTimeout\(M\.flowRafId\)/);
  });

  it('keeps the decorative flow frozen while the vehicle is stationary', () => {
    const speedStart = SRC.indexOf('export function _updateFlowSpeed');
    const speedEnd = SRC.indexOf('/* ── Map Mood Controller', speedStart);
    const body = SRC.slice(speedStart, speedEnd);

    expect(body).toContain('speedKmh >= 1.5');
    expect(body.indexOf('_stopLightTrail()')).toBeLessThan(body.indexOf('Hysteresis:'));
    expect(body).toContain("if (map && map.getLayer(ROUTE_FLOW)) _startLightTrail()");
    expect(SRC).toContain('if (M.lastFlowSpeedKmh >= 1.5) _startLightTrail()');
  });
});
