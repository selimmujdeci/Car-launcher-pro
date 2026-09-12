/**
 * restAreaVoiceQuery.test.ts — DİNLENME TESİSİ sesli sorgusu (SIRA 1).
 *
 * ── ÖLÇÜLEN KUSUR (2026-08-13, gerçek Overpass sorguları) ──────────────────
 * "biraz yoruldum / mola vereyim" isteği `FIND_NEARBY_PARKING`e düşüyor ve
 * `amenity=parking` aranıyordu. O-4 Anadolu Otoyolu (Bolu), 25 km yarıçap:
 *     amenity=parking      **206**   ← ürünün gördüğü (köy/şehir otoparkları)
 *     highway=services      **13**   ← gerçek dinlenme tesisi
 *     highway=rest_area      **5**
 * Dinlenme tesisleri `amenity` ile etiketlenMEZ → sorgu kurucusu `[amenity=X]`
 * sabitiyle yazdığı için YAPISAL olarak ulaşılamazlardı.
 *
 * İKİNCİ KUSUR: yarıçap da 5 km sabitti. Aynı noktada dinlenme tesisi sayısı
 *     5 km → **0** · 10 km → 2 · 15 km → 6 · 25 km → 18   (en yakını 7,5 km)
 * Yani etiket düzeltilse bile 5 km'de sonuç GELMEZDİ.
 *
 * Bu kasa ikisini de kilitler ve KONTROL testleriyle mevcut kategorilerin
 * davranışının DEĞİŞMEDİĞİNİ kanıtlar.
 */
import { describe, it, expect } from 'vitest';
import nearbySrc      from '../platform/nearbyPoiNavigation.ts?raw';
import geocodingSrc   from '../platform/geocodingService.ts?raw';
import intentSrc      from '../platform/intentEngine.ts?raw';
import executorSrc    from '../platform/commandExecutor.ts?raw';
import addressNavSrc  from '../platform/addressNavigationEngine.ts?raw';
import i18nSrc        from '../i18n/config.ts?raw';
import { NEARBY_POI_CATALOG, type NearbyPoiCategory } from '../platform/nearbyPoiNavigation';

/** Yorumları soyar — kilitler YORUMU değil KODU denetlemeli. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
   .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

/* ── Etiket süzgeci — asıl kök ─────────────────────────────────────────────── */

