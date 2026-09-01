/**
 * globalAddressScope.test.ts — P0-NAV-07 KAPSAM AYRIMI KİLİTLERİ.
 *
 * TEK CÜMLELİK SÖZLEŞME:
 *   **"En yakın X" YEREL kalır; hedef ADRES kullanıcının çevresine hapsedilmez.**
 *
 * ÖLÇÜLEN KUSUR (2026-08-23, Tarsus 36.9175/34.8621):
 *   `"Kuvayimilliye Caddesi"` → kullanıcı çevresi 20 km'de **0 sonuç**; doğru
 *   cadde 24,6 km'de duruyordu ve `searchStreetByName` oraya HİÇ bakmıyordu.
 *   `"Bağlar Mahallesi"` → viewbox yanlılığı yüzünden Nominatim **1 sonuç**
 *   döndürüyordu; aynı adlı 4 mahalle (200/370/393/405 km) listeye GİRMİYORDU.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  searchStreetByName, extractStreetQuery,
  WIDE_RADIUS_M, ANCHOR_RADIUS_M, STREET_ATTEMPT_TIMEOUT_MS, STREET_SEARCH_BUDGET_MS,
} from '../platform/streetSearchService';
import {
  resolveCityAnchor, _resetCityAnchorCacheForTest, readCityAnchorCacheSize,
} from '../platform/geo/cityAnchor';
import {
  awaitNominatimSlot, _resetNominatimRateLimitForTest,
  readNominatimSlotDelayMs, NOMINATIM_GAP_MS,
} from '../platform/geo/nominatimRateLimit';
import { detectPlaceIntent } from '../platform/geo/placeQueryModel';
import { detectCitiesInQuery } from '../platform/geo/locationBiasGate';
import { stripComments } from './helpers';

const ME = { lat: 36.9175, lng: 34.8621 };

/** Overpass yanıtı üreten yardımcı. */
function overpassBody(ways: Array<{ id: number; name: string; lat: number; lon: number }>): string {
  return JSON.stringify({
    elements: ways.map((w) => ({
      id: w.id, tags: { name: w.name, highway: 'residential' }, center: { lat: w.lat, lon: w.lon },
    })),
  });
}

