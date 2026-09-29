/**
 * Canlı yakıt fiyatı istemcisi — canlı > APK tablosu, ağ yokken son canlı fiyat,
 * bozuk/fiyatsız cevap, 14 gün bayatlık (mevcut `resolveFuelCategory` mantığı), il seçimi.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../platform/gpsService', () => ({ getGPSState: () => ({ location: null, source: null }) }));

import {
  createLiveFuelPriceClient,
  LIVE_FUEL_STORAGE_KEY,
  LIVE_REFRESH_INTERVAL_MS,
  LIVE_RETRY_AFTER_FAILURE_MS,
  type LiveFuelDeps,
} from '../platform/trip/cost/liveFuelPrice';
import { parseFuelPricePack, resolveFuelCategory } from '../platform/trip/cost/fuelPricePack';
import { nearestProvince } from '../platform/trip/cost/data/trProvinceCenters';

/** carospro.com/api/fuel-prices?il=Ankara gerçek biçimi (EPDK, 2026-09-29 ölçümü). */
const LIVE_ANKARA = {
  schema: 1,
  currency: 'TRY',
  source: 'EPDK İllere Göre Akaryakıt Bayi Fiyatları (sorguNo 72) — Ankara, marka medyanı',
  observedOn: '2026-09-24',
  province: 'Ankara',
  pricePerLiter: { petrol: 81.4, diesel: 94.55 },
};
const BUNDLED = parseFuelPricePack({
  schema: 1, currency: 'TRY', source: 'APK tablosu (test)', observedOn: '2026-09-20',
  pricePerLiter: { petrol: 80.4, diesel: 93.5 },
})!;

const T0 = Date.UTC(2026, 8, 29, 9);

function setup(responses: Array<() => Response | Promise<Response>>, initialStore: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialStore));
  let t = T0;
  const fetchFn = vi.fn<LiveFuelDeps['fetchFn']>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('beklenmeyen istek');
    return next();
  });
  const client = createLiveFuelPriceClient({
    fetchFn,
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => { store.set(k, v); } },
    now: () => t,
    url: 'https://example.test/api/fuel-prices',
  });
  return { client, fetchFn, store, advance: (ms: number) => { t += ms; } };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

