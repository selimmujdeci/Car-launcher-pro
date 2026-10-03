/**
 * weatherFuelEmptyState.test.tsx — Hava & Yakıt: boş istasyon listesinin anlamı.
 *
 * Regresyon (ekran taraması 2026-10-03): konum yokken servis aramayı HİÇ
 * yapmıyor (`locationSource: 'none'`), API+önbellek başarısızsa `fuelPending`
 * yazıyor; widget üç durumu da "Yakın istasyon bulunamadı" diye gösteriyordu
 * → yapılmamış bir aramanın sonucu iddia ediliyordu (§8: bilinmeyen ≠ yok).
 *
 * Gerçek bileşen gerçek DOM'a basılır; yalnız servis durumu taklit edilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const src = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../platform/weatherService', () => ({
  useWeatherState: () => src.state,
  refreshWeather: () => Promise.resolve(),
  refreshFuelPrices: () => Promise.resolve(),
}));

import { WeatherWidget } from '../components/weather/WeatherWidget';

const BASE = {
  weather: null, stations: [], isLoadingWeather: false, isLoadingFuel: false,
  fuelPending: false, lastUpdated: null, error: null, locationSource: 'gps',
};

let container: HTMLDivElement;
let root: Root;

async function render(state: Partial<typeof BASE>): Promise<string> {
  src.state = { ...BASE, ...state };
  await act(async () => { root.render(<WeatherWidget key={JSON.stringify(state)} />); });
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

describe('Hava & Yakıt — boş istasyon listesi', () => {
  it('konum yokken (arama yapılmadı) "bulunamadı" iddiası YOK, konum bekleniyor denir', async () => {
    const text = await render({ locationSource: 'none', error: 'Konum alınamadı — GPS bekleniyor' });
    expect(text).not.toMatch(/Yakın istasyon bulunamadı/);
    expect(text).toMatch(/Konum bekleniyor/);
  });

  it('API ve önbellek başarısızken (fuelPending) "bulunamadı" değil "bekleniyor"', async () => {
    const text = await render({ fuelPending: true });
    expect(text).not.toMatch(/Yakın istasyon bulunamadı/);
    expect(text).toMatch(/İstasyon verisi bekleniyor/);
  });

  it('konum var, arama yapıldı ve sonuç boş → "Yakın istasyon bulunamadı"', async () => {
    expect(await render({})).toMatch(/Yakın istasyon bulunamadı/);
  });
});
