/**
 * Uygulama kontrolü (saha 2026-09-26): genel parser "30 saniye ileri sar"ı
 * sonraki şarkıya, "tesla temasına geç"i şarkı değiştirmeye çeviriyordu;
 * sürücü değiştirme komutu hiç yoktu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAppControl, matchDriverName } from '../platform/voice/appControlCommands';

describe('parseAppControl — dar ve kesin', () => {
  it.each([
    ['karıştırmayı aç', { op: 'shuffle', on: true }],
    ['karıştırmayı kapat', { op: 'shuffle', on: false }],
    ['şarkıyı tekrarla', { op: 'repeat', mode: 'one' }],
    ['listeyi tekrarla', { op: 'repeat', mode: 'all' }],
    ['tekrarı kapat', { op: 'repeat', mode: 'off' }],
    ['30 saniye ileri sar', { op: 'seek', deltaSec: 30 }],
    ['otuz saniye geri sar', { op: 'seek', deltaSec: -30 }],
    ['bir dakika ileri sar', { op: 'seek', deltaSec: 60 }],
    ['şarkıyı baştan başlat', { op: 'restart' }],
    ['tesla temasına geç', { op: 'theme', theme: 'tesla' }],
    ['temayı expedition yap', { op: 'theme', theme: 'expedition' }],
    ['sürücüyü Ayşe yap', { op: 'driver', name: 'Ayşe' }],
    ['Mehmet sürüyor', { op: 'driver', name: 'Mehmet' }],
    ['sürücü değiştir', { op: 'driver', name: null }],
  ])('"%s"', (t, want) => { expect(parseAppControl(t)).toEqual(want); });

  it.each([
    ['bu hangi şarkı', 'now_playing'], ['hangi şarkı çalıyor', 'now_playing'],
    ['varışa ne kadar kaldı', 'eta'], ['kaç km kaldı', 'remaining'],
    ['kim sürüyor', 'driver'], ['ses kaç', 'volume'],
  ])('bilgi: "%s" → %s', (t, what) => { expect(parseAppControl(t)).toEqual({ op: 'info', what }); });

  it.each(['karışık çal', 'tekrar söyle', 'ileri git', 'tesla aç', 'ben sürüyorum', 'eve götür', 'sonraki şarkı'])(
    '"%s" bu katmana ait DEĞİL', (t) => { expect(parseAppControl(t)).toBeNull(); });

  it('sürücü adı Türkçe ekle de eşleşir', () => {
    const d = [{ id: '1', name: 'Ayşe' }, { id: '2', name: 'Mehmet' }];
    expect(matchDriverName("Ayşe'ye", d)?.id).toBe('1');
    expect(matchDriverName('Mehmeti', d)?.id).toBe('2');
    expect(matchDriverName('Ahmet', d)).toBeNull();
  });
});

describe('executeAppControl — sonuçtan konuşur', () => {
  beforeEach(() => { vi.resetModules(); });

  it('kaynak karıştırmayı reddederse "yaptım" denmez', async () => {
    vi.doMock('../platform/media/authority/mediaCommandGateway', () => ({
      setShuffle: async () => ({ outcome: 'FAILED' }), setRepeat: async () => ({ outcome: 'VERIFIED' }),
    }));
    const { executeAppControl } = await import('../platform/voice/appControlExecutor');
    expect(await executeAppControl({ op: 'shuffle', on: true })).toEqual({ ok: false, text: 'Bu kaynakta karışık çalmayı değiştiremiyorum.' });
    expect((await executeAppControl({ op: 'repeat', mode: 'one' })).ok).toBe(true);
    vi.doUnmock('../platform/media/authority/mediaCommandGateway');
  });

  it('tema adıyla değişir, gündüz/gece tercihi korunur', async () => {
    const { useCarTheme } = await import('../store/useCarTheme');
    useCarTheme.getState().setTheme('expedition-day');
    const { executeAppControl } = await import('../platform/voice/appControlExecutor');
    const r = await executeAppControl({ op: 'theme', theme: 'tesla' });
    expect(r.ok).toBe(true);
    expect(useCarTheme.getState().theme).toBe('tesla-day');
  });

  it('kayıtlı olmayan sürücü için liste söylenir', async () => {
    const { useStore } = await import('../store/useStore');
    useStore.getState().updateSettings({ driverProfiles: [
      { id: 'a', name: 'Ayşe', color: '#f00', createdAt: '2026-01-01T00:00:00Z' },
    ] as never, activeDriverProfileId: null });
    const { executeAppControl } = await import('../platform/voice/appControlExecutor');
    const r = await executeAppControl({ op: 'driver', name: 'Veli' });
    expect(r).toEqual({ ok: false, text: 'Veli adında bir sürücü yok. Kayıtlı sürücüler: Ayşe.' });
  });
});
