/**
 * sportPanelLiveGate.test.tsx — Spor paneli G-metre canlılık kapısı.
 *
 * Regresyon (ekran taraması 2026-10-03): OBD bağlı değilken G-metre ve oturum
 * rekoru "0.00g" gösteriyordu (bilinmeyen → sahte 0). G, kanonik canlılık
 * kapısı (`isObdReadingLive`) olmadan hız farkından hesaplanıyordu → bayat
 * snapshot hızı (source 'real', dataFresh false) ilk canlı örnekle birleşip
 * sahte bir "En Sert Fren" rekoru doğurabiliyordu.
 *
 * Gerçek bileşen gerçek DOM'a basılır; yalnız veri kaynakları (OBD/GPS) ve
 * ilgisiz RunLab kartı taklit edilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const src = vi.hoisted(() => ({ obd: {} as Record<string, unknown> }));

vi.mock('../platform/obdService', () => ({ useOBDState: () => src.obd }));
vi.mock('../platform/gpsService', () => ({ useGPSLocation: () => null }));
vi.mock('../components/sport/RunLabCard', () => ({ RunLabCard: () => null }));

const NONE = { source: 'none', dataFresh: false, lastSeenMs: 0, speed: 0, rpm: 0 };
const stale = (speed: number) => ({ source: 'real', dataFresh: false, lastSeenMs: 1, speed, rpm: 0 });
const live = (speed: number) => ({ source: 'real', dataFresh: true, lastSeenMs: Date.now(), speed, rpm: 800 });

let container: HTMLDivElement;
let root: Root;
let mountKey = 0;

async function mountPanel(): Promise<string> {
  const { SportModePanel } = await import('../components/sport/SportModePanel');
  mountKey++;
  await act(async () => { root.render(<SportModePanel key={mountKey} />); });
  return container.textContent ?? '';
}

beforeEach(() => {
  vi.resetModules();               // performanceService modül durumu her testte sıfır
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T08:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('Spor paneli — G-metre canlılık kapısı', () => {
  it('OBD canlı değilken G ve oturum rekoru sayı değil "—"', async () => {
    src.obd = NONE;
    const text = await mountPanel();
    expect(text, 'canlı veri yokken G-metre sahte 0.00g gösteriyor').not.toMatch(/\d\.\d\dg/);
    expect((text.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('bayat snapshot hızı ilk canlı örnekle sahte fren rekoru üretmez', async () => {
    src.obd = stale(80);               // 12 saatlik geri yükleme: araç dün 80 km/h'teydi
    await mountPanel();
    vi.setSystemTime(Date.now() + 600);
    src.obd = live(0);                 // canlı veri geldi: araç park hâlinde
    await mountPanel();
    vi.setSystemTime(Date.now() + 600);
    src.obd = live(0);
    const text = await mountPanel();
    expect(text, 'snapshot→canlı sıçraması sahte "En Sert Fren" rekoru üretti').not.toMatch(/[1-9]\.\d\dg|0\.[1-9]\dg|0\.0[1-9]g/);
  });
});
