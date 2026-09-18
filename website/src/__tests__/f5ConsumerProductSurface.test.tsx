/**
 * F5 · TÜKETİCİ ÜRÜN YÜZEYİ — ölçülen kusurların regresyon kilitleri.
 *
 * ── A · BAŞLIK CANLILIK İDDİA EDEMEZ ─────────────────────────────────────
 * `/kumanda` başlığı, araç eşleşmiş olduğu SÜRECE "Canlı Bağlantı" yazıyordu.
 * Production ölçümü (2026-09-18): 94 telemetri satırının son 24 saatte
 * güncellenmiş olanı YALNIZ 2. Yani etiket sahadaki çoğu durumda STALE'i
 * CURRENT gibi gösteriyordu.
 *
 * ── B · FİLO UYARI MOTORU TÜKETİCİ ÜRÜNÜNDE ──────────────────────────────
 * `useRealtime` hem `/kumanda` hem `/dashboard` tarafından çağrılıyor ve her
 * ikisinde de `NotificationEngine`i (90 km/s hız limiti · İstanbul geofence ·
 * motor sıcaklığı) kuruyordu. Üretilen uyarılar tüketici yüzeyinde HİÇ
 * gösterilmiyor (`notificationStore`u yalnız filo yüzeyleri okur) → yanlış
 * ürünün kuralıyla verilmiş, kimseye ulaşmayan GÜRÜLTÜ.
 *
 * ── C · ÇEVRİMDIŞI KABUK ─────────────────────────────────────────────────
 * `sw.js`te `fetch` dinleyicisi YOKTU: kurulu uygulama çevrimdışı açıldığında
 * ürün değil tarayıcının ağ hata sayfası çıkıyordu. Eklenen kabuk YALNIZ
 * tüketici gezinmesine bakar, araç verisi ÖNBELLEKLEMEZ, filo yüzeyine
 * DOKUNMAZ.
 *
 * ── D · ÇOKLU ARAÇ İZOLASYONU ────────────────────────────────────────────
 * A aracının geç gelen okuması B aracının ekranına YAZAMAZ.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { freshnessLabel } from '@/lib/fleet/vehicleTelemetryFreshness';

const PAGE = readFileSync(join(process.cwd(), 'src/app/(pwa)/kumanda/page.tsx'), 'utf8');

/* ═══ A · Başlık bağlantı etiketi ════════════════════════════════════════ */

describe('F5/A · başlık "Canlı Bağlantı" diyemez', () => {
  it('koşulsuz canlılık metni kaynaktan KALDIRILDI', () => {
    expect(PAGE).not.toContain("'Canlı Bağlantı'");
  });

  it('etiket kanonik tazelik otoritesinden okunur', () => {
    expect(PAGE).toContain('freshnessLabel(vehicle.telemetry.device)');
    /* Araç var ama telemetri okunamadıysa "canlı" DENMEZ. */
    expect(PAGE).toContain("'Durum bilinmiyor'");
  });

  it('tazelik hükümleri kullanıcıya doğru cümleye çevrilir', () => {
    expect(freshnessLabel('LIVE')).toBe('Canlı');
    expect(freshnessLabel('STALE')).toBe('Eski veri');
    expect(freshnessLabel('OFFLINE')).toBe('Araç çevrimdışı');
    expect(freshnessLabel('NEVER_SEEN')).toBe('Veri yok');
    /* Mutasyon: hiçbir bayat/çevrimdışı hüküm "Canlı"ya YÜKSELMEZ. */
    expect(freshnessLabel('STALE')).not.toBe('Canlı');
    expect(freshnessLabel('OFFLINE')).not.toBe('Canlı');
  });
});

/* ═══ B · Filo uyarı motoru ürün sınırı ══════════════════════════════════ */

const engineCtor = vi.fn();
vi.mock('@/lib/notificationEngine', () => ({
  NotificationEngine: class {
    constructor() { engineCtor(); }
    process() { return []; }
  },
}));
vi.mock('@/lib/vehicles.service', () => ({ fetchVehicles: vi.fn(async () => []) }));

