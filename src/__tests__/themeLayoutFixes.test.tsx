/**
 * Tema düzen düzeltmeleri — regresyon kilitleri (720p / ChameleonScaler 1.2 ölçeği).
 * Görsel doğrulama dev sunucusunda Playwright ile yapıldı; burada davranışı
 * belirleyen kaynak kararları kilitlenir.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.defineProperty(navigator, 'userAgent', { value: 'Vitest', configurable: true }));

import { TripMeterRow } from '../components/trip/TripMeterRow';

const theme = (f: string) => readFileSync(join(__dirname, '../components/themes', f), 'utf8');
const palette = { ink: '#fff', ink2: '#ccc', ink3: '#999', accent: '#f80', tile: '#222', edge: '#333' };

function render(el: React.ReactElement): HTMLDivElement {
  const host = document.createElement('div');
  const root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.render(el));
  return host;
}

describe('TripMeterRow compact', () => {
  it('tek satır: simgeli Sıfırla (erişilebilir ad korunur), görünür ipucu metni yok', () => {
    const host = render(<TripMeterRow palette={palette} compact />);
    const btn = host.querySelector('button[aria-label="Sıfırla"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('');
    expect(host.textContent).not.toContain('Aracı durdurunca');
  });

  it('varsayılan (compact değil) davranış değişmedi', () => {
    const host = render(<TripMeterRow palette={palette} />);
    expect(host.querySelector('button[aria-label="Sıfırla"]')!.textContent).toContain('Sıfırla');
  });
});

describe('tema kaynak kilitleri', () => {
  it('Horizon pusula oyuğu panel-göreli (vw ölçekte kayıyordu)', () => {
    const src = theme('HorizonLayout.tsx');
    expect(src).toMatch(/const notchX = `calc\(50% \+/);
    expect(src).not.toMatch(/const notchX = `calc\(50vw/);
  });

  it('Expedition dock butonları 3 tam buton (38% yarım etiket kesiyordu)', () => {
    expect(theme('ExpeditionLayout.tsx')).toContain("flex: '0 0 33.333%'");
  });

  it('gün/ay adları Türkçe büyük harfe çevrilir (PAZARTESI/NIS değil)', () => {
    for (const f of ['ExpeditionLayout.tsx', 'HorizonLayout.tsx']) {
      expect(theme(f)).not.toMatch(/(DAYS_TR|MONTHS_TR)\[[^\]]+\]\.toUpperCase\(\)/);
    }
    expect('Pazartesi'.toLocaleUpperCase('tr-TR')).toBe('PAZARTESİ');
  });

  it('Pro araç kartında Ayarlar açan sahte KİLİT/ŞARJ düğmeleri yok', () => {
    const src = theme('ProLayout.tsx');
    expect(src).not.toMatch(/label: 'KİLİT'/);
    expect(src).not.toMatch(/label: 'ŞARJ'/);
  });

  it('Pro/Tesla harita kartında ikinci "genişlet" kutusu yok (mini haritanınki yeterli)', () => {
    for (const f of ['ProLayout.tsx', 'TeslaLayout.tsx']) expect(theme(f)).not.toMatch(/<Maximize2/);
  });

  it('Expedition hız rakamı halkayla aynı SVG içinde (halka küçülünce taşmaz)', () => {
    expect(theme('ExpeditionLayout.tsx')).toMatch(/<text x="116" y="124"[^>]*>\{formatDisplaySpeed\(rawSpeed\)\}<\/text>/);
  });
});

describe('güneş modu SVG kuralları', () => {
  const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
  it('alt-öğe stroke kuralları yalnız ikon setine iner (gösterge yayları gündüz kaybolmaz)', () => {
    expect(css).not.toMatch(/\.sunlight-mode svg:not\(\.caros-cockpit-screen\) \*\[fill\]/);
    expect(css).not.toMatch(/\.sunlight-mode svg:not\(\.caros-cockpit-screen\) \*\[stroke\]/);
    expect(css).toMatch(/\.sunlight-mode svg\.lucide \*\[fill\] \{\s*stroke-width: 0 !important;/);
  });
});