describe('canlı yakıt fiyatı istemcisi', () => {
  it('canlı fiyat APK tablosunun önüne geçer ve il parametresiyle istenir', async () => {
    const { client, fetchFn } = setup([json(LIVE_ANKARA)]);
    expect(client.getEffectivePack(BUNDLED)).toBe(BUNDLED);
    expect(await client.refresh('Ankara')).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe('https://example.test/api/fuel-prices?il=Ankara');
    const eff = client.getEffectivePack(BUNDLED)!;
    expect(eff.pricePerLiter).toEqual({ petrol: 81.4, diesel: 94.55 });
    expect(eff.observedOn).toBe('2026-09-24');
    expect(eff.source).toContain('EPDK');
  });

  it('APK tablosu canlı kayıttan daha yeni günlüyse tablo kullanılır', async () => {
    const { client } = setup([json({ ...LIVE_ANKARA, observedOn: '2026-09-01' })]);
    await client.refresh('Ankara');
    expect(client.getEffectivePack(BUNDLED)).toBe(BUNDLED);
  });

  it('ağ yokken son canlı fiyat depodan okunur (yeni oturum)', async () => {
    const first = setup([json(LIVE_ANKARA)]);
    await first.client.refresh('Ankara');
    const saved = first.store.get(LIVE_FUEL_STORAGE_KEY)!;

    const offline = setup([() => { throw new TypeError('Failed to fetch'); }], { [LIVE_FUEL_STORAGE_KEY]: saved });
    expect(await offline.client.refresh('Ankara')).toBe(false);
    expect(offline.client.getEffectivePack(BUNDLED)!.pricePerLiter.diesel).toBe(94.55);
  });

  it('fiyatsız (null) ya da bozuk cevap önceki iyi kaydı silmez, 0 yazılmaz', async () => {
    const { client, store } = setup([
      json(LIVE_ANKARA),
      json({ ...LIVE_ANKARA, observedOn: null, pricePerLiter: { petrol: null, diesel: null } }, 503),
      json({ ...LIVE_ANKARA, pricePerLiter: { petrol: 0, diesel: null } }),
      () => new Response('<html>hata</html>', { status: 200 }),
    ]);
    await client.refresh('Ankara');
    const saved = store.get(LIVE_FUEL_STORAGE_KEY);
    for (let i = 0; i < 3; i++) expect(await client.refresh('Ankara')).toBe(false);
    expect(store.get(LIVE_FUEL_STORAGE_KEY)).toBe(saved);
    expect(client.getLivePack()!.pricePerLiter).toEqual({ petrol: 81.4, diesel: 94.55 });
  });

  it('eksik il (400) → canlı fiyat yok, APK tablosu kalır', async () => {
    const { client } = setup([json({
      schema: 1, currency: 'TRY', source: 'EPDK — il bilinmiyor', observedOn: null, province: null,
      pricePerLiter: { petrol: null, diesel: null }, error: 'il parametresi eksik',
    }, 400)]);
    expect(await client.refresh('')).toBe(false);
    expect(client.getEffectivePack(BUNDLED)).toBe(BUNDLED);
  });

  it('bozuk depo kaydı yok sayılır', () => {
    const { client } = setup([], { [LIVE_FUEL_STORAGE_KEY]: '{bozuk' });
    expect(client.getLivePack()).toBeNull();
  });

  it('14 günü geçen canlı fiyat BAYAT işaretlenir (mevcut mantık)', async () => {
    const { client } = setup([json(LIVE_ANKARA)]);
    await client.refresh('Ankara');
    const pack = client.getEffectivePack(null);
    const at = (iso: string) => resolveFuelCategory({
      vehicleType: 'diesel', pack, nowMs: Date.parse(iso), reportCurrency: 'TRY',
    });
    expect(at('2026-10-08T12:00:00Z').priceState).toBe('OK');     // 14 gün
    expect(at('2026-10-09T12:00:00Z').priceState).toBe('STALE');  // 15 gün
    expect(at('2026-10-09T12:00:00Z').input.pricePerLiter).toBe(94.55);
  });

  it('yenileme zamanlaması: 6 saat, il değişimi, hatadan sonra 30 dk bekleme', async () => {
    const { client, advance } = setup([json(LIVE_ANKARA), () => { throw new Error('ağ yok'); }]);
    expect(client.shouldRefresh('Ankara')).toBe(true);
    await client.refresh('Ankara');
    expect(client.shouldRefresh('Ankara')).toBe(false);
    expect(client.shouldRefresh('Konya')).toBe(true);
    advance(LIVE_REFRESH_INTERVAL_MS);
    expect(client.shouldRefresh('Ankara')).toBe(true);
    await client.refresh('Ankara'); // başarısız
    expect(client.shouldRefresh('Ankara')).toBe(false);
    advance(LIVE_RETRY_AFTER_FAILURE_MS);
    expect(client.shouldRefresh('Ankara')).toBe(true);
  });
});

describe('konumdan il', () => {
  it('il merkezlerine yakın noktalar', () => {
    expect(nearestProvince(39.92, 32.85)).toBe('Ankara');
    expect(nearestProvince(37.0, 35.3)).toBe('Adana');
    expect(nearestProvince(41.04, 29.0)).toBe('İstanbul');
    expect(nearestProvince(38.42, 27.13)).toBe('İzmir');
  });

  it('Türkiye dışı / geçersiz konum → null', () => {
    expect(nearestProvince(48.85, 2.35)).toBeNull();
    expect(nearestProvince(NaN, 30)).toBeNull();
  });
});
