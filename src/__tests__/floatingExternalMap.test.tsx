/**
 * FloatingExternalMap — rota harici uygulamadayken sağlayıcının haritasını
 * gösteren sürüklenebilir pencere (sahibin kararı 2026-09-30).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FloatingExternalMap } from '../components/map/FloatingExternalMap';
import { clearExternalRoute, getExternalRoute, setExternalRoute } from '../platform/navigation/externalRouteState';

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
});
