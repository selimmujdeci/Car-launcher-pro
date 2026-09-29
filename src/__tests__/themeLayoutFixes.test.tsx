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

  it('Pro durum kümesi kart dışında, orta sütunun üstünde (R11: müzik kartı başlığından taşıyordu)', () => {
    const src = theme('ProLayout.tsx');
    // Tek yer: kart düzeninden bağımsız durum çubuğu (müzik kartı gizlense de erişilir).
    expect(src).toMatch(/zone === 'center-stage' && \([\s\S]{0,200}data-testid="pro-status-bar"[\s\S]{0,200}<StatusCluster \/>/);
    expect(src.split('<StatusCluster />').length - 1).toBe(1);
    // Müzik kartı başlığında artık yalnız etiket var.
    const music = src.slice(src.indexOf('data-editable="pro.music"'), src.indexOf('data-editable="pro.music"') + 400);
    expect(music).not.toContain('StatusCluster');
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

describe('uygulama kabuğu metin seçimi', () => {
  const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
  it('kabukta seçim kapalı, giriş alanlarında açık', () => {
    expect(css).toMatch(/html, body \{[^}]*user-select: none;/);
    expect(css).toMatch(/input, textarea, \[contenteditable="true"\] \{[^}]*user-select: text;/);
  });
});

describe('Ayarlar', () => {
  const src = readFileSync(join(__dirname, '../components/settings/SettingsPage.tsx'), 'utf8');
  it('YÜK/RAM/NET telemetrisi geliştirici kapısının arkasında', () => {
    expect(src).toContain('const devTelemetry      = useCarosLabAllowed();');
    expect(src).toMatch(/!isCompactScreen && devTelemetry && \(/);
  });
  it('Horizon/Tesla/Pro kartlarında tel-çerçeve önizleme var', () => {
    for (const id of ['horizon', 'tesla', 'pro']) {
      expect(src).toMatch(new RegExp(`\\{ id: '${id}',[^\\n]*wire: \\{ cols:`));
    }
  });
});

describe('müzik boş durumu', () => {
  const src = readFileSync(join(__dirname, '../components/media/MediaScreen.tsx'), 'utf8');
  it('pasif oynat düğmesiyle çelişen "Oynat\'a dokun" yok; gerçek kısayollar var', () => {
    expect(src).toContain("playAvailable ? 'Oynat\\'a dokun' : 'Cihaz ya da kaynak seçin'");
    expect(src).toContain('disabled={!playAvailable}');
    expect(src).toMatch(/data-testid="media-empty-actions"[\s\S]{0,400}onClick=\{onTabLibrary\}/);
  });
});

/* 1024×600 (K24 paneli) + sürüş modu (düğmeler 56px) — Playwright ile ölçülen
   çakışma/kesilmelerin kaynak kilitleri (inceleme 2026-09-29). */
describe('1024×600 ve sürüş modu düzeni', () => {
  it('başlık saati akışta: yan alanlar eşit paylaşır, küme sığmazsa saat kayar (mutlak değil)', () => {
    const tesla = theme('TeslaLayout.tsx');
    expect(tesla).toContain("const HEADER_SIDE: React.CSSProperties = { flex: '1 1 0', minWidth: 'max-content'");
    for (const f of ['TeslaLayout.tsx', 'ExpeditionLayout.tsx', 'HorizonLayout.tsx']) {
      const src = theme(f);
      expect(src, `${f} saati hâlâ mutlak ortalıyor`).not.toMatch(/left: '50%', top: '50%', transform: 'translate\(-50%,-50%\)', textAlign: 'center', pointerEvents: 'none'/);
      expect(src).toContain("flex: 'none', margin: '0 12px', textAlign: 'center', pointerEvents: 'none'");
    }
  });

  it('Tesla ray sarmalayıcısı: doğal kart küçülmez, dolduran kart kalanı alır', () => {
    const src = theme('TeslaLayout.tsx');
    expect(src).toContain("new Set(['speed', 'vehicle'])");
    expect(src).toContain(": { flexShrink: 0, display: 'flex', flexDirection: 'column' };");
    expect(src).toMatch(/data-testid="tesla-music-body"[^>]*flex-wrap/);
  });

  it('Expedition ölçüleri eşit çeyrek; gerçek veri plakadan taşmaz', () => {
    const src = theme('ExpeditionLayout.tsx');
    expect(src).toMatch(/function Metric[\s\S]{0,200}flex: 1, minWidth: 0, overflow: 'hidden'/);
    expect(src).not.toContain('MoreVertical');
  });

  it('Pro: süreler kırılmaz, durum yazısı başlıktan önceliklidir', () => {
    const src = theme('ProLayout.tsx');
    expect(src.match(/fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 \}\}>\{total > 0/g)).toHaveLength(2);
    expect(src).toMatch(/data-testid="pro-vehicle-status" style=\{\{[^}]*whiteSpace: 'nowrap', flexShrink: 0/);
  });

  it('compact yol sayacı: etiket değerin üstünde, gerekirse iki satır (kesilmez)', () => {
    const host = render(<TripMeterRow palette={palette} compact />);
    const label = [...host.querySelectorAll('span')].find((s) => s.textContent === 'Yol Sayacı')!;
    expect(label.style.whiteSpace).toBe('normal');
    expect(label.parentElement!.style.flexDirection || label.parentElement!.className).toMatch(/col/);
  });
});
