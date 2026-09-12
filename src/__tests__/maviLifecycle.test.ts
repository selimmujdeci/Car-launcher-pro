/**
 * maviLifecycle.test.ts — Mavi Çekirdeği Faz-1 · Yaşam döngüsü state machine sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Tam mutlu-yol: idle→waking→listening→understanding→planning→executing→speaking→idle.
 *  2. Tanımsız (from,event) geçişi fail-closed reddedilir (durum DEĞİŞMEZ).
 *  3. Bozuk/geçersiz olay reddedilir.
 *  4. Yeni oturum (wake/listen from idle) generation + sessionId artırır; ara geçişler artırmaz.
 *  5. Stale generation damgalı olay bayat sayılıp reddedilir.
 *  6. cancel/fail her aktif durumdan geçerli; cancelled/error yalnız recover ile idle'a döner.
 *  7. start/dispose/restart idempotent.
 */
import { describe, it, expect } from 'vitest';
import {
  MaviLifecycle, createMaviLifecycle, nextState, canTransition, isRecoverable,
  type MaviState, type MaviEvent,
} from '../platform/maviCore/maviLifecycle';

describe('MaviLifecycle — mutlu yol', () => {
  it('idle→waking→listening→understanding→planning→executing→speaking→idle tam akışı', () => {
    const lc = createMaviLifecycle();
    lc.start();
    expect(lc.state).toBe('idle');
    expect(lc.dispatch('wake').to).toBe('waking');
    expect(lc.dispatch('listen').to).toBe('listening');
    expect(lc.dispatch('capture').to).toBe('understanding');
    expect(lc.dispatch('plan').to).toBe('planning');
    expect(lc.dispatch('execute').to).toBe('executing');
    expect(lc.dispatch('reply').to).toBe('speaking');
    expect(lc.dispatch('settle').to).toBe('idle');
  });

  it('takip dinlemesi: speaking→listening (follow) aynı oturumda devam eder', () => {
    const lc = createMaviLifecycle();
    lc.dispatch('listen'); // idle→listening (yeni oturum 1)
    lc.dispatch('capture');
    lc.dispatch('reply'); // understanding→speaking (sohbet cevabı)
    const gBefore = lc.generation;
    const r = lc.dispatch('follow'); // speaking→listening
    expect(r.to).toBe('listening');
    expect(lc.generation).toBe(gBefore); // follow yeni oturum ÜRETMEZ
  });

  it('sessiz sohbet: understanding→speaking→idle (aksiyon yok)', () => {
    const lc = createMaviLifecycle();
    lc.dispatch('wake');
    lc.dispatch('listen');
    lc.dispatch('capture');
    expect(lc.dispatch('reply').to).toBe('speaking');
    expect(lc.dispatch('settle').to).toBe('idle');
  });
});

describe('MaviLifecycle — fail-closed geçersiz geçişler', () => {
  it('tanımsız (from,event) reddedilir ve durumu değiştirmez', () => {
    const lc = createMaviLifecycle();
    // idle'dan capture tanımsız
    const r = lc.dispatch('capture');
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('undefined_transition');
    expect(lc.state).toBe('idle');
  });

  it('geçersiz/bozuk olay reddedilir (invalid_event)', () => {
    const lc = createMaviLifecycle();
    const r = lc.dispatch('zıpla' as unknown as MaviEvent);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('invalid_event');
    expect(lc.state).toBe('idle');
  });

  it('speaking sırasında plan tanımsız (yalnız settle/follow/cancel/fail)', () => {
    const lc = createMaviLifecycle();
    lc.dispatch('listen');
    lc.dispatch('capture');
    lc.dispatch('reply'); // →speaking
    expect(lc.dispatch('plan').accepted).toBe(false);
    expect(lc.state).toBe('speaking');
  });
});

