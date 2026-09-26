/**
 * Mavi smoke 2026-09-26 (telefon, 44 komut) — bulunan hatalar geri gelmesin.
 *  1. "ana ekrana dön" kokpit sayfasında (yolculuk/OBD/gösterge) kalıp "Ana ekrandayız" diyordu.
 *  2. "haritayı aç" haritayı kokpit sayfasının ALTINDA açıyordu (görünmüyordu).
 *  3. "radyodan Kral FM aç" → eski YouTube hatasının kurtarması radyonun adını YouTube'da arıyordu.
 *  4. Rota ön izlemesinde "kaç km kaldı / ne kadar kaldı" → "hesaplayamadım".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { navState, routeState } = vi.hoisted(() => ({
  navState: { status: 'PREVIEW', etaSeconds: undefined as number | undefined, distanceMeters: undefined as number | undefined },
  routeState: { totalDistanceMeters: 12400, totalDurationSeconds: 1260 },
}));

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

describe('ana ekrana dön kokpit sayfasını da kapatır', () => {
  it('goHomeScreenResult → requestCockpitPage("home")', async () => {
    const bus = await import('../platform/cockpitPageBus');
    const seen: string[] = [];
    bus.registerCockpitPageHandler((p) => { seen.push(p); return true; });
    const { goHomeScreenResult } = await import('../platform/intentEngine');
    goHomeScreenResult(() => undefined);
    bus.unregisterCockpitPageHandler();
    expect(seen).toEqual(['home']);
  });

  it('harita/çekmece açılınca kokpit sayfası kapanır (MainLayout)', () => {
    expect(src('components/layout/MainLayout.tsx'))
      .toMatch(/if \(fullMapOpen \|\| drawer !== 'none'\) requestCockpitPage\('home'\)/);
  });
});

describe('YouTube kurtarması başka kaynağın oturumunu değiştiremez', () => {
  it('çalan parça YouTube değilse kurtarma hiçbir şey yapmaz', () => {
    const s = src('platform/media/carosMediaLayer.ts');
    const body = s.slice(s.indexOf('async function _recoverYouTube'));
    const guard = body.indexOf("now0.providerId !== 'youtube') return;");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.indexOf('searchOnce'));
    expect(guard).toBeLessThan(body.indexOf('next();'));
  });
});

describe('rota ön izlemesinde kalan süre/mesafe', () => {
  beforeEach(() => { vi.resetModules(); });
  vi.mock('../platform/navigationService', () => ({
    NavStatus: { IDLE: 'IDLE', ERROR: 'ERROR', PREVIEW: 'PREVIEW', ACTIVE: 'ACTIVE' },
    getNavigationState: () => navState,
  }));
  vi.mock('../platform/routingService', () => ({ getRouteState: () => routeState }));

  it('ölçülen rota toplamını "rota" diye söyler — canlı kalan gibi sunmaz', async () => {
    const { executeAppControl } = await import('../platform/voice/appControlExecutor');
    const km = await executeAppControl({ op: 'info', what: 'remaining' });
    expect(km).toEqual({ ok: true, text: 'Rota 12 kilometre, yaklaşık 21 dakika. Henüz yola çıkılmadı.' });
    const eta = await executeAppControl({ op: 'info', what: 'eta' });
    expect(eta.ok).toBe(true);
  });

  it('rota toplamı yoksa uydurmaz', async () => {
    routeState.totalDistanceMeters = 0;
    const { executeAppControl } = await import('../platform/voice/appControlExecutor');
    const r = await executeAppControl({ op: 'info', what: 'remaining' });
    expect(r.ok).toBe(false);
    routeState.totalDistanceMeters = 12400;
  });
});

describe('"bu hangi şarkı" radyo çalarken', () => {
  it('kaynak unknown ama çalıyorsa adı söylenir; duraklatılmış unknown → yok', () => {
    const s = src('platform/voice/appControlExecutor.ts');
    expect(s).toContain("(m.source === 'unknown' && !m.playing)");
  });
});

describe('ses göstergesi görünür', () => {
  it('varsayılan rakamlı kart; eski 6px çizgi v19 göçünde değişir', () => {
    const s = src('store/useStore.ts');
    expect(s).toContain("volumeStyle: 'tesla_ultra',");
    expect(s).toContain("if (settings.volumeStyle === 'minimal_pro') settings.volumeStyle = 'tesla_ultra';");
  });
});
