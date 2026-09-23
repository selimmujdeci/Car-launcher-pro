/**
 * navVoiceArrival.test — varış ve talimat anonslarının dili (analiz 2026-09-24).
 *
 *   · "600 metre sonra hedefinize ulaştınız" (geçmiş zaman) → gelecek zaman.
 *   · Varışta ikinci anons ("Hedefiniz 500 metrede") → sesli varış varsa YOK.
 *   · Yolculuk 500 m içinden başladıysa "500 metrede" denmez.
 *   · "Sağa dönün (Atatürk Caddesi)" parantezle okunmaz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({ spoken: [] as string[] }));
vi.mock('../platform/ttsService', async (orig) => ({
  ...(await orig<typeof import('../platform/ttsService')>()),
  speakNavigation: (t: string) => { M.spoken.push(t); },
}));
vi.mock('../platform/bridge', () => ({ isNative: false }));

import { decideGuidance, spokenInstruction } from '../platform/navigation/core/voiceGuidanceModel';
import {
  startNavigation, activateNavigation, stopNavigation, updateNavigationProgress,
} from '../platform/navigationService';
import { writeActiveRoute } from '../platform/routingService';

const base = {
  navActive: true, isRerouting: false, distanceSource: 'ALONG_ROUTE' as const,
  speedKmh: 50, spokenBits: 0,
};

describe('varış anonsu', () => {
  it('🔒 varış adımı gelecek zamanla söylenir', () => {
    expect(decideGuidance({ ...base, distanceM: 580, instruction: 'Hedefinize ulaştınız', isArrival: true })!.text)
      .toBe('600 metre sonra hedefinize ulaşacaksınız');
    expect(decideGuidance({ ...base, distanceM: 40, instruction: 'Hedefinize ulaştınız', isArrival: true })!.text)
      .toBe('Hedefinize ulaşmak üzeresiniz');
  });

  it('dönüş talimatı değişmedi', () => {
    expect(decideGuidance({ ...base, distanceM: 240, instruction: 'Sola dönün' })!.text).toBe('250 metre sonra sola dönün');
  });
});

describe('yol adı', () => {
  it('🔒 parantez sese okunmaz', () => {
    expect(spokenInstruction('Sağa dönün (Atatürk Caddesi)')).toBe('sağa dönün, Atatürk Caddesi');
    expect(spokenInstruction('Dönel kavşakta 2. çıkıştan ayrılın (D400)')).toBe('dönel kavşakta 2. çıkıştan ayrılın, D400');
    expect(spokenInstruction('U dönüşü yapın')).toBe('u dönüşü yapın');
  });
});

describe('500 m yakınlık uyarısı', () => {
  const dest = { id: 'p1', name: 'P', latitude: 41.0, longitude: 29.0, type: 'history' as const };
  // Kuzeyden hedefe inen düz rota (~1,1 km).
  const geom: [number, number][] = [[29.0, 41.01], [29.0, 41.0]];
  const step = { instruction: 'x', streetName: '', distance: 0, duration: 0, maneuverType: 'arrive',
    maneuverModifier: 'straight', coordinate: [29, 41] as [number, number], roundaboutExit: null, lanes: null, geometryPointCount: 0 };

  const setSteps = (steps: typeof step[]) =>
    writeActiveRoute({ geometry: geom, distanceM: 1100, durationS: 100, steps });

  beforeEach(() => { M.spoken.length = 0; stopNavigation(); });

  const drive = () => {
    startNavigation(dest, false, 'USER');
    activateNavigation();
    updateNavigationProgress(41.01, 29.0, 0, geom);    // ~1,1 km
    updateNavigationProgress(41.004, 29.0, 0, geom);   // ~445 m
    stopNavigation();
  };

  it('🔒 rota sesli varış içeriyorsa ikinci anons YOK', () => {
    setSteps([{ ...step, maneuverType: 'depart' }, step]);
    drive();
    expect(M.spoken.filter((t) => t.includes('500 metrede'))).toHaveLength(0);
  });

  it('tek adımlı (sentinel) rotada uyarı söylenir', () => {
    setSteps([step]);
    drive();
    expect(M.spoken).toContain('Hedefiniz 500 metrede, hazır olun.');
  });

  it('🔒 yolculuk 500 m içinden başladıysa "500 metrede" denmez', () => {
    setSteps([step]);
    startNavigation(dest, false, 'USER');
    activateNavigation();
    updateNavigationProgress(41.003, 29.0, 0, geom);   // ~330 m
    stopNavigation();
    expect(M.spoken.filter((t) => t.includes('500 metrede'))).toHaveLength(0);
  });
});

describe('otoyol kademeleri', () => {
  it('🔒 80 km/s üstünde ilk anons 1 km, yaklaşma 400 m', () => {
    const hw = { ...base, speedKmh: 110, instruction: 'Sağdaki çıkışı kullanın' };
    expect(decideGuidance({ ...hw, distanceM: 980 })!.text).toBe('1 kilometre sonra sağdaki çıkışı kullanın');
    expect(decideGuidance({ ...hw, distanceM: 380, spokenBits: 1 })!.stage).toBe('NEAR');
    // Şehir hızında 980 m'de henüz konuşulmaz.
    expect(decideGuidance({ ...hw, speedKmh: 50, distanceM: 980 })).toBeNull();
  });

  it('kilometre ondalığı Türkçe virgülle', async () => {
    const { spokenDistance } = await import('../platform/navigation/core/voiceGuidanceModel');
    expect(spokenDistance(1480)).toBe('1,5 kilometre');
    expect(spokenDistance(240)).toBe('250 metre');
  });
});

describe('ardışık manevra', () => {
  it('🔒 yakın ikinci manevra "ardından" ile aynı anonsta söylenir', () => {
    const d = decideGuidance({ ...base, distanceM: 200, instruction: 'Sağa dönün', thenInstruction: 'Sola dönün (Cumhuriyet Caddesi)' })!;
    expect(d.text).toBe('200 metre sonra sağa dönün, ardından sola dönün, Cumhuriyet Caddesi');
    expect(decideGuidance({ ...base, distanceM: 30, instruction: 'Sağa dönün', thenInstruction: 'Hedefinize ulaştınız', thenIsArrival: true })!.text)
      .toBe('Şimdi sağa dönün, ardından hedefinize ulaşacaksınız');
  });

  it('uzak kademede (FAR) eklenmez — ikinci manevra o an henüz anlamsız', () => {
    expect(decideGuidance({ ...base, distanceM: 580, instruction: 'Sağa dönün', thenInstruction: 'Sola dönün' })!.text)
      .toBe('600 metre sonra sağa dönün');
  });
});

describe('dikkat bütçesi kısaltması', () => {
  it('🔒 ondalıklı kilometre ön eki artık kırpıntı bırakmaz', async () => {
    const { shortenInstruction } = await vi.importActual<typeof import('../platform/ttsService')>('../platform/ttsService');
    expect(shortenInstruction('1,5 kilometre sonra sağdaki çıkışı kullanın')).toBe('sağdaki çıkışı kullanın');
    expect(shortenInstruction('250 metre sonra sola dönün')).toBe('sola dön');
  });
});
