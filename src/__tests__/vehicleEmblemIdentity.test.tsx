/**
 * vehicleEmblemIdentity — logo paketi, OBD'siz araç kimliği, VIN WMI
 * karşılaştırması, kendi amblem görseli ve amblemli açılış.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { useStore } from '../store/useStore';
import {
  CAR_BRANDS, BRAND_LOGOS_ENABLED, brandFromWmi, brandLogoPath, getBrand, monogramOf, searchBrands,
} from '../platform/vehicle/brandCatalog';
import { checkBrandAgainstVin, saveVehicleIdentity } from '../platform/vehicle/vehicleBrandIdentity';
import { removeFlatBackground } from '../platform/vehicle/emblemImage';
import { resolveEmblem, readableOnDark } from '../components/vehicle/VehicleEmblem';
import { BootSplash, BOOT_SHOW_MS, EMBLEM_BOOT_SHOW_MS } from '../components/layout/BootSplash';
import { buildEmblemBoot, freshTemperature, BOOT_WEATHER_MAX_AGE_MS } from '../components/layout/emblemBoot';
import type { WeatherState } from '../platform/weatherService';

const VIN_RENAULT = 'VF1RJA00012345678';
const VIN_FORD_TR = 'NM0KXXTTGKLA12345';

function resetVehicles() {
  useStore.getState().updateSettings({
    vehicleProfiles: [], activeVehicleProfileId: null, bootSplashStyle: 'caros',
    driverProfiles: [], activeDriverProfileId: null,
  });
}

describe('logo paketi + marka eşleme', () => {
  it('Türkiye\'de yaygın ≥40 marka, kimlik ve WMI tekil', () => {
    expect(CAR_BRANDS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CAR_BRANDS.map((b) => b.id)).size).toBe(CAR_BRANDS.length);
    const wmi = CAR_BRANDS.flatMap((b) => b.wmi);
    expect(new Set(wmi).size).toBe(wmi.length);
    for (const id of ['renault', 'fiat', 'toyota', 'volkswagen', 'ford', 'hyundai', 'togg', 'mercedes', 'byd', 'chery']) {
      expect(getBrand(id), id).not.toBeNull();
    }
  });

  it('WMI → marka; tabloda olmayan WMI uydurulmaz', () => {
    expect(brandFromWmi(VIN_RENAULT)?.id).toBe('renault');
    expect(brandFromWmi(VIN_FORD_TR)?.id).toBe('ford');
    expect(brandFromWmi('ZZZ00000000000000')).toBeNull();
    expect(brandFromWmi(null)).toBeNull();
  });

  it('logosu olmayan marka monogram; paket tek bayrakla kapanır', () => {
    expect(BRAND_LOGOS_ENABLED).toBe(true);
    expect(brandLogoPath(getBrand('mercedes'))).toBeNull();
    expect(monogramOf('Togg')).toBe('T');
    expect(monogramOf('ıssız')).toBe('I');
    expect(brandLogoPath(getBrand('renault'))).toMatch(/^M/);
    expect(brandLogoPath(getBrand('renault'), false)).toBeNull();
  });
});

describe('marka arama (Türkçe + yazım hatası toleransı)', () => {
  it.each([
    ['fıat', 'fiat'], ['FİAT', 'fiat'], ['Fiat', 'fiat'], ['fiyat', 'fiat'],
    ['citroen', 'citroen'], ['sitroen', 'citroen'],
    ['mersedes', 'mercedes'], ['mercedes-benz', 'mercedes'],
    ['vw', 'volkswagen'], ['volkswagen', 'volkswagen'], ['folksvagen', 'volkswagen'],
    ['togg', 'togg'], ['şkoda', 'skoda'], ['reno', 'renault'],
  ])('"%s" → %s', (q, id) => {
    expect(searchBrands(q)[0]?.id).toBe(id);
  });

  it('eşleşme yoksa boş (UI monogram seçeneği sunar); boş sorgu tüm liste', () => {
    expect(searchBrands('xyzq')).toEqual([]);
    expect(searchBrands('  ')).toHaveLength(CAR_BRANDS.length);
  });
});

describe('VIN ↔ seçim karşılaştırması (kaynak ayrımı)', () => {
  it('VIN yoksa/WMI bilinmiyorsa çelişki ilan edilmez', () => {
    expect(checkBrandAgainstVin(null, { brandId: 'fiat' }).kind).toBe('no_vin');
    expect(checkBrandAgainstVin('ZZZ00000000000000', { brandId: 'fiat' }).kind).toBe('unknown_wmi');
  });

  it('seçim yoksa VIN yalnız ÖNERİ; eşleşme doğrulama; farklıysa çelişki (sessiz ezme yok)', () => {
    expect(checkBrandAgainstVin(VIN_RENAULT, { brandId: undefined }).kind).toBe('suggest');
    expect(checkBrandAgainstVin(VIN_RENAULT, { brandId: 'renault' }).kind).toBe('match');
    const c = checkBrandAgainstVin(VIN_RENAULT, { brandId: 'fiat' });
    expect(c.kind).toBe('conflict');
    if (c.kind === 'conflict') { expect(c.vinBrand.id).toBe('renault'); expect(c.selected?.id).toBe('fiat'); }
  });

  it('"seçimim doğru" yalnız o VIN için susturur', () => {
    expect(checkBrandAgainstVin(VIN_RENAULT, { brandId: 'fiat', vinBrandConflictDismissedFor: VIN_RENAULT }).kind).toBe('no_vin');
    expect(checkBrandAgainstVin('VF1RJA00099999999', { brandId: 'fiat', vinBrandConflictDismissedFor: VIN_RENAULT }).kind).toBe('conflict');
  });
});

describe('araç kimliği yazımı (tek sahip: aktif VehicleProfile)', () => {
  beforeEach(resetVehicles);

  it('profil yoksa oluşturur ve aktif yapar; kaynak korunur', () => {
    saveVehicleIdentity({ brandId: 'renault', model: ' Clio ', modelYear: 2021, source: 'user_selected' });
    const s = useStore.getState().settings;
    expect(s.vehicleProfiles).toHaveLength(1);
    const p = s.vehicleProfiles[0]!;
    expect(s.activeVehicleProfileId).toBe(p.id);
    expect(p).toMatchObject({ brandId: 'renault', model: 'Clio', modelYear: 2021, identitySource: 'user_selected', name: 'Renault Clio' });
  });

  it('mevcut aktif profili günceller (yeni profil açmaz); geçersiz yıl yazılmaz', () => {
    useStore.getState().addVehicleProfile({ id: 'vp-1', name: 'Araç 1', createdAt: '2026-01-01', lastUsedAt: null, vin: VIN_RENAULT });
    useStore.getState().setActiveVehicleProfile('vp-1');
    saveVehicleIdentity({ brandId: 'renault', model: 'Megane', modelYear: 1800, source: 'vin_proven' });
    const p = useStore.getState().settings.vehicleProfiles;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: 'vp-1', name: 'Araç 1', vin: VIN_RENAULT, brandId: 'renault', identitySource: 'vin_proven' });
    expect(p[0]!.modelYear).toBeUndefined();
  });

  it('🔒 mevcut kullanıcı: açılış varsayılanı CarOS Pro (ayar yoksa)', () => {
    const merge = useStore.persist.getOptions().merge!;
    const out = merge({ settings: { setupCompleted: true } }, useStore.getState()) as ReturnType<typeof useStore.getState>;
    expect(out.settings.bootSplashStyle).toBe('caros');
  });
});

describe('kendi amblem görseli', () => {
  const img = (w: number, h: number, bg: number[], fg: number[]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inside = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
      d.set([...(inside ? fg : bg), 255], (y * w + x) * 4);
    }
    return d;
  };

  it('düz arka plan saydam olur, amblem korunur', () => {
    const d = img(8, 8, [255, 255, 255], [10, 10, 10]);
    expect(removeFlatBackground(d, 8, 8)).toBe(true);
    expect(d[3]).toBe(0);                          // köşe
    expect(d[(4 * 8 + 4) * 4 + 3]).toBe(255);      // merkez
  });

  it('köşeler farklıysa (fotoğraf) dokunmaz', () => {
    const d = img(8, 8, [255, 255, 255], [10, 10, 10]);
    d.set([200, 0, 0, 255], (7 * 8 + 7) * 4);
    expect(removeFlatBackground(d, 8, 8)).toBe(false);
    expect(d[3]).toBe(255);
  });
});

describe('amblem çözümü', () => {
  it('öncelik: kendi görselin → logo → monogram → yok', () => {
    expect(resolveEmblem({ brandId: 'renault', customEmblem: 'data:image/png;base64,AA' })?.kind).toBe('image');
    expect(resolveEmblem({ brandId: 'renault' })?.kind).toBe('logo');
    expect(resolveEmblem({ brandId: 'togg' })).toMatchObject({ kind: 'mono', letter: 'T' });
    expect(resolveEmblem({ model: 'Doblo' })).toMatchObject({ kind: 'mono', letter: 'D' });
    expect(resolveEmblem({})).toBeNull();
    expect(resolveEmblem(null)).toBeNull();
  });

  it('siyah marka tonu karanlık zeminde açık nötre döner', () => {
    expect(readableOnDark('#000000')).toBe('#E6E8EC');
    expect(readableOnDark('#FFCC33')).toBe('#FFCC33');
  });
});

describe('amblemli açılış', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetVehicles();
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    vi.useFakeTimers();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

  it('🔒 varsayılan açılış değişmedi: 6 kare, ~5,25 sn, dokunma katmanı yok', () => {
    expect(BOOT_SHOW_MS).toBe(5250);
    act(() => root.render(<BootSplash phase="show" />));
    expect(host.querySelectorAll('img')).toHaveLength(6);
    expect(host.querySelector('[data-testid="boot-emblem"]')).toBeNull();
    expect(host.firstElementChild!.className).toContain('pointer-events-none');
  });

  it('amblemli açılış daha kısa; son sahne selam + bilinen veri; dokununca atlar', () => {
    expect(EMBLEM_BOOT_SHOW_MS).toBeLessThan(BOOT_SHOW_MS);
    const onSkip = vi.fn();
    const emblem = resolveEmblem({ brandId: 'renault' })!;
    act(() => root.render(<BootSplash phase="show" onSkip={onSkip}
      emblem={{ emblem, treatment: 'neon', driverName: 'Selim', line: 'Renault Clio · 18°C', particles: false }} />));
    expect(host.textContent).not.toContain('Hoş geldin');
    for (let i = 0; i < 3; i++) act(() => { vi.advanceTimersByTime(450); });
    expect(host.textContent).toContain('Hoş geldin, Selim');
    expect(host.textContent).toContain('Renault Clio · 18°C');
    expect(host.querySelector('[aria-label="Renault amblemi"]')).not.toBeNull();
    act(() => { host.querySelector('[data-testid="boot-emblem"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('bilinmeyen alan gösterilmez (sahte ad/sıcaklık yok)', () => {
    const emblem = resolveEmblem({ brandId: 'togg' })!;
    act(() => root.render(<BootSplash phase="show" emblem={{ emblem, treatment: 'neon', particles: false }} />));
    for (let i = 0; i < 3; i++) act(() => { vi.advanceTimersByTime(450); });
    expect(host.querySelector('.ve-hello')!.textContent).toBe('Hoş geldin');
    expect(host.querySelector('.ve-meta')).toBeNull();
  });

  it('ayar kapalıysa veya kimlik yoksa amblemli açılış kurulmaz', () => {
    expect(buildEmblemBoot()).toBeNull();                        // caros
    useStore.getState().updateSettings({ bootSplashStyle: 'emblem' });
    expect(buildEmblemBoot()).toBeNull();                        // araç yok
    saveVehicleIdentity({ brandId: 'renault', model: 'Clio', source: 'user_selected' });
    const b = buildEmblemBoot();
    expect(b?.emblem.kind).toBe('logo');
    expect(b?.line).toContain('Renault Clio');
  });

  it('bayat hava sıcaklığı açılışta gösterilmez', () => {
    const w = (ageMs: number) => ({ weather: { temperature: 18.4 }, lastUpdated: 1_000_000 - ageMs } as unknown as WeatherState);
    expect(freshTemperature(w(60_000), 1_000_000)).toBe(18);
    expect(freshTemperature(w(BOOT_WEATHER_MAX_AGE_MS + 1), 1_000_000)).toBeNull();
    expect(freshTemperature(null, 1_000_000)).toBeNull();
  });
});
