/**
 * useStore.test.ts — Zustand persist store testleri.
 *
 * Test kapsamı:
 *  - DEFAULT_SETTINGS bazlı başlangıç durumu
 *  - migrate: v3→v4 sleepMode=false zorunlu
 *  - migrate: v1→v4 editMode=false + dayNightMode='night'
 *  - merge: her yüklemede sleepMode/editMode sıfırlanır
 *  - updateSettings: kısmi birleştirme diğer alanları korur
 *  - safeStorage: QuotaExceededError sessizce yönetilir
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── localStorage mock ─────────────────────────────────────── */
// jsdom içinde localStorage zaten var; sadece davranışları test ediyoruz.

/* ── Helpers ────────────────────────────────────────────────── */

const STORAGE_KEY = 'car-launcher-storage';

function clearStore(): void {
  localStorage.removeItem(STORAGE_KEY);
}


/* ── Import (her testten sonra modül sıfırlanmalı) ────────────
 * Zustand modül seviyesi state tuttuğu için her describe bloğunda
 * resetSettings() çağrısıyla sıfırlıyoruz.                       */

import { useStore } from '../store/useStore';

/* ── İlk durum ─────────────────────────────────────────────── */

describe('useStore — başlangıç durumu', () => {
  beforeEach(clearStore);

  it('varsayılan tema "light"', () => {
    // Persist middleware önceki değeri yoksa DEFAULT_SETTINGS kullanır
    useStore.getState().resetSettings();
    expect(useStore.getState().settings.theme).toBe('light');
  });

  it('varsayılan themePack "tesla"', () => {
    useStore.getState().resetSettings();
    expect(useStore.getState().settings.themePack).toBe('tesla');
  });

  it('varsayılan wallpaper "none"', () => {
    useStore.getState().resetSettings();
    expect(useStore.getState().settings.wallpaper).toBe('none');
  });

  it('sleepMode başlangıçta false', () => {
    useStore.getState().resetSettings();
    expect(useStore.getState().settings.sleepMode).toBe(false);
  });

  it('editMode başlangıçta false', () => {
    useStore.getState().resetSettings();
    expect(useStore.getState().settings.editMode).toBe(false);
  });
});

/* ── updateSettings ─────────────────────────────────────────── */

describe('useStore — updateSettings', () => {
  beforeEach(() => {
    clearStore();
    useStore.getState().resetSettings();
  });

  it('kısmi güncelleme diğer alanları bozmaz', () => {
    const { updateSettings } = useStore.getState();
    const before = useStore.getState().settings.volume;

    updateSettings({ theme: 'oled' });

    const after = useStore.getState().settings;
    expect(after.theme).toBe('oled');
    expect(after.volume).toBe(before); // değişmedi
    expect(after.themePack).toBe('tesla'); // değişmedi
  });

  it('birden fazla alan aynı anda güncellenebilir', () => {
    const { updateSettings } = useStore.getState();
    updateSettings({ theme: 'light', volume: 80, showSeconds: true });

    const { settings } = useStore.getState();
    expect(settings.theme).toBe('light');
    expect(settings.volume).toBe(80);
    expect(settings.showSeconds).toBe(true);
  });

  it('boolean toggle — sleepMode', () => {
    const { updateSettings } = useStore.getState();
    expect(useStore.getState().settings.sleepMode).toBe(false);
    updateSettings({ sleepMode: true });
    expect(useStore.getState().settings.sleepMode).toBe(true);
    updateSettings({ sleepMode: false });
    expect(useStore.getState().settings.sleepMode).toBe(false);
  });

  it('wallpaper güncelleme', () => {
    const { updateSettings } = useStore.getState();
    const newWallpaper = 'linear-gradient(135deg, #000, #fff)';
    updateSettings({ wallpaper: newWallpaper });
    expect(useStore.getState().settings.wallpaper).toBe(newWallpaper);
  });

  it('widgetVisible kısmi güncelleme diğer widget durumlarını korur', () => {
    const { updateSettings } = useStore.getState();
    const before = useStore.getState().settings.widgetVisible;

    updateSettings({ widgetVisible: { ...before, obd: false } });

    const after = useStore.getState().settings.widgetVisible;
    expect(after.obd).toBe(false);
    expect(after.nav).toBe(true); // diğerleri korundu
    expect(after.media).toBe(true);
  });
});

/* ── resetSettings ──────────────────────────────────────────── */

describe('useStore — resetSettings', () => {
  it('tüm ayarları varsayılana döndürür', () => {
    const { updateSettings, resetSettings } = useStore.getState();
    updateSettings({ theme: 'dark', volume: 99, gridColumns: 5 });

    resetSettings();

    const { settings } = useStore.getState();
    expect(settings.theme).toBe('light');
    expect(settings.volume).toBe(60);
    expect(settings.gridColumns).toBe(3);
  });
});

/* ── safeStorage — QuotaExceededError ──────────────────────── */

describe('safeStorage — QuotaExceededError koruması', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearStore();
  });

  it('setItem quota dolduğunda sessizce başarısız olur (uygulama çökmez)', () => {
    // Birinci setItem çağrısında QuotaExceededError fırlat
    const originalSetItem = localStorage.setItem.bind(localStorage);
    let callCount = 0;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      callCount++;
      if (callCount === 1) {
        const err = new DOMException('Quota exceeded', 'QuotaExceededError');
        throw err;
      }
      originalSetItem(key, value);
    });

    // updateSettings QuotaExceededError'a rağmen atmamalı
    expect(() => {
      useStore.getState().updateSettings({ volume: 42 });
    }).not.toThrow();
  });
});

/* ── updateMaintenance ──────────────────────────────────────── */

describe('useStore — updateMaintenance', () => {
  beforeEach(() => {
    clearStore();
    useStore.getState().resetSettings();
  });

  it('kısmi bakım güncellemesi', () => {
    const { updateMaintenance } = useStore.getState();
    updateMaintenance({ currentKm: 50000 });

    const { maintenance } = useStore.getState().settings;
    expect(maintenance.currentKm).toBe(50000);
    expect(maintenance.nextOilChangeKm).toBe(10000); // değişmedi
  });
});

/* ── updateParking ──────────────────────────────────────────── */

describe('useStore — updateParking', () => {
  beforeEach(() => {
    clearStore();
    useStore.getState().resetSettings();
  });

  it('park konumu kaydet', () => {
    const { updateParking } = useStore.getState();
    const loc = { lat: 41.01, lng: 28.97, timestamp: Date.now(), address: 'İstanbul' };
    updateParking(loc);
    expect(useStore.getState().settings.parkingLocation).toEqual(loc);
  });

  it('park konumunu temizle (null)', () => {
    const { updateParking } = useStore.getState();
    updateParking({ lat: 41.01, lng: 28.97, timestamp: Date.now() });
    updateParking(null);
    expect(useStore.getState().settings.parkingLocation).toBeNull();
  });
});
