/**
 * currentLocation.test.ts — "Neredeyim?" zinciri: intent → action → tool.
 *
 * KAPSAM:
 *  1. Intent eşleşmesi (Türkçe karakterli + ASCII varyasyonlar) ve mevcut niyetlerin BOZULMAMASI
 *  2. Saf çekirdek: fix sınıflandırma (yok / geçersiz / bayat / süresi dolmuş) + cevap üretimi
 *  3. Servis: adres bulundu / geocode timeout / GPS yok / bayat / geçersiz koordinat
 *  4. reverseGeocode: bounded timeout · HTTP hatası · parse hatası · offline · retry YOK
 *  5. Tool: sonuç Mavi'nin cevabına (summary) ULAŞIYOR
 *
 * DÜRÜSTLÜK KİLİTLERİ: GPS yokken TAHMİN YOK · bayat fix güncelmiş gibi SUNULMAZ ·
 * adres yoksa uydurma yer adı YOK (koordinat okunur).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyLocationFix,
  buildLocationAnswer,
  LOCATION_FRESH_MS,
  LOCATION_EXPIRY_MS,
} from '../platform/location/currentLocationCore';
import { readCurrentLocation } from '../platform/location/currentLocationService';
import { MaviIntentResolver, DRIVE_INTENT_CATALOG } from '../platform/maviCore/intentResolver';
import { createPilotActionRegistry } from '../platform/maviCore/actionRegistry';

const NOW = 1_800_000_000_000;

/** Ankara Kızılay civarı — gerçekçi, geçerli koordinat. */
const FIX = { latitude: 39.9208, longitude: 32.8541, accuracy: 12, timestamp: NOW - 5_000 };

function gps(over: Partial<typeof FIX> | null = {}) {
  return () => ({
    location: over === null ? null : { ...FIX, ...over },
    source: 'native' as const,
  });
}

/* ══════════════ 1) INTENT ══════════════ */

describe('intent — "Neredeyim?" ve varyasyonları', () => {
  const resolver = new MaviIntentResolver();

  const VARIANTS = [
    'Neredeyim?',
    'Şu an neredeyim?',
    'Konumumu söyle',
    'Bulunduğum yer neresi?',
    'Neredeyiz?',
    'Konumum ne?',
  ];

  for (const utterance of VARIANTS) {
    it(`"${utterance}" → query.current_location`, () => {
      const r = resolver.resolve(utterance);
      expect(r.intent).toBe('query.current_location');
      expect(r.actionId).toBe('location.current.read');
      expect(r.reason).toBe('matched');
      expect(r.missingRequired).toEqual([]);
      expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    });
  }

  /* Sesli komut/STT çıktısı Türkçe karakter taşımayabilir (ASCII katlaması) —
     normalize aynı sonucu vermeli. */
  const ASCII_VARIANTS = [
    'neredeyim',
    'su an neredeyim',
    'konumumu soyle',
    'bulundugum yer neresi',
    'neredeyiz',
    'konumum ne',
    'NEREDEYIM',              // büyük I tuzağı (İ/I → i katlaması)
    '  neredeyim?!  ',        // noktalama + boşluk gürültüsü
  ];

  for (const utterance of ASCII_VARIANTS) {
    it(`ASCII/gürültülü "${utterance}" → query.current_location`, () => {
      expect(resolver.resolve(utterance).intent).toBe('query.current_location');
    });
  }

  it('katalogda TEK kayıt ve mevcut niyetlerin SONUNDA (öncelik bozulmadı)', () => {
    const matches = DRIVE_INTENT_CATALOG.filter((d) => d.intent === 'query.current_location');
    expect(matches).toHaveLength(1);
    expect(DRIVE_INTENT_CATALOG[DRIVE_INTENT_CATALOG.length - 1].intent).toBe('query.current_location');
  });

  it('MEVCUT niyetler BOZULMADI (konum niyeti onları çalmıyor)', () => {
    const regression: Record<string, string> = {
      'ana sayfaya dön':        'open.home',
      'ayarları aç':            'open.settings',
      'navigasyonu başlat':     'navigation.open',
      'rotayı iptal et':        'navigation.cancel',
      'araç sağlığını göster':  'open.vehicle_health',
      'sonraki şarkı':          'media.next',
      'gece modu':              'set.theme',
    };
    for (const [utterance, expected] of Object.entries(regression)) {
      expect(resolver.resolve(utterance).intent, utterance).toBe(expected);
    }
  });

  it('konum niyeti NAVİGASYON başlatmaz — ayrı eyleme bağlı', () => {
    const r = resolver.resolve('neredeyim');
    expect(r.actionId).not.toBe('navigation.open');
    expect(r.actionId).toBe('location.current.read');
  });

  it('bağlı eylem GERÇEKTEN kayıtlı (intent→action zinciri kopuk değil)', () => {
    const reg = createPilotActionRegistry();
    const r = resolver.resolve('neredeyim');
    expect(reg.has(r.actionId!)).toBe(true);
    expect(reg.get(r.actionId!)!.resultContract).toBe('value');
  });
});

