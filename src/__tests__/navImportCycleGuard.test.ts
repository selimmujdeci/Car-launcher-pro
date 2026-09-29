/**
 * Dev sunucusu açılış çökmesi kilidi:
 * "Cannot access 'REROUTE_THRESHOLD_M' before initialization" (navEgoHorizonBridge).
 * Döngü: routingService → offlineRoutingService → SystemBoot → navigationSessionRuntime
 *        → navEgoHorizonBridge → routingService. Köprü eşiği üst düzeyde okuyordu.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as leaf from '../platform/navigation/routeThresholds';
import * as routing from '../platform/routingService';

const read = (f: string) => readFileSync(join(__dirname, '../platform', f), 'utf8');

describe('rota eşikleri — döngüsel import güvenliği', () => {
  it('yaprak modülün hiç import\'u yok', () => {
    expect(read('navigation/routeThresholds.ts')).not.toMatch(/^\s*import\s/m);
  });

  it('routingService aynı değerleri yeniden dışa aktarır (tek kaynak)', () => {
    expect(routing.REROUTE_THRESHOLD_M).toBe(leaf.REROUTE_THRESHOLD_M);
    expect(routing.STEP_ADVANCE_THRESHOLD_M).toBe(leaf.STEP_ADVANCE_THRESHOLD_M);
    expect(routing.MANEUVER_STACK_THRESHOLD_M).toBe(leaf.MANEUVER_STACK_THRESHOLD_M);
    expect(leaf.STEP_ADVANCE_THRESHOLD_M).toBeLessThan(leaf.MANEUVER_STACK_THRESHOLD_M);
    expect(leaf.MANEUVER_STACK_THRESHOLD_M).toBeLessThan(leaf.REROUTE_THRESHOLD_M);
  });

  it('köprü eşiği routingService\'ten DEĞİL yaprak modülden okur', () => {
    const src = read('navigation/navEgoHorizonBridge.ts');
    expect(src).toMatch(/import \{ REROUTE_THRESHOLD_M \} from '\.\/routeThresholds';/);
    expect(src).not.toMatch(/REROUTE_THRESHOLD_M,?\s*\n?\s*\} from '\.\.\/routingService'/);
  });

  it('offlineRoutingService SystemBoot\'u statik import etmez (döngü kenarı kapalı)', () => {
    expect(read('offlineRoutingService.ts')).not.toMatch(/^import[^;]*from '\.\/system\/SystemBoot';/m);
  });
});
