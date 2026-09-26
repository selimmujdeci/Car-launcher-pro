/**
 * Hazır taslak galerisi — gerçek render + tıklama; reducer ile tek adımda geri alınır.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PresetGallery } from '../components/pwa/theme/PresetGallery';
import { colorPresetsFor, SHAPE_PRESETS } from '../lib/theme/themePresets';
import { createStudioState, studioReducer, canUndo } from '../lib/theme/themeStudioState';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mount(onTokens = vi.fn(), onScreen = vi.fn()) {
  const st = createStudioState();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(
    <PresetGallery themeId="horizon" manifest={st.manifests.horizon} surfaceId="trip" surfaceLabel="Yolculuk"
      onPatchTokens={onTokens} onPatchScreen={onScreen} />,
  ));
  const btn = (text: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  return { onTokens, onScreen, btn };
}

describe('PresetGallery', () => {
  it('renk taslağı tüm temaya uygulanır', () => {
    const { onTokens, btn } = mount();
    const p = colorPresetsFor('horizon')[1];
    act(() => btn(p.name).click());
    expect(onTokens).toHaveBeenCalledWith(p.tokens);
  });

  it('"Sadece: Yolculuk" seçilince yalnız o ekrana uygulanır', () => {
    const { onTokens, onScreen, btn } = mount();
    const p = colorPresetsFor('horizon')[2];
    act(() => btn('Sadece: Yolculuk').click());
    act(() => btn(p.name).click());
    expect(onTokens).not.toHaveBeenCalled();
    expect(onScreen).toHaveBeenCalledWith(expect.objectContaining({ accentPrimary: p.tokens.accentPrimary, bg: p.tokens.bgPrimary }));
  });

  it('kart şekli sekmesi ayrı; şekil yalnız geometri gönderir', () => {
    const { onTokens, btn } = mount();
    act(() => btn('Kart Şekilleri').click());
    const s = SHAPE_PRESETS.find((x) => x.id === 'shape-cam')!;
    act(() => btn(s.name).click());
    expect(onTokens).toHaveBeenCalledWith(s.tokens);
  });
});

describe('reducer ile', () => {
  it('taslak uygulaması TEK adımda geri alınır', () => {
    let st = createStudioState();
    st = studioReducer(st, { type: 'select-theme', themeId: 'tesla' });
    const before = st.manifests.tesla.tokens;
    st = studioReducer(st, { type: 'patch-tokens', patch: colorPresetsFor('tesla')[3].tokens });
    expect(st.manifests.tesla.tokens.accentPrimary).toBe(colorPresetsFor('tesla')[3].tokens.accentPrimary);
    expect(canUndo(st)).toBe(true);
    st = studioReducer(st, { type: 'undo' });
    expect(st.manifests.tesla.tokens).toEqual(before);
  });
});
