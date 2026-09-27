/** Sürüşte video — kullanıcı kararı 2026-09-27: bilinçli açılan seçenek, varsayılan KAPALI. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';
import { useSystemStore } from '../store/useSystemStore';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { startTheaterService, stopTheaterService } from '../platform/theaterModeService';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('sinema modu hareket hâlinde', () => {
  beforeEach(() => {
    stopTheaterService();
    useUnifiedVehicleStore.setState({ speed: 0 } as never);
    useSystemStore.getState().setTheaterMode(true);
  });

  it('varsayılan: seçenek KAPALI → araç hareket edince sinema modu kapanır', () => {
    expect(useStore.getState().settings.videoWhileDriving).toBe(false);
    startTheaterService();
    useUnifiedVehicleStore.setState({ speed: 30 } as never);
    expect(useSystemStore.getState().isTheaterModeActive).toBe(false);
    stopTheaterService();
  });

  it('seçenek AÇIK → araç hareket etse de sinema modu sürer', () => {
    useStore.getState().updateSettings({ videoWhileDriving: true });
    useSystemStore.getState().setTheaterMode(true);
    startTheaterService();
    useUnifiedVehicleStore.setState({ speed: 30 } as never);
    expect(useSystemStore.getState().isTheaterModeActive).toBe(true);
    useStore.getState().updateSettings({ videoWhileDriving: false });
    vi.restoreAllMocks();
  });

  it('seçenek sürüşte kilitli Ekran sekmesinde (yalnız park hâlinde değişir)', () => {
    const src = readFileSync(resolve('src/components/settings/SettingsPage.tsx'), 'utf8');
    const appearance = src.slice(src.indexOf("{shownTab === 'appearance' && ("), src.indexOf("{shownTab === 'maintenance' && ("));
    expect(appearance).toContain('videoWhileDriving');
  });
});
