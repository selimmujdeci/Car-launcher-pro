/**
 * ClimateScreen — aracın gerçek klima durumunu gösterir (2026-10-03).
 * Eskiden sabit 22/21 °C, fan 3 ve uydurma kabin sıcaklığı gösteriyordu; düğmeler
 * araca hiçbir şey göndermeden "değişmiş" görünüyordu (sahte onay).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Sunucu çizimi zustand'ın BAŞLANGIÇ durumunu okur → store basit bir sahteyle değiştirilir. */
const fake = vi.hoisted(() => ({ state: { canClimate: null as unknown, canAmbientTemp: null as number | null } }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => {
  const hook = (sel: (s: typeof fake.state) => unknown) => sel(fake.state);
  hook.getState = () => fake.state;
  return { useUnifiedVehicleStore: hook };
});

import { ClimateScreen } from '../components/climate/ClimateScreen';

beforeEach(() => { fake.state = { canClimate: null, canAmbientTemp: null }; });

describe('klima ekranı gerçek veri', () => {
  it('araç verisi → değerler aracın bildirdiği gibi', () => {
    fake.state = {
      canClimate: {
        power: true, ac: true, auto: false, dual: true, recirc: false, defrostFront: true, defrostRear: false,
        fanLevel: 4, fanMax: 7, tempDriverC: 20.5, tempPassengerC: 23,
      },
      canAmbientTemp: 12,
    };
    const html = renderToStaticMarkup(<ClimateScreen />);
    expect(html).toContain('20.5');
    expect(html).toContain('23.0');
    expect(html).toContain('FAN 4');
    expect(html).toContain('12°C');
    expect(html).toContain('açık');
  });

  it('veri yoksa açık uyarı; boş halka / tuş görünümlü rozet ÇİZİLMEZ (saha 2026-10-03: tuş sanıldı)', () => {
    const html = renderToStaticMarkup(<ClimateScreen />);
    expect(html).toContain('veri yok');
    expect(html).toContain('Araçtan klima bilgisi gelmiyor.');
    expect(html).toContain('aracın kendi düğmeleriyle');
    expect(html).not.toContain('A/C');
    expect(html).not.toContain('İç hava');
    expect(html).not.toContain('22.0');
    expect(html).not.toContain('21.0');
    expect(html).not.toContain('kabin');
  });

  it('🔒 ekranda sahte simülasyon ve araca gitmeyen kontrol kalmadı', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'climate', 'ClimateScreen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/setInterval|useState/);          // simülasyon / yerel sahte durum yok
    expect(src).not.toMatch(/Koltuk Isıtma|Direksiyon/);       // araçta olmayan donanım yok
    expect((src.match(/onClick=/g) ?? []).length).toBe(1);     // yalnız "kapat" düğmesi
  });
});