/* ══════════════ 2) SAF ÇEKİRDEK ══════════════ */

describe('classifyLocationFix — fix sınıflandırma', () => {
  it('taze + geçerli → usable', () => {
    const c = classifyLocationFix(FIX, NOW);
    expect(c.klass).toBe('usable');
    expect(c.fix!.latitude).toBeCloseTo(39.9208);
    expect(c.fix!.ageMs).toBe(5_000);
  });

  it('fix yok / null koordinat → no_fix', () => {
    expect(classifyLocationFix(null, NOW).klass).toBe('no_fix');
    expect(classifyLocationFix(undefined, NOW).klass).toBe('no_fix');
    expect(classifyLocationFix({ latitude: NaN, longitude: 5, timestamp: NOW }, NOW).klass).toBe('no_fix');
    expect(classifyLocationFix({ longitude: 5, timestamp: NOW }, NOW).klass).toBe('no_fix');
  });

  it('aralık dışı enlem/boylam → invalid', () => {
    expect(classifyLocationFix({ latitude: 91, longitude: 0, timestamp: NOW }, NOW).klass).toBe('invalid');
    expect(classifyLocationFix({ latitude: -91, longitude: 0, timestamp: NOW }, NOW).klass).toBe('invalid');
    expect(classifyLocationFix({ latitude: 0, longitude: 181, timestamp: NOW }, NOW).klass).toBe('invalid');
    expect(classifyLocationFix({ latitude: 0, longitude: -181, timestamp: NOW }, NOW).klass).toBe('invalid');
  });

  it('Null Island (0,0) GERÇEK konum sayılmaz → invalid', () => {
    expect(classifyLocationFix({ latitude: 0, longitude: 0, timestamp: NOW }, NOW).klass).toBe('invalid');
  });

  it('tazelik sınırının hemen üstü → aging, sona erme sınırının üstü → expired', () => {
    const aging = classifyLocationFix({ ...FIX, timestamp: NOW - (LOCATION_FRESH_MS + 1_000) }, NOW);
    expect(aging.klass).toBe('aging');
    const expired = classifyLocationFix({ ...FIX, timestamp: NOW - (LOCATION_EXPIRY_MS + 1_000) }, NOW);
    expect(expired.klass).toBe('expired');
  });

  it('zaman damgası yoksa yaş UYDURULMAZ (ageMs null, usable)', () => {
    const c = classifyLocationFix({ latitude: 39.9, longitude: 32.8 }, NOW);
    expect(c.klass).toBe('usable');
    expect(c.fix!.ageMs).toBeNull();
    expect(c.fix!.timestampMs).toBeNull();
  });

  it('gelecek zaman damgası (saat kayması) NEGATİF yaş üretmez', () => {
    const c = classifyLocationFix({ ...FIX, timestamp: NOW + 60_000 }, NOW);
    expect(c.fix!.ageMs).toBe(0);
  });
});

