/**
 * Tema Stüdyo önizlemesi taslağı GERÇEKTEN uygular (saha 2026-09-26, başsız
 * Chrome'da ölçüldü): (1) baz tema manifestten SONRA değişince tema-değişimi
 * dinleyicisi renkleri siliyordu; (2) gündüz `.sunlight-mode` `!important` ile
 * --bg-card/--bg-primary'yi beyaza zorluyordu → yalnız ikon rengi değişiyordu.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initThemeRuntime, __resetThemeRuntimeForTest } from '../platform/theme/themeRuntime';
import { initThemePreviewBridge } from '../platform/themePreviewBridge';
import { createThemeManifest } from '../platform/theme/themeManifest';
import { useCarTheme } from '../store/useCarTheme';

function send(manifest: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    origin: 'https://carospro.com', data: { type: 'caros-theme-manifest', manifest },
  }));
}

describe('önizleme: taslak renkleri kalır', () => {
  beforeEach(() => {
    __resetThemeRuntimeForTest();
    document.documentElement.removeAttribute('style');
    useCarTheme.getState().setTheme('expedition');
    initThemeRuntime();
    initThemePreviewBridge();
  });

  it('BAŞKA temaya ait manifest gelince baz tema değişir VE renkler silinmez', () => {
    const m = createThemeManifest('horizon');
    m.tokens.bgCard = { kind: 'solid', from: '#2a1f3d', to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 };
    m.tokens.accentPrimary = '#b38cff';
    send(m);
    expect(useCarTheme.getState().theme).toBe('horizon');
    const st = document.documentElement.style;
    expect(st.getPropertyValue('--bg-card')).toBe('#2a1f3d');
    expect(st.getPropertyValue('--accent-primary')).toBe('#b38cff');
    expect(st.getPropertyValue('--card-hi')).not.toBe('');
  });

  it('kullanıcı tokenları !important yazılır (güneş modu zorlamasını yener)', () => {
    const m = createThemeManifest('expedition');
    m.tokens.bgPrimary = { kind: 'solid', from: '#101820', to: null, angle: 180, stopA: 0, stopB: 100, alpha: 100 };
    send(m);
    expect(document.documentElement.style.getPropertyPriority('--bg-primary')).toBe('important');
  });
});