async function mountRealtime(options?: { fleetAlerts?: boolean }) {
  const { useRealtime } = await import('@/hooks/useRealtime');
  function Probe() { useRealtime(options); return null; }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return async () => { await act(async () => { root.unmount(); }); host.remove(); };
}

describe('F5/B · filo uyarı kuralları tüketici ürününde çalışmaz', () => {
  beforeEach(() => {
    engineCtor.mockClear();
    localStorage.clear();
    localStorage.setItem('caros_pair_vehicle_id', 'veh-f5');
    localStorage.setItem('caros_pair_vehicle_name', 'Megane');
    localStorage.setItem('caros_pair_vehicle_plate', '34 ABC 123');
  });

  it('fleetAlerts:false iken motor HİÇ kurulmaz', async () => {
    const unmount = await mountRealtime({ fleetAlerts: false });
    expect(engineCtor).not.toHaveBeenCalled();
    await unmount();
  });

  it('filo yüzeyinin varsayılan davranışı DEĞİŞMEDİ', async () => {
    const unmount = await mountRealtime();
    expect(engineCtor).toHaveBeenCalled();
    await unmount();
  });

  it('tüketici sayfası bayrağı açıkça kapatır', () => {
    expect(PAGE).toContain('useRealtime({ fleetAlerts: false })');
  });
});

/* ═══ C · Çevrimdışı kabuk ═══════════════════════════════════════════════ */

/**
 * Gezinme isteği STUB'ıdır, gerçek `Request` DEĞİL: `new Request(url, { mode:
 * 'navigate' })` spesifikasyon gereği yasaktır (yalnız tarayıcı üretebilir).
 * SW bu nesneden yalnız `mode` · `method` · `url` okur ve olduğu gibi `fetch`e
 * verir; stub tam olarak o sözleşmeyi taşır.
 */
interface RequestLike { readonly url: string; readonly method: string; readonly mode: string }
type FetchEvent = { request: RequestLike; respondWith: (r: Promise<Response>) => void };

function loadSw(opts: { networkFails?: boolean; shellCached?: boolean } = {}) {
  const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const listeners: Record<string, (event: unknown) => void> = {};
  const cachedPuts: string[] = [];
  const networkCalls: string[] = [];

  const cachesStub = {
    open: async () => ({
      addAll: async () => undefined,
      put: async (req: RequestLike | string) => {
        cachedPuts.push(typeof req === 'string' ? req : req.url);
      },
    }),
    keys: async () => [],
    delete: async () => true,
    match: async (url: string) =>
      (opts.shellCached === false ? undefined : new Response('<offline-shell>', { status: 200 })),
  };

  const fetchStub = async (request: RequestLike) => {
    networkCalls.push(request.url);
    if (opts.networkFails) throw new TypeError('Failed to fetch');
    return new Response('<live>', { status: 200 });
  };

  const selfStub = {
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; },
    location: { origin: 'https://carospro.com' },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => null },
    registration: { showNotification: async () => undefined },
  };

  const factory = new Function('self', 'caches', 'fetch', `${source}\n;return true;`) as
    (s: unknown, c: unknown, f: unknown) => boolean;
  factory(selfStub, cachesStub, fetchStub);

  /** Gezinme olayını sürer; `null` = SW isteğe HİÇ karışmadı. */
  async function navigate(url: string, mode = 'navigate'): Promise<string | null> {
    let responded: Promise<Response> | null = null;
    const event: FetchEvent = {
      request: { url, method: 'GET', mode },
      respondWith: (r) => { responded = r; },
    };
    listeners.fetch?.(event);
    if (responded === null) return null;
    return await (await (responded as Promise<Response>)).text();
  }

  return { listeners, navigate, cachedPuts, networkCalls };
}

