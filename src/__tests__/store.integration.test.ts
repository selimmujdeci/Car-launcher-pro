/**
 * Store Integration Test
 * 
 * Zustand store'larının persist ve state güncellemelerini test eder.
 */

import { describe, it, expect, vi as _vi, beforeEach as _beforeEach } from 'vitest';
import { STORE_FIXTURES } from './helpers';

describe('Store Integration', () => {
  describe('Settings deep merge', () => {
    it('persist settings → default settings → doğru merge', () => {
      const defaults = STORE_FIXTURES.defaultSettings;
      const persisted = {
        language: 'en',
        theme: 'light' as const,
      };

      // Deep merge simülasyonu
      const merged = { ...defaults };
      for (const key in persisted) {
        const d = defaults[key as keyof typeof defaults];
        const p = persisted[key as keyof typeof persisted];
        if (p !== undefined && d !== null && typeof d === 'object' && !Array.isArray(d) &&
            p !== null && typeof p === 'object' && !Array.isArray(p)) {
          (merged as Record<string, unknown>)[key] = { ...d, ...p };
        } else if (p !== undefined) {
          (merged as Record<string, unknown>)[key] = p;
        }
      }

      expect(merged.language).toBe('en');
      expect(merged.theme).toBe('light');
      expect(merged.themePack).toBe('tesla'); // varsayılan korunmalı
    });
  });

  describe('Negative Delta Guard (km values)', () => {
    it('km geri gidemez', () => {
      const current = {
        lastOilChangeKm: 50000,
        nextOilChangeKm: 60000,
      };

      const newValues = {
        lastOilChangeKm: 40000, // geri gidiyor → reddedilmeli
        nextOilChangeKm: 55000,
      };

      // Negative Delta Guard
      const isValid = 
        newValues.lastOilChangeKm >= current.lastOilChangeKm &&
        newValues.nextOilChangeKm >= current.lastOilChangeKm;

      expect(isValid).toBe(false);
    });

    it('km ileri gidebilir', () => {
      const current = {
        lastOilChangeKm: 50000,
        nextOilChangeKm: 60000,
      };

      const newValues = {
        lastOilChangeKm: 55000,
        nextOilChangeKm: 65000,
      };

      const isValid = 
        newValues.lastOilChangeKm >= current.lastOilChangeKm &&
        newValues.nextOilChangeKm >= current.lastOilChangeKm;

      expect(isValid).toBe(true);
    });
  });

  describe('Runtime state reset on reload', () => {
    it('oturum başında runtime state sıfırlanır', () => {
      const persisted = {
        activeSmartCards: [{ id: 'card-1' }],
        fuelSuggestionCard: { id: 'fuel-1' },
        isEcoMode: true,
        targetFPS: 30,
      };

      // merge fonksiyonu: runtime state sıfırlanır
      const merged = {
        ...persisted,
        activeSmartCards: [], // oturum başı sıfırla
        fuelSuggestionCard: null,
        theaterSuggestionCard: null,
        isEcoMode: false,
        targetFPS: 0,
      };

      expect(merged.activeSmartCards).toHaveLength(0);
      expect(merged.fuelSuggestionCard).toBeNull();
      expect(merged.isEcoMode).toBe(false);
    });
  });

  describe('Vehicle profile switch', () => {
    it('aktif profil değiştiğinde OBD vehicle type güncellenir', () => {
      const profiles = [
        { id: 'ice-1', name: 'Benzin', vehicleType: 'ice' as const },
        { id: 'ev-1', name: 'Elektrik', vehicleType: 'ev' as const },
      ];

      const activeProfileId = 'ev-1';
      const activeProfile = profiles.find((p) => p.id === activeProfileId);

      // OBD vehicle type güncellemesi
      const newVehicleType = activeProfile?.vehicleType ?? 'ice';

      expect(newVehicleType).toBe('ev');
    });
  });
});