/** Bir istek gövdesinden `around:<yarıçap>,<lat>,<lng>` üçlüsünü okur. */
function readAround(init: unknown): { r: number; lat: number; lng: number } | null {
  const body = String((init as { body?: string } | undefined)?.body ?? '');
  const m = /around:(\d+),([\d.-]+),([\d.-]+)/.exec(decodeURIComponent(body));
  return m ? { r: Number(m[1]), lat: Number(m[2]), lng: Number(m[3]) } : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   A) SÖZLEŞME SABİTLERİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-07 › kapsam sabitleri', () => {
  it('🔒 genişletilmiş yarıçap ÖLÇÜLEN değerdir ve tavanı vardır', () => {
    /* 100 km denendi → halka açık sunucuda 429/504. 60 km ölçümde 1264/2302/
       3249 ms'de döndü ve 24,6 km'deki hedefi buldu. */
    expect(WIDE_RADIUS_M).toBe(60_000);
    expect(WIDE_RADIUS_M).toBeLessThanOrEqual(60_000);   // kör büyütme yasağı
    expect(ANCHOR_RADIUS_M).toBe(20_000);
  });

  it('🔒 deneme başına tavan VAR ve bütçeyi tek başına yiyemez', () => {
    /* Ölçülen tasarım hatası: yalnız ORTAK bütçe varken yavaş bir deneme
       (8679 ms) genişletmeyi AÇ BIRAKIYORDU. */
    expect(STREET_ATTEMPT_TIMEOUT_MS).toBeLessThan(STREET_SEARCH_BUDGET_MS);
    expect(STREET_SEARCH_BUDGET_MS / STREET_ATTEMPT_TIMEOUT_MS).toBeGreaterThanOrEqual(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B) SOKAK ARAMASI — çapa · genişletme · merkez sırası
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-07 › searchStreetByName kapsamı', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('🔒 ÇAPA verilirse arama ORADA yapılır (kullanıcı konumu ŞART DEĞİL)', async () => {
    const seen: Array<{ r: number; lat: number; lng: number }> = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init: unknown) => {
      const a = readAround(init); if (a) seen.push(a);
      return new Response(overpassBody([
        { id: 1, name: 'Kuvayi Milliye Caddesi', lat: 36.8031, lon: 34.6254 },
      ]), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await searchStreetByName('Mersin Kuvayimilliye Caddesi', undefined, undefined, {
      anchor: { lat: 36.7978, lng: 34.6298 },
    });
    expect(out.map((o) => o.name)).toEqual(['Kuvayi Milliye Caddesi']);
    expect(seen.length).toBe(1);
    expect(seen[0].r).toBe(ANCHOR_RADIUS_M);
    expect(seen[0].lat).toBeCloseTo(36.7978, 3);      // ÇAPA merkezi, kullanıcı DEĞİL
  });

  it('🔒 çapa da kullanıcı konumu da yoksa ağa HİÇ çıkılmaz', async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await searchStreetByName('Kuvayimilliye Caddesi')).toEqual([]);
    expect(await searchStreetByName('Kuvayimilliye Caddesi', NaN, NaN)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('🔒 yakın çevre BOŞ dönerse genişletilmiş yarıçap denenir', async () => {
    const seen: number[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init: unknown) => {
      const a = readAround(init); if (a) seen.push(a.r);
      const body = seen.length === 1
        ? overpassBody([])                                   // 20 km → yok
        : overpassBody([{ id: 2, name: 'Kuvayi Milliye Caddesi', lat: 36.8031, lon: 34.6254 }]);
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const out = await searchStreetByName('Kuvayimilliye Caddesi', ME.lat, ME.lng, {
      allowWideRadius: true,
    });
    expect(seen).toEqual([20_000, WIDE_RADIUS_M]);
    expect(out.map((o) => o.name)).toEqual(['Kuvayi Milliye Caddesi']);
  });

  it('🔒 genişletme İZİN VERİLMEDİKÇE yapılmaz (kör büyütme yasağı)', async () => {
    const seen: number[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init: unknown) => {
      const a = readAround(init); if (a) seen.push(a.r);
      return new Response(overpassBody([]), { status: 200 });
    }) as unknown as typeof fetch;

    await searchStreetByName('Kuvayimilliye Caddesi', ME.lat, ME.lng);   // opts YOK
    expect(seen).toEqual([20_000]);
  });

  it('🔒 yakın çevre BULDUYSA genişletme YAPILMAZ (gereksiz istek yok)', async () => {
    const seen: number[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init: unknown) => {
      const a = readAround(init); if (a) seen.push(a.r);
      return new Response(overpassBody([
        { id: 3, name: '0469. Sokak', lat: 36.9184, lon: 34.8637 },
      ]), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await searchStreetByName('0469 Sokak', ME.lat, ME.lng, { allowWideRadius: true });
    expect(seen).toEqual([20_000]);
    expect(out.length).toBe(1);
  });

  it('🔒 HATA "burada yok" SAYILMAZ — düşen sorgu GENİŞ alanla tekrarlanmaz', async () => {
    /* Zorlanan bir sunucuya daha geniş sorgu atmak onu da bizi de bloklar. */
    const seen: number[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init: unknown) => {
      const a = readAround(init); if (a) seen.push(a.r);
      return new Response('<html>busy</html>', { status: 200 });
    }) as unknown as typeof fetch;

    const out = await searchStreetByName('Kuvayimilliye Caddesi', ME.lat, ME.lng, {
      allowWideRadius: true,
    });
    expect(out).toEqual([]);
    expect(seen).toEqual([20_000]);                    // GENİŞLETME YOK
  });

  it('🔒 çapa boş dönerse kullanıcı çevresi yine denenir (çapa TEK ŞANS değil)', async () => {
    const seen: Array<{ r: number; lat: number }> = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init: unknown) => {
      const a = readAround(init); if (a) seen.push({ r: a.r, lat: a.lat });
      const body = seen.length === 1
        ? overpassBody([])
        : overpassBody([{ id: 4, name: 'Kuvayi Milliye Caddesi', lat: 36.92, lon: 34.86 }]);
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const out = await searchStreetByName('Mersin Kuvayimilliye Caddesi', ME.lat, ME.lng, {
      anchor: { lat: 36.7978, lng: 34.6298 },
    });
    expect(seen.length).toBe(2);
    expect(seen[0].lat).toBeCloseTo(36.7978, 3);       // önce çapa
    expect(seen[1].lat).toBeCloseTo(ME.lat, 3);        // sonra kullanıcı
    expect(out.length).toBe(1);
  });

  it('🔒 sokak sorgusu OLMAYAN metin ağa çıkmaz', async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await searchStreetByName('pastane', ME.lat, ME.lng, { allowWideRadius: true })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C) ŞEHİR ÇAPASI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-07 › cityAnchor', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    _resetCityAnchorCacheForTest();
    _resetNominatimRateLimitForTest();
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('🔒 sorguda il adı YOKSA ağa HİÇ çıkılmaz', async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await resolveCityAnchor('Kuvayimilliye Caddesi')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('🔒 il adı VARSA idari birim olarak çözülür', async () => {
    let url = '';
    globalThis.fetch = vi.fn(async (u: unknown) => {
      url = String(u);
      return new Response(JSON.stringify([{ lat: '36.7978381', lon: '34.6298391' }]), { status: 200 });
    }) as unknown as typeof fetch;

    const a = await resolveCityAnchor('Mersin Kuvayimilliye Caddesi');
    expect(a).not.toBeNull();
    expect(a?.city).toBe('mersin');
    expect(a?.lat).toBeCloseTo(36.7978, 3);
    /* Bir DÜKKÂN ya da CADDE çapa olamaz — idari birim istenir. */
    expect(url).toContain('featureType=settlement');
    expect(url).toContain('countrycodes=tr');
  });

  it('🔒 aynı il İKİNCİ kez ağa sorulmaz (il merkezleri değişmez)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ lat: '39.92', lon: '32.85' }]), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    await resolveCityAnchor('Ankara Atatürk Bulvarı');
    await resolveCityAnchor('Ankara Kızılay Caddesi');
    expect(f).toHaveBeenCalledTimes(1);
    expect(readCityAnchorCacheSize()).toBe(1);
  });

  it('🔒 ÇEVRİMDIŞIYKEN ağa çıkılmaz ve önbelleğe "yok" YAZILMAZ', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await resolveCityAnchor('Mersin Kuvayimilliye Caddesi')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(readCityAnchorCacheSize()).toBe(0);        // internet gelince yeniden denenir
  });

  it('🔒 geçici HTTP hatası ÖNBELLEĞE ALINMAZ', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response('err', { status: 503 })
        : new Response(JSON.stringify([{ lat: '36.7978', lon: '34.6298' }]), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await resolveCityAnchor('Mersin Kuvayimilliye Caddesi')).toBeNull();
    const second = await resolveCityAnchor('Mersin Kuvayimilliye Caddesi');
    expect(second?.city).toBe('mersin');               // yeniden soruldu
  });

  it('🔒 Null Island / bozuk koordinat çapa OLAMAZ', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify([{ lat: '0', lon: '0' }]), { status: 200 })) as unknown as typeof fetch;
    expect(await resolveCityAnchor('Mersin Kuvayimilliye Caddesi')).toBeNull();
  });

  it('🔒 ağ hatası aramayı DÜŞÜRMEZ', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(resolveCityAnchor('Mersin Kuvayimilliye Caddesi')).resolves.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D) NOMINATIM ToS — TEK OTORİTE
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-07 › Nominatim hız sınırı tek otoritedir', () => {
  beforeEach(() => { _resetNominatimRateLimitForTest(); });

  it('🔒 art arda iki slot en az ToS aralığı kadar ayrıdır', async () => {
    vi.useFakeTimers();
    try {
      const done: number[] = [];
      const p1 = awaitNominatimSlot().then(() => done.push(1));
      const p2 = awaitNominatimSlot().then(() => done.push(2));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toEqual([1]);                       // ilk slot ANINDA
      await vi.advanceTimersByTimeAsync(NOMINATIM_GAP_MS);
      await Promise.all([p1, p2]);
      expect(done).toEqual([1, 2]);                    // ikincisi BEKLEDİ
    } finally { vi.useRealTimers(); }
  });

  it('🔒 slot REZERVE edilir — eşzamanlı çağrılar aynı anı paylaşmaz', () => {
    expect(readNominatimSlotDelayMs()).toBe(0);
    void awaitNominatimSlot();
    void awaitNominatimSlot();
    expect(readNominatimSlotDelayMs()).toBeGreaterThanOrEqual(NOMINATIM_GAP_MS);
  });

  it('🔒 geocodingService KENDİ sayacını tutmaz (ikinci otorite yasağı)', async () => {
    const src = stripComments(
      (await import('../platform/geocodingService.ts?raw')).default as string,
    );
    expect(src).toContain("from './geo/nominatimRateLimit'");
    // Eski yerel sayaç geri gelmemeli.
    expect(src).not.toContain('_lastNominatimMs');
    expect(src).toContain('await _waitNominatim()');   // çağrı yeri KORUNDU
  });

  it('🔒 mapService de AYNI otoriteden geçer', async () => {
    const src = stripComments(
      (await import('../platform/mapService.ts?raw')).default as string,
    );
    expect(src).toContain('awaitNominatimSlot');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E) KAPSAM AYRIMI — "en yakın" YEREL, adres GENİŞ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-07 › kapsam ayrımı kararı', () => {
  /** `mapService`teki kararın AYNISI — kural tek yerde kalsın diye burada
   *  yeniden ifade edilmez, aynı saf girdilerden türetilir. */
  const wantsWide = (q: string): boolean => {
    const i = detectPlaceIntent(q);
    return i.category === null && (i.hasAddressStructure || detectCitiesInQuery(q).length > 0);
  };

  it('🔒 "en yakın X" kategori sorguları GENİŞ aramaya AÇILMAZ', () => {
    for (const q of [
      'en yakın eczane', 'en yakın benzinlik', 'pastane', 'eczane',
      'yakınımdaki market', 'en yakın otopark',
    ]) {
      expect(wantsWide(q), q).toBe(false);
    }
  });

  it('🔒 adres / idari sorgular GENİŞ aramaya AÇILIR', () => {
    for (const q of [
      'Bağlar Mahallesi', 'Cumhuriyet Mahallesi', 'Kuvayimilliye Caddesi',
      'Bağdat Caddesi', '0469 Sokak', 'Atatürk Bulvarı',
    ]) {
      expect(wantsWide(q), q).toBe(true);
    }
  });

  it('🔒 şehir ADI geçen sorgu, adres yapısı olmasa bile GENİŞ aranır', () => {
    expect(wantsWide('Ankara Kızılay')).toBe(true);
    expect(wantsWide('İstanbul Kadıköy')).toBe(true);
  });

  it('🔒 ŞEHİR + KATEGORİ hâlâ kategoridir (yerel kalır, geniş açılmaz)', () => {
    /* "Ankara eczane" bir kategori sorgusudur; şehir kapısı zaten
       `locationBiasGate`tedir — ikinci bir geniş geçiş GEREKMEZ. */
    expect(wantsWide('Ankara eczane')).toBe(false);
    expect(detectPlaceIntent('Ankara eczane').category?.id).toBe('eczane');
  });

  it('🔒 sokak sorgusu tanıma DEĞİŞMEDİ (P0-NAV-06 davranışı korunur)', () => {
    expect(extractStreetQuery('Kuvayimilliye Caddesi')?.kind).toBe('named');
    expect(extractStreetQuery('0469 Sokak')?.kind).toBe('numbered');
    expect(extractStreetQuery('pastane')).toBeNull();
  });
});
