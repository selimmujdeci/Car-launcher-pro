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
    readCurrentLocation: vi.fn(() => ({ ok: true, text: 'Şu anda Bağlar Mahallesi civarındasınız.' })),
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
    readCurrentLocation: spies.readCurrentLocation as never,
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
  /* KİLİT GÜNCELLENDİ (#123): gölgede `ok:true` kuralı phone.* İÇİN GEÇERSİZ.
     Diğer eylemlerde gölge no-op zararsızdır (gerçek işi ESKİ HAT yapar), ama
     telefonda eski hat da yoktur → `ok:true` "arama yapıldı" demek olurdu.
     Kilit kaldırılmadı, doğru davranışa daraltıldı. */
  it('phone.* DIŞINDAKİ pilot eylemler ok döner, hiçbir servis portu yok', async () => {
    const shadow = createShadowHandlers();
    for (const id of Object.keys(shadow)) {
      if (id.startsWith('phone.')) continue;
      const r = await shadow[id]({}, noopSignal);
      expect(r.ok).toBe(true);
    }
    expect((await shadow['vehicle.health.read']({}, noopSignal)).value).toMatchObject({ dtcCount: 0 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PHONE HUB handler'ları (#123) — SAHTE BAŞARI YASAK
 *
 * Repoda telefona komut iletecek RFCOMM komut kanalı YOKTUR (`PhoneHubLink`
 * yalnız oturum/eşleştirme yönetir). Bu yüzden handler'lar dürüstçe reddeder;
 * hiçbir koşulda "arama yapıldı" anlamına gelen ok:true DÖNMEZ.
 * ════════════════════════════════════════════════════════════════════════ */

describe('phone.* handler\'ları — fail-soft dürüst reddetme', () => {
  const PHONE_IDS = ['phone.media.play', 'phone.call.start', 'phone.sms.draft'] as const;

  it('port BAĞLI DEĞİLKEN phone.call.start → ok:false PHONE_NOT_CONNECTED', async () => {
    const { deps } = makeDeps();                       // isPhoneLinkReady VERİLMEDİ
    const h = createPilotHandlers(deps);
    const r = await h['phone.call.start']({ contactName: 'Ayşe' }, noopSignal);

    expect(r.ok).toBe(false);
    expect(r.error).toBe('PHONE_NOT_CONNECTED');
    expect(r.value).toBeUndefined();                   // sahte sonuç taşınmaz
  });

  it('port YOKSA / patlarsa üç eylem de fail-closed reddeder (throw ETMEZ)', async () => {
    const boom = createPilotHandlers(makeDeps({
      isPhoneLinkReady: () => { throw new Error('link boom'); },
    }).deps);
    for (const id of PHONE_IDS) {
      const r = await boom[id]({}, noopSignal);
      expect(r.ok, `${id} sahte başarı DÖNMEMELİ`).toBe(false);
      expect(r.error).toBe('PHONE_NOT_CONNECTED');
    }
  });

  /* KİLİT: "oturum bağlı" bilgisi TEK BAŞINA aramayı yaptırmaz — komut kanalı
     hâlâ yok. ok:true dönmek yapılmamış aramayı yapılmış göstermek olurdu. */
  it('oturum BAĞLI görünse bile komut kanalı yoksa yine ok:false (gerekçe ayrışır)', async () => {
    const h = createPilotHandlers(makeDeps({ isPhoneLinkReady: () => true }).deps);
    const r = await h['phone.call.start']({ contactName: 'Ayşe' }, noopSignal);

    expect(r.ok).toBe(false);
    expect(r.error).toContain('PHONE_TRANSPORT_MISSING');
    expect(r.error).toContain('phone.call.start');     // hangi eylem olduğu izlenebilir
  });

  it('phone.* handler\'ları HİÇBİR araç/medya/nav portuna DOKUNMAZ', async () => {
    const { deps, spies } = makeDeps({ isPhoneLinkReady: () => true });
    const h = createPilotHandlers(deps);
    for (const id of PHONE_IDS) await h[id]({}, noopSignal);

    for (const [name, spy] of Object.entries(spies)) {
      expect(spy, `phone.* '${name}' portunu ÇAĞIRMAMALI`).not.toHaveBeenCalled();
    }
  });

  it('GÖLGE modda da ok:true DÖNMEZ (telefonda eski hat da yok)', async () => {
    const shadow = createShadowHandlers();
    for (const id of PHONE_IDS) {
      const r = await shadow[id]({}, noopSignal);
      expect(r.ok, `${id} gölgede bile sahte başarı DÖNMEMELİ`).toBe(false);
      expect(r.error).toBe('PHONE_NOT_CONNECTED');
    }
  });
});
