/**
 * Harici rota kalıcılığı — telefonda ölçüldü (2026-09-30): rota yalnız
 * bellekteydi; uygulama kapanıp açılınca Yandex'te rota sürerken yüzen
 * pencere GELMİYORDU.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseStoredExternalRoute, EXTERNAL_ROUTE_MAX_AGE_MS, type ExternalRoute,
} from '../platform/navigation/externalRouteState';

const KEY = 'caros-external-route';
const NOW = 1_000_000_000_000;
const R: ExternalRoute = {
  provider: 'yandex', packageName: 'ru.yandex.yandexnavi', destName: 'Mersin', lat: 36.8, lng: 34.6, startedAtMs: NOW - 60_000,
};

afterEach(() => { localStorage.removeItem(KEY); vi.resetModules(); });

describe('parseStoredExternalRoute (saf doğrulama)', () => {
  it('geçerli kayıt geri döner', () => {
    expect(parseStoredExternalRoute(JSON.stringify(R), NOW)).toEqual(R);
  });
  it('bozuk / eksik / geçersiz kayıt YÜKLENMEZ', () => {
    expect(parseStoredExternalRoute(null, NOW)).toBeNull();
    expect(parseStoredExternalRoute('{bozuk', NOW)).toBeNull();
    expect(parseStoredExternalRoute(JSON.stringify({ ...R, provider: 'here' }), NOW)).toBeNull();
    expect(parseStoredExternalRoute(JSON.stringify({ ...R, lat: 91 }), NOW)).toBeNull();
    expect(parseStoredExternalRoute(JSON.stringify({ ...R, destName: 5 }), NOW)).toBeNull();
  });
  it('azami ömrü aşmış ya da gelecekten gelen kayıt YÜKLENMEZ (bayat pencere yok)', () => {
    expect(parseStoredExternalRoute(JSON.stringify({ ...R, startedAtMs: NOW - EXTERNAL_ROUTE_MAX_AGE_MS - 1 }), NOW)).toBeNull();
    expect(parseStoredExternalRoute(JSON.stringify({ ...R, startedAtMs: NOW + 1000 }), NOW)).toBeNull();
  });
});

describe('uygulama yeniden açılınca', () => {
  it('kaydedilen rota modül yeniden yüklenince geri gelir; × sonrası gelmez', async () => {
    const a = await import('../platform/navigation/externalRouteState');
    a.setExternalRoute({ ...R, startedAtMs: Date.now() });
    expect(localStorage.getItem(KEY)).not.toBeNull();

    vi.resetModules();
    const b = await import('../platform/navigation/externalRouteState');
    expect(b.getExternalRoute()?.destName).toBe('Mersin');

    b.clearExternalRoute();
    expect(localStorage.getItem(KEY)).toBeNull();
    vi.resetModules();
    const c = await import('../platform/navigation/externalRouteState');
    expect(c.getExternalRoute()).toBeNull();
  });
});