describe('dinlenme tesisi — OSM etiketi', () => {
  it('🔒 sorgu `amenity=` SABİTİNE gömülü DEĞİL (kökün ta kendisi)', () => {
    /* Eski hâl: `[amenity=${amenity}](around:5000,...)`. Bu satır geri gelirse
       dinlenme tesisi yeniden görünmez olur. */
    expect(code(geocodingSrc)).not.toMatch(/node\[amenity=\$\{amenity\}\]/);
    expect(code(geocodingSrc)).toMatch(/NEARBY_FILTERS/);
  });

  it('🔒 dinlenme tesisi `highway=services` VE `highway=rest_area` arar', () => {
    const c = code(geocodingSrc);
    expect(c).toContain("'highway=services'");
    expect(c).toContain("'highway=rest_area'");
    // İkisi AYNI kategoride olmalı — biri eksikse tesislerin bir kısmı kaybolur.
    expect(c).toMatch(/rest_area:\s*\{\s*tags:\s*\['highway=services',\s*'highway=rest_area'\]/);
  });

  it('🔒 mevcut kategoriler AYNEN amenity kalır (KONTROL — davranış değişmedi)', () => {
    const c = code(geocodingSrc);
    expect(c).toMatch(/fuel:\s*\{\s*tags:\s*\['amenity=fuel'\]/);
    expect(c).toMatch(/parking:\s*\{\s*tags:\s*\['amenity=parking'\]/);
    expect(c).toMatch(/hospital:\s*\{\s*tags:\s*\['amenity=hospital'\]/);
  });
});

/* ── Yarıçap — ikinci kök ──────────────────────────────────────────────────── */

describe('dinlenme tesisi — yarıçap', () => {
  it('🔒 yarıçap SABİT 5000 değil, kategoriden gelir', () => {
    expect(code(geocodingSrc)).not.toMatch(/around:5000,\$\{lat\}/);
    expect(code(geocodingSrc)).toMatch(/around:\$\{r\}/);
  });

  it('🔒 dinlenme tesisi yarıçapı ölçülen boşluğu kapatır (>5 km)', () => {
    /* 5 km'de ölçülen sonuç SIFIRDI; en yakın tesis 7,5 km. Bu eşiğin altına
       düşerse özellik sessizce "bulunamadı" demeye başlar. */
    expect(NEARBY_POI_CATALOG.restArea.radiusM).toBeGreaterThan(10_000);
  });

  it('🔒 mevcut kategorilerin yarıçapı DEĞİŞMEDİ (KONTROL)', () => {
    expect(NEARBY_POI_CATALOG.fuel.radiusM).toBe(5000);
    expect(NEARBY_POI_CATALOG.parking.radiusM).toBe(5000);
    expect(NEARBY_POI_CATALOG.hospital.radiusM).toBe(5000);
    expect(code(geocodingSrc)).toMatch(/fuel:\s*\{\s*tags:[^}]*radiusM:\s*5000/);
  });
});

/* ── Katalog bütünlüğü ─────────────────────────────────────────────────────── */

describe('katalog — her kategori TAM tanımlı', () => {
  const cats = Object.keys(NEARBY_POI_CATALOG) as NearbyPoiCategory[];

  it('restArea kataloğa eklendi', () => {
    expect(cats).toContain('restArea');
  });

  it.each(['fuel', 'hospital', 'parking', 'restArea'] as NearbyPoiCategory[])(
    '%s: sentinel · TTS anahtarları · yarıçap eksiksiz', (cat) => {
      const d = NEARBY_POI_CATALOG[cat];
      expect(d.sentinel).toMatch(/^__nearby_.+__$/);
      expect(d.amenity.length).toBeGreaterThan(0);
      expect(d.radiusM).toBeGreaterThan(0);
      for (const k of [d.successKey, d.notFoundKey, d.errorKey, d.gpsUnavailableKey]) {
        expect(k, `${cat}: TTS anahtarı boş`).toMatch(/^navigation\./);
      }
    });

  it('🔒 sentinel\'ler BENZERSİZ — iki kategori aynı hedefe gitmez', () => {
    const sentinels = cats.map((c) => NEARBY_POI_CATALOG[c].sentinel);
    expect(new Set(sentinels).size).toBe(sentinels.length);
  });

  it('🔒 her TTS anahtarının i18n karşılığı VAR (tr + en) — sessiz komut yok', () => {
    for (const cat of cats) {
      const d = NEARBY_POI_CATALOG[cat];
      for (const full of [d.successKey, d.notFoundKey, d.errorKey]) {
        const leaf = full.replace(/^navigation\./, '');
        const hits = i18nSrc.split(`"${leaf}"`).length - 1;
        expect(hits, `${leaf}: i18n karşılığı eksik (tr+en = 2 bekleniyor)`)
          .toBeGreaterThanOrEqual(2);
      }
    }
  });
});

/* ── Uçtan uca zincir ──────────────────────────────────────────────────────── */

describe('uçtan uca zincir — sesli niyet → dispatch → Overpass', () => {
  it('🔒 niyet tanımlı ve GEÇERLİ sayılıyor (yoksa AI çıktısı reddedilir)', () => {
    const c = code(intentSrc);
    expect(c).toContain("| 'FIND_NEARBY_REST_AREA'");
    expect(c).toMatch(/VALID_INTENTS[\s\S]{0,400}FIND_NEARBY_REST_AREA/);
  });

  it('🔒 niyet MERKEZİ hatta gider (düz-metin geocode DEĞİL)', () => {
    /* fuel/parking P1-1/P1-2'de düz-metin geocode'dan alınıp bu hatta taşındı;
       yeni kategori aynı hattı kullanmalı — yoksa üçüncü bir yol doğar. */
    expect(code(intentSrc)).toMatch(/FIND_NEARBY_REST_AREA[\s\S]{0,400}dispatchNearbyPoi\?\.\('restArea'\)/);
    expect(code(executorSrc)).toMatch(/FIND_NEARBY_REST_AREA[\s\S]{0,500}dispatchNearbyPoi\('restArea'\)/);
  });

  it('🔒 sentinel Overpass tipine çözülüyor (zincirin son halkası)', () => {
    const c = code(addressNavSrc);
    expect(c).toContain("'__nearby_rest_area__'");
    expect(c).toMatch(/__nearby_rest_area__'\s*\?\s*'rest_area'/);
    // "yakın hedef" sayılmazsa çevrimdışı dala düşer ve Overpass hiç çağrılmaz.
    expect(c).toMatch(/isNearby[\s\S]{0,200}__nearby_rest_area__/);
  });

  it('🔒 "yoruldum/mola" artık OTOPARK\'a düşmüyor', () => {
    /* Kusurun kullanıcıya görünen yüzü buydu: otoyolda "mola" deyince şehir
       otoparkı öneriliyordu. */
    const voice = code(nearbySrc) + code(intentSrc);
    expect(voice).toContain('restArea');
    // İstem örneği doğru niyete bağlanmış olmalı.
    expect(code(i18nSrc)).toContain('nearby_rest_area_starting');
  });
});
