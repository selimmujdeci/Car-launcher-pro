/**
 * screenOrientationPreference.test.tsx — Ayarlar › Ekran › Ekran yönü.
 *
 * Kilitlenenler:
 *  · varsayılan YATAY (eski davranış) — mevcut kurulumlar değişmez
 *  · tercih tek sahipte (navigationOrientation); tam ekran navigasyon bırakılınca
 *    TABAN yöne dönülür
 *  · native: tercih iletilir; eski APK'da (yöntem yok) sessiz yatay, hata fırlatmaz
 *  · native kenar: navigasyon çıkışı sabit yataya değil TABAN tercihe döner;
 *    MainActivity tercihi JS'ten önce uygular
 *  · web perdesi yalnız 'landscape' tercihinde
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const h = vi.hoisted(() => ({
  native: false,
  plugin: {} as Record<string, unknown>,
}));

vi.mock('../platform/bridge', async () => {
  const actual = await vi.importActual<typeof import('../platform/bridge')>('../platform/bridge');
  return { ...actual, get isNative() { return h.native; } };
});
vi.mock('../platform/nativePlugin', async () => {
  const actual = await vi.importActual<typeof import('../platform/nativePlugin')>('../platform/nativePlugin');
  return { ...actual, CarLauncher: h.plugin };
});

import {
  acquireFullNavigationOrientation, getNavigationOrientationSnapshot, getScreenOrientationPreference,
  setScreenOrientationPreference, _resetNavigationOrientationForTest,
} from '../platform/navigation/navigationOrientation';
import { ScreenOrientationPanel } from '../components/settings/ScreenOrientationPanel';
import { useStore } from '../store/useStore';

const read = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');

beforeEach(() => {
  _resetNavigationOrientationForTest();
  h.native = false;
  for (const k of Object.keys(h.plugin)) delete h.plugin[k];
});

describe('taban yön tercihi', () => {
  it('O1. 🔒 varsayılan YATAY — ana arayüz dikeye açık değil', () => {
    expect(useStore.getState().settings.screenOrientation).toBe('landscape');
    const s = getNavigationOrientationSnapshot();
    expect(s.base).toBe('landscape');
    expect(s.mainUiPortraitAllowed).toBe(false);
  });

  it('O2. dikey/otomatik seçilince ana arayüz dikeye açılır; geçersiz değer yok sayılır', async () => {
    await setScreenOrientationPreference('portrait');
    expect(getScreenOrientationPreference()).toBe('portrait');
    expect(getNavigationOrientationSnapshot().mainUiPortraitAllowed).toBe(true);
    await setScreenOrientationPreference('auto');
    expect(getNavigationOrientationSnapshot().base).toBe('auto');
    await setScreenOrientationPreference('ters' as never);
    expect(getScreenOrientationPreference()).toBe('auto');
  });

  it('O3. tam ekran navigasyon dört yönü açar, bırakınca TABAN tercih korunur', async () => {
    await setScreenOrientationPreference('portrait');
    const release = acquireFullNavigationOrientation();
    expect(getNavigationOrientationSnapshot().mode).toBe('FULL_SENSOR');
    release();
    const s = getNavigationOrientationSnapshot();
    expect(s.mode).toBe('LOCKED_LANDSCAPE');   // = taban yön (ad tarihsel)
    expect(s.base).toBe('portrait');
  });
});

describe('native', () => {
  it('N1. tercih native\'e iletilir', async () => {
    h.native = true;
    const calls: unknown[] = [];
    h.plugin.setScreenOrientation = vi.fn(async (o: unknown) => { calls.push(o); return { mode: 'portrait', applied: true }; });
    await setScreenOrientationPreference('portrait');
    expect(calls).toEqual([{ mode: 'portrait' }]);
    expect(getNavigationOrientationSnapshot().lastError).toBeNull();
  });

  it('N2. 🔒 eski APK (yöntem yok) → hata FIRLATMAZ, hata kaydı düşer', async () => {
    h.native = true;
    await expect(setScreenOrientationPreference('portrait')).resolves.toBeUndefined();
    expect(getNavigationOrientationSnapshot().lastError).toContain('eski APK');
  });

  it('N3. native çağrı hatası → fail-soft, hata kaydı', async () => {
    h.native = true;
    h.plugin.setScreenOrientation = vi.fn(async () => { throw new Error('persist_failed'); });
    await expect(setScreenOrientationPreference('auto')).resolves.toBeUndefined();
    expect(getNavigationOrientationSnapshot().lastError).toBe('persist_failed');
  });
});

describe('arayüz', () => {
  it('U1. üç seçenek; varsayılan YATAY seçili (aria-checked)', () => {
    /* Not: renderToStaticMarkup zustand'ın İLK durumunu okur → varsayılan görünüm. */
    const html = renderToStaticMarkup(<ScreenOrientationPanel />);
    const labels = [...html.matchAll(/<span class="text-sm font-bold">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Yatay', 'Dikey', 'Otomatik']);
    expect(html).toMatch(/aria-checked="true"[^>]*>(<[^>]+>)*Yatay/);
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
  });

  it('U2. seçim ayara yazılır (tek doğruluk: settings.screenOrientation)', () => {
    useStore.getState().updateSettings({ screenOrientation: 'portrait' });
    expect(useStore.getState().settings.screenOrientation).toBe('portrait');
    useStore.getState().updateSettings({ screenOrientation: 'landscape' });
  });
});

describe('yapısal kilitler', () => {
  it('S1. 🔒 native: navigasyon çıkışı TABAN tercihe döner; geçersiz mod reddedilir', () => {
    const src = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(src).toMatch(/: screenOrientationFor\(readScreenOrientationPref\(getContext\(\)\)\)/);
    expect(src).toMatch(/if \(!isScreenOrientationPref\(mode\)\) \{ call\.reject\("invalid_mode"\)/);
    expect(src).toMatch(/"portrait"\.equals\(pref\)\) return android\.content\.pm\.ActivityInfo\.SCREEN_ORIENTATION_SENSOR_PORTRAIT/);
  });

  it('S2. 🔒 MainActivity tercihi JS\'ten önce uygular; varsayılanda dokunmaz', () => {
    const src = read('android/app/src/main/java/com/cockpitos/pro/MainActivity.java');
    expect(src).toMatch(/if \(!"landscape"\.equals\(pref\)\) \{\s*setRequestedOrientation\(CarLauncherPlugin\.screenOrientationFor\(pref\)\);/);
  });

  it('S3. 🔒 web perdesi yalnız yatay tercihte; App tercihi tek sahibine bağlar', () => {
    const src = read('src/App.tsx');
    expect(src).toMatch(/isPortrait && !isNative && screenOrientation === 'landscape' &&/);
    expect(src).toMatch(/setScreenOrientationPreference\(screenOrientation\)/);
  });
});
