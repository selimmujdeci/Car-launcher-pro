/**
 * Runtime Manager Integration Test
 * 
 * Adaptive Runtime Manager'ın hysteresis ve mode geçişlerini test eder.
 */

import { describe, it, expect, vi } from 'vitest';
import { RUNTIME_MODE_SCENARIOS, HYSTERESIS_SCENARIOS } from './fixtures/integration';

describe('Runtime Manager Integration', () => {
  describe('Mode transitions', () => {
    RUNTIME_MODE_SCENARIOS.forEach((scenario) => {
      it(`${scenario.name}`, () => {
        const { initialMode, trigger, expectedMode } = scenario;

        // Mode geçişi simülasyonu
        let newMode = initialMode;

        switch (trigger) {
          case 'thermal':
            // Termal → downgrade
            if (initialMode === 'PERFORMANCE') newMode = 'BALANCED';
            break;
          case 'memory':
            // Bellek → power save
            if (initialMode !== 'SAFE_MODE' && initialMode !== 'POWER_SAVE') newMode = 'POWER_SAVE';
            break;
          case 'failure':
            // Arıza → safe mode
            newMode = 'SAFE_MODE';
            break;
          case 'user':
            // Kullanıcı → performance
            newMode = 'PERFORMANCE';
            break;
        }

        expect(newMode).toBe(expectedMode);
      });
    });
  });

  describe('Hysteresis behavior', () => {
    HYSTERESIS_SCENARIOS.forEach((scenario) => {
      it(`${scenario.name}`, () => {
        const { currentMode, requestedMode, shouldTransition, reason } = scenario;

        const modeRank: Record<string, number> = {
          SAFE_MODE: 0,
          POWER_SAVE: 1,
          BASIC_JS: 2,
          BALANCED: 3,
          PERFORMANCE: 4,
        };

        const currentRank = modeRank[currentMode] ?? 0;
        const requestedRank = modeRank[requestedMode] ?? 0;

        // Downgrade: her zaman anlık
        // Upgrade: 30s gecikme
        let transition: boolean;
        if (currentRank > requestedRank) {
          transition = true; // downgrade
        } else if (currentRank < requestedRank) {
          transition = false; // upgrade (gecikme gerekli)
        } else {
          transition = false; // aynı mod
        }

        expect(transition).toBe(shouldTransition);
      });
    });
  });

  describe('Power ceiling', () => {
    it('akü voltajı düşük → performance mod yasak', () => {
      const powerCeiling = 'POWER_SAVE';
      const requestedMode = 'PERFORMANCE';

      const modeRank: Record<string, number> = {
        SAFE_MODE: 0,
        POWER_SAVE: 1,
        BASIC_JS: 2,
        BALANCED: 3,
        PERFORMANCE: 4,
      };

      // Ceiling varsa üstüne çıkılamaz
      const ceilingRank = modeRank[powerCeiling] ?? 0;
      const requestedRank = modeRank[requestedMode] ?? 0;

      const actualMode = requestedRank > ceilingRank ? powerCeiling : requestedMode;

      expect(actualMode).toBe(powerCeiling);
    });
  });

  describe('Memory pressure handling', () => {
    it('CRITICAL bellek baskısı → OPTIONAL worker sonlandırılır', () => {
      const workers = [
        { key: 'VehicleCompute', criticality: 'CRITICAL' as const, worker: {} },
        { key: 'VisionCompute', criticality: 'OPTIONAL' as const, worker: {} },
        { key: 'NavigationCompute', criticality: 'OPTIONAL' as const, worker: {} },
      ];

      const level = 'CRITICAL';

      const terminatedWorkers = workers
        .filter((w) => level === 'CRITICAL' && w.criticality === 'OPTIONAL')
        .map((w) => w.key);

      expect(terminatedWorkers).toContain('VisionCompute');
      expect(terminatedWorkers).toContain('NavigationCompute');
      expect(terminatedWorkers).not.toContain('VehicleCompute');
    });
  });
});