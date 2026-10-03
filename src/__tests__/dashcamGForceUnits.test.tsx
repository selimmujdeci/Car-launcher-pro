/**
 * dashcamGForceUnits.test.tsx — Araç kamerası G-sensörü birimi.
 *
 * Regresyon (ekran taraması 2026-10-03): dashcamService eşiği ve ölçümü m/s²
 * (yerçekimi DAHİL toplam ivme); görünüm bunları "G" diye basıyordu →
 * bilgi satırı "G-Sensörü 15G üzerinde kilitler" (gerçek ≈1.5 g), canlı kutu
 * araç dururken "9.8G". Sensör örneği hiç gelmemişken de "0.0G" (bilinmeyen →
 * sahte 0). Eşik görünümde ikinci bir sabitle kopyalanıyordu (tek otorite: servis).
 *
 * Gerçek bileşen gerçek DOM'a basılır; yalnız servis durumu taklit edilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const cam = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../platform/dashcamService', () => ({
  SHAKE_THRESHOLD_MS2: 15,
  useDashcamState: () => cam.state,
  startDashcam: () => undefined,
  stopDashcam: () => undefined,
  lockCurrentRecording: () => undefined,
  downloadCurrentBuffer: () => undefined,
  downloadLockedRecording: () => undefined,
  getVideoStream: () => null,
}));

import { DashcamView } from '../components/dashcam/DashcamView';

const BASE = {
  active: false, locked: false, hasPermission: true, error: null,
  segments: 0, lockedCount: 0, currentDurationSec: 0, gForce: 0,
};

let container: HTMLDivElement;
let root: Root;

async function render(state: Partial<typeof BASE>): Promise<string> {
  cam.state = { ...BASE, ...state };
  await act(async () => { root.render(<DashcamView onClose={() => undefined} />); });
  return container.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Araç kamerası — G-sensörü birimi', () => {
  it('kilit eşiği servis eşiğinden g olarak yazılır (15 m/s² ≈ 1.5G, "15G" değil)', async () => {
    const text = await render({});
    expect(text).toMatch(/G-Sensörü 1\.5G üzerinde/);
    expect(text).not.toMatch(/15G/);
  });

  it('durağan araçta canlı G ≈ 1.0G (yerçekimi), m/s² değeri "9.8G" değil', async () => {
    const text = await render({ active: true, gForce: 9.8 });
    expect(text).toMatch(/1\.0G/);
    expect(text).not.toMatch(/9\.8G/);
  });

  it('sensör örneği gelmemişken canlı G "—" (sahte 0.0G değil)', async () => {
    const text = await render({ active: true, gForce: 0 });
    expect(text).not.toMatch(/0\.0G/);
  });
});
