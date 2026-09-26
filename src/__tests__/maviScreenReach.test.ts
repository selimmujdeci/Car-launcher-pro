/**
 * Mavi uygulamanın HER ekranına ulaşır (saha 2026-09-26: kokpit sayfaları ve
 * ayar sekmelerinin çoğu sesle açılamıyordu; "yolculuk bilgisayarını göster"
 * adrese navigasyon sanılıyordu).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchScreenCommand, SCREEN_CATALOG } from '../platform/screenCatalog';
import { getScreenById } from '../platform/screenRegistry';
import { registerCockpitPageHandler, unregisterCockpitPageHandler } from '../platform/cockpitPageBus';
import { routeIntent, type AppIntent, type RouterContext } from '../platform/intentEngine';

const ctx = { launch: () => {}, openDrawer: () => {}, setTheme: () => {}, playMedia: () => {}, pauseMedia: () => {} } as unknown as RouterContext;
const open = (screen: string, screenAction = 'open') =>
  routeIntent({ type: 'OPEN_SCREEN', payload: { screen, screenAction } } as AppIntent, ctx);

describe('ekran kestirmesi', () => {
  it.each([
    ['yolculuk bilgisayarını göster', 'trip-computer'],
    ['obd ekranını aç', 'obd-live'],
    ['kokpiti aç', 'cockpit'],
    ['ses ayarlarını aç', 'settings-sound'],
    ['sürücü profillerini aç', 'settings-profiles'],
    ['klimayı aç', 'climate'],
    ['arıza kodlarını göster', 'dtc'],
  ])('"%s" → %s', (t, id) => { expect(matchScreenCommand(t)?.id).toBe(id); });

  it('kapat fiili kapama niyetidir', () => {
    expect(matchScreenCommand('trafik panelini kapat')).toEqual({ id: 'traffic', action: 'close' });
  });

  it('tam eşleşme değilse beyne bırakılır', () => {
    expect(matchScreenCommand('yolculuk bilgisayarında bugün kaç km var')).toBeNull();
    expect(matchScreenCommand('haritayı aç')).toBeNull();
  });

  it('katalogdaki her ekranın açma davranışı bağlı', () => {
    for (const c of SCREEN_CATALOG) expect(getScreenById(c.id), c.id).not.toBeNull();
  });
});

describe('kokpit sayfası — sahip reddederse "açıldı" denmez', () => {
  beforeEach(() => unregisterCockpitPageHandler());

  it('sahip kabul ederse açıldı', async () => {
    const h = vi.fn(() => true);
    registerCockpitPageHandler(h);
    const r = await open('trip-computer');
    expect(h).toHaveBeenCalledWith('trip');
    expect(r.status).toBe('succeeded');
  });

  it('geri vites vb. ile reddedilirse dürüst başarısızlık', async () => {
    registerCockpitPageHandler(() => false);
    const r = await open('trip-computer');
    expect(r.status).toBe('failed');
    expect(r.detail).toMatch(/şu an açılamıyor/);
  });
});
