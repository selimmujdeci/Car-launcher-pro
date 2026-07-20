/**
 * maviPilotHandlers.test.ts — Mavi Çekirdeği Faz-2 · Pilot eylem handler'ları sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Her handler yalnız KENDİ resmi servis portunu çağırır (mock DI).
 *  2. vehicle.health.read salt-okuma değer döner; hiçbir yazma portu YOK.
 *  3. Servis throw → ok:false (yapılmış gibi cevap verme).
 *  4. reversible eylemler rollback döndürür (tema/ses geri yükleme, nav iptali); tek-yön vermez.
 *  5. navigation.open: hedef varsa navigateTo, yoksa ekran; bulunamazsa dürüst hata.
 *  6. Shadow handler'lar gerçek servisi ÇAĞIRMAZ (ok döner).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPilotHandlers, createShadowHandlers, type PilotHandlerDeps,
} from '../platform/maviCore/wiring/maviPilotHandlers';

const noopSignal = new AbortController().signal;

function makeDeps(over: Partial<PilotHandlerDeps> = {}): { deps: PilotHandlerDeps; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    setTheme: vi.fn(), openScreen: vi.fn(() => true),
    mediaPlay: vi.fn(), mediaPause: vi.fn(), mediaNext: vi.fn(),
    setVolume: vi.fn(), navigateTo: vi.fn(), openNavScreen: vi.fn(() => true),
    cancelNavigation: vi.fn(),
    readHealth: vi.fn(() => ({ dtcCount: 2, criticalCount: 1, summary: 'iki kod' })),
  };
  const deps: PilotHandlerDeps = {
    setTheme: spies.setTheme as never,
    getThemeMode: () => 'day',
    openScreen: spies.openScreen as never,
    mediaPlay: spies.mediaPlay as never,
    mediaPause: spies.mediaPause as never,
    mediaNext: spies.mediaNext as never,
    setVolume: spies.setVolume as never,
    getVolume: () => 40,
    navigateTo: spies.navigateTo as never,
    openNavScreen: spies.openNavScreen as never,
    cancelNavigation: spies.cancelNavigation as never,
    readHealth: spies.readHealth as never,
    ...over,
  };
  return { deps, spies };
}

describe('createPilotHandlers — resmi servis çağrıları', () => {
  it('ui.theme.set gerçek setTheme çağırır + rollback önceki modu geri yükler', async () => {
    const { deps, spies } = makeDeps();
    const h = createPilotHandlers(deps);
    const r = await h['ui.theme.set']({ theme: 'night' }, noopSignal);
    expect(r.ok).toBe(true);
    expect(spies.setTheme).toHaveBeenCalledWith('night');
    // rollback → getThemeMode()'un döndürdüğü 'day'
    await r.rollback!();
    expect(spies.setTheme).toHaveBeenLastCalledWith('day');
  });

  it('ui.theme.set geçersiz tema → ok:false', async () => {
    const { deps } = makeDeps();
    const r = await createPilotHandlers(deps)['ui.theme.set']({ theme: 'mor' as never }, noopSignal);
    expect(r.ok).toBe(false);
  });

  it('ui.page.open ekran bulunamazsa dürüst hata', async () => {
    const { deps } = makeDeps({ openScreen: () => false });
    const r = await createPilotHandlers(deps)['ui.page.open']({ page: 'yok' }, noopSignal);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bulunamadı/);
  });

  it('media.play/pause/next resmi portları çağırır; play/pause reversible', async () => {
    const { deps, spies } = makeDeps();
    const h = createPilotHandlers(deps);
    const play = await h['media.play']({}, noopSignal);
    expect(spies.mediaPlay).toHaveBeenCalledOnce();
    expect(typeof play.rollback).toBe('function');
    await h['media.next']({}, noopSignal);
    expect(spies.mediaNext).toHaveBeenCalledOnce();
    const next = await h['media.next']({}, noopSignal);
    expect(next.rollback).toBeUndefined(); // tek-yön
  });

  it('media.volume.set aralık dışı → ok:false; geçerli → setVolume + rollback', async () => {
    const { deps, spies } = makeDeps();
    const h = createPilotHandlers(deps);
    expect((await h['media.volume.set']({ value: 150 }, noopSignal)).ok).toBe(false);
    const r = await h['media.volume.set']({ value: 70 }, noopSignal);
    expect(spies.setVolume).toHaveBeenCalledWith(70);
    await r.rollback!();
    expect(spies.setVolume).toHaveBeenLastCalledWith(40); // getVolume() önceki
  });

  it('navigation.open hedefle navigateTo + rollback=cancel; hedefsiz ekran açar', async () => {
    const { deps, spies } = makeDeps();
    const h = createPilotHandlers(deps);
    const withDest = await h['navigation.open']({ destination: 'ev' }, noopSignal);
    expect(spies.navigateTo).toHaveBeenCalledWith('ev');
    await withDest.rollback!();
    expect(spies.cancelNavigation).toHaveBeenCalledOnce();

    const noDest = await h['navigation.open']({}, noopSignal);
    expect(spies.openNavScreen).toHaveBeenCalledOnce();
    expect(noDest.ok).toBe(true);
  });

  it('navigation.cancel stopNavigation portunu çağırır (tek-yön)', async () => {
    const { deps, spies } = makeDeps();
    const r = await createPilotHandlers(deps)['navigation.cancel']({}, noopSignal);
    expect(spies.cancelNavigation).toHaveBeenCalledOnce();
    expect(r.rollback).toBeUndefined();
  });

  it('vehicle.health.read salt-okuma değer döner (yazma portu YOK)', async () => {
    const { deps, spies } = makeDeps();
    const r = await createPilotHandlers(deps)['vehicle.health.read']({}, noopSignal);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ dtcCount: 2, criticalCount: 1, summary: 'iki kod' });
    expect(r.rollback).toBeUndefined();
    expect(spies.readHealth).toHaveBeenCalledOnce();
  });

  it('servis throw → ok:false (yapılmış gibi cevap verme)', async () => {
    const { deps } = makeDeps({ setTheme: () => { throw new Error('motor yok'); } });
    const r = await createPilotHandlers(deps)['ui.theme.set']({ theme: 'oled' }, noopSignal);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/motor yok/);
  });
});

describe('createShadowHandlers — gölge (gerçek servis çağrısı YOK)', () => {
  it('tüm pilot eylemler ok döner, hiçbir servis portu yok', async () => {
    const shadow = createShadowHandlers();
    for (const id of Object.keys(shadow)) {
      const r = await shadow[id]({}, noopSignal);
      expect(r.ok).toBe(true);
    }
    expect((await shadow['vehicle.health.read']({}, noopSignal)).value).toMatchObject({ dtcCount: 0 });
  });
});