describe('F5/C · çevrimdışı kabuk', () => {
  it('fetch dinleyicisi artık VAR', () => {
    expect(loadSw().listeners.fetch).toBeTypeOf('function');
  });

  it('ağ düşünce tüketici gezinmesi kabuğa düşer', async () => {
    const sw = loadSw({ networkFails: true });
    expect(await sw.navigate('https://carospro.com/kumanda')).toBe('<offline-shell>');
  });

  it('ağ ayaktayken canlı yanıt DEĞİŞTİRİLMEZ ve ÖNBELLEĞE ALINMAZ', async () => {
    const sw = loadSw();
    expect(await sw.navigate('https://carospro.com/kumanda')).toBe('<live>');
    /* Araç verisi taşıyan hiçbir yanıt saklanmaz. */
    expect(sw.cachedPuts).toEqual([]);
  });

  it('ÜRÜN SINIRI: filo paneli kabuğa ALINMAZ', async () => {
    const sw = loadSw({ networkFails: true });
    expect(await sw.navigate('https://carospro.com/dashboard')).toBeNull();
    expect(await sw.navigate('https://carospro.com/dashboard/fleet')).toBeNull();
  });

  it('API/veri istekleri SW tarafından HİÇ ele alınmaz', async () => {
    const sw = loadSw({ networkFails: true });
    expect(await sw.navigate('https://carospro.com/api/pwa/command', 'cors')).toBeNull();
    expect(await sw.navigate('https://carospro.com/api/vehicles', 'no-cors')).toBeNull();
  });

  it('başka kaynağa giden gezinme ele alınmaz', async () => {
    const sw = loadSw({ networkFails: true });
    expect(await sw.navigate('https://baska-site.example/kumanda')).toBeNull();
  });

  it('kabuk yoksa sahte boş sayfa üretilmez — hata YUTULMAZ', async () => {
    const sw = loadSw({ networkFails: true, shellCached: false });
    await expect(sw.navigate('https://carospro.com/kumanda')).rejects.toThrow();
  });

  it('çevrimdışı sayfa ARAÇ VERİSİ göstermez ve bunu söyler', () => {
    const html = readFileSync(join(process.cwd(), 'public', 'offline.html'), 'utf8');
    expect(html).toContain('saklanmaz');
    expect(html).toContain('İnternet bağlantısı yok');
    /* Mutasyon: bayat ölçüm "güncel" gibi sunulmuyor. */
    expect(html).not.toContain('Canlı');
  });
});

/* ═══ D · Çoklu araç izolasyonu ══════════════════════════════════════════ */

const dtcResolvers: Array<(v: unknown) => void> = [];
vi.mock('@/lib/diagnostics/dtcResultReader', () => ({
  readLatestDtcOutcome: vi.fn((vehicleId: string) =>
    new Promise((resolve) => {
      dtcResolvers.push((outcome) => resolve(outcome));
      void vehicleId;
    })),
  readLatestVoltageOutcome: vi.fn(async () => null),
}));

describe('F5/D · A aracının geç cevabı B ekranına yazamaz', () => {
  it('araç değiştikten sonra gelen A sonucu YOK SAYILIR', async () => {
    dtcResolvers.length = 0;
    const { useVehicleHealth } = await import('@/hooks/useVehicleHealth');

    const seen: Array<string | null> = [];
    function Probe({ id }: { id: string }) {
      const { summary } = useVehicleHealth(id, undefined);
      seen.push(summary ? summary.headline : null);
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => { root.render(createElement(Probe, { id: 'A' })); });
    /* A okunurken kullanıcı B'ye geçer. */
    await act(async () => { root.render(createElement(Probe, { id: 'B' })); });

    /* A'nın cevabı ŞİMDİ geliyor — B ekranına yazılmamalı. */
    await act(async () => {
      dtcResolvers[0]?.({
        kind: 'RESULT', partial: false, readAt: new Date().toISOString(),
        completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
        dtcs: [{ code: 'P0571', severity: 'warning', system: 'Fren', desc: 'A aracının kodu' }],
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(seen.every((h) => h === null)).toBe(true);

    await act(async () => { root.unmount(); });
    host.remove();
  });
});
