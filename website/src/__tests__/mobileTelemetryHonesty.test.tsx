/**
 * mobileTelemetryHonesty.test.tsx — KUMANDA TELEMETRİ ŞERİDİ DÜRÜSTLÜK KİLİTLERİ.
 *
 * ÖLÇÜLEN KUSUR (2026-08-14, gerçek telefon ekran görüntüsü): araç OFFLINE,
 * kartta "Araç bağlantısı kesildi" yazıyor ve hemen altında **HIZ 22 km/h
 * yeşil · YAKIT 0 · MOTOR 0** görünüyordu. 22 bayat bir ölçümdü, iki sıfır ise
 * hiç ölçülmemiş alanların varsayılanıydı (sahte 0).
 *
 * `vehicleStore` gerçeği zaten `telemetry` katmanında taşıyordu; tüketici onu
 * hiç okumuyordu. Bu dosya okumanın geri alınmasını engeller.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/hooks/useCommandTracker', () => ({
  useCommandTracker: () => ({ phases: {}, result: null, dispatch: vi.fn(), retry: vi.fn() }),
}));

import MobileCarControl from '@/components/dashboard/MobileCarControl';
import { buildVehicleFreshness, markVehicleOffline, applyFreshnessUpdate }
  from '@/lib/fleet/vehicleTelemetryFreshness';
import type { LiveVehicle } from '@/types/realtime';

const NOW = 1_760_000_000_000;

function baseVehicle(over: Partial<LiveVehicle> = {}): LiveVehicle {
  return {
    id: 'v1', plate: '34 ABC 123', name: 'Test', driver: '—',
    status: 'offline',
    lat: 0, lng: 0, speed: 0, fuel: 0, engineTemp: 0, rpm: 0, odometer: 0,
    location: '—', lastSeen: '—', lastTimestamp: 0,
    telemetry: buildVehicleFreshness({ now: NOW, row: null, readable: true }),
    ...over,
  } as LiveVehicle;
}

function render(v: LiveVehicle): string {
  return renderToStaticMarkup(<MobileCarControl vehicle={v} />);
}

/**
 * YALNIZ telemetri şeridini ayıklar. Tüm kartta arama yapmak yanıltıcıdır:
 * "Aç" düğmesi de yeşil (#34d399) kullanır ve renk kilidi ona takılırdı.
 */
function strip(html: string): string {
  const i = html.lastIndexOf('grid grid-cols-3 gap-2');
  expect(i).toBeGreaterThan(-1);
  return html.slice(i);
}

describe('telemetri şeridi — sahte 0 yasağı', () => {
  it('KİLİT: hiç ölçülmemiş sinyal "0" diye BASILMAZ', () => {
    const html = strip(render(baseVehicle()));
    // Üç kutu da ölçümsüz → em-dash + "veri yok".
    expect(html).toContain('—');
    expect(html.toLowerCase()).toContain('veri yok');
    // Ham 0 varsayılanı ekrana sızmamalı: ">0<" biçiminde bir değer hücresi olmamalı.
    expect(html).not.toMatch(/tabular-nums[^>]*>\s*0\s*</);
  });

  it('KİLİT: araç çevrimdışıyken son ölçüm CANLI gibi gösterilmez', () => {
    const base = buildVehicleFreshness({ now: NOW, row: null, readable: true });
    // Gerçek bir ölçüm geldi (22 km/h), sonra araç çevrimdışına düştü.
    const updated = applyFreshnessUpdate(base, {
      lat: 41, lng: 29, speed: 22, fuel: Number.NaN,
      engineTemp: Number.NaN, rpm: Number.NaN, timestamp: NOW,
    });
    expect(updated).toBeDefined();
    const f = markVehicleOffline(updated as NonNullable<typeof updated>);

    const html = strip(render(baseVehicle({ speed: 22, telemetry: f, status: 'offline' })));

    // Değer KORUNUR (bilgi atılmaz) ama etiketlenir.
    expect(html).toContain('22');
    expect(html.toLowerCase()).toMatch(/çevrimdışı|eski veri/);
  });

  it('KİLİT: ölçümsüz sinyale "iyi durum" rengi (yeşil/mavi) VERİLMEZ', () => {
    const html = strip(render(baseVehicle()));
    // Nötr token kullanılmalı; sağlık renkleri hak edilmeden basılmaz.
    expect(html).toContain('var(--pwa-text-3)');
    expect(html).not.toContain('#34d399'); // yakıt/hız/motor "iyi" yeşili
    expect(html).not.toContain('#60a5fa'); // yakıt "iyi" mavisi
  });

  it('canlı ölçüm normal gösterilir (kilit meşru veriyi BOĞMAZ)', () => {
    const f = applyFreshnessUpdate(
      buildVehicleFreshness({ now: NOW, row: null, readable: true }),
      { lat: 41, lng: 29, speed: 55, fuel: 70, engineTemp: 90, rpm: 2000, timestamp: Date.now() },
    );
    const html = strip(render(baseVehicle({ speed: 55, fuel: 70, engineTemp: 90, telemetry: f, status: 'online' })));

    expect(html).toContain('55');
    expect(html).toContain('70');
    expect(html).toContain('90');
    // Canlıysa "eski veri"/"çevrimdışı" notu ÇIKMAZ.
    expect(html.toLowerCase()).not.toContain('eski veri');
  });

  it('KİLİT: tazelik katmanı yoksa ham sayı CANLI diye sunulmaz', () => {
    // Eski kayıt: `telemetry` hiç yok. Sayı gösterilir ama hüküm verilmez.
    const v = baseVehicle({ speed: 88, telemetry: undefined });
    const html = strip(render(v));
    expect(html).toContain('88');
    expect(html.toLowerCase()).toContain('doğrulanmadı');
  });
});