describe('MaviLifecycle — oturum kuşağı (generation) + sessionId', () => {
  it('idle→wake yeni oturum başlatır (generation + sessionId artar)', () => {
    const lc = createMaviLifecycle();
    expect(lc.generation).toBe(0);
    expect(lc.sessionId).toBe(0);
    lc.dispatch('wake');
    expect(lc.generation).toBe(1);
    expect(lc.sessionId).toBe(1);
  });

  it('ara geçişler generation artırmaz; sonraki oturum yeniden artırır', () => {
    const lc = createMaviLifecycle();
    lc.dispatch('wake');   // gen 1
    lc.dispatch('listen'); // aynı oturum
    lc.dispatch('capture');
    lc.dispatch('settle'); // →idle (oturum bitti)
    expect(lc.generation).toBe(1);
    lc.dispatch('listen'); // yeni oturum → gen 2
    expect(lc.generation).toBe(2);
    expect(lc.sessionId).toBe(2);
  });

  it('stale generation damgalı olay bayat sayılıp reddedilir', () => {
    const lc = createMaviLifecycle();
    lc.dispatch('listen');   // gen 1, listening
    lc.dispatch('capture');  // understanding
    // Bayat plan gen 0'a aitmiş gibi gelirse reddet
    const r = lc.dispatch('plan', { expectedGeneration: 0 });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('stale_generation');
    expect(lc.state).toBe('understanding');
    // Doğru kuşakla kabul edilir
    const ok = lc.dispatch('plan', { expectedGeneration: 1 });
    expect(ok.accepted).toBe(true);
    expect(ok.to).toBe('planning');
  });
});

describe('MaviLifecycle — iptal / hata / kurtarma', () => {
  it('cancel her aktif durumdan cancelled üretir; recover ile idle', () => {
    const activeStates: Array<{ setup: (lc: MaviLifecycle) => void; state: MaviState }> = [
      { setup: (lc) => { lc.dispatch('wake'); }, state: 'waking' },
      { setup: (lc) => { lc.dispatch('listen'); }, state: 'listening' },
      { setup: (lc) => { lc.dispatch('listen'); lc.dispatch('capture'); }, state: 'understanding' },
      { setup: (lc) => { lc.dispatch('listen'); lc.dispatch('capture'); lc.dispatch('plan'); }, state: 'planning' },
      { setup: (lc) => { lc.dispatch('listen'); lc.dispatch('capture'); lc.dispatch('plan'); lc.dispatch('execute'); }, state: 'executing' },
      { setup: (lc) => { lc.dispatch('listen'); lc.dispatch('capture'); lc.dispatch('reply'); }, state: 'speaking' },
    ];
    for (const { setup, state } of activeStates) {
      const lc = createMaviLifecycle();
      setup(lc);
      expect(lc.state).toBe(state);
      expect(lc.dispatch('cancel').to).toBe('cancelled');
      expect(isRecoverable(lc.state)).toBe(true);
      expect(lc.dispatch('recover').to).toBe('idle');
    }
  });

  it('fail → error; error yalnız recover ile çıkar (settle reddedilir)', () => {
    const lc = createMaviLifecycle();
    lc.dispatch('listen');
    expect(lc.dispatch('fail').to).toBe('error');
    expect(lc.dispatch('settle').accepted).toBe(false); // error'dan settle tanımsız
    expect(lc.dispatch('recover').to).toBe('idle');
  });
});

describe('MaviLifecycle — saf yardımcılar', () => {
  it('nextState / canTransition matrisle tutarlı', () => {
    expect(nextState('idle', 'wake')).toBe('waking');
    expect(nextState('idle', 'capture')).toBeNull();
    expect(canTransition('speaking', 'follow')).toBe(true);
    expect(canTransition('speaking', 'plan')).toBe(false);
  });
});

describe('MaviLifecycle — idempotent lifecycle + gözlem', () => {
  it('start/dispose/restart tekrar çağrılınca güvenli', () => {
    const lc = createMaviLifecycle();
    lc.start();
    lc.start(); // idempotent
    lc.dispatch('wake');
    expect(lc.state).toBe('waking');
    lc.dispose();
    expect(lc.state).toBe('idle');
    expect(lc.generation).toBe(0);
    lc.dispose(); // idempotent
    lc.restart();
    expect(lc.state).toBe('idle');
  });

  it('subscribe kabul edilen geçişlerde bildirilir; kaldırılınca susar', () => {
    const lc = createMaviLifecycle();
    const seen: MaviState[] = [];
    const off = lc.subscribe((s) => seen.push(s.state));
    lc.dispatch('wake');
    lc.dispatch('capture'); // reddedilir → bildirim yok
    off();
    lc.dispatch('listen');
    expect(seen).toEqual(['waking']);
  });

  it('changedAt enjekte edilen saatten gelir (determinizm)', () => {
    let t = 1000;
    const lc = createMaviLifecycle({ now: () => t });
    t = 2500;
    lc.dispatch('wake');
    expect(lc.snapshot().changedAt).toBe(2500);
  });
});
