/**
 * dayNightManualSunlight.test.tsx — Elle gece seçimi güneş modunu kapatır.
 *
 * Regresyon (ekran taraması 2026-10-03): gündüz saatinde kullanıcı Ayarlar'dan
 * GECE'yi seçince `setUserOverride` kuruluyor; `applySunlightMode` kilit aktifken
 * HER değişikliği reddettiği için Katman 3a'nın "gece → hep kapat" köprüsü de
 * çalışmıyordu → gece paletinde güneş modu (52px düğme, 2px siyah kenar, büyük
 * yazı) açık kalıyordu. Kilit OTOMATİK geçişleri durdurmak içindir; kullanıcının
 * kendi gece kararının sonucunu değil.
 *
 * Gerçek hook gerçek store ile çalışır; yalnız kilit kaynağı, OBD aboneliği ve
 * OLED varyant yan etkisi taklit edilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const ovr = vi.hoisted(() => ({ active: false }));

vi.mock('../platform/system/SystemOrchestrator', () => ({ isUserOverrideActive: () => ovr.active }));
vi.mock('../platform/obdService', () => ({ onOBDData: () => () => undefined }));
vi.mock('../store/useCarTheme', () => ({ autoApplyOledVariant: () => undefined }));

import { useStore } from '../store/useStore';
import { useDayNightManager } from '../hooks/useDayNightManager';

function Harness() { useDayNightManager(); return null; }

let container: HTMLDivElement;
let root: Root;
const sunlight = () => document.documentElement.classList.contains('sunlight-mode');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0));   // yerel öğle — gündüz saati
  ovr.active = false;
  document.documentElement.classList.remove('sunlight-mode');
  useStore.getState().updateSettings({ dayNightMode: 'day', autoThemeEnabled: true, autoBrightnessEnabled: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('Gündüz/gece — elle gece seçimi', () => {
  it('gündüz saatinde elle GECE (kilit aktif) → güneş modu kapanır', async () => {
    await act(async () => { root.render(<Harness />); });
    expect(sunlight(), 'ön koşul: gündüz + far kapalı → güneş modu açık').toBe(true);

    ovr.active = true;   // SettingsPage.toggleDayNight → setUserOverride(120_000)
    await act(async () => { useStore.getState().updateSettings({ dayNightMode: 'night', theme: 'dark' }); });
    expect(sunlight(), 'gece paletinde güneş modu açık kaldı').toBe(false);
  });

  it('kilit aktifken OTOMATİK gündüz kararı güneş modunu açamaz (mevcut davranış korunur)', async () => {
    useStore.getState().updateSettings({ dayNightMode: 'night', theme: 'dark' });
    ovr.active = true;
    await act(async () => { root.render(<Harness />); });
    expect(sunlight()).toBe(false);
  });
});
