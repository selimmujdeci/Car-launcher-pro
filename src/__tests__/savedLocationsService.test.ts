/**
 * savedLocationsService.test.ts — Özel Konumlar TEK OTORİTE testleri.
 *
 * Kapsam: isimli kayıt · legacy adsız uyum · rename ID korur · isim çözümleme
 * (tam/ambiguous/bulunamadı) · paylaşım metni/yolu · GPS-yok fail-closed
 * (sayısal düzeyde) · store'un TEK gerçek kaynak olduğu (useStore.customLocations).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useStore } from '../store/useStore';
import {
  getSavedLocations, addSavedLocation, renameSavedLocation, removeSavedLocation,
  findSavedLocationByName, buildLocationShareText, buildLocationMapsUrl,
  shareSavedLocation,
} from '../platform/savedLocations/savedLocationsService';

beforeEach(() => { useStore.getState().resetSettings(); });
afterEach(() => { useStore.getState().resetSettings(); });

describe('savedLocationsService — CRUD (TEK otorite: useStore.settings.customLocations)', () => {
  it('isimli konum kaydeder', () => {
    const loc = addSavedLocation(36.9, 34.8, 'Mavi Göl');
    expect(loc?.name).toBe('Mavi Göl');
    expect(loc?.lat).toBe(36.9);
    expect(loc?.lng).toBe(34.8);
    expect(getSavedLocations()).toHaveLength(1);
    expect(getSavedLocations()[0].id).toBe(loc?.id);
  });

  it('legacy adsız kayıt uyumu — isim verilmezse fallback "Konum N" (eski davranış)', () => {
    const a = addSavedLocation(1, 1, null);
    const b = addSavedLocation(2, 2, '');
    expect(a?.name).toBe('Konum 1');
    expect(b?.name).toBe('Konum 2');
  });

  it('kayıt UI ile aynı store alanlarını (id/lat/lng/name/timestamp) kullanır — legacy okuyucu bozulmaz', () => {
    addSavedLocation(10, 20, 'Depo');
    const raw = useStore.getState().settings.customLocations;
    expect(raw[0]).toMatchObject({ lat: 10, lng: 20, name: 'Depo' });
    expect(typeof raw[0].id).toBe('string');
    expect(typeof raw[0].timestamp).toBe('number');
  });

  it('rename — AYNI ID korunur (sil-yeniden-oluştur YOK)', () => {
    const loc = addSavedLocation(1, 1, 'Mavi Göl');
    const id = loc!.id;
    const ok = renameSavedLocation(id, 'Piknik Alanı');
    expect(ok).toBe(true);
    const all = getSavedLocations();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);           // ID DEĞİŞMEDİ
    expect(all[0].name).toBe('Piknik Alanı');
    expect(all[0].lat).toBe(1);            // koordinat DEĞİŞMEDİ
  });

  it('rename — olmayan ID sessizce false döner (yan etki yok)', () => {
    expect(renameSavedLocation('yok-id', 'X')).toBe(false);
  });

  it('remove — kaydı siler, diğerlerine dokunmaz', () => {
    const a = addSavedLocation(1, 1, 'A');
    const b = addSavedLocation(2, 2, 'B');
    expect(removeSavedLocation(a!.id)).toBe(true);
    const remaining = getSavedLocations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b!.id);
  });

  it('GPS kanıtı yoksa (NaN/Infinity) kayıt OLUŞTURULMAZ — fail-closed', () => {
    expect(addSavedLocation(NaN, 34.8, 'X')).toBeNull();
    expect(addSavedLocation(36.9, Infinity, 'X')).toBeNull();
    expect(getSavedLocations()).toHaveLength(0);
  });
});

describe('savedLocationsService — isim çözümleme (rastgele seçim YOK)', () => {
  it('tam eşleşme (Türkçe büyük/küçük harf + boşluk farkına dayanıklı)', () => {
    addSavedLocation(1, 1, 'Mavi Göl');
    const r = findSavedLocationByName('  MAVİ GÖL  ');
    expect(r.match?.name).toBe('Mavi Göl');
    expect(r.ambiguous).toHaveLength(0);
  });

  it('bilinmeyen isim → match null, ambiguous boş (fail-closed, uydurma YOK)', () => {
    addSavedLocation(1, 1, 'Depo');
    const r = findSavedLocationByName('Olmayan Yer');
    expect(r.match).toBeNull();
    expect(r.ambiguous).toHaveLength(0);
  });

  it('birden fazla benzer isim → AMBIGUOUS döner, rastgele seçim YAPILMAZ', () => {
    addSavedLocation(1, 1, 'Mavi Göl');
    addSavedLocation(2, 2, 'Mavi Göl');
    const r = findSavedLocationByName('Mavi Göl');
    expect(r.match).toBeNull();
    expect(r.ambiguous).toHaveLength(2);
  });

  it('boş isim → eşleşme yok', () => {
    addSavedLocation(1, 1, 'Depo');
    const r = findSavedLocationByName('   ');
    expect(r.match).toBeNull();
    expect(r.ambiguous).toHaveLength(0);
  });
});

describe('savedLocationsService — paylaşım (share) DOĞRU konumu kullanır', () => {
  it('paylaşım metni ad + koordinat + HTTPS harita bağlantısı içerir', () => {
    const loc = addSavedLocation(36.123456, 34.654321, 'Mavi Göl')!;
    const text = buildLocationShareText(loc);
    expect(text).toContain('Mavi Göl');
    expect(text).toContain('36.123456');
    expect(text).toContain('34.654321');
    expect(text).toContain(buildLocationMapsUrl(loc));
    expect(buildLocationMapsUrl(loc)).toMatch(/^https:\/\/www\.google\.com\/maps\?q=/);
  });

  it('navigator.share varsa DOĞRU konumun metniyle çağrılır (native rota)', async () => {
    const loc = addSavedLocation(10, 20, 'Depo')!;
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share: shareSpy });
    const r = await shareSavedLocation(loc);
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const arg = shareSpy.mock.calls[0][0];
    expect(arg.text).toContain('Depo');
    expect(arg.text).toContain('10.000000');
    expect(r).toEqual({ ok: true, route: 'native' });
    vi.unstubAllGlobals();
  });

  it('navigator.share YOKSA panoya düşer, sessiz "başarılı" YALANI yok', async () => {
    const loc = addSavedLocation(10, 20, 'Depo')!;
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: undefined });
    const r = await shareSavedLocation(loc);
    expect(r.route).not.toBe('native');
    vi.unstubAllGlobals();
  });

  it('kullanıcı native paylaşım sayfasını İPTAL ederse (AbortError) başarısızlık SAYILMAZ', async () => {
    const loc = addSavedLocation(10, 20, 'Depo')!;
    const shareSpy = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    vi.stubGlobal('navigator', { ...navigator, share: shareSpy });
    const r = await shareSavedLocation(loc);
    expect(r).toEqual({ ok: true, route: 'native' });
    vi.unstubAllGlobals();
  });
});