describe('buildLocationAnswer — Türkçe cevap', () => {
  it('adres varsa yer adıyla cevaplar', () => {
    const a = buildLocationAnswer({
      classification: classifyLocationFix(FIX, NOW),
      address: 'Kızılay Mahallesi, Çankaya',
    });
    expect(a.ok).toBe(true);
    expect(a.basis).toBe('address');
    expect(a.text).toContain('Kızılay Mahallesi, Çankaya');
  });

  it('adres yoksa KOORDİNAT okur — uydurma yer adı YOK', () => {
    const a = buildLocationAnswer({ classification: classifyLocationFix(FIX, NOW), address: null });
    expect(a.ok).toBe(true);
    expect(a.basis).toBe('coordinates');
    expect(a.text).toContain('39.92080');
    expect(a.text).toContain('32.85410');
    expect(a.text).toContain('Adres bilgisini alamadım');
  });

  it('GPS yok → dürüst "alamıyorum", TAHMİN YOK', () => {
    const a = buildLocationAnswer({ classification: { klass: 'no_fix' }, address: null });
    expect(a.ok).toBe(false);
    expect(a.basis).toBe('none');
    expect(a.text).toContain('Konum verisini şu anda alamıyorum');
  });

  it('BAYAT fix güncelmiş gibi SUNULMAZ — yaş cümlede geçer', () => {
    const c = classifyLocationFix({ ...FIX, timestamp: NOW - 3 * 60_000 }, NOW);
    const a = buildLocationAnswer({ classification: c, address: 'Kızılay' });
    expect(a.ok).toBe(true);
    expect(a.text).toContain('3 dakika önceki');
    expect(a.text).not.toContain('Şu anda ');
  });

  it('çok eski fix → fail-closed, koordinat bile verilmez', () => {
    const c = classifyLocationFix({ ...FIX, timestamp: NOW - 10 * 60_000 }, NOW);
    const a = buildLocationAnswer({ classification: c, address: 'Kızılay' });
    expect(a.ok).toBe(false);
    expect(a.text).toContain('çok eski');
    expect(a.text).not.toContain('39.9');
  });
});

/* ══════════════ 3) SERVİS ══════════════ */

