/**
 * geoUriParser.test.ts — paylaşılan konum URI'lerinin KİLİTLERİ.
 *
 * SAHA KUSURU (2026-08-21): WhatsApp'tan gelen konuma basınca Android
 * seçicisinde CarOS Pro hiç çıkmıyordu. Filtre eklendi; bu testler gelen
 * URI'nin DOĞRU ayrıştırıldığını kilitler.
 *
 * ANA İLKELER:
 *  (a) `geo:0,0?q=...` DOLGUDUR — 0,0'ı hedef sanmak sürücüyü Atlantik'e sürer.
 *  (b) Koordinat yoksa UYDURULMAZ — aranabilir metin veya "çözülemedi".
 *  (c) Kısa bağlantı ağ ister — dürüstçe `short_link` denir.
 */

import { describe, it, expect } from 'vitest';
import { parseGeoUri } from '../platform/navigation/geoUriParser';

describe('KİLİT 1 — WhatsApp / Telegram geo: biçimleri', () => {
  it('geo:0,0?q=lat,lng(Ad) — gerçek hedef q\'dadır, 0,0 DOLGUDUR', () => {
    const r = parseGeoUri('geo:0,0?q=41.0082,28.9784(Sultanahmet)');
    expect(r.kind).toBe('coords');
    expect(r.kind === 'coords' && r.lat).toBeCloseTo(41.0082, 4);
    expect(r.kind === 'coords' && r.lng).toBeCloseTo(28.9784, 4);
    expect(r.kind === 'coords' && r.label).toBe('Sultanahmet');
  });

  it('geo:lat,lng — düz biçim', () => {
    const r = parseGeoUri('geo:39.9208,32.8541');
    expect(r.kind === 'coords' && r.lat).toBeCloseTo(39.9208, 4);
  });

  it('geo:lat,lng?z=15 — zoom parametresi hedefi bozmaz', () => {
    const r = parseGeoUri('geo:41.015,28.979?z=15');
    expect(r.kind === 'coords' && r.lng).toBeCloseTo(28.979, 3);
  });

  it('geo:0,0 tek başına HEDEF SAYILMAZ (sahte 0)', () => {
    const r = parseGeoUri('geo:0,0');
    expect(r.kind).toBe('unresolved');
  });

  it('etiket URL-kodluysa çözülür', () => {
    const r = parseGeoUri('geo:0,0?q=41.0,29.0(Kad%C4%B1k%C3%B6y%20%C4%B0skele)');
    expect(r.kind === 'coords' && r.label).toBe('Kadıköy İskele');
  });
});

describe('KİLİT 2 — google.navigation ve harita bağlantıları', () => {
  it('google.navigation:q=lat,lng', () => {
    const r = parseGeoUri('google.navigation:q=41.0082,28.9784');
    expect(r.kind === 'coords' && r.lat).toBeCloseTo(41.0082, 4);
  });

  it('maps.google.com ?q=lat,lng', () => {
    const r = parseGeoUri('https://maps.google.com/?q=36.8969,30.7133');
    expect(r.kind === 'coords' && r.lat).toBeCloseTo(36.8969, 4);
  });

  it('google.com/maps/@lat,lng,zoom', () => {
    const r = parseGeoUri('https://www.google.com/maps/@38.4237,27.1428,14z');
    expect(r.kind === 'coords' && r.lng).toBeCloseTo(27.1428, 4);
  });

  it('?destination=lat,lng (yol tarifi bağlantısı)', () => {
    const r = parseGeoUri('https://www.google.com/maps/dir/?api=1&destination=40.1885,29.0610');
    expect(r.kind === 'coords' && r.lat).toBeCloseTo(40.1885, 4);
  });
});

describe('KİLİT 3 — koordinat yoksa UYDURULMAZ', () => {
  it('adres metni arama sorgusu olur', () => {
    const r = parseGeoUri('geo:0,0?q=Atat%C3%BCrk%20Caddesi%20No%3A5%20Konya');
    expect(r.kind).toBe('query');
    expect(r.kind === 'query' && r.query).toMatch(/Atatürk Caddesi/);
  });

  it('kısa bağlantı dürüstçe çözülemedi der (ağ gerekir)', () => {
    const r = parseGeoUri('https://maps.app.goo.gl/aBcD1234');
    expect(r.kind).toBe('unresolved');
    expect(r.kind === 'unresolved' && r.reason).toBe('short_link');
  });

  it('boş girdi — sahte sonuç üretmez', () => {
    expect(parseGeoUri('').kind).toBe('unresolved');
    expect(parseGeoUri(null).kind).toBe('unresolved');
    expect(parseGeoUri(undefined).kind).toBe('unresolved');
  });

  it('tanınmayan biçim no_coords olur', () => {
    const r = parseGeoUri('https://example.com/bir-sey');
    expect(r.kind === 'unresolved' && r.reason).toBe('no_coords');
  });

  it('sınır dışı koordinat kabul EDİLMEZ', () => {
    expect(parseGeoUri('geo:91.0,28.9').kind).not.toBe('coords');
    expect(parseGeoUri('geo:41.0,181.0').kind).not.toBe('coords');
  });

  it('salt noktalama/sayı kalıntısı arama sorgusu SAYILMAZ', () => {
    expect(parseGeoUri('geo:0,0?q=,,,').kind).toBe('unresolved');
  });
});

describe('KİLİT 4 — negatif ve ondalıksız koordinatlar', () => {
  it('güney/batı yarımküre (negatif) çalışır', () => {
    const r = parseGeoUri('geo:0,0?q=-33.8688,151.2093(Sydney)');
    expect(r.kind === 'coords' && r.lat).toBeCloseTo(-33.8688, 4);
    expect(r.kind === 'coords' && r.lng).toBeCloseTo(151.2093, 4);
  });

  it('ondalıksız koordinat çalışır', () => {
    const r = parseGeoUri('geo:41,29');
    expect(r.kind === 'coords' && r.lat).toBe(41);
  });
});
