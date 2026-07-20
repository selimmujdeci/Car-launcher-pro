/**
 * maviContextStore.test.ts — Mavi Çekirdeği Faz-1 · Kısa-süreli bağlam deposu sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Bounded: konuşma turları maxTurns tavanını aşmaz (en eski düşer).
 *  2. Duplicate suppression: ardışık birebir aynı tur bastırılır.
 *  3. Referans çözümleme: screen/destination/media/lastAction; çözülemezse undefined (sahte yok).
 *  4. Decoupled beslemeler: medya/nav snapshot bozuk girdide güvenli varsayıma düşer.
 *  5. start/dispose/restart/clear idempotent; persist YOK (dispose temizler).
 */
import { describe, it, expect } from 'vitest';
import { createMaviContextStore } from '../platform/maviCore/contextStore';

describe('MaviContextStore — bounded konuşma turları', () => {
  it('maxTurns aşılınca en eski tur düşer', () => {
    const cs = createMaviContextStore({ maxTurns: 3 });
    cs.pushTurn({ role: 'user', intentId: 'a' });
    cs.pushTurn({ role: 'assistant', intentId: 'b' });
    cs.pushTurn({ role: 'user', intentId: 'c' });
    cs.pushTurn({ role: 'assistant', intentId: 'd' });
    expect(cs.turnCount).toBe(3);
    expect(cs.snapshot().turns.map((t) => t.intentId)).toEqual(['b', 'c', 'd']);
  });

  it('ardışık birebir aynı tur bastırılır (duplicate suppression)', () => {
    const cs = createMaviContextStore();
    cs.pushTurn({ role: 'user', intentId: 'ui.theme.set' });
    cs.pushTurn({ role: 'user', intentId: 'ui.theme.set' }); // ardışık tekrar → bastırılır
    expect(cs.turnCount).toBe(1);
    cs.pushTurn({ role: 'assistant', intentId: 'ui.theme.set' }); // farklı rol → eklenir
    expect(cs.turnCount).toBe(2);
  });

  it('geçersiz rol eklenmez', () => {
    const cs = createMaviContextStore();
    cs.pushTurn({ role: 'sistem' as never });
    expect(cs.turnCount).toBe(0);
  });

  it('turn zaman damgası enjekte edilen saatten gelir', () => {
    let t = 42;
    const cs = createMaviContextStore({ now: () => t });
    t = 999;
    cs.pushTurn({ role: 'user', intentId: 'x' });
    expect(cs.snapshot().turns[0].at).toBe(999);
  });
});

describe('MaviContextStore — referans çözümleme', () => {
  it('screen: son ekran; yoksa undefined', () => {
    const cs = createMaviContextStore();
    expect(cs.resolveReference('screen')).toBeUndefined();
    cs.setLastScreen('trafik');
    expect(cs.resolveReference('screen')).toBe('trafik');
  });

  it('destination: yalnız aktif navigasyonda çözülür', () => {
    const cs = createMaviContextStore();
    cs.updateNav({ active: false, destination: 'ev' });
    expect(cs.resolveReference('destination')).toBeUndefined(); // aktif değil
    cs.updateNav({ active: true, destination: 'iş' });
    expect(cs.resolveReference('destination')).toBe('iş');
  });

  it('media: çalan başlık; lastAction: son eylem', () => {
    const cs = createMaviContextStore();
    cs.updateMedia({ playing: true, title: 'Yol Şarkısı', source: 'youtube' });
    expect(cs.resolveReference('media')).toBe('Yol Şarkısı');
    cs.setLastAction('media.play');
    expect(cs.resolveReference('lastAction')).toBe('media.play');
  });
});

describe('MaviContextStore — decoupled beslemeler (fail-soft)', () => {
  it('bozuk medya/nav girdisi güvenli varsayıma düşer', () => {
    const cs = createMaviContextStore();
    cs.updateMedia(null);
    cs.updateNav(undefined);
    const s = cs.snapshot();
    expect(s.media.playing).toBe(false);
    expect(s.nav.active).toBe(false);
  });

  it('boş title/destination normalize edilir (undefined)', () => {
    const cs = createMaviContextStore();
    cs.updateMedia({ playing: true, title: '' });
    expect(cs.snapshot().media.title).toBeUndefined();
    cs.setLastScreen('   ');
    expect(cs.snapshot().lastScreen).toBeUndefined();
  });

  it('snapshot dondurulmuş (mutasyona kapalı)', () => {
    const cs = createMaviContextStore();
    cs.pushTurn({ role: 'user', intentId: 'a' });
    const s = cs.snapshot();
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.turns)).toBe(true);
  });
});

describe('MaviContextStore — idempotent lifecycle', () => {
  it('dispose bağlamı temizler; persist yok', () => {
    const cs = createMaviContextStore();
    cs.setLastIntent('nav.open');
    cs.pushTurn({ role: 'user', intentId: 'x' });
    cs.dispose();
    expect(cs.turnCount).toBe(0);
    expect(cs.snapshot().lastIntentId).toBeUndefined();
    cs.dispose(); // idempotent
    cs.restart();
    expect(cs.snapshot().media.playing).toBe(false);
  });
});
