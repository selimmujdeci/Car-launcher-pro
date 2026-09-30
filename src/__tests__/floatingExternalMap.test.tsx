/**
 * FloatingExternalMap — rota harici uygulamadayken sağlayıcının haritasını
 * gösteren sürüklenebilir pencere (sahibin kararı 2026-09-30).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FloatingExternalMap } from '../components/map/FloatingExternalMap';
import { clearExternalRoute, getExternalRoute, setExternalRoute } from '../platform/navigation/externalRouteState';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(<FloatingExternalMap />); });
  return host;
}

afterEach(() => {
  act(() => { clearExternalRoute(); root?.unmount(); });
  host?.remove();
  root = null; host = null;
});

describe('FloatingExternalMap', () => {
  it('harici rota yokken HİÇBİR ŞEY çizmez', () => {
    const el = mount();
    expect(el.querySelector('[data-testid="floating-external-map"]')).toBeNull();
  });

  it('rota Yandex\'teyken pencere Yandex haritasını gösterir; × pencereyi ve rotayı kapatır', () => {
    const el = mount();
    act(() => {
      setExternalRoute({ provider: 'yandex', packageName: 'ru.yandex.yandexnavi', destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: 1 });
    });
    const box = el.querySelector('[data-testid="floating-external-map"]');
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain('Yandex rotası');
    expect(box!.textContent).toContain('Mersin');
    const iframe = box!.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('yandex.com.tr/map-widget/v1/');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(box!.querySelector('[aria-label="Yandex uygulamasına dön"]')).not.toBeNull();

    const close = box!.querySelector('[aria-label="Kapat"]') as HTMLButtonElement;
    act(() => { close.click(); });
    expect(getExternalRoute()).toBeNull();
    expect(el.querySelector('[data-testid="floating-external-map"]')).toBeNull();
  });

  it('büyüt/küçült düğmesi pencere boyutunu değiştirir ve tercihi saklar', () => {
    const el = mount();
    act(() => {
      setExternalRoute({ provider: 'google_maps', packageName: 'com.google.android.apps.maps', destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: 2 });
    });
    const box = el.querySelector('[data-testid="floating-external-map"]') as HTMLDivElement;
    expect(box.dataset.size).toBe('normal');
    act(() => { (box.querySelector('[aria-label="Büyüt"]') as HTMLButtonElement).click(); });
    expect(box.dataset.size).toBe('large');
    expect(localStorage.getItem('caros-external-map-size')).toBe('large');
    act(() => { (box.querySelector('[aria-label="Küçült"]') as HTMLButtonElement).click(); });
    expect(box.dataset.size).toBe('normal');
    localStorage.removeItem('caros-external-map-size');
  });

  it('simge durumu: harita gizlenir, başlık kalır; "Haritayı aç" geri getirir', () => {
    const el = mount();
    act(() => {
      setExternalRoute({ provider: 'yandex', packageName: 'ru.yandex.yandexnavi', destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: 3 });
    });
    const box = el.querySelector('[data-testid="floating-external-map"]') as HTMLDivElement;
    act(() => { (box.querySelector('[aria-label="Simge durumuna küçült"]') as HTMLButtonElement).click(); });
    expect(box.dataset.size).toBe('collapsed');
    expect(box.querySelector('iframe')).toBeNull();
    expect(box.textContent).toContain('Mersin');
    expect(box.querySelector('[aria-label="Kapat"]')).not.toBeNull();
    expect(localStorage.getItem('caros-external-map-collapsed')).toBe('1');
    act(() => { (box.querySelector('[aria-label="Haritayı aç"]') as HTMLButtonElement).click(); });
    expect(box.dataset.size).toBe('normal');
    expect(box.querySelector('iframe')).not.toBeNull();
    localStorage.removeItem('caros-external-map-collapsed');
  });

  it('pencere bitiş izleyicisini kendisi başlatır: hedefe varınca kapanır', () => {
    const el = mount();
    act(() => {
      setExternalRoute({ provider: 'yandex', packageName: null, destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: Date.now() });
    });
    expect(el.querySelector('[data-testid="floating-external-map"]')).not.toBeNull();
    act(() => {
      useUnifiedVehicleStore.setState({ location: { latitude: 36.8005, longitude: 34.6 } } as never);
    });
    expect(getExternalRoute()).toBeNull();
    expect(el.querySelector('[data-testid="floating-external-map"]')).toBeNull();
  });

  it('başlangıç yalnız CANLI GPS: konum yokken hedef, canlı konum gelince BİR KEZ rota', () => {
    act(() => { useUnifiedVehicleStore.setState({ location: null, gpsSource: null } as never); });
    const el = mount();
    act(() => {
      setExternalRoute({ provider: 'yandex', packageName: null, destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: Date.now() });
    });
    const src = () => el.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(src()).toContain('pt=');
    // Varsayılan / son bilinen konum başlangıç SAYILMAZ.
    act(() => { useUnifiedVehicleStore.setState({ location: { latitude: 39, longitude: 35 }, gpsSource: 'default' } as never); });
    expect(src()).toContain('pt=');
    act(() => { useUnifiedVehicleStore.setState({ location: { latitude: 36.92, longitude: 34.91 }, gpsSource: 'native' } as never); });
    expect(src()).toContain('rtext=36.920000,34.910000~36.800000,34.600000');
    // Sonraki GPS güncellemesi iframe'i yeniden yüklemez.
    act(() => { useUnifiedVehicleStore.setState({ location: { latitude: 36.93, longitude: 34.91 }, gpsSource: 'native' } as never); });
    expect(src()).toContain('rtext=36.920000,34.910000~');
    act(() => { useUnifiedVehicleStore.setState({ location: null, gpsSource: null } as never); });
  });
});
