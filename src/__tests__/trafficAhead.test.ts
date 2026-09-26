/**
 * trafficAhead.test — rotada öndeki trafik olayının sesli uyarısı (TomTom bölümleri).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { decideTrafficAhead } from '../platform/navigation/core/trafficAheadModel';
import {
  noteTrafficAheadTick, _resetVoiceGuidanceForTest,
} from '../platform/navigation/voiceGuidanceRuntime';

// 11 nokta, her segment 500 m → nokta i'den sona kalan: (10 − i) × 500.
const cum = Array.from({ length: 11 }, (_, i) => (10 - i) * 500);
const jam = { startIdx: 6, endIdx: 8, level: 'heavy' as const, kind: 'JAM' as const, delayS: 180 };

describe('karar (saf)', () => {
  const base = { sections: [jam], cumulativeDistances: cum, speedKmh: 50, announcedStarts: new Set<number>() };

  it('şehirde 1 km içinde bir kez; metin mesafe + gecikme', () => {
    // Araç sona 3800 m → bölüm başı (sona 2000 m) 1800 m ileride → henüz değil.
    expect(decideTrafficAhead({ ...base, vehicleAlongRemainingM: 3800 })).toBeNull();
    const d = decideTrafficAhead({ ...base, vehicleAlongRemainingM: 2900 })!;
    expect(d.text).toBe('900 metre sonra trafik sıkışıklığı, yaklaşık 3 dakika gecikme');
  });

  it('otoyol hızında 2 km önceden', () => {
    expect(decideTrafficAhead({ ...base, speedKmh: 110, vehicleAlongRemainingM: 3800 })!.text)
      .toBe('1,8 kilometre sonra trafik sıkışıklığı, yaklaşık 3 dakika gecikme');
  });

  it('🔒 küçük gecikme konuşulmaz; kapalı yol gecikmesiz de söylenir; geçilen bölüm söylenmez', () => {
    const small = { ...jam, delayS: 30 };
    expect(decideTrafficAhead({ ...base, sections: [small], vehicleAlongRemainingM: 2500 })).toBeNull();
    const closed = { ...jam, kind: 'ROAD_CLOSURE' as const, delayS: null };
    expect(decideTrafficAhead({ ...base, sections: [closed], vehicleAlongRemainingM: 2500 })!.text)
      .toBe('500 metre sonra yol kapalı');
    expect(decideTrafficAhead({ ...base, vehicleAlongRemainingM: 1500 })).toBeNull();   // bölümün içinde
  });

  it('konum bilinmiyorsa karar YOK', () => {
    expect(decideTrafficAhead({ ...base, vehicleAlongRemainingM: null })).toBeNull();
  });
});

describe('runtime', () => {
  const spoken: string[] = [];
  const speak = (t: string) => { spoken.push(t); };
  const tick = (along: number, over: Partial<Parameters<typeof noteTrafficAheadTick>[0]> = {}) =>
    noteTrafficAheadTick({
      sessionId: 1, routeRevision: 1, isRerouting: false, sections: [jam], cumulativeDistances: cum,
      vehicleAlongRemainingM: along, speedKmh: 50, distanceToNextTurnM: null, ...over,
    }, speak);

  beforeEach(() => { _resetVoiceGuidanceForTest(); spoken.length = 0; });

  it('🔒 aynı olay bir kez söylenir; yeni rota revizyonunda yeniden değerlendirilir', () => {
    tick(2900); tick(2700); tick(2500);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatch(/^900 metre sonra trafik sıkışıklığı/);
    tick(2400, { routeRevision: 2 });
    expect(spoken).toHaveLength(2);
  });

  it('🔒 dönüş anonsu yakınken ertelenir, sonra söylenir', () => {
    tick(2900, { distanceToNextTurnM: 150 });
    expect(spoken).toHaveLength(0);
    tick(2800, { distanceToNextTurnM: 900 });
    expect(spoken).toHaveLength(1);
  });

  it('yeniden rota hesaplanırken konuşulmaz', () => {
    tick(2900, { isRerouting: true });
    expect(spoken).toHaveLength(0);
  });
});
