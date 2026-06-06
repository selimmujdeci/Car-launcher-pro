/**
 * offlineConversationEngine.test.ts — esnek (skorlu) anlama + araç Q&A.
 *
 * Veri kaynakları mock'lanır; motorun kelime-sırasından bağımsız eşleştiğini
 * ve gerçek araç verisinden yanıt ürettiğini doğrular.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../platform/mediaService', () => ({
  getMediaState: () => ({ hasSession: true, track: { title: 'Test Şarkı', artist: 'Test Sanatçı' } }),
}));
vi.mock('../platform/gpsService', () => ({
  getGPSState: () => ({ location: { speed: 0 } }),
}));
vi.mock('../platform/routingService', () => ({
  getRouteState: () => ({ geometry: null, totalDistanceMeters: 0, totalDurationSeconds: 0 }),
}));
vi.mock('../platform/obdService', () => ({
  onOBDData: (cb: (d: Record<string, unknown>) => void) => {
    cb({
      speed: 50, rpm: 2000, engineTemp: 88, fuelLevel: 42,
      fuelRemainingL: 21, estimatedRangeKm: 380, range: -1,
      batteryVoltage: 13.8, batteryLevel: -1, chargingState: 'not_charging',
      throttle: 15, headlights: false,
      doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
      tpms: { fl: 235, fr: 233, rl: 230, rr: 232 },
    });
    return () => {};
  },
}));

import { tryOfflineConversation } from '../platform/offlineConversationEngine';

describe('offlineConversationEngine — araç verisi Q&A', () => {
  it('"ne kadar yakıt var" → yakıt yanıtı', () => {
    const r = tryOfflineConversation('ne kadar yakıt var');
    expect(r.handled).toBe(true);
    expect(r.response.toLowerCase()).toContain('yakıt');
  });

  it('kelime sırası farkı: "yakıt ne kadar kaldı" da yakıt yanıtı (esnek eşleşme)', () => {
    const r = tryOfflineConversation('yakıt ne kadar kaldı');
    expect(r.handled).toBe(true);
    expect(r.response).toContain('42');
  });

  it('"akü kaç volt" → akü voltajı', () => {
    const r = tryOfflineConversation('akü kaç volt');
    expect(r.handled).toBe(true);
    expect(r.response).toContain('13.8');
  });

  it('"hız kaç" → hız (snapshot 50)', () => {
    const r = tryOfflineConversation('hız kaç');
    expect(r.handled).toBe(true);
    expect(r.response).toContain('50');
  });

  it('"motor devri kaç" → RPM', () => {
    const r = tryOfflineConversation('motor devri kaç');
    expect(r.handled).toBe(true);
    expect(r.response).toContain('2000');
  });

  it('"lastik basıncı nasıl" → lastik yanıtı', () => {
    const r = tryOfflineConversation('lastik basıncı nasıl');
    expect(r.handled).toBe(true);
    expect(r.response.toLowerCase()).toContain('lastik');
  });

  it('"kapılar kapalı mı" → kapı durumu', () => {
    const r = tryOfflineConversation('kapılar kapalı mı');
    expect(r.handled).toBe(true);
    expect(r.response.toLowerCase()).toContain('kapı');
  });

  it('"ne çalıyor" → çalan müzik', () => {
    const r = tryOfflineConversation('ne çalıyor');
    expect(r.handled).toBe(true);
    expect(r.response).toContain('Test Şarkı');
  });

  it('"varışa ne kadar kaldı" → rota yok bilgisi (yine de handled)', () => {
    const r = tryOfflineConversation('varışa ne kadar kaldı');
    expect(r.handled).toBe(true);
    expect(r.response.toLowerCase()).toContain('rota');
  });
});

describe('offlineConversationEngine — sohbet + eşleşmeme', () => {
  it('"merhaba" → selamlama', () => {
    expect(tryOfflineConversation('merhaba').handled).toBe(true);
  });

  it('"saat kaç" → saat', () => {
    const r = tryOfflineConversation('saat kaç');
    expect(r.handled).toBe(true);
    expect(r.response.toLowerCase()).toContain('saat');
  });

  it('alakasız giriş → handled:false (uydurma yanıt yok)', () => {
    expect(tryOfflineConversation('asdf qwerty zxcv').handled).toBe(false);
  });

  it('boş giriş → handled:false', () => {
    expect(tryOfflineConversation('   ').handled).toBe(false);
  });
});
