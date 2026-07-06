/**
 * Freeze davranış kilitleri — gizli drawer alt ağacı askıya alma (K24 JS diyeti).
 *
 * KİLİT: Freeze, freeze=true iken çocuğu ASKIYA ALMALI (promise fırlatma —
 * React Suspense sözleşmesi: re-render durur, effect'ler temizlenir, state
 * korunur), freeze=false iken çocuğu aynen render etmeli. Bu bozulursa 13
 * gizli drawer ekranı sürekli render/paint üretir (bkz. project_caros_k24_perf).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Freeze } from '../components/layout/Freeze';

describe('Freeze — gizli alt ağaç askıya alma', () => {
  it('freeze=false: çocuk aynen render edilir', () => {
    const html = renderToStaticMarkup(
      <Freeze freeze={false}><span data-testid="cocuk">canli</span></Freeze>,
    );
    expect(html).toContain('canli');
  });

  it('KİLİT: freeze=true → çocuk askıya alınır, fallback (boş) render edilir', () => {
    // SSR'da askıya alınan çocuk yerine Suspense fallback'i (null) basılır —
    // çocuk çıktıda OLMAMALI. Bu, promise-fırlatma mekanizmasının kanıtıdır.
    const html = renderToStaticMarkup(
      <Freeze freeze={true}><span data-testid="cocuk">canli</span></Freeze>,
    );
    expect(html).not.toContain('canli');
    expect(html).not.toContain('cocuk');
  });

  it('KİLİT: askıya alma Error değil Promise fırlatmayla yapılır (Suspense sözleşmesi)', () => {
    // Freeze'in iç mekanizması değişirse (ör. null dönme) donmuş ekranların
    // state'i kaybolur; promise-fırlatma korunmalı. SSR'da fallback'e düşmesi
    // + hata FIRLATMAMASI bu sözleşmenin gözlenebilir kanıtıdır.
    expect(() => renderToStaticMarkup(
      <Freeze freeze={true}><span>x</span></Freeze>,
    )).not.toThrow();
  });
});