describe('readCurrentLocation — uçtan uca (DI)', () => {
  it('geçerli güncel GPS + başarılı adres → adresli cevap', async () => {
    const r = await readCurrentLocation({
      readGpsState: gps(),
      reverseGeocode: async () => 'Kızılay Mahallesi, Çankaya',
      nowMs: () => NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.address).toBe('Kızılay Mahallesi, Çankaya');
    expect(r.text).toContain('Kızılay Mahallesi, Çankaya');
    expect(r.provider).toBe('native');
    expect(r.latitude).toBeCloseTo(39.9208);
  });

  it('geçerli GPS + geocode TIMEOUT (null) → koordinatlı dürüst cevap', async () => {
    const r = await readCurrentLocation({
      readGpsState: gps(),
      reverseGeocode: async () => null,          // timeout/ağ hatası sözleşmesi
      nowMs: () => NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.address).toBeNull();
    expect(r.text).toContain('enlem 39.92080');
    expect(r.text).toContain('boylam 32.85410');
  });

  it('geocode THROW etse bile cevap üretilir (fail-soft)', async () => {
    const r = await readCurrentLocation({
      readGpsState: gps(),
      reverseGeocode: async () => { throw new Error('ağ patladı'); },
      nowMs: () => NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.address).toBeNull();
    expect(r.text).toContain('enlem');
  });

  it('GPS YOK → unavailable, ağa HİÇ çıkılmaz', async () => {
    const geocode = vi.fn(async () => 'olmamalı');
    const r = await readCurrentLocation({
      readGpsState: gps(null), reverseGeocode: geocode, nowMs: () => NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('Konum verisini şu anda alamıyorum');
    expect(geocode).not.toHaveBeenCalled();       // boşuna istek yok
  });

  it('BAYAT GPS (3 dk) → cevap verilir ama yaşı BEYAN edilir', async () => {
    const r = await readCurrentLocation({
      readGpsState: gps({ timestamp: NOW - 3 * 60_000 }),
      reverseGeocode: async () => 'Kızılay',
      nowMs: () => NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.classification.klass).toBe('aging');
    expect(r.text).toContain('3 dakika önceki');
  });

  it('ÇOK ESKİ GPS (10 dk) → fail-closed unavailable, geocode çağrılmaz', async () => {
    const geocode = vi.fn(async () => 'olmamalı');
    const r = await readCurrentLocation({
      readGpsState: gps({ timestamp: NOW - 10 * 60_000 }),
      reverseGeocode: geocode, nowMs: () => NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.classification.klass).toBe('expired');
    expect(geocode).not.toHaveBeenCalled();
  });

  it('GEÇERSİZ koordinat → unavailable, geocode çağrılmaz', async () => {
    const geocode = vi.fn(async () => 'olmamalı');
    for (const bad of [{ latitude: 95, longitude: 32 }, { latitude: 39, longitude: 200 }, { latitude: 0, longitude: 0 }]) {
      const r = await readCurrentLocation({
        readGpsState: gps(bad), reverseGeocode: geocode, nowMs: () => NOW,
      });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.classification.klass).toBe('invalid');
    }
    expect(geocode).not.toHaveBeenCalled();
  });

  it('GPS store PATLARSA throw etmez — dürüst unavailable', async () => {
    const r = await readCurrentLocation({
      readGpsState: () => { throw new Error('store yok'); },
      nowMs: () => NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.provider).toBeNull();
  });

  it('geocode bütçesi servis tarafından AÇIKÇA geçilir (bounded)', async () => {
    const geocode = vi.fn(async () => null);
    await readCurrentLocation({ readGpsState: gps(), reverseGeocode: geocode, nowMs: () => NOW });
    expect(geocode).toHaveBeenCalledTimes(1);                  // RETRY YOK
    const budget = geocode.mock.calls[0][2] as unknown as number;
    expect(budget).toBeGreaterThanOrEqual(2_000);
    expect(budget).toBeLessThanOrEqual(3_000);
  });
});

/* ══════════════ 4) reverseGeocode ══════════════ */

describe('reverseGeocode — bounded + fail-soft', () => {
  const realFetch = globalThis.fetch;
  const realOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, 'onLine');

  function setOnLine(value: boolean): void {
    Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
  }

  beforeEach(() => { setOnLine(true); });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realOnLine) Object.defineProperty(globalThis.navigator, 'onLine', realOnLine);
    vi.restoreAllMocks();
  });

  /* ⚠️ SÜRE: bu dosyadaki İLK `await import(...)` ~360 modüllük kapanışı derler
     (sonraki importlar önbellekten gelir ve hızlıdır). Düşük-uç/yüklü makinede
     bu tek seferlik derleme 5 sn varsayılanını aşabiliyor → testin İDDİASI
     değil yalnız SÜRESİ genişletildi. Mantık kilidi aynen korunur. */
  it('başarılı yanıt → kısa adres', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ display_name: 'Kızılay Mahallesi, Çankaya, Ankara, Türkiye' }),
    })) as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    expect(await reverseGeocode(39.92, 32.85, 3_000)).toBe('Kızılay Mahallesi, Çankaya');
  }, 30_000);

  it('HTTP hatası → null (throw YOK)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    expect(await reverseGeocode(39.92, 32.85, 3_000)).toBeNull();
  });

  it('parse hatası → null', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => { throw new SyntaxError('bozuk json'); },
    })) as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    expect(await reverseGeocode(39.92, 32.85, 3_000)).toBeNull();
  });

  it('ağ hatası → null, TEK deneme (retry YOK)', async () => {
    const f = vi.fn(async () => { throw new TypeError('network'); });
    globalThis.fetch = f as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    expect(await reverseGeocode(39.92, 32.85, 3_000)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('boş display_name → null (uydurma adres yok)', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ display_name: '   ' }),
    })) as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    expect(await reverseGeocode(39.92, 32.85, 3_000)).toBeNull();
  });

  it('ÇEVRİMDIŞI → ağa HİÇ çıkmaz, anında null', async () => {
    setOnLine(false);
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    expect(await reverseGeocode(39.92, 32.85, 3_000)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('geçersiz koordinat → istek YAPILMAZ', async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    expect(await reverseGeocode(NaN, 32.85, 3_000)).toBeNull();
    expect(await reverseGeocode(95, 32.85, 3_000)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('istekte API anahtarı / Authorization TAŞINMAZ', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ display_name: 'X, Y' }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    const { reverseGeocode } = await import('../platform/geocodingService');
    await reverseGeocode(39.92, 32.85, 3_000);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const headerKeys = Object.keys((init.headers ?? {}) as Record<string, string>).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');
    expect(headerKeys).not.toContain('x-api-key');
  });
});

/* ══════════════ 5) TOOL → MAVİ CEVABI ══════════════ */

describe('get_current_location — tool sonucu Mavi cevabına ULAŞIYOR', () => {
  afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  async function loadToolWith(gpsLocation: unknown, address: string | null) {
    vi.resetModules();
    vi.doMock('../platform/gpsService', () => ({
      getGPSState: () => ({ location: gpsLocation, source: 'native', heading: null, isTracking: true, error: null, unavailable: false }),
    }));
    vi.doMock('../platform/geocodingService', () => ({
      reverseGeocode: async () => address,
      REVERSE_GEOCODE_TIMEOUT_MS: 3_000,
    }));
    const { MAVI_TOOLS } = await import('../platform/ai/tools/concrete/maviTools');
    const tool = MAVI_TOOLS.find((t) => t.name === 'get_current_location')!;
    expect(tool).toBeDefined();
    return tool;
  }

  it('allowlist\'te SALT-OKUNUR olarak kayıtlı (yazma/navigasyon değil)', async () => {
    const { MAVI_TOOLS } = await import('../platform/ai/tools/concrete/maviTools');
    const tool = MAVI_TOOLS.find((t) => t.name === 'get_current_location')!;
    expect(tool.effect).toBe('read');
    expect(tool.requiresConfirmation).not.toBe(true);
    expect(Object.keys(tool.parameters)).toHaveLength(0);
  });

  it('güncel GPS + adres → summary Mavi\'nin söyleyeceği cümledir', async () => {
    const tool = await loadToolWith({ ...FIX, timestamp: Date.now() }, 'Kızılay Mahallesi, Çankaya');
    const res = await tool.handler({}, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain('Kızılay Mahallesi, Çankaya');
    expect(res.data['answer']).toBe(res.summary);
    expect(res.data['latitude']).toBeCloseTo(39.9208);
    expect(res.data['stale']).toBe(false);
  });

  it('adres yoksa summary KOORDİNAT taşır (dürüst fallback)', async () => {
    const tool = await loadToolWith({ ...FIX, timestamp: Date.now() }, null);
    const res = await tool.handler({}, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain('enlem');
    expect(res.data['address']).toBeUndefined();
  });

  it('GPS yok → unavailable + dürüst mesaj (uydurma konum YOK)', async () => {
    const tool = await loadToolWith(null, 'olmamalı');
    const res = await tool.handler({}, {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('unavailable');
    expect(res.message).toContain('Konum verisini şu anda alamıyorum');
  });

  it('bayat GPS → stale=true ve cevapta yaş beyanı', async () => {
    const tool = await loadToolWith({ ...FIX, timestamp: Date.now() - 2 * 60_000 }, 'Kızılay');
    const res = await tool.handler({}, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data['stale']).toBe(true);
    expect(res.summary).toContain('dakika önceki');
  });

  it('çok eski GPS → fail-closed unavailable', async () => {
    const tool = await loadToolWith({ ...FIX, timestamp: Date.now() - 20 * 60_000 }, 'Kızılay');
    const res = await tool.handler({}, {});
    expect(res.ok).toBe(false);
  });
});